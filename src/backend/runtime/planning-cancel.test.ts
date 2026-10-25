import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { seedSingleCharacter } from "../core/visual-state.js";
import { registerVisualNovelBackend } from "./controller.js";
import { characterRegistryPath, chatStatePath, singleCharacterStatePath, turnPath, type StoredTurnRecord } from "./storage.js";
import { storyCheckReply } from "./__fixtures__/story-check";
import { isPlannedTurn, isProvisionalTurn } from "./__fixtures__/turns.js";

/**
 * Cancelled planning frees the chat's planning queue at once: the planner
 * request is aborted (and rejected locally even when the host ignores the
 * signal), a reopened view plans again instead of joining the cancelled plan,
 * and a newer version of the message replaces the plan of the old one. The
 * replaced plan never persists, paints or seeds the chat's identity state.
 */

const FIRST = "First paragraph.\n\nSecond paragraph.";
const SECOND = "Another swipe opens.\n\nIt ends here.";
const THIRD = "A third swipe. It closes.";
const VEX = "Vex steps out of the dark.\n\nVex waits.";

function plannerPayload(content: string) {
  const name = content.includes("Vex steps") ? "Vex" : "Mira";
  return {
    scenes: [{
      startParagraph: 0,
      boundary: { claimedNewScene: true, reason: "initial", location: "Observatory", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
      environment: { location: "Observatory", timeOfDay: "night", weather: null, lighting: "lantern light", description: "An old observatory", persistentElements: [] },
      cast: [name],
      basePrompt: "old observatory",
      compositionLock: `${name} centered`
    }],
    cues: [{ paragraphIndex: 0 }],
    choices: [],
    characters: [{ name, description: "silver hair, green eyes" }]
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

type FixtureOptions = {
  config?: Record<string, unknown>;
  /** Planner calls answer at once instead of parking until released. */
  autoRelease?: boolean;
  /** Line checks park until released too, so a superseded plan's text is still pending. */
  holdChecks?: boolean;
  /** Runs before a storage read settles; awaiting it holds the read. */
  beforeGet?: (path: string) => Promise<void> | void;
  /** Runs before a storage write lands; awaiting it holds the write. */
  beforeSet?: (path: string) => Promise<void> | void;
};

function fixture(options: FixtureOptions = {}) {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let frontend!: (payload: unknown, userId: string) => void;
  const data = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const messages: Array<Record<string, unknown>> = [];
  // Planner calls park until the test releases them; the fake host ignores the signal.
  const planner: Array<{ content: string; signal?: AbortSignal; release: () => void }> = [];
  const checks: Array<() => void> = [];
  let seq = 0;
  data.set("config.json", {
    generateImages: false,
    includeCharacterContext: false,
    includePersonaContext: false,
    includeLorebookContext: false,
    ...options.config
  });
  const spindle = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    onFrontendMessage: (fn: (payload: unknown, userId: string) => void) => { frontend = fn; },
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown }) => {
        await options.beforeGet?.(path);
        return data.get(path) ?? readOptions.fallback;
      },
      setJson: async (path: string, value: unknown) => {
        await options.beforeSet?.(path);
        data.set(path, value);
      }
    },
    chat: { getMessages: async (chatId: string) => messages.filter((m) => m.chat_id === chatId).map((m) => ({ ...m })) },
    generate: {
      raw: (request: { messages: Array<{ content: string }>; signal?: AbortSignal }) => new Promise((resolve) => {
        // Skip non-story blocks (on by default) answers its line check at once: only planner calls park.
        const check = storyCheckReply(request);
        if (check && options.holdChecks) return void checks.push(() => resolve(check));
        if (check) return resolve(check);
        const content = request.messages.at(-1)?.content ?? "";
        const release = () => resolve({ content: JSON.stringify(plannerPayload(content)) });
        planner.push({ content, ...(request.signal ? { signal: request.signal } : {}), release });
        if (options.autoRelease) release();
      })
    },
    // Sprite mode generates (and the frontend cuts) sprites in the background.
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
    log: { warn() {}, error() {}, info() {} }
  } as unknown as SpindleAPI;
  const fire = (event: string, ...args: unknown[]) => {
    for (const handler of handlers.get(event) ?? []) handler(...args);
  };
  registerVisualNovelBackend(spindle);
  const message = (chatId: string, content: string, swipeId = 0, swipes?: string[]) => ({
    id: "m1", chat_id: chatId, content, is_user: false, name: "Mira", swipe_id: swipeId,
    swipes: swipes ?? (swipeId ? [FIRST, content] : [content]), swipe_dates: [1], extra: {}, parent_message_id: null, branch_id: null,
    created_at: 1, index_in_chat: 1, send_date: 1
  });
  /** The host switches the message to another swipe and reports it. */
  const swipe = (chatId: string, userId: string, content: string, swipeId: number, swipes?: string[]) => {
    const swiped = message(chatId, content, swipeId, swipes);
    messages.splice(0, messages.length, swiped);
    fire("MESSAGE_SWIPED", { chatId, message: swiped }, userId);
  };
  return {
    fire, sent, planner, checks, messages, message, swipe, data,
    request: (payload: unknown, userId: string) => frontend(payload, userId),
    record: (chatId: string, swipeId = 0) => data.get(turnPath(chatId, "m1", swipeId)) as StoredTurnRecord | undefined,
    activePath: (chatId: string) => (data.get(chatStatePath(chatId)) as { activeTurnPath?: string | null } | undefined)?.activeTurnPath,
    turns: () => sent.filter(isPlannedTurn).map((m) => m.turn as { swipeId: number; paragraphs: string[] }),
    /** Swipe ids of the text sent before a plan, from `from` (an index into `sent`) on. */
    texts: (from = 0) => sent.slice(from).filter(isProvisionalTurn).map((m) => (m.turn as { swipeId: number }).swipeId),
    releaseChecks: () => { for (const release of checks.splice(0)) release(); }
  };
}

describe("cancelled planning frees the queue", () => {
  test("reopening the view while a turn plans plans it again (it never joins the cancelled plan)", async () => {
    const f = fixture({ holdChecks: true });
    f.request({ type: "vn_view", chatId: "pc-reopen", open: true }, "user-pc1");
    f.messages.push(f.message("pc-reopen", FIRST));
    f.fire("GENERATION_ENDED", { chatId: "pc-reopen", messageId: "m1", content: FIRST }, "user-pc1");
    await waitFor(() => f.planner.length === 1);
    expect(f.planner[0]?.signal).toBeDefined();

    f.request({ type: "vn_view", chatId: "pc-reopen", open: false }, "user-pc1");
    expect(f.planner[0]?.signal?.aborted).toBe(true);
    f.request({ type: "vn_get_state", chatId: "pc-reopen", viewOpen: true }, "user-pc1");
    // The new plan starts while the cancelled request is still parked on the host.
    await waitFor(() => f.planner.length === 2 && f.checks.length === 2);
    // The new plan's line check answers; the cancelled one's stays parked.
    f.checks.splice(1)[0]!();
    await waitFor(() => f.texts().length === 1);
    f.planner[1]!.release();
    await waitFor(() => f.turns().length === 1);
    expect(f.record("pc-reopen")?.status).toBe("ready");
    // The cancelled requests finishing late change nothing, its text included.
    f.releaseChecks();
    f.planner[0]!.release();
    await settle();
    expect(f.turns()).toHaveLength(1);
    expect(f.texts()).toHaveLength(1);
  });

  test("swiping while the old swipe plans replaces that plan instead of queueing behind it", async () => {
    const f = fixture({ holdChecks: true });
    f.request({ type: "vn_view", chatId: "pc-swipe", open: true }, "user-pc2");
    f.messages.push(f.message("pc-swipe", FIRST));
    f.fire("GENERATION_ENDED", { chatId: "pc-swipe", messageId: "m1", content: FIRST }, "user-pc2");
    await waitFor(() => f.planner.length === 1);

    f.swipe("pc-swipe", "user-pc2", SECOND, 1);
    await waitFor(() => f.planner.length === 2);
    expect(f.planner[0]?.signal?.aborted).toBe(true);
    expect(f.planner[1]?.content).toContain("Another swipe opens.");
    // Both line checks answer after the swipe: only the new swipe's text goes out.
    f.releaseChecks();
    f.planner[1]!.release();
    f.planner[0]!.release();
    await waitFor(() => f.turns().length >= 1);
    await settle();
    // Only the new swipe is shown; the old swipe's plan never paints, not even its text.
    expect(f.turns().map((turn) => turn.swipeId)).toEqual([1]);
    expect(f.texts()).toEqual([1]);
    expect(f.record("pc-swipe", 0)).toBeUndefined();
  });

  test("swiping back to an already planned swipe cancels the plan of the swipe it left", async () => {
    const f = fixture();
    const chat = "pc-back";
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pc3");
    f.messages.push(f.message(chat, FIRST));
    f.fire("GENERATION_ENDED", { chatId: chat, messageId: "m1", content: FIRST }, "user-pc3");
    await waitFor(() => f.planner.length === 1);
    f.planner[0]!.release();
    await waitFor(() => f.turns().length === 1);

    f.swipe(chat, "user-pc3", SECOND, 1);
    await waitFor(() => f.planner.length === 2);
    // Back to swipe 0: its stored turn is shown again as it is.
    const back = f.sent.length;
    f.swipe(chat, "user-pc3", FIRST, 0, [FIRST, SECOND]);
    await waitFor(() => f.turns().length === 2);
    expect(f.planner[1]?.signal?.aborted).toBe(true);
    f.planner[1]!.release();
    await settle(60);
    expect(f.turns().map((turn) => turn.swipeId)).toEqual([0, 0]);
    // A stored turn needs no text before its plan; the left swipe's text never comes again.
    expect(f.texts(back)).toEqual([]);
    expect(f.activePath(chat)).toBe(turnPath(chat, "m1", 0));
    expect(f.record(chat, 1)).toBeUndefined();
  });

  test("swiping back to a stored turn the host cannot resolve right now cancels the other swipe's plan", async () => {
    // No macro API on this host: `{{user}}` stays unresolved, the stored turn is kept.
    const MACRO = "First paragraph for {{user}}.\n\nSecond paragraph.";
    const f = fixture();
    const chat = "pc-unresolved";
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pc4");
    f.messages.push(f.message(chat, MACRO));
    f.fire("GENERATION_ENDED", { chatId: chat, messageId: "m1", content: MACRO }, "user-pc4");
    await waitFor(() => f.planner.length === 1);
    f.planner[0]!.release();
    await waitFor(() => f.turns().length === 1);

    f.swipe(chat, "user-pc4", SECOND, 1, [MACRO, SECOND]);
    await waitFor(() => f.planner.length === 2);
    f.swipe(chat, "user-pc4", MACRO, 0, [MACRO, SECOND]);
    await waitFor(() => f.turns().length === 2);
    expect(f.planner[1]?.signal?.aborted).toBe(true);
    f.planner[1]!.release();
    await settle(60);
    expect(f.turns().map((turn) => turn.swipeId)).toEqual([0, 0]);
    expect(f.activePath(chat)).toBe(turnPath(chat, "m1", 0));
  });

  test("swiping to a greeting that waits for a scene selection cancels the other swipe's plan", async () => {
    const GREETING = "{{#when::{{getvar::scene}}::is::1}}The first scene opens.{{/when}}";
    const f = fixture({ holdChecks: true });
    const chat = "pc-greeting";
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pc5");
    f.messages.push(f.message(chat, FIRST));
    f.fire("GENERATION_ENDED", { chatId: chat, messageId: "m1", content: FIRST }, "user-pc5");
    await waitFor(() => f.planner.length === 1);

    f.swipe(chat, "user-pc5", GREETING, 1);
    await waitFor(() => f.sent.some((m) => m.type === "vn_waiting"));
    expect(f.planner[0]?.signal?.aborted).toBe(true);
    f.releaseChecks();
    f.planner[0]!.release();
    await settle(60);
    expect(f.turns()).toHaveLength(0);
    expect(f.texts()).toEqual([]);
    expect(f.record(chat, 0)).toBeUndefined();
  });

  test("an older swipe whose stored turn loads slowly never replaces the newer swipe's plan", async () => {
    const chat = "pc-order";
    const f = fixture({ beforeGet: (path) => (path === turnPath(chat, "m1", 1) ? settle(40) : undefined) });
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pc6");
    f.swipe(chat, "user-pc6", SECOND, 1);
    await settle(10);
    // Swipe 2 arrives while swipe 1 is still reading its stored turn.
    f.swipe(chat, "user-pc6", THIRD, 2, [FIRST, SECOND, THIRD]);
    await waitFor(() => f.planner.some((call) => call.content.includes("A third swipe")));
    await settle(60);
    const third = f.planner.find((call) => call.content.includes("A third swipe"))!;
    expect(third.signal?.aborted).toBe(false);
    expect(f.planner.filter((call) => call.content.includes("Another swipe opens."))).toHaveLength(0);
    for (const call of f.planner) call.release();
    await waitFor(() => f.turns().length >= 1);
    await settle();
    expect(f.turns().map((turn) => turn.swipeId)).toEqual([2]);
    expect(f.texts()).toEqual([2]);
  });

  test("a plan superseded during its identity writes stops before it seeds the chat's characters", async () => {
    const chat = "pc-identity";
    let armed = false;
    let swiped = 0;
    // The first identity write after planning merges the chat's frozen
    // protagonist into its appearance roster; the cancel lands during it.
    const f: ReturnType<typeof fixture> = fixture({
      beforeGet: async (path) => {
        if (!armed || path !== `chats/${chat}/characters.json`) return;
        armed = false;
        swiped = f.sent.length;
        f.swipe(chat, "user-pc7", FIRST, 1, [VEX, FIRST]);
        await waitFor(() => f.planner[0]!.signal!.aborted);
      }
    });
    f.data.set(singleCharacterStatePath(chat), seedSingleCharacter("Mira", "silver hair, green eyes"));
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pc7");
    f.messages.push(f.message(chat, VEX));
    f.fire("GENERATION_ENDED", { chatId: chat, messageId: "m1", content: VEX }, "user-pc7");
    await waitFor(() => f.planner.length === 1);
    f.planner[0]!.release();
    armed = true;
    await waitFor(() => f.planner.length === 2);
    f.planner[1]!.release();
    await waitFor(() => f.turns().length === 1);
    await settle();
    expect(f.turns().map((turn) => turn.swipeId)).toEqual([1]);
    expect(f.texts(swiped)).toEqual([1]);
    // Nothing of the discarded swipe's cast reaches the chat's identity state.
    for (const path of [singleCharacterStatePath(chat), characterRegistryPath(chat), `chats/${chat}/characters.json`]) {
      expect(JSON.stringify(f.data.get(path) ?? null)).not.toContain("Vex");
    }
  });

  test("a plan superseded while its sprite view builds is neither persisted nor shown", async () => {
    const chat = "pc-view";
    let armed = false;
    let swiped = 0;
    // The registry write is the last identity write; the next registry read builds the view.
    const f: ReturnType<typeof fixture> = fixture({
      config: { presentationMode: "sprites", generateImages: true, maxImagesPerTurn: 2, imageConcurrency: 4, referenceAnchoring: false },
      autoRelease: true,
      beforeSet: (path) => { if (path === characterRegistryPath(chat) && f.turns().length === 0 && f.planner.length > 0 && !f.planner[0]!.signal?.aborted) armed = true; },
      beforeGet: async (path) => {
        if (!armed || path !== characterRegistryPath(chat)) return;
        armed = false;
        swiped = f.sent.length;
        f.swipe(chat, "user-pc8", SECOND, 1);
        await waitFor(() => f.planner[0]!.signal!.aborted);
      }
    });
    f.request({ type: "vn_view", chatId: chat, open: true }, "user-pc8");
    f.messages.push(f.message(chat, FIRST));
    f.fire("GENERATION_ENDED", { chatId: chat, messageId: "m1", content: FIRST }, "user-pc8");
    await waitFor(() => f.turns().length >= 1);
    await settle(60);
    expect(f.planner[0]?.signal?.aborted).toBe(true);
    expect(f.turns().map((turn) => turn.swipeId)).toEqual([1]);
    expect(f.texts(swiped)).toEqual([1]);
    expect(f.record(chat, 0)).toBeUndefined();
    expect(f.activePath(chat)).toBe(turnPath(chat, "m1", 1));
  });
});
