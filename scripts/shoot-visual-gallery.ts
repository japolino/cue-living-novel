// Screenshot gallery for visual review: every preset (reading, choices, composer),
// ambient overlays, one-shot effects, and the settings panel.
// Usage: bun run scripts/shoot-visual-gallery.ts [outDir]   (default .cache/visual/before)

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const outDir = process.argv[2] ?? ".cache/visual/before";
await mkdir(outDir, { recursive: true });
const build = await Bun.build({ entrypoints: ["scripts/visual-gallery-fixture.ts"], target: "browser" });
if (!build.success) { console.error(build.logs); process.exit(1); }
const bundle = await build.outputs[0]!.text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => new URL(r.url).pathname === "/f.js"
  ? new Response(bundle, { headers: { "Content-Type": "application/javascript" } })
  : new Response('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#08090d"><script type="module" src="/f.js"></script></body></html>', { headers: { "Content-Type": "text/html" } }) });
const base = `http://127.0.0.1:${server.port}/`;
const browser = await chromium.launch({ headless: true });
const presets = ["lumiverse","golden-hour","boxed-console","paper-novel","midnight-noir","yamaku-classic","literature-club"];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  for (const p of presets) {
    await page.goto(`${base}?preset=${p}`);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${outDir}/stage-${p}-read.png` });
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Space"); await page.waitForTimeout(150); }
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/stage-${p}-choices.png` });
    await page.goto(`${base}?preset=${p}&mode=standard`);
    await page.waitForTimeout(500);
    for (let i = 0; i < 3; i++) { await page.keyboard.press("Space"); await page.waitForTimeout(150); }
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/stage-${p}-compose.png` });
  }
  for (const a of ["rain","snow","sakura","fireflies","embers","fog","dream_haze","danger_pulse"]) {
    await page.goto(`${base}?preset=lumiverse`);
    await page.waitForTimeout(500);
    await page.evaluate((x) => (window as any).gallery.stage.applyAmbient(x), a);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}/ambient-${a}.png` });
  }
  for (const e of ["sparkle_burst","hearts_burst","confetti","speed_lines","lightning","flash_red"]) {
    await page.goto(`${base}?preset=lumiverse`);
    await page.waitForTimeout(500);
    await page.evaluate((x) => (window as any).gallery.stage.triggerEffect(x), e);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${outDir}/effect-${e}.png` });
  }
  const sp = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await sp.goto(`${base}?view=settings`);
  await sp.waitForTimeout(500);
  await sp.screenshot({ path: `${outDir}/settings-full.png`, fullPage: true });
  await sp.goto(`${base}?view=settings&setup=1`);
  await sp.waitForTimeout(500);
  await sp.screenshot({ path: `${outDir}/settings-setup.png`, fullPage: true });
} finally { await browser.close(); server.stop(true); }
console.log("done", outDir);
