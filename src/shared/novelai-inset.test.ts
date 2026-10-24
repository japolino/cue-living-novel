import { describe, expect, test } from "bun:test";
import {
  NOVELAI_INSET_BLOCK,
  NOVELAI_INSET_LAYOUTS,
  fitContain,
  insetLayoutProblems,
  insetMaskValue,
  normalizePixelRect,
  novelAiInsetLayout,
} from "./novelai-inset.js";

describe("NovelAI V5 inset geometry", () => {
  test("the sprite layout is the author's: 1216×832, reference left half, right half repainted", () => {
    const layout = NOVELAI_INSET_LAYOUTS.sprite;
    expect(layout.canvas).toEqual({ width: 1216, height: 832 });
    expect(layout.reference).toEqual({ x: 0, y: 0, width: 608, height: 832 });
    expect(layout.repaint).toEqual({ x: 608, y: 0, width: 608, height: 832 });
    // Free on Opus: area at most 1024².
    expect(layout.canvas.width * layout.canvas.height).toBeLessThanOrEqual(1024 * 1024);
    expect(insetLayoutProblems(layout)).toEqual([]);
    expect(novelAiInsetLayout("sprite")).toBe(layout);
    expect(novelAiInsetLayout("scene")).toBeNull();
    expect(novelAiInsetLayout("__proto__")).toBeNull();
  });

  test("mask edges must sit on 8-px blocks; canvas sides on 64", () => {
    const layout = NOVELAI_INSET_LAYOUTS.sprite;
    for (const edge of [layout.repaint.x, layout.repaint.x + layout.repaint.width, layout.repaint.y + layout.repaint.height]) expect(edge % NOVELAI_INSET_BLOCK).toBe(0);
    expect(insetLayoutProblems({ ...layout, repaint: { x: 604, y: 0, width: 612, height: 832 }, reference: { x: 0, y: 0, width: 604, height: 832 } })).toEqual(["mask edges are not on 8-px blocks"]);
    expect(insetLayoutProblems({ ...layout, canvas: { width: 1200, height: 832 } })).toContain("canvas sides are not multiples of 64");
    expect(insetLayoutProblems({ ...layout, reference: { x: 0, y: 0, width: 616, height: 832 } })).toContain("reference and repaint boxes overlap");
    expect(insetLayoutProblems({ ...layout, repaint: { x: 608, y: 0, width: 616, height: 832 } })).toContain("repaint box outside the canvas");
  });

  test("a hypothetical scene layout (1472×704, 448-px strip, 1024×704 repaint) passes the same checks", () => {
    // Untested with NovelAI (see the scene-mode design); only the geometry rules are checked here.
    const scene = { canvas: { width: 1472, height: 704 }, reference: { x: 0, y: 0, width: 448, height: 704 }, repaint: { x: 448, y: 0, width: 1024, height: 704 } };
    expect(insetLayoutProblems(scene)).toEqual([]);
    expect(scene.canvas.width * scene.canvas.height).toBeLessThanOrEqual(1024 * 1024);
  });

  test("the reference is contained and centred: a portrait idle in the left half", () => {
    const box = NOVELAI_INSET_LAYOUTS.sprite.reference;
    // NovelAI sprite idles are 832×1216.
    expect(fitContain({ width: 832, height: 1216 }, box)).toEqual({ x: 19, y: 0, width: 569, height: 832 });
    // A ComfyUI standard sprite (624×912) is scaled up to the same box.
    expect(fitContain({ width: 624, height: 912 }, box)).toEqual({ x: 19, y: 0, width: 569, height: 832 });
    // A wide image fills the width and is centred vertically.
    expect(fitContain({ width: 1216, height: 832 }, box)).toEqual({ x: 0, y: 208, width: 608, height: 416 });
    // An offset box keeps its offset.
    expect(fitContain({ width: 100, height: 100 }, { x: 40, y: 8, width: 200, height: 100 })).toEqual({ x: 90, y: 8, width: 100, height: 100 });
  });

  test("mask: black (keep) left of x = 608, white (repaint) from 608", () => {
    const layout = NOVELAI_INSET_LAYOUTS.sprite;
    expect(insetMaskValue(layout, 0, 0)).toBe(0);
    expect(insetMaskValue(layout, 607, 831)).toBe(0);
    expect(insetMaskValue(layout, 608, 0)).toBe(255);
    expect(insetMaskValue(layout, 1215, 831)).toBe(255);
    expect(insetMaskValue(layout, 1216, 0)).toBe(0);
  });

  test("crop rectangles from untrusted input", () => {
    expect(normalizePixelRect({ x: 608, y: 0, width: 608, height: 832 })).toEqual({ x: 608, y: 0, width: 608, height: 832 });
    expect(normalizePixelRect({ x: 1.5, y: 0, width: 608, height: 832 })).toBeNull();
    expect(normalizePixelRect({ x: -1, y: 0, width: 608, height: 832 })).toBeNull();
    expect(normalizePixelRect({ x: 0, y: 0, width: 0, height: 832 })).toBeNull();
    expect(normalizePixelRect({ x: 16000, y: 0, width: 608, height: 832 })).toBeNull();
    expect(normalizePixelRect([608, 0, 608, 832])).toBeNull();
    expect(normalizePixelRect(null)).toBeNull();
  });
});
