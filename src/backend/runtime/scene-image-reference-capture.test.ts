// Adopted from cache-review probe `.cache/scene-cache/probes/reference-capture.regression.test.ts` (import paths adjusted).
/**
 * Regression probe (cache-review) for the exact found case: a cache hit must
 * never skip a reference-portrait capture render, and existing capture
 * concurrency (one capture per character, later cues anchored) must be
 * unchanged with the cache on.
 */
import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../config.js";
import { TurnPlanSchema, type AssetJob, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import { createAssetJobs, generateAssets } from "./images.js";
import { SceneImageCache } from "../core/scene-image-cache.js";
import { portraitStatePath } from "./storage.js";

const now = new Date().toISOString();
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function scene(): SceneState {
  return {
    sceneId: "s1", revision: 0, startParagraph: 0,
    environment: { location: "Library", timeOfDay: "night", weather: null, lighting: "lamplight", description: "A quiet library.", persistentElements: ["oak desk"] },
    cast: ["Mira"], continuity: { revision: 0, characters: {}, facts: {} }, basePrompt: "base", identityPrompt: "silver hair, green eyes, red coat",
    cameraLock: { framing: "upper body", angle: "eye level", perspective: "straight-on", lens: null, subjectAnchor: "c", horizon: "h", safeDialogueRegion: "r", aspectRatio: "16:9" },
    compositionLock: "lock", activeAssetId: null, priorSceneId: null, character: "Mira", characterId: "mira", subjectCategory: "female", attire: null
  };
}
function cue(p: number, pose: string, tag: string): VisualCue {
  return { cueId: `cue-${tag}-${p}`, paragraphIndex: p, sceneId: "s1", sceneRevision: 0, kind: "flattened_scene", action: null, expression: null, poseExpressionId: pose, promptDelta: "", assetJobId: `job-${tag}-${p}`, character: "Mira", characterId: "mira", subjectCategory: "female", resolvedIdentity: "silver hair, green eyes, red coat", resolvedAttire: null };
}
function plan(tag: string, cues: Array<[number, string]>): TurnPlan {
  return TurnPlanSchema.parse({
    schemaVersion: 1, key: { chatId: "chat-A", assistantMessageId: `m-${tag}`, swipeId: 0, sourceFingerprint: `fp-${tag}-00000000`, revision: 1 },
    paragraphs: [0, 1, 2].map((index) => ({ index, sourceIndex: index, text: `P${index}` })), scenes: [scene()],
    visualCues: cues.map(([p, pose]) => cue(p, pose, tag)), choices: [], initialContinuity: { revision: 0, characters: {}, facts: {} }, continuityDeltas: [],
    terminalContinuity: { revision: 0, characters: {}, facts: {} }, planningStatus: "planned", createdAt: now
  });
}

function harness() {
  const calls: Array<{ includeDataUrl: boolean | undefined; anchored: boolean }> = [];
  const store = new Map<string, unknown>();
  const images = new Set<string>();
  let seq = 0;
  const spindle = {
    log: { info() {}, warn() {}, error() {} },
    imageGen: {
      generate: async (input: { includeDataUrl?: boolean; parameters?: Record<string, unknown> }) => {
        calls.push({ includeDataUrl: input.includeDataUrl, anchored: Boolean(input.parameters?.resolvedReferenceImages) });
        await new Promise((resolve) => setTimeout(resolve, 10));
        const imageId = `img-${++seq}`; images.add(imageId);
        return { imageId, imageUrl: `/api/v1/images/${imageId}`, imageDataUrl: PNG, model: "m", provider: "novelai" };
      },
      getConnection: async () => ({ provider: "novelai" }),
      listConnections: async () => [{ provider: "novelai", is_default: true }]
    },
    images: { get: async (id: string) => images.has(id) ? { id } : null },
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown }) => store.get(path) ?? options.fallback,
      setJson: async (path: string, value: unknown) => { store.set(path, value); }
    }
  } as unknown as SpindleAPI;
  return { spindle, calls, store, images };
}
async function run(h: ReturnType<typeof harness>, cache: SceneImageCache, p: TurnPlan, cfg: VisualNovelConfig): Promise<AssetJob[]> {
  return generateAssets(h.spindle, p, createAssetJobs(p, cfg), cfg, new AbortController().signal, () => {}, undefined, { sceneCache: cache });
}
const off: VisualNovelConfig = { ...DEFAULT_CONFIG, maxImagesPerTurn: 2, imageConcurrency: 2, referenceAnchoring: false };
const on: VisualNovelConfig = { ...off, referenceAnchoring: true };
const portraits = (h: ReturnType<typeof harness>) => ((h.store.get(portraitStatePath("chat-A")) as { portraits?: Record<string, unknown> } | undefined)?.portraits ?? {});

describe("regression: reference capture vs scene cache", () => {
  test("anchoring off -> on: the next render of a character with no portrait MUST capture, even though the cache has a hit", async () => {
    const cache = new SceneImageCache();
    const h = harness();
    const t1 = await run(h, cache, plan("a1", [[0, "smile"]]), off);
    expect(t1[0]!.status).toBe("generated");
    expect(h.calls).toEqual([{ includeDataUrl: false, anchored: false }]);
    expect(Object.keys(portraits(h))).toEqual([]);
    const t2 = await run(h, cache, plan("a2", [[0, "smile"]]), on);
    expect(t2[0]!.status).toBe("generated");
    expect(h.calls.length).toBe(2);                                     // capture render happened
    expect(h.calls[1]).toEqual({ includeDataUrl: true, anchored: false });
    expect(Object.keys(portraits(h))).toEqual(["mira"]);                 // portrait stored
    // A later identical cue is now anchored by portrait; the cache may serve it (portrait exists, no capture needed).
    const t3 = await run(h, cache, plan("a3", [[0, "smile"]]), on);
    expect(t3[0]!.status).toBe("generated");
    expect(h.calls.length).toBe(2);
  });

  test("capture concurrency unchanged with the cache on: one capture per character, later cues anchored, then all hits", async () => {
    const cache = new SceneImageCache();
    const h = harness();
    const t1 = await run(h, cache, plan("c1", [[0, "smile"], [1, "angry"]]), on);
    expect(t1.every((j) => j.status === "generated")).toBe(true);
    expect(h.calls.length).toBe(2);
    expect(h.calls.filter((c) => c.includeDataUrl === true).length).toBe(1);   // exactly one capture
    expect(h.calls.filter((c) => c.anchored).length).toBe(1);                 // the other waited and was anchored
    expect(Object.keys(portraits(h))).toEqual(["mira"]);
    const t2 = await run(h, cache, plan("c2", [[0, "smile"], [1, "angry"]]), on);
    expect(t2.every((j) => j.status === "generated")).toBe(true);
    expect(h.calls.length).toBe(2);                                            // both hits
    expect(t2.map((j) => j.imageId).sort()).toEqual(t1.map((j) => j.imageId).sort());
  });

  test("no portrait, cold cache, anchoring on: the very first render captures (baseline unchanged)", async () => {
    const h = harness();
    await run(h, new SceneImageCache(), plan("b1", [[0, "smile"]]), on);
    expect(h.calls).toEqual([{ includeDataUrl: true, anchored: false }]);
    expect(Object.keys(portraits(h))).toEqual(["mira"]);
  });
});
