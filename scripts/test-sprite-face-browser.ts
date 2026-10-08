import { chromium } from "playwright";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

/**
 * Sprite face detector in a real browser (Chromium): the real worker,
 * onnxruntime-web (WASM, from node_modules, offline) and the face model, on
 * a sprite library's ready cut-outs. Read-only: images are only served.
 *
 * Inputs (not in the repo):
 *   CUE_SPRITE_FACE_LIBRARY  sprites/library.json of a Cue user
 *   CUE_SPRITE_FACE_IMAGES   folder with <imageId>.png (Lumiverse data/images)
 *   CUE_SPRITE_FACE_MODEL    face_detect_v1.4_n model.onnx
 *   CUE_SPRITE_FACE_REFERENCE optional JSON {cutImageId: {box, score}} from
 *                            the Python bench (onnxruntime CPU, PIL resize)
 * Checks: every cut-out gets a face (>= 99%), runs in a Worker on WASM, and
 * matches the Python reference (mean IoU >= 0.95). Prints ms per image.
 * Results: .cache/sprite-face/results.json. Run: bun run test:sprite-face
 */
const LIBRARY = process.env.CUE_SPRITE_FACE_LIBRARY ?? "";
const IMAGES = (process.env.CUE_SPRITE_FACE_IMAGES ?? "").replace(/\\/g, "/");
const MODEL = process.env.CUE_SPRITE_FACE_MODEL ?? ".cache/models/anime_face_detection/face_detect_v1.4_n/model.onnx";
const REFERENCE = process.env.CUE_SPRITE_FACE_REFERENCE ?? ".cache/bench/reference_face_n.json";
const LIMIT = Number(process.env.SPRITE_FACE_LIMIT ?? 0);
const OUT = ".cache/sprite-face";

if (!LIBRARY || !existsSync(LIBRARY) || !IMAGES || !existsSync(MODEL)) {
  console.log("SKIP sprite face browser test: set CUE_SPRITE_FACE_LIBRARY, CUE_SPRITE_FACE_IMAGES and CUE_SPRITE_FACE_MODEL.");
  process.exit(0);
}
type Stored = { status: string; cutImageId: string | null };
const library = JSON.parse(readFileSync(LIBRARY, "utf8")) as { sets: Record<string, { name: string; images: Record<string, Stored> }> };
let items: Array<{ id: string; label: string }> = [];
for (const [setKey, set] of Object.entries(library.sets)) {
  for (const [expression, image] of Object.entries(set.images)) {
    if (image.status === "ready" && image.cutImageId && existsSync(`${IMAGES}/${image.cutImageId}.png`)) items.push({ id: image.cutImageId, label: `${set.name}/${setKey}/${expression}` });
  }
}
if (LIMIT > 0) items = items.slice(0, LIMIT);
const reference: Record<string, { box: number[]; score: number }> = existsSync(REFERENCE) ? JSON.parse(readFileSync(REFERENCE, "utf8")) : {};

const build = await Bun.build({ entrypoints: ["scripts/sprite-face-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const TYPES: Record<string, string> = { mjs: "text/javascript", js: "text/javascript", wasm: "application/wasm", png: "image/png" };
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
    if (path.startsWith("/img/")) return send(`${IMAGES}/${path.slice(5).replace(/[^A-Za-z0-9_.-]/g, "")}`);
    return new Response('<html><head><meta charset="utf-8"></head><body><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
  },
});
const origin = `http://127.0.0.1:${server.port}`;
await mkdir(OUT, { recursive: true });

const iou = (a: number[], b: number[]): number => {
  const x1 = Math.max(a[0]!, b[0]!), y1 = Math.max(a[1]!, b[1]!);
  const x2 = Math.min(a[0]! + a[2]!, b[0]! + b[2]!), y2 = Math.min(a[1]! + a[3]!, b[1]! + b[3]!);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a[2]! * a[3]! + b[2]! * b[3]! - inter;
  return union > 0 ? inter / union : 0;
};

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.waitForSelector("body[data-ready]");
  await page.evaluate(() => (window as any).face.configureCutoutRuntime({ ortBaseUrl: `${location.origin}/ort/`, backend: "wasm", numThreads: 1 }));
  const rows: Array<{ id: string; label: string; face: number[] | null; score: number | null; count: number; ms: number; iou: number | null }> = [];
  for (const [index, item] of items.entries()) {
    const result = await page.evaluate(async (id) => {
      const f = (window as any).face;
      const blob = await f.fetchBlob(`/img/${id}.png`);
      return f.detectSpriteFace(blob, { modelUrl: `${location.origin}/model.onnx` });
    }, item.id) as { face: number[] | null; score: number | null; count: number; durationMs: number };
    const ref = reference[item.id];
    rows.push({ id: item.id, label: item.label, face: result.face, score: result.score, count: result.count, ms: result.durationMs, iou: ref && result.face ? iou(ref.box, result.face) : ref ? 0 : null });
    if (index === 0) console.log(`first detection (model load included): ${result.durationMs.toFixed(0)} ms`);
  }
  const mode = await page.evaluate(() => (window as any).face.getCutoutRunnerMode());
  const state = await page.evaluate(() => (window as any).face.getFaceModelState());
  const steady = rows.slice(1).map((row) => row.ms).sort((a, b) => a - b);
  const found = rows.filter((row) => row.face).length;
  const ious = rows.map((row) => row.iou).filter((value): value is number => value !== null);
  const meanIou = ious.reduce((a, b) => a + b, 0) / Math.max(1, ious.length);
  const summary = {
    images: rows.length, found, multi: rows.filter((row) => row.count > 1).length, runner: mode, state,
    msMedian: steady[Math.floor(steady.length / 2)] ?? 0, msMean: steady.reduce((a, b) => a + b, 0) / Math.max(1, steady.length), msMax: steady.at(-1) ?? 0,
    meanIou, minIou: ious.length ? Math.min(...ious) : null,
    misses: rows.filter((row) => !row.face).map((row) => row.label),
    worst: [...rows].filter((row) => row.iou !== null).sort((a, b) => a.iou! - b.iou!).slice(0, 5).map((row) => `${row.label} ${row.iou!.toFixed(3)}`),
  };
  console.log(JSON.stringify(summary, null, 2));
  await writeFile(`${OUT}/results.json`, JSON.stringify({ summary, rows }, null, 2));
  assert.equal(mode, "worker", "detection runs in a Worker");
  assert.equal(state.state, "ready");
  assert.equal(state.backend, "wasm");
  assert.ok(found >= rows.length * 0.99, `faces found: ${found}/${rows.length}`);
  if (ious.length) assert.ok(meanIou >= 0.95, `mean IoU against the Python reference: ${meanIou.toFixed(3)}`);
  console.log("PASS sprite face browser test");
} finally {
  await browser.close();
  server.stop(true);
}
