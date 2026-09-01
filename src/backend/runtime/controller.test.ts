import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { TurnPlanSchema, type AssetJob } from "../../shared/contracts.js";
import { markAssetReady, turnView } from "./controller.js";
import { chatStatePath, turnPath, type StoredChatState, type StoredTurnRecord } from "./storage.js";

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
