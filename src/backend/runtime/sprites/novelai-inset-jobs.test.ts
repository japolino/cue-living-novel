import { describe, expect, test } from "bun:test";
import type { VisualNovelConfig } from "../../../config.js";
import { NOVELAI_INSET_LAYOUTS } from "../../../shared/novelai-inset.js";
import { spriteSetKeyFor } from "../../../shared/sprites.js";
import { referenceParametersFor } from "../images.js";
import { CUT_META, KAI, MIRA, fakePng, mockSpindle, spriteConfig, toBase64, waitFor, type GenerateCall, type MockSpindleOptions } from "./__fixtures__/sprite-fixtures.js";
import { SpriteService, type SpriteServiceDeps } from "./jobs.js";
import { compileSpriteRequest } from "./prompts.js";
import { spriteSeedFor, spriteStyleKey } from "./style.js";

/** NovelAI V5 reference inset in the sprite queue: request, crop, fallbacks. */

const V5 = { imageModel: "nai-diffusion-5-full", referenceAnchoring: true, spriteExpressionCount: 4 } as const;
const CROP = NOVELAI_INSET_LAYOUTS.sprite.repaint;

type InsetMessage = { requestId: string; layout: string; imageId: string; userId?: string };
type CutMessage = { requestId: string; imageId: string; setKey: string; expression: string; crop?: typeof CROP };

function setup(options: MockSpindleOptions & {
  config?: Partial<VisualNovelConfig>;
  /** How the browser answers an inset request (default: a valid canvas and mask). */
  inset?: "ok" | "error" | "silent";
  /** Whether the browser echoes the crop in the cut meta (default true). */
  echoCrop?: boolean;
  deps?: Partial<SpriteServiceDeps>;
} = {}) {
  const mock = mockSpindle({ provider: "novelai", ...options });
  let config = spriteConfig({ ...V5, ...(options.config ?? {}) });
  const log: string[] = [];
  const service = new SpriteService(mock.spindle, {
    isViewOpen: () => true,
    openChatId: () => "chat-1",
    loadConfig: async () => config,
    log: (line) => log.push(line),
    referenceTimeoutMs: 300,
    insetTimeoutMs: 60,
    idleCheckWaitMs: 2000,
    ...(options.deps ?? {}),
  });
  let insetMode = options.inset ?? "ok";
  let echoCrop = options.echoCrop !== false;
  const styleKey = spriteStyleKey(config);
  const setKey = spriteSetKeyFor(MIRA, styleKey);
  const insets = () => mock.of("vn_novelai_inset") as unknown as InsetMessage[];
  const cuts = () => mock.of("vn_sprite_cut") as unknown as CutMessage[];
  const answered = new Set<string>();
  /** Answer every pending inset and cut request, as the browser would. */
  const answerPending = () => {
    for (const request of insets()) {
      if (answered.has(request.requestId)) continue;
      answered.add(request.requestId);
      if (insetMode === "silent") continue;
      if (insetMode === "error") {
        service.handleInsetResult("u1", { type: "vn_novelai_inset_result", requestId: request.requestId, chunkIndex: 0, chunkCount: 1, error: "Image fetch failed (404)." });
        continue;
      }
      service.handleInsetResult("u1", { type: "vn_novelai_inset_result", requestId: request.requestId, part: "image", chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(fakePng(1216, 832, 90)) });
      service.handleInsetResult("u1", { type: "vn_novelai_inset_result", requestId: request.requestId, part: "mask", chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(fakePng(1216, 832, 5)) });
    }
    for (const request of cuts()) {
      if (answered.has(request.requestId)) continue;
      answered.add(request.requestId);
      const width = request.crop ? request.crop.width : 832;
      const height = request.crop ? request.crop.height : 1216;
      service.handleCutResult("u1", {
        type: "vn_sprite_cut_result", requestId: request.requestId, chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(fakePng(width, height)),
        meta: { ...CUT_META, width, height, twoFigures: false, ...(request.crop && echoCrop ? { crop: request.crop } : {}) },
      });
    }
  };
  /** Play the browser until `done` holds. */
  const drive = async (done: () => boolean | Promise<boolean>, timeoutMs = 4000) => {
    const started = Date.now();
    while (!(await done())) {
      if (Date.now() - started > timeoutMs) throw new Error("Timed out driving the sprite queue");
      answerPending();
      await new Promise<void>((resolve) => setTimeout(resolve, 3));
    }
    await service.settle("u1");
  };
  const library = () => service.library.get("u1");
  const image = async (expression: string) => (await library()).sets[setKey]!.images[expression]!;
  const allSettled = async () => {
    const set = (await library()).sets[setKey];
    return Boolean(set) && ["idle", "smile", "sad", "angry"].every((expression) => ["ready", "failed"].includes(set!.images[expression]?.status ?? ""));
  };
  return {
    ...mock, service, log, setKey, insets, cuts, drive, library, image, allSettled,
    get config() { return config; },
    setConfig: (patch: Partial<VisualNovelConfig>) => { config = { ...config, ...patch }; },
    setInset: (mode: "ok" | "error" | "silent") => { insetMode = mode; },
    setEchoCrop: (value: boolean) => { echoCrop = value; },
    /** Answer one inset request with a valid canvas and mask (as the browser would). */
    answerInset: (requestId: string) => {
      service.handleInsetResult("u1", { type: "vn_novelai_inset_result", requestId, part: "image", chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(fakePng(1216, 832, 90)) });
      service.handleInsetResult("u1", { type: "vn_novelai_inset_result", requestId, part: "mask", chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(fakePng(1216, 832, 5)) });
    },
  };
}

const inpainting = (call: GenerateCall) => call.model === "nai-diffusion-5-full-inpainting";

describe("NovelAI V5 inset: sprite expressions", () => {
  test("the idle renders as before; each expression is an inset of the idle, cut from the right half", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(f.allSettled);
    const idle = await f.image("idle");
    // The idle: unchanged (portrait, plain model, captured), and its cut has no crop.
    expect(f.calls[0]!.model).toBe("nai-diffusion-5-full");
    expect(f.calls[0]!.parameters.resolution).toBe("832x1216");
    expect(f.calls[0]!.parameters.rawRequestOverride).toBeUndefined();
    expect(f.cuts()[0]).toMatchObject({ expression: "idle" });
    expect(f.cuts()[0]!.crop).toBeUndefined();
    expect(idle.crop).toBeUndefined();
    // Every expression asked the browser for an inset of the idle render.
    expect(f.insets().map((request) => request.imageId)).toEqual([idle.rawImageId!, idle.rawImageId!, idle.rawImageId!]);
    expect(f.insets().every((request) => request.layout === "sprite" && request.userId === "u1")).toBe(true);
    const expressions = f.calls.slice(1);
    expect(expressions).toHaveLength(3);
    for (const call of expressions) {
      expect(inpainting(call)).toBe(true);
      expect(call.parameters.resolution).toBe("1216x832");
      expect(call.parameters.resolvedReferenceImages).toBeUndefined();
      expect(call.includeDataUrl).toBe(false);
      expect(call.prompt.startsWith("split screen, ")).toBe(true);
      expect(call.negativePrompt!.split(", ")).toContain("comic");
      expect(call.negativePrompt!.split(", ")).not.toContain("split screen");
      // The set's shared seed (one pose across the set).
      expect(call.parameters.seed).toBe((await f.library()).sets[f.setKey]!.seed);
      const override = JSON.parse(call.parameters.rawRequestOverride as string);
      expect(override).toEqual({ action: "infill", parameters: { noise: 0, image: toBase64(fakePng(1216, 832, 90)), mask: toBase64(fakePng(1216, 832, 5)) } });
    }
    // The cut-out is made from the right half, and the crop is stored for re-cuts.
    for (const expression of ["smile", "sad", "angry"]) {
      const stored = await f.image(expression);
      expect(stored.status).toBe("ready");
      expect(stored.crop).toEqual(CROP);
      expect(stored.insetReference).toBe(idle.rawImageId!);
      expect(stored.width).toBe(608);
      expect(f.cuts().find((cut) => cut.expression === expression)!.crop).toEqual(CROP);
    }
    expect(f.log.some((line) => line.includes("NovelAI V5 reference inset on nai-diffusion-5-full-inpainting"))).toBe(true);
  });

  test("Re-cut crops the same way; a regenerate starts plain again", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(f.allSettled);
    const before = f.cuts().length;
    await f.service.action("u1", { type: "vn_sprite_action", action: "recut", setKey: f.setKey, expression: "smile" }, { config: f.config });
    await f.drive(async () => (await f.image("smile")).status === "ready" && f.cuts().length > before);
    const recut = f.cuts().slice(before);
    expect(recut).toHaveLength(1);
    expect(recut[0]).toMatchObject({ expression: "smile", crop: CROP });
    expect((await f.image("smile")).crop).toEqual(CROP);
  });

  test("a page that does not crop (older frontend) fails the cut instead of keeping both halves", async () => {
    const f = setup({ echoCrop: false });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(f.allSettled);
    expect((await f.image("idle")).status).toBe("ready");
    const smile = await f.image("smile");
    expect(smile.status).toBe("failed");
    expect(smile.error).toContain("did not crop");
    // The raw render and its crop stay: Re-cut can try again.
    expect(smile.rawImageId).toBeTruthy();
    expect(smile.crop).toEqual(CROP);
  });

  test("the user's raw request override (connection defaults and Image parameters) is merged in", async () => {
    const f = setup({
      defaultParameters: { rawRequestOverride: JSON.stringify({ parameters: { steps: 14, scale: 6.7 } }) },
      config: { imageConnectionId: "conn-1", imageParameters: { rawRequestOverride: JSON.stringify({ parameters: { scale: 5.5, cfg_rescale: 0 } }) } },
    });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(f.allSettled);
    const call = f.calls.find(inpainting)!;
    expect(JSON.parse(call.parameters.rawRequestOverride as string)).toMatchObject({
      action: "infill",
      parameters: { noise: 0, steps: 14, scale: 5.5, cfg_rescale: 0 },
    });
    // The idle keeps the user's own override untouched.
    expect(f.calls[0]!.parameters.rawRequestOverride).toBe(JSON.stringify({ parameters: { scale: 5.5, cfg_rescale: 0 } }));
  });

  test("an invalid user override skips the inset (plain expression)", async () => {
    const f = setup({ config: { imageParameters: { rawRequestOverride: "{oops" } } });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(f.allSettled);
    expect(f.calls.some(inpainting)).toBe(false);
    expect(f.log.some((line) => line.includes("reference inset skipped (rawRequestOverride"))).toBe(true);
  });
});

describe("NovelAI V5 inset: fallbacks", () => {
  test("a rejected request (400) retries the expression once unanchored and turns the inset off for the session", async () => {
    const f = setup({ failGenerate: (call) => (inpainting(call) ? "NovelAI image generate failed (400): unknown model" : null) });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(f.allSettled);
    // idle, smile (inset fails, then plain), then sad and angry plain without asking the browser again.
    expect(f.calls.map((call) => call.model)).toEqual([
      "nai-diffusion-5-full", "nai-diffusion-5-full-inpainting", "nai-diffusion-5-full", "nai-diffusion-5-full", "nai-diffusion-5-full",
    ]);
    expect(f.insets()).toHaveLength(1);
    const retry = f.calls[2]!;
    expect(retry.parameters.resolution).toBe("832x1216");
    expect(retry.parameters.rawRequestOverride).toBeUndefined();
    expect(retry.parameters.resolvedReferenceImages).toBeUndefined();
    expect(retry.prompt.startsWith("split screen")).toBe(false);
    for (const expression of ["smile", "sad", "angry"]) {
      const stored = await f.image(expression);
      expect(stored.status).toBe("ready");
      expect(stored.crop).toBeUndefined();
      expect(stored.insetReference).toBeUndefined();
    }
    expect(f.log.some((line) => line.includes("reference inset failed on nai-diffusion-5-full-inpainting") && line.includes("inset off"))).toBe(true);
  });

  test("a passing error (429 lock, 5xx, network, no image id) fails the render as usual and keeps the inset on", async () => {
    for (const failure of [
      "NovelAI image generate failed (429): Concurrent generation is locked",
      "NovelAI image generate failed (502): Bad Gateway",
      "fetch failed",
      "The image provider completed without a persisted image ID.",
    ]) {
      let failed = false;
      const f = setup({ failGenerate: (call) => (inpainting(call) && !failed ? ((failed = true), failure) : null) });
      await f.service.prepareCast("u1", [MIRA], f.config);
      await f.drive(f.allSettled);
      // No plain retry: the idle is the only plain render; every expression asked for an inset.
      expect(f.calls.filter((call) => !inpainting(call))).toHaveLength(1);
      expect(f.calls.filter(inpainting)).toHaveLength(3);
      const statuses = await Promise.all(["smile", "sad", "angry"].map(async (expression) => (await f.image(expression)).status));
      expect(statuses.filter((status) => status === "failed")).toHaveLength(1);
      expect(statuses.filter((status) => status === "ready")).toHaveLength(2);
      expect(f.log.some((line) => line.includes("inset off"))).toBe(false);
      // Retrying the failed one draws an inset again.
      const failedExpression = ["smile", "sad", "angry"][statuses.indexOf("failed")]!;
      await f.service.action("u1", { type: "vn_sprite_action", action: "regenerate", setKey: f.setKey, expression: failedExpression }, { config: f.config });
      await f.drive(async () => (await f.image(failedExpression)).status === "ready");
      expect(f.calls.filter(inpainting)).toHaveLength(4);
      expect((await f.image(failedExpression)).insetReference).toBe((await f.image("idle")).rawImageId!);
    }
  });

  test("once the inset is off, a set's expressions no longer wait for its idle's check", async () => {
    const f = setup({ gated: true, deps: { idleCheckWaitMs: 10_000 }, failGenerate: (call) => (inpainting(call) ? "NovelAI image generate failed (404): Not Found" : null) });
    const releaseAll = async (done: () => Promise<boolean>) => {
      await f.drive(async () => {
        for (const gate of f.gates) gate.release();
        return done();
      });
    };
    await f.service.prepareCast("u1", [MIRA], f.config);
    await releaseAll(f.allSettled);
    expect(f.log.some((line) => line.includes("inset off"))).toBe(true);
    const asked = f.insets().length;
    // A new character: the next expression starts before the idle's cut-out (its duplicate check) is back.
    const released = f.gates.length;
    await f.service.prepareCast("u1", [KAI], f.config);
    await waitFor(() => f.gates.length === released + 1);
    f.gates[released]!.release();
    await waitFor(() => f.gates.length === released + 2);
    const kai = spriteSetKeyFor(KAI, spriteStyleKey(f.config));
    expect((await f.library()).sets[kai]!.images.idle!.status).toBe("cutting");
    expect(inpainting(f.gates[released + 1]!.call)).toBe(false);
    await releaseAll(async () => {
      const set = (await f.library()).sets[kai]!;
      return ["idle", "smile", "sad", "angry"].every((expression) => set.images[expression]!.status === "ready");
    });
    expect(f.insets()).toHaveLength(asked);
  });

  test("the switch-off is per model: V5 Curated still tries its own (unverified) inpainting model", async () => {
    const f = setup({ failGenerate: (call) => (call.model === "nai-diffusion-5-full-inpainting" ? "unknown model" : null) });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(f.allSettled);
    f.setConfig({ imageModel: "nai-diffusion-5-curated" });
    const curated = spriteSetKeyFor(MIRA, spriteStyleKey(f.config));
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(async () => {
      const set = (await f.library()).sets[curated];
      return Boolean(set) && ["smile", "sad", "angry"].every((expression) => set!.images[expression]?.status === "ready");
    });
    expect(f.calls.filter((call) => call.model === "nai-diffusion-5-curated-inpainting")).toHaveLength(3);
    expect(f.log.some((line) => line.includes("nai-diffusion-5-curated-inpainting (unverified model name)"))).toBe(true);
  });

  test("no canvas from the browser (error or timeout): plain expressions, and the browser is not asked again for that idle", async () => {
    for (const inset of ["error", "silent"] as const) {
      const f = setup({ inset });
      await f.service.prepareCast("u1", [MIRA], f.config);
      await f.drive(f.allSettled);
      expect(f.calls.some(inpainting)).toBe(false);
      expect(f.insets()).toHaveLength(1);
      for (const expression of ["smile", "sad", "angry"]) expect((await f.image(expression)).status).toBe("ready");
      expect(f.calls.slice(1).every((call) => call.parameters.resolvedReferenceImages === undefined && call.parameters.resolution === "832x1216")).toBe(true);
      expect(f.log.some((line) => line.includes("reference inset unavailable"))).toBe(true);
    }
  });
});

describe("NovelAI V5 inset: when it applies", () => {
  test("V5 without anchoring: plain expressions, nothing waits for the idle, no inset", async () => {
    const f = setup({ gated: true, config: { referenceAnchoring: false } });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await waitFor(() => f.gates.length === 1);
    f.gates[0]!.release();
    // The next expression starts without the idle's cut-out (its duplicate check).
    await waitFor(() => f.gates.length === 2);
    expect(f.cuts().filter((cut) => cut.expression === "idle")).toHaveLength(1);
    f.gates[1]!.release();
    for (let index = 2; index < 4; index += 1) {
      await waitFor(() => f.gates.length > index);
      f.gates[index]!.release();
    }
    await f.drive(f.allSettled);
    expect(f.insets()).toHaveLength(0);
    expect(f.calls.every((call) => call.model === "nai-diffusion-5-full" && call.parameters.rawRequestOverride === undefined)).toBe(true);
  });

  test("V4.5 with anchoring: the Precise Reference request is exactly what it was", async () => {
    const f = setup({ config: { imageModel: "nai-diffusion-4-5-full" } });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(f.allSettled);
    expect(f.insets()).toHaveLength(0);
    expect(f.cuts().every((cut) => cut.crop === undefined)).toBe(true);
    const set = (await f.library()).sets[f.setKey]!;
    const reference = { data: toBase64(fakePng(8, 8, 4)), mimeType: "image/png" };
    for (const [index, expression] of ["smile", "sad", "angry"].entries()) {
      const request = compileSpriteRequest({ config: f.config, provider: "novelai", member: set, expression, seed: set.seed });
      expect(f.calls[index + 1]).toEqual({
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        model: "nai-diffusion-4-5-full",
        parameters: { ...referenceParametersFor("novelai", reference, f.config), ...request.parameters },
        includeDataUrl: false,
        userId: "u1",
      });
      expect((await f.image(expression)).crop).toBeUndefined();
    }
  });

  test("other providers never get an inset, whatever the model name says", async () => {
    const f = setup({ provider: "comfyui", config: { imageModel: "nai-diffusion-5-full" } });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(f.allSettled);
    expect(f.insets()).toHaveLength(0);
    expect(f.calls.slice(1).every((call) => Array.isArray(call.parameters.resolvedSourceImages))).toBe(true);
  });
});

describe("NovelAI V5 inset: a new idle", () => {
  test("regenerating the idle queues the inset expressions made from the old idle again", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(f.allSettled);
    const oldIdle = (await f.image("idle")).rawImageId!;
    const oldSmile = (await f.image("smile")).rawImageId!;
    const calls = f.calls.length;
    await f.service.action("u1", { type: "vn_sprite_action", action: "regenerate", setKey: f.setKey, expression: "idle" }, { config: f.config });
    await f.drive(async () => {
      const set = (await f.library()).sets[f.setKey]!;
      return set.images.idle!.rawImageId !== oldIdle && ["idle", "smile", "sad", "angry"].every((expression) => set.images[expression]!.status === "ready");
    });
    const newIdle = (await f.image("idle")).rawImageId!;
    expect(newIdle).not.toBe(oldIdle);
    // The idle again, then the three expressions as insets of the new idle.
    expect(f.calls.length - calls).toBe(4);
    for (const expression of ["smile", "sad", "angry"]) expect((await f.image(expression)).insetReference).toBe(newIdle);
    expect(f.insets().slice(-3).every((request) => request.imageId === newIdle)).toBe(true);
    expect(f.deleted).toContain(oldSmile);
    expect(f.log.some((line) => line.includes("requeued inset expressions made from the old one"))).toBe(true);
    // The regenerated idle drew a new set seed; the expressions follow it.
    const set = (await f.library()).sets[f.setKey]!;
    expect(set.seed).not.toBe(spriteSeedFor(f.setKey));
    expect(f.calls.slice(-3).every((call) => call.parameters.seed === set.seed)).toBe(true);
  });

  test("a plain expression (fallback) is not requeued by a new idle", async () => {
    let failInset = true;
    const f = setup({ failGenerate: (call) => (failInset && inpainting(call) ? "unknown model" : null) });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await f.drive(f.allSettled);
    failInset = false;
    const smile = (await f.image("smile")).rawImageId;
    const oldIdle = (await f.image("idle")).rawImageId;
    await f.service.action("u1", { type: "vn_sprite_action", action: "regenerate", setKey: f.setKey, expression: "idle" }, { config: f.config });
    await f.drive(async () => (await f.image("idle")).status === "ready" && (await f.image("idle")).rawImageId !== oldIdle);
    expect((await f.image("smile")).rawImageId).toBe(smile);
    expect((await f.image("smile")).status).toBe("ready");
  });
});
