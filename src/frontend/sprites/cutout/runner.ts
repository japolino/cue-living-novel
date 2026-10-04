/**
 * Runs `cutoutWorkerMain` in a Worker built from a blob URL (off the main
 * thread). When a Worker cannot start (no Worker, CSP), the same code runs
 * on the main thread behind a MessageChannel.
 */
import { createCutoutKernel } from "./kernel.js";
import {
  cutoutWorkerMain,
  type CutoutBackendPreference,
  type CutoutLoadResult,
  type CutoutPort,
  type CutoutWorkerCutResult,
  type CutoutWorkerResponse,
} from "./worker-main.js";

export type CutoutRunnerMode = "worker" | "inline";

export type CutoutRunner = {
  readonly mode: CutoutRunnerMode;
  /** True once the worker crashed or was terminated; start a new runner. */
  isClosed(): boolean;
  load(model: ArrayBuffer, options: { ortBaseUrl: string; backend: CutoutBackendPreference; numThreads: number }): Promise<CutoutLoadResult>;
  cut(image: Blob, useModel: boolean): Promise<CutoutWorkerCutResult>;
  unload(): Promise<void>;
  terminate(): void;
};

/** Source of the worker script (exported for tests). */
export function cutoutWorkerSource(): string {
  return `"use strict";\n(${String(cutoutWorkerMain)})(self, ${String(createCutoutKernel)});\n`;
}

type Endpoint = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

function connect(endpoint: Endpoint, mode: CutoutRunnerMode, onClose: () => void): CutoutRunner & { handleFailure(error: string): void } {
  let nextId = 1;
  let closed = false;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  endpoint.onmessage = (event: MessageEvent) => {
    const data = event.data as CutoutWorkerResponse;
    if (!data || data.type !== "result") return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) entry.resolve(data.value);
    else entry.reject(Object.assign(new Error(data.error), data.code ? { code: data.code } : {}));
  };
  const call = <T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> => {
    if (closed) return Promise.reject(new Error("The cut-out worker stopped."));
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
    load: (model, options) => call<CutoutLoadResult>({ type: "load", model, ...options }, [model]),
    cut: (image, useModel) => call<CutoutWorkerCutResult>({ type: "cut", image, useModel }),
    unload: () => call<void>({ type: "unload" }),
    terminate: () => fail("The cut-out worker was stopped."),
    handleFailure: fail,
  };
}

function startInline(): CutoutRunner {
  const channel = new MessageChannel();
  cutoutWorkerMain(channel.port2 as unknown as CutoutPort, createCutoutKernel);
  const runner = connect(channel.port1, "inline", () => { channel.port1.close(); channel.port2.close(); });
  return runner;
}

async function startWorker(timeoutMs: number): Promise<CutoutRunner> {
  const url = URL.createObjectURL(new Blob([cutoutWorkerSource()], { type: "text/javascript" }));
  let worker: Worker;
  try {
    worker = new Worker(url, { type: "module", name: "cue-sprite-cutout" });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(new Error("The cut-out worker did not start.")), timeoutMs);
    const done = (error?: Error): void => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      if (error) { worker.terminate(); reject(error); } else resolve();
    };
    worker.onmessage = (event) => { if ((event.data as CutoutWorkerResponse | null)?.type === "hello") done(); };
    worker.onerror = (event) => { event.preventDefault?.(); done(new Error(event.message || "The cut-out worker failed to start.")); };
  }).finally(() => URL.revokeObjectURL(url));
  const runner = connect(worker, "worker", () => worker.terminate());
  worker.onerror = (event) => { event.preventDefault?.(); runner.handleFailure(event.message || "The cut-out worker crashed."); };
  worker.onmessageerror = () => runner.handleFailure("The cut-out worker sent an unreadable message.");
  return runner;
}

/** Start a runner: a Worker when possible, else inline on the main thread. */
export async function startCutoutRunner(options: { preferWorker?: boolean; timeoutMs?: number } = {}): Promise<CutoutRunner> {
  if (options.preferWorker !== false && typeof Worker === "function" && typeof URL.createObjectURL === "function") {
    try {
      return await startWorker(options.timeoutMs ?? 8000);
    } catch {
      /* fall through to inline */
    }
  }
  return startInline();
}
