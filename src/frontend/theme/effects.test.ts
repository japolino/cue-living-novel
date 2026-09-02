import assert from "node:assert/strict";
import test from "node:test";

import { VN_BASE_CSS } from "./base-css";
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
