import { describe, expect, test } from "bun:test";
import { createFaceKernel } from "./face-kernel.js";
import { createCutoutKernel } from "./kernel.js";

const face = createFaceKernel();

/** YOLO output [1, 5, N] from rows of [cx, cy, w, h, score]. */
function channelsFirst(rows: number[][]): { data: Float32Array; dims: number[] } {
  const n = rows.length;
  const data = new Float32Array(5 * n);
  rows.forEach((row, i) => row.forEach((value, c) => { data[c * n + i] = value; }));
  return { data, dims: [1, 5, n] };
}

describe("face kernel", () => {
  test("input size: long side 640, both sides multiples of 32, small images round up", () => {
    expect(face.inputSize(624, 912)).toEqual({ width: 448, height: 640 });
    expect(face.inputSize(832, 1216)).toEqual({ width: 448, height: 640 });
    expect(face.inputSize(1216, 832)).toEqual({ width: 640, height: 448 });
    expect(face.inputSize(100, 50)).toEqual({ width: 128, height: 64 });
  });

  test("model input is RGB / 255 in CHW planes", () => {
    const rgba = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i++) rgba.set([255, 51, 0, 7], i * 4);
    const input = face.faceInput(rgba, 32, 32, createCutoutKernel().resizeBilinear);
    expect([input.width, input.height]).toEqual([32, 32]);
    expect(input.tensor.length).toBe(3 * 32 * 32);
    expect(input.tensor[0]).toBeCloseTo(1, 5);
    expect(input.tensor[32 * 32]).toBeCloseTo(0.2, 5);
    expect(input.tensor[2 * 32 * 32]).toBe(0);
  });

  test("decode: threshold, NMS, best first, normalized to the input size", () => {
    const { data, dims } = channelsFirst([
      [100, 200, 40, 60, 0.6],
      [224, 160, 80, 80, 0.9],
      [226, 162, 80, 80, 0.85], // same face, overlaps the best one: dropped
      [50, 50, 20, 20, 0.2], // below the threshold
      [400, 600, 40, 40, 0.7], // a second face
    ]);
    const found = face.decode(data, dims, { width: 448, height: 640 }, 0.5);
    expect(found.map((item) => item.score)).toEqual([expect.closeTo(0.9, 5), expect.closeTo(0.7, 5), expect.closeTo(0.6, 5)]);
    const [x, y, w, h] = found[0]!.box;
    expect(x).toBeCloseTo(184 / 448, 6);
    expect(y).toBeCloseTo(120 / 640, 6);
    expect(w).toBeCloseTo(80 / 448, 6);
    expect(h).toBeCloseTo(80 / 640, 6);
    expect(face.pick(found)!.score).toBeCloseTo(0.9, 5);
  });

  test("decode reads [1, N, 5] too, and clamps boxes to the image", () => {
    const rows = [[10, 10, 40, 40, 0.8], ...Array.from({ length: 30 }, () => [0, 0, 0, 0, 0])];
    const data = Float32Array.from(rows.flat());
    const found = face.decode(data, [1, rows.length, 5], { width: 64, height: 64 }, 0.5);
    expect(found).toHaveLength(1);
    expect(found[0]!.box).toEqual([0, 0, 30 / 64, 30 / 64]);
  });

  test("decode ignores empty, broken and short output", () => {
    expect(face.decode(new Float32Array(0), [1, 5, 0], { width: 32, height: 32 }, 0.5)).toEqual([]);
    expect(face.decode(new Float32Array(10), [1, 5, 8400], { width: 32, height: 32 }, 0.5)).toEqual([]);
    const { data, dims } = channelsFirst([[16, 16, 0, 10, 0.9], [16, 16, 10, 10, Number.NaN]]);
    expect(face.decode(data, dims, { width: 32, height: 32 }, 0.5)).toEqual([]);
    expect(face.pick([])).toBeNull();
  });

  test("factory source is self-contained (it is shipped to a Worker as text)", () => {
    const rebuilt = new Function(`return (${String(createFaceKernel)})();`)() as ReturnType<typeof createFaceKernel>;
    const { data, dims } = channelsFirst([[16, 16, 8, 8, 0.9]]);
    expect(rebuilt.decode(data, dims, { width: 32, height: 32 }, 0.5)[0]!.box).toEqual([0.375, 0.375, 0.25, 0.25]);
  });
});
