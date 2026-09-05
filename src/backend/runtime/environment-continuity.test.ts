import assert from "node:assert/strict";
import { test, describe } from "bun:test";
import type { ChatMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { emptySingleCharacter } from "../core/visual-state.js";
import {
  environmentsEqual,
  mergeEnvironment,
  mergePersistentElements,
  synthesizeBasePrompt,
  isGenericDescription,
  isGenericLocation,
  isExplicitClear,
  normalizeTimeOfDay,
  normalizeWeather,
  normalizeEnvironmentChanges,
  planTurn,
  type PlanTurnInput
} from "./planner.js";
import { compileImagePrompt } from "./images.js";
import type { SceneEnvironment, SceneState } from "../../shared/contracts.js";

const message: ChatMessageDTO & { role: "assistant" } = {
  id: "msg_env_test",
  chat_id: "chat_env",
  index_in_chat: 1,
  is_user: false,
  name: "Mira",
  content: "Hello",
  send_date: 1,
  swipe_id: 0,
  swipes: ["Hello"],
  swipe_dates: [1],
  extra: {},
  parent_message_id: null,
  branch_id: null,
  created_at: 1,
  role: "assistant"
};

function makeSpindle(contentResponse: any): SpindleAPI {
  return {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: typeof contentResponse === "string" ? contentResponse : JSON.stringify(contentResponse)
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;
}

describe("Environment continuity: unit tests", () => {
  const richBaseEnv: SceneEnvironment = {
    location: "Grand Mahogany Library",
    timeOfDay: "afternoon",
    weather: "clear",
    lighting: "warm golden sunlight streaming through tall arched windows",
    description: "A spacious grand mahogany library with towering bookshelves reaching the ceiling, stained glass accents, and crimson velvet armchairs.",
    persistentElements: ["towering bookshelves", "stained glass windows", "closed oak door"]
  };

  test("mergeEnvironment: keeps detailed description and lighting when proposal omits them", () => {
    const proposal: SceneEnvironment = {
      location: "the current setting",
      timeOfDay: null,
      weather: null,
      lighting: null,
      description: "A coherent visual-novel environment in a visual novel scene.",
      persistentElements: []
    };

    const merged = mergeEnvironment(richBaseEnv, proposal);
    assert.equal(merged.location, richBaseEnv.location);
    assert.equal(merged.description, richBaseEnv.description);
    assert.equal(merged.lighting, richBaseEnv.lighting);
    assert.equal(merged.timeOfDay, richBaseEnv.timeOfDay);
    assert.equal(merged.weather, richBaseEnv.weather);
    assert.deepEqual(merged.persistentElements, richBaseEnv.persistentElements);
    assert.ok(environmentsEqual(richBaseEnv, merged));
  });

  test("mergeEnvironment: keeps detailed description when proposal merely paraphrases", () => {
    const paraphraseLoc: SceneEnvironment = {
      ...richBaseEnv,
      description: "The mahogany library."
    };
    assert.equal(mergeEnvironment(richBaseEnv, paraphraseLoc).description, richBaseEnv.description);

    const paraphraseSubset: SceneEnvironment = {
      ...richBaseEnv,
      description: "A grand mahogany library with towering bookshelves."
    };
    assert.equal(mergeEnvironment(richBaseEnv, paraphraseSubset).description, richBaseEnv.description);
  });

  test("mergeEnvironment: longer generic rewrite must not erase detailed established features (TV detail)", () => {
    const livingRoomEnv: SceneEnvironment = {
      location: "Living room",
      timeOfDay: "night",
      weather: null,
      lighting: "dim warm indoor lighting with television screen glow",
      description: "A cozy apartment living room at night with a worn fabric couch, television glowing, tense intimate atmosphere",
      persistentElements: ["worn fabric couch", "television"]
    };

    const longerGenericRewrite: SceneEnvironment = {
      ...livingRoomEnv,
      description: "A beautifully rendered visual novel background depicting the living room in cozy atmospheric anime style with soft lighting."
    };

    const merged = mergeEnvironment(livingRoomEnv, longerGenericRewrite);
    assert.equal(merged.description, livingRoomEnv.description);
  });

  test("mergeEnvironment: accepts explicit description progression and state change markers", () => {
    const proposalWithChange: SceneEnvironment = {
      ...richBaseEnv,
      description: "The grand library in disarray, with ancient books scattered across the floor and stained glass shattered."
    };
    assert.equal(mergeEnvironment(richBaseEnv, proposalWithChange).description, proposalWithChange.description);
  });

  test("mergeLighting: short explicit lights off accepted", () => {
    const mergedOff = mergeEnvironment(richBaseEnv, { ...richBaseEnv, lighting: "lights off" });
    assert.equal(mergedOff.lighting, "lights off");

    const mergedDark = mergeEnvironment(richBaseEnv, { ...richBaseEnv, lighting: "dark" });
    assert.equal(mergedDark.lighting, "dark");
  });

  test("mergeLighting: normal, ambient, clear lighting are not accidentally null", () => {
    const mergedNormal = mergeEnvironment(richBaseEnv, { ...richBaseEnv, lighting: "normal" });
    assert.equal(mergedNormal.lighting, "normal");

    const mergedAmbient = mergeEnvironment(richBaseEnv, { ...richBaseEnv, lighting: "ambient" });
    assert.equal(mergedAmbient.lighting, "ambient");

    const mergedClear = mergeEnvironment(richBaseEnv, { ...richBaseEnv, lighting: "clear" });
    assert.equal(mergedClear.lighting, "clear");
  });

  test("mergeLighting: explicit clear 'none' sets lighting to null", () => {
    const mergedNone = mergeEnvironment(richBaseEnv, { ...richBaseEnv, lighting: "none" });
    assert.equal(mergedNone.lighting, null);
  });

  test("mergePersistentElements: generic bookshelf must not erase detailed bookshelf", () => {
    const base = ["tall mahogany bookshelf packed with grimoires", "wooden desk", "closed window"];
    const merged = mergePersistentElements(base, ["bookshelf"]);
    assert.deepEqual(merged, base);
  });

  test("mergePersistentElements: laptop on desk does not erase desk", () => {
    const base = ["wooden desk"];
    const merged = mergePersistentElements(base, ["laptop on desk"]);
    assert.deepEqual(merged, ["wooden desk", "laptop on desk"]);
  });

  test("mergePersistentElements: single object removal vs clear all", () => {
    const base = ["tall mahogany bookshelf packed with grimoires", "wooden desk", "closed window"];

    // 1. Single object removal via '-' prefix
    const removedOne = mergePersistentElements(base, ["-closed window"]);
    assert.deepEqual(removedOne, ["tall mahogany bookshelf packed with grimoires", "wooden desk"]);

    // 2. Single object removal via removedElements parameter
    const removedParam = mergePersistentElements(base, [], ["closed window"]);
    assert.deepEqual(removedParam, ["tall mahogany bookshelf packed with grimoires", "wooden desk"]);

    // 3. Clear all via 'none'
    const clearedAll = mergePersistentElements(base, ["none"]);
    assert.deepEqual(clearedAll, []);
  });

  test("normalizeWeather and mergeEnvironment: weather 'none' sentinel clears weather to null", () => {
    const envWithRain: SceneEnvironment = {
      ...richBaseEnv,
      weather: "heavy rain"
    };

    const proposalWithNone: SceneEnvironment = {
      ...richBaseEnv,
      weather: "none"
    };

    const merged = mergeEnvironment(envWithRain, proposalWithNone);
    assert.equal(merged.weather, null);
  });

  test("normalizeTimeOfDay: normalizes calendar timestamp to visual period without three comma tags", () => {
    assert.equal(normalizeTimeOfDay("Saturday, October 18, 08:40 PM (Spring)"), "evening");
    assert.equal(normalizeTimeOfDay("Monday, 02:30 PM"), "afternoon");
    assert.equal(normalizeTimeOfDay("night"), "night");
    assert.equal(normalizeTimeOfDay("sunset"), "sunset");
  });
});

describe("Scene background prompt synthesis (basePrompt)", () => {
  test("synthesizes Danbooru-style tags from environment fields", () => {
    const env: SceneEnvironment = {
      location: "Bedroom",
      timeOfDay: "night",
      weather: "rain",
      lighting: "lamp light",
      description: "A cozy bedroom with a closed window.",
      persistentElements: ["closed window", "wooden desk"]
    };

    const prompt = synthesizeBasePrompt(env);
    assert.equal(prompt, "Bedroom, night, rain, lamp light, closed window, wooden desk");
  });

  test("preserves explicit specific proposed basePrompt", () => {
    const env: SceneEnvironment = {
      location: "Bedroom",
      timeOfDay: "night",
      weather: "clear",
      lighting: "lamp light",
      description: "bedroom with an open window",
      persistentElements: ["open window"]
    };

    const prompt = synthesizeBasePrompt(env, "bedroom, open window, lamp light");
    assert.equal(prompt, "bedroom, open window, lamp light");
  });

  test("replaces generic proposed basePrompt with synthesized tags", () => {
    const env: SceneEnvironment = {
      location: "Bedroom",
      timeOfDay: "night",
      weather: "clear",
      lighting: "lamp light",
      description: "bedroom with an open window",
      persistentElements: ["open window"]
    };

    const prompt = synthesizeBasePrompt(env, "a visual novel scene");
    assert.equal(prompt, "Bedroom, night, clear, lamp light, open window");
  });
});

describe("End-to-End planTurn and Final Compiled Prompt Verification", () => {
  test("compiled prompt: longer generic rewrite does not erase TV detail", async () => {
    const initialEnv: SceneEnvironment = {
      location: "Living room",
      timeOfDay: "night",
      weather: "clear",
      lighting: "dim warm indoor lighting with television screen glow",
      description: "A cozy apartment living room at night with a worn fabric couch, television glowing, tense intimate atmosphere",
      persistentElements: ["worn fabric couch", "television"]
    };

    const turn1Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: true, reason: "initial", location: "Living room" },
        environment: initialEnv,
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "living room, night, television glowing, couch",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "neutral" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result1 = await planTurn(turn1Spindle, {
      chatId: "tv_chat",
      message: { ...message, content: "Mira watches the screen." },
      content: "Mira watches the screen.",
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    const scene1 = result1.plan.scenes[0]!;
    const cue1 = result1.plan.visualCues[0]!;
    const prompt1 = compileImagePrompt(DEFAULT_CONFIG, scene1, cue1, { Mira: "silver hair, green eyes" });
    assert.ok(prompt1.includes("television"), "Prompt 1 should contain television");

    // Turn 2: LLM outputs longer generic rewrite without mentioning TV
    const turn2Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "none", location: "Living room" },
        environment: {
          location: "Living room",
          timeOfDay: "night",
          weather: "clear",
          lighting: "dim warm indoor lighting",
          description: "A beautifully rendered visual novel background depicting the living room in cozy atmospheric anime style with soft lighting.",
          persistentElements: []
        },
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "a visual novel scene",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "neutral" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result2 = await planTurn(turn2Spindle, {
      chatId: "tv_chat",
      message: { ...message, content: "Mira continues sitting in the room." },
      content: "Mira continues sitting in the room.",
      previousScene: scene1,
      previousContinuity: result1.plan.terminalContinuity,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: result1.singleCharacter,
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    const scene2 = result2.plan.scenes[0]!;
    const cue2 = result2.plan.visualCues[0]!;
    const prompt2 = compileImagePrompt(DEFAULT_CONFIG, scene2, cue2, { Mira: "silver hair, green eyes" });

    // The TV detail must survive into both scene description and the compiled image prompt!
    assert.ok(scene2.environment.description.includes("television glowing"), "Scene description must keep TV");
    assert.ok(prompt2.includes("television"), "Final compiled prompt must contain television");
  });

  test("compiled prompt: short explicit 'lights off' is accepted into final prompt", async () => {
    const initialEnv: SceneEnvironment = {
      location: "Bedroom",
      timeOfDay: "night",
      weather: "clear",
      lighting: "warm bedside lamp",
      description: "A cozy bedroom with a bedside lamp.",
      persistentElements: ["bedside lamp", "wooden bed"]
    };

    const turn1Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: true, reason: "initial", location: "Bedroom" },
        environment: initialEnv,
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "bedroom, night, warm bedside lamp",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "smile" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result1 = await planTurn(turn1Spindle, {
      chatId: "light_chat",
      message: { ...message, content: "Mira turns down the covers." },
      content: "Mira turns down the covers.",
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    const scene1 = result1.plan.scenes[0]!;

    // Turn 2: short explicit "lights off"
    const turn2Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "none", location: "Bedroom" },
        environment: {
          location: "Bedroom",
          timeOfDay: "night",
          weather: "clear",
          lighting: "lights off",
          description: "A bedroom in the dark.",
          persistentElements: []
        },
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "bedroom, night, lights off",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "sleepy" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result2 = await planTurn(turn2Spindle, {
      chatId: "light_chat",
      message: { ...message, content: "Mira turns off the lights and goes to sleep." },
      content: "Mira turns off the lights and goes to sleep.",
      previousScene: scene1,
      previousContinuity: result1.plan.terminalContinuity,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: result1.singleCharacter,
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    const scene2 = result2.plan.scenes[0]!;
    const cue2 = result2.plan.visualCues[0]!;
    const prompt2 = compileImagePrompt(DEFAULT_CONFIG, scene2, cue2, { Mira: "silver hair, green eyes" });

    assert.equal(scene2.environment.lighting, "lights off");
    assert.ok(prompt2.includes("lights off"), "Compiled prompt must contain 'lights off'");
  });

  test("compiled prompt: weather 'none' does not leak into prompt", async () => {
    const initialEnv: SceneEnvironment = {
      location: "Courtyard",
      timeOfDay: "night",
      weather: "heavy rain",
      lighting: "dim lamplight",
      description: "A stone courtyard under heavy rain.",
      persistentElements: ["stone bench"]
    };

    const turn1Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: true, reason: "initial", location: "Courtyard" },
        environment: initialEnv,
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "courtyard, night, heavy rain, stone bench",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "neutral" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result1 = await planTurn(turn1Spindle, {
      chatId: "weather_chat",
      message: { ...message, content: "The rain pours down." },
      content: "The rain pours down.",
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    const scene1 = result1.plan.scenes[0]!;

    // Turn 2: weather is 'none' (rain stopped)
    const turn2Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "none", location: "Courtyard" },
        environment: {
          location: "Courtyard",
          timeOfDay: "night",
          weather: "none",
          lighting: "dim lamplight",
          description: "A quiet stone courtyard.",
          persistentElements: []
        },
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "a visual novel scene",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "neutral" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result2 = await planTurn(turn2Spindle, {
      chatId: "weather_chat",
      message: { ...message, content: "The rain ceases." },
      content: "The rain ceases.",
      previousScene: scene1,
      previousContinuity: result1.plan.terminalContinuity,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: result1.singleCharacter,
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    const scene2 = result2.plan.scenes[0]!;
    const cue2 = result2.plan.visualCues[0]!;
    const prompt2 = compileImagePrompt(DEFAULT_CONFIG, scene2, cue2, { Mira: "silver hair, green eyes" });

    assert.equal(scene2.environment.weather, null);
    assert.ok(!prompt2.includes("none"), "Compiled prompt must NEVER contain literal 'none'");
  });

  test("missing both boundary.location and environment.location does not force new scene", async () => {
    const initialEnv: SceneEnvironment = {
      location: "Jay's apartment",
      timeOfDay: "night",
      weather: null,
      lighting: "warm lamp",
      description: "Jay's cozy apartment living room.",
      persistentElements: ["couch"]
    };

    const turn1Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: true, reason: "initial", location: "Jay's apartment" },
        environment: initialEnv,
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "apartment, night, couch",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "neutral" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result1 = await planTurn(turn1Spindle, {
      chatId: "loc_chat",
      message: { ...message, content: "Mira sits on the couch." },
      content: "Mira sits on the couch.",
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    const scene1 = result1.plan.scenes[0]!;

    // Turn 2: MISSING location in both boundary and environment (raw undefined or empty)
    const turn2Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "none" } as any, // missing location
        environment: {
          timeOfDay: "night",
          lighting: "warm lamp",
          description: "Jay's cozy apartment living room.",
          persistentElements: []
        } as any, // missing location
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "a visual novel scene",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "neutral" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result2 = await planTurn(turn2Spindle, {
      chatId: "loc_chat",
      message: { ...message, content: "Mira continues sitting on the couch." },
      content: "Mira continues sitting on the couch.",
      previousScene: scene1,
      previousContinuity: result1.plan.terminalContinuity,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: result1.singleCharacter,
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    const scene2 = result2.plan.scenes[0]!;
    // Must NOT start a new scene! Reuses scene1
    assert.equal(scene2.sceneId, scene1.sceneId);
    assert.equal(scene2.revision, scene1.revision);
    assert.equal(scene2.environment.location, "Jay's apartment");
  });
});

describe("Structured environmentChanges patch and stale contradiction neutralization", () => {
  test("structured patch: addElements, removeElements, replaceElements, and description replacement", () => {
    const base: SceneEnvironment = {
      location: "Library",
      timeOfDay: "afternoon",
      weather: "clear",
      lighting: "sunlight",
      description: "A peaceful wooden library with tall bookshelves.",
      persistentElements: ["tall bookshelves", "study desk", "closed window"]
    };

    const changes = {
      description: "The library after a fierce duel, bookshelves knocked over.",
      addElements: ["scattered tomes"],
      removeElements: ["study desk"],
      replaceElements: [{ from: "closed window", to: "shattered window" }],
      clearElements: false,
      clearLighting: false,
      clearWeather: false
    };

    const merged = mergeEnvironment(base, { location: "Library", persistentElements: [] }, changes);
    assert.equal(merged.description, "The library after a fierce duel, bookshelves knocked over.");
    assert.deepEqual(merged.persistentElements, ["tall bookshelves", "shattered window", "scattered tomes"]);
  });

  test("structured patch: clearLighting and clearWeather", () => {
    const base: SceneEnvironment = {
      location: "Courtyard",
      timeOfDay: "night",
      weather: "rain",
      lighting: "lantern light",
      description: "A courtyard in the rain.",
      persistentElements: ["stone bench"]
    };

    const changes = {
      clearLighting: true,
      clearWeather: true,
      addElements: [],
      removeElements: [],
      replaceElements: [],
      clearElements: false
    };

    const merged = mergeEnvironment(base, { location: "Courtyard", persistentElements: [] }, changes);
    assert.equal(merged.lighting, null);
    assert.equal(merged.weather, null);
  });

  test("stale contradiction neutralization: explicit off/dark neutralizes 'lit' modifiers and drops contradictory prose", async () => {
    const initialEnv: SceneEnvironment = {
      location: "Living room",
      timeOfDay: "dusk",
      weather: null,
      lighting: "warm lamplight with television screen glow",
      description: "A cozy living room at dusk, a worn couch facing a brightly glowing television, warm lamps lit.",
      persistentElements: ["worn couch", "television", "lit lamp"]
    };

    const turn1Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: true, reason: "initial", location: "Living room" },
        environment: initialEnv,
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "living room, dusk, couch, television, lit lamp",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "neutral" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result1 = await planTurn(turn1Spindle, {
      chatId: "stale_chat",
      message: { ...message, content: "Mira sits quietly." },
      content: "Mira sits quietly.",
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    const scene1 = result1.plan.scenes[0]!;

    // Turn 2: lighting turns off into darkness
    const turn2Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "none", location: "Living room" },
        environment: {
          location: "Living room",
          timeOfDay: "night",
          weather: null,
          lighting: "lights off, darkness",
          description: "", // omitted / stale
          persistentElements: []
        },
        environmentChanges: {
          lighting: "lights off, darkness",
          timeOfDay: "night",
          addElements: [],
          removeElements: [],
          replaceElements: [],
          clearElements: false,
          clearLighting: false,
          clearWeather: false
        },
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "a visual novel scene",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "neutral" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result2 = await planTurn(turn2Spindle, {
      chatId: "stale_chat",
      message: { ...message, content: "Suddenly the power cuts out and darkness falls." },
      content: "Suddenly the power cuts out and darkness falls.",
      previousScene: scene1,
      previousContinuity: result1.plan.terminalContinuity,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: result1.singleCharacter,
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    const scene2 = result2.plan.scenes[0]!;
    const cue2 = result2.plan.visualCues[0]!;
    const prompt2 = compileImagePrompt(DEFAULT_CONFIG, scene2, cue2, { Mira: "silver hair, green eyes" });

    // 1. "lit lamp" was neutralized to "lamp"
    assert.deepEqual(scene2.environment.persistentElements, ["worn couch", "television", "lamp"]);
    assert.ok(!prompt2.includes("lit lamp"), "Compiled prompt must not contain 'lit lamp' in darkness");
    assert.ok(prompt2.includes("lamp"), "Compiled prompt still preserves the lamp object");

    // 2. Contradictory "warm lamps lit" and "at dusk" prose dropped
    assert.ok(!prompt2.includes("warm lamps lit"), "Compiled prompt must not contain 'warm lamps lit'");
    assert.ok(!prompt2.includes("at dusk"), "Compiled prompt must not contradict night with 'at dusk'");
    assert.ok(prompt2.includes("lights off"), "Compiled prompt contains 'lights off'");
  });

  test("malformed environmentChanges safely tolerated without fallback", async () => {
    const initialEnv: SceneEnvironment = {
      location: "Balcony",
      timeOfDay: "night",
      weather: "clear",
      lighting: "moonlight",
      description: "A stone balcony overlooking the city lights.",
      persistentElements: ["stone railing"]
    };

    const turn1Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: true, reason: "initial", location: "Balcony" },
        environment: initialEnv,
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "balcony, night, moonlight",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "neutral" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result1 = await planTurn(turn1Spindle, {
      chatId: "mal_chat",
      message: { ...message, content: "Mira stands on the balcony." },
      content: "Mira stands on the balcony.",
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    // Turn 2 passes completely bogus/malformed environmentChanges shape
    const turn2Spindle = makeSpindle({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "none", location: "Balcony" },
        environment: {
          location: "Balcony",
          timeOfDay: "night",
          weather: "clear",
          lighting: "moonlight",
          description: "A stone balcony overlooking the city lights.",
          persistentElements: []
        },
        environmentChanges: "invalid string instead of object" as any,
        cast: ["Mira"],
        character: "Mira",
        basePrompt: "a visual novel scene",
        compositionLock: "centered"
      }],
      cues: [{ paragraphIndex: 0, expression: "neutral" }],
      characters: [{ name: "Mira", description: "silver hair, green eyes" }]
    });

    const result2 = await planTurn(turn2Spindle, {
      chatId: "mal_chat",
      message: { ...message, content: "She sighs in the night air." },
      content: "She sighs in the night air.",
      previousScene: result1.plan.scenes[0]!,
      previousContinuity: result1.plan.terminalContinuity,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: result1.singleCharacter,
      characterAppearance: { Mira: "silver hair, green eyes" }
    });

    // Does NOT fail or fall back!
    assert.equal(result2.usedFallback, false);
    assert.equal(result2.plan.planningStatus, "planned");
    assert.equal(result2.plan.scenes[0]!.environment.location, "Balcony");
  });
});

describe("Model-facing instruction verification and reviewer blockers B1-B3", () => {
  test("planner model prompt instruction contains environmentChanges schema and clear semantics", async () => {
    const captured = { systemMessage: "" };
    const spindle: SpindleAPI = {
      generate: {
        raw: async (req: any) => {
          captured.systemMessage = req.system || req.messages?.[0]?.content || "";
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  scenes: [{
                    startParagraph: 0,
                    boundary: { claimedNewScene: true, reason: "initial", location: "Room" },
                    environment: { location: "Room", timeOfDay: null, weather: null, lighting: null, description: "A room", persistentElements: [] },
                    cast: ["Mira"],
                    character: "Mira",
                    basePrompt: "room",
                    compositionLock: "centered"
                  }],
                  cues: [{ paragraphIndex: 0, expression: "smile" }],
                  characters: [{ name: "Mira", description: "silver hair" }]
                })
              }
            }]
          };
        }
      },
      log: { warn() {} }
    } as unknown as SpindleAPI;

    await planTurn(spindle, {
      chatId: "inst_chat",
      message: { ...message, content: "Test instruction." },
      content: "Test instruction.",
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: { Mira: "silver hair" }
    });

    // 1. Instruction explains environmentChanges
    assert.ok(captured.systemMessage.includes("environmentChanges:"), "System message must contain environmentChanges instruction");
    assert.ok(captured.systemMessage.includes("clearLighting"), "System message must mention clearLighting");
    assert.ok(captured.systemMessage.includes("Setting lighting, timeOfDay, or weather to null"), "System message must explain null-clear semantics");
    assert.ok(captured.systemMessage.includes("Location changes belong only in boundary"), "System message must explain location is not in patch");

    // 2. Shape includes environmentChanges
    assert.ok(captured.systemMessage.includes("environmentChanges?:{description?,lighting?,timeOfDay?,weather?,addElements?,removeElements?,replaceElements?:[{from,to}],clearElements?,clearLighting?,clearWeather?}"), "Shape must specify environmentChanges fields");
  });

  test("description synthesis never invents 'at night' when timeOfDay is null or cleared", () => {
    const base: SceneEnvironment = {
      location: "Grand Hall",
      timeOfDay: null,
      weather: null,
      lighting: "warm candlelight",
      description: "A grand hall illuminated by candlelight.",
      persistentElements: ["tapestry"]
    };

    // Patch updates lighting to 'dim torchlight' without setting timeOfDay
    const changes = {
      lighting: "dim torchlight",
      timeOfDay: null,
      addElements: [],
      removeElements: [],
      replaceElements: [],
      clearElements: false,
      clearLighting: false,
      clearWeather: false
    };

    const merged = mergeEnvironment(base, { location: "Grand Hall", persistentElements: [] }, changes);
    assert.equal(merged.lighting, "dim torchlight");
    assert.equal(merged.timeOfDay, null);
    // Must NOT say "Grand Hall at night"!
    assert.ok(!merged.description.includes("at night"), "Must not invent 'at night' when timeOfDay is null");
    assert.equal(merged.description, "Grand Hall, dim torchlight.");
  });

  test("structured patch normalizes calendar timestamps in timeOfDay and weather 'none' sentinel", () => {
    const changes = normalizeEnvironmentChanges({
      timeOfDay: "Saturday, October 18, 08:40 PM (Spring)",
      weather: "none",
      lighting: "none"
    });

    assert.ok(changes !== null);
    // Timestamp is normalized to visual period
    assert.equal(changes!.timeOfDay, "evening");
    // Weather none is preserved as sentinel for mergeEnvironment
    assert.equal(changes!.weather, "none");
    // Lighting none is converted to null for clear
    assert.equal(changes!.lighting, null);
  });
});
