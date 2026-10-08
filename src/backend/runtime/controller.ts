import type {
  ChatMessageDTO,
  GenerationEndedPayloadDTO,
  MessageSwipedPayloadDTO,
  SwipeEditedPayloadDTO,
  SpindleAPI
} from "lumiverse-spindle-types";
import { createExternalImages } from "./external-images.js";
import {
  AssetJobSchema,
  ChoiceSchema,
  type AssetJob
} from "../../shared/contracts.js";
import type { FrontendRequest, AssetView, TurnView } from "../../protocol.js";
import type { VisualNovelConfig } from "../../config.js";
import { SpriteCastMemberSchema, SpriteStagingSchema, type SpriteCastMember, type SpriteParagraphStage, type SpriteStaging } from "../../shared/sprites.js";
import { characterAppearanceKey, type CharacterRegistry } from "../../shared/identity.js";
import { buildSpriteStaging, deterministicSpriteStaging, isPersonaName, sanitizeStoredStaging } from "./sprite-staging.js";
import { SpriteService, spriteStyleKey } from "./sprites/index.js";
import { isSpritePlannedRecord, keyIllustrationCap, keyIllustrationCues, keyIllustrationViews } from "./sprites/key-moments.js";
import { keyMomentScenes } from "./sprites/moment-prompts.js";
import { resolvePanelTemplate } from "./panel-templates.js";
import { ViewRegistry } from "./view-registry.js";
import { isFrontendRequest } from "../../protocol.js";
import { compareTurnKeys, turnKeyEquals } from "../core/guards.js";
import { PlanningQueue, isAbortError } from "../core/planning-queue.js";
import { resolveNativeCardJobs } from "./native-assets.js";
import { handleReferenceImageResponse } from "./reference-source.js";
import { CACHE_JOB_PROVIDER, createAssetJobs, prepareAssetJobs, generateAssets, resolveCacheCues, retainPlanEpisodes } from "./images.js";
import { SceneImageCache, sceneImageScope } from "../core/scene-image-cache.js";
import { fingerprintForMessage, gameHintsForTurn, planTurn } from "./planner.js";
import {
  isUnselectedGreeting,
  needsResolution,
  resolutionCacheKey,
  resolveContextMessages,
  resolveMessageIntake,
  type MessageIntake,
  type MessageResolutionCache
} from "./message-text.js";
import { loadConnectionCatalog } from "./connections.js";
import { SYSTEM_ONE_KEY } from "./system-one.js";
import {
  clearAudioCatalogCache,
  normalizeAudioStoragePrefix,
  preloadAudioForCues,
  resolveAudioUrl,
  scanAudioCatalog,
  SUPPORTED_AUDIO_EXTENSIONS
} from "./audio-catalog.js";
import {
  loadCharacterAppearance,
  loadCharacterRegistry,
  loadChatState,
  loadConfig,
  loadSingleCharacterState,
  loadTurnRecord,
  mergeCharacterAppearanceFromState,
  mergePlannerCharacters,
  resetChatIdentityState,
  saveCharacterRegistry,
  saveChatState,
  saveSingleCharacterState,
  saveTurnRecord,
  turnPath,
  updateConfig,
  type StoredChatState,
  type StoredTurnRecord,
  type TurnBaseline
} from "./storage.js";

type NormalizedChatMessage = ChatMessageDTO & {
  role: "system" | "user" | "assistant";
  metadata?: Record<string, unknown>;
};

const planningQueue = new PlanningQueue();
const externalImageServices = new WeakMap<SpindleAPI, ReturnType<typeof createExternalImages>>();
function externalImages(spindle: SpindleAPI) {
  let service = externalImageServices.get(spindle);
  if (!service) { service = createExternalImages(spindle); externalImageServices.set(spindle, service); }
  return service;
}
const assetControllers = new Map<string, AbortController>();
/**
 * Sprite mode: one library/generation service per backend worker. It gates
 * generation on the same view registry as scene mode (any open Cue view of
 * the user) and reads config through storage.
 */
const spriteServices = new WeakMap<SpindleAPI, SpriteService>();
export function spriteService(spindle: SpindleAPI): SpriteService {
  let service = spriteServices.get(spindle);
  if (!service) {
    service = new SpriteService(spindle, {
      isViewOpen: (userId) => views.openChat(userId) !== null,
      openChatId: (userId) => views.openChat(userId),
      loadConfig: async (userId) => {
        const config = await loadConfig(spindle, userId);
        rememberDebugFlag(userId, config);
        return config;
      },
      log: (line, userId) => dbg(spindle, userId, line),
    });
    spriteServices.set(spindle, service);
  }
  return service;
}
/**
 * Per-chat intake epoch. Macro resolution awaits the host before the planning
 * queue can see the job, so a cancel, a new generation, a deletion, or a
 * newer message event during that await could otherwise let a stale intake
 * enqueue afterwards. Bumping the epoch invalidates every intake that started
 * before the bump.
 */
const intakeEpochs = new Map<string, number>();
function bumpIntakeEpoch(userId: string | undefined, chatId: string): void {
  const key = runtimeKey(userId, chatId);
  intakeEpochs.set(key, (intakeEpochs.get(key) ?? 0) + 1);
}
const activeTurnKeys = new Map<string, StoredTurnRecord["plan"]["key"]>();

/**
 * Temporary scene-image cache (one per backend worker). See
 * `core/scene-image-cache.ts` for lifetime rules. Exposed for tests and
 * diagnostics; production code reaches it only through this accessor.
 */
const sceneCache = new SceneImageCache();
export function sceneImageCache(): SceneImageCache {
  return sceneCache;
}
/** Last chat each user asked state for; a change releases the previous chat's cache scope. */
const activeChatByUser = new Map<string, string>();

/** Release cache admission for a chat whose turn/scene/swipe just changed. Entries stay; late results are rejected. */
function releaseSceneCacheAdmission(spindle: SpindleAPI, userId: string | undefined, chatId: string, reason: string): void {
  const scope = sceneImageScope(userId, chatId);
  const epoch = sceneCache.bumpEpoch(scope, reason);
  dbg(spindle, userId, `scene-cache admission released scope=${scope} epoch=${epoch} reason=${reason}`);
}

/** Explicit release of a whole chat scope (delete/reset/chat switch): entries dropped, late results rejected. */
function releaseSceneCacheScope(spindle: SpindleAPI, userId: string | undefined, chatId: string, reason: "chat_switch" | "scope_cleared"): void {
  const scope = sceneImageScope(userId, chatId);
  const dropped = sceneCache.invalidateScope(scope, reason);
  dbg(spindle, userId, `scene-cache scope released scope=${scope} reason=${reason} dropped=${dropped} generation=${sceneCache.generation(scope)}`);
}

/** Track the chat a user is viewing; switching chats releases the previous chat's scope. */
function noteActiveChat(spindle: SpindleAPI, userId: string | undefined, chatId: string): void {
  const userKey = userId ?? "owner";
  const previous = activeChatByUser.get(userKey);
  if (previous && previous !== chatId) releaseSceneCacheScope(spindle, userId, previous, "chat_switch");
  if (chatId) activeChatByUser.set(userKey, chatId);
}

function runtimeKey(userId: string | undefined, chatId: string): string {
  return `${userId ?? "owner"}:${chatId}`;
}

/**
 * Chats whose Cue view is currently open, per user. Automatic work (planning
 * and image generation on host events) is skipped while a chat's view is
 * closed; opening the view later plans the latest reply through `vn_get_state`.
 * Exposed for tests; production code reaches it only through this accessor.
 */
const views = new ViewRegistry();
export function viewRegistry(): ViewRegistry {
  return views;
}

/**
 * Persist "cancelled" over any queued/generating job of the chat's active turn
 * so a view-close abort leaves nothing that looks stuck. Late in-flight results
 * are already rejected by the ownership check (`activeTurnKeys`).
 */
async function cancelIncompleteJobs(
  spindle: SpindleAPI,
  chatId: string,
  userId: string | undefined,
  abortedTurn: StoredTurnRecord["plan"]["key"] | null
): Promise<void> {
  const key = runtimeKey(userId, chatId);
  // Runs unawaited after a close. The aborted batch never resumes on its own,
  // so its jobs are stamped even if the view reopened meanwhile (otherwise a
  // fast close/reopen leaves "generating" jobs that nothing will ever finish).
  // Only a new owner claiming the chat's turn while we were loading (retry,
  // reply, reuse) makes the stored jobs live work that must be left alone,
  // and only the record of the aborted turn itself is ever touched.
  const unclaimed = (): boolean => !activeTurnKeys.has(key);
  const chatState = await loadChatState(spindle, chatId, userId);
  if (!chatState.activeTurnPath || !unclaimed()) return;
  const record = await loadTurnRecord(spindle, chatState.activeTurnPath, userId);
  if (!record || !unclaimed()) return;
  if (abortedTurn && !turnKeyEquals(record.plan.key, abortedTurn)) return;
  const nowTime = new Date().toISOString();
  let cancelled = 0;
  const jobs = record.jobs.map((job) => {
    if (job.status !== "queued" && job.status !== "generating") return job;
    cancelled += 1;
    return AssetJobSchema.parse({ ...job, status: "cancelled", error: null, finishedAt: nowTime });
  });
  if (cancelled === 0 || !unclaimed()) return;
  const next = { ...record, jobs, updatedAt: nowTime };
  await saveTurnRecord(spindle, chatState.activeTurnPath, next, userId);
  dbg(spindle, userId, `view-gate persisted cancelled over ${cancelled} incomplete job(s) chat=${chatId}`);
  // A view that reopened before this landed already holds the pre-cancel
  // jobs; tell it so no spinner outlives the batch.
  if (views.isOpen(userId, chatId)) {
    for (const job of jobs) {
      if (job.status !== "cancelled" || job.finishedAt !== nowTime) continue;
      spindle.sendToFrontend({ type: "vn_asset", chatId, messageId: record.plan.key.assistantMessageId, asset: assetView(next, job) }, userId);
    }
  }
}

/**
 * Abort a chat's in-flight work the same way GENERATION_STARTED does: drop
 * turn ownership so late results cannot persist or send, abort the asset
 * batch, cancel queued planning, and release the scene-cache admission.
 */
function abortChatWork(spindle: SpindleAPI, userId: string | undefined, chatId: string, reason: string): void {
  const key = runtimeKey(userId, chatId);
  planningQueue.cancelChat(userId, chatId, undefined, reason);
  const abortedTurn = activeTurnKeys.get(key) ?? null;
  activeTurnKeys.delete(key);
  assetControllers.get(key)?.abort(reason);
  releaseSceneCacheAdmission(spindle, userId, chatId, "view_closed");
  void cancelIncompleteJobs(spindle, chatId, userId, abortedTurn).catch((error) => {
    spindle.log.warn(`Visual novel view-close cleanup failed: ${errorText(error)}`);
  });
}

/** Mark a chat's view open. Opening displaces the user's previously open chat, whose work is aborted. */
function openView(spindle: SpindleAPI, userId: string | undefined, chatId: string): void {
  if (!chatId) return;
  const wasOpen = views.isOpen(userId, chatId);
  const displaced = views.open(userId, chatId);
  if (!wasOpen) dbg(spindle, userId, `view open chat=${chatId}`);
  if (displaced) {
    dbg(spindle, userId, `view closed chat=${displaced} reason=view_switched`);
    abortChatWork(spindle, userId, displaced, "The visual novel view moved to another chat.");
  }
  // Sprite mode: queued library work resumes while a view is open.
  if (!wasOpen && spriteModeCached(userId)) {
    void spriteService(spindle).onViewOpened(userId).catch((error) => {
      spindle.log.warn(`Sprite queue resume failed: ${errorText(error)}`);
    });
  }
}

/** Close whichever chat's view is open for this user (home screen, no active chat). */
function closeOpenView(spindle: SpindleAPI, userId: string | undefined, reason: string): void {
  const open = views.openChat(userId);
  if (open) closeView(spindle, userId, open, reason);
}

/** Mark a chat's view closed and abort its in-flight work. Idempotent. */
function closeView(spindle: SpindleAPI, userId: string | undefined, chatId: string, reason: string): void {
  if (!views.close(userId, chatId)) return;
  dbg(spindle, userId, `view closed chat=${chatId} reason=${reason}`);
  abortChatWork(spindle, userId, chatId, "The visual novel view closed before this turn settled.");
  // Sprite generation is per user: it pauses once no Cue view is open.
  if (views.openChat(userId) === null) spriteServices.get(spindle)?.pause(userId);
}

/**
 * Whether automatic work (planning + image generation triggered by host
 * events) may run for a chat. Explicit requests from the open view
 * (vn_get_state, vn_retry_turn, choices) never pass through here.
 */
async function allowAutomaticWork(spindle: SpindleAPI, userId: string | undefined, chatId: string, trigger: string): Promise<boolean> {
  const config = await loadConfig(spindle, userId);
  rememberDebugFlag(userId, config);
  if (!config.enabled) {
    dbg(spindle, userId, `skipped ${trigger}: extension disabled (enabled=false) chat=${chatId}`);
    return false;
  }
  if (!views.isOpen(userId, chatId)) {
    dbg(spindle, userId, `skipped ${trigger}: view closed chat=${chatId}`);
    return false;
  }
  return true;
}

/**
 * Hand the exact planning text to the image/reference pipeline (card
 * reference lookups pair inline tags with plan paragraphs from this string;
 * a legacy record without it skips that step rather than re-resolving).
 */
function sourceTextOption(record: Pick<StoredTurnRecord, "resolvedSourceText">): { resolvedSourceText?: string } {
  return record.resolvedSourceText !== undefined ? { resolvedSourceText: record.resolvedSourceText } : {};
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

function rememberDebugFlag(userId: string | undefined, config: { debugLogging: boolean; presentationMode?: VisualNovelConfig["presentationMode"] }): void {
  debugFlags.set(userId ?? "owner", config.debugLogging);
  if (config.presentationMode) presentationModes.set(userId ?? "owner", config.presentationMode);
}

/**
 * Last presentation mode seen per user (refreshed on every config load, like
 * the debug flag). Lets synchronous decisions (stored-turn reuse, view
 * building) follow the mode without an extra storage read in scene mode.
 */
const presentationModes = new Map<string, VisualNovelConfig["presentationMode"]>();
function spriteModeCached(userId: string | undefined): boolean {
  return presentationModes.get(userId ?? "owner") === "sprites";
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

/**
 * Per-paragraph stage-effect and ambient views. A paragraph's one-shot effect
 * comes from its visual cue; its persistent ambient comes from the scene that
 * owns the most recent cue at or before that paragraph (falling back to the
 * first scene). Both arrays are omitted when the turn has nothing to show so
 * old records keep their legacy behavior. Explicit ambient nulls are sent to clear.
 */
function effectViews(record: StoredTurnRecord): Pick<TurnView, "effects" | "ambients"> {
  const paragraphCount = record.plan.paragraphs.length;
  if (paragraphCount === 0) return {};
  const effects: Array<string | null> = new Array(paragraphCount).fill(null);
  // An explicit empty list suppresses legacy effects; only old records fall back.
  for (const cue of record.plan.effectCues ?? record.plan.visualCues) {
    if (cue.effect && cue.paragraphIndex >= 0 && cue.paragraphIndex < paragraphCount) {
      effects[cue.paragraphIndex] = cue.effect;
    }
  }
  const ambients: Array<string | null> = new Array(paragraphCount).fill(null);
  const scenes = record.plan.scenes;
  let sceneIndex = 0;
  for (let index = 0; index < paragraphCount; index += 1) {
    // Scene boundaries are independent of the image budget and cue placement.
    while (sceneIndex + 1 < scenes.length && scenes[sceneIndex + 1]!.startParagraph <= index) {
      sceneIndex += 1;
    }
    ambients[index] = scenes[sceneIndex]?.ambient ?? null;
  }
  const hasEffect = effects.some((value) => value !== null);
  // Explicit null is a clear instruction, not missing data.
  const hasAmbient = scenes.some((scene) => scene.ambient !== undefined);
  return {
    ...(hasEffect ? { effects } : {}),
    ...(hasAmbient ? { ambients } : {})
  };
}

function assetView(record: StoredTurnRecord, job: StoredTurnRecord["jobs"][number]): AssetView {
  const cue = record.plan.visualCues.find((candidate) => candidate.assetJobId === job.jobId)
    ?? record.plan.cacheCues?.find((candidate) => candidate.assetJobId === job.jobId);
  return {
    jobId: job.jobId,
    cueId: cue?.cueId ?? job.jobId,
    paragraphIndex: job.paragraphIndex,
    status: job.status,
    ...(job.provider === CACHE_JOB_PROVIDER ? { source: "cache" as const } : {}),
    ...(job.imageId ? { imageId: job.imageId } : {}),
    ...(job.imageUrl ? { imageUrl: job.imageUrl } : {}),
    ...(job.error ? { error: job.error } : {})
  };
}

/**
 * Load the data URLs for a turn's audio cues into the bounded cache, then
 * build the view. Keeps `turnView` synchronous while audio bytes stay lazy.
 */
export async function turnViewWithAudio(spindle: SpindleAPI, record: StoredTurnRecord): Promise<TurnView> {
  const cues = record.plan.audioCues?.length
    ? record.plan.audioCues
    : record.plan.visualCues.filter((cue) => Boolean(cue.bgm || cue.sfx));
  try {
    await preloadAudioForCues(spindle, cues);
  } catch {
    // Audio is best-effort: a failed preload only mutes the cue.
  }
  return turnView(record);
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
    ...(record.plan.panels ? { panels: record.plan.panels } : {}),
    ...(record.plan.panelSource ? { panelSource: record.plan.panelSource } : {}),
    ...(record.plan.paragraphSpeakers?.some((speaker) => speaker !== null)
      ? { paragraphSpeakers: record.plan.paragraphSpeakers }
      : {}),
    ...effectViews(record),
    choices: record.plan.choices.map((choice) => ({ id: choice.id, label: choice.label, value: choice.submission })),
    assets: record.jobs.map((job) => assetView(record, job)),
    ...(audioCues.length > 0 ? { audioCues } : {}),
    status: record.status,
    ...(record.error ? { error: record.error } : {})
  };
}

/**
 * The view sent to the frontend. Scene mode: exactly `turnViewWithAudio`.
 * Sprite mode adds `sprites` (staging + the sets and plates it uses) and
 * makes sure the library has (or is generating) them. A turn stored without
 * staging (planned in scene mode) gets deterministic staging here, once.
 */
async function buildTurnView(
  spindle: SpindleAPI,
  record: StoredTurnRecord,
  userId: string | undefined,
  config?: VisualNovelConfig
): Promise<TurnView> {
  const view = await turnViewWithAudio(spindle, record);
  if (config ? config.presentationMode !== "sprites" : !spriteModeCached(userId)) return view;
  try {
    const effective = config ?? await loadConfig(spindle, userId);
    if (effective.presentationMode !== "sprites") return view;
    const service = spriteService(spindle);
    const staging = await stagingForRecord(spindle, record, effective, userId);
    await service.ensureForStaging(userId, staging, effective);
    const sprites = await service.turnView(userId, staging, effective);
    // Key moments: the scene-image jobs of `illustrate` paragraphs (off: sprites only).
    const illustrations = keyIllustrationCap(effective) > 0 ? keyIllustrationViews(staging, record.jobs) : [];
    return { ...view, sprites: illustrations.length ? { ...sprites, illustrations } : sprites };
  } catch (error) {
    spindle.log.warn(`Sprite view could not be built; sending the turn without sprites: ${errorText(error)}`);
    return view;
  }
}

/** The active Lumiverse persona name, or "" (no persona, or the lookup failed). */
async function activePersonaName(spindle: SpindleAPI, userId: string | undefined): Promise<string> {
  try {
    const persona = await spindle.personas?.getActive?.(userId);
    return persona?.name?.trim() ?? "";
  } catch {
    return "";
  }
}

/** The persona of a stored turn: its userSpeaker, else the active persona ("" when none). */
async function recordPersonaName(spindle: SpindleAPI, record: StoredTurnRecord, userId: string | undefined): Promise<string> {
  const stored = record.userSpeaker?.trim();
  if (stored && stored !== "You") return stored;
  return activePersonaName(spindle, userId);
}

/** Valid staging for every paragraph of the plan, or null. */
function usableStaging(staging: unknown, paragraphCount: number): SpriteStaging | null {
  const parsed = SpriteStagingSchema.safeParse(staging);
  if (!parsed.success || parsed.data.paragraphs.length !== paragraphCount) return null;
  return parsed.data;
}

/** The stored staging, or deterministic staging saved onto the record (turns planned before sprite mode was on). */
async function stagingForRecord(
  spindle: SpindleAPI,
  record: StoredTurnRecord,
  config: VisualNovelConfig,
  userId: string | undefined
): Promise<SpriteStaging> {
  const chatId = record.plan.key.chatId;
  const personaName = await recordPersonaName(spindle, record, userId);
  const registry: CharacterRegistry = await loadCharacterRegistry(spindle, chatId, userId).catch(() => ({}));
  const stored = usableStaging(record.plan.spriteStaging, record.plan.paragraphs.length);
  // Old stored staging may hold the persona or a registry alias as its own member.
  if (stored) return sanitizeStoredStaging(stored, { personaName, registry });
  const styleKey = spriteStyleKey(config);
  const staging = deterministicSpriteStaging({
    plan: record.plan,
    config,
    styleKey,
    knownPlates: await spriteService(spindle).knownPlates(userId, config),
    previousCast: [],
    previousStage: null,
    characterAppearance: await loadCharacterAppearance(spindle, userId, chatId).catch(() => ({})),
    registry,
    ...(personaName ? { personaName } : {}),
  });
  const key = record.plan.key;
  try {
    await saveTurnRecord(spindle, turnPath(key.chatId, key.assistantMessageId, key.swipeId), {
      ...record,
      plan: { ...record.plan, spriteStaging: staging },
      updatedAt: new Date().toISOString()
    }, userId);
    dbg(spindle, userId, `sprite staging added to stored turn chat=${key.chatId} message=${key.assistantMessageId}`);
  } catch (error) {
    spindle.log.warn(`Sprite staging could not be saved on the stored turn: ${errorText(error)}`);
  }
  return staging;
}

/**
 * Plan sprite staging for a freshly planned turn. Never throws: a staging
 * failure (or an invalid result) falls back to deterministic staging.
 */
async function planSpriteStaging(
  spindle: SpindleAPI,
  input: {
    plan: StoredTurnRecord["plan"];
    config: VisualNovelConfig;
    previous: StoredTurnRecord | null;
    personaName: string;
    characterAppearance: Readonly<Record<string, string>>;
    registry: Readonly<CharacterRegistry>;
    signal: AbortSignal;
  },
  userId: string | undefined
): Promise<SpriteStaging> {
  const previousUsable = input.previous && input.previous.plan.key.assistantMessageId !== input.plan.key.assistantMessageId
    ? usableStaging(input.previous.plan.spriteStaging, input.previous.plan.paragraphs.length)
    : null;
  // The previous turn's cast feeds continuity: clean the persona and split aliases out first.
  const previousStaging = previousUsable
    ? sanitizeStoredStaging(previousUsable, { personaName: input.personaName, registry: input.registry })
    : null;
  const previousStage: SpriteParagraphStage | null = previousStaging?.paragraphs.at(-1) ?? null;
  const stagingInput = {
    plan: input.plan,
    config: input.config,
    styleKey: spriteStyleKey(input.config),
    knownPlates: await spriteService(spindle).knownPlates(userId, input.config).catch(() => []),
    previousCast: previousStaging?.cast ?? [],
    previousStage,
    ...(previousStaging ? { previousSceneId: input.previous?.plan.scenes.at(-1)?.sceneId ?? null } : {}),
    characterAppearance: input.characterAppearance,
    registry: input.registry,
    ...(input.personaName ? { personaName: input.personaName } : {}),
  };
  try {
    const staged = await buildSpriteStaging(spindle, { ...stagingInput, ...(userId ? { userId } : {}), signal: input.signal });
    const usable = usableStaging(staged, input.plan.paragraphs.length);
    if (usable) return usable;
    spindle.log.warn("Sprite staging was invalid; using deterministic staging.");
  } catch (error) {
    spindle.log.warn(`Sprite staging failed; using deterministic staging: ${errorText(error)}`);
  }
  return deterministicSpriteStaging(stagingInput);
}

/**
 * "Prepare for this chat": the cast of the chat's latest staged turn, plus
 * every registry character with a known appearance (identity tags, no
 * outfit override).
 */
async function spriteCastForChat(spindle: SpindleAPI, chatId: string, userId: string | undefined): Promise<SpriteCastMember[]> {
  const cast: SpriteCastMember[] = [];
  const seen = new Set<string>();
  const registry: CharacterRegistry = await loadCharacterRegistry(spindle, chatId, userId).catch(() => ({}));
  // The persona never gets a sprite set: the turn's userSpeaker and the active persona are both left out.
  const personaKeys = new Set<string>();
  const active = await activePersonaName(spindle, userId);
  if (active) personaKeys.add(characterAppearanceKey(active));
  try {
    const chatState = await loadChatState(spindle, chatId, userId);
    const record = await loadTurnRecord(spindle, chatState.activeTurnPath, userId);
    const recordPersona = record?.userSpeaker && record.userSpeaker !== "You" ? record.userSpeaker : "";
    if (recordPersona) personaKeys.add(characterAppearanceKey(recordPersona));
    const usable = record ? usableStaging(record.plan.spriteStaging, record.plan.paragraphs.length) : null;
    const staging = usable ? sanitizeStoredStaging(usable, { personaName: recordPersona || active, registry }) : null;
    for (const member of staging?.cast ?? []) {
      const key = characterAppearanceKey(member.name);
      if (seen.has(key) || personaKeys.has(key) || isPersonaName(member.name)) continue;
      seen.add(key);
      cast.push(member);
    }
  } catch {
    // No stored turn: the registry alone decides.
  }
  for (const entry of Object.values(registry)) {
    const key = characterAppearanceKey(entry.name);
    if (!key || seen.has(key) || !entry.tags.trim() || personaKeys.has(key) || isPersonaName(entry.name)) continue;
    const parsed = SpriteCastMemberSchema.safeParse({
      characterKey: entry.id || key,
      name: entry.name.slice(0, 200),
      ...(entry.id ? { characterId: entry.id } : {}),
      identity: entry.tags.slice(0, 4000),
      attire: null,
      subjectCategory: entry.subjectCategory,
    });
    if (!parsed.success) continue;
    seen.add(key);
    cast.push(parsed.data);
  }
  return cast.slice(0, 16);
}

async function bootstrapLatestAssistantTurn(spindle: SpindleAPI, chatId: string, userId?: string): Promise<void> {
  const messages = await spindle.chat.getMessages(chatId) as NormalizedChatMessage[];
  const latest = [...messages].reverse().find((message) => !message.is_user && message.content.trim());
  if (!latest) return;
  spindle.sendToFrontend({ type: "vn_planning", chatId }, userId);
  await processAssistantMessage(spindle, chatId, latest, latest.content, userId);
}

/**
 * How a stored turn relates to the message it was planned from, given the
 * message's current intake resolution.
 *
 * - `current`: the record is for this message and its selection fingerprint
 *   matches (or, for a legacy record, the raw text still matches what it was
 *   fingerprinted on). Nothing to replan.
 * - `reselected`: same stored message text, but the scene selection resolved
 *   differently (a picker only sets a chat variable). Replan; when the message
 *   is the chat's sole assistant turn the identity state came from the
 *   discarded scene and is reset.
 * - `changed`: a different message, edited text, or a legacy record whose
 *   fingerprint scheme cannot be compared. Replan with continuity intact.
 */
type RecordRelation = "current" | "reselected" | "changed";

function relateRecord(
  record: StoredTurnRecord | null,
  message: Pick<NormalizedChatMessage, "id" | "swipe_id" | "content">,
  intake: Pick<MessageIntake, "selectionText" | "stableSelection">
): RecordRelation {
  if (!record) return "changed";
  const key = record.plan.key;
  if (key.assistantMessageId !== message.id || (key.swipeId ?? null) !== (message.swipe_id ?? null)) return "changed";
  const selection = fingerprintForMessage({ id: message.id, swipe_id: message.swipe_id, content: intake.selectionText });
  const rawFingerprint = fingerprintForMessage({ id: message.id, swipe_id: message.swipe_id, content: message.content });
  if (record.source?.version === 2) {
    // 1. Raw text changed -> plain edit (replan, preserve continuity).
    if (record.source.rawFingerprint !== rawFingerprint) return "changed";
    // 2. Raw text identical, selection identical -> current.
    if (key.sourceFingerprint === selection) return "current";
    // 3. Raw text identical, selection differs:
    //    Only a stable selection change is a genuine re-selection that resets identity.
    //    An unstable selection (volatile condition or stateful macro re-rolled)
    //    replans without reset so the new branch is shown with identity preserved.
    return intake.stableSelection ? "reselected" : "changed";
  }
  // Legacy records: fingerprinted on raw text (pre-macro intake) or on the
  // fully resolved text (volatile output included). Either exact match means
  // the stored turn still describes this message; anything else replans once
  // and upgrades the record, never resetting identity on a guess.
  if (key.sourceFingerprint === selection || key.sourceFingerprint === rawFingerprint) return "current";
  return "changed";
}

function selectionFingerprint(message: Pick<NormalizedChatMessage, "id" | "swipe_id">, intake: Pick<MessageIntake, "selectionText">): string {
  return fingerprintForMessage({ id: message.id, swipe_id: message.swipe_id, content: intake.selectionText });
}

export async function sendState(
  spindle: SpindleAPI,
  chatId: string,
  userId?: string,
  options: { viewOpen?: boolean } = {}
): Promise<void> {
  // No active chat (home screen): whatever view was open is gone. Close it
  // before the first await so a reply landing meanwhile is already gated.
  if (!chatId) closeOpenView(spindle, userId, "no_active_chat");
  const config = await loadConfig(spindle, userId);
  rememberDebugFlag(userId, config);
  if (!chatId) {
    spindle.sendToFrontend({ type: "vn_state", chatId: "", config, turn: null }, userId);
    return;
  }
  // Only an explicit flag changes the view state. A state request that says
  // nothing about the view (background reconcile, older frontends) must never
  // open it, or closed chats would start paying for planning and images again.
  if (options.viewOpen === true) openView(spindle, userId, chatId);
  else if (options.viewOpen === false) closeView(spindle, userId, chatId, "state_request");
  // The scene cache follows the chat the user is looking at, not background requests.
  if (views.isOpen(userId, chatId)) noteActiveChat(spindle, userId, chatId);
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
  // The stored turn can be stale for two reasons: a newer reply arrived
  // while the view was closed, or the same message resolves to a different
  // scene (a LumiRealm picker only sets a chat variable). Both are decided
  // BEFORE the state is sent so a stale turn is never rendered first. Only
  // messages that contain macro syntax reach the host; a host that cannot
  // resolve right now (interceptor not loaded, transient error) keeps the
  // stored turn instead of replacing it.
  let stale: { message: NormalizedChatMessage; intake: MessageIntake | null; relation: RecordRelation } | null = null;
  if (record) {
    try {
      const messages = await spindle.chat.getMessages(chatId) as NormalizedChatMessage[];
      const latest = [...messages].reverse().find((message) => !message.is_user && message.content.trim());
      if (latest) {
        const isSame = latest.id === record.plan.key.assistantMessageId;
        if (!isSame) {
          stale = { message: latest, intake: null, relation: "changed" };
        } else if (needsResolution(latest.content)) {
          const intake = await resolveMessageIntake(spindle, chatId, latest.content, userId);
          const relation = relateRecord(record, latest, intake);
          if (relation !== "current" && !intake.resolved) {
            dbg(spindle, userId, `host could not resolve message ${latest.id}; keeping the stored turn chat=${chatId}`);
          } else if (relation !== "current") {
            stale = { message: latest, intake, relation };
          }
        } else if (relateRecord(record, latest, { selectionText: latest.content, stableSelection: true }) !== "current") {
          stale = { message: latest, intake: { text: latest.content, selectionText: latest.content, resolved: true, stableSelection: true }, relation: "changed" };
        }
      }
    } catch (error) {
      spindle.log.warn(`Stored turn freshness check failed; sending the stored turn: ${errorText(error)}`);
    }
  }
  spindle.sendToFrontend({
    type: "vn_state",
    chatId,
    config,
    turn: record && !stale ? await buildTurnView(spindle, record, userId, config) : null
  }, userId);
  if (config.presentationMode === "sprites" && views.isOpen(userId, chatId)) {
    // A reloaded frontend lost its cut requests; re-send them and resume the queue.
    void spriteService(spindle).onStateRequested(userId).catch((error) => {
      spindle.log.warn(`Sprite queue resume failed: ${errorText(error)}`);
    });
  }
  const canPlan = config.enabled && views.isOpen(userId, chatId);
  if (!record) {
    if (canPlan) await bootstrapLatestAssistantTurn(spindle, chatId, userId);
    else dbg(spindle, userId, `skipped bootstrap: ${config.enabled ? "view closed" : "extension disabled (enabled=false)"} chat=${chatId}`);
    return;
  }
  if (!canPlan || !stale) return;
  dbg(spindle, userId, stale.relation === "reselected"
    ? `scene selection changed; replanning with the resolved text chat=${chatId}`
    : `stored turn is stale (newer or changed reply); planning the latest reply chat=${chatId}`);
  spindle.sendToFrontend({ type: "vn_planning", chatId }, userId);
  await processAssistantMessage(spindle, chatId, stale.message, stale.message.content, userId, stale.intake ? { precomputedIntake: stale.intake } : {});
  // A close mid-batch leaves cancelled jobs behind. They are not resumed
  // automatically on reopen (a GENERATION_STARTED abort looks the same and a
  // newer reply is usually on its way); the reading view offers Retry for them.
}

async function persistActiveTurn(
  spindle: SpindleAPI,
  record: StoredTurnRecord,
  path: string,
  userId?: string
): Promise<void> {
  await saveTurnRecord(spindle, path, record, userId);
  await saveChatState(spindle, record.plan.key.chatId, {
    schemaVersion: 1,
    activeTurnPath: path,
    latestScene: terminalSceneState(record),
    terminalContinuity: record.plan.terminalContinuity,
    updatedAt: new Date().toISOString()
  }, userId);
}

/** The chat's latest scene after a turn: its last scene with the terminal subject and continuity. */
function terminalSceneState(record: StoredTurnRecord): StoredChatState["latestScene"] {
  const lastScene = record.plan.scenes.at(-1) ?? null;
  return lastScene && record.plan.terminalVisualState ? {
    ...lastScene,
    character: record.plan.terminalVisualState.character,
    ...(record.plan.terminalVisualState.characterId ? { characterId: record.plan.terminalVisualState.characterId } : {}),
    ...(record.plan.terminalVisualState.subjectCategory ? { subjectCategory: record.plan.terminalVisualState.subjectCategory } : {}),
    identityPrompt: record.plan.terminalVisualState.identity || null,
    attire: record.plan.terminalVisualState.attire,
    continuity: record.plan.terminalContinuity,
    activeAssetId: null
  } : lastScene;
}

/**
 * The state a stored turn was planned from (the state before its message).
 * Records stored before baselines fall back to: `plan.initialContinuity`, and
 * as the previous scene the terminal scene of the previous assistant message's
 * stored turn (its current swipe); no scene when the message is the chat's
 * first assistant turn; the record's own first scene (what retry used before
 * baselines) when that previous turn is not stored or the message is unknown.
 */
async function recordBaseline(
  spindle: SpindleAPI,
  record: StoredTurnRecord,
  messages: readonly NormalizedChatMessage[],
  userId?: string
): Promise<{ baseline: TurnBaseline; source: string }> {
  if (record.baseline) return { baseline: record.baseline, source: "stored baseline" };
  const previousContinuity = record.plan.initialContinuity;
  const index = messages.findIndex((candidate) => candidate.id === record.plan.key.assistantMessageId);
  if (index >= 0) {
    const prior = messages.slice(0, index).reverse().find((candidate) => !candidate.is_user && candidate.content.trim());
    if (!prior) return { baseline: { previousScene: null, previousContinuity }, source: "legacy: first assistant turn" };
    const priorRecord = await loadTurnRecord(spindle, turnPath(record.plan.key.chatId, prior.id, prior.swipe_id), userId).catch(() => null);
    if (priorRecord) return { baseline: { previousScene: terminalSceneState(priorRecord), previousContinuity }, source: `legacy: previous turn ${prior.id}` };
  }
  return { baseline: { previousScene: record.plan.scenes[0] ?? null, previousContinuity }, source: "legacy: own first scene" };
}

async function startAssets(
  spindle: SpindleAPI,
  record: StoredTurnRecord,
  path: string,
  userId?: string,
  options: { bypassJobIds?: Iterable<string> } = {}
): Promise<void> {
  const config = await loadConfig(spindle, userId);
  rememberDebugFlag(userId, config);
  if (!config.generateImages || record.jobs.length === 0) return;
  // The view may have closed between planning and this batch start; a closed
  // view means nobody sees (or pays for) these images.
  if (!views.isOpen(userId, record.plan.key.chatId)) {
    dbg(spindle, userId, `skipped asset batch: view closed chat=${record.plan.key.chatId}`);
    await cancelIncompleteJobs(spindle, record.plan.key.chatId, userId, record.plan.key);
    return;
  }
  const cacheServed = record.jobs.filter((job) => job.provider === CACHE_JOB_PROVIDER).length;
  dbg(spindle, userId, `assets starting: ${record.jobs.length - cacheServed} generated job(s)${cacheServed ? ` + ${cacheServed} cache-served swap(s) (not generated)` : ""} for chat=${record.plan.key.chatId} message=${record.plan.key.assistantMessageId} concurrency=${config.imageConcurrency}`);
  const key = runtimeKey(userId, record.plan.key.chatId);
  assetControllers.get(key)?.abort("A newer turn replaced this asset batch.");
  const controller = new AbortController();
  assetControllers.set(key, controller);
  // Every batch start supersedes the previous batch's cache admission, so a
  // late result from the replaced batch can never populate the active cache.
  releaseSceneCacheAdmission(spindle, userId, record.plan.key.chatId, "batch_start");
  const scope = sceneImageScope(userId, record.plan.key.chatId);
  const admission = sceneCache.admission(scope);
  let current = record;
  // Sprite mode: the jobs are key illustrations; the pipeline sees only their cues.
  const spritePlanned = isSpritePlannedRecord(record);

  const onUpdate = async (jobs: AssetJob[], changed: AssetJob): Promise<void> => {
    dbg(spindle, userId, `asset ${changed.jobId} p${changed.paragraphIndex} [${changed.priority}] -> ${changed.status}${changed.imageId ? ` image=${changed.imageId}` : ""}${changed.error ? ` error="${changed.error}"` : ""}`);
    const active = activeTurnKeys.get(key) ?? null;
    if (!compareTurnKeys(active, changed.ownerTurnKey).accepted) return;
    current = { ...current, jobs, updatedAt: new Date().toISOString() };
    await saveTurnRecord(spindle, path, current, userId);
    // Sprite mode: the host maps this onto `sprites.illustrations` (no turn re-send).
    spindle.sendToFrontend({
      type: "vn_asset",
      chatId: record.plan.key.chatId,
      messageId: record.plan.key.assistantMessageId,
      asset: assetView(current, changed)
    }, userId);
  };

  try {
    // Sprite mode: key moments get their own two-character prompt and run
    // on the sprite scheduler (shared provider concurrency, same gating).
    const finalJobs = spritePlanned
      ? await spriteService(spindle).runKeyMoments(userId, {
          jobs: record.jobs,
          scenes: keyMomentScenes(record.plan, record.jobs),
          chatId: record.plan.key.chatId,
          signal: controller.signal,
          onUpdate
        })
      : await generateAssets(
          spindle,
          record.plan,
          record.jobs,
          config,
          controller.signal,
          onUpdate,
          userId,
          { sceneCache, admission, ...(options.bypassJobIds ? { bypassJobIds: options.bypassJobIds } : {}), ...sourceTextOption(record) }
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

/**
 * Sprite mode: put a sprite-planned turn's unfinished key illustrations
 * (queued, generating, cancelled or failed) back in the queue. Finished
 * pictures are kept. Returns null when there is nothing to resume, the
 * feature is off, or a batch for the chat is still running.
 */
async function requeueKeyIllustrations(
  spindle: SpindleAPI,
  record: StoredTurnRecord,
  path: string,
  userId: string | undefined,
  options: { bypassCache: boolean }
): Promise<{ record: StoredTurnRecord; bypassJobIds: Set<string> } | null> {
  if (!isSpritePlannedRecord(record) || record.jobs.length === 0) return null;
  const config = await loadConfig(spindle, userId);
  if (keyIllustrationCap(config) === 0 || config.presentationMode !== "sprites") return null;
  const running = assetControllers.get(runtimeKey(userId, record.plan.key.chatId));
  if (running && !running.signal.aborted) return null;
  const nowTime = new Date().toISOString();
  const bypassJobIds = new Set<string>();
  let requeued = 0;
  const jobs = record.jobs.map((job) => {
    if (job.status === "generated" || job.status === "browser_ready") return job;
    requeued += 1;
    if (options.bypassCache) bypassJobIds.add(job.jobId);
    return AssetJobSchema.parse({
      ...job, status: "queued", imageId: null, imageUrl: null, error: null,
      queuedAt: nowTime, startedAt: null, generatedAt: null, readyAt: null, finishedAt: null
    });
  });
  if (requeued === 0) return null;
  const next = { ...record, jobs, updatedAt: nowTime };
  await saveTurnRecord(spindle, path, next, userId);
  dbg(spindle, userId, `key illustrations re-queued ${requeued} job(s) chat=${record.plan.key.chatId} message=${record.plan.key.assistantMessageId}`);
  return { record: next, bypassJobIds };
}

function startKeyIllustrations(
  spindle: SpindleAPI,
  record: StoredTurnRecord,
  path: string,
  userId: string | undefined,
  bypassJobIds: Set<string>,
  operation: "generate_assets" | "retry_turn"
): void {
  void startAssets(spindle, record, path, userId, bypassJobIds.size ? { bypassJobIds } : {}).catch((error) => {
    if (!isAbortError(error)) {
      spindle.log.error(`Key illustration pipeline failed: ${errorText(error)}`);
      spindle.sendToFrontend({ type: "vn_error", chatId: record.plan.key.chatId, operation, error: errorText(error) }, userId);
    }
  });
}

async function processAssistantMessage(
  spindle: SpindleAPI,
  chatId: string,
  message: NormalizedChatMessage,
  content: string,
  userId?: string,
  options?: { retry?: boolean; forceRegenerate?: boolean; precomputedIntake?: MessageIntake }
): Promise<void> {
  if (!content.trim() || message.is_user) return;
  // Macro intake: the raw stored text may hold every alternative scene of a
  // RisuAI card greeting. Resolve once, cache for this planning run, and use
  // the resolved text everywhere (plan, storage, frontend). Fingerprints use
  // the selection text (volatile macros masked) so `{{random}}`/`{{time}}`
  // output never looks like a new scene.
  const intakeKey = runtimeKey(userId, chatId);
  const intakeEpoch = intakeEpochs.get(intakeKey) ?? 0;
  const resolutionCache: MessageResolutionCache = new Map();
  const intake = options?.precomputedIntake ?? await resolveMessageIntake(spindle, chatId, content, userId);
  if ((intakeEpochs.get(intakeKey) ?? 0) !== intakeEpoch) {
    dbg(spindle, userId, `intake for message ${message.id} superseded while resolving; dropped`);
    return;
  }
  const resolved = intake.text;
  resolutionCache.set(resolutionCacheKey(message), resolved);
  if (resolved !== content) dbg(spindle, userId, `message ${message.id} macro-resolved: ${content.length} -> ${resolved.length} chars`);
  const path = turnPath(chatId, message.id, message.swipe_id);
  const existing = await loadTurnRecord(spindle, path, userId);
  const relation = relateRecord(existing, message, intake);
  // The host could not resolve the message right now (no interceptor loaded,
  // transient error). A turn already planned from a successful resolution
  // stays authoritative: never replace it with a waiting state or a replan
  // built from the stripped raw text.
  if (!intake.resolved && existing && !options?.forceRegenerate) {
    dbg(spindle, userId, `message ${message.id} could not be resolved by the host; keeping the stored turn`);
    const key = runtimeKey(userId, chatId);
    activeTurnKeys.set(key, existing.plan.key);
    await persistActiveTurn(spindle, existing, path, userId);
    spindle.sendToFrontend({ type: "vn_turn", turn: await buildTurnView(spindle, existing, userId) }, userId);
    return;
  }
  if (isUnselectedGreeting(content, resolved)) {
    dbg(spindle, userId, `message ${message.id} has no narrative after macro resolution; waiting for a scene selection`);
    spindle.sendToFrontend({ type: "vn_waiting", chatId, messageId: message.id, reason: "greeting_unselected" }, userId);
    return;
  }
  const fingerprint = selectionFingerprint(message, intake);
  const rawFingerprint = fingerprintForMessage({ id: message.id, swipe_id: message.swipe_id, content });
  if (!options?.retry && !options?.forceRegenerate && existing && relation === "current") {
    // Sprite mode never runs scene jobs, so their state does not matter; a
    // turn planned for sprites has no scene jobs and is replanned in scene mode.
    const spriteMode = spriteModeCached(userId);
    const hasIncompleteJobs = spriteMode
      ? false
      : existing.jobs.some(
        (job) => job.status === "failed" || job.status === "cancelled" || job.status === "queued" || job.status === "generating"
      ) || (existing.plan.spriteStaging !== undefined && (existing.jobs.length === 0 || isSpritePlannedRecord(existing)));
    if (!hasIncompleteJobs) {
      dbg(spindle, userId, `turn reused from storage chat=${chatId} message=${message.id} fingerprint=${fingerprint}`);
      const key = runtimeKey(userId, chatId);
      activeTurnKeys.set(key, existing.plan.key);
      await persistActiveTurn(spindle, existing, path, userId);
      // Sprite mode: unfinished key illustrations resume instead of replanning.
      const resumed = spriteMode ? await requeueKeyIllustrations(spindle, existing, path, userId, { bypassCache: false }) : null;
      spindle.sendToFrontend({ type: "vn_turn", turn: await buildTurnView(spindle, resumed?.record ?? existing, userId) }, userId);
      if (resumed) startKeyIllustrations(spindle, resumed.record, path, userId, resumed.bypassJobIds, "generate_assets");
      return;
    }
  }

  const dedupeId = `${message.id}:${message.swipe_id}:${fingerprint}`;
  dbg(spindle, userId, `planning enqueued chat=${chatId} message=${message.id} swipe=${message.swipe_id} fingerprint=${fingerprint}`);
  const scheduled = planningQueue.enqueue(userId, chatId, message.id, async (operation) => {
    const planningStartedAt = Date.now();
    const config = await loadConfig(spindle, userId);
    rememberDebugFlag(userId, config);
    const messages = await spindle.chat.getMessages(chatId) as NormalizedChatMessage[];
    // Greeting replacement: the same stored message re-resolved to a different
    // scene while it is the chat's only assistant turn. The durable identity
    // state (frozen protagonist, registry, appearance roster, scene lineage)
    // came from the discarded scene; the predecessor state of such a chat is
    // empty, so restore that instead of leaking the old cast into the newly
    // selected scene. Mid-chat turns are never reset.
    // Only a re-selection (same stored text, different resolved scene) resets;
    // a plain edit of the greeting keeps continuity and identity.
    const assistantTurns = messages.filter((candidate) => !candidate.is_user && candidate.content.trim());
    const replacesGreeting = relation === "reselected"
      && assistantTurns.length === 1
      && assistantTurns[0]!.id === message.id;
    if (replacesGreeting) {
      dbg(spindle, userId, `greeting ${message.id} re-resolved to a different scene; resetting this chat's identity state`);
      await resetChatIdentityState(spindle, chatId, userId);
      releaseSceneCacheScope(spindle, userId, chatId, "scope_cleared");
    }
    const chatState = await loadChatState(spindle, chatId, userId);
    const singleCharacter = await loadSingleCharacterState(spindle, chatId, userId);
    const characterAppearance = await loadCharacterAppearance(spindle, userId, chatId);
    const characterRegistry = await loadCharacterRegistry(spindle, chatId, userId);
    // Another swipe or an edit of the active message plans from the state
    // before that message, not from the discarded swipe's end state.
    const activeRecord = await loadTurnRecord(spindle, chatState.activeTurnPath, userId).catch(() => null);
    const planned: { baseline: TurnBaseline; source: string } = replacesGreeting
      ? { baseline: { previousScene: null, previousContinuity: null }, source: "greeting reset" }
      : options?.retry && existing
        ? await recordBaseline(spindle, existing, messages, userId)
        : activeRecord && activeRecord.plan.key.assistantMessageId === message.id
          ? await recordBaseline(spindle, activeRecord, messages, userId)
          : { baseline: { previousScene: chatState.latestScene, previousContinuity: chatState.terminalContinuity }, source: "chat latest state" };
    const baseline = planned.baseline;
    dbg(spindle, userId, `planning baseline chat=${chatId} message=${message.id} swipe=${message.swipe_id} source=${planned.source} scene=${baseline.previousScene ? `${baseline.previousScene.sceneId} rev${baseline.previousScene.revision}` : "none"} continuity=rev${baseline.previousContinuity?.revision ?? "none"}`);
    const recentMessages = config.includeRecentMessages > 0
      ? await resolveContextMessages(spindle, chatId, messages.slice(-config.includeRecentMessages), resolutionCache, userId)
      : [];
    const result = await planTurn(spindle, {
      chatId,
      message,
      content: resolved,
      sourceFingerprint: fingerprint,
      previousScene: baseline.previousScene,
      previousContinuity: baseline.previousContinuity,
      recentMessages,
      config,
      singleCharacter,
      characterAppearance,
      characterRegistry,
      gameHints: gameHintsForTurn(messages, message.id),
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
      `effects=[${(result.plan.effectCues ?? result.plan.visualCues).filter((cue) => cue.effect).map((cue) => `p${cue.paragraphIndex}:${cue.effect}`).join(", ")}]`,
      `ambients=[${result.plan.scenes.map((scene) => `p${scene.startParagraph}:${scene.ambient === undefined ? "omitted" : scene.ambient}`).join(", ")}]`,
      `choices=${result.plan.choices.length}`,
      `protagonist="${result.singleCharacter.protagonist.name}" tags=${result.singleCharacter.protagonist.tags.length}`,
      `subject=${result.plan.terminalVisualState?.characterId ?? "?"}/${result.plan.terminalVisualState?.subjectCategory ?? "unknown"}`,
      `registry=${Object.values(result.characterRegistry).map((entry) => `${entry.id}${entry.aliases.length ? `(${entry.aliases.join("/")})` : ""}`).join(",")}`,
      ...(result.rejectedAliases.length ? [`rejectedAliases=[${result.rejectedAliases.map((item) => `${item.alias}->${item.requestedFor} owned by ${item.ownedBy}`).join("; ")}]`] : []),
      ...(result.rejectedSubjects.length ? [`rejectedSubjects=[${result.rejectedSubjects.map((item) => `${item.name}: ${item.requested} kept ${item.durable}`).join("; ")}]`] : []),
      `context: ${summarizeDiagnostics(result.contextDiagnostics)}`
    ].join(" | "));
    await mergeCharacterAppearanceFromState(spindle, singleCharacter, userId, chatId);
    await saveSingleCharacterState(spindle, chatId, result.singleCharacter, userId);
    await mergeCharacterAppearanceFromState(spindle, result.singleCharacter, userId, chatId);
    if (result.extractedCharacters && result.extractedCharacters.length > 0) {
      await mergePlannerCharacters(spindle, result.extractedCharacters, userId, chatId);
    }
    // Persist stable ids, explicit aliases and subject categories learned this turn.
    await saveCharacterRegistry(spindle, chatId, result.characterRegistry, userId);
        let jobs: StoredTurnRecord["jobs"] = [];
    // Sprite mode: the plan still feeds staging, but no scene image runs.
    const spriteMode = config.presentationMode === "sprites";
    if (spriteMode) {
      dbg(spindle, userId, `sprite mode: scene-image jobs only for key illustrations chat=${chatId} message=${message.id}`);
    } else if (config.useNativeCardImages) {
      try {
        jobs = await resolveNativeCardJobs({
          spindle,
          chatId,
          plan: result.plan,
          content: resolved,
          speakerName: message.name,
          userId,
        });
      } catch (err) {
        if (config.debugLogging) spindle.log.warn(`Native card image resolution failed: ${errorText(err)}`);
      }
    } else if (config.generateImages) {
      jobs = await prepareAssetJobs(spindle, result.plan, config, characterAppearance, sceneCache, userId, sourceTextOption({ resolvedSourceText: resolved }));
      // Reuse-only candidates beyond the image cap: deterministic cache lookup
      // before the first vn_turn. Hits become terminal jobs; misses add nothing.
      if (result.plan.cacheCues?.length) {
        const scope = sceneImageScope(userId, chatId);
        retainPlanEpisodes(sceneCache, scope, result.plan);
        const extra = await resolveCacheCues(spindle, result.plan, config, characterAppearance, jobs, sceneCache, userId, {
          log: (line) => dbg(spindle, userId, line),
          ...sourceTextOption({ resolvedSourceText: resolved })
        });
        if (extra.length > 0) {
          dbg(spindle, userId, `scene-cache resolved ${extra.length} extra swap(s) beyond the image cap without requests (cap=${config.maxImagesPerTurn}, budgeted=${jobs.length})`);
          jobs = [...jobs, ...extra];
        }
      }
    }
    let userSpeaker = (await activePersonaName(spindle, userId)) || "You";
    if (userSpeaker === "You") {
      try {
        const recent = (await spindle.chat.getMessages(chatId) as NormalizedChatMessage[]);
        const lastUser = [...recent].reverse().find((m) => m.role === "user" || Boolean(m.is_user));
        if (lastUser?.name?.trim()) {
          userSpeaker = lastUser.name.trim();
        }
      } catch {}
    }

    let plan = result.plan;
    if (spriteMode) {
      if (operation.controller.signal.aborted) return;
      const previous = await loadTurnRecord(spindle, chatState.activeTurnPath, userId).catch(() => null);
      const staging = await planSpriteStaging(spindle, {
        plan,
        config,
        previous,
        personaName: userSpeaker === "You" ? "" : userSpeaker,
        characterAppearance,
        registry: result.characterRegistry,
        signal: operation.controller.signal
      }, userId);
      plan = { ...plan, spriteStaging: staging };
      // Key moments: the existing scene-image job for each `illustrate` paragraph's cue, within the cap.
      const keyCues = keyIllustrationCues(plan, keyIllustrationCap(config));
      if (keyCues.length) {
        jobs = createAssetJobs({ ...plan, visualCues: keyCues, cacheCues: undefined, classifierVisuals: undefined }, config, characterAppearance);
      }
      dbg(spindle, userId, `sprite staging source=${staging.source} cast=[${staging.cast.map((member) => member.name).join(", ")}] plates=${staging.plates.length} paragraphs=${staging.paragraphs.length} keyIllustrations=[${keyCues.map((cue) => `p${cue.paragraphIndex}`).join(", ")}]`);
    }

    const settingsSnapshot: Record<string, unknown> = {
      promptPrefix: config.promptPrefix,
      promptSuffix: config.promptSuffix,
      negativePrompt: config.negativePrompt,
      imageConnectionId: config.imageConnectionId,
      imageModel: config.imageModel,
      imageConcurrency: config.imageConcurrency,
      // Marks a sprite-planned turn: its jobs are key illustrations only.
      ...(spriteMode ? { presentationMode: "sprites" } : {})
    };
    const nowTime = new Date().toISOString();
    const record: StoredTurnRecord = {
      schemaVersion: 1,
      speaker: message.name || "Narrator",
      userSpeaker,
      status: "ready",
      plan,
      jobs,
      updatedAt: nowTime,
      resolvedSourceText: resolved,
      source: { version: 2, rawFingerprint },
      settingsSnapshot,
      baseline,
      attempts: [
        {
          attemptNumber: 1,
          timestamp: nowTime,
          settings: settingsSnapshot
        }
      ]
    };
    // The view may have closed (or a new generation started) during the awaits
    // above. Persisting or sending now would resurrect a turn nobody is watching.
    if (operation.controller.signal.aborted) {
      dbg(spindle, userId, `planned turn dropped after abort chat=${chatId} message=${message.id}`);
      return;
    }
    const key = runtimeKey(userId, chatId);
    activeTurnKeys.set(key, record.plan.key);
    await persistActiveTurn(spindle, record, path, userId);
    if (operation.controller.signal.aborted) return;
    spindle.sendToFrontend({ type: "vn_turn", turn: await buildTurnView(spindle, record, userId, config) }, userId);
    if ((!spriteMode || jobs.length > 0) && !config.useNativeCardImages && config.generateImages) {
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
  if (!(await allowAutomaticWork(spindle, userId, payload.chatId, "GENERATION_ENDED"))) return;
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

async function retryTurn(
  spindle: SpindleAPI,
  chatId: string,
  message: NormalizedChatMessage,
  userId?: string
): Promise<void> {
  const key = runtimeKey(userId, chatId);
  assetControllers.get(key)?.abort("Retrying turn.");
  planningQueue.cancelChat(userId, chatId);
  releaseSceneCacheAdmission(spindle, userId, chatId, "retry");

  const path = turnPath(chatId, message.id, message.swipe_id);
  const existing = await loadTurnRecord(spindle, path, userId);

  // A scene picker may have changed since this turn was planned. Re-resolve
  // macro-bearing messages first; a resolution that no longer matches the
  // stored plan replans instead of regenerating the discarded scene's images.
  if (needsResolution(message.content)) {
    const intake = await resolveMessageIntake(spindle, chatId, message.content, userId);
    // A host that cannot resolve right now keeps the stored plan (images are
    // retried below); only a real, different resolution replans.
    if (intake.resolved && relateRecord(existing, message, intake) !== "current") {
      await processAssistantMessage(spindle, chatId, message, message.content, userId, { retry: true, precomputedIntake: intake });
      return;
    }
  }

  const config = await loadConfig(spindle, userId);
  rememberDebugFlag(userId, config);
  const characterAppearance = await loadCharacterAppearance(spindle, userId, chatId);

  // Sprite mode: a usable stored turn keeps its plan; Retry re-queues the
  // failed sprites and plates it uses instead of replanning.
  if (config.presentationMode === "sprites" && existing && existing.status !== "failed") {
    activeTurnKeys.set(key, existing.plan.key);
    await persistActiveTurn(spindle, existing, path, userId);
    const staging = await stagingForRecord(spindle, existing, config, userId);
    const requeued = await spriteService(spindle).retryFailed(userId, staging, config);
    dbg(spindle, userId, `sprite retry re-queued ${requeued} image(s) chat=${chatId} message=${message.id}`);
    const stored = await loadTurnRecord(spindle, path, userId) ?? existing;
    // Key illustrations: finished pictures are kept, the rest regenerate (as in scene mode).
    const resumed = await requeueKeyIllustrations(spindle, stored, path, userId, { bypassCache: true });
    const current = resumed?.record ?? stored;
    spindle.sendToFrontend({ type: "vn_turn", turn: await buildTurnView(spindle, current, userId, config) }, userId);
    if (resumed) startKeyIllustrations(spindle, current, path, userId, resumed.bypassJobIds, "retry_turn");
    return;
  }

  if (!existing || existing.status === "failed" || existing.jobs.length === 0
    || existing.plan.visualCues.some((cue) => cue.resolvedIdentity !== undefined && !cue.resolvedIdentity.trim())) {
    await processAssistantMessage(spindle, chatId, message, message.content, userId, { retry: true });
    return;
  }

  const freshJobs = createAssetJobs(existing.plan, config, characterAppearance);
  const freshJobMap = new Map(freshJobs.map((j) => [j.jobId, j]));
  const nowTime = new Date().toISOString();
  // Forced regeneration: re-queued jobs bypass cache lookup (they still own and
  // store their fresh render). Finished jobs, including cache-served ones
  // (always `generated`), are kept exactly as before; unfinished jobs never
  // carry an image id (schema invariant), so there is nothing to invalidate.
  const bypassJobIds = new Set<string>();
  const updatedJobs = existing.jobs.map((job) => {
    if (job.status === "browser_ready" || job.status === "generated") {
      return job;
    }
    bypassJobIds.add(job.jobId);
    const fresh = freshJobMap.get(job.jobId);
    return AssetJobSchema.parse({
      ...job,
      status: "queued",
      promptFingerprint: fresh?.promptFingerprint ?? job.promptFingerprint,
      imageId: null,
      imageUrl: null,
      error: null,
      queuedAt: nowTime,
      startedAt: null,
      generatedAt: null,
      readyAt: null,
      finishedAt: null
    });
  });

  const settingsSnapshot: Record<string, unknown> = {
    promptPrefix: config.promptPrefix,
    promptSuffix: config.promptSuffix,
    negativePrompt: config.negativePrompt,
    imageConnectionId: config.imageConnectionId,
    imageModel: config.imageModel,
    imageConcurrency: config.imageConcurrency
  };

  // Reuse-only candidates that have no job yet may hit now (cache only, no requests).
  if (config.generateImages && !config.useNativeCardImages && (existing.plan.cacheCues?.length || existing.plan.classifierVisuals)) {
    const scope = sceneImageScope(userId, chatId);
    retainPlanEpisodes(sceneCache, scope, existing.plan);
    const extra = await resolveCacheCues(spindle, existing.plan, config, characterAppearance, updatedJobs, sceneCache, userId, {
      log: (line) => dbg(spindle, userId, line),
      ...sourceTextOption(existing)
    });
    for (const job of extra) updatedJobs.push(job);
  }

  const updatedRecord: StoredTurnRecord = {
    ...existing,
    status: "ready",
    jobs: updatedJobs,
    updatedAt: nowTime,
    settingsSnapshot,
    attempts: [
      ...(existing.attempts ?? []),
      {
        attemptNumber: (existing.attempts?.length ?? 1) + 1,
        timestamp: nowTime,
        settings: settingsSnapshot
      }
    ]
  };

  activeTurnKeys.set(key, updatedRecord.plan.key);
  await saveTurnRecord(spindle, path, updatedRecord, userId);
  await persistActiveTurn(spindle, updatedRecord, path, userId);
  spindle.sendToFrontend({ type: "vn_turn", turn: await buildTurnView(spindle, updatedRecord, userId, config) }, userId);

  if (!config.useNativeCardImages && config.generateImages) {
    void startAssets(spindle, updatedRecord, path, userId, { bypassJobIds }).catch((error) => {
      if (!isAbortError(error)) {
        spindle.log.error(`Visual novel asset pipeline retry failed: ${errorText(error)}`);
        spindle.sendToFrontend({ type: "vn_error", chatId, operation: "retry_turn", error: errorText(error) }, userId);
      }
    });
  }
}

async function handleFrontendMessage(spindle: SpindleAPI, request: FrontendRequest, userId: string): Promise<void> {
  if (request.type === "vn_external_image") { await externalImages(spindle).request(request.request, userId); return; }
  if (request.type === "vn_external_image_cancel") { externalImages(spindle).cancel(request.request, userId); return; }
  dbg(spindle, userId, `frontend request ${request.type}`);
  switch (request.type) {
    case "vn_resolve_panel_template": {
      if (typeof request.requestId !== "string" || request.requestId.length > 100 || typeof request.chatId !== "string") return;
      try {
        const template = await resolvePanelTemplate(spindle, request.template, request.chatId, userId, typeof request.characterId === "string" ? request.characterId : undefined);
        spindle.sendToFrontend({ type: "vn_panel_template", requestId: request.requestId, chatId: request.chatId, template }, userId);
      } catch (error) {
        spindle.sendToFrontend({ type: "vn_panel_template", requestId: request.requestId, chatId: request.chatId, error: error instanceof Error ? error.message : String(error) }, userId);
      }
      return;
    }
    case "vn_view": {
      if (typeof request.chatId !== "string" || !request.chatId) return;
      if (request.open) openView(spindle, userId, request.chatId);
      else closeView(spindle, userId, request.chatId, "vn_view");
      return;
    }
    case "vn_get_state":
      await sendState(spindle, request.chatId ?? "", userId, request.viewOpen === undefined ? {} : { viewOpen: request.viewOpen });
      return;
    case "vn_get_connection_catalog": {
      const catalog = await loadConnectionCatalog(spindle, userId);
      spindle.sendToFrontend({ type: "vn_connection_catalog", ...catalog }, userId);
      return;
    }
    case "vn_get_system_one_key_status":
      spindle.sendToFrontend({ type: "vn_system_one_key_status", saved: await spindle.enclave.has(SYSTEM_ONE_KEY, userId) }, userId);
      return;
    case "vn_set_system_one_key": {
      const key = request.key.trim();
      if (!key || key.length > 8192) throw new Error("Enter a valid System One API key");
      await spindle.enclave.put(SYSTEM_ONE_KEY, key, userId);
      spindle.sendToFrontend({ type: "vn_system_one_key_status", saved: true }, userId);
      return;
    }
    case "vn_clear_system_one_key":
      await spindle.enclave.delete(SYSTEM_ONE_KEY, userId);
      spindle.sendToFrontend({ type: "vn_system_one_key_status", saved: false }, userId);
      return;
    case "vn_set_config": {
      const config = await updateConfig(spindle, request.patch, userId);
      rememberDebugFlag(userId, config);
      dbg(spindle, userId, `config saved (${Object.keys(request.patch).length} field(s) in patch)`);
      if (request.patch.audioDirectory !== undefined) {
        void scanAudioCatalog(spindle, config.audioDirectory);
      }
      spindle.sendToFrontend({ type: "vn_config", config }, userId);
      // Switching to sprite mode restages the open chat's current turn at once.
      if (request.patch.presentationMode === "sprites" && typeof request.chatId === "string" && request.chatId && views.isOpen(userId, request.chatId)) {
        const chatState = await loadChatState(spindle, request.chatId, userId);
        const record = await loadTurnRecord(spindle, chatState.activeTurnPath, userId).catch(() => null);
        if (record && record.plan.key.chatId === request.chatId) {
          spindle.sendToFrontend({ type: "vn_turn", turn: await buildTurnView(spindle, record, userId, config) }, userId);
        }
      }
      return;
    }
    case "vn_scan_audio": {
      const config = await loadConfig(spindle, userId);
      const dir = request.directory?.trim() || config.audioDirectory;
      const catalog = await scanAudioCatalog(spindle, dir, { force: true });
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
      // Submissions only come from the open view; a restarted backend relearns
      // the open state here so the resulting reply is not skipped.
      openView(spindle, userId, request.chatId);
      await submit(spindle, request, userId);
      return;
    case "vn_asset_ready":
      await markAssetReady(spindle, request, userId);
      return;
    case "vn_cancel": {
      bumpIntakeEpoch(userId, request.chatId);
      planningQueue.cancelChat(userId, request.chatId);
      assetControllers.get(runtimeKey(userId, request.chatId))?.abort("Cancelled from the visual novel UI.");
      releaseSceneCacheAdmission(spindle, userId, request.chatId, "cancel");
      return;
    }
    case "vn_refresh": {
      // "Try again" from a view that has no turn yet (waiting card, early
      // failure). It comes from the open view, so it relearns the open state
      // like submit/retry do, then goes through the same freshness check as
      // any state request: reuse, replan a changed selection, or bootstrap.
      // A chat with no assistant message answers vn_state/turn:null so the
      // stage leaves its planning phase instead of waiting forever.
      if (typeof request.chatId !== "string" || !request.chatId) return;
      await sendState(spindle, request.chatId, userId, { viewOpen: true });
      return;
    }
    case "vn_sprite_cut_result": {
      // Chunked cut-out PNG from the browser. Routed by request id only; the
      // base64 body is never logged.
      if (typeof request.requestId !== "string" || request.requestId.length > 100) return;
      spriteService(spindle).handleCutResult(userId, request);
      return;
    }
    case "vn_get_sprite_library":
      await spriteService(spindle).sendLibrary(userId);
      return;
    case "vn_sprite_action": {
      const config = await loadConfig(spindle, userId);
      rememberDebugFlag(userId, config);
      dbg(spindle, userId, `sprite action ${request.action}${request.setKey ? ` set=${request.setKey}` : ""}${request.expression ? ` expression=${request.expression}` : ""}${request.plateKey ? ` plate=${request.plateKey}` : ""}`);
      await spriteService(spindle).action(userId, request, {
        config,
        castForChat: (chatId) => spriteCastForChat(spindle, chatId, userId)
      });
      return;
    }
    case "vn_reference_image": {
      // Reply to a backend-initiated card reference fetch. The payload is
      // routed by request id only and never logged (it carries base64).
      if (typeof request.requestId !== "string" || request.requestId.length > 100) return;
      handleReferenceImageResponse(request);
      return;
    }
    case "vn_retry_turn": {
      // Retries only come from the open view; never gate explicit user actions.
      openView(spindle, userId, request.chatId);
      const messages = await spindle.chat.getMessages(request.chatId) as NormalizedChatMessage[];
      const message = messages.find((candidate) => candidate.id === request.messageId);
      if (!message) throw new Error("The assistant message no longer exists.");
      await retryTurn(spindle, request.chatId, message, userId);
      return;
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
  bumpIntakeEpoch(userId, candidate.chatId);
  planningQueue.cancelChat(userId, candidate.chatId);
  assetControllers.get(runtimeKey(userId, candidate.chatId))?.abort("The source assistant message was deleted.");
  activeTurnKeys.delete(runtimeKey(userId, candidate.chatId));
  // The chat's scene lineage restarts (latestScene becomes null): release the
  // whole scope so the next "initial" episode never shares the old entries.
  releaseSceneCacheScope(spindle, userId, candidate.chatId, "scope_cleared");
  await saveChatState(spindle, candidate.chatId, {
    schemaVersion: 1,
    activeTurnPath: null,
    latestScene: null,
    terminalContinuity: null,
    updatedAt: new Date().toISOString()
  }, userId);
  await sendState(spindle, candidate.chatId, userId, { viewOpen: views.isOpen(userId, candidate.chatId) });
}

function reconcileMessageEvent(spindle: SpindleAPI, payload: unknown, userId?: string): void {
  const event = eventMessage(payload);
  if (!event || event.message.is_user) return;
  void (async () => {
    if (!(await allowAutomaticWork(spindle, userId, event.chatId, "message reconcile"))) return;
    // A newer version of the message supersedes any intake still resolving.
    bumpIntakeEpoch(userId, event.chatId);
    releaseSceneCacheAdmission(spindle, userId, event.chatId, "message_changed");
    await processAssistantMessage(spindle, event.chatId, event.message, event.message.content, userId);
  })().catch((error) => {
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
    bumpIntakeEpoch(userId, payload.chatId);
    activeTurnKeys.delete(key);
    assetControllers.get(key)?.abort("A new generation started before this turn's assets settled.");
    releaseSceneCacheAdmission(spindle, userId, payload.chatId, "generation_started");
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
  spindle.on("CHAT_SWITCHED", (payload: unknown, userId?: string) => {
    // Host-side notice of the active chat. The frontend also asks for state on
    // CHAT_SWITCHED, so `vn_get_state` remains the fallback observation.
    const candidate = payload && typeof payload === "object" ? payload as { chatId?: unknown } : {};
    const chatId = typeof candidate.chatId === "string" ? candidate.chatId : "";
    dbg(spindle, userId, `event CHAT_SWITCHED chat=${chatId || "(none)"}`);
    noteActiveChat(spindle, userId, chatId);
  });
  spindle.on("IMAGE_DELETED", (payload: unknown) => {
    // Best effort: a deleted gallery image must never be served from the cache again.
    const candidate = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const imageId = [candidate.imageId, candidate.id, (candidate.image as Record<string, unknown> | undefined)?.id]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (!imageId) return;
    const dropped = sceneCache.invalidateImage(imageId, "image_deleted");
    if (dropped > 0) spindle.log.info(`[VN] scene-cache dropped ${dropped} entr${dropped === 1 ? "y" : "ies"} for deleted image ${imageId}`);
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
