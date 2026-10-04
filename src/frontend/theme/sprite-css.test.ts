import { describe, expect, test } from "bun:test";
import { VN_SPRITE_CSS } from "./sprite-css";
import { VN_BASE_CSS } from "./base-css";
import { SPRITE_EMOTES, SPRITE_LIGHTS, SPRITE_MOTIONS } from "../../shared/sprites";

describe("VN_SPRITE_CSS", () => {
  test("is part of the base stylesheet", () => {
    expect(VN_BASE_CSS).toContain(VN_SPRITE_CSS);
  });
  test("styles every motion, emote and light", () => {
    for (const motion of SPRITE_MOTIONS) if (motion !== "none") expect(VN_SPRITE_CSS).toContain(`[data-vn-sprite-motion="${motion}"]`);
    for (const emote of SPRITE_EMOTES) if (emote !== "none" && emote !== "blush") expect(VN_SPRITE_CSS).toContain(`[data-vn-sprite-emote-name="${emote}"]`);
    for (const light of SPRITE_LIGHTS) if (light !== "neutral") expect(VN_SPRITE_CSS).toContain(`[data-vn-sprite-light="${light}"]`);
  });
  test("every referenced keyframe exists and every keyframe is used", () => {
    const defined = new Set([...VN_SPRITE_CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!));
    const used = new Set([...VN_SPRITE_CSS.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]!).filter((name) => name !== "none"));
    for (const name of used) expect(defined.has(name)).toBe(true);
    for (const name of defined) expect(used.has(name)).toBe(true);
  });
  test("respects reduced motion and effect intensity", () => {
    expect(VN_SPRITE_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(VN_SPRITE_CSS).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(VN_SPRITE_CSS).toContain('[data-vn-effect-intensity="off"]');
    expect(VN_SPRITE_CSS).toContain('[data-vn-effect-intensity="gentle"]');
  });
  test("uses no network assets and keeps braces balanced", () => {
    expect(VN_SPRITE_CSS).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
    expect(VN_SPRITE_CSS).not.toContain("@import");
    expect(VN_SPRITE_CSS.split("{").length).toBe(VN_SPRITE_CSS.split("}").length);
  });
  test("every rule is scoped to the sprite layer or its children", () => {
    const selectors = [...VN_SPRITE_CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[\s\S]*?\n}\n/g, "").matchAll(/(^|})\s*([^{}@]+)\{/g)].map((m) => m[2]!.trim());
    for (const selector of selectors) {
      if (/^(from|to|\d+%)/.test(selector) || selector === "") continue;
      for (const part of selector.split(",")) expect(part).toMatch(/\[data-vn-sprite/);
    }
  });
});
