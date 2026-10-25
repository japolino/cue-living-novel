
import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend, viewRegistry } from "./controller.js";
import { chatStatePath, turnPath, type StoredChatState, type StoredTurnRecord } from "./storage.js";
import { isPlannedTurn } from "./__fixtures__/turns.js";

const CONTENT = "First paragraph.\n\nSecond paragraph.";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function plannerPayload() {
  return {
    scenes: [{
      startParagraph: 0,
      boundary: { claimedNewScene: true, reason: "initial", location: "Observatory", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
      environment: { location: "Observatory", timeOfDay: "night", weather: null, lighting: "lantern light", description: "An old observatory", persistentElements: ["brass telescope"] },
      cast: ["Mira"],
      basePrompt: "old observatory",
      compositionLock: "Mira centered"
    }],
    cues: [{ paragraphIndex: 0 }],
    choices: [],
    characters: [{ name: "Mira", description: "silver hair" }]
  };
}


describe("view gating regressions (from the audit probes)", () => {
test("closing the view during post-plan awaits persists nothing and sends no vn_turn", async () => {
  let frontend!: (payload: any, userId: string) => void;
  const data = new Map<string, any>([["config.json", { enabled: true, debugLogging: true, generateImages: true }]]);
  const messages: any[] = [];
  const sent: any[] = [];
  const handlers = new Map<string, Array<(...args: any[]) => void>>();

  let resolveSaveRegistry!: () => void;
  let registryIntercept = false;

  const spindle = {
    on: (event: string, handler: any) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    onFrontendMessage: (fn: any) => { frontend = fn; },
    userStorage: {
      getJson: async (path: string, opts: any) => data.get(path) ?? opts.fallback,
      setJson: async (path: string, val: any) => {
        data.set(path, val);
        if (registryIntercept && path.includes("character-registry")) {
          await new Promise<void>((res) => { resolveSaveRegistry = res; });
        }
      },
    },
    chat: {
      getMessages: async (chatId: string) => messages.filter((m) => m.chat_id === chatId),
    },
    generate: {
      raw: async () => ({ content: JSON.stringify({
        scenes: [{
          startParagraph: 0,
          boundary: { claimedNewScene: true, reason: "initial", location: "Observatory", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
          environment: { location: "Observatory", timeOfDay: "night", weather: null, lighting: "lantern light", description: "An old observatory", persistentElements: ["brass telescope"] },
          cast: ["Mira"],
          basePrompt: "old observatory",
          compositionLock: "Mira centered"
        }],
        cues: [{ paragraphIndex: 0 }],
        choices: [],
        characters: [{ name: "Mira", description: "silver hair" }]
      })}),
    },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async () => ({ imageId: "img-1", imageUrl: "/img-1.png" }),
    },
    sendToFrontend: (msg: any) => { sent.push(msg); },
    log: { warn() {}, error() {}, info() {} },
  } as unknown as SpindleAPI;

  registerVisualNovelBackend(spindle);

  // User opens view
  frontend({ type: "vn_view", chatId: "chat-abort2", open: true }, "user-1");

  registryIntercept = true;

  // Message arrives
  const content = "Paragraph 1.\n\nParagraph 2.";
  messages.push({
    id: "m-abort2",
    chat_id: "chat-abort2",
    content,
    is_user: false,
    name: "Mira",
    swipe_id: 0,
    swipes: [content],
    swipe_dates: [1],
    extra: {},
  });

  for (const h of handlers.get("GENERATION_ENDED") ?? []) {
    h({ chatId: "chat-abort2", messageId: "m-abort2", content }, "user-1");
  }

  // Wait for intercept
  while (!resolveSaveRegistry) {
    await new Promise((r) => setTimeout(r, 5));
  }

  // User closes view while saveCharacterRegistry is awaiting
  frontend({ type: "vn_view", chatId: "chat-abort2", open: false }, "user-1");
  expect(viewRegistry().isOpen("user-1", "chat-abort2")).toBe(false);

  // Now resolve the registry save
  resolveSaveRegistry();
  await new Promise((r) => setTimeout(r, 80));

  // 1. Did it send vn_turn to frontend after view closed?
  const turnSent = sent.find(isPlannedTurn);
  expect(Boolean(turnSent)).toBe(false);

  // 2. Did it claim activeTurnKeys and persist active turn?
  const chatState = data.get(chatStatePath("chat-abort2")) as StoredChatState;
  expect(chatState?.activeTurnPath ?? null).toBeNull();

  // 3. User reopens the view:
  let plannerCalls = 0;
  spindle.generate.raw = async () => {
    plannerCalls += 1;
    return { content: "" };
  };
  frontend({ type: "vn_view", chatId: "chat-abort2", open: true }, "user-1");
  frontend({ type: "vn_get_state", chatId: "chat-abort2", viewOpen: true }, "user-1");
  await new Promise((r) => setTimeout(r, 50));

  // Nothing was persisted, so reopening plans the reply fresh instead of showing a cancelled turn.
  expect(plannerCalls).toBeGreaterThanOrEqual(1);
  const lastState = sent.filter((m) => m.type === "vn_state").slice(-1)[0];
  expect(lastState?.turn ?? null).toBeNull();
});

test("a late view-close cleanup never overwrites a retried turn with cancelled", async () => {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  let frontend!: (payload: unknown, userId: string) => void;
  const data = new Map<string, unknown>();
  const messages: any[] = [];
  const gates: any[] = [];
  let seq = 0;

  data.set("config.json", {
    generateImages: true,
    maxImagesPerTurn: 2,
    imageConcurrency: 1,
    includeCharacterContext: false,
    includePersonaContext: false,
    includeLorebookContext: false,
    debugLogging: true
  });

  let slowGetJson = false;
  let resolveSlowJson!: () => void;

  const spindle = {
    on: (event: string, handler: any) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    onFrontendMessage: (fn: any) => { frontend = fn; },
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown }) => {
        if (slowGetJson && path.includes("turns/")) {
          await new Promise<void>((r) => { resolveSlowJson = r; });
        }
        return data.get(path) ?? readOptions.fallback;
      },
      setJson: async (path: string, value: unknown) => {
        data.set(path, value);
      }
    },
    chat: { getMessages: async (chatId: string) => messages.filter((m) => m.chat_id === chatId) },
    generate: {
      raw: async () => ({ content: JSON.stringify(plannerPayload()) })
    },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async () => {
        const gate = deferred<{ imageId: string; imageUrl?: string | null }>();
        gates.push(gate);
        return gate.promise;
      }
    },
    sendToFrontend: () => {},
    log: { warn(m: any) { console.log("WARN:", m); }, error(m: any) { console.log("ERROR:", m); }, info() {} }
  } as unknown as SpindleAPI;

  const fire = (event: string, ...args: any[]) => {
    for (const h of handlers.get(event) ?? []) h(...args);
  };

  registerVisualNovelBackend(spindle);

  // 1. Open view and send message
  frontend({ type: "vn_view", chatId: "chat-race", open: true }, "user-1");
  messages.push({
    id: "m1", chat_id: "chat-race", content: CONTENT, is_user: false, name: "Mira", swipe_id: 0,
    swipes: [CONTENT], swipe_dates: [1], extra: {}, parent_message_id: null, branch_id: null,
    created_at: 1, index_in_chat: 1, send_date: 1
  });
  fire("GENERATION_ENDED", { chatId: "chat-race", messageId: "m1", content: CONTENT }, "user-1");

  // Wait for image job to start generating
  while (gates.length === 0) {
    await new Promise((r) => setTimeout(r, 5));
  }
  const path = turnPath("chat-race", "m1", 0);
  const recBefore = data.get(path) as StoredTurnRecord;
  expect(recBefore?.jobs[0]?.status).toBe("generating");

  // 2. Slow down userStorage for cancelIncompleteJobs
  slowGetJson = true;

  // 3. User closes view -> triggers unawaited cancelIncompleteJobs
  frontend({ type: "vn_view", chatId: "chat-race", open: false }, "user-1");

  // Wait for cancelIncompleteJobs to hang on reading the turn record
  while (!resolveSlowJson) {
    await new Promise((r) => setTimeout(r, 5));
  }

  // 4. While cancelIncompleteJobs is hanging, user reopens view and retries turn!
  slowGetJson = false;
  frontend({ type: "vn_view", chatId: "chat-race", open: true }, "user-1");
  await frontend({ type: "vn_retry_turn", chatId: "chat-race", messageId: "m1" }, "user-1");

  // Retry has started, gates length is now 2 (a new image job is generating!)
  while (gates.length < 2) await new Promise((r) => setTimeout(r, 5));
  const recAfterRetry = data.get(path) as StoredTurnRecord;
  expect(recAfterRetry.jobs[0]?.status).toBe("generating");

  // 5. Now resolve the hanging cancelIncompleteJobs from step 3!
  resolveSlowJson();
  await new Promise((r) => setTimeout(r, 50));

  // Check what happened to the turn in storage!
  const recFinal = data.get(path) as StoredTurnRecord;
  // The stale cleanup sees a reopened view / live owner and leaves the retried job alone.
  expect(recFinal.jobs[0]?.status).toBe("generating");
});
});
