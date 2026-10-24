import { fitContain, type NovelAiInsetLayout, type PixelRect } from "../../shared/novelai-inset.js";

/**
 * Small canvas helpers for the sprite pipeline (main thread): the NovelAI V5
 * reference inset canvas and mask, and the crop of an inset render before
 * the cut-out. OffscreenCanvas where it exists, else a detached <canvas>.
 */

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(width: number, height: number): { canvas: AnyCanvas; context: Context2D } {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context) return { canvas, context };
  }
  if (typeof document === "undefined") throw new Error("This browser cannot draw images (no canvas).");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw images (no 2D canvas).");
  return { canvas, context };
}

async function toPng(canvas: AnyCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/png" });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The canvas could not be saved as PNG."))), "image/png");
  });
}

/**
 * The inset canvas (white, the reference contained and centred in the
 * layout's reference box) and its mask (black keep, white repaint), both
 * PNGs of the canvas size.
 */
export async function composeNovelAiInset(reference: Blob, layout: NovelAiInsetLayout): Promise<{ image: Blob; mask: Blob }> {
  const bitmap = await createImageBitmap(reference);
  try {
    const { width, height } = layout.canvas;
    const image = makeCanvas(width, height);
    image.context.fillStyle = "#ffffff";
    image.context.fillRect(0, 0, width, height);
    const box = fitContain({ width: bitmap.width, height: bitmap.height }, layout.reference);
    image.context.imageSmoothingEnabled = true;
    image.context.imageSmoothingQuality = "high";
    // A transparent reference (a cut-out) lands on white, like the sprites themselves.
    image.context.drawImage(bitmap, box.x, box.y, box.width, box.height);
    const mask = makeCanvas(width, height);
    mask.context.fillStyle = "#000000";
    mask.context.fillRect(0, 0, width, height);
    mask.context.fillStyle = "#ffffff";
    mask.context.fillRect(layout.repaint.x, layout.repaint.y, layout.repaint.width, layout.repaint.height);
    return { image: await toPng(image.canvas), mask: await toPng(mask.canvas) };
  } finally {
    bitmap.close();
  }
}

/** `blob` cropped to `rect` (pixels) as a PNG. Throws when the rectangle is not inside the image. */
export async function cropImageBlob(blob: Blob, rect: PixelRect): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (rect.x + rect.width > bitmap.width || rect.y + rect.height > bitmap.height) {
      throw new Error(`The crop ${rect.width}×${rect.height} at ${rect.x},${rect.y} is outside the ${bitmap.width}×${bitmap.height} image.`);
    }
    const target = makeCanvas(rect.width, rect.height);
    target.context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return await toPng(target.canvas);
  } finally {
    bitmap.close();
  }
}
