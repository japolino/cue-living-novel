import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  chooseCutoutModelUrl,
  clearCutoutModel,
  configureCutoutRuntime,
  cutSprite,
  detectSpriteFace,
  getFaceModelState,
  getCutoutModelState,
  getCachedCutoutModelBytes,
  getCutoutRunnerMode,
  getStudioCutoutSupport,
  onCutoutModelState,
  ORT_CDN_BASE,
  ORT_VERSION,
  prepareCutoutModel,
  prepareStudioCutoutModel,
  resetCutoutRuntime,
  type CutoutModelState,
} from "./index.js";
import { cutoutWorkerSource } from "./runner.js";

/*
 * Runtime tests with fakes: Bun has no canvas, so createImageBitmap /
 * OffscreenCanvas / ImageData are replaced by a tiny JSON "image" format, and
 * onnxruntime-web by a fake ESM module on disk. The real browser path runs in
 * scripts/test-sprite-cutout-browser.ts.
 */
type FakePixels = { width: number; height: number; data: number[] };
const fakeImage = (width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Blob => {
  const data: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.push(...paint(x, y));
  return new Blob([JSON.stringify({ width, height, data })], { type: "application/x-fake-image" });
};
/** 16x16 white image with a dark 6x8 block (x 5..10, y 4..11). */
const sprite = () => fakeImage(16, 16, (x, y) => (x >= 5 && x < 11 && y >= 4 && y < 12 ? [30, 30, 40, 255] : [255, 255, 255, 255]));
const decodePng = async (blob: Blob): Promise<FakePixels> => JSON.parse(await blob.text()) as FakePixels;
/** A fake image behind a PNG signature and IHDR saying RGBA (colour type 6): what ComfyUI's cut-out saves. */
const pngWrapped = async (image: Blob): Promise<Blob> => {
  const header = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 16, 0, 0, 0, 16, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
  return new Blob([header, await image.text()], { type: "image/png" });
};

const FAKE_ORT = `
export const env = { wasm: {}, webgpu: {} };
// Fake YOLO face detector: one box around the dark pixels (score 0.9), a
// shifted duplicate (NMS drops it) and a weak box (below the threshold).
function fakeFaceSession(found) {
  return {
    inputNames: ["images"], outputNames: ["output0"], inputMetadata: [{ shape: ["batch", 3, "height", "width"] }],
    async run(feeds) {
      const t = feeds.images; const h = t.dims[2], w = t.dims[3];
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (t.data[y * w + x] < 0.5) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
      const rows = [[(x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, found ? 0.9 : 0.1], [(x0 + x1) / 2 + 0.5, (y0 + y1) / 2, x1 - x0, y1 - y0, found ? 0.8 : 0.1], [4, 4, 4, 4, 0.2]];
      const data = new Float32Array(15);
      rows.forEach((row, i) => row.forEach((v, c) => { data[c * 3 + i] = v; }));
      return { output0: { data, dims: [1, 5, 3], dispose() {} } };
    },
    async release() {},
  };
}
export class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
export const InferenceSession = {
  async create(bytes, options) {
    const head = new TextDecoder().decode(bytes.subarray(0, 6));
    globalThis.__fakeOrtCreates = (globalThis.__fakeOrtCreates ?? 0) + 1;
    globalThis.__fakeOrtOptions = options;
    if (head === "BROKEN") throw new Error("failed to allocate");
    if (head === "FACEMD" || head === "NOFACE") return fakeFaceSession(head === "FACEMD");
    return {
      inputNames: ["img"], outputNames: ["mask"], inputMetadata: [{ shape: [1, 3, 16, 16] }],
      async run(feeds) {
        if (head === "THROWS") throw new Error("device lost");
        const t = feeds.img; const n = 16 * 16; const out = new Float32Array(n);
        globalThis.__fakeOrtFirstRow = Array.from(t.data.subarray(0, 16));
        // "Segmentation": dark pixels are foreground.
        for (let i = 0; i < n; i++) out[i] = t.data[i] < 0.5 ? 1 : 0;
        return { mask: { data: out, dispose() {} } };
      },
      async release() {},
    };
  },
};
`;

const saved: Record<string, unknown> = {};
let dir = "";
let fetches: string[] = [];
let modelBody = "MODEL-".padEnd(4096, "x");

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cue-ort-"));
  writeFileSync(join(dir, "ort.wasm.min.mjs"), FAKE_ORT);
  writeFileSync(join(dir, "ort.webgpu.min.mjs"), FAKE_ORT);
  const g = globalThis as Record<string, unknown>;
  for (const key of ["createImageBitmap", "OffscreenCanvas", "ImageData", "fetch"]) saved[key] = g[key];
  g.createImageBitmap = async (blob: Blob) => {
    // A fake image may follow a real PNG header (see pngWrapped).
    const text = await blob.text();
    const image = JSON.parse(text.slice(text.indexOf("{"))) as FakePixels;
    return { width: image.width, height: image.height, pixels: image.data, close() {} };
  };
  g.ImageData = class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
  g.OffscreenCanvas = class {
    pixels = new Uint8ClampedArray(0);
    constructor(public width: number, public height: number) { this.pixels = new Uint8ClampedArray(width * height * 4); }
    getContext() {
      return {
        drawImage: (bitmap: { pixels: number[] }) => { this.pixels = Uint8ClampedArray.from(bitmap.pixels); },
        getImageData: () => ({ data: Uint8ClampedArray.from(this.pixels) }),
        putImageData: (image: { data: Uint8ClampedArray }) => { this.pixels = Uint8ClampedArray.from(image.data); },
      };
    }
    async convertToBlob() { return new Blob([JSON.stringify({ width: this.width, height: this.height, data: [...this.pixels] })], { type: "image/png" }); }
  };
  g.fetch = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("file:")) return (saved.fetch as typeof fetch)(input);
    fetches.push(url);
    if (url.includes("missing")) return new Response("nope", { status: 404 });
    const body = url.includes("broken") ? "BROKEN".padEnd(4096, "x") : url.includes("throws") ? "THROWS".padEnd(4096, "x")
      : url.includes("noface") ? "NOFACE".padEnd(4096, "x") : url.includes("face") ? "FACEMD".padEnd(4096, "x") : modelBody;
    return new Response(body, { headers: { "Content-Length": String(body.length) } });
  };
});

afterAll(() => {
  const g = globalThis as Record<string, unknown>;
  for (const [key, value] of Object.entries(saved)) g[key] = value;
  rmSync(dir, { recursive: true, force: true });
  resetCutoutRuntime();
});

afterEach(() => {
  resetCutoutRuntime();
  fetches = [];
  modelBody = "MODEL-".padEnd(4096, "x");
});

const configure = () => configureCutoutRuntime({ ortBaseUrl: pathToFileURL(dir).href + "/", backend: "wasm", preferWorker: false, numThreads: 1 });

describe("cut-out runtime", () => {
  test("onnxruntime-web CDN pin matches the devDependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies["onnxruntime-web"]).toBe(ORT_VERSION);
    expect(ORT_CDN_BASE).toBe(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`);
  });

  test("worker source is self-contained: run from text, it answers a cut", async () => {
    const posted: Array<Record<string, unknown>> = [];
    const port = { onmessage: null as ((event: { data: unknown }) => void) | null, postMessage: (message: Record<string, unknown>) => posted.push(message) };
    new Function("self", cutoutWorkerSource())(port);
    expect(posted[0]).toEqual({ type: "hello" });
    port.onmessage!({ data: { id: 7, type: "cut", image: sprite(), useModel: true } });
    for (let i = 0; i < 50 && posted.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    const reply = posted[1] as { id: number; ok: boolean; value: { quality: string; modelError: string; bbox: number[] } };
    expect(reply.id).toBe(7);
    expect(reply.ok).toBe(true);
    expect(reply.value.quality).toBe("basic");
    expect(reply.value.modelError).toMatch(/not loaded/);
    expect(reply.value.bbox).toEqual([5 / 16, 4 / 16, 6 / 16, 8 / 16]);
  });

  test("basic cut: no download, transparent background, bbox", async () => {
    configure();
    expect(await getCutoutRunnerMode()).toBe("inline");
    const result = await cutSprite(sprite(), { quality: "basic", modelUrl: "https://models.test/isnet.onnx" });
    expect(fetches).toEqual([]);
    expect(result.quality).toBe("basic");
    expect([result.width, result.height]).toEqual([16, 16]);
    expect(result.bbox).toEqual([5 / 16, 4 / 16, 6 / 16, 8 / 16]);
    const png = await decodePng(result.png);
    expect(png.data[3]).toBe(0);
    expect(png.data[(6 * 16 + 7) * 4 + 3]).toBe(255);
    expect(getCutoutModelState()).toEqual({ state: "absent" });
    // No mask, no scenery check.
    expect(result.scenery).toBeUndefined();
  });

  test("best: download with progress, load, ready, model used", async () => {
    configure();
    const states: CutoutModelState[] = [];
    const off = onCutoutModelState((state) => states.push(state));
    const result = await cutSprite(sprite(), { quality: "best", modelUrl: "https://models.test/isnet.onnx" });
    off();
    expect(result.quality).toBe("best");
    expect(fetches).toEqual(["https://models.test/isnet.onnx"]);
    // The cut was checked against the model's mask: nothing opaque outside the figure.
    expect(result.scenery).toBe(false);
    expect(result.sceneryShare).toBe(0);
    expect(states[0]).toEqual({ state: "downloading", receivedBytes: 0, totalBytes: null });
    expect(states.some((s) => s.state === "downloading" && s.receivedBytes === 4096 && s.totalBytes === 4096)).toBe(true);
    expect(states.at(-2)).toEqual({ state: "loading" });
    // No browser storage in this test: the ready state says the model downloads again next visit.
    expect(states.at(-1)).toEqual({ state: "ready", backend: "wasm", bytes: 4096, notStored: true });
    // A second cut reuses the loaded session.
    const again = await cutSprite(sprite(), { quality: "best", modelUrl: "https://models.test/isnet.onnx" });
    expect(again.quality).toBe("best");
    expect(fetches).toHaveLength(1);
    // A different URL loads a different model.
    await prepareCutoutModel("https://models.test/other.onnx");
    expect(fetches).toHaveLength(2);
  });

  describe("half-precision copy", () => {
    const FULL = "https://models.test/isnet.onnx";
    const HALF = "https://models.test/isnet_fp16.onnx";
    const nav = (globalThis as unknown as { navigator?: Record<string, unknown> }).navigator;
    const setGpu = (gpu: unknown): void => {
      if (nav) Object.defineProperty(nav, "gpu", { value: gpu, configurable: true, writable: true });
    };
    afterEach(() => {
      if (nav) delete nav.gpu;
      delete (globalThis as { caches?: unknown }).caches;
    });
    const adapter = (features: string[]) => ({ requestAdapter: async () => ({ features: new Set(features) }) });

    test("WASM runs either: the half-size copy downloads", async () => {
      configure();
      const result = await cutSprite(sprite(), { quality: "best", modelUrl: FULL, modelUrlF16: HALF });
      expect(result.quality).toBe("best");
      expect(fetches).toEqual([HALF]);
      expect(await chooseCutoutModelUrl(FULL, HALF)).toBe(HALF);
      await prepareCutoutModel(FULL, HALF);
      expect(fetches).toEqual([HALF]); // already loaded
    });

    test("WebGPU with shader-f16: the copy; without it: the full model keeps WebGPU", async () => {
      if (!nav) return;
      configure();
      configureCutoutRuntime({ backend: "auto" });
      setGpu(adapter(["shader-f16"]));
      expect(await chooseCutoutModelUrl(FULL, HALF)).toBe(HALF);
      resetCutoutRuntime();
      setGpu(adapter([]));
      const result = await cutSprite(sprite(), { quality: "best", modelUrl: FULL, modelUrlF16: HALF });
      expect(result.quality).toBe("best");
      expect(fetches).toEqual([FULL]);
      expect(getCutoutModelState()).toMatchObject({ state: "ready", backend: "webgpu" });
      resetCutoutRuntime();
      setGpu({ requestAdapter: async () => null }); // no adapter: WASM, so the copy
      expect(await chooseCutoutModelUrl(FULL, HALF)).toBe(HALF);
    });

    test("a full model already in the cache stays in use; cached bytes fall back to the copy", async () => {
      configure();
      const store = new Map<string, Response>();
      (globalThis as { caches?: unknown }).caches = {
        open: async () => ({
          match: async (url: string) => store.get(url)?.clone(),
          put: async (url: string, response: Response) => { store.set(url, response); },
        }),
        delete: async () => { store.clear(); return true; },
      };
      store.set(FULL, new Response(modelBody, { headers: { "Content-Length": String(modelBody.length) } }));
      expect(await chooseCutoutModelUrl(FULL, HALF)).toBe(FULL);
      expect(await getCachedCutoutModelBytes(FULL, HALF)).toBe(4096);
      await clearCutoutModel();
      store.set(HALF, new Response("x".repeat(2048), { headers: { "Content-Length": "2048" } }));
      expect(await getCachedCutoutModelBytes(FULL, HALF)).toBe(2048);
      expect(await chooseCutoutModelUrl(FULL, HALF)).toBe(HALF);
      expect(await chooseCutoutModelUrl("https://models.test/custom.onnx")).toBe("https://models.test/custom.onnx");
      expect(fetches).toEqual([]);
    });
  });

  describe("studio quality", () => {
    const BEST = "https://models.test/isnet.onnx";
    const STUDIO = "http://localhost:8790/studio.onnx";
    const nav = (globalThis as unknown as { navigator?: Record<string, unknown> }).navigator;
    const setGpu = (gpu: unknown): void => {
      if (nav) Object.defineProperty(nav, "gpu", { value: gpu, configurable: true, writable: true });
    };
    const adapter = (features: string[]) => ({ requestAdapter: async () => ({ features: new Set(features) }) });
    const g = globalThis as Record<string, unknown>;
    afterEach(() => {
      if (nav) delete nav.gpu;
      delete g.__fakeOrtOptions;
      delete g.__fakeOrtFirstRow;
    });
    /** 16x8 white image with a dark block: letterboxed it gets zero rows on top, stretched it does not. */
    const wide = () => fakeImage(16, 8, (x, y) => (x >= 5 && x < 11 && y >= 2 && y < 6 ? [30, 30, 40, 255] : [255, 255, 255, 255]));
    const studioGpu = (): boolean => {
      if (!nav) return false;
      configure();
      configureCutoutRuntime({ backend: "auto" });
      setGpu(adapter(["shader-f16"]));
      return true;
    };
    /** The Studio model downloads in the background (never inside a cut): wait for it. */
    const studioDownloaded = async (): Promise<void> => {
      for (let i = 0; i < 500; i++) {
        const state = getCutoutModelState();
        if (!(state.state === "downloading" && state.studio)) return;
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      throw new Error("The Studio download did not finish.");
    };

    test("WebGPU with shader-f16: the Studio model downloads in the background, then runs on WebGPU with a stretched input", async () => {
      if (!studioGpu()) return;
      expect(await getStudioCutoutSupport()).toBeNull();
      const states: CutoutModelState[] = [];
      const off = onCutoutModelState((state) => states.push(state));
      // The first cut uses Best while the Studio model downloads.
      const first = await cutSprite(wide(), { quality: "studio", modelUrl: BEST, studioModelUrl: STUDIO });
      expect(first.studio).toBeUndefined();
      expect(states[0]).toEqual({ state: "downloading", receivedBytes: 0, totalBytes: null, studio: true });
      await studioDownloaded();
      const result = await cutSprite(wide(), { quality: "studio", modelUrl: BEST, studioModelUrl: STUDIO });
      off();
      expect(result.quality).toBe("best");
      expect(result.studio).toBe(true);
      expect(fetches).toEqual([STUDIO, BEST]);
      expect((g.__fakeOrtOptions as { executionProviders: string[] }).executionProviders).toEqual(["webgpu"]);
      // Stretched: the top row is the white image, not letterbox padding.
      expect(g.__fakeOrtFirstRow).toEqual(new Array(16).fill(1));
      expect(states.at(-2)).toEqual({ state: "loading", studio: true });
      expect(states.at(-1)).toEqual({ state: "ready", backend: "webgpu", bytes: 4096, studio: true, notStored: true });
      expect(result.bbox).toEqual([5 / 16, 2 / 8, 6 / 16, 4 / 8]);
      // Best letterboxes the same image (zero padding on top).
      const best = await cutSprite(wide(), { quality: "best", modelUrl: BEST, studioModelUrl: STUDIO });
      expect(best.studio).toBeUndefined();
      expect(g.__fakeOrtFirstRow).toEqual(new Array(16).fill(0));
    });

    test("no shader-f16: no Studio download, Best cuts, the ready state says why", async () => {
      if (!nav) return;
      configure();
      configureCutoutRuntime({ backend: "auto" });
      setGpu(adapter([]));
      expect(await getStudioCutoutSupport()).toMatch(/shader-f16/);
      const result = await cutSprite(sprite(), { quality: "studio", modelUrl: BEST, studioModelUrl: STUDIO });
      expect(result.quality).toBe("best");
      expect(result.studio).toBeUndefined();
      expect(fetches).toEqual([BEST]);
      const state = getCutoutModelState();
      expect(state).toMatchObject({ state: "ready", backend: "webgpu" });
      expect(state.state === "ready" && state.note).toMatch(/shader-f16/);
      await cutSprite(sprite(), { quality: "studio", modelUrl: BEST, studioModelUrl: STUDIO });
      expect(fetches).toEqual([BEST]);
      // An explicit prepare still refuses before any download.
      await expect(prepareStudioCutoutModel(STUDIO)).rejects.toThrow(/shader-f16/);
      expect(fetches).toEqual([BEST]);
    });

    test("WebAssembly backend or no Studio URL: Best, nothing else downloads", async () => {
      configure();
      expect(await getStudioCutoutSupport()).toMatch(/WebAssembly/);
      const wasm = await cutSprite(sprite(), { quality: "studio", modelUrl: BEST, studioModelUrl: STUDIO });
      expect(wasm.quality).toBe("best");
      expect(wasm.studio).toBeUndefined();
      resetCutoutRuntime();
      configure();
      const noUrl = await cutSprite(sprite(), { quality: "studio", modelUrl: BEST });
      expect(noUrl.quality).toBe("best");
      expect(fetches).toEqual([BEST, BEST]);
      const state = getCutoutModelState();
      expect(state.state === "ready" && state.note).toMatch(/No Studio model URL/);
    });

    test("the Studio session cannot be built: sticky, Best cuts, no second Studio download", async () => {
      if (!studioGpu()) return;
      const broken = "http://localhost:8790/studio-broken.onnx";
      await cutSprite(sprite(), { quality: "studio", modelUrl: BEST, studioModelUrl: broken });
      await studioDownloaded();
      const result = await cutSprite(sprite(), { quality: "studio", modelUrl: BEST, studioModelUrl: broken });
      expect(result.quality).toBe("best");
      expect(result.studio).toBeUndefined();
      // Best again on the fresh worker the failure leaves (this test has no browser cache).
      expect(fetches).toEqual([broken, BEST, BEST]);
      const state = getCutoutModelState();
      expect(state.state === "ready" && state.note).toMatch(/Studio model cannot run.*failed to allocate/);
      await cutSprite(sprite(), { quality: "studio", modelUrl: BEST, studioModelUrl: broken });
      expect(fetches).toEqual([broken, BEST, BEST]);
    });

    test("the Studio download fails: Best cuts and the note names the Studio model", async () => {
      if (!studioGpu()) return;
      const missing = "http://localhost:8790/studio-missing.onnx";
      const result = await cutSprite(sprite(), { quality: "studio", modelUrl: BEST, studioModelUrl: missing });
      await studioDownloaded();
      expect(result.quality).toBe("best");
      expect(result.studio).toBeUndefined();
      expect(fetches).toEqual([missing, BEST]);
      const state = getCutoutModelState();
      expect(state.state === "ready" && state.note).toMatch(/^The Studio model is not available: .*404/);
    });

    test("the Studio model fails while cutting: that sprite is cut again with Best", async () => {
      if (!studioGpu()) return;
      const throws = "http://localhost:8790/studio-throws.onnx";
      await cutSprite(sprite(), { quality: "studio", modelUrl: BEST, studioModelUrl: throws });
      await studioDownloaded();
      const result = await cutSprite(sprite(), { quality: "studio", modelUrl: BEST, studioModelUrl: throws });
      expect(result.quality).toBe("best");
      expect(result.studio).toBeUndefined();
      expect(result.bbox).toEqual([5 / 16, 4 / 16, 6 / 16, 8 / 16]);
      expect(fetches).toEqual([throws, BEST, BEST]);
      const state = getCutoutModelState();
      expect(state.state === "ready" && state.note).toMatch(/device lost/);
      // Best keeps cutting; the Studio model is not tried again on this page.
      const again = await cutSprite(sprite(), { quality: "studio", modelUrl: BEST, studioModelUrl: throws });
      expect(again.quality).toBe("best");
      expect(fetches).toEqual([throws, BEST, BEST]);
    });
  });

  test("download blocked: best falls back to basic, state says why, retry waits", async () => {
    configure();
    const result = await cutSprite(sprite(), { quality: "best", modelUrl: "https://models.test/missing.onnx" });
    expect(result.quality).toBe("basic");
    const state = getCutoutModelState();
    expect(state.state).toBe("error");
    expect(state.state === "error" && state.error).toMatch(/HTTP 404/);
    await cutSprite(sprite(), { quality: "best", modelUrl: "https://models.test/missing.onnx" });
    expect(fetches).toHaveLength(1); // cooldown: no second download attempt right away
    await expect(prepareCutoutModel("https://models.test/missing.onnx")).rejects.toThrow(/404/); // explicit prepare retries
    expect(fetches).toHaveLength(2);
  });

  test("model cannot run (session fails): unsupported, basic, sticky until prepare", async () => {
    configure();
    const result = await cutSprite(sprite(), { quality: "best", modelUrl: "https://models.test/broken.onnx" });
    expect(result.quality).toBe("basic");
    const state = getCutoutModelState();
    expect(state.state).toBe("unsupported");
    expect(state.state === "unsupported" && state.reason).toMatch(/failed to allocate/);
    await cutSprite(sprite(), { quality: "best", modelUrl: "https://models.test/broken.onnx" });
    expect(fetches).toHaveLength(1);
  });

  test("inference failure: that cut is basic and the state is error", async () => {
    configure();
    const result = await cutSprite(sprite(), { quality: "best", modelUrl: "https://models.test/throws.onnx" });
    expect(result.quality).toBe("basic");
    expect(getCutoutModelState()).toEqual({ state: "error", error: "device lost" });
  });

  test("a few transparent pixels on an opaque image count as white background", async () => {
    configure();
    // Top row transparent (16 of 60 border pixels), the rest of the frame white and opaque.
    const image = fakeImage(16, 16, (x, y) => (y === 0 ? [0, 0, 0, 0] : x >= 4 && x < 12 && y >= 4 && y < 12 ? [200, 40, 40, 255] : [255, 255, 255, 255]));
    const result = await cutSprite(image, { quality: "basic", modelUrl: "" });
    const png = await decodePng(result.png);
    expect(png.data.slice(0, 4)).toEqual([255, 255, 255, 0]);
    expect(result.bbox).toEqual([0.25, 0.25, 0.5, 0.5]);
    expect(result.preCut).toBeUndefined();
  });

  test("a source that is already cut out keeps its alpha and skips the model", async () => {
    configure();
    // Transparent frame, opaque figure, a soft edge pixel; colours under alpha 0 are kept as they are.
    const image = fakeImage(16, 16, (x, y) => (x === 3 && y === 8 ? [200, 40, 40, 128] : x >= 4 && x < 12 && y >= 4 && y < 12 ? [200, 40, 40, 255] : [9, 9, 9, 0]));
    for (const quality of ["basic", "best"] as const) {
      const result = await cutSprite(image, { quality, modelUrl: "https://models.test/isnet.onnx" });
      const png = await decodePng(result.png);
      expect(png.data.slice(0, 4)).toEqual([9, 9, 9, 0]);
      expect(png.data.slice((8 * 16 + 3) * 4, (8 * 16 + 3) * 4 + 4)).toEqual([200, 40, 40, 128]);
      expect(png.data[(8 * 16 + 8) * 4 + 3]).toBe(255);
      expect(result.bbox).toEqual([3 / 16, 0.25, 9 / 16, 0.5]);
      expect(result.quality).toBe("best");
      expect(result.preCut).toBe(true);
      expect(result.timings?.modelMs).toBe(0);
      // Its alpha is the workflow model's mask: nothing to check it against.
      expect(result.scenery).toBeUndefined();
    }
  });

  test("a transparent PNG the workflow cut is cut without loading the model", async () => {
    configure();
    const image = await pngWrapped(fakeImage(16, 16, (x, y) => (x >= 4 && x < 12 && y >= 4 && y < 12 ? [200, 40, 40, 255] : [9, 9, 9, 0])));
    const result = await cutSprite(image, { quality: "best", modelUrl: "https://models.test/isnet.onnx" });
    expect(result.preCut).toBe(true);
    expect(result.quality).toBe("best");
    expect(result.bbox).toEqual([0.25, 0.25, 0.5, 0.5]);
    expect(fetches).toEqual([]);
    expect(getCutoutModelState().state).toBe("absent");
  });

  test("abort before the cut rejects with AbortError", async () => {
    configure();
    const controller = new AbortController();
    controller.abort();
    await expect(cutSprite(sprite(), { quality: "basic", modelUrl: "", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  test("clearCutoutModel forgets the loaded model", async () => {
    configure();
    await prepareCutoutModel("https://models.test/isnet.onnx");
    expect(getCutoutModelState().state).toBe("ready");
    await clearCutoutModel();
    expect(getCutoutModelState()).toEqual({ state: "absent" });
    await prepareCutoutModel("https://models.test/isnet.onnx");
    expect(fetches).toHaveLength(2);
  });

  test("best cut with the face model: the face box rides along", async () => {
    configure();
    const result = await cutSprite(sprite(), { quality: "best", modelUrl: "https://models.test/isnet.onnx", faceModelUrl: "https://models.test/face.onnx" });
    expect(result.quality).toBe("best");
    expect(fetches).toEqual(["https://models.test/isnet.onnx", "https://models.test/face.onnx"]);
    expect(result.face).toEqual([5 / 16, 4 / 16, 6 / 16, 8 / 16]);
    expect(getFaceModelState()).toEqual({ state: "ready", backend: "wasm", bytes: 4096 });
    // Basic cuts never download the face model.
    const basic = await cutSprite(sprite(), { quality: "basic", modelUrl: "", faceModelUrl: "https://models.test/face.onnx" });
    expect(basic.face).toBeUndefined();
  });

  test("face model download fails: the cut still works, face is unknown", async () => {
    configure();
    const result = await cutSprite(sprite(), { quality: "best", modelUrl: "https://models.test/isnet.onnx", faceModelUrl: "https://models.test/missing-face.onnx" });
    expect(result.quality).toBe("best");
    expect(result.face).toBeUndefined();
    expect(getFaceModelState().state).toBe("error");
  });

  test("detectSpriteFace: a cut-out on transparent counts as on white; no face gives null", async () => {
    configure();
    const cutout = fakeImage(16, 16, (x, y) => (x >= 5 && x < 11 && y >= 4 && y < 12 ? [30, 30, 40, 255] : [0, 0, 0, 0]));
    const found = await detectSpriteFace(cutout, { modelUrl: "https://models.test/face.onnx" });
    expect(found.face).toEqual([5 / 16, 4 / 16, 6 / 16, 8 / 16]);
    expect(found.score).toBeCloseTo(0.9, 5);
    expect(found.count).toBe(1);
    const none = await detectSpriteFace(cutout, { modelUrl: "https://models.test/noface.onnx" });
    expect(none).toMatchObject({ face: null, score: null, count: 0 });
    await clearCutoutModel();
    expect(getFaceModelState()).toEqual({ state: "absent" });
  });

  test("detectSpriteFace rejects when the face model cannot be fetched", async () => {
    configure();
    await expect(detectSpriteFace(sprite(), { modelUrl: "https://models.test/missing-face.onnx" })).rejects.toThrow(/404/);
  });
});
