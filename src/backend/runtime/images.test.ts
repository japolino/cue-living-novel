import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../config.js";
import { TurnPlanSchema, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import { POSE_EXPRESSION_CATALOGUE, poseById } from "../../shared/character.js";
import { compileImagePrompt, compileNegativePrompt, createAssetJobs } from "./images.js";

const now = new Date().toISOString();
const key = {
  chatId: "chat",
  assistantMessageId: "message",
  swipeId: 0,
  sourceFingerprint: "12345678abcdef",
  revision: 0
};

const scene: SceneState = {
  sceneId: "scene",
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
  continuity: { revision: 0, characters: {}, facts: {} },
  basePrompt: "quiet library at night",
  identityPrompt: "silver hair, green eyes, red coat",
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
  compositionLock: "Mira centered",
  activeAssetId: null,
  priorSceneId: null
};

function cue(poseExpressionId: string | undefined, paragraphIndex = 0): VisualCue {
  return {
    cueId: `cue-${poseExpressionId ?? "none"}`,
    paragraphIndex,
    sceneId: "scene",
    sceneRevision: 0,
    kind: "flattened_scene",
    action: null,
    expression: null,
    promptDelta: "",
    ...(poseExpressionId ? { poseExpressionId } : {}),
    assetJobId: `job-${poseExpressionId ?? "none"}`
  };
}

function plan(cues: VisualCue[]): TurnPlan {
  return TurnPlanSchema.parse({
    schemaVersion: 1,
    key,
    paragraphs: [{ index: 0, sourceIndex: 0, text: "First." }],
    scenes: [scene],
    visualCues: cues,
    choices: [],
    initialContinuity: { revision: 0, characters: {}, facts: {} },
    continuityDeltas: [],
    terminalContinuity: { revision: 0, characters: {}, facts: {} },
    planningStatus: "planned",
    createdAt: now
  });
}

describe("compileImagePrompt (vendored Inlay compiler)", () => {
  test("renders ordered ComfyUI sections without legacy prose labels", () => {
    const compiled = compileImagePrompt(DEFAULT_CONFIG, scene, cue("smile"));
    const sections = compiled.split(",\n\n");
    expect(sections).toEqual([
      DEFAULT_CONFIG.promptPrefix,
      "1girl, solo",
      "girl, silver hair, green eyes, red coat, gentle smile, eyes relaxed",
      "Library, night, lamplight",
      "upper body, eye level, straight-on"
    ]);
    expect(compiled.match(/1girl, solo/g)?.length).toBe(1);
    for (const forbidden of ["identity:", "camera:", "composition:", ";", "50mm", "Mira"]) {
      expect(compiled).not.toContain(forbidden);
    }
  });


  test("retains a 'short cut' hair tag under upper body framing (does not drop as figure)", () => {
    const hina = {
      ...scene,
      identityPrompt: "Golden blonde short cut, Brilliant red irises with stark white pupils, round face, Black high school uniform, red sailor ribbon"
    };
    const compiled = compileImagePrompt(DEFAULT_CONFIG, hina, cue("smile"));
    expect(compiled).toContain("Golden blonde short cut");
    expect(compiled).toContain("Brilliant red irises with stark white pupils");
    expect(compiled).toContain("Black high school uniform");
    expect(compiled).toContain("red sailor ribbon");
    expect(compiled).not.toContain("identity:");
  });

  test("projects away lower-body attire under upper body framing", () => {
    const hina = {
      ...scene,
      identityPrompt: "petite, golden blonde short hair, brilliant red eyes, black sailor uniform, red ribbon, black pleated skirt, white pantyhose"
    };
    const compiled = compileImagePrompt(DEFAULT_CONFIG, hina, cue("smile"));
    expect(compiled).toContain("golden blonde short hair");
    expect(compiled).toContain("black sailor uniform");
    expect(compiled).not.toContain("black pleated skirt");
    expect(compiled).not.toContain("white pantyhose");
  });

  test("uses only the exact closed-catalogue pose suffix, not free-form cue text", () => {
    const altered = { ...cue("smile"), action: "Mira turns", expression: "fear", promptDelta: "lantern held high" };
    const compiled = compileImagePrompt(DEFAULT_CONFIG, scene, altered);
    expect(compiled).toContain(poseById(POSE_EXPRESSION_CATALOGUE, "smile").suffix);
    expect(compiled).not.toContain("Mira turns");
    expect(compiled).not.toContain("lantern held high");
  });

  test("only the closed-catalogue pose block varies between cues", () => {
    const smile = compileImagePrompt(DEFAULT_CONFIG, scene, cue("smile"));
    const idle = compileImagePrompt(DEFAULT_CONFIG, scene, cue("idle"));
    expect(smile.replace(poseById(POSE_EXPRESSION_CATALOGUE, "smile").suffix, "POSE"))
      .toBe(idle.replace(poseById(POSE_EXPRESSION_CATALOGUE, "idle").suffix, "POSE"));
  });

  test("falls back to the first catalogue entry for absent or unknown ids", () => {
    const first = poseById(POSE_EXPRESSION_CATALOGUE, undefined);
    expect(compileImagePrompt(DEFAULT_CONFIG, scene, cue(undefined))).toContain(first.suffix);
    expect(compileImagePrompt(DEFAULT_CONFIG, scene, cue("not-a-pose"))).toContain(first.suffix);
  });
  test("compiles the negative prompt through the same Inlay selection", () => {
    const config = { ...DEFAULT_CONFIG, negativePrompt: "low quality; duplicate subject" };
    const negative = compileNegativePrompt(config, scene, cue("idle"));
    expect(negative).toContain("low quality");
    expect(negative).toContain("duplicate subject");
    expect(negative).not.toContain(";");
  });

});

describe("createAssetJobs promptFingerprint", () => {
  test("includes the pose id/suffix so different poses yield different fingerprints", () => {
    const smile = createAssetJobs(plan([cue("smile")]), DEFAULT_CONFIG)[0]!;
    const idle = createAssetJobs(plan([cue("idle")]), DEFAULT_CONFIG)[0]!;
    expect(smile.promptFingerprint).toBeString();
    expect(smile.promptFingerprint).not.toBe(idle.promptFingerprint);
  });

  test("is deterministic for a fixed pose (no clock / content drift)", () => {
    const first = createAssetJobs(plan([cue("wave")]), DEFAULT_CONFIG)[0]!.promptFingerprint;
    const second = createAssetJobs(plan([cue("wave")]), DEFAULT_CONFIG)[0]!.promptFingerprint;
    expect(first).toBe(second);
  });

  test("does not depend on free-form promptDelta", () => {
    const withEmpty = createAssetJobs(plan([cue("smile")]), DEFAULT_CONFIG)[0]!.promptFingerprint;
    const withDelta = createAssetJobs(plan([{ ...cue("smile"), promptDelta: "a completely different free-form delta" }]), DEFAULT_CONFIG)[0]!.promptFingerprint;
    expect(withEmpty).toBe(withDelta);
  });
});
