import { chromium, type Page } from "playwright";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";

/**
 * 3D backgrounds on the real stage (docs/SPRITE_MODE.md, "3D backgrounds"),
 * Chromium with software WebGL: the depth canvas over the plate, mouse
 * parallax with the sprites moving with the floor, the dolly, Motion off,
 * the setting, a plate change, the slow drift on a touch phone and reduced
 * motion (flat).
 *
 * With CUE_PLATE_DEPTH_MODEL (Depth Anything V2 Small model_quantized.onnx)
 * the real model runs (onnxruntime-web WASM from node_modules); without it,
 * stored depth maps (a floor-to-wall ramp with a near box) stand in.
 * PLATE_PARALLAX_FRAMES=1 also writes a mouse sweep as frames.
 * Screenshots: .cache/plate-parallax/. Run: bun run test:plate-parallax
 */
const OUT = ".cache/plate-parallax";
const MODEL = process.env.CUE_PLATE_DEPTH_MODEL ?? "";
const REAL = Boolean(MODEL) && existsSync(MODEL);
const FRAMES = process.env.PLATE_PARALLAX_FRAMES === "1";
const PLATES = ["plate_classroom", "plate_park", "plate_street", "plate_bedroom"];

const build = await Bun.build({ entrypoints: ["scripts/sprite-stage-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const TYPES: Record<string, string> = { mjs: "text/javascript", js: "text/javascript", wasm: "application/wasm", webp: "image/webp" };
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const path = decodeURIComponent(new URL(request.url).pathname);
    const send = (file: string) => {
      if (file.includes("..") || !existsSync(file)) return new Response("missing", { status: 404 });
      return new Response(Bun.file(file), { headers: { "Content-Type": TYPES[file.split(".").pop()!] ?? "application/octet-stream" } });
    };
    if (path === "/fixture.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
    if (path.startsWith("/sprites/")) {
      const file = path.slice("/sprites/".length).replace(/[^\w.-]/g, "");
      try { return new Response(await readFile(`scripts/fixtures/sprites/${file}`), { headers: { "Content-Type": "image/webp" } }); }
      catch { return new Response("missing", { status: 404 }); }
    }
    if (path.startsWith("/ort/")) return send(`node_modules/onnxruntime-web/dist/${path.slice(5)}`);
    if (path === "/model.onnx" && REAL) return send(MODEL);
    return new Response('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
  },
});
const origin = `http://127.0.0.1:${server.port}`;
await mkdir(OUT, { recursive: true });

const errors: string[] = [];
const watch = (page: Page): void => {
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
};

/** A stand-in depth map: the floor ramps from near (bottom) to the far wall, with a near box low on the left. */
function seedMap(): { width: number; height: number; depth: number[] } {
  const width = 256;
  const height = 175;
  const depth: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const wall = y < height * 0.55;
      let d = wall ? 230 : Math.round(230 - ((y - height * 0.55) / (height * 0.45)) * 230);
      if (x > width * 0.08 && x < width * 0.3 && y > height * 0.45 && y < height * 0.85) d = 40;
      depth.push(d);
    }
  }
  return { width, height, depth };
}

async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/?depth=1`);
  await page.waitForFunction(() => Boolean((window as unknown as { fx?: unknown }).fx));
  if (REAL) await page.evaluate(() => (window as any).fx.depth.configure(`${location.origin}/ort/`, `${location.origin}/model.onnx`));
  else {
    const map = seedMap();
    for (const plate of PLATES) await page.evaluate(({ url, map }) => (window as any).fx.depth.seed(url, map.width, map.height, map.depth), { url: `/sprites/${plate}.webp`, map });
  }
}

const DUO = (plateKey: string) => [{
  speaker: "Mira", text: "This is Ren, from the class next door.", plateKey,
  actors: [{ characterKey: "mira", slot: "left", focus: true, facing: "right" }, { characterKey: "ren", slot: "right", facing: "left" }],
}];

const state = (page: Page) => page.evaluate(() => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  const canvas = theme.querySelector<HTMLCanvasElement>("[data-vn-plate-depth]");
  const sprites = theme.querySelector<HTMLElement>("[data-vn-sprites]");
  const images = [...theme.querySelectorAll("[data-vn-scene-image]")];
  return {
    exists: Boolean(canvas),
    ready: canvas?.dataset.vnReady === "true",
    opacity: canvas ? Number(getComputedStyle(canvas).opacity) : 0,
    afterImages: canvas ? images.indexOf(canvas) === images.length - 1 : false,
    zIndex: canvas ? getComputedStyle(canvas).zIndex : "",
    spritesTransform: sprites?.style.transform ?? "",
  };
});

const waitReady = (page: Page, ready = true, timeout = REAL ? 180_000 : 15_000) => page.waitForFunction((want) => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  const canvas = theme.querySelector<HTMLCanvasElement>("[data-vn-plate-depth]");
  return (canvas?.dataset.vnReady === "true") === want;
}, ready, { timeout });

const translateX = (transform: string): number => Number(/translate\(([-\d.]+)px/.exec(transform)?.[1] ?? 0);

/** Mean absolute RGB difference of two PNG screenshots, per band of rows (0..1 ranges). */
const diff = (page: Page, a: Buffer, b: Buffer, bands: Array<[number, number]>) => page.evaluate(async ({ a, b, bands }) => {
  const decode = async (bytes: number[]) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  };
  const [x, y] = await Promise.all([decode(a), decode(b)]);
  return bands.map(([from, to]) => {
    let sum = 0, n = 0;
    for (let row = Math.floor(from * x.height); row < Math.floor(to * x.height); row += 1) {
      for (let col = 0; col < x.width; col += 2) {
        const i = (row * x.width + col) * 4;
        sum += Math.abs(x.data[i]! - y.data[i]!) + Math.abs(x.data[i + 1]! - y.data[i + 1]!) + Math.abs(x.data[i + 2]! - y.data[i + 2]!);
        n += 3;
      }
    }
    return sum / Math.max(1, n);
  });
}, { a: [...a], b: [...b], bands });

const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
try {
  // Desktop: mouse parallax.
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page);
  await open(page);
  await page.mouse.move(640, 360);
  await page.evaluate((p) => (window as any).fx.load(p), DUO("plate_classroom"));
  const started = Date.now();
  await waitReady(page);
  console.log(`depth canvas ready after ${Date.now() - started} ms (${REAL ? "real model" : "stored maps"})`);
  let s = await state(page);
  assert.ok(s.afterImages, "the canvas follows the scene images");
  assert.equal(s.zIndex, "1");
  // Let the dolly finish, the mouse in the middle.
  await page.waitForTimeout(9800);
  s = await state(page);
  assert.ok(s.opacity > 0.99, `canvas shown (opacity ${s.opacity})`);
  assert.ok(Math.abs(translateX(s.spritesTransform)) < 1, `sprites centred at rest: ${s.spritesTransform}`);
  assert.match(s.spritesTransform, /scale\(1\.0[1-5]/, "sprites dolly with the floor");
  const centre = await page.screenshot({ path: `${OUT}/classroom-centre.png` });
  await page.mouse.move(1279, 360, { steps: 8 });
  await page.waitForTimeout(2500);
  s = await state(page);
  const right = await page.screenshot({ path: `${OUT}/classroom-right.png` });
  assert.ok(translateX(s.spritesTransform) < -5, `sprites move with the floor: ${s.spritesTransform}`);
  await page.mouse.move(0, 360, { steps: 8 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/classroom-left.png` });
  s = await state(page);
  assert.ok(translateX(s.spritesTransform) > 5, `sprites move the other way: ${s.spritesTransform}`);
  const [top, bottom] = await diff(page, centre, right, [[0.05, 0.3], [0.75, 0.97]]);
  console.log(`centre vs right, mean abs diff: top ${top!.toFixed(1)}, bottom ${bottom!.toFixed(1)}`);
  assert.ok(bottom! > 1, "the near floor moves");

  if (FRAMES) {
    for (const plate of PLATES) {
      await page.evaluate((p) => (window as any).fx.load(p), DUO(plate));
      await waitReady(page, false, 5000).catch(() => {});
      await waitReady(page);
      await page.waitForTimeout(9800);
      for (let i = 0; i < 36; i += 1) {
        const x = 640 + Math.sin((i / 36) * 2 * Math.PI) * 639;
        const y = 360 + Math.sin((i / 36) * 4 * Math.PI) * 200;
        await page.mouse.move(x, y);
        await page.waitForTimeout(110);
        await page.screenshot({ path: `${OUT}/frames-${plate}-${String(i).padStart(2, "0")}.png` });
      }
    }
    await page.evaluate((p) => (window as any).fx.load(p), DUO("plate_classroom"));
    await waitReady(page);
  }

  // Motion off: flat, the sprites back in place; full again: back without a new estimate.
  await page.evaluate(() => (window as any).fx.stage.setEffectIntensity("off"));
  await waitReady(page, false, 2000);
  await page.waitForTimeout(2500);
  assert.equal((await state(page)).spritesTransform, "", "sprites released at Motion off");
  await page.evaluate(() => (window as any).fx.stage.setEffectIntensity("full"));
  await waitReady(page, true, 5000);
  // The setting.
  await page.evaluate(() => (window as any).fx.depth.set(false));
  await waitReady(page, false, 2000);
  await page.evaluate(() => (window as any).fx.depth.set(true));
  await waitReady(page, true, 5000);
  // A plate change: out, then in with the new plate.
  await page.evaluate((p) => (window as any).fx.load(p), DUO("plate_street"));
  await waitReady(page, false, 3000).catch(() => {});
  await waitReady(page);
  await page.waitForTimeout(9800);
  await page.mouse.move(1100, 200, { steps: 6 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/street-right.png` });
  await page.close();

  // Phone: no mouse, a slow drift.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mobile = await phone.newPage();
  watch(mobile);
  await open(mobile);
  await mobile.evaluate((p) => (window as any).fx.load(p), DUO("plate_park"));
  await waitReady(mobile);
  await mobile.waitForTimeout(1500);
  const first = await mobile.screenshot({ path: `${OUT}/phone-park-a.png` });
  await mobile.waitForTimeout(4000);
  const later = await mobile.screenshot({ path: `${OUT}/phone-park-b.png` });
  const [drift] = await diff(mobile, first, later, [[0.05, 0.6]]);
  console.log(`phone drift over 4 s, mean abs diff: ${drift!.toFixed(1)}`);
  assert.ok(drift! > 0.5, "the plate drifts on a touch screen");
  await phone.close();

  // Reduced motion: the plate stays flat.
  const calm = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const still = await calm.newPage();
  watch(still);
  await open(still);
  await still.evaluate((p) => (window as any).fx.load(p), DUO("plate_classroom"));
  await still.waitForTimeout(REAL ? 15_000 : 3000);
  assert.equal((await state(still)).ready, false, "reduced motion keeps the plate flat");
  await calm.close();

  assert.deepEqual(errors, [], "no page errors");
  console.log(`PASS plate parallax browser test; screenshots in ${OUT}/`);
} finally {
  await browser.close();
  server.stop(true);
}
