import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  clearCutoutModel,
  configureCutoutRuntime,
  cutSprite,
  getCutoutModelState,
  getCutoutRunnerMode,
  onCutoutModelState,
  ORT_CDN_BASE,
  ORT_VERSION,
  prepareCutoutModel,
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

const FAKE_ORT = `
export const env = { wasm: {}, webgpu: {} };
export class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
export const InferenceSession = {
  async create(bytes, options) {
    const head = new TextDecoder().decode(bytes.subarray(0, 6));
    globalThis.__fakeOrtCreates = (globalThis.__fakeOrtCreates ?? 0) + 1;
    globalThis.__fakeOrtOptions = options;
    if (head === "BROKEN") throw new Error("failed to allocate");
    return {
      inputNames: ["img"], outputNames: ["mask"], inputMetadata: [{ shape: [1, 3, 16, 16] }],
      async run(feeds) {
        if (head === "THROWS") throw new Error("device lost");
        const t = feeds.img; const n = 16 * 16; const out = new Float32Array(n);
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
    const image = JSON.parse(await blob.text()) as FakePixels;
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
    const body = url.includes("broken") ? "BROKEN".padEnd(4096, "x") : url.includes("throws") ? "THROWS".padEnd(4096, "x") : modelBody;
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
  });

  test("best: download with progress, load, ready, model used", async () => {
    configure();
    const states: CutoutModelState[] = [];
    const off = onCutoutModelState((state) => states.push(state));
    const result = await cutSprite(sprite(), { quality: "best", modelUrl: "https://models.test/isnet.onnx" });
    off();
    expect(result.quality).toBe("best");
    expect(fetches).toEqual(["https://models.test/isnet.onnx"]);
    expect(states[0]).toEqual({ state: "downloading", receivedBytes: 0, totalBytes: null });
    expect(states.some((s) => s.state === "downloading" && s.receivedBytes === 4096 && s.totalBytes === 4096)).toBe(true);
    expect(states.at(-2)).toEqual({ state: "loading" });
    expect(states.at(-1)).toEqual({ state: "ready", backend: "wasm", bytes: 4096 });
    // A second cut reuses the loaded session.
    const again = await cutSprite(sprite(), { quality: "best", modelUrl: "https://models.test/isnet.onnx" });
    expect(again.quality).toBe("best");
    expect(fetches).toHaveLength(1);
    // A different URL loads a different model.
    await prepareCutoutModel("https://models.test/other.onnx");
    expect(fetches).toHaveLength(2);
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

  test("transparent input pixels count as white background", async () => {
    configure();
    const image = fakeImage(16, 16, (x, y) => (x >= 4 && x < 12 && y >= 4 && y < 12 ? [200, 40, 40, 255] : [0, 0, 0, 0]));
    const result = await cutSprite(image, { quality: "basic", modelUrl: "" });
    const png = await decodePng(result.png);
    expect(png.data.slice(0, 4)).toEqual([255, 255, 255, 0]);
    expect(result.bbox).toEqual([0.25, 0.25, 0.5, 0.5]);
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
});
