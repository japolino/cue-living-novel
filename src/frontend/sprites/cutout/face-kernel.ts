/**
 * DOM-free face detector helpers for sprite emotes (YOLOv8 ONNX, one class).
 *
 * Self-contained like kernel.ts: `String(createFaceKernel)` is shipped into
 * the cut-out worker, so the factory uses no imports and no module values.
 *
 * Input: the image is stretched (no letterbox) so the long side is at most
 * `maxSize` and both sides are multiples of 32, RGB / 255, CHW. This matches
 * how the deepghs detectors were trained and evaluated (dghs-imgutils).
 * Output: `[1, 5, anchors]` (or `[1, anchors, 5]`) rows of cx, cy, w, h,
 * score in input pixels.
 */

/** Normalized box relative to the full image: [x, y, width, height]. */
export type FaceBox = [number, number, number, number];

export type FaceCandidate = { box: FaceBox; score: number };

export type FaceInput = {
  /** 1x3xHxW CHW float tensor data, RGB / 255. */
  tensor: Float32Array;
  width: number;
  height: number;
};

export type FaceKernel = {
  readonly params: { maxSize: number; align: number; iou: number };
  /** Input size for an image: long side at most maxSize, both sides multiples of align. */
  inputSize(width: number, height: number): { width: number; height: number };
  /**
   * Model input from RGBA (alpha is ignored: composite first). `resize`
   * resizes interleaved float channels (the cut-out kernel's resizeBilinear).
   */
  faceInput(
    rgba: Uint8ClampedArray, width: number, height: number,
    resize: (src: Float32Array, sw: number, sh: number, channels: number, dw: number, dh: number) => Float32Array,
  ): FaceInput;
  /** Boxes at or above `threshold`, after NMS, best first, normalized to the image. */
  decode(output: Float32Array, dims: readonly number[], input: { width: number; height: number }, threshold: number): FaceCandidate[];
  /** The face to use for emotes: the best scoring box, or null. */
  pick(candidates: readonly FaceCandidate[]): FaceCandidate | null;
};

export function createFaceKernel(): FaceKernel {
  const params = {
    /** Long side of the model input (the size the detectors were trained at). */
    maxSize: 640,
    align: 32,
    /** NMS: boxes overlapping a better one more than this are dropped. */
    iou: 0.7,
  };

  function inputSize(width: number, height: number): { width: number; height: number } {
    const scale = Math.min(1, params.maxSize / Math.max(width, height));
    return {
      width: Math.max(params.align, Math.ceil((width * scale) / params.align) * params.align),
      height: Math.max(params.align, Math.ceil((height * scale) / params.align) * params.align),
    };
  }

  function faceInput(
    rgba: Uint8ClampedArray, width: number, height: number,
    resize: (src: Float32Array, sw: number, sh: number, channels: number, dw: number, dh: number) => Float32Array,
  ): FaceInput {
    const size = inputSize(width, height);
    const n = width * height;
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      rgb[i * 3] = rgba[i * 4]!;
      rgb[i * 3 + 1] = rgba[i * 4 + 1]!;
      rgb[i * 3 + 2] = rgba[i * 4 + 2]!;
    }
    const small = size.width === width && size.height === height ? rgb : resize(rgb, width, height, 3, size.width, size.height);
    const plane = size.width * size.height;
    const tensor = new Float32Array(plane * 3);
    for (let i = 0; i < plane; i++) {
      tensor[i] = small[i * 3]! / 255;
      tensor[plane + i] = small[i * 3 + 1]! / 255;
      tensor[2 * plane + i] = small[i * 3 + 2]! / 255;
    }
    return { tensor, width: size.width, height: size.height };
  }

  function overlap(a: FaceBox, b: FaceBox): number {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
    const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a[2] * a[3] + b[2] * b[3] - inter;
    return union > 0 ? inter / union : 0;
  }

  function decode(output: Float32Array, dims: readonly number[], input: { width: number; height: number }, threshold: number): FaceCandidate[] {
    const a = dims.length >= 2 ? dims[dims.length - 2]! : 0;
    const b = dims.length >= 1 ? dims[dims.length - 1]! : 0;
    // [5, N] (YOLOv8 export) or [N, 5]: the short side (5..16) holds box + scores.
    const channelsFirst = !(b >= 5 && b <= 16 && a > b);
    const count = channelsFirst ? b : a;
    const stride = channelsFirst ? b : 0;
    const width = channelsFirst ? a : b;
    if (count <= 0 || width < 5 || output.length < count * width) return [];
    const at = (row: number, col: number): number => (channelsFirst ? output[col * stride + row]! : output[row * width + col]!);
    const found: FaceCandidate[] = [];
    for (let i = 0; i < count; i++) {
      const score = at(i, 4);
      if (!(score >= threshold)) continue;
      const cx = at(i, 0), cy = at(i, 1), w = at(i, 2), h = at(i, 3);
      if (!(w > 0) || !(h > 0)) continue;
      let x0 = (cx - w / 2) / input.width, y0 = (cy - h / 2) / input.height;
      let x1 = (cx + w / 2) / input.width, y1 = (cy + h / 2) / input.height;
      x0 = Math.min(1, Math.max(0, x0)); y0 = Math.min(1, Math.max(0, y0));
      x1 = Math.min(1, Math.max(0, x1)); y1 = Math.min(1, Math.max(0, y1));
      if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
      found.push({ box: [x0, y0, x1 - x0, y1 - y0], score });
    }
    found.sort((left, right) => right.score - left.score);
    const kept: FaceCandidate[] = [];
    for (const candidate of found) {
      if (kept.every((other) => overlap(candidate.box, other.box) <= params.iou)) kept.push(candidate);
    }
    return kept;
  }

  function pick(candidates: readonly FaceCandidate[]): FaceCandidate | null {
    let best: FaceCandidate | null = null;
    for (const candidate of candidates) if (!best || candidate.score > best.score) best = candidate;
    return best;
  }

  return { params, inputSize, faceInput, decode, pick };
}
