/**
 * Plate depth in the browser (docs/SPRITE_MODE.md, "3D backgrounds"): the
 * depth map of a plate URL, estimated once in the depth worker and kept.
 *
 * Nothing loads up front. The first plate asks for the depth model
 * (DEFAULT_PLATE_DEPTH_MODEL_URL, downloaded once into the cut-out model
 * store) and onnxruntime-web from the cut-out runtime's base URL. Each depth
 * map is kept in memory for the page and in the same browser store, keyed
 * by the plate URL, so a plate is estimated once per browser. A failed
 * download or run is not tried again for PLATE_DEPTH_RETRY_MS; a browser
 * that cannot run the model at all is not asked again on that page.
 */
import { DEFAULT_PLATE_DEPTH_MODEL_URL } from "../../shared/sprites.js";
import { getCutoutRuntimeInfo } from "../sprites/cutout/index.js";
import { downloadModel, readCachedModel, writeCachedModel } from "../sprites/cutout/model-store.js";
import type { PlateDepthMap } from "./plate-depth-kernel.js";
import { startPlateDepthRunner, type PlateDepthRunner } from "./plate-depth-worker.js";

/** After a failure, plates stay flat this long before the model is tried again. */
export const PLATE_DEPTH_RETRY_MS = 60_000;
/** Depth maps kept in memory (about 180 KB each). */
const MEMORY_LIMIT = 12;
/** Stored depth: "CPD" + format version, u16 width, u16 height, then the bytes. */
const STORE_MAGIC = [0x43, 0x50, 0x44, 1] as const;

const memory = new Map<string, Promise<PlateDepthMap>>();
let modelUrl = DEFAULT_PLATE_DEPTH_MODEL_URL;
let runnerPromise: Promise<PlateDepthRunner> | null = null;
let model: { runner: PlateDepthRunner; promise: Promise<void> } | null = null;
let failure: { at: number; sticky: boolean; message: string } | null = null;

/** Browser-store key of a plate's depth (an http(s) URL, as Cache Storage wants). */
export function plateDepthStoreKey(url: string, base = typeof location !== "undefined" ? location.href : "http://localhost/"): string {
  const absolute = new URL(url, base);
  absolute.hash = "";
  absolute.searchParams.set("cue-plate-depth", String(STORE_MAGIC[3]));
  return absolute.href;
}

export function encodePlateDepth(map: PlateDepthMap): ArrayBuffer {
  const bytes = new Uint8Array(8 + map.depth.length);
  bytes.set(STORE_MAGIC, 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, map.width, true);
  view.setUint16(6, map.height, true);
  bytes.set(map.depth, 8);
  return bytes.buffer;
}

/** A stored depth map, or null when the bytes are not one (another format, cut short). */
export function decodePlateDepth(buffer: ArrayBuffer): PlateDepthMap | null {
  if (buffer.byteLength < 9) return null;
  const bytes = new Uint8Array(buffer);
  if (STORE_MAGIC.some((value, i) => bytes[i] !== value)) return null;
  const view = new DataView(buffer);
  const width = view.getUint16(4, true);
  const height = view.getUint16(6, true);
  if (!width || !height || bytes.length !== 8 + width * height) return null;
  return { width, height, depth: bytes.slice(8) };
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)) || "unknown error";

const defaultThreads = (): number => {
  const isolated = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 1;
  return isolated ? Math.max(1, Math.min(4, cores)) : 1;
};

async function getRunner(): Promise<PlateDepthRunner> {
  const current = runnerPromise ? await runnerPromise.catch(() => null) : null;
  if (current && !current.isClosed()) return current;
  runnerPromise = startPlateDepthRunner({ preferWorker: getCutoutRuntimeInfo().options.preferWorker });
  return runnerPromise;
}

async function ensureModel(): Promise<PlateDepthRunner> {
  if (typeof WebAssembly !== "object") {
    failure = { at: Date.now(), sticky: true, message: "This browser has no WebAssembly." };
    throw new Error(failure.message);
  }
  if (failure && (failure.sticky || Date.now() - failure.at < PLATE_DEPTH_RETRY_MS)) throw new Error(failure.message);
  const runner = await getRunner();
  if (model && model.runner === runner) {
    await model.promise;
    return runner;
  }
  const promise = (async () => {
    let stage: "download" | "load" = "download";
    try {
      let bytes = await readCachedModel(modelUrl);
      if (!bytes) {
        bytes = await downloadModel(modelUrl, () => {});
        if (bytes.byteLength < 1024) throw new Error("The downloaded depth model file is too small to be a model.");
        await writeCachedModel(modelUrl, bytes);
      }
      stage = "load";
      const options = getCutoutRuntimeInfo().options;
      await runner.load(bytes, { ortBaseUrl: options.ortBaseUrl, numThreads: options.numThreads > 0 ? options.numThreads : defaultThreads() });
      failure = null;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      failure = { at: Date.now(), sticky: stage === "load" && (code === "session" || code === "unsupported"), message: errorText(error) };
      throw error;
    }
  })();
  model = { runner, promise };
  promise.catch(() => { if (model?.promise === promise) model = null; });
  await promise;
  return runner;
}

async function estimate(url: string): Promise<PlateDepthMap> {
  const key = plateDepthStoreKey(url);
  const stored = await readCachedModel(key);
  const kept = stored ? decodePlateDepth(stored) : null;
  if (kept) return kept;
  let runner = await ensureModel();
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`The plate could not be read: HTTP ${response.status}.`);
  const image = await response.blob();
  let result;
  try {
    result = await runner.depth(image);
  } catch (error) {
    if (!runner.isClosed()) throw error;
    // The worker stopped (crashed, out of memory): load again and retry once.
    runner = await ensureModel();
    result = await runner.depth(image);
  }
  const map: PlateDepthMap = { width: result.width, height: result.height, depth: result.depth };
  void writeCachedModel(key, encodePlateDepth(map));
  return map;
}

/**
 * The depth map of a plate (0 = nearest .. 255 = farthest). Shared between
 * callers; rejects when the model cannot run (the plate stays flat).
 */
export function plateDepthFor(url: string): Promise<PlateDepthMap> {
  const hit = memory.get(url);
  if (hit) {
    // Most recently used last.
    memory.delete(url);
    memory.set(url, hit);
    return hit;
  }
  const promise = estimate(url);
  memory.set(url, promise);
  promise.catch(() => { if (memory.get(url) === promise) memory.delete(url); });
  while (memory.size > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
  return promise;
}

/** Use another copy of the model (tests serve it locally). */
export function configurePlateDepth(options: { modelUrl?: string }): void {
  if (options.modelUrl && options.modelUrl !== modelUrl) {
    modelUrl = options.modelUrl;
    resetPlateDepth();
  }
}

/** Stop the worker and forget everything kept in memory (tests, teardown). */
export function resetPlateDepth(): void {
  memory.clear();
  failure = null;
  model = null;
  const pending = runnerPromise;
  runnerPromise = null;
  void pending?.then((runner) => runner.terminate()).catch(() => {});
}
