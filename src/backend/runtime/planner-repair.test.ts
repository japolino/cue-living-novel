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
      generate: { raw: async () => ({ content: JSON.stringify(payload) }) },
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
});
