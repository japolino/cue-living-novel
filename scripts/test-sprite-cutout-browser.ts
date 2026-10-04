import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

/**
 * Sprite cut-out in a real browser (Chromium): the real worker, kernel,
 * onnxruntime-web and model cache, on the owner's bake-off sprites.
 *
 * Inputs (not in the repo): CUE_SPRITE_BAKEOFF (default
 * C:/Users/eme4/cue-sprite-bakeoff) with fixtures/raw/*.png (generated
 * sprites on white), fixtures/sprites/*.png (Python reference cut-outs:
 * `hybrid2` with isnetis_int8.onnx) and models/isnetis.onnx +
 * models/isnetis_int8.onnx. onnxruntime-web is served from node_modules (the
 * pinned devDependency) instead of the CDN, so the test runs offline.
 *
 * Checks:
 *   - nothing heavy loads before a cut; the cut runs in a Worker;
 *   - "basic" (no model) on every sprite, IoU reported, sanity floor;
 *   - fallback: "best" with an unreachable model gives "basic" + state "error";
 *   - for each model (int8, fp32) x backend (wasm, webgpu when headless
 *     Chromium gets an adapter): load time, per-image time, IoU (alpha >= 128)
 *     against the reference. Requirements: int8 (same model as the
 *     reference) mean IoU >= 0.99 and min >= 0.98; fp32 mean IoU >= 0.97 and
 *     min >= 0.93;
 *   - "standard" image size (624x912, CUE_SPRITE_STANDARD, default the
 *     owner's reply-test raw_lr folder; skipped when missing): each sprite is
 *     cut as it is and again upscaled to 832x1216 (the size the kernel
 *     parameters were tuned on); the alphas must agree (IoU mean >= 0.99,
 *     min >= 0.98) and the bbox must not move, for "basic" on every sprite and
 *     with the model on 3 (all on WebGPU or with SPRITE_CUTOUT_FULL=1);
 *   - duplicate check ("two figures", CUE_SPRITE_HYP, default the owner's
 *     reply-test/hyp folder; skipped when missing): the kernel's figureCheck on
 *     the experiment's Python cut-outs must give the Python rule's flags
 *     (hyp/q4_labels_rule.csv, >= 99% agreement); real cuts of
 *     reply-test/raw_lr2/Mio_idle.png and Mio_laughing.png (two figures) are
 *     flagged and at most 1 of reply-test/raw_lr/*.png is; with
 *     SPRITE_CUTOUT_FULL=1 or SPRITE_CUTOUT_DUP_FULL=1 every experiment raw
 *     image is also cut ("basic") and compared with the labels;
 *   - model cache: a second load reads the cache (no download), clear removes it;
 *   - cut service: ordered base64 chunks with meta, duplicate requestIds ignored.
 *
 * WASM is slow (~15-20 s per sprite single-threaded), so by default WASM runs
 * on 3 sprites per model and WebGPU on all; SPRITE_CUTOUT_FULL=1 runs all
 * sprites everywhere. SPRITE_CUTOUT_NO_GPU=1 skips WebGPU (keeps the GPU free
 * for other work). Composites on a dark background: .cache/sprite-cutout/.
 * Run: bun run test:sprite-cutout
 */
const BAKEOFF = (process.env.CUE_SPRITE_BAKEOFF ?? "C:/Users/eme4/cue-sprite-bakeoff").replace(/\\/g, "/");
const RAW = `${BAKEOFF}/fixtures/raw`;
const REF = `${BAKEOFF}/fixtures/sprites`;
const MODELS = `${BAKEOFF}/models`;
const FULL = process.env.SPRITE_CUTOUT_FULL === "1";
const NO_GPU = process.env.SPRITE_CUTOUT_NO_GPU === "1";
const STANDARD = (process.env.CUE_SPRITE_STANDARD ?? "C:/Users/eme4/cue-living-novel/.cache/reply-test/raw_lr").replace(/\\/g, "/");
const standardNames = existsSync(STANDARD)
  ? readdirSync(STANDARD).filter((file) => file.endsWith(".png") && file !== "plate.png").map((file) => file.slice(0, -4)).sort()
  : [];
const OUT = ".cache/sprite-cutout";
const HYP = (process.env.CUE_SPRITE_HYP ?? "C:/Users/eme4/cue-living-novel/.cache/reply-test/hyp").replace(/\\/g, "/");
const LR2 = (process.env.CUE_SPRITE_LR2 ?? `${HYP.replace(/\/[^/]+\/?$/, "")}/raw_lr2`).replace(/\\/g, "/");
const DUP_FULL = FULL || process.env.SPRITE_CUTOUT_DUP_FULL === "1";
type HypLabel = { src: string; label: string; dup: boolean; rf: number; flag: boolean };
const hypLabels: HypLabel[] = existsSync(`${HYP}/q4_labels_rule.csv`)
  ? readFileSync(`${HYP}/q4_labels_rule.csv`, "utf8").trim().split(/\r?\n/).slice(1).map((line) => {
    // src,label,n,dup,rf,flag,set,type,rf_full,flag_full (set is quoted and holds commas)
    const cells = line.match(/("[^"]*"|[^,]+)/g) ?? [];
    return { src: cells[0]!, label: cells[1]!, dup: cells[3] === "1", rf: Number(cells[8]), flag: cells[9] === "1" };
  })
  : [];

if (!existsSync(RAW)) {
  console.log(`SKIP sprite cut-out browser test: no bake-off sprites at ${RAW} (set CUE_SPRITE_BAKEOFF).`);
  process.exit(0);
}
const names = readdirSync(RAW).filter((file) => file.endsWith(".png")).map((file) => file.slice(0, -4)).sort();
const withRef = names.filter((name) => existsSync(`${REF}/${name}.png`));
const models = ["isnetis_int8.onnx", "isnetis.onnx"].filter((file) => existsSync(`${MODELS}/${file}`));
if (models.length < 2) console.log(`SKIP model part for missing files in ${MODELS}: ${["isnetis_int8.onnx", "isnetis.onnx"].filter((f) => !models.includes(f)).join(", ")}`);
const SAMPLE = ["02_silver_white_dress", "06_windy_hair", "p02_silver_white_dress"].filter((name) => withRef.includes(name));

const build = await Bun.build({ entrypoints: ["scripts/sprite-cutout-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const TYPES: Record<string, string> = { mjs: "text/javascript", js: "text/javascript", wasm: "application/wasm", png: "image/png" };
const requests: string[] = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname);
    requests.push(path);
    const send = (file: string) => {
      if (file.includes("..") || !existsSync(file)) return new Response("missing", { status: 404 });
      return new Response(Bun.file(file), { headers: { "Content-Type": TYPES[file.split(".").pop()!] ?? "application/octet-stream" } });
    };
    if (path === "/fixture.js") return new Response(bundle, { headers: { "Content-Type": "text/javascript" } });
    if (path.startsWith("/ort/")) return send(`node_modules/onnxruntime-web/dist/${path.slice(5)}`);
    if (path.startsWith("/models/")) return send(`${MODELS}/${path.slice(8)}`);
    if (path.startsWith("/raw/")) return send(`${RAW}/${path.slice(5)}`);
    if (path.startsWith("/ref/")) return send(`${REF}/${path.slice(5)}`);
    if (path.startsWith("/std/")) return send(`${STANDARD}/${path.slice(5)}`);
    if (path.startsWith("/hyp/")) return send(`${HYP}/${path.slice(5)}`);
    if (path.startsWith("/lr2/")) return send(`${LR2}/${path.slice(5)}`);
    return new Response('<html><head><meta charset="utf-8"></head><body><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
  },
});
const origin = `http://127.0.0.1:${server.port}`;
await mkdir(OUT, { recursive: true });

type Row = { name: string; quality: string; ms: number; modelMs: number; cutMs: number; iou: number | null; mad: number | null; bbox: number[]; jpeg?: string };

async function cutAll(page: Page, list: string[], quality: "best" | "basic", modelUrl: string, keepJpeg: boolean): Promise<Row[]> {
  const rows: Row[] = [];
  for (const name of list) {
    rows.push(await page.evaluate(async ({ name, quality, modelUrl, keepJpeg, hasRef }) => {
      const c = (window as any).cutout;
      const blob = await c.fetchBlob(`/raw/${name}.png`);
      const r = await c.cutSprite(blob, { quality, modelUrl });
      const cmp = hasRef ? await c.compareAlpha(r.png, `/ref/${name}.png`) : { iou: null, mad: null };
      return { name, quality: r.quality, ms: r.durationMs, modelMs: r.timings?.modelMs ?? 0, cutMs: r.timings?.cutMs ?? 0, iou: cmp.iou, mad: cmp.mad, bbox: r.bbox, ...(keepJpeg ? { jpeg: await c.composite(r.png) } : {}) };
    }, { name, quality, modelUrl, keepJpeg, hasRef: withRef.includes(name) }));
  }
  return rows;
}

async function saveJpegs(rows: Row[], tag: string): Promise<void> {
  for (const row of rows) if (row.jpeg) await writeFile(`${OUT}/${row.name}__${tag}.jpg`, Buffer.from(row.jpeg.split(",")[1]!, "base64"));
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const fmt = (value: number, digits = 4) => value.toFixed(digits);
function summarize(label: string, rows: Row[]): { meanIou: number; minIou: number; meanMs: number; meanModelMs: number } {
  const ious = rows.map((r) => r.iou).filter((v): v is number => v !== null);
  const steady = rows.length > 1 ? rows.slice(1) : rows; // first run warms up (shader compile, JIT)
  const out = { meanIou: mean(ious), minIou: Math.min(...ious), meanMs: mean(steady.map((r) => r.ms)), meanModelMs: mean(steady.map((r) => r.modelMs)) };
  console.log(`\n${label}: mean IoU ${fmt(out.meanIou)}, min ${fmt(out.minIou)}, mean ${Math.round(out.meanMs)} ms/sprite (model ${Math.round(out.meanModelMs)} ms; first ${Math.round(rows[0]?.ms ?? 0)} ms)`);
  for (const r of rows) console.log(`  ${r.name.padEnd(26)} ${r.quality.padEnd(5)} ${String(Math.round(r.ms)).padStart(6)} ms  model ${String(Math.round(r.modelMs)).padStart(6)}  kernel ${String(Math.round(r.cutMs)).padStart(4)}  IoU ${r.iou === null ? "  -   " : fmt(r.iou)}  MAD ${r.mad === null ? "-" : fmt(r.mad)}`);
  return out;
}

const summary: Record<string, unknown> = {};
let browser: Browser | undefined;
try {
  // GPU flags: real adapter in headless Chromium; Playwright's Chromium has no
  // dxil.dll, so Dawn must use FXC on Windows.
  browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-dawn-features=use_dxc"] });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => document.title === "sprite-cutout-ready");

  // ---- Nothing heavy before a cut -------------------------------------------
  assert.ok(!requests.some((p) => p.startsWith("/ort/") || p.startsWith("/models/")), "no runtime or model fetch at load");
  assert.deepEqual(await page.evaluate(() => (window as any).cutout.getCutoutModelState()), { state: "absent" });
  await page.evaluate((base) => (window as any).cutout.configureCutoutRuntime({ ortBaseUrl: base, backend: "wasm" }), `${origin}/ort/`);
  assert.equal(await page.evaluate(() => (window as any).cutout.getCutoutRunnerMode()), "worker", "the cut-out runs in a Worker");

  // ---- Basic quality ----------------------------------------------------------
  const basic = await cutAll(page, names, "basic", `${origin}/models/none.onnx`, true);
  await saveJpegs(basic, "basic");
  const basicStats = summarize("basic (no model) vs reference", basic);
  assert.ok(basic.every((r) => r.quality === "basic"), "basic stays basic");
  assert.ok(!requests.some((p) => p.startsWith("/ort/") || p.startsWith("/models/")), "basic never loads the runtime or a model");
  const kernelMs = mean(basic.slice(1).map((r) => r.cutMs));
  console.log(`  kernel (flood fill + matte + defringe) mean ${Math.round(kernelMs)} ms per 832x1216 sprite`);
  assert.ok(kernelMs < 300, `kernel under 300 ms (${kernelMs})`);
  assert.ok(basicStats.meanIou >= 0.85, `basic mean IoU sanity floor 0.85 (${basicStats.meanIou})`);
  assert.ok(basic.every((r) => r.bbox[2]! > 0.2 && r.bbox[3]! > 0.5), "basic bbox covers the figure");
  summary.basic = basicStats;

  // ---- Fallback: unreachable model ---------------------------------------------
  const fallback = await page.evaluate(async (url) => {
    const c = (window as any).cutout;
    const r = await c.cutSprite(await c.fetchBlob("/raw/01_dark_uniform.png"), { quality: "best", modelUrl: url });
    return { quality: r.quality, state: c.getCutoutModelState() };
  }, `${origin}/models/missing.onnx`);
  assert.equal(fallback.quality, "basic", "missing model falls back to basic");
  assert.equal(fallback.state.state, "error", "state says the model failed");
  assert.match(fallback.state.error, /404/);

  // ---- Models x backends --------------------------------------------------------
  const gpu = !NO_GPU && await page.evaluate(async () => !!(await (navigator as any).gpu?.requestAdapter().catch(() => null)));
  if (!gpu) console.log(NO_GPU ? "\nSKIP WebGPU: SPRITE_CUTOUT_NO_GPU=1." : "\nSKIP WebGPU: headless Chromium offers no adapter here.");
  const backends: Array<"wasm" | "webgpu"> = gpu ? ["webgpu", "wasm"] : ["wasm"];
  for (const model of models) {
    const url = `${origin}/models/${model}`;
    const int8 = model.includes("int8");
    for (const backend of backends) {
      const list = backend === "webgpu" && !int8 ? withRef : FULL ? withRef : SAMPLE;
      const load = await page.evaluate(async ({ url, backend, base }) => {
        const c = (window as any).cutout;
        c.resetCutoutRuntime();
        c.configureCutoutRuntime({ ortBaseUrl: base, backend });
        c.states.length = 0;
        const t = performance.now();
        await c.prepareCutoutModel(url);
        return { ms: performance.now() - t, info: c.getCutoutRuntimeInfo().model, states: c.states.map((s: any) => s.state) };
      }, { url, backend, base: `${origin}/ort/` });
      assert.equal(load.info.backend, backend, `${model} runs on ${backend}`);
      const keep = (backend === "webgpu" || !gpu) && !int8 ? true : backend === "wasm" && int8;
      const rows = await cutAll(page, list, "best", url, keep);
      await saveJpegs(rows, `${int8 ? "int8" : "fp32"}_${backend}`);
      const stats = summarize(`${model} on ${backend} (load ${Math.round(load.ms)} ms, session ${Math.round(load.info.loadMs)} ms; states ${[...new Set(load.states)].join(" > ")})`, rows);
      assert.ok(rows.every((r) => r.quality === "best"), `${model}/${backend}: model used for every sprite`);
      if (int8) {
        assert.ok(stats.meanIou >= 0.99 && stats.minIou >= 0.98, `${model}/${backend}: IoU vs reference mean >= 0.99, min >= 0.98 (${fmt(stats.meanIou)}, ${fmt(stats.minIou)})`);
      } else {
        assert.ok(stats.meanIou >= 0.97 && stats.minIou >= 0.93, `${model}/${backend}: IoU vs reference mean >= 0.97, min >= 0.93 (${fmt(stats.meanIou)}, ${fmt(stats.minIou)})`);
      }
      summary[`${model}/${backend}`] = { ...stats, loadMs: load.ms, sessionMs: load.info.loadMs, sprites: rows.length };
    }
  }

  // ---- Standard image size (624x912) ----------------------------------------------
  // The kernel has pixel-based parameters (edge band 3 px, holes > 30 px, a
  // 4-px border strip for the background colour). Cutting a 624x912 sprite
  // must give the same result as cutting it at the 832x1216 the parameters
  // were tuned on.
  if (!standardNames.length) {
    console.log(`\nSKIP standard-size check: no 624x912 sprites at ${STANDARD} (set CUE_SPRITE_STANDARD).`);
  } else {
    const model = models.at(-1);
    const runs: Array<{ quality: "basic" | "best"; list: string[] }> = [{ quality: "basic", list: standardNames }];
    if (model) runs.push({ quality: "best", list: gpu || FULL ? standardNames : standardNames.filter((name) => ["Mio_idle", "Ryoko_idle", "Viola_worried"].includes(name)).slice(0, 3) });
    if (model) {
      await page.evaluate(async ({ url, backend, base }) => {
        const c = (window as any).cutout;
        c.resetCutoutRuntime();
        c.configureCutoutRuntime({ ortBaseUrl: base, backend });
        await c.prepareCutoutModel(url);
      }, { url: `${origin}/models/${model}`, backend: gpu ? "webgpu" : "wasm", base: `${origin}/ort/` });
    }
    for (const { quality, list } of runs) {
      const rows: Array<{ name: string; iou: number; mad: number; size: number[]; upSize: number[]; quality: string; bbox: number[]; upBbox: number[] }> = [];
      for (const name of list) {
        rows.push({ name, ...await page.evaluate(({ name, quality, modelUrl }) => (window as any).cutout.scaleCompare(`/std/${name}.png`, { quality, modelUrl }), { name, quality, modelUrl: model ? `${origin}/models/${model}` : `${origin}/models/none.onnx` }) });
      }
      const ious = rows.map((row) => row.iou);
      const stats = { meanIou: mean(ious), minIou: Math.min(...ious), sprites: rows.length };
      console.log(`\nstandard size 624x912 vs 832x1216, ${quality}${quality === "best" ? ` (${model})` : ""}: mean IoU ${fmt(stats.meanIou)}, min ${fmt(stats.minIou)}`);
      for (const row of rows) console.log(`  ${row.name.padEnd(26)} IoU ${fmt(row.iou)}  MAD ${fmt(row.mad)}  bbox ${row.bbox.map((v) => v.toFixed(3)).join(",")} vs ${row.upBbox.map((v) => v.toFixed(3)).join(",")}`);
      for (const row of rows) {
        assert.deepEqual(row.size, [624, 912], `${row.name}: a standard-size sprite`);
        assert.deepEqual(row.upSize, [832, 1216]);
        assert.equal(row.quality, quality, `${row.name}: ${quality} cut`);
        assert.equal(row.upQuality, quality);
        assert.ok(row.bbox.every((v, i) => Math.abs(v - row.upBbox[i]!) <= 0.01), `${row.name}: bbox does not depend on the size`);
      }
      assert.ok(stats.meanIou >= 0.99 && stats.minIou >= 0.98, `standard size (${quality}): IoU vs the 832x1216 cut mean >= 0.99, min >= 0.98 (${fmt(stats.meanIou)}, ${fmt(stats.minIou)})`);
      summary[`standard-624x912/${quality}`] = stats;
    }
  }

  // ---- Duplicate check (two figures) ------------------------------------------------
  if (!hypLabels.length) {
    console.log(`\nSKIP duplicate check: no labels at ${HYP}/q4_labels_rule.csv (set CUE_SPRITE_HYP).`);
  } else {
    // 1. The TS port of the rule on the experiment's own (Python) cut-outs.
    const rows: Array<HypLabel & { tsFlag: boolean; tsShare: number }> = [];
    for (const entry of hypLabels) {
      const check = await page.evaluate((url) => (window as any).cutout.figureCheckUrl(url), `/hyp/cut_${entry.src}/${entry.label}.webp`);
      rows.push({ ...entry, tsFlag: check.twoFigures, tsShare: check.splitShare });
    }
    const agree = rows.filter((row) => row.tsFlag === row.flag).length;
    const maxDiff = Math.max(...rows.map((row) => Math.abs(row.tsShare - row.rf)));
    const score = (flags: boolean[]) => {
      const tp = rows.filter((row, i) => flags[i] && row.dup).length, fp = rows.filter((row, i) => flags[i] && !row.dup).length;
      const fn = rows.filter((row, i) => !flags[i] && row.dup).length, tn = rows.length - tp - fp - fn;
      return { tp, fp, fn, tn, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn), fpr: fp / Math.max(1, fp + tn) };
    };
    const ts = score(rows.map((row) => row.tsFlag));
    const py = score(rows.map((row) => row.flag));
    console.log(`\nduplicate check, TS figureCheck on the Python cut-outs: ${agree}/${rows.length} flags agree with the Python rule (max split-share difference ${fmt(maxDiff)})`);
    console.log(`  vs labels: TS P ${fmt(ts.precision, 3)} R ${fmt(ts.recall, 3)} FPR ${fmt(ts.fpr, 3)} (TP ${ts.tp} FP ${ts.fp} FN ${ts.fn}); Python P ${fmt(py.precision, 3)} R ${fmt(py.recall, 3)} FPR ${fmt(py.fpr, 3)}`);
    for (const row of rows.filter((r) => r.tsFlag !== r.flag)) console.log(`  differs: ${row.src}/${row.label} TS ${fmt(row.tsShare, 3)} vs Python ${fmt(row.rf, 3)}`);
    assert.ok(agree / rows.length >= 0.99, `TS figureCheck agrees with the Python rule on >= 99% (${agree}/${rows.length})`);
    summary.duplicateCheckPort = { agree, total: rows.length, maxShareDiff: maxDiff, ts, python: py };

    // 2. Real cuts: raw_lr2 Mio (two figures) and raw_lr (mostly one figure).
    const model = models.at(-1);
    const modelUrl = model ? `${origin}/models/${model}` : `${origin}/models/none.onnx`;
    if (model) {
      await page.evaluate(async ({ url, backend, base }) => {
        const c = (window as any).cutout;
        c.resetCutoutRuntime();
        c.configureCutoutRuntime({ ortBaseUrl: base, backend });
        await c.prepareCutoutModel(url);
      }, { url: modelUrl, backend: gpu ? "webgpu" : "wasm", base: `${origin}/ort/` });
    }
    const real: Record<string, unknown> = {};
    for (const quality of model ? ["basic", "best"] as const : ["basic"] as const) {
      for (const name of ["Mio_idle", "Mio_laughing"]) {
        if (!existsSync(`${LR2}/${name}.png`)) continue;
        const r = await page.evaluate(({ url, quality, modelUrl }) => (window as any).cutout.cutFigures(url, { quality, modelUrl }), { url: `/lr2/${name}.png`, quality, modelUrl });
        console.log(`  raw_lr2/${name} (${r.quality}): split share ${fmt(r.splitShare, 3)} -> ${r.twoFigures ? "two figures" : "one figure"}`);
        assert.equal(r.quality, quality);
        assert.ok(r.twoFigures, `raw_lr2/${name} (${quality}) has two figures`);
        real[`raw_lr2/${name}/${quality}`] = r.splitShare;
      }
      const list = quality === "basic" || gpu || FULL ? standardNames : standardNames.slice(0, 3);
      const flagged: string[] = [];
      for (const name of list) {
        const r = await page.evaluate(({ url, quality, modelUrl }) => (window as any).cutout.cutFigures(url, { quality, modelUrl }), { url: `/std/${name}.png`, quality, modelUrl });
        if (r.twoFigures) flagged.push(`${name} ${fmt(r.splitShare, 3)}`);
        real[`raw_lr/${name}/${quality}`] = r.splitShare;
      }
      console.log(`  raw_lr (${quality}): ${flagged.length}/${list.length} flagged${flagged.length ? `: ${flagged.join(", ")}` : ""}`);
      assert.ok(flagged.length <= 1, `raw_lr (${quality}): at most one sprite flagged (${flagged.join(", ")})`);
    }
    summary.duplicateCheckReal = real;

    // 3. Optional: the whole pipeline ("basic") on every experiment raw image.
    if (DUP_FULL) {
      const flags: boolean[] = [];
      for (const entry of hypLabels) {
        const r = await page.evaluate((url) => (window as any).cutout.cutFigures(url, { quality: "basic", modelUrl: "" }), `/hyp/${entry.src}/${entry.label}.png`);
        flags.push(r.twoFigures);
      }
      const full = score(flags);
      const agreeFull = flags.filter((flag, i) => flag === rows[i]!.flag).length;
      console.log(`  basic cut of every raw image: ${agreeFull}/${rows.length} agree with the Python flags; vs labels P ${fmt(full.precision, 3)} R ${fmt(full.recall, 3)} FPR ${fmt(full.fpr, 3)} (TP ${full.tp} FP ${full.fp} FN ${full.fn})`);
      summary.duplicateCheckBasicPipeline = { agree: agreeFull, total: rows.length, ...full };
    }
  }

  // ---- Model cache --------------------------------------------------------------
  if (models.length) {
    const model = models[0]!;
    const url = `${origin}/models/${model}`;
    const before = requests.filter((p) => p === `/models/${model}`).length;
    const cache = await page.evaluate(async ({ url, base }) => {
      const c = (window as any).cutout;
      c.resetCutoutRuntime();
      c.configureCutoutRuntime({ ortBaseUrl: base, backend: "wasm" });
      c.states.length = 0;
      const cachedBefore = await c.getCachedCutoutModelBytes(url);
      await c.prepareCutoutModel(url);
      const states = c.states.map((s: any) => s.state);
      const ready = c.getCutoutModelState();
      await c.clearCutoutModel();
      return { cachedBefore, states, ready, after: c.getCutoutModelState(), cachedAfter: await c.getCachedCutoutModelBytes(url) };
    }, { url, base: `${origin}/ort/` });
    assert.ok((cache.cachedBefore ?? 0) > 1_000_000, "model is cached after the first download");
    assert.equal(requests.filter((p) => p === `/models/${model}`).length, before, "second load reads the browser cache, not the network");
    assert.ok(!cache.states.includes("downloading"), "no download state on a cached load");
    assert.equal(cache.ready.state, "ready");
    assert.equal(cache.ready.bytes, cache.cachedBefore);
    assert.deepEqual(cache.after, { state: "absent" });
    assert.equal(cache.cachedAfter, null, "clear removes the cached model");
  }

  // ---- Cut service -----------------------------------------------------------------
  const service = await page.evaluate(async () => {
    const c = (window as any).cutout;
    const { service, sent } = c.startService();
    const a = { type: "vn_sprite_cut", requestId: "r1", imageId: "05_boy_jacket", setKey: "s", expression: "idle" };
    const b = { type: "vn_sprite_cut", requestId: "r2", imageId: "missing_image", setKey: "s", expression: "smile" };
    await Promise.all([service.handle(a), service.handle(a), service.handle(b)]);
    const first = sent.filter((m: any) => m.requestId === "r1");
    const data = first.map((m: any) => m.dataBase64).join("");
    const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
    const px = await c.pixels(new Blob([bytes], { type: "image/png" }));
    return { count: first.length, indexes: first.map((m: any) => m.chunkIndex), chunkCount: first[0].chunkCount, meta: first[0].meta, size: [px.width, px.height], error: sent.find((m: any) => m.requestId === "r2")?.error ?? null };
  });
  assert.equal(service.count, service.chunkCount, "one message per chunk, duplicate ignored");
  assert.deepEqual(service.indexes, [...Array(service.chunkCount).keys()], "chunks in order");
  assert.deepEqual(service.size, [832, 1216], "chunks reassemble to the PNG");
  assert.equal(service.meta.quality, "basic");
  assert.deepEqual([service.meta.width, service.meta.height], [832, 1216]);
  assert.ok(service.error && /404/.test(service.error), "failed fetch replies with an error");

  assert.deepEqual(errors, [], "no page errors");
  await writeFile(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(`\nsprite cut-out browser test passed (composites in ${OUT}/)`);
} finally {
  await browser?.close();
  server.stop(true);
}
