import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend, spriteService } from "./controller.js";
import { turnPath, type StoredTurnRecord } from "./storage.js";
import { SPRITE_LIBRARY_PATH, type SpriteLibrary } from "./sprites/library.js";
import { waitFor } from "./sprites/__fixtures__/sprite-fixtures.js";
import type { TurnView } from "../../protocol.js";

/**
 * Key-moment illustrations in sprite mode (config keyIllustrations): the
 * flagged paragraph's cue runs the ordinary scene-image job, and the turn's
 * sprite view carries the finished picture. "off" and scene mode unchanged.
 */

const CONTENT = "Mira smiled at the stars.\n\nMira kisses Kai on the cheek.";

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
    cues: [{ paragraphIndex: 0, character: "Mira", poseExpressionId: "smile" }, { paragraphIndex: 1, character: "Mira", poseExpressionId: "embarrassed" }],
    paragraphSpeakers: [null, null],
    choices: [],
    characters: [{ name: "Mira", description: "1girl, silver hair, green eyes" }]
  };
}

const isScenePrompt = (prompt: string) => !prompt.includes("white background") && !prompt.includes("no humans");

const settle = (ms = 40) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function fixture(config: Record<string, unknown> = {}, options: { gated?: boolean; failScenes?: () => boolean } = {}) {
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
        if (isScenePrompt(input.prompt) && options.failScenes?.()) throw new Error("provider down");
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



const illustrations = (turn: TurnView | undefined) => turn?.sprites?.illustrations ?? [];

describe("controller: key illustrations in sprite mode", () => {
  test("few: one scene-image job for the flagged paragraph; the sprite view gets the finished picture", async () => {
    const f = fixture({ presentationMode: "sprites", keyIllustrations: "few" });
    f.request({ type: "vn_view", chatId: "km-1", open: true }, "k1");
    f.reply("km-1", "m1", "k1");
    await waitFor(() => f.turns().length > 0);
    const stored = f.record("km-1", "m1")!;
    expect(stored.plan.spriteStaging!.paragraphs.map((stage) => stage.illustrate === true)).toEqual([false, true]);
    expect(stored.jobs.map((job) => job.paragraphIndex)).toEqual([1]);
    expect(stored.settingsSnapshot?.presentationMode).toBe("sprites");
    expect(illustrations(f.turns()[0]).map((view) => [view.paragraphIndex, view.status])).toEqual([[1, "pending"]]);
    await waitFor(() => illustrations(f.turns().at(-1)).some((view) => view.status === "ready"));
    const ready = illustrations(f.turns().at(-1))[0]!;
    expect(ready).toMatchObject({ paragraphIndex: 1, status: "ready" });
    expect(ready.url).toMatch(/^\/api\/v1\/images\/img-\d+$/);
    // Exactly one scene prompt reached the provider; the rest are sprites and plates.
    expect(f.prompts.filter(isScenePrompt)).toHaveLength(1);
    expect(f.of("vn_asset").map((message) => (message.asset as { paragraphIndex: number }).paragraphIndex)).toContain(1);
    // The same picture is in TurnView.assets (the existing scene-image channel).
    expect(f.turns().at(-1)!.assets.find((asset) => asset.paragraphIndex === 1)?.imageUrl).toBe(ready.url);
    await spriteService(f.spindle).settle("k1");
  });

  test("off (the default): no scene-image job and no illustration", async () => {
    const f = fixture({ presentationMode: "sprites" });
    f.request({ type: "vn_view", chatId: "km-2", open: true }, "k2");
    f.reply("km-2", "m1", "k2");
    await waitFor(() => f.turns().length > 0);
    await spriteService(f.spindle).settle("k2");
    const stored = f.record("km-2", "m1")!;
    expect(stored.jobs).toEqual([]);
    expect(stored.plan.spriteStaging!.paragraphs.every((stage) => stage.illustrate === undefined)).toBe(true);
    expect(f.prompts.filter(isScenePrompt)).toHaveLength(0);
    expect(f.turns().every((turn) => turn.sprites?.illustrations === undefined)).toBe(true);
  });

  test("a failed illustration is reported in the view; Retry regenerates it without replanning", async () => {
    let fail = true;
    const f = fixture({ presentationMode: "sprites", keyIllustrations: "few" }, { failScenes: () => fail });
    f.request({ type: "vn_view", chatId: "km-3", open: true }, "k3");
    f.reply("km-3", "m1", "k3");
    await waitFor(() => illustrations(f.turns().at(-1)).some((view) => view.status === "failed"));
    expect(f.record("km-3", "m1")!.jobs[0]!.status).toBe("failed");
    const planner = f.plannerCalls();
    fail = false;
    f.request({ type: "vn_retry_turn", chatId: "km-3", messageId: "m1" }, "k3");
    await waitFor(() => illustrations(f.turns().at(-1)).some((view) => view.status === "ready"));
    expect(f.plannerCalls()).toBe(planner);
    expect(f.record("km-3", "m1")!.jobs.map((job) => job.status)).toEqual(["generated"]);
    expect(f.prompts.filter(isScenePrompt)).toHaveLength(2);
    await spriteService(f.spindle).settle("k3");
  });

  test("a view closed mid-render cancels the illustration; the next reuse of the turn resumes it", async () => {
    const f = fixture({ presentationMode: "sprites", keyIllustrations: "few", imageConcurrency: 1 }, { gated: true });
    f.request({ type: "vn_view", chatId: "km-4", open: true }, "k4");
    f.reply("km-4", "m1", "k4");
    await waitFor(() => (f.record("km-4", "m1")?.jobs.length ?? 0) === 1);
    f.request({ type: "vn_view", chatId: "km-4", open: false }, "k4");
    await waitFor(() => f.record("km-4", "m1")!.jobs[0]!.status === "cancelled");
    for (const gate of f.gates) gate();
    f.request({ type: "vn_view", chatId: "km-4", open: true }, "k4");
    const planner = f.plannerCalls();
    const scenePrompts = f.prompts.filter(isScenePrompt).length;
    // The same reply is processed again (an edit/swipe reconcile): reused, not replanned.
    f.fire("GENERATION_ENDED", { chatId: "km-4", messageId: "m1", content: CONTENT }, "k4");
    await waitFor(() => f.prompts.filter(isScenePrompt).length > scenePrompts, 2000);
    expect(f.plannerCalls()).toBe(planner);
    expect(["queued", "generating"]).toContain(f.record("km-4", "m1")!.jobs[0]!.status);
    let released = 0;
    await waitFor(() => {
      for (const gate of f.gates.slice(released)) gate();
      released = f.gates.length;
      return f.record("km-4", "m1")!.jobs[0]!.status === "generated";
    }, 4000);
  });

  test("switching back to scene mode replans a sprite-planned turn even though it has jobs", async () => {
    const f = fixture({ presentationMode: "sprites", keyIllustrations: "few" });
    f.request({ type: "vn_view", chatId: "km-5", open: true }, "k5");
    f.reply("km-5", "m1", "k5");
    await waitFor(() => f.record("km-5", "m1")?.jobs[0]?.status === "generated");
    await spriteService(f.spindle).settle("k5");
    const planner = f.plannerCalls();
    f.request({ type: "vn_set_config", patch: { presentationMode: "scene" } }, "k5");
    await waitFor(() => f.of("vn_config").length > 0);
    f.fire("GENERATION_ENDED", { chatId: "km-5", messageId: "m1", content: CONTENT }, "k5");
    await waitFor(() => f.plannerCalls() > planner);
    await waitFor(() => (f.record("km-5", "m1")?.jobs.length ?? 0) === 2 && f.record("km-5", "m1")!.plan.spriteStaging === undefined);
    expect(f.record("km-5", "m1")!.settingsSnapshot?.presentationMode).toBeUndefined();
  });
});

describe("controller: scene mode ignores keyIllustrations", () => {
  test("scene mode with few: scene jobs as before, no staging, no sprites", async () => {
    const f = fixture({ keyIllustrations: "few" });
    f.request({ type: "vn_view", chatId: "km-6", open: true }, "k6");
    f.reply("km-6", "m1", "k6");
    await waitFor(() => (f.record("km-6", "m1")?.jobs.length ?? 0) > 0);
    await waitFor(() => f.record("km-6", "m1")!.jobs.every((job) => job.status === "generated"));
    const stored = f.record("km-6", "m1")!;
    expect(stored.jobs).toHaveLength(2);
    expect(stored.plan.spriteStaging).toBeUndefined();
    expect(stored.settingsSnapshot?.presentationMode).toBeUndefined();
    expect(f.turns().every((turn) => turn.sprites === undefined)).toBe(true);
    expect(f.library()).toBeUndefined();
  });
});
