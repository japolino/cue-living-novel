import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../../config.js";
import type { NovelAiInsetLayout } from "../../../shared/novelai-inset.js";
import { splitConnectionSelection } from "../images.js";
import { tagKey, type SpriteImageRequest } from "./prompts.js";

/**
 * NovelAI V5 reference inset for sprite expressions. Lumiverse drops
 * reference images on V5 (no Precise Reference or Vibe Transfer yet), so an
 * anchored expression is made by inpainting instead: the set's idle fills
 * the left half of a 1216×832 canvas (composed in the browser, see
 * `NOVELAI_INSET_LAYOUTS`), the right half is masked, and a V5 inpainting
 * request with a `split screen` scene prompt draws the expression copying
 * the idle's character and style. The browser crops the right half before
 * the cut-out.
 *
 * Everything here is pure except `connectionRawOverride`; jobs.ts decides
 * when to use it and falls back to the plain (unanchored) request.
 */

/** NovelAI Diffusion V5 models (same rule as `novelAiQualityTags`). */
export const NOVELAI_V5_MODEL = /^nai-diffusion-5(?:-|$)/;
/** Scene prompt prefix of the technique. */
export const NOVELAI_INSET_PROMPT_TAG = "split screen";
/** Added to the negative (the sprite negative already has `multiple views`). */
export const NOVELAI_INSET_NEGATIVE_TAG = "comic";
/** Inpainting model names confirmed by the technique's author. */
const VERIFIED_INPAINTING_MODELS = new Set(["nai-diffusion-5-full-inpainting"]);

export type NovelAiInsetModel = {
  /** The model the inset request sends. */
  model: string;
  /**
   * False when the name is a guess (anything but V5 Full). Only logged: any
   * inset model whose request NovelAI rejects (`novelAiInsetRejected`) is
   * turned off, verified or not; other errors leave it on.
   */
  verified: boolean;
};

/**
 * The inpainting model for an inset, or null when the connection is not
 * NovelAI V5. `<model>-inpainting` (V5 Full: `nai-diffusion-5-full-inpainting`,
 * verified; V5 Curated: `nai-diffusion-5-curated-inpainting`, unverified).
 */
export function novelAiInsetModelFor(provider: string | null | undefined, model: string | null | undefined): NovelAiInsetModel | null {
  if (provider !== "novelai" || !model || !NOVELAI_V5_MODEL.test(model)) return null;
  const inpainting = model.endsWith("-inpainting") ? model : `${model}-inpainting`;
  return { model: inpainting, verified: VERIFIED_INPAINTING_MODELS.has(inpainting) };
}

/** Session key of an inset NovelAI rejected: no more insets for that user, connection and model. */
export function novelAiInsetKey(userId: string | undefined, connectionId: string | null | undefined, model: string): string {
  return `${userId ?? "owner"}\u0000${connectionId ?? ""}\u0000${model}`;
}

/** HTTP statuses that reject the request itself (a wrong model name or body), not a passing condition. */
const REJECTED_STATUSES = new Set([400, 404, 422]);
/** Lumiverse's provider errors: `NovelAI image generate failed (429): ...`. */
const PROVIDER_STATUS = /\bfailed \((\d{3})\)/;

/**
 * Whether an inset generation error means NovelAI rejects the inset request
 * (turn the inset off and draw the expression plain): HTTP 400, 404 or 422,
 * or an error without a status that names the model or the inpainting
 * (`unknown model`, a streamed error about infill). Everything else (408,
 * 429 concurrent-generation lock, 5xx, 401/402, network, a missing image id)
 * is not about the inset: the job fails as any render does and the inset
 * stays on.
 */
export function novelAiInsetRejected(error: unknown, model: string): boolean {
  const raw = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status = typeof raw === "number" ? raw : Number(PROVIDER_STATUS.exec(message)?.[1] ?? Number.NaN);
  if (Number.isFinite(status)) return REJECTED_STATUSES.has(status);
  const text = message.toLowerCase();
  return text.includes(model.toLowerCase()) || /\b(?:model|infill|inpaint\w*)\b/.test(text);
}

/** Base prompt with `split screen` first (once). */
export function insetPrompt(prompt: string): string {
  const first = prompt.split(",")[0] ?? "";
  if (tagKey(first) === NOVELAI_INSET_PROMPT_TAG) return prompt;
  return prompt.trim() ? `${NOVELAI_INSET_PROMPT_TAG}, ${prompt}` : NOVELAI_INSET_PROMPT_TAG;
}

/**
 * Sprite negative for an inset: without `split screen` (the sprite negative
 * forbids it, the inset asks for it) and with `comic`; `multiple views` and
 * every other tag stay as they are.
 */
export function insetNegative(negative: string): string {
  const tags = negative.split(",").map((tag) => tag.trim()).filter(Boolean);
  const kept = tags.filter((tag) => tagKey(tag) !== NOVELAI_INSET_PROMPT_TAG);
  if (!kept.some((tag) => tagKey(tag) === NOVELAI_INSET_NEGATIVE_TAG)) kept.push(NOVELAI_INSET_NEGATIVE_TAG);
  return kept.join(", ");
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unsafeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

/** Deep merge as Lumiverse's `applyRawOverride` does it: objects merge, arrays and scalars replace. */
function deepMerge(target: unknown, source: unknown): unknown {
  if (source === null || source === undefined) return target;
  if (!isObject(source) || !isObject(target)) return source;
  const result: JsonObject = { ...target };
  for (const key of Object.keys(source)) {
    if (unsafeKey(key)) continue;
    result[key] = deepMerge(result[key], source[key]);
  }
  return result;
}

/**
 * A user's `rawRequestOverride` (a JSON string, as Lumiverse takes it, or an
 * object). Empty: null. Throws on invalid JSON or a non-object, like
 * Lumiverse would at generation time.
 */
export function parseRawOverride(value: unknown): JsonObject | null {
  if (value === undefined || value === null) return null;
  if (isObject(value)) return value;
  if (typeof value !== "string") throw new Error("rawRequestOverride must be a JSON object.");
  if (!value.trim()) return null;
  const parsed: unknown = JSON.parse(value);
  if (!isObject(parsed)) throw new Error("rawRequestOverride must be a JSON object.");
  return parsed;
}

/**
 * The inset's `rawRequestOverride`: `noise: 0` (the user's value wins), then
 * the user's overrides in order (connection defaults, then Cue's Image
 * parameters: Lumiverse would use the later one), then the inset itself,
 * which wins for `action`, `parameters.image` and `parameters.mask`.
 * Lumiverse deep-merges the result into the NovelAI body (`model` is a
 * protected key there, so the model goes in the request's `model` field).
 */
export function mergeNovelAiRawOverride(userOverrides: readonly unknown[], canvas: { image: string; mask: string }): string {
  let merged: unknown = { parameters: { noise: 0 } };
  for (const override of userOverrides) merged = deepMerge(merged, parseRawOverride(override));
  merged = deepMerge(merged, { action: "infill", parameters: { image: canvas.image, mask: canvas.mask } });
  return JSON.stringify(merged);
}

/**
 * Turn a sprite expression request (NovelAI V5) into its inset request:
 * landscape canvas resolution, `split screen` first in the base prompt, the
 * character caption unchanged, the negative without `split screen` and with
 * `comic`, no reference images, and the infill override. Steps, guidance,
 * sampler and seed stay the user's / the set's. The model goes in the
 * request's `model` field (see `novelAiInsetModelFor`).
 */
export function compileNovelAiInsetRequest(input: {
  request: SpriteImageRequest;
  layout: NovelAiInsetLayout;
  canvas: { image: string; mask: string };
  /** The user's raw overrides, lowest priority first (connection defaults, Cue's Image parameters). */
  userOverrides?: readonly unknown[];
}): SpriteImageRequest {
  const { request, layout } = input;
  const negativePrompt = insetNegative(request.negativePrompt);
  const parameters: JsonObject = {
    ...request.parameters,
    negativePrompt,
    resolution: `${layout.canvas.width}x${layout.canvas.height}`,
    rawRequestOverride: mergeNovelAiRawOverride(input.userOverrides ?? [], input.canvas),
  };
  delete parameters.resolvedReferenceImages;
  return { prompt: insetPrompt(request.prompt), negativePrompt, parameters };
}

/**
 * The image connection's own `rawRequestOverride` (connection default
 * parameters), which the extension's parameters would otherwise replace:
 * Lumiverse merges extension parameters over the defaults one level deep.
 * Null when there is none or the connection cannot be read.
 */
export async function connectionRawOverride(spindle: SpindleAPI, config: Pick<VisualNovelConfig, "imageConnectionId">, userId?: string): Promise<unknown> {
  try {
    const { connectionId } = splitConnectionSelection(config.imageConnectionId);
    const connection = connectionId
      ? await spindle.imageGen.getConnection(connectionId, userId)
      : await spindle.imageGen.listConnections(userId).then((list) => list.find((candidate) => candidate.is_default) ?? list[0] ?? null);
    const defaults = connection?.default_parameters;
    return isObject(defaults) ? defaults.rawRequestOverride ?? null : null;
  } catch {
    return null;
  }
}
