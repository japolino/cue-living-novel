import { chromium, devices, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

/**
 * Reading UX browser regression: real CSS, real focus, real touch targets.
 * Run: bun run ./scripts/test-reading-browser.ts
 */
const build = await Bun.build({ entrypoints: ["scripts/reading-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => new URL(request.url).pathname === "/fixture.js" ? new Response(bundle, { headers: { "Content-Type": "application/javascript" } }) : new Response('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } }) });
const url = (query: string) => `http://127.0.0.1:${server.port}/?${query}`;
await mkdir(".cache/ux-redesign", { recursive: true });

// Active element, piercing open shadow roots.
const deepActiveDescription = `(() => { let el = document.activeElement; while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement; if (!el) return ""; const attr = Array.from(el.attributes).find((a) => a.name.startsWith("data-vn")); return el.tagName.toLowerCase() + (attr ? "[" + attr.name + (attr.value ? "=" + attr.value : "") + "]" : ""); })()`;

let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });

  // ---- Phone: touch targets, toolbar vs nameplate, Your turn reachability ----
  const phone = await browser.newContext({ ...devices["Pixel 5"], viewport: { width: 360, height: 640 } });
  const mobile = await phone.newPage();
  await mobile.goto(url("mode=cyoa"));
  await mobile.locator("[data-vn-dialogue]").waitFor();
  assert.equal(await mobile.evaluate(() => matchMedia("(pointer: coarse)").matches), true, "phone context emulates a coarse pointer");
  for (const name of ["previous", "log", "auto", "skip"]) {
    const box = await mobile.locator(`[data-vn-control="${name}"]`).boundingBox();
    assert.ok(box && box.height >= 44 && box.width >= 44, `${name} control is a 44px touch target (got ${box?.width}x${box?.height})`);
  }
  const continueBox = await mobile.getByRole("button", { name: "Continue", exact: true }).boundingBox();
  assert.ok(continueBox && continueBox.height >= 44 && continueBox.width >= 44, "Continue is a 44px touch target");
  const exitBox = await mobile.getByRole("button", { name: "Back to chat", exact: true }).boundingBox();
  assert.ok(exitBox && exitBox.height >= 44, "Back to chat is a 44px touch target");
  const controls = await mobile.locator("[data-vn-controls]").boundingBox();
  const speaker = await mobile.locator("[data-vn-speaker]").boundingBox();
  assert.ok(controls && speaker && controls.y + controls.height <= speaker.y + 0.5, "phone toolbar sits above the nameplate");
  assert.ok(controls && controls.x >= 0 && controls.x + controls.width <= 360, "phone toolbar fits the viewport width");
  await mobile.screenshot({ path: ".cache/ux-redesign/reading-mobile.png" });
  await mobile.evaluate(() => { const s = (window as any).readingFixture.stage; for (let i = 0; i < 4 && s.getState().phase !== "awaiting-input"; i++) s.advance(); });
  await mobile.getByRole("heading", { name: "Your turn" }).waitFor();
  const choices = await mobile.locator("[data-vn-choice-list]").boundingBox();
  const controlsAtTurn = await mobile.locator("[data-vn-controls]").boundingBox();
  assert.ok(choices && controlsAtTurn && choices.y + choices.height <= controlsAtTurn.y + 0.5, "phone choices stay above the toolbar so Previous remains reachable");
  await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: ".cache/ux-redesign/reading-mobile-your-turn.png" });
  await mobile.getByRole("button", { name: "Previous paragraph", exact: true }).tap();
  assert.equal(await mobile.evaluate(() => (window as any).readingFixture.stage.getState().currentParagraphIndex), 1, "Previous is tappable at Your turn");
  await phone.close();

  // ---- Desktop: keyboard, focus, history, status, errors, themes ----
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url("mode=standard&css=" + encodeURIComponent("[data-vn-root][data-vn-preset] [data-vn-dialogue] { border-top-left-radius: 3px; }")));
  await page.locator("[data-vn-dialogue]").waitFor();
  const active = () => page.evaluate(deepActiveDescription);
  const focusOutline = () => page.evaluate(`(() => { let el = document.activeElement; while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement; const s = el ? getComputedStyle(el) : null; return s ? s.outlineStyle + " " + s.outlineWidth : ""; })()`);

  // Labels
  assert.equal(await page.getByRole("button", { name: "Back to chat", exact: true }).textContent(), "Back to chat");
  assert.equal((await page.getByRole("button", { name: "Open history", exact: true }).textContent())?.trim(), "History");
  assert.equal(await page.getByRole("button", { name: "Auto play", exact: true }).getAttribute("aria-pressed"), "false");
  assert.match(await page.getByRole("button", { name: "Skip", exact: true }).evaluate((el) => (el as HTMLElement).getAttribute("aria-describedby") ?? ""), /vn-skip-description/);

  // Keyboard path with visible focus rings
  await page.evaluate(() => (window as any).readingFixture.stage.focus());
  await page.keyboard.press("Tab");
  assert.equal(await active(), 'button[data-vn-control=log]', "Tab skips the disabled Previous and lands on History");
  assert.match(await focusOutline(), /solid/, "History shows a visible focus ring");
  await page.keyboard.press("Tab");
  assert.equal(await active(), 'button[data-vn-control=auto]');
  await page.keyboard.press("Tab");
  assert.equal(await active(), 'button[data-vn-control=skip]');
  await page.keyboard.press("Tab");
  assert.equal(await active(), 'button[data-vn-continue]');
  assert.match(await focusOutline(), /solid/, "Continue shows a visible focus ring");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => (window as any).readingFixture.stage.getState().currentParagraphIndex), 1);

  // Auto/Pause visible state + footer
  const auto = page.getByRole("button", { name: "Auto play", exact: true });
  await auto.click();
  assert.equal(await auto.getAttribute("aria-pressed"), "true");
  assert.equal((await auto.textContent())?.trim(), "Pause");
  assert.equal(await page.locator("[data-vn-reading-state]").textContent(), "Auto play on");
  await auto.click();
  assert.equal((await auto.textContent())?.trim(), "Auto");
  assert.equal(await page.locator("[data-vn-reading-state]").isVisible(), false);

  // History focus management
  const history = page.getByRole("button", { name: "Open history", exact: true });
  await history.click();
  assert.equal(await page.getByRole("dialog", { name: "History" }).isVisible(), true);
  assert.equal(await active(), "button[data-vn-backlog-close]", "History opens with focus on Close");
  assert.equal(await page.locator("[data-vn-backlog-item]").count(), 2);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "History" }).isVisible(), false);
  assert.equal(await active(), "button[data-vn-control=log]", "closing History returns focus to the History button");

  // Your turn (standard): heading, hint, draft survives Previous, toolbar stays put
  await page.evaluate(() => (window as any).readingFixture.stage.focus());
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Your turn" }).waitFor();
  assert.match((await page.locator("[data-vn-interaction-hint]").textContent()) ?? "", /Write your reply/);
  assert.equal(await active(), "textarea[data-vn-input]", "the reply field receives focus at Your turn");
  await page.locator("[data-vn-input]").fill("Keep my draft");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.evaluate(() => (window as any).readingFixture.stage.getState().currentParagraphIndex), 2, "Left Arrow inside the reply field only moves the caret");
  const previous = page.getByRole("button", { name: "Previous paragraph", exact: true });
  assert.equal(await previous.evaluate((el) => el.closest("[data-vn-controls]") !== null), true, "Previous stays in the toolbar at Your turn");
  await previous.click();
  assert.equal(await page.evaluate(() => (window as any).readingFixture.stage.getState().draft), "Keep my draft");
  await page.evaluate(() => (window as any).readingFixture.stage.focus());
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Your turn" }).waitFor();
  assert.equal(await page.locator("[data-vn-input]").inputValue(), "Keep my draft");
  await page.waitForTimeout(400); // let the enter animations settle before the screenshot
  await page.screenshot({ path: ".cache/ux-redesign/reading-desktop-your-turn.png" });

  // Waiting + error surface
  await page.evaluate(() => { const s = (window as any).readingFixture.stage; s.setPhase("waiting-for-response"); s.setAssetProgress({ current: 2, total: 3 }); });
  assert.equal(await page.getByText("Waiting for the reply…", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Creating image 2 of 3", { exact: true }).isVisible(), true);
  assert.equal(await page.locator("[data-vn-dialogue-text]").isVisible(), true, "the last paragraph stays readable while the reply prepares");
  await page.evaluate(() => (window as any).readingFixture.stage.setError({ source: "image", message: "This scene image could not be made.", detail: "HTTP 502 upstream timeout", retryable: true, retryScope: "Try again keeps 2 finished images and remakes 1." }));
  const card = page.getByRole("alert");
  assert.equal(await card.getByText("Scene image could not be made", { exact: true }).isVisible(), true);
  assert.equal(await card.locator("pre").isVisible(), false, "technical details start collapsed");
  await card.getByText("Technical details", { exact: true }).click();
  assert.equal(await card.locator("pre").isVisible(), true);
  assert.equal(await card.locator("pre").textContent(), "HTTP 502 upstream timeout");
  await page.waitForTimeout(300);
  await page.screenshot({ path: ".cache/ux-redesign/reading-desktop-error.png" });
  assert.equal(await page.evaluate(() => (window as any).readingFixture.counters.rerolls), 0, "no automatic retry");
  await card.getByRole("button", { name: "Try again", exact: true }).click();
  assert.equal(await page.evaluate(() => (window as any).readingFixture.counters.rerolls), 1);

  // Custom CSS stays the final layer across preset changes; text scale applies
  assert.equal(await page.locator("[data-vn-dialogue]").evaluate((el) => getComputedStyle(el).borderTopLeftRadius), "3px");
  await page.evaluate(() => (window as any).readingFixture.stage.setThemePreset("golden-hour"));
  assert.equal(await page.locator("[data-vn-dialogue]").evaluate((el) => getComputedStyle(el).borderTopLeftRadius), "3px", "custom CSS still wins after a preset switch");
  const baseSize = await page.locator("[data-vn-dialogue-text]").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  await page.evaluate(() => (window as any).readingFixture.stage.setTextScale(1.4));
  const scaled = await page.locator("[data-vn-dialogue-text]").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(Math.abs(scaled / baseSize - 1.4) < 0.02, `text scale multiplies the dialogue size (${baseSize} -> ${scaled})`);

  // Reduced motion still disables camera shake
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => (window as any).readingFixture.stage.triggerEffect("shake"));
  assert.equal(await page.locator("[data-vn-root]").evaluate((el) => getComputedStyle(el).animationName), "none", "reduced motion suppresses shake");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // Phone toolbar for presets that position the toolbar themselves
  for (const preset of ["golden-hour", "midnight-noir", "yamaku-classic", "literature-club"]) {
    const ctx = await browser.newContext({ ...devices["Pixel 5"], viewport: { width: 360, height: 640 } });
    const p = await ctx.newPage();
    await p.goto(url(`mode=standard&preset=${preset}`));
    await p.locator("[data-vn-dialogue]").waitFor();
    // Measure only after the preset layer is attached and the touch-size token resolved.
    await p.waitForFunction((id) => {
      const host = document.querySelector("[data-vn-stage-host]")?.shadowRoot?.querySelector("[data-vn-theme-host]")?.shadowRoot;
      const root = host?.querySelector("[data-vn-root]") as HTMLElement | null;
      const control = host?.querySelector('[data-vn-control="log"]') as HTMLElement | null;
      return Boolean(root && control && root.dataset.vnPreset === id && parseFloat(getComputedStyle(control).minHeight) >= 44);
    }, preset);
    const pointer = await p.evaluate(() => matchMedia("(pointer: coarse)").matches);
    const c = await p.locator("[data-vn-controls]").boundingBox();
    const sp = await p.locator("[data-vn-speaker]").boundingBox();
    const text = await p.locator("[data-vn-dialogue-text]").boundingBox();
    assert.ok(c && sp && text, `${preset}: toolbar, nameplate and text are laid out`);
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    assert.ok(!overlaps(c!, sp!), `${preset}: phone toolbar does not overlap the nameplate`);
    assert.ok(!overlaps(c!, text!), `${preset}: phone toolbar does not overlap the dialogue text`);
    for (const name of ["log", "auto", "skip"]) {
      const box = await p.locator(`[data-vn-control="${name}"]`).boundingBox();
      assert.ok(box && box.height >= 44, `${preset}: ${name} is 44px tall on phones (got ${box?.height}, coarse pointer: ${pointer})`);
    }
    await p.screenshot({ path: `.cache/ux-redesign/reading-mobile-${preset}.png` });
    await ctx.close();
  }

  console.log("Reading browser checks passed: touch targets, toolbar bounds, keyboard focus, History focus return, Your turn hand-off, draft preservation, status labels, error card details/retry, custom CSS order, text scale, reduced motion, preset toolbars.");
} finally { await browser?.close(); server.stop(); }
