import { describe, expect, test } from "bun:test";
import type { ChatMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { emptySingleCharacter } from "../core/visual-state.js";
import { planTurn } from "./planner.js";

const message: ChatMessageDTO & { role: "assistant" } = {
  id: "assistant-repair",
  chat_id: "chat-1",
  index_in_chat: 2,
  is_user: false,
  name: "Sandra",
  content: "Sandra speaks.",
  send_date: 1,
  swipe_id: 0,
  swipes: ["Sandra speaks."],
  swipe_dates: [1],
  extra: {},
  parent_message_id: "user-1",
  branch_id: null,
  created_at: 1,
  role: "assistant"
};

function spindleWith(payload: unknown): { spindle: SpindleAPI; usedFallback: () => boolean } {
  let fallback = false;
  return {
    usedFallback: () => fallback,
    spindle: {
      chats: { get: async () => ({ character_id: "character-1" }) },
      characters: {
        get: async () => ({ id: "character-1", name: "Sandra", description: "wanted", personality: "", scenario: "", creator_notes: "", tags: [], world_book_ids: [], extensions: {} })
      },
      personas: { getActive: async () => null },
      connections: {
        get: async () => ({ id: "conn", name: "P", provider: "openai", model: "gpt", is_default: true, api_url: "", preset_id: null, has_api_key: true, metadata: {}, reasoning_bindings: null }),
        list: async () => []
      },
      generate: { raw: async () => ({ content: typeof payload === "string" ? payload : JSON.stringify(payload) }) },
      log: { warn: () => { fallback = true; } }
    } as unknown as SpindleAPI
  };
}

describe("planner tolerant parse", () => {
  test("does not fall back when boundary.reason is outside the enum", async () => {
    const { spindle, usedFallback } = spindleWith({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: false, reason: "the scene is fine", location: "Test place", timeOfDay: null, majorTimeJump: false, environmentReplacement: false, forced: false },
        environment: { location: "Test place", timeOfDay: null, weather: null, lighting: null, description: "A test setting.", persistentElements: [] },
        cast: ["Sandra"],
        basePrompt: "test place",
        compositionLock: "Character centered"
      }],
      cues: [{ paragraphIndex: 0, action: null, expression: null, promptDelta: "speaks" }],
      choices: [],
      characters: [{ name: "Sandra", description: "tall, silver hair" }]
    });
    const result = await planTurn(spindle, {
      chatId: "chat-1",
      message,
      content: message.content,
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, parserConnectionId: "conn" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: {}
    });
    expect(usedFallback()).toBe(false);
    expect(result.plan.scenes[0]?.basePrompt).toBe("test place");
  });

  test("handles a missing environment object without falling back", async () => {
    const { spindle, usedFallback } = spindleWith({
      scenes: [{
        startParagraph: 0,
        boundary: { claimedNewScene: true, reason: "initial", location: "City", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
        cast: ["Sandra"],
        basePrompt: "night city",
        compositionLock: "Character centered"
      }],
      cues: [{ paragraphIndex: 0, action: null, expression: null, promptDelta: "walk" }],
      choices: [],
      characters: []
    });
    const result = await planTurn(spindle, {
      chatId: "chat-1",
      message,
      content: message.content,
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, parserConnectionId: "conn" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: {}
    });
    expect(usedFallback()).toBe(false);
  });

  test("tolerates empty scenes array without fallback, preserving multiple cues", async () => {
    const multiParaContent = [
      "Paragraph zero.",
      "Paragraph one.",
      "Paragraph two.",
      "Paragraph three.",
      "Paragraph four.",
      "Paragraph five.",
      "Paragraph six.",
      "Paragraph seven.",
      "Paragraph eight."
    ].join("\n\n");

    const { spindle, usedFallback } = spindleWith({
      scenes: [],
      cues: [
        { paragraphIndex: 0 },
        { paragraph_index: 2 },
        { paragraph: 4 },
        { p_index: 6 },
        { index: 8 }
      ],
      choices: [],
      characters: [{ name: "Sandra", description: "silver hair" }]
    });
    const result = await planTurn(spindle, {
      chatId: "chat-1",
      message: { ...message, content: multiParaContent },
      content: multiParaContent,
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 5, parserConnectionId: "conn" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: {}
    });
    expect(usedFallback()).toBe(false);
    expect(result.plan.scenes.length).toBeGreaterThanOrEqual(1);
    expect(result.plan.scenes[0]?.startParagraph).toBe(0);
    expect(result.plan.visualCues.length).toBe(5);
    expect(result.plan.visualCues.map((c) => c.paragraphIndex)).toEqual([0, 2, 4, 6, 8]);
  });

  test("normalizes singular scene object into scenes array", async () => {
    const twoParaContent = "Paragraph zero.\n\nParagraph one.";
    const { spindle, usedFallback } = spindleWith({
      scene: {
        startParagraph: 0,
        boundary: { claimedNewScene: true, reason: "initial", location: "Courtyard" },
        environment: { location: "Courtyard", description: "Stone courtyard" },
        cast: ["Sandra"],
        basePrompt: "stone courtyard"
      },
      cues: [{ paragraphIndex: 0 }, { paragraphIndex: 1 }],
      choices: [],
      characters: []
    });
    const result = await planTurn(spindle, {
      chatId: "chat-1",
      message: { ...message, content: twoParaContent },
      content: twoParaContent,
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 2, parserConnectionId: "conn" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: {}
    });
    expect(usedFallback()).toBe(false);
    expect(result.plan.scenes[0]?.environment.location).toBe("Courtyard");
    expect(result.plan.visualCues.length).toBe(2);
  });

  test("parses output containing markdown thought fence followed by json fence", async () => {
    const rawContent = `\`\`\`thought
I need to plan 5 cues for this scene.
\`\`\`
\`\`\`json
{
  "scenes": [{ "startParagraph": 0, "environment": { "location": "Garden" } }],
  "cues": [{ "paragraphIndex": 0 }, { "paragraphIndex": 1 }],
  "characters": []
}
\`\`\``;
    const { spindle, usedFallback } = spindleWith(rawContent);
    const result = await planTurn(spindle, {
      chatId: "chat-1",
      message: { ...message, content: "P0.\n\nP1." },
      content: "P0.\n\nP1.",
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 2, parserConnectionId: "conn" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: {}
    });
    expect(usedFallback()).toBe(false);
    expect(result.plan.scenes[0]?.environment.location).toBe("Garden");
    expect(result.plan.visualCues.length).toBe(2);
  });

  test("parses output with <thought> tags and trailing commas", async () => {
    const rawContent = `<thought>
Considering options...
</thought>
{
  "scenes": [{ "startParagraph": 0, "environment": { "location": "Bazaar" }, }],
  "cues": [{ "paragraphIndex": 0 },],
  "characters": [],
}`;
    const { spindle, usedFallback } = spindleWith(rawContent);
    const result = await planTurn(spindle, {
      chatId: "chat-1",
      message: { ...message, content: "P0." },
      content: "P0.",
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 1, parserConnectionId: "conn" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: {}
    });
    expect(usedFallback()).toBe(false);
    expect(result.plan.scenes[0]?.environment.location).toBe("Bazaar");
  });

  test("extracts content from provider response shapes like { text } or { choices }", async () => {
    const spindle: any = {
      chats: { get: async () => ({ character_id: "character-1" }) },
      characters: { get: async () => ({ id: "character-1", name: "Sandra", description: "", tags: [], extensions: {} }) },
      personas: { getActive: async () => null },
      connections: { get: async () => ({ id: "conn", is_default: true }), list: async () => [] },
      generate: {
        raw: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  scenes: [{ startParagraph: 0, environment: { location: "Palace" } }],
                  cues: [{ paragraphIndex: 0 }]
                })
              }
            }
          ]
        })
      },
      log: { warn: () => {} }
    };
    const result = await planTurn(spindle, {
      chatId: "chat-1",
      message: { ...message, content: "P0." },
      content: "P0.",
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 1, parserConnectionId: "conn" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: {}
    });
    expect(result.usedFallback).toBe(false);
    expect(result.plan.scenes[0]?.environment.location).toBe("Palace");
  });

  test("assigns poseExpressionId from planner cue.expression matching 80종 catalog", async () => {
    const multiContent = "P0.\n\nP1.\n\nP2.";
    const { spindle, usedFallback } = spindleWith({
      scenes: [{ startParagraph: 0, environment: { location: "Balcony" } }],
      cues: [
        { paragraphIndex: 0, expression: "smirk" },
        { paragraphIndex: 1, expression: "lovestruck" },
        { paragraphIndex: 2, expression: "acting cute" }
      ],
      choices: [],
      characters: [{ name: "Sandra", description: "silver hair" }]
    });
    const result = await planTurn(spindle, {
      chatId: "chat-1",
      message: { ...message, content: multiContent },
      content: multiContent,
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 3, parserConnectionId: "conn" },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: {}
    });
    expect(usedFallback()).toBe(false);
    expect(result.plan.visualCues.length).toBe(3);
    expect(result.plan.visualCues[0]?.poseExpressionId).toBe("smirk");
    expect(result.plan.visualCues[1]?.poseExpressionId).toBe("lovestruck");
    expect(result.plan.visualCues[2]?.poseExpressionId).toBe("acting_cute");
  });
});
