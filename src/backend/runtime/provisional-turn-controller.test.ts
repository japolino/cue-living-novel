import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import type { TurnView } from "../../protocol.js";
import { STORY_CHECK_SYSTEM } from "../core/non-story.js";
import { registerVisualNovelBackend } from "./controller.js";
import { chatStatePath, turnPath, type StoredTurnRecord } from "./storage.js";
import { isPlannedTurn, isProvisionalTurn } from "./__fixtures__/turns.js";

/**
 * The reply's text reaches the stage before the visual planner returns (a
 * provisional vn_turn with the planned turn's fingerprint). It is never the
 * chat's active turn, waits for the non-story line check, comes again for a
 * view that reopens during planning, and gives way to another swipe.
 */

const REPLY = "The rain taps the window.\n\nWord count: 312. Next, Mira should reveal the map.\n\n\"Over here,\" Mira says.";
const STORY = ["The rain taps the window.", "\"Over here,\" Mira says."];
const SWIPE = "Thunder rolls.\n\nMira: Stay inside.";

function plannerPayload() {
  return {
    scenes: [{
      startParagraph: 0,
      boundary: { claimedNewScene: true, reason: "initial", location: "Observatory", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
      environment: { location: "Observatory", timeOfDay: "night", weather: "rain", lighting: "lantern light", description: "An old observatory", persistentElements: [] },
      cast: ["Mira"],
    }],
    cues: [{ paragraphIndex: 0 }],
    speakers: { "0": "Narrator", "1": "Mira" },
    choices: [],
    characters: [{ name: "Mira", description: "silver hair, green eyes" }],
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
const settle = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Parked = { release: () => void; signal?: AbortSignal };

function fixture(config: Record<string, unknown> = {}) {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let frontend!: (payload: unknown, userId: string) => void;
  const data = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  // Planner calls and line checks both park until the test releases them.
  const planner: Parked[] = [];
  const checks: Parked[] = [];
  data.set("config.json", { generateImages: false, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false, ...config });
  const spindle = {
    on: (event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    onFrontendMessage: (fn: (payload: unknown, userId: string) => void) => { frontend = fn; },
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); },
    },
    chat: { getMessages: async (chatId: string) => messages.filter((m) => m.chat_id === chatId).map((m) => ({ ...m })) },
    generate: {
      raw: (request: { messages: Array<{ content: string }>; signal?: AbortSignal }) => new Promise((resolve) => {
        const signal = request.signal ? { signal: request.signal } : {};
        if (request.messages[0]?.content === STORY_CHECK_SYSTEM) {
          // "Word count" lines are not story; every other line is.
          const rows = [...String(request.messages[1]?.content ?? "").matchAll(/^(\d+): (.*)$/gm)];
          checks.push({ ...signal, release: () => resolve({ content: rows.map(([, index, line]) => `${index} ${/word count/i.test(line!) ? "S" : "K"}`).join("\n") }) });
          return;
        }
        planner.push({ ...signal, release: () => resolve({ content: JSON.stringify(plannerPayload()) }) });
      }),
    },
    sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); },
    log: { warn() {}, error() {}, info() {} },
  } as unknown as SpindleAPI;
  const fire = (event: string, ...args: unknown[]) => { for (const handler of handlers.get(event) ?? []) handler(...args); };
  registerVisualNovelBackend(spindle);
  const message = (chatId: string, content: string, swipeId = 0) => ({
    id: "m1", chat_id: chatId, content, is_user: false, name: "Mira", swipe_id: swipeId, swipes: swipeId ? [REPLY, content] : [content],
    swipe_dates: [1], extra: {}, parent_message_id: null, branch_id: null, created_at: 1, index_in_chat: 1, send_date: 1,
  });
  return {
    fire, sent, planner, checks, messages, data,
    request: (payload: unknown, userId: string) => frontend(payload, userId),
    reply: (chatId: string, userId: string, content = REPLY) => {
      messages.splice(0, messages.length, message(chatId, content));
      fire("GENERATION_ENDED", { chatId, messageId: "m1", content }, userId);
    },
    swipe: (chatId: string, userId: string, content: string, swipeId: number) => {
      const swiped = message(chatId, content, swipeId);
      messages.splice(0, messages.length, swiped);
      fire("MESSAGE_SWIPED", { chatId, message: swiped }, userId);
    },
    provisionals: () => sent.filter(isProvisionalTurn).map((m) => m.turn as TurnView),
    planned: () => sent.filter(isPlannedTurn).map((m) => m.turn as TurnView),
    record: (chatId: string, swipeId = 0) => data.get(turnPath(chatId, "m1", swipeId)) as StoredTurnRecord | undefined,
    activePath: (chatId: string) => (data.get(chatStatePath(chatId)) as { activeTurnPath?: string | null } | undefined)?.activeTurnPath,
  };
}

describe("provisional turn (text before the plan)", () => {
  test("the text shows before the planner returns, after the line check, and is never stored", async () => {
    const f = fixture();
    const chat = "pt-basic";
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pt1");
    f.reply(chat, "user-pt1");
    await waitFor(() => f.planner.length === 1 && f.checks.length === 1);
    await settle();
    // Lines the check may still remove are never shown: nothing until it answers.
    expect(f.provisionals()).toHaveLength(0);

    f.checks[0]!.release();
    await waitFor(() => f.provisionals().length === 1);
    const early = f.provisionals()[0]!;
    expect(early).toMatchObject({ status: "planning", provisional: true, messageId: "m1", choices: [], assets: [] });
    expect(early.paragraphs).toEqual(STORY);
    expect(early.paragraphSpeakers).toEqual(["", "Mira"]);
    expect(early.effects).toBeUndefined();
    // Not the chat's active turn, not stored.
    expect(f.record(chat)).toBeUndefined();
    expect(f.activePath(chat)).toBeUndefined();

    f.planner[0]!.release();
    await waitFor(() => f.planned().length === 1);
    const planned = f.planned()[0]!;
    expect(planned.sourceFingerprint).toBe(early.sourceFingerprint);
    expect(planned.paragraphs).toEqual(early.paragraphs);
    expect(planned.status).toBe("ready");
    expect(f.record(chat)?.plan.paragraphs.map((paragraph) => paragraph.text)).toEqual(STORY);
    const order = f.sent.filter((m) => m.type === "vn_turn" || m.type === "vn_turn_text").map((m) => m.type);
    expect(order).toEqual(["vn_turn_text", "vn_turn"]);
  });

  test("an older frontend, which reads only vn_turn, never sees the text before the plan", async () => {
    const f = fixture({ skipNonStory: false });
    const chat = "pt-old-frontend";
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pt6");
    f.reply(chat, "user-pt6");
    await waitFor(() => f.provisionals().length === 1);
    // A reloaded page joins the plan in flight: the text comes again, under its own type.
    f.request({ type: "vn_get_state", chatId: chat, viewOpen: true }, "user-pt6");
    await waitFor(() => f.provisionals().length === 2);
    f.planner[0]!.release();
    await waitFor(() => f.planned().length === 1);
    const turns = f.sent.filter((m) => m.type === "vn_turn").map((m) => m.turn as TurnView);
    expect(turns).toHaveLength(1);
    expect(turns.every((turn) => !turn.provisional && turn.status === "ready")).toBe(true);
    expect(f.sent.filter((m) => m.type === "vn_turn_text")).toHaveLength(2);
  });

  test("without Skip non-story blocks the text goes out at once, every line kept", async () => {
    const f = fixture({ skipNonStory: false });
    const chat = "pt-off";
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pt2");
    f.reply(chat, "user-pt2");
    await waitFor(() => f.provisionals().length === 1);
    expect(f.planner).toHaveLength(1);
    expect(f.checks).toHaveLength(0);
    expect(f.provisionals()[0]!.paragraphs).toHaveLength(3);
    f.planner[0]!.release();
    await waitFor(() => f.planned().length === 1);
    expect(f.planned()[0]!.paragraphs).toEqual(f.provisionals()[0]!.paragraphs);
  });

  test("a view closed and reopened during planning gets the text again from the check's cache", async () => {
    const f = fixture();
    const chat = "pt-reopen";
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pt3");
    f.reply(chat, "user-pt3");
    await waitFor(() => f.checks.length === 1);
    f.checks[0]!.release();
    await waitFor(() => f.provisionals().length === 1);

    f.request({ type: "vn_view", chatId: chat, open: false }, "user-pt3");
    f.request({ type: "vn_get_state", chatId: chat, viewOpen: true }, "user-pt3");
    await waitFor(() => f.provisionals().length === 2);
    // Cached labels: no second check, and the planner of the new plan has not answered.
    expect(f.checks).toHaveLength(1);
    expect(f.planned()).toHaveLength(0);
    expect(f.provisionals()[1]!.paragraphs).toEqual(STORY);
    const state = f.sent.filter((m) => m.type === "vn_state").at(-1) as { turn: unknown };
    expect(state.turn).toBeNull();
    for (const call of f.planner) call.release();
    await waitFor(() => f.planned().length === 1);
    await settle();
    expect(f.planned()).toHaveLength(1);
  });

  test("a reloaded page that joins the plan in flight gets the same text again", async () => {
    const f = fixture();
    const chat = "pt-reload";
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pt4");
    f.reply(chat, "user-pt4");
    await waitFor(() => f.checks.length === 1);
    f.checks[0]!.release();
    await waitFor(() => f.provisionals().length === 1);

    // The view stays open: the new page's state request joins the running plan.
    const before = f.sent.length;
    f.request({ type: "vn_get_state", chatId: chat, viewOpen: true }, "user-pt4");
    await waitFor(() => f.provisionals().length === 2);
    expect(f.sent.slice(before).map((m) => m.type)).toEqual(["vn_state", "vn_planning", "vn_turn_text"]);
    expect(f.provisionals()[1]).toEqual(f.provisionals()[0]!);
    expect(f.planner).toHaveLength(1);
    f.planner[0]!.release();
    await waitFor(() => f.planned().length === 1);
    // Once the plan is in, nothing provisional comes again.
    f.request({ type: "vn_get_state", chatId: chat, viewOpen: true }, "user-pt4");
    await settle();
    expect(f.provisionals()).toHaveLength(2);
  });

  test("a swipe replaces the provisional turn; the old swipe never paints again", async () => {
    const f = fixture();
    const chat = "pt-swipe";
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pt5");
    f.reply(chat, "user-pt5");
    await waitFor(() => f.checks.length === 1);
    f.checks[0]!.release();
    await waitFor(() => f.provisionals().length === 1);
    const afterFirst = f.sent.length;

    f.swipe(chat, "user-pt5", SWIPE, 1);
    await waitFor(() => f.checks.length === 2);
    f.checks[1]!.release();
    await waitFor(() => f.provisionals().length === 2);
    expect(f.planner[0]?.signal?.aborted).toBe(true);
    const swiped = f.provisionals()[1]!;
    expect(swiped.swipeId).toBe(1);
    expect(swiped.paragraphSpeakers).toEqual(["", "Mira"]);
    expect(swiped.sourceFingerprint).not.toBe(f.provisionals()[0]!.sourceFingerprint);

    for (const call of f.planner) call.release();
    await waitFor(() => f.planned().length === 1);
    await settle(60);
    const later = f.sent.slice(afterFirst).filter((m) => m.type === "vn_turn" || m.type === "vn_turn_text").map((m) => m.turn as TurnView);
    expect(later.every((turn) => turn.swipeId === 1)).toBe(true);
    expect(f.planned().map((turn) => turn.swipeId)).toEqual([1]);
    expect(f.record(chat, 0)).toBeUndefined();
  });
});
