import assert from "node:assert/strict";
import test from "node:test";

import { VN_BASE_CSS } from "./base-css";
import {
  VN_THEME_CUSTOM_PROPERTIES,
  VN_THEME_SELECTORS,
} from "./contract";
import { sanitizeVnUserCss } from "./user-css";

test("the documented theme selectors remain in the base stylesheet", () => {
  for (const selector of Object.values(VN_THEME_SELECTORS)) {
    assert.match(VN_BASE_CSS, new RegExp(selector.replaceAll("[", "\\[").replaceAll("]", "\\]")));
  }
});

test("the documented custom properties have base values", () => {
  for (const property of VN_THEME_CUSTOM_PROPERTIES) {
    assert.match(VN_BASE_CSS, new RegExp(`${property}\\s*:`));
  }
});

test("scene image fit stays centered and defaults to a backward-compatible cover", () => {
  assert.match(
    VN_BASE_CSS,
    /\[data-vn-scene-image\]\s*\{[\s\S]*?object-fit:\s*cover;[\s\S]*?object-position:\s*center center;/,
  );

  for (const fit of ["contain", "fill", "none", "scale-down"]) {
    assert.match(
      VN_BASE_CSS,
      new RegExp(`\\[data-vn-scene-image\\]\\[data-vn-scene-image-fit="${fit}"\\]\\s*\\{[^}]*object-fit:\\s*${fit};`),
    );
  }
});

test("custom CSS removes remote imports and URL fetches", () => {
  const result = sanitizeVnUserCss(`@im/**/port "https://example.com/theme.css";\n[data-vn-root] { background: u\\72l(https://example.com/pixel); color: white; }`);
  assert.doesNotMatch(result, /@import|example\.com/);
  assert.match(result, /color: white/);
});

test("the readability scrim is contained under the dialogue box so it never paints over text", () => {
  // data-vn-scene must establish its own stacking context so the scrim's
  // z-index (3) is bounded inside the scene layer, keeping the dialogue
  // (z-index 2) above it in every theme.
  assert.match(
    VN_BASE_CSS,
    /\[data-vn-scene\]\s*\{[\s\S]*?isolation:\s*isolate;/,
  );
});

