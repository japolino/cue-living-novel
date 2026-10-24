import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend } from "./controller.js";
import { turnPath, type StoredTurnRecord } from "./storage.js";

/**
 * Cancelled planning frees the chat's planning queue at once: the planner
 * request is aborted (and rejected locally even when the host ignores the
 * signal), a reopened view plans again instead of joining the cancelled plan,
 * and a newer version of the message replaces the plan of the old one.
 */

const FIRST = "First paragraph.\n\nSecond paragraph.";
const SECOND = "Another swipe opens.\n\nIt ends here.";

function plannerPayload() {
  return {
    scenes: [{
      startParagraph: 0,
      boundary: { claimedNewScene: true, reason: "initial", location: "Observatory", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
      environment: { location: "Observatory", timeOfDay: "night", weather: null, lighting: "lantern light", description: "An old observatory", persistentElements: [] },
      cast: ["Mira"],
      basePrompt: "old observatory",
      compositionLock: "Mira centered"
    }],
    cues: [{ paragraphIndex: 0 }],
    choices: [],
    characters: [{ name: "Mira", description: "silver hair, green eyes" }]
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function fixture() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let frontend!: (payload: unknown, userId: string) => void;
  const data = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  // Planner calls park until the test releases them; the fake host ignores the signal.
  const planner: Array<{ content: string; signal?: AbortSignal; release: () => void }> = [];
  data.set("config.json", {
    generateImages: false,
    includeCharacterContext: false,
    includePersonaContext: false,
    includeLorebookContext: false
  });
  const spindle = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    onFrontendMessage: (fn: (payload: unknown, userId: string) => void) => { frontend = fn; },
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown }) => data.get(path) ?? readOptions.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    },
    chat: { getMessages: async (chatId: string) => messages.filter((m) => m.chat_id === chatId).map((m) => ({ ...m })) },
    generate: {
      raw: (request: { messages: Array<{ content: string }>; signal?: AbortSignal }) => new Promise((resolve) => {
        planner.push({
          content: request.messages.at(-1)?.content ?? "",
          ...(request.signal ? { signal: request.signal } : {}),
          release: () => resolve({ content: JSON.stringify(plannerPayload()) })
        });
      })
    },
    sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); },
    log: { warn() {}, error() {}, info() {} }
  } as unknown as SpindleAPI;
  const fire = (event: string, ...args: unknown[]) => {
    for (const handler of handlers.get(event) ?? []) handler(...args);
  };
  registerVisualNovelBackend(spindle);
  const message = (chatId: string, content: string, swipeId = 0) => ({
    id: "m1", chat_id: chatId, content, is_user: false, name: "Mira", swipe_id: swipeId,
    swipes: swipeId ? [FIRST, content] : [content], swipe_dates: [1], extra: {}, parent_message_id: null, branch_id: null,
    created_at: 1, index_in_chat: 1, send_date: 1
  });
  return {
    fire, sent, planner, messages, message,
    request: (payload: unknown, userId: string) => frontend(payload, userId),
    record: (chatId: string, swipeId = 0) => data.get(turnPath(chatId, "m1", swipeId)) as StoredTurnRecord | undefined,
    turns: () => sent.filter((m) => m.type === "vn_turn").map((m) => m.turn as { swipeId: number; paragraphs: string[] })
  };
}

describe("cancelled planning frees the queue", () => {
  test("reopening the view while a turn plans plans it again (it never joins the cancelled plan)", async () => {
    const f = fixture();
    f.request({ type: "vn_view", chatId: "pc-reopen", open: true }, "user-pc1");
    f.messages.push(f.message("pc-reopen", FIRST));
    f.fire("GENERATION_ENDED", { chatId: "pc-reopen", messageId: "m1", content: FIRST }, "user-pc1");
    await waitFor(() => f.planner.length === 1);
    expect(f.planner[0]?.signal).toBeDefined();

    f.request({ type: "vn_view", chatId: "pc-reopen", open: false }, "user-pc1");
    expect(f.planner[0]?.signal?.aborted).toBe(true);
    f.request({ type: "vn_get_state", chatId: "pc-reopen", viewOpen: true }, "user-pc1");
    // The new plan starts while the cancelled request is still parked on the host.
    await waitFor(() => f.planner.length === 2);
    f.planner[1]!.release();
    await waitFor(() => f.turns().length === 1);
    expect(f.record("pc-reopen")?.status).toBe("ready");
    // The cancelled request finishing late changes nothing.
    f.planner[0]!.release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(f.turns()).toHaveLength(1);
  });

  test("swiping while the old swipe plans replaces that plan instead of queueing behind it", async () => {
    const f = fixture();
    f.request({ type: "vn_view", chatId: "pc-swipe", open: true }, "user-pc2");
    f.messages.push(f.message("pc-swipe", FIRST));
    f.fire("GENERATION_ENDED", { chatId: "pc-swipe", messageId: "m1", content: FIRST }, "user-pc2");
    await waitFor(() => f.planner.length === 1);

    const swiped = f.message("pc-swipe", SECOND, 1);
    f.messages.splice(0, 1, swiped);
    f.fire("MESSAGE_SWIPED", { chatId: "pc-swipe", message: swiped }, "user-pc2");
    await waitFor(() => f.planner.length === 2);
    expect(f.planner[0]?.signal?.aborted).toBe(true);
    expect(f.planner[1]?.content).toContain("Another swipe opens.");
    f.planner[1]!.release();
    f.planner[0]!.release();
    await waitFor(() => f.turns().length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Only the new swipe is shown; the old swipe's plan never paints.
    expect(f.turns().map((turn) => turn.swipeId)).toEqual([1]);
    expect(f.record("pc-swipe", 0)).toBeUndefined();
  });
});
