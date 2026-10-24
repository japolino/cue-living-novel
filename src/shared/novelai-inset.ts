/**
 * NovelAI V5 reference inset: geometry shared by the backend (request, crop)
 * and the browser (canvas and mask). V5 has no Precise Reference or Vibe
 * Transfer, so a character is kept consistent by inpainting: the reference
 * image fills one part of a canvas, the rest is masked, and a V5 inpainting
 * request ("split screen") draws the masked part copying the character and
 * its art style; the repainted part is cropped out as the result. Technique:
 * arca.live AI-art channel, author "bequiet" (posts 180786125, 185554190,
 * 185642997).
 *
 * Mask edges must sit on 8-px blocks (the latent grid) or a grey seam
 * appears; canvas sides are multiples of 64. One layout per use, so a scene
 * layout can be added later next to the sprite one.
 */

/** A pixel rectangle (integers). */
export type PixelRect = { x: number; y: number; width: number; height: number };

export type NovelAiInsetLayoutId = "sprite";

export type NovelAiInsetLayout = {
  id: NovelAiInsetLayoutId;
  canvas: { width: number; height: number };
  /** Where the reference is fitted (contained and centred, on white). */
  reference: PixelRect;
  /** The masked part: white in the mask, repainted, and cropped as the result. */
  repaint: PixelRect;
};

/** Mask edges must sit on blocks of this many pixels. */
export const NOVELAI_INSET_BLOCK = 8;
/** Canvas sides must be multiples of this. */
export const NOVELAI_INSET_CANVAS_STEP = 64;

/**
 * Sprite layout (author-validated): a 1216×832 landscape canvas (free on
 * Opus at ≤ 28 steps), the reference in the left half (608×832, full
 * height), the right half repainted. The output is 608×832.
 */
export const NOVELAI_INSET_LAYOUTS: Readonly<Record<NovelAiInsetLayoutId, NovelAiInsetLayout>> = {
  sprite: {
    id: "sprite",
    canvas: { width: 1216, height: 832 },
    reference: { x: 0, y: 0, width: 608, height: 832 },
    repaint: { x: 608, y: 0, width: 608, height: 832 },
  },
};

export function novelAiInsetLayout(id: unknown): NovelAiInsetLayout | null {
  return typeof id === "string" && Object.hasOwn(NOVELAI_INSET_LAYOUTS, id) ? NOVELAI_INSET_LAYOUTS[id as NovelAiInsetLayoutId] : null;
}

function inside(rect: PixelRect, canvas: { width: number; height: number }): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= canvas.width && rect.y + rect.height <= canvas.height;
}

function overlaps(left: PixelRect, right: PixelRect): boolean {
  return left.x < right.x + right.width && right.x < left.x + left.width && left.y < right.y + right.height && right.y < left.y + left.height;
}

/** What is wrong with a layout (empty when it is usable). */
export function insetLayoutProblems(layout: Pick<NovelAiInsetLayout, "canvas" | "reference" | "repaint">): string[] {
  const problems: string[] = [];
  const { canvas, reference, repaint } = layout;
  const integers = [canvas.width, canvas.height, reference.x, reference.y, reference.width, reference.height, repaint.x, repaint.y, repaint.width, repaint.height];
  if (!integers.every((value) => Number.isInteger(value))) problems.push("not integer pixels");
  if (canvas.width % NOVELAI_INSET_CANVAS_STEP || canvas.height % NOVELAI_INSET_CANVAS_STEP) problems.push(`canvas sides are not multiples of ${NOVELAI_INSET_CANVAS_STEP}`);
  if (!inside(reference, canvas)) problems.push("reference box outside the canvas");
  if (!inside(repaint, canvas)) problems.push("repaint box outside the canvas");
  if ([repaint.x, repaint.y, repaint.x + repaint.width, repaint.y + repaint.height].some((edge) => edge % NOVELAI_INSET_BLOCK)) problems.push(`mask edges are not on ${NOVELAI_INSET_BLOCK}-px blocks`);
  if (overlaps(reference, repaint)) problems.push("reference and repaint boxes overlap");
  return problems;
}

/** The reference's drawn box: contained in `box` (scaled up or down, aspect kept), centred, integer pixels. */
export function fitContain(source: { width: number; height: number }, box: PixelRect): PixelRect {
  if (!(source.width > 0) || !(source.height > 0)) return { ...box };
  const scale = Math.min(box.width / source.width, box.height / source.height);
  const width = Math.max(1, Math.min(box.width, Math.round(source.width * scale)));
  const height = Math.max(1, Math.min(box.height, Math.round(source.height * scale)));
  return { x: box.x + Math.floor((box.width - width) / 2), y: box.y + Math.floor((box.height - height) / 2), width, height };
}

/** Mask value at a pixel: 255 (white, repaint) inside the repaint box, else 0 (black, keep). */
export function insetMaskValue(layout: Pick<NovelAiInsetLayout, "repaint">, x: number, y: number): 0 | 255 {
  const { repaint } = layout;
  return x >= repaint.x && x < repaint.x + repaint.width && y >= repaint.y && y < repaint.y + repaint.height ? 255 : 0;
}

/** Largest side a crop rectangle may name. */
export const MAX_CROP_SIDE = 16384;

/** A crop rectangle from untrusted input (stored data, a message), or null when it is not usable. */
export function normalizePixelRect(value: unknown): PixelRect | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<Record<keyof PixelRect, unknown>>;
  const fields = [record.x, record.y, record.width, record.height];
  if (!fields.every((field) => typeof field === "number" && Number.isInteger(field))) return null;
  const [x, y, width, height] = fields as number[];
  if (x! < 0 || y! < 0 || width! < 1 || height! < 1 || x! + width! > MAX_CROP_SIDE || y! + height! > MAX_CROP_SIDE) return null;
  return { x: x!, y: y!, width: width!, height: height! };
}
