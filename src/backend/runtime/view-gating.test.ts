import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend, viewRegistry } from "./controller.js";
import { chatStatePath, turnPath, type StoredChatState, type StoredTurnRecord } from "./storage.js";
import { storyCheckReply } from "./__fixtures__/story-check";

/**
 * View gating: automatic planning and image generation only run for chats
 * whose Cue view is open (announced via vn_view / vn_get_state), and never
 * when config.enabled is false. Explicit user actions are never gated.
 */

const CONTENT = "First paragraph.\n\nSecond paragraph.";

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
    cues: [{ paragraphIndex: 0 }],
    choices: [],
    characters: [{ name: "Mira", description: "silver hair, green eyes" }]
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

const settle = (ms = 40) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type FixtureOptions = {
  config?: Record<string, unknown>;
  /** When true, imageGen.generate blocks on a gate the test resolves. */
  gated?: boolean;
};

function fixture(options: FixtureOptions = {}) {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let frontend!: (payload: unknown, userId: string) => void;
  const data = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  const gates: Array<{ resolve: (value: { imageId: string; imageUrl?: string | null }) => void; reject: (reason?: unknown) => void }> = [];
  let plannerCalls = 0;
  let imageCalls = 0;
  let seq = 0;
  data.set("config.json", {
    generateImages: true,
    maxImagesPerTurn: 2,
    imageConcurrency: 1,
    includeCharacterContext: false,
    includePersonaContext: false,
    includeLorebookContext: false,
    ...(options.config ?? {})
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
    chat: { getMessages: async (chatId: string) => messages.filter((m) => m.chat_id === chatId) },
    generate: {
      raw: async (request: unknown) => {
        const check = storyCheckReply(request); if (check) return check;
        plannerCalls += 1;
        return { content: JSON.stringify(plannerPayload()) };
      }
    },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async () => {
        imageCalls += 1;
        if (options.gated) {
          const gate = deferred<{ imageId: string; imageUrl?: string | null }>();
          gates.push(gate);
          return gate.promise;
        }
        seq += 1;
        return { imageId: `img-${seq}`, imageUrl: `/api/v1/images/img-${seq}` };
      }
    },
    sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); },
    log: { warn() {}, error() {}, info() {} }
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
  registerVisualNovelBackend(spindle);
  return {
    spindle, fire, reply, request, record, data, sent, gates,
    plannerCalls: () => plannerCalls,
    imageCalls: () => imageCalls
  };
}

describe("view gating: automatic work only runs for open views", () => {
  test("H1: a reply that finishes with the view closed triggers no planner and no image call", async () => {
    const f = fixture();
    f.reply("gate-h1", "m1", "user-h1");
    await settle();
    expect(f.plannerCalls()).toBe(0);
    expect(f.imageCalls()).toBe(0);
    expect(f.record("gate-h1", "m1")).toBeUndefined();
  });

  test("H2: skipped while closed, planned exactly once when the view opens (vn_view then vn_get_state)", async () => {
    const f = fixture();
    f.request({ type: "vn_view", chatId: "gate-h2", open: true }, "user-h2");
    f.request({ type: "vn_view", chatId: "gate-h2", open: false }, "user-h2");
    f.reply("gate-h2", "m1", "user-h2");
    await settle();
    expect(f.plannerCalls()).toBe(0);

    // Reopen: vn_view announces, vn_get_state plans. Only one plan runs.
    f.request({ type: "vn_view", chatId: "gate-h2", open: true }, "user-h2");
    await settle();
    expect(f.plannerCalls()).toBe(0); // vn_view alone never plans
    f.request({ type: "vn_get_state", chatId: "gate-h2", viewOpen: true }, "user-h2");
    await waitFor(() => f.record("gate-h2", "m1")?.status === "ready");
    await settle();
    expect(f.plannerCalls()).toBe(1);
    expect(f.imageCalls()).toBe(1);
  });

  test("H8: a stale stored record (older reply) is replanned on reopen; a current one is not", async () => {
    const f = fixture();
    f.request({ type: "vn_view", chatId: "gate-h8", open: true }, "user-h8");
    f.reply("gate-h8", "m1", "user-h8");
    await waitFor(() => f.record("gate-h8", "m1")?.jobs[0]?.status === "generated");
    expect(f.plannerCalls()).toBe(1);

    // Close, two replies arrive; both are skipped.
    f.request({ type: "vn_view", chatId: "gate-h8", open: false }, "user-h8");
    f.reply("gate-h8", "m2", "user-h8");
    f.reply("gate-h8", "m3", "user-h8");
    await settle();
    expect(f.plannerCalls()).toBe(1);

    // Reopen: the stored record still points at m1 -> the latest reply (m3) is planned once.
    f.request({ type: "vn_get_state", chatId: "gate-h8", viewOpen: true }, "user-h8");
    await waitFor(() => f.record("gate-h8", "m3")?.status === "ready");
    await settle();
    expect(f.plannerCalls()).toBe(2);
    expect(f.record("gate-h8", "m2")).toBeUndefined();

    // Asking again with a current record plans nothing new.
    const before = f.plannerCalls();
    f.request({ type: "vn_get_state", chatId: "gate-h8", viewOpen: true }, "user-h8");
    await settle();
    expect(f.plannerCalls()).toBe(before);
  });

  test("H3: closing the view mid-batch aborts, persists cancelled, rejects the late result; retry recovers", async () => {
    const f = fixture({ gated: true });
    f.request({ type: "vn_view", chatId: "gate-h3", open: true }, "user-h3");
    f.reply("gate-h3", "m1", "user-h3");
    await waitFor(() => f.gates.length >= 1);
    await waitFor(() => f.record("gate-h3", "m1")?.jobs[0]?.status === "generating");

    f.request({ type: "vn_view", chatId: "gate-h3", open: false }, "user-h3");
    // The late completion must not be persisted or sent.
    f.gates[0]!.resolve({ imageId: "late-img", imageUrl: "/api/v1/images/late-img" });
    await settle();
    const jobs = f.record("gate-h3", "m1")!.jobs;
    expect(jobs.every((job) => job.status === "cancelled")).toBe(true);
    expect(jobs.some((job) => job.imageId === "late-img")).toBe(false);
    const assetStatuses = f.sent.filter((m) => m.type === "vn_asset").map((m) => (m.asset as { status: string }).status);
    expect(assetStatuses).not.toContain("generated");

    // Explicit retry from the reopened view regenerates without a replan (plan is intact).
    f.request({ type: "vn_retry_turn", chatId: "gate-h3", messageId: "m1" }, "user-h3");
    await waitFor(() => f.gates.length >= 2);
    f.gates[1]!.resolve({ imageId: "img-retry", imageUrl: "/api/v1/images/img-retry" });
    await waitFor(() => f.record("gate-h3", "m1")?.jobs[0]?.status === "generated");
    expect(f.record("gate-h3", "m1")!.jobs[0]!.imageId).toBe("img-retry");
    expect(f.plannerCalls()).toBe(1);
  });

  test("H3b: reopening the view resumes the stopped pictures without a replan", async () => {
    const f = fixture({ gated: true });
    f.request({ type: "vn_view", chatId: "gate-h3b", open: true }, "user-h3b");
    f.reply("gate-h3b", "m1", "user-h3b");
    await waitFor(() => f.gates.length >= 1);
    await waitFor(() => f.record("gate-h3b", "m1")?.jobs[0]?.status === "generating");
    f.request({ type: "vn_view", chatId: "gate-h3b", open: false }, "user-h3b");
    await waitFor(() => f.record("gate-h3b", "m1")!.jobs.every((job) => job.status === "cancelled"));

    f.request({ type: "vn_get_state", chatId: "gate-h3b", viewOpen: true }, "user-h3b");
    await waitFor(() => f.gates.length >= 2);
    // The view gets the resumed turn, never a cancelled one.
    const state = f.sent.filter((m) => m.type === "vn_state").at(-1) as { turn: { assets: Array<{ status: string }> } };
    expect(state.turn.assets.map((asset) => asset.status)).not.toContain("cancelled");
    f.gates[1]!.resolve({ imageId: "img-resumed", imageUrl: "/api/v1/images/img-resumed" });
    await waitFor(() => f.record("gate-h3b", "m1")?.jobs[0]?.status === "generated");
    expect(f.record("gate-h3b", "m1")!.jobs[0]!.imageId).toBe("img-resumed");
    expect(f.plannerCalls()).toBe(1);
  });

  test("H3c: nothing resumes while a reply is being generated; it does once generation stops", async () => {
    const f = fixture({ gated: true });
    f.request({ type: "vn_view", chatId: "gate-h3c", open: true }, "user-h3c");
    f.reply("gate-h3c", "m1", "user-h3c");
    await waitFor(() => f.gates.length >= 1);
    await waitFor(() => f.record("gate-h3c", "m1")?.jobs[0]?.status === "generating");
    f.fire("GENERATION_STARTED", { chatId: "gate-h3c" }, "user-h3c");
    f.request({ type: "vn_get_state", chatId: "gate-h3c", viewOpen: true }, "user-h3c");
    await waitFor(() => f.sent.filter((m) => m.type === "vn_state").length >= 1);
    await settle();
    expect(f.gates.length).toBe(1);

    f.fire("GENERATION_STOPPED", { chatId: "gate-h3c" }, "user-h3c");
    f.request({ type: "vn_get_state", chatId: "gate-h3c", viewOpen: true }, "user-h3c");
    await waitFor(() => f.gates.length >= 2);
    expect(f.plannerCalls()).toBe(1);
  });

  test("H3d: a failed picture is not resumed on reopen; it waits for Try again", async () => {
    const f = fixture({ gated: true });
    f.request({ type: "vn_view", chatId: "gate-h3d", open: true }, "user-h3d");
    f.reply("gate-h3d", "m1", "user-h3d");
    await waitFor(() => f.gates.length >= 1);
    f.gates[0]!.reject(new Error("failed (402): Not enough Anlas"));
    await waitFor(() => f.record("gate-h3d", "m1")?.jobs[0]?.status === "failed");
    f.request({ type: "vn_view", chatId: "gate-h3d", open: false }, "user-h3d");
    f.request({ type: "vn_get_state", chatId: "gate-h3d", viewOpen: true }, "user-h3d");
    await waitFor(() => f.sent.filter((m) => m.type === "vn_state").length >= 1);
    await settle();
    expect(f.gates.length).toBe(1);
    expect(f.record("gate-h3d", "m1")!.jobs[0]!.status).toBe("failed");
  });

  test("H4: enabled:false skips everything even with the view open, but state/config is still served", async () => {
    const f = fixture({ config: { enabled: false } });
    f.request({ type: "vn_view", chatId: "gate-h4", open: true }, "user-h4");
    f.reply("gate-h4", "m1", "user-h4");
    await settle();
    expect(f.plannerCalls()).toBe(0);
    expect(f.imageCalls()).toBe(0);

    f.request({ type: "vn_get_state", chatId: "gate-h4", viewOpen: true }, "user-h4");
    await settle();
    expect(f.plannerCalls()).toBe(0);
    const state = f.sent.find((m) => m.type === "vn_state") as { config: { enabled: boolean }; turn: unknown };
    expect(state.config.enabled).toBe(false);
    expect(state.turn).toBeNull();
  });

  test("H5: a vn_get_state without viewOpen never opens the view; only vn_view/viewOpen:true does", async () => {
    const f = fixture();
    f.request({ type: "vn_get_state", chatId: "gate-h5" }, "user-h5");
    await waitFor(() => f.sent.some((m) => m.type === "vn_state"));
    // A background/legacy state request must not register the view as open,
    // otherwise closed chats start paying for planning and images again.
    f.reply("gate-h5", "m1", "user-h5");
    await settle();
    expect(f.plannerCalls()).toBe(0);
    expect(f.imageCalls()).toBe(0);
    // The explicit announcement is what opens it.
    f.request({ type: "vn_view", chatId: "gate-h5", open: true }, "user-h5");
    f.request({ type: "vn_get_state", chatId: "gate-h5", viewOpen: true }, "user-h5");
    await waitFor(() => f.record("gate-h5", "m1")?.status === "ready");
    expect(f.plannerCalls()).toBe(1);
  });

  test("home screen (empty chat) closes the open view and aborts its work", async () => {
    const f = fixture({ gated: true });
    f.request({ type: "vn_view", chatId: "gate-home", open: true }, "user-home");
    f.request({ type: "vn_get_state", chatId: "gate-home", viewOpen: true }, "user-home");
    await waitFor(() => f.sent.some((m) => m.type === "vn_state"));
    f.request({ type: "vn_get_state", chatId: "", viewOpen: true }, "user-home");
    await waitFor(() => f.sent.filter((m) => m.type === "vn_state").length >= 2);
    f.reply("gate-home", "m1", "user-home");
    await settle();
    expect(f.plannerCalls()).toBe(0);
    expect(f.imageCalls()).toBe(0);
  });

  test("swipe and edit reconciles are ignored while the view is closed", async () => {
    const f = fixture();
    const message = {
      id: "m1", chat_id: "gate-swipe", content: CONTENT, is_user: false, name: "Mira", swipe_id: 1,
      swipes: [CONTENT, CONTENT], swipe_dates: [1, 2], extra: {}, parent_message_id: null, branch_id: null,
      created_at: 1, index_in_chat: 0, send_date: 1
    };
    f.fire("MESSAGE_SWIPED", { chatId: "gate-swipe", message }, "user-swipe");
    f.fire("SWIPE_EDITED", { chatId: "gate-swipe", message }, "user-swipe");
    f.fire("MESSAGE_EDITED", { chatId: "gate-swipe", message }, "user-swipe");
    await settle();
    expect(f.plannerCalls()).toBe(0);
    expect(f.imageCalls()).toBe(0);
  });

  test("H6: per-chat and per-user isolation; opening another chat closes the first and aborts its batch", async () => {
    const f = fixture({ gated: true });
    // User A opens chat-a only; user B never opens anything.
    f.request({ type: "vn_view", chatId: "gate-h6-a", open: true }, "user-h6-a");
    f.reply("gate-h6-a", "a1", "user-h6-a");
    f.reply("gate-h6-b", "b1", "user-h6-b");
    await waitFor(() => f.gates.length >= 1);
    expect(f.plannerCalls()).toBe(1); // only chat-a planned
    expect(viewRegistry().isOpen("user-h6-b", "gate-h6-b")).toBe(false);

    // The same user opens chat-b: chat-a is displaced and its batch aborted.
    f.request({ type: "vn_view", chatId: "gate-h6-b", open: true }, "user-h6-a");
    expect(viewRegistry().isOpen("user-h6-a", "gate-h6-a")).toBe(false);
    f.gates[0]!.resolve({ imageId: "late-a", imageUrl: "/api/v1/images/late-a" });
    await settle();
    const jobs = f.record("gate-h6-a", "a1")!.jobs;
    expect(jobs.every((job) => job.status === "cancelled")).toBe(true);
    expect(jobs.some((job) => job.imageId === "late-a")).toBe(false);
  });

  test("MESSAGE_DELETED cleanup with a closed view clears state but never plans", async () => {
    const f = fixture();
    f.request({ type: "vn_view", chatId: "gate-del", open: true }, "user-del");
    f.reply("gate-del", "m1", "user-del");
    await waitFor(() => f.record("gate-del", "m1")?.status === "ready");
    expect(f.plannerCalls()).toBe(1);
    f.request({ type: "vn_view", chatId: "gate-del", open: false }, "user-del");
    f.fire("MESSAGE_DELETED", { chatId: "gate-del", messageId: "m1" }, "user-del");
    await settle();
    const state = f.data.get(chatStatePath("gate-del")) as StoredChatState;
    expect(state.activeTurnPath).toBeNull();
    expect(f.plannerCalls()).toBe(1); // the deletion never replanned m1
  });
});
