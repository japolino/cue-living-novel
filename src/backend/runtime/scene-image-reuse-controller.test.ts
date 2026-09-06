import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend, sceneImageCache, sendState, turnView } from "./controller.js";
import { chatStatePath, type StoredChatState, type StoredTurnRecord } from "./storage.js";
import { computeAssetProgress } from "../../frontend/host/controller.js";
import { retryScopeForTurn } from "../../frontend/host/turn-status.js";
import { sceneImageScope } from "../core/scene-image-cache.js";

/**
 * Controller wiring through the real planner: the image cap is 1, the planner
 * proposes two cues with the same pose. The second cue becomes a reuse-only
 * candidate. It gets its image only from the cache (after the budgeted image
 * lands), never from a second provider request.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const content = "Mira smiles at the door.\n\nShe smiles again, softer this time.";

function payload() {
  return {
    scenes: [{
      startParagraph: 0,
      boundary: { claimedNewScene: true, reason: "initial", location: "Observatory", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
      environment: { location: "Observatory", timeOfDay: "night", weather: null, lighting: "lantern light", description: "An old observatory", persistentElements: ["brass telescope"] },
      cast: ["Mira"],
      character: "Mira",
      basePrompt: "old observatory, brass telescope",
      compositionLock: "Mira centered"
    }],
    cues: [
      { paragraphIndex: 0, character: "Mira", expression: "smile" },
      { paragraphIndex: 1, character: "Mira", expression: "smile" }
    ],
    choices: [],
    characters: [{ name: "Mira", description: "silver hair, green eyes" }]
  };
}

function fixture(messages: Array<{ id: string; content: string }>) {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const data = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const calls: Array<Record<string, unknown>> = [];
  let counter = 0;
  data.set("config.json", {
    generateImages: true,
    maxImagesPerTurn: 1,
    imageConcurrency: 1,
    referenceAnchoring: false,
    includeCharacterContext: false,
    includePersonaContext: false,
    includeLorebookContext: false
  });
  const spindle = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    onFrontendMessage: () => {},
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    },
    chat: {
      getMessages: async () => messages.map((message, index) => ({
        id: message.id,
        content: message.content,
        is_user: false,
        name: "Mira",
        chat_id: "chat",
        index_in_chat: index,
        send_date: index,
        swipe_id: 0,
        swipes: [message.content],
        swipe_dates: [index],
        extra: {},
        parent_message_id: "user-1",
        branch_id: null,
        created_at: index
      }))
    },
    generate: { raw: async () => ({ content: JSON.stringify(payload()) }) },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async (input: Record<string, unknown>) => {
        calls.push(input);
        counter += 1;
        return { imageId: `img-${counter}`, imageUrl: `/api/v1/images/img-${counter}` };
      }
    },
    images: { get: async (id: string) => ({ id, url: `/api/v1/images/${id}` }) },
    sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); },
    log: { warn() {}, error() {}, info() {} }
  } as unknown as SpindleAPI;
  const fire = (event: string, ...args: unknown[]) => {
    for (const handler of handlers.get(event) ?? []) handler(...args);
  };
  return { spindle, fire, data, sent, calls };
}

async function settle(condition: () => boolean, rounds = 400): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition did not settle.");
}

describe("controller wiring: extra swaps beyond the cap without extra requests", () => {
  test("the second cue is a cache candidate, gets the budgeted image once it lands, and never adds a provider call", async () => {
    sceneImageCache().clear();
    const { spindle, fire, data, sent, calls } = fixture([{ id: "assistant-1", content }]);
    registerVisualNovelBackend(spindle);
    fire("GENERATION_ENDED", { chatId: "chat", messageId: "assistant-1", content }, "user-1");
    await settle(() => sent.some((message) => message.type === "vn_asset" && (message.asset as Record<string, unknown>).source === "cache"));

    const state = data.get(chatStatePath("chat")) as StoredChatState;
    const record = data.get(state.activeTurnPath!) as StoredTurnRecord;
    expect(record.plan.visualCues).toHaveLength(1);
    expect(record.plan.cacheCues).toHaveLength(1);
    expect(record.plan.cacheCues![0]!.paragraphIndex).toBe(1);
    expect(calls).toHaveLength(1);

    await settle(() => (data.get(state.activeTurnPath!) as StoredTurnRecord).jobs.length === 2);
    const stored = data.get(state.activeTurnPath!) as StoredTurnRecord;
    const extra = stored.jobs.find((job) => job.provider === "cache")!;
    expect(extra.status).toBe("generated");
    expect(extra.imageId).toBe("img-1");
    expect(extra.paragraphIndex).toBe(1);

    const view = turnView(stored);
    const extraView = view.assets.find((asset) => asset.source === "cache")!;
    expect(extraView.cueId).toBe(record.plan.cacheCues![0]!.cueId);
    expect(extraView.imageUrl).toBe("/api/v1/images/img-1");
    // Progress and retry wording ignore cache-served swaps.
    expect(computeAssetProgress(view)).toBeNull();
    expect(retryScopeForTurn(view)).toEqual({ scope: "unfinished-images", unfinished: 0, kept: 1, automatic: false });

    // The first vn_turn carried only the budgeted job (the candidate was cold then).
    const firstTurn = sent.find((message) => message.type === "vn_turn") as { turn: { assets: unknown[] } };
    expect(firstTurn.turn.assets).toHaveLength(1);
  });

  test("a warm candidate is served in the first vn_turn of the next message with no request", async () => {
    sceneImageCache().clear();
    const { spindle, fire, data, sent, calls } = fixture([{ id: "assistant-1", content }, { id: "assistant-2", content }]);
    registerVisualNovelBackend(spindle);
    fire("GENERATION_ENDED", { chatId: "chat", messageId: "assistant-1", content }, "user-1");
    await settle(() => sent.some((message) => message.type === "vn_asset" && (message.asset as Record<string, unknown>).source === "cache"));
    expect(calls).toHaveLength(1);

    fire("GENERATION_STARTED", { chatId: "chat" }, "user-1");
    fire("GENERATION_ENDED", { chatId: "chat", messageId: "assistant-2", content }, "user-1");
    await settle(() => sent.filter((message) => message.type === "vn_turn").length >= 2);
    const secondTurn = sent.filter((message) => message.type === "vn_turn").at(-1) as { turn: { messageId: string; assets: Array<Record<string, unknown>> } };
    expect(secondTurn.turn.messageId).toBe("assistant-2");
    // Budgeted job for p0 plus the warm candidate for p1, both before any generation ran for this message.
    expect(secondTurn.turn.assets).toHaveLength(2);
    expect(secondTurn.turn.assets.find((asset) => asset.source === "cache")).toMatchObject({ status: "generated", imageId: "img-1", paragraphIndex: 1 });
    await settle(() => {
      const state = data.get(chatStatePath("chat")) as StoredChatState;
      const record = data.get(state.activeTurnPath!) as StoredTurnRecord;
      return record.jobs.every((job) => job.status === "generated");
    });
    // The budgeted cue is exact-compatible too, so it was reused: still one request overall.
    expect(calls).toHaveLength(1);
    expect(sceneImageCache().stats().generationsAvoided).toBeGreaterThanOrEqual(2);
  });

  test("the host CHAT_SWITCHED event releases the previous chat's scope for that user only", async () => {
    sceneImageCache().clear();
    const { spindle, fire } = fixture([]);
    registerVisualNovelBackend(spindle);
    const provenance = { provider: null, connectionId: null, model: "", promptFingerprint: "k", assistantMessageId: "m", swipeId: 0, jobId: "j" };
    const scopeA = sceneImageScope("user-1", "chat-a");
    const scopeOther = sceneImageScope("user-2", "chat-a");
    sceneImageCache().store(scopeA, "k", { imageId: "img", episode: "initial:0", provenance }, sceneImageCache().admission(scopeA));
    sceneImageCache().store(scopeOther, "k", { imageId: "img", episode: "initial:0", provenance }, sceneImageCache().admission(scopeOther));
    const tokenA = sceneImageCache().admission(scopeA);
    fire("CHAT_SWITCHED", { chatId: "chat-a" }, "user-1");
    expect(sceneImageCache().size).toBe(2);
    fire("CHAT_SWITCHED", { chatId: "chat-b" }, "user-1");
    expect(sceneImageCache().peek(scopeA, "k")).toBeNull();
    expect(sceneImageCache().peek(scopeOther, "k")).not.toBeNull(); // another user's view of the same chat is untouched
    expect(sceneImageCache().isAdmitted(tokenA)).toBe(false);
    expect(sceneImageCache().stats().invalidations.chat_switch).toBe(1);
    // Returning to the home screen (chatId null) releases the current chat as well.
    const scopeB = sceneImageScope("user-1", "chat-b");
    sceneImageCache().store(scopeB, "k", { imageId: "img", episode: "initial:0", provenance }, sceneImageCache().admission(scopeB));
    fire("CHAT_SWITCHED", { chatId: null }, "user-1");
    expect(sceneImageCache().peek(scopeB, "k")).toBeNull();
    // Malformed payloads are ignored.
    fire("CHAT_SWITCHED", "nonsense", "user-1");
    fire("CHAT_SWITCHED", undefined, "user-1");
  });

  test("switching chats via vn_get_state releases the previous chat's scope explicitly", async () => {
    sceneImageCache().clear();
    const { spindle } = fixture([]);
    const scopeA = sceneImageScope("user-1", "chat-a");
    sceneImageCache().store(scopeA, "k", { imageId: "img", episode: "initial:0", provenance: { provider: null, connectionId: null, model: "", promptFingerprint: "k", assistantMessageId: "m", swipeId: 0, jobId: "j" } }, sceneImageCache().admission(scopeA));
    const token = sceneImageCache().admission(scopeA);
    await sendState(spindle, "chat-a", "user-1");
    expect(sceneImageCache().size).toBe(1);
    await sendState(spindle, "chat-b", "user-1");
    expect(sceneImageCache().size).toBe(0);
    expect(sceneImageCache().isAdmitted(token)).toBe(false);
    expect(sceneImageCache().stats().invalidations.chat_switch).toBe(1);
  });
});
