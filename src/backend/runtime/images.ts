import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../config.js";
import { AssetJobSchema, type AssetJob, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import { AssetScheduler } from "../core/asset-scheduler.js";

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

export function compileImagePrompt(config: VisualNovelConfig, scene: SceneState, cue: VisualCue): string {
  const camera = scene.cameraLock;
  return [
    config.promptPrefix,
    scene.identityPrompt ? `identity: ${scene.identityPrompt}` : "",
    scene.basePrompt,
    `camera: ${camera.framing}, ${camera.angle}, ${camera.perspective}, ${camera.lens ?? "natural lens"}`,
    `composition: ${camera.subjectAnchor}; ${camera.horizon}; ${camera.safeDialogueRegion}; ${scene.compositionLock}`,
    cue.action ? `action: ${cue.action}` : "",
    cue.expression ? `expression: ${cue.expression}` : "",
    cue.promptDelta,
    config.promptSuffix
  ].filter(Boolean).join(", ");
}

export function createAssetJobs(plan: TurnPlan): AssetJob[] {
  const now = new Date().toISOString();
  return plan.visualCues.map((cue, index) => {
    const scene = sceneForCue(plan, cue);
    const promptIdentity = `${scene.identityPrompt ?? ""}\0${scene.basePrompt}\0${scene.cameraLock.framing}\0${scene.compositionLock}\0${cue.promptDelta}`;
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
        const result = await spindle.imageGen.generate({
          ...(config.imageConnectionId ? { connection_id: config.imageConnectionId } : {}),
          prompt: compileImagePrompt(config, scene, cue),
          ...(config.negativePrompt ? { negativePrompt: config.negativePrompt } : {}),
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
}
