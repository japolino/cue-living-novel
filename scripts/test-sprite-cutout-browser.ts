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
 *   - pre-cut source: a cut-out fed back in is recognised (no model run) and
 *     keeps its alpha, colours and bbox (3 sprites);
 *   - inset crop + pre-cut: a NovelAI V5 inset canvas (opaque reference left,
 *     transparent cut-out right) through the cut service is cropped first,
 *     then recognised as pre-cut on the cropped half (alpha kept, crop echoed,
 *     the half-precision model URL passed along);
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
 *   - scenery check: every Best (and Studio) cut of the bake-off and
 *     reply-test sprites is checked and none is flagged; on the hard
 *     light-themed renders (CUE_SPRITE_SCENERY, default the background-removal
 *     benchmark's gen/white; skipped when missing) at least 8 of the 10 with
 *     drawn scenery are flagged and none of the 12 clean ones (3 of each on
 *     WASM unless SPRITE_CUTOUT_FULL=1);
 *   - model cache: a second load reads the cache (no download), clear removes it;
 *   - Studio quality (CUE_SPRITE_STUDIO_MODEL, an exported BiRefNet .onnx;
 *     skipped when unset): where the browser cannot run it (headless Chromium
 *     has no shader-f16) the cut uses Best and the Studio file is never
 *     fetched; where it can (this browser, or CUE_SPRITE_STUDIO_CHANNEL=msedge)
 *     the first "studio" cut does not wait for the Studio download (Best,
 *     provisional), the download goes on in the background, and then
 *     every sprite is cut by the Studio model in the Worker on WebGPU, IoU vs
 *     the ISNet reference mean >= 0.95, min >= 0.9 (another model), warm
 *     model time reported;
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
const STUDIO_MODEL = process.env.CUE_SPRITE_STUDIO_MODEL ? process.env.CUE_SPRITE_STUDIO_MODEL.replace(/\\/g, "/") : "";
const STUDIO_CHANNEL = process.env.CUE_SPRITE_STUDIO_CHANNEL ?? "";
const NO_GPU = process.env.SPRITE_CUTOUT_NO_GPU === "1";
const STANDARD = (process.env.CUE_SPRITE_STANDARD ?? "C:/Users/eme4/cue-living-novel/.cache/reply-test/raw_lr").replace(/\\/g, "/");
const standardNames = existsSync(STANDARD)
  ? readdirSync(STANDARD).filter((file) => file.endsWith(".png") && file !== "plate.png").map((file) => file.slice(0, -4)).sort()
  : [];
const OUT = ".cache/sprite-cutout";
const HYP = (process.env.CUE_SPRITE_HYP ?? "C:/Users/eme4/cue-living-novel/.cache/reply-test/hyp").replace(/\\/g, "/");
const LR2 = (process.env.CUE_SPRITE_LR2 ?? `${HYP.replace(/\/[^/]+\/?$/, "")}/raw_lr2`).replace(/\\/g, "/");
const DUP_FULL = FULL || process.env.SPRITE_CUTOUT_DUP_FULL === "1";
const SCENERY = (process.env.CUE_SPRITE_SCENERY ?? "C:/Users/eme4/cue-living-novel/.cache/improve/bgremoval/gen/white").replace(/\\/g, "/");
/** Hard light-themed renders (docs/SPRITE_MODE.md, scenery check): drawn scenery behind the character, and clean ones. */
const SCENERY_KEPT = ["c01_white_sundress", "c08_fairy_wings", "c14_sheep_girl", "c15_shrine_maiden", "c17_dark_elf", "c18_black_maid", "c19_school_uniform", "c20_vampire_goth", "c22_angel_glow", "c23_snow_coat_boy"];
const SCENERY_CLEAN = ["c02_bride_veil", "c03_angel_wings", "c04_kitsune_white", "c05_ghost_girl", "c06_slime_girl", "c09_harpy_white", "c10_nurse_white", "c11_boy_white_shirt", "c12_lace_sleeves", "c13_windy_hair", "c16_magical_girl", "c21_cat_hoodie"];
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
    if (path === "/studio/model.onnx") return STUDIO_MODEL ? new Response(Bun.file(STUDIO_MODEL)) : new Response("missing", { status: 404 });
    if (path.startsWith("/raw/")) return send(`${RAW}/${path.slice(5)}`);
    if (path.startsWith("/ref/")) return send(`${REF}/${path.slice(5)}`);
    if (path.startsWith("/std/")) return send(`${STANDARD}/${path.slice(5)}`);
    if (path.startsWith("/hyp/")) return send(`${HYP}/${path.slice(5)}`);
    if (path.startsWith("/lr2/")) return send(`${LR2}/${path.slice(5)}`);
    if (path.startsWith("/scn/")) return send(`${SCENERY}/${path.slice(5)}`);
    return new Response('<html><head><meta charset="utf-8"></head><body><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
  },
});
const origin = `http://127.0.0.1:${server.port}`;
await mkdir(OUT, { recursive: true });

type Row = { name: string; quality: string; studio?: boolean; scenery: boolean | null; ms: number; modelMs: number; cutMs: number; iou: number | null; mad: number | null; bbox: number[]; jpeg?: string };

async function cutAll(page: Page, list: string[], quality: "studio" | "best" | "basic", modelUrl: string, keepJpeg: boolean, studioModelUrl = ""): Promise<Row[]> {
  const rows: Row[] = [];
  for (const name of list) {
    rows.push(await page.evaluate(async ({ name, quality, modelUrl, studioModelUrl, keepJpeg, hasRef }) => {
      const c = (window as any).cutout;
      const blob = await c.fetchBlob(`/raw/${name}.png`);
      const r = await c.cutSprite(blob, { quality, modelUrl, ...(studioModelUrl ? { studioModelUrl } : {}) });
      const cmp = hasRef ? await c.compareAlpha(r.png, `/ref/${name}.png`) : { iou: null, mad: null };
      return { name, quality: r.quality, studio: r.studio === true, scenery: r.scenery ?? null, ms: r.durationMs, modelMs: r.timings?.modelMs ?? 0, cutMs: r.timings?.cutMs ?? 0, iou: cmp.iou, mad: cmp.mad, bbox: r.bbox, ...(keepJpeg ? { jpeg: await c.composite(r.png) } : {}) };
    }, { name, quality, modelUrl, studioModelUrl, keepJpeg, hasRef: withRef.includes(name) }));
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

  // ---- Pre-cut source: a cut-out fed back in keeps its own alpha ------------------
  for (const name of names.slice(0, 3)) {
    const trip = await page.evaluate((url) => (window as any).cutout.preCutRoundTrip(url), `/raw/${name}.png`);
    assert.equal(trip.firstPreCut, false, `${name}: a generated sprite on white is not pre-cut`);
    assert.equal(trip.preCut, true, `${name}: its cut-out is recognised as pre-cut`);
    assert.equal(trip.quality, "best");
    assert.equal(trip.modelMs, 0, "no model run on a pre-cut source");
    assert.equal(trip.alphaDiff, 0, `${name}: alpha kept (${trip.alphaDiff})`);
    assert.ok(trip.rgbDiff <= 1, `${name}: colours kept (${trip.rgbDiff})`);
    assert.ok(trip.sameBbox, `${name}: same bbox`);
  }
  console.log("\npre-cut round trip: 3 cut-outs fed back in kept their alpha and bbox (no model run)");

  // ---- Inset crop first, then the pre-cut check on the cropped half --------------
  const insetTrip = await page.evaluate((url) => (window as any).cutout.insetPreCutTrip(url), `/raw/${names[0]}.png`);
  assert.equal(insetTrip.error, null, "the inset cut succeeds");
  assert.equal(insetTrip.seen.length, 1, "one cut");
  assert.deepEqual([insetTrip.seen[0].width, insetTrip.seen[0].height], insetTrip.half, "the cut ran on the cropped half, not the whole canvas");
  assert.equal(insetTrip.seen[0].preCut, true, "the cropped half is recognised as pre-cut");
  assert.equal(insetTrip.seen[0].modelMs, 0, "no model run on the pre-cut half");
  assert.equal(insetTrip.alphaDiff, 0, `the cut-out keeps the half's alpha (${insetTrip.alphaDiff})`);
  assert.deepEqual(insetTrip.meta?.crop, insetTrip.crop, "the crop is echoed in the meta");
  assert.match(insetTrip.seen[0].modelUrlF16 ?? "", /model_fp16\.onnx$/, "the half-precision model URL travels with the crop");
  console.log(`inset crop + pre-cut: cropped ${insetTrip.half.join("x")} half kept its alpha (whole canvas would${insetTrip.wholePreCut ? "" : " not"} count as pre-cut)`);

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
      assert.deepEqual(rows.filter((r) => r.scenery !== false).map((r) => r.name), [], `${model}/${backend}: the scenery check ran and flagged no bake-off sprite`);
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
        if (quality === "best") assert.equal(r.scenery, false, `raw_lr/${name}: no scenery flagged (share ${r.sceneryShare})`);
        else assert.equal(r.scenery, null, `raw_lr/${name}: no scenery check without a model`);
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

  // ---- Scenery check -------------------------------------------------------------
  // Hard light-themed renders: walls, discs, rings or floor bands drawn behind
  // the character that the cut keeps. The Best cut must flag at least 8 of the
  // 10 with scenery (the dark ring of c17 sits inside the model's figure and
  // is missed by design) and none of the 12 clean ones.
  const sceneryModel = models.at(-1);
  if (!existsSync(SCENERY) || !sceneryModel) {
    console.log(`\nSKIP scenery check: ${sceneryModel ? `no renders at ${SCENERY} (set CUE_SPRITE_SCENERY)` : "no model"}.`);
  } else {
    const url = `${origin}/models/${sceneryModel}`;
    await page.evaluate(async ({ url, backend, base }) => {
      const c = (window as any).cutout;
      c.resetCutoutRuntime();
      c.configureCutoutRuntime({ ortBaseUrl: base, backend });
      await c.prepareCutoutModel(url);
    }, { url, backend: gpu ? "webgpu" : "wasm", base: `${origin}/ort/` });
    // WASM: 3 of each unless SPRITE_CUTOUT_FULL=1.
    const pick = (list: string[]) => (gpu || FULL ? list : list.slice(0, 3)).filter((name) => existsSync(`${SCENERY}/${name}.png`));
    const check = async (list: string[]) => {
      const out: Array<{ name: string; scenery: boolean | null; share: number | null }> = [];
      for (const name of list) {
        const r = await page.evaluate(({ url, modelUrl }) => (window as any).cutout.cutFigures(url, { quality: "best", modelUrl }), { url: `/scn/${name}.png`, modelUrl: url });
        assert.equal(r.quality, "best", `${name}: cut with the model`);
        out.push({ name, scenery: r.scenery, share: r.sceneryShare });
      }
      return out;
    };
    const kept = await check(pick(SCENERY_KEPT));
    const clean = await check(pick(SCENERY_CLEAN));
    console.log(`\nscenery check (${sceneryModel}, ${gpu ? "webgpu" : "wasm"}): ${kept.filter((r) => r.scenery).length}/${kept.length} renders with scenery flagged, ${clean.filter((r) => r.scenery).length}/${clean.length} clean ones`);
    for (const r of [...kept, ...clean]) console.log(`  ${r.name.padEnd(22)} share ${r.share === null ? "-" : fmt(r.share)} ${r.scenery ? "scenery" : ""}`);
    assert.deepEqual(clean.filter((r) => r.scenery !== false).map((r) => r.name), [], "no clean render is flagged");
    const minimum = kept.length === SCENERY_KEPT.length ? 8 : kept.filter((r) => r.name !== "c17_dark_elf").length;
    assert.ok(kept.filter((r) => r.scenery).length >= minimum, `at least ${minimum} of ${kept.length} renders with scenery are flagged`);
    summary.sceneryCheck = { model: sceneryModel, backend: gpu ? "webgpu" : "wasm", kept, clean };
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

  // ---- Studio quality (optional) ----------------------------------------------------
  if (!STUDIO_MODEL || !existsSync(STUDIO_MODEL)) {
    console.log("\nSKIP Studio check: set CUE_SPRITE_STUDIO_MODEL to an exported BiRefNet .onnx (docs/SPRITE_MODE.md, Studio cut-out).");
  } else if (models.length) {
    const studioUrl = `${origin}/studio/model.onnx`;
    const bestUrl = `${origin}/models/${models.at(-1)}`;
    const setUp = (target: Page) => target.evaluate(async (base) => {
      const c = (window as any).cutout;
      c.resetCutoutRuntime();
      c.configureCutoutRuntime({ ortBaseUrl: base, backend: "auto" });
      c.states.length = 0;
      return c.getStudioCutoutSupport();
    }, `${origin}/ort/`);
    const support: string | null = await setUp(page);
    if (support) {
      const fallback = await cutAll(page, SAMPLE.slice(0, 1), "studio", bestUrl, false, studioUrl);
      const state = await page.evaluate(() => (window as any).cutout.getCutoutModelState());
      assert.ok(fallback.every((r) => r.quality === "best" && !r.studio), "Studio where it cannot run: the cut uses Best");
      assert.ok(!requests.includes("/studio/model.onnx"), "Studio where it cannot run: the Studio model is never fetched");
      assert.equal(state.note, support, "the ready state says why Studio is not used");
      console.log(`\nStudio where it cannot run: Best cut, no Studio download (${support})`);
      summary.studioFallback = { support, quality: fallback[0]!.quality };
    }
    let studioBrowser: Browser | undefined;
    try {
      let target: Page | null = support ? null : page;
      if (!target && STUDIO_CHANNEL) {
        studioBrowser = await chromium.launch({ headless: true, channel: STUDIO_CHANNEL, args: ["--enable-unsafe-webgpu", "--enable-gpu", "--ignore-gpu-blocklist"] });
        target = await studioBrowser.newPage();
        target.on("pageerror", (error) => errors.push(error.message));
        await target.goto(`${origin}/`);
        await target.waitForFunction(() => document.title === "sprite-cutout-ready");
        const there = await setUp(target);
        if (there) { console.log(`SKIP Studio cuts: ${STUDIO_CHANNEL} cannot run them either (${there})`); target = null; }
      }
      if (!target) {
        if (support && !STUDIO_CHANNEL) console.log("SKIP Studio cuts: set CUE_SPRITE_STUDIO_CHANNEL=msedge (or another browser with shader-f16).");
      } else {
        // The 500 MB download never runs inside a cut: the first "studio" cut uses Best (provisional).
        const early = await target.evaluate(async ({ url, best, name }) => {
          const c = (window as any).cutout;
          const blob = await c.fetchBlob(`/raw/${name}.png`);
          const t = performance.now();
          const r = await c.cutSprite(blob, { quality: "studio", modelUrl: best, studioModelUrl: url });
          const state = c.getCutoutModelState();
          return { ms: performance.now() - t, quality: r.quality, studio: r.studio === true, provisional: r.provisional === true, state: state.state, stateStudio: state.studio === true };
        }, { url: studioUrl, best: bestUrl, name: withRef[0]! });
        assert.ok(early.quality === "best" && !early.studio && early.provisional, "the first Studio cut uses Best while the Studio model downloads (provisional)");
        console.log(`\nStudio download in the background: first cut by Best in ${Math.round(early.ms)} ms (provisional), state then ${early.state}${early.stateStudio ? " (Studio)" : ""}`);
        // It finishes on its own (no cut waits for it).
        const after = await target.evaluate(async () => {
          const c = (window as any).cutout;
          const t = performance.now();
          for (let i = 0; i < 1800; i++) {
            const s = c.getCutoutModelState();
            if (!(s.state === "downloading" && s.studio)) return { ms: performance.now() - t, state: s };
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          return { ms: performance.now() - t, state: c.getCutoutModelState() };
        });
        console.log(`  the background download ended ${Math.round(after.ms)} ms later: ${JSON.stringify(after.state)}`);
        assert.ok(!after.state.note, `the background download succeeded (${after.state.note ?? ""})`);
        const load = await target.evaluate(async (url) => {
          const c = (window as any).cutout;
          const t = performance.now();
          await c.prepareStudioCutoutModel(url); // joins the background download, then loads
          return { ms: performance.now() - t, info: c.getCutoutRuntimeInfo().model, state: c.getCutoutModelState(), states: c.states.map((s: any) => s.state) };
        }, studioUrl);
        console.log(`Studio model ${load.state.notStored ? "loaded from memory: this browser profile did not store it" : "stored in this browser"}`);
        assert.equal(requests.filter((path) => path === "/studio/model.onnx").length, 1, "the Studio model downloads once");
        assert.equal(load.info.backend, "webgpu", "the Studio model runs on WebGPU");
        assert.equal(load.state.studio, true, "the ready state is the Studio model's");
        assert.equal(await target.evaluate(() => (window as any).cutout.getCutoutRunnerMode()), "worker", "the Studio model runs in the Worker");
        const rows = await cutAll(target, withRef, "studio", bestUrl, true, studioUrl);
        await saveJpegs(rows, "studio");
        const stats = summarize(`Studio (BiRefNet, load ${Math.round(load.ms)} ms, session ${Math.round(load.info.loadMs)} ms; states ${[...new Set(load.states)].join(" > ")}) vs the ISNet reference`, rows);
        assert.ok(rows.every((r) => r.quality === "best" && r.studio), "the Studio model cut every sprite");
        assert.deepEqual(rows.filter((r) => r.scenery !== false).map((r) => r.name), [], "the scenery check ran on the Studio mask and flagged no bake-off sprite");
        assert.ok(stats.meanIou >= 0.95 && stats.minIou >= 0.9, `Studio IoU vs reference mean >= 0.95, min >= 0.9 (${fmt(stats.meanIou)}, ${fmt(stats.minIou)})`);
        summary.studio = { ...stats, loadMs: load.ms, sessionMs: load.info.loadMs, sprites: rows.length, channel: STUDIO_CHANNEL || "chromium", firstCutMs: early.ms, notStored: load.state.notStored === true };
      }
    } finally {
      await studioBrowser?.close();
    }
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
