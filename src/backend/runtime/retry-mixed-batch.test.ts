import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend, sceneImageCache } from "./controller.js";
import { chatStatePath, turnPath, type StoredChatState, type StoredTurnRecord } from "./storage.js";
import { TurnPlanSchema, type AssetJob } from "../../shared/contracts.js";

/**
 * Regression: a `vn_retry_turn` batch that mixes a kept finished image with a
 * re-queued failed job must keep the finished image untouched, generate only
 * the unfinished one, persist its completion, and raise no error.
 * (Baseline bug: every visual cue was handed to the scheduler, which rejects
 * non-queued jobs with "Only queued asset jobs can be scheduled.")
 */

const now = new Date().toISOString();
const content = "Mira smiles.\n\nMira frowns at the window.";
const key = { chatId: "chat", assistantMessageId: "assistant-1", swipeId: 0, sourceFingerprint: "", revision: 1 };

const plan = (fingerprint: string) => TurnPlanSchema.parse({
  schemaVersion: 1,
  key: { ...key, sourceFingerprint: fingerprint },
  paragraphs: [{ index: 0, sourceIndex: 0, text: "Mira smiles." }, { index: 1, sourceIndex: 1, text: "Mira frowns at the window." }],
  scenes: [{
    sceneId: "scene-1",
    revision: 1,
    startParagraph: 0,
    environment: { location: "Library", timeOfDay: "night", weather: null, lighting: "lamplight", description: "A quiet library.", persistentElements: [] },
    cast: ["Mira"],
    continuity: { revision: 0, characters: {}, facts: {} },
    basePrompt: "quiet library",
    identityPrompt: "silver hair, green eyes",
    cameraLock: { framing: "medium wide", angle: "eye level", perspective: "fixed", lens: null, subjectAnchor: "center", horizon: "upper third", safeDialogueRegion: "lower third", aspectRatio: "16:9" },
    compositionLock: "Mira centered",
    activeAssetId: null,
    priorSceneId: null,
    character: "Mira",
    characterId: "mira",
    subjectCategory: "female",
    attire: null
  }],
  visualCues: [0, 1].map((paragraphIndex) => ({
    cueId: `cue-${paragraphIndex}`,
    paragraphIndex,
    sceneId: "scene-1",
    sceneRevision: 1,
    kind: "flattened_scene",
    action: null,
    expression: null,
    poseExpressionId: paragraphIndex === 0 ? "smile" : "idle",
    character: "Mira",
    characterId: "mira",
    subjectCategory: "female",
    resolvedIdentity: "silver hair, green eyes",
    resolvedAttire: null,
    promptDelta: "",
    assetJobId: `job-${paragraphIndex}`
  })),
  choices: [],
  initialContinuity: { revision: 0, characters: {}, facts: {} },
  continuityDeltas: [],
  terminalContinuity: { revision: 0, characters: {}, facts: {} },
  planningStatus: "planned",
  createdAt: now
});

function job(id: string, paragraphIndex: number, fingerprint: string, state: "generated" | "failed"): AssetJob {
  const base = {
    jobId: id,
    ownerTurnKey: { ...key, sourceFingerprint: fingerprint },
    sceneId: "scene-1",
    sceneRevision: 1,
    paragraphIndex,
    promptFingerprint: `fp-${id}`,
    provider: "image:default",
    priority: "visible" as const,
    queuedAt: now,
    startedAt: now
  };
  return state === "generated"
    ? { ...base, status: "generated", imageId: "img-kept", imageUrl: "/api/v1/images/img-kept", error: null, generatedAt: now, readyAt: null, finishedAt: null }
    : { ...base, status: "failed", imageId: null, imageUrl: null, error: "provider down", generatedAt: null, readyAt: null, finishedAt: now };
}

function fixture() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let frontend: ((payload: unknown, userId: string) => void) | null = null;
  const data = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const calls: Array<Record<string, unknown>> = [];
  data.set("config.json", { generateImages: true, maxImagesPerTurn: 2, imageConcurrency: 1, referenceAnchoring: false, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false });
  const spindle = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    onFrontendMessage: (handler: (payload: unknown, userId: string) => void) => { frontend = handler; },
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    },
    chat: {
      getMessages: async () => [{
        id: "assistant-1", content, is_user: false, name: "Mira", chat_id: "chat", index_in_chat: 1, send_date: 1,
        swipe_id: 0, swipes: [content], swipe_dates: [1], extra: {}, parent_message_id: "user-1", branch_id: null, created_at: 1
      }]
    },
    generate: { raw: async () => { throw new Error("planner must not run for a mixed retry"); } },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async (input: Record<string, unknown>) => {
        calls.push(input);
        return { imageId: "img-new", imageUrl: "/api/v1/images/img-new" };
      }
    },
    images: { get: async (id: string) => ({ id, url: `/api/v1/images/${id}` }) },
    sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); },
    log: { warn() {}, error() {}, info() {} }
  } as unknown as SpindleAPI;
  return { spindle, data, sent, calls, frontend: () => frontend! };
}

async function settle(condition: () => boolean, rounds = 400): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition did not settle.");
}

describe("mixed retry batch (kept finished image + re-queued failed job)", () => {
  test("keeps the finished asset untouched, generates only the failed one, persists it and raises no error", async () => {
    sceneImageCache().clear();
    const { spindle, data, sent, calls, frontend } = fixture();
    registerVisualNovelBackend(spindle);
    const { fingerprintForMessage } = await import("./planner.js");
    const fingerprint = fingerprintForMessage({ id: "assistant-1", swipe_id: 0, content });
    const path = turnPath("chat", "assistant-1", 0);
    const record: StoredTurnRecord = {
      schemaVersion: 1,
      speaker: "Mira",
      status: "ready",
      plan: plan(fingerprint),
      jobs: [job("job-0", 0, fingerprint, "generated"), job("job-1", 1, fingerprint, "failed")],
      updatedAt: now
    };
    data.set(path, record);
    const state: StoredChatState = { schemaVersion: 1, activeTurnPath: path, latestScene: record.plan.scenes[0]!, terminalContinuity: record.plan.terminalContinuity, updatedAt: now };
    data.set(chatStatePath("chat"), state);

    frontend()({ type: "vn_retry_turn", chatId: "chat", messageId: "assistant-1" }, "user-1");
    await settle(() => {
      const stored = data.get(path) as StoredTurnRecord;
      return stored.jobs.every((item) => item.status === "generated" || item.status === "browser_ready");
    });

    const stored = data.get(path) as StoredTurnRecord;
    expect(calls).toHaveLength(1);
    expect(stored.jobs.find((item) => item.jobId === "job-0")).toEqual(record.jobs[0]);
    const retried = stored.jobs.find((item) => item.jobId === "job-1")!;
    expect(retried.status).toBe("generated");
    expect(retried.imageId).toBe("img-new");
    expect(retried.error).toBeNull();
    expect(sent.some((message) => message.type === "vn_error")).toBe(false);
    const retryTurn = sent.find((message) => message.type === "vn_turn") as { turn: { assets: Array<Record<string, unknown>> } };
    expect(retryTurn.turn.assets.map((asset) => asset.status)).toEqual(["generated", "queued"]);
    const updates = sent.filter((message) => message.type === "vn_asset").map((message) => message.asset as Record<string, unknown>);
    expect(updates.every((asset) => asset.jobId === "job-1")).toBe(true);
    expect(updates.at(-1)).toMatchObject({ jobId: "job-1", status: "generated", imageId: "img-new" });
  });
});
