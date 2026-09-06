import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../config.js";
import { AssetJobSchema, type AssetJob, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import { AssetScheduler } from "../core/asset-scheduler.js";
import {
  SceneImageCache,
  sceneEpisodeOf,
  sceneImageCacheKey,
  sceneImageScope,
  shortSceneKey,
  type SceneImageAdmission,
  type SceneImageCacheEntry,
  type SceneImageIdentity,
  type SceneImageMissReason,
  type SceneImageOutcome,
  type SceneImageProvenance
} from "../core/scene-image-cache.js";
import { POSE_EXPRESSION_CATALOGUE, poseById } from "../../shared/character.js";
import { compileActionProp } from "../../shared/action-prop.js";
import {
  appearanceMapKeyFor,
  characterAppearanceKey,
  characterIdFor,
  normalizeCharacterName,
  stripAnatomyCompounds,
  subjectPromptFor,
  type CharacterAppearanceMap,
  type SubjectCategory
} from "../../shared/identity.js";
import { assemblePrompt, normalizeConfig, renderNegativeWithCurrentSelection, renderPrompt, splitTopLevelCsv, parseWeightedGroup, validateAndRepairDelimiters, type Config, type PromptEntry } from "../inlay-prompt/index.js";
import {
  loadCharacterAppearance,
  loadPortraits,
  savePortrait,
  VALID_IMAGE_MIMES,
  type StoredPortrait
} from "./storage.js";

export type AssetUpdateHandler = (jobs: AssetJob[], changed: AssetJob) => Promise<void> | void;

function hash(source: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    value = Math.imul(value ^ source.charCodeAt(index), 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

function sceneForCue(plan: TurnPlan, cue: VisualCue): SceneState {
  const scene = plan.scenes.find((candidate) => candidate.sceneId === cue.sceneId && candidate.revision === cue.sceneRevision);
  if (!scene) throw new Error(`No scene owns visual cue ${cue.cueId}.`);
  return scene;
}

export type CueVisualState = {
  characterName: string;
  characterKey: string;
  /** Stable registry id when the planner resolved one; falls back to the name key. */
  characterId: string;
  /** Durable subject class persisted with the cue; `unknown` defers to the identity text. */
  subjectCategory: SubjectCategory;
  baseIdentity: string;
  identity: string;
  attire: string;
};

export function portraitIdentityFingerprint(name: string, identity: string, config: VisualNovelConfig, provider: string | null): string {
  if (!identity.trim()) return "";
  return hash(JSON.stringify(["identity-v2", characterAppearanceKey(name), identity.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean).sort(), provider, config.imageConnectionId, config.imageModel]));
}

export function compatiblePortrait(portrait: StoredPortrait | undefined, fingerprint: string): StoredPortrait | undefined {
  return fingerprint && portrait?.identityFingerprint === fingerprint ? portrait : undefined;
}

export function resolveCueCharacterVisualState(
  scene: SceneState,
  cue: VisualCue,
  characterAppearance?: CharacterAppearanceMap
): CueVisualState {
  const characterName = cueCharacterName(scene, cue);
  const characterKey = characterAppearanceKey(characterName);
  const sceneCharacterName = normalizeCharacterName(scene.character || scene.cast[0] || "");
  const sceneCharacterKey = characterAppearanceKey(sceneCharacterName);

  let baseIdentity = "";
  if (characterKey && sceneCharacterKey && characterKey === sceneCharacterKey) {
    baseIdentity = scene.identityPrompt?.trim() ?? "";
  } else if (characterKey && sceneCharacterKey && characterKey !== sceneCharacterKey) {
    // Cue character differs from the scene's primary character.
    // Do not leak the scene character's identity prompt.
    const mapKey = appearanceMapKeyFor(characterAppearance, characterName);
    if (mapKey && characterAppearance?.[mapKey]) {
      baseIdentity = characterAppearance[mapKey].trim();
    } else if (scene.continuity?.characters) {
      const match = Object.entries(scene.continuity.characters).find(
        ([name]) => characterAppearanceKey(name) === characterKey
      );
      if (match && match[1]?.appearance) {
        baseIdentity = Object.values(match[1].appearance).filter(Boolean).join(", ");
      }
    }
  } else {
    baseIdentity = scene.identityPrompt?.trim() ?? "";
  }

  if (cue.resolvedIdentity !== undefined) baseIdentity = cue.resolvedIdentity;
  const attire = cue.resolvedAttire !== undefined ? cue.resolvedAttire ?? "" : cue.attire || (characterKey === sceneCharacterKey ? scene.attire : null) || "";
  let identity = baseIdentity;
  if (attire && identity) {
    identity = applyAttireOverride(identity, attire);
  } else if (attire) {
    identity = attire;
  }

  const characterId = cue.characterId?.trim() || (characterKey === sceneCharacterKey && scene.characterId?.trim()) || characterIdFor(characterName);
  const subjectCategory: SubjectCategory = cue.subjectCategory
    ?? (characterKey === sceneCharacterKey ? scene.subjectCategory : undefined)
    ?? "unknown";
  return { characterName, characterKey, characterId, subjectCategory, baseIdentity, identity, attire };
}

/** Compiled camera block. Fixed for every scene image; kept in one place so the cache key sees the same values. */
const CUE_CAMERA = { framing: "upper body", angle: "eye level", perspective: "straight-on" } as const;

/**
 * Everything the prompt compiler consumed for one cue, plus its output. The
 * scene-image cache keys on this structured description, so it must stay the
 * single source for `compileImagePrompt` / `compileNegativePrompt`.
 */
export type CueDescription = {
  visualState: CueVisualState;
  pose: { id: string; suffix: string };
  actionTag: string | null;
  environment: SceneImageIdentity["environment"];
  framing: SceneImageIdentity["framing"];
  entry: PromptEntry;
  promptSyntax: Config["promptSyntax"];
};

export function describeCue(
  config: VisualNovelConfig,
  scene: SceneState,
  cue: VisualCue,
  characterAppearance?: CharacterAppearanceMap
): CueDescription {
  const promptSyntax = (config as any).promptSyntax ?? "comfyui";
  const compilerConfig = normalizeConfig({
    promptSyntax,
    promptStyle: "anima",
    supplement: true,
    customPositivePrefix: config.promptPrefix,
    customPositiveSuffix: config.promptSuffix,
    customNegative: config.negativePrompt,
    maxCharacters: 1,
    perspectiveMode: "dynamic",
    originalReference: config.originalReference,
    originalCreationName: config.originalCreationName
  });
  const visualState = resolveCueCharacterVisualState(scene, cue, characterAppearance);
  const identity = visualState.identity;
  const [label, situation] = classifySubject(identity, visualState.subjectCategory);
  const pose = poseById(POSE_EXPRESSION_CATALOGUE, cue.poseExpressionId);
  const actionTag = compileActionProp(cue.action);
  const timeWeather = [scene.environment.timeOfDay, scene.environment.weather].filter(Boolean).join(", ");
  const desc = scene.environment.description?.trim();
  const isRedundantDesc = !desc || desc.toLowerCase() === `a quiet ${scene.environment.location.toLowerCase()}.` || desc.toLowerCase() === scene.environment.location.toLowerCase();
  const environment: SceneImageIdentity["environment"] = {
    location: scene.environment.location,
    timeWeather,
    lighting: scene.environment.lighting ?? null,
    description: isRedundantDesc ? null : desc,
    persistentElements: [...scene.environment.persistentElements]
  };
  const entry = assemblePrompt({
    environment: {
      location: [environment.location],
      timeWeather,
      lightingMood: environment.lighting ? [environment.lighting] : [],
      backgroundElements: environment.persistentElements,
      ...(environment.description ? { description: [environment.description] } : {})
    }
  }, {
    paragraph: 1,
    situation,
    camera: { ...CUE_CAMERA, focus: [] },
    characters: [{
      ...(config.originalReference && config.originalCreationName?.trim() && visualState.characterName
        ? { name: visualState.characterName }
        : {}),
      label,
      identity,
      expression: pose.suffix,
      ...(actionTag ? { action: actionTag } : {}),
      visibleTags: identity
    }]
  }, compilerConfig, 1, 1);
  return {
    visualState,
    pose: { id: pose.id, suffix: pose.suffix },
    actionTag: actionTag || null,
    environment,
    framing: { ...CUE_CAMERA },
    entry,
    promptSyntax
  };
}

function compilePromptEntry(
  config: VisualNovelConfig,
  scene: SceneState,
  cue: VisualCue,
  characterAppearance?: CharacterAppearanceMap
): PromptEntry {
  return describeCue(config, scene, cue, characterAppearance).entry;
}

export function compileImagePrompt(
  config: VisualNovelConfig,
  scene: SceneState,
  cue: VisualCue,
  characterAppearance?: CharacterAppearanceMap,
  syntax?: Config["promptSyntax"]
): string {
  const selectedSyntax = syntax ?? (config as any).promptSyntax ?? "comfyui";
  const entry = compilePromptEntry(config, scene, cue, characterAppearance);
  return renderPrompt(entry.prompt, selectedSyntax);
}

export function compileNegativePrompt(
  config: VisualNovelConfig,
  scene: SceneState,
  cue: VisualCue,
  characterAppearance?: CharacterAppearanceMap
): string {
  const entry = compilePromptEntry(config, scene, cue, characterAppearance);
  if (entry.negative) return entry.negative;
  const compilerConfig = normalizeConfig({
    promptSyntax: "comfyui",
    promptStyle: "anima",
    supplement: true,
    customPositivePrefix: config.promptPrefix,
    customPositiveSuffix: config.promptSuffix,
    customNegative: config.negativePrompt,
    maxCharacters: 1,
    perspectiveMode: "dynamic"
  });
  return renderNegativeWithCurrentSelection(entry.shotNegative, entry.prompt.format ?? "ordered", compilerConfig);
}

/** Sort user image parameters deterministically. Internal reference payloads are never part of this map. */
function userImageParameters(config: VisualNovelConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(config.imageParameters).sort()) out[key] = config.imageParameters[key];
  return out;
}

/**
 * Structured exact-compatibility identity for one cue: the effective state
 * the compiler consumed (durable subject, wardrobe, environment incl. lighting,
 * pose, bounded action, framing) AND the exact provider request it produced.
 * `provider` is the resolved image provider id (null when unknown).
 */
export function sceneImageIdentityFor(
  config: VisualNovelConfig,
  scene: SceneState,
  cue: VisualCue,
  characterAppearance: CharacterAppearanceMap | undefined,
  provider: string | null
): SceneImageIdentity {
  const description = describeCue(config, scene, cue, characterAppearance);
  const { connectionId, workflowId } = splitConnectionSelection(config.imageConnectionId);
  return {
    subject: {
      characterId: description.visualState.characterId,
      subjectCategory: description.visualState.subjectCategory
    },
    appearance: {
      identity: description.visualState.identity,
      attire: description.visualState.attire
    },
    environment: description.environment,
    pose: description.pose,
    action: description.actionTag,
    framing: description.framing,
    request: {
      prompt: renderPrompt(description.entry.prompt, description.promptSyntax),
      negativePrompt: compileNegativePrompt(config, scene, cue, characterAppearance),
      provider,
      connectionId: connectionId ? (workflowId ? `${connectionId}::${workflowId}` : connectionId) : null,
      model: config.imageModel,
      parameters: userImageParameters(config),
      promptSyntax: description.promptSyntax,
      referenceAnchoring: referenceAnchoringEnabled(config)
    }
  };
}

/** Provider key used by cache-resolved (reuse-only) jobs. They never touch the scheduler. */
export const CACHE_JOB_PROVIDER = "cache";

export type SceneImageVerifier = (imageId: string) => Promise<boolean>;

/**
 * Default verifier: the image must still exist in Lumiverse. When the host
 * does not expose `images.get`, the asset is unverifiable and treated as
 * missing (normal generation runs instead).
 */
export function defaultSceneImageVerifier(spindle: SpindleAPI, userId?: string): SceneImageVerifier {
  return async (imageId) => {
    const api = (spindle as { images?: { get?: (id: string, userId?: string) => Promise<unknown> } }).images;
    if (!api || typeof api.get !== "function") throw new Error("images.get unavailable");
    return Boolean(await api.get(imageId, userId));
  };
}

export type SceneCacheOptions = {
  sceneCache?: SceneImageCache | null;
  /** Token minted when the batch was admitted; defaults to a token minted at call time. */
  admission?: SceneImageAdmission;
  /** Jobs that must skip lookup (forced regeneration). They still claim and store. */
  bypassJobIds?: Iterable<string>;
  verifyImage?: SceneImageVerifier;
};

/**
 * Keep only the physical scene episodes this plan can reach. Call whenever a
 * plan is accepted for a chat (planning, retry, batch start). Idempotent.
 */
export function retainPlanEpisodes(cache: SceneImageCache, scope: string, plan: TurnPlan): number {
  return cache.retainEpisodes(scope, plan.scenes.map((scene) => sceneEpisodeOf(scene, cache.generation(scope))));
}

/**
 * Fail closed on identity: the cache only serves cues whose durable identity
 * was persisted by the planner (registry id, resolved appearance, subject
 * class). Legacy or unresolved cues always take normal generation.
 */
export function cacheEligibleCue(cue: VisualCue): boolean {
  return Boolean(cue.characterId?.trim()) && Boolean(cue.resolvedIdentity?.trim()) && cue.subjectCategory !== undefined;
}

/** Resolve the image provider once per batch; null when unknown. */
export async function resolveSceneImageProvider(spindle: SpindleAPI, config: VisualNovelConfig, userId?: string): Promise<string | null> {
  return resolveImageProviderId(spindle, config, userId);
}

/**
 * Deterministic cache lookup for the plan's reuse-only candidates
 * (`plan.cacheCues`, the cues beyond `maxImagesPerTurn`). A hit becomes a
 * terminal `generated` job with provider `cache`; a miss produces nothing: no
 * job, no provider request, no budget change. Candidates that already have a
 * job (any status) are skipped. Never throws.
 */
export async function resolveCacheCues(
  spindle: SpindleAPI,
  plan: TurnPlan,
  config: VisualNovelConfig,
  characterAppearance: CharacterAppearanceMap | undefined,
  existingJobs: readonly AssetJob[],
  cache: SceneImageCache,
  userId?: string,
  options: { provider?: string | null; verifyImage?: SceneImageVerifier; log?: (line: string) => void } = {}
): Promise<AssetJob[]> {
  const candidates = plan.cacheCues ?? [];
  if (candidates.length === 0) return [];
  const scope = sceneImageScope(userId, plan.key.chatId);
  const haveJob = new Set(existingJobs.map((job) => job.jobId));
  const pending = candidates.filter((cue) => !haveJob.has(cue.assetJobId));
  if (pending.length === 0) return [];
  const provider = options.provider !== undefined ? options.provider : await resolveImageProviderId(spindle, config, userId);
  const verify = options.verifyImage ?? defaultSceneImageVerifier(spindle, userId);
  const log = options.log ?? (() => {});
  const resolved: AssetJob[] = [];
  for (const cue of pending) {
    let scene: SceneState;
    try {
      scene = sceneForCue(plan, cue);
    } catch {
      continue;
    }
    if (!cacheEligibleCue(cue)) {
      cache.recordMiss("identity_unresolved");
      log(`scene-cache candidate p${cue.paragraphIndex} miss reason=identity_unresolved (no job, no request)`);
      continue;
    }
    let key: string;
    try {
      key = sceneImageCacheKey(sceneImageIdentityFor(config, scene, cue, characterAppearance, provider));
    } catch {
      continue;
    }
    const episode = sceneEpisodeOf(scene, cache.generation(scope));
    const found = cache.lookup(scope, key, episode);
    if (found.status === "miss") {
      log(`scene-cache candidate p${cue.paragraphIndex} miss reason=${found.reason} key=${shortSceneKey(key)} (no job, no request)`);
      continue;
    }
    const verdict = await verifyEntry(cache, scope, key, found.entry, verify);
    if (verdict !== "ok") {
      log(`scene-cache candidate p${cue.paragraphIndex} miss reason=${verdict} image=${found.entry.imageId} (no job, no request)`);
      continue;
    }
    const timestamp = new Date().toISOString();
    const job = AssetJobSchema.parse({
      jobId: cue.assetJobId,
      ownerTurnKey: plan.key,
      sceneId: cue.sceneId,
      sceneRevision: cue.sceneRevision,
      paragraphIndex: cue.paragraphIndex,
      promptFingerprint: key,
      provider: CACHE_JOB_PROVIDER,
      priority: "background",
      status: "generated",
      imageId: found.entry.imageId,
      imageUrl: found.entry.imageUrl,
      error: null,
      queuedAt: timestamp,
      startedAt: timestamp,
      generatedAt: timestamp,
      readyAt: null,
      finishedAt: null
    });
    log(`scene-cache candidate p${cue.paragraphIndex} hit key=${shortSceneKey(key)} image=${found.entry.imageId} from message=${found.entry.provenance.assistantMessageId} -> extra swap without a request`);
    resolved.push(job);
  }
  return resolved;
}

/** Confirm a hit still points at a real asset; otherwise retire it. */
async function verifyEntry(
  cache: SceneImageCache,
  scope: string,
  key: string,
  entry: SceneImageCacheEntry,
  verify: SceneImageVerifier
): Promise<"ok" | Extract<SceneImageMissReason, "asset_missing" | "asset_unverifiable">> {
  let reason: "asset_missing" | "asset_unverifiable";
  try {
    if (await verify(entry.imageId)) return "ok";
    reason = "asset_missing";
  } catch {
    reason = "asset_unverifiable";
  }
  cache.revokeHit();
  cache.invalidate(scope, key, reason);
  cache.recordMiss(reason);
  return reason;
}

export function createAssetJobs(
  plan: TurnPlan,
  config: VisualNovelConfig,
  characterAppearance?: CharacterAppearanceMap
): AssetJob[] {
  const now = new Date().toISOString();
  return plan.visualCues.map((cue, index) => {
    const scene = sceneForCue(plan, cue);
    const pose = poseById(POSE_EXPRESSION_CATALOGUE, cue.poseExpressionId);
    const promptIdentity = `${compileImagePrompt(config, scene, cue, characterAppearance)}\0${pose.id}`;
    return AssetJobSchema.parse({
      jobId: cue.assetJobId,
      ownerTurnKey: plan.key,
      sceneId: cue.sceneId,
      sceneRevision: cue.sceneRevision,
      paragraphIndex: cue.paragraphIndex,
      promptFingerprint: `${hash(promptIdentity)}${hash(promptIdentity.split("").reverse().join(""))}`,
      provider: "pending",
      priority: index === 0 ? "visible" : index === 1 ? "next" : "background",
      status: "queued",
      imageId: null,
      imageUrl: null,
      error: null,
      queuedAt: now,
      startedAt: null,
      generatedAt: null,
      readyAt: null,
      finishedAt: null
    });
  });
}

function replaceJob(jobs: AssetJob[], next: AssetJob): AssetJob[] {
  return jobs.map((job) => job.jobId === next.jobId ? next : job);
}

function abortError(signal: AbortSignal): Error {
  const error = new Error(typeof signal.reason === "string" ? signal.reason : "Image generation cancelled.");
  error.name = "AbortError";
  return error;
}

const REFERENCE_PROVIDERS = new Set(["novelai", "comfyui", "swarmui"]);

/** Whether reference anchoring is enabled for this config (default on). */
export function referenceAnchoringEnabled(config: VisualNovelConfig): boolean {
  return config.referenceAnchoring !== false && config.imageParameters.referenceAnchoring !== false;
}

/** The character a cue depicts, used as the portrait lookup key. */
export function cueCharacterName(scene: SceneState, cue: VisualCue): string {
  return normalizeCharacterName(cue.character || scene.character || scene.cast[0] || "");
}

/** Provider-specific reference parameters for one generation. */
export function referenceParametersFor(
  provider: string | null,
  portrait: Pick<StoredPortrait, "data" | "mimeType">,
  config: VisualNovelConfig
): Record<string, unknown> {
  if (!provider || !REFERENCE_PROVIDERS.has(provider)) return {};
  if (provider === "novelai") {
    const raw = Number(config.imageParameters.referenceStrength);
    const strength = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.6;
    return {
      resolvedReferenceImages: [{
        data: portrait.data,
        strength,
        infoExtracted: 1,
        refType: "character"
      }]
    };
  }
  return {
    resolvedSourceImages: [{ data: portrait.data, mimeType: portrait.mimeType }]
  };
}

/** Parse a base64 data URL into raw base64 bytes and a MIME type. */
export function parseDataUrl(dataUrl: string | undefined): { data: string; mimeType: string } | null {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const mimeType = match[1]!.toLowerCase();
  const data = match[2]!;
  if (!VALID_IMAGE_MIMES.has(mimeType)) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  return { mimeType, data };
}

/**
 * Split a settings connection id into the real connection profile id and an
 * optional ComfyUI workflow id. The settings catalog exposes per-workflow
 * entries as compound `<connectionId>::<workflowId>` ids.
 */
export function splitConnectionSelection(raw: string | null): { connectionId?: string; workflowId?: string } {
  if (!raw) return {};
  const separator = raw.indexOf("::");
  if (separator === -1) return { connectionId: raw };
  return { connectionId: raw.slice(0, separator), workflowId: raw.slice(separator + 2) };
}

async function resolveImageProviderId(
  spindle: SpindleAPI,
  config: VisualNovelConfig,
  userId?: string
): Promise<string | null> {
  try {
    const { connectionId } = splitConnectionSelection(config.imageConnectionId);
    if (connectionId) {
      const connection = await spindle.imageGen.getConnection(connectionId, userId);
      return connection?.provider ?? null;
    }
    const connections = await spindle.imageGen.listConnections(userId);
    const chosen = connections.find((candidate) => candidate.is_default) ?? connections[0];
    return chosen?.provider ?? null;
  } catch {
    return null;
  }
}

export async function generateAssets(
  spindle: SpindleAPI,
  plan: TurnPlan,
  initialJobs: AssetJob[],
  config: VisualNovelConfig,
  signal: AbortSignal,
  onUpdate: AssetUpdateHandler,
  userId?: string,
  cacheOptions: SceneCacheOptions = {}
): Promise<AssetJob[]> {
  let jobs = [...initialJobs];
  const providerKey = `image:${config.imageConnectionId ?? "default"}`;
  const scheduler = new AssetScheduler({ [providerKey]: { concurrency: config.imageConcurrency } });
  const cache = cacheOptions.sceneCache ?? null;
  // The provider id is part of the cache key, so resolve it whenever the cache
  // is on; reference anchoring keeps its own gate below.
  const provider = referenceAnchoringEnabled(config) || cache ? await resolveImageProviderId(spindle, config, userId) : null;
  const anchorable = referenceAnchoringEnabled(config) && provider !== null && REFERENCE_PROVIDERS.has(provider);

  const [initialPortraits, characterAppearance] = await Promise.all([
    anchorable ? loadPortraits(spindle, plan.key.chatId, userId).catch(() => ({} as Record<string, StoredPortrait>)) : Promise.resolve({} as Record<string, StoredPortrait>),
    loadCharacterAppearance(spindle, userId, plan.key.chatId).catch(() => ({} as CharacterAppearanceMap))
  ]);
  const portraits: Record<string, StoredPortrait> = { ...initialPortraits };

  if (config.debugLogging) {
    const portraitNames = Object.values(portraits).map((entry) => entry.name).join(", ");
    spindle.log.info(`[VN] reference anchoring ${anchorable ? `active (provider=${provider})` : referenceAnchoringEnabled(config) ? `inactive (provider=${provider ?? "unknown"} unsupported)` : "disabled by config"}; ${Object.keys(portraits).length} portrait(s)${portraitNames ? ` [${portraitNames}]` : ""}`);
  }

  /* ---- scene-image cache (temporary, reuse-first, generate-on-miss) ---- */
  const scope = sceneImageScope(userId, plan.key.chatId);
  const admission = cache ? (cacheOptions.admission ?? cache.admission(scope)) : null;
  const bypass = new Set(cacheOptions.bypassJobIds ?? []);
  const verify = cacheOptions.verifyImage ?? defaultSceneImageVerifier(spindle, userId);
  const cacheLog = (line: string): void => {
    if (config.debugLogging) spindle.log.info(`[VN] ${line}`);
  };
  const observedGenerationMs: number[] = [];
  const estimateSavedMs = (): string => {
    if (observedGenerationMs.length === 0) return "unknown (no provider timing observed in this batch yet)";
    const mean = observedGenerationMs.reduce((sum, value) => sum + value, 0) / observedGenerationMs.length;
    return `~${Math.round(mean)}ms, estimate = mean of ${observedGenerationMs.length} provider call(s) in this batch`;
  };
  if (cache) {
    const retired = retainPlanEpisodes(cache, scope, plan);
    if (retired > 0) cacheLog(`scene-cache retired ${retired} entr${retired === 1 ? "y" : "ies"} from earlier physical scenes (episodes now ${plan.scenes.map((scene) => sceneEpisodeOf(scene, cache.generation(scope))).join(",")})`);
    cacheLog(`scene-cache batch admitted scope=${scope} epoch=${admission!.epoch} entries=${cache.size} bypass=${bypass.size}`);
  }
  const provenanceFor = (jobId: string, promptFingerprint: string): SceneImageProvenance => {
    const { connectionId, workflowId } = splitConnectionSelection(config.imageConnectionId);
    return {
      provider,
      connectionId: connectionId ? (workflowId ? `${connectionId}::${workflowId}` : connectionId) : null,
      model: config.imageModel,
      promptFingerprint,
      assistantMessageId: plan.key.assistantMessageId,
      swipeId: plan.key.swipeId,
      jobId
    };
  };
  const stillAdmitted = (): boolean => Boolean(cache && admission && cache.isAdmitted(admission) && !signal.aborted);
  /** After a budgeted store, reuse-only candidates may now hit. Deterministic, no requests. */
  let resolvingCandidates: Promise<void> = Promise.resolve();
  const resolveCandidatesNow = (): Promise<void> => {
    if (!cache || !plan.cacheCues?.length) return Promise.resolve();
    resolvingCandidates = resolvingCandidates.then(async () => {
      if (!stillAdmitted()) return;
      const extra = await resolveCacheCues(spindle, plan, config, characterAppearance, jobs, cache, userId, { provider, verifyImage: verify, log: cacheLog });
      if (!stillAdmitted()) return;
      for (const job of extra) {
        if (jobs.some((existing) => existing.jobId === job.jobId)) continue;
        jobs = [...jobs, job];
        await onUpdate(jobs, job);
      }
    }).catch(() => undefined);
    return resolvingCandidates;
  };

  const capturePromises = new Map<string, Promise<StoredPortrait | null>>();
  const ownedJobIds = new Set(initialJobs.map((job) => job.jobId));
  const unsubscribe = scheduler.subscribe((changed) => {
    if (!ownedJobIds.has(changed.jobId)) return;
    jobs = replaceJob(jobs, changed);
    void onUpdate(jobs, changed);
  });
  const abort = (): void => {
    scheduler.cancelTurn((job) => ownedJobIds.has(job.jobId), typeof signal.reason === "string" ? signal.reason : undefined);
  };
  signal.addEventListener("abort", abort, { once: true });

  try {
    if (cache && plan.cacheCues?.length) await resolveCandidatesNow();
    const promises = plan.visualCues.map((cue) => {
      const existing = initialJobs.find((job) => job.jobId === cue.assetJobId);
      if (!existing) throw new Error(`Missing asset job ${cue.assetJobId}.`);
      // A retry keeps finished images: such jobs are preserved as-is and never
      // re-scheduled (the scheduler only accepts queued jobs).
      if (existing.status === "generated" || existing.status === "browser_ready") return Promise.resolve(existing);
      const job = AssetJobSchema.parse({ ...existing, provider: providerKey });
      return scheduler.schedule(job, async (scheduledJob, jobSignal) => {
        if (signal.aborted) throw abortError(signal);
        const scene = sceneForCue(plan, cue);
        const visualState = resolveCueCharacterVisualState(scene, cue, characterAppearance);
        if (cue.resolvedIdentity !== undefined && !cue.resolvedIdentity.trim()) throw new Error(`No usable appearance was resolved for "${visualState.characterName}". Replan this turn with a character description; the previous character will not be substituted.`);
        const prompt = compileImagePrompt(config, scene, cue, characterAppearance);
        const negativePrompt = compileNegativePrompt(config, scene, cue, characterAppearance);
        const characterName = visualState.characterName;
        const characterKey = visualState.characterKey;

        /* ---- reference anchoring decision first: unchanged, and it gates reuse ---- */
        // If another render is currently capturing this character, wait for it before proceeding.
        // Dependent renders wait; unrelated characters stay concurrent.
        if (anchorable && characterKey && capturePromises.has(characterKey)) {
          try {
            await capturePromises.get(characterKey);
          } catch {
            // Predecessor capture failure is handled gracefully below
          }
        }

        const identityFingerprint = portraitIdentityFingerprint(characterName, visualState.baseIdentity, config, provider);
        let portrait = anchorable && characterKey ? compatiblePortrait(portraits[characterKey], identityFingerprint) : undefined;
        let isCaptureOwner = false;
        let captureResolve: ((val: StoredPortrait | null) => void) | undefined;

        const wantsCapture = anchorable && Boolean(characterKey) && Boolean(identityFingerprint) && !portrait && !capturePromises.has(characterKey);
        if (wantsCapture) {
          isCaptureOwner = true;
          const promise = new Promise<StoredPortrait | null>((resolve) => {
            captureResolve = resolve;
          });
          capturePromises.set(characterKey, promise);
        }

        /* ---- reuse-first: exact-compatible cached image, or own the generation ---- */
        let cacheKey: string | null = null;
        let episode = "";
        let settle: ((outcome: SceneImageOutcome) => void) | null = null;
        if (cache && admission) {
          if (!cacheEligibleCue(cue)) {
            cache.recordMiss("identity_unresolved");
            cacheLog(`scene-cache p${cue.paragraphIndex} miss reason=identity_unresolved (planner did not persist a durable identity) -> generating`);
          } else {
            cacheKey = sceneImageCacheKey(sceneImageIdentityFor(config, scene, cue, characterAppearance, provider));
            episode = sceneEpisodeOf(scene, cache.generation(scope));
            if (bypass.has(scheduledJob.jobId)) {
              cache.recordMiss("bypass");
              cacheLog(`scene-cache p${cue.paragraphIndex} miss reason=bypass (forced regeneration) key=${shortSceneKey(cacheKey)} -> generating`);
            } else if (wantsCapture) {
              // Reference anchoring needs this render to capture the character's
              // portrait. Reuse would skip that capture, so the cache stands aside
              // (the render is still owned and stored for later cues).
              cache.recordMiss("portrait_capture");
              cacheLog(`scene-cache p${cue.paragraphIndex} miss reason=portrait_capture (portrait for "${characterName}" must be captured by this render) key=${shortSceneKey(cacheKey)} -> generating`);
            } else {
              // Loop: a hit may turn out to point at a deleted asset, and a
              // waiter may be released by an aborted owner; both re-enter here.
              for (;;) {
                if (signal.aborted) throw abortError(signal);
                if (jobSignal.aborted) throw abortError(jobSignal);
                const found = cache.lookup(scope, cacheKey, episode);
                if (found.status === "hit") {
                  const verdict = await verifyEntry(cache, scope, cacheKey, found.entry, verify);
                  if (verdict === "ok") {
                    cacheLog(`scene-cache p${cue.paragraphIndex} hit key=${shortSceneKey(cacheKey)} image=${found.entry.imageId} from message=${found.entry.provenance.assistantMessageId} job=${found.entry.provenance.jobId} -> generation avoided (saved: ${estimateSavedMs()})`);
                    return { imageId: found.entry.imageId, imageUrl: found.entry.imageUrl };
                  }
                  cacheLog(`scene-cache p${cue.paragraphIndex} miss reason=${verdict} image=${found.entry.imageId} -> generating`);
                } else {
                  cacheLog(`scene-cache p${cue.paragraphIndex} miss reason=${found.reason} key=${shortSceneKey(cacheKey)}`);
                }
                const claim = cache.claim(scope, cacheKey, jobSignal);
                if (claim.role === "owner") {
                  settle = claim.settle;
                  cacheLog(`scene-cache p${cue.paragraphIndex} owns generation key=${shortSceneKey(cacheKey)}`);
                  break;
                }
                const waitStarted = Date.now();
                cacheLog(`scene-cache p${cue.paragraphIndex} waiting for in-flight compatible generation key=${shortSceneKey(cacheKey)}`);
                const outcome = await claim.promise;
                const waitedMs = Date.now() - waitStarted;
                if (outcome.kind === "entry") {
                  cacheLog(`scene-cache p${cue.paragraphIndex} shared in-flight result image=${outcome.entry.imageId} after ${waitedMs}ms wait -> generation avoided`);
                  cache.recordHitShared();
                  return { imageId: outcome.entry.imageId, imageUrl: outcome.entry.imageUrl };
                }
                if (outcome.kind === "failed") {
                  cacheLog(`scene-cache p${cue.paragraphIndex} in-flight owner failed after ${waitedMs}ms wait -> failing once, no retry cascade`);
                  throw outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
                }
                if (!cache.isAdmitted(admission)) {
                  const stale = new Error("Scene changed while waiting for a compatible image.");
                  stale.name = "AbortError";
                  throw stale;
                }
                cacheLog(`scene-cache p${cue.paragraphIndex} in-flight owner ${outcome.kind} after ${waitedMs}ms wait -> re-claiming`);
              }
            }
          }
        }

        let generationSettled = false;
        try {
          if (config.debugLogging && anchorable) {
            spindle.log.info(`[VN] cue p${cue.paragraphIndex}: ${portrait ? `anchored to portrait ${portrait.imageId} (${portrait.name})` : wantsCapture ? `no portrait for "${characterName}" yet — capturing this render` : `unanchored (character="${characterName}")`}`);
          }
          const parameters = portrait && provider
            ? { ...config.imageParameters, ...referenceParametersFor(provider, portrait, config) }
            : config.imageParameters;
          const { connectionId, workflowId } = splitConnectionSelection(config.imageConnectionId);
          const effectiveParameters = {
            ...parameters,
            ...(workflowId ? { workflow_id: workflowId } : {})
          };
          const generationStarted = Date.now();
          const result = await spindle.imageGen.generate({
            ...(connectionId ? { connection_id: connectionId } : {}),
            prompt,
            ...(negativePrompt ? { negativePrompt } : {}),
            ...(config.imageModel ? { model: config.imageModel } : {}),
            parameters: effectiveParameters,
            owner_chat_id: plan.key.chatId,
            includeDataUrl: wantsCapture,
            ...(userId ? { userId } : {})
          });
          observedGenerationMs.push(Date.now() - generationStarted);

          if (signal.aborted) throw abortError(signal);
          if (jobSignal.aborted) throw abortError(jobSignal);
          if (!result.imageId) throw new Error("The image provider completed without a persisted image ID.");

          if (wantsCapture) {
            const parsed = parseDataUrl(result.imageDataUrl);
            if (parsed) {
              const stored: StoredPortrait = {
                name: characterName,
                imageId: result.imageId,
                data: parsed.data,
                mimeType: parsed.mimeType,
                createdAt: new Date().toISOString(),
                prompt,
                identityFingerprint
              };
              try {
                if (await savePortrait(spindle, plan.key.chatId, stored, userId, { replace: !compatiblePortrait(portraits[characterKey], identityFingerprint) })) {
                  portraits[characterKey] = stored;
                  if (config.debugLogging) spindle.log.info(`[VN] portrait captured for "${characterName}" -> ${stored.imageId} (${stored.mimeType}, ${stored.data.length} base64 chars)`);
                } else {
                  const refreshed = await loadPortraits(spindle, plan.key.chatId, userId);
                  const winner = refreshed[characterKey];
                  if (winner) portraits[characterKey] = winner;
                }
              } catch {
                // Non-fatal: anchoring simply resumes on a later turn.
              }
            }
          }
          const imageUrl = result.imageUrl ?? `/api/v1/images/${encodeURIComponent(result.imageId)}`;
          if (cache && admission && cacheKey) {
            const stored = cache.store(scope, cacheKey, {
              imageId: result.imageId,
              imageUrl,
              episode,
              provenance: provenanceFor(scheduledJob.jobId, scheduledJob.promptFingerprint)
            }, admission, signal);
            if (stored.stored) {
              cacheLog(`scene-cache p${cue.paragraphIndex} store key=${shortSceneKey(cacheKey)} image=${result.imageId}${stored.replaced ? " (replaced)" : ""} entries=${cache.size} bytes=${cache.bytes}`);
              generationSettled = true;
              settle?.({ kind: "entry", entry: stored.entry });
              // A budgeted image just landed: reuse-only candidates may hit now.
              void resolveCandidatesNow();
            } else {
              cacheLog(`scene-cache p${cue.paragraphIndex} reject reason=${stored.reason} image=${result.imageId} (late or superseded result not cached)`);
              generationSettled = true;
              settle?.({ kind: "released" });
            }
          }
          return { imageId: result.imageId, imageUrl };
        } catch (error) {
          if (settle && !generationSettled) {
            generationSettled = true;
            const aborted = signal.aborted || jobSignal.aborted || (error instanceof Error && error.name === "AbortError");
            settle(aborted ? { kind: "aborted" } : { kind: "failed", error });
          }
          throw error;
        } finally {
          if (settle && !generationSettled) {
            generationSettled = true;
            settle({ kind: "released" });
          }
          // Release ownership in finally, covering validation and persistence failures
          if (isCaptureOwner) {
            captureResolve?.(portraits[characterKey] ?? null);
            capturePromises.delete(characterKey);
          }
        }
      }).promise;
    });
    await Promise.allSettled(promises);
    await resolvingCandidates;
    // Guarantee finished batches have no unexplained queued jobs
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i]!.status === "queued") {
        jobs[i] = AssetJobSchema.parse({
          ...jobs[i]!,
          status: "cancelled",
          imageId: null,
          imageUrl: null,
          generatedAt: null,
          readyAt: null,
          error: null,
          finishedAt: new Date().toISOString()
        });
      }
    }
    if (cache) {
      const stats = cache.stats();
      cacheLog(`scene-cache batch summary hits=${stats.hits} shared=${stats.sharedHits} avoided=${stats.generationsAvoided} stores=${stats.stores} misses=${Object.entries(stats.misses).filter(([, count]) => count > 0).map(([reason, count]) => `${reason}:${count}`).join(",") || "0"} rejects=${Object.entries(stats.rejections).filter(([, count]) => count > 0).map(([reason, count]) => `${reason}:${count}`).join(",") || "0"} waits=${stats.waits.count}/${stats.waits.totalMs}ms evictions=${stats.evictions} entries=${stats.entries} bytes=${stats.bytes}`);
    }
    return jobs;
  } finally {
    signal.removeEventListener("abort", abort);
    unsubscribe();
  }
}

const CLOTHING_TAG_REGEX = /\b(?:clothes|clothing|attire|outfit|uniform|dress(?:es)?|sundress(?:es)?|skirt(?:s)?|shirt(?:s)?|t-?shirt(?:s)?|tee-?shirt(?:s)?|sweatshirt(?:s)?|blouse(?:s)?|sweater(?:s)?|cardigan(?:s)?|jacket(?:s)?|coat(?:s)?|hoodie(?:s)?|vest(?:s)?|suit(?:s)?|robe(?:s)?|kimono(?:s)?|yukata|hanfu|gi|pants|trousers|jeans|shorts|leggings|tights|pantyhose|socks?|stockings?|shoes?|boots?|sneakers?|heels?|sandals?|gloves?|hat(?:s)?|cap(?:s)?|hood(?:s)?|scarf|scarves|tie(?:s)?|necktie(?:s)?|ribbon(?:s)?|(?:hair\s*)?bows?(?!\s*[-]?\s*(?:shaped|lips|mouth))|collar(?:s)?|apron(?:s)?|swimsuit(?:s)?|bikini(?:s)?|pajamas?|leotard(?:s)?|bodysuit(?:s)?|armor|armour|breastplate(?:s)?|cloak(?:s)?|cape(?:s)?)\b/i;

export function isClothingTag(tag: string): boolean {
  if (/\b(?:bow[- ]shaped|cupid(?:'s)?\s+bow|lips?|mouth)\b/i.test(tag)) {
    return false;
  }
  const normalized = tag.toLowerCase().replace(/_/g, " ");
  return CLOTHING_TAG_REGEX.test(normalized);
}

export function cleanClothingFromPhrase(phrase: string): string {
  const match = phrase.match(/^(.*?)\s+\b(?:wearing|dressed in|clad in|sporting)\s+(.+)$/i);
  if (match && match[1] && match[2]) {
    const clothingPart = match[2];
    if (isClothingTag(clothingPart)) {
      return match[1].trim();
    }
  }
  return phrase;
}

export function applyAttireOverride(baseIdentity: string, newAttire: string): string {
  const trimmedAttire = newAttire.trim();
  if (!trimmedAttire && !baseIdentity.trim()) return "";
  if (!baseIdentity.trim()) return trimmedAttire;

  const tags = splitTopLevelCsv(baseIdentity);
  const physicalTags: string[] = [];

  for (const tag of tags) {
    const parsed = parseWeightedGroup(tag);
    if (parsed) {
      const surviving: string[] = [];
      for (const item of parsed.items) {
        const cleaned = cleanClothingFromPhrase(item);
        if (cleaned && !isClothingTag(cleaned)) {
          surviving.push(cleaned);
        }
      }
      if (surviving.length > 0) {
        if (parsed.type === "comfy") {
          physicalTags.push(`(${surviving.join(", ")}:${parsed.weight})`);
        } else {
          physicalTags.push(`${parsed.prefix}${surviving.join(", ")}${parsed.suffix}`);
        }
      }
      continue;
    }

    const cleanedTag = cleanClothingFromPhrase(tag);
    if (cleanedTag && !isClothingTag(cleanedTag)) {
      physicalTags.push(cleanedTag);
    }
  }

  const combined = trimmedAttire ? [...physicalTags, trimmedAttire].join(", ") : physicalTags.join(", ");
  return validateAndRepairDelimiters(combined);
}

/**
 * Decide the solo subject line. A persisted `subjectCategory` wins outright;
 * only `unknown` falls back to explicit gender words in the identity text.
 * Species and anatomy compounds ("cat ears", "fox tail", "wolf fur") are
 * stripped before the creature check, so animal ears never make a "1other".
 */
export function classifySubject(identity: string, subjectCategory: SubjectCategory = "unknown"): [label: string, situation: string] {
  const persisted = subjectPromptFor(subjectCategory);
  if (persisted) return persisted;

  const text = identity.toLowerCase();
  if (/\b1boy\b/.test(text)) return ["boy", "1boy, solo"];
  if (/\b1girl\b/.test(text)) return ["girl", "1girl, solo"];
  if (/\b1other\b/.test(text)) return ["other", "1other, solo"];

  // Strip relational prose and possessives (e.g. "sister's", "mother's")
  let cleaned = text.replace(/\b\w+'s\b/gi, "");
  // Strip known clothing phrases containing gender words like "maid uniform"
  cleaned = cleaned.replace(/\bmaid\s+uniform\b/gi, "uniform");
  cleaned = cleaned.replace(/\bfake\s+(?:mustache|beard)\b/gi, "");

  const isNonbinary = /\b(?:nonbinary|non-binary|agender|genderless)\b/i.test(cleaned);
  const isFemale = /\b(?:girl|woman|female|lady|gal|tomboy|(?:demon|wolf|cat|fox|monster|bunny|cow)\s*(?:girl|woman|female))\b/i.test(cleaned);
  const isMale = /\b(?:boy|man|male|guy|gentleman|father|son|brother|husband|(?:demon|wolf|cat|fox|monster|bunny|cow)\s*(?:boy|man|male)|anthro\s+\w+\s+male|male\s+warrior|male\s+android)\b/i.test(cleaned);

  // Animal words attached to body parts are anatomy, not a creature subject.
  const creatureText = stripAnatomyCompounds(cleaned)
    .replace(/\b(?:kitsune|catgirl|foxgirl|wolfgirl|kemonomimi|nekomimi|neko|anthro|furry|beastkin|monster\s+girl|monster\s+boy)\b/gi, " ");
  const isAnimal = /\b(?:dog|cat|retriever|hound|wolf|horse|quadruped|four\s+legs|animal|creature|beast|monster)\b/i.test(creatureText);

  if (isFemale && !isMale) {
    return ["girl", "1girl, solo"];
  } else if (isMale && !isFemale) {
    return ["boy", "1boy, solo"];
  } else if (isAnimal || isNonbinary || /\b(?:1other|creature|monster|animal|robot|android|cyborg|machine|golem|inanimate)\b/i.test(creatureText)) {
    return ["other", "1other, solo"];
  }

  // Default
  return ["girl", "1girl, solo"];
}
