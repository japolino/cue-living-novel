import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fitContain, insetMaskValue, NOVELAI_INSET_LAYOUTS } from "../../shared/novelai-inset.js";
import { composeNovelAiInset, cropImageBlob } from "./canvas-tools.js";

/**
 * The browser canvas code with a tiny fake 2D canvas: fills are painted into
 * a grey-level buffer (enough to check the mask pixel by pixel), drawImage
 * calls are recorded, and blobs map back to the canvas they came from.
 */

type Bitmap = { width: number; height: number; closed: boolean; close: () => void };

class FakeContext {
  fillStyle = "#000000";
  imageSmoothingEnabled = false;
  imageSmoothingQuality = "low";
  readonly draws: unknown[][] = [];
  constructor(private readonly canvas: FakeCanvas) {}
  fillRect(x: number, y: number, width: number, height: number): void {
    const value = this.fillStyle === "#ffffff" ? 255 : this.fillStyle === "#000000" ? 0 : -1;
    if (value < 0) throw new Error(`unexpected fill ${this.fillStyle}`);
    for (let row = Math.max(0, y); row < Math.min(this.canvas.height, y + height); row += 1) {
      this.canvas.pixels.fill(value, row * this.canvas.width + Math.max(0, x), row * this.canvas.width + Math.min(this.canvas.width, x + width));
    }
  }
  drawImage(...args: unknown[]): void {
    this.draws.push(args);
  }
}

class FakeCanvas {
  readonly pixels: Uint8Array;
  readonly context = new FakeContext(this);
  constructor(readonly width: number, readonly height: number) {
    this.pixels = new Uint8Array(width * height).fill(7);
  }
  getContext(kind: string): FakeContext | null {
    return kind === "2d" ? this.context : null;
  }
  async convertToBlob(options: { type: string }): Promise<Blob> {
    const blob = new Blob([`${this.width}x${this.height}`], { type: options.type });
    canvases.set(blob, this);
    return blob;
  }
}

const canvases = new WeakMap<Blob, FakeCanvas>();
const sizes = new WeakMap<Blob, { width: number; height: number }>();
const bitmaps: Bitmap[] = [];
const globals = globalThis as Record<string, unknown>;
let saved: { OffscreenCanvas: unknown; createImageBitmap: unknown };

function picture(width: number, height: number): Blob {
  const blob = new Blob(["png"], { type: "image/png" });
  sizes.set(blob, { width, height });
  return blob;
}

beforeEach(() => {
  saved = { OffscreenCanvas: globals.OffscreenCanvas, createImageBitmap: globals.createImageBitmap };
  globals.OffscreenCanvas = FakeCanvas;
  globals.createImageBitmap = async (blob: Blob) => {
    const size = sizes.get(blob);
    if (!size) throw new Error("not an image");
    const bitmap: Bitmap = { ...size, closed: false, close: () => { bitmap.closed = true; } };
    bitmaps.push(bitmap);
    return bitmap;
  };
  bitmaps.length = 0;
});

afterEach(() => {
  globals.OffscreenCanvas = saved.OffscreenCanvas;
  globals.createImageBitmap = saved.createImageBitmap;
});

describe("NovelAI V5 inset canvas (browser)", () => {
  const layout = NOVELAI_INSET_LAYOUTS.sprite;

  test("the mask is black where the reference stays and white where NovelAI repaints, pixel by pixel", async () => {
    const { mask } = await composeNovelAiInset(picture(832, 1216), layout);
    const canvas = canvases.get(mask)!;
    expect([canvas.width, canvas.height]).toEqual([1216, 832]);
    expect(mask.type).toBe("image/png");
    let mismatches = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) if (canvas.pixels[y * canvas.width + x] !== insetMaskValue(layout, x, y)) mismatches += 1;
    }
    expect(mismatches).toBe(0);
    // The edge sits at x = 608 on every row.
    expect([canvas.pixels[607], canvas.pixels[608]]).toEqual([0, 255]);
  });

  test("the canvas is white with the reference contained in the left box, smoothed", async () => {
    const { image } = await composeNovelAiInset(picture(832, 1216), layout);
    const canvas = canvases.get(image)!;
    expect([canvas.width, canvas.height]).toEqual([1216, 832]);
    expect(canvas.pixels.every((value) => value === 255)).toBe(true);
    const box = fitContain({ width: 832, height: 1216 }, layout.reference);
    expect(box).toEqual({ x: 19, y: 0, width: 569, height: 832 });
    expect(canvas.context.draws).toEqual([[bitmaps[0], box.x, box.y, box.width, box.height]]);
    expect(canvas.context.imageSmoothingEnabled).toBe(true);
    expect(canvas.context.imageSmoothingQuality).toBe("high");
    expect(bitmaps[0]!.closed).toBe(true);
  });

  test("an inset render is cropped to the repainted half; a crop outside the image throws", async () => {
    const cropped = await cropImageBlob(picture(1216, 832), layout.repaint);
    const canvas = canvases.get(cropped)!;
    expect([canvas.width, canvas.height]).toEqual([608, 832]);
    expect(canvas.context.draws).toEqual([[bitmaps[0], 608, 0, 608, 832, 0, 0, 608, 832]]);
    expect(bitmaps[0]!.closed).toBe(true);
    await expect(cropImageBlob(picture(832, 1216), layout.repaint)).rejects.toThrow("outside");
    expect(bitmaps[1]!.closed).toBe(true);
  });
});
