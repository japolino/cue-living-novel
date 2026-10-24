import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config";
import { ContinuityStateSchema, SceneStateSchema, type SceneState } from "../../shared/contracts";
import { POSE_EXPRESSION_CATALOGUE } from "../../shared/character";
import { emptySingleCharacter } from "../core/visual-state";
import { namedInReply, planTurn, PLANNER_EXPRESSION_IDS, RECENT_CONTEXT_LIMITS, type PlanTurnInput } from "./planner";

// The story reader's compact output: a speaker map, reason-only boundaries,
// continuing scenes without an environment, no basePrompt/compositionLock.

const content = [
  "Aria slams her tankard down. \"Another round!\"",
  "\"You've had four,\" Dorran grunts from behind the bar.",
  "She shrugs off her dented breastplate and pulls on a borrowed wool cloak.",
  "Outside, the market square is slick with rain.",
  "Lightning splits the sky above the stalls."
].join("\n\n");

const message: ChatMessageDTO & { role: "assistant" } = {
  id: "assistant-9",
  chat_id: "chat-1",
  index_in_chat: 9,
  is_user: false,
  name: "Aria",
  content,
  send_date: 1,
  swipe_id: 0,
  swipes: [content],
  swipe_dates: [1],
  extra: {},
  parent_message_id: "user-8",
  branch_id: null,
  created_at: 1,
  role: "assistant"
};

function tavern(): SceneState {
  return SceneStateSchema.parse({
    sceneId: "scene-tavern",
    revision: 3,
    startParagraph: 0,
    environment: {
      location: "The Gilded Stag tavern",
      timeOfDay: "night",
      weather: null,
      lighting: "warm hearth light",
      description: "A crowded tavern common room with a long oak bar.",
      persistentElements: ["long oak bar", "stone hearth", "ale barrels"]
    },
    cast: ["Aria"],
    character: "Aria",
    attire: "dented steel breastplate, green tunic",
    continuity: ContinuityStateSchema.parse({ revision: 1, characters: {}, facts: {} }),
    basePrompt: "STORED_BASE_PROMPT_SENTINEL",
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
    compositionLock: "COMPOSITION_LOCK_SENTINEL",
    activeAssetId: "image-tavern",
    priorSceneId: null
  });
}

function plannerSpindle(output: unknown, captured?: { system: string; user: string }): SpindleAPI {
  return {
    generate: {
      raw: async (request: any) => {
        if (captured) {
          captured.system = request.messages?.[0]?.content ?? "";
          captured.user = request.messages?.[1]?.content ?? "";
        }
        return { choices: [{ message: { content: JSON.stringify(output) } }] };
      }
    },
    log: { warn() {}, info() {} }
  } as unknown as SpindleAPI;
}

function input(overrides: Partial<PlanTurnInput> = {}): PlanTurnInput {
  return {
    chatId: "chat-1",
    message,
    content,
    previousScene: tavern(),
    previousContinuity: ContinuityStateSchema.parse({ revision: 1, characters: {}, facts: {} }),
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {},
    ...overrides
  };
}

const marketEnvironment = {
  location: "Millbrook market square",
  timeOfDay: "night",
  weather: "rain",
  lighting: "guttering lanterns",
  description: "A rain-slick cobbled square between shuttered stalls.",
  persistentElements: ["cobblestones", "shuttered stalls", "lanterns"]
};

test("compact output: speaker map, reason-only boundary, continuing scene keeps the previous place", async () => {
  const result = await planTurn(plannerSpindle({
    speakers: { "0": "Aria", "1": "Dorran", "2": "She", "3": "Narrator", "4": "Narrator" },
    scenes: [
      { startParagraph: 0, boundary: { reason: "none" }, cast: ["Aria"], character: "Aria" },
      { startParagraph: 3, boundary: { reason: "location_change" }, environment: marketEnvironment, cast: ["Aria"], character: "Aria", ambient: "rain" }
    ],
    cues: [{ paragraphIndex: 0, expression: "angry", character: "Aria" }, { paragraphIndex: 3, expression: "determined", character: "Aria" }],
    effects: [{ paragraphIndex: 4, effect: "lightning" }],
    characters: [{ name: "Aria", description: "elf ranger, long auburn braid, green eyes", subjectCategory: "female" }]
  }), input());

  assert.equal(result.usedFallback, false);
  // "Dorran" is spelled in the reply, so the one-line barkeep keeps a nameplate; a pronoun never does.
  assert.deepEqual(result.plan.paragraphSpeakers, ["Aria", "Dorran", null, "", ""]);
  assert.equal(result.plan.scenes.length, 2);
  assert.equal(result.plan.scenes[0]?.sceneId, "scene-tavern");
  assert.equal(result.plan.scenes[0]?.environment.location, "The Gilded Stag tavern");
  assert.equal(result.plan.scenes[1]?.startParagraph, 3);
  assert.equal(result.plan.scenes[1]?.environment.location, "Millbrook market square");
  assert.equal(result.plan.scenes[1]?.ambient, "rain");
  assert.deepEqual(result.plan.effectCues?.map((cue) => `${cue.paragraphIndex}:${cue.effect}`), ["4:lightning"]);
});

test("a later scene that omits its environment continues the scene before it, not the previous turn's", async () => {
  const result = await planTurn(plannerSpindle({
    speakers: {},
    scenes: [
      { startParagraph: 0, boundary: { reason: "none" }, cast: ["Aria"], character: "Aria" },
      { startParagraph: 3, boundary: { reason: "location_change" }, environment: marketEnvironment, cast: ["Aria"], character: "Aria" },
      { startParagraph: 4, boundary: { reason: "none" }, cast: ["Aria"], character: "Aria" }
    ],
    cues: [{ paragraphIndex: 0, expression: "idle", character: "Aria" }],
    characters: []
  }), input());

  assert.deepEqual(result.plan.scenes.map((scene) => scene.environment.location), ["The Gilded Stag tavern", "Millbrook market square"]);
});

test("an environment nested inside the boundary is read as the scene's environment", async () => {
  const result = await planTurn(plannerSpindle({
    scenes: [{ startParagraph: 0, boundary: { reason: "location_change", environment: marketEnvironment }, cast: ["Aria"], character: "Aria" }],
    cues: [{ paragraphIndex: 0, expression: "idle", character: "Aria" }],
    characters: []
  }), input());

  assert.equal(result.plan.scenes[0]?.environment.location, "Millbrook market square");
  assert.notEqual(result.plan.scenes[0]?.sceneId, "scene-tavern");
});

test("attire sent as a tag list or a {name: outfit} map is a wardrobe change", async () => {
  const wardrobeAt = (plan: Awaited<ReturnType<typeof planTurn>>["plan"]) => plan.continuityDeltas.flatMap((delta) =>
    Object.entries(delta.delta.characterUpdates ?? {}).map(([name, update]) => `${delta.paragraphIndex}:${name}:${(update as { wardrobe?: { attire?: string | null } }).wardrobe?.attire}`));

  const listed = await planTurn(plannerSpindle({
    scenes: [{ startParagraph: 0, boundary: { reason: "none" }, cast: ["Aria"], character: "Aria" }],
    cues: [
      { paragraphIndex: 0, expression: "idle", character: "Aria" },
      { paragraphIndex: 2, expression: "determined", character: "Aria", attire: ["borrowed wool cloak", "green tunic"] }
    ],
    characters: []
  }), input());
  assert.deepEqual(wardrobeAt(listed.plan), ["2:Aria:borrowed wool cloak, green tunic"]);

  const mapped = await planTurn(plannerSpindle({
    scenes: [
      { startParagraph: 0, boundary: { reason: "none" }, cast: ["Aria"], character: "Aria" },
      { startParagraph: 2, boundary: { reason: "none" }, character: "Aria", attire: { Aria: "borrowed wool cloak, green tunic" } }
    ],
    cues: [{ paragraphIndex: 0, expression: "idle", character: "Aria" }],
    characters: []
  }), input());
  assert.deepEqual(wardrobeAt(mapped.plan), ["2:Aria:borrowed wool cloak, green tunic"]);
  assert.equal(mapped.plan.scenes.length, 1);
});

test("an alias-only character entry without a description does not fail the plan", async () => {
  const result = await planTurn(plannerSpindle({
    scenes: [{ startParagraph: 0, boundary: { reason: "none" }, cast: ["Aria"], character: "Aria" }],
    cues: [{ paragraphIndex: 0, expression: "idle", character: "Aria" }],
    characters: [{ name: "The ranger", description: "", characterId: "aria", aliases: ["The ranger"] }, { name: "Nobody" }]
  }), input());
  assert.equal(result.usedFallback, false);
});

test("the request sends the reply once, trims history and drops fixed scene metadata", async () => {
  const captured = { system: "", user: "" };
  const continuity = ContinuityStateSchema.parse({
    revision: 1,
    characters: { Aria: { wardrobe: { attire: "dented steel breastplate, green tunic" } } },
    facts: {}
  });
  await planTurn(plannerSpindle({ scenes: [], cues: [] }, captured), input({
    previousContinuity: continuity,
    recentMessages: [
      { id: "user-6", name: "Theo", is_user: true, content: "OLD_LINE ".repeat(400) + "LATEST_TAIL" },
      { id: "assistant-7", name: "Aria", is_user: false, content: "<think>HIDDEN_REASONING</think>Aria laughs at the bar." },
      { id: message.id, name: "Aria", is_user: false, content }
    ]
  }));

  const [previous = "", afterPrevious = ""] = captured.user.split("RECENT CHAT");
  const recent = afterPrevious.split("TARGET ASSISTANT RESPONSE")[0] ?? "";
  // The target reply appears once, in TARGET ASSISTANT RESPONSE.
  assert.equal(captured.user.split("Dorran grunts").length - 1, 1);
  assert.doesNotMatch(recent, /HIDDEN_REASONING/);
  assert.match(recent, /Aria laughs at the bar\./);
  assert.match(recent, /LATEST_TAIL/);
  assert.ok(recent.length <= RECENT_CONTEXT_LIMITS.total + 200, `recent chat is ${recent.length} chars`);
  // PREVIOUS SCENE keeps the place and current outfits, not the fixed camera, lock or stored base prompt.
  assert.match(previous, /The Gilded Stag tavern/);
  assert.match(previous, /"outfits":\{"Aria":"dented steel breastplate, green tunic"\}/);
  assert.doesNotMatch(previous, /cameraLock|STORED_BASE_PROMPT_SENTINEL|COMPOSITION_LOCK_SENTINEL|scene-tavern/);
  assert.doesNotMatch(captured.system, /basePrompt|compositionLock/);
});

test("namedInReply accepts names spelled in the reply and never pronouns or role words", () => {
  const paragraphs = ["\"You've had four,\" Dorran grunts.", "The elf customer waves."];
  assert.equal(namedInReply("Dorran", paragraphs), true);
  assert.equal(namedInReply("dorran", paragraphs), true);
  assert.equal(namedInReply("Elf customer", paragraphs), true);
  assert.equal(namedInReply("Dor", paragraphs), false);
  assert.equal(namedInReply("She", ["She waves."]), false);
  assert.equal(namedInReply("Woman", ["A woman waves."]), false);
  assert.equal(namedInReply("Mira", paragraphs), false);
});

test("every expression id offered to the story reader is a catalogue entry", () => {
  const catalogue = new Set(POSE_EXPRESSION_CATALOGUE.map((entry) => entry.id));
  assert.deepEqual(PLANNER_EXPRESSION_IDS.filter((id) => !catalogue.has(id)), []);
});
