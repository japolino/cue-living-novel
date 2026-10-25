import { chromium, devices, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";

/**
 * The Cinema, NVL and Daylight stage layouts in a real browser, on a desktop
 * (1280x800) and a phone (393x851), in scene and sprite modes: each theme reads
 * a few paragraphs and the key facts of its look are checked.
 *   Cinema: no box background, centred nameplate between rules in the speaker's
 *     colour, spoken words styled apart from the narration, a ▼ once the line is
 *     typed, text controls at the bottom right beside the progress.
 *   NVL: earlier paragraphs stay on the page (dimmer) under their names, the
 *     page clears when the next paragraph would overflow, Previous shows the
 *     same pages again, Your turn and the reader's own paragraph still work.
 *   Daylight: light stage and box, dark name with a blue underline, blue ▼.
 * Every layout: long paragraphs scroll and page ("Show more") on the phone,
 * the toolbar never covers the text or the name, 44px touch targets, reduced
 * motion and Motion off, no console errors.
 * Uses the sprite stage fixture (scripts/sprite-stage-browser-fixture.ts:
 * ?preset, ?mode=scene|sprites, window.fx).
 * Screenshots: .cache/layouts/
 * Run: bun run test:layouts
 */
const OUT = ".cache/layouts";
const build = await Bun.build({ entrypoints: ["scripts/sprite-stage-browser-fixture.ts"], target: "browser" });
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

type Rect = { x: number; y: number; width: number; height: number };
type Mode = "scene" | "sprites";
type Para = { speaker?: string; text: string };
type Viewport = { name: "desktop" | "phone"; width: number; height: number };
const DESKTOP: Viewport = { name: "desktop", width: 1280, height: 800 };
const PHONE: Viewport = { name: "phone", width: 393, height: 851 };
const LAYOUTS = ["cinema", "nvl", "daylight"] as const;

const errors: string[] = [];
const watch = (page: Page) => {
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
};

const READ: Para[] = [
  { speaker: "Mira", text: "The rain kept falling over the station. 「Wait for me,」 she whispered, then louder: \"Please, just wait.\"" },
  { speaker: "Aoi", text: "\"I'm here,\" he said, shaking the water from his coat. \"<shout>I never left.</shout>\"" },
  { text: "Neither of them moved. Somewhere below, a tram bell rang twice and faded into the evening." },
  { speaker: "Mira", text: "『Then stay,』 she said, and for a moment the lamps seemed to hold their breath. “Just for tonight.”" },
  { speaker: "Aoi", text: "He smiled at last. \"Tonight, then. And tomorrow, if you'll let me.\"" },
];
const medium = (i: number): Para => ({
  ...(i % 3 === 2 ? {} : { speaker: i % 3 === 0 ? "Mira" : "Aoi" }),
  text: `${i + 1}. The lamps along the canal came on one by one while the last tram rattled over the bridge, and she counted the windows still lit on the far bank. "Not yet," she said quietly, "not until the bells."`,
});
const MEDIUM: Para[] = Array.from({ length: 10 }, (_, i) => medium(i));
const longText = (i: number) => `Paragraph ${i}. ` + "The rain had not let up since noon, and the lamps of the village were coming on one by one, small and yellow and very far away. \"You promised,\" she called into the stairwell. ".repeat(5);
const LONG: Para[] = [0, 1, 2].map((i) => ({ speaker: "Mira", text: longText(i) }));

const fixtureParagraphs = (paragraphs: Para[]) => paragraphs.map((p) => ({
  ...p,
  actors: [
    { characterKey: "mira", slot: "left", focus: p.speaker === "Mira" },
    { characterKey: "aoi", slot: "right", facing: "left", focus: p.speaker === "Aoi" },
  ],
  ...(p === paragraphs[0] ? { plateKey: "plate_park", light: "day" } : {}),
}));

const frames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function open(page: Page, preset: string, mode: Mode): Promise<void> {
  await page.goto(url({ preset, mode }));
  await page.waitForFunction(() => Boolean((window as any).fx));
}
async function load(page: Page, paragraphs: Para[], settle = 150): Promise<void> {
  await page.evaluate((ps) => (window as any).fx.load(ps), fixtureParagraphs(paragraphs));
  await page.locator("[data-vn-dialogue-text]").waitFor();
  await page.waitForTimeout(settle);
  await frames(page);
}
async function go(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => (window as any).fx.go(i), index);
  await frames(page);
}
async function toYourTurn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { fx } = window as any;
    fx.go(fx.stage.getState().paragraphs.length - 1);
    fx.stage.advance();
  });
  await page.getByRole("heading", { name: "Your turn" }).waitFor();
  await page.waitForTimeout(350);
}

/** What the layouts are checked by, read from the live stage. */
const facts = (page: Page) => page.evaluate(() => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  const q = (selector: string) => theme.querySelector<HTMLElement>(selector)!;
  const rect = (el: Element | null) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width || r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  };
  const cs = (el: Element, pseudo?: string) => getComputedStyle(el, pseudo);
  const resolve = (value: string) => {
    if (!value) return "";
    const probe = document.createElement("span");
    probe.style.color = value;
    theme.append(probe);
    const color = cs(probe).color;
    probe.remove();
    return color;
  };
  const dialogue = q("[data-vn-dialogue]"), speaker = q("[data-vn-speaker]"), text = q("[data-vn-dialogue-text]");
  const next = q("[data-vn-continue]"), controls = q("[data-vn-controls]"), progress = q("[data-vn-progress]");
  const page = theme.querySelector<HTMLElement>("[data-vn-nvl-page]");
  const sprites = q("[data-vn-sprites]"), scrim = q("[data-vn-scrim]");
  const state = (window as any).fx.stage.getState();
  return {
    phase: state.phase as string,
    index: state.currentParagraphIndex as number,
    dialogue: rect(dialogue), speaker: speaker.hidden ? null : rect(speaker), text: rect(text), next: rect(next), controls: rect(controls), progress: rect(progress),
    controlButtons: [...controls.querySelectorAll("[data-vn-control]")].map((el) => ({ name: (el as HTMLElement).dataset.vnControl!, rect: rect(el) })),
    dialogueBg: cs(dialogue).backgroundColor, dialogueBgImage: cs(dialogue).backgroundImage, dialogueBorder: cs(dialogue).borderTopWidth,
    speakerText: speaker.textContent ?? "", speakerColor: cs(speaker).color, speakerVar: resolve(speaker.style.getPropertyValue("--vn-speaker-color")),
    speakerRule: cs(speaker, "::before").width, speakerUnderline: `${cs(speaker).borderBottomStyle} ${cs(speaker).borderBottomWidth} ${cs(speaker).borderBottomColor}`, speakerWeight: Number(cs(speaker).fontWeight),
    textColor: cs(text).color, textWeight: Number(cs(text).fontWeight), textAlign: cs(text).textAlign, textContent: text.textContent ?? "",
    quotes: [...text.querySelectorAll("[data-vn-quote]")].map((el) => ({ text: el.textContent ?? "", color: cs(el).color, weight: Number(cs(el).fontWeight) })),
    ready: next.dataset.vnReady === "true", nextOpacity: Number(cs(next).opacity), nextGlyph: cs(next, "::before").content, nextColor: cs(next).color, nextLabel: next.getAttribute("aria-label") ?? "",
    nextAnimation: cs(next).animationName,
    controlsBg: cs(controls).backgroundColor, controlsPosition: cs(controls).position,
    labels: [...controls.querySelectorAll("[data-vn-control-label]")].map((el) => cs(el).display),
    icons: [...controls.querySelectorAll("[data-vn-control-icon]")].map((el) => cs(el).display),
    progressText: progress.textContent ?? "",
    paged: dialogue.hasAttribute("data-vn-nvl-paged"),
    pageShown: Boolean(page && !page.hidden && cs(page).display !== "none"),
    entries: page && !page.hidden ? [...page.querySelectorAll("[data-vn-nvl-entry]")].map((el) => {
      const name = el.querySelector("[data-vn-nvl-speaker]");
      return { speaker: name?.textContent ?? "", text: el.querySelector("[data-vn-nvl-text]")?.textContent ?? "", rect: rect(el), opacity: Number(cs(el).opacity), color: name ? cs(name).color : "", colorVar: name ? resolve((name as HTMLElement).style.getPropertyValue("--vn-speaker-color")) : "" };
    }) : [],
    pageRect: page && !page.hidden ? rect(page) : null,
    // The page stacks from its bottom: entries that do not fit spill past its top.
    pageClip: page && !page.hidden && page.firstElementChild ? Math.max(page.scrollHeight - page.clientHeight, page.getBoundingClientRect().top - page.firstElementChild.getBoundingClientRect().top) : 0,
    scroll: { top: text.scrollTop, client: text.clientHeight, height: text.scrollHeight, overflow: text.dataset.vnOverflow ?? "" },
    rootBg: cs(q("[data-vn-root]")).backgroundColor, sceneBg: cs(q("[data-vn-scene]")).backgroundImage,
    scrimBg: cs(scrim).backgroundImage, scrimFilter: cs(scrim).backdropFilter,
    sprites: { shown: !sprites.hidden, opacity: Number(cs(sprites).opacity), filter: cs(sprites).filter },
    sparkles: [...theme.querySelectorAll("[data-vn-ornament-group][data-vn-preset='daylight'] [data-vn-anim]")].map((el) => cs(el).animationName),
  };
});
type Facts = Awaited<ReturnType<typeof facts>>;

/** Mean relative luminance (0 dark .. 1 light) of a region of the screen. */
async function luminance(page: Page, clip: Rect): Promise<number> {
  const png = (await page.screenshot({ clip })).toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((resolve) => { img.onload = resolve; img.src = `data:image/png;base64,${b64}`; });
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    return sum / (data.length / 4) / 255;
  }, png);
}

const overlaps = (a: Rect | null, b: Rect | null) => Boolean(a && b && a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5);
const inside = (r: Rect | null, v: Viewport) => Boolean(r && r.x >= -0.5 && r.y >= -0.5 && r.x + r.width <= v.width + 0.5 && r.y + r.height <= v.height + 0.5);
const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
const lum = (color: string) => { const [r = 0, g = 0, b = 0] = rgb(color); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
const stops = (gradient: string) => gradient.match(/rgba?\([^)]+\)/g) ?? [];

/** Layout facts every new theme keeps on both screens. */
function assertCommon(f: Facts, v: Viewport, label: string): void {
  assert.ok(inside(f.dialogue, v), `${label}: the dialogue fits the screen (${JSON.stringify(f.dialogue)})`);
  assert.ok(inside(f.controls, v), `${label}: the toolbar fits the screen (${JSON.stringify(f.controls)})`);
  assert.ok(!overlaps(f.controls, f.text), `${label}: the toolbar does not cover the text (${JSON.stringify({ controls: f.controls, text: f.text })})`);
  assert.ok(!overlaps(f.controls, f.speaker), `${label}: the toolbar does not cover the name`);
  for (const control of f.controlButtons) assert.ok(inside(control.rect, v), `${label}: ${control.name} fits the screen`);
  if (v.name === "phone") {
    for (const control of f.controlButtons) {
      assert.ok(control.rect && control.rect.width >= 44 && control.rect.height >= 44, `${label}: ${control.name} is a 44px touch target (${JSON.stringify(control.rect)})`);
    }
    if (f.ready) assert.ok(f.next && f.next.width >= 44 && f.next.height >= 44, `${label}: Continue is a 44px touch target (${JSON.stringify(f.next)})`);
  }
}

function assertCinema(f: Facts, label: string): void {
  assert.equal(f.dialogueBg, "rgba(0, 0, 0, 0)", `${label}: no box background`);
  assert.equal(f.dialogueBgImage, "none", `${label}: no box gradient`);
  assert.equal(f.dialogueBorder, "0px", `${label}: no box border`);
  assert.ok(f.dialogue && f.speaker, `${label}: dialogue and name show`);
  const middle = f.dialogue!.x + f.dialogue!.width / 2;
  assert.ok(Math.abs(f.speaker!.x + f.speaker!.width / 2 - middle) <= 2, `${label}: the name is centred (${f.speaker!.x + f.speaker!.width / 2} vs ${middle})`);
  assert.ok(Number.parseFloat(f.speakerRule) >= 20, `${label}: thin rules flank the name (${f.speakerRule})`);
  assert.equal(f.speakerColor, f.speakerVar, `${label}: the name is in the speaker's colour`);
  assert.equal(f.textAlign, "center", `${label}: subtitles are centred`);
  assert.ok(f.quotes.length > 0, `${label}: spoken words are marked`);
  for (const quote of f.quotes) {
    assert.ok(quote.weight >= 700 && quote.weight > f.textWeight, `${label}: ${quote.text} is bold against the narration`);
    assert.notEqual(quote.color, f.textColor, `${label}: ${quote.text} is coloured apart from the narration`);
    assert.ok(lum(quote.color) > 0.95, `${label}: spoken words are white (${quote.color})`);
  }
  assert.ok(lum(f.textColor) < lum(f.quotes[0]!.color), `${label}: the narration is muted grey (${f.textColor})`);
  assert.ok(f.labels.every((d) => d !== "none") && f.icons.every((d) => d === "none"), `${label}: the controls are text buttons`);
  assert.ok(f.controls && f.progress && f.dialogue, `${label}: controls and progress show`);
  assert.ok(f.controls!.x + f.controls!.width >= f.dialogue!.x + f.dialogue!.width - 2, `${label}: the controls sit at the right`);
  assert.ok(f.controls!.y >= f.text!.y + f.text!.height - 1, `${label}: the controls sit below the subtitles`);
  assert.ok(f.progress!.x + f.progress!.width <= f.controls!.x + 1, `${label}: the progress sits beside the controls, on their left`);
  assert.ok(Math.abs((f.progress!.y + f.progress!.height / 2) - (f.controls!.y + f.controls!.height / 2)) <= f.controls!.height / 2, `${label}: the progress is level with the controls`);
  assert.match(f.progressText, /^\d+ \/ \d+$/, `${label}: the progress reads "n / m"`);
}

function assertDaylight(f: Facts, label: string): void {
  const box = stops(f.dialogueBgImage);
  assert.ok(box.length >= 2 && box.every((stop) => lum(stop) > 0.9 && (rgb(stop)[3] ?? 1) < 1), `${label}: a white translucent box (${f.dialogueBgImage})`);
  assert.ok(lum(f.rootBg) > 0.9, `${label}: a light stage behind the scene (${f.rootBg})`);
  assert.ok(stops(f.sceneBg).every((stop) => lum(stop) > 0.85), `${label}: a light scene backdrop (${f.sceneBg})`);
  assert.match(f.scrimFilter, /blur\(1\.5px\).*brightness\(1\.12\)/, `${label}: the scene is brightened and softened`);
  assert.equal(f.speakerUnderline, "solid 3px rgb(47, 125, 225)", `${label}: the name has a blue underline`);
  assert.ok(lum(f.speakerColor) < 0.2 && f.speakerWeight >= 700, `${label}: the name is dark and bold (${f.speakerColor} ${f.speakerWeight})`);
  assert.ok(lum(f.textColor) < 0.25, `${label}: dark ink (${f.textColor})`);
  assert.ok(lum(f.controlsBg) > 0.9, `${label}: light controls (${f.controlsBg})`);
  if (f.ready) {
    assert.match(f.nextGlyph, /▼/, `${label}: a ▼ marks the end of the line`);
    assert.equal(f.nextColor, "rgb(47, 125, 225)", `${label}: the ▼ is blue`);
  }
}

let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const desktop = await browser.newContext({ viewport: { width: DESKTOP.width, height: DESKTOP.height } });
  const phone = await browser.newContext({ ...devices["Pixel 5"], viewport: { width: PHONE.width, height: PHONE.height } });
  const contexts = [[DESKTOP, desktop], [PHONE, phone]] as const;

  // ---- Every layout reads a few paragraphs, both screens, both modes --------------------
  for (const preset of LAYOUTS) {
    for (const [v, context] of contexts) {
      for (const mode of ["scene", "sprites"] as const) {
        const label = `${preset} ${v.name} ${mode}`;
        const page = await context.newPage();
        watch(page);
        await open(page, preset, mode);
        await load(page, READ, mode === "sprites" ? 500 : 150);
        await page.screenshot({ path: `${OUT}/${preset}-${v.name}-${mode}.png` });
        let f = await facts(page);
        assertCommon(f, v, label);
        assert.equal(f.speakerText, "Mira");
        assert.equal(f.sprites.shown, mode === "sprites", `${label}: sprites show only in sprite mode`);
        if (preset === "cinema") assertCinema(f, label);
        if (preset === "daylight") assertDaylight(f, label);
        if (preset === "cinema") {
          assert.ok(f.ready && f.nextOpacity === 1 && /▼/.test(f.nextGlyph), `${label}: a ▼ shows once the line is typed (${f.nextGlyph})`);
          assert.equal(f.nextColor, "rgb(232, 194, 106)", `${label}: the ▼ is gold`);
        }
        if (preset === "nvl") {
          assert.ok(f.paged, `${label}: the dialogue shows as a page`);
          assert.equal(f.entries.length, 0, `${label}: the first paragraph starts the page`);
          assert.equal(f.speakerColor, f.speakerVar, `${label}: the name is in the speaker's colour`);
          assert.ok(f.dialogue!.height >= v.height * 0.7, `${label}: the page fills the screen (${f.dialogue!.height})`);
          assert.ok(f.text!.y < f.dialogue!.y + 80, `${label}: the text starts at the top of the page`);
          // The screen darkens: the scene above the page is darker than under the
          // default theme (scene mode has no picture here, so it is simply dark).
          const strip = { x: 0, y: 0, width: v.width, height: Math.max(8, Math.floor(f.dialogue!.y) - 4) };
          const above = await luminance(page, strip);
          if (mode === "scene") assert.ok(above < 0.2, `${label}: the screen is dark (luminance ${above.toFixed(2)})`);
          else {
            const plain = await context.newPage();
            await open(plain, "lumiverse", mode);
            await load(plain, READ, 500);
            const base = await luminance(plain, strip);
            await plain.close();
            assert.ok(above < base * 0.75, `${label}: the screen darkens (luminance ${above.toFixed(2)} against ${base.toFixed(2)})`);
          }
          if (mode === "sprites") {
            assert.equal(f.sprites.opacity, 0.5, `${label}: the characters fade back`);
            assert.match(f.sprites.filter, /brightness\(0\.66\)/, `${label}: the characters dim`);
          }
        }
        if (preset === "daylight") {
          const top = await luminance(page, { x: 0, y: 0, width: v.width, height: Math.round(v.height * 0.3) });
          const box = await luminance(page, { x: f.dialogue!.x + 8, y: f.dialogue!.y + 8, width: f.dialogue!.width - 16, height: Math.max(8, f.dialogue!.height - 16) });
          assert.ok(top > (mode === "sprites" ? 0.55 : 0.8), `${label}: the stage is light (luminance ${top.toFixed(2)})`);
          assert.ok(box > 0.8, `${label}: the box is light (luminance ${box.toFixed(2)})`);
        }

        // Read on through the turn.
        let mostEntries = 0;
        for (let i = 1; i < READ.length; i++) {
          await go(page, i);
          f = await facts(page);
          assertCommon(f, v, `${label} paragraph ${i + 1}`);
          assert.equal(f.speakerText, READ[i]!.speaker ?? "", `${label}: paragraph ${i + 1} names its speaker`);
          if (preset === "cinema") {
            assert.equal(f.progressText, `${i + 1} / ${READ.length}`);
            if (READ[i]!.speaker) assertCinema(f, `${label} paragraph ${i + 1}`);
          }
          if (preset === "nvl") {
            assert.ok(f.paged, `${label}: still a page at paragraph ${i + 1}`);
            assert.ok(f.entries.length === 0 || f.entries.length === i || f.entries.length <= mostEntries, `${label}: paragraph ${i + 1} stacks under the page or starts a new one (${f.entries.length})`);
            mostEntries = Math.max(mostEntries, f.entries.length);
            if (i <= 2) assert.ok(f.entries.length > 0, `${label}: earlier paragraphs stay on the page at paragraph ${i + 1}`);
            const names = READ.slice(i - f.entries.length, i).map((p) => p.speaker ?? "");
            assert.deepEqual(f.entries.map((e) => e.speaker), names, `${label}: each earlier paragraph shows under its name`);
            for (const entry of f.entries) {
              assert.equal(entry.opacity, 0.56, `${label}: earlier paragraphs are dimmer`);
              if (entry.speaker) assert.equal(entry.color, entry.colorVar, `${label}: ${entry.speaker} is in their colour`);
              assert.ok(entry.rect && f.text && entry.rect.y + entry.rect.height <= f.text.y + 1, `${label}: earlier paragraphs sit above the new one`);
            }
            assert.ok(f.pageClip <= 1, `${label}: the page is not clipped (${f.pageClip})`);
            assert.ok(f.scroll.height <= f.scroll.client + 1, `${label}: the new paragraph has room`);
          }
          if (preset === "daylight" && READ[i]!.speaker) assertDaylight(f, `${label} paragraph ${i + 1}`);
        }
        if (preset === "nvl") {
          assert.ok(mostEntries >= 2, `${label}: several paragraphs are visible with names (${mostEntries})`);
          await page.screenshot({ path: `${OUT}/${preset}-${v.name}-${mode}-page.png` });
        }

        // History keeps the spoken words marked.
        if (preset === "cinema") {
          await page.evaluate(() => (window as any).fx.stage.openBacklog());
          const backlog = await page.evaluate(() => {
            const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
            return [...theme.querySelectorAll("[data-vn-backlog-text] [data-vn-quote]")].map((el) => Number(getComputedStyle(el).fontWeight));
          });
          assert.ok(backlog.length >= 5 && backlog.every((weight) => weight >= 700), `${label}: History shows the spoken words in bold (${backlog})`);
          await page.evaluate(() => (window as any).fx.stage.closeBacklog());
        }

        // Your turn: the reply box is reachable and clear of the toolbar and text.
        await toYourTurn(page);
        f = await facts(page);
        const reply = await page.locator("[data-vn-input-form]").boundingBox();
        assert.ok(inside(reply, v), `${label}: the reply box fits the screen at Your turn`);
        assert.ok(!overlaps(reply, f.controls), `${label}: the reply box clears the toolbar`);
        assert.ok(!overlaps(reply, f.text), `${label}: the reply box clears the text`);
        assert.ok(!overlaps(f.controls, f.text), `${label}: the toolbar clears the text at Your turn`);
        if (preset === "nvl") {
          assert.ok(!f.paged && !f.pageShown, `${label}: at Your turn the page folds into a box`);
          assert.ok(f.dialogue!.height < v.height * 0.45, `${label}: the folded box leaves room for the reply (${f.dialogue!.height})`);
        }
        await page.screenshot({ path: `${OUT}/${preset}-${v.name}-${mode}-your-turn.png` });
        await page.getByRole("button", { name: "Previous paragraph", exact: true }).click();
        await frames(page);
        f = await facts(page);
        assert.equal(f.index, READ.length - 2, `${label}: Previous works at Your turn`);
        if (preset === "nvl") assert.ok(f.paged && f.pageShown, `${label}: back from Your turn the page shows again`);

        // The reader's own paragraph.
        if (preset === "nvl") {
          await toYourTurn(page);
          await page.evaluate(() => (window as any).fx.stage.presentUserParagraph("I take her hand. \"Let's go.\"", "You"));
          await frames(page);
          f = await facts(page);
          assert.equal(f.phase, "revealing", `${label}: the reader's paragraph is read`);
          assert.ok(f.paged, `${label}: the reader's paragraph shows on the page`);
          assert.equal(f.speakerText, "You");
          assert.match(f.textContent, /I take her hand/);
          assert.ok(f.pageClip <= 1 && f.scroll.height <= f.scroll.client + 1, `${label}: the reader's paragraph fits`);
          await page.screenshot({ path: `${OUT}/${preset}-${v.name}-${mode}-user.png` });
        }
        await page.close();
      }
    }
  }

  // ---- NVL: the page clears on overflow; Previous shows the same pages --------------------
  for (const [v, context] of contexts) {
    const label = `nvl ${v.name}`;
    const page = await context.newPage();
    watch(page);
    await open(page, "nvl", "scene");
    await load(page, MEDIUM);
    const forward: string[][] = [];
    for (let i = 0; i < MEDIUM.length; i++) {
      await go(page, i);
      const f = await facts(page);
      assert.ok(f.paged, `${label}: paragraph ${i + 1} shows as a page`);
      assert.ok(f.pageClip <= 1, `${label}: paragraph ${i + 1}: the page is not clipped (${f.pageClip})`);
      assert.ok(f.scroll.height <= f.scroll.client + 1, `${label}: paragraph ${i + 1} has room (${JSON.stringify(f.scroll)})`);
      const entries = f.entries.map((e) => e.text);
      const before = forward[i - 1] ?? [];
      if (entries.length > 0) {
        assert.deepEqual(entries, [...before, MEDIUM[i - 1]!.text.replace(/<[^>]+>/g, "")].slice(-entries.length), `${label}: paragraph ${i + 1} stacks under the ones before`);
        assert.equal(entries.length, before.length + 1, `${label}: paragraph ${i + 1} keeps the page`);
      }
      forward.push(entries);
      if (i > 0 && entries.length === 0) await page.screenshot({ path: `${OUT}/nvl-${v.name}-new-page.png` });
    }
    const counts = forward.map((entries) => entries.length);
    assert.ok(Math.max(...counts) >= 2, `${label}: several paragraphs share a page (${counts})`);
    assert.ok(counts.slice(1).includes(0), `${label}: the page clears when the next paragraph would overflow (${counts})`);
    for (let i = MEDIUM.length - 2; i >= 0; i--) {
      await page.evaluate(() => (window as any).fx.stage.previous());
      await frames(page);
      const f = await facts(page);
      assert.equal(f.index, i);
      assert.deepEqual(f.entries.map((e) => e.text), forward[i], `${label}: Previous to paragraph ${i + 1} shows its page`);
    }
    for (let i = 1; i < MEDIUM.length; i++) {
      await go(page, i);
      assert.deepEqual((await facts(page)).entries.map((e) => e.text), forward[i], `${label}: forward again, paragraph ${i + 1} shows the same page`);
    }
    // Paragraphs type beneath the page: the page shows from the first letter.
    await page.evaluate(() => (window as any).fx.stage.setTextSpeed(40));
    await load(page, MEDIUM, 0);
    // The first advance finishes typing paragraph 1, the second moves on.
    await page.evaluate(() => (window as any).fx.stage.advance());
    await page.evaluate(() => (window as any).fx.stage.advance());
    await frames(page);
    const typing = await facts(page);
    assert.equal(typing.index, 1);
    assert.ok(!typing.ready, `${label}: paragraph 2 is still typing`);
    assert.equal(typing.entries.length, 1, `${label}: the earlier paragraph stays while the new one types`);
    await page.close();
  }

  // ---- Cinema: the ▼ waits for the line; spoken words survive the typewriter --------------
  {
    const page = await desktop.newPage();
    watch(page);
    await open(page, "cinema", "scene");
    await page.evaluate(() => (window as any).fx.stage.setTextSpeed(30));
    await load(page, READ, 0);
    let f = await facts(page);
    assert.ok(!f.ready && f.nextOpacity < 1, "cinema: no ▼ while the line types");
    assert.equal(f.quotes.length, 2, "cinema: the spoken words are marked while typing");
    assert.equal(f.textContent, READ[0]!.text, "cinema: the typed text is the paragraph");
    await page.waitForFunction(() => document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector<HTMLElement>("[data-vn-continue]")!.dataset.vnReady === "true", undefined, { timeout: 15_000 });
    await page.waitForTimeout(300);
    f = await facts(page);
    assert.ok(f.ready && f.nextOpacity === 1 && /▼/.test(f.nextGlyph), "cinema: the ▼ appears when the line is typed");
    assert.equal(f.quotes.length, 2, "cinema: the spoken words stay marked after typing");
    await page.close();
  }

  // ---- Long paragraphs keep scrolling in their capped box on the phone --------------------
  for (const preset of LAYOUTS) {
    const label = `${preset} phone long`;
    const page = await phone.newPage();
    watch(page);
    await open(page, preset, "scene");
    await load(page, LONG);
    let f = await facts(page);
    assertCommon(f, PHONE, label);
    if (preset !== "nvl") assert.ok(f.dialogue!.height <= PHONE.height * 0.42, `${label}: the box stays under 42% of the screen (${f.dialogue!.height})`);
    else assert.ok(f.text!.y + f.text!.height <= f.dialogue!.y + f.dialogue!.height, `${label}: the text stays inside the page`);
    assert.ok(f.scroll.height > f.scroll.client + 1 && f.scroll.overflow === "below", `${label}: the paragraph scrolls inside its box (${JSON.stringify(f.scroll)})`);
    assert.equal(f.nextLabel, "Show more", `${label}: Continue offers the next lines`);
    await page.screenshot({ path: `${OUT}/${preset}-phone-long.png` });
    await page.getByRole("button", { name: "Show more", exact: true }).tap({ force: true });
    await page.waitForTimeout(500);
    f = await facts(page);
    assert.equal(f.index, 0, `${label}: a tap shows the next lines instead of moving on`);
    assert.ok(f.scroll.top > 0, `${label}: Show more scrolls the paragraph`);
    for (let i = 0; i < 10 && /below|both/.test((await facts(page)).scroll.overflow); i++) {
      await page.locator("[data-vn-continue]").tap({ force: true });
      await page.waitForTimeout(450);
    }
    f = await facts(page);
    assert.ok(f.scroll.top + f.scroll.client >= f.scroll.height - 1, `${label}: paging reaches the end`);
    assert.equal(f.nextLabel, "Continue", `${label}: Continue is back at the end`);
    await page.locator("[data-vn-continue]").tap({ force: true });
    await frames(page);
    f = await facts(page);
    assert.equal(f.index, 1, `${label}: at the end a tap moves on`);
    assert.equal(f.scroll.top, 0, `${label}: the next paragraph starts at its first line`);
    if (preset === "nvl") assert.equal(f.entries.length, 0, `${label}: a long paragraph that cannot share the page starts a new one`);
    await toYourTurn(page);
    f = await facts(page);
    const reply = await page.locator("[data-vn-input-form]").boundingBox();
    assert.ok(reply && f.controls && !overlaps(reply, f.controls) && !overlaps(reply, f.text), `${label}: at Your turn the reply box clears the toolbar and the text`);
    assert.ok(f.scroll.top + f.scroll.client >= f.scroll.height - 1, `${label}: at Your turn the paragraph's last lines show`);
    await page.screenshot({ path: `${OUT}/${preset}-phone-long-your-turn.png` });
    await page.close();
  }

  // ---- Reduced motion and Motion off ------------------------------------------------------
  {
    const reduced = await browser.newContext({ viewport: { width: DESKTOP.width, height: DESKTOP.height }, reducedMotion: "reduce" });
    for (const preset of LAYOUTS) {
      const page = await reduced.newPage();
      watch(page);
      await open(page, preset, "scene");
      await load(page, READ);
      const f = await facts(page);
      assert.equal(f.nextAnimation, "none", `${preset}: the ▼ holds still under reduced motion`);
      if (preset === "daylight") assert.ok(f.sparkles.length === 3 && f.sparkles.every((name) => name === "none"), `daylight: sparkles hold still under reduced motion (${f.sparkles})`);
      await page.close();
    }
    await reduced.close();
    const page = await desktop.newPage();
    watch(page);
    await open(page, "daylight", "scene");
    await load(page, READ);
    assert.ok((await facts(page)).sparkles.some((name) => name !== "none"), "daylight: sparkles twinkle with Motion on");
    await page.evaluate(() => (window as any).fx.stage.setEffectIntensity("off"));
    await frames(page);
    assert.ok((await facts(page)).sparkles.every((name) => name === "none"), "daylight: Motion off stills the sparkles");
    await page.close();
  }

  // ---- Switching themes while reading -----------------------------------------------------
  {
    const page = await phone.newPage();
    watch(page);
    await open(page, "nvl", "sprites");
    await load(page, READ, 500);
    await go(page, 3);
    assert.ok((await facts(page)).entries.length > 0);
    await page.evaluate(() => (window as any).fx.stage.setThemePreset("lumiverse"));
    await frames(page);
    let f = await facts(page);
    assert.ok(!f.paged && !f.pageShown && f.entries.length === 0, "leaving NVL folds the page away");
    assert.ok(f.dialogue!.height < PHONE.height * 0.42, `leaving NVL gives back an ordinary box (${f.dialogue!.height})`);
    assertCommon(f, PHONE, "lumiverse after nvl");
    const figure = await page.locator("[data-vn-sprite-key='mira'] [data-vn-sprite-image][data-vn-sprite-layer='active']").boundingBox();
    assert.ok(figure && figure.height > PHONE.height * 0.25, `leaving NVL, the characters stand tall again (${figure?.height})`);
    await page.evaluate(() => (window as any).fx.stage.setThemePreset("cinema"));
    await frames(page);
    f = await facts(page);
    assertCinema(f, "cinema after lumiverse");
    await page.evaluate(() => (window as any).fx.stage.setThemePreset("nvl"));
    await frames(page);
    f = await facts(page);
    assert.ok(f.paged && f.entries.length > 0, "back to NVL, the page shows again");
    await page.close();
  }

  assert.deepEqual(errors, [], "no console errors");
  await desktop.close();
  await phone.close();
  console.log(`Layouts browser test passed. Screenshots in ${OUT}/`);
} finally {
  await browser?.close();
  server.stop(true);
}
