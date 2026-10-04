import assert from "node:assert/strict";
import test from "node:test";

import { VN_BASE_CSS } from "./base-css";
import { VN_EFFECTS_CSS, svgDataUri } from "./effects-css";
import { VN_THEME_SELECTORS } from "./contract";

test("base stylesheet contains camera and screen effect keyframes", () => {
  assert.match(VN_BASE_CSS, /@keyframes\s+vn-shake\s*\{/);
  assert.match(VN_BASE_CSS, /@keyframes\s+vn-flash-white\s*\{/);
  assert.match(VN_BASE_CSS, /@keyframes\s+vn-flash-red\s*\{/);
  assert.match(VN_BASE_CSS, /@keyframes\s+vn-fade-to-black\s*\{/);
});

test("screen shake animation has +/- translations and 300ms duration", () => {
  assert.match(VN_BASE_CSS, /translate3d\(-4px/);
  assert.match(VN_BASE_CSS, /translate3d\(4px/);
  assert.match(VN_BASE_CSS, /vn-shake\s+300ms/);
});

test("screen flash overlay is documented selector and fullscreen styled", () => {
  assert.equal(VN_THEME_SELECTORS.flash, "[data-vn-flash]");
  assert.match(VN_BASE_CSS, /\[data-vn-flash\]\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/);
  assert.match(VN_BASE_CSS, /vn-flash-white/);
  assert.match(VN_BASE_CSS, /vn-flash-red/);
  assert.match(VN_BASE_CSS, /vn-fade-to-black/);
});

test("camera zoom-in scales scene image to 1.12 with smooth 2s ease", () => {
  assert.match(
    VN_BASE_CSS,
    /\[data-vn-scene-image\]\s*\{[\s\S]*?transition:[^;]*transform\s+2s\s+ease/,
  );
  assert.match(
    VN_BASE_CSS,
    /\[data-vn-scene-image\]\.vn-zoom-in[\s\S]*?transform:\s*scale\(1\.12\);/,
  );
});

test("scene transitions define active and incoming layers", () => {
  assert.match(VN_BASE_CSS, /\[data-vn-scene-image\]\[data-vn-layer="active"\]\s*\{[\s\S]*?z-index:\s*1;/);
  assert.match(VN_BASE_CSS, /\[data-vn-scene-image\]\[data-vn-layer="incoming"\]\s*\{[\s\S]*?z-index:\s*2;/);
});

test("prefers-reduced-motion neutralizes shake, zoom, and screen flash", () => {
  const reducedMotionIndex = VN_BASE_CSS.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.notEqual(reducedMotionIndex, -1);
  const reducedBlock = VN_BASE_CSS.slice(reducedMotionIndex);

  assert.match(reducedBlock, /vn-shake[\s\S]*?animation:\s*none\s*!important/);
  assert.match(reducedBlock, /vn-zoom-in[\s\S]*?transform:\s*none\s*!important/);
  assert.match(reducedBlock, /\[data-vn-flash\][\s\S]*?opacity:\s*0\s*!important/);
});

test("effects stylesheet uses only inline data URIs (no network assets)", () => {
  assert.doesNotMatch(VN_EFFECTS_CSS, /https?:/i);
  assert.doesNotMatch(VN_EFFECTS_CSS, /@import/i);
  for (const m of VN_EFFECTS_CSS.matchAll(/url\(([^)]*)\)/g)) {
    assert.ok(m[1]!.startsWith("data:image/svg+xml;base64,"), `unexpected url(): ${m[1]!.slice(0, 40)}`);
  }
  assert.match(svgDataUri("<rect/>", 4, 4), /^url\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)$/);
});

test("effect keyframes animate only compositor-friendly properties", () => {
  const allowed = new Set(["transform", "translate", "rotate", "scale", "opacity", "animation-timing-function"]);
  const blocks = [...VN_EFFECTS_CSS.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?)\n\}/g)];
  assert.ok(blocks.length > 30);
  for (const [, name, body] of blocks) {
    const props = new Set([...body!.replace(/\([^()]*\)/g, "").matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!));
    for (const prop of props) {
      if (prop === "filter" && name === "vn-blur-pulse") continue;
      assert.ok(allowed.has(prop), `${name} animates ${prop}`);
    }
  }
});

test("effect overlays never take pointer events and bursts sit below the dialogue", () => {
  assert.match(VN_EFFECTS_CSS, /\[data-vn-fx\] \{[^}]*pointer-events: none;[^}]*\}/);
  assert.match(VN_EFFECTS_CSS, /\[data-vn-ambient\] \{[^}]*pointer-events: none;[^}]*\}/);
  assert.match(VN_EFFECTS_CSS, /\[data-vn-fx\] \{[^}]*z-index: 2;/);
  assert.match(VN_EFFECTS_CSS, /container-type: size;/);
});

test("every ambient and burst has styling, and grades target the scene, not the dialogue", () => {
  for (const id of ["vignette_dark", "sepia_flashback", "desaturate", "dream_haze", "danger_pulse"]) {
    assert.match(VN_EFFECTS_CSS, new RegExp(`\\[data-vn-ambient\\]\\.vn-ambient-${id}`));
  }
  for (const cls of ["vn-rain-layer", "vn-splash", "vn-drop", "vn-flake--crystal", "vn-petal", "vn-firefly", "vn-ember", "vn-fog-layer-3", "vn-sparkle", "vn-heart", "vn-confetti-piece", "vn-speed-lines", "vn-bolt"]) {
    assert.ok(VN_EFFECTS_CSS.includes(`.${cls}`), `missing .${cls}`);
  }
  assert.doesNotMatch(VN_EFFECTS_CSS, /\[data-vn-dialogue\]/);
  assert.doesNotMatch(VN_EFFECTS_CSS, /\[data-vn-narrative\]/);
});

test("gentle intensity thins particles and reduced motion freezes them", () => {
  assert.match(VN_EFFECTS_CSS, /\[data-vn-effect-intensity="gentle"\] \[data-vn-ambient\] \.vn-pt:nth-child\(2n\)/);
  const reduced = VN_EFFECTS_CSS.slice(VN_EFFECTS_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\[data-vn-ambient\] \*,[\s\S]*?animation: none !important;/);
  assert.match(reduced, /\[data-vn-fx\] \*/);
  assert.match(reduced, /\[data-vn-fx\] \.vn-bolt[\s\S]*?display: none !important;/);
  assert.match(reduced, /vn-ambient-danger_pulse::before[\s\S]*?animation: none !important;/);
});
