/**
 * Browser sprite cut-out: removes the plain (white) background from a
 * generated sprite and returns a transparent PNG.
 *
 * Pipeline (validated in the sprite bake-off, see docs/SPRITE_MODE.md):
 *   1. segmentation mask from ISNet-anime (onnxruntime-web, WebGPU -> WASM),
 *   2. border flood fill over background-coloured pixels for sharp edges,
 *      guarded by the mask (no leaks into white clothes or hair),
 *   3. enclosed background holes the mask calls background are removed,
 *   4. separate specks the mask calls background are removed,
 *   5. defringe: the background colour is un-mixed from soft edge pixels.
 * "basic" quality skips the model (steps 2 and 5 only).
 *
 * Nothing heavy loads up front: the worker starts on the first cut, and
 * onnxruntime-web (pinned, from ORT_CDN_BASE) plus the model load only when
 * "best" quality or a model download is requested. The model is cached in
 * the browser (Cache Storage, or IndexedDB on insecure origins), keyed by URL.
 */
import { cachedModelBytes, deleteCachedModels, downloadModel, readCachedModel, writeCachedModel } from "./model-store.js";
import { startCutoutRunner, type CutoutRunner, type CutoutRunnerMode } from "./runner.js";
import type { CutoutBackendPreference, CutoutCutTimings, CutoutLoadResult } from "./worker-main.js";

export type CutoutQuality = "best" | "basic";

export type CutoutModelState =
  | { state: "absent" }
  | { state: "downloading"; receivedBytes: number; totalBytes: number | null }
  | { state: "loading" }
  | { state: "ready"; backend: "webgpu" | "wasm"; bytes: number }
  | { state: "unsupported"; reason: string }
  | { state: "error"; error: string };

export type CutoutResult = {
  png: Blob;
  width: number;
  height: number;
  /** Opaque bounding box, normalized 0..1: [x, y, width, height]. */
  bbox: [number, number, number, number];
  quality: CutoutQuality;
  /**
   * Duplicate check: the mask looks like two figures side by side (see
   * `CutoutFigureCheck`). Precise (1% false positives) but finds only about
   * half of the duplicates.
   */
  twoFigures: boolean;
  /** Share of the checked rows that hold two wide opaque runs (0..1). */
  splitShare: number;
  durationMs: number;
  /** Where the time went (diagnostics). */
  timings?: CutoutCutTimings;
};

export type CutoutOptions = {
  quality: CutoutQuality;
  modelUrl: string;
  signal?: AbortSignal;
};

/** onnxruntime-web version (matches the pinned devDependency; a unit test checks). */
export const ORT_VERSION = "1.30.0";
/** Pinned CDN directory for onnxruntime-web (ESM entry + .wasm), fetched only when the model runs. */
export const ORT_CDN_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
/** After a failed download, "best" cuts use "basic" for this long before trying again. */
export const CUTOUT_RETRY_MS = 60_000;

export type CutoutRuntimeOptions = {
  /** Directory URL with ort.*.min.mjs and ort-wasm-*.wasm (trailing slash). */
  ortBaseUrl: string;
  backend: CutoutBackendPreference;
  /** WASM threads; >1 needs a cross-origin isolated page. */
  numThreads: number;
  /** Run off the main thread (falls back to inline when a Worker cannot start). */
  preferWorker: boolean;
};

const defaultThreads = (): number => {
  const isolated = typeof globalThis !== "undefined" && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 1;
  return isolated ? Math.max(1, Math.min(4, cores)) : 1;
};

let runtime: CutoutRuntimeOptions = { ortBaseUrl: ORT_CDN_BASE, backend: "auto", numThreads: 0, preferWorker: true };
let state: CutoutModelState = { state: "absent" };
const listeners = new Set<(state: CutoutModelState) => void>();
let runnerPromise: Promise<CutoutRunner> | null = null;
let loaded: { url: string; runner: CutoutRunner; info: CutoutLoadResult } | null = null;
let loading: { url: string; promise: Promise<void> } | null = null;
let failure: { url: string; at: number; sticky: boolean; message: string } | null = null;
let generation = 0;
let runnerMode: CutoutRunnerMode | null = null;

function setState(next: CutoutModelState): void {
  state = next;
  for (const listener of [...listeners]) {
    try { listener(next); } catch { /* a listener must not break the cut-out */ }
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)) || "unknown error";

function abortError(): Error {
  return typeof DOMException === "function" ? new DOMException("The cut-out was aborted.", "AbortError") : Object.assign(new Error("The cut-out was aborted."), { name: "AbortError" });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

async function getRunner(): Promise<CutoutRunner> {
  if (runnerPromise) {
    const current = await runnerPromise.catch(() => null);
    if (current && !current.isClosed()) return current;
    runnerPromise = null;
    if (loaded && loaded.runner === current) {
      loaded = null;
      if (state.state === "ready") setState({ state: "absent" });
    }
  }
  runnerPromise = startCutoutRunner({ preferWorker: runtime.preferWorker });
  const started = await runnerPromise;
  runnerMode = started.mode;
  return started;
}

async function ensureModel(url: string, force: boolean): Promise<void> {
  if (typeof WebAssembly !== "object") {
    const reason = "This browser has no WebAssembly.";
    failure = { url, at: Date.now(), sticky: true, message: reason };
    setState({ state: "unsupported", reason });
    throw new Error(reason);
  }
  const runner = await getRunner();
  if (loaded && loaded.url === url && loaded.runner === runner && !runner.isClosed()) return;
  if (loading && loading.url === url) return loading.promise;
  if (loading) await loading.promise.catch(() => {});
  if (!force && failure && failure.url === url && (failure.sticky || Date.now() - failure.at < CUTOUT_RETRY_MS)) throw new Error(failure.message);
  const gen = generation;
  const stale = (): boolean => gen !== generation;
  let promise: Promise<void> | null = null;
  promise = (async () => {
    let size = 0;
    let stage: "download" | "load" = "download";
    try {
      let bytes = await readCachedModel(url);
      if (stale()) throw abortError();
      if (!bytes) {
        setState({ state: "downloading", receivedBytes: 0, totalBytes: null });
        bytes = await downloadModel(url, (receivedBytes, totalBytes) => { if (!stale()) setState({ state: "downloading", receivedBytes, totalBytes }); });
        if (stale()) throw abortError();
        if (bytes.byteLength < 1024) throw new Error("The downloaded model file is too small to be a model.");
        await writeCachedModel(url, bytes);
        if (stale()) throw abortError();
      }
      size = bytes.byteLength;
      stage = "load";
      setState({ state: "loading" });
      const threads = runtime.numThreads > 0 ? runtime.numThreads : defaultThreads();
      const info = await runner.load(bytes, { ortBaseUrl: runtime.ortBaseUrl, backend: runtime.backend, numThreads: threads });
      if (stale()) throw abortError();
      loaded = { url, runner, info };
      failure = null;
      setState({ state: "ready", backend: info.backend, bytes: size });
    } catch (error) {
      if (stale()) throw error;
      const code = (error as { code?: string } | null)?.code;
      const text = errorText(error);
      if (stage === "load" && (code === "session" || code === "unsupported")) {
        const reason = `The cut-out model cannot run in this browser: ${text}`;
        failure = { url, at: Date.now(), sticky: true, message: reason };
        setState({ state: "unsupported", reason });
      } else {
        failure = { url, at: Date.now(), sticky: false, message: text };
        setState({ state: "error", error: text });
      }
      throw error;
    } finally {
      if (loading && loading.promise === promise) loading = null;
    }
  })();
  loading = { url, promise };
  return promise;
}

/**
 * Cut one sprite. "best" downloads/loads the model on first use; when the
 * model cannot run the cut falls back to "basic" and says so in `quality`
 * (and the model state says why).
 */
export async function cutSprite(image: Blob, options: CutoutOptions): Promise<CutoutResult> {
  const started = performance.now();
  throwIfAborted(options.signal);
  let useModel = false;
  if (options.quality === "best") {
    try {
      await ensureModel(options.modelUrl, false);
      useModel = true;
    } catch {
      /* fall back to basic */
    }
  }
  throwIfAborted(options.signal);
  let runner = await getRunner();
  let result;
  try {
    result = await runner.cut(image, useModel);
  } catch (error) {
    if (!runner.isClosed()) throw error;
    // The worker died mid-cut (most likely out of memory in the model): retry once without it.
    if (useModel) {
      const text = `The cut-out worker stopped while running the model: ${errorText(error)}`;
      failure = { url: options.modelUrl, at: Date.now(), sticky: true, message: text };
      setState({ state: "unsupported", reason: text });
    }
    throwIfAborted(options.signal);
    runner = await getRunner();
    result = await runner.cut(image, false);
  }
  if (result.modelError) {
    failure = { url: options.modelUrl, at: Date.now(), sticky: false, message: result.modelError };
    loaded = null;
    setState({ state: "error", error: result.modelError });
  }
  throwIfAborted(options.signal);
  return {
    png: result.png,
    width: result.width,
    height: result.height,
    bbox: result.bbox,
    quality: result.quality,
    twoFigures: result.figures?.twoFigures === true,
    splitShare: result.figures?.splitShare ?? 0,
    durationMs: performance.now() - started,
    timings: result.timings,
  };
}

export function getCutoutModelState(): CutoutModelState {
  return state;
}

/** Subscribe to model state changes; returns an unsubscribe function. */
export function onCutoutModelState(listener: (state: CutoutModelState) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Download (once, cached in the browser) and load the model ahead of time. */
export async function prepareCutoutModel(modelUrl: string): Promise<void> {
  await ensureModel(modelUrl, true);
}

/** Forget the cached model (settings "Remove downloaded model"). */
export async function clearCutoutModel(): Promise<void> {
  generation++;
  loading = null;
  failure = null;
  const current = loaded;
  loaded = null;
  if (current && !current.runner.isClosed()) await current.runner.unload().catch(() => {});
  await deleteCachedModels();
  if (state.state !== "unsupported" || typeof WebAssembly === "object") setState({ state: "absent" });
}

/**
 * Size in bytes of the model cached for `modelUrl`, or null. Lets settings
 * show "downloaded" before the model is loaded in this page.
 */
export async function getCachedCutoutModelBytes(modelUrl: string): Promise<number | null> {
  return cachedModelBytes(modelUrl);
}

/** Override runtime options (tests, self-hosted onnxruntime-web). */
export function configureCutoutRuntime(options: Partial<CutoutRuntimeOptions>): void {
  runtime = { ...runtime, ...options };
}

/** Diagnostics: how the cut-out runs right now. */
export function getCutoutRuntimeInfo(): { runner: CutoutRunnerMode | null; model: (CutoutLoadResult & { url: string }) | null; options: CutoutRuntimeOptions } {
  return {
    runner: runnerMode,
    model: loaded ? { ...loaded.info, url: loaded.url } : null,
    options: { ...runtime },
  };
}

/** Diagnostics: the runner mode, starting the runner if needed. */
export async function getCutoutRunnerMode(): Promise<CutoutRunnerMode> {
  return (await getRunner()).mode;
}

/** Stop the worker and forget the loaded model (keeps the cache). For tests and teardown. */
export function resetCutoutRuntime(): void {
  generation++;
  loading = null;
  failure = null;
  loaded = null;
  const pending = runnerPromise;
  runnerPromise = null;
  void pending?.then((runner) => runner.terminate(), () => {});
  setState({ state: "absent" });
}
