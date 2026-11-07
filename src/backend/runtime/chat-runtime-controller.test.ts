import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend } from "./controller.js";
import { chatStatePath, turnPath, type StoredChatState, type StoredTurnRecord } from "./storage.js";
import { storyCheckReply } from "./__fixtures__/story-check";
import { isPlannedTurn } from "./__fixtures__/turns.js";

/**
 * The chat's turn owner and its asset batch move only together (ChatRuntime):
 * - (c) a turn that takes the chat back from storage stops the batch of the
 *   turn it replaces, so nobody pays for pictures no turn will show;
 * - (d) a cancel or a new generation that lands while a batch is still
 *   starting stops it before its first request.
 */

const A = "Aurelia lowers the report.\n\nShe studies the visitor.\n\nThe hall is silent.";
const B = "Aurelia turns to the window.\n\nRain runs down the glass.\n\nShe does not answer.";
const MACRO = "{{getvar::mood}}Aurelia lowers the report.\n\nShe studies the visitor.\n\nThe hall is silent.";

function plannerPayload() {
  return {
    scenes: [{
      startParagraph: 0,
      boundary: { claimedNewScene: true, reason: "initial", location: "Sol Eterna", timeOfDay: "day", majorTimeJump: false, environmentReplacement: false, forced: false },
      environment: { location: "Sol Eterna", timeOfDay: "day", weather: null, lighting: "sunlight", description: "The Grand Audience Chamber", persistentElements: [] },
      cast: ["Aurelia"], basePrompt: "grand audience chamber", compositionLock: "Aurelia centered"
    }],
    // Two different prompts: two requests, one after the other (concurrency 1).
    cues: [{ paragraphIndex: 0, character: "Aurelia", expression: "smile" }, { paragraphIndex: 1, character: "Aurelia", expression: "angry" }],
    choices: [],
    characters: [{ name: "Aurelia", description: "platinum-blonde hair, golden eyes" }]
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
const settle = (ms = 60) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Gate = { resolve: (value: { imageId: string; imageUrl?: string | null }) => void; reject: (reason?: unknown) => void };
type Hold = { match: (path: string) => boolean; engaged: boolean; release: () => void; promise: Promise<void> };

function fixture(chatId: string) {
  const userId = `user-${chatId}`;
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let frontend!: (payload: unknown, userId: string) => void;
  const data = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const gates: Gate[] = [];
  const messages: Array<Record<string, unknown>> = [];
  let images = 0;
  let resolver: (template: string) => string = (template) => template.replace(/\{\{getvar::[^}]*\}\}/g, "");
  // A storage read that waits until released; armed when a given message is sent.
  let hold: Hold | null = null;
  let armOn: ((message: Record<string, unknown>) => boolean) | null = null;
  data.set("config.json", {
    generateImages: true, maxImagesPerTurn: 2, imageConcurrency: 1,
    includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false
  });
  const newHold = (match: (path: string) => boolean): Hold => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    return { match, engaged: false, release, promise };
  };
  const spindle = {
    on: (event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    onFrontendMessage: (fn: (payload: unknown, userId: string) => void) => { frontend = fn; },
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown }) => {
        if (hold && !hold.engaged && hold.match(path)) {
          hold.engaged = true;
          await hold.promise;
        }
        return data.get(path) ?? options.fallback;
      },
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    },
    chat: { getMessages: async () => messages.map((message) => ({ ...message })) },
    macros: { resolve: async (template: string) => ({ text: resolver(template), diagnostics: [] }) },
    generate: {
      raw: async (request: unknown) => {
        const check = storyCheckReply(request);
        if (check) return check;
        return { content: JSON.stringify(plannerPayload()) };
      }
    },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: () => new Promise((resolve, reject) => { gates.push({ resolve, reject }); })
    },
    images: { get: async (id: string) => ({ id }), delete: async () => true },
    sendToFrontend: (message: Record<string, unknown>) => {
      sent.push(message);
      if (armOn?.(message)) { armOn = null; hold = newHold((path) => path === "config.json"); }
    },
    log: { warn() {}, error() {}, info() {} }
  } as unknown as SpindleAPI;
  registerVisualNovelBackend(spindle);
  const fire = (event: string, payload: unknown) => { for (const handler of handlers.get(event) ?? []) handler(payload, userId); };
  const request = (payload: unknown) => frontend(payload, userId);
  const message = (swipeId: number, content: string, swipes: string[]) => ({
    id: "m1", chat_id: chatId, content, is_user: false, name: "Aurelia", role: "assistant", swipe_id: swipeId, swipes,
    swipe_dates: swipes.map(() => 1), extra: {}, parent_message_id: null, branch_id: null, created_at: 1, index_in_chat: 1, send_date: 1
  });
  const image = () => { images += 1; return { imageId: `img-${chatId}-${images}`, imageUrl: `/api/v1/images/img-${chatId}-${images}` }; };
  const record = (swipeId = 0) => data.get(turnPath(chatId, "m1", swipeId)) as StoredTurnRecord | undefined;
  return {
    sent, gates, data, request, fire, record, image,
    open: () => request({ type: "vn_view", chatId, open: true }),
    /** The reply m1 lands (GENERATION_ENDED). */
    reply: (content: string) => {
      messages.splice(0, messages.length, message(0, content, [content]));
      fire("GENERATION_ENDED", { chatId, messageId: "m1", content });
    },
    /** The host shows another swipe of m1 and reports it (MESSAGE_SWIPED). */
    swipe: (swipeId: number, swipes: string[]) => {
      const swiped = message(swipeId, swipes[swipeId]!, swipes);
      messages.splice(0, messages.length, swiped);
      fire("MESSAGE_SWIPED", { chatId, message: swiped });
    },
    setResolver: (next: (template: string) => string) => { resolver = next; },
    /** Hold the next config read after a message matching `when` is sent (the batch start's own read). */
    holdBatchStartAfter: (when: (message: Record<string, unknown>) => boolean) => { armOn = when; },
    holdEngaged: () => hold?.engaged === true,
    releaseHold: () => hold?.release(),
    activePath: () => (data.get(chatStatePath(chatId)) as StoredChatState | undefined)?.activeTurnPath ?? null,
    pathOf: (swipeId: number) => turnPath(chatId, "m1", swipeId)
  };
}

/** Plan m1 and let its two pictures finish. */
async function finishedReply(f: ReturnType<typeof fixture>, content: string): Promise<void> {
  f.open();
  f.reply(content);
  await waitFor(() => f.gates.length >= 1);
  f.gates[0]!.resolve(f.image());
  await waitFor(() => f.gates.length >= 2);
  f.gates[1]!.resolve(f.image());
  await waitFor(() => f.record(0)?.jobs.every((job) => job.status === "generated") === true);
}

describe("(c) the owner moves only with its batch", () => {
  test("swiping back to a finished swipe stops the batch of the swipe it leaves", async () => {
    const f = fixture("c-reuse");
    await finishedReply(f, A);
    f.swipe(1, [A, B]);
    await waitFor(() => f.gates.length >= 3);
    expect(f.activePath()).toBe(f.pathOf(1));
    // Back to the finished swipe: it is reused from storage and takes the chat.
    f.swipe(0, [A, B]);
    await waitFor(() => f.activePath() === f.pathOf(0));
    await settle();
    f.gates[2]!.resolve(f.image());
    await settle(120);
    // Swipe 1's second picture is never asked for: nobody would show it.
    expect(f.gates.length).toBe(3);
    expect(f.record(0)!.jobs.every((job) => job.status === "generated")).toBe(true);
  });

  test("a stored turn kept because the host cannot resolve it stops the batch it replaces", async () => {
    const f = fixture("c-keep");
    await finishedReply(f, MACRO);
    f.swipe(1, [MACRO, B]);
    await waitFor(() => f.gates.length >= 3);
    // The interceptor is gone: swipe 0 cannot be resolved, so its stored turn is kept.
    f.setResolver(() => { throw new Error("interceptor not loaded"); });
    f.swipe(0, [MACRO, B]);
    await waitFor(() => f.activePath() === f.pathOf(0));
    await settle();
    f.gates[2]!.resolve(f.image());
    await settle(120);
    expect(f.gates.length).toBe(3);
  });
});

describe("(d) an abort while the batch is starting", () => {
  test("a cancel that lands while the batch loads its config stops it before its first request", async () => {
    const f = fixture("d-cancel");
    f.open();
    f.holdBatchStartAfter(isPlannedTurn);
    f.reply(A);
    await waitFor(() => f.holdEngaged());
    f.request({ type: "vn_cancel", chatId: "d-cancel" });
    await settle();
    f.releaseHold();
    await settle(120);
    expect(f.gates.length).toBe(0);
    expect(f.record(0)!.jobs.every((job) => job.status === "cancelled")).toBe(true);
  });

  test("a new generation that starts while the batch loads its config stops it before its first request", async () => {
    const f = fixture("d-generation");
    f.open();
    f.holdBatchStartAfter(isPlannedTurn);
    f.reply(A);
    await waitFor(() => f.holdEngaged());
    f.fire("GENERATION_STARTED", { chatId: "d-generation" });
    f.releaseHold();
    await settle(120);
    expect(f.gates.length).toBe(0);
  });

  test("a cancel that lands while resumed pictures start stops them before their first request", async () => {
    const f = fixture("d-resume");
    f.open();
    f.reply(A);
    await waitFor(() => f.gates.length >= 1);
    // A close stops the batch; the stopped request returns.
    f.request({ type: "vn_view", chatId: "d-resume", open: false });
    f.gates[0]!.resolve(f.image());
    await waitFor(() => f.record(0)!.jobs.every((job) => job.status === "cancelled"));
    await settle();
    // The reopened view resumes them; a cancel lands while that batch starts.
    f.holdBatchStartAfter((message) => message.type === "vn_state");
    f.request({ type: "vn_get_state", chatId: "d-resume", viewOpen: true });
    await waitFor(() => f.holdEngaged());
    f.request({ type: "vn_cancel", chatId: "d-resume" });
    await settle();
    f.releaseHold();
    await settle(120);
    expect(f.gates.length).toBe(1);
    expect(f.record(0)!.jobs.every((job) => job.status === "cancelled")).toBe(true);
  });
});

