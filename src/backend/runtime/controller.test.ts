import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { TurnPlanSchema, type AssetJob } from "../../shared/contracts.js";
import { markAssetReady, sendState, turnView } from "./controller.js";
import { chatStatePath, singleCharacterStatePath, turnPath, type StoredChatState, type StoredTurnRecord } from "./storage.js";
import { seedSingleCharacter } from "../core/visual-state.js";
import { SINGLE_CHARACTER_SCHEMA_VERSION } from "../../shared/character.js";

const now = new Date().toISOString();
const key = {
  chatId: "chat",
  assistantMessageId: "message",
  swipeId: 0,
  sourceFingerprint: "12345678abcdef",
  revision: 0
};

const plan = TurnPlanSchema.parse({
  schemaVersion: 1,
  key,
  paragraphs: [{ index: 0, sourceIndex: 0, text: "The door opens." }],
  scenes: [{
    sceneId: "scene",
    revision: 0,
    startParagraph: 0,
    environment: {
      location: "Library",
      timeOfDay: "night",
      weather: null,
      lighting: "lamplight",
      description: "A quiet library.",
      persistentElements: []
    },
    cast: ["Mira"],
    continuity: { revision: 0, characters: {}, facts: {} },
    basePrompt: "quiet library at night",
    cameraLock: {
      framing: "medium wide",
      angle: "eye level",
      perspective: "fixed",
      lens: "50mm",
      subjectAnchor: "center",
      horizon: "upper third",
      safeDialogueRegion: "lower third",
      aspectRatio: "16:9"
    },
    compositionLock: "Mira centered",
    activeAssetId: null,
    priorSceneId: null
  }],
  visualCues: [{
    cueId: "cue",
    paragraphIndex: 0,
    sceneId: "scene",
    sceneRevision: 0,
    kind: "flattened_scene",
    action: null,
    expression: null,
    promptDelta: "Mira looks toward the door",
    assetJobId: "job"
  }],
  choices: [],
  initialContinuity: { revision: 0, characters: {}, facts: {} },
  continuityDeltas: [],
  terminalContinuity: { revision: 0, characters: {}, facts: {} },
  planningStatus: "planned",
  createdAt: now
});

function generatedJob(): AssetJob {
  return {
    jobId: "job",
    ownerTurnKey: key,
    sceneId: "scene",
    sceneRevision: 0,
    paragraphIndex: 0,
    promptFingerprint: "prompt-fingerprint",
    provider: "image:default",
    priority: "visible",
    status: "generated",
    imageId: "image",
    imageUrl: "/api/v1/images/image",
    error: null,
    queuedAt: now,
    startedAt: now,
    generatedAt: now,
    readyAt: null,
    finishedAt: null
  };
}

function runtime(record: StoredTurnRecord): { spindle: SpindleAPI; writes: Map<string, unknown>; sent: unknown[] } {
  const path = turnPath("chat", "message", 0);
  const state: StoredChatState = {
    schemaVersion: 1,
    activeTurnPath: path,
    latestScene: plan.scenes[0]!,
    terminalContinuity: plan.terminalContinuity,
    updatedAt: now
  };
  const data = new Map<string, unknown>([[chatStatePath("chat"), state], [path, record]]);
  const writes = new Map<string, unknown>();
  const sent: unknown[] = [];
  const spindle = {
    userStorage: {
      getJson: async (storagePath: string, options: { fallback: unknown }) => data.get(storagePath) ?? options.fallback,
      setJson: async (storagePath: string, value: unknown) => {
        data.set(storagePath, value);
        writes.set(storagePath, value);
      }
    },
    sendToFrontend: (message: unknown) => { sent.push(message); }
  } as unknown as SpindleAPI;
  return { spindle, writes, sent };
}

describe("runtime asset readiness", () => {
  test("turn views expose the stable job identity", () => {
    const record: StoredTurnRecord = { schemaVersion: 1, speaker: "Mira", status: "ready", plan, jobs: [generatedJob()], updatedAt: now };
    expect(turnView(record).assets[0]?.jobId).toBe("job");
  });

  test("persists browser readiness only for the active fingerprint", async () => {
    const record: StoredTurnRecord = { schemaVersion: 1, speaker: "Mira", status: "ready", plan, jobs: [generatedJob()], updatedAt: now };
    const { spindle, writes, sent } = runtime(record);
    await markAssetReady(spindle, {
      type: "vn_asset_ready",
      chatId: "chat",
      messageId: "message",
      jobId: "job",
      sourceFingerprint: key.sourceFingerprint
    });
    const stored = writes.get(turnPath("chat", "message", 0)) as StoredTurnRecord;
    expect(stored.jobs[0]?.status).toBe("browser_ready");
    expect(stored.jobs[0]?.readyAt).toBeString();
    expect((sent[0] as { asset: AssetJob }).asset.status).toBe("browser_ready");
  });

  test("ignores readiness from an obsolete turn", async () => {
    const record: StoredTurnRecord = { schemaVersion: 1, speaker: "Mira", status: "ready", plan, jobs: [generatedJob()], updatedAt: now };
    const { spindle, writes, sent } = runtime(record);
    await markAssetReady(spindle, {
      type: "vn_asset_ready",
      chatId: "chat",
      messageId: "message",
      jobId: "job",
      sourceFingerprint: "obsolete-fingerprint"
    });
    expect(writes.size).toBe(0);
    expect(sent).toHaveLength(0);
  });
});


type PlanningMsg = {
  id: string;
  content: string;
  is_user: boolean;
  name: string;
};

function planningRuntime(
  messages: PlanningMsg[],
  options: {
    initial?: ReadonlyMap<string, unknown>;
    generateRaw?: () => unknown;
  } = {}
): {
  spindle: SpindleAPI;
  data: Map<string, unknown>;
  sent: Array<Record<string, unknown>>;
  generateCalls: () => number;
} {
  const data = new Map<string, unknown>(options.initial ?? []);
  data.set("config.json", { generateImages: false, maxImagesPerTurn: 4, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false });
  const sent: Array<Record<string, unknown>> = [];
  let generateCalls = 0;
  const spindle = {
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown }) => data.get(path) ?? readOptions.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    },
    chat: {
      getMessages: async () => messages.map((m) => ({
        ...m,
        chat_id: "chat-controller",
        index_in_chat: 1,
        send_date: 1,
        swipe_id: 0,
        swipes: [m.content],
        swipe_dates: [1],
        extra: {},
        parent_message_id: m.is_user ? null : "user-1",
        branch_id: null,
        created_at: 1,
        role: m.is_user ? "user" : "assistant"
      }))
    },
    generate: {
      raw: async () => {
        generateCalls += 1;
        if (options.generateRaw) return { content: JSON.stringify(options.generateRaw()) };
        throw new Error("planner unavailable");
      }
    },
    sendToFrontend: (payload: Record<string, unknown>) => { sent.push(payload); },
    log: { warn() {}, error() {}, info() {} }
  } as unknown as SpindleAPI;
  return { spindle, data, sent, generateCalls: () => generateCalls };
}

function singleCharacterPayload(description: string) {
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
    characters: [{ name: "Mira", description }]
  };
}

describe("single-character planning flow", () => {
  test("seeds the single-character state once from the planner on a fresh chat", async () => {
    const runtime = planningRuntime([
      { id: "user-1", content: "Open the door.", is_user: true, name: "User" },
      { id: "assistant-1", content: "Mira steps forward.", is_user: false, name: "Mira" }
    ], { generateRaw: () => singleCharacterPayload("silver hair, green eyes") });

    await sendState(runtime.spindle, "chat-controller", "user-1");

    const stored = runtime.data.get(singleCharacterStatePath("chat-controller")) as Record<string, unknown>;
    expect(stored.schemaVersion).toBe(SINGLE_CHARACTER_SCHEMA_VERSION);
    expect((stored.protagonist as Record<string, unknown>).name).toBe("Mira");
    expect((stored.protagonist as Record<string, unknown>).tags).toEqual(["silver hair", "green eyes"]);
  });

  test("freezes the seeded identity on a later plan even if the planner drifts", async () => {
    const seeded = seedSingleCharacter("Mira", "brown hair, violet eyes");
    const runtime = planningRuntime([
      { id: "user-2", content: "Continue.", is_user: true, name: "User" },
      { id: "assistant-2", content: "A new scene begins.", is_user: false, name: "Mira" }
    ], {
      initial: new Map<string, unknown>([[singleCharacterStatePath("chat-controller"), seeded]]),
      generateRaw: () => singleCharacterPayload("silver hair, green eyes, red coat")
    });

    await sendState(runtime.spindle, "chat-controller", "user-1");

    const stored = runtime.data.get(singleCharacterStatePath("chat-controller")) as Record<string, unknown>;
    // Frozen identity wins; the planner's drifted description is ignored.
    expect((stored.protagonist as Record<string, unknown>).name).toBe("Mira");
    expect((stored.protagonist as Record<string, unknown>).tags).toEqual(["brown hair", "violet eyes"]);
  });

  test("re-sends a valid stored turn without re-planning (reuse guard)", async () => {
    const record: StoredTurnRecord = { schemaVersion: 1, speaker: "Mira", status: "ready", plan, jobs: [], updatedAt: now };
    const path = turnPath("chat", "message", 0);
    const state: StoredChatState = {
      schemaVersion: 1,
      activeTurnPath: path,
      latestScene: plan.scenes[0]!,
      terminalContinuity: plan.terminalContinuity,
      updatedAt: now
    };
    const runtime = planningRuntime([], {
      initial: new Map<string, unknown>([
        [chatStatePath("chat"), state],
        [path, record]
      ]),
      generateRaw: () => { throw new Error("must not re-plan"); }
    });

    await sendState(runtime.spindle, "chat", "user-1");

    // The stored turn is returned as-is; the planner is never invoked again.
    expect(runtime.sent[0]).toMatchObject({ type: "vn_state", chatId: "chat", turn: { messageId: "message" } });
    expect(runtime.generateCalls()).toBe(0);
  });
});
