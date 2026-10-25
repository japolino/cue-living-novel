import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend, spriteService } from "./controller.js";
import { CHARACTER_CONFIG_PATH, turnPath, type StoredTurnRecord } from "./storage.js";
import { waitFor } from "./sprites/__fixtures__/sprite-fixtures.js";
import type { CharacterConfigView, TurnView } from "../../protocol.js";
import type { VisualNovelConfig } from "../../config.js";
import { isPlannedTurn } from "./__fixtures__/turns.js";

/**
 * Settings saved per character through the controller: saves in "<name> only"
 * scope, the layers sent with vn_state / vn_config, and planning that follows
 * the chat's character (here: sprite mode for one character only).
 */

const CONTENT = "Mira smiled at the stars.\n\n\"It's beautiful,\" Mira said.";

function plannerPayload() {
  return {
    scenes: [{
      startParagraph: 0,
      boundary: { claimedNewScene: true, reason: "initial", location: "Observatory", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
      environment: { location: "Observatory", timeOfDay: "night", weather: null, lighting: "lantern light", description: "An old observatory", persistentElements: ["brass telescope"] },
      cast: ["Mira"],
      basePrompt: "old observatory, brass telescope",
      compositionLock: "Mira centered"
    }],
    cues: [{ paragraphIndex: 0, character: "Mira", poseExpressionId: "smile" }, { paragraphIndex: 1, character: "Mira", poseExpressionId: "smile" }],
    paragraphSpeakers: [null, "Mira"],
    choices: [],
    characters: [{ name: "Mira", description: "1girl, silver hair, green eyes" }]
  };
}

const CHATS: Record<string, { character_id?: string }> = {
  "chat-mira": { character_id: "card-mira" },
  "chat-mira-2": { character_id: "card-mira" },
  "chat-theo": { character_id: "card-theo" },
  "chat-group": {},
};
const CARDS: Record<string, { name: string }> = { "card-mira": { name: "Mira" }, "card-theo": { name: "Theo" } };

function fixture(config: Record<string, unknown> = {}, characters?: unknown) {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let frontend!: (payload: unknown, userId: string) => void;
  const data = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  let seq = 0;
  data.set("config.json", {
    generateImages: true,
    maxImagesPerTurn: 2,
    imageConcurrency: 4,
    referenceAnchoring: false,
    includeCharacterContext: false,
    includePersonaContext: false,
    includeLorebookContext: false,
    ...config
  });
  if (characters !== undefined) data.set(CHARACTER_CONFIG_PATH, characters);
  const spindle = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    onFrontendMessage: (fn: (payload: unknown, userId: string) => void) => { frontend = fn; },
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown }) => {
        const value = data.get(path);
        return value === undefined ? readOptions.fallback : JSON.parse(JSON.stringify(value));
      },
      setJson: async (path: string, value: unknown) => { data.set(path, JSON.parse(JSON.stringify(value))); }
    },
    chats: { get: async (chatId: string) => CHATS[chatId] ? { id: chatId, ...CHATS[chatId] } : null },
    characters: { get: async (id: string) => CARDS[id] ? { id, ...CARDS[id] } : null },
    chat: { getMessages: async (chatId: string) => messages.filter((m) => m.chat_id === chatId) },
    generate: { raw: async () => ({ content: JSON.stringify(plannerPayload()) }) },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async () => { seq += 1; return { imageId: `img-${seq}`, imageUrl: `/api/v1/images/img-${seq}` }; }
    },
    images: {
      upload: async () => { seq += 1; return { id: `cut-${seq}`, url: `/api/v1/images/cut-${seq}` }; },
      delete: async () => true,
      get: async (id: string) => ({ id })
    },
    sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); },
    log: { warn() {}, error() {}, info() {} },
  } as unknown as SpindleAPI;
  const fire = (event: string, ...args: unknown[]) => {
    for (const handler of handlers.get(event) ?? []) handler(...args);
  };
  const reply = (chatId: string, id: string, userId: string) => {
    messages.push({
      id, chat_id: chatId, content: CONTENT, is_user: false, name: "Mira", swipe_id: 0,
      swipes: [CONTENT], swipe_dates: [1], extra: {}, parent_message_id: null, branch_id: null,
      created_at: messages.length, index_in_chat: messages.length, send_date: 1
    });
    fire("GENERATION_ENDED", { chatId, messageId: id, content: CONTENT }, userId);
  };
  const request = (payload: unknown, userId: string) => frontend(payload, userId);
  const record = (chatId: string, id: string) => data.get(turnPath(chatId, id, 0)) as StoredTurnRecord | undefined;
  const of = (type: string) => sent.filter((message) => message.type === type);
  const turns = () => of("vn_turn").filter(isPlannedTurn).map((message) => message.turn as TurnView);
  const lastState = (chatId: string) => of("vn_state").filter((message) => message.chatId === chatId).at(-1) as
    { config: VisualNovelConfig; characterScope?: CharacterConfigView | null } | undefined;
  const lastConfig = () => of("vn_config").at(-1) as { config: VisualNovelConfig; chatId?: string; characterScope?: CharacterConfigView | null } | undefined;
  registerVisualNovelBackend(spindle);
  return { spindle, data, sent, reply, request, record, of, turns, lastState, lastConfig };
}

async function stateOf(f: ReturnType<typeof fixture>, chatId: string, userId: string) {
  const before = f.of("vn_state").length;
  f.request({ type: "vn_get_state", chatId }, userId);
  await waitFor(() => f.of("vn_state").length > before);
  return f.lastState(chatId)!;
}

describe("controller: settings saved per character", () => {
  test("old saves: vn_state carries the shared config unchanged and an empty character layer", async () => {
    const f = fixture({ themePreset: "golden-hour" });
    const state = await stateOf(f, "chat-mira", "c1");
    expect(state.config.themePreset).toBe("golden-hour");
    expect(state.characterScope).toMatchObject({ chatId: "chat-mira", characterId: "card-mira", name: "Mira", overrides: {} });
    expect(state.characterScope!.shared).toEqual(state.config);
    // A chat without a character, and the home screen, offer no character scope.
    expect((await stateOf(f, "chat-group", "c1")).characterScope).toBeNull();
    expect((await stateOf(f, "", "c1")).characterScope).toBeNull();
    expect(f.data.has(CHARACTER_CONFIG_PATH)).toBe(false);
  });

  test("a save for one character changes only that character's chats; the shared config is untouched", async () => {
    const f = fixture({ themePreset: "golden-hour" });
    f.request({ type: "vn_set_config", patch: { themePreset: "midnight-noir", textScale: 1.3 }, chatId: "chat-mira", character: { characterId: "card-mira" } }, "c2");
    await waitFor(() => f.of("vn_config").length > 0);
    const answer = f.lastConfig()!;
    expect(answer.chatId).toBe("chat-mira");
    expect(answer.config.themePreset).toBe("midnight-noir");
    expect(answer.characterScope).toMatchObject({ characterId: "card-mira", overrides: { themePreset: "midnight-noir", textScale: 1.3 } });
    expect(answer.characterScope!.shared.themePreset).toBe("golden-hour");
    expect((f.data.get("config.json") as Record<string, unknown>).themePreset).toBe("golden-hour");
    // Every chat with that card follows; another card keeps the shared settings.
    expect((await stateOf(f, "chat-mira-2", "c2")).config.themePreset).toBe("midnight-noir");
    expect((await stateOf(f, "chat-theo", "c2")).config.themePreset).toBe("golden-hour");
    // A shared change still reaches the character for everything it does not set itself.
    f.request({ type: "vn_set_config", patch: { themePreset: "daylight", textSpeed: 45 }, chatId: "chat-mira" }, "c2");
    await waitFor(() => f.lastConfig()!.config.textSpeed === 45);
    expect(f.lastConfig()!.config.themePreset).toBe("midnight-noir");
    expect(f.lastConfig()!.characterScope!.shared.themePreset).toBe("daylight");
    expect((await stateOf(f, "chat-theo", "c2")).config.themePreset).toBe("daylight");
  });

  test("refused: a shared setting, another chat's character, or no character; the real layers come back first", async () => {
    const f = fixture();
    f.request({ type: "vn_set_config", patch: { imageConnectionId: "other" }, chatId: "chat-mira", character: { characterId: "card-mira" } }, "c3");
    await waitFor(() => f.of("vn_error").length === 1);
    expect(f.of("vn_error")[0]).toMatchObject({ operation: "vn_set_config" });
    expect(String(f.of("vn_error")[0]!.error)).toContain("imageConnectionId");
    expect(f.sent.findIndex((message) => message.type === "vn_config")).toBeLessThan(f.sent.findIndex((message) => message.type === "vn_error"));
    f.request({ type: "vn_set_config", patch: { themePreset: "daylight" }, chatId: "chat-mira", character: { characterId: "card-theo" } }, "c3");
    await waitFor(() => f.of("vn_error").length === 2);
    expect(String(f.of("vn_error")[1]!.error)).toContain("character changed");
    f.request({ type: "vn_set_config", patch: { themePreset: "daylight" }, chatId: "chat-group", character: { characterId: "card-mira" } }, "c3");
    await waitFor(() => f.of("vn_error").length === 3);
    f.request({ type: "vn_reset_character_config", chatId: "chat-mira", characterId: "card-mira", keys: ["parserConnectionId"] }, "c3");
    await waitFor(() => f.of("vn_error").length === 4);
    expect(f.of("vn_error")[3]).toMatchObject({ operation: "vn_reset_character_config" });
    expect(f.data.has(CHARACTER_CONFIG_PATH)).toBe(false);
    expect((f.data.get("config.json") as Record<string, unknown>).imageConnectionId).toBeUndefined();
  });

  test("Use shared: one setting, then all of them", async () => {
    const characters = { schemaVersion: 1, characters: { "card-mira": { name: "Mira", overrides: { themePreset: "midnight-noir", textScale: 1.3 }, updatedAt: "x" } } };
    const f = fixture({}, characters);
    f.request({ type: "vn_reset_character_config", chatId: "chat-mira", characterId: "card-mira", keys: ["themePreset"] }, "c4");
    await waitFor(() => f.of("vn_config").length === 1);
    expect(f.lastConfig()!.characterScope!.overrides).toEqual({ textScale: 1.3 });
    expect(f.lastConfig()!.config.themePreset).toBe("lumiverse");
    f.request({ type: "vn_reset_character_config", chatId: "chat-mira", characterId: "card-mira" }, "c4");
    await waitFor(() => f.of("vn_config").length === 2);
    expect(f.lastConfig()!.characterScope!.overrides).toEqual({});
    expect(f.lastConfig()!.config).toEqual(f.lastConfig()!.characterScope!.shared);
    expect((f.data.get(CHARACTER_CONFIG_PATH) as { characters: object }).characters).toEqual({});
  });

  test("sprite mode for one character: its replies are staged, another character's get scene pictures", async () => {
    const characters = { schemaVersion: 1, characters: { "card-mira": { name: "Mira", overrides: { presentationMode: "sprites" }, updatedAt: "x" } } };
    const f = fixture({ presentationMode: "scene" }, characters);
    f.request({ type: "vn_view", chatId: "chat-mira", open: true }, "c5");
    f.reply("chat-mira", "m1", "c5");
    await waitFor(() => f.turns().some((turn) => turn.chatId === "chat-mira"));
    const staged = f.record("chat-mira", "m1")!;
    expect(staged.jobs).toEqual([]);
    expect(staged.plan.spriteStaging?.paragraphs).toHaveLength(2);
    expect(f.turns().find((turn) => turn.chatId === "chat-mira")!.sprites).toBeDefined();
    await spriteService(f.spindle).settle("c5");

    f.request({ type: "vn_view", chatId: "chat-theo", open: true }, "c5");
    f.reply("chat-theo", "t1", "c5");
    await waitFor(() => (f.record("chat-theo", "t1")?.jobs.length ?? 0) > 0);
    expect(f.record("chat-theo", "t1")!.plan.spriteStaging).toBeUndefined();
    await waitFor(() => f.turns().some((turn) => turn.chatId === "chat-theo"));
    expect(f.turns().filter((turn) => turn.chatId === "chat-theo").every((turn) => turn.sprites === undefined)).toBe(true);
  });

  test("switching one character into sprite mode restages its open turn at once", async () => {
    const f = fixture({ presentationMode: "scene" });
    f.request({ type: "vn_view", chatId: "chat-mira", open: true }, "c6");
    f.reply("chat-mira", "m1", "c6");
    await waitFor(() => (f.record("chat-mira", "m1")?.jobs.length ?? 0) > 0);
    await waitFor(() => f.record("chat-mira", "m1")!.jobs.every((job) => job.status === "generated"));
    expect(f.turns().at(-1)!.sprites).toBeUndefined();
    f.request({ type: "vn_set_config", patch: { presentationMode: "sprites" }, chatId: "chat-mira", character: { characterId: "card-mira" } }, "c6");
    await waitFor(() => f.turns().some((turn) => turn.sprites !== undefined));
    expect(f.lastConfig()!.characterScope!.overrides).toEqual({ presentationMode: "sprites" });
    expect((f.data.get("config.json") as Record<string, unknown>).presentationMode).toBe("scene");
    await spriteService(f.spindle).settle("c6");
  });
});
