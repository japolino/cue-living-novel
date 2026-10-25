/**
 * Sticker outline for cut-out sprites (docs/SPRITE_MODE.md, "Puppet
 * motion"), baked once per image, radius and colour (white by default,
 * config `spriteOutlineColor`) into a canvas the size of the image: the alpha
 * is thresholded first (faint haze around a cut-out must not grow into a
 * halo), the coloured silhouette is drawn around a few rings of
 * offsets (a dilation), and the original is drawn on top. The stage then
 * shows the canvas (or uploads it as the puppet texture); there is no
 * per-frame CSS drop-shadow.
 */

/** Alpha (0..255) below which a pixel does not count for the outline, and above which it counts fully. */
export const OUTLINE_ALPHA_LOW = 72;
export const OUTLINE_ALPHA_HIGH = 150;

/** Offsets (dx, dy) that dilate a silhouette by `radius` px: rings at the radius and inside it, about 1.2 px apart. */
export function outlineOffsets(radius: number): Array<[number, number]> {
  if (!(radius > 0)) return [];
  const rings = radius > 2.4 ? [radius, radius * 0.64, radius * 0.3] : radius > 1.2 ? [radius, radius * 0.5] : [radius];
  const offsets: Array<[number, number]> = [];
  for (const ring of rings) {
    const steps = Math.min(48, Math.max(8, Math.ceil((2 * Math.PI * ring) / 1.2)));
    for (let i = 0; i < steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2;
      offsets.push([Math.cos(angle) * ring, Math.sin(angle) * ring]);
    }
  }
  return offsets;
}

/** "#rrggbb" as [r, g, b] (white for anything else). */
export function outlineRgb(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!match) return [255, 255, 255];
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

/** Threshold an RGBA buffer into a silhouette of one colour in place (see OUTLINE_ALPHA_LOW/HIGH). */
export function silhouetteInPlace(rgba: Uint8ClampedArray, rgb: readonly [number, number, number] = [255, 255, 255]): void {
  const span = OUTLINE_ALPHA_HIGH - OUTLINE_ALPHA_LOW;
  const [red, green, blue] = rgb;
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3]!;
    rgba[i] = red;
    rgba[i + 1] = green;
    rgba[i + 2] = blue;
    rgba[i + 3] = alpha <= OUTLINE_ALPHA_LOW ? 0 : alpha >= OUTLINE_ALPHA_HIGH ? 255 : Math.round(((alpha - OUTLINE_ALPHA_LOW) / span) * 255);
  }
}

const canvas2d = (doc: Document, width: number, height: number, readback = false): [HTMLCanvasElement, CanvasRenderingContext2D] | null => {
  try {
    const canvas = doc.createElement("canvas");
    if (typeof canvas.getContext !== "function") return null;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", readback ? { willReadFrequently: true } : undefined) as CanvasRenderingContext2D | null;
    return ctx ? [canvas, ctx] : null;
  } catch {
    return null;
  }
};

/**
 * The image with an outline of `radius` image pixels in `color` ("#rrggbb"), as a canvas of
 * the image's size; null when canvases are not available. A cross-origin
 * image without CORS cannot be read back: its silhouette is then not
 * thresholded and fewer offsets are used, so haze stays faint.
 */
export function bakeSpriteOutline(source: CanvasImageSource, width: number, height: number, radius: number, doc: Document = document, color = "#ffffff"): HTMLCanvasElement | null {
  if (!(width > 0 && height > 0)) return null;
  const silhouette = canvas2d(doc, width, height, true);
  const out = canvas2d(doc, width, height);
  if (!silhouette || !out) return null;
  const [silCanvas, sil] = silhouette;
  const [outCanvas, ctx] = out;
  sil.drawImage(source, 0, 0, width, height);
  let offsets = outlineOffsets(radius);
  try {
    const pixels = sil.getImageData(0, 0, width, height);
    silhouetteInPlace(pixels.data, outlineRgb(color));
    sil.putImageData(pixels, 0, 0);
  } catch {
    sil.globalCompositeOperation = "source-in";
    sil.fillStyle = color;
    sil.fillRect(0, 0, width, height);
    offsets = offsets.filter((_, i) => i % 4 === 0);
  }
  for (const [dx, dy] of offsets) ctx.drawImage(silCanvas, dx, dy);
  ctx.drawImage(source, 0, 0, width, height);
  silCanvas.width = 0;
  silCanvas.height = 0;
  return outCanvas;
}
