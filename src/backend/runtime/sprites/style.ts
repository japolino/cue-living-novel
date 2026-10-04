import type { VisualNovelConfig } from "../../../config.js";
import { spriteHash } from "../../../shared/sprites.js";

/**
 * Bump when sprite or plate prompts change in a way that should start new
 * sets (old sets stay in the library until they age out).
 */
export const SPRITE_PROMPT_VERSION = "sprite-prompt-v1";

/**
 * Image-style identity for the sprite library. Two configs with the same key
 * produce interchangeable sprites and plates, so sets are shared across chats;
 * any change (connection, model, prompt affixes, negative, NovelAI quality
 * toggles, prompt version) starts new sets.
 */
export function spriteStyleKey(config: Pick<
  VisualNovelConfig,
  "imageConnectionId" | "imageModel" | "promptPrefix" | "promptSuffix" | "negativePrompt" | "novelAiQualityTags" | "novelAiUseDefaultNegative"
>): string {
  return `style_${spriteHash(JSON.stringify([
    SPRITE_PROMPT_VERSION,
    config.imageConnectionId ?? null,
    config.imageModel ?? "",
    config.promptPrefix ?? "",
    config.promptSuffix ?? "",
    config.negativePrompt ?? "",
    config.novelAiQualityTags !== false,
    config.novelAiUseDefaultNegative !== false,
  ]))}`;
}

/**
 * Fixed seed for a sprite set or plate (32-bit unsigned, valid for NovelAI,
 * ComfyUI and SwarmUI). `variant` changes it for regenerations, so a
 * regenerated image differs while first renders of one set share a seed.
 */
export function spriteSeedFor(key: string, variant = 0): number {
  const base = Number.parseInt(spriteHash(key), 16) >>> 0;
  if (!variant) return base;
  return (base + Math.imul(variant, 0x9e3779b1)) >>> 0;
}
