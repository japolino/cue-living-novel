import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { SceneStateSchema } from "../../shared/contracts.js";
import { seedSingleCharacter, emptySingleCharacter } from "../core/visual-state.js";
import { planTurn } from "./planner.js";
import { resolveCueCharacterVisualState, compileImagePrompt } from "./images.js";
import { saveSingleCharacterState, loadSingleCharacterState, mergePlannerCharacters, loadCharacterAppearance, characterAppearancePath } from "./storage.js";

import type { ChatMessageDTO } from "lumiverse-spindle-types";

const baseMessage: ChatMessageDTO & { role: "assistant" } = {
  id: "msg-turn-2",
  chat_id: "chat-switch",
  index_in_chat: 2,
  is_user: false,
  name: "Shark Girl",
  content: "Suddenly, a girl with sharp teeth and a dorsal fin appears from the waves.",
  send_date: 1,
  swipe_id: 0,
  swipes: ["Suddenly, a girl with sharp teeth and a dorsal fin appears from the waves."],
  swipe_dates: [1],
  extra: {},
  parent_message_id: "user-1",
  branch_id: null,
  created_at: 1,
  role: "assistant"
};

const previousCatgirlScene = SceneStateSchema.parse({
  sceneId: "scene-catgirl",
  revision: 1,
  startParagraph: 0,
  environment: {
    location: "beach",
    timeOfDay: "day",
    weather: "sunny",
    lighting: "bright",
    description: "A sunny beach",
    persistentElements: []
  },
  cast: ["Catgirl"],
  character: "Catgirl",
  attire: "maid outfit",
  ambient: null,
  continuity: { revision: 0, characters: {}, facts: {} },
  basePrompt: "beach, ocean",
  identityPrompt: "catgirl, cat ears, cat tail, black hair",
  cameraLock: {
    framing: "upper body",
    angle: "eye level",
    perspective: "straight-on",
    lens: null,
    subjectAnchor: "center",
    horizon: "upper middle third",
    safeDialogueRegion: "lower quarter",
    aspectRatio: "16:9"
  },
  compositionLock: "centered",
  activeAssetId: "asset-catgirl-1",
  priorSceneId: null
});

function mockSpindle(payload: unknown) {
  return {
    chats: { get: async () => ({ character_id: null }) },
    characters: { get: async () => null },
    personas: { getActive: async () => null },
    connections: { get: async () => null },
    generate: {
      raw: async () => ({
        content: typeof payload === "string" ? payload : JSON.stringify(payload)
      })
    },
    log: { warn: () => {}, info: () => {}, error: () => {} }
  } as unknown as SpindleAPI;
}

describe("Character Switch & Multi-Character Continuity", () => {
  test("switches active character to Shark Girl even when LLM omits scene.character and cue.character", async () => {
    const payload = {
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "none", location: "beach" },
        environment: { location: "beach", timeOfDay: "day", weather: "sunny", lighting: "bright", description: "A sunny beach", persistentElements: [] },
        basePrompt: "beach, ocean",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "smile" }],
      characters: [{ name: "Shark Girl", description: "shark girl, sharp teeth, grey hair, dorsal fin" }]
    };

    const spindle = mockSpindle(payload);
    const catgirlState = seedSingleCharacter("Catgirl", "catgirl, cat ears, cat tail, black hair");

    const result = await planTurn(spindle, {
      chatId: "chat-switch",
      message: baseMessage,
      content: baseMessage.content,
      previousScene: previousCatgirlScene,
      previousContinuity: null,
      recentMessages: [],
      config: DEFAULT_CONFIG,
      singleCharacter: catgirlState,
      characterAppearance: { Catgirl: "catgirl, cat ears, cat tail, black hair" }
    });

    expect(result.usedFallback).toBe(false);
    expect(result.plan.scenes[0]?.character).toBe("Shark Girl");
    expect(result.plan.scenes[0]?.identityPrompt).toContain("dorsal fin");
    expect(result.plan.visualCues[0]?.character).toBe("Shark Girl");
    expect(result.plan.scenes[0]?.activeAssetId).toBeNull();
  });

  test("parses dictionary-style characters map and 'appearance' field alias", async () => {
    const payload = {
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "none", location: "beach" },
        environment: { location: "beach" },
        basePrompt: "beach",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "smile" }],
      characters: { "Shark Girl": "shark girl, sharp teeth, grey hair, dorsal fin" }
    };

    const spindle = mockSpindle(payload);
    const catgirlState = seedSingleCharacter("Catgirl", "catgirl, cat ears, cat tail, black hair");

    const result = await planTurn(spindle, {
      chatId: "chat-switch",
      message: baseMessage,
      content: baseMessage.content,
      previousScene: previousCatgirlScene,
      previousContinuity: null,
      recentMessages: [],
      config: DEFAULT_CONFIG,
      singleCharacter: catgirlState,
      characterAppearance: {}
    });

    expect(result.usedFallback).toBe(false);
    expect(result.plan.scenes[0]?.character).toBe("Shark Girl");
    expect(result.plan.scenes[0]?.identityPrompt).toContain("dorsal fin");
  });

  test("mergePlannerCharacters persists newly discovered character into characterAppearance", async () => {
    const data = new Map<string, unknown>();
    const spindle = {
      userStorage: {
        getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
        setJson: async (path: string, val: unknown) => { data.set(path, val); }
      }
    } as unknown as SpindleAPI;

    await mergePlannerCharacters(spindle, [
      { name: "Shark Girl", description: "shark girl, sharp teeth, dorsal fin, blue hair" }
    ]);

    const appearance = await loadCharacterAppearance(spindle);
    expect(appearance["Shark Girl"]).toContain("dorsal fin");
    expect(appearance["Shark Girl"]).toContain("sharp teeth");
  });

  test("saves new protagonist in saveSingleCharacterState when character definitively changes", async () => {
    const data = new Map<string, unknown>();
    const spindle = {
      userStorage: {
        getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
        setJson: async (path: string, val: unknown) => { data.set(path, val); }
      }
    } as unknown as SpindleAPI;

    const catgirl = seedSingleCharacter("Catgirl", "cat ears, cat tail");
    await saveSingleCharacterState(spindle, "chat-1", catgirl);
    expect((await loadSingleCharacterState(spindle, "chat-1")).protagonist.name).toBe("Catgirl");

    const sharkGirl = seedSingleCharacter("Shark Girl", "shark teeth, dorsal fin");
    await saveSingleCharacterState(spindle, "chat-1", sharkGirl);
    expect((await loadSingleCharacterState(spindle, "chat-1")).protagonist.name).toBe("Shark Girl");
  });

  test("compiles honest Shark Girl image prompt without Catgirl tags", async () => {
    const sharkScene = SceneStateSchema.parse({
      ...previousCatgirlScene,
      character: "Shark Girl",
      cast: ["Shark Girl"],
      identityPrompt: "shark girl, sharp teeth, dorsal fin, grey hair"
    });
    const cue = {
      ...previousCatgirlScene.cameraLock,
      cueId: "cue-shark-1",
      assetJobId: "job-shark-1",
      paragraphIndex: 0,
      sceneId: sharkScene.sceneId,
      sceneRevision: 1,
      kind: "flattened_scene" as const,
      action: null,
      expression: null,
      poseExpressionId: "smile",
      character: "Shark Girl",
      attire: undefined,
      promptDelta: ""
    };

    const visualState = resolveCueCharacterVisualState(sharkScene, cue, { "Shark Girl": "shark girl, sharp teeth, dorsal fin, grey hair" });
    expect(visualState.characterName).toBe("Shark Girl");
    expect(visualState.identity).toContain("dorsal fin");
    expect(visualState.identity).not.toContain("cat ears");

    const prompt = compileImagePrompt(DEFAULT_CONFIG, sharkScene, cue, { "Shark Girl": "shark girl, sharp teeth, dorsal fin, grey hair" });
    expect(prompt).toContain("dorsal fin");
    expect(prompt).not.toContain("cat ears");
  });

  test("simulates full multi-turn cycle: Catgirl -> Shark Girl -> Shark Girl follow-up -> Catgirl return", async () => {
    const data = new Map<string, unknown>();
    const spindle = {
      chats: { get: async () => ({ character_id: null }) },
      characters: { get: async () => null },
      personas: { getActive: async () => null },
      connections: { get: async () => null },
      userStorage: {
        getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
        setJson: async (path: string, val: unknown) => { data.set(path, val); }
      },
      log: { warn: () => {}, info: () => {}, error: () => {} }
    } as unknown as SpindleAPI;

    // Turn 1: Catgirl seeded
    const catgirlState = seedSingleCharacter("Catgirl", "cat ears, cat tail, black hair");
    await saveSingleCharacterState(spindle, "chat-sim", catgirlState);

    // Turn 2: Shark Girl introduced; Gemini 3.5 Lite outputs characters with Shark Girl, but omits scene.character
    const turn2Payload = {
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "none", location: "beach" },
        environment: { location: "beach", timeOfDay: "day", weather: "sunny", lighting: "bright", description: "beach", persistentElements: [] },
        basePrompt: "beach, ocean",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "smile" }],
      characters: [{ name: "Shark Girl", description: "shark girl, sharp teeth, dorsal fin, grey hair" }]
    };
    spindle.generate = { raw: async () => ({ content: JSON.stringify(turn2Payload) }) } as any;

    const turn2Result = await planTurn(spindle, {
      chatId: "chat-sim",
      message: { ...baseMessage, id: "msg-2", name: "Shark Girl" },
      content: "Shark girl smiles warmly from the surf.",
      previousScene: previousCatgirlScene,
      previousContinuity: null,
      recentMessages: [],
      config: DEFAULT_CONFIG,
      singleCharacter: await loadSingleCharacterState(spindle, "chat-sim"),
      characterAppearance: await loadCharacterAppearance(spindle)
    });

    expect(turn2Result.plan.scenes[0]?.character).toBe("Shark Girl");
    expect(turn2Result.plan.visualCues[0]?.character).toBe("Shark Girl");
    expect(turn2Result.plan.scenes[0]?.identityPrompt).toContain("dorsal fin");

    // Controller persists turn 2
    await saveSingleCharacterState(spindle, "chat-sim", turn2Result.singleCharacter);
    await mergePlannerCharacters(spindle, turn2Result.extractedCharacters ?? []);

    // Turn 3: Follow-up message. LLM omits characters completely!
    const turn3Payload = {
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "none", location: "beach" },
        environment: { location: "beach", timeOfDay: "day", weather: "sunny", lighting: "bright", description: "beach", persistentElements: [] },
        basePrompt: "beach, ocean",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "laugh" }],
      characters: []
    };
    spindle.generate = { raw: async () => ({ content: JSON.stringify(turn3Payload) }) } as any;

    const turn3Result = await planTurn(spindle, {
      chatId: "chat-sim",
      message: { ...baseMessage, id: "msg-3", name: "Shark Girl" },
      content: "She splashes water playfully.",
      previousScene: turn2Result.plan.scenes[0]!,
      previousContinuity: turn2Result.plan.terminalContinuity,
      recentMessages: [],
      config: DEFAULT_CONFIG,
      singleCharacter: await loadSingleCharacterState(spindle, "chat-sim"),
      characterAppearance: await loadCharacterAppearance(spindle)
    });

    // Turn 3 continues as Shark Girl because previous scene was Shark Girl!
    expect(turn3Result.plan.scenes[0]?.character).toBe("Shark Girl");
    expect(turn3Result.plan.visualCues[0]?.character).toBe("Shark Girl");
    expect(turn3Result.plan.scenes[0]?.identityPrompt).toContain("dorsal fin");

    // Turn 4: Catgirl returns! LLM explicitly calls Catgirl
    const turn4Payload = {
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "none", location: "beach" },
        environment: { location: "beach", timeOfDay: "day", weather: "sunny", lighting: "bright", description: "beach", persistentElements: [] },
        character: "Catgirl",
        basePrompt: "beach, ocean",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, character: "Catgirl", expression: "pout" }],
      characters: [{ name: "Catgirl", description: "catgirl, cat ears, cat tail, black hair" }]
    };
    spindle.generate = { raw: async () => ({ content: JSON.stringify(turn4Payload) }) } as any;

    const turn4Result = await planTurn(spindle, {
      chatId: "chat-sim",
      message: { ...baseMessage, id: "msg-4", name: "Catgirl" },
      content: "Catgirl pouts from the towel.",
      previousScene: turn3Result.plan.scenes[0]!,
      previousContinuity: turn3Result.plan.terminalContinuity,
      recentMessages: [],
      config: DEFAULT_CONFIG,
      singleCharacter: await loadSingleCharacterState(spindle, "chat-sim"),
      characterAppearance: await loadCharacterAppearance(spindle)
    });

    expect(turn4Result.plan.scenes[0]?.character).toBe("Catgirl");
    expect(turn4Result.plan.visualCues[0]?.character).toBe("Catgirl");
    expect(turn4Result.plan.scenes[0]?.identityPrompt).toContain("cat ears");
  });
});
