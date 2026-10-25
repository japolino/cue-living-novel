import { chromium, devices, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";

/**
 * How a reply opens, waits and ends, in a real browser: the opening card
 * (words, growing rule, tap to start), the location label beside the top-left
 * controls, every waiting backdrop with every recap (line-up taps swap the
 * line and the picture, cards, the moving film), the reply box's extras and
 * the closed reply box, on desktop and a 393x851 phone, with no console errors
 * and no sideways scroll.
 * Screenshots: .cache/scene-flow/
 * Run: bun run ./scripts/test-scene-flow-browser.ts
 */
const OUT = ".cache/scene-flow";
const build = await Bun.build({ entrypoints: ["scripts/scene-flow-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
    if (path.startsWith("/sprites/")) {
      const file = path.slice("/sprites/".length).replace(/[^\w.-]/g, "");
      try { return new Response(await readFile(`scripts/fixtures/sprites/${file}`), { headers: { "Content-Type": "image/webp" } }); }
      catch { return new Response("missing", { status: 404 }); }
    }
    return new Response('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
  },
});
const url = (query: Record<string, string> = {}) => `http://127.0.0.1:${server.port}/?${new URLSearchParams(query)}`;
await mkdir(OUT, { recursive: true });

const BACKDROPS = ["card", "tidy", "daylight", "cast"] as const;
const RECAPS = ["lineup", "cards", "film", "off"] as const;

type Box = { x: number; y: number; width: number; height: number };
const inside = (box: Box | null, width: number, height: number, slack = 1): boolean =>
  Boolean(box && box.x >= -slack && box.y >= -slack && box.x + box.width <= width + slack && box.y + box.height <= height + slack);
const overlaps = (a: Box | null, b: Box | null): boolean =>
  Boolean(a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height);

const errors: string[] = [];
function watch(page: Page): void {
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(String(error)));
}

async function noSidewaysScroll(page: Page, where: string): Promise<void> {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(wide, false, `${where}: no sideways scroll`);
}

/** The opening card, a tap, the label while reading. */
async function opening(page: Page, size: { width: number; height: number }, tag: string): Promise<void> {
  const card = page.locator("[data-vn-opening]");
  await card.waitFor();
  assert.equal(await page.locator("[data-vn-opening] [data-vn-scene-kicker]").textContent(), "Scene · Seiran Academy");
  assert.equal(await page.locator("[data-vn-opening] [data-vn-scene-title]").textContent(), "Classroom 2-B, Seiran Academy");
  assert.equal(await page.locator("[data-vn-opening] [data-vn-scene-meta]").textContent(), "clear · after school · 7 paragraphs");
  assert.match(await page.locator("[data-vn-opening-bg]").evaluate((el) => getComputedStyle(el).backgroundImage), /plate_park\.webp/, `${tag}: the card's own picture is behind the opening card`);
  // The gold rule grows in.
  await page.waitForTimeout(1200);
  const rule = await page.locator("[data-vn-scene-rule]").boundingBox();
  assert.ok(rule && rule.width > 60, `${tag}: the rule has grown (${rule?.width}px)`);
  const words = await page.locator("[data-vn-opening-card]").boundingBox();
  assert.ok(inside(words, size.width, size.height), `${tag}: the card's words fit the screen`);
  assert.equal((await page.locator("[data-vn-dialogue-text]").textContent())?.includes("late again"), false, `${tag}: the first paragraph waits for the card`);
  await noSidewaysScroll(page, `${tag} opening card`);
  await page.screenshot({ path: `${OUT}/opening-${tag}.png` });
  await card.click();
  await page.waitForTimeout(450);
  assert.equal(await card.isHidden(), true, `${tag}: a tap closes the card`);
  await page.locator("[data-vn-dialogue-text]", { hasText: "late again" }).waitFor();

  const label = page.locator("[data-vn-location]");
  await label.waitFor();
  assert.equal(await page.locator("[data-vn-location-place]").textContent(), "Classroom 2-B, Seiran Academy");
  assert.equal(await page.locator("[data-vn-location-meta]").textContent(), "after school · clear");
  const labelBox = await label.boundingBox();
  assert.ok(labelBox && labelBox.x < size.width / 2 && labelBox.y < 120, `${tag}: the label sits at the top left (${JSON.stringify(labelBox)})`);
  assert.ok(inside(labelBox, size.width, size.height), `${tag}: the label fits the screen`);
  // The Panels launcher's corner (44px tall at 12px), Back to chat, the toolbar, the badges, the dialogue.
  assert.ok(labelBox && labelBox.y >= 56, `${tag}: the label sits below the Panels launcher's corner`);
  for (const selector of ["[data-vn-controls]", "[data-vn-exit]", "[data-vn-dialogue]", "[data-vn-badge]"]) {
    const others = page.locator(selector);
    for (let index = 0; index < await others.count(); index += 1) {
      const other = others.nth(index);
      if (!(await other.isVisible())) continue;
      assert.equal(overlaps(labelBox, await other.boundingBox()), false, `${tag}: the label does not cover ${selector}`);
    }
  }
  await page.screenshot({ path: `${OUT}/reading-label-${tag}.png` });
}

/** Your turn: Previous, From the start, Close; Close leaves a Reply button. */
async function replyBox(page: Page, tag: string): Promise<void> {
  await page.evaluate(() => (window as any).fx.toEnd());
  await page.getByRole("heading", { name: "Your turn" }).waitFor();
  for (const name of ["Previous", "From the start", "Close the reply box"]) {
    assert.equal(await page.locator("[data-vn-interaction-actions]").getByRole("button", { name, exact: true }).isVisible(), true, `${tag}: ${name} in the reply box`);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/reply-box-${tag}.png` });
  await page.locator("[data-vn-interaction-actions]").getByRole("button", { name: "Close the reply box", exact: true }).click();
  const reply = page.locator("[data-vn-reply-open]");
  await reply.waitFor();
  assert.equal(await page.locator("[data-vn-interaction]").isHidden(), true, `${tag}: Close hides the reply box`);
  await page.screenshot({ path: `${OUT}/reply-closed-${tag}.png` });
  await reply.click();
  await page.locator("[data-vn-input]").waitFor();
}

/** Every backdrop with every recap while the next reply is written. */
async function waitingScreens(page: Page, size: { width: number; height: number }, tag: string, recaps: readonly string[]): Promise<void> {
  await page.evaluate(() => (window as any).fx.waiting());
  const screen = page.locator("[data-vn-waiting]");
  await screen.waitFor();
  for (const backdrop of BACKDROPS) {
    for (const recap of recaps) {
      await page.evaluate(([b, r]) => (window as any).fx.flow({ waitingBackdrop: b, waitingRecap: r }), [backdrop, recap]);
      await page.waitForFunction(([b, r]) => {
        const el = document.querySelector("[data-vn-stage-host]")?.shadowRoot?.querySelector("[data-vn-theme-host]")?.shadowRoot?.querySelector("[data-vn-waiting]") as HTMLElement | null
          ?? (document.querySelector("[data-vn-waiting]") as HTMLElement | null);
        return Boolean(el && !el.hidden && el.dataset.vnBackdrop === b && (r === "auto" || el.dataset.vnRecap === r));
      }, [backdrop, recap]);
      await page.waitForTimeout(1100);
      await page.screenshot({ path: `${OUT}/waiting-${backdrop}-${recap}-${tag}.png` });
      const where = `${tag} ${backdrop}/${recap}`;
      const screenBox = await screen.boundingBox();
      assert.ok(screenBox && screenBox.width >= size.width - 2 && screenBox.height >= size.height - 2, `${where}: the waiting screen covers the stage`);
      assert.equal(await page.locator("[data-vn-waiting-status]").textContent(), "Mira is writing the next scene…", `${where}: status`);
      const info = await page.locator("[data-vn-waiting-info]").boundingBox();
      assert.ok(inside(info, size.width, size.height), `${where}: the scene words fit (${JSON.stringify(info)})`);
      if (recap === "lineup") {
        const figures = page.locator("[data-vn-waiting-figure]");
        assert.equal(await figures.count(), 3, `${where}: three characters stand`);
        for (let index = 0; index < 3; index += 1) {
          const figure = figures.nth(index);
          assert.ok(inside(await figure.locator("[data-vn-bubble]").boundingBox(), size.width, size.height), `${where}: bubble ${index} fits`);
          assert.ok(inside(await figure.locator("[data-vn-name-tag]").boundingBox(), size.width, size.height), `${where}: name tag ${index} fits`);
          const tag = await figure.locator("[data-vn-name-tag]").boundingBox();
          assert.equal(overlaps(tag, await page.locator("[data-vn-waiting-status]").boundingBox()), false, `${where}: name tag ${index} clear of the status line`);
          const loaded = await figure.locator("[data-vn-figure-img][data-vn-front]").evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0);
          assert.equal(loaded, true, `${where}: figure ${index} shows its picture`);
        }
      }
      // The recap never covers the status line or what you sent.
      for (const part of ["[data-vn-waiting-status]", "[data-vn-waiting-sent]"]) {
        const box = await page.locator(part).boundingBox();
        for (const selector of ["[data-vn-recap-card]", "[data-vn-film]", "[data-vn-film-recap]", "[data-vn-bubble]", "[data-vn-name-tag]", "[data-vn-cast-header]", "[data-vn-daylight-tip]"]) {
          const others = page.locator(selector);
          for (let index = 0; index < await others.count(); index += 1) {
            if (!(await others.nth(index).isVisible())) continue;
            assert.equal(overlaps(box, await others.nth(index).boundingBox()), false, `${where}: ${selector} clear of ${part}`);
          }
        }
      }
      if (recap === "cards") {
        assert.ok(inside(await page.locator("[data-vn-recap-card]").boundingBox(), size.width, size.height), `${where}: the card fits`);
        if (tag === "phone") assert.equal(overlaps(await page.locator("[data-vn-card-figure]").boundingBox(), await page.locator("[data-vn-waiting-status]").boundingBox()), false, `${where}: the picture stays off the status text`);
        assert.ok((await page.locator("[data-vn-recap-line]").textContent())?.length, `${where}: the card has a line`);
      }
      if (recap === "film") {
        // The film pauses under the pointer (to read a card): move it away.
        await page.mouse.move(2, 2);
        const offset = () => page.locator("[data-vn-film-track]").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
        const first = await offset();
        await page.waitForTimeout(500);
        assert.notEqual(await offset(), first, `${where}: the film moves`);
      }
      await noSidewaysScroll(page, where);
    }
  }
}

/** A tap on a line-up figure: the bubble shows their next line and the picture changes to it. */
async function lineupTap(page: Page, tag: string): Promise<void> {
  await page.evaluate(() => (window as any).fx.flow({ waitingBackdrop: "card", waitingRecap: "lineup" }));
  await page.waitForTimeout(700);
  const mira = page.locator("[data-vn-waiting-figure]", { has: page.locator("[data-vn-name-tag]", { hasText: "Mira" }) });
  const before = await mira.locator("[data-vn-bubble-text]").textContent();
  const pictureBefore = await mira.locator("[data-vn-figure-img][data-vn-front]").getAttribute("src");
  await mira.locator("[data-vn-figure-body]").click();
  await page.waitForTimeout(450);
  const after = await mira.locator("[data-vn-bubble-text]").textContent();
  assert.notEqual(after, before, `${tag}: a tap gives Mira's next line`);
  assert.notEqual(await mira.locator("[data-vn-figure-img][data-vn-front]").getAttribute("src"), pictureBefore, `${tag}: and the picture of that line`);
  assert.equal(await page.evaluate(() => (window as any).fx.state().phase), "waiting-for-response", `${tag}: the tap never reaches the stage`);
  await page.screenshot({ path: `${OUT}/lineup-tap-${tag}.png` });
}

let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });

  const desktopSize = { width: 1280, height: 800 };
  const desktop = await browser.newPage({ viewport: desktopSize });
  watch(desktop);
  await desktop.goto(url({ card: "title" }));
  await opening(desktop, desktopSize, "desktop");
  await replyBox(desktop, "desktop");
  await waitingScreens(desktop, desktopSize, "desktop", RECAPS);
  await lineupTap(desktop, "desktop");
  // A new reply: the waiting screen goes and the next card opens.
  await desktop.evaluate(() => (window as any).fx.load());
  await desktop.locator("[data-vn-opening]").waitFor();
  // It fades out.
  await desktop.locator("[data-vn-waiting]").waitFor({ state: "hidden", timeout: 1000 });
  await desktop.close();

  // Four characters: "auto" turns to flashback cards.
  const four = await browser.newPage({ viewport: desktopSize });
  watch(four);
  await four.goto(url({ cast: "4" }));
  await four.locator("[data-vn-dialogue]").waitFor();
  await four.evaluate(() => (window as any).fx.waiting());
  await four.locator("[data-vn-recap-cards]").waitFor();
  assert.equal(await four.locator("[data-vn-waiting]").getAttribute("data-vn-recap"), "cards", "four characters: automatic shows cards");
  assert.equal(await four.locator("[data-vn-recap-dots] li").count(), 5, "four characters and an inner voice in the cards");
  await four.waitForTimeout(800);
  await four.screenshot({ path: `${OUT}/waiting-auto-four.png` });
  await four.close();

  const phoneSize = { width: 393, height: 851 };
  const phoneContext = await browser.newContext({ ...devices["Pixel 5"], viewport: phoneSize });
  const phone = await phoneContext.newPage();
  watch(phone);
  await phone.goto(url({ card: "title" }));
  await opening(phone, phoneSize, "phone");
  await replyBox(phone, "phone");
  await waitingScreens(phone, phoneSize, "phone", RECAPS);
  await lineupTap(phone, "phone");
  await phoneContext.close();

  // The new layouts: the label stays clear of their dialogue (NVL's page reaches high up).
  for (const [preset, size] of [["cinema", desktopSize], ["nvl", desktopSize], ["daylight", desktopSize], ["nvl", { width: 393, height: 851 }]] as const) {
    const page = await browser.newPage({ viewport: size });
    watch(page);
    await page.goto(url({ card: "title", preset }));
    await page.locator("[data-vn-opening]").waitFor();
    await page.locator("[data-vn-opening]").click();
    await page.locator("[data-vn-opening]").waitFor({ state: "hidden" });
    await page.evaluate(() => { const s = (window as any).fx.stage; for (let i = 0; i < 3; i++) s.advance(); });
    await page.waitForTimeout(400);
    const label = await page.locator("[data-vn-location]").boundingBox();
    assert.ok(label, `${preset}: the label shows`);
    for (const selector of ["[data-vn-dialogue]", "[data-vn-nvl-page]", "[data-vn-speaker]", "[data-vn-controls]"]) {
      const other = page.locator(selector).first();
      if (await other.count() === 0 || !(await other.isVisible())) continue;
      assert.equal(overlaps(label, await other.boundingBox()), false, `${preset}: the label does not cover ${selector}`);
    }
    await page.screenshot({ path: `${OUT}/reading-label-${preset}-${size.width}.png` });
    await page.close();
  }

  // Motion off: everything still, the card and screen still show.
  const still = await browser.newPage({ viewport: desktopSize });
  watch(still);
  await still.goto(url({ card: "title", intensity: "off" }));
  await still.locator("[data-vn-opening]").waitFor();
  assert.equal(await still.locator("[data-vn-opening]").getAttribute("data-vn-opening-motion"), "false");
  await still.locator("[data-vn-opening]").click();
  assert.equal(await still.locator("[data-vn-opening]").isHidden(), true, "motion off: the card goes at once");
  await still.evaluate(() => { (window as any).fx.flow({ waitingRecap: "film" }); (window as any).fx.waiting(); });
  await still.locator("[data-vn-film]").waitFor();
  assert.equal(await still.locator("[data-vn-film-track]").evaluate((el) => getComputedStyle(el).animationName), "none", "motion off: the film stands still");
  await still.close();

  assert.deepEqual(errors, [], "no console errors");
  console.log(`scene flow browser check passed; screenshots in ${OUT}/`);
} finally {
  await browser?.close();
  server.stop(true);
}
