import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../config.js";
import { TurnPlanSchema, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import { POSE_EXPRESSION_CATALOGUE, poseById } from "../../shared/character.js";
import { compileImagePrompt, createAssetJobs } from "./images.js";

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

describe("compileImagePrompt (deterministic single-character)", () => {
  test("embeds the identity tags exactly once and forces a solo protagonist", () => {
    const compiled = compileImagePrompt(DEFAULT_CONFIG, scene, cue("smile"));
    expect(compiled).toContain("identity: silver hair, green eyes, red coat, solo");
    expect(compiled).toContain("solo");
    // Identity tags appear exactly once.
    expect(compiled.split("silver hair").length - 1).toBe(1);
    expect(compiled.split("green eyes").length - 1).toBe(1);
    expect(compiled.split("red coat").length - 1).toBe(1);
    // Fixed camera / composition is present.
    expect(compiled).toContain("camera: medium wide, eye level, fixed, 50mm");
    expect(compiled).toContain("composition: center; upper third; lower third; Mira centered");
  });

  test("appends the exact closed-catalogue pose suffix and no free-form delta", () => {
    const compiled = compileImagePrompt(DEFAULT_CONFIG, scene, cue("smile"));
    const pose = poseById(POSE_EXPRESSION_CATALOGUE, "smile");
    expect(compiled).toContain(pose.suffix);
    // No free-form action / expression / promptDelta leaks into the compiled prompt.
    expect(compiled).not.toContain("action:");
    expect(compiled).not.toContain("expression:");
    expect(compiled).not.toContain("Mira turns");
    expect(compiled).not.toContain("lantern held high");
  });

  test("only the pose suffix varies between cues in the same scene", () => {
    const smile = compileImagePrompt(DEFAULT_CONFIG, scene, cue("smile"));
    const idle = compileImagePrompt(DEFAULT_CONFIG, scene, cue("idle"));
    // The shared identity / scene / camera block is byte-identical excepting the suffix.
    const sharedPrefix = "identity: silver hair, green eyes, red coat, solo, " + scene.basePrompt;
    const smileSuffix = poseById(POSE_EXPRESSION_CATALOGUE, "smile").suffix;
    const idleSuffix = poseById(POSE_EXPRESSION_CATALOGUE, "idle").suffix;
    expect(smile).toContain(sharedPrefix);
    expect(idle).toContain(sharedPrefix);
    expect(smile).toContain(smileSuffix);
    expect(idle).toContain(idleSuffix);
    expect(smile).not.toBe(idle);
  });

  test("falls back to the first catalogue entry for absent / unknown ids", () => {
    const first = poseById(POSE_EXPRESSION_CATALOGUE, undefined);
    expect(compileImagePrompt(DEFAULT_CONFIG, scene, cue(undefined))).toContain(first.suffix);
    expect(compileImagePrompt(DEFAULT_CONFIG, scene, cue("not-a-pose"))).toContain(first.suffix);
  });

  test("produces a lone solo block when the scene has no identity tags", () => {
    const bare = { ...scene, identityPrompt: null };
    const compiled = compileImagePrompt(DEFAULT_CONFIG, bare, cue("idle"));
    expect(compiled).toContain("solo");
    expect(compiled).not.toContain("identity:");
  });
});

describe("createAssetJobs promptFingerprint", () => {
  test("includes the pose id/suffix so different poses yield different fingerprints", () => {
    const smile = createAssetJobs(plan([cue("smile")]))[0]!;
    const idle = createAssetJobs(plan([cue("idle")]))[0]!;
    expect(smile.promptFingerprint).toBeString();
    expect(smile.promptFingerprint).not.toBe(idle.promptFingerprint);
  });

  test("is deterministic for a fixed pose (no clock / content drift)", () => {
    const first = createAssetJobs(plan([cue("wave")]))[0]!.promptFingerprint;
    const second = createAssetJobs(plan([cue("wave")]))[0]!.promptFingerprint;
    expect(first).toBe(second);
  });

  test("does not depend on free-form promptDelta", () => {
    const withEmpty = createAssetJobs(plan([cue("smile")]))[0]!.promptFingerprint;
    const withDelta = createAssetJobs(plan([{ ...cue("smile"), promptDelta: "a completely different free-form delta" }]))[0]!.promptFingerprint;
    expect(withEmpty).toBe(withDelta);
  });
});
