/**
 * Depth helpers for sprite mode (docs/SPRITE_MODE.md, "Stage").
 *
 * Sprite scenes are layered back to front: plate (scene image layers) ->
 * back ambient -> plate light (lightning) -> scrim -> sprites -> front
 * ambient -> fx / dialogue. Camera effects move each layer by its depth
 * factor (SPRITE_DEPTH, mirrored as CSS vars in effects-css.ts) so depth
 * reads; this module holds the pure parts: the depth table and the plate
 * light side used to place the sprites' rim light.
 */

/** Camera-move multipliers per layer (zoom and shake offsets). */
export const SPRITE_DEPTH = { plate: 1, sprites: 1.15, front: 1.4 } as const;

/** Side the plate is lit from; the sprites' rim light sits on that edge. */
export type PlateLightSide = "left" | "right" | "top";

/** Relative brightness difference between the plate's sides that picks a side. */
export const PLATE_LIGHT_BIAS = 0.12;

/** Size of the plate thumbnail that is sampled (cheap: one tiny draw per plate). */
export const PLATE_SAMPLE_SIZE = { width: 24, height: 14 } as const;

/**
 * Where the light comes from in an RGBA thumbnail of the plate: compares the
 * brightness of the left and right thirds of the upper 3/4 (the floor and
 * the dialogue area say little about the light). Bright pixels weigh more
 * (squared luminance) so a window or a lamp wins over a pale wall. Returns
 * "top" when neither side is clearly brighter.
 */
export function plateLightSide(data: ArrayLike<number>, width: number, height: number): PlateLightSide {
  if (width < 3 || height < 1 || data.length < width * height * 4) return "top";
  const rows = Math.max(1, Math.round(height * 0.75));
  const third = Math.max(1, Math.floor(width / 3));
  let left = 0;
  let right = 0;
  let total = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const lum = (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
      const weight = lum * lum;
      total += weight;
      if (x < third) left += weight;
      else if (x >= width - third) right += weight;
    }
  }
  if (total <= 0) return "top";
  const mean = (left + right) / 2;
  if (mean <= 1e-6) return "top";
  const bias = (right - left) / mean;
  if (bias > PLATE_LIGHT_BIAS) return "right";
  if (bias < -PLATE_LIGHT_BIAS) return "left";
  return "top";
}

const plateLightCache = new Map<string, Promise<PlateLightSide | null>>();

/**
 * Light side of a plate image, sampled once per URL from a 24x14 thumbnail.
 * Null where the browser cannot read the pixels (no canvas, a cross-origin
 * image without CORS, a decode failure); the stage then keeps the default.
 */
export function measurePlateLight(url: string): Promise<PlateLightSide | null> {
  const cached = plateLightCache.get(url);
  if (cached) return cached;
  const result = samplePlate(url);
  plateLightCache.set(url, result);
  if (plateLightCache.size > 64) {
    const oldest = plateLightCache.keys().next().value;
    if (oldest !== undefined) plateLightCache.delete(oldest);
  }
  return result;
}

async function samplePlate(url: string): Promise<PlateLightSide | null> {
  if (typeof Image === "undefined" || typeof document === "undefined") return null;
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas") as HTMLCanvasElement;
    if (typeof canvas.getContext !== "function") return null;
    const { width, height } = PLATE_SAMPLE_SIZE;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    return plateLightSide(context.getImageData(0, 0, width, height).data, width, height);
  } catch {
    return null;
  }
}
