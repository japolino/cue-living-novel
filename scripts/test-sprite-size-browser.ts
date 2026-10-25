import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";

/**
 * Sprite size matching and the outline colour in a real browser
 * (docs/SPRITE_MODE.md, "Size matching"): with the default ("Same face size,
 * keep heights") two pictures framed differently draw their faces at the
 * same height on screen, and a close-up expression keeps the face size of
 * the idle one; "Off" sizes each picture by its figure, so the faces differ
 * again; "Same face size, heads in line" puts every face top on one line
 * without lifting anybody off the floor; a coloured sticker outline bakes in
 * that colour. Desktop and a phone (portrait). Reuses the sprite stage
 * fixture (scripts/sprite-stage-browser-fixture.ts).
 * Screenshots: .cache/sprite-size/
 * Run: bun run ./scripts/test-sprite-size-browser.ts
 */
const OUT = ".cache/sprite-size";
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
    return new Response(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><script type="module" src="/fixture.js"></script></body></html>`, { headers: { "Content-Type": "text/html" } });
  },
});
const url = (query: Record<string, string> = {}) => `http://127.0.0.1:${server.port}/?${new URLSearchParams(query)}`;
await mkdir(OUT, { recursive: true });

/** Detected faces of the fixture cut-outs ([x, y, w, h] of the image), as in the fixture. */
const FACE: Record<string, [number, number, number, number]> = {
  mira_idle: [0.3669, 0.16, 0.2343, 0.1497],
  mira_surprised: [0.3379, 0.1397, 0.2968, 0.2147],
  aoi_idle: [0.3346, 0.1215, 0.2358, 0.15],
  aoi_sad: [0.3516, 0.1097, 0.2926, 0.1943],
};

const errors: string[] = [];
function watch(page: Page): void {
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
}

type Face = { key: string; file: string; height: number; top: number; bottom: number; stageBottom: number };

/** Each actor's face box on screen, from its active image layer and the fixture face table. */
async function faces(page: Page): Promise<Record<string, Face>> {
  const rows = await page.evaluate(() => {
    const theme = (window as any).__theme() as ShadowRoot;
    const stage = theme.querySelector("[data-vn-sprites]")!.getBoundingClientRect();
    return [...theme.querySelectorAll<HTMLElement>("[data-vn-sprite]")].filter((el) => el.dataset.vnSpriteState !== "exiting").map((el) => {
      const layer = el.querySelector<HTMLElement>("[data-vn-sprite-image][data-vn-sprite-layer='active']")!;
      const box = layer.getBoundingClientRect();
      const src = layer.querySelector("img")!.getAttribute("src") ?? "";
      return { key: el.dataset.vnSpriteKey!, file: src.replace(/^.*\//, "").replace(/\.webp$/, ""), top: box.top, height: box.height, bottom: box.bottom, stageBottom: stage.bottom };
    });
  });
  const out: Record<string, Face> = {};
  for (const row of rows) {
    const face = FACE[row.file];
    assert.ok(face, `a face for ${row.file}`);
    out[row.key] = { key: row.key, file: row.file, height: row.height * face[3], top: row.top + row.height * face[1], bottom: row.bottom, stageBottom: row.stageBottom };
  }
  return out;
}

/** Wait until the size and lift transitions settled (two equal reads). */
async function settled(page: Page): Promise<Record<string, Face>> {
  let last = "";
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(150);
    const now = await faces(page);
    const key = JSON.stringify(Object.values(now).map((f) => [Math.round(f.height), Math.round(f.top)]));
    if (key === last) return now;
    last = key;
  }
  return faces(page);
}

const ratio = (a: number, b: number) => Math.max(a, b) / Math.min(a, b);

async function run(page: Page, tag: string): Promise<void> {
  watch(page);
  // The CSS puppet path: plain images, so layer boxes are the drawn pictures.
  await page.goto(url({ puppet: "css", intensity: "off" }));
  await page.waitForFunction(() => Boolean((window as any).fx));
  await page.evaluate(() => { (window as any).__theme = () => document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!; });
  // Mira idle (face 15% of the image) beside Aoi sad (a closer framing, face 19%).
  await page.evaluate(() => (window as any).fx.load([
    { text: "Two framings.", speaker: "", actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "aoi", slot: "right", expression: "sad" }] },
    { text: "Mira gasps.", speaker: "", actors: [{ characterKey: "mira", slot: "left", expression: "surprised" }, { characterKey: "aoi", slot: "right", expression: "sad" }] },
  ]));
  await page.waitForFunction(() => {
    const imgs = [...(window as any).__theme().querySelectorAll("[data-vn-sprite] [data-vn-sprite-layer='active'] img[src]")] as HTMLImageElement[];
    return imgs.length === 2 && imgs.every((img) => img.complete && img.naturalWidth > 0);
  });

  // Default: same face size, feet on the floor.
  let f = await settled(page);
  assert.equal(f.aoi!.file, "aoi_sad");
  assert.ok(ratio(f.mira!.height, f.aoi!.height) < 1.04, `${tag}: matched faces (${f.mira!.height.toFixed(1)} vs ${f.aoi!.height.toFixed(1)} px)`);
  // Both stand on the same floor (the stage bottom; on a phone, just above the dialogue box).
  assert.ok(Math.abs(f.mira!.bottom - f.aoi!.bottom) < 2, `${tag}: both on one floor (${f.mira!.bottom.toFixed(1)} vs ${f.aoi!.bottom.toFixed(1)})`);
  if (tag === "desktop") assert.ok(Math.abs(f.mira!.bottom - f.mira!.stageBottom) < 2, `${tag}: on the stage floor`);
  await page.screenshot({ path: `${OUT}/${tag}-heights.png` });
  const matchedMira = f.mira!.height;

  // A close-up expression keeps the face size.
  await page.evaluate(() => (window as any).fx.go(1));
  await page.waitForFunction(() => (window as any).__theme().querySelector("[data-vn-sprite-key='mira'] [data-vn-sprite-layer='active'] img")?.getAttribute("src")?.includes("surprised"));
  f = await settled(page);
  assert.equal(f.mira!.file, "mira_surprised");
  assert.ok(ratio(f.mira!.height, matchedMira) < 1.04, `${tag}: the close-up keeps the face size (${f.mira!.height.toFixed(1)} vs ${matchedMira.toFixed(1)} px)`);
  await page.screenshot({ path: `${OUT}/${tag}-closeup.png` });

  // Off: the closer framings have bigger faces again.
  await page.evaluate(() => (window as any).fx.sizeMatch({ spriteSizeMatch: "off" }));
  f = await settled(page);
  // (On a phone the slot width limits the wide close-up, so it grows less there.)
  assert.ok(ratio(f.mira!.height, matchedMira) > (tag === "desktop" ? 1.15 : 1.04), `${tag}: off sizes by the figure, so the close-up's face differs (${f.mira!.height.toFixed(1)} vs ${matchedMira.toFixed(1)} px)`);
  await page.screenshot({ path: `${OUT}/${tag}-off.png` });

  // Heads in line: one face-top line; whoever moved went down, never up.
  await page.evaluate(() => (window as any).fx.go(0));
  await page.evaluate(() => (window as any).fx.sizeMatch({ spriteSizeMatch: "heights" }));
  const heights = await settled(page);
  await page.evaluate(() => (window as any).fx.sizeMatch({ spriteSizeMatch: "heads" }));
  f = await settled(page);
  assert.ok(Math.abs(f.mira!.top - f.aoi!.top) < 3, `${tag}: face tops in line (${f.mira!.top.toFixed(1)} vs ${f.aoi!.top.toFixed(1)})`);
  for (const key of ["mira", "aoi"]) assert.ok(f[key]!.top >= heights[key]!.top - 1, `${tag}: ${key} did not rise`);
  assert.ok(ratio(f.mira!.height, f.aoi!.height) < 1.04, `${tag}: still the same face size`);
  await page.screenshot({ path: `${OUT}/${tag}-heads.png` });
  await page.evaluate(() => (window as any).fx.sizeMatch({}));

  // Outline colour: the baked sticker outline is red.
  await page.evaluate(() => (window as any).fx.puppet({ spriteOutline: 4, spriteOutlineColor: "#ff0000" }));
  await page.waitForFunction(() => (window as any).__theme().querySelector("[data-vn-sprite-key='mira'] [data-vn-sprite-layer='active']")?.getAttribute("data-vn-sprite-canvas") === "outline", null, { timeout: 5000 });
  const red = await page.evaluate(() => {
    const canvas = (window as any).__theme().querySelector("[data-vn-sprite-key='mira'] [data-vn-sprite-layer='active'] canvas") as HTMLCanvasElement | null;
    if (!canvas || !canvas.width) return { found: false, why: "no canvas" };
    const ctx = canvas.getContext("2d")!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let redPixels = 0;
    let whitePixels = 0;
    for (let i = 0; i < data.length; i += 4 * 7) {
      if (data[i + 3]! < 200) continue;
      if (data[i]! > 230 && data[i + 1]! < 40 && data[i + 2]! < 40) redPixels += 1;
      if (data[i]! > 245 && data[i + 1]! > 245 && data[i + 2]! > 245) whitePixels += 1;
    }
    return { found: redPixels > 50, redPixels, whitePixels };
  });
  assert.ok(red.found, `${tag}: the outline is drawn in the chosen colour (${JSON.stringify(red)})`);
  await page.screenshot({ path: `${OUT}/${tag}-outline-red.png` });
  await page.evaluate(() => (window as any).fx.puppet({}));
}

let browser: Browser | null = null;
try {
  browser = await chromium.launch();
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await run(desktop, "desktop");
  const phone = await browser.newPage({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await run(phone, "phone");
  assert.deepEqual(errors, [], "no console errors");
  console.log("sprite size browser test: ok");
} finally {
  await browser?.close();
  server.stop(true);
}
