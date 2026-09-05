import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../config.js";
import {
  ActionPropSchema,
  ActionPropFieldSchema,
  ALLOWED_ACTIONS,
  ALLOWED_HANDS,
  ALLOWED_RELATIONSHIPS,
  compileActionProp,
  normalizeActionProp,
  parseActionProp,
  validateVisibleObject,
  VisibleObjectSchema,
  type ActionProp
} from "./action-prop.js";
import {
  VisualCueSchema,
  type SceneState,
  type VisualCue
} from "./contracts.js";
import { POSE_EXPRESSION_CATALOGUE, poseById } from "./character.js";
import {
  compileImagePrompt,
  createAssetJobs,
  portraitIdentityFingerprint
} from "../backend/runtime/images.js";

const scene: SceneState = {
  sceneId: "scene-1",
  revision: 0,
  startParagraph: 0,
  environment: {
    location: "Grand Hall",
    timeOfDay: "night",
    weather: null,
    lighting: "chandelier",
    description: "A grand ballroom.",
    persistentElements: []
  },
  cast: ["Mira"],
  continuity: { revision: 0, characters: {}, facts: {} },
  basePrompt: "grand hall at night",
  identityPrompt: "silver hair, green eyes, crimson gown",
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
  priorSceneId: null
};

function createCue(action: unknown = null, poseExpressionId = "smile"): VisualCue {
  return VisualCueSchema.parse({
    cueId: "cue-action-test",
    paragraphIndex: 0,
    sceneId: "scene-1",
    sceneRevision: 0,
    kind: "flattened_scene",
    action: action as any,
    expression: null,
    poseExpressionId,
    character: "Mira",
    attire: null,
    resolvedIdentity: "silver hair, green eyes, crimson gown",
    resolvedAttire: null,
    promptDelta: "",
    assetJobId: "job-1"
  });
}

describe("Action / Prop Bounded Schema & Parser", () => {
  describe("1. Parser & Normalization", () => {
    test("parses canonical string 'holding brass key in right raised hand'", () => {
      const parsed = parseActionProp("holding brass key in right raised hand");
      expect(parsed).toEqual({
        action: "holding",
        object: "brass key",
        relationship: "in right raised hand",
        hand: "right"
      });
    });

    test("normalizes articles and pronouns in string input", () => {
      const parsed = parseActionProp("holding a brass key in her right raised hand");
      expect(parsed).toEqual({
        action: "holding",
        object: "brass key",
        relationship: "in right raised hand",
        hand: "right"
      });

      const parsedThe = parseActionProp("holding the brass key in right hand");
      expect(parsedThe).toEqual({
        action: "holding",
        object: "brass key",
        relationship: "in right hand",
        hand: "right"
      });
    });

    test("requires relationship/hand and rejects action missing relationship/hand", () => {
      expect(parseActionProp("holding brass key")).toBeNull();
      expect(parseActionProp("raises a lantern")).toBeNull();
    });

    test("normalizes action verb aliases (holds, raises, carries, wielding)", () => {
      expect(parseActionProp("holds lantern in left hand")?.action).toBe("holding");
      expect(parseActionProp("raises wooden staff held aloft")?.action).toBe("raising");
      expect(parseActionProp("carries leather grimoire at side")?.action).toBe("carrying");
      expect(parseActionProp("wields silver dagger with both hands")?.action).toBe("wielding");
    });

    test("matches multiword action verbs longest-first (reaching for vs reaching)", () => {
      const parsed = parseActionProp("reaching for brass key in right hand");
      expect(parsed).toEqual({
        action: "reaching",
        object: "brass key",
        relationship: "in right hand",
        hand: "right"
      });

      const parsedResting = parseActionProp("resting hand on wooden staff at side");
      expect(parsedResting).toEqual({
        action: "resting_hand_on",
        object: "wooden staff",
        relationship: "at side",
        hand: null
      });
    });

    test("handles raised flag as boolean or string (raised: true, false, 'true', 'false')", () => {
      const raisedFalse = parseActionProp({ action: "holding", prop: "brass key", hand: "right", raised: false });
      expect(raisedFalse?.relationship).toBe("in right hand");

      const raisedStrFalse = parseActionProp({ action: "holding", prop: "brass key", hand: "right", raised: "false" });
      expect(raisedStrFalse?.relationship).toBe("in right hand");

      const raisedTrue = parseActionProp({ action: "holding", prop: "brass key", hand: "right", raised: true });
      expect(raisedTrue?.relationship).toBe("in right raised hand");

      const raisedStrTrue = parseActionProp({ action: "holding", prop: "brass key", hand: "right", raised: "true" });
      expect(raisedStrTrue?.relationship).toBe("in right raised hand");
    });

    test("parses structured object with explicit relationship", () => {
      const structured = {
        action: "holding",
        object: "brass key",
        relationship: "in right raised hand"
      };
      const parsed = parseActionProp(structured);
      expect(parsed).toEqual({
        action: "holding",
        object: "brass key",
        relationship: "in right raised hand",
        hand: "right"
      });
    });

    test("normalizeActionProp produces identical output to parseActionProp", () => {
      const str = "holding brass key in right raised hand";
      expect(normalizeActionProp(str)).toEqual(parseActionProp(str));
    });
  });

  describe("2. Bounds & Visible Object Noun Grammar", () => {
    test("accepts allowed prop nouns with zero, one, or two modifiers", () => {
      expect(validateVisibleObject("key").success).toBe(true);
      expect(validateVisibleObject("brass key").success).toBe(true);
      expect(validateVisibleObject("ornate brass key").success).toBe(true);
      expect(validateVisibleObject("wooden staff").success).toBe(true);
      expect(validateVisibleObject("leather grimoire").success).toBe(true);
      expect(validateVisibleObject("silver dagger").success).toBe(true);
    });

    test("rejects camera directives in visible object (full body, close-up, camera angle)", () => {
      expect(validateVisibleObject("full body").success).toBe(false);
      expect(validateVisibleObject("upper body").success).toBe(false);
      expect(validateVisibleObject("camera view").success).toBe(false);
      expect(validateVisibleObject("portrait lens").success).toBe(false);
    });

    test("rejects anatomy / body directives in visible object (blonde hair, red eyes)", () => {
      expect(validateVisibleObject("blonde hair").success).toBe(false);
      expect(validateVisibleObject("red eyes").success).toBe(false);
      expect(validateVisibleObject("bare shoulders").success).toBe(false);
      expect(validateVisibleObject("clenched fist").success).toBe(false);
    });

    test("rejects subject / person directives in visible object (another girl, 1boy)", () => {
      expect(validateVisibleObject("another girl").success).toBe(false);
      expect(validateVisibleObject("1boy").success).toBe(false);
      expect(validateVisibleObject("companion").success).toBe(false);
      expect(validateVisibleObject("crowd").success).toBe(false);
    });

    test("rejects clothing / wardrobe directives in visible object (blue dress, black boots)", () => {
      expect(validateVisibleObject("blue dress").success).toBe(false);
      expect(validateVisibleObject("black boots").success).toBe(false);
      expect(validateVisibleObject("leather jacket").success).toBe(false);
      expect(validateVisibleObject("white uniform").success).toBe(false);
    });

    test("rejects objects with unknown modifiers or exceeding 2 modifiers", () => {
      expect(validateVisibleObject("mystical cosmic alien key").success).toBe(false);
      expect(validateVisibleObject("random unknown key").success).toBe(false);
    });

    test("enforces character length bound (1 to 64 chars)", () => {
      expect(validateVisibleObject("").success).toBe(false);
      expect(validateVisibleObject("a".repeat(65)).success).toBe(false);
    });
  });

  describe("3. Schema safeParse & Strict Invariants", () => {
    test("rejects invalid relationship in ActionPropSchema.safeParse", () => {
      const res = ActionPropSchema.safeParse({
        action: "holding",
        object: "brass key",
        relationship: "floating around the room" as any,
        hand: "right"
      });
      expect(res.success).toBe(false);
    });

    test("rejects conflicting hand vs relationship in ActionPropSchema.safeParse", () => {
      const res = ActionPropSchema.safeParse({
        action: "holding",
        object: "brass key",
        relationship: "in right raised hand",
        hand: "left"
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain("conflicts with relationship");
      }
    });

    test("accepts matching hand vs relationship in ActionPropSchema.safeParse", () => {
      const res = ActionPropSchema.safeParse({
        action: "holding",
        object: "brass key",
        relationship: "in right raised hand",
        hand: "right"
      });
      expect(res.success).toBe(true);
    });

    test("accepts null hand when relationship is neutral or specified", () => {
      const res = ActionPropSchema.safeParse({
        action: "holding",
        object: "brass key",
        relationship: "held aloft",
        hand: null
      });
      expect(res.success).toBe(true);
    });

    test("ActionPropFieldSchema normalizes legacy invalid strings to null backward-compatibly", () => {
      expect(ActionPropFieldSchema.parse("Mira turns")).toBeNull();
      expect(ActionPropFieldSchema.parse("raises a lantern")).toBeNull();
      expect(ActionPropFieldSchema.parse("speaks")).toBeNull();
      expect(ActionPropFieldSchema.parse("")).toBeNull();
      expect(ActionPropFieldSchema.parse(null)).toBeNull();
      expect(ActionPropFieldSchema.parse(undefined)).toBeNull();

      // Valid string normalizes to canonical ActionProp
      const valid = ActionPropFieldSchema.parse("holding brass key in right raised hand");
      expect(valid).toEqual({
        action: "holding",
        object: "brass key",
        relationship: "in right raised hand",
        hand: "right"
      });
    });
  });

  describe("4. Invalid Inputs & Prompt Injection Defense", () => {
    test("rejects arbitrary narrative text passthrough (e.g. 'Mira turns')", () => {
      expect(parseActionProp("Mira turns")).toBeNull();
      expect(compileActionProp("Mira turns")).toBeNull();
    });

    test("rejects prompt injection attempts (masterpiece, lora, weights, score)", () => {
      expect(parseActionProp("holding brass key, masterpiece, best quality")).toBeNull();
      expect(parseActionProp("holding brass key <lora:detail:1.2>")).toBeNull();
      expect(parseActionProp("holding (brass key:1.5)")).toBeNull();
      expect(parseActionProp("holding brass key score_9_up")).toBeNull();
      expect(parseActionProp("holding brass key; drop table cues;")).toBeNull();
      expect(parseActionProp("holding brass key <script>alert(1)</script>")).toBeNull();
      expect(parseActionProp("holding brass key, ignore previous instructions")).toBeNull();
    });

    test("rejects delimiter characters (commas, semicolons, brackets, braces)", () => {
      expect(parseActionProp("holding brass key; in right hand")).toBeNull();
      expect(parseActionProp("holding {brass key} in right hand")).toBeNull();
      expect(parseActionProp("holding [brass key] in right hand")).toBeNull();
    });
  });

  describe("5. Deterministic Compilation & Formatting", () => {
    test("renders action with underscores as natural words (resting_hand_on -> resting hand on)", () => {
      const compiled = compileActionProp({
        action: "resting_hand_on",
        object: "wooden staff",
        relationship: "at side"
      });
      expect(compiled).toBe("resting hand on wooden staff at side");
    });

    test("compiles 'holding brass key in right raised hand' deterministically into final prompt", () => {
      const cueWithAction = createCue("holding brass key in right raised hand", "smile");
      const compiled = compileImagePrompt(DEFAULT_CONFIG, scene, cueWithAction);

      const smileSuffix = poseById(POSE_EXPRESSION_CATALOGUE, "smile").suffix;
      expect(compiled).toContain(smileSuffix);
      expect(compiled).toContain("holding brass key in right raised hand");

      const sections = compiled.split(",\n\n");
      expect(sections).toHaveLength(5);
      expect(sections[0]).toBe(DEFAULT_CONFIG.promptPrefix);
      expect(sections[1]).toBe("1girl, solo");
      expect(sections[2]).toContain(smileSuffix);
      expect(sections[2]).toContain("holding brass key in right raised hand");
      expect(sections[3]).toContain("Grand Hall");
      expect(sections[4]).toBe("upper body, eye level, straight-on");
    });

    test("compiles identically in both fixed and dynamic perspective modes", () => {
      const cueWithAction = createCue("holding brass key in right raised hand", "smile");

      const dynamicConfig = { ...DEFAULT_CONFIG, perspectiveMode: "dynamic" as const };
      const fixedConfig = { ...DEFAULT_CONFIG, perspectiveMode: "fixed" as const };

      const compiledDynamic = compileImagePrompt(dynamicConfig, scene, cueWithAction);
      const compiledFixed = compileImagePrompt(fixedConfig, scene, cueWithAction);

      expect(compiledDynamic).toContain("holding brass key in right raised hand");
      expect(compiledFixed).toContain("holding brass key in right raised hand");
    });
  });

  describe("6. Pose Catalogue Integrity & Fingerprint Invariants", () => {
    test("does not overwrite or replace the pose catalogue suffix", () => {
      const smileSuffix = poseById(POSE_EXPRESSION_CATALOGUE, "smile").suffix;
      const thinkSuffix = poseById(POSE_EXPRESSION_CATALOGUE, "think").suffix;

      const cueSmile = createCue("holding brass key in right raised hand", "smile");
      const cueThink = createCue("holding brass key in right raised hand", "think");

      const compiledSmile = compileImagePrompt(DEFAULT_CONFIG, scene, cueSmile);
      const compiledThink = compileImagePrompt(DEFAULT_CONFIG, scene, cueThink);

      expect(compiledSmile).toContain(smileSuffix);
      expect(compiledSmile).not.toContain(thinkSuffix);
      expect(compiledThink).toContain(thinkSuffix);
      expect(compiledThink).not.toContain(smileSuffix);

      expect(compiledSmile).toContain("holding brass key in right raised hand");
      expect(compiledThink).toContain("holding brass key in right raised hand");
    });

    test("promptFingerprint differentiates cues with different props, but portraitIdentityFingerprint stays invariant", () => {
      const cueNoAction = createCue(null, "smile");
      const cueWithAction = createCue("holding brass key in right raised hand", "smile");

      const planA = {
        schemaVersion: 1 as const,
        key: { chatId: "chat", assistantMessageId: "msg", swipeId: 0, sourceFingerprint: "12345678abcdef", revision: 0 },
        paragraphs: [{ index: 0, sourceIndex: 0, text: "Para." }],
        scenes: [scene],
        visualCues: [cueNoAction],
        choices: [],
        initialContinuity: { revision: 0, characters: {}, facts: {} },
        continuityDeltas: [],
        terminalContinuity: { revision: 0, characters: {}, facts: {} },
        planningStatus: "planned" as const,
        createdAt: new Date().toISOString()
      };

      const planB = {
        ...planA,
        visualCues: [cueWithAction]
      };

      const jobsA = createAssetJobs(planA as any, DEFAULT_CONFIG);
      const jobsB = createAssetJobs(planB as any, DEFAULT_CONFIG);

      // promptFingerprint MUST differ so the new prop triggers regeneration
      expect(jobsA[0]!.promptFingerprint).not.toBe(jobsB[0]!.promptFingerprint);
      expect(jobsA[0]!.promptFingerprint).toHaveLength(16);
      expect(jobsB[0]!.promptFingerprint).toHaveLength(16);

      // portraitIdentityFingerprint MUST NOT include props (invariant)
      const fpA = portraitIdentityFingerprint("Mira", scene.identityPrompt!, DEFAULT_CONFIG, "test-provider");
      const fpB = portraitIdentityFingerprint("Mira", scene.identityPrompt!, DEFAULT_CONFIG, "test-provider");
      expect(fpA).toBe(fpB);
    });
  });

  describe("7. Planner Integration & Identity Isolation", () => {
    test("planner validates and normalizes action into cue without leaking to identity or wardrobe", async () => {
      const { planTurn } = await import("../backend/runtime/planner.js");
      const { emptySingleCharacter } = await import("../backend/core/visual-state.js");

      const mockSpindle = {
        generate: {
          raw: async () => ({
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: true, reason: "initial", location: "Grand Hall" },
                environment: {
                  location: "Grand Hall",
                  description: "A ballroom",
                  persistentElements: []
                },
                cast: ["Mira"]
              }],
              cues: [
                {
                  paragraphIndex: 0,
                  character: "Mira",
                  expression: "smile",
                  action: "holding brass key in right raised hand"
                },
                {
                  paragraphIndex: 1,
                  character: "Mira",
                  expression: "think",
                  action: "Mira turns"
                }
              ]
            })
          })
        },
        log: { warn() {} }
      } as any;

      const message = {
        id: "msg-1",
        chat_id: "chat-1",
        index_in_chat: 1,
        is_user: false,
        name: "Mira",
        content: "First line holding the key.\n\nSecond line thinking.",
        send_date: 1,
        swipe_id: 0,
        swipes: ["First line holding the key.\n\nSecond line thinking."],
        swipe_dates: [1],
        extra: {},
        parent_message_id: null,
        branch_id: null,
        created_at: 1,
        role: "assistant"
      } as any;

      const result = await planTurn(mockSpindle, {
        chatId: "chat-1",
        message,
        content: message.content,
        previousScene: null,
        previousContinuity: null,
        recentMessages: [],
        config: DEFAULT_CONFIG,
        singleCharacter: emptySingleCharacter(),
        characterAppearance: {}
      });

      expect(result.usedFallback).toBe(false);
      expect(result.plan.visualCues).toHaveLength(2);

      // First cue has normalized action
      const cue0 = result.plan.visualCues[0]!;
      expect(cue0.action).toEqual({
        action: "holding",
        object: "brass key",
        relationship: "in right raised hand",
        hand: "right"
      });

      // Second cue has invalid action dropped to null
      const cue1 = result.plan.visualCues[1]!;
      expect(cue1.action).toBeNull();

      // PROPS MUST NEVER LEAK INTO IDENTITY OR WARDROBE
      expect(result.plan.scenes[0]!.identityPrompt ?? "").not.toContain("brass key");
      expect(result.plan.scenes[0]!.identityPrompt ?? "").not.toContain("holding");
      expect(cue0.resolvedIdentity).not.toContain("brass key");
      expect(cue0.resolvedIdentity).not.toContain("holding");
      expect(cue0.resolvedAttire ?? "").not.toContain("brass key");
      expect(result.plan.terminalVisualState?.identity).not.toContain("brass key");
      const miraWardrobe = Object.values(result.plan.terminalContinuity.characters["Mira"]?.wardrobe ?? {});
      for (const item of miraWardrobe) {
        expect(item).not.toContain("brass key");
      }

      // Compiling first cue includes action alongside catalogue pose
      const prompt0 = compileImagePrompt(DEFAULT_CONFIG, result.plan.scenes[0]!, cue0);
      expect(prompt0).toContain("holding brass key in right raised hand");
      expect(prompt0).toContain(poseById(POSE_EXPRESSION_CATALOGUE, "smile").suffix);

      // Compiling second cue does NOT include "Mira turns"
      const prompt1 = compileImagePrompt(DEFAULT_CONFIG, result.plan.scenes[0]!, cue1);
      expect(prompt1).not.toContain("Mira turns");
      expect(prompt1).toContain(poseById(POSE_EXPRESSION_CATALOGUE, "think").suffix);
    });

    test("cue targeted at user persona does not inherit companion action", async () => {
      const { planTurn } = await import("../backend/runtime/planner.js");
      const { emptySingleCharacter } = await import("../backend/core/visual-state.js");

      const mockSpindle = {
        generate: {
          raw: async () => ({
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: true, reason: "initial", location: "Grand Hall" },
                environment: {
                  location: "Grand Hall",
                  description: "A ballroom",
                  persistentElements: []
                },
                cast: ["Mira"]
              }],
              cues: [
                {
                  paragraphIndex: 0,
                  character: "User",
                  expression: "smile",
                  action: "holding brass key in right raised hand"
                }
              ]
            })
          })
        },
        log: { warn() {} }
      } as any;

      const message = {
        id: "msg-2",
        chat_id: "chat-1",
        index_in_chat: 1,
        is_user: false,
        name: "Mira",
        content: "User paragraph here.",
        send_date: 1,
        swipe_id: 0,
        swipes: ["User paragraph here."],
        swipe_dates: [1],
        extra: {},
        parent_message_id: null,
        branch_id: null,
        created_at: 1,
        role: "assistant"
      } as any;

      const result = await planTurn(mockSpindle, {
        chatId: "chat-1",
        message,
        content: message.content,
        previousScene: null,
        previousContinuity: null,
        recentMessages: [],
        config: DEFAULT_CONFIG,
        singleCharacter: emptySingleCharacter(),
        characterAppearance: {}
      });

      const cue0 = result.plan.visualCues[0]!;
      expect(cue0.action).toBeNull();
    });
  });
});
