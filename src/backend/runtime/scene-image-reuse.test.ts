import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../config.js";
import { TurnPlanSchema, type AssetJob, type SceneState, type SubjectCategory, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import { SceneImageCache, sceneEpisodeOf, sceneImageCacheKey, sceneImageScope } from "../core/scene-image-cache.js";
import {
  CACHE_JOB_PROVIDER,
  cacheEligibleCue,
  createAssetJobs,
  generateAssets,
  resolveCacheCues,
  sceneImageIdentityFor
} from "./images.js";

/* ------------------------------------------------------------------ *
 * Fixtures: three turns of one chat. Scene ids change on every speaker
 * switch (as the planner does), priorSceneId stays until a physical boundary.
 * ------------------------------------------------------------------ */

const now = new Date().toISOString();

function turnKey(messageId: string, revision: number) {
  return { chatId: "chat-1", assistantMessageId: messageId, swipeId: 0, sourceFingerprint: `fingerprint-${messageId}`, revision };
}

const library: SceneState["environment"] = {
  location: "Library",
  timeOfDay: "night",
  weather: null,
  lighting: "lamplight",
  description: "A quiet library.",
  persistentElements: ["oak shelves"]
};

type Character = { name: string; id: string; identity: string; subject: SubjectCategory };
const MIRA: Character = { name: "Mira", id: "mira", identity: "silver hair, green eyes, red coat", subject: "female" };
const ALEX: Character = { name: "Alex", id: "alex", identity: "short black hair, brown eyes, grey hoodie", subject: "male" };

function scene(
  sceneId: string,
  character: Character,
  options: { priorSceneId?: string | null; environment?: Partial<SceneState["environment"]>; attire?: string | null; compositionLock?: string } = {}
): SceneState {
  return {
    sceneId,
    revision: 1,
    startParagraph: 0,
    environment: { ...library, ...(options.environment ?? {}) },
    cast: [character.name],
    continuity: { revision: 0, characters: {}, facts: {} },
    basePrompt: `quiet library at night with ${character.name}`,
    identityPrompt: character.identity,
    cameraLock: {
      framing: "medium wide",
      angle: "eye level",
      perspective: "fixed",
      lens: "50mm",
      subjectAnchor: "center",
      horizon: "upper third",
      safeDialogueRegion: "lower third",
      aspectRatio: "16:9"
    },
    compositionLock: options.compositionLock ?? `${character.name} centered`,
    activeAssetId: null,
    priorSceneId: options.priorSceneId ?? null,
    character: character.name,
    characterId: character.id,
    subjectCategory: character.subject,
    attire: options.attire ?? null
  };
}

function cue(
  id: string,
  sceneId: string,
  character: Character,
  options: { paragraphIndex?: number; pose?: string; attire?: string | null; action?: string | null; unresolved?: boolean } = {}
): VisualCue {
  return {
    cueId: `cue-${id}`,
    paragraphIndex: options.paragraphIndex ?? 0,
    sceneId,
    sceneRevision: 1,
    kind: "flattened_scene",
    action: options.action ?? null,
    expression: null,
    poseExpressionId: options.pose ?? "smile",
    character: character.name,
    ...(options.unresolved ? {} : {
      characterId: character.id,
      subjectCategory: character.subject,
      resolvedIdentity: character.identity,
      resolvedAttire: options.attire ?? null
    }),
    ...(options.attire ? { attire: options.attire } : {}),
    promptDelta: "",
    assetJobId: `job-${id}`
  };
}

function plan(messageId: string, revision: number, scenes: SceneState[], cues: VisualCue[], cacheCues: VisualCue[] = []): TurnPlan {
  const maxParagraph = Math.max(0, ...cues.map((item) => item.paragraphIndex), ...cacheCues.map((item) => item.paragraphIndex));
  return TurnPlanSchema.parse({
    schemaVersion: 1,
    key: turnKey(messageId, revision),
    paragraphs: Array.from({ length: maxParagraph + 1 }, (_, index) => ({ index, sourceIndex: index, text: `Paragraph ${index}.` })),
    scenes,
    visualCues: cues,
    ...(cacheCues.length > 0 ? { cacheCues } : {}),
    choices: [],
    initialContinuity: { revision: 0, characters: {}, facts: {} },
    continuityDeltas: [],
    terminalContinuity: { revision: 0, characters: {}, facts: {} },
    planningStatus: "planned",
    createdAt: now
  });
}

type Gate = { resolve: (value: { imageId: string; imageUrl?: string | null }) => void; reject: (reason?: unknown) => void };

function harness(options: { manual?: boolean; images?: Record<string, boolean> | "throw" | "absent"; debug?: boolean } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const gates: Gate[] = [];
  const logs: string[] = [];
  const verified: string[] = [];
  let counter = 0;
  const imagesApi = options.images === "absent"
    ? {}
    : {
      images: {
        get: async (imageId: string) => {
          verified.push(imageId);
          if (options.images === "throw") throw new Error("images unavailable");
          const known: Record<string, boolean> = typeof options.images === "object" ? options.images : {};
          if (imageId in known) return known[imageId] ? { id: imageId, url: `/api/v1/images/${imageId}` } : null;
          return { id: imageId, url: `/api/v1/images/${imageId}` };
        }
      }
    };
  const spindle = {
    userStorage: { getJson: async (_path: string, readOptions: { fallback: unknown }) => readOptions.fallback, setJson: async () => {} },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async (input: Record<string, unknown>) => {
        calls.push(input);
        if (options.manual) {
          return new Promise<{ imageId: string; imageUrl?: string | null }>((resolve, reject) => { gates.push({ resolve, reject }); });
        }
        counter += 1;
        return { imageId: `img-${counter}`, imageUrl: `/api/v1/images/img-${counter}` };
      }
    },
    ...imagesApi,
    log: { info: (line: string) => { logs.push(line); }, warn: () => {}, error: () => {} }
  } as unknown as SpindleAPI;
  return { spindle, calls, gates, logs, verified };
}

const config: VisualNovelConfig = { ...DEFAULT_CONFIG, imageConcurrency: 2, referenceAnchoring: false };

async function run(
  spindle: SpindleAPI,
  turn: TurnPlan,
  cache: SceneImageCache,
  options: { signal?: AbortSignal; config?: VisualNovelConfig; bypass?: string[]; updates?: AssetJob[]; admission?: ReturnType<SceneImageCache["admission"]>; jobs?: AssetJob[] } = {}
): Promise<AssetJob[]> {
  const effective = options.config ?? config;
  const jobs = options.jobs ?? createAssetJobs(turn, effective);
  return generateAssets(spindle, turn, jobs, effective, options.signal ?? new AbortController().signal, (_jobs, changed) => {
    options.updates?.push(changed);
  }, undefined, {
    sceneCache: cache,
    ...(options.admission ? { admission: options.admission } : {}),
    ...(options.bypass ? { bypassJobIds: options.bypass } : {})
  });
}

const scope = sceneImageScope(undefined, "chat-1");

/* ------------------------------------------------------------------ */

describe("scene image reuse across turns (production path: generateAssets)", () => {
  test("Mira -> Alex -> Mira with alternating scene ids reuses turn 1's image on turn 3 with no request", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls, verified } = harness();

    const turn1 = plan("m1", 1, [scene("scene-1", MIRA)], [cue("t1", "scene-1", MIRA)]);
    const first = await run(spindle, turn1, cache);
    expect(first[0]!.status).toBe("generated");
    expect(first[0]!.imageId).toBe("img-1");
    expect(calls).toHaveLength(1);
    expect(cache.size).toBe(1);

    // Speaker switch: the planner mints a new scene id but keeps priorSceneId (null here).
    const turn2 = plan("m2", 2, [scene("scene-2", ALEX)], [cue("t2", "scene-2", ALEX)]);
    const second = await run(spindle, turn2, cache);
    expect(second[0]!.imageId).toBe("img-2");
    expect(calls).toHaveLength(2);

    const turn3 = plan("m3", 3, [scene("scene-3", MIRA)], [cue("t3", "scene-3", MIRA)]);
    const third = await run(spindle, turn3, cache);
    expect(third[0]!.status).toBe("generated");
    expect(third[0]!.imageId).toBe("img-1");
    expect(third[0]!.imageUrl).toBe("/api/v1/images/img-1");
    expect(third[0]!.ownerTurnKey.assistantMessageId).toBe("m3");
    expect(calls).toHaveLength(2);
    expect(verified).toEqual(["img-1"]);
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.generationsAvoided).toBe(1);
    expect(stats.stores).toBe(2);
  });

  test("the key ignores scene id, composition lock, camera lock, prompt delta and turn identity", () => {
    const base = sceneImageIdentityFor(config, scene("scene-1", MIRA), cue("a", "scene-1", MIRA), undefined, "comfyui");
    const changed = sceneImageIdentityFor(
      config,
      { ...scene("scene-9", MIRA, { compositionLock: "Alex left, Mira right" }), cameraLock: { ...scene("x", MIRA).cameraLock, lens: "85mm" } },
      { ...cue("zzz", "scene-9", MIRA, { paragraphIndex: 3 }), promptDelta: "lantern held high" },
      undefined,
      "comfyui"
    );
    expect(sceneImageCacheKey(base)).toBe(sceneImageCacheKey(changed));
  });

  test("exact compatibility: wardrobe, lighting, weather, elements, pose, action, settings, negative prompt all miss", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    await run(spindle, plan("m1", 1, [scene("scene-1", MIRA)], [cue("t1", "scene-1", MIRA)]), cache);
    expect(calls).toHaveLength(1);

    const variants: Array<[string, TurnPlan, VisualNovelConfig?]> = [
      ["wardrobe", plan("m2", 2, [scene("s", MIRA, { attire: "blue sundress" })], [cue("v", "s", MIRA, { attire: "blue sundress" })])],
      ["lighting", plan("m2", 2, [scene("s", MIRA, { environment: { lighting: "moonlight" } })], [cue("v", "s", MIRA)])],
      ["weather", plan("m2", 2, [scene("s", MIRA, { environment: { weather: "rain" } })], [cue("v", "s", MIRA)])],
      ["time", plan("m2", 2, [scene("s", MIRA, { environment: { timeOfDay: "dawn" } })], [cue("v", "s", MIRA)])],
      ["location", plan("m2", 2, [scene("s", MIRA, { environment: { location: "Street" } })], [cue("v", "s", MIRA)])],
      ["elements", plan("m2", 2, [scene("s", MIRA, { environment: { persistentElements: ["oak shelves", "candle"] } })], [cue("v", "s", MIRA)])],
      ["description", plan("m2", 2, [scene("s", MIRA, { environment: { description: "Dust motes drift in the lamplight." } })], [cue("v", "s", MIRA)])],
      ["pose", plan("m2", 2, [scene("s", MIRA)], [cue("v", "s", MIRA, { pose: "idle" })])],
      ["action", plan("m2", 2, [scene("s", MIRA)], [cue("v", "s", MIRA, { action: "holding brass key in right raised hand" })])],
      ["model", plan("m2", 2, [scene("s", MIRA)], [cue("v", "s", MIRA)]), { ...config, imageModel: "other-model" }],
      ["parameters", plan("m2", 2, [scene("s", MIRA)], [cue("v", "s", MIRA)]), { ...config, imageParameters: { steps: 30 } }],
      ["user reference setting", plan("m2", 2, [scene("s", MIRA)], [cue("v", "s", MIRA)]), { ...config, imageParameters: { referenceStrength: 0.9 } }],
      ["negative prompt", plan("m2", 2, [scene("s", MIRA)], [cue("v", "s", MIRA)]), { ...config, negativePrompt: "low quality, extra fingers" }],
      ["prefix", plan("m2", 2, [scene("s", MIRA)], [cue("v", "s", MIRA)]), { ...config, promptPrefix: "photo" }],
      ["connection", plan("m2", 2, [scene("s", MIRA)], [cue("v", "s", MIRA)]), { ...config, imageConnectionId: "conn::workflow-b" }]
    ];
    for (const [label, variant, variantConfig] of variants) {
      const before = calls.length;
      const jobs = await run(spindle, variant, cache, variantConfig ? { config: variantConfig } : {});
      expect(jobs[0]!.status).toBe("generated");
      expect(calls.length).toBe(before + 1);
      expect(jobs[0]!.imageId).not.toBe("img-1");
    }
    expect(cache.stats().hits).toBe(0);
  });

  test("a different character with identical visible tags never shares an entry", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    const fox1: Character = { name: "Fox Girl (Yuki)", id: "fox-girl-yuki", identity: "fox ears, orange hair, amber eyes", subject: "female" };
    const fox2: Character = { name: "Fox Girl (Ren)", id: "fox-girl-ren", identity: "fox ears, orange hair, amber eyes", subject: "female" };
    await run(spindle, plan("m1", 1, [scene("s1", fox1)], [cue("a", "s1", fox1)]), cache);
    await run(spindle, plan("m2", 2, [scene("s2", fox2)], [cue("b", "s2", fox2)]), cache);
    expect(calls).toHaveLength(2);
    expect(cache.stats().hits).toBe(0);
  });

  test("fails closed: cues without a persisted durable identity never hit or populate", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    const legacy = cue("legacy", "scene-1", MIRA, { unresolved: true });
    expect(cacheEligibleCue(legacy)).toBe(false);
    await run(spindle, plan("m1", 1, [scene("scene-1", MIRA)], [legacy]), cache);
    await run(spindle, plan("m2", 2, [scene("scene-1", MIRA)], [cue("legacy2", "scene-1", MIRA, { unresolved: true })]), cache);
    expect(calls).toHaveLength(2);
    expect(cache.size).toBe(0);
    expect(cache.stats().misses.identity_unresolved).toBe(2);
  });
});

describe("physical scene lifetime", () => {
  test("leaving the library and coming back never reuses the earlier visit", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    // Turn 1: library (initial episode).
    await run(spindle, plan("m1", 1, [scene("lib-1", MIRA)], [cue("a", "lib-1", MIRA)]), cache);
    // Turn 2: physical boundary to the street; priorSceneId points at the library scene.
    await run(spindle, plan("m2", 2, [scene("street", MIRA, { priorSceneId: "lib-1", environment: { location: "Street", lighting: "streetlight" } })], [cue("b", "street", MIRA)]), cache);
    expect(cache.size).toBe(1); // library entry retired at batch start
    // Turn 3: back to an identical library, new physical episode.
    const back = await run(spindle, plan("m3", 3, [scene("lib-2", MIRA, { priorSceneId: "street" })], [cue("c", "lib-2", MIRA)]), cache);
    expect(back[0]!.imageId).toBe("img-3");
    expect(calls).toHaveLength(3);
    expect(cache.stats().hits).toBe(0);
    expect(cache.stats().invalidations.scene_boundary).toBeGreaterThan(0);
  });

  test("a speaker switch inside the same physical scene keeps eligibility", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    await run(spindle, plan("m1", 1, [scene("lib-1", MIRA, { priorSceneId: "hall" })], [cue("a", "lib-1", MIRA)]), cache);
    await run(spindle, plan("m2", 2, [scene("lib-2", ALEX, { priorSceneId: "hall" })], [cue("b", "lib-2", ALEX)]), cache);
    const third = await run(spindle, plan("m3", 3, [scene("lib-3", MIRA, { priorSceneId: "hall" })], [cue("c", "lib-3", MIRA)]), cache);
    expect(third[0]!.imageId).toBe("img-1");
    expect(calls).toHaveLength(2);
  });

  test("a multi-scene turn keeps the first scene's episode reusable and starts a new one for the second", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    await run(spindle, plan("m1", 1, [scene("lib-1", MIRA)], [cue("a", "lib-1", MIRA)]), cache);
    const street = { ...scene("street", MIRA, { priorSceneId: "lib-1", environment: { location: "Street", lighting: "streetlight" } }), startParagraph: 1 };
    const jobs = await run(spindle, plan("m2", 2, [scene("lib-1", MIRA), street], [cue("b", "lib-1", MIRA), cue("c", "street", MIRA, { paragraphIndex: 1 })]), cache);
    expect(jobs[0]!.imageId).toBe("img-1"); // reused inside the continuing library episode
    expect(jobs[1]!.imageId).toBe("img-2");
    expect(calls).toHaveLength(2);
  });

  test("after an explicit scope release the next 'initial' lineage cannot see old entries", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    await run(spindle, plan("m1", 1, [scene("lib-1", MIRA)], [cue("a", "lib-1", MIRA)]), cache);
    cache.invalidateScope(scope, "scope_cleared");
    await run(spindle, plan("m2", 2, [scene("lib-9", MIRA)], [cue("b", "lib-9", MIRA)]), cache);
    expect(calls).toHaveLength(2);
    expect(cache.snapshot(scope)[0]!.episode).toBe("initial:1");
  });
});

describe("late results, aborts and forced regeneration", () => {
  test("a result that lands after the turn changed is not admitted to the cache", async () => {
    const cache = new SceneImageCache();
    const { spindle, gates, logs } = harness({ manual: true, debug: true });
    const debugConfig = { ...config, debugLogging: true };
    const turn = plan("m1", 1, [scene("scene-1", MIRA)], [cue("a", "scene-1", MIRA)]);
    const admission = cache.admission(scope);
    const running = run(spindle, turn, cache, { admission, config: debugConfig });
    while (gates.length === 0) await Promise.resolve();
    cache.bumpEpoch(scope, "swipe");
    gates[0]!.resolve({ imageId: "late-img" });
    const jobs = await running;
    expect(jobs[0]!.status).toBe("generated"); // the job itself still completes for its own record
    expect(cache.size).toBe(0);
    expect(cache.stats().rejections.stale_admission).toBe(1);
    expect(logs.some((line) => line.includes("scene-cache p0 reject reason=stale_admission"))).toBe(true);
  });

  test("an aborted generation neither populates the cache nor blocks the next claimant", async () => {
    const cache = new SceneImageCache();
    const { spindle, gates, calls } = harness({ manual: true });
    const controller = new AbortController();
    const turn = plan("m1", 1, [scene("scene-1", MIRA)], [cue("a", "scene-1", MIRA)]);
    const running = run(spindle, turn, cache, { signal: controller.signal });
    while (gates.length === 0) await Promise.resolve();
    const key = sceneImageCacheKey(sceneImageIdentityFor(config, turn.scenes[0]!, turn.visualCues[0]!, undefined, "comfyui"));
    expect(cache.inFlightFor(scope, key)).toBe(true);
    controller.abort("A newer turn replaced this asset batch.");
    expect(cache.inFlightFor(scope, key)).toBe(false);
    gates[0]!.resolve({ imageId: "discarded" });
    const jobs = await running;
    expect(jobs[0]!.status).toBe("cancelled");
    expect(cache.size).toBe(0);
    expect(calls).toHaveLength(1);
  });

  test("forced regeneration bypasses the lookup, still stores, and the new image replaces the old entry", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    const turn = plan("m1", 1, [scene("scene-1", MIRA)], [cue("a", "scene-1", MIRA)]);
    await run(spindle, turn, cache);
    const retried = await run(spindle, turn, cache, { bypass: ["job-a"] });
    expect(calls).toHaveLength(2);
    expect(retried[0]!.imageId).toBe("img-2");
    expect(cache.snapshot(scope)[0]!.imageId).toBe("img-2");
    expect(cache.stats().misses.bypass).toBe(1);
    expect(cache.stats().replacements).toBe(1);
  });
});

describe("missing or unverifiable assets", () => {
  test("a hit whose image was deleted is retired and normal generation runs", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls, logs } = harness({ images: { "img-1": false } });
    const turn = plan("m1", 1, [scene("scene-1", MIRA)], [cue("a", "scene-1", MIRA)]);
    await run(spindle, turn, cache);
    const again = await run(spindle, plan("m2", 2, [scene("scene-2", MIRA)], [cue("b", "scene-2", MIRA)]), cache, { config: { ...config, debugLogging: true } });
    expect(calls).toHaveLength(2);
    expect(again[0]!.imageId).toBe("img-2");
    const stats = cache.stats();
    expect(stats.hits).toBe(0);
    expect(stats.generationsAvoided).toBe(0);
    expect(stats.misses.asset_missing).toBe(1);
    expect(stats.invalidations.asset_missing).toBe(1);
    expect(cache.snapshot(scope)[0]!.imageId).toBe("img-2");
    expect(logs.some((line) => line.includes("miss reason=asset_missing"))).toBe(true);
  });

  test("when the host cannot verify the asset the cache stands aside", async () => {
    for (const images of ["throw", "absent"] as const) {
      const cache = new SceneImageCache();
      const { spindle, calls } = harness({ images });
      await run(spindle, plan("m1", 1, [scene("scene-1", MIRA)], [cue("a", "scene-1", MIRA)]), cache);
      await run(spindle, plan("m2", 2, [scene("scene-2", MIRA)], [cue("b", "scene-2", MIRA)]), cache);
      expect(calls).toHaveLength(2);
      expect(cache.stats().misses.asset_unverifiable).toBe(1);
    }
  });
});

describe("concurrent compatible requests", () => {
  test("a second batch waits for the in-flight owner and shares its image (one request)", async () => {
    const cache = new SceneImageCache();
    const { spindle, gates, calls } = harness({ manual: true });
    const first = run(spindle, plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)]), cache);
    while (gates.length === 0) await Promise.resolve();
    const second = run(spindle, plan("m2", 2, [scene("s2", MIRA)], [cue("b", "s2", MIRA)]), cache);
    // Let the second batch reach the waiter state.
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(cache.stats().waits.count).toBe(1);
    gates[0]!.resolve({ imageId: "img-shared" });
    const [jobsA, jobsB] = await Promise.all([first, second]);
    expect(jobsA[0]!.imageId).toBe("img-shared");
    expect(jobsB[0]!.imageId).toBe("img-shared");
    expect(calls).toHaveLength(1);
    expect(cache.stats().sharedHits).toBe(1);
    expect(cache.stats().generationsAvoided).toBe(1);
  });

  test("when the owner is aborted the waiter takes over and generates itself", async () => {
    const cache = new SceneImageCache();
    const { spindle, gates, calls } = harness({ manual: true });
    const abortFirst = new AbortController();
    const first = run(spindle, plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)]), cache, { signal: abortFirst.signal });
    while (gates.length === 0) await Promise.resolve();
    const second = run(spindle, plan("m2", 2, [scene("s2", MIRA)], [cue("b", "s2", MIRA)]), cache);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    abortFirst.abort("superseded");
    while (gates.length < 2) await Promise.resolve();
    gates[0]!.resolve({ imageId: "discarded" });
    gates[1]!.resolve({ imageId: "img-own" });
    const [jobsA, jobsB] = await Promise.all([first, second]);
    expect(jobsA[0]!.status).toBe("cancelled");
    expect(jobsB[0]!.imageId).toBe("img-own");
    expect(calls).toHaveLength(2);
    expect(cache.snapshot(scope)[0]!.imageId).toBe("img-own");
  });

  test("an owner failure is reported once to the waiter without a retry cascade", async () => {
    const cache = new SceneImageCache();
    const { spindle, gates, calls } = harness({ manual: true });
    const first = run(spindle, plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)]), cache);
    while (gates.length === 0) await Promise.resolve();
    const second = run(spindle, plan("m2", 2, [scene("s2", MIRA)], [cue("b", "s2", MIRA)]), cache);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    gates[0]!.reject(new Error("provider down"));
    const [jobsA, jobsB] = await Promise.all([first, second]);
    expect(jobsA[0]!.status).toBe("failed");
    expect(jobsB[0]!.status).toBe("failed");
    expect(jobsB[0]!.error).toBe("provider down");
    expect(calls).toHaveLength(1);
  });

  test("intra-turn identical cues still share one request through the scheduler (unchanged behavior)", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    const jobs = await run(spindle, plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA), cue("b", "s1", MIRA, { paragraphIndex: 1 })]), cache);
    expect(calls).toHaveLength(1);
    expect(jobs.map((job) => job.imageId)).toEqual(["img-1", "img-1"]);
  });
});

describe("reuse-only candidates beyond the image cap", () => {
  test("a cold candidate produces no job and no request; the budget is untouched", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    const turn = plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)], [cue("extra", "s1", ALEX, { paragraphIndex: 1 })]);
    const updates: AssetJob[] = [];
    const jobs = await run(spindle, turn, cache, { updates });
    expect(calls).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    expect(updates.every((job) => job.provider !== CACHE_JOB_PROVIDER)).toBe(true);
  });

  test("a candidate that becomes compatible when a budgeted image lands is delivered as an extra swap", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    const turn = plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)], [cue("extra", "s1", MIRA, { paragraphIndex: 2 })]);
    const updates: AssetJob[] = [];
    const jobs = await run(spindle, turn, cache, { updates });
    expect(calls).toHaveLength(1);
    expect(jobs).toHaveLength(2);
    const extra = jobs.find((job) => job.jobId === "job-extra")!;
    expect(extra.provider).toBe(CACHE_JOB_PROVIDER);
    expect(extra.status).toBe("generated");
    expect(extra.imageId).toBe("img-1");
    expect(extra.paragraphIndex).toBe(2);
    expect(extra.ownerTurnKey.assistantMessageId).toBe("m1");
    expect(updates.some((job) => job.jobId === "job-extra" && job.status === "generated")).toBe(true);
  });

  test("resolveCacheCues serves warm candidates before the first turn view and skips ones that already have jobs", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = harness();
    await run(spindle, plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)]), cache);
    const turn2 = plan("m2", 2, [scene("s2", ALEX)], [cue("b", "s2", ALEX)], [
      cue("warm", "s2", MIRA, { paragraphIndex: 1 }),
      cue("cold", "s2", MIRA, { paragraphIndex: 2, pose: "idle" })
    ]);
    const budgeted = createAssetJobs(turn2, config);
    const extra = await resolveCacheCues(spindle, turn2, config, undefined, budgeted, cache);
    expect(extra.map((job) => job.jobId)).toEqual(["job-warm"]);
    expect(extra[0]!.imageId).toBe("img-1");
    expect(extra[0]!.provider).toBe(CACHE_JOB_PROVIDER);
    expect(calls).toHaveLength(1);
    // Already resolved candidates are not resolved twice.
    expect(await resolveCacheCues(spindle, turn2, config, undefined, [...budgeted, ...extra], cache)).toEqual([]);
  });

  test("a candidate whose cached asset vanished is silently skipped", async () => {
    const cache = new SceneImageCache();
    const { spindle } = harness({ images: { "img-1": false } });
    await run(spindle, plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)]), cache);
    const turn2 = plan("m2", 2, [scene("s2", ALEX)], [cue("b", "s2", ALEX)], [cue("warm", "s2", MIRA, { paragraphIndex: 1 })]);
    expect(await resolveCacheCues(spindle, turn2, config, undefined, createAssetJobs(turn2, config), cache)).toEqual([]);
    expect(cache.size).toBe(0);
  });

  test("createAssetJobs never creates jobs for candidates (cap invariant)", () => {
    const turn = plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)], [cue("extra", "s1", MIRA, { paragraphIndex: 1 })]);
    expect(createAssetJobs(turn, config).map((job) => job.jobId)).toEqual(["job-a"]);
  });
});

describe("debug observability", () => {
  test("hits, misses, stores, waits and the batch summary are traced with [VN] scene-cache lines", async () => {
    const cache = new SceneImageCache();
    const { spindle, logs } = harness();
    const debugConfig = { ...config, debugLogging: true };
    await run(spindle, plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)]), cache, { config: debugConfig });
    await run(spindle, plan("m2", 2, [scene("s2", MIRA)], [cue("b", "s2", MIRA)]), cache, { config: debugConfig });
    const text = logs.join("\n");
    expect(text).toContain("scene-cache p0 miss reason=absent");
    expect(text).toContain("scene-cache p0 owns generation");
    expect(text).toContain("scene-cache p0 store key=");
    expect(text).toContain("scene-cache p0 hit key=");
    expect(text).toContain("generation avoided");
    expect(text).toContain("scene-cache batch summary hits=1");
    expect(text).toContain("avoided=1");
  });

  test("without the cache option generateAssets behaves exactly as before", async () => {
    const { spindle, calls, logs } = harness();
    const turn = plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)]);
    const jobs = await generateAssets(spindle, turn, createAssetJobs(turn, config), { ...config, debugLogging: true }, new AbortController().signal, () => {});
    expect(jobs[0]!.status).toBe("generated");
    expect(calls).toHaveLength(1);
    expect(logs.some((line) => line.includes("scene-cache"))).toBe(false);
  });
});


describe("reference anchoring stays in charge of portrait capture", () => {
  function anchoringHarness() {
    const base = harness();
    const portraits = new Map<string, unknown>();
    const spindle = base.spindle as unknown as { userStorage: { getJson: (path: string, options: { fallback: unknown }) => Promise<unknown>; setJson: (path: string, value: unknown) => Promise<void> } };
    spindle.userStorage = {
      getJson: async (path, options) => portraits.get(path) ?? options.fallback,
      setJson: async (path, value) => { portraits.set(path, value); }
    };
    return { ...base, portraits };
  }
  const anchoring: VisualNovelConfig = { ...config, referenceAnchoring: true };

  test("anchoring off -> on: the required portrait capture render is never replaced by a cache hit", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls, portraits } = anchoringHarness();
    await run(spindle, plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)]), cache, { config });
    expect(calls).toHaveLength(1);
    const second = await run(spindle, plan("m2", 2, [scene("s2", MIRA)], [cue("b", "s2", MIRA)]), cache, { config: anchoring });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.includeDataUrl).toBe(true);
    expect(second[0]!.imageId).toBe("img-2");
    // The settings toggle is part of compatibility, so the anchored render has its own entry.
    expect(cache.size).toBe(2);
    expect(portraits.size).toBe(0); // the mock provider returns no data URL, so nothing was captured; the attempt itself is what matters
    expect(cache.stats().misses.portrait_capture + cache.stats().misses.absent).toBeGreaterThanOrEqual(1);
  });

  test("a captured portrait makes later compatible cues reuse, and switching anchoring off misses again", async () => {
    const cache = new SceneImageCache();
    const { spindle, calls } = anchoringHarness();
    const withData = spindle as unknown as { imageGen: { generate: (input: Record<string, unknown>) => Promise<Record<string, unknown>> } };
    const original = withData.imageGen.generate;
    withData.imageGen.generate = async (input) => ({ ...(await original(input)), imageDataUrl: "data:image/png;base64,QUJD" });
    await run(spindle, plan("m1", 1, [scene("s1", MIRA)], [cue("a", "s1", MIRA)]), cache, { config: anchoring });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.includeDataUrl).toBe(true);
    const second = await run(spindle, plan("m2", 2, [scene("s2", MIRA)], [cue("b", "s2", MIRA)]), cache, { config: anchoring });
    expect(calls).toHaveLength(1);
    expect(second[0]!.imageId).toBe("img-1");
    await run(spindle, plan("m3", 3, [scene("s3", MIRA)], [cue("c", "s3", MIRA)]), cache, { config });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.includeDataUrl).toBe(false);
  });
});

describe("episode helper matches the planner's scene lineage", () => {
  test("uses priorSceneId and the scope generation", () => {
    const cache = new SceneImageCache();
    expect(sceneEpisodeOf(scene("s", MIRA), cache.generation(scope))).toBe("initial:0");
    expect(sceneEpisodeOf(scene("s", MIRA, { priorSceneId: "hall" }), cache.generation(scope))).toBe("hall");
  });
});
