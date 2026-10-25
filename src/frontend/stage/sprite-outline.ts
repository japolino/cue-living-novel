/**
 * White sticker outline for cut-out sprites (docs/SPRITE_MODE.md, "Puppet
 * motion"), baked once per image and radius into a canvas the size of the
 * image: the alpha is thresholded first (faint haze around a cut-out must not
 * grow into a halo), the white silhouette is drawn around a few rings of
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

/** Threshold an RGBA buffer into a white silhouette in place (see OUTLINE_ALPHA_LOW/HIGH). */
export function silhouetteInPlace(rgba: Uint8ClampedArray): void {
  const span = OUTLINE_ALPHA_HIGH - OUTLINE_ALPHA_LOW;
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3]!;
    rgba[i] = 255;
    rgba[i + 1] = 255;
    rgba[i + 2] = 255;
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
 * The image with a white outline of `radius` image pixels, as a canvas of
 * the image's size; null when canvases are not available. A cross-origin
 * image without CORS cannot be read back: its silhouette is then not
 * thresholded and fewer offsets are used, so haze stays faint.
 */
export function bakeSpriteOutline(source: CanvasImageSource, width: number, height: number, radius: number, doc: Document = document): HTMLCanvasElement | null {
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
    silhouetteInPlace(pixels.data);
    sil.putImageData(pixels, 0, 0);
  } catch {
    sil.globalCompositeOperation = "source-in";
    sil.fillStyle = "#fff";
    sil.fillRect(0, 0, width, height);
    offsets = offsets.filter((_, i) => i % 4 === 0);
  }
  for (const [dx, dy] of offsets) ctx.drawImage(silCanvas, dx, dy);
  ctx.drawImage(source, 0, 0, width, height);
  silCanvas.width = 0;
  silCanvas.height = 0;
  return outCanvas;
}
