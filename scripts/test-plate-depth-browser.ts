import { chromium } from "playwright";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

/**
 * Plate depth in a real browser (Chromium): the real worker, onnxruntime-web
 * (WASM, from node_modules, offline) and the depth model on the four repo
 * fixture plates.
 *
 * Input (not in the repo): CUE_PLATE_DEPTH_MODEL, Depth Anything V2 Small
 * model_quantized.onnx (DEFAULT_PLATE_DEPTH_MODEL_URL).
 * Checks: hand-marked near/far pairs per plate (>= 90% right in all), the
 * depth map size, that a stored map comes back without the model, and that
 * it runs in a Worker. Prints ms per plate. Run: bun run test:plate-depth
 */
const MODEL = process.env.CUE_PLATE_DEPTH_MODEL ?? ".cache/models/depth-anything-v2-small/model_quantized.onnx";
if (!existsSync(MODEL)) {
  console.log("SKIP plate depth browser test: set CUE_PLATE_DEPTH_MODEL to Depth Anything V2 Small model_quantized.onnx.");
  process.exit(0);
}

type Pair = [a: [number, number], b: [number, number], nearer: "a" | "b"];
/** Pairs any viewer agrees on, in px of a 1216 x 832 copy of the plate. */
const PAIRS: Record<string, Pair[]> = {
  bedroom: [
    [[800, 300], [780, 700], "b"], [[550, 250], [500, 800], "b"], [[230, 430], [400, 640], "b"], [[1060, 450], [950, 300], "a"],
    [[1160, 330], [840, 530], "a"], [[1000, 730], [840, 520], "a"], [[230, 230], [30, 600], "b"], [[200, 530], [130, 300], "a"],
  ],
  classroom: [
    [[750, 330], [620, 680], "b"], [[1100, 650], [1100, 330], "a"], [[500, 320], [240, 620], "b"], [[300, 790], [760, 450], "a"],
    [[700, 500], [650, 620], "b"], [[610, 200], [390, 55], "b"], [[1100, 590], [880, 640], "a"], [[760, 455], [760, 350], "a"],
  ],
  park: [
    [[590, 510], [600, 790], "b"], [[310, 560], [650, 470], "a"], [[735, 535], [1130, 640], "b"], [[735, 535], [880, 560], "b"],
    [[380, 150], [600, 520], "a"], [[955, 500], [700, 470], "a"], [[735, 535], [330, 450], "b"], [[880, 570], [400, 720], "b"],
  ],
  street: [
    [[420, 620], [600, 790], "b"], [[760, 550], [360, 300], "a"], [[360, 280], [40, 400], "b"], [[360, 280], [490, 130], "b"],
    [[1100, 150], [410, 380], "a"], [[750, 500], [300, 760], "b"], [[180, 400], [400, 600], "a"], [[420, 640], [1000, 550], "b"],
  ],
};

const build = await Bun.build({ entrypoints: ["scripts/plate-depth-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const TYPES: Record<string, string> = { mjs: "text/javascript", js: "text/javascript", wasm: "application/wasm", webp: "image/webp" };
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    const send = (file: string) => {
      if (file.includes("..") || !existsSync(file)) return new Response("missing", { status: 404 });
      return new Response(Bun.file(file), { headers: { "Content-Type": TYPES[file.split(".").pop()!] ?? "application/octet-stream" } });
    };
    if (path === "/fixture.js") return new Response(bundle, { headers: { "Content-Type": "text/javascript" } });
    if (path.startsWith("/ort/")) return send(`node_modules/onnxruntime-web/dist/${path.slice(5)}`);
    if (path === "/model.onnx") return send(MODEL);
    if (path.startsWith("/plate/")) return send(`scripts/fixtures/sprites/plate_${path.slice(7).replace(/[^a-z]/g, "")}.webp`);
    return new Response('<html><head><meta charset="utf-8"></head><body><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
  },
});
const origin = `http://127.0.0.1:${server.port}`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.waitForSelector("body[data-ready]");
  await page.evaluate(() => {
    const d = (window as any).depth;
    d.configureCutoutRuntime({ ortBaseUrl: `${location.origin}/ort/`, numThreads: 1 });
    d.configurePlateDepth({ modelUrl: `${location.origin}/model.onnx` });
  });
  let right = 0;
  let total = 0;
  const kept: Record<string, number[]> = {};
  for (const [name, pairs] of Object.entries(PAIRS)) {
    const map = await page.evaluate((url) => (window as any).depth.measure(url), `/plate/${name}`) as { width: number; height: number; depth: number[]; ms: number };
    assert.ok(map.width > 0 && map.width <= 512, `${name}: depth width ${map.width}`);
    assert.equal(map.depth.length, map.width * map.height);
    const at = ([x, y]: [number, number]): number => map.depth[Math.min(map.height - 1, Math.floor((y / 832) * map.height)) * map.width + Math.min(map.width - 1, Math.floor((x / 1216) * map.width))]!;
    const ok = pairs.filter(([a, b, nearer]) => (nearer === "a" ? at(a) < at(b) : at(b) < at(a))).length;
    right += ok;
    total += pairs.length;
    kept[name] = map.depth;
    console.log(`${name}: ${map.width}x${map.height}, ${ok}/${pairs.length} pairs, ${map.ms.toFixed(0)} ms`);
  }
  assert.ok(right >= total * 0.9, `near/far pairs right: ${right}/${total}`);
  assert.ok(page.workers().length > 0, "depth runs in a Worker");

  // A stored map comes back without the model (fresh page state, same browser store).
  await page.evaluate(() => {
    const d = (window as any).depth;
    d.resetPlateDepth();
    d.configurePlateDepth({ modelUrl: `${location.origin}/missing.onnx` });
  });
  const again = await page.evaluate((url) => (window as any).depth.measure(url), "/plate/park") as { depth: number[]; ms: number };
  assert.deepEqual(again.depth, kept.park, "stored depth map");
  console.log(`stored map read back in ${again.ms.toFixed(0)} ms`);
  console.log(`PASS plate depth browser test (${right}/${total} pairs)`);
} finally {
  await browser.close();
  server.stop(true);
}
