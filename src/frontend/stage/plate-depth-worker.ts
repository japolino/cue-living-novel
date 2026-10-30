/**
 * The plate depth "worker" (docs/SPRITE_MODE.md, "3D backgrounds"): decodes
 * a plate, runs the depth model with onnxruntime-web (WASM, loaded lazily by
 * URL) and returns the depth map.
 *
 * `plateDepthWorkerMain` is self-contained (no imports, no module-level
 * values) because its source text is shipped into a Worker built from a blob
 * URL, like the cut-out worker. Without Worker support the same function
 * runs on the main thread behind a MessageChannel.
 */
import { createPlateDepthKernel, PLATE_DEPTH_INPUT, PLATE_DEPTH_MAX_WIDTH, type PlateDepthKernel, type PlateDepthMap } from "./plate-depth-kernel.js";

export type PlateDepthLoadRequest = {
  id: number;
  type: "load";
  model: ArrayBuffer;
  /** Directory URL holding ort.wasm.min.mjs and the ort-wasm-*.wasm files (trailing slash). */
  ortBaseUrl: string;
  numThreads: number;
};

export type PlateDepthWorkerRequest =
  | PlateDepthLoadRequest
  | { id: number; type: "depth"; image: Blob; inputSize: number; maxWidth: number }
  | { id: number; type: "unload" };

export type PlateDepthLoadResult = { loadMs: number };
export type PlateDepthResult = PlateDepthMap & { ms: number };

export type PlateDepthWorkerResponse =
  | { type: "hello" }
  | { type: "result"; id: number; ok: true; value: unknown }
  | { type: "result"; id: number; ok: false; error: string; code?: string };

export type PlateDepthPort = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

export function plateDepthWorkerMain(port: PlateDepthPort, createKernel: () => PlateDepthKernel): void {
  const MAX_PIXELS = 4096 * 4096;
  const kernel = createKernel();
  const g = globalThis as any;
  let ortModule: Promise<any> | null = null;
  let ort: any = null;
  let session: any = null;

  const message = (error: unknown): string => (error instanceof Error ? error.message : String(error)) || "unknown error";
  const coded = (code: string, text: string): Error => Object.assign(new Error(text), { code });

  function importOrt(base: string, numThreads: number): Promise<any> {
    if (!ortModule) {
      ortModule = (import(/* webpackIgnore: true */ base + "ort.wasm.min.mjs") as Promise<any>).then((loaded) => {
        loaded.env.wasm.wasmPaths = base;
        loaded.env.wasm.numThreads = numThreads;
        loaded.env.wasm.proxy = false;
        loaded.env.logLevel = "error";
        return loaded;
      });
      ortModule.catch(() => { ortModule = null; });
    }
    return ortModule;
  }

  async function release(): Promise<void> {
    const current = session;
    session = null;
    if (current) { try { await current.release(); } catch { /* already gone */ } }
  }

  async function load(request: PlateDepthLoadRequest): Promise<{ loadMs: number }> {
    const started = performance.now();
    if (typeof WebAssembly !== "object") throw coded("unsupported", "This browser has no WebAssembly.");
    await release();
    try {
      ort = await importOrt(request.ortBaseUrl, request.numThreads);
    } catch (error) {
      throw coded("runtime", "wasm runtime: " + message(error));
    }
    try {
      session = await ort.InferenceSession.create(new Uint8Array(request.model), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    } catch (error) {
      throw coded("session", "wasm: " + message(error));
    }
    return { loadMs: performance.now() - started };
  }

  function makeCanvas(width: number, height: number): any {
    if (typeof g.OffscreenCanvas === "function") return new g.OffscreenCanvas(width, height);
    const canvas = g.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  async function depth(image: Blob, target: number, maxWidth: number): Promise<PlateDepthMap & { ms: number }> {
    const started = performance.now();
    if (!session) throw new Error("The depth model is not loaded.");
    const bitmap = await g.createImageBitmap(image);
    const width = bitmap.width, height = bitmap.height;
    if (!width || !height || width * height > MAX_PIXELS) { bitmap.close(); throw new Error("Plate size " + width + "x" + height + " is not supported."); }
    const size = kernel.inputSize(width, height, target);
    const ctx = makeCanvas(size.width, size.height).getContext("2d", { willReadFrequently: true });
    if (!ctx) { bitmap.close(); throw new Error("No 2D canvas available."); }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const rgba = ctx.getImageData(0, 0, size.width, size.height).data;
    const tensor = new ort.Tensor("float32", kernel.modelInput(rgba, size.width, size.height), [1, 3, size.height, size.width]);
    const feeds: Record<string, unknown> = {};
    feeds[session.inputNames[0]] = tensor;
    const outputs = await session.run(feeds);
    const output = outputs[session.outputNames[0]];
    const data: Float32Array = typeof output.getData === "function" ? await output.getData(true) : output.data;
    const dims: number[] = Array.isArray(output.dims) ? output.dims.map(Number) : [];
    for (const name of Object.keys(outputs)) { try { outputs[name].dispose(); } catch { /* cpu tensor */ } }
    // [1, H, W] (or [H, W]): the model keeps the input size.
    const outH = dims.length >= 2 ? dims[dims.length - 2]! : size.height;
    const outW = dims.length >= 1 ? dims[dims.length - 1]! : size.width;
    if (!data || data.length < outW * outH) throw new Error("Unexpected model output.");
    const map = kernel.depthMap(data, outW, outH, maxWidth);
    return { ...map, ms: performance.now() - started };
  }

  // One request at a time, in arrival order.
  let chain: Promise<void> = Promise.resolve();
  port.onmessage = (event: MessageEvent) => {
    const request = event.data as PlateDepthWorkerRequest;
    if (!request || typeof request.id !== "number") return;
    chain = chain.then(async () => {
      try {
        let value: unknown = null;
        let transfer: Transferable[] = [];
        if (request.type === "load") value = await load(request);
        else if (request.type === "depth") {
          const result = await depth(request.image, request.inputSize, request.maxWidth);
          value = result;
          transfer = [result.depth.buffer];
        } else await release();
        port.postMessage({ type: "result", id: request.id, ok: true, value }, transfer);
      } catch (error) {
        const code = error && typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : undefined;
        port.postMessage({ type: "result", id: request.id, ok: false, error: message(error), ...(code ? { code } : {}) });
      }
    });
  };
  port.postMessage({ type: "hello" });
}

export type PlateDepthRunner = {
  readonly mode: "worker" | "inline";
  /** True once the worker crashed or was terminated; start a new runner. */
  isClosed(): boolean;
  load(model: ArrayBuffer, options: { ortBaseUrl: string; numThreads: number }): Promise<PlateDepthLoadResult>;
  depth(image: Blob, options?: { inputSize?: number; maxWidth?: number }): Promise<PlateDepthResult>;
  terminate(): void;
};

/** Source of the worker script (exported for tests). */
export function plateDepthWorkerSource(): string {
  return `"use strict";\n(${String(plateDepthWorkerMain)})(self, ${String(createPlateDepthKernel)});\n`;
}

type Endpoint = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

function connect(endpoint: Endpoint, mode: "worker" | "inline", onClose: () => void): PlateDepthRunner & { fail(error: string): void } {
  let nextId = 1;
  let closed = false;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  endpoint.onmessage = (event: MessageEvent) => {
    const data = event.data as PlateDepthWorkerResponse;
    if (!data || data.type !== "result") return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) entry.resolve(data.value);
    else entry.reject(Object.assign(new Error(data.error), data.code ? { code: data.code } : {}));
  };
  const call = <T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> => {
    if (closed) return Promise.reject(new Error("The depth worker stopped."));
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      try {
        endpoint.postMessage({ ...message, id }, transfer);
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
  const fail = (error: string): void => {
    if (closed) return;
    closed = true;
    for (const entry of pending.values()) entry.reject(new Error(error));
    pending.clear();
    onClose();
  };
  return {
    mode,
    isClosed: () => closed,
    load: (model, options) => call<PlateDepthLoadResult>({ type: "load", model, ...options }, [model]),
    depth: (image, options = {}) => call<PlateDepthResult>({ type: "depth", image, inputSize: options.inputSize ?? PLATE_DEPTH_INPUT, maxWidth: options.maxWidth ?? PLATE_DEPTH_MAX_WIDTH }),
    terminate: () => fail("The depth worker was stopped."),
    fail,
  };
}

function startInline(): PlateDepthRunner {
  const channel = new MessageChannel();
  plateDepthWorkerMain(channel.port2 as unknown as PlateDepthPort, createPlateDepthKernel);
  return connect(channel.port1, "inline", () => { channel.port1.close(); channel.port2.close(); });
}

async function startWorker(timeoutMs: number): Promise<PlateDepthRunner> {
  const url = URL.createObjectURL(new Blob([plateDepthWorkerSource()], { type: "text/javascript" }));
  let worker: Worker;
  try {
    worker = new Worker(url, { type: "module", name: "cue-plate-depth" });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("The depth worker did not start.")), timeoutMs);
    const done = (error?: Error): void => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      if (error) { worker.terminate(); reject(error); } else resolve();
    };
    worker.onmessage = (event) => { if ((event.data as PlateDepthWorkerResponse | null)?.type === "hello") done(); };
    worker.onerror = (event) => { event.preventDefault?.(); done(new Error(event.message || "The depth worker failed to start.")); };
  }).finally(() => URL.revokeObjectURL(url));
  const runner = connect(worker, "worker", () => worker.terminate());
  worker.onerror = (event) => { event.preventDefault?.(); runner.fail(event.message || "The depth worker crashed."); };
  worker.onmessageerror = () => runner.fail("The depth worker sent an unreadable message.");
  return runner;
}

/** Start a runner: a Worker when possible, else inline on the main thread. */
export async function startPlateDepthRunner(options: { preferWorker?: boolean; timeoutMs?: number } = {}): Promise<PlateDepthRunner> {
  if (options.preferWorker !== false && typeof Worker === "function" && typeof URL.createObjectURL === "function") {
    try {
      return await startWorker(options.timeoutMs ?? 8000);
    } catch {
      /* fall through to inline */
    }
  }
  return startInline();
}
