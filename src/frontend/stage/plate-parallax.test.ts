import { describe, expect, test } from "bun:test";
import { PLATE_DOLLY_MS, PLATE_DOLLY_ZOOM, plateDollyZoom, plateDrawnWidth, plateFitTransform, plateFloorNear, pointerCamera } from "./plate-parallax.js";

describe("plate parallax helpers", () => {
  test("cover: the plate fills the view, the overflow is cropped evenly", () => {
    // 1216x832 on a 16:9 view: scaled to the width, top and bottom cropped.
    const fit = plateFitTransform("cover", 1216, 832, 1600, 900)!;
    expect(fit.contain).toBe(false);
    expect(fit.scaleX).toBeCloseTo(1, 6);
    expect(fit.offsetX).toBeCloseTo(0, 6);
    const drawnH = 832 * (1600 / 1216);
    expect(fit.scaleY).toBeCloseTo(900 / drawnH, 6);
    // The view's middle is the plate's middle.
    expect(fit.offsetY + 0.5 * fit.scaleY).toBeCloseTo(0.5, 6);
  });

  test("contain: the plate fits inside, the rest is outside 0..1", () => {
    const fit = plateFitTransform("contain", 1216, 832, 1600, 900)!;
    expect(fit.contain).toBe(true);
    expect(fit.scaleY).toBeCloseTo(1, 6);
    expect(fit.offsetX).toBeLessThan(0);
    expect(fit.offsetX + fit.scaleX).toBeGreaterThan(1);
  });

  test("fill stretches; other fits are not drawn", () => {
    expect(plateFitTransform("fill", 1216, 832, 1600, 900)).toEqual({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, contain: false });
    expect(plateFitTransform("none", 1216, 832, 1600, 900)).toBeNull();
    expect(plateFitTransform("scale-down", 1216, 832, 1600, 900)).toBeNull();
    expect(plateFitTransform("cover", 0, 832, 1600, 900)).toBeNull();
  });

  test("drawn width follows the fit", () => {
    expect(plateDrawnWidth("cover", 1216, 832, 1600, 900)).toBeCloseTo(1600, 3);
    expect(plateDrawnWidth("contain", 1216, 832, 1600, 900)).toBeCloseTo(1216 * (900 / 832), 3);
    expect(plateDrawnWidth("none", 1216, 832, 1600, 900)).toBe(0);
  });

  test("floor nearness: the median of the low middle band", () => {
    const width = 100;
    const height = 100;
    const depth = new Uint8Array(width * height).fill(255);
    // The floor band (rows 86-96) is near; one far object stands in it.
    for (let y = 86; y < 96; y += 1) depth.fill(51, y * width + 25, y * width + 75);
    depth[90 * width + 50] = 255;
    expect(plateFloorNear({ width, height, depth })).toBeCloseTo(0.8, 2);
    expect(plateFloorNear({ width: 1, height: 1, depth: new Uint8Array([0]) })).toBe(1);
  });

  test("dolly: eases out to the zoom, half of it at gentle, none at off", () => {
    expect(plateDollyZoom(0, "full")).toBe(1);
    expect(plateDollyZoom(PLATE_DOLLY_MS / 2, "full")).toBeGreaterThan(1 + (PLATE_DOLLY_ZOOM - 1) * 0.5);
    expect(plateDollyZoom(PLATE_DOLLY_MS * 2, "full")).toBeCloseTo(PLATE_DOLLY_ZOOM, 6);
    expect(plateDollyZoom(PLATE_DOLLY_MS, "gentle")).toBeCloseTo(1 + (PLATE_DOLLY_ZOOM - 1) / 2, 6);
    expect(plateDollyZoom(PLATE_DOLLY_MS, "off")).toBe(1);
  });

  test("pointer: the eye moves toward the pointer, clamped to -1..1", () => {
    const rect = { left: 100, top: 50, width: 800, height: 400 };
    expect(pointerCamera(500, 250, rect)).toEqual({ x: 0, y: 0 });
    expect(pointerCamera(900, 50, rect)).toEqual({ x: -1, y: 1 });
    expect(pointerCamera(5000, 250, rect).x).toBe(-1);
    expect(pointerCamera(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});
