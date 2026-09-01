import type {
  ChatMessageDTO,
  GenerationEndedPayloadDTO,
  MessageSwipedPayloadDTO,
  SwipeEditedPayloadDTO,
  SpindleAPI
} from "lumiverse-spindle-types";
import {
  AssetJobSchema,
  ChoiceSchema
} from "../../shared/contracts.js";
import type { FrontendRequest, AssetView, TurnView } from "../../protocol.js";
import { isFrontendRequest } from "../../protocol.js";
import { compareTurnKeys } from "../core/guards.js";
import { PlanningQueue, isAbortError } from "../core/planning-queue.js";
import { createAssetJobs, generateAssets } from "./images.js";
import { fingerprintForMessage, planTurn } from "./planner.js";
import { loadConnectionCatalog } from "./connections.js";
import {
  loadChatState,
  loadConfig,
  loadSingleCharacterState,
  loadTurnRecord,
  saveChatState,
  saveSingleCharacterState,
  saveTurnRecord,
  turnPath,
  updateConfig,
  type StoredTurnRecord
} from "./storage.js";

type NormalizedChatMessage = ChatMessageDTO & {
  role: "system" | "user" | "assistant";
  metadata?: Record<string, unknown>;
};

const planningQueue = new PlanningQueue();
const assetControllers = new Map<string, AbortController>();
const activeTurnKeys = new Map<string, StoredTurnRecord["plan"]["key"]>();

function runtimeKey(userId: string | undefined, chatId: string): string {
  return `${userId ?? "owner"}:${chatId}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assetView(record: StoredTurnRecord, job: StoredTurnRecord["jobs"][number]): AssetView {
  const cue = record.plan.visualCues.find((candidate) => candidate.assetJobId === job.jobId);
  return {
    jobId: job.jobId,
    cueId: cue?.cueId ?? job.jobId,
    paragraphIndex: job.paragraphIndex,
    status: job.status,
    ...(job.imageId ? { imageId: job.imageId } : {}),
    ...(job.imageUrl ? { imageUrl: job.imageUrl } : {}),
    ...(job.error ? { error: job.error } : {})
  };
}

export function turnView(record: StoredTurnRecord): TurnView {
  const swipe = record.plan.key.swipeId;
  return {
    chatId: record.plan.key.chatId,
    messageId: record.plan.key.assistantMessageId,
    swipeId: typeof swipe === "number" ? swipe : Number(swipe ?? 0) || 0,
    sourceFingerprint: record.plan.key.sourceFingerprint,
    revision: record.plan.key.revision,
    speaker: record.speaker,
    paragraphs: record.plan.paragraphs.map((paragraph) => paragraph.text),
    choices: record.plan.choices.map((choice) => ({ id: choice.id, label: choice.label, value: choice.submission })),
    assets: record.jobs.map((job) => assetView(record, job)),
    status: record.status,
    ...(record.error ? { error: record.error } : {})
  };
}

async function bootstrapLatestAssistantTurn(spindle: SpindleAPI, chatId: string, userId?: string): Promise<void> {
  const messages = await spindle.chat.getMessages(chatId) as NormalizedChatMessage[];
  const latest = [...messages].reverse().find((message) => !message.is_user && message.content.trim());
  if (!latest) return;
  spindle.sendToFrontend({ type: "vn_planning", chatId }, userId);
  await processAssistantMessage(spindle, chatId, latest, latest.content, userId);
}

export async function sendState(spindle: SpindleAPI, chatId: string, userId?: string): Promise<void> {
  const config = await loadConfig(spindle, userId);
  if (!chatId) {
    spindle.sendToFrontend({ type: "vn_state", chatId: "", config, turn: null }, userId);
    return;
  }
  const chatState = await loadChatState(spindle, chatId, userId);
  let record: StoredTurnRecord | null = null;
  try {
    record = await loadTurnRecord(spindle, chatState.activeTurnPath, userId);
    if (record && record.plan.key.chatId !== chatId) {
      spindle.log.warn("Stored visual novel turn belongs to another chat; rebuilding it from the current chat.");
      record = null;
    }
  } catch (error) {
    spindle.log.warn(`Stored visual novel turn could not be loaded; rebuilding it from chat: ${errorText(error)}`);
  }
  spindle.sendToFrontend({
    type: "vn_state",
    chatId,
    config,
    turn: record ? turnView(record) : null
  }, userId);
  if (!record) await bootstrapLatestAssistantTurn(spindle, chatId, userId);
}

async function persistActiveTurn(
  spindle: SpindleAPI,
  record: StoredTurnRecord,
  path: string,
  userId?: string
): Promise<void> {
  await saveTurnRecord(spindle, path, record, userId);
  const lastScene = record.plan.scenes.at(-1) ?? null;
  await saveChatState(spindle, record.plan.key.chatId, {
    schemaVersion: 1,
    activeTurnPath: path,
    latestScene: lastScene,
    terminalContinuity: record.plan.terminalContinuity,
    updatedAt: new Date().toISOString()
  }, userId);
}

async function startAssets(
  spindle: SpindleAPI,
  record: StoredTurnRecord,
  path: string,
  userId?: string
): Promise<void> {
  const config = await loadConfig(spindle, userId);
  if (!config.generateImages || record.jobs.length === 0) return;
  const key = runtimeKey(userId, record.plan.key.chatId);
  assetControllers.get(key)?.abort("A newer turn replaced this asset batch.");
  const controller = new AbortController();
  assetControllers.set(key, controller);
  let current = record;

  try {
    const finalJobs = await generateAssets(
      spindle,
      record.plan,
      record.jobs,
      config,
      controller.signal,
      async (jobs, changed) => {
        const active = activeTurnKeys.get(key) ?? null;
        if (!compareTurnKeys(active, changed.ownerTurnKey).accepted) return;
        current = { ...current, jobs, updatedAt: new Date().toISOString() };
        await saveTurnRecord(spindle, path, current, userId);
        spindle.sendToFrontend({
          type: "vn_asset",
          chatId: record.plan.key.chatId,
          messageId: record.plan.key.assistantMessageId,
          asset: assetView(current, changed)
        }, userId);
      },
      userId
    );
    const active = activeTurnKeys.get(key) ?? null;
    if (compareTurnKeys(active, record.plan.key).accepted) {
      current = { ...current, jobs: finalJobs, updatedAt: new Date().toISOString() };
      await saveTurnRecord(spindle, path, current, userId);
    }
  } finally {
    if (assetControllers.get(key) === controller) assetControllers.delete(key);
  }
}

async function processAssistantMessage(
  spindle: SpindleAPI,
  chatId: string,
  message: NormalizedChatMessage,
  content: string,
  userId?: string
): Promise<void> {
  if (!content.trim() || message.is_user) return;
  const path = turnPath(chatId, message.id, message.swipe_id);
  const existing = await loadTurnRecord(spindle, path, userId);
  const fingerprint = fingerprintForMessage({ id: message.id, swipe_id: message.swipe_id, content });
  if (existing?.plan.key.sourceFingerprint === fingerprint) {
    const key = runtimeKey(userId, chatId);
    activeTurnKeys.set(key, existing.plan.key);
    await persistActiveTurn(spindle, existing, path, userId);
    spindle.sendToFrontend({ type: "vn_turn", turn: turnView(existing) }, userId);
    return;
  }

  const dedupeId = `${message.id}:${message.swipe_id}:${fingerprint}`;
  const scheduled = planningQueue.enqueue(userId, chatId, message.id, async (operation) => {
    const config = await loadConfig(spindle, userId);
    const chatState = await loadChatState(spindle, chatId, userId);
    const singleCharacter = await loadSingleCharacterState(spindle, chatId, userId);
    const messages = await spindle.chat.getMessages(chatId) as NormalizedChatMessage[];
    const result = await planTurn(spindle, {
      chatId,
      message,
      content,
      previousScene: chatState.latestScene,
      previousContinuity: chatState.terminalContinuity,
      recentMessages: messages.slice(-config.includeRecentMessages),
      config,
      singleCharacter,
      ...(userId ? { userId } : {})
    });
    if (operation.controller.signal.aborted) return;
    await saveSingleCharacterState(spindle, chatId, result.singleCharacter, userId);
    const jobs = config.generateImages ? createAssetJobs(result.plan) : [];
    const record: StoredTurnRecord = {
      schemaVersion: 1,
      speaker: message.name || "Narrator",
      status: "ready",
      plan: result.plan,
      jobs,
      updatedAt: new Date().toISOString()
    };
    const key = runtimeKey(userId, chatId);
    activeTurnKeys.set(key, record.plan.key);
    await persistActiveTurn(spindle, record, path, userId);
    spindle.sendToFrontend({ type: "vn_turn", turn: turnView(record) }, userId);
    void startAssets(spindle, record, path, userId).catch((error) => {
      if (!isAbortError(error)) {
        spindle.log.error(`Visual novel asset pipeline failed: ${errorText(error)}`);
        spindle.sendToFrontend({ type: "vn_error", chatId, operation: "generate_assets", error: errorText(error) }, userId);
      }
    });
  }, dedupeId);

  try {
    await scheduled.promise;
  } catch (error) {
    if (isAbortError(error, scheduled.operation.controller.signal)) return;
    spindle.sendToFrontend({ type: "vn_error", chatId, operation: "plan_turn", error: errorText(error) }, userId);
    throw error;
  }
}

async function generationEnded(spindle: SpindleAPI, payload: GenerationEndedPayloadDTO, userId?: string): Promise<void> {
  spindle.sendToFrontend({
    type: "vn_generation",
    chatId: payload.chatId,
    active: false,
    ...(payload.error ? { error: payload.error } : {})
  }, userId);
  if (payload.error || !payload.content) return;
  const messages = await spindle.chat.getMessages(payload.chatId) as NormalizedChatMessage[];
  const message = payload.messageId
    ? messages.find((candidate) => candidate.id === payload.messageId)
    : [...messages].reverse().find((candidate) => !candidate.is_user);
  if (!message) throw new Error("The generated assistant message could not be found.");
  await processAssistantMessage(spindle, payload.chatId, message, payload.content, userId);
}

function submissionMetadata(message: NormalizedChatMessage): Record<string, unknown> {
  const metadata = message.metadata;
  return metadata && typeof metadata === "object" ? metadata : {};
}

async function submit(spindle: SpindleAPI, request: Extract<FrontendRequest, { type: "vn_submit" }>, userId: string): Promise<void> {
  const existing = await spindle.chat.getMessages(request.chatId) as NormalizedChatMessage[];
  const alreadyWritten = existing.some((message) => {
    const vn = submissionMetadata(message).visualNovelPreview;
    return vn !== null && typeof vn === "object" && (vn as { requestId?: unknown }).requestId === request.requestId;
  });
  if (alreadyWritten) {
    spindle.sendToFrontend({
      type: "vn_error",
      chatId: request.chatId,
      operation: "submit",
      error: "This response was already saved. The extension will not submit it twice."
    }, userId);
    return;
  }

  try {
    await spindle.chat.appendMessage(request.chatId, {
      role: "user",
      content: request.content,
      metadata: { visualNovelPreview: { requestId: request.requestId } }
    }, { triggerGeneration: true });
  } catch (error) {
    const after = await spindle.chat.getMessages(request.chatId) as NormalizedChatMessage[];
    const saved = after.some((message) => {
      const vn = submissionMetadata(message).visualNovelPreview;
      return vn !== null && typeof vn === "object" && (vn as { requestId?: unknown }).requestId === request.requestId;
    });
    const detail = errorText(error);
    throw new Error(saved
      ? `Your response was saved, but Lumiverse could not start generation: ${detail}`
      : detail);
  }
}

export async function markAssetReady(
  spindle: SpindleAPI,
  request: Extract<FrontendRequest, { type: "vn_asset_ready" }>,
  userId?: string
): Promise<void> {
  const chatState = await loadChatState(spindle, request.chatId, userId);
  const record = await loadTurnRecord(spindle, chatState.activeTurnPath, userId);
  if (!record || !chatState.activeTurnPath) return;
  if (record.plan.key.assistantMessageId !== request.messageId
    || record.plan.key.sourceFingerprint !== request.sourceFingerprint) return;
  const index = record.jobs.findIndex((job) => job.jobId === request.jobId);
  if (index < 0) return;
  const job = record.jobs[index]!;
  if (job.status === "browser_ready") return;
  if (job.status !== "generated") return;
  const readyAt = new Date().toISOString();
  const readyJob = AssetJobSchema.parse({
    ...job,
    status: "browser_ready",
    readyAt,
    finishedAt: readyAt
  });
  const jobs = record.jobs.map((candidate, candidateIndex) => candidateIndex === index ? readyJob : candidate);
  const next = { ...record, jobs, updatedAt: readyAt };
  await saveTurnRecord(spindle, chatState.activeTurnPath, next, userId);
  spindle.sendToFrontend({
    type: "vn_asset",
    chatId: request.chatId,
    messageId: request.messageId,
    asset: assetView(next, readyJob)
  }, userId);
}

async function handleFrontendMessage(spindle: SpindleAPI, request: FrontendRequest, userId: string): Promise<void> {
  switch (request.type) {
    case "vn_get_state":
      await sendState(spindle, request.chatId ?? "", userId);
      return;
    case "vn_get_connection_catalog": {
      const catalog = await loadConnectionCatalog(spindle, userId);
      spindle.sendToFrontend({ type: "vn_connection_catalog", ...catalog }, userId);
      return;
    }
    case "vn_set_config": {
      const config = await updateConfig(spindle, request.patch, userId);
      spindle.sendToFrontend({ type: "vn_config", config }, userId);
      return;
    }
    case "vn_submit":
      await submit(spindle, request, userId);
      return;
    case "vn_asset_ready":
      await markAssetReady(spindle, request, userId);
      return;
    case "vn_cancel": {
      planningQueue.cancelChat(userId, request.chatId);
      assetControllers.get(runtimeKey(userId, request.chatId))?.abort("Cancelled from the visual novel UI.");
      return;
    }
    case "vn_retry_turn": {
      const messages = await spindle.chat.getMessages(request.chatId) as NormalizedChatMessage[];
      const message = messages.find((candidate) => candidate.id === request.messageId);
      if (!message) throw new Error("The assistant message no longer exists.");
      await processAssistantMessage(spindle, request.chatId, message, message.content, userId);
    }
  }
}

function eventMessage(payload: unknown): { chatId: string; message: NormalizedChatMessage } | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as { chatId?: unknown; message?: unknown };
  if (typeof candidate.chatId !== "string" || !candidate.message || typeof candidate.message !== "object") return null;
  const message = candidate.message as Partial<NormalizedChatMessage>;
  if (typeof message.id !== "string" || typeof message.content !== "string" || typeof message.is_user !== "boolean") return null;
  return { chatId: candidate.chatId, message: message as NormalizedChatMessage };
}

async function clearDeletedTurn(spindle: SpindleAPI, payload: unknown, userId?: string): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  const candidate = payload as { chatId?: unknown; messageId?: unknown };
  if (typeof candidate.chatId !== "string" || typeof candidate.messageId !== "string") return;
  const state = await loadChatState(spindle, candidate.chatId, userId);
  const record = await loadTurnRecord(spindle, state.activeTurnPath, userId);
  if (!record || record.plan.key.assistantMessageId !== candidate.messageId) return;
  planningQueue.cancelChat(userId, candidate.chatId);
  assetControllers.get(runtimeKey(userId, candidate.chatId))?.abort("The source assistant message was deleted.");
  activeTurnKeys.delete(runtimeKey(userId, candidate.chatId));
  await saveChatState(spindle, candidate.chatId, {
    schemaVersion: 1,
    activeTurnPath: null,
    latestScene: null,
    terminalContinuity: null,
    updatedAt: new Date().toISOString()
  }, userId);
  await sendState(spindle, candidate.chatId, userId);
}

function reconcileMessageEvent(spindle: SpindleAPI, payload: unknown, userId?: string): void {
  const event = eventMessage(payload);
  if (!event || event.message.is_user) return;
  void processAssistantMessage(spindle, event.chatId, event.message, event.message.content, userId).catch((error) => {
    spindle.log.error(`Visual novel message reconciliation failed: ${errorText(error)}`);
  });
}

export function registerVisualNovelBackend(spindle: SpindleAPI): void {
  spindle.on("PERMISSION_CHANGED", (payload) => {
    spindle.sendToFrontend({
      type: "vn_permission",
      permission: payload.permission,
      granted: payload.granted
    });
  });
  spindle.on("GENERATION_STARTED", (payload, userId) => {
    spindle.sendToFrontend({ type: "vn_generation", chatId: payload.chatId, active: true }, userId);
  });
  spindle.on("GENERATION_ENDED", (payload, userId) => {
    void generationEnded(spindle, payload, userId).catch((error) => {
      spindle.log.error(`Visual novel turn failed: ${errorText(error)}`);
      spindle.sendToFrontend({ type: "vn_error", chatId: payload.chatId, operation: "generation_ended", error: errorText(error) }, userId);
    });
  });
  spindle.on("GENERATION_STOPPED", (payload, userId) => {
    spindle.sendToFrontend({ type: "vn_generation", chatId: payload.chatId, active: false }, userId);
  });
  spindle.on("MESSAGE_SWIPED", (payload: MessageSwipedPayloadDTO, userId) => {
    reconcileMessageEvent(spindle, payload, userId);
  });
  spindle.on("SWIPE_EDITED", (payload: SwipeEditedPayloadDTO, userId) => {
    reconcileMessageEvent(spindle, payload, userId);
  });
  spindle.on("MESSAGE_EDITED", (payload, userId) => {
    reconcileMessageEvent(spindle, payload, userId);
  });
  spindle.on("MESSAGE_DELETED", (payload, userId) => {
    void clearDeletedTurn(spindle, payload, userId).catch((error) => {
      spindle.log.error(`Visual novel deletion reconciliation failed: ${errorText(error)}`);
    });
  });
  spindle.onFrontendMessage((payload, userId) => {
    if (!isFrontendRequest(payload)) return;
    void handleFrontendMessage(spindle, payload, userId).catch((error) => {
      const chatId = "chatId" in payload && typeof payload.chatId === "string" ? payload.chatId : undefined;
      spindle.log.error(`Visual novel frontend request failed: ${errorText(error)}`);
      spindle.sendToFrontend({ type: "vn_error", ...(chatId ? { chatId } : {}), operation: payload.type, error: errorText(error) }, userId);
    });
  });
  spindle.log.info("Visual Novel Preview loaded.");
}
