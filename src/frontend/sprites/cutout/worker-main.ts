/**
 * The cut-out "worker": decodes the image, runs the segmentation model with
 * onnxruntime-web (loaded lazily by URL), runs the kernel and encodes the PNG.
 *
 * `cutoutWorkerMain` is self-contained (no imports, no module-level values)
 * because its source text is shipped into a Worker built from a blob URL:
 *   `(${cutoutWorkerMain})(self, ${createCutoutKernel})`.
 * Without Worker support the same function runs on the main thread behind a
 * MessageChannel, so both paths share one implementation.
 */
import type { FaceCandidate, FaceKernel } from "./face-kernel.js";
import type { CutoutBBox, CutoutFigureCheck, CutoutKernel } from "./kernel.js";

export type CutoutBackend = "webgpu" | "wasm";
export type CutoutBackendPreference = "auto" | CutoutBackend;

export type CutoutLoadRequest = {
  id: number;
  type: "load";
  model: ArrayBuffer;
  /** Directory URL holding ort.*.min.mjs and the ort-wasm-*.wasm files (trailing slash). */
  ortBaseUrl: string;
  backend: CutoutBackendPreference;
  numThreads: number;
};

/** Load the face detector (always on WASM: it is small, and WebGPU memory stays for the cut-out). */
export type FaceLoadRequest = {
  id: number;
  type: "loadFace";
  model: ArrayBuffer;
  ortBaseUrl: string;
  numThreads: number;
  /** Lowest box score that counts as a face. */
  threshold: number;
};

export type CutoutWorkerRequest =
  | CutoutLoadRequest
  | FaceLoadRequest
  | { id: number; type: "cut"; image: Blob; useModel: boolean; detectFace?: boolean }
  | { id: number; type: "face"; image: Blob }
  | { id: number; type: "unload" }
  | { id: number; type: "unloadFace" };

export type CutoutLoadResult = { backend: CutoutBackend; inputSize: number; loadMs: number; notes: string[] };

export type FaceLoadResult = { backend: "wasm"; loadMs: number };

/** Face detection of one image: the chosen face (null: none found) and every box found. */
export type FaceDetectResult = { face: FaceCandidate | null; candidates: FaceCandidate[]; ms: number };

export type CutoutCutTimings = { decodeMs: number; modelMs: number; cutMs: number; encodeMs: number };

export type CutoutWorkerCutResult = {
  png: Blob;
  width: number;
  height: number;
  bbox: CutoutBBox;
  quality: "best" | "basic";
  /** Duplicate check on the cut-out alpha. */
  figures: CutoutFigureCheck;
  /** Set when the model was requested but could not run (the result is "basic"). */
  modelError: string | null;
  /** Face detection on the source image; absent when it was not asked for or could not run. */
  face?: FaceDetectResult;
  timings: CutoutCutTimings;
};

export type CutoutWorkerResponse =
  | { type: "hello" }
  | { type: "result"; id: number; ok: true; value: unknown }
  | { type: "result"; id: number; ok: false; error: string; code?: CutoutFailureCode };

/**
 * Why a load failed: "unsupported" (no WebAssembly), "runtime" (onnxruntime
 * could not be fetched; retryable), "session" (the model cannot run here:
 * out of memory, broken file).
 */
export type CutoutFailureCode = "unsupported" | "runtime" | "session";

export type CutoutPort = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

/** Largest image the cut-out accepts (pixels). */
export const CUTOUT_MAX_PIXELS = 4096 * 4096;

export function cutoutWorkerMain(port: CutoutPort, createKernel: () => CutoutKernel, createFace?: () => FaceKernel): void {
  const MAX_PIXELS = 4096 * 4096;
  const kernel = createKernel();
  const faceKernel = createFace ? createFace() : null;
  let faceSession: any = null;
  let faceOrt: OrtModule = null;
  let faceThreshold = 0.3;
  type OrtModule = any;
  const ortModules: Record<string, Promise<OrtModule> | undefined> = {};
  let session: any = null;
  let sessionOrt: OrtModule = null;
  let inputSize = 1024;
  const g = globalThis as any;

  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)) || "unknown error";
  const coded = (code: string, text: string): Error => Object.assign(new Error(text), { code });

  function importOrt(base: string, backend: "webgpu" | "wasm", numThreads: number): Promise<OrtModule> {
    // Any loaded bundle runs WASM too: the face detector reuses the cut-out's one.
    if (backend === "wasm" && !ortModules["ort.wasm.min.mjs"] && ortModules["ort.webgpu.min.mjs"]) return ortModules["ort.webgpu.min.mjs"]!;
    const file = backend === "webgpu" ? "ort.webgpu.min.mjs" : "ort.wasm.min.mjs";
    let pending = ortModules[file];
    if (!pending) {
      pending = (import(/* webpackIgnore: true */ base + file) as Promise<OrtModule>).then((ort) => {
        ort.env.wasm.wasmPaths = base;
        ort.env.wasm.numThreads = numThreads;
        ort.env.wasm.proxy = false;
        ort.env.logLevel = "error";
        return ort;
      });
      pending.catch(() => { delete ortModules[file]; });
      ortModules[file] = pending;
    }
    return pending;
  }

  async function release(): Promise<void> {
    const current = session;
    session = null;
    sessionOrt = null;
    if (current) { try { await current.release(); } catch { /* already gone */ } }
  }

  async function load(request: CutoutLoadRequest): Promise<CutoutLoadResult> {
    const started = performance.now();
    if (typeof WebAssembly !== "object") throw coded("unsupported", "This browser has no WebAssembly.");
    await release();
    const notes: string[] = [];
    const order: Array<"webgpu" | "wasm"> = [];
    if (request.backend !== "wasm") {
      let adapter: unknown = null;
      try { adapter = g.navigator && g.navigator.gpu ? await g.navigator.gpu.requestAdapter() : null; } catch (error) { notes.push("webgpu adapter: " + message(error)); }
      if (adapter) order.push("webgpu");
      else notes.push("webgpu: no adapter");
    }
    if (request.backend !== "webgpu") order.push("wasm");
    const bytes = new Uint8Array(request.model);
    const failures: string[] = [];
    let sessionFailed = false;
    for (const backend of order) {
      let ort: OrtModule;
      try {
        ort = await importOrt(request.ortBaseUrl, backend, request.numThreads);
      } catch (error) {
        failures.push(backend + " runtime: " + message(error));
        continue;
      }
      try {
        const created = await ort.InferenceSession.create(bytes, { executionProviders: [backend], graphOptimizationLevel: "all" });
        session = created;
        sessionOrt = ort;
        const meta = created.inputMetadata && created.inputMetadata[0];
        const shape = meta && Array.isArray(meta.shape) ? meta.shape : null;
        inputSize = shape && typeof shape[2] === "number" && shape[2] > 0 ? shape[2] : 1024;
        return { backend, inputSize, loadMs: performance.now() - started, notes: notes.concat(failures) };
      } catch (error) {
        sessionFailed = true;
        failures.push(backend + ": " + message(error));
      }
    }
    throw coded(sessionFailed ? "session" : "runtime", failures.length ? failures.join("; ") : "No usable backend.");
  }

  async function releaseFace(): Promise<void> {
    const current = faceSession;
    faceSession = null;
    faceOrt = null;
    if (current) { try { await current.release(); } catch { /* already gone */ } }
  }

  async function loadFace(request: FaceLoadRequest): Promise<FaceLoadResult> {
    const started = performance.now();
    if (typeof WebAssembly !== "object") throw coded("unsupported", "This browser has no WebAssembly.");
    if (!faceKernel) throw coded("unsupported", "No face detector in this worker.");
    await releaseFace();
    let ort: OrtModule;
    try {
      ort = await importOrt(request.ortBaseUrl, "wasm", request.numThreads);
    } catch (error) {
      throw coded("runtime", "wasm runtime: " + message(error));
    }
    try {
      faceSession = await ort.InferenceSession.create(new Uint8Array(request.model), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      faceOrt = ort;
    } catch (error) {
      throw coded("session", "wasm: " + message(error));
    }
    faceThreshold = request.threshold > 0 && request.threshold < 1 ? request.threshold : 0.3;
    return { backend: "wasm", loadMs: performance.now() - started };
  }

  async function detectFace(rgba: Uint8ClampedArray, width: number, height: number): Promise<FaceDetectResult> {
    const started = performance.now();
    const ort = faceOrt, current = faceSession;
    if (!current || !faceKernel) throw new Error("The face model is not loaded.");
    const input = faceKernel.faceInput(rgba, width, height, kernel.resizeBilinear);
    const tensor = new ort.Tensor("float32", input.tensor, [1, 3, input.height, input.width]);
    const feeds: Record<string, unknown> = {};
    feeds[current.inputNames[0]] = tensor;
    const outputs = await current.run(feeds);
    const output = outputs[current.outputNames[0]];
    const data: Float32Array = typeof output.getData === "function" ? await output.getData(true) : output.data;
    const dims: number[] = Array.isArray(output.dims) ? output.dims.map(Number) : [];
    for (const name of Object.keys(outputs)) { try { outputs[name].dispose(); } catch { /* cpu tensor */ } }
    const candidates = faceKernel.decode(data, dims, input, faceThreshold);
    return { face: faceKernel.pick(candidates), candidates: candidates.slice(0, 8), ms: performance.now() - started };
  }

  function makeCanvas(width: number, height: number): any {
    if (typeof g.OffscreenCanvas === "function") return new g.OffscreenCanvas(width, height);
    const canvas = g.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  async function decode(image: Blob): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
    const bitmap = await g.createImageBitmap(image, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const width = bitmap.width, height = bitmap.height;
    if (!width || !height || width * height > MAX_PIXELS) { bitmap.close(); throw new Error("Sprite image size " + width + "x" + height + " is not supported."); }
    const ctx = makeCanvas(width, height).getContext("2d", { willReadFrequently: true });
    if (!ctx) { bitmap.close(); throw new Error("No 2D canvas available."); }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const rgba: Uint8ClampedArray = ctx.getImageData(0, 0, width, height).data;
    // Like the reference (RGB), but a transparent source counts as white.
    for (let o = 3; o < rgba.length; o += 4) {
      const a = rgba[o]!;
      if (a === 255) continue;
      const k = (255 - a) * 255;
      rgba[o - 3] = (rgba[o - 3]! * a + k) / 255;
      rgba[o - 2] = (rgba[o - 2]! * a + k) / 255;
      rgba[o - 1] = (rgba[o - 1]! * a + k) / 255;
      rgba[o] = 255;
    }
    return { rgba, width, height };
  }

  async function encode(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
    const canvas = makeCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas available.");
    ctx.putImageData(new g.ImageData(rgba, width, height), 0, 0);
    if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type: "image/png" });
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob: Blob | null) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed."))), "image/png"));
  }

  async function infer(rgba: Uint8ClampedArray, width: number, height: number): Promise<Float32Array> {
    const ort = sessionOrt, current = session;
    const input = kernel.modelInput(rgba, width, height, inputSize);
    const tensor = new ort.Tensor("float32", input.tensor, [1, 3, inputSize, inputSize]);
    const feeds: Record<string, unknown> = {};
    feeds[current.inputNames[0]] = tensor;
    const outputs = await current.run(feeds);
    const output = outputs[current.outputNames[0]];
    const data: Float32Array = typeof output.getData === "function" ? await output.getData(true) : output.data;
    for (const name of Object.keys(outputs)) { try { outputs[name].dispose(); } catch { /* cpu tensor */ } }
    if (!data || data.length < inputSize * inputSize) throw new Error("Unexpected model output.");
    return kernel.modelMask(data, input, width, height);
  }

  async function cut(image: Blob, useModel: boolean, withFace: boolean): Promise<CutoutWorkerCutResult> {
    let t = performance.now();
    const { rgba, width, height } = await decode(image);
    const decodeMs = performance.now() - t;
    // On the source (white background): the cut changes rgba in place below.
    let face: FaceDetectResult | undefined;
    if (withFace && faceSession) {
      try { face = await detectFace(rgba, width, height); } catch { face = undefined; }
    }
    let mask: Float32Array | null = null;
    let modelError: string | null = null;
    t = performance.now();
    if (useModel) {
      if (!session) modelError = "The cut-out model is not loaded.";
      else {
        try { mask = await infer(rgba, width, height); } catch (error) { modelError = message(error); }
      }
    }
    const modelMs = performance.now() - t;
    t = performance.now();
    const result = kernel.cutoutPixels(rgba, width, height, mask);
    const cutMs = performance.now() - t;
    t = performance.now();
    const png = await encode(result.rgba, width, height);
    const encodeMs = performance.now() - t;
    return { png, width, height, bbox: result.bbox, quality: mask ? "best" : "basic", figures: result.figures, modelError, ...(face ? { face } : {}), timings: { decodeMs, modelMs, cutMs, encodeMs } };
  }

  async function face(image: Blob): Promise<FaceDetectResult> {
    if (!faceSession) throw new Error("The face model is not loaded.");
    const { rgba, width, height } = await decode(image);
    return detectFace(rgba, width, height);
  }

  // One request at a time, in arrival order.
  let chain: Promise<void> = Promise.resolve();
  port.onmessage = (event: MessageEvent) => {
    const request = event.data as CutoutWorkerRequest;
    if (!request || typeof request.id !== "number") return;
    chain = chain.then(async () => {
      try {
        let value: unknown;
        if (request.type === "load") value = await load(request);
        else if (request.type === "loadFace") value = await loadFace(request);
        else if (request.type === "cut") value = await cut(request.image, request.useModel, request.detectFace === true);
        else if (request.type === "face") value = await face(request.image);
        else if (request.type === "unloadFace") { await releaseFace(); value = null; }
        else { await release(); value = null; }
        port.postMessage({ type: "result", id: request.id, ok: true, value });
      } catch (error) {
        const code = error && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : undefined;
        port.postMessage({ type: "result", id: request.id, ok: false, error: message(error), ...(code ? { code } : {}) });
      }
    });
  };
  port.postMessage({ type: "hello" });
}
