import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../config.js";
import { AssetJobSchema, type AssetJob, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import { AssetScheduler } from "../core/asset-scheduler.js";
import { POSE_EXPRESSION_CATALOGUE, poseById } from "../../shared/character.js";
import {
  appearanceMapKeyFor,
  characterAppearanceKey,
  normalizeCharacterName,
  type CharacterAppearanceMap
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

  return { characterName, characterKey, baseIdentity, identity, attire };
}

function compilePromptEntry(
  config: VisualNovelConfig,
  scene: SceneState,
  cue: VisualCue,
  characterAppearance?: CharacterAppearanceMap
): PromptEntry {
  const promptSyntax = (config as any).promptSyntax ?? "comfyui";
  const compilerConfig = normalizeConfig({
    promptSyntax,
    promptStyle: "anima",
    supplement: true,
    customPositivePrefix: config.promptPrefix,
    customPositiveSuffix: config.promptSuffix,
    customNegative: config.negativePrompt,
    maxCharacters: 1,
    perspectiveMode: "dynamic"
  });
  const visualState = resolveCueCharacterVisualState(scene, cue, characterAppearance);
  const identity = visualState.identity;
  const [label, situation] = classifySubject(identity);
  const pose = poseById(POSE_EXPRESSION_CATALOGUE, cue.poseExpressionId);
  const timeWeather = [scene.environment.timeOfDay, scene.environment.weather].filter(Boolean).join(", ");
  const desc = scene.environment.description?.trim();
  const isRedundantDesc = !desc || desc.toLowerCase() === `a quiet ${scene.environment.location.toLowerCase()}.` || desc.toLowerCase() === scene.environment.location.toLowerCase();
  return assemblePrompt({
    environment: {
      location: [scene.environment.location],
      timeWeather,
      lightingMood: scene.environment.lighting ? [scene.environment.lighting] : [],
      backgroundElements: scene.environment.persistentElements,
      ...(isRedundantDesc ? {} : { description: [desc] })
    }
  }, {
    paragraph: 1,
    situation,
    camera: { framing: "upper body", angle: "eye level", perspective: "straight-on", focus: [] },
    characters: [{ label, identity, expression: pose.suffix, visibleTags: identity }]
  }, compilerConfig, 1, 1);
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
  userId?: string
): Promise<AssetJob[]> {
  let jobs = [...initialJobs];
  const providerKey = `image:${config.imageConnectionId ?? "default"}`;
  const scheduler = new AssetScheduler({ [providerKey]: { concurrency: config.imageConcurrency } });
  const provider = referenceAnchoringEnabled(config) ? await resolveImageProviderId(spindle, config, userId) : null;
  const anchorable = provider !== null && REFERENCE_PROVIDERS.has(provider);

  const [initialPortraits, characterAppearance] = await Promise.all([
    anchorable ? loadPortraits(spindle, plan.key.chatId, userId).catch(() => ({} as Record<string, StoredPortrait>)) : Promise.resolve({} as Record<string, StoredPortrait>),
    loadCharacterAppearance(spindle, userId, plan.key.chatId).catch(() => ({} as CharacterAppearanceMap))
  ]);
  const portraits: Record<string, StoredPortrait> = { ...initialPortraits };

  if (config.debugLogging) {
    const portraitNames = Object.values(portraits).map((entry) => entry.name).join(", ");
    spindle.log.info(`[VN] reference anchoring ${anchorable ? `active (provider=${provider})` : referenceAnchoringEnabled(config) ? `inactive (provider=${provider ?? "unknown"} unsupported)` : "disabled by config"}; ${Object.keys(portraits).length} portrait(s)${portraitNames ? ` [${portraitNames}]` : ""}`);
  }

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
    const promises = plan.visualCues.map((cue) => {
      const existing = initialJobs.find((job) => job.jobId === cue.assetJobId);
      if (!existing) throw new Error(`Missing asset job ${cue.assetJobId}.`);
      const job = AssetJobSchema.parse({ ...existing, provider: providerKey });
      return scheduler.schedule(job, async (_scheduledJob, jobSignal) => {
        if (signal.aborted) throw abortError(signal);
        const scene = sceneForCue(plan, cue);
        const visualState = resolveCueCharacterVisualState(scene, cue, characterAppearance);
        if (cue.resolvedIdentity !== undefined && !cue.resolvedIdentity.trim()) throw new Error(`No usable appearance was resolved for "${visualState.characterName}". Replan this turn with a character description; the previous character will not be substituted.`);
        const prompt = compileImagePrompt(config, scene, cue, characterAppearance);
        const negativePrompt = compileNegativePrompt(config, scene, cue, characterAppearance);
        const characterName = visualState.characterName;
        const characterKey = visualState.characterKey;

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
          return {
            imageId: result.imageId,
            imageUrl: result.imageUrl ?? `/api/v1/images/${encodeURIComponent(result.imageId)}`
          };
        } finally {
          // Release ownership in finally, covering validation and persistence failures
          if (isCaptureOwner) {
            captureResolve?.(portraits[characterKey] ?? null);
            capturePromises.delete(characterKey);
          }
        }
      }).promise;
    });
    await Promise.allSettled(promises);
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

export function classifySubject(identity: string): [label: string, situation: string] {
  const text = identity.toLowerCase();
  if (/\b1boy\b/.test(text)) return ["boy", "1boy, solo"];
  if (/\b1girl\b/.test(text)) return ["girl", "1girl, solo"];
  if (/\b1other\b/.test(text)) return ["1other", "1other, solo"];

  // Strip relational prose and possessives (e.g. "sister's", "mother's")
  let cleaned = text.replace(/\b\w+'s\b/gi, "");
  // Strip known clothing phrases containing gender words like "maid uniform"
  cleaned = cleaned.replace(/\bmaid\s+uniform\b/gi, "uniform");
  cleaned = cleaned.replace(/\bfake\s+(?:mustache|beard)\b/gi, "");

  const isNonbinary = /\b(?:nonbinary|non-binary|agender|genderless)\b/i.test(cleaned);
  const isAnimal = /\b(?:dog|cat|retriever|hound|wolf|horse|quadruped|four\s+legs|animal|creature|beast|monster)\b/i.test(cleaned);

  const isFemale = /\b(?:girl|woman|female|lady|gal|tomboy|(?:demon|wolf|cat|fox|monster|bunny|cow)\s*(?:girl|woman|female))\b/i.test(cleaned);
  const isMale = /\b(?:boy|man|male|guy|gentleman|father|son|brother|husband|(?:demon|wolf|cat|fox|monster|bunny|cow)\s*(?:boy|man|male)|anthro\s+\w+\s+male|male\s+warrior|male\s+android)\b/i.test(cleaned);

  if (isFemale && !isMale) {
    return ["girl", "1girl, solo"];
  } else if (isMale && !isFemale) {
    return ["boy", "1boy, solo"];
  } else if (isAnimal || isNonbinary || /\b(?:1other|creature|monster|animal|robot|android|cyborg|machine|golem|inanimate)\b/i.test(cleaned)) {
    return ["1other", "1other, solo"];
  }

  // Default
  return ["girl", "1girl, solo"];
}
