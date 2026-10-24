import assert from "node:assert/strict";
import test from "node:test";
import type { CharacterDTO, ChatMessageDTO, PersonaDTO, SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config";
import { ContinuityStateSchema, SceneStateSchema, type SceneState } from "../../shared/contracts";
import { emptySingleCharacter } from "../core/visual-state";
import { loadVisualContext } from "./context";
import { planTurn, type PlanTurnInput } from "./planner";
import { deterministicSpriteStaging } from "./sprite-staging";

// Regressions found by review of the compact story-reader shape: free-text
// boundary reasons, omitted environments on new scenes, CJK history, speakers
// only the reply names, attire maps and description-less character entries.

const content = [
  "Aria slams her tankard down. \"Another round!\"",
  "\"You've had four,\" Dorran grunts from behind the bar.",
  "Hours later, morning light fills the tavern.",
  "She stretches and smiles at Theo."
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

const tavernEnvironment = {
  location: "The Gilded Stag tavern",
  timeOfDay: "night",
  weather: null,
  lighting: "warm hearth light",
  description: "A crowded tavern common room with a long oak bar.",
  persistentElements: ["long oak bar", "stone hearth", "ale barrels"]
};

function tavern(): SceneState {
  return SceneStateSchema.parse({
    sceneId: "scene-tavern",
    revision: 3,
    startParagraph: 0,
    environment: tavernEnvironment,
    cast: ["Aria"],
    character: "Aria",
    attire: "dented steel breastplate",
    continuity: ContinuityStateSchema.parse({ revision: 1, characters: {}, facts: {} }),
    basePrompt: "tavern",
    cameraLock: {
      framing: "upper body", angle: "eye level", perspective: "straight-on", lens: null,
      subjectAnchor: "center", horizon: "upper middle third", safeDialogueRegion: "lower quarter", aspectRatio: "16:9"
    },
    compositionLock: "centered",
    activeAssetId: "image-tavern",
    priorSceneId: null
  });
}

const registry = {
  aria: { id: "aria", name: "Aria", aliases: [], tags: "elf, auburn braid, green eyes", subjectCategory: "female" as const },
  kitsune: { id: "kitsune", name: "Kitsune", aliases: ["Fox girl"], tags: "fox ears, fox tail, orange hair", subjectCategory: "female" as const }
};

const persona: PersonaDTO = {
  id: "persona-1", name: "Theo Grant", title: "", description: "A tall man.", image_id: null,
  attached_world_book_id: null, folder: "", is_default: true, metadata: {}, created_at: 1, updated_at: 1
};

function plannerSpindle(output: unknown, captured?: { user: string }): SpindleAPI {
  return {
    generate: {
      raw: async (request: any) => {
        if (captured) captured.user = request.messages?.[1]?.content ?? "";
        return { choices: [{ message: { content: JSON.stringify(output) } }] };
      }
    },
    personas: { getActive: async () => persona },
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
    config: { ...DEFAULT_CONFIG, includeCharacterContext: false, includePersonaContext: true, includeLorebookContext: false, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: { Aria: "elf, auburn braid, green eyes" },
    characterRegistry: registry,
    ...overrides
  };
}

const opening = { startParagraph: 0, boundary: { reason: "none" }, cast: ["Aria"], character: "Aria" };
const cueAt0 = { paragraphIndex: 0, expression: "idle", character: "Aria" };

test("a free-text reason that only mentions time or the environment never starts a scene", async () => {
  for (const reason of ["no_time_skip", "same time", "no time jump", "environment unchanged", "weather change", "same_location"]) {
    const result = await planTurn(plannerSpindle({ scenes: [{ ...opening, boundary: { reason } }], cues: [cueAt0] }), input());
    assert.equal(result.plan.scenes.length, 1, reason);
    assert.equal(result.plan.scenes[0]?.sceneId, "scene-tavern", reason);
    assert.deepEqual(result.plan.scenes[0]?.environment.persistentElements, tavernEnvironment.persistentElements, reason);
  }
  // The exact enum value still does.
  const jump = await planTurn(plannerSpindle({ scenes: [{ ...opening, boundary: { reason: "major_time_jump" } }], cues: [cueAt0] }), input());
  assert.notEqual(jump.plan.scenes[0]?.sceneId, "scene-tavern");
});

test("a new scene in the same place builds on the place before it", async () => {
  const later = (extra: Record<string, unknown>) => ({ startParagraph: 2, boundary: { reason: "major_time_jump" }, cast: ["Aria"], character: "Aria", ...extra });
  for (const [label, scene] of [
    ["no environment", later({})],
    ["partial environment", later({ environment: { timeOfDay: "morning", lighting: "morning sunlight" } })],
    ["environmentChanges only", later({ environmentChanges: { timeOfDay: "morning" } })]
  ] as const) {
    const result = await planTurn(plannerSpindle({ scenes: [opening, scene], cues: [cueAt0, { paragraphIndex: 2, expression: "smile", character: "Aria" }] }), input());
    const next = result.plan.scenes[1];
    assert.ok(next, label);
    assert.notEqual(next.sceneId, "scene-tavern", label);
    assert.equal(next.environment.location, tavernEnvironment.location, label);
    assert.deepEqual(next.environment.persistentElements, tavernEnvironment.persistentElements, label);
    assert.doesNotMatch(next.environment.description, /coherent visual-novel environment/, label);
    if (label === "no environment") assert.equal(next.environment.description, tavernEnvironment.description, label);
    // A new time of day re-describes the same place (mergeEnvironment drops stale time prose).
    else assert.equal(next.environment.timeOfDay, "morning", label);
  }
});

test("a boundary that names a new place is the fallback for an omitted environment", async () => {
  const result = await planTurn(plannerSpindle({
    scenes: [opening, { startParagraph: 2, boundary: { reason: "location_change", location: "Millbrook market square" }, cast: ["Aria"], character: "Aria" }],
    cues: [cueAt0]
  }), input());
  assert.equal(result.plan.scenes[1]?.environment.location, "Millbrook market square");
  assert.deepEqual(result.plan.scenes[1]?.environment.persistentElements, []);
});

test("recent chat keeps Japanese, Chinese and Thai text and never splits a code point", async () => {
  const captured = { user: "" };
  const japanese = "ミラは窓の外を見つめながら、静かに紅茶を一口飲んだ。部屋の中には古い本の匂いが漂い、暖炉の火がぱちぱちと音を立てている。".repeat(3);
  const chinese = "米拉望着窗外，静静地喝了一口红茶。房间里弥漫着旧书的气味，壁炉里的火噼啪作响。她慢慢转过身来，温柔地微笑着。".repeat(3);
  const thai = "มิราจ้องมองออกไปนอกหน้าต่างพลางจิบชาอย่างเงียบๆ ห้องนี้มีกลิ่นหนังสือเก่าลอยอยู่".repeat(3);
  const longJapanese = `${"あ".repeat(100)}。`.repeat(30) + "\n最後の行。";
  const emoji = `${"🙂".repeat(1500)} end`;
  const data = `data:image/png;base64,${"iVBORw0KGgo".repeat(30)}`;
  await planTurn(plannerSpindle({ scenes: [], cues: [] }, captured), input({
    recentMessages: [
      { id: "a-4", name: "Mira", is_user: false, content: emoji },
      { id: "a-5", name: "Mira", is_user: false, content: chinese },
      { id: "a-6", name: "Mira", is_user: false, content: thai },
      { id: "a-7", name: "Mira", is_user: false, content: `${japanese}\n\nShort line. ${data}` },
      { id: "a-8", name: "Mira", is_user: false, content: longJapanese },
      { id: message.id, name: "Aria", is_user: false, content }
    ]
  }));
  const recent = captured.user.split("RECENT CHAT")[1]?.split("TARGET ASSISTANT RESPONSE")[0] ?? "";
  assert.ok(recent.includes(japanese), "a 180-character Japanese paragraph survives");
  assert.ok(recent.includes(chinese.slice(-60)), "Chinese text survives");
  assert.ok(recent.includes(thai.slice(-40)), "Thai text survives");
  assert.doesNotMatch(recent, /iVBORw0KGgo/, "inline data is still dropped");
  // The newest message is clipped to its tail, not cut down to its last line.
  const newest = recent.slice(recent.lastIndexOf("Mira: "));
  assert.ok(newest.includes("最後の行。") && newest.length > 1500, `newest kept ${newest.length} chars`);
  assert.doesNotMatch(recent, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, "no lone surrogate");
});

test("a re-planned older turn never sends the messages after it as history", async () => {
  const captured = { user: "" };
  await planTurn(plannerSpindle({ scenes: [], cues: [] }, captured), input({
    recentMessages: [
      { id: "user-8", index_in_chat: 8, name: "Theo Grant", is_user: true, content: "BEFORE_TARGET line" },
      { id: "user-10", index_in_chat: 10, name: "Theo Grant", is_user: true, content: "AFTER_TARGET line" },
      { id: "assistant-11", index_in_chat: 11, name: "Aria", is_user: false, content: "AFTER_TARGET reply" }
    ]
  }));
  const recent = captured.user.split("RECENT CHAT")[1]?.split("TARGET ASSISTANT RESPONSE")[0] ?? "";
  assert.match(recent, /BEFORE_TARGET/);
  assert.doesNotMatch(recent, /AFTER_TARGET/);
});

test("a speaker only the reply names is a nameplate, never a sprite actor; nicknames and role labels are not new speakers", async () => {
  const result = await planTurn(plannerSpindle({
    speakers: { "0": "Aria", "1": "Dorran", "2": "The guard", "3": "Theo" },
    scenes: [opening],
    cues: [cueAt0]
  }), input({ content: content.replace("Hours later, morning light fills the tavern.", "The guard yawns by the door.") }));
  assert.deepEqual(result.plan.paragraphSpeakers, ["Aria", "Dorran", null, "Theo Grant"]);
  assert.deepEqual(result.plan.nameplateOnlySpeakers, ["Dorran"]);
  const staging = deterministicSpriteStaging({
    plan: result.plan, config: DEFAULT_CONFIG, styleKey: "style", knownPlates: [], previousCast: [], previousStage: null,
    personaName: "Theo Grant", registry: result.characterRegistry, characterAppearance: { Aria: "elf, auburn braid, green eyes" }
  });
  assert.deepEqual(staging.cast.map((member) => member.name), ["Aria"]);
});

test("an attire map dresses only the character it names, after alias resolution", async () => {
  const wardrobe = (plan: Awaited<ReturnType<typeof planTurn>>["plan"]) => plan.continuityDeltas.flatMap((delta) =>
    Object.entries(delta.delta.characterUpdates ?? {}).map(([name, update]) => `${delta.paragraphIndex}:${name}:${(update as { wardrobe?: { attire?: string | null } }).wardrobe?.attire}`));
  const other = await planTurn(plannerSpindle({
    scenes: [opening],
    cues: [cueAt0, { paragraphIndex: 1, expression: "idle", character: "Aria", attire: { Dorran: "leather apron" } }]
  }), input());
  assert.deepEqual(wardrobe(other.plan), []);
  const alias = await planTurn(plannerSpindle({
    scenes: [opening],
    cues: [cueAt0, { paragraphIndex: 3, expression: "smile", character: "Kitsune", attire: { "Fox girl": "red silk kimono", Aria: "green cloak" } }]
  }), input());
  assert.deepEqual(wardrobe(alias.plan), ["3:Kitsune:red silk kimono"]);
});

test("a description-less character entry links to an existing character or is dropped", async () => {
  const result = await planTurn(plannerSpindle({
    scenes: [opening],
    cues: [cueAt0],
    characters: [
      { name: "Red fox", description: "", characterId: "kitsune-fox", aliases: ["Red fox"] },
      { name: "The vixen", description: "", characterId: "kitsune", aliases: ["The vixen"] }
    ]
  }), input());
  assert.deepEqual(Object.keys(result.characterRegistry).sort(), ["aria", "kitsune"]);
  assert.ok(result.characterRegistry.kitsune?.aliases.includes("The vixen"));
  assert.equal(result.characterRegistry.kitsune?.tags, registry.kitsune.tags);
});

test("on a card tagged as a scenario, {{char}} reads as the narrator, not the card title", async () => {
  const card: CharacterDTO = {
    id: "card-1", name: "Monster Musume Paradise", description: "{{char}} narrates a school for monster girls.",
    personality: "", scenario: "{{char}} follows {{user}} through the day.", first_mes: "", mes_example: "", creator_notes: "",
    system_prompt: "", post_history_instructions: "", tags: ["Scenario", "Multiple Characters"], alternate_greetings: [],
    creator: "", image_id: null, world_book_ids: [], extensions: {}, created_at: 1, updated_at: 1
  };
  const spindle = {
    chats: { get: async () => ({ id: "chat-1", character_id: "card-1", name: "c", metadata: {}, created_at: 1, updated_at: 1 }) },
    characters: { get: async () => card },
    personas: { getActive: async () => persona },
    world_books: { getActivated: async () => [], entries: { get: async () => null } },
    macros: { resolve: async (text: string) => ({ text, diagnostics: [] }) }
  } as unknown as SpindleAPI;
  const snapshot = await loadVisualContext(spindle, { chatId: "chat-1", target: "x", config: { ...DEFAULT_CONFIG, includeLorebookContext: false } });
  assert.match(snapshot.plannerContext, /the narrator follows Theo Grant through the day/);
  assert.doesNotMatch(snapshot.plannerContext, /Monster Musume Paradise follows/);
});
