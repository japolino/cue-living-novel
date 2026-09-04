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
import { resolveNativeCardJobs } from "./native-assets.js";
import { createAssetJobs, generateAssets } from "./images.js";
import { fingerprintForMessage, planTurn } from "./planner.js";
import { loadConnectionCatalog } from "./connections.js";
import {
  clearAudioCatalogCache,
  normalizeAudioStoragePrefix,
  resolveAudioUrl,
  scanAudioCatalog,
  SUPPORTED_AUDIO_EXTENSIONS
} from "./audio-catalog.js";
import {
  loadCharacterAppearance,
  loadChatState,
  loadConfig,
  loadSingleCharacterState,
  loadTurnRecord,
  mergeCharacterAppearanceFromState,
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

/* ------------------------------------------------------------------ *
 * Verbose debug logging ("listening" trace).
 *
 * When `debugLogging` is enabled every host event the extension listens to,
 * every planning run, and every asset transition is traced to the Lumiverse
 * log with a stable `[VN]` prefix. The flag is cached per user because host
 * events arrive before any config read; the cache refreshes on every config
 * load, so toggling the setting applies from the next event on.
 * ------------------------------------------------------------------ */

const debugFlags = new Map<string, boolean>();

/**
 * Audio imports arrive as one message per file followed by a "done" marker.
 * Messages are handled concurrently, so the done handler must wait for every
 * pending write before rescanning the catalog.
 */
const pendingAudioImports = new Map<string, Promise<void>[]>();

/**
 * Reassembly buffers for chunked audio imports. The host WebSocket bridge
 * caps a frontend->backend message at 4 MB, so files larger than one chunk
 * arrive as ordered pieces sharing a transferId.
 */
const audioImportBuffers = new Map<string, { chunks: Array<string | undefined>; received: number }>();

/** Maximum assembled base64 size (~30 MB of raw audio). */
export const MAX_AUDIO_IMPORT_BASE64 = 40 * 1024 * 1024;

/**
 * Accept one chunk of a (possibly single-chunk) audio import. Returns the
 * complete base64 payload once every chunk has arrived, otherwise null.
 * Oversized transfers throw and drop their buffer.
 */
export function acceptAudioImportChunk(
  bufferKey: string,
  part: { dataBase64: string; chunkIndex?: number; chunkCount?: number }
): string | null {
  const chunkCount = part.chunkCount && part.chunkCount > 1 ? Math.floor(part.chunkCount) : 1;
  if (chunkCount === 1) {
    if (part.dataBase64.length > MAX_AUDIO_IMPORT_BASE64) throw new Error("Audio file too large to import (30 MB max).");
    return part.dataBase64;
  }
  const index = Math.floor(part.chunkIndex ?? 0);
  if (index < 0 || index >= chunkCount) return null;
  const buffer = audioImportBuffers.get(bufferKey) ?? { chunks: new Array<string | undefined>(chunkCount), received: 0 };
  if (buffer.chunks.length !== chunkCount) {
    audioImportBuffers.delete(bufferKey);
    return null;
  }
  if (buffer.chunks[index] === undefined) buffer.received += 1;
  buffer.chunks[index] = part.dataBase64;
  const assembledSoFar = buffer.chunks.reduce((total, chunk) => total + (chunk?.length ?? 0), 0);
  if (assembledSoFar > MAX_AUDIO_IMPORT_BASE64) {
    audioImportBuffers.delete(bufferKey);
    throw new Error("Audio file too large to import (30 MB max).");
  }
  audioImportBuffers.set(bufferKey, buffer);
  if (buffer.received < chunkCount) return null;
  audioImportBuffers.delete(bufferKey);
  return buffer.chunks.join("");
}

/** Drop any unfinished chunk buffers for a user's import session. */
export function clearAudioImportBuffers(userKey: string): void {
  for (const key of [...audioImportBuffers.keys()]) {
    if (key.startsWith(`${userKey}:`)) audioImportBuffers.delete(key);
  }
}

/**
 * Make a browser-supplied relative path safe for scoped storage: forward
 * slashes, no drive letters, no leading slashes, no dot segments.
 */
export function sanitizeAudioImportPath(relativePath: string): string | null {
  const normalized = relativePath
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:\//, "")
    .replace(/^\/+/, "");
  const parts = normalized.split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  if (parts.length === 0) return null;
  return parts.join("/");
}

function rememberDebugFlag(userId: string | undefined, config: { debugLogging: boolean }): void {
  debugFlags.set(userId ?? "owner", config.debugLogging);
}

function dbg(spindle: SpindleAPI, userId: string | undefined, message: string): void {
  if (debugFlags.get(userId ?? "owner")) spindle.log.info(`[VN] ${message}`);
}

function summarizeDiagnostics(diagnostics: {
  chatLoaded: boolean;
  characterLoaded: boolean;
  personaLoaded: boolean;
  loreActivated: number;
  loreIncluded: number;
  errors: string[];
}): string {
  const parts = [
    `character=${diagnostics.characterLoaded ? "yes" : "no"}`,
    `persona=${diagnostics.personaLoaded ? "yes" : "no"}`,
    `lore=${diagnostics.loreIncluded}/${diagnostics.loreActivated}`
  ];
  if (diagnostics.errors.length > 0) parts.push(`errors=[${diagnostics.errors.join("; ")}]`);
  return parts.join(" ");
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
  // Prefer the dedicated audio cue list (added so audio survives the image-cue
  // limit); fall back to bgm/sfx on visual cues for turns planned before this
  // field existed.
  const toAudioView = (cue: { paragraphIndex: number; bgm?: string | null | undefined; sfx?: string | null | undefined }) => ({
    paragraphIndex: cue.paragraphIndex,
    ...(cue.bgm ? { bgm: cue.bgm, bgmUrl: resolveAudioUrl(cue.bgm, "bgm") } : {}),
    ...(cue.sfx ? { sfx: cue.sfx, sfxUrl: resolveAudioUrl(cue.sfx, "sfx") } : {}),
  });
  const audioCues = (record.plan.audioCues?.length
    ? record.plan.audioCues
    : record.plan.visualCues.filter((cue) => Boolean(cue.bgm || cue.sfx))
  ).map(toAudioView);

  return {
    chatId: record.plan.key.chatId,
    messageId: record.plan.key.assistantMessageId,
    swipeId: typeof swipe === "number" ? swipe : Number(swipe ?? 0) || 0,
    sourceFingerprint: record.plan.key.sourceFingerprint,
    revision: record.plan.key.revision,
    speaker: record.speaker,
    userSpeaker: record.userSpeaker || "You",
    paragraphs: record.plan.paragraphs.map((paragraph) => paragraph.text),
    choices: record.plan.choices.map((choice) => ({ id: choice.id, label: choice.label, value: choice.submission })),
    assets: record.jobs.map((job) => assetView(record, job)),
    ...(audioCues.length > 0 ? { audioCues } : {}),
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
  rememberDebugFlag(userId, config);
  if (!config.generateImages || record.jobs.length === 0) return;
  dbg(spindle, userId, `assets starting: ${record.jobs.length} job(s) for chat=${record.plan.key.chatId} message=${record.plan.key.assistantMessageId} concurrency=${config.imageConcurrency}`);
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
        dbg(spindle, userId, `asset ${changed.jobId} p${changed.paragraphIndex} [${changed.priority}] -> ${changed.status}${changed.imageId ? ` image=${changed.imageId}` : ""}${changed.error ? ` error="${changed.error}"` : ""}`);
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
    dbg(spindle, userId, `turn reused from storage chat=${chatId} message=${message.id} fingerprint=${fingerprint}`);
    const key = runtimeKey(userId, chatId);
    activeTurnKeys.set(key, existing.plan.key);
    await persistActiveTurn(spindle, existing, path, userId);
    spindle.sendToFrontend({ type: "vn_turn", turn: turnView(existing) }, userId);
    return;
  }

  const dedupeId = `${message.id}:${message.swipe_id}:${fingerprint}`;
  dbg(spindle, userId, `planning enqueued chat=${chatId} message=${message.id} swipe=${message.swipe_id} fingerprint=${fingerprint}`);
  const scheduled = planningQueue.enqueue(userId, chatId, message.id, async (operation) => {
    const planningStartedAt = Date.now();
    const config = await loadConfig(spindle, userId);
    rememberDebugFlag(userId, config);
    const chatState = await loadChatState(spindle, chatId, userId);
    const singleCharacter = await loadSingleCharacterState(spindle, chatId, userId);
    const characterAppearance = await loadCharacterAppearance(spindle, userId);
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
      characterAppearance,
      ...(userId ? { userId } : {})
    });
    if (operation.controller.signal.aborted) return;
    dbg(spindle, userId, [
      `planned chat=${chatId} message=${message.id} in ${Date.now() - planningStartedAt}ms`,
      `fallback=${result.usedFallback ? "yes" : "no"}`,
      `paragraphs=${result.plan.paragraphs.length}`,
      `scenes=${result.plan.scenes.length} (${result.plan.scenes.map((scene) => `${scene.sceneId}@p${scene.startParagraph} rev${scene.revision} "${scene.environment.location}"`).join(", ")})`,
      `cues=${result.plan.visualCues.length} [${result.plan.visualCues.map((cue) => `p${cue.paragraphIndex}:${cue.poseExpressionId ?? "?"}${cue.character ? `(${cue.character})` : ""}`).join(", ")}]`,
      `audio=${result.plan.audioCues.length} [${result.plan.audioCues.map((cue) => `p${cue.paragraphIndex}:${[cue.bgm ? `bgm=${cue.bgm}` : "", cue.sfx ? `sfx=${cue.sfx}` : ""].filter(Boolean).join("+")}`).join(", ")}]`,
      `choices=${result.plan.choices.length}`,
      `protagonist="${result.singleCharacter.protagonist.name}" tags=${result.singleCharacter.protagonist.tags.length}`,
      `context: ${summarizeDiagnostics(result.contextDiagnostics)}`
    ].join(" | "));
    await saveSingleCharacterState(spindle, chatId, result.singleCharacter, userId);
    await mergeCharacterAppearanceFromState(spindle, result.singleCharacter, userId);
        let jobs: StoredTurnRecord["jobs"] = [];
    if (config.useNativeCardImages) {
      try {
        jobs = await resolveNativeCardJobs({
          spindle,
          chatId,
          plan: result.plan,
          content,
          speakerName: message.name,
          userId,
        });
      } catch (err) {
        if (config.debugLogging) spindle.log.warn(`Native card image resolution failed: ${errorText(err)}`);
      }
    } else if (config.generateImages) {
      jobs = createAssetJobs(result.plan, config);
    }
    let userSpeaker = "You";
    try {
      const persona = await spindle.personas?.getActive?.(userId);
      if (persona?.name?.trim()) {
        userSpeaker = persona.name.trim();
      }
    } catch {}
    if (userSpeaker === "You") {
      try {
        const recent = (await spindle.chat.getMessages(chatId) as NormalizedChatMessage[]);
        const lastUser = [...recent].reverse().find((m) => m.role === "user" || Boolean(m.is_user));
        if (lastUser?.name?.trim()) {
          userSpeaker = lastUser.name.trim();
        }
      } catch {}
    }

    const record: StoredTurnRecord = {
      schemaVersion: 1,
      speaker: message.name || "Narrator",
      userSpeaker,
      status: "ready",
      plan: result.plan,
      jobs,
      updatedAt: new Date().toISOString()
    };
    const key = runtimeKey(userId, chatId);
    activeTurnKeys.set(key, record.plan.key);
    await persistActiveTurn(spindle, record, path, userId);
    spindle.sendToFrontend({ type: "vn_turn", turn: turnView(record) }, userId);
    if (!config.useNativeCardImages && config.generateImages) {
      void startAssets(spindle, record, path, userId).catch((error) => {
        if (!isAbortError(error)) {
          spindle.log.error(`Visual novel asset pipeline failed: ${errorText(error)}`);
          spindle.sendToFrontend({ type: "vn_error", chatId, operation: "generate_assets", error: errorText(error) }, userId);
        }
      });
    }
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
  dbg(spindle, userId, `event GENERATION_ENDED chat=${payload.chatId} message=${payload.messageId ?? "latest"} contentChars=${payload.content?.length ?? 0}${payload.error ? ` error=${payload.error}` : ""}`);
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
  dbg(spindle, userId, `asset ${readyJob.jobId} p${readyJob.paragraphIndex} -> browser_ready (decoded in browser)`);
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
  dbg(spindle, userId, `frontend request ${request.type}`);
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
      rememberDebugFlag(userId, config);
      dbg(spindle, userId, `config saved (${Object.keys(request.patch).length} field(s) in patch)`);
      if (request.patch.audioDirectory !== undefined) {
        void scanAudioCatalog(spindle, config.audioDirectory);
      }
      spindle.sendToFrontend({ type: "vn_config", config }, userId);
      return;
    }
    case "vn_scan_audio": {
      const config = await loadConfig(spindle, userId);
      const dir = request.directory?.trim() || config.audioDirectory;
      const catalog = await scanAudioCatalog(spindle, dir);
      spindle.sendToFrontend({
        type: "vn_audio_scanned",
        bgmCount: catalog.bgm.length,
        sfxCount: catalog.sfx.length,
      }, userId);
      return;
    }
    case "vn_import_audio_file": {
      const cleaned = sanitizeAudioImportPath(request.relativePath);
      if (!cleaned) return;
      const dot = cleaned.lastIndexOf(".");
      const extension = dot >= 0 ? cleaned.slice(dot).toLowerCase() : "";
      if (!(SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(extension)) return;
      const bufferKey = `${userId ?? "owner"}:${request.transferId ?? cleaned}`;
      const assembled = acceptAudioImportChunk(bufferKey, request);
      if (assembled === null) {
        dbg(spindle, userId, `audio chunk ${((request.chunkIndex ?? 0) + 1)}/${request.chunkCount ?? 1} buffered for ${cleaned}`);
        return;
      }
      const dataBase64 = assembled;
      const config = await loadConfig(spindle, userId);
      const prefix = normalizeAudioStoragePrefix(config.audioDirectory || "audio");
      const target = `${prefix}/${cleaned}`;
      const write = (async () => {
        const bytes = Uint8Array.from(atob(dataBase64), (character) => character.charCodeAt(0));
        const directory = target.split("/").slice(0, -1).join("/");
        if (directory) await spindle.storage.mkdir(directory).catch(() => {});
        await spindle.storage.writeBinary(target, bytes);
        dbg(spindle, userId, `audio imported ${target} (${bytes.length} bytes)`);
      })();
      const pendingKey = userId ?? "owner";
      const pending = pendingAudioImports.get(pendingKey) ?? [];
      pending.push(write.catch((error) => {
        spindle.log.warn(`Audio import failed for ${target}: ${errorText(error)}`);
      }));
      pendingAudioImports.set(pendingKey, pending);
      await write;
      return;
    }
    case "vn_import_audio_done": {
      const pendingKey = userId ?? "owner";
      clearAudioImportBuffers(pendingKey);
      const pending = pendingAudioImports.get(pendingKey) ?? [];
      pendingAudioImports.delete(pendingKey);
      await Promise.allSettled(pending);
      const config = await loadConfig(spindle, userId);
      clearAudioCatalogCache();
      const catalog = await scanAudioCatalog(spindle, config.audioDirectory || "audio");
      dbg(spindle, userId, `audio import finished: ${request.fileCount} file(s) sent, catalog now ${catalog.bgm.length} BGM / ${catalog.sfx.length} SFX`);
      spindle.sendToFrontend({
        type: "vn_audio_scanned",
        bgmCount: catalog.bgm.length,
        sfxCount: catalog.sfx.length,
      }, userId);
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
    dbg(spindle, userId, `event GENERATION_STARTED chat=${payload.chatId}`);
    // A new generation is starting (a user message was submitted). Drop any
    // ownership of the previous turn's assets so queued old-turn ComfyUI calls
    // cannot start and running completions cannot persist/send, then abort the
    // current asset batch. The new turn's ownership is re-established when it is
    // actually planned (processAssistantMessage -> activeTurnKeys.set).
    const key = runtimeKey(userId, payload.chatId);
    activeTurnKeys.delete(key);
    assetControllers.get(key)?.abort("A new generation started before this turn's assets settled.");
    spindle.sendToFrontend({ type: "vn_generation", chatId: payload.chatId, active: true }, userId);
  });
  spindle.on("GENERATION_ENDED", (payload, userId) => {
    void generationEnded(spindle, payload, userId).catch((error) => {
      spindle.log.error(`Visual novel turn failed: ${errorText(error)}`);
      spindle.sendToFrontend({ type: "vn_error", chatId: payload.chatId, operation: "generation_ended", error: errorText(error) }, userId);
    });
  });
  spindle.on("GENERATION_STOPPED", (payload, userId) => {
    dbg(spindle, userId, `event GENERATION_STOPPED chat=${payload.chatId}`);
    spindle.sendToFrontend({ type: "vn_generation", chatId: payload.chatId, active: false }, userId);
  });
  spindle.on("MESSAGE_SWIPED", (payload: MessageSwipedPayloadDTO, userId) => {
    dbg(spindle, userId, "event MESSAGE_SWIPED");
    reconcileMessageEvent(spindle, payload, userId);
  });
  spindle.on("SWIPE_EDITED", (payload: SwipeEditedPayloadDTO, userId) => {
    dbg(spindle, userId, "event SWIPE_EDITED");
    reconcileMessageEvent(spindle, payload, userId);
  });
  spindle.on("MESSAGE_EDITED", (payload, userId) => {
    dbg(spindle, userId, "event MESSAGE_EDITED");
    reconcileMessageEvent(spindle, payload, userId);
  });
  spindle.on("MESSAGE_DELETED", (payload, userId) => {
    dbg(spindle, userId, "event MESSAGE_DELETED");
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
  void loadConfig(spindle).then((cfg) => {
    rememberDebugFlag(undefined, cfg);
    void scanAudioCatalog(spindle, cfg.audioDirectory || "audio");
  }).catch(() => {});
  spindle.log.info("Cue — Living Novel loaded.");
}
