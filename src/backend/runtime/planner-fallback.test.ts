import { describe, expect, test } from "bun:test";
import type { ChatMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { emptySingleCharacter } from "../core/visual-state.js";
import { compileImagePrompt } from "./images.js";
import { planTurn } from "./planner.js";

const message: ChatMessageDTO & { role: "assistant" } = {
  id: "assistant-fallback",
  chat_id: "chat-1",
  index_in_chat: 2,
  is_user: false,
  name: "Mira",
  content: "Mira raises the lantern.",
  send_date: 1,
  swipe_id: 0,
  swipes: ["Mira raises the lantern."],
  swipe_dates: [1],
  extra: {},
  parent_message_id: "user-1",
  branch_id: null,
  created_at: 1,
  role: "assistant"
};

type PlannerBehaviour = "success" | "fail" | "emptyCharacters";

function spindleFor(
  behaviour: PlannerBehaviour,
  captured: { systemMessage: string },
  options: { plannerCharacterName?: string; plannerCharacterDescription?: string; noCard?: boolean } = {}
): SpindleAPI {
  return {
    chats: { get: async () => ({ character_id: options.noCard ? null : "character-1" }) },
    characters: {
      get: async () => ({
        id: "character-1",
        name: "Mira",
        description: "silver hair, green eyes, red wool coat",
        personality: "careful",
        scenario: "old observatory",
        creator_notes: "keep the red coat",
        tags: ["silver hair", "red coat"],
        world_book_ids: [],
        extensions: {}
      })
    },
    personas: { getActive: async () => null },
    connections: {
      get: async () => null,
      list: async () => []
    },
    generate: {
      raw: async (request: { messages: Array<{ role: string; content: string }> }) => {
        captured.systemMessage = request.messages[0]?.content ?? "";
        if (behaviour === "fail") throw new Error("planner unavailable");
        return { content: JSON.stringify({
          scenes: [{
            startParagraph: 0,
            boundary: {
              claimedNewScene: true,
              reason: "initial",
              location: "Observatory",
              timeOfDay: "night",
              majorTimeJump: false,
              environmentReplacement: false,
              forced: false
            },
            environment: {
              location: "Observatory",
              timeOfDay: "night",
              weather: null,
              lighting: "lantern light",
              description: "An old observatory",
              persistentElements: ["brass telescope"]
            },
            cast: ["Mira"],
            basePrompt: "old observatory, brass telescope, lantern light",
            compositionLock: "Mira centered"
          }],
          cues: [{ paragraphIndex: 0, action: "raises a lantern", expression: "alert", promptDelta: "lantern held high" }],
          choices: [],
          characters: behaviour === "emptyCharacters"
            ? []
            : [{ name: options.plannerCharacterName ?? "Mira", description: options.plannerCharacterDescription ?? "silver hair, green eyes, red wool coat" }]
        }) };
      }
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;
}

function plan(
  spindle: SpindleAPI,
  singleCharacter: ReturnType<typeof emptySingleCharacter>,
  messageOverride: typeof message = message
) {
  return planTurn(spindle, {
    chatId: "chat-1",
    message: messageOverride,
    content: message.content,
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: DEFAULT_CONFIG,
    singleCharacter,
    characterAppearance: {}
  });
}

describe("fresh single-character fallback", () => {
  test("seeds exactly one stable protagonist from the character card when the sidecar fails", async () => {
    const captured = { systemMessage: "" };
    const result = await plan(spindleFor("fail", captured), emptySingleCharacter());
    expect(result.usedFallback).toBe(true);
    // Card identity (full description + stable tags) wins over the speaker name
    // fallback: not just "Mira".
    expect(result.singleCharacter.protagonist.name).toBe("Mira");
    expect(result.singleCharacter.protagonist.tags).toEqual(["silver hair", "green eyes", "red wool coat"]);
    const scene = result.plan.scenes[0]!;
    expect(scene.identityPrompt).toBe("silver hair, green eyes, red wool coat");
    expect(scene.identityPrompt).not.toBe("");
    expect(scene.cast).toEqual(["Mira"]);
    // The prompt is not a bare "solo": it carries a nonempty identity/tag block.
    const cue = result.plan.visualCues[0]!;
    const prompt = compileImagePrompt(DEFAULT_CONFIG, scene, cue);
    expect(prompt).toContain("1girl, solo");
    expect(prompt).toContain("girl, silver hair, green eyes, red wool coat");
    expect(prompt).not.toContain("identity:");
    expect(prompt).not.toContain("Mira");
    expect(prompt).not.toBe("solo");
  });

  test("seeds the card identity when the planner returns characters: []", async () => {
    const captured = { systemMessage: "" };
    const result = await plan(spindleFor("emptyCharacters", captured), emptySingleCharacter());
    expect(result.usedFallback).toBe(false);
    expect(result.singleCharacter.protagonist.name).toBe("Mira");
    expect(result.singleCharacter.protagonist.tags).toEqual(["silver hair", "green eyes", "red wool coat"]);
    const scene = result.plan.scenes[0]!;
    expect(scene.identityPrompt).toBe("silver hair, green eyes, red wool coat");
    expect(scene.cast).toEqual(["Mira"]);
  });

  test("repeats a stable fallback and never re-seeds once frozen", async () => {
    const capturedA = { systemMessage: "" };
    const capturedB = { systemMessage: "" };
    const capturedC = { systemMessage: "" };
    const runA = await plan(spindleFor("fail", capturedA), emptySingleCharacter());
    const runB = await plan(spindleFor("fail", capturedB), emptySingleCharacter());
    // Two identical fresh fails produce the identical seeded protagonist.
    expect(runB.singleCharacter.protagonist).toEqual(runA.singleCharacter.protagonist);
    // Passing the frozen result back in must leave it untouched (frozen).
    const runC = await plan(spindleFor("fail", capturedC), runA.singleCharacter);
    expect(runC.singleCharacter.protagonist).toEqual(runA.singleCharacter.protagonist);
  });

  test("later planner success never overwrites the frozen fallback-seeded protagonist", async () => {
    const capturedFail = { systemMessage: "" };
    const capturedSuccess = { systemMessage: "" };
    const fallback = await plan(spindleFor("fail", capturedFail), emptySingleCharacter());
    expect(fallback.singleCharacter.protagonist.name).toBe("Mira");

    // The next turn the planner succeeds but names a DIFFERENT protagonist.
    const success = await plan(
      spindleFor("success", capturedSuccess, { plannerCharacterName: "Nova", plannerCharacterDescription: "black hair, blue eyes" }),
      fallback.singleCharacter
    );
    expect(success.usedFallback).toBe(false);
    // The frozen card-identity protagonist must win over the planner's new character.
    expect(success.singleCharacter.protagonist.name).toBe("Mira");
    expect(success.singleCharacter.protagonist.tags).toEqual(["silver hair", "green eyes", "red wool coat"]);
    const scene = success.plan.scenes[0]!;
    expect(scene.identityPrompt).toBe("silver hair, green eyes, red wool coat");
    expect(scene.cast).toEqual(["Mira"]);
    // The frozen identity is fed back to the planner as the known-character baseline.
    expect(capturedSuccess.systemMessage).toContain("Mira: silver hair, green eyes, red wool coat");
  });

  test("never injects the speaker name as an appearance tag when there is no card", async () => {
    const captured = { systemMessage: "" };
    const result = await plan(spindleFor("fail", captured, { noCard: true }), emptySingleCharacter());
    expect(result.usedFallback).toBe(true);
    // The name is a memory key only; it never becomes an appearance tag.
    expect(result.singleCharacter.protagonist.name).toBe("Mira");
    expect(result.singleCharacter.protagonist.tags).toEqual([]);
    const scene = result.plan.scenes[0]!;
    expect(scene.identityPrompt).toBeNull();
    expect(scene.cast).toEqual(["Mira"]);
    const cue = result.plan.visualCues[0]!;
    const prompt = compileImagePrompt(DEFAULT_CONFIG, scene, cue);
    expect(prompt).not.toContain("identity:");
    expect(prompt).toContain("solo");
  });

  test("uses the literal Protagonist when there is no card and no speaker name", async () => {
    const captured = { systemMessage: "" };
    const unnamed = { ...message, name: "" };
    const result = await plan(spindleFor("fail", captured, { noCard: true }), emptySingleCharacter(), unnamed);
    expect(result.usedFallback).toBe(true);
    expect(result.singleCharacter.protagonist.name).toBe("Protagonist");
    // No card and no speaker name: the durable fallback is a name-keyed, tag-free
    // identity, never a name-only appearance tag.
    expect(result.singleCharacter.protagonist.tags).toEqual([]);
    const scene = result.plan.scenes[0]!;
    expect(scene.identityPrompt).toBeNull();
    expect(scene.cast).toEqual(["Protagonist"]);
  });

});
