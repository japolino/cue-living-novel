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
/** "slow" URLs answer once `releaseSlow` runs. */
let releaseSlow: () => void = () => {};
let slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
const cacheStore = new Map<string, string>();
/** URLs the fake cache refuses to store (quota). */
const quota = new Set<string>();
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
    if (url.includes("slow")) await slowGate;
    const body = bodyFor(url);
    return new Response(body, { headers: { "Content-Length": String(body.length) } });
  };
  g.caches = {
    open: async () => ({
      match: async (url: string) => { const body = cacheStore.get(url); return body === undefined ? undefined : new Response(body, { headers: { "Content-Length": String(body.length) } }); },
      put: async (url: string, response: Response) => {
        if (quota.has(url)) throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
        cacheStore.set(url, await response.text());
      },
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
  quota.clear();
  local.clear();
  held.clear();
  heldElsewhere = false;
  clock = 0;
  delete hooks.onLoad;
  releaseSlow();
  slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
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
const tick = (ms = 1): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** Wait for the background downloads (the Studio model's, and Best's on first use) to finish. */
const downloaded = (): Promise<void> => cutout.cutoutModelSettled();
const fetchesOf = (url: string): number => fetches.filter((item) => item === url).length;

describe("Studio failures that stop the worker or the tab", () => {
  test("the worker dies loading the Studio model: not tried again on this page, Best cuts on a fresh worker", async () => {
    const url = studioUrl("crashload");
    cached(url, BEST);
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
    cached(url, BEST);
    expect((await cut(url)).studio).toBeUndefined();
    clock += 10 * 60_000;
    expect((await cut(url)).studio).toBeUndefined();
    expect(studioLoads()).toBe(1);
    expect(note()).toMatch(/Studio model could not start.*no adapter/);
  });

  test("the marker is set while the Studio model loads and cleared after its first good cut", async () => {
    cached(STUDIO, BEST);
    const during: Array<unknown> = [];
    hooks.onLoad = (name) => { if (name.startsWith("STUDIO")) during.push(marker()); };
    const result = await cut(STUDIO);
    expect(result.studio).toBe(true);
    expect(during).toEqual([expect.objectContaining({ url: STUDIO })]);
    expect(marker()).toBeNull();
  });

  test("a tab that died loading or first running the Studio model: the next visit uses Best; Settings retries", async () => {
    cached(STUDIO, BEST);
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
    cached(url, BEST);
    await cut(url);
    expect(marker()).toMatchObject({ url, reason: expect.stringMatching(/failed to allocate/) });
    cutout.resetCutoutRuntime(); // the next visit
    const loadsBefore = studioLoads();
    expect((await cut(url)).studio).toBeUndefined();
    expect(studioLoads()).toBe(loadsBefore);
    expect(note()).toMatch(/earlier visit.*failed to allocate/);
  });

  test("another Cue tab runs the Studio model: this tab cuts with Best and reads no crash into its marker", async () => {
    cached(STUDIO, BEST);
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
    cached(STUDIO, BEST);
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
    cached(url, BEST);
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
    cached(url, BEST);
    expect((await cut(url)).quality).toBe("best");
    expect(runners[0]!.closed).toBe(true);
    expect(runners[1]!.calls).toEqual(["load BEST auto letterbox", "cut BEST"]);
  });

  test("the worker dies running Studio, then again running Best: the sprite is cut without a model, Best is not tried again", async () => {
    const url = studioUrl("crashcut");
    const bestCrash = "https://models.test/isnet-crashcut.onnx";
    cached(url, bestCrash);
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

describe("the Studio download runs in the background", () => {
  test("cuts never wait for it: Best cuts while it downloads, the next cut after it loads the Studio model", async () => {
    const url = studioUrl("slow");
    cached(BEST);
    const first = await Promise.race([cut(url), tick(500).then(() => null)]);
    expect(first).not.toBeNull();
    expect(first!.quality).toBe("best");
    expect(first!.studio).toBeUndefined();
    expect(cutout.getCutoutModelState()).toEqual({ state: "downloading", receivedBytes: 0, totalBytes: null, studio: true });
    // More cuts while it downloads: Best, one download.
    expect((await cut(url)).studio).toBeUndefined();
    releaseSlow();
    await downloaded();
    expect(cacheStore.has(url)).toBe(true);
    expect(cutout.getCutoutModelState()).toMatchObject({ state: "ready", backend: "webgpu" });
    const after = await cut(url);
    expect(after.studio).toBe(true);
    expect(fetchesOf(url)).toBe(1);
  });

  test("a failed download is tried again after 1, 2, then 4 minutes, then not on this page; Settings retries", async () => {
    const url = studioUrl("missing");
    cached(BEST);
    const step = async (advance: number, expected: number): Promise<void> => {
      clock += advance;
      expect((await cut(url)).studio).toBeUndefined();
      await downloaded();
      expect(fetchesOf(url)).toBe(expected);
    };
    await step(0, 1);
    expect(note()).toMatch(/^The Studio model is not available: .*HTTP 404.*Trying again in 1 min/);
    await step(30_000, 1);
    await step(31_000, 2);
    expect(note()).toMatch(/Trying again in 2 min/);
    await step(61_000, 2);
    await step(60_000, 3);
    await step(4 * 60_000, 4);
    expect(note()).toMatch(/Gave up after 4 tries on this page.*Try Studio again/);
    await step(60 * 60_000, 4);
    await expect(cutout.prepareStudioCutoutModel(url)).rejects.toThrow(/404/);
    expect(fetchesOf(url)).toBe(5);
  });

  test("Settings' download waits for the background download instead of starting another", async () => {
    const url = studioUrl("slow");
    await cut(url);
    const prepared = cutout.prepareStudioCutoutModel(url);
    releaseSlow();
    await prepared;
    expect(fetchesOf(url)).toBe(1);
    expect(cutout.getCutoutModelState()).toMatchObject({ state: "ready", studio: true });
  });
});

describe("provisional Best cuts (one Studio re-cut later)", () => {
  test("a Best cut made because the Studio model is not ready yet is provisional; Studio cuts and lasting failures are not", async () => {
    const url = studioUrl("slow");
    cached(BEST);
    expect((await cut(url)).provisional).toBe(true);
    releaseSlow();
    await downloaded();
    const studioCut = await cut(url);
    expect(studioCut.studio).toBe(true);
    expect(studioCut.provisional).toBeUndefined();
    cutout.resetCutoutRuntime();
    // Another tab has the Studio model: it may be free later.
    heldElsewhere = true;
    expect((await cut(url)).provisional).toBe(true);
    heldElsewhere = false;
    cutout.resetCutoutRuntime();
    // Lasting: the session cannot be built, no Studio URL, Best quality.
    const broken = studioUrl("session");
    cached(broken);
    expect((await cut(broken)).provisional).toBeUndefined();
    expect((await cut(broken)).provisional).toBeUndefined();
    expect((await cut()).provisional).toBeUndefined();
    expect((await cutout.cutSprite(new Blob(["image"]), { quality: "best", modelUrl: BEST, studioModelUrl: url })).provisional).toBeUndefined();
  });
});

describe("the Studio model leaves when it is no longer wanted", () => {
  const sync = (quality: "studio" | "best" | "basic", url = ""): void => (cutout as unknown as { syncStudioCutout: (q: string, u: string) => void }).syncStudioCutout(quality, url);

  test("another quality or another URL: the Studio model leaves the worker, the device lock and its marker go", async () => {
    cached(STUDIO, BEST);
    expect((await cut(STUDIO)).studio).toBe(true);
    sync("best", STUDIO);
    await tick();
    expect(runners[0]!.calls.at(-1)).toBe("unload");
    expect(held.size).toBe(0);
    expect(cutout.getCutoutModelState()).toEqual({ state: "absent" });
    // A basic cut also lets it go (hosts that never call the sync).
    expect((await cut(STUDIO)).studio).toBe(true);
    await cutout.cutSprite(new Blob(["image"]), { quality: "basic", modelUrl: BEST, studioModelUrl: STUDIO });
    expect(runners[0]!.calls.slice(-2)).toEqual(["unload", "cut basic"]);
    // A loaded Studio model that has not cut yet: not a crash, the marker goes.
    await cutout.prepareStudioCutoutModel(STUDIO);
    expect(marker()).toMatchObject({ url: STUDIO });
    sync("studio", studioUrl("other"));
    await tick();
    expect(marker()).toBeNull();
    expect(held.size).toBe(0);
  });

  test("a Studio load that ends after Studio was deselected is unloaded; the cut uses Best", async () => {
    cached(STUDIO, BEST);
    hooks.onLoad = (name) => { if (name === "STUDIO") sync("best"); };
    const result = await cut(STUDIO);
    expect(result.studio).toBeUndefined();
    expect(result.quality).toBe("best");
    expect(calls()).toContain("unload");
    expect(held.size).toBe(0);
  });

  test("the background download stops when the URL changes or Studio is deselected", async () => {
    const url = studioUrl("slow");
    cached(BEST);
    await cut(url);
    sync("studio", studioUrl("other"));
    expect(cutout.getCutoutModelState().state).not.toBe("downloading");
    releaseSlow();
    await tick(5);
    expect(cacheStore.has(url)).toBe(false);
  });

  test("clearing the Studio URL drops its note and its error", async () => {
    const url = studioUrl("session");
    cached(url, BEST);
    await cut(url);
    expect(note()).toMatch(/failed to allocate/);
    sync("studio", "");
    expect(note()).toBe("");
    expect(cutout.getCutoutModelState()).toMatchObject({ state: "ready" });
    cutout.resetCutoutRuntime();
    await expect(cutout.prepareStudioCutoutModel(url)).rejects.toThrow(/failed to allocate/);
    expect(cutout.getCutoutModelState()).toMatchObject({ state: "unsupported", studio: true });
    sync("best");
    expect(cutout.getCutoutModelState()).toEqual({ state: "absent" });
  });

  test("Remove downloaded model unloads the worker's models even when the page lost track of them", async () => {
    const bestErr = "https://models.test/isnet-modelerr.onnx";
    cached(bestErr);
    const result = await cutout.cutSprite(new Blob(["image"]), { quality: "best", modelUrl: bestErr, faceModelUrl: "https://models.test/face.onnx" });
    expect(result.quality).toBe("basic"); // the run failed: the page forgot the model, the worker still holds it
    await cutout.clearCutoutModel();
    expect(runners[0]!.calls.slice(-2)).toEqual(["unload", "unloadFace"]);
  });
});

describe("the Studio file in the browser's storage", () => {
  const FILES = "cue-sprite-cutout-studio-files";

  test("a stored Studio download replaces the Studio file cached for an earlier URL (Best's stays)", async () => {
    const old = studioUrl("old");
    cached(old, BEST);
    local.set(FILES, JSON.stringify([old]));
    await cut(STUDIO);
    await downloaded();
    await tick();
    expect(cacheStore.has(STUDIO)).toBe(true);
    expect(cacheStore.has(old)).toBe(false);
    expect(cacheStore.has(BEST)).toBe(true);
    expect(JSON.parse(local.get(FILES)!)).toEqual([STUDIO]);
  });

  test("a Studio file the browser will not store loads from memory, and the state says it downloads again", async () => {
    quota.add(STUDIO);
    await cut(STUDIO);
    await downloaded();
    const result = await cut(STUDIO);
    expect(result.studio).toBe(true);
    expect(fetchesOf(STUDIO)).toBe(1);
    expect(cutout.getCutoutModelState()).toMatchObject({ state: "ready", studio: true, notStored: true });
  });

  test("a Best model the browser will not store: its ready state says so too", async () => {
    quota.add(BEST);
    // First use: the cut is Basic and the model downloads in the background.
    expect((await cutout.cutSprite(new Blob(["image"]), { quality: "best", modelUrl: BEST })).quality).toBe("basic");
    await downloaded();
    expect(cutout.getCutoutModelState()).toMatchObject({ state: "ready", notStored: true });
    expect((await cutout.cutSprite(new Blob(["image"]), { quality: "best", modelUrl: BEST })).quality).toBe("best");
    cutout.resetCutoutRuntime();
    quota.clear();
    await cutout.cutSprite(new Blob(["image"]), { quality: "best", modelUrl: BEST });
    await downloaded();
    expect("notStored" in cutout.getCutoutModelState()).toBe(false);
  });
});
