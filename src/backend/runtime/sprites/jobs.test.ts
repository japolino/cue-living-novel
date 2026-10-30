import { describe, expect, test } from "bun:test";
import { SPRITE_HOT_SET, plateKeyFor, spriteSetKeyFor, type SpriteStaging } from "../../../shared/sprites.js";
import { CUT_META, KAI, MIRA, fakePng, mockSpindle, sampleStaging, spriteConfig, toBase64, waitFor, type MockSpindleOptions } from "./__fixtures__/sprite-fixtures.js";
import { SPRITE_LIBRARY_PATH, type SpriteLibrary } from "./library.js";
import { PLATE_RETRY_AFTER_MS, SpriteService } from "./jobs.js";
import { SPRITE_EXPRESSION_TAGS } from "./prompts.js";
import { spriteStyleKey } from "./style.js";
import type { VisualNovelConfig } from "../../../config.js";

function setup(options: MockSpindleOptions & { config?: Partial<VisualNovelConfig>; open?: boolean; cutTimeoutMs?: number; idleCheckWaitMs?: number } = {}) {
  const mock = mockSpindle(options);
  let open = options.open ?? true;
  let config = spriteConfig(options.config);
  const log: string[] = [];
  const service = new SpriteService(mock.spindle, {
    isViewOpen: () => open,
    openChatId: () => (open ? "chat-1" : null),
    loadConfig: async () => config,
    log: (line) => log.push(line),
    ...(options.cutTimeoutMs !== undefined ? { cutTimeoutMs: options.cutTimeoutMs } : {}),
    ...(options.idleCheckWaitMs !== undefined ? { idleCheckWaitMs: options.idleCheckWaitMs } : {}),
    referenceTimeoutMs: 300,
    retryDelayMs: 5,
  });
  const styleKey = spriteStyleKey(config);
  const started = () => log.filter((line) => line.endsWith("-> generating")).map((line) => line.split(" ")[3]!);
  const library = async () => service.library.get("u1");
  const stored = () => mock.data.get(`u1:${SPRITE_LIBRARY_PATH}`) as SpriteLibrary | undefined;
  const cutRequests = () => mock.of("vn_sprite_cut") as Array<{ requestId: string; imageId: string; setKey: string; expression: string }>;
  const answerCut = (request: { requestId: string }, meta: Record<string, unknown> = CUT_META) => service.handleCutResult("u1", {
    type: "vn_sprite_cut_result", requestId: request.requestId, chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(fakePng()), meta: meta as typeof CUT_META,
  });
  const answered = new Set<string>();
  /** Answer every cut not answered yet (until none is left); `flag` decides the duplicate check per request, `scenery` (when given) the scenery check. */
  const answerAll = async (flag: (request: { expression: string; imageId: string }) => boolean = () => false, scenery?: (request: { expression: string; imageId: string }) => boolean) => {
    for (let guard = 0; guard < 60; guard += 1) {
      const pending = cutRequests().filter((request) => !answered.has(request.requestId));
      if (pending.length === 0) return;
      for (const request of pending) {
        answered.add(request.requestId);
        answerCut(request, { ...CUT_META, twoFigures: flag(request), ...(scenery ? { scenery: scenery(request) } : {}) });
      }
      await service.settle("u1");
    }
  };
  /** Generate calls with the "set/expression" each one rendered (the log order is the call order). */
  const callsBy = () => started().map((name, index) => ({ name, call: mock.calls[index]! }));
  return {
    ...mock, service, log, styleKey, started, library, stored, cutRequests, answerCut, answerAll, answered, callsBy,
    setOpen: (value: boolean) => { open = value; },
    setConfig: (patch: Partial<VisualNovelConfig>) => { config = { ...config, ...patch }; },
  };
}

const label = (setKey: string, expression: string) => `${setKey}/${expression}`;

describe("sprite jobs: ensure, priorities, dedupe", () => {
  test("the turn's plates and needed expressions go first in reading order, then the rare expression, then the fill-in", async () => {
    const f = setup({ gated: true });
    const staging = sampleStaging(f.styleKey);
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    await f.service.ensureForStaging("u1", staging, spriteConfig());
    // Concurrency 1: release one at a time and record the order.
    for (let index = 0; index < SPRITE_HOT_SET.length + 3; index += 1) {
      await waitFor(() => f.gates.length > index);
      f.gates[index]!.release();
    }
    await f.service.settle("u1");
    const [observatory, garden] = staging.plates.map((plate) => plate.plateKey);
    const order = f.started();
    // Paragraph 0 needs the observatory plate and the smile; paragraph 1 the
    // garden plate (a plate before the sprites of its paragraph) and the crying fallback.
    expect(order.slice(0, 4)).toEqual([observatory!, label(setKey, "smile"), garden!, label(setKey, "crying_with_eyes_open")]);
    // Then the rare expression (made on demand in 12 mode), then the fill-in.
    expect(order[4]).toBe(label(setKey, "happy_tears"));
    expect(order.slice(5)).toEqual(SPRITE_HOT_SET.filter((expression) => expression !== "smile" && expression !== "crying_with_eyes_open").map((expression) => label(setKey, expression)));
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length + 3);
    const lib = await f.library();
    expect(lib.sets[setKey]!.images.smile!.status).toBe("cutting");
    expect(lib.plates[observatory!]!.status).toBe("ready");
    expect(lib.plates[observatory!]!.url).toBe("/api/v1/images/raw-1");
  });

  test("a later character's first sprite does not wait behind every expression of the first one", async () => {
    const f = setup({ gated: true });
    const plate = plateKeyFor({ location: "Classroom", timeOfDay: "noon" }, f.styleKey);
    const actor = (characterKey: string, expression: string, slot: "left" | "center" | "right") => ({ characterKey, expression, slot, facing: "viewer" as const, focus: false, motion: "none" as const, emote: "none" as const, intensity: 3 });
    const staging: SpriteStaging = {
      version: 1,
      source: "planner",
      cast: [MIRA, KAI],
      plates: [{ plateKey: plate, location: "Classroom", timeOfDay: "noon", weather: null, description: "desks" }],
      paragraphs: [
        { actors: [actor("mira", "smile", "center")], plateKey: plate, light: "day" },
        { actors: [actor("mira", "smile", "left"), actor("kai", "idle", "right")], plateKey: plate, light: "day" },
        { actors: [actor("mira", "angry", "left"), actor("kai", "idle", "right")], plateKey: plate, light: "day" },
        { actors: [actor("mira", "sad", "left"), actor("kai", "surprised", "right")], plateKey: plate, light: "day" },
      ],
    };
    await f.service.ensureForStaging("u1", staging, spriteConfig());
    for (let index = 0; index < 6; index += 1) {
      await waitFor(() => f.gates.length > index);
      f.gates[index]!.release();
    }
    const mira = spriteSetKeyFor(MIRA, f.styleKey);
    const kai = spriteSetKeyFor(KAI, f.styleKey);
    expect(f.started().slice(0, 6)).toEqual([
      plate,
      label(mira, "smile"),
      label(kai, "idle"),
      label(mira, "angry"),
      label(mira, "sad"),
      label(kai, "surprised"),
    ]);
  });

  test("ensuring the same staging again starts nothing twice", async () => {
    const f = setup({ gated: true, config: { imageConcurrency: 2 } });
    const staging = sampleStaging(f.styleKey);
    await f.service.ensureForStaging("u1", staging, spriteConfig({ imageConcurrency: 2 }));
    await f.service.ensureForStaging("u1", staging, spriteConfig({ imageConcurrency: 2 }));
    await waitFor(() => f.gates.length === 2);
    // Work goes to the provider only when a slot is free (2 at a time).
    expect(f.service.inflightKeys("u1")).toHaveLength(2);
    let released = 0;
    while (released < SPRITE_HOT_SET.length + 3) {
      await waitFor(() => f.gates.length > released);
      f.gates[released]!.release();
      released += 1;
    }
    await f.service.settle("u1");
    await f.service.ensureForStaging("u1", staging, spriteConfig({ imageConcurrency: 2 }));
    await f.service.settle("u1");
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length + 3);
  });

  test("sprite generation uses the portrait size, the set seed and no chat ownership", async () => {
    const f = setup();
    await f.service.ensureForStaging("u1", { ...sampleStaging(f.styleKey), plates: [], paragraphs: sampleStaging(f.styleKey).paragraphs.map((p) => ({ ...p, plateKey: null })) }, spriteConfig());
    await f.service.settle("u1");
    const set = (await f.library()).sets[spriteSetKeyFor(MIRA, f.styleKey)]!;
    for (const call of f.calls) {
      // Default spriteImageSize "standard" (the mock provider is ComfyUI).
      expect(call.parameters.width).toBe(624);
      expect(call.parameters.height).toBe(912);
      expect(call.parameters.seed).toBe(set.seed);
      expect((call as Record<string, unknown>).owner_chat_id).toBeUndefined();
      expect(call.userId).toBe("u1");
      expect(call.prompt).toContain("white background");
    }
    // A failed image is not retried by ensure.
    expect(Object.values(set.images).every((image) => image.status === "cutting")).toBe(true);
  });

  test("a generation failure marks the image failed with the provider's message", async () => {
    const f = setup({ failGenerate: (call) => (call.prompt.includes(SPRITE_EXPRESSION_TAGS.smile!) ? "NovelAI is busy" : null) });
    await f.service.ensureForStaging("u1", sampleStaging(f.styleKey), spriteConfig());
    await f.service.settle("u1");
    const image = (await f.library()).sets[spriteSetKeyFor(MIRA, f.styleKey)]!.images.smile!;
    expect(image.status).toBe("failed");
    expect(image.error).toBe("NovelAI is busy");
    const updates = f.of("vn_sprite_update").filter((message) => (message.image as { expression: string }).expression === "smile");
    expect(updates.at(-1)).toMatchObject({ image: { expression: "smile", status: "failed", error: "NovelAI is busy" } });
    const calls = f.calls.length;
    await f.service.ensureForStaging("u1", sampleStaging(f.styleKey), spriteConfig());
    await f.service.settle("u1");
    expect(f.calls.length).toBe(calls);
  });

  test("generation off (generateImages false) queues but never calls the provider", async () => {
    const f = setup({ config: { generateImages: false } });
    await f.service.ensureForStaging("u1", sampleStaging(f.styleKey), spriteConfig({ generateImages: false }));
    await f.service.settle("u1");
    expect(f.calls).toHaveLength(0);
    expect((await f.library()).sets[spriteSetKeyFor(MIRA, f.styleKey)]!.images.idle!.status).toBe("queued");
  });
});

describe("sprite jobs: view gating", () => {
  test("nothing runs while no view is open; opening resumes the queue", async () => {
    const f = setup({ open: false });
    await f.service.ensureForStaging("u1", sampleStaging(f.styleKey), spriteConfig());
    await f.service.settle("u1");
    expect(f.calls).toHaveLength(0);
    expect(f.stored()!.sets[spriteSetKeyFor(MIRA, f.styleKey)]!.images.smile!.status).toBe("queued");
    f.setOpen(true);
    await f.service.onViewOpened("u1");
    await f.service.settle("u1");
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length + 3);
  });

  test("pause cancels queued work (kept queued) and keeps a render that finishes after the pause", async () => {
    const f = setup({ gated: true });
    const noPlates = { ...sampleStaging(f.styleKey), plates: [], paragraphs: sampleStaging(f.styleKey).paragraphs.map((p) => ({ ...p, plateKey: null })) };
    await f.service.ensureForStaging("u1", noPlates, spriteConfig());
    await waitFor(() => f.gates.length === 1);
    f.setOpen(false);
    f.service.pause("u1");
    f.gates[0]!.release();
    await f.service.settle("u1");
    expect(f.calls).toHaveLength(1);
    const set = (await f.library()).sets[spriteSetKeyFor(MIRA, f.styleKey)]!;
    expect(set.images.smile!.status).toBe("cutting");
    expect(set.images.smile!.rawImageId).toBe("raw-1");
    expect(Object.values(set.images).filter((image) => image.status === "queued")).toHaveLength(SPRITE_HOT_SET.length);
    expect(f.cutRequests()).toHaveLength(0);
    f.setOpen(true);
    await f.service.onViewOpened("u1");
    await waitFor(() => f.gates.length === 2);
    expect(f.cutRequests()).toHaveLength(1);
  });

  test("library state survives a restart: interrupted work resumes in a new service", async () => {
    const f = setup({ gated: true });
    await f.service.ensureForStaging("u1", sampleStaging(f.styleKey), spriteConfig());
    await waitFor(() => f.gates.length === 1);
    await f.service.library.flush("u1");
    const fresh = new SpriteService(f.spindle, { isViewOpen: () => true, loadConfig: async () => spriteConfig() });
    const callsBefore = f.calls.length;
    await fresh.onViewOpened("u1");
    await waitFor(() => f.calls.length > callsBefore);
    expect(f.calls.length).toBe(callsBefore + 1);
  });
});

describe("sprite jobs: reference anchoring", () => {
  test("idle goes first; other expressions are anchored to the idle render", async () => {
    const f = setup({ provider: "novelai", config: { referenceAnchoring: true } });
    await f.service.ensureForStaging("u1", { ...sampleStaging(f.styleKey), plates: [], paragraphs: sampleStaging(f.styleKey).paragraphs.map((p) => ({ ...p, plateKey: null })) }, spriteConfig({ referenceAnchoring: true }));
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    expect(f.started()[0]).toBe(label(setKey, "idle"));
    expect(f.calls[0]!.includeDataUrl).toBe(true);
    expect(f.calls[0]!.parameters.resolvedReferenceImages).toBeUndefined();
    // NovelAI ignores spriteImageSize (default "standard"): its largest free size.
    expect(f.calls[0]!.parameters.resolution).toBe("832x1216");
    expect(f.calls[0]!.parameters.width).toBeUndefined();
    for (const call of f.calls.slice(1)) {
      expect(call.includeDataUrl).toBe(false);
      const refs = call.parameters.resolvedReferenceImages as Array<{ data: string }>;
      expect(refs).toHaveLength(1);
      expect(refs[0]!.data).toBe(toBase64(fakePng(8, 8, 4)));
    }
  });

  test("without the idle data in memory, the reference is relayed by the frontend (and skipped cleanly on timeout)", async () => {
    const f = setup({ provider: "comfyui", config: { referenceAnchoring: true } });
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    // A library where idle is already rendered (e.g. by an earlier worker).
    await f.service.library.update("u1", (library, now) => {
      library.sets[setKey] = {
        setKey, styleKey: f.styleKey, name: "Mira", identity: MIRA.identity, attire: MIRA.attire, seed: 5, seedRound: 0, createdAt: now, updatedAt: now, usedAt: now,
        images: { idle: { expression: "idle", status: "ready", rawImageId: "raw-idle", rawImageUrl: null, cutImageId: "cut-idle", cutUrl: "/api/v1/images/cut-idle", bbox: [0, 0, 1, 1], width: 832, height: 1216, quality: "best", upgrade: null, error: null, attempts: 1, cutAttempts: 0, seed: 5, ownSeed: false, twoFigures: false, scenery: null, autoRetried: false, createdAt: now, updatedAt: now } },
      };
    });
    await f.service.prepareCast("u1", [MIRA], spriteConfig({ referenceAnchoring: true }));
    await waitFor(() => f.of("vn_reference_fetch").length > 0);
    expect(f.of("vn_reference_fetch")[0]).toMatchObject({ imageId: "raw-idle", characterKey: setKey, userId: "u1" });
    await f.service.settle("u1");
    // The relay timed out (no frontend in this test): generation went on
    // unanchored, and the miss is remembered instead of re-asked per expression.
    expect(f.calls.length).toBe(SPRITE_HOT_SET.length - 1);
    expect(f.of("vn_reference_fetch")).toHaveLength(1);
    expect(f.calls[0]!.parameters.resolvedSourceImages).toBeUndefined();
    expect(f.calls[0]!.parameters.denoise).toBe(0);
  });
});

describe("sprite jobs: cut bridge", () => {
  test("a generated sprite is cut by the frontend, uploaded, and broadcast ready", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    // Two cuts in flight at most.
    expect(f.cutRequests()).toHaveLength(2);
    const first = f.cutRequests()[0]!;
    expect(first).toMatchObject({ setKey, expression: "idle", imageId: "raw-1", userId: "u1" });
    f.answerCut(first);
    await f.service.settle("u1");
    const idle = (await f.library()).sets[setKey]!.images.idle!;
    expect(idle.status).toBe("ready");
    expect(idle.cutImageId).toMatch(/^cut-/);
    expect(idle.bbox).toEqual(CUT_META.bbox);
    expect(f.uploads[0]).toMatchObject({ filename: `cue-sprite-${setKey}-idle.png`, userId: "u1" });
    expect(f.of("vn_sprite_update").at(-2) ?? f.of("vn_sprite_update").at(-1)).toBeDefined();
    const ready = f.of("vn_sprite_update").find((message) => (message.image as { status: string }).status === "ready");
    expect(ready).toMatchObject({ setKey, image: { expression: "idle", status: "ready", url: `/api/v1/images/${idle.cutImageId}`, bbox: CUT_META.bbox, width: 832, height: 1216 } });
    // The next pending cut is sent once one settles.
    expect(f.cutRequests()).toHaveLength(3);
  });

  test("cut errors, upload failures and repeated timeouts mark the image failed with a readable error", async () => {
    const f = setup({ cutTimeoutMs: 30 });
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const [first, second] = f.cutRequests();
    f.service.handleCutResult("u1", { type: "vn_sprite_cut_result", requestId: first!.requestId, chunkIndex: 0, chunkCount: 1, error: "WebGPU lost" });
    f.setFailUpload(true);
    f.answerCut(second!);
    await f.service.settle("u1");
    let lib = await f.library();
    expect(lib.sets[setKey]!.images[first!.expression]!).toMatchObject({ status: "failed", error: "Cut-out failed: WebGPU lost" });
    expect(lib.sets[setKey]!.images[second!.expression]!).toMatchObject({ status: "failed", error: "Could not save the cut-out: disk full" });
    // Nobody answers the rest: three timeouts each, then failed.
    await waitFor(() => Object.values(lib.sets[setKey]!.images).every((image) => image.status === "failed"), 4000);
    lib = await f.library();
    expect(lib.sets[setKey]!.images.laughing!.error).toBe("The browser did not return the cut-out in time.");
  });

  test("a stale cut result (regenerated meanwhile) is ignored", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const first = f.cutRequests()[0]!;
    await f.service.action("u1", { type: "vn_sprite_action", action: "regenerate", setKey, expression: first.expression }, { config: spriteConfig() });
    f.answerCut(first);
    await f.service.settle("u1");
    const image = (await f.library()).sets[setKey]!.images[first.expression]!;
    expect(image.rawImageId).not.toBe(first.imageId);
    expect(image.cutImageId).toBeNull();
    expect(f.uploads).toHaveLength(0);
  });

  test("a basic cut made while 'studio' is selected is queued for a re-cut too", async () => {
    const f = setup({ config: { spriteCutout: "studio" } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    f.answerCut(f.cutRequests()[0]!, { ...CUT_META, quality: "basic" });
    await f.service.settle("u1");
    expect(await f.service.queueCutUpgrades("u1")).toBe(1);
  });

  /** Answer every pending cut (with `meta`) until none is left. */
  async function answerPending(f: ReturnType<typeof setup>, meta: Record<string, unknown> = CUT_META): Promise<void> {
    for (let guard = 0; guard < 30; guard += 1) {
      const pending = f.cutRequests().filter((request) => !f.answered.has(request.requestId));
      if (pending.length === 0) return;
      for (const request of pending) { f.answered.add(request.requestId); f.answerCut(request, meta); }
      await f.service.settle("u1");
    }
  }

  test("a Best cut made while the Studio model downloaded gets one Studio re-cut on the next view open", async () => {
    const f = setup({ config: { spriteCutout: "studio" } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    await answerPending(f, { ...CUT_META, provisional: true });
    const idle = async () => (await f.library()).sets[setKey]!.images.idle!;
    expect(await idle()).toMatchObject({ quality: "best", provisional: true, upgrade: null });
    const bestCut = (await idle()).cutImageId;
    const before = f.cutRequests().length;
    await f.service.onViewOpened("u1");
    await f.service.settle("u1");
    const upgrades = f.cutRequests().slice(before);
    expect(upgrades.map((request) => request.expression)).toContain("idle");
    // Still Best (the Studio model is not ready yet): the old cut stays, and that was the one try.
    const idleUpgrade = upgrades.find((request) => request.expression === "idle")!;
    f.answered.add(idleUpgrade.requestId);
    f.answerCut(idleUpgrade, { ...CUT_META, provisional: true });
    await f.service.settle("u1");
    expect(await idle()).toMatchObject({ cutImageId: bestCut, provisional: true, upgrade: "done" });
    // The others get the Studio model: replaced, no longer provisional.
    await answerPending(f, { ...CUT_META, studio: true });
    const others = Object.values((await f.library()).sets[setKey]!.images).filter((image) => image.expression !== "idle" && image.status === "ready");
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((image) => image.provisional === undefined && image.upgrade === "done")).toBe(true);
    const count = f.cutRequests().length;
    await f.service.onViewOpened("u1");
    await f.service.settle("u1");
    expect(f.cutRequests().length).toBe(count);
  });

  test("provisional cuts are not re-cut while 'best' is selected; a basic cut re-cut by a provisional Best one still gets its Studio try", async () => {
    const best = setup({ config: { spriteCutout: "best" } });
    await best.service.prepareCast("u1", [MIRA], spriteConfig());
    await best.service.settle("u1");
    await answerPending(best, { ...CUT_META, provisional: true });
    expect(await best.service.queueCutUpgrades("u1")).toBe(0);

    const f = setup({ config: { spriteCutout: "studio" } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    await answerPending(f, { ...CUT_META, quality: "basic" });
    await f.service.onViewOpened("u1");
    await f.service.settle("u1");
    await answerPending(f, { ...CUT_META, provisional: true });
    const idle = (await f.library()).sets[setKey]!.images.idle!;
    expect(idle).toMatchObject({ quality: "best", provisional: true, upgrade: null });
    await f.service.onViewOpened("u1");
    await f.service.settle("u1");
    await answerPending(f, { ...CUT_META, studio: true });
    expect((await f.library()).sets[setKey]!.images.idle!).toMatchObject({ quality: "best", upgrade: "done" });
    expect((await f.library()).sets[setKey]!.images.idle!.provisional).toBeUndefined();
  });

  test("the cut-out model arriving in the browser re-cuts the Basic cuts at once (no view reopen); nothing to re-cut sends nothing", async () => {
    const f = setup({ config: { spriteCutout: "best" } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    // First use: every cut is Basic while the model downloads.
    await answerPending(f, { ...CUT_META, quality: "basic" });
    const before = f.cutRequests().length;
    const basicCount = Object.values((await f.library()).sets[setKey]!.images).filter((image) => image.quality === "basic").length;
    expect(basicCount).toBeGreaterThan(0);
    expect(await f.service.onCutoutModelArrived("u1")).toBe(basicCount);
    await f.service.settle("u1");
    expect(f.cutRequests().length).toBeGreaterThan(before);
    await answerPending(f);
    expect(Object.values((await f.library()).sets[setKey]!.images).every((image) => image.quality === "best")).toBe(true);
    // Again (the Studio download, say): nothing left to re-cut.
    const count = f.cutRequests().length;
    expect(await f.service.onCutoutModelArrived("u1")).toBe(0);
    await f.service.settle("u1");
    expect(f.cutRequests().length).toBe(count);
  });

  test("a re-cut that is Basic again because the model is still downloading keeps its re-cut for the arrival", async () => {
    const f = setup({ config: { spriteCutout: "best" } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    await answerPending(f, { ...CUT_META, quality: "basic", modelPending: true });
    // The view reopens (or the page reloads) while Best still downloads: the re-cuts are Basic again.
    await f.service.onViewOpened("u1");
    await f.service.settle("u1");
    await answerPending(f, { ...CUT_META, quality: "basic", modelPending: true });
    const images = () => f.library().then((library) => Object.values(library.sets[setKey]!.images));
    expect((await images()).every((image) => image.quality === "basic" && image.upgrade === null)).toBe(true);
    // The model arrives: every one of them is re-cut with it.
    expect(await f.service.onCutoutModelArrived("u1")).toBe((await images()).length);
    await f.service.settle("u1");
    await answerPending(f);
    expect((await images()).every((image) => image.quality === "best" && image.upgrade === "done")).toBe(true);
  });

  test("a cut still out when the model arrives comes back Basic and is re-cut at once", async () => {
    const f = setup({ config: { spriteCutout: "best" } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const first = f.cutRequests()[0]!;
    // The model arrives while this cut is still being made (Basic: it started without the model).
    expect(await f.service.onCutoutModelArrived("u1")).toBe(0);
    const before = f.cutRequests().length;
    f.answered.add(first.requestId);
    f.answerCut(first, { ...CUT_META, quality: "basic", modelPending: true });
    await f.service.settle("u1");
    expect((await f.library()).sets[setKey]!.images.idle!).toMatchObject({ status: "ready", quality: "basic", upgrade: "pending" });
    // The re-cut goes out after the cuts still in flight (lower priority) and uses the model.
    await answerPending(f);
    const recut = f.cutRequests().slice(before).filter((request) => request.imageId === first.imageId);
    expect(recut).toHaveLength(1);
    expect((await f.library()).sets[setKey]!.images.idle!).toMatchObject({ quality: "best", upgrade: "done" });
    // A re-cut sent after the arrival that is Basic again (a reloaded page downloads again) waits for the next arrival: no loop.
    const g = setup({ config: { spriteCutout: "best" } });
    await g.service.prepareCast("u1", [MIRA], spriteConfig());
    await g.service.settle("u1");
    await g.service.onCutoutModelArrived("u1");
    const sent = g.cutRequests().length;
    await answerPending(g, { ...CUT_META, quality: "basic", modelPending: true });
    await g.service.settle("u1");
    const gKey = spriteSetKeyFor(MIRA, g.styleKey);
    expect(Object.values((await g.library()).sets[gKey]!.images).every((image) => image.upgrade === null)).toBe(true);
    expect(g.cutRequests().length).toBeGreaterThanOrEqual(sent);
  });

  test("a basic cut made while 'best' is selected is re-cut once on the next view open, silently", async () => {
    const f = setup({ config: { spriteCutout: "best" } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const first = f.cutRequests()[0]!;
    f.answerCut(first, { ...CUT_META, quality: "basic" });
    await f.service.settle("u1");
    const basicCut = (await f.library()).sets[setKey]!.images.idle!.cutImageId;
    expect((await f.library()).sets[setKey]!.images.idle!.quality).toBe("basic");
    // Answer every other pending cut so only the upgrade remains.
    const answered = new Set<string>([first.requestId]);
    for (let guard = 0; guard < 30; guard += 1) {
      const pending = f.cutRequests().filter((request) => !answered.has(request.requestId));
      if (pending.length === 0) break;
      for (const request of pending) { answered.add(request.requestId); f.answerCut(request); }
      await f.service.settle("u1");
    }
    const before = f.cutRequests().length;
    await f.service.onViewOpened("u1");
    await f.service.settle("u1");
    const upgrade = f.cutRequests().slice(before);
    expect(upgrade).toHaveLength(1);
    expect(upgrade[0]).toMatchObject({ expression: "idle", imageId: first.imageId });
    // Still shown while re-cutting.
    expect((await f.library()).sets[setKey]!.images.idle!.status).toBe("ready");
    f.answerCut(upgrade[0]!);
    await f.service.settle("u1");
    const idle = (await f.library()).sets[setKey]!.images.idle!;
    expect(idle.quality).toBe("best");
    expect(idle.upgrade).toBe("done");
    expect(f.deleted).toContain(basicCut!);
    // Only once.
    const count = f.cutRequests().length;
    await f.service.onViewOpened("u1");
    await f.service.settle("u1");
    expect(f.cutRequests().length).toBe(count);
  });
});

describe("sprite jobs: library actions", () => {
  async function readySet(f: ReturnType<typeof setup>) {
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const answered = new Set<string>();
    for (let guard = 0; guard < 20; guard += 1) {
      const pending = f.cutRequests().filter((request) => !answered.has(request.requestId));
      if (pending.length === 0) break;
      for (const request of pending) { answered.add(request.requestId); f.answerCut(request); }
      await f.service.settle("u1");
    }
    return spriteSetKeyFor(MIRA, f.styleKey);
  }

  test("prepare_chat builds sets for the chat's cast and replies with the library", async () => {
    const f = setup({ config: { presentationMode: "scene" } });
    await f.service.action("u1", { type: "vn_sprite_action", action: "prepare_chat", chatId: "chat-1" }, { config: spriteConfig({ presentationMode: "scene" }), castForChat: async () => [MIRA, KAI] });
    await f.service.settle("u1");
    // Explicit work runs even in scene mode.
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length * 2);
    const reply = f.of("vn_sprite_library").at(-1) as { sets: Array<{ name: string }> };
    expect(reply.sets.map((set) => set.name).sort()).toEqual(["Kai", "Mira"]);
    await expect(f.service.action("u1", { type: "vn_sprite_action", action: "prepare_chat", chatId: "chat-1" }, { config: spriteConfig(), castForChat: async () => [] })).rejects.toThrow("No characters");
    expect(f.of("vn_sprite_library")).toHaveLength(2);
  });

  test("regenerate one expression: old images deleted, a new seed, new render", async () => {
    const f = setup();
    const setKey = await readySet(f);
    const before = { ...(await f.library()).sets[setKey]!.images.smile! };
    expect(before.status).toBe("ready");
    const calls = f.calls.length;
    await f.service.action("u1", { type: "vn_sprite_action", action: "regenerate", setKey, expression: "smile" }, { config: spriteConfig() });
    await f.service.settle("u1");
    expect(f.deleted).toEqual(expect.arrayContaining([before.rawImageId!, before.cutImageId!]));
    expect(f.calls.length).toBe(calls + 1);
    expect(f.calls.at(-1)!.parameters.seed).not.toBe((await f.library()).sets[setKey]!.seed);
    expect((await f.library()).sets[setKey]!.images.smile!.status).toBe("cutting");
    expect(f.of("vn_sprite_library").length).toBeGreaterThan(0);
  });

  test("changing spriteImageSize keeps the set: nothing regenerates; new renders use the new size", async () => {
    const f = setup();
    const setKey = await readySet(f);
    expect(f.calls.every((call) => call.parameters.width === 624 && call.parameters.height === 912)).toBe(true);
    const calls = f.calls.length;
    f.setConfig({ spriteImageSize: "upscaled" });
    const upscaled = spriteConfig({ spriteImageSize: "upscaled" });
    expect(spriteStyleKey(upscaled)).toBe(f.styleKey);
    await f.service.prepareCast("u1", [MIRA], upscaled);
    await f.service.settle("u1");
    expect(f.calls.length).toBe(calls);
    expect(spriteSetKeyFor(MIRA, spriteStyleKey(upscaled))).toBe(setKey);
    await f.service.action("u1", { type: "vn_sprite_action", action: "regenerate", setKey, expression: "smile" }, { config: upscaled });
    await f.service.settle("u1");
    expect(f.calls.length).toBe(calls + 1);
    expect(f.calls.at(-1)!.parameters).toMatchObject({ width: 832, height: 1216 });
  });

  test("recut re-sends the raw image; without one it rejects cleanly after replying", async () => {
    const f = setup();
    const setKey = await readySet(f);
    const raw = (await f.library()).sets[setKey]!.images.sad!.rawImageId;
    const cuts = f.cutRequests().length;
    await f.service.action("u1", { type: "vn_sprite_action", action: "recut", setKey, expression: "sad" }, { config: spriteConfig() });
    expect(f.cutRequests().length).toBe(cuts + 1);
    expect(f.cutRequests().at(-1)).toMatchObject({ expression: "sad", imageId: raw });
    expect((await f.library()).sets[setKey]!.images.sad!.status).toBe("cutting");
    await f.service.library.update("u1", (library) => { library.sets[setKey]!.images.angry!.rawImageId = null; });
    const replies = f.of("vn_sprite_library").length;
    await expect(f.service.action("u1", { type: "vn_sprite_action", action: "recut", setKey, expression: "angry" }, { config: spriteConfig() })).rejects.toThrow("no generated image");
    expect(f.of("vn_sprite_library").length).toBe(replies + 1);
  });

  test("delete_set removes the set and deletes its images; delete_plate and regenerate_plate", async () => {
    const f = setup();
    const staging = sampleStaging(f.styleKey);
    await f.service.ensureForStaging("u1", staging, spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const raws = Object.values((await f.library()).sets[setKey]!.images).map((image) => image.rawImageId).filter(Boolean);
    await f.service.action("u1", { type: "vn_sprite_action", action: "delete_set", setKey }, { config: spriteConfig() });
    expect((await f.library()).sets[setKey]).toBeUndefined();
    expect(f.deleted).toEqual(expect.arrayContaining(raws as string[]));
    expect((f.of("vn_sprite_library").at(-1) as { sets: unknown[] }).sets).toHaveLength(0);
    const [observatory, garden] = staging.plates.map((plate) => plate.plateKey) as [string, string];
    const oldPlate = (await f.library()).plates[observatory]!.imageId!;
    const calls = f.calls.length;
    await f.service.action("u1", { type: "vn_sprite_action", action: "regenerate_plate", plateKey: observatory }, { config: spriteConfig() });
    await f.service.settle("u1");
    expect(f.calls.length).toBe(calls + 1);
    expect(f.deleted).toContain(oldPlate);
    expect((await f.library()).plates[observatory]!.imageId).not.toBe(oldPlate);
    expect(f.of("vn_plate_update").at(-1)).toMatchObject({ plate: { plateKey: observatory, status: "ready" } });
    await f.service.action("u1", { type: "vn_sprite_action", action: "delete_plate", plateKey: garden }, { config: spriteConfig() });
    expect((await f.library()).plates[garden]).toBeUndefined();
    await expect(f.service.action("u1", { type: "vn_sprite_action", action: "delete_set", setKey: "set_gone" }, { config: spriteConfig() })).rejects.toThrow("no longer in the library");
  });

  test("retryFailed re-queues failed images of the staged turn", async () => {
    const f = setup({ failGenerate: () => "boom" });
    const staging = sampleStaging(f.styleKey);
    await f.service.ensureForStaging("u1", staging, spriteConfig());
    await f.service.settle("u1");
    const failedCalls = f.calls.length;
    expect(Object.values((await f.library()).plates).every((plate) => plate.status === "failed")).toBe(true);
    const count = await f.service.retryFailed("u1", staging, spriteConfig());
    expect(count).toBe(failedCalls);
    await f.service.settle("u1");
    expect(f.calls.length).toBe(failedCalls * 2);
  });

  const LOCKED = "NovelAI image generate failed (429): Concurrent generation is locked";
  const telescope = (call: { prompt: string }) => call.prompt.includes("brass telescope");

  test("a render that fails for a passing reason (NovelAI's 429 lock) is asked for once more, silently", async () => {
    let locked = true;
    const f = setup({ failGenerate: (call) => (telescope(call) && locked ? ((locked = false), LOCKED) : null) });
    const staging = sampleStaging(f.styleKey);
    const observatory = staging.plates[0]!.plateKey;
    await f.service.ensureForStaging("u1", staging, spriteConfig());
    await f.service.settle("u1");
    expect(f.calls.filter(telescope)).toHaveLength(2);
    const plate = (await f.library()).plates[observatory]!;
    expect(plate.status).toBe("ready");
    expect(plate.error).toBeNull();
    expect(f.log.some((line) => line.startsWith(`${observatory}: image request failed for a passing reason`))).toBe(true);
  });

  test("a plate still failing for a passing reason goes again when a turn needs it a minute later", async () => {
    let locked = true;
    const f = setup({ failGenerate: (call) => (telescope(call) && locked ? LOCKED : null) });
    const staging = sampleStaging(f.styleKey);
    const observatory = staging.plates[0]!.plateKey;
    await f.service.ensureForStaging("u1", staging, spriteConfig());
    await f.service.settle("u1");
    // Both tries hit the lock.
    expect(f.calls.filter(telescope)).toHaveLength(2);
    expect((await f.library()).plates[observatory]!).toMatchObject({ status: "failed", error: LOCKED });
    // The turn shown again at once: not yet.
    await f.service.ensureForStaging("u1", staging, spriteConfig());
    await f.service.settle("u1");
    expect(f.calls.filter(telescope)).toHaveLength(2);
    // A minute later, the lock gone: the next view of the turn makes it.
    await f.service.library.update("u1", (library) => {
      library.plates[observatory]!.updatedAt = new Date(Date.now() - PLATE_RETRY_AFTER_MS - 1_000).toISOString();
    });
    locked = false;
    await f.service.ensureForStaging("u1", staging, spriteConfig());
    await f.service.settle("u1");
    expect(f.calls.filter(telescope)).toHaveLength(3);
    expect((await f.library()).plates[observatory]!).toMatchObject({ status: "ready", error: null });
  });

  test("a refused render (400) is not retried and its plate stays failed", async () => {
    const refused = "NovelAI image generate failed (400): bad prompt";
    const f = setup({ failGenerate: (call) => (telescope(call) ? refused : null) });
    const staging = sampleStaging(f.styleKey);
    const observatory = staging.plates[0]!.plateKey;
    await f.service.ensureForStaging("u1", staging, spriteConfig());
    await f.service.settle("u1");
    expect(f.calls.filter(telescope)).toHaveLength(1);
    await f.service.library.update("u1", (library) => {
      library.plates[observatory]!.updatedAt = new Date(Date.now() - PLATE_RETRY_AFTER_MS - 1_000).toISOString();
    });
    await f.service.ensureForStaging("u1", staging, spriteConfig());
    await f.service.settle("u1");
    expect(f.calls.filter(telescope)).toHaveLength(1);
    expect((await f.library()).plates[observatory]!).toMatchObject({ status: "failed", error: refused });
  });

  test("retry_failed (the stage's Try again): one set's failed cuts are cut again from their render, failed renders are made again", async () => {
    // The first two renders work (their cuts then fail in the browser); the rest fail at the provider.
    let failing = true;
    let renders = 0;
    const f = setup({ failGenerate: () => (failing && ++renders > 2 ? "boom" : null) });
    await f.service.prepareCast("u1", [MIRA, KAI], spriteConfig());
    await f.service.settle("u1");
    const mira = spriteSetKeyFor(MIRA, f.styleKey);
    const kai = spriteSetKeyFor(KAI, f.styleKey);
    for (let guard = 0; guard < 30; guard += 1) {
      const pending = f.cutRequests().filter((request) => !f.answered.has(request.requestId));
      if (pending.length === 0) break;
      for (const request of pending) {
        f.answered.add(request.requestId);
        f.service.handleCutResult("u1", { type: "vn_sprite_cut_result", requestId: request.requestId, chunkIndex: 0, chunkCount: 1, error: "WebGPU lost" });
      }
      await f.service.settle("u1");
    }
    const failed = (key: string) => Object.values(f.stored()!.sets[key]!.images).filter((image) => image.status === "failed");
    const miraFailed = failed(mira);
    const withRender = miraFailed.filter((image) => image.rawImageId);
    const withoutRender = miraFailed.filter((image) => !image.rawImageId);
    expect(withRender.length).toBeGreaterThan(0);
    expect(withoutRender.length).toBeGreaterThan(0);
    const kaiFailed = failed(kai).length;
    failing = false;
    const calls = f.calls.length;
    const cuts = f.cutRequests().length;
    await f.service.action("u1", { type: "vn_sprite_action", action: "retry_failed", setKey: mira }, { config: spriteConfig() });
    await f.service.settle("u1");
    // A re-cut of each render (the same image), a new render for the rest; Kai's failures stay.
    const recuts = f.cutRequests().slice(cuts).filter((request) => request.setKey === mira);
    expect(recuts.map((request) => request.imageId)).toEqual(expect.arrayContaining(withRender.map((image) => image.rawImageId)));
    expect(f.calls.length - calls).toBe(withoutRender.length);
    expect(failed(kai)).toHaveLength(kaiFailed);
    expect(f.of("vn_sprite_library").length).toBeGreaterThan(0);
    await expect(f.service.action("u1", { type: "vn_sprite_action", action: "retry_failed", setKey: "set_gone" }, { config: spriteConfig() })).rejects.toThrow("no longer in the library");
  });

  test("the library is bounded: an evicted set's images are deleted", async () => {
    const mock = mockSpindle();
    const service = new SpriteService(mock.spindle, { isViewOpen: () => true, loadConfig: async () => spriteConfig(), libraryLimits: { sets: 1 } });
    await service.prepareCast("u1", [MIRA], spriteConfig());
    await service.settle("u1");
    const miraRaws = mock.calls.length;
    await service.prepareCast("u1", [KAI], spriteConfig());
    await service.settle("u1");
    const library = await service.library.get("u1");
    expect(Object.values(library.sets).map((set) => set.name)).toEqual(["Kai"]);
    expect(mock.deleted.filter((id) => id.startsWith("raw-")).length).toBe(miraRaws);
  });
});

describe("sprite jobs: reference strength", () => {
  async function expressionCalls(imageParameters: Record<string, unknown>) {
    const f = setup({ provider: "comfyui", config: { referenceAnchoring: true, imageParameters } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig({ referenceAnchoring: true, imageParameters }));
    await f.service.settle("u1");
    await f.answerAll();
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const calls = f.callsBy();
    expect(calls).toHaveLength(SPRITE_HOT_SET.length);
    expect(calls[0]!.name).toBe(label(setKey, "idle"));
    expect(calls[0]!.call.parameters.resolvedSourceImages).toBeUndefined();
    return calls.slice(1).map((entry) => entry.call.parameters);
  }

  test("ComfyUI sprite expressions default to strength 0.5 (sent as denoise)", async () => {
    for (const parameters of await expressionCalls({})) {
      expect(parameters.resolvedSourceImages).toHaveLength(1);
      expect(parameters.denoise).toBe(0.5);
    }
  });

  test("the user's referenceStrength or denoise wins", async () => {
    for (const parameters of await expressionCalls({ referenceStrength: 0.8 })) expect(parameters.denoise).toBe(0.8);
    for (const parameters of await expressionCalls({ denoise: 0.3 })) expect(parameters.denoise).toBe(0.3);
  });
});

describe("sprite jobs: duplicate check", () => {
  test("a flagged expression gets one automatic regeneration with its own seed; a flagged retry is kept", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const set = (await f.library()).sets[setKey]!;
    const firstSmileRaw = set.images.smile!.rawImageId!;
    await f.answerAll((request) => request.expression === "smile");
    await f.service.settle("u1");
    const smiles = f.callsBy().filter((entry) => entry.name === label(setKey, "smile"));
    expect(smiles).toHaveLength(2);
    expect(smiles[0]!.call.parameters.seed).toBe(set.seed);
    expect(smiles[1]!.call.parameters.seed).not.toBe(set.seed);
    // Nothing else was regenerated.
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length + 1);
    const smile = (await f.library()).sets[setKey]!.images.smile!;
    expect(smile).toMatchObject({ status: "ready", twoFigures: true, autoRetried: true, ownSeed: true });
    expect(smile.rawImageId).not.toBe(firstSmileRaw);
    expect(f.deleted).toContain(firstSmileRaw);
    // The flagged first cut was never uploaded; the kept retry was.
    expect(f.uploads).toHaveLength(SPRITE_HOT_SET.length);
    const view = await f.service.libraryView("u1");
    expect(view.sets[0]!.expressions.smile).toMatchObject({ status: "ready", twoFigures: true });
    expect(view.sets[0]!.expressions.idle!.twoFigures).toBeUndefined();
    expect((await f.library()).sets[setKey]!.images.idle!.twoFigures).toBe(false);
    // The set seed did not change for an expression.
    expect((await f.library()).sets[setKey]!.seed).toBe(set.seed);
  });

  test("a flagged idle draws a new set seed: idle again, then every expression with the new seed and the new idle as reference", async () => {
    const f = setup({ provider: "comfyui", config: { referenceAnchoring: true } });
    const config = spriteConfig({ referenceAnchoring: true });
    await f.service.prepareCast("u1", [MIRA], config);
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const oldSeed = (await f.library()).sets[setKey]!.seed;
    // Only the idle ran: the expressions wait for its duplicate check.
    expect(f.started()).toEqual([label(setKey, "idle")]);
    const firstIdle = (await f.library()).sets[setKey]!.images.idle!.rawImageId!;
    await f.answerAll((request) => request.imageId === firstIdle);
    await f.service.settle("u1");
    const set = (await f.library()).sets[setKey]!;
    expect(set.seedRound).toBe(1);
    expect(set.seed).not.toBe(oldSeed);
    const calls = f.callsBy();
    expect(calls.map((entry) => entry.name).slice(0, 2)).toEqual([label(setKey, "idle"), label(setKey, "idle")]);
    expect(calls).toHaveLength(SPRITE_HOT_SET.length + 1);
    expect(calls[1]!.call.parameters.seed).toBe(set.seed);
    for (const entry of calls.slice(2)) {
      expect(entry.call.parameters.seed).toBe(set.seed);
      expect(entry.call.parameters.resolvedSourceImages).toHaveLength(1);
    }
    expect(set.images.idle).toMatchObject({ status: "ready", twoFigures: false, autoRetried: true, seed: set.seed });
    expect(set.images.idle!.rawImageId).not.toBe(firstIdle);
    expect(f.deleted).toContain(firstIdle);
    // The reference came from the new idle render in memory (no relay for the dropped one).
    expect(f.of("vn_reference_fetch")).toHaveLength(0);
    expect(Object.values(set.images).every((image) => image.status === "ready")).toBe(true);
  });

  test("the wait for the idle's check is bounded; expressions that ran with the old seed are queued again when the idle is flagged", async () => {
    const f = setup({ provider: "comfyui", config: { referenceAnchoring: true }, idleCheckWaitMs: 40 });
    const config = spriteConfig({ referenceAnchoring: true });
    await f.service.prepareCast("u1", [MIRA], config);
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    // Nobody answers the idle's cut: after 40 ms the expressions go ahead with the shared seed.
    await waitFor(() => f.calls.length === SPRITE_HOT_SET.length);
    await f.service.settle("u1");
    const oldSeed = (await f.library()).sets[setKey]!.seed;
    expect(f.calls.every((call) => call.parameters.seed === oldSeed)).toBe(true);
    const before = (await f.library()).sets[setKey]!;
    const oldRaws = Object.values(before.images).map((image) => image.rawImageId!);
    const firstIdle = before.images.idle!.rawImageId!;
    // The idle's cut is asked for first.
    expect(f.cutRequests()[0]).toMatchObject({ expression: "idle", imageId: firstIdle });
    await f.answerAll((request) => request.imageId === firstIdle);
    await f.service.settle("u1");
    const set = (await f.library()).sets[setKey]!;
    expect(set.seed).not.toBe(oldSeed);
    // 12 with the old seed, then the idle and the 11 expressions again with the new one.
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length * 2);
    expect(f.calls.slice(SPRITE_HOT_SET.length).every((call) => call.parameters.seed === set.seed)).toBe(true);
    expect(f.deleted).toEqual(expect.arrayContaining(oldRaws));
    expect(Object.values(set.images).every((image) => image.status === "ready" && image.seed === set.seed)).toBe(true);
  });

  test("an older frontend without the check: nothing is regenerated", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    for (let guard = 0; guard < 20; guard += 1) {
      const pending = f.cutRequests().filter((request) => !f.answered.has(request.requestId));
      if (!pending.length) break;
      for (const request of pending) { f.answered.add(request.requestId); f.answerCut(request); }
      await f.service.settle("u1");
    }
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length);
    expect(Object.values((await f.library()).sets[spriteSetKeyFor(MIRA, f.styleKey)]!.images).every((image) => image.status === "ready" && image.twoFigures === null)).toBe(true);
  });
});

describe("sprite jobs: scenery check", () => {
  test("an expression with scenery gets one automatic regeneration with its own seed; a flagged retry is kept and shown", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const set = (await f.library()).sets[setKey]!;
    const firstSmileRaw = set.images.smile!.rawImageId!;
    await f.answerAll(() => false, (request) => request.expression === "smile");
    await f.service.settle("u1");
    const smiles = f.callsBy().filter((entry) => entry.name === label(setKey, "smile"));
    expect(smiles).toHaveLength(2);
    expect(smiles[0]!.call.parameters.seed).toBe(set.seed);
    expect(smiles[1]!.call.parameters.seed).not.toBe(set.seed);
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length + 1);
    expect(f.log).toContain(`sprite ${setKey}/smile: scenery -> regenerate`);
    const smile = (await f.library()).sets[setKey]!.images.smile!;
    expect(smile).toMatchObject({ status: "ready", scenery: true, twoFigures: false, autoRetried: true, ownSeed: true });
    expect(f.deleted).toContain(firstSmileRaw);
    expect(f.uploads).toHaveLength(SPRITE_HOT_SET.length);
    const view = await f.service.libraryView("u1");
    expect(view.sets[0]!.expressions.smile).toMatchObject({ status: "ready", scenery: true });
    expect(view.sets[0]!.expressions.idle!.scenery).toBeUndefined();
    expect((await f.library()).sets[setKey]!.images.idle!.scenery).toBe(false);
    expect((await f.library()).sets[setKey]!.seed).toBe(set.seed);
  });

  test("two figures and scenery share the one automatic regeneration", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const firstSmileRaw = (await f.library()).sets[setKey]!.images.smile!.rawImageId!;
    // The first smile has scenery, its retry two figures: the retry is kept.
    await f.answerAll(
      (request) => request.expression === "smile" && request.imageId !== firstSmileRaw,
      (request) => request.imageId === firstSmileRaw,
    );
    await f.service.settle("u1");
    expect(f.callsBy().filter((entry) => entry.name === label(setKey, "smile"))).toHaveLength(2);
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length + 1);
    expect((await f.library()).sets[setKey]!.images.smile).toMatchObject({ status: "ready", twoFigures: true, scenery: false, autoRetried: true });
  });

  test("an idle with scenery draws a new set seed for the whole set", async () => {
    const f = setup({ provider: "comfyui", config: { referenceAnchoring: true } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig({ referenceAnchoring: true }));
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const oldSeed = (await f.library()).sets[setKey]!.seed;
    expect(f.started()).toEqual([label(setKey, "idle")]);
    const firstIdle = (await f.library()).sets[setKey]!.images.idle!.rawImageId!;
    await f.answerAll(() => false, (request) => request.imageId === firstIdle);
    await f.service.settle("u1");
    const set = (await f.library()).sets[setKey]!;
    expect(set.seedRound).toBe(1);
    expect(set.seed).not.toBe(oldSeed);
    expect(f.callsBy().map((entry) => entry.name).slice(0, 2)).toEqual([label(setKey, "idle"), label(setKey, "idle")]);
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length + 1);
    expect(f.calls.slice(1).every((call) => call.parameters.seed === set.seed)).toBe(true);
    expect(set.images.idle).toMatchObject({ status: "ready", scenery: false, autoRetried: true, seed: set.seed });
    expect(f.log.some((line) => line.startsWith(`sprite ${setKey}/idle: scenery -> regenerate with a new set seed`))).toBe(true);
  });

  test("anchored expressions drawn from an idle that kept scenery are not rendered again for it", async () => {
    const f = setup({ provider: "comfyui", config: { referenceAnchoring: true } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig({ referenceAnchoring: true }));
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    // The idle and its automatic retry both keep scenery; every expression inherits it.
    await f.answerAll(() => false, () => true);
    await f.service.settle("u1");
    expect(f.callsBy().filter((entry) => entry.name === label(setKey, "idle"))).toHaveLength(2);
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length + 1);
    expect(f.log.some((line) => /\/(?!idle)\w+: scenery -> regenerate/.test(line))).toBe(false);
    const set = (await f.library()).sets[setKey]!;
    expect(set.images.idle).toMatchObject({ status: "ready", scenery: true, autoRetried: true });
    expect(set.images.smile).toMatchObject({ status: "ready", scenery: true, autoRetried: false });
  });

  test("an idle cut without the check (basic or pre-cut): anchored expressions keep their scenery cut", async () => {
    const f = setup({ provider: "comfyui", config: { referenceAnchoring: true } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig({ referenceAnchoring: true }));
    await f.service.settle("u1");
    for (let guard = 0; guard < 30; guard += 1) {
      const pending = f.cutRequests().filter((request) => !f.answered.has(request.requestId));
      if (!pending.length) break;
      for (const request of pending) {
        f.answered.add(request.requestId);
        f.answerCut(request, request.expression === "idle" ? { ...CUT_META, twoFigures: false } : { ...CUT_META, twoFigures: false, scenery: true });
      }
      await f.service.settle("u1");
    }
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length);
    expect((await f.library()).sets[spriteSetKeyFor(MIRA, f.styleKey)]!.images.idle!.scenery).toBeNull();
  });

  test("an idle checked clean: an anchored expression with scenery is rendered again", async () => {
    const f = setup({ provider: "comfyui", config: { referenceAnchoring: true } });
    await f.service.prepareCast("u1", [MIRA], spriteConfig({ referenceAnchoring: true }));
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    await f.answerAll(() => false, (request) => request.expression === "smile");
    await f.service.settle("u1");
    expect(f.callsBy().filter((entry) => entry.name === label(setKey, "smile"))).toHaveLength(2);
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length + 1);
    expect(f.log).toContain(`sprite ${setKey}/smile: scenery -> regenerate`);
  });

  test("a user Re-cut never regenerates, even of a render whose first cut ran no check", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    // First cuts from an older page: no check, so both flags stay null (as on legacy images).
    for (let guard = 0; guard < 20; guard += 1) {
      const pending = f.cutRequests().filter((request) => !f.answered.has(request.requestId));
      if (!pending.length) break;
      for (const request of pending) { f.answered.add(request.requestId); f.answerCut(request); }
      await f.service.settle("u1");
    }
    const raw = (await f.library()).sets[setKey]!.images.smile!.rawImageId!;
    expect((await f.library()).sets[setKey]!.images.smile).toMatchObject({ status: "ready", twoFigures: null, scenery: null });
    await f.service.action("u1", { type: "vn_sprite_action", action: "recut", setKey, expression: "smile" }, { config: spriteConfig() });
    await f.answerAll(() => true, () => true);
    await f.service.settle("u1");
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length);
    expect(f.deleted).not.toContain(raw);
    expect((await f.library()).sets[setKey]!.images.smile).toMatchObject({ status: "ready", rawImageId: raw, twoFigures: true, scenery: true, autoRetried: false });
  });

  test("the stage's Retry of a failed cut keeps the render it cuts again", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    // The first cuts are clean, but saving them fails: the renders stay, unchecked for the next cut.
    f.setFailUpload(true);
    await f.answerAll();
    await f.service.settle("u1");
    expect((await f.library()).sets[setKey]!.images.smile!.status).toBe("failed");
    f.setFailUpload(false);
    const raw = (await f.library()).sets[setKey]!.images.smile!.rawImageId!;
    await f.service.retryFailed("u1", sampleStaging(f.styleKey), spriteConfig());
    await f.answerAll(() => false, (request) => request.expression === "smile");
    await f.service.settle("u1");
    // Retry also renders the staged turn's plates; the smile is not rendered again.
    expect(f.callsBy().filter((entry) => entry.name === label(setKey, "smile"))).toHaveLength(1);
    expect((await f.library()).sets[setKey]!.images.smile).toMatchObject({ status: "ready", rawImageId: raw, scenery: true });
  });

  test("a cut without the check (basic, or one the workflow made) is kept and stays unchecked", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    // CUT_META carries no scenery field: what a pre-cut source or a basic cut sends.
    await f.answerAll();
    await f.service.settle("u1");
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length);
    expect(Object.values((await f.library()).sets[spriteSetKeyFor(MIRA, f.styleKey)]!.images).every((image) => image.status === "ready" && image.scenery === null)).toBe(true);
  });
});

describe("sprite jobs: set seed and user regeneration", () => {
  test("regenerating the idle draws a new set seed for expressions not made yet; made ones stay", async () => {
    const f = setup({ gated: true });
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    // idle and the next expression render; the third is running when the user regenerates the idle.
    for (let index = 0; index < 2; index += 1) {
      await waitFor(() => f.gates.length > index);
      f.gates[index]!.release();
    }
    await waitFor(() => f.gates.length === 3);
    const oldSeed = (await f.library()).sets[setKey]!.seed;
    const made = f.started().slice(0, 2);
    const kept = { ...(await f.library()).sets[setKey]!.images[made[1]!.split("/")[1]!]! };
    await f.service.action("u1", { type: "vn_sprite_action", action: "regenerate", setKey, expression: "idle" }, { config: spriteConfig() });
    let released = 2;
    while (released < SPRITE_HOT_SET.length + 1) {
      await waitFor(() => f.gates.length > released);
      f.gates[released]!.release();
      released += 1;
    }
    await f.service.settle("u1");
    const set = (await f.library()).sets[setKey]!;
    expect(set.seedRound).toBe(1);
    expect(set.seed).not.toBe(oldSeed);
    const calls = f.callsBy();
    expect(calls).toHaveLength(SPRITE_HOT_SET.length + 1);
    // The running one kept its old seed; the new idle is next, then the rest, all with the new seed.
    expect(calls[2]!.call.parameters.seed).toBe(oldSeed);
    expect(calls[3]!.name).toBe(label(setKey, "idle"));
    for (const entry of calls.slice(3)) expect(entry.call.parameters.seed).toBe(set.seed);
    // The expression made before stays as it was.
    expect(set.images[kept.expression]!.rawImageId).toBe(kept.rawImageId);
    expect(calls.filter((entry) => entry.name === label(setKey, kept.expression))).toHaveLength(1);
  });

  test("regenerating the whole set: every expression shares one new seed", async () => {
    const f = setup();
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    await f.answerAll();
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    const oldSeed = (await f.library()).sets[setKey]!.seed;
    const calls = f.calls.length;
    await f.service.action("u1", { type: "vn_sprite_action", action: "regenerate", setKey }, { config: spriteConfig() });
    await f.service.settle("u1");
    const set = (await f.library()).sets[setKey]!;
    const fresh = f.calls.slice(calls);
    expect(fresh).toHaveLength(SPRITE_HOT_SET.length);
    expect(new Set(fresh.map((call) => call.parameters.seed))).toEqual(new Set([set.seed]));
    expect(set.seed).not.toBe(oldSeed);
  });
});

describe("sprite jobs: face boxes", () => {
  async function readyIdle(f: ReturnType<typeof setup>, meta: Record<string, unknown> = CUT_META) {
    await f.service.prepareCast("u1", [MIRA], spriteConfig());
    await f.service.settle("u1");
    const setKey = spriteSetKeyFor(MIRA, f.styleKey);
    f.answerCut(f.cutRequests()[0]!, meta);
    await f.service.settle("u1");
    return setKey;
  }

  test("a face from the cut is stored and sent; old cut meta without one leaves it unknown", async () => {
    const f = setup();
    const setKey = await readyIdle(f, { ...CUT_META, face: [0.4, 0.1, 0.2, 0.15] });
    const idle = (await f.library()).sets[setKey]!.images.idle!;
    expect(idle.face).toEqual([0.4, 0.1, 0.2, 0.15]);
    const update = f.of("vn_sprite_update").find((message) => (message.image as { status: string }).status === "ready");
    expect((update!.image as { face?: unknown }).face).toEqual([0.4, 0.1, 0.2, 0.15]);
    const g = setup();
    const other = await readyIdle(g);
    expect("face" in (await g.library()).sets[other]!.images.idle!).toBe(false);
  });

  test("saveFace fills a missing face of the current cut-out once, and broadcasts it", async () => {
    const f = setup();
    const setKey = await readyIdle(f);
    const idle = (await f.library()).sets[setKey]!.images.idle!;
    const url = idle.cutUrl!;
    const before = f.of("vn_sprite_update").length;
    // Wrong URL (a replaced cut-out), bad box, unknown set: ignored.
    expect(await f.service.saveFace("u1", { setKey, expression: "idle", url: "/api/v1/images/old", face: [0.4, 0.1, 0.2, 0.15] })).toBe(false);
    expect(await f.service.saveFace("u1", { setKey, expression: "idle", url, face: [0.4, 0.1] })).toBe(false);
    expect(await f.service.saveFace("u1", { setKey: "set_nope", expression: "idle", url, face: null })).toBe(false);
    expect(await f.service.saveFace("u1", { setKey, expression: "idle", url, face: [0.4, 0.1, 0.2, 0.15] })).toBe(true);
    await f.service.library.flush("u1");
    expect(f.stored()!.sets[setKey]!.images.idle!.face).toEqual([0.4, 0.1, 0.2, 0.15]);
    const sent = f.of("vn_sprite_update").slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ setKey, image: { expression: "idle", face: [0.4, 0.1, 0.2, 0.15] } });
    // Already known: not overwritten.
    expect(await f.service.saveFace("u1", { setKey, expression: "idle", url, face: null })).toBe(false);
  });

  test("null (no face found) is stored too; a re-cut forgets the face", async () => {
    const f = setup();
    const setKey = await readyIdle(f);
    const url = (await f.library()).sets[setKey]!.images.idle!.cutUrl!;
    expect(await f.service.saveFace("u1", { setKey, expression: "idle", url, face: null })).toBe(true);
    expect((await f.library()).sets[setKey]!.images.idle!.face).toBeNull();
    const update = f.of("vn_sprite_update").at(-1)!;
    expect((update.image as { face?: unknown }).face).toBeNull();
    await f.service.action("u1", { type: "vn_sprite_action", action: "recut", setKey, expression: "idle" }, { config: spriteConfig() });
    expect("face" in (await f.library()).sets[setKey]!.images.idle!).toBe(false);
  });
});
