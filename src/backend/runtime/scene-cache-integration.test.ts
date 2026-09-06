import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../config.js";
import {
  TurnPlanSchema,
  AssetJobSchema,
  type SceneState,
  type TurnPlan,
  type VisualCue,
  type AssetJob
} from "../../shared/contracts.js";
import {
  SceneImageCache,
  sceneEpisodeOf,
  sceneImageCacheKey,
  sceneImageScope,
  type SceneImageIdentity,
  type SceneImageProvenance
} from "../core/scene-image-cache.js";
import {
  generateAssets,
  createAssetJobs,
  sceneImageIdentityFor,
  resolveCacheCues,
  cacheEligibleCue,
  CACHE_JOB_PROVIDER,
  defaultSceneImageVerifier,
  type SceneCacheOptions
} from "./images.js";
import { markAssetReady, turnView, sceneImageCache, registerVisualNovelBackend, sendState } from "./controller.js";
import { chatStatePath, turnPath, type StoredChatState, type StoredTurnRecord } from "./storage.js";

// ---------------------------------------------------------------------------
// Deterministic deferred gate helper (zero setTimeout polling)
// ---------------------------------------------------------------------------

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Test harness / fake Spindle environment
// ---------------------------------------------------------------------------

type MockSpindleOptions = {
  initialStorage?: Record<string, unknown>;
  initialImages?: Record<string, unknown>;
  onGenerate?: (input: any) => Promise<{ imageId: string; imageUrl?: string | null }> | { imageId: string; imageUrl?: string | null };
};

function createMockSpindle(options: MockSpindleOptions = {}) {
  const storage = new Map<string, unknown>(Object.entries(options.initialStorage ?? {}));
  const images = new Map<string, unknown>(Object.entries(options.initialImages ?? {}));
  const sent: unknown[] = [];
  const generateCalls: any[] = [];
  const eventHandlers = new Map<string, Array<(...args: any[]) => void>>();

  const spindle = {
    userStorage: {
      getJson: async (path: string, opts: { fallback: unknown }) => {
        return storage.has(path) ? storage.get(path) : opts.fallback;
      },
      setJson: async (path: string, value: unknown) => {
        storage.set(path, value);
      }
    },
    images: {
      get: async (id: string, userId?: string) => {
        return images.get(id) ?? null;
      },
      delete: async (id: string, userId?: string) => {
        const existed = images.has(id);
        images.delete(id);
        return existed ? 1 : 0;
      }
    },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async (input: any) => {
        generateCalls.push(input);
        if (options.onGenerate) {
          const res = await options.onGenerate(input);
          if (res.imageId) images.set(res.imageId, { id: res.imageId, url: res.imageUrl });
          return res;
        }
        const imgId = `img-${generateCalls.length}`;
        const result = { imageId: imgId, imageUrl: `/api/v1/images/${imgId}` };
        images.set(imgId, { id: imgId, url: result.imageUrl });
        return result;
      }
    },
    on: (event: string, handler: (...args: any[]) => void) => {
      const list = eventHandlers.get(event) ?? [];
      list.push(handler);
      eventHandlers.set(event, list);
      return () => {
        const filtered = (eventHandlers.get(event) ?? []).filter((h) => h !== handler);
        eventHandlers.set(event, filtered);
      };
    },
    sendToFrontend: (message: unknown) => {
      sent.push(message);
    },
    log: {
      info: () => {},
      warn: () => {},
      error: () => {}
    }
  } as unknown as SpindleAPI;

  const fire = (event: string, ...args: any[]) => {
    for (const handler of eventHandlers.get(event) ?? []) {
      handler(...args);
    }
  };

  return {
    spindle,
    storage,
    images,
    sent,
    generateCalls,
    fire
  };
}

// ---------------------------------------------------------------------------
// Fixture factories for Scene, Cue, and Plan
// ---------------------------------------------------------------------------

const now = new Date().toISOString();

function makeScene(overrides: Partial<SceneState> = {}): SceneState {
  return {
    sceneId: "scene-library",
    revision: 0,
    startParagraph: 0,
    environment: {
      location: "Library",
      timeOfDay: "night",
      weather: null,
      lighting: "lamplight",
      description: "A quiet library.",
      persistentElements: []
    },
    cast: ["Mira"],
    character: "Mira",
    continuity: { revision: 0, characters: {}, facts: {} },
    basePrompt: "quiet library at night",
    identityPrompt: "silver hair, green eyes, red coat",
    cameraLock: {
      framing: "upper body",
      angle: "eye level",
      perspective: "straight-on",
      lens: "50mm",
      subjectAnchor: "center",
      horizon: "upper third",
      safeDialogueRegion: "lower third",
      aspectRatio: "16:9"
    },
    compositionLock: "Mira centered",
    activeAssetId: null,
    priorSceneId: null,
    ...overrides
  };
}

function makeCue(overrides: Partial<VisualCue> = {}): VisualCue {
  return {
    cueId: `cue-${Math.random().toString(36).slice(2, 7)}`,
    paragraphIndex: 0,
    sceneId: "scene-library",
    sceneRevision: 0,
    kind: "flattened_scene",
    character: "Mira",
    characterId: "char-mira",
    resolvedIdentity: "silver hair, green eyes, red coat",
    subjectCategory: "female",
    action: null,
    expression: null,
    poseExpressionId: "neutral",
    promptDelta: "",
    assetJobId: `job-${Math.random().toString(36).slice(2, 7)}`,
    ...overrides
  };
}

function makePlan(options: {
  chatId?: string;
  messageId?: string;
  scenes?: SceneState[];
  visualCues?: VisualCue[];
  cacheCues?: VisualCue[];
  revision?: number;
}): TurnPlan {
  const scenes = options.scenes ?? [makeScene()];
  const visualCues = options.visualCues ?? [makeCue({ sceneId: scenes[0]!.sceneId, sceneRevision: scenes[0]!.revision })];
  return TurnPlanSchema.parse({
    schemaVersion: 1,
    key: {
      chatId: options.chatId ?? "chat-integration",
      assistantMessageId: options.messageId ?? "msg-1",
      swipeId: 0,
      sourceFingerprint: "fp-12345678",
      revision: options.revision ?? 0
    },
    paragraphs: [{ index: 0, sourceIndex: 0, text: "First paragraph beat." }],
    scenes,
    visualCues,
    ...(options.cacheCues ? { cacheCues: options.cacheCues } : {}),
    choices: [],
    initialContinuity: { revision: 0, characters: {}, facts: {} },
    continuityDeltas: [],
    terminalContinuity: { revision: 0, characters: {}, facts: {} },
    planningStatus: "planned",
    createdAt: now
  });
}

// ===========================================================================
// Test Suites
// ===========================================================================

describe("Scene Image Cache Integration", () => {

  // -------------------------------------------------------------------------
  // Suite 1: Alternating Characters across Turns (Mira -> Alex -> Mira)
  // -------------------------------------------------------------------------
  describe("Suite 1: Alternating Characters across Turns", () => {
    test("Mira neutral -> Alex happy -> Mira neutral reuses cached image on turn 3 avoiding generation", async () => {
      const cache = new SceneImageCache();
      const { spindle, generateCalls } = createMockSpindle();
      const config = { ...DEFAULT_CONFIG, generateImages: true, imageConcurrency: 1, referenceAnchoring: false };
      const signal = new AbortController().signal;

      // Turn 1: Mira neutral in opening library scene (priorSceneId: null)
      const scene1 = makeScene({ sceneId: "scene-1", priorSceneId: null, character: "Mira" });
      const cue1 = makeCue({ sceneId: "scene-1", character: "Mira", characterId: "char-mira", poseExpressionId: "neutral", assetJobId: "job-turn-1" });
      const plan1 = makePlan({ messageId: "msg-1", scenes: [scene1], visualCues: [cue1] });
      const jobs1 = createAssetJobs(plan1, config);

      const res1 = await generateAssets(spindle, plan1, jobs1, config, signal, () => {}, undefined, { sceneCache: cache });
      expect(generateCalls).toHaveLength(1);
      expect(res1[0]!.status).toBe("generated");
      const miraImageId = res1[0]!.imageId!;
      expect(miraImageId).toBe("img-1");

      // Turn 2: Alex happy (different character in same opening room, so priorSceneId: null)
      const scene2 = makeScene({ sceneId: "scene-2", priorSceneId: null, character: "Alex" });
      const cue2 = makeCue({
        sceneId: "scene-2",
        character: "Alex",
        characterId: "char-alex",
        resolvedIdentity: "short brown hair, brown eyes, blue jacket",
        subjectCategory: "male",
        poseExpressionId: "smile",
        assetJobId: "job-turn-2"
      });
      const plan2 = makePlan({ messageId: "msg-2", scenes: [scene2], visualCues: [cue2] });
      const jobs2 = createAssetJobs(plan2, config);

      const res2 = await generateAssets(spindle, plan2, jobs2, config, signal, () => {}, undefined, { sceneCache: cache });
      expect(generateCalls).toHaveLength(2);
      expect(res2[0]!.status).toBe("generated");
      const alexImageId = res2[0]!.imageId!;
      expect(alexImageId).toBe("img-2");
      expect(alexImageId).not.toBe(miraImageId);

      // Turn 3: Mira neutral again (dialogue returns to Mira in same opening room)
      const scene3 = makeScene({ sceneId: "scene-3", priorSceneId: null, character: "Mira" });
      const cue3 = makeCue({ sceneId: "scene-3", character: "Mira", characterId: "char-mira", poseExpressionId: "neutral", assetJobId: "job-turn-3" });
      const plan3 = makePlan({ messageId: "msg-3", scenes: [scene3], visualCues: [cue3] });
      const jobs3 = createAssetJobs(plan3, config);

      const res3 = await generateAssets(spindle, plan3, jobs3, config, signal, () => {}, undefined, { sceneCache: cache });

      // Verification: provider was NOT called again! Exact hit!
      expect(generateCalls).toHaveLength(2);
      expect(res3[0]!.status).toBe("generated");
      expect(res3[0]!.imageId).toBe(miraImageId);

      const stats = cache.stats();
      expect(stats.hits).toBe(1);
      expect(stats.generationsAvoided).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Suite 2: Alias & Stable ID Resolution
  // -------------------------------------------------------------------------
  describe("Suite 2: Alias & Stable ID Resolution", () => {
    test("Character alias mapping to same durable characterId hits cache", async () => {
      const cache = new SceneImageCache();
      const { spindle, generateCalls } = createMockSpindle();
      const config = { ...DEFAULT_CONFIG, generateImages: true, imageConcurrency: 1, referenceAnchoring: false };
      const signal = new AbortController().signal;

      // Turn 1: Display name "Mira" with stable characterId "char-mira-1"
      const scene1 = makeScene({ sceneId: "scene-1", priorSceneId: null, character: "Mira" });
      const cue1 = makeCue({
        sceneId: "scene-1",
        character: "Mira",
        characterId: "char-mira-1",
        resolvedIdentity: "silver hair, emerald eyes, formal gown",
        poseExpressionId: "neutral",
        assetJobId: "job-alias-1"
      });
      const plan1 = makePlan({ messageId: "msg-1", scenes: [scene1], visualCues: [cue1] });
      const jobs1 = createAssetJobs(plan1, config);
      const res1 = await generateAssets(spindle, plan1, jobs1, config, signal, () => {}, undefined, { sceneCache: cache });
      expect(generateCalls).toHaveLength(1);

      // Turn 2: Alias name "Lady Mira Thorne" with same characterId "char-mira-1" in same scene
      const scene2 = makeScene({ sceneId: "scene-2", priorSceneId: null, character: "Lady Mira Thorne" });
      const cue2 = makeCue({
        sceneId: "scene-2",
        character: "Lady Mira Thorne",
        characterId: "char-mira-1",
        resolvedIdentity: "silver hair, emerald eyes, formal gown",
        poseExpressionId: "neutral",
        assetJobId: "job-alias-2"
      });
      const plan2 = makePlan({ messageId: "msg-2", scenes: [scene2], visualCues: [cue2] });
      const jobs2 = createAssetJobs(plan2, config);
      const res2 = await generateAssets(spindle, plan2, jobs2, config, signal, () => {}, undefined, { sceneCache: cache });

      // Hits cache!
      expect(generateCalls).toHaveLength(1);
      expect(res2[0]!.status).toBe("generated");
      expect(res2[0]!.imageId).toBe(res1[0]!.imageId);
      expect(cache.stats().hits).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Suite 3: Distinct Same-Species Characters (No Cross-Collisions)
  // -------------------------------------------------------------------------
  describe("Suite 3: Distinct Same-Species Characters", () => {
    test("Two distinct fox-girl characters do not share cache entries", async () => {
      const cache = new SceneImageCache();
      const { spindle, generateCalls } = createMockSpindle();
      const config = { ...DEFAULT_CONFIG, generateImages: true, imageConcurrency: 1, referenceAnchoring: false };
      const signal = new AbortController().signal;

      // Character A: Yuki (fox girl, orange ears, red kimono)
      const sceneA = makeScene({ sceneId: "scene-a", priorSceneId: null, character: "Yuki" });
      const cueA = makeCue({
        sceneId: "scene-a",
        character: "Yuki",
        characterId: "char-yuki",
        subjectCategory: "female",
        resolvedIdentity: "fox girl, orange fox ears, bushy tail, red kimono",
        poseExpressionId: "neutral",
        assetJobId: "job-yuki"
      });
      const planA = makePlan({ messageId: "msg-a", scenes: [sceneA], visualCues: [cueA] });
      const jobsA = createAssetJobs(planA, config);
      const resA = await generateAssets(spindle, planA, jobsA, config, signal, () => {}, undefined, { sceneCache: cache });
      expect(generateCalls).toHaveLength(1);

      // Character B: Rin (fox girl, orange ears, blue kimono, distinct characterId)
      const sceneB = makeScene({ sceneId: "scene-b", priorSceneId: null, character: "Rin" });
      const cueB = makeCue({
        sceneId: "scene-b",
        character: "Rin",
        characterId: "char-rin",
        subjectCategory: "female",
        resolvedIdentity: "fox girl, orange fox ears, bushy tail, blue kimono",
        poseExpressionId: "neutral",
        assetJobId: "job-rin"
      });
      const planB = makePlan({ messageId: "msg-b", scenes: [sceneB], visualCues: [cueB] });
      const jobsB = createAssetJobs(planB, config);
      const resB = await generateAssets(spindle, planB, jobsB, config, signal, () => {}, undefined, { sceneCache: cache });

      // Second provider call must happen!
      expect(generateCalls).toHaveLength(2);
      expect(resB[0]!.imageId).not.toBe(resA[0]!.imageId);
      expect(cache.stats().hits).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Suite 4: Sensitivity & Miss Matrix
  // -------------------------------------------------------------------------
  describe("Suite 4: Exact Sensitivity & Miss Matrix", () => {
    test("Single-parameter variations each trigger a cache miss", async () => {
      const config = { ...DEFAULT_CONFIG, generateImages: true, imageConcurrency: 1, referenceAnchoring: false };
      const signal = new AbortController().signal;

      const baseScene = makeScene({ sceneId: "scene-base", priorSceneId: null });
      const baseCue = makeCue({ sceneId: "scene-base", assetJobId: "job-base" });

      // Function to test if a variant generates a new call against a warm base cache
      async function testVariant(label: string, variantScene: SceneState, variantCue: VisualCue, variantConfig: VisualNovelConfig = config) {
        const cache = new SceneImageCache();
        const { spindle, generateCalls } = createMockSpindle();

        // Populate base
        const basePlan = makePlan({ messageId: "msg-base", scenes: [baseScene], visualCues: [baseCue] });
        await generateAssets(spindle, basePlan, createAssetJobs(basePlan, config), config, signal, () => {}, undefined, { sceneCache: cache });
        expect(generateCalls).toHaveLength(1);

        // Run variant
        const varPlan = makePlan({ messageId: `msg-${label}`, scenes: [variantScene], visualCues: [variantCue] });
        await generateAssets(spindle, varPlan, createAssetJobs(varPlan, variantConfig), variantConfig, signal, () => {}, undefined, { sceneCache: cache });

        // Must have caused call #2 (cache miss)
        expect(generateCalls).toHaveLength(2);
      }

      // a) Outfit change
      await testVariant(
        "attire",
        baseScene,
        makeCue({ sceneId: "scene-base", attire: "white sundress", assetJobId: "job-attire" })
      );

      // b) Action change (valid bounded action noun grammar)
      await testVariant(
        "action",
        baseScene,
        makeCue({ sceneId: "scene-base", action: "holding brass lantern in right hand", assetJobId: "job-action" })
      );

      // c) Lighting change
      await testVariant(
        "lighting",
        makeScene({ sceneId: "scene-base", priorSceneId: null, environment: { ...baseScene.environment, lighting: "bright sunlight" } }),
        makeCue({ sceneId: "scene-base", assetJobId: "job-light" })
      );

      // d) Location change
      await testVariant(
        "location",
        makeScene({ sceneId: "scene-base", priorSceneId: null, environment: { ...baseScene.environment, location: "Observatory" } }),
        makeCue({ sceneId: "scene-base", assetJobId: "job-loc" })
      );

      // e) Pose change
      await testVariant(
        "pose",
        baseScene,
        makeCue({ sceneId: "scene-base", poseExpressionId: "smile", assetJobId: "job-pose" })
      );

      // f) Settings change: promptPrefix
      await testVariant(
        "promptPrefix",
        baseScene,
        makeCue({ sceneId: "scene-base", assetJobId: "job-prefix" }),
        { ...config, promptPrefix: "masterpiece, highly detailed" }
      );

      // g) Settings change: negativePrompt
      await testVariant(
        "negativePrompt",
        baseScene,
        makeCue({ sceneId: "scene-base", assetJobId: "job-neg" }),
        { ...config, negativePrompt: "bad quality, blurry" }
      );

      // h) Settings change: model
      await testVariant(
        "model",
        baseScene,
        makeCue({ sceneId: "scene-base", assetJobId: "job-model" }),
        { ...config, imageModel: "illustrious-xl" }
      );

      // i) Settings change: user imageParameters
      await testVariant(
        "parameters",
        baseScene,
        makeCue({ sceneId: "scene-base", assetJobId: "job-params" }),
        { ...config, imageParameters: { cfg_scale: 8.5 } }
      );

      // j) Settings change: referenceAnchoring
      await testVariant(
        "referenceAnchoring",
        baseScene,
        makeCue({ sceneId: "scene-base", assetJobId: "job-ref" }),
        { ...config, referenceAnchoring: true }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Suite 5: Physical Scene Lifetime vs Speaker Boundaries
  // -------------------------------------------------------------------------
  describe("Suite 5: Physical Scene Lifetime vs Speaker Boundaries", () => {
    test("Physical room change retires earlier visit on lookup", () => {
      const cache = new SceneImageCache();
      const scope = sceneImageScope(undefined, "chat-lifetime");
      const token = cache.admission(scope);

      const identity: SceneImageIdentity = {
        subject: { characterId: "char-mira", subjectCategory: "female" },
        appearance: { identity: "silver hair, green eyes", attire: "red coat" },
        environment: { location: "Library", timeWeather: "night", lighting: "lamplight", description: null, persistentElements: [] },
        pose: { id: "neutral", suffix: ", neutral expression" },
        action: null,
        framing: { framing: "upper body", angle: "eye level", perspective: "straight-on" },
        request: { prompt: "mira library", negativePrompt: "lowres", provider: "comfyui", connectionId: null, model: "", parameters: {}, promptSyntax: "comfyui", referenceAnchoring: false }
      };
      const key = sceneImageCacheKey(identity);

      // Episode 1: Initial library visit (episode = "initial:0")
      const episode1 = "initial:0";
      cache.store(scope, key, {
        imageId: "img-lib-1",
        episode: episode1,
        provenance: { provider: "comfyui", connectionId: null, model: "", promptFingerprint: "fp", assistantMessageId: "msg-1", swipeId: 0, jobId: "job-1" }
      }, token);

      // Lookup in same episode hits
      expect(cache.lookup(scope, key, episode1).status).toBe("hit");

      // Later re-entering library after courtyard visit creates a new episode ("scene-yard")
      const episode2 = "scene-yard";
      const missResult = cache.lookup(scope, key, episode2);

      // Looking up an entry belonging to an earlier episode drops it on sight and returns episode_retired!
      expect(missResult.status).toBe("miss");
      if (missResult.status === "miss") {
        expect(missResult.reason).toBe("episode_retired");
      }
      expect(cache.stats().misses.episode_retired).toBe(1);
    });

    test("Initial scene vs post-MESSAGE_DELETED scene do not share entries after scope invalidation", () => {
      const cache = new SceneImageCache();
      const scope = sceneImageScope(undefined, "chat-del");
      const token1 = cache.admission(scope);

      // Identity in initial scene
      const identity: SceneImageIdentity = {
        subject: { characterId: "char-mira", subjectCategory: "female" },
        appearance: { identity: "silver hair, green eyes", attire: "red coat" },
        environment: { location: "Library", timeWeather: "night", lighting: "lamplight", description: null, persistentElements: [] },
        pose: { id: "neutral", suffix: ", neutral expression" },
        action: null,
        framing: { framing: "upper body", angle: "eye level", perspective: "straight-on" },
        request: { prompt: "mira library", negativePrompt: "lowres", provider: "comfyui", connectionId: null, model: "", parameters: {}, promptSyntax: "comfyui", referenceAnchoring: false }
      };
      const key = sceneImageCacheKey(identity);
      const episodeInitial = sceneEpisodeOf({ priorSceneId: null });

      // Store initial
      cache.store(scope, key, {
        imageId: "img-init-1",
        episode: episodeInitial,
        provenance: { provider: "comfyui", connectionId: null, model: "", promptFingerprint: "fp", assistantMessageId: "msg-1", swipeId: 0, jobId: "job-1" }
      }, token1);

      // Lookup succeeds
      expect(cache.lookup(scope, key, episodeInitial).status).toBe("hit");

      // Now MESSAGE_DELETED occurs: invalidate scope
      cache.invalidateScope(scope, "image_deleted");

      // Lookup returns miss (invalidated)
      const postLookup = cache.lookup(scope, key, episodeInitial);
      expect(postLookup.status).toBe("miss");
      if (postLookup.status === "miss") {
        expect(postLookup.reason).toBe("invalidated");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Suite 6: Chat Switch & Late Admission Eviction Races
  // -------------------------------------------------------------------------
  describe("Suite 6: Chat Switch & Late Admission Eviction Races", () => {
    test("Late store from chat A after scope epoch bump is rejected with stale_admission", () => {
      const cache = new SceneImageCache();
      const scopeA = sceneImageScope(undefined, "chat-a");
      const tokenA = cache.admission(scopeA);

      // User switches chats or triggers navigation: epoch bumps on chat A
      cache.bumpEpoch(scopeA, "chat_switch");

      const provenance: SceneImageProvenance = {
        provider: "comfyui",
        connectionId: null,
        model: "",
        promptFingerprint: "fp-12345678",
        assistantMessageId: "msg-a",
        swipeId: 0,
        jobId: "job-a"
      };

      const result = cache.store(scopeA, "sample-key", {
        imageId: "img-late",
        episode: "initial",
        provenance
      }, tokenA);

      expect(result.stored).toBe(false);
      if (!result.stored) {
        expect(result.reason).toBe("stale_admission");
      }
      expect(cache.stats().rejections.stale_admission).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Suite 7: Missing / Evicted Assets Handling
  // -------------------------------------------------------------------------
  describe("Suite 7: Missing / Evicted Assets Handling", () => {
    test("Cache detects missing image in host storage, revokes hit, and falls back to provider", async () => {
      const cache = new SceneImageCache();
      const config = { ...DEFAULT_CONFIG, generateImages: true, imageConcurrency: 1, referenceAnchoring: false };
      const signal = new AbortController().signal;

      // Seed mock spindle with initial generation
      const { spindle, images, generateCalls } = createMockSpindle();
      const scene = makeScene();
      const cue = makeCue({ assetJobId: "job-missing-1" });
      const plan = makePlan({ messageId: "msg-1", scenes: [scene], visualCues: [cue] });

      const res1 = await generateAssets(spindle, plan, createAssetJobs(plan, config), config, signal, () => {}, undefined, { sceneCache: cache });
      expect(generateCalls).toHaveLength(1);
      const generatedImg = res1[0]!.imageId!;
      expect(generatedImg).toBe("img-1");

      // Now delete the image from Lumiverse storage (simulating external deletion / host eviction)
      images.delete(generatedImg);
      expect(await spindle.images.get(generatedImg)).toBeNull();

      // Next turn requests same visual state
      const cue2 = makeCue({ assetJobId: "job-missing-2" });
      const plan2 = makePlan({ messageId: "msg-2", scenes: [scene], visualCues: [cue2] });

      const res2 = await generateAssets(spindle, plan2, createAssetJobs(plan2, config), config, signal, () => {}, undefined, { sceneCache: cache });

      // Verifier detected missing asset -> revoked hit -> generated fresh image (call #2)
      expect(generateCalls).toHaveLength(2);
      expect(res2[0]!.status).toBe("generated");
      expect(res2[0]!.imageId).toBe("img-2");
      expect(res2[0]!.imageId).not.toBe(generatedImg);
      expect(cache.stats().misses.asset_missing).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // Suite 8: Concurrent In-Flight Deduplication & Cancellation
  // -------------------------------------------------------------------------
  describe("Suite 8: Concurrent In-Flight Deduplication & Cancellation", () => {
    test("Concurrent requests share 1 provider call and waiter cleanly aborts without failing owner", async () => {
      const cache = new SceneImageCache();
      const gate = deferred<{ imageId: string; imageUrl?: string | null }>();
      let providerCalls = 0;

      const { spindle } = createMockSpindle({
        onGenerate: async () => {
          providerCalls++;
          return gate.promise;
        }
      });

      const config = { ...DEFAULT_CONFIG, generateImages: true, imageConcurrency: 2, referenceAnchoring: false };
      const scene = makeScene();
      const cue1 = makeCue({ assetJobId: "job-c1" });
      const plan1 = makePlan({ messageId: "msg-c1", scenes: [scene], visualCues: [cue1] });

      const cue2 = makeCue({ assetJobId: "job-c2" });
      const plan2 = makePlan({ messageId: "msg-c2", scenes: [scene], visualCues: [cue2] });

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      // Launch batch 1 (owner)
      const p1 = generateAssets(spindle, plan1, createAssetJobs(plan1, config), config, controller1.signal, () => {}, undefined, { sceneCache: cache });

      // Launch batch 2 (waiter on same key)
      const p2 = generateAssets(spindle, plan2, createAssetJobs(plan2, config), config, controller2.signal, () => {}, undefined, { sceneCache: cache });

      // Abort waiter (controller2) while provider call is in-flight
      controller2.abort("User cancelled turn 2");

      // Settle provider call for owner
      gate.resolve({ imageId: "img-shared-concurrent" });

      const [res1, res2] = await Promise.allSettled([p1, p2]);

      // Owner must succeed
      expect(res1.status).toBe("fulfilled");
      if (res1.status === "fulfilled") {
        expect(res1.value[0]!.status).toBe("generated");
        expect(res1.value[0]!.imageId).toBe("img-shared-concurrent");
      }

      // Provider was called only once
      expect(providerCalls).toBe(1);

      // Waiter was cancelled cleanly
      expect(res2.status).toBe("fulfilled");
      if (res2.status === "fulfilled") {
        expect(res2.value[0]!.status).toBe("cancelled");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Suite 9: Memory Bounds & LRU Eviction Without History Corruption
  // -------------------------------------------------------------------------
  describe("Suite 9: Memory Bounds & LRU Eviction", () => {
    test("Exceeding maxEntries evicts LRU entry while stored turn records remain intact", async () => {
      // Cache with max capacity 2
      const cache = new SceneImageCache({ maxEntries: 2 });
      const { spindle, storage, generateCalls } = createMockSpindle();
      const config = { ...DEFAULT_CONFIG, generateImages: true, imageConcurrency: 1, referenceAnchoring: false };
      const signal = new AbortController().signal;

      // Turn 1: State A
      const sceneA = makeScene({ sceneId: "s-a", basePrompt: "state A" });
      const cueA = makeCue({ sceneId: "s-a", characterId: "char-a", assetJobId: "job-a" });
      const planA = makePlan({ messageId: "msg-a", scenes: [sceneA], visualCues: [cueA] });
      const resA = await generateAssets(spindle, planA, createAssetJobs(planA, config), config, signal, () => {}, undefined, { sceneCache: cache });
      const recordA: StoredTurnRecord = {
        schemaVersion: 1,
        speaker: "Mira",
        status: "ready",
        plan: planA,
        jobs: resA,
        updatedAt: now
      };
      await spindle.userStorage.setJson(turnPath("chat-integration", "msg-a", 0), recordA);

      // Turn 2: State B
      const sceneB = makeScene({ sceneId: "s-b", basePrompt: "state B" });
      const cueB = makeCue({ sceneId: "s-b", characterId: "char-b", assetJobId: "job-b" });
      const planB = makePlan({ messageId: "msg-b", scenes: [sceneB], visualCues: [cueB] });
      await generateAssets(spindle, planB, createAssetJobs(planB, config), config, signal, () => {}, undefined, { sceneCache: cache });

      expect(cache.stats().entries).toBe(2);

      // Turn 3: State C (causes eviction of State A)
      const sceneC = makeScene({ sceneId: "s-c", basePrompt: "state C" });
      const cueC = makeCue({ sceneId: "s-c", characterId: "char-c", assetJobId: "job-c" });
      const planC = makePlan({ messageId: "msg-c", scenes: [sceneC], visualCues: [cueC] });
      await generateAssets(spindle, planC, createAssetJobs(planC, config), config, signal, () => {}, undefined, { sceneCache: cache });

      expect(cache.stats().entries).toBe(2);
      expect(cache.stats().evictions).toBe(1);

      // Turn 4: State A again -> Cache MISS because it was evicted!
      expect(generateCalls).toHaveLength(3);
      const cueA2 = makeCue({ sceneId: "s-a", characterId: "char-a", assetJobId: "job-a-2" });
      const planA2 = makePlan({ messageId: "msg-a2", scenes: [sceneA], visualCues: [cueA2] });
      await generateAssets(spindle, planA2, createAssetJobs(planA2, config), config, signal, () => {}, undefined, { sceneCache: cache });
      expect(generateCalls).toHaveLength(4);

      // Stored record A in storage remains completely unaffected and intact!
      const reloadedRecordA = (await spindle.userStorage.getJson(turnPath("chat-integration", "msg-a", 0), { fallback: null })) as unknown as StoredTurnRecord;
      expect(reloadedRecordA.jobs[0]!.imageId).toBe(resA[0]!.imageId);
      expect(reloadedRecordA.jobs[0]!.status).toBe("generated");
    });
  });

  // -------------------------------------------------------------------------
  // Suite 10: Beyond-Cap Reuse-Only Candidates (cacheCues)
  // -------------------------------------------------------------------------
  describe("Suite 10: Beyond-Cap Reuse-Only Candidates", () => {
    test("Cold candidate cue causes 0 provider calls; warm candidate cue delivers extra cached swap", async () => {
      const cache = new SceneImageCache();
      const { spindle, generateCalls } = createMockSpindle();
      const config = { ...DEFAULT_CONFIG, generateImages: true, imageConcurrency: 1, referenceAnchoring: false };
      const signal = new AbortController().signal;

      // Turn 1: Generate Mira neutral in Library
      const scene1 = makeScene({ sceneId: "scene-1" });
      const cue1 = makeCue({ sceneId: "scene-1", paragraphIndex: 0, characterId: "char-mira", poseExpressionId: "neutral", assetJobId: "job-t1" });
      const plan1 = makePlan({ messageId: "msg-1", scenes: [scene1], visualCues: [cue1] });
      const res1 = await generateAssets(spindle, plan1, createAssetJobs(plan1, config), config, signal, () => {}, undefined, { sceneCache: cache });
      expect(generateCalls).toHaveLength(1);
      const miraImg = res1[0]!.imageId!;

      // Turn 2: Has 1 budgeted cue (Alex) and 1 candidate cue (Mira neutral) in cacheCues beyond cap
      const scene2 = makeScene({ sceneId: "scene-2", priorSceneId: null, character: "Alex" });
      const budgetedCue = makeCue({
        sceneId: "scene-2",
        paragraphIndex: 0,
        character: "Alex",
        characterId: "char-alex",
        resolvedIdentity: "short brown hair, blue eyes",
        subjectCategory: "male",
        poseExpressionId: "smile",
        assetJobId: "job-budgeted"
      });
      const candidateWarm = makeCue({
        sceneId: "scene-2",
        paragraphIndex: 1,
        character: "Mira",
        characterId: "char-mira",
        resolvedIdentity: "silver hair, green eyes, red coat",
        subjectCategory: "female",
        poseExpressionId: "neutral",
        assetJobId: "job-candidate-warm"
      });

      const plan2 = TurnPlanSchema.parse({
        schemaVersion: 1,
        key: { chatId: "chat-integration", assistantMessageId: "msg-2", swipeId: 0, sourceFingerprint: "fp-12345678", revision: 0 },
        paragraphs: [
          { index: 0, sourceIndex: 0, text: "Alex speaks." },
          { index: 1, sourceIndex: 1, text: "Mira reacts." }
        ],
        scenes: [scene2],
        visualCues: [budgetedCue],
        cacheCues: [candidateWarm],
        choices: [],
        initialContinuity: { revision: 0, characters: {}, facts: {} },
        continuityDeltas: [],
        terminalContinuity: { revision: 0, characters: {}, facts: {} },
        planningStatus: "planned",
        createdAt: now
      });

      // Step A: resolveCacheCues for warm candidate
      const resolvedCues = await resolveCacheCues(spindle, plan2, config, undefined, [], cache);
      expect(resolvedCues).toHaveLength(1);
      expect(resolvedCues[0]!.provider).toBe(CACHE_JOB_PROVIDER);
      expect(resolvedCues[0]!.status).toBe("generated");
      expect(resolvedCues[0]!.imageId).toBe(miraImg);

      // Now run generateAssets for budgeted cue
      const budgetedJobs = createAssetJobs(plan2, config);
      await generateAssets(spindle, plan2, budgetedJobs, config, signal, () => {}, undefined, { sceneCache: cache });

      // Total provider calls must be exactly 2 (1 for Turn 1 Mira + 1 for Turn 2 Alex; 0 for candidate!)
      expect(generateCalls).toHaveLength(2);

      // Step B: Cold candidate test (candidate visual state has never been generated)
      const candidateCold = makeCue({
        sceneId: "scene-2",
        paragraphIndex: 1,
        character: "UnknownGuest",
        characterId: "char-guest",
        resolvedIdentity: "purple hair, yellow eyes",
        subjectCategory: "female",
        poseExpressionId: "neutral",
        assetJobId: "job-candidate-cold"
      });
      const planCold = TurnPlanSchema.parse({
        ...plan2,
        key: { ...plan2.key, assistantMessageId: "msg-cold" },
        cacheCues: [candidateCold]
      });

      const resolvedCold = await resolveCacheCues(spindle, planCold, config, undefined, [], cache);
      // Miss produces NO job and NO provider calls!
      expect(resolvedCold).toHaveLength(0);
      expect(generateCalls).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Suite 11: Fail-Closed on Unresolved / Legacy Identity
  // -------------------------------------------------------------------------
  describe("Suite 11: Fail-Closed on Unresolved / Legacy Identity", () => {
    test("Cues missing characterId, resolvedIdentity, or subjectCategory bypass cache", () => {
      // Legacy cue missing characterId
      const legacyCue = makeCue({ characterId: undefined as any });
      expect(cacheEligibleCue(legacyCue)).toBe(false);

      // Cue with empty resolvedIdentity
      const emptyIdentityCue = makeCue({ resolvedIdentity: "   " });
      expect(cacheEligibleCue(emptyIdentityCue)).toBe(false);

      // Cue with missing subjectCategory
      const missingCategoryCue = makeCue({ subjectCategory: undefined as any });
      expect(cacheEligibleCue(missingCategoryCue)).toBe(false);

      // Valid cue is eligible
      const validCue = makeCue();
      expect(cacheEligibleCue(validCue)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Suite 12: Historical Ownership Decoupled from Invalidation
  // -------------------------------------------------------------------------
  describe("Suite 12: Historical Ownership Decoupled from Invalidation", () => {
    test("markAssetReady succeeds on stored record even after cache is cleared", async () => {
      const cache = new SceneImageCache();
      const { spindle, storage } = createMockSpindle();
      const config = { ...DEFAULT_CONFIG, generateImages: true, imageConcurrency: 1, referenceAnchoring: false };
      const signal = new AbortController().signal;

      const scene = makeScene();
      const cue = makeCue({ assetJobId: "job-hist-1" });
      const plan = makePlan({ messageId: "msg-hist", scenes: [scene], visualCues: [cue] });

      const finalJobs = await generateAssets(spindle, plan, createAssetJobs(plan, config), config, signal, () => {}, undefined, { sceneCache: cache });
      const record: StoredTurnRecord = {
        schemaVersion: 1,
        speaker: "Mira",
        status: "ready",
        plan,
        jobs: finalJobs,
        updatedAt: now
      };
      const path = turnPath("chat-integration", "msg-hist", 0);
      await spindle.userStorage.setJson(path, record);

      const state: StoredChatState = {
        schemaVersion: 1,
        activeTurnPath: path,
        latestScene: plan.scenes[0]!,
        terminalContinuity: plan.terminalContinuity,
        updatedAt: now
      };
      await spindle.userStorage.setJson(chatStatePath("chat-integration"), state);

      // Completely clear the cache
      cache.clear();
      expect(cache.stats().entries).toBe(0);

      // markAssetReady reads the stored record directly from userStorage
      await markAssetReady(spindle, {
        type: "vn_asset_ready",
        chatId: "chat-integration",
        messageId: "msg-hist",
        jobId: "job-hist-1",
        sourceFingerprint: plan.key.sourceFingerprint
      });

      const updatedRecord = (await spindle.userStorage.getJson(path, { fallback: null })) as unknown as StoredTurnRecord;
      expect(updatedRecord.jobs[0]!.status).toBe("browser_ready");
      expect(updatedRecord.jobs[0]!.readyAt).toBeString();
    });
  });


  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Suite 13: Actual Controller Events & Lifecycle Integration
  // -------------------------------------------------------------------------
  describe("Suite 13: Actual Controller Events & Lifecycle Integration", () => {
    test("sendState for chat B releases chat A scope via controller noteActiveChat", async () => {
      const cache = sceneImageCache();
      cache.clear();
      const scopeA = sceneImageScope(undefined, "chat-ctrl-a");
      const tokenA = cache.admission(scopeA);

      // Store an entry in chat A
      const provenance: SceneImageProvenance = {
        provider: "comfyui",
        connectionId: null,
        model: "",
        promptFingerprint: "fp-12345678",
        assistantMessageId: "msg-a",
        swipeId: 0,
        jobId: "job-a"
      };
      cache.store(scopeA, "key-a", { imageId: "img-a", episode: "initial:0", provenance }, tokenA);
      expect(cache.lookup(scopeA, "key-a", "initial:0").status).toBe("hit");

      // Setup controller runtime
      const data = new Map<string, unknown>();
      data.set("config.json", { generateImages: false, maxImagesPerTurn: 1 });
      const spindle = {
        userStorage: {
          getJson: async (path: string, opts: any) => data.get(path) ?? opts.fallback,
          setJson: async (path: string, val: any) => { data.set(path, val); }
        },
        chat: { getMessages: async () => [] },
        sendToFrontend: () => {},
        log: { info: () => {}, warn: () => {}, error: () => {} }
      } as unknown as SpindleAPI;

      // Call sendState for chat-ctrl-a (activates chat A)
      await sendState(spindle, "chat-ctrl-a");

      // Call sendState for chat-ctrl-b (switches active chat to B -> releases chat A scope!)
      await sendState(spindle, "chat-ctrl-b");

      // Chat A's scope was invalidated by controller!
      const postSwitchLookup = cache.lookup(scopeA, "key-a", "initial:0");
      expect(postSwitchLookup.status).toBe("miss");
      if (postSwitchLookup.status === "miss") {
        expect(postSwitchLookup.reason).toBe("invalidated");
      }
    });

    test("Controller GENERATION_STARTED event handler advances scope epoch", () => {
      const cache = sceneImageCache();
      cache.clear();
      const scope = sceneImageScope(undefined, "chat-event");
      const tokenBefore = cache.admission(scope);

      let registeredHandler!: (payload: { chatId: string }) => void;
      const spindle = {
        on: (event: string, handler: any) => {
          if (event === "GENERATION_STARTED") registeredHandler = handler;
          return () => {};
        },
        onFrontendMessage: () => {},
        sendToFrontend: () => {},
        log: { info: () => {}, warn: () => {}, error: () => {} }
      } as unknown as SpindleAPI;

      registerVisualNovelBackend(spindle);
      expect(registeredHandler).toBeDefined();

      // Fire the actual controller GENERATION_STARTED event
      registeredHandler({ chatId: "chat-event" });

      // Token minted before event must now be stale
      expect(cache.isAdmitted(tokenBefore)).toBe(false);
    });

    test("Controller MESSAGE_DELETED event handler clears chat scope when active message is deleted", async () => {
      const cache = sceneImageCache();
      cache.clear();
      const scope = sceneImageScope(undefined, "chat-delete-event");
      const token = cache.admission(scope);

      cache.store(scope, "key-del", {
        imageId: "img-del",
        episode: "initial:0",
        provenance: { provider: "comfyui", connectionId: null, model: "", promptFingerprint: "fp-12345678", assistantMessageId: "msg-del", swipeId: 0, jobId: "job-del" }
      }, token);

      expect(cache.lookup(scope, "key-del", "initial:0").status).toBe("hit");

      const scene = makeScene();
      const cue = makeCue({ assetJobId: "job-del" });
      const plan = makePlan({ chatId: "chat-delete-event", messageId: "msg-del", scenes: [scene], visualCues: [cue] });
      const record: StoredTurnRecord = {
        schemaVersion: 1,
        speaker: "Mira",
        status: "ready",
        plan,
        jobs: [],
        updatedAt: now
      };
      const path = turnPath("chat-delete-event", "msg-del", 0);
      const data = new Map<string, unknown>([
        [chatStatePath("chat-delete-event"), { schemaVersion: 1, activeTurnPath: path, latestScene: scene, terminalContinuity: plan.terminalContinuity, updatedAt: now }],
        [path, record],
        ["config.json", { generateImages: false }]
      ]);

      let deleteHandler!: (payload: { chatId: string; messageId: string }) => void;
      const spindle = {
        userStorage: {
          getJson: async (p: string, opts: any) => data.get(p) ?? opts.fallback,
          setJson: async (p: string, val: any) => { data.set(p, val); }
        },
        chat: { getMessages: async () => [] },
        on: (event: string, handler: any) => {
          if (event === "MESSAGE_DELETED") deleteHandler = handler;
          return () => {};
        },
        onFrontendMessage: () => {},
        sendToFrontend: () => {},
        log: { info: () => {}, warn: () => {}, error: () => {} }
      } as unknown as SpindleAPI;

      registerVisualNovelBackend(spindle);
      expect(deleteHandler).toBeDefined();

      // Fire MESSAGE_DELETED controller event
      deleteHandler({ chatId: "chat-delete-event", messageId: "msg-del" });

      // Wait a microtask cycle for the async deletion handler to complete
      for (let i = 0; i < 20; i++) {
        await new Promise((res) => setTimeout(res, 5));
        if (cache.lookup(scope, "key-del", "initial:0").status === "miss") break;
      }

      // Chat scope was completely cleared by the controller
      expect(cache.lookup(scope, "key-del", "initial:0").status).toBe("miss");
    });
  });

  // Suite 14: Frontend Progress and Retry Accounting (AssetView.source === "cache")
  // -------------------------------------------------------------------------
  describe("Suite 14: Frontend Progress and Retry Accounting", () => {
    test("turnView attaches source: 'cache' to jobs with CACHE_JOB_PROVIDER", () => {
      const scene = makeScene();
      const cue = makeCue();
      const plan = makePlan({ scenes: [scene], visualCues: [cue] });

      const normalJob: AssetJob = AssetJobSchema.parse({
        jobId: "job-normal",
        ownerTurnKey: plan.key,
        sceneId: "scene-library",
        sceneRevision: 0,
        paragraphIndex: 0,
        promptFingerprint: "fp-normal-123",
        provider: "image:default",
        priority: "visible",
        status: "generated",
        imageId: "img-norm",
        imageUrl: "/img-norm",
        error: null,
        queuedAt: now,
        startedAt: now,
        generatedAt: now,
        readyAt: null,
        finishedAt: null
      });

      const cachedJob: AssetJob = AssetJobSchema.parse({
        jobId: "job-cached",
        ownerTurnKey: plan.key,
        sceneId: "scene-library",
        sceneRevision: 0,
        paragraphIndex: 1,
        promptFingerprint: "fp-cached-123",
        provider: CACHE_JOB_PROVIDER,
        priority: "background",
        status: "generated",
        imageId: "img-cache",
        imageUrl: "/img-cache",
        error: null,
        queuedAt: now,
        startedAt: now,
        generatedAt: now,
        readyAt: null,
        finishedAt: null
      });

      const record: StoredTurnRecord = {
        schemaVersion: 1,
        speaker: "Mira",
        status: "ready",
        plan,
        jobs: [normalJob, cachedJob],
        updatedAt: now
      };

      const view = turnView(record);
      expect(view.assets).toHaveLength(2);
      expect(view.assets[0]!.source).toBeUndefined();
      expect(view.assets[1]!.source).toBe("cache");
    });

    test("computeAssetProgress ignores cached swap jobs and only counts budgeted jobs", async () => {
      const { computeAssetProgress } = await import("../../frontend/host/controller.js");

      // Turn with 1 generating budgeted job and 1 already-ready cached job
      const turnViewWithCache = {
        turnId: "turn-1",
        speaker: "Mira",
        status: "ready" as const,
        paragraphs: ["Beat 1", "Beat 2"],
        assets: [
          { jobId: "j-norm", paragraphIndex: 0, status: "generating" as const, imageUrl: null },
          { jobId: "j-cache", paragraphIndex: 1, status: "generated" as const, imageUrl: "/img", source: "cache" as const }
        ]
      };

      const progress = computeAssetProgress(turnViewWithCache as any);
      // Total must be 1 (budgeted job only), NOT 2!
      expect(progress).not.toBeNull();
      expect(progress!.total).toBe(1);
      expect(progress!.current).toBe(1);
    });

    test("retryScopeForTurn excludes cached swap jobs from retry counts", async () => {
      const { retryScopeForTurn, describeRetryScope } = await import("../../frontend/host/turn-status.js");

      // Turn with 1 failed normal job and 1 cached swap
      const turnWithFailedAndCache = {
        status: "ready" as const,
        assets: [
          { jobId: "j-failed", paragraphIndex: 0, status: "failed" as const, imageUrl: null },
          { jobId: "j-cached", paragraphIndex: 1, status: "generated" as const, imageUrl: "/img", source: "cache" as const }
        ]
      };

      const scope = retryScopeForTurn(turnWithFailedAndCache as any);
      expect(scope.unfinished).toBe(1);
      expect(scope.kept).toBe(0);

      const desc = describeRetryScope(scope);
      // Describes only the 1 unfinished real image, not the cached swap!
      expect(desc).toBe("Try again makes 1 image again.");
    });
  });


  // -------------------------------------------------------------------------
  // Suite 15: End-to-End Real Controller Lifecycle Integration (Reviewer Probe)
  // -------------------------------------------------------------------------
  describe("Suite 15: Real Controller Lifecycle Integration", () => {
    type Script = {
      speaker: string;
      location: string;
      claimNew: boolean;
      reason: string;
      cues: Array<number | [number, string]>;
      expression?: string;
    };
    const CONTENT = "One.\n\nTwo.\n\nThree.\n\nFour.";

    function lifecycleFixture() {
      const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
      let frontend: ((payload: unknown, userId: string) => void) | null = null;
      const data = new Map<string, unknown>();
      const sent: Array<Record<string, unknown>> = [];
      const providerCalls: string[] = [];
      const images = new Set<string>();
      const deletes: string[] = [];
      let seq = 0;
      let script: Script = { speaker: "Mira", location: "Observatory", claimNew: true, reason: "initial", cues: [0] };
      const messages: Array<Record<string, unknown>> = [];
      let gate: { pending: boolean; release: () => void } | null = null;

      data.set("config.json", {
        generateImages: true,
        maxImagesPerTurn: 2,
        imageConcurrency: 2,
        referenceAnchoring: false,
        debugLogging: false,
        includeCharacterContext: false,
        includePersonaContext: false,
        includeLorebookContext: false
      });

      const spindle = {
        on: (event: string, handler: (...args: unknown[]) => void) => {
          handlers.set(event, [...(handlers.get(event) ?? []), handler]);
          return () => {};
        },
        onFrontendMessage: (fn: (payload: unknown, userId: string) => void) => { frontend = fn; },
        userStorage: {
          getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
          setJson: async (path: string, value: unknown) => { data.set(path, value); }
        },
        chat: { getMessages: async (chatId: string) => messages.filter((m) => m.chat_id === chatId) },
        generate: {
          raw: async () => ({
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: {
                  claimedNewScene: script.claimNew,
                  reason: script.reason,
                  location: script.location,
                  timeOfDay: "night",
                  majorTimeJump: false,
                  environmentReplacement: false,
                  forced: false
                },
                environment: {
                  location: script.location,
                  timeOfDay: "night",
                  weather: null,
                  lighting: "lantern light",
                  description: `An old ${script.location.toLowerCase()}`,
                  persistentElements: ["brass telescope"]
                },
                cast: [script.speaker],
                character: script.speaker,
                basePrompt: "base",
                compositionLock: `${script.speaker} centered ${Math.random()}`
              }],
              cues: script.cues.map((entry) =>
                Array.isArray(entry)
                  ? { paragraphIndex: entry[0], character: script.speaker, expression: entry[1] }
                  : { paragraphIndex: entry, character: script.speaker, expression: script.expression ?? "smile" }
              ),
              choices: [],
              effects: [],
              speakers: [],
              characters: [
                { name: "Mira", description: "silver hair, green eyes, red coat" },
                { name: "Alex", description: "black hair, brown eyes, grey hoodie" }
              ]
            })
          })
        },
        imageGen: {
          generate: async (input: { prompt: string }) => {
            providerCalls.push(input.prompt);
            if (gate?.pending) await new Promise<void>((resolve) => { gate!.release = resolve; });
            const imageId = `img-${++seq}`;
            images.add(imageId);
            return { imageId, imageUrl: `/api/v1/images/${imageId}`, imageDataUrl: "", model: "m", provider: "comfyui" };
          },
          getConnection: async () => ({ provider: "comfyui" }),
          listConnections: async () => [{ provider: "comfyui", is_default: true }]
        },
        images: {
          get: async (id: string) => (images.has(id) ? { id } : null),
          delete: async (id: string) => { deletes.push(id); return true; }
        },
        sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); },
        log: { info() {}, warn() {}, error() {} }
      } as unknown as SpindleAPI;

      const fire = (event: string, ...args: unknown[]) => {
        for (const handler of handlers.get(event) ?? []) handler(...args);
      };
      const request = (payload: unknown) => frontend!(payload, "user-1");

      const say = async (chatId: string, id: string, s: Script) => {
        script = s;
        messages.push({
          id,
          chat_id: chatId,
          content: CONTENT,
          is_user: false,
          name: s.speaker,
          swipe_id: 0,
          swipes: [CONTENT],
          swipe_dates: [1],
          extra: {},
          parent_message_id: null,
          branch_id: null,
          created_at: 1,
          index_in_chat: messages.length,
          send_date: 1
        });
        const before = sent.length;
        fire("GENERATION_ENDED", { chatId, messageId: id, content: CONTENT }, "user-1");
        const start = Date.now();
        while (!sent.slice(before).some((m) => m.type === "vn_turn" && (m.turn as { messageId: string }).messageId === id)) {
          if (Date.now() - start > 3000) throw new Error("Timed out waiting for vn_turn");
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
        return sent.slice(before);
      };

      const record = (chatId: string, id: string) => data.get(turnPath(chatId, id, 0)) as unknown as StoredTurnRecord;
      const openGate = () => { gate = { pending: true, release: () => {} }; };
      const closeGate = () => { gate!.pending = false; gate!.release(); };

      return { spindle, fire, request, say, record, sent, providerCalls, images, deletes, data, openGate, closeGate };
    }

    test("end-to-end controller loop: reuse, extra swaps before first vn_turn, retry, chat switch, delete, stale late result", async () => {
      const f = lifecycleFixture();
      registerVisualNovelBackend(f.spindle);
      const cache = sceneImageCache();
      cache.clear();
      const scopeA = sceneImageScope("user-1", "chat-A");

      // T1: Mira, cap 2, cues at p0..p3. 2 provider calls; p2/p3 are cache candidates.
      const t1 = await f.say("chat-A", "m1", {
        speaker: "Mira",
        location: "Observatory",
        claimNew: true,
        reason: "initial",
        cues: [[0, "smile"], [1, "angry"], [2, "smile"], [3, "angry"]]
      });
      expect(f.providerCalls.length).toBe(2);
      const r1 = f.record("chat-A", "m1");
      expect(r1.plan.visualCues.length).toBe(2);
      expect(r1.plan.cacheCues?.length).toBe(2);

      // Wait for late-population extra swaps
      const startT1 = Date.now();
      while (f.record("chat-A", "m1").jobs.filter((j) => j.provider === "cache").length < 2) {
        if (Date.now() - startT1 > 3000) throw new Error("Timed out waiting for cache jobs");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }

      const cacheViews = t1.concat(f.sent).filter((m) => m.type === "vn_asset" && (m.asset as { source?: string }).source === "cache");
      expect(cacheViews.length).toBeGreaterThanOrEqual(2);
      expect(f.providerCalls.length).toBe(2);
      expect(cache.snapshot(scopeA).length).toBe(2);

      // T2: Alex in same observatory (speaker switch new scene id): different identity -> 2 calls.
      await f.say("chat-A", "m2", {
        speaker: "Alex",
        location: "Observatory",
        claimNew: false,
        reason: "none",
        cues: [[0, "smile"], [1, "angry"]]
      });
      expect(f.providerCalls.length).toBe(4);
      const r2 = f.record("chat-A", "m2");
      expect(r2.plan.scenes[0]!.sceneId).not.toBe(r1.plan.scenes[0]!.sceneId);
      expect(r2.plan.scenes[0]!.priorSceneId).toBe(r1.plan.scenes[0]!.priorSceneId);

      // T3: Mira again, cues p0..p2: ZERO calls; the FIRST vn_turn already carries cache swap for p2.
      const t3 = await f.say("chat-A", "m3", {
        speaker: "Mira",
        location: "Observatory",
        claimNew: false,
        reason: "none",
        cues: [[0, "smile"], [1, "angry"], [2, "smile"]]
      });
      expect(f.providerCalls.length).toBe(4);
      const firstTurnView = t3.find((m) => m.type === "vn_turn") as {
        turn: { assets: Array<{ paragraphIndex: number; status: string; source?: string; imageId?: string }> };
      };
      const assets3 = firstTurnView.turn.assets;
      expect(assets3.filter((a) => a.source === "cache").map((a) => a.paragraphIndex)).toEqual([2]);
      expect(assets3.find((a) => a.source === "cache")!.status).toBe("generated");

      const startT3 = Date.now();
      while (!f.record("chat-A", "m3").jobs.every((j) => j.status === "generated")) {
        if (Date.now() - startT3 > 3000) throw new Error("Timed out waiting for T3 jobs");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }

      const r3 = f.record("chat-A", "m3");
      expect(new Set(r3.jobs.map((j) => j.imageId)).size).toBe(2);
      expect(r3.jobs[0]!.imageId).toBe(r1.jobs[0]!.imageId);
      expect(r3.jobs.every((j) => j.ownerTurnKey.assistantMessageId === "m3")).toBe(true);

      // Retry T3: everything is generated -> kept, no provider call, cache job untouched.
      const beforeRetry = f.sent.length;
      f.request({ type: "vn_retry_turn", chatId: "chat-A", messageId: "m3" });
      const startRetry = Date.now();
      while (!f.sent.slice(beforeRetry).some((m) => m.type === "vn_turn")) {
        if (Date.now() - startRetry > 3000) throw new Error("Timed out waiting for retry vn_turn");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      expect(f.providerCalls.length).toBe(4);
      expect(f.record("chat-A", "m3").jobs.filter((j) => j.provider === "cache").length).toBe(1);

      // Browser ack on the cache job works from the record alone.
      const cacheJob = r3.jobs.find((j) => j.provider === "cache")!;
      f.request({
        type: "vn_asset_ready",
        chatId: "chat-A",
        messageId: "m3",
        jobId: cacheJob.jobId,
        sourceFingerprint: r3.plan.key.sourceFingerprint
      });
      const startAck = Date.now();
      while (f.record("chat-A", "m3").jobs.find((j) => j.jobId === cacheJob.jobId)!.status !== "browser_ready") {
        if (Date.now() - startAck > 3000) throw new Error("Timed out waiting for browser_ready ack");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }

      // Stale late result: T4 starts generating, GENERATION_STARTED interrupts, late completion is not cached.
      f.openGate();
      const messagesBefore = f.providerCalls.length;
      const t4 = f.say("chat-A", "m4", {
        speaker: "Mira",
        location: "Observatory",
        claimNew: false,
        reason: "none",
        cues: [0],
        expression: "laugh"
      });
      const startGate = Date.now();
      while (f.providerCalls.length !== messagesBefore + 1) {
        if (Date.now() - startGate > 3000) throw new Error("Timed out waiting for provider call");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      f.fire("GENERATION_STARTED", { chatId: "chat-A" }, "user-1");
      f.closeGate();
      await t4;
      expect(cache.snapshot(scopeA).length).toBe(4);
      expect(f.record("chat-A", "m4").jobs[0]!.status).not.toBe("generated");

      // Chat switch: viewing chat B releases chat A's scope.
      f.request({ type: "vn_get_state", chatId: "chat-A" });
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      expect(cache.snapshot(scopeA).length).toBe(4);

      f.request({ type: "vn_get_state", chatId: "chat-B" });
      const startB = Date.now();
      while (cache.snapshot(scopeA).length !== 0) {
        if (Date.now() - startB > 3000) throw new Error("Timed out waiting for chat switch release");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      expect(cache.stats().invalidations.chat_switch).toBeGreaterThanOrEqual(1);

      f.request({ type: "vn_get_state", chatId: "chat-A" });
      await new Promise<void>((resolve) => setTimeout(resolve, 40));

      // Back in chat A the same Mira cue must generate again (no resurrection).
      const calls = f.providerCalls.length;
      await f.say("chat-A", "m5", {
        speaker: "Mira",
        location: "Observatory",
        claimNew: false,
        reason: "none",
        cues: [0]
      });
      expect(f.providerCalls.length).toBe(calls + 1);
      expect(cache.snapshot(scopeA).length).toBe(1);

      // Delete: scope cleared and generation advanced; nothing was ever deleted from the host.
      f.fire("MESSAGE_DELETED", { chatId: "chat-A", messageId: "m5" }, "user-1");
      const startDel = Date.now();
      while (cache.snapshot(scopeA).length !== 0) {
        if (Date.now() - startDel > 3000) throw new Error("Timed out waiting for delete release");
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      expect(cache.generation(scopeA)).toBeGreaterThanOrEqual(2);
      expect(f.deletes).toEqual([]);

      // Every persisted record still holds its image ids after all cache churn.
      for (const id of ["m1", "m2", "m3"]) {
        expect(f.record("chat-A", id).jobs.every((j) => j.imageId)).toBe(true);
      }
    });
  });

});
