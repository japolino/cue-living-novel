/**
 * Pure pixel steps of plate depth (docs/SPRITE_MODE.md, "3D backgrounds"):
 * the model input of a plate and the depth map from the model's output.
 *
 * The model is Depth Anything V2 Small (DEFAULT_PLATE_DEPTH_MODEL_URL). It
 * takes the plate resized so the short side is about PLATE_DEPTH_INPUT px
 * (both sides multiples of 14, aspect kept), normalized with the ImageNet mean and
 * deviation, and returns relative disparity: bigger is nearer. Parallax is
 * proportional to disparity, so the depth map is the disparity normalized
 * between its 1st and 99th percentile, inverted (0 = nearest, 255 =
 * farthest), at most PLATE_DEPTH_MAX_WIDTH wide, softened a little
 * (PLATE_DEPTH_SMOOTH) so the parallax warp does not ghost sharp edges.
 *
 * `createPlateDepthKernel` is self-contained (no imports, no module-level
 * values) because the depth worker ships its source text
 * (plate-depth-worker.ts), like the cut-out kernel.
 */

/**
 * Short side of the model input, in px. The model's own size is 518; 392
 * ordered the same 97.5% of held-out near/far pairs with 40% fewer tokens
 * (edge alignment 81.5% against 83.5%).
 */
export const PLATE_DEPTH_INPUT = 392;
/** Widest depth map kept (px); the parallax needs no more. */
export const PLATE_DEPTH_MAX_WIDTH = 512;
/**
 * Gaussian sigma (depth-map px) of the softening. On 10 held-out plates at
 * full camera shift, 2 cut ghosted pixels from 0.59% to 0.12% and stretched
 * ones from 0.91% to 0.60%, with the same near/far order (97.5%).
 */
export const PLATE_DEPTH_SMOOTH = 2;

/** A depth map: 0 = nearest .. 255 = farthest, row-major. */
export type PlateDepthMap = { width: number; height: number; depth: Uint8Array };

export type PlateDepthKernel = {
  /** Model input size for a plate (aspect kept, sides multiples of 14). */
  inputSize(width: number, height: number, target?: number): { width: number; height: number };
  /** RGBA already at the input size -> normalized planar RGB (1 x 3 x H x W). */
  modelInput(rgba: ArrayLike<number>, width: number, height: number): Float32Array;
  /** Model output (disparity, bigger = nearer) -> depth map at most `maxWidth` wide, softened by `smooth` (sigma, px). */
  depthMap(disparity: ArrayLike<number>, width: number, height: number, maxWidth?: number, smooth?: number): PlateDepthMap;
};

export function createPlateDepthKernel(): PlateDepthKernel {
  const MULTIPLE = 14;
  const MEAN = [0.485, 0.456, 0.406];
  const STD = [0.229, 0.224, 0.225];

  function inputSize(width: number, height: number, target = 392): { width: number; height: number } {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    // DPT keep-aspect resize: the scale closer to 1 wins (the short side lands on target).
    const sw = target / w;
    const sh = target / h;
    const s = Math.abs(1 - sw) < Math.abs(1 - sh) ? sw : sh;
    const side = (v: number): number => Math.max(MULTIPLE, Math.round((v * s) / MULTIPLE) * MULTIPLE);
    return { width: side(w), height: side(h) };
  }

  function modelInput(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
    const plane = width * height;
    const out = new Float32Array(plane * 3);
    for (let i = 0; i < plane; i += 1) {
      const o = i * 4;
      out[i] = (rgba[o]! / 255 - MEAN[0]!) / STD[0]!;
      out[plane + i] = (rgba[o + 1]! / 255 - MEAN[1]!) / STD[1]!;
      out[plane * 2 + i] = (rgba[o + 2]! / 255 - MEAN[2]!) / STD[2]!;
    }
    return out;
  }

  /** The 1st and 99th percentile of up to ~16k evenly spaced samples. */
  function range(values: ArrayLike<number>): { lo: number; hi: number } {
    const step = Math.max(1, Math.floor(values.length / 16384));
    const sample: number[] = [];
    for (let i = 0; i < values.length; i += step) {
      const v = values[i]!;
      if (Number.isFinite(v)) sample.push(v);
    }
    if (!sample.length) return { lo: 0, hi: 0 };
    sample.sort((a, b) => a - b);
    const at = (q: number): number => sample[Math.min(sample.length - 1, Math.max(0, Math.round(q * (sample.length - 1))))]!;
    return { lo: at(0.01), hi: at(0.99) };
  }

  /** Separable Gaussian blur in place, edges clamped. */
  function soften(values: Float32Array, width: number, height: number, sigma: number): void {
    if (!(sigma > 0)) return;
    const radius = Math.ceil(sigma * 3);
    const kernel: number[] = [];
    let total = 0;
    for (let i = -radius; i <= radius; i += 1) { const k = Math.exp(-(i * i) / (2 * sigma * sigma)); kernel.push(k); total += k; }
    for (let i = 0; i < kernel.length; i += 1) kernel[i]! /= total;
    const line = new Float32Array(Math.max(width, height));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let i = -radius; i <= radius; i += 1) sum += kernel[i + radius]! * values[y * width + Math.min(width - 1, Math.max(0, x + i))]!;
        line[x] = sum;
      }
      values.set(line.subarray(0, width), y * width);
    }
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        let sum = 0;
        for (let i = -radius; i <= radius; i += 1) sum += kernel[i + radius]! * values[Math.min(height - 1, Math.max(0, y + i)) * width + x]!;
        line[y] = sum;
      }
      for (let y = 0; y < height; y += 1) values[y * width + x] = line[y]!;
    }
  }

  function depthMap(disparity: ArrayLike<number>, width: number, height: number, maxWidth = 512, smooth = 2): PlateDepthMap {
    const outW = Math.max(1, Math.min(width, maxWidth));
    const outH = Math.max(1, Math.round((height * outW) / width));
    const depth = new Uint8Array(outW * outH);
    const { lo, hi } = range(disparity);
    const span = hi - lo;
    // A flat output (a solid colour plate): everything far, no parallax.
    if (!(span > 1e-6)) { depth.fill(255); return { width: outW, height: outH, depth }; }
    const near = new Float32Array(outW * outH);
    const sx = width / outW;
    const sy = height / outH;
    for (let y = 0; y < outH; y += 1) {
      // Bilinear sample at the output pixel centre.
      const v = Math.min(height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
      const y0 = Math.floor(v);
      const y1 = Math.min(height - 1, y0 + 1);
      const fy = v - y0;
      for (let x = 0; x < outW; x += 1) {
        const u = Math.min(width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
        const x0 = Math.floor(u);
        const x1 = Math.min(width - 1, x0 + 1);
        const fx = u - x0;
        const top = disparity[y0 * width + x0]! * (1 - fx) + disparity[y0 * width + x1]! * fx;
        const bottom = disparity[y1 * width + x0]! * (1 - fx) + disparity[y1 * width + x1]! * fx;
        const value = Math.min(1, Math.max(0, (top * (1 - fy) + bottom * fy - lo) / span));
        near[y * outW + x] = Number.isFinite(value) ? value : 0;
      }
    }
    soften(near, outW, outH, smooth);
    for (let i = 0; i < near.length; i += 1) depth[i] = Math.round((1 - near[i]!) * 255);
    return { width: outW, height: outH, depth };
  }

  return { inputSize, modelInput, depthMap };
}
