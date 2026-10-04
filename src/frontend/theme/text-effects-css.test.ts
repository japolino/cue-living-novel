import { describe, expect, test } from "bun:test";
import { TEXT_EFFECT_IDS } from "../../shared/text-effects";
import { VN_BASE_CSS } from "./base-css";
import { VN_TEXT_EFFECTS_CSS } from "./text-effects-css";

const css = VN_TEXT_EFFECTS_CSS;

describe("VN_TEXT_EFFECTS_CSS", () => {
  test("styles every catalogue effect", () => {
    for (const id of TEXT_EFFECT_IDS) expect(css).toContain(`[data-vn-text-fx="${id}"]`);
  });

  test("is part of the base stylesheet", () => {
    expect(VN_BASE_CSS).toContain(css);
  });

  test("does not depend on the stage root, so other shadow roots can reuse it", () => {
    expect(css).not.toContain("[data-vn-root]");
    expect(css).not.toContain(":host");
  });

  test("uses no network assets", () => {
    expect(css).not.toMatch(/url\(/i);
    expect(css).not.toMatch(/@import/i);
    expect(css).not.toMatch(/https?:/i);
  });

  test("handles the three modes and reduced motion", () => {
    for (const mode of ["animated", "static", "off"]) expect(css).toContain(`[data-vn-text-effects="${mode}"]`);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("--vn-tfx-gate-motion: none");
    expect(reduced).toContain("--vn-tfx-play: paused");
  });

  test("every referenced keyframe exists and every keyframe is used", () => {
    const defined = new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!));
    const referenced = new Set([...css.matchAll(/var\(--vn-tfx-gate-(?:motion|color),\s*([\w-]+)\)/g)].map((m) => m[1]!));
    expect(referenced.size).toBeGreaterThan(0);
    for (const name of referenced) expect(defined.has(name)).toBe(true);
    for (const name of defined) expect(referenced.has(name)).toBe(true);
  });

  test("motion is only transform, opacity or filter (no layout properties in keyframes)", () => {
    const blocks = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]!);
    expect(blocks.length).toBeGreaterThan(5);
    for (const block of blocks) {
      const props = [...block.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!);
      for (const prop of props) {
        expect(["translate", "rotate", "scale", "transform", "opacity", "filter", "color", "animation-timing-function"]).toContain(prop);
      }
    }
  });

  test("braces are balanced", () => {
    expect((css.match(/\{/g) ?? []).length).toBe((css.match(/\}/g) ?? []).length);
  });
});
