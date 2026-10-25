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
 * For the default model a half-precision copy (half the download) is used
 * where it runs at full speed (`chooseCutoutModelUrl`).
 *
 * A source that is already transparent (the image workflow cut it) keeps its
 * own alpha: no model, no flood fill (`isPreCut` in the kernel).
 *
 * "studio" quality (opt-in, experimental) runs a BiRefNet model exported for
 * onnxruntime-web's WebGPU backend instead (docs/SPRITE_MODE.md, "Studio
 * cut-out"): ComfyUI-grade masks, about 0.8 s per sprite once loaded on the
 * GPU it was measured on, a 500 MB download from a URL the user sets. The
 * download runs in the background, never inside a cut (the backend times a
 * cut out after 5 minutes): "studio" cuts use Best until it is in the
 * browser, and a failed download is tried again after 1, 2 and 4 minutes,
 * then not on that page. It
 * needs WebGPU with half-precision shaders; where it cannot run, the cut uses
 * the "best" model and the model state says why. A Studio failure is not
 * tried again on the page, and is remembered on the device (studio-device.ts):
 * a tab that died loading the model or running its first cut is not retried
 * on every reload; settings ("Try Studio again") retry it.
 *
 * A small face detector (YOLOv8, see DEFAULT_SPRITE_FACE_MODEL_URL) runs in
 * the same worker, on WASM, to place emotes on the face. It loads on its own,
 * once, the first time a face is wanted ("best" and "studio" quality).
 */
import type { FaceBox } from "./face-kernel.js";
import type { CutoutInputFit } from "./kernel.js";
import { cachedModelBytes, deleteCachedModel, deleteCachedModels, downloadModel, readCachedModel, writeCachedModel } from "./model-store.js";
import { startCutoutRunner, type CutoutRunner, type CutoutRunnerMode } from "./runner.js";
import { clearStudioAttempt, forgetStudioFiles, readStudioAttempt, releaseStudioLock, replaceStudioFile, studioDeviceProblem, takeStudioLock, writeStudioAttempt } from "./studio-device.js";
import type { CutoutBackendPreference, CutoutCutTimings, CutoutLoadResult, CutoutWorkerCutResult } from "./worker-main.js";

/** "studio": the opt-in BiRefNet model (`studioModelUrl`); "best": ISNet-anime; "basic": no model. */
export type CutoutQuality = "studio" | "best" | "basic";

/**
 * `studio`: about the Studio model (the Best one otherwise). `note` (ready):
 * why "studio" cuts use the Best model instead. `notStored` (ready): the
 * browser would not store the model (storage full, private mode), so it
 * downloads again on the next visit.
 */
export type CutoutModelState =
  | { state: "absent" }
  | { state: "downloading"; receivedBytes: number; totalBytes: number | null; studio?: true }
  | { state: "loading"; studio?: true }
  | { state: "ready"; backend: "webgpu" | "wasm"; bytes: number; studio?: true; note?: string; notStored?: true }
  | { state: "unsupported"; reason: string; studio?: true }
  | { state: "error"; error: string; studio?: true };

export type CutoutResult = {
  png: Blob;
  width: number;
  height: number;
  /** Opaque bounding box, normalized 0..1: [x, y, width, height]. */
  bbox: [number, number, number, number];
  /** "best": a model made the mask (`studio`: the Studio model); "basic": no model could run. */
  quality: "best" | "basic";
  /** The Studio model made the mask. */
  studio?: true;
  /**
   * "studio" quality, cut with Best only because the Studio model was not
   * ready yet (downloading, or busy in another tab): worth one Studio re-cut
   * later (the backend's one-shot upgrade). Absent once the Studio model
   * cannot run on this page, without a Studio URL, and for other qualities.
   */
  provisional?: true;
  /**
   * Duplicate check: the mask looks like two figures side by side (see
   * `CutoutFigureCheck`). Precise (1% false positives) but finds only about
   * half of the duplicates.
   */
  twoFigures: boolean;
  /** Share of the checked rows that hold two wide opaque runs (0..1). */
  splitShare: number;
  /**
   * Scenery check: the cut kept scenery drawn behind the character (a wall,
   * disc, ring or floor band the mask calls background; see
   * `CutoutSceneryCheck`). Absent when there was no mask to check against
   * ("basic", or a pre-cut source).
   */
  scenery?: boolean;
  /** Share of the opaque pixels the scenery check counts as stray (0..1); absent with `scenery`. */
  sceneryShare?: number;
  /** Detected face, normalized to the image; null: none found; absent: not detected. */
  face?: FaceBox | null;
  /** The source was already transparent (cut by the image workflow) and kept its own alpha. */
  preCut?: true;
  durationMs: number;
  /** Where the time went (diagnostics). */
  timings?: CutoutCutTimings;
};

export type CutoutOptions = {
  quality: CutoutQuality;
  modelUrl: string;
  /**
   * Half-precision copy of the same model (half the download, same masks).
   * Used instead of `modelUrl` unless `modelUrl` is already cached or the GPU
   * runs WebGPU without half-precision shaders (there the full model keeps
   * WebGPU speed). See `chooseCutoutModelUrl`.
   */
  modelUrlF16?: string;
  /**
   * The Studio model for "studio" quality: BiRefNet exported for the browser
   * (half precision, 1024 px stretched input, normalisation and sigmoid in the
   * graph). Without it, or where it cannot run, "studio" cuts like "best".
   */
  studioModelUrl?: string;
  /** Also detect the face ("best" and "studio"). Failures leave `face` absent. */
  faceModelUrl?: string;
  signal?: AbortSignal;
};

export type FaceDetection = {
  /** Best face, normalized to the image, or null when none was found. */
  face: FaceBox | null;
  score: number | null;
  /** Boxes found (more than one: several faces or a false box). */
  count: number;
  durationMs: number;
};

/** onnxruntime-web version (matches the pinned devDependency; a unit test checks). */
export const ORT_VERSION = "1.30.0";
/** Pinned CDN directory for onnxruntime-web (ESM entry + .wasm), fetched only when the model runs. */
export const ORT_CDN_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
/** After a failed download, "best" cuts use "basic" for this long before trying again. */
export const CUTOUT_RETRY_MS = 60_000;
/** A failed background Studio download is tried again after this, doubling each time. */
export const STUDIO_DOWNLOAD_RETRY_MS = 60_000;
/** Studio download tries on one page before it gives up (settings retry). */
export const STUDIO_DOWNLOAD_ATTEMPTS = 4;

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
/** The background Studio download's progress, shown over `state` unless that is a download or load of its own. */
let overlay: CutoutModelState | null = null;
const listeners = new Set<(state: CutoutModelState) => void>();
let runnerPromise: Promise<CutoutRunner> | null = null;
type ModelFailure = { url: string; at: number; sticky: boolean; message: string };
/** How a cut-out model runs: ISNet letterboxes, on WebGPU or WASM; the Studio model stretches, on WebGPU only. */
type ModelSpec = { fit: CutoutInputFit; backend: CutoutBackendPreference | null; studio: boolean };
const BEST_SPEC: ModelSpec = { fit: "letterbox", backend: null, studio: false };
const STUDIO_SPEC: ModelSpec = { fit: "stretch", backend: "webgpu", studio: true };
/** One cut-out model is loaded at a time (the Best or the Studio one). */
let loaded: { url: string; runner: CutoutRunner; info: CutoutLoadResult; bytes: number; studio: boolean; notStored: boolean } | null = null;
let loading: { url: string; promise: Promise<void> } | null = null;
/** Last failure of the Best model, and of the Studio model (kept apart: a Studio failure must not stop Best). */
let failure: ModelFailure | null = null;
let studioFailure: ModelFailure | null = null;
/** Why "studio" cuts use the Best model, shown with its ready state. */
let studioNote: string | null = null;
/**
 * This page's Studio attempt: the device-wide marker it wrote before loading
 * the Studio model, cleared after the model's first good cut (`failed`: kept,
 * with the reason, so the next visit does not try it either).
 */
let studioAttempt: { url: string; failed: boolean } | null = null;
let pageHideWatched = false;
/** The Studio model's background download (one at a time). */
let studioDownload: { url: string; promise: Promise<boolean>; controller: AbortController } | null = null;
/** Failed Studio downloads on this page, for the backoff. */
let studioDownloadFailures: { url: string; count: number; at: number; message: string } | null = null;
/** A downloaded Studio file the browser would not store: kept until it loads (the load takes it). */
let studioMemory: { url: string; bytes: ArrayBuffer } | null = null;
/** The Studio model the settings want (`syncStudioCutout`; null: none); undefined until told. */
let studioWanted: string | null | undefined;
let generation = 0;
let runnerMode: CutoutRunnerMode | null = null;

/** Lowest score that counts as a face (true faces scored 0.80+ on 275 sprites; the model card F1 threshold is 0.278). */
export const FACE_SCORE_THRESHOLD = 0.5;
let faceState: CutoutModelState = { state: "absent" };
const faceListeners = new Set<(state: CutoutModelState) => void>();
let faceLoaded: { url: string; runner: CutoutRunner } | null = null;
let faceLoading: { url: string; promise: Promise<void> } | null = null;
let faceFailure: { url: string; at: number; sticky: boolean; message: string } | null = null;

function setFaceState(next: CutoutModelState): void {
  faceState = next;
  for (const listener of [...faceListeners]) {
    try { listener(next); } catch { /* a listener must not break detection */ }
  }
}

/** The loaded model changes; the device-wide Studio lock goes with the Studio model. */
function setLoaded(next: typeof loaded): void {
  if (loaded?.studio && !next?.studio) releaseStudioLock();
  loaded = next;
}

const visibleState = (): CutoutModelState => (overlay && state.state !== "downloading" && state.state !== "loading" ? overlay : state);

function publish(): void {
  const next = visibleState();
  for (const listener of [...listeners]) {
    try { listener(next); } catch { /* a listener must not break the cut-out */ }
  }
}

function setState(next: CutoutModelState): void {
  state = next;
  publish();
}

/** The loaded model's ready state (`note`: why "studio" cuts use this Best model). */
function readyState(model: NonNullable<typeof loaded>, note?: string | null): CutoutModelState {
  return {
    state: "ready",
    backend: model.info.backend,
    bytes: model.bytes,
    ...(model.studio ? { studio: true as const } : {}),
    ...(!model.studio && note ? { note } : {}),
    ...(model.notStored ? { notStored: true as const } : {}),
  };
}

function setOverlay(next: CutoutModelState | null): void {
  overlay = next;
  publish();
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
      setLoaded(null);
      if (state.state === "ready") setState({ state: "absent" });
    }
    if (faceLoaded && faceLoaded.runner === current) {
      faceLoaded = null;
      if (faceState.state === "ready") setFaceState({ state: "absent" });
    }
  }
  runnerPromise = startCutoutRunner({ preferWorker: runtime.preferWorker });
  const started = await runnerPromise;
  runnerMode = started.mode;
  return started;
}

/**
 * Stop a runner and forget its models: the next call starts a fresh worker,
 * and with it a fresh GPU device (after a Studio failure the old one may be
 * lost or out of memory).
 */
function retireRunner(runner: CutoutRunner): void {
  runner.terminate();
  if (loaded?.runner === runner) setLoaded(null);
  if (faceLoaded?.runner === runner) {
    faceLoaded = null;
    if (faceState.state === "ready") setFaceState({ state: "absent" });
  }
}

async function ensureModel(url: string, force: boolean, spec: ModelSpec = BEST_SPEC): Promise<void> {
  const setFailure = (next: ModelFailure): void => { if (spec.studio) studioFailure = next; else failure = next; };
  const tag = spec.studio ? { studio: true as const } : {};
  if (typeof WebAssembly !== "object") {
    const reason = "This browser has no WebAssembly.";
    setFailure({ url, at: Date.now(), sticky: true, message: reason });
    setState({ state: "unsupported", reason });
    throw new Error(reason);
  }
  const runner = await getRunner();
  if (loaded && loaded.url === url && loaded.runner === runner && !runner.isClosed()) return;
  if (loading && loading.url === url) return loading.promise;
  if (loading) await loading.promise.catch(() => {});
  const last = spec.studio ? studioFailure : failure;
  if (!force && last && last.url === url && (last.sticky || Date.now() - last.at < CUTOUT_RETRY_MS)) throw new Error(last.message);
  if (spec.studio) {
    // Checked before the download: the Studio model is 500 MB.
    const reason = await studioCannotRun();
    if (reason) {
      setFailure({ url, at: Date.now(), sticky: true, message: reason });
      throw new Error(reason);
    }
    // Never downloaded here (500 MB, inside a cut): `downloadStudio` runs in the background.
    if (studioMemory?.url !== url && !(await isCached(url))) throw new Error("The Studio model is not downloaded yet.");
    // One Studio session per device (about 3 GB of graphics memory each): another tab's comes first.
    if (!(await takeStudioLock())) throw new Error(STUDIO_BUSY);
    // Holding the lock, a marker this page did not write is from a visit that never finished.
    const earlier = force ? null : earlierStudioFailure(url);
    if (earlier) {
      releaseStudioLock();
      setFailure({ url, at: Date.now(), sticky: true, message: earlier });
      throw new Error(earlier);
    }
  }
  const gen = generation;
  const stale = (): boolean => gen !== generation;
  let promise: Promise<void> | null = null;
  promise = (async () => {
    let size = 0;
    let stage: "download" | "load" = "download";
    let deselected = false;
    let notStored = false;
    try {
      let bytes: ArrayBuffer | null;
      if (spec.studio && studioMemory?.url === url) {
        bytes = studioMemory.bytes;
        studioMemory = null;
        notStored = true;
      } else bytes = await readCachedModel(url);
      if (stale()) throw abortError();
      if (!bytes && spec.studio) throw new Error("The Studio model is no longer in this browser's storage.");
      if (!bytes) {
        setState({ state: "downloading", receivedBytes: 0, totalBytes: null });
        bytes = await downloadModel(url, (receivedBytes, totalBytes) => { if (!stale()) setState({ state: "downloading", receivedBytes, totalBytes }); });
        if (stale()) throw abortError();
        if (bytes.byteLength < 1024) throw new Error("The downloaded model file is too small to be a model.");
        notStored = !(await writeCachedModel(url, bytes)).stored;
        if (stale()) throw abortError();
      }
      size = bytes.byteLength;
      stage = "load";
      setState({ state: "loading", ...tag });
      const threads = runtime.numThreads > 0 ? runtime.numThreads : defaultThreads();
      // The previous model leaves the worker first (one session at a time).
      if (loaded && loaded.runner === runner) setLoaded(null);
      if (spec.studio) markStudioAttempt(url);
      const info = await runner.load(bytes, { ortBaseUrl: runtime.ortBaseUrl, backend: spec.backend ?? runtime.backend, numThreads: threads, fit: spec.fit });
      if (stale()) throw abortError();
      if (spec.studio && studioWanted !== undefined && studioWanted !== url) {
        // Deselected while it loaded: it leaves again (not a failure).
        deselected = true;
        void runner.unload().catch(() => {});
        studioAttemptDone(url);
        releaseStudioLock();
        setState({ state: "absent" });
        throw abortError();
      }
      setLoaded({ url, runner, info, bytes: size, studio: spec.studio, notStored });
      if (spec.studio) { studioFailure = null; studioNote = null; } else failure = null;
      // Best loaded while "studio" cannot run: its ready state says why.
      setState(readyState(loaded!, studioNote));
    } catch (error) {
      if (stale() || deselected) throw error;
      const code = (error as { code?: string } | null)?.code;
      const text = errorText(error);
      if (spec.studio && stage === "load") {
        // Any Studio load failure stands for the page and the device: the
        // worker may have died (out of memory), and the next try costs 500 MB.
        const reason = runner.isClosed()
          ? `The cut-out worker stopped while loading the Studio model (most likely out of memory): ${text}`
          : code === "session" || code === "unsupported"
            ? `The Studio model cannot run in this browser: ${text}`
            : `The Studio model could not start: ${text}`;
        setFailure({ url, at: Date.now(), sticky: true, message: reason });
        studioAttemptFailed(url, reason);
        releaseStudioLock();
        retireRunner(runner);
        setState({ state: "unsupported", reason, ...tag });
        throw new Error(reason);
      }
      if (spec.studio) releaseStudioLock();
      if (stage === "load" && (code === "session" || code === "unsupported")) {
        const reason = `The cut-out model cannot run in this browser: ${text}`;
        setFailure({ url, at: Date.now(), sticky: true, message: reason });
        setState({ state: "unsupported", reason, ...tag });
      } else {
        setFailure({ url, at: Date.now(), sticky: false, message: text });
        setState({ state: "error", error: text, ...tag });
      }
      throw error;
    } finally {
      if (loading && loading.promise === promise) loading = null;
    }
  })();
  loading = { url, promise };
  return promise;
}

type GpuLike = { requestAdapter(): Promise<{ features: { has(name: string): boolean }; isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } } | null> };
let gpuF16: Promise<boolean> | null = null;
const chosenUrls = new Map<string, string>();

/**
 * Can this browser run a half-precision model at full speed? False only when
 * WebGPU is there but lacks "shader-f16": onnxruntime-web then cannot build
 * the f16 session on the GPU and would fall back to WASM (about 100x slower),
 * while the full-precision model runs on WebGPU. Without WebGPU both models
 * run on WASM at the same speed.
 */
function halfPrecisionRuns(): Promise<boolean> {
  if (runtime.backend === "wasm") return Promise.resolve(true);
  gpuF16 ??= (async () => {
    const gpu = (globalThis as { navigator?: { gpu?: GpuLike } }).navigator?.gpu;
    if (!gpu) return true;
    try {
      const adapter = await gpu.requestAdapter();
      return !adapter || adapter.features.has("shader-f16");
    } catch {
      return true;
    }
  })();
  return gpuF16;
}

let studioCheck: Promise<string | null> | null = null;

/**
 * Why the Studio model cannot run here, or null. It is a half-precision
 * WebGPU model: without "shader-f16" onnxruntime-web cannot build it on the
 * GPU, and on WebAssembly it takes tens of seconds per sprite (23 s at half
 * size; at full size the browser passed 4.5 GB of RAM and was stopped).
 * Phones, devices that report under 8 GB of memory and software adapters are
 * not offered it (about 3 GB of graphics memory). WebGPU's limits are no
 * gate: the model ran with the default limits, masks identical to those with
 * the adapter's maximum buffer sizes.
 */
function studioCannotRun(): Promise<string | null> {
  if (runtime.backend === "wasm") return Promise.resolve("The Studio cut-out needs WebGPU; the cut-out is set to WebAssembly.");
  const device = studioDeviceProblem();
  if (device) return Promise.resolve(device);
  studioCheck ??= (async () => {
    const gpu = (globalThis as { navigator?: { gpu?: GpuLike } }).navigator?.gpu;
    if (!gpu) return "The Studio cut-out needs WebGPU, which this browser does not offer.";
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) return "The Studio cut-out needs WebGPU, and no graphics adapter is available to it.";
      if (adapter.info?.isFallbackAdapter === true || adapter.isFallbackAdapter === true) return "The Studio cut-out needs a graphics card; WebGPU only offers a software graphics adapter here.";
      if (!adapter.features.has("shader-f16")) return "The Studio cut-out needs half-precision WebGPU shaders (shader-f16), which this graphics adapter does not offer.";
      return null;
    } catch (error) {
      return `The Studio cut-out needs WebGPU: ${errorText(error)}`;
    }
  })();
  return studioCheck;
}

async function isCached(url: string): Promise<boolean> {
  try { return (await cachedModelBytes(url)) !== null; } catch { return false; }
}

/**
 * The model file to use: `url`, or its half-precision copy `f16Url` (half the
 * download, the same masks: cut alpha IoU 0.9999 on 58 sprites). A model
 * already in the browser cache stays in use (no second download); otherwise
 * the copy is picked unless the GPU cannot run it. Remembered per page.
 */
export async function chooseCutoutModelUrl(url: string, f16Url?: string): Promise<string> {
  if (!f16Url || f16Url === url) return url;
  const key = `${url}\n${f16Url}`;
  const known = chosenUrls.get(key);
  if (known) return known;
  const pick = (await isCached(url)) ? url : (await isCached(f16Url)) ? f16Url : (await halfPrecisionRuns()) ? f16Url : url;
  chosenUrls.set(key, pick);
  return pick;
}

async function ensureFaceModel(url: string, force: boolean): Promise<CutoutRunner> {
  if (typeof WebAssembly !== "object") {
    const reason = "This browser has no WebAssembly.";
    faceFailure = { url, at: Date.now(), sticky: true, message: reason };
    setFaceState({ state: "unsupported", reason });
    throw new Error(reason);
  }
  const runner = await getRunner();
  if (faceLoaded && faceLoaded.url === url && faceLoaded.runner === runner && !runner.isClosed()) return runner;
  if (faceLoading && faceLoading.url === url) { await faceLoading.promise; return ensureFaceModel(url, false); }
  if (faceLoading) await faceLoading.promise.catch(() => {});
  if (!force && faceFailure && faceFailure.url === url && (faceFailure.sticky || Date.now() - faceFailure.at < CUTOUT_RETRY_MS)) throw new Error(faceFailure.message);
  const gen = generation;
  const stale = (): boolean => gen !== generation;
  let promise: Promise<void> | null = null;
  promise = (async () => {
    let stage: "download" | "load" = "download";
    try {
      let bytes = await readCachedModel(url);
      if (stale()) throw abortError();
      if (!bytes) {
        setFaceState({ state: "downloading", receivedBytes: 0, totalBytes: null });
        bytes = await downloadModel(url, (receivedBytes, totalBytes) => { if (!stale()) setFaceState({ state: "downloading", receivedBytes, totalBytes }); });
        if (stale()) throw abortError();
        if (bytes.byteLength < 1024) throw new Error("The downloaded face model file is too small to be a model.");
        await writeCachedModel(url, bytes);
        if (stale()) throw abortError();
      }
      const size = bytes.byteLength;
      stage = "load";
      setFaceState({ state: "loading" });
      const threads = runtime.numThreads > 0 ? runtime.numThreads : defaultThreads();
      await runner.loadFace(bytes, { ortBaseUrl: runtime.ortBaseUrl, numThreads: threads, threshold: FACE_SCORE_THRESHOLD });
      if (stale()) throw abortError();
      faceLoaded = { url, runner };
      faceFailure = null;
      setFaceState({ state: "ready", backend: "wasm", bytes: size });
    } catch (error) {
      if (stale()) throw error;
      const code = (error as { code?: string } | null)?.code;
      const text = errorText(error);
      if (stage === "load" && (code === "session" || code === "unsupported")) {
        const reason = `The face model cannot run in this browser: ${text}`;
        faceFailure = { url, at: Date.now(), sticky: true, message: reason };
        setFaceState({ state: "unsupported", reason });
      } else {
        faceFailure = { url, at: Date.now(), sticky: false, message: text };
        setFaceState({ state: "error", error: text });
      }
      throw error;
    } finally {
      if (faceLoading && faceLoading.promise === promise) faceLoading = null;
    }
  })();
  faceLoading = { url, promise };
  await promise;
  return runner;
}

/** A Studio failure as the user reads it (download errors do not name the model). */
const studioReason = (text: string): string => (/Studio/.test(text) ? text : `The Studio model is not available: ${text}`);

const STUDIO_BUSY = "The Studio model is running in another Cue tab; this tab cuts with Best until that tab lets it go.";

/** The marker goes up before the Studio model loads; a normal page close takes it down. */
function markStudioAttempt(url: string): void {
  studioAttempt = { url, failed: false };
  writeStudioAttempt(url);
  if (pageHideWatched) return;
  const target = globalThis as { addEventListener?: (type: string, listener: () => void) => void };
  if (typeof target.addEventListener !== "function") return;
  pageHideWatched = true;
  // Closing or reloading the tab is not a crash (a dead tab sends no pagehide).
  target.addEventListener("pagehide", () => { if (studioAttempt && !studioAttempt.failed) { studioAttempt = null; clearStudioAttempt(); } });
}

/** The Studio model made its first good cut: the device has run it. */
function studioAttemptDone(url: string): void {
  if (studioAttempt?.url !== url || studioAttempt.failed) return;
  studioAttempt = null;
  clearStudioAttempt();
}

/** The page saw the Studio model fail: the next visit reads why. */
function studioAttemptFailed(url: string, reason: string): void {
  studioAttempt = { url, failed: true };
  writeStudioAttempt(url, reason);
}

/** Why `url` failed on an earlier visit to this device, or null (call while holding the Studio lock). */
function earlierStudioFailure(url: string): string | null {
  if (studioAttempt?.url === url) return null;
  const previous = readStudioAttempt();
  if (!previous || previous.url !== url) return null;
  return previous.reason
    ? `On an earlier visit: ${previous.reason} Try Studio again in Settings to retry.`
    : "The Studio model did not finish loading or its first cut on an earlier visit (the tab or its cut-out worker most likely ran out of memory). Try Studio again in Settings to retry.";
}

/**
 * The Studio model cannot run here: remember it (no retry this page, nor on
 * this device), and retire the runner that ran it so Best starts on a fresh
 * worker.
 */
function studioFailed(url: string, text: string, runner: CutoutRunner): void {
  studioFailure = { url, at: Date.now(), sticky: true, message: text };
  studioNote = text;
  studioAttemptFailed(url, text);
  retireRunner(runner);
  if (loaded?.studio) setLoaded(null);
  releaseStudioLock();
  setState({ state: "unsupported", reason: text, studio: true });
}

/** "studio" cuts run on the Best model: its ready state carries the reason. */
function showStudioNote(note: string | null): void {
  if (!note || !loaded || loaded.studio) return;
  if (state.state === "ready" && state.note === note) return;
  setState(readyState(loaded, note));
}

const studioRetryMs = (failures: number): number => STUDIO_DOWNLOAD_RETRY_MS * 2 ** (failures - 1);

/**
 * Download the Studio model in the background and store it in the browser
 * (or keep it in memory when the browser will not store it). Resolves true
 * when its bytes are ready, false when the download failed (counted for the
 * backoff, and given up for the page after STUDIO_DOWNLOAD_ATTEMPTS) or was
 * stopped. One download at a time; a second call for the same URL joins it.
 */
function downloadStudio(url: string): Promise<boolean> {
  if (studioDownload?.url === url) return studioDownload.promise;
  studioDownload?.controller.abort();
  const controller = new AbortController();
  const stopped = (): boolean => controller.signal.aborted;
  let promise: Promise<boolean> | null = null;
  promise = (async () => {
    setOverlay({ state: "downloading", receivedBytes: 0, totalBytes: null, studio: true });
    try {
      const bytes = await downloadModel(url, (receivedBytes, totalBytes) => { if (!stopped()) setOverlay({ state: "downloading", receivedBytes, totalBytes, studio: true }); }, controller.signal);
      if (stopped()) return false;
      if (bytes.byteLength < 1024) throw new Error("The downloaded model file is too small to be a model.");
      const write = await writeCachedModel(url, bytes);
      if (stopped()) return false;
      // One Studio file in the browser (about 500 MB each): an earlier URL's goes.
      if (write.stored) for (const old of replaceStudioFile(url)) await deleteCachedModel(old);
      studioMemory = write.stored ? null : { url, bytes };
      studioDownloadFailures = null;
      if (!studioFailure) studioNote = null;
      return true;
    } catch (error) {
      if (stopped()) return false;
      const count = (studioDownloadFailures?.url === url ? studioDownloadFailures.count : 0) + 1;
      const message = studioReason(errorText(error));
      studioDownloadFailures = { url, count, at: Date.now(), message };
      if (count >= STUDIO_DOWNLOAD_ATTEMPTS) {
        const text = `${message} Gave up after ${count} tries on this page; Try Studio again in Settings to retry.`;
        studioFailure = { url, at: Date.now(), sticky: true, message: text };
        studioNote = text;
      } else {
        studioNote = `${message} Trying again in ${Math.round(studioRetryMs(count) / 60_000)} min; sprites are cut with Best meanwhile.`;
      }
      return false;
    } finally {
      if (studioDownload?.promise === promise) studioDownload = null;
      if (!studioDownload) overlay = null;
      // Best's ready state carries the outcome (no note: the Studio model loads with the next sprite).
      if (loaded && !loaded.studio && state.state === "ready") setState(readyState(loaded, studioNote));
      else publish();
    }
  })();
  studioDownload = { url, promise, controller };
  return promise;
}

/** Stop the background Studio download (nothing is counted against it). */
function stopStudioDownload(): void {
  const current = studioDownload;
  studioDownload = null;
  current?.controller.abort();
  if (overlay) setOverlay(null);
}

/**
 * How a "studio" cut gets the Studio model: "load" (loaded, or its file is in
 * the browser or in memory: loading takes seconds), "later" (cut with Best
 * now: the download runs in the background, or waits for its next try), or
 * "no" (Best for this page; `studioNote` says why).
 */
async function studioForCut(url: string): Promise<"load" | "later" | "no"> {
  if (loaded?.studio && loaded.url === url && !loaded.runner.isClosed()) return "load";
  if (studioFailure?.url === url && studioFailure.sticky) {
    studioNote = studioReason(studioFailure.message);
    return "no";
  }
  const reason = await studioCannotRun();
  if (reason) {
    studioFailure = { url, at: Date.now(), sticky: true, message: reason };
    studioNote = reason;
    return "no";
  }
  if (studioMemory?.url === url || (await isCached(url))) return "load";
  if (studioDownload?.url === url) return "later";
  const failures = studioDownloadFailures?.url === url ? studioDownloadFailures : null;
  if (!failures || Date.now() - failures.at >= studioRetryMs(failures.count)) {
    studioNote = "The Studio model is downloading (about 500 MB); sprites are cut with Best until it is ready.";
    void downloadStudio(url);
  }
  return "later";
}

/**
 * Whether an encoded image can be transparent, from its header alone: a PNG
 * with an alpha channel or a tRNS chunk, or a WebP with alpha. A JPEG, a PNG
 * or WebP without alpha, or another format: false (the worker still checks
 * every image it cuts).
 */
export async function mayBeTransparent(image: Blob): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await image.slice(0, 65536).arrayBuffer());
  } catch {
    return false;
  }
  const ascii = (at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length));
  const u32 = (at: number): number => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
  if (bytes.length >= 33 && bytes[0] === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
    const colourType = bytes[25]!;
    if (colourType === 4 || colourType === 6) return true;
    // Grey, RGB or palette: transparent only with a tRNS chunk, which comes before the image data.
    for (let at = 33; at + 8 <= bytes.length; at += 12 + u32(at)) {
      const type = ascii(at + 4, 4);
      if (type === "tRNS") return true;
      if (type === "IDAT" || type === "IEND") return false;
    }
    return true; // Its chunks run past what was read: it may be.
  }
  if (bytes.length >= 25 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") return (bytes[20]! & 0x10) !== 0;
    if (chunk === "VP8L") return bytes[20] === 0x2f && ((bytes[24]! >> 4) & 1) === 1;
    return false; // Lossy "VP8 ": no alpha.
  }
  return false;
}

/** The cut-out result for the page from the worker's result. */
function cutoutResult(result: CutoutWorkerCutResult, studio: boolean, later: boolean, started: number): CutoutResult {
  return {
    png: result.png,
    width: result.width,
    height: result.height,
    bbox: result.bbox,
    quality: result.quality,
    ...(studio && result.quality === "best" && !result.preCut ? { studio: true as const } : {}),
    ...(later && !studio && result.quality === "best" && !result.preCut ? { provisional: true as const } : {}),
    twoFigures: result.figures?.twoFigures === true,
    splitShare: result.figures?.splitShare ?? 0,
    ...(result.scenery ? { scenery: result.scenery.scenery, sceneryShare: result.scenery.share } : {}),
    ...(result.face ? { face: result.face.face ? result.face.face.box : null } : {}),
    ...(result.preCut ? { preCut: true as const } : {}),
    durationMs: performance.now() - started,
    timings: result.timings,
  };
}

/**
 * A source that may be transparent, cut without a model first: the worker
 * keeps the alpha of one the image workflow already cut (null when it is
 * not one, or the worker stopped). Only the face model loads for it.
 */
async function cutPreCut(image: Blob, options: CutoutOptions, started: number): Promise<CutoutResult | null> {
  let withFace = false;
  if (options.faceModelUrl) {
    try {
      await ensureFaceModel(options.faceModelUrl, false);
      withFace = true;
    } catch {
      /* no face: the stage detects it later */
    }
  }
  throwIfAborted(options.signal);
  const runner = await getRunner();
  let result: CutoutWorkerCutResult;
  try {
    result = await runner.cut(image, false, withFace && faceLoaded?.runner === runner);
  } catch (error) {
    if (!runner.isClosed()) throw error;
    return null; // The cut with a model starts on a fresh worker.
  }
  if (!result.preCut) return null;
  throwIfAborted(options.signal);
  return cutoutResult(result, false, false, started);
}

/**
 * Cut one sprite. "best" downloads/loads the model on first use; when the
 * model cannot run the cut falls back to "basic" and says so in `quality`
 * (and the model state says why). "studio" does the same with the Studio
 * model, and falls back to "best" when that cannot run (`studio` in the
 * result says which model made the mask). A transparent source the image
 * workflow already cut keeps its alpha and loads no cut-out model (Studio
 * would start its download for nothing).
 */
export async function cutSprite(image: Blob, options: CutoutOptions): Promise<CutoutResult> {
  const started = performance.now();
  throwIfAborted(options.signal);
  syncStudioCutout(options.quality, options.studioModelUrl);
  const wantsModel = options.quality !== "basic";
  if (wantsModel && await mayBeTransparent(image)) {
    const preCut = await cutPreCut(image, options, started);
    if (preCut) return preCut;
  }
  let useModel = false;
  let studio = false;
  /** The Studio model may come later (see CutoutResult.provisional). */
  let later = false;
  let modelUrl = options.modelUrl;
  const useBest = async (): Promise<boolean> => {
    try {
      modelUrl = await chooseCutoutModelUrl(options.modelUrl, options.modelUrlF16);
      await ensureModel(modelUrl, false);
      if (options.quality === "studio") showStudioNote(studioNote ?? (options.studioModelUrl ? null : "No Studio model URL is set (Settings, Advanced)."));
      return true;
    } catch {
      return false; /* fall back to basic */
    }
  };
  if (options.quality === "studio" && options.studioModelUrl) {
    const url = options.studioModelUrl;
    const plan = await studioForCut(url);
    later = plan === "later";
    if (plan === "load") {
      try {
        await ensureModel(url, false, STUDIO_SPEC);
        modelUrl = url;
        useModel = studio = true;
      } catch (error) {
        // Deselected while it loaded: no note (the cut uses Best as asked).
        if ((error as { name?: string } | null)?.name !== "AbortError") studioNote = studioReason(errorText(error));
        later = studioNote === STUDIO_BUSY;
      }
    }
  }
  if (wantsModel && !useModel) useModel = await useBest();
  let withFace = false;
  if (wantsModel && options.faceModelUrl) {
    try {
      await ensureFaceModel(options.faceModelUrl, false);
      withFace = true;
    } catch {
      /* no face: the stage detects it later */
    }
  }
  throwIfAborted(options.signal);
  const withFaceOn = (on: CutoutRunner): boolean => withFace && faceLoaded?.runner === on;
  /** The worker died running Best: remember it for the page (the cuts go on without a model). */
  const bestCrashed = (url: string, error: unknown): void => {
    const text = `The cut-out worker stopped while running the model: ${errorText(error)}`;
    failure = { url, at: Date.now(), sticky: true, message: text };
    setState({ state: "unsupported", reason: text });
  };
  /**
   * Cut again after a failure: with Best when `withBest` and it loads (on the
   * fresh worker a Studio failure leaves), else without a model. A worker that
   * dies again here leaves a cut without a model on another fresh worker.
   */
  const cutAgain = async (withBest: boolean): Promise<CutoutWorkerCutResult> => {
    throwIfAborted(options.signal);
    const best = withBest && await useBest();
    if (best && withFace && options.faceModelUrl) {
      try { await ensureFaceModel(options.faceModelUrl, false); } catch { withFace = false; }
    }
    throwIfAborted(options.signal);
    const again = await getRunner();
    try {
      return await again.cut(image, best, best && withFaceOn(again));
    } catch (error) {
      if (!again.isClosed()) throw error;
      if (best) bestCrashed(modelUrl, error);
      throwIfAborted(options.signal);
      return (await getRunner()).cut(image, false);
    }
  };
  const runner = await getRunner();
  let result: CutoutWorkerCutResult;
  try {
    result = await runner.cut(image, useModel, withFaceOn(runner));
  } catch (error) {
    if (!runner.isClosed()) throw error;
    // The worker died mid-cut (most likely out of memory in the model): retry once
    // without it ("studio": with the Best model).
    if (studio) studioFailed(modelUrl, `The cut-out worker stopped while running the Studio model: ${errorText(error)}`, runner);
    else if (useModel) bestCrashed(modelUrl, error);
    const again = studio;
    studio = false;
    result = await cutAgain(again);
  }
  if (result.modelError && studio) {
    // The Studio model loaded but could not run (GPU memory): cut again with Best.
    studioFailed(modelUrl, `The Studio model could not run: ${result.modelError}`, runner);
    studio = false;
    result = await cutAgain(true);
  }
  // A source that turns out cut (its header did not tell) ends the Studio attempt too: the model loaded.
  if (studio && result.quality === "best" && !result.modelError) studioAttemptDone(modelUrl);
  if (result.modelError && loaded?.url === modelUrl) {
    failure = { url: modelUrl, at: Date.now(), sticky: false, message: result.modelError };
    setLoaded(null);
    setState({ state: "error", error: result.modelError });
  }
  throwIfAborted(options.signal);
  return cutoutResult(result, studio, later, started);
}

/**
 * Detect the face of one sprite image (a cut-out counts as on white). Loads
 * the face model on first use (once, cached in the browser). Throws when
 * the model cannot run; `face` null means the model found no face.
 */
export async function detectSpriteFace(image: Blob, options: { modelUrl: string; signal?: AbortSignal }): Promise<FaceDetection> {
  const started = performance.now();
  throwIfAborted(options.signal);
  let runner = await ensureFaceModel(options.modelUrl, false);
  throwIfAborted(options.signal);
  let result;
  try {
    result = await runner.face(image);
  } catch (error) {
    if (!runner.isClosed()) throw error;
    // The worker stopped (another job crashed it): load again and retry once.
    faceLoaded = null;
    throwIfAborted(options.signal);
    runner = await ensureFaceModel(options.modelUrl, false);
    result = await runner.face(image);
  }
  throwIfAborted(options.signal);
  return {
    face: result.face ? result.face.box : null,
    score: result.face ? result.face.score : null,
    count: result.candidates.length,
    durationMs: performance.now() - started,
  };
}

export function getFaceModelState(): CutoutModelState {
  return faceState;
}

/** Subscribe to face model state changes; returns an unsubscribe function. */
export function onFaceModelState(listener: (state: CutoutModelState) => void): () => void {
  faceListeners.add(listener);
  return () => { faceListeners.delete(listener); };
}

/** Download (once) and load the face model ahead of time. */
export async function prepareFaceModel(modelUrl: string): Promise<void> {
  await ensureFaceModel(modelUrl, true);
}

/** Size in bytes of the face model cached for `modelUrl`, or null. */
export async function getCachedFaceModelBytes(modelUrl: string): Promise<number | null> {
  return cachedModelBytes(modelUrl);
}

export function getCutoutModelState(): CutoutModelState {
  return visibleState();
}

/** Subscribe to model state changes; returns an unsubscribe function. */
export function onCutoutModelState(listener: (state: CutoutModelState) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Download (once, cached in the browser) and load the model ahead of time (`modelUrlF16`: see CutoutOptions). */
export async function prepareCutoutModel(modelUrl: string, modelUrlF16?: string): Promise<void> {
  await ensureModel(await chooseCutoutModelUrl(modelUrl, modelUrlF16), true);
}

/**
 * Download (once, cached in the browser) and load the Studio model ahead of
 * time; also settings' "Try Studio again" (it forgets an earlier failure on
 * this page and device). Throws, before any download, where it cannot run
 * (see `getStudioCutoutSupport`).
 */
export async function prepareStudioCutoutModel(studioModelUrl: string): Promise<void> {
  studioWanted = studioModelUrl;
  if (studioFailure?.url === studioModelUrl) studioFailure = null;
  if (studioDownloadFailures?.url === studioModelUrl) studioDownloadFailures = null;
  studioNote = null;
  if (!studioAttempt || studioAttempt.url !== studioModelUrl || studioAttempt.failed) {
    studioAttempt = null;
    clearStudioAttempt();
  }
  try {
    const reason = await studioCannotRun();
    if (reason) throw new Error(reason);
    if (studioMemory?.url !== studioModelUrl && !(await isCached(studioModelUrl)) && !(await downloadStudio(studioModelUrl))) {
      throw studioDownloadFailures?.url === studioModelUrl ? new Error(studioDownloadFailures.message) : abortError();
    }
    await ensureModel(studioModelUrl, true, STUDIO_SPEC);
  } catch (error) {
    studioNote = studioReason(errorText(error));
    if (state.state !== "unsupported" && state.state !== "error") setState({ state: "unsupported", reason: studioNote, studio: true });
    throw error;
  }
}

/** Why the Studio model cannot run in this browser (no download needed to tell), or null. */
export function getStudioCutoutSupport(): Promise<string | null> {
  return studioCannotRun();
}

/**
 * The cut-out settings changed (cuts call it too): when the Studio model is
 * no longer wanted (another quality, another or no Studio URL) it leaves the
 * worker and the device-wide lock (about 3 GB of graphics memory), its
 * background download stops, and its note and failure state go.
 */
export function syncStudioCutout(quality: CutoutQuality, studioModelUrl = ""): void {
  const wanted = quality === "studio" && studioModelUrl ? studioModelUrl : null;
  const changed = wanted !== studioWanted;
  studioWanted = wanted;
  if (studioDownload && studioDownload.url !== wanted) stopStudioDownload();
  if (studioMemory && studioMemory.url !== wanted) studioMemory = null;
  if (loaded?.studio && loaded.url !== wanted) {
    const current = loaded;
    setLoaded(null);
    if (!current.runner.isClosed()) void current.runner.unload().catch(() => {});
    studioAttemptDone(current.url);
    setState({ state: "absent" });
  }
  if (!changed) return;
  if (studioAttempt && studioAttempt.url !== wanted) studioAttemptDone(studioAttempt.url);
  studioNote = null;
  if ("studio" in state && state.studio && state.state !== "loading") setState({ state: "absent" });
  else if (state.state === "ready" && state.note && loaded && !loaded.studio) setState(readyState(loaded));
}

/** Forget the cached models, the face model too (settings "Remove downloaded model"). */
export async function clearCutoutModel(): Promise<void> {
  generation++;
  loading = null;
  failure = null;
  studioFailure = null;
  studioNote = null;
  studioAttempt = null;
  clearStudioAttempt();
  stopStudioDownload();
  studioDownloadFailures = null;
  studioMemory = null;
  setLoaded(null);
  releaseStudioLock();
  faceLoading = null;
  faceFailure = null;
  faceLoaded = null;
  // Whatever the worker holds goes, also a model this page no longer tracks.
  const live = runnerPromise ? await runnerPromise.catch(() => null) : null;
  if (live && !live.isClosed()) {
    await live.unload().catch(() => {});
    await live.unloadFace().catch(() => {});
  }
  chosenUrls.clear();
  await deleteCachedModels();
  forgetStudioFiles();
  if (state.state !== "unsupported" || typeof WebAssembly === "object") setState({ state: "absent" });
  if (faceState.state !== "unsupported" || typeof WebAssembly === "object") setFaceState({ state: "absent" });
}

/**
 * Size in bytes of the model cached for `modelUrl` (or its half-precision
 * copy `modelUrlF16`), or null. Lets settings show "downloaded" before the
 * model is loaded in this page.
 */
export async function getCachedCutoutModelBytes(modelUrl: string, modelUrlF16?: string): Promise<number | null> {
  const bytes = await cachedModelBytes(modelUrl);
  if (bytes !== null || !modelUrlF16 || modelUrlF16 === modelUrl) return bytes;
  return cachedModelBytes(modelUrlF16);
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
  gpuF16 = null;
  studioCheck = null;
  chosenUrls.clear();
  loading = null;
  failure = null;
  studioFailure = null;
  studioNote = null;
  studioAttempt = null;
  studioDownload?.controller.abort();
  studioDownload = null;
  studioDownloadFailures = null;
  studioMemory = null;
  studioWanted = undefined;
  overlay = null;
  loaded = null;
  releaseStudioLock();
  faceLoading = null;
  faceFailure = null;
  faceLoaded = null;
  const pending = runnerPromise;
  runnerPromise = null;
  void pending?.then((runner) => runner.terminate(), () => {});
  setState({ state: "absent" });
  setFaceState({ state: "absent" });
}
