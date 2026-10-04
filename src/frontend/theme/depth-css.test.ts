import { describe, expect, test } from "bun:test";
import { VN_EFFECTS_CSS } from "./effects-css";
import { VN_SPRITE_CSS } from "./sprite-css";
import { SPRITE_DEPTH } from "../stage/sprite-depth";
import { SPRITE_LIGHTS } from "../../shared/sprites";

/** The sprite-mode depth section of the effects stylesheet. */
const start = VN_EFFECTS_CSS.lastIndexOf("/*", VN_EFFECTS_CSS.indexOf("SPRITE MODE DEPTH ("));
const end = VN_EFFECTS_CSS.lastIndexOf("/*", VN_EFFECTS_CSS.indexOf("EFFECT INTENSITY:"));
const DEPTH = VN_EFFECTS_CSS.slice(start, end);
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const selectors = (css: string) => [...stripComments(css).replace(/@keyframes[\s\S]*?\n}\n/g, "").matchAll(/(^|[{};])\s*([^{}@;]+)\{/g)]
  .map((m) => m[2]!.trim())
  .filter((s) => s && !/^(from|to|\d+%)/.test(s));

describe("sprite mode depth CSS", () => {
  test("lives in the effects stylesheet before the intensity overrides", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  test("every depth rule is scoped to sprite mode or a sprite-mode-only layer", () => {
    const list = selectors(DEPTH);
    expect(list.length).toBeGreaterThan(20);
    for (const selector of list) {
      for (const part of selector.split(",")) {
        expect(part).toMatch(/\[data-vn-presentation="sprites"\]|\[data-vn-ambient-front\]|\[data-vn-plate-light\]|\[data-vn-lightning\]/);
      }
    }
  });

  test("depth factors match SPRITE_DEPTH", () => {
    expect(DEPTH).toContain(`--vn-depth-sprites: ${Math.round((SPRITE_DEPTH.sprites - 1) * 100) / 100};`);
    expect(DEPTH).toContain(`--vn-depth-front: ${Math.round((SPRITE_DEPTH.front - 1) * 100) / 100};`);
  });

  test("every camera effect has a depth animation for sprites and the front layer", () => {
    for (const [attr, name] of [['[data-vn-zoom="out"]', "vn-depth-zoom-pull"], ['[data-vn-zoom="punch"]', "vn-depth-zoom-punch"], ['[data-vn-tilt="true"]', "vn-depth-tilt"], ["[data-vn-heartbeat]", "vn-depth-heartbeat"], ['[data-vn-shake="true"]', "vn-depth-shake"], ['[data-vn-shake="hard"]', "vn-depth-shake-hard"], ['[data-vn-shake="rumble"]', "vn-depth-rumble"]]) {
      expect(DEPTH).toContain(`[data-vn-scene]${attr} [data-vn-sprites]`);
      expect(DEPTH).toContain(`[data-vn-scene]${attr} [data-vn-ambient-front]`);
      expect(DEPTH).toContain(`animation: ${name} `);
      expect(DEPTH).toMatch(new RegExp(`@keyframes ${name} \\{`));
    }
    expect(DEPTH).toContain('[data-vn-scene][data-vn-zoom="in"] [data-vn-sprites]');
  });

  test("the plate drift survives plate camera moves (listed first) and stops when it should", () => {
    for (const name of ["vn-zoom-pull", "vn-zoom-punch", "vn-tilt", "vn-blur-pulse"]) {
      expect(DEPTH).toMatch(new RegExp(`animation: var\\(--vn-plate-drift\\), ${name} `));
    }
    expect(DEPTH).toContain('[data-vn-effect-intensity="off"] [data-vn-scene-image]');
    expect(DEPTH).toContain("[data-vn-sprite-illustrated]");
    const reduced = DEPTH.slice(DEPTH.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("--vn-plate-drift: none;");
    expect(reduced).toMatch(/\[data-vn-ambient\]\[data-vn-ambient-front\],\s*\[data-vn-plate-light\] \{\s*display: none !important;/);
    expect(reduced).toContain("animation: none !important;");
  });

  test("layers never take pointer events and sit inside the scene, under the dialogue", () => {
    expect(DEPTH).toMatch(/\[data-vn-plate-light\] \{[^}]*pointer-events: none;/);
    expect(DEPTH).toMatch(/\[data-vn-ambient\]\[data-vn-ambient-front\] \{[^}]*z-index: 5;/);
    expect(DEPTH).not.toMatch(/\[data-vn-(dialogue|narrative|controls)\]/);
    // The front layer is also an ambient overlay, so it inherits pointer-events: none.
    expect(VN_EFFECTS_CSS).toMatch(/\[data-vn-ambient\] \{[^}]*pointer-events: none;/);
  });

  test("grades are raised over the sprites only in sprite mode", () => {
    for (const grade of ["vignette_dark", "sepia_flashback", "desaturate", "dream_haze", "danger_pulse"]) {
      expect(DEPTH).toContain(`[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-scene-ambient="${grade}"] > [data-vn-ambient]:not([data-vn-ambient-front])`);
      expect(VN_SPRITE_CSS).toContain(`[data-vn-scene][data-vn-scene-ambient="${grade}"] [data-vn-sprites] { --vn-sprite-air-filter:`);
    }
  });
});

describe("sprite grounding and rim light", () => {
  test("contact shadow and occlusion bands ride on the anchor", () => {
    expect(VN_SPRITE_CSS).toMatch(/\[data-vn-sprite\]::before \{[^}]*z-index: -1;/);
    expect(VN_SPRITE_CSS).toMatch(/\[data-vn-sprite\]::after \{[^}]*z-index: 1;/);
  });
  test("rim light: cut-out minus shifted cut-out, coloured per light, flipped for mirrored figures", () => {
    expect(VN_SPRITE_CSS).toContain("mask-composite: subtract;");
    expect(VN_SPRITE_CSS).toContain("-webkit-mask-composite: source-out;");
    expect(VN_SPRITE_CSS).toContain('[data-vn-sprite][data-vn-sprite-mirrored="true"] { --vn-sprite-rim-flip: -1; }');
    for (const side of ["left", "right", "top"]) expect(VN_SPRITE_CSS).toContain(`[data-vn-scene][data-vn-light-side="${side}"] [data-vn-sprites]`);
    for (const light of SPRITE_LIGHTS) {
      if (light === "neutral") continue;
      const block = VN_SPRITE_CSS.slice(VN_SPRITE_CSS.indexOf(`[data-vn-sprites][data-vn-sprite-light="${light}"] {`));
      expect(block.slice(0, block.indexOf("}"))).toMatch(/--vn-sprite-rim: #[0-9a-f]{6};\s*--vn-sprite-rim-o: [\d.]+;/);
    }
  });
  test("lightning silhouettes are motion-only (reduced motion keeps them off)", () => {
    const motion = VN_SPRITE_CSS.slice(VN_SPRITE_CSS.indexOf("@media (prefers-reduced-motion: no-preference)"), VN_SPRITE_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(motion).toContain("[data-vn-scene][data-vn-lightning] [data-vn-sprite-image] img");
    expect(motion).toContain("animation: vn-sprite-lightning-shade 550ms");
  });
  test("narrow portrait trio: speaker whole and in front, others smaller", () => {
    const portrait = VN_SPRITE_CSS.slice(VN_SPRITE_CSS.indexOf("@media (orientation: portrait)"));
    expect(portrait).toContain("left: var(--vn-sprite-xn, var(--vn-sprite-x, 50%));");
    expect(portrait).toMatch(/\[data-vn-sprite-dim="true"\] \{\s*scale: 0\.8;/);
    expect(portrait).toMatch(/\[data-vn-sprite-focus="true"\] \{\s*left: clamp\(/);
  });
});
