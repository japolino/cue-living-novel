import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  normalizeConfig,
  SCENE_IMAGE_FITS,
  THEME_PRESET_IDS,
} from "./config";

test("configuration normalizes unsafe ranges and unknown modes", () => {
  const config = normalizeConfig({
    mode: "unknown",
    maxImagesPerTurn: 500,
    imageConcurrency: 0,
    parserConnectionId: "  planner-id  ",
    imageConnectionId: "   ",
    customCss: 42
  });
  assert.equal(config.mode, "standard");
  assert.equal(config.maxImagesPerTurn, 12);
  assert.equal(config.imageConcurrency, 1);
  assert.equal(config.parserConnectionId, "planner-id");
  assert.equal(config.imageConnectionId, null);
  assert.equal(config.customCss, DEFAULT_CONFIG.customCss);
});

test("configuration preserves the CYOA and custom CSS controls", () => {
  const config = normalizeConfig({ mode: "cyoa", customCss: "[data-vn-dialogue] { color: pink; }" });
  assert.equal(config.mode, "cyoa");
  assert.match(config.customCss, /color: pink/);
});

test("scene image fit defaults to cover for absent or invalid values", () => {
  assert.equal(DEFAULT_CONFIG.sceneImageFit, "cover");
  assert.equal(normalizeConfig({}).sceneImageFit, "cover");
  assert.equal(normalizeConfig({ sceneImageFit: "zoom" }).sceneImageFit, "cover");
  assert.equal(normalizeConfig({ sceneImageFit: 42 }).sceneImageFit, "cover");
  assert.equal(normalizeConfig({ sceneImageFit: null }).sceneImageFit, "cover");
});

test("scene image fit preserves every supported mode and rejects unknown ones", () => {
  for (const fit of SCENE_IMAGE_FITS) {
    assert.equal(normalizeConfig({ sceneImageFit: fit }).sceneImageFit, fit);
  }
  assert.equal(normalizeConfig({ sceneImageFit: "original" }).sceneImageFit, "cover");
});


test("the host-neutral preset id list is exactly the five supported presets", () => {
  assert.deepEqual(
    [...THEME_PRESET_IDS],
    ["lumiverse", "golden-hour", "boxed-console", "paper-novel", "midnight-noir"],
  );
  assert.equal(DEFAULT_CONFIG.themePreset, "lumiverse");
});

test("theme preset set/read roundtrips every supported id", () => {
  for (const themePreset of THEME_PRESET_IDS) {
    assert.equal(normalizeConfig({ themePreset }).themePreset, themePreset);
  }
});

test("theme preset falls back to lumiverse for unknown or removed ids", () => {
  assert.equal(normalizeConfig({ themePreset: "retro-crt" }).themePreset, "lumiverse");
  assert.equal(normalizeConfig({ themePreset: "unknown" }).themePreset, "lumiverse");
  assert.equal(normalizeConfig({ themePreset: 42 }).themePreset, "lumiverse");
  assert.equal(normalizeConfig({}).themePreset, "lumiverse");
});

test("shared config never imports frontend theme code (host-neutral boundary)", () => {
  const source = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /frontend\/theme/);
  assert.doesNotMatch(source, /\.\.\/(frontend|stage|settings|host)\//);
});
