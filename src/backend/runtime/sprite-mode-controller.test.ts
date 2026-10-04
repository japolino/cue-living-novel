import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend, spriteService } from "./controller.js";
import { turnPath, type StoredTurnRecord } from "./storage.js";
import { SPRITE_LIBRARY_PATH, type SpriteLibrary } from "./sprites/library.js";
import { CUT_META, fakePng, toBase64, waitFor } from "./sprites/__fixtures__/sprite-fixtures.js";
import type { TurnView } from "../../protocol.js";

/**
 * Sprite mode through the controller: planning stages sprites instead of
 * scene-image jobs, vn_turn carries `sprites`, the library generates and the
 * frontend cuts. Scene mode stays exactly as before.
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

const settle = (ms = 40) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function fixture(config: Record<string, unknown> = {}, options: { gated?: boolean } = {}) {
  const gates: Array<() => void> = [];
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let frontend!: (payload: unknown, userId: string) => void;
  const data = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const prompts: string[] = [];
  const deleted: string[] = [];
  let plannerCalls = 0;
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
    chat: { getMessages: async (chatId: string) => messages.filter((m) => m.chat_id === chatId) },
    generate: {
      raw: async () => {
        plannerCalls += 1;
        return { content: JSON.stringify(plannerPayload()) };
      }
    },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async (input: { prompt: string }) => {
        prompts.push(input.prompt);
        seq += 1;
        const result = { imageId: `img-${seq}`, imageUrl: `/api/v1/images/img-${seq}` };
        if (!options.gated) return result;
        return new Promise((resolve) => gates.push(() => resolve(result)));
      }
    },
    images: {
      upload: async () => { seq += 1; return { id: `cut-${seq}`, url: `/api/v1/images/cut-${seq}` }; },
      delete: async (id: string) => { deleted.push(id); return true; },
      get: async (id: string) => ({ id })
    },
    sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); },
    log: { warn() {}, error() {}, info() {} }
  } as unknown as SpindleAPI;
  const fire = (event: string, ...args: unknown[]) => {
    for (const handler of handlers.get(event) ?? []) handler(...args);
  };
  const addReply = (chatId: string, id: string) => {
    messages.push({
      id, chat_id: chatId, content: CONTENT, is_user: false, name: "Mira", swipe_id: 0,
      swipes: [CONTENT], swipe_dates: [1], extra: {}, parent_message_id: null, branch_id: null,
      created_at: messages.length, index_in_chat: messages.length, send_date: 1
    });
  };
  const reply = (chatId: string, id: string, userId: string) => {
    addReply(chatId, id);
    fire("GENERATION_ENDED", { chatId, messageId: id, content: CONTENT }, userId);
  };
  const request = (payload: unknown, userId: string) => frontend(payload, userId);
  const record = (chatId: string, id: string) => data.get(turnPath(chatId, id, 0)) as StoredTurnRecord | undefined;
  const library = () => data.get(SPRITE_LIBRARY_PATH) as SpriteLibrary | undefined;
  const of = (type: string) => sent.filter((message) => message.type === type);
  const turns = () => of("vn_turn").map((message) => message.turn as TurnView);
  registerVisualNovelBackend(spindle);
  return { spindle, data, sent, prompts, deleted, gates, fire, reply, addReply, request, record, library, of, turns, plannerCalls: () => plannerCalls };
}

const isSpritePrompt = (prompt: string) => prompt.includes("white background");
const isScenePrompt = (prompt: string) => !prompt.includes("white background") && !prompt.includes("no humans");

describe("controller: sprite mode", () => {
  test("a reply is staged: no scene jobs, staging saved, vn_turn carries sprites, the library generates and cuts", async () => {
    const f = fixture({ presentationMode: "sprites" });
    f.request({ type: "vn_view", chatId: "sp-1", open: true }, "u1");
    f.reply("sp-1", "m1", "u1");
    await waitFor(() => f.turns().length > 0);
    await waitFor(() => f.of("vn_sprite_cut").length > 0);
    const stored = f.record("sp-1", "m1")!;
    expect(stored.jobs).toEqual([]);
    expect(stored.plan.spriteStaging?.paragraphs).toHaveLength(2);
    expect(stored.plan.spriteStaging?.cast.map((member) => member.name)).toContain("Mira");
    const turn = f.turns().at(-1)!;
    expect(turn.assets).toEqual([]);
    expect(turn.sprites?.staging).toEqual(stored.plan.spriteStaging!);
    const mira = stored.plan.spriteStaging!.cast.find((member) => member.name === "Mira")!;
    expect(turn.sprites?.sets[mira.characterKey]?.name).toBe("Mira");
    expect(Object.keys(turn.sprites?.sets[mira.characterKey]?.expressions ?? {})).toContain("idle");
    for (const plateKey of stored.plan.spriteStaging!.plates.map((plate) => plate.plateKey)) expect(turn.sprites?.plates[plateKey]).toBeDefined();
    // Only sprite and plate prompts reach the provider.
    await waitFor(() => f.prompts.length >= 12);
    expect(f.prompts.every((prompt) => !isScenePrompt(prompt))).toBe(true);
    expect(f.prompts.some(isSpritePrompt)).toBe(true);
    expect(f.of("vn_asset")).toHaveLength(0);
    // The frontend answers a cut: the sprite becomes ready and is broadcast.
    const cut = f.of("vn_sprite_cut")[0] as { requestId: string; setKey: string; expression: string };
    f.request({ type: "vn_sprite_cut_result", requestId: cut.requestId, chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(fakePng()), meta: CUT_META }, "u1");
    await waitFor(() => f.of("vn_sprite_update").some((message) => (message.image as { status: string }).status === "ready"));
    await waitFor(() => f.library()?.sets[cut.setKey]?.images[cut.expression]?.status === "ready");
    const update = f.of("vn_sprite_update").find((message) => (message.image as { status: string }).status === "ready")!;
    expect(update).toMatchObject({ setKey: cut.setKey, image: { expression: cut.expression, status: "ready", bbox: CUT_META.bbox } });
    await spriteService(f.spindle).settle("u1");
  });

  test("a stored scene-mode turn gets staging lazily when sprite mode is switched on", async () => {
    const f = fixture({ presentationMode: "scene" });
    f.request({ type: "vn_view", chatId: "sp-2", open: true }, "u2");
    f.reply("sp-2", "m1", "u2");
    await waitFor(() => (f.record("sp-2", "m1")?.jobs.length ?? 0) > 0);
    await waitFor(() => f.record("sp-2", "m1")!.jobs.every((job) => job.status === "generated"));
    expect(f.record("sp-2", "m1")!.plan.spriteStaging).toBeUndefined();
    expect(f.turns().at(-1)!.sprites).toBeUndefined();
    const planner = f.plannerCalls();
    f.request({ type: "vn_set_config", patch: { presentationMode: "sprites" }, chatId: "sp-2" }, "u2");
    await waitFor(() => f.turns().some((turn) => turn.sprites !== undefined));
    const turn = f.turns().at(-1)!;
    expect(turn.sprites!.staging.paragraphs).toHaveLength(2);
    expect(f.record("sp-2", "m1")!.plan.spriteStaging).toEqual(turn.sprites!.staging);
    expect(f.plannerCalls()).toBe(planner);
    // A later state request reuses the stored staging (no replan).
    f.request({ type: "vn_get_state", chatId: "sp-2", viewOpen: true }, "u2");
    await waitFor(() => f.of("vn_state").length > 0);
    const state = f.of("vn_state").at(-1)!.turn as TurnView;
    expect(state.sprites?.staging).toEqual(turn.sprites!.staging);
    expect(f.plannerCalls()).toBe(planner);
    await spriteService(f.spindle).settle("u2");
  });

  test("Retry in sprite mode re-queues failed sprites instead of replanning", async () => {
    const f = fixture({ presentationMode: "sprites" });
    f.request({ type: "vn_view", chatId: "sp-3", open: true }, "u3");
    f.reply("sp-3", "m1", "u3");
    await waitFor(() => f.turns().length > 0);
    await spriteService(f.spindle).settle("u3");
    const planner = f.plannerCalls();
    const turns = f.turns().length;
    f.request({ type: "vn_retry_turn", chatId: "sp-3", messageId: "m1" }, "u3");
    await waitFor(() => f.turns().length > turns);
    expect(f.plannerCalls()).toBe(planner);
    expect(f.turns().at(-1)!.sprites).toBeDefined();
  });

  test("library requests and actions answer with vn_sprite_library; a failed action also reports vn_error", async () => {
    const f = fixture({ presentationMode: "sprites" });
    f.request({ type: "vn_get_sprite_library" }, "u4");
    await waitFor(() => f.of("vn_sprite_library").length === 1);
    expect(f.of("vn_sprite_library")[0]).toEqual({ type: "vn_sprite_library", sets: [], plates: [] });
    f.request({ type: "vn_sprite_action", action: "recut", setKey: "set_missing", expression: "idle" }, "u4");
    await waitFor(() => f.of("vn_error").length === 1);
    expect(f.of("vn_sprite_library")).toHaveLength(2);
    expect(f.of("vn_error")[0]).toMatchObject({ operation: "vn_sprite_action", error: "This sprite set is no longer in the library." });
  });

  test("prepare_chat uses the chat's registry characters", async () => {
    const f = fixture({ presentationMode: "sprites" });
    f.request({ type: "vn_view", chatId: "sp-5", open: true }, "u5");
    f.reply("sp-5", "m1", "u5");
    await waitFor(() => f.turns().length > 0);
    f.request({ type: "vn_sprite_action", action: "prepare_chat", chatId: "sp-5" }, "u5");
    await waitFor(() => f.of("vn_sprite_library").length > 0);
    const library = f.of("vn_sprite_library").at(-1) as { sets: Array<{ name: string }> };
    expect(library.sets.map((set) => set.name)).toContain("Mira");
    await spriteService(f.spindle).settle("u5");
  });

  test("closing the view pauses sprite generation; reopening resumes it", async () => {
    const f = fixture({ presentationMode: "sprites", imageConcurrency: 1 }, { gated: true });
    f.request({ type: "vn_view", chatId: "sp-6", open: true }, "u6");
    f.reply("sp-6", "m1", "u6");
    await waitFor(() => f.gates.length >= 1);
    f.request({ type: "vn_view", chatId: "sp-6", open: false }, "u6");
    // The running render still lands (and is kept); nothing new starts.
    f.gates[0]!();
    await spriteService(f.spindle).settle("u6");
    const paused = f.prompts.length;
    await settle(30);
    expect(f.prompts.length).toBe(paused);
    expect(Object.values(f.library()!.sets).some((set) => Object.values(set.images).some((image) => image.status === "queued"))).toBe(true);
    f.request({ type: "vn_view", chatId: "sp-6", open: true }, "u6");
    await waitFor(() => f.prompts.length > paused);
    expect(f.prompts.length).toBe(paused + 1);
  });
});

describe("controller: scene mode is unchanged", () => {
  test("no staging, no sprites, scene jobs as before, no sprite traffic", async () => {
    const f = fixture();
    f.request({ type: "vn_view", chatId: "sc-1", open: true }, "u7");
    f.reply("sc-1", "m1", "u7");
    await waitFor(() => (f.record("sc-1", "m1")?.jobs.length ?? 0) > 0);
    await waitFor(() => f.record("sc-1", "m1")!.jobs.every((job) => job.status === "generated"));
    const stored = f.record("sc-1", "m1")!;
    expect(stored.plan.spriteStaging).toBeUndefined();
    expect(f.turns().every((turn) => turn.sprites === undefined)).toBe(true);
    expect(f.prompts.every(isScenePrompt)).toBe(true);
    expect(f.library()).toBeUndefined();
    expect(f.of("vn_sprite_update")).toHaveLength(0);
    expect(f.of("vn_sprite_cut")).toHaveLength(0);
  });
});
