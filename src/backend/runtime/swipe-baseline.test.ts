import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { TurnPlanSchema, type TurnPlan } from "../../shared/contracts.js";
import { sendState } from "./controller.js";
import { chatStatePath, loadTurnRecord, saveTurnRecord, turnPath, type StoredChatState, type StoredTurnRecord } from "./storage.js";

// A swipe (or an edit) of the active message must plan from the state before
// that message, not from the discarded swipe's end state.

const now = new Date().toISOString();
const chatId = "chat-swipe";

function continuity(revision: number, attire: string) {
  return {
    revision,
    characters: { Rin: { present: true, appearance: {}, wardrobe: { attire }, pose: null, expression: null, props: [] } },
    facts: {}
  };
}
const before = continuity(2, "dark green bib apron, white collared shirt");
const swipeZeroEnd = continuity(3, "oversized knit sweater under a green bib apron");

function scene(sceneId: string, revision: number, location: string, attire: string | null) {
  return {
    sceneId,
    revision,
    startParagraph: 0,
    environment: { location, timeOfDay: "evening", weather: null, lighting: "warm", description: `${location}.`, persistentElements: [] },
    cast: ["Rin"],
    character: "Rin",
    attire,
    continuity: { revision: 0, characters: {}, facts: {} },
    basePrompt: location,
    cameraLock: {
      framing: "medium wide", angle: "eye level", perspective: "fixed", lens: "50mm",
      subjectAnchor: "center", horizon: "upper third", safeDialogueRegion: "lower third", aspectRatio: "16:9"
    },
    compositionLock: "Rin centered",
    activeAssetId: null,
    priorSceneId: null
  };
}
const sceneBefore = scene("scene-before", 5, "Cafe counter", "dark green bib apron, white collared shirt");

function makePlan(messageId: string, swipeId: number, revision: number, initial: unknown, terminal: unknown, location: string): TurnPlan {
  return TurnPlanSchema.parse({
    schemaVersion: 1,
    key: { chatId, assistantMessageId: messageId, swipeId, sourceFingerprint: `fingerprint-${messageId}-${swipeId}`, revision },
    paragraphs: [{ index: 0, sourceIndex: 0, text: "Old text." }],
    scenes: [scene(`scene-${messageId}-${swipeId}`, revision, location, "oversized knit sweater under a green bib apron")],
    visualCues: [],
    choices: [],
    initialContinuity: initial,
    // One delta per continuity revision step (the schema checks the count).
    continuityDeltas: Array.from({ length: (terminal as { revision: number }).revision - (initial as { revision: number }).revision }, () => ({ paragraphIndex: 0, delta: {} })),
    terminalContinuity: terminal,
    planningStatus: "planned",
    createdAt: now
  });
}

function record(plan: TurnPlan, baseline?: StoredTurnRecord["baseline"]): StoredTurnRecord {
  return { schemaVersion: 1, speaker: "Rin", status: "ready", plan, jobs: [], updatedAt: now, ...(baseline ? { baseline } : {}) };
}

type Msg = { id: string; content: string; is_user: boolean; swipe_id: number };

function runtime(messages: Msg[], initial: Array<[string, unknown]>) {
  const data = new Map<string, unknown>(initial);
  data.set("config.json", { generateImages: false, maxImagesPerTurn: 4, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false });
  const spindle = {
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    },
    chat: {
      getMessages: async () => messages.map((m, index) => ({
        ...m,
        name: m.is_user ? "User" : "Rin",
        chat_id: chatId,
        index_in_chat: index,
        send_date: 1,
        swipes: [m.content],
        swipe_dates: [1],
        extra: {},
        parent_message_id: null,
        branch_id: null,
        created_at: 1,
        role: m.is_user ? "user" : "assistant"
      }))
    },
    generate: { raw: async () => { throw new Error("planner unavailable"); } },
    sendToFrontend: () => {},
    log: { warn() {}, error() {}, info() {} }
  } as unknown as SpindleAPI;
  return { spindle, data };
}

function chatState(activeTurnPath: string, latestScene: unknown, terminalContinuity: unknown): StoredChatState {
  return { schemaVersion: 1, activeTurnPath, latestScene, terminalContinuity, updatedAt: now } as StoredChatState;
}

const swipeZeroPath = turnPath(chatId, "a1", 0);
const swipeZeroScene = { ...scene("scene-a1-0", 6, "Back room", "oversized knit sweater under a green bib apron"), continuity: swipeZeroEnd };

describe("swipe planning baseline", () => {
  test("swipe 1 of the active message plans from swipe 0's baseline, not its end state", async () => {
    const swipeZero = record(makePlan("a1", 0, 6, before, swipeZeroEnd, "Back room"), { previousScene: sceneBefore as never, previousContinuity: before as never });
    const { spindle, data } = runtime(
      [{ id: "u1", content: "Hi.", is_user: true, swipe_id: 0 }, { id: "a1", content: "Rin wipes the counter.", is_user: false, swipe_id: 1 }],
      [[chatStatePath(chatId), chatState(swipeZeroPath, swipeZeroScene, swipeZeroEnd)], [swipeZeroPath, swipeZero]]
    );
    await sendState(spindle, chatId, "user-swipe", { viewOpen: true });
    const swipeOne = data.get(turnPath(chatId, "a1", 1)) as StoredTurnRecord;
    expect(swipeOne).toBeDefined();
    expect(swipeOne.plan.initialContinuity).toEqual(before);
    expect(swipeOne.plan.key.revision).toBe(sceneBefore.revision + 1);
    expect(swipeOne.plan.scenes[0]?.environment.location).toBe("Cafe counter");
    // The new swipe keeps the same baseline for later swipes.
    expect(swipeOne.baseline?.previousScene?.sceneId).toBe("scene-before");
    expect(swipeOne.baseline?.previousContinuity).toEqual(before);
    const state = data.get(chatStatePath(chatId)) as StoredChatState;
    expect(state.activeTurnPath).toBe(turnPath(chatId, "a1", 1));
  });

  test("a new message plans from the chat's latest state", async () => {
    const swipeZero = record(makePlan("a1", 0, 6, before, swipeZeroEnd, "Back room"), { previousScene: sceneBefore as never, previousContinuity: before as never });
    const { spindle, data } = runtime(
      [
        { id: "a1", content: "Rin wipes the counter.", is_user: false, swipe_id: 0 },
        { id: "u2", content: "Nice sweater.", is_user: true, swipe_id: 0 },
        { id: "a2", content: "Rin smiles.", is_user: false, swipe_id: 0 }
      ],
      [[chatStatePath(chatId), chatState(swipeZeroPath, swipeZeroScene, swipeZeroEnd)], [swipeZeroPath, swipeZero]]
    );
    await sendState(spindle, chatId, "user-new", { viewOpen: true });
    const next = data.get(turnPath(chatId, "a2", 0)) as StoredTurnRecord;
    expect(next.plan.initialContinuity).toEqual(swipeZeroEnd);
    expect(next.plan.key.revision).toBe(7);
    expect(next.baseline?.previousScene?.sceneId).toBe("scene-a1-0");
    expect(next.baseline?.previousContinuity).toEqual(swipeZeroEnd);
  });

  test("an old record without a baseline falls back to its initial continuity and the previous turn's scene", async () => {
    const swipeZero = record(makePlan("a1", 0, 6, before, swipeZeroEnd, "Back room"));
    const previousTurn = record({ ...makePlan("a0", 0, 5, continuity(1, "x"), before, "Cafe counter"), scenes: [sceneBefore as never] });
    const { spindle, data } = runtime(
      [
        { id: "a0", content: "Rin opens the cafe.", is_user: false, swipe_id: 0 },
        { id: "u1", content: "Hi.", is_user: true, swipe_id: 0 },
        { id: "a1", content: "Rin wipes the counter.", is_user: false, swipe_id: 1 }
      ],
      [
        [chatStatePath(chatId), chatState(swipeZeroPath, swipeZeroScene, swipeZeroEnd)],
        [swipeZeroPath, swipeZero],
        [turnPath(chatId, "a0", 0), previousTurn]
      ]
    );
    await sendState(spindle, chatId, "user-legacy", { viewOpen: true });
    const swipeOne = data.get(turnPath(chatId, "a1", 1)) as StoredTurnRecord;
    expect(swipeOne.plan.initialContinuity).toEqual(before);
    expect(swipeOne.plan.key.revision).toBe(6);
    expect(swipeOne.baseline?.previousScene?.sceneId).toBe("scene-before");
  });

  test("an old record of the first assistant turn falls back to no previous scene", async () => {
    const empty = { revision: 0, characters: {}, facts: {} };
    const swipeZero = record(makePlan("a1", 0, 1, empty, swipeZeroEnd, "Back room"));
    const { spindle, data } = runtime(
      [{ id: "u1", content: "Hi.", is_user: true, swipe_id: 0 }, { id: "a1", content: "Rin wipes the counter.", is_user: false, swipe_id: 1 }],
      [[chatStatePath(chatId), chatState(swipeZeroPath, swipeZeroScene, swipeZeroEnd)], [swipeZeroPath, swipeZero]]
    );
    await sendState(spindle, chatId, "user-first", { viewOpen: true });
    const swipeOne = data.get(turnPath(chatId, "a1", 1)) as StoredTurnRecord;
    expect(swipeOne.plan.initialContinuity).toEqual(empty);
    expect(swipeOne.plan.key.revision).toBe(1);
    expect(swipeOne.baseline).toEqual({ previousScene: null, previousContinuity: empty });
  });

  test("loadTurnRecord keeps a valid baseline and drops a broken one", async () => {
    const { spindle, data } = runtime([], []);
    const stored = record(makePlan("a1", 0, 6, before, swipeZeroEnd, "Back room"), { previousScene: sceneBefore as never, previousContinuity: before as never });
    await saveTurnRecord(spindle, "turn.json", stored);
    const loaded = await loadTurnRecord(spindle, "turn.json");
    expect(loaded?.baseline?.previousScene?.sceneId).toBe("scene-before");
    expect(loaded?.baseline?.previousContinuity).toEqual(before);
    data.set("empty.json", { ...stored, baseline: { previousScene: null, previousContinuity: null } });
    expect((await loadTurnRecord(spindle, "empty.json"))?.baseline).toEqual({ previousScene: null, previousContinuity: null });
    data.set("broken.json", { ...stored, baseline: { previousScene: { sceneId: 1 }, previousContinuity: before } });
    expect((await loadTurnRecord(spindle, "broken.json"))?.baseline).toBeUndefined();
    data.set("old.json", { ...stored, baseline: undefined });
    expect((await loadTurnRecord(spindle, "old.json"))?.baseline).toBeUndefined();
  });
});
