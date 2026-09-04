import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../config.js";
import { AssetJobSchema, type AssetJob, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import { AssetScheduler } from "../core/asset-scheduler.js";
import { POSE_EXPRESSION_CATALOGUE, poseById } from "../../shared/character.js";
import { characterAppearanceKey, normalizeCharacterName } from "../../shared/identity.js";
import { assemblePrompt, normalizeConfig, renderNegativeWithCurrentSelection, renderPrompt, type PromptEntry } from "../inlay-prompt/index.js";
import { loadPortraits, savePortrait, type StoredPortrait } from "./storage.js";

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

function compilePromptEntry(config: VisualNovelConfig, scene: SceneState, cue: VisualCue): PromptEntry {
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
  let identity = scene.identityPrompt?.trim() ?? "";
  const attire = cue.attire || scene.attire;
  if (attire && identity) {
    identity = applyAttireOverride(identity, attire);
  }
  const identityText = identity.toLowerCase();
  const isFemale = /\b(?:1girl|girl|woman|female|lady|maid|sister|mother|daughter|gal|tomboy)\b/i.test(identityText);
  const isMale = /\b(?:1boy|boy|man|male|guy|gentleman|brother|father|son|mustache|beard)\b/i.test(identityText);
  let label = "girl";
  let situation = "1girl, solo";
  if (isFemale && !isMale) {
    label = "girl";
    situation = "1girl, solo";
  } else if (isMale && !isFemale) {
    label = "boy";
    situation = "1boy, solo";
  } else if (/\b(?:1other|creature|monster|animal|robot|android|cyborg|machine|golem|inanimate)\b/i.test(identityText)) {
    label = "1other";
    situation = "1other, solo";
  }
  const pose = poseById(POSE_EXPRESSION_CATALOGUE, cue.poseExpressionId);
  const timeWeather = [scene.environment.timeOfDay, scene.environment.weather].filter(Boolean).join(" ");
  return assemblePrompt({
    environment: {
      location: [scene.environment.location],
      timeWeather,
      lightingMood: scene.environment.lighting ? [scene.environment.lighting] : [],
      backgroundElements: scene.environment.persistentElements
    }
  }, {
    paragraph: 1,
    situation,
    camera: { framing: "upper body", angle: "eye level", perspective: "straight-on", focus: [] },
    characters: [{ label, identity, expression: pose.suffix, visibleTags: identity }]
  }, compilerConfig, 1, 1);
}

export function compileImagePrompt(config: VisualNovelConfig, scene: SceneState, cue: VisualCue): string {
  const entry = compilePromptEntry(config, scene, cue);
  return renderPrompt(entry.prompt, "comfyui");
}

export function compileNegativePrompt(config: VisualNovelConfig, scene: SceneState, cue: VisualCue): string {
  const entry = compilePromptEntry(config, scene, cue);
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

export function createAssetJobs(plan: TurnPlan, config: VisualNovelConfig): AssetJob[] {
  const now = new Date().toISOString();
  return plan.visualCues.map((cue, index) => {
    const scene = sceneForCue(plan, cue);
    const pose = poseById(POSE_EXPRESSION_CATALOGUE, cue.poseExpressionId);
    const promptIdentity = `${compileImagePrompt(config, scene, cue)}\0${pose.id}`;
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


/* ------------------------------------------------------------------ *
 * Reference-image anchoring.
 *
 * A character's first generated image in a chat becomes their canonical
 * portrait (stored per chat, first-wins). Every later generation for that
 * character passes the portrait back to the provider as an identity anchor:
 * - NovelAI: Director / Precise Reference (`resolvedReferenceImages`), read
 *   directly by the host's NovelAI provider.
 * - ComfyUI / SwarmUI: `resolvedSourceImages`, which the host uploads and
 *   patches into the active workflow's mapped `init_image` field (for
 *   example an IP-Adapter reference LoadImage node).
 * Other providers receive no reference parameters. Opt out by setting
 * `referenceAnchoring: false` inside the connection's image parameters;
 * `referenceStrength` (0..1, default 0.6) tunes the NovelAI strength.
 * ------------------------------------------------------------------ */

const REFERENCE_PROVIDERS = new Set(["novelai", "comfyui", "swarmui"]);

/** Whether reference anchoring is enabled for this config (default on). */
export function referenceAnchoringEnabled(config: VisualNovelConfig): boolean {
  // The settings toggle is authoritative; `imageParameters.referenceAnchoring`
  // remains as a per-connection escape hatch.
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
  return { mimeType: match[1]!, data: match[2]! };
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
  let portraits: Record<string, StoredPortrait> = {};
  if (anchorable) {
    try {
      portraits = await loadPortraits(spindle, plan.key.chatId, userId);
    } catch {
      portraits = {};
    }
  }
  if (config.debugLogging) {
    const portraitNames = Object.values(portraits).map((entry) => entry.name).join(", ");
    spindle.log.info(`[VN] reference anchoring ${anchorable ? `active (provider=${provider})` : referenceAnchoringEnabled(config) ? `inactive (provider=${provider ?? "unknown"} unsupported)` : "disabled by config"}; ${Object.keys(portraits).length} portrait(s)${portraitNames ? ` [${portraitNames}]` : ""}`);
  }
  const capturing = new Set<string>();
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
        const prompt = compileImagePrompt(config, scene, cue);
        const negativePrompt = compileNegativePrompt(config, scene, cue);
        const characterName = cueCharacterName(scene, cue);
        const characterKey = characterAppearanceKey(characterName);
        const portrait = anchorable && characterKey ? portraits[characterKey] : undefined;
        // Capture: the first anchored-less generation for a character becomes
        // that character's canonical portrait, so request its data URL once.
        const wantsCapture = anchorable && Boolean(characterKey) && !portrait && !capturing.has(characterKey);
        if (wantsCapture) capturing.add(characterKey);
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
        let result;
        try {
          result = await spindle.imageGen.generate({
            ...(connectionId ? { connection_id: connectionId } : {}),
            prompt,
            ...(negativePrompt ? { negativePrompt } : {}),
            ...(config.imageModel ? { model: config.imageModel } : {}),
            parameters: effectiveParameters,
            owner_chat_id: plan.key.chatId,
            includeDataUrl: wantsCapture,
            ...(userId ? { userId } : {})
          });
        } catch (error) {
          if (wantsCapture) capturing.delete(characterKey);
          throw error;
        }
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
              createdAt: new Date().toISOString()
            };
            try {
              if (await savePortrait(spindle, plan.key.chatId, stored, userId)) {
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
          capturing.delete(characterKey);
        }
        return {
          imageId: result.imageId,
          imageUrl: result.imageUrl ?? `/api/v1/images/${encodeURIComponent(result.imageId)}`
        };
      }).promise;
    });
    await Promise.allSettled(promises);
    return jobs;
  } finally {
    signal.removeEventListener("abort", abort);
    unsubscribe();
  }
}const CLOTHING_TAG_REGEX = /\b(?:clothes|clothing|attire|outfit|uniform|dress|skirt|shirt|blouse|sweater|cardigan|jacket|coat|hoodie|vest|suit|robe|kimono|yukata|hanfu|gi|pants|trousers|jeans|shorts|leggings|tights|pantyhose|socks?|stockings?|shoes?|boots?|sneakers?|heels?|sandals?|gloves?|hat|cap|hood|scarf|tie|ribbon|bow|collar|apron|swimsuit|bikini|pajamas?|leotard|bodysuit|armor|armour|cloak|cape)\b/i;

export function applyAttireOverride(baseIdentity: string, newAttire: string): string {
  const trimmedAttire = newAttire.trim();
  if (!trimmedAttire) return baseIdentity;
  const tags = baseIdentity.split(",").map((t) => t.trim()).filter(Boolean);
  const physicalTags = tags.filter((tag) => !CLOTHING_TAG_REGEX.test(tag));
  return [...physicalTags, trimmedAttire].join(", ");
}


