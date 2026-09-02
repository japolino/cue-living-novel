import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../config.js";
import { AssetJobSchema, type AssetJob, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import { AssetScheduler } from "../core/asset-scheduler.js";
import { POSE_EXPRESSION_CATALOGUE, poseById } from "../../shared/character.js";
import { assemblePrompt, normalizeConfig, renderNegativeWithCurrentSelection, renderPrompt, type PromptEntry } from "../inlay-prompt/index.js";

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
  const isFemale = /\b(?:girl|woman|female|lady|maid|sister|mother|daughter|gal)\b/i.test(identityText);
  const isMale = /\b(?:boy|man|male|guy|gentleman|brother|father|son|mustache|beard)\b/i.test(identityText);
  let label = "girl";
  let situation = "1girl, solo";
  if (isFemale && !isMale) {
    label = "girl";
    situation = "1girl, solo";
  } else if (isMale && !isFemale) {
    label = "boy";
    situation = "1boy, solo";
  } else if (/\b(?:creature|monster|animal|robot|android|cyborg|machine|golem|inanimate)\b/i.test(identityText)) {
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
        const result = await spindle.imageGen.generate({
          ...(config.imageConnectionId ? { connection_id: config.imageConnectionId } : {}),
          prompt,
          ...(negativePrompt ? { negativePrompt } : {}),
          ...(config.imageModel ? { model: config.imageModel } : {}),
          parameters: config.imageParameters,
          owner_chat_id: plan.key.chatId,
          includeDataUrl: false,
          ...(userId ? { userId } : {})
        });
        if (signal.aborted) throw abortError(signal);
        if (jobSignal.aborted) throw abortError(jobSignal);
        if (!result.imageId) throw new Error("The image provider completed without a persisted image ID.");
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


