import { describe, expect, test } from "bun:test";
import { AssetJobSchema, TurnKeySchema, TurnPlanSchema, VisualCueSchema, type ContinuityState, type TurnPlan } from "./contracts.js";
import { validateTurnPlan } from "../backend/core/turn-plan.js";

const continuity: ContinuityState = { revision: 0, characters: {}, facts: {} };

function plan(): TurnPlan {
  return {
    schemaVersion: 1,
    key: {
      chatId: "chat",
      assistantMessageId: "message",
      swipeId: null,
      sourceFingerprint: "12345678abcdef",
      revision: 0
    },
    paragraphs: [
      { index: 0, sourceIndex: 0, text: "First." },
      { index: 1, sourceIndex: 1, text: "Second." }
    ],
    scenes: [{
      sceneId: "scene",
      revision: 0,
      startParagraph: 0,
      environment: {
        location: "Library",
        timeOfDay: null,
        weather: null,
        lighting: null,
        description: "A library",
        persistentElements: []
      },
      cast: [],
      continuity,
      basePrompt: "library interior",
      cameraLock: {
        framing: "medium wide",
        angle: "eye level",
        perspective: "fixed",
        lens: null,
        subjectAnchor: "center",
        horizon: "upper third",
        safeDialogueRegion: "lower third",
        aspectRatio: "16:9"
      },
      compositionLock: "fixed composition",
      activeAssetId: null,
      priorSceneId: null
    }],
    visualCues: [{
      cueId: "cue",
      paragraphIndex: 1,
      sceneId: "scene",
      sceneRevision: 0,
      kind: "flattened_scene",
      action: null,
      expression: null,
      promptDelta: "Mira turns",
      assetJobId: "job"
    }],
    choices: [{ id: "continue", label: "Continue", submission: "Continue.", source: "authored", unlocksAfterParagraph: 1 }],
    initialContinuity: continuity,
    continuityDeltas: [],
    terminalContinuity: continuity,
    planningStatus: "planned",
    createdAt: new Date().toISOString()
  };
}

describe("shared contracts", () => {
  test("rejects unknown fields at trust boundaries", () => {
    expect(() => TurnKeySchema.parse({ ...plan().key, unexpected: true })).toThrow();
  });

  test("enforces paragraph, scene, cue, and choice ownership invariants", () => {
    expect(TurnPlanSchema.parse(plan())).toBeDefined();
    expect(() => TurnPlanSchema.parse({ ...plan(), paragraphs: [{ index: 1, sourceIndex: 0, text: "Wrong." }] })).toThrow();
    expect(() => TurnPlanSchema.parse({ ...plan(), choices: [{ ...plan().choices[0]!, unlocksAfterParagraph: 0 }] })).toThrow();
    expect(() => TurnPlanSchema.parse({ ...plan(), visualCues: [{ ...plan().visualCues[0]!, sceneId: "stale-scene" }] })).toThrow();
  });

  test("checks terminal continuity after structural validation", () => {
    const valid = plan();
    expect(validateTurnPlan(valid)).toEqual(valid);
    expect(() => validateTurnPlan({ ...plan(), terminalContinuity: { ...continuity, revision: 1 } })).toThrow("Terminal continuity");
  });

  test("enforces asset lifecycle evidence", () => {
    const base = {
      jobId: "job",
      ownerTurnKey: plan().key,
      sceneId: "scene",
      sceneRevision: 0,
      paragraphIndex: 0,
      promptFingerprint: "prompt-fingerprint",
      provider: "provider",
      priority: "background",
      queuedAt: new Date().toISOString()
    };
    expect(() => AssetJobSchema.parse({ ...base, status: "generated" })).toThrow();
    expect(AssetJobSchema.parse({
      ...base,
      status: "generated",
      startedAt: new Date().toISOString(),
      imageId: "image",
      generatedAt: new Date().toISOString()
    })).toBeDefined();
  });
});

describe("VisualCueSchema poseExpressionId (additive)", () => {
  const base = {
    cueId: "cue",
    paragraphIndex: 1,
    sceneId: "scene",
    sceneRevision: 0,
    kind: "flattened_scene",
    action: null,
    expression: null,
    promptDelta: "Mira turns",
    assetJobId: "job"
  };

  test("accepts a declared poseExpressionId", () => {
    const cue = VisualCueSchema.parse({ ...base, poseExpressionId: "smile" });
    expect(cue.poseExpressionId).toBe("smile");
  });

  test("still parses an old stored cue without poseExpressionId", () => {
    const cue = VisualCueSchema.parse({ ...base });
    // Backward compatibility: the field is optional and absent when unset.
    expect(cue.poseExpressionId).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(cue, "poseExpressionId")).toBe(false);
  });

  test("still rejects unknown fields at the trust boundary", () => {
    expect(() => VisualCueSchema.parse({ ...base, unexpected: true })).toThrow();
  });

  test("allows an empty promptDelta (no free-form visual delta)", () => {
    const cue = VisualCueSchema.parse({ ...base, promptDelta: "" });
    expect(cue.promptDelta).toBe("");
  });
});

describe("VisualCueSchema audio cues (additive)", () => {
  const base = {
    cueId: "cue",
    paragraphIndex: 1,
    sceneId: "scene",
    sceneRevision: 0,
    kind: "flattened_scene",
    action: null,
    expression: null,
    promptDelta: "Mira turns",
    assetJobId: "job",
  };

  test("accepts optional bgm and sfx fields", () => {
    const cue = VisualCueSchema.parse({ ...base, bgm: "theme_peaceful", sfx: "door_open" });
    expect(cue.bgm).toBe("theme_peaceful");
    expect(cue.sfx).toBe("door_open");
  });

  test("allows null or omitted bgm and sfx", () => {
    const cue = VisualCueSchema.parse({ ...base, bgm: null, sfx: null });
    expect(cue.bgm).toBeNull();
    expect(cue.sfx).toBeNull();

    const omitted = VisualCueSchema.parse({ ...base });
    expect(omitted.bgm).toBeUndefined();
    expect(omitted.sfx).toBeUndefined();
  });
});
describe("VisualCueSchema effect (additive)", () => {
  const base = {
    cueId: "cue",
    paragraphIndex: 1,
    sceneId: "scene",
    sceneRevision: 0,
    kind: "flattened_scene",
    action: null,
    expression: null,
    promptDelta: "Mira turns",
    assetJobId: "job",
  };

  test("accepts declared stage effects", () => {
    const effects = ["shake", "flash_white", "flash_red", "zoom_in", "fade_to_black"] as const;
    for (const effect of effects) {
      const cue = VisualCueSchema.parse({ ...base, effect });
      expect(cue.effect).toBe(effect);
    }
  });

  test("still parses cue without effect field", () => {
    const cue = VisualCueSchema.parse({ ...base });
    expect(cue.effect).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(cue, "effect")).toBe(false);
  });

  test("rejects invalid effect values", () => {
    expect(() => VisualCueSchema.parse({ ...base, effect: "barrel_roll" })).toThrow();
  });
});
