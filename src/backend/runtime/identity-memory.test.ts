import { describe, expect, test } from "bun:test";
import type { ChatMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { emptySingleCharacter, seedSingleCharacter } from "../core/visual-state.js";
import { compileImagePrompt } from "./images.js";
import { planTurn } from "./planner.js";
import type { CharacterAppearanceMap } from "../../shared/identity.js";

const HINA_DESCRIPTION = "petite, golden blonde short hair, brilliant red eyes, black high school uniform, red ribbon at collar, black pleated skirt, white pantyhose";

const message: ChatMessageDTO & { role: "assistant" } = {
  id: "assistant-identity-memory",
  chat_id: "chat-hina",
  index_in_chat: 2,
  is_user: false,
  name: "Hina",
  content: "Hina raises her hand.",
  send_date: 1,
  swipe_id: 0,
  swipes: ["Hina raises her hand."],
  swipe_dates: [1],
  extra: {},
  parent_message_id: "user-1",
  branch_id: null,
  created_at: 1,
  role: "assistant"
};

type Card = {
  name: string;
  description: string;
  tags: string[];
};

function spindleFor(
  card: Card | null,
  plannerCharacters: Array<{ name: string; description: string }>,
  captured: { systemMessage: string },
  options: { includeCharacterContext?: boolean; includePersonaContext?: boolean } = {}
): SpindleAPI {
  const includeCharacterContext = options.includeCharacterContext ?? true;
  return {
    chats: { get: async () => ({ character_id: card ? "character-1" : null }) },
    characters: {
      get: async () => card ? {
        id: "character-1",
        name: card.name,
        description: card.description,
        personality: "",
        scenario: "",
        creator_notes: "",
        tags: card.tags,
        world_book_ids: [],
        extensions: {}
      } : { id: "character-1", name: "", description: "", personality: "", scenario: "", creator_notes: "", tags: [], world_book_ids: [], extensions: {} }
    },
    personas: { getActive: async () => null },
    connections: {
      get: async () => ({ id: "conn", name: "Parser", provider: "openai", model: "gpt", is_default: true, api_url: "", preset_id: null, has_api_key: true, metadata: {}, reasoning_bindings: null }),
      list: async () => []
    },
    generate: {
      raw: async (request: { messages: Array<{ role: string; content: string }> }) => {
        captured.systemMessage = request.messages[0]?.content ?? "";
        return { content: JSON.stringify({
          scenes: [{
            startParagraph: 0,
            boundary: { claimedNewScene: true, reason: "initial", location: "Classroom", timeOfDay: "afternoon", majorTimeJump: false, environmentReplacement: false, forced: false },
            environment: { location: "Classroom", timeOfDay: "afternoon", weather: null, lighting: "sunlight", description: "A sunlit classroom", persistentElements: [] },
            cast: ["Hina"],
            basePrompt: "sunlit classroom, wooden desks",
            compositionLock: "Hina centered"
          }],
          cues: [{ paragraphIndex: 0, action: null, expression: null, promptDelta: "" }],
          choices: [],
          characters: plannerCharacters
        }) };
      }
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;
}

function plan(
  spindle: SpindleAPI,
  singleCharacter: ReturnType<typeof emptySingleCharacter>,
  characterAppearance: CharacterAppearanceMap = {}
) {
  return planTurn(spindle, {
    chatId: "chat-hina",
    message,
    content: message.content,
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: {
      ...DEFAULT_CONFIG,
      parserConnectionId: "conn",
      includeCharacterContext: true,
      includePersonaContext: true,
      includeLorebookContext: false
    },
    singleCharacter,
    characterAppearance
  });
}

function fullCard(): Card {
  return {
    name: "Hina",
    description: HINA_DESCRIPTION,
    tags: ["golden blonde short hair", "brilliant red eyes"]
  };
}

describe("durable cross-chat character memory", () => {
  test("two fresh chats with the same character reuse the identical full baseline", async () => {
    // Chat A learns the full Hina baseline from the character card.
    const capturedA = { systemMessage: "" };
    const resultA = await plan(spindleFor(fullCard(), [{ name: "Hina", description: HINA_DESCRIPTION }], capturedA), emptySingleCharacter());
    expect(resultA.singleCharacter.protagonist.name).toBe("Hina");
    const learned = resultA.singleCharacter.protagonist.tags;
    expect(learned).toContain("golden blonde short hair");
    expect(learned).toContain("brilliant red eyes");
    expect(learned).toContain("black high school uniform");

    // Chat B is a fresh chat (empty per-chat state) but shares the global map.
    // Even though its card is degraded, the durable baseline is reused EXACTLY.
    const capturedB = { systemMessage: "" };
    const degradedCard: Card = {
      name: "Hina",
      description: "Hina",
      tags: []
    };
    const resultB = await plan(
      spindleFor(degradedCard, [{ name: "Hina", description: "Hina" }], capturedB),
      emptySingleCharacter(),
      { Hina: learned.join(", ") }
    );
    expect(resultB.singleCharacter.protagonist.name).toBe("Hina");
    expect(resultB.singleCharacter.protagonist.tags).toEqual(learned);
    // The durable memory is exposed to the planner as the KNOWN CHARACTERS baseline.
    expect(capturedB.systemMessage).toContain("Hina: " + learned.join(", "));
  });

  test("a degraded planner character cannot override card or durable memory", async () => {
    const captured = { systemMessage: "" };
    // The planner echoes only the name; the card carries the full appearance.
    const result = await plan(
      spindleFor(fullCard(), [{ name: "Hina", description: "Hina" }], captured),
      emptySingleCharacter()
    );
    expect(result.singleCharacter.protagonist.tags).toContain("golden blonde short hair");
    expect(result.singleCharacter.protagonist.tags).not.toContain("Hina");
    const scene = result.plan.scenes[0]!;
    expect(scene.identityPrompt).not.toBe("Hina");
  });

  test("a card with a full description but empty stable tags still yields a full visual identity", async () => {
    const captured = { systemMessage: "" };
    const card: Card = { name: "Hina", description: HINA_DESCRIPTION, tags: [] };
    const result = await plan(spindleFor(card, [{ name: "Hina", description: "Hina" }], captured), emptySingleCharacter());
    expect(result.singleCharacter.protagonist.tags).toEqual([
      "petite",
      "golden blonde short hair",
      "brilliant red eyes",
      "black high school uniform",
      "red ribbon at collar",
      "black pleated skirt",
      "white pantyhose"
    ]);
  });

  test("no identity source produces no name appearance tag", async () => {
    const captured = { systemMessage: "" };
    const spindled = spindleFor(null, [{ name: "Hina", description: "Hina" }], captured); // no card
    const result = await plan(spindled, emptySingleCharacter());
    expect(result.singleCharacter.protagonist.name).toBe("Hina");
    expect(result.singleCharacter.protagonist.tags).toEqual([]);
    const scene = result.plan.scenes[0]!;
    expect(scene.identityPrompt).toBeNull();
    const cue = result.plan.visualCues[0]!;
    const prompt = compileImagePrompt(DEFAULT_CONFIG, scene, cue);
    expect(prompt).not.toContain("identity: Hina");
    expect(prompt).toContain("solo");
  });

  test("a usable frozen per-chat baseline is reused and never re-seeded", async () => {
    const captured = { systemMessage: "" };
    const frozen = seedSingleCharacter("Hina", "golden blonde short hair, brilliant red eyes");
    const result = await plan(spindleFor(fullCard(), [{ name: "Hina", description: "black hair, blue eyes" }], captured), frozen);
    expect(result.singleCharacter.protagonist.tags).toEqual(["golden blonde short hair", "brilliant red eyes"]);
  });
});

describe("scenario-card fallback poisoning (regression)", () => {
  const scenarioCard: Card = {
    name: "Monster Musume Paradise",
    description: "A city where monster girls vastly outnumber humans. Play as yourself.",
    tags: []
  };
  const poisonedMap: CharacterAppearanceMap = {
    "Monster Musume Paradise": "19yo female cow girl, soft cow horns, long brown hair, amber eyes, office blouse, bell choker"
  };

  function failingSpindle(card: Card): SpindleAPI {
    const captured = { systemMessage: "" };
    const spindle = spindleFor(card, [], captured) as unknown as Record<string, unknown>;
    // Sidecar returns empty content -> planner falls back.
    spindle.generate = { raw: async () => ({ content: "" }) };
    return spindle as unknown as SpindleAPI;
  }

  test("a planner fallback never freezes a card-title global-map identity", async () => {
    const result = await plan(failingSpindle(scenarioCard), emptySingleCharacter(), poisonedMap);
    expect(result.usedFallback).toBe(true);
    // The cow girl from another chat must NOT be adopted...
    expect(result.singleCharacter.protagonist.tags.join(", ")).not.toContain("cow");
    // ...and the identity must stay non-durable (name-only) so a later
    // successful planner turn can seed the real character.
    expect(result.singleCharacter.protagonist.tags).toEqual([]);
  });

  test("a successful planner extraction outranks the card title for seeding", async () => {
    const captured = { systemMessage: "" };
    const spindle = spindleFor(scenarioCard, [
      { name: "Nana", description: "cat girl, cat ears, slit pupils, long black hair, amber eyes, black hoodie, gray sports shorts" }
    ], captured);
    const result = await plan(spindle, emptySingleCharacter(), poisonedMap);
    expect(result.usedFallback).toBe(false);
    expect(result.singleCharacter.protagonist.name).toBe("Nana");
    const tags = result.singleCharacter.protagonist.tags.join(", ");
    expect(tags).toContain("cat ears");
    expect(tags).not.toContain("cow");
  });
});
