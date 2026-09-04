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


test("the host-neutral preset id list is exactly the seven supported presets", () => {
  assert.deepEqual(
    [...THEME_PRESET_IDS],
    ["lumiverse", "golden-hour", "boxed-console", "paper-novel", "midnight-noir", "yamaku-classic", "literature-club"],
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
test("configuration preserves ignoredTags, displayRegexRules, and useNativeCardImages", () => {
  const config = normalizeConfig({
    ignoredTags: "status, stats, system",
    displayRegexRules: "/§([^§]+)§/g => $1",
    useNativeCardImages: true,
  });
  assert.equal(config.ignoredTags, "status, stats, system");
  assert.equal(config.displayRegexRules, "/§([^§]+)§/g => $1");
  assert.equal(config.useNativeCardImages, true);
});

test("configuration defaults ignoredTags, displayRegexRules, and useNativeCardImages", () => {
  const config = normalizeConfig({});
  assert.equal(config.ignoredTags, "");
  assert.equal(config.displayRegexRules, "");
  assert.equal(config.useNativeCardImages, false);
});

test("configuration preserves textSpeed, autoPlayDelay, and skipMode", () => {
  const config = normalizeConfig({
    textSpeed: 35,
    autoPlayDelay: 3500,
    skipMode: "all",
  });
  assert.equal(config.textSpeed, 35);
  assert.equal(config.autoPlayDelay, 3500);
  assert.equal(config.skipMode, "all");
});

test("configuration defaults textSpeed, autoPlayDelay, and skipMode", () => {
  const config = normalizeConfig({});
  assert.equal(config.textSpeed, 20);
  assert.equal(config.autoPlayDelay, 2000);
  assert.equal(config.skipMode, "read");
});

test("configuration preserves audioDirectory, bgmVolume, and sfxVolume", () => {
  const config = normalizeConfig({
    audioDirectory: "/path/to/audio",
    bgmVolume: 0.5,
    sfxVolume: 0.9,
  });
  assert.equal(config.audioDirectory, "/path/to/audio");
  assert.equal(config.bgmVolume, 0.5);
  assert.equal(config.sfxVolume, 0.9);
});

test("configuration defaults audioDirectory, bgmVolume, and sfxVolume", () => {
  const config = normalizeConfig({});
  assert.equal(config.audioDirectory, "");
  assert.equal(config.bgmVolume, 0.7);
  assert.equal(config.sfxVolume, 0.8);
});

test("configuration clamps bgmVolume and sfxVolume to [0, 1]", () => {
  const low = normalizeConfig({
    bgmVolume: -0.5,
    sfxVolume: -10,
  });
  assert.equal(low.bgmVolume, 0);
  assert.equal(low.sfxVolume, 0);

  const high = normalizeConfig({
    bgmVolume: 1.5,
    sfxVolume: 999,
  });
  assert.equal(high.bgmVolume, 1);
  assert.equal(high.sfxVolume, 1);

  const invalid = normalizeConfig({
    bgmVolume: "not-a-number",
    sfxVolume: null,
  });
  assert.equal(invalid.bgmVolume, 0.7);
  assert.equal(invalid.sfxVolume, 0.8);
});

test("prompt presets normalize to safe named entries", () => {
  const config = normalizeConfig({
    promptPresets: [
      { id: "a", name: "Soft anime", positive: "soft shading", negative: "harsh light" },
      { id: "a", name: "Duplicate id" },
      { id: "", name: "No id" },
      { id: "b", name: "  " },
      { id: "c", name: "Minimal" },
      "garbage",
      null
    ]
  });
  assert.deepEqual(config.promptPresets, [
    { id: "a", name: "Soft anime", positive: "soft shading", negative: "harsh light" },
    { id: "c", name: "Minimal", positive: "", negative: "" }
  ]);
});

test("prompt presets default to an empty list", () => {
  assert.deepEqual(DEFAULT_CONFIG.promptPresets, []);
  assert.deepEqual(normalizeConfig({}).promptPresets, []);
  assert.deepEqual(normalizeConfig({ promptPresets: "nope" }).promptPresets, []);
});
