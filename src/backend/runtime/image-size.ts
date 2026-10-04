/**
 * Image sizes Cue sends with its own requests (dependency free).
 *
 * One setting, `spriteImageSize`, picks the size on ComfyUI / SwarmUI for
 * every picture Cue makes: sprites are portrait, plates, key moments and
 * scene pictures are landscape. NovelAI always gets its largest size that
 * costs no Anlas. Other providers get no size from Cue.
 */
import type { VisualNovelConfig, VisualNovelSpriteImageSize } from "../../config.js";

/** "scene" is a scene-mode picture; it uses the plate (landscape) size. */
export type SpriteImageKind = "sprite" | "plate" | "moment" | "scene";
export type SpritePixelSize = { readonly width: number; readonly height: number };

/** Sprite and plate sizes per `spriteImageSize` (ComfyUI / SwarmUI). Key moments and scene pictures use the plate size. */
export const SPRITE_IMAGE_SIZE_PRESETS: Readonly<Record<VisualNovelSpriteImageSize, { sprite: SpritePixelSize; plate: SpritePixelSize }>> = {
  standard: { sprite: { width: 624, height: 912 }, plate: { width: 912, height: 624 } },
  upscaled: { sprite: { width: 832, height: 1216 }, plate: { width: 1216, height: 832 } },
};
/** "Upscaled" sizes (also NovelAI's, see NOVELAI_SPRITE_SIZE). */
export const SPRITE_SIZE = SPRITE_IMAGE_SIZE_PRESETS.upscaled.sprite;
export const PLATE_SIZE = SPRITE_IMAGE_SIZE_PRESETS.upscaled.plate;
/**
 * NovelAI always gets its largest size that costs no Anlas on Opus (at most
 * 1024×1024 = 1,048,576 pixels), whatever `spriteImageSize` says.
 */
export const NOVELAI_SPRITE_SIZE = SPRITE_SIZE;
export const NOVELAI_PLATE_SIZE = PLATE_SIZE;

/** Pixel size of one generated image of `kind` for a provider and the config's `spriteImageSize`. */
export function spriteImageSizeFor(
  provider: string | null,
  kind: SpriteImageKind,
  setting: VisualNovelSpriteImageSize | undefined,
): SpritePixelSize {
  const landscape = kind !== "sprite";
  if (provider === "novelai") return landscape ? NOVELAI_PLATE_SIZE : NOVELAI_SPRITE_SIZE;
  const preset = SPRITE_IMAGE_SIZE_PRESETS[setting ?? "standard"] ?? SPRITE_IMAGE_SIZE_PRESETS.standard;
  return landscape ? preset.plate : preset.sprite;
}

/** Providers whose image parameters take an explicit width and height. */
const SIZE_PROVIDERS = new Set(["comfyui", "swarmui"]);

/**
 * Size parameters for one image of `kind`: NovelAI a `resolution` (always its
 * largest free size), ComfyUI / SwarmUI `width` / `height` from
 * `spriteImageSize`, other providers nothing.
 */
export function sizeParameters(
  provider: string | null,
  kind: SpriteImageKind,
  config: Pick<VisualNovelConfig, "spriteImageSize"> | null | undefined,
): Record<string, unknown> {
  const size = spriteImageSizeFor(provider, kind, config?.spriteImageSize);
  if (provider === "novelai") return { resolution: `${size.width}x${size.height}` };
  if (provider && SIZE_PROVIDERS.has(provider)) return { width: size.width, height: size.height };
  return {};
}

function hasValue(parameters: Record<string, unknown> | null | undefined, key: string): boolean {
  const value = parameters?.[key];
  return value !== undefined && value !== null && value !== "";
}

/**
 * Default size for one scene-mode picture: landscape, the plate size (see
 * sizeParameters). The user's own "Image parameters (JSON)" wins: when it
 * already has `width` or `height` (or `resolution` on NovelAI, for example
 * from the NovelAI "Image dimensions" control), Cue adds no size.
 */
export function sceneSizeParameters(
  provider: string | null,
  config: Pick<VisualNovelConfig, "spriteImageSize" | "imageParameters"> | null | undefined,
): Record<string, unknown> {
  const user = config?.imageParameters;
  if (hasValue(user, "width") || hasValue(user, "height")) return {};
  if (provider === "novelai" && hasValue(user, "resolution")) return {};
  return sizeParameters(provider, "scene", config);
}
