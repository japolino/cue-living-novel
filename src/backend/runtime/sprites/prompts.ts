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
import { sizeParameters } from "../image-size.js";
import { NOVELAI_NEGATIVE_DEFAULT, novelAiCapabilities, novelAiQualityTags, renderNovelAiEmphasis } from "../novelai-prompt.js";

/**
 * Sprite framing: one standing figure, straight on and centred, on plain
 * white with empty space on both sides, so the browser can cut it out and
 * the stage can place it. Variant "F6" of the October 2026 ComfyUI tests
 * (without the "(white background:1.2)" weight and the "grey background"
 * negative, which had no effect): side clipping 100% -> 58%, figure width
 * share 1.00 -> 0.80, low-angle / tilted shots about 12/18 -> 3/18. The
 * plain-language sentence is the only part that gives side margin; it holds
 * commas, so the top-level tag split makes it three "tags": keep it last.
 */
export const SPRITE_FRAMING_TAGS = "solo, standing, centered, front view, straight-on, facing viewer, looking at viewer, cowboy shot, simple background, white background, no shadow";
export const SPRITE_NEGATIVE_TAGS = "scenery, background, shadow, drop shadow, gradient background, multiple people, text, multiple girls, 2girls, multiple views, split screen, border, from below, from above, dutch angle, cropped, out of frame";
/** Plate framing: an empty place. */
export const PLATE_TAGS = "scenery, no humans, detailed background, wide shot";
export const PLATE_NEGATIVE_TAGS = "1girl, 1boy, people, person, character, text";

export {
  NOVELAI_PLATE_SIZE,
  NOVELAI_SPRITE_SIZE,
  PLATE_SIZE,
  SPRITE_IMAGE_SIZE_PRESETS,
  SPRITE_SIZE,
  sizeParameters,
  spriteImageSizeFor,
  type SpriteImageKind,
  type SpritePixelSize,
} from "../image-size.js";

/** Providers whose image parameters take a fixed seed. */
const SEED_PROVIDERS = new Set(["novelai", "comfyui", "swarmui"]);

export type SpriteImageRequest = {
  prompt: string;
  negativePrompt: string;
  /** Provider parameters this request adds (size, seed, NovelAI structure); merged over the user's image parameters. */
  parameters: Record<string, unknown>;
};

export type SpritePromptMember = Pick<SpriteCastMember, "name" | "identity" | "attire"> & Partial<Pick<SpriteCastMember, "subjectCategory">>;

export function tagKey(tag: string): string {
  return tag.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

/** Drop tags already present earlier (case-insensitive, top-level only). */
export function dedupeSections(sections: string[]): string[] {
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
export function stylePrefix(config: VisualNovelConfig, novelAi: boolean): string {
  if (config.promptPrefix !== DEFAULT_CONFIG.promptPrefix) return config.promptPrefix;
  return novelAi ? "anime coloring" : "masterpiece, best quality, anime coloring";
}

function seedParameters(provider: string | null, seed: number | null): Record<string, unknown> {
  return seed !== null && provider && SEED_PROVIDERS.has(provider) ? { seed } : {};
}

export function renderComfy(sections: string[]): string {
  const joined = sections.map((section) => normalizePromptSection(section)).filter(Boolean).join(",\n\n");
  return validateAndRepairDelimiters(serializePromptWeights(joined, "comfyui"));
}

export function comfyNegative(config: VisualNovelConfig, extra: string): string {
  const joined = dedupeSections([config.negativePrompt, extra]).join(", ");
  return validateAndRepairDelimiters(serializePromptWeights(joined, "comfyui"));
}

export function novelAiNegative(config: VisualNovelConfig, extra: string, model: string): string {
  const base = config.novelAiUseDefaultNegative !== false && config.negativePrompt === DEFAULT_CONFIG.negativePrompt
    ? NOVELAI_NEGATIVE_DEFAULT
    : config.negativePrompt;
  return renderNovelAiEmphasis(dedupeSections([base, extra]).join(", "), model);
}

/**
 * NovelAI quality tags. V4.5 ones start with "location" (a background-focus
 * tag), which suits plates but would pull a sprite off its white background.
 */
export function novelAiQuality(config: VisualNovelConfig, model: string, present: string[], forSprite: boolean): string[] {
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

/** Weight of a non-natural skin colour tag in sprite identities (see weightSkinColourTags). */
export const SPRITE_SKIN_COLOUR_WEIGHT = 1.15;
const NON_NATURAL_SKIN = "blue|green|red|purple|pink|grey|gray|orange|yellow|black|teal|cyan|aqua|turquoise|violet|lavender|magenta|crimson|lime|gold|golden|silver";
const SKIN_COLOUR_TAG = new RegExp(`^(?:(?:light|dark|pale|bright|deep|pastel)[ -])?(?:${NON_NATURAL_SKIN})[ -]skin(?:ned)?$`, "i");

/**
 * Sprite identities: weight non-natural skin colour tags ("blue skin",
 * "light green skin", "purple_skin") at SPRITE_SKIN_COLOUR_WEIGHT, so the
 * colour holds on a plain white background. In the October 2026 ComfyUI
 * test (N = 4 seeds) "(blue skin:1.2)" moved a slime girl's median hue from
 * teal (163°) to blue (191°); 1.4 added little. Natural tones (pale, fair,
 * dark, tan, brown, light, white skin), "colored skin" and tags that already
 * carry a weight or emphasis are left as they are.
 */
export function weightSkinColourTags(identity: string, weight = SPRITE_SKIN_COLOUR_WEIGHT): string {
  const tags = splitTopLevelCsv(identity);
  let changed = false;
  const out = tags.map((tag) => {
    const trimmed = tag.trim();
    const plain = trimmed.replace(/_/g, " ").replace(/\s+/g, " ");
    if (!SKIN_COLOUR_TAG.test(plain)) return trimmed;
    changed = true;
    return `(${trimmed}:${weight})`;
  });
  return changed ? out.filter(Boolean).join(", ") : identity;
}

/**
 * Sprite request: style prefix + subject + identity + outfit + expression
 * suffix + white-background sprite framing + style suffix, in the provider's
 * prompt syntax. NovelAI V4+ gets the character in a character caption (as
 * scene prompts do), a portrait resolution and the set's seed. The size
 * follows `spriteImageSize` on ComfyUI / SwarmUI (see spriteImageSizeFor).
 */
export function compileSpriteRequest(input: {
  config: VisualNovelConfig;
  provider: string | null;
  member: SpritePromptMember;
  expression: string;
  seed: number | null;
}): SpriteImageRequest {
  const { config, provider, member } = input;
  const plainIdentity = spriteIdentityTags(member);
  const [, subject] = classifySubject(plainIdentity, member.subjectCategory ?? "unknown");
  const identity = weightSkinColourTags(plainIdentity);
  const pose = poseById(POSE_EXPRESSION_CATALOGUE, input.expression);
  const extra = { ...sizeParameters(provider, "sprite", config), ...seedParameters(provider, input.seed) };
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
  const extra = { ...sizeParameters(provider, "plate", config), ...seedParameters(provider, input.seed) };
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
