import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../config.js";
import { TurnPlanSchema, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import { sceneImageCacheKey } from "../core/scene-image-cache.js";
import { sceneSizeParameters, sizeParameters as coreSizeParameters } from "./image-size.js";
import { createAssetJobs, generateAssets, sceneImageIdentityFor } from "./images.js";
import { compileSpriteRequest, sizeParameters } from "./sprites/prompts.js";

const now = new Date().toISOString();
const key = { chatId: "chat", assistantMessageId: "message", swipeId: 0, sourceFingerprint: "12345678abcdef", revision: 0 };

const scene: SceneState = {
  sceneId: "scene",
  revision: 0,
  startParagraph: 0,
  environment: { location: "Library", timeOfDay: "night", weather: null, lighting: "lamplight", description: "A quiet library.", persistentElements: [] },
  cast: ["Mira"],
  continuity: { revision: 0, characters: {}, facts: {} },
  basePrompt: "quiet library at night",
  identityPrompt: "silver hair, green eyes, red coat",
  cameraLock: { framing: "medium wide", angle: "eye level", perspective: "fixed", lens: "50mm", subjectAnchor: "center", horizon: "upper third", safeDialogueRegion: "lower third", aspectRatio: "16:9" },
  compositionLock: "Mira centered",
  activeAssetId: null,
  priorSceneId: null
};

const cue: VisualCue = {
  cueId: "cue-0",
  paragraphIndex: 0,
  sceneId: "scene",
  sceneRevision: 0,
  kind: "flattened_scene",
  action: null,
  expression: null,
  promptDelta: "",
  poseExpressionId: "smile",
  character: "Mira",
  assetJobId: "job-0"
};

function plan(): TurnPlan {
  return TurnPlanSchema.parse({
    schemaVersion: 1,
    key,
    paragraphs: [{ index: 0, sourceIndex: 0, text: "Mira smiles." }],
    scenes: [scene],
    visualCues: [cue],
    choices: [],
    initialContinuity: { revision: 0, characters: {}, facts: {} },
    continuityDeltas: [],
    terminalContinuity: { revision: 0, characters: {}, facts: {} },
    planningStatus: "planned",
    createdAt: now
  });
}

function config(patch: Partial<VisualNovelConfig> = {}): VisualNovelConfig {
  return { ...DEFAULT_CONFIG, presentationMode: "scene", referenceAnchoring: false, ...patch };
}

/** Run one scene-mode cue and return the parameters the provider got. */
async function sceneRequest(provider: string, cfg: VisualNovelConfig): Promise<Record<string, unknown>> {
  const calls: any[] = [];
  const spindle = {
    userStorage: { getJson: async () => null, setJson: async () => {} },
    imageGen: {
      getConnection: async () => ({ provider }),
      listConnections: async () => [{ provider, is_default: true }],
      generate: async (input: any) => {
        calls.push(input);
        return { imageId: "img-1", imageUrl: "/api/v1/images/img-1" };
      }
    },
    log: { info: () => {}, warn: () => {}, error: () => {} }
  } as any;
  const p = plan();
  const jobs = await generateAssets(spindle, p, createAssetJobs(p, cfg), cfg, new AbortController().signal, () => {});
  expect(jobs[0]!.status).toBe("generated");
  expect(calls).toHaveLength(1);
  return calls[0].parameters;
}

describe("scene pictures: default landscape size", () => {
  test("ComfyUI: 912x624 (standard) and 1216x832 (upscaled)", async () => {
    const standard = await sceneRequest("comfyui", config({ spriteImageSize: "standard" }));
    expect(standard.width).toBe(912);
    expect(standard.height).toBe(624);
    const upscaled = await sceneRequest("comfyui", config({ spriteImageSize: "upscaled" }));
    expect(upscaled.width).toBe(1216);
    expect(upscaled.height).toBe(832);
    // The default is "standard".
    const byDefault = await sceneRequest("comfyui", config());
    expect([byDefault.width, byDefault.height]).toEqual([912, 624]);
  });

  test("SwarmUI follows the same setting", async () => {
    const params = await sceneRequest("swarmui", config({ spriteImageSize: "upscaled" }));
    expect([params.width, params.height]).toEqual([1216, 832]);
  });

  test("NovelAI: always resolution 1216x832 (largest free size), no width/height", async () => {
    for (const spriteImageSize of ["standard", "upscaled"] as const) {
      const params = await sceneRequest("novelai", config({ spriteImageSize }));
      expect(params.resolution).toBe("1216x832");
      expect(params.width).toBeUndefined();
      expect(params.height).toBeUndefined();
      // The NovelAI request structure is still there.
      expect(params.qualityToggle).toBe(false);
    }
  });

  test("the user's own width/height in Image parameters wins", async () => {
    const params = await sceneRequest("comfyui", config({ spriteImageSize: "upscaled", imageParameters: { width: 640, height: 960, steps: 20 } }));
    expect([params.width, params.height, params.steps]).toEqual([640, 960, 20]);
    // Only one of them set: Cue adds nothing (no mixed size).
    const onlyWidth = await sceneRequest("comfyui", config({ imageParameters: { width: 1024 } }));
    expect(onlyWidth.width).toBe(1024);
    expect(onlyWidth.height).toBeUndefined();
  });

  test("NovelAI: the user's resolution (NovelAI Image dimensions) wins", async () => {
    const params = await sceneRequest("novelai", config({ imageParameters: { resolution: "832x1216" } }));
    expect(params.resolution).toBe("832x1216");
  });

  test("other providers get no size", async () => {
    for (const provider of ["openai", "stability", "pollinations"]) {
      const params = await sceneRequest(provider, config({ spriteImageSize: "upscaled" }));
      expect(params.width).toBeUndefined();
      expect(params.height).toBeUndefined();
      expect(params.resolution).toBeUndefined();
    }
    expect(sceneSizeParameters(null, config())).toEqual({});
  });

  test("sceneSizeParameters: empty values do not count as a user size", () => {
    expect(sceneSizeParameters("comfyui", config({ imageParameters: { width: "", height: null } }))).toEqual({ width: 912, height: 624 });
    // A ComfyUI "resolution" key is not a NovelAI resolution: the size still goes in.
    expect(sceneSizeParameters("comfyui", config({ imageParameters: { resolution: "x" } }))).toEqual({ width: 912, height: 624 });
  });
});

describe("sprite mode is unchanged", () => {
  test("sprites stay portrait, plates landscape; the sprite module re-exports the same helper", () => {
    expect(sizeParameters).toBe(coreSizeParameters);
    expect(sizeParameters("comfyui", "sprite", { spriteImageSize: "standard" })).toEqual({ width: 624, height: 912 });
    expect(sizeParameters("comfyui", "plate", { spriteImageSize: "upscaled" })).toEqual({ width: 1216, height: 832 });
    expect(sizeParameters("novelai", "sprite", { spriteImageSize: "standard" })).toEqual({ resolution: "832x1216" });
    // Sprite requests still put their size over the user's image parameters.
    const request = compileSpriteRequest({
      config: config({ presentationMode: "sprites", imageParameters: { width: 640, height: 960 } }),
      provider: "comfyui",
      member: { name: "Mira", identity: "silver hair", attire: "red coat" },
      expression: "neutral",
      seed: 7
    } as any);
    expect([request.parameters.width, request.parameters.height]).toEqual([624, 912]);
  });
});

describe("scene cache identity carries the default size", () => {
  const identity = (provider: string | null, cfg: VisualNovelConfig) => sceneImageIdentityFor(cfg, scene, cue, undefined, provider);

  test("ComfyUI / NovelAI: the size is part of the request; changing the setting changes the key", () => {
    expect(identity("comfyui", config()).request.parameters).toMatchObject({ width: 912, height: 624 });
    expect(identity("novelai", config({ imageModel: "nai-diffusion-4-5-full" })).request.parameters).toMatchObject({ resolution: "1216x832" });
    expect(sceneImageCacheKey(identity("comfyui", config({ spriteImageSize: "standard" }))))
      .not.toBe(sceneImageCacheKey(identity("comfyui", config({ spriteImageSize: "upscaled" }))));
  });

  test("other providers: key bytes do not change; a user size is hashed once", () => {
    expect(identity("openai", config()).request.parameters).toEqual({});
    expect(sceneImageCacheKey(identity("openai", config({ spriteImageSize: "standard" }))))
      .toBe(sceneImageCacheKey(identity("openai", config({ spriteImageSize: "upscaled" }))));
    // With the user's own size, the setting no longer matters.
    const own = { imageParameters: { width: 640, height: 960 } };
    expect(identity("comfyui", config(own)).request.parameters).toEqual({ width: 640, height: 960 });
    expect(sceneImageCacheKey(identity("comfyui", config({ ...own, spriteImageSize: "standard" }))))
      .toBe(sceneImageCacheKey(identity("comfyui", config({ ...own, spriteImageSize: "upscaled" }))));
  });
});
