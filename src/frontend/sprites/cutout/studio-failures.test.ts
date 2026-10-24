import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { CutoutRunner } from "./runner.js";

/*
 * How the Studio tier fails, with a fake cut-out runner (the real one cannot
 * be made to crash on demand). The fake reads what to do from the model
 * file's first bytes: "STUDIO-CRASHLOAD" stops the worker while loading,
 * "...-CRASHCUT" while cutting, "...-RUNTIME" / "...-SESSION" fail the load
 * with that code, "...-MODELERR" loads but every run fails.
 */
const KEY = "cue-sprite-cutout-studio-attempt";
const BEST = "https://models.test/isnet.onnx";
const STUDIO = "http://localhost:8790/studio.onnx";
const studioUrl = (variant: string): string => `http://localhost:8790/studio-${variant}.onnx`;

/** Model file content for a URL: "isnet*.onnx" is Best, "studio*.onnx" the Studio model. */
const bodyFor = (url: string): string => url.split("/").pop()!.replace(/\.onnx$/, "").toUpperCase().replace(/^ISNET/, "BEST").padEnd(4096, "x");
const nameOf = (bytes: ArrayBuffer): string => new TextDecoder().decode(new Uint8Array(bytes).subarray(0, 40)).replace(/x+$/, "");

type Hooks = { onLoad?: (name: string) => void };
const hooks: Hooks = {};

class FakeRunner {
  readonly mode = "inline" as const;
  closed = false;
  model: string | null = null;
  faceLoaded = false;
  calls: string[] = [];
  isClosed(): boolean { return this.closed; }
  private check(): void { if (this.closed) throw new Error("The cut-out worker stopped."); }
  async load(model: ArrayBuffer, options: { backend: string; fit?: string }) {
    this.check();
    const name = nameOf(model);
    structuredClone(model, { transfer: [model] }); // like postMessage: the caller's buffer is gone
    this.calls.push(`load ${name} ${options.backend} ${options.fit ?? "letterbox"}`);
    hooks.onLoad?.(name);
    this.model = null;
    if (name.endsWith("CRASHLOAD")) { this.terminate(); throw new Error("The cut-out worker stopped."); }
    if (name.endsWith("RUNTIME")) throw Object.assign(new Error("webgpu runtime: no adapter"), { code: "runtime" });
    if (name.endsWith("SESSION")) throw Object.assign(new Error("webgpu: failed to allocate"), { code: "session" });
    this.model = name;
    return { backend: options.backend === "wasm" ? "wasm" as const : "webgpu" as const, inputSize: 1024, loadMs: 1, notes: [] };
  }
  async cut(_image: Blob, useModel: boolean, detectFace = false) {
    this.check();
    this.calls.push(`cut ${useModel ? this.model ?? "none" : "basic"}${detectFace ? " face" : ""}`);
    let quality: "best" | "basic" = "basic";
    let modelError: string | null = null;
    if (useModel) {
      if (!this.model) modelError = "The cut-out model is not loaded.";
      else if (this.model.endsWith("CRASHCUT")) { this.terminate(); throw new Error("The cut-out worker stopped."); }
      else if (this.model.endsWith("MODELERR")) modelError = "out of GPU memory";
      else quality = "best";
    }
    return {
      png: new Blob(["png"], { type: "image/png" }), width: 16, height: 16, bbox: [0.25, 0.25, 0.5, 0.5] as [number, number, number, number], quality,
      figures: { twoFigures: false, splitShare: 0 } as never, modelError,
      ...(detectFace && this.faceLoaded ? { face: { face: null, candidates: [], ms: 0 } } : {}),
      timings: { decodeMs: 0, modelMs: 0, cutMs: 0, encodeMs: 0 },
    };
  }
  async unload() { this.check(); this.calls.push("unload"); this.model = null; }
  async loadFace() { this.check(); this.calls.push("loadFace"); this.faceLoaded = true; return { backend: "wasm" as const, loadMs: 1 }; }
  async face() { this.check(); return { face: null, candidates: [], ms: 0 }; }
  async unloadFace() { this.check(); this.calls.push("unloadFace"); this.faceLoaded = false; }
  terminate(): void { if (!this.closed) { this.closed = true; this.calls.push("terminate"); } }
}

let runners: FakeRunner[] = [];
mock.module("./runner.js", () => ({
  startCutoutRunner: async () => { const runner = new FakeRunner(); runners.push(runner); return runner as unknown as CutoutRunner; },
  cutoutWorkerSource: () => "",
}));
const cutout = await import("./index.js");

/* ---- browser fakes: Cache Storage, localStorage, fetch, navigator.gpu / locks / deviceMemory ---- */
const g = globalThis as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const realNow = Date.now;
let clock = 0;
let fetches: string[] = [];
const cacheStore = new Map<string, string>();
const local = new Map<string, string>();
type LockCallback = (lock: unknown) => Promise<void> | undefined;
let heldElsewhere = false;
const held = new Set<string>();
const nav = (g.navigator ??= {}) as Record<string, unknown>;
const navKeys = ["gpu", "deviceMemory", "userAgentData", "locks"];
const savedNav: Record<string, PropertyDescriptor | undefined> = {};
const setNav = (key: string, value: unknown): void => { Object.defineProperty(nav, key, { value, configurable: true, writable: true }); };
const adapter = (features: string[], extra: Record<string, unknown> = {}) => ({ requestAdapter: async () => ({ features: new Set(features), ...extra }) });

beforeAll(() => {
  for (const key of ["fetch", "caches", "localStorage"]) saved[key] = g[key];
  for (const key of navKeys) savedNav[key] = Object.getOwnPropertyDescriptor(nav, key);
  Date.now = () => realNow() + clock;
  g.fetch = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    fetches.push(url);
    if (url.includes("missing")) return new Response("nope", { status: 404 });
    const body = bodyFor(url);
    return new Response(body, { headers: { "Content-Length": String(body.length) } });
  };
  g.caches = {
    open: async () => ({
      match: async (url: string) => { const body = cacheStore.get(url); return body === undefined ? undefined : new Response(body, { headers: { "Content-Length": String(body.length) } }); },
      put: async (url: string, response: Response) => { cacheStore.set(url, await response.text()); },
      delete: async (url: string) => cacheStore.delete(url),
    }),
    delete: async () => { cacheStore.clear(); return true; },
  };
  g.localStorage = {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => { local.set(key, String(value)); },
    removeItem: (key: string) => { local.delete(key); },
  };
});

afterAll(() => {
  Date.now = realNow;
  for (const [key, value] of Object.entries(saved)) g[key] = value;
  for (const key of navKeys) {
    const descriptor = savedNav[key];
    if (descriptor) Object.defineProperty(nav, key, descriptor);
    else delete nav[key];
  }
  cutout.resetCutoutRuntime();
});

beforeEach(() => {
  cutout.configureCutoutRuntime({ backend: "auto", preferWorker: false, numThreads: 1 });
  setNav("gpu", adapter(["shader-f16"]));
  setNav("deviceMemory", 8);
  setNav("userAgentData", { mobile: false });
  setNav("locks", {
    request: (name: string, _options: { ifAvailable: boolean }, callback: LockCallback) => {
      if (heldElsewhere || held.has(name)) return Promise.resolve(callback(null));
      held.add(name);
      return Promise.resolve(callback({ name })).finally(() => held.delete(name));
    },
  });
});

afterEach(() => {
  cutout.resetCutoutRuntime();
  runners = [];
  fetches = [];
  cacheStore.clear();
  local.clear();
  held.clear();
  heldElsewhere = false;
  clock = 0;
  delete hooks.onLoad;
});

const cut = (studioModelUrl?: string, extra: Record<string, unknown> = {}) =>
  cutout.cutSprite(new Blob(["image"]), { quality: "studio", modelUrl: BEST, ...(studioModelUrl ? { studioModelUrl } : {}), ...extra });
const cached = (...urls: string[]): void => { for (const url of urls) cacheStore.set(url, bodyFor(url)); };
const calls = (): string[] => runners.flatMap((runner) => runner.calls);
const studioLoads = (): number => calls().filter((call) => call.startsWith("load STUDIO")).length;
const note = (): string => {
  const state = cutout.getCutoutModelState();
  return state.state === "ready" && state.note ? state.note : "";
};
const marker = (): { url: string; reason?: string } | null => (local.has(KEY) ? JSON.parse(local.get(KEY)!) : null);

describe("Studio failures that stop the worker or the tab", () => {
  test("the worker dies loading the Studio model: not tried again on this page, Best cuts on a fresh worker", async () => {
    const url = studioUrl("crashload");
    cached(url);
    const first = await cut(url);
    expect(first.quality).toBe("best");
    expect(first.studio).toBeUndefined();
    expect(studioLoads()).toBe(1);
    expect(runners[0]!.closed).toBe(true);
    expect(runners.at(-1)!.calls).toContain("load BEST auto letterbox");
    expect(note()).toMatch(/stopped while loading the Studio model/);
    clock += 10 * 60_000;
    const again = await cut(url);
    expect(again.quality).toBe("best");
    expect(studioLoads()).toBe(1);
  });

  test("onnxruntime cannot start for the Studio model (\"runtime\"): not tried again on this page", async () => {
    const url = studioUrl("runtime");
    cached(url);
    expect((await cut(url)).studio).toBeUndefined();
    clock += 10 * 60_000;
    expect((await cut(url)).studio).toBeUndefined();
    expect(studioLoads()).toBe(1);
    expect(note()).toMatch(/Studio model could not start.*no adapter/);
  });

  test("the marker is set while the Studio model loads and cleared after its first good cut", async () => {
    cached(STUDIO);
    const during: Array<unknown> = [];
    hooks.onLoad = (name) => { if (name.startsWith("STUDIO")) during.push(marker()); };
    const result = await cut(STUDIO);
    expect(result.studio).toBe(true);
    expect(during).toEqual([expect.objectContaining({ url: STUDIO })]);
    expect(marker()).toBeNull();
  });

  test("a tab that died loading or first running the Studio model: the next visit uses Best; Settings retries", async () => {
    cached(STUDIO);
    local.set(KEY, JSON.stringify({ url: STUDIO, at: 1 }));
    const result = await cut(STUDIO);
    expect(result.quality).toBe("best");
    expect(result.studio).toBeUndefined();
    expect(studioLoads()).toBe(0);
    expect(note()).toMatch(/earlier visit/);
    expect(note()).toMatch(/Try Studio again/);
    // A marker for another Studio file does not count against this one.
    cutout.resetCutoutRuntime();
    local.set(KEY, JSON.stringify({ url: studioUrl("other"), at: 1 }));
    expect((await cut(STUDIO)).studio).toBe(true);
    // Settings: "Try Studio again" clears it and loads.
    cutout.resetCutoutRuntime();
    local.set(KEY, JSON.stringify({ url: STUDIO, at: 1 }));
    await cutout.prepareStudioCutoutModel(STUDIO);
    expect((await cut(STUDIO)).studio).toBe(true);
    expect(marker()).toBeNull();
  });

  test("a Studio failure the page saw is remembered on the device with its reason", async () => {
    const url = studioUrl("session");
    cached(url);
    await cut(url);
    expect(marker()).toMatchObject({ url, reason: expect.stringMatching(/failed to allocate/) });
    cutout.resetCutoutRuntime(); // the next visit
    const loadsBefore = studioLoads();
    expect((await cut(url)).studio).toBeUndefined();
    expect(studioLoads()).toBe(loadsBefore);
    expect(note()).toMatch(/earlier visit.*failed to allocate/);
  });

  test("another Cue tab runs the Studio model: this tab cuts with Best and reads no crash into its marker", async () => {
    cached(STUDIO);
    heldElsewhere = true;
    local.set(KEY, JSON.stringify({ url: STUDIO, at: realNow() })); // the other tab is loading it right now
    const result = await cut(STUDIO);
    expect(result.studio).toBeUndefined();
    expect(studioLoads()).toBe(0);
    expect(note()).toMatch(/another Cue tab/);
    expect(marker()).toMatchObject({ url: STUDIO });
    // When that tab lets go, this one loads it (the marker is then its own).
    heldElsewhere = false;
    local.delete(KEY);
    expect((await cut(STUDIO)).studio).toBe(true);
  });

  test("phones, small-memory devices and software adapters are not offered the Studio model", async () => {
    cached(STUDIO);
    setNav("deviceMemory", 4);
    expect(await cutout.getStudioCutoutSupport()).toMatch(/at least 8 GB of memory; this one reports 4 GB/);
    expect((await cut(STUDIO)).studio).toBeUndefined();
    cutout.resetCutoutRuntime();
    setNav("deviceMemory", 8);
    setNav("userAgentData", { mobile: true });
    expect(await cutout.getStudioCutoutSupport()).toMatch(/not offered on phones/);
    cutout.resetCutoutRuntime();
    setNav("userAgentData", undefined);
    setNav("deviceMemory", undefined); // browsers that do not say: allowed
    setNav("gpu", adapter(["shader-f16"], { info: { isFallbackAdapter: true } }));
    expect(await cutout.getStudioCutoutSupport()).toMatch(/software graphics adapter/);
    expect(studioLoads()).toBe(0);
    cutout.resetCutoutRuntime();
    setNav("gpu", adapter(["shader-f16"]));
    expect(await cutout.getStudioCutoutSupport()).toBeNull();
  });
});

describe("cutting again after a Studio failure", () => {
  const FACE = "https://models.test/face.onnx";

  test("a Studio run failure: Best cuts the sprite on a fresh worker (a new GPU device), the face finder comes along", async () => {
    const url = studioUrl("modelerr");
    cached(url);
    const result = await cut(url, { faceModelUrl: FACE });
    expect(result.quality).toBe("best");
    expect(result.studio).toBeUndefined();
    expect(result.face).toBeNull();
    expect(runners).toHaveLength(2);
    expect(runners[0]!.calls).toEqual(["load STUDIO-MODELERR webgpu stretch", "loadFace", "cut STUDIO-MODELERR face", "terminate"]);
    expect(runners[1]!.calls).toEqual(["load BEST auto letterbox", "loadFace", "cut BEST face"]);
    expect(note()).toMatch(/Studio model could not run: out of GPU memory/);
  });

  test("a Studio load failure leaves its worker too: Best starts on a fresh one", async () => {
    const url = studioUrl("session");
    cached(url);
    expect((await cut(url)).quality).toBe("best");
    expect(runners[0]!.closed).toBe(true);
    expect(runners[1]!.calls).toEqual(["load BEST auto letterbox", "cut BEST"]);
  });

  test("the worker dies running Studio, then again running Best: the sprite is cut without a model, Best is not tried again", async () => {
    const url = studioUrl("crashcut");
    cached(url);
    const bestCrash = "https://models.test/isnet-crashcut.onnx";
    const result = await cutout.cutSprite(new Blob(["image"]), { quality: "studio", modelUrl: bestCrash, studioModelUrl: url });
    expect(result.quality).toBe("basic");
    expect(runners).toHaveLength(3);
    expect(runners[2]!.calls).toEqual(["cut basic"]);
    expect(cutout.getCutoutModelState()).toMatchObject({ state: "unsupported", reason: expect.stringMatching(/stopped while running the model/) });
    const next = await cutout.cutSprite(new Blob(["image"]), { quality: "best", modelUrl: bestCrash });
    expect(next.quality).toBe("basic");
    expect(calls().filter((call) => call.startsWith("load BEST"))).toHaveLength(1);
  });
});
