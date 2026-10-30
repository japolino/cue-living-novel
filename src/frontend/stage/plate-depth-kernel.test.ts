import { describe, expect, test } from "bun:test";
import { createPlateDepthKernel, PLATE_DEPTH_INPUT, PLATE_DEPTH_MAX_WIDTH, PLATE_DEPTH_SMOOTH } from "./plate-depth-kernel.js";

const kernel = createPlateDepthKernel();

describe("plate depth kernel", () => {
  test("input size: short side on the target, aspect kept, multiples of 14", () => {
    expect(kernel.inputSize(1216, 832)).toEqual({ width: 574, height: 392 });
    expect(kernel.inputSize(1216, 832, 518)).toEqual({ width: 756, height: 518 });
    expect(kernel.inputSize(832, 1216, 518)).toEqual({ width: 518, height: 756 });
    expect(kernel.inputSize(512, 512)).toEqual({ width: PLATE_DEPTH_INPUT, height: PLATE_DEPTH_INPUT });
    const tiny = kernel.inputSize(1, 900);
    expect(tiny.width % 14).toBe(0);
    expect(tiny.width).toBeGreaterThanOrEqual(14);
  });

  test("model input: planar RGB with the ImageNet normalization", () => {
    const rgba = new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 0, 255]);
    const t = kernel.modelInput(rgba, 2, 1);
    expect(t.length).toBe(6);
    expect(t[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(t[1]).toBeCloseTo((0 - 0.485) / 0.229, 5);
    expect(t[3]).toBeCloseTo((1 - 0.456) / 0.224, 5);
    expect(t[4]).toBeCloseTo((128 / 255 - 0.406) / 0.225, 5);
  });

  test("depth map: bigger disparity is nearer, 0 near .. 255 far", () => {
    // Disparity grows downward: the bottom row is the nearest.
    const w = 20;
    const h = 10;
    const disparity = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) disparity.fill(y, y * w, (y + 1) * w);
    const sharp = kernel.depthMap(disparity, w, h, 512, 0);
    expect(sharp.width).toBe(w);
    expect(sharp.height).toBe(h);
    expect(sharp.depth[0]).toBe(255);
    expect(sharp.depth[(h - 1) * w]).toBe(0);
    expect(sharp.depth[5 * w]!).toBeLessThan(sharp.depth[2 * w]!);
    // Softened by default: the same order, the extremes pulled in a little.
    const soft = kernel.depthMap(disparity, w, h);
    expect(soft.depth[0]!).toBeGreaterThan(200);
    expect(soft.depth[(h - 1) * w]!).toBeLessThan(55);
    expect(soft.depth[5 * w]!).toBeLessThan(soft.depth[2 * w]!);
  });

  test("depth map: outliers beyond the 1st / 99th percentile clamp", () => {
    const disparity = new Float32Array(1000).map((_, i) => i / 999);
    disparity[0] = -50;
    disparity[999] = 50;
    const map = kernel.depthMap(disparity, 1000, 1, 1000, 0);
    expect(map.depth[0]).toBe(255);
    expect(map.depth[999]).toBe(0);
    expect(map.depth[500]!).toBeGreaterThan(100);
    expect(map.depth[500]!).toBeLessThan(155);
  });

  test("depth map: at most 512 wide, aspect kept", () => {
    const map = kernel.depthMap(new Float32Array(756 * 518).fill(1), 756, 518);
    expect(map.width).toBe(PLATE_DEPTH_MAX_WIDTH);
    expect(map.height).toBe(Math.round((518 * 512) / 756));
  });

  test("depth map: softening spreads a step over a few pixels", () => {
    const disparity = new Float32Array(40).map((_, i) => (i < 20 ? 0 : 1));
    const map = kernel.depthMap(disparity, 40, 1, 40, PLATE_DEPTH_SMOOTH);
    expect(map.depth[0]).toBe(255);
    expect(map.depth[39]).toBe(0);
    expect(map.depth[19]!).toBeGreaterThan(map.depth[20]!);
    expect(map.depth[19]!).toBeLessThan(255);
    expect(map.depth[20]!).toBeGreaterThan(0);
  });

  test("depth map: a flat or broken output is all far", () => {
    expect([...kernel.depthMap(new Float32Array(16).fill(3), 4, 4).depth]).toEqual(new Array(16).fill(255));
    expect([...kernel.depthMap(new Float32Array(16).fill(Number.NaN), 4, 4).depth]).toEqual(new Array(16).fill(255));
  });

  test("the kernel survives being shipped as source (worker)", () => {
    const rebuilt = new Function(`return (${String(createPlateDepthKernel)})();`)() as ReturnType<typeof createPlateDepthKernel>;
    expect(rebuilt.inputSize(1216, 832)).toEqual({ width: 574, height: 392 });
  });
});
