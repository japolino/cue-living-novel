import type { VisualNovelConfig } from "../../../config.js";
import { DEFAULT_CONFIG } from "../../../config.js";
import { POSE_EXPRESSION_CATALOGUE, poseById } from "../../../shared/character.js";
import type { SpriteCastMember, SpritePlateRef } from "../../../shared/sprites.js";
import {
  normalizePromptSection,
  serializePromptWeights,
  splitTopLevelCsv,
  validateAndRepairDelimiters,
} from "../../inlay-prompt/index.js";
import { applyAttireOverride, classifySubject } from "../images.js";
import { NOVELAI_NEGATIVE_DEFAULT, novelAiCapabilities, novelAiQualityTags, renderNovelAiEmphasis } from "../novelai-prompt.js";

/** Sprite framing: one standing figure on plain white, so the browser can cut it out. */
export const SPRITE_FRAMING_TAGS = "solo, standing, cowboy shot, looking at viewer, simple background, white background, no shadow";
export const SPRITE_NEGATIVE_TAGS = "scenery, background, shadow, drop shadow, gradient background, multiple people, text";
/** Plate framing: an empty place. */
export const PLATE_TAGS = "scenery, no humans, detailed background, wide shot";
export const PLATE_NEGATIVE_TAGS = "1girl, 1boy, people, person, character, text";

export const SPRITE_SIZE = { width: 832, height: 1216 } as const;
export const PLATE_SIZE = { width: 1216, height: 832 } as const;

/** Providers whose image parameters take a fixed seed. */
const SEED_PROVIDERS = new Set(["novelai", "comfyui", "swarmui"]);
/** Providers whose image parameters take an explicit width and height. */
const SIZE_PROVIDERS = new Set(["comfyui", "swarmui"]);

export type SpriteImageRequest = {
  prompt: string;
  negativePrompt: string;
  /** Provider parameters this request adds (size, seed, NovelAI structure); merged over the user's image parameters. */
  parameters: Record<string, unknown>;
};

export type SpritePromptMember = Pick<SpriteCastMember, "name" | "identity" | "attire"> & Partial<Pick<SpriteCastMember, "subjectCategory">>;

function tagKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

/** Drop tags already present earlier (case-insensitive, top-level only). */
function dedupeSections(sections: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const section of sections) {
    const kept: string[] = [];
    for (const tag of splitTopLevelCsv(section)) {
      const trimmed = tag.trim();
      if (!trimmed) continue;
      const key = tagKey(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(trimmed);
    }
    if (kept.length) out.push(kept.join(", "));
  }
  return out;
}

/**
 * Scene prompts use the default prefix "... anime visual novel scene"; a
 * sprite or plate is not a scene, so the default prefix is swapped for a
 * neutral style line. A custom prefix (artist and style tags) is kept as is:
 * it is what keeps sprites and plates in the user's style.
 */
function stylePrefix(config: VisualNovelConfig, novelAi: boolean): string {
  if (config.promptPrefix !== DEFAULT_CONFIG.promptPrefix) return config.promptPrefix;
  return novelAi ? "anime coloring" : "masterpiece, best quality, anime coloring";
}

function sizeParameters(provider: string | null, size: { width: number; height: number }): Record<string, unknown> {
  if (provider === "novelai") return { resolution: `${size.width}x${size.height}` };
  if (provider && SIZE_PROVIDERS.has(provider)) return { width: size.width, height: size.height };
  return {};
}

function seedParameters(provider: string | null, seed: number | null): Record<string, unknown> {
  return seed !== null && provider && SEED_PROVIDERS.has(provider) ? { seed } : {};
}

function renderComfy(sections: string[]): string {
  const joined = sections.map((section) => normalizePromptSection(section)).filter(Boolean).join(",\n\n");
  return validateAndRepairDelimiters(serializePromptWeights(joined, "comfyui"));
}

function comfyNegative(config: VisualNovelConfig, extra: string): string {
  const joined = dedupeSections([config.negativePrompt, extra]).join(", ");
  return validateAndRepairDelimiters(serializePromptWeights(joined, "comfyui"));
}

function novelAiNegative(config: VisualNovelConfig, extra: string, model: string): string {
  const base = config.novelAiUseDefaultNegative !== false && config.negativePrompt === DEFAULT_CONFIG.negativePrompt
    ? NOVELAI_NEGATIVE_DEFAULT
    : config.negativePrompt;
  return renderNovelAiEmphasis(dedupeSections([base, extra]).join(", "), model);
}

/**
 * NovelAI quality tags. V4.5 ones start with "location" (a background-focus
 * tag), which suits plates but would pull a sprite off its white background.
 */
function novelAiQuality(config: VisualNovelConfig, model: string, present: string[], forSprite: boolean): string[] {
  if (config.novelAiQualityTags === false) return [];
  const have = new Set(present.flatMap((section) => splitTopLevelCsv(section)).map(tagKey));
  return splitTopLevelCsv(novelAiQualityTags(model))
    .map((tag) => tag.trim())
    .filter((tag) => tag && !have.has(tagKey(tag)) && !(forSprite && tagKey(tag) === "location"));
}

/** Identity tags with the outfit swapped in (the same rule scene prompts use). */
export function spriteIdentityTags(member: Pick<SpritePromptMember, "identity" | "attire">): string {
  const identity = member.identity.trim();
  const attire = member.attire?.trim() ?? "";
  if (attire && identity) return applyAttireOverride(identity, attire);
  return attire || identity;
}

/**
 * Sprite request: style prefix + subject + identity + outfit + expression
 * suffix + white-background sprite framing + style suffix, in the provider's
 * prompt syntax. NovelAI V4+ gets the character in a character caption (as
 * scene prompts do), a portrait resolution and the set's seed.
 */
export function compileSpriteRequest(input: {
  config: VisualNovelConfig;
  provider: string | null;
  member: SpritePromptMember;
  expression: string;
  seed: number | null;
}): SpriteImageRequest {
  const { config, provider, member } = input;
  const identity = spriteIdentityTags(member);
  const [, subject] = classifySubject(identity, member.subjectCategory ?? "unknown");
  const pose = poseById(POSE_EXPRESSION_CATALOGUE, input.expression);
  const extra = { ...sizeParameters(provider, SPRITE_SIZE), ...seedParameters(provider, input.seed) };
  if (provider === "novelai") {
    const model = config.imageModel || "nai-diffusion-4-5-full";
    const caps = novelAiCapabilities(model);
    const characterSections = dedupeSections([identity, pose.suffix]);
    const base = caps.structured
      ? dedupeSections([stylePrefix(config, true), subject, SPRITE_FRAMING_TAGS, config.promptSuffix])
      : dedupeSections([stylePrefix(config, true), subject, identity, pose.suffix, SPRITE_FRAMING_TAGS, config.promptSuffix]);
    const quality = novelAiQuality(config, model, [...base, ...(caps.structured ? characterSections : [])], true);
    const prompt = renderNovelAiEmphasis([...base, ...quality].join(", "), model);
    const negativePrompt = novelAiNegative(config, SPRITE_NEGATIVE_TAGS, model);
    return {
      prompt,
      negativePrompt,
      parameters: {
        qualityToggle: false,
        negativePrompt,
        characterTags: caps.structured && characterSections.length
          ? [{ tags: renderNovelAiEmphasis(characterSections.join(", "), model) }]
          : [],
        ...extra,
      },
    };
  }
  const sections = dedupeSections([stylePrefix(config, false), subject, identity, pose.suffix, SPRITE_FRAMING_TAGS, config.promptSuffix]);
  return { prompt: renderComfy(sections), negativePrompt: comfyNegative(config, SPRITE_NEGATIVE_TAGS), parameters: extra };
}

/** Plate request: style prefix + place, time, weather, description + "scenery, no humans" + style suffix. */
export function compilePlateRequest(input: {
  config: VisualNovelConfig;
  provider: string | null;
  plate: Pick<SpritePlateRef, "location" | "timeOfDay" | "weather" | "description">;
  seed: number | null;
}): SpriteImageRequest {
  const { config, provider, plate } = input;
  const description = plate.description.trim();
  const redundant = !description
    || description.toLowerCase() === plate.location.trim().toLowerCase()
    || description.toLowerCase() === `a quiet ${plate.location.trim().toLowerCase()}.`;
  const place = [plate.location, plate.timeOfDay ?? "", plate.weather ?? ""].map((part) => part.trim()).filter(Boolean).join(", ");
  const extra = { ...sizeParameters(provider, PLATE_SIZE), ...seedParameters(provider, input.seed) };
  if (provider === "novelai") {
    const model = config.imageModel || "nai-diffusion-4-5-full";
    const base = dedupeSections([stylePrefix(config, true), place, redundant ? "" : description, PLATE_TAGS, config.promptSuffix]);
    const quality = novelAiQuality(config, model, base, false);
    const prompt = renderNovelAiEmphasis([...base, ...quality].join(", "), model);
    const negativePrompt = novelAiNegative(config, PLATE_NEGATIVE_TAGS, model);
    return { prompt, negativePrompt, parameters: { qualityToggle: false, negativePrompt, characterTags: [], ...extra } };
  }
  const sections = dedupeSections([stylePrefix(config, false), place, redundant ? "" : description, PLATE_TAGS, config.promptSuffix]);
  return { prompt: renderComfy(sections), negativePrompt: comfyNegative(config, PLATE_NEGATIVE_TAGS), parameters: extra };
}
