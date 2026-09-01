import { describe, expect, test } from "bun:test";
import { AssetJobSchema, TurnKeySchema, TurnPlanSchema, type ContinuityState, type TurnPlan } from "./contracts.js";
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
