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


test("chrome tokens are declared on the root so presets re-derive them", () => {
  const rootRule = VN_BASE_CSS.match(/\n\[data-vn-root\] \{[\s\S]*?\n\}/)?.[0] ?? "";
  for (const token of [
    "--vn-accent-contrast",
    "--vn-focus-ring",
    "--vn-chrome-bg",
    "--vn-chrome-border",
    "--vn-chrome-text",
    "--vn-panel-bg",
    "--vn-panel-solid",
    "--vn-overlay-text",
    "--vn-overlay-muted",
    "--vn-interaction-clearance",
  ]) {
    assert.match(rootRule, new RegExp(`${token}\\s*:`), `${token} lives on [data-vn-root]`);
  }
});

test("entrance animations never pin transform, so hover and press feedback still moves", () => {
  assert.doesNotMatch(VN_BASE_CSS, /animation:\s*vn-enter[^;]*\bboth\b/);
  assert.doesNotMatch(VN_BASE_CSS, /animation:\s*vn-badge-enter[^;]*\bboth\b/);
  assert.match(VN_BASE_CSS, /animation:\s*vn-enter[^;]*backwards/);
});

test("the continue bob only runs when motion is allowed", () => {
  const noPreference = VN_BASE_CSS.indexOf("@media (prefers-reduced-motion: no-preference)");
  const bob = VN_BASE_CSS.indexOf("animation: vn-continue-bob");
  assert.ok(noPreference >= 0 && bob > noPreference, "vn-continue-bob is applied inside the no-preference block");
  assert.equal(VN_BASE_CSS.split("animation: vn-continue-bob").length - 1, 1);
});

test("the reply area keeps clear of the dialogue box", () => {
  assert.match(VN_BASE_CSS, /\[data-vn-interaction\] \{[\s\S]*?calc\(var\(--vn-interaction-clearance\)/);
});

test("every interactive chrome control has a visible focus ring", () => {
  for (const selector of ["[data-vn-control]", "[data-vn-choice]", "[data-vn-game-choice]", "[data-vn-backlog-close]", "[data-vn-continue]", "[data-vn-submit]"]) {
    const escaped = selector.replaceAll("[", "\\[").replaceAll("]", "\\]");
    assert.match(VN_BASE_CSS, new RegExp(`${escaped}:focus-visible[^{]*\\{[^}]*outline:\\s*(?:2|3)px solid`), `${selector} has an outline focus ring`);
  }
});
