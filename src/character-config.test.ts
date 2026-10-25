import { describe, expect, test } from "bun:test";
import {
  CHARACTER_SCOPED_KEYS,
  DEFAULT_CONFIG,
  characterOverrideWith,
  characterOverrideWithout,
  effectiveConfig,
  isCharacterScopedKey,
  normalizeCharacterOverride,
  normalizeConfig,
  unscopedKeys,
} from "./config.js";
import { characterConfigTarget, characterResetKeys } from "./protocol.js";

/** Settings saved per character: the key list and the merge rules. */

describe("per-character key list", () => {
  test("every key is a real setting, listed once", () => {
    expect(new Set(CHARACTER_SCOPED_KEYS).size).toBe(CHARACTER_SCOPED_KEYS.length);
    for (const key of CHARACTER_SCOPED_KEYS) expect(Object.keys(DEFAULT_CONFIG)).toContain(key);
  });

  test("the look and reading settings are per character", () => {
    for (const key of [
      "themePreset", "presentationMode", "keyIllustrations", "sceneImageFit", "textScale", "effectIntensity", "customCss",
      "textSpeed", "autoPlayDelay", "generateChoices", "replyBoxAtEnd", "openingCard", "openingCardMinMs", "cardBackground",
      "locationLabel", "playOnArrival", "waitingBackdrop", "waitingRecap", "displayRegexRules",
      "spriteMotion", "spriteBreathing", "spriteSway", "spriteHeadMotion", "spriteActing", "spritePhysics", "spriteOutline",
      "spriteFocusBlur", "spriteTransitions", "spriteAtmosphere",
      "clickEffect", "spritePressBounce", "interfaceSounds", "interfaceSoundVolume", "innerVoices",
    ]) expect(isCharacterScopedKey(key)).toBe(true);
  });

  test("connections, models, image generation, storage, voices and anything secret stay shared", () => {
    for (const key of [
      "enabled", "autoEnter", "debugLogging", "parserConnectionId", "imageConnectionId", "imageModel", "imageParameters",
      "parserParameters", "generateImages", "useNativeCardImages", "maxImagesPerTurn", "imageConcurrency",
      "referenceAnchoring", "referenceSource", "promptPrefix", "promptSuffix", "negativePrompt", "promptPresets",
      "systemOneMode", "systemOneApiUrl", "systemOneModel", "audioDirectory", "bgmVolume", "sfxVolume", "speech",
      "spriteCutout", "spriteModelUrl", "spriteStudioModelUrl", "spriteImageSize", "spriteExpressionCount",
      "includeRecentMessages", "includeCharacterContext", "includePersonaContext", "includeLorebookContext",
      "customPlannerInstructions", "ignoredTags", "skipNonStory",
    ]) expect(isCharacterScopedKey(key)).toBe(false);
    for (const key of CHARACTER_SCOPED_KEYS) expect(key).not.toMatch(/apikey|secret|token|url|connection|model|storage|directory|[a-z]Key$/i);
  });

  test("unscopedKeys names what one character cannot have", () => {
    expect(unscopedKeys({ themePreset: "midnight-noir", imageConnectionId: "x", textSpeed: 10, speech: {} })).toEqual(["imageConnectionId", "speech"]);
    expect(unscopedKeys({ themePreset: "midnight-noir" })).toEqual([]);
  });
});

describe("merge rules", () => {
  const shared = normalizeConfig({ themePreset: "golden-hour", textSpeed: 30, presentationMode: "scene" });

  test("no own values: the shared config itself, so old saves read exactly as before", () => {
    expect(effectiveConfig(shared, undefined)).toBe(shared);
    expect(effectiveConfig(shared, {})).toBe(shared);
    expect(effectiveConfig(shared, { imageConnectionId: "other" })).toBe(shared);
  });

  test("own values sit on top of the shared ones; everything else is shared", () => {
    const config = effectiveConfig(shared, { themePreset: "midnight-noir", presentationMode: "sprites" });
    expect(config.themePreset).toBe("midnight-noir");
    expect(config.presentationMode).toBe("sprites");
    expect(config.textSpeed).toBe(30);
    expect(config).toEqual(normalizeConfig({ ...shared, themePreset: "midnight-noir", presentationMode: "sprites" }));
  });

  test("an override that sneaks in a shared key does not change it", () => {
    const config = effectiveConfig(shared, { themePreset: "midnight-noir", parserConnectionId: "sneaky", debugLogging: true });
    expect(config.parserConnectionId).toBe(shared.parserConnectionId);
    expect(config.debugLogging).toBe(shared.debugLogging);
  });

  test("stored overrides keep only valid per-character values", () => {
    expect(normalizeCharacterOverride({ themePreset: "midnight-noir", imageModel: "x", textSpeed: 500, bogus: 1 })).toEqual({ themePreset: "midnight-noir", textSpeed: 100 });
    // A retired or unknown value follows the shared setting again instead of jumping to the default.
    expect(normalizeCharacterOverride({ themePreset: "retired-theme" })).toEqual({});
    expect(normalizeCharacterOverride({ textSpeed: "fast" })).toEqual({});
    // The default itself is a valid own value (shared may differ).
    expect(normalizeCharacterOverride({ themePreset: "lumiverse" })).toEqual({ themePreset: "lumiverse" });
    expect(normalizeCharacterOverride(null)).toEqual({});
    expect(normalizeCharacterOverride([1, 2])).toEqual({});
  });

  test("a character save keeps only what differs from the shared settings", () => {
    const own = characterOverrideWith(shared, {}, { themePreset: "midnight-noir", textSpeed: 30 });
    expect(own).toEqual({ themePreset: "midnight-noir" });
    // Setting it back to the shared value drops it; other own values stay.
    const more = characterOverrideWith(shared, own, { presentationMode: "sprites" });
    expect(more).toEqual({ themePreset: "midnight-noir", presentationMode: "sprites" });
    expect(characterOverrideWith(shared, more, { themePreset: "golden-hour" })).toEqual({ presentationMode: "sprites" });
    // Shared keys in the patch are ignored (the backend refuses such a save first).
    expect(characterOverrideWith(shared, {}, { imageConnectionId: "x", textScale: 1.3 })).toEqual({ textScale: 1.3 });
    // Values are normalized like the shared config.
    expect(characterOverrideWith(shared, {}, { textSpeed: 999 })).toEqual({ textSpeed: 100 });
  });

  test("going back to shared: one setting, or all of them", () => {
    const own = { themePreset: "midnight-noir", presentationMode: "sprites", textScale: 1.3 } as const;
    expect(characterOverrideWithout(own, ["themePreset"])).toEqual({ presentationMode: "sprites", textScale: 1.3 });
    expect(characterOverrideWithout(own, ["themePreset", "presentationMode", "textScale"])).toEqual({});
    expect(characterOverrideWithout(own)).toEqual({});
  });
});

describe("protocol: per-character requests", () => {
  test("a save target names a usable character id", () => {
    expect(characterConfigTarget({ characterId: "card-1" })).toEqual({ characterId: "card-1" });
    expect(characterConfigTarget({ characterId: "" })).toBeNull();
    expect(characterConfigTarget({ characterId: "   " })).toBeNull();
    expect(characterConfigTarget({ characterId: 4 })).toBeNull();
    expect(characterConfigTarget({ characterId: "x".repeat(201) })).toBeNull();
    expect(characterConfigTarget("card-1")).toBeNull();
    expect(characterConfigTarget(null)).toBeNull();
  });

  test("reset keys: absent means all, a list must name per-character settings only", () => {
    expect(characterResetKeys(undefined)).toBeUndefined();
    expect(characterResetKeys(["themePreset", "themePreset", "textSpeed"])).toEqual(["themePreset", "textSpeed"]);
    expect(characterResetKeys([])).toEqual([]);
    expect(characterResetKeys(["imageConnectionId"])).toBeNull();
    expect(characterResetKeys("themePreset")).toBeNull();
    expect(characterResetKeys([1])).toBeNull();
  });
});
