import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG, THEME_PRESET_IDS, SCENE_IMAGE_FITS, EFFECT_INTENSITIES } from "../../config.js";
import {
  AUTO_PLAY_STEPS,
  BUDGET_PRESETS,
  EFFECT_INTENSITY_OPTIONS,
  IMAGE_SOURCE_OPTIONS,
  REFERENCE_SOURCE_OPTIONS,
  SCENE_IMAGE_FIT_OPTIONS,
  TEXT_SPEED_STEPS,
  budgetPresetFor,
  connectionReadiness,
  describeAutoPlay,
  describeBudget,
  describeTextSpeed,
  imageSourceFromConfig,
  imageSourcePatch,
  jsonObject,
  resetPatch,
  themePreviewTokens,
  type ConnectionOption,
  effectiveImageConnection,
  isNovelAiConnection,
  readNovelAiParameters,
  parseNovelAiSeed,
  NOVELAI_SEED_MAX,
  novelAiResolutionPresetFor,
  buildNovelAiSamplerOptions,
  snapDimension,
  NOVELAI_RESOLUTION_PRESETS,
  NOVELAI_SAMPLER_OPTIONS,
  NOVELAI_NOTICE,
  normalizeReferenceSource,
  TEXT_EFFECT_MODE_OPTIONS,
  normalizeTextEffects,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_KEY,
  SETUP_DONE_KEY,
  normalizeSettingsSection,
  searchSettings,
  type SettingsSearchEntry,
} from "./model";
import { TEXT_EFFECT_MODES } from "../../config.js";

describe("reference source options", () => {
  test("exposes exactly captured (default first) and card sprites", () => {
    expect(REFERENCE_SOURCE_OPTIONS.map((option) => option.value)).toEqual(["captured", "card"]);
    expect(REFERENCE_SOURCE_OPTIONS[0]!.label).toBe("Captured render (default)");
    expect(REFERENCE_SOURCE_OPTIONS[1]!.label).toBe("Card sprites");
    expect(REFERENCE_SOURCE_OPTIONS[1]!.help).toMatch(/characters the card does not know still use captured renders/i);
  });

  test("normalizes unknown values back to the default", () => {
    expect(normalizeReferenceSource("card")).toBe("card");
    expect(normalizeReferenceSource("captured")).toBe("captured");
    expect(normalizeReferenceSource("sprites")).toBe(DEFAULT_CONFIG.referenceSource);
    expect(normalizeReferenceSource("")).toBe(DEFAULT_CONFIG.referenceSource);
  });
});

describe("image source", () => {
  test("reads one choice from the two stored flags", () => {
    expect(imageSourceFromConfig({ generateImages: true, useNativeCardImages: false })).toBe("generated");
    expect(imageSourceFromConfig({ generateImages: false, useNativeCardImages: false })).toBe("text");
    expect(imageSourceFromConfig({ generateImages: true, useNativeCardImages: true })).toBe("card");
    expect(imageSourceFromConfig({ generateImages: false, useNativeCardImages: true })).toBe("card");
  });

  test("every choice round-trips through the flags without touching other keys", () => {
    for (const { value } of IMAGE_SOURCE_OPTIONS) {
      const patch = imageSourcePatch(value);
      expect(Object.keys(patch).every((key) => key === "generateImages" || key === "useNativeCardImages")).toBe(true);
      expect(imageSourceFromConfig({ ...DEFAULT_CONFIG, ...patch })).toBe(value);
    }
  });

  test("choosing card pictures does not flip the generate flag (backend prefers card)", () => {
    expect(imageSourcePatch("card")).toEqual({ useNativeCardImages: true });
    expect(imageSourceFromConfig({ ...DEFAULT_CONFIG, generateImages: false, ...imageSourcePatch("card") })).toBe("card");
  });
});

describe("picture budget presets", () => {
  test("named presets never include unlimited", () => {
    expect(BUDGET_PRESETS.some((preset) => preset.value <= 0)).toBe(false);
    expect(budgetPresetFor(0)).toBe("custom");
  });
  test("the default budget is a named preset", () => {
    expect(budgetPresetFor(DEFAULT_CONFIG.maxImagesPerTurn)).toBe("balanced");
  });
  test("custom values are described honestly", () => {
    expect(describeBudget(0)).toMatch(/No limit/);
    expect(describeBudget(1)).toBe("1 picture per reply.");
    expect(describeBudget(7)).toBe("Up to 7 pictures per reply.");
  });
});

describe("named reading steps", () => {
  test("defaults map to a named step", () => {
    expect(describeTextSpeed(DEFAULT_CONFIG.textSpeed)).toBe("Normal");
    expect(describeAutoPlay(DEFAULT_CONFIG.autoPlayDelay)).toBe("Normal (2 s)");
  });
  test("custom values keep their numbers", () => {
    expect(describeTextSpeed(33)).toBe("Custom (33 ms per letter)");
    expect(describeAutoPlay(2750)).toBe("Custom (2.75 s)");
  });
  test("steps stay inside the config clamp ranges", () => {
    for (const step of TEXT_SPEED_STEPS) expect(step.value >= 0 && step.value <= 100).toBe(true);
    for (const step of AUTO_PLAY_STEPS) expect(step.value >= 500 && step.value <= 10000).toBe(true);
  });
});

describe("plain-language option lists", () => {
  test("picture fit covers every fit exactly once", () => {
    expect(SCENE_IMAGE_FIT_OPTIONS.map((option) => option.value)).toEqual([...SCENE_IMAGE_FITS]);
  });
  test("effect intensity covers every level exactly once", () => {
    expect([...EFFECT_INTENSITY_OPTIONS.map((option) => option.value)].sort()).toEqual([...EFFECT_INTENSITIES].sort());
  });
});

describe("theme preview tokens", () => {
  test("every preset yields its own accent from the preset CSS", () => {
    const accents = new Set<string>();
    for (const id of THEME_PRESET_IDS) {
      const tokens = themePreviewTokens(id);
      expect(tokens.accent.length).toBeGreaterThan(0);
      expect(tokens.fontFamily.length).toBeGreaterThan(0);
      expect(tokens.dialogueBg.length).toBeGreaterThan(0);
      accents.add(tokens.accent);
    }
    expect(accents.size).toBe(THEME_PRESET_IDS.length);
  });
  test("preview values are plain CSS values, not declarations", () => {
    const tokens = themePreviewTokens("paper-novel");
    expect(tokens.accent).toBe("#8a2f23");
    expect(tokens.accent.includes(";")).toBe(false);
  });
});

describe("connection readiness", () => {
  const options: ConnectionOption[] = [
    { id: "a", name: "Studio", provider: "OpenAI", model: "gpt-4o", isDefault: true },
    { id: "b", name: "Local", provider: "Ollama", model: "llama", isDefault: false },
  ];
  test("loading and idle both read as checking", () => {
    expect(connectionReadiness("planner", { status: "idle", options: [] }, null).level).toBe("loading");
    expect(connectionReadiness("planner", { status: "loading", options }, "a").level).toBe("loading");
  });
  test("a selected connection that exists is available but not tested", () => {
    const readiness = connectionReadiness("image", { status: "ready", options }, "b");
    expect(readiness.level).toBe("ready");
    expect(readiness.title).toMatch(/not tested/);
    expect(readiness.title).toMatch(/Local/);
  });
  test("the Lumiverse default is named when one is marked", () => {
    const readiness = connectionReadiness("planner", { status: "ready", options }, null);
    expect(readiness.level).toBe("ready");
    expect(readiness.title).toMatch(/Studio/);
  });
  test("a missing saved connection is blocked with a way out", () => {
    const readiness = connectionReadiness("planner", { status: "ready", options }, "gone");
    expect(readiness.level).toBe("blocked");
    expect(readiness.fix).toBe("choose");
    expect(readiness.action).toMatch(/gone/);
  });
  test("no saved connections points at Lumiverse settings and a free refresh", () => {
    const readiness = connectionReadiness("image", { status: "ready", options: [] }, null);
    expect(readiness.level).toBe("attention");
    expect(readiness.fix).toBe("refresh");
    expect(readiness.action).toMatch(/free/);
  });
  test("a list error offers retry", () => {
    const readiness = connectionReadiness("image", { status: "error", options: [], error: "Host offline." }, null);
    expect(readiness.level).toBe("blocked");
    expect(readiness.fix).toBe("refresh");
    expect(readiness.action).toMatch(/Host offline/);
  });
});

describe("reset", () => {
  test("keeps prompt presets and the music folder", () => {
    const presets = [{ id: "p1", name: "Soft", positive: "soft light", negative: "" }];
    const patch = resetPatch({ promptPresets: presets, audioDirectory: "packs/vn" });
    expect(patch.promptPresets).toEqual(presets);
    expect(patch.promptPresets).not.toBe(presets);
    expect(patch.audioDirectory).toBe("packs/vn");
    expect(patch.themePreset).toBe(DEFAULT_CONFIG.themePreset);
    expect(patch.maxImagesPerTurn).toBe(DEFAULT_CONFIG.maxImagesPerTurn);
  });
});

describe("jsonObject", () => {
  test("blank means an empty object", () => {
    expect(jsonObject("  ", "Image parameters")).toEqual({});
  });
  test("invalid JSON names the field", () => {
    expect(() => jsonObject("{oops", "Image parameters")).toThrow(/Image parameters/);
  });
  test("arrays are rejected", () => {
    expect(() => jsonObject("[1]", "Image parameters")).toThrow(/JSON object/);
  });
});

describe("NovelAI effective connection & parameters", () => {
  const options: ConnectionOption[] = [
    { id: "nai-1", name: "NovelAI V4.5", provider: "novelai", model: "nai-diffusion-4-5-full", isDefault: false },
    { id: "stab-1", name: "Stability", provider: "stability", model: "sd3", isDefault: true },
    { id: "comfy-1", name: "ComfyUI", provider: "comfyui", model: "anime", isDefault: false },
  ];

  test("effectiveImageConnection: strict isDefault check when selectedId is null", () => {
    // With stab-1 as default, effective is stab-1 (not nai-1 even though nai-1 is first in options)
    const effectiveDefault = effectiveImageConnection({ status: "ready", options }, null);
    expect(effectiveDefault?.id).toBe("stab-1");
    expect(isNovelAiConnection(effectiveDefault)).toBe(false);

    // If no connection is marked isDefault, effective connection is null (never guesses options[0])
    const noDefaultOptions: ConnectionOption[] = [
      { id: "nai-first", name: "First NAI", provider: "novelai", model: "v4", isDefault: false },
      { id: "other", name: "Other", provider: "comfyui", model: "c", isDefault: false },
    ];
    const unresolved = effectiveImageConnection({ status: "ready", options: noDefaultOptions }, null);
    expect(unresolved).toBeNull();
    expect(isNovelAiConnection(unresolved)).toBe(false);
  });

  test("effectiveImageConnection: resolves explicit selection", () => {
    const explicitNai = effectiveImageConnection({ status: "ready", options }, "nai-1");
    expect(explicitNai?.id).toBe("nai-1");
    expect(isNovelAiConnection(explicitNai)).toBe(true);

    const missing = effectiveImageConnection({ status: "ready", options }, "nonexistent");
    expect(missing).toBeNull();
    expect(isNovelAiConnection(missing)).toBe(false);
  });

  test("effectiveImageConnection: loading or error states yield null", () => {
    expect(effectiveImageConnection({ status: "loading", options }, "nai-1")).toBeNull();
    expect(effectiveImageConnection({ status: "error", options, error: "fail" }, "nai-1")).toBeNull();
    expect(effectiveImageConnection({ status: "idle", options }, "nai-1")).toBeNull();
  });

  test("isNovelAiConnection: case-insensitivity and provider checks", () => {
    expect(isNovelAiConnection({ id: "x", name: "X", provider: "novelai", model: "m", isDefault: false })).toBe(true);
    expect(isNovelAiConnection({ id: "x", name: "X", provider: "NovelAI", model: "m", isDefault: false })).toBe(true);
    expect(isNovelAiConnection({ id: "x", name: "X", provider: " NOVELAI ", model: "m", isDefault: false })).toBe(true);
    expect(isNovelAiConnection({ id: "x", name: "X", provider: "comfyui", model: "m", isDefault: false })).toBe(false);
    expect(isNovelAiConnection(null)).toBe(false);
  });

  test("resolution presets stay within 1024x1024 (1,048,576 px) Opus limit", () => {
    const OPUS_MAX_PIXELS = 1024 * 1024;
    for (const preset of NOVELAI_RESOLUTION_PRESETS) {
      expect(preset.width * preset.height).toBeLessThanOrEqual(OPUS_MAX_PIXELS);
      expect(preset.help).toMatch(/Within Opus size limit/);
    }
  });

  test("novelAiResolutionPresetFor maps standard and custom resolutions", () => {
    expect(novelAiResolutionPresetFor("1216x832")).toBe("landscape");
    expect(novelAiResolutionPresetFor("832x1216")).toBe("portrait");
    expect(novelAiResolutionPresetFor("1024x1024")).toBe("square");
    expect(novelAiResolutionPresetFor("1536x1024")).toBe("custom");
    expect(novelAiResolutionPresetFor("custom-anything")).toBe("custom");
    expect(novelAiResolutionPresetFor("")).toBe("custom");
  });

  test("parseNovelAiSeed: empty, -1 (Lumiverse shuffle), fractions, and out-of-range mean random", () => {
    expect(parseNovelAiSeed("")).toBeNull();
    expect(parseNovelAiSeed("   ")).toBeNull();
    expect(parseNovelAiSeed(undefined)).toBeNull();
    expect(parseNovelAiSeed(null)).toBeNull();
    expect(parseNovelAiSeed(-1)).toBeNull();
    expect(parseNovelAiSeed("-1")).toBeNull();
    expect(parseNovelAiSeed(1.5)).toBeNull();
    expect(parseNovelAiSeed(NOVELAI_SEED_MAX + 2)).toBeNull();
    expect(parseNovelAiSeed("abc")).toBeNull();
    expect(parseNovelAiSeed(0)).toBe(0);
    expect(parseNovelAiSeed("12345")).toBe(12345);
    expect(parseNovelAiSeed(NOVELAI_SEED_MAX)).toBe(NOVELAI_SEED_MAX);
  });

  test("readNovelAiParameters exposes the seed and treats an invalid stored seed as random", () => {
    expect(readNovelAiParameters({}).seed).toBeNull();
    expect(readNovelAiParameters({ seed: -1 }).seed).toBeNull();
    expect(readNovelAiParameters({ seed: 777 }).seed).toBe(777);
    expect(readNovelAiParameters({ seed: "4242" }).seed).toBe(4242);
  });

  test("readNovelAiParameters defaults, clamps, and string coercion", () => {
    const defaults = readNovelAiParameters({});
    expect(defaults.steps).toBe(28);
    expect(defaults.guidance).toBe(5);
    expect(defaults.sampler).toBe("k_euler_ancestral");
    expect(defaults.resolution).toBe("1216x832");
    expect(defaults.preset).toBe("landscape");

    // Clamping
    const clamped = readNovelAiParameters({ steps: 99, guidance: 50 });
    expect(clamped.steps).toBe(50);
    expect(clamped.guidance).toBe(20);

    const clampedLow = readNovelAiParameters({ steps: 0, guidance: 0 });
    expect(clampedLow.steps).toBe(1);
    expect(clampedLow.guidance).toBe(1);

    // String coercion
    const strings = readNovelAiParameters({ steps: "32", guidance: "7.5", sampler: "k_dpmpp_2m" });
    expect(strings.steps).toBe(32);
    expect(strings.guidance).toBe(7.5);
    expect(strings.sampler).toBe("k_dpmpp_2m");

    // Custom dimensions
    const custom = readNovelAiParameters({ resolution: "1536x1024" });
    expect(custom.preset).toBe("custom");
    expect(custom.width).toBe(1536);
    expect(custom.height).toBe(1024);
  });

  test("buildNovelAiSamplerOptions preserves unsupported or custom samplers", () => {
    const standard = buildNovelAiSamplerOptions("k_euler_ancestral");
    expect(standard.length).toBe(NOVELAI_SAMPLER_OPTIONS.length);

    const custom = buildNovelAiSamplerOptions("custom_sampler_v2");
    expect(custom.length).toBe(NOVELAI_SAMPLER_OPTIONS.length + 1);
    expect(custom.some((opt) => opt.value === "custom_sampler_v2" && opt.label.includes("Custom"))).toBe(true);
  });
  test("snapDimension rounds to nearest multiple of 64 bounded to [64, 2048]", () => {
    expect(snapDimension(1400)).toBe(1408); // 1408 is 22 * 64
    expect(snapDimension(1024)).toBe(1024);
    expect(snapDimension(830)).toBe(832);
    expect(snapDimension(10)).toBe(64);     // minimum bound
    expect(snapDimension(5000)).toBe(2048); // maximum bound
    expect(snapDimension(NaN, 1216)).toBe(1216); // fallback
  });
});

describe("text effects mode options", () => {
  test("lists every config mode once, default first", () => {
    expect(TEXT_EFFECT_MODE_OPTIONS.map((option) => option.value)).toEqual([...TEXT_EFFECT_MODES]);
    expect(TEXT_EFFECT_MODE_OPTIONS[0]!.value).toBe(DEFAULT_CONFIG.textEffects);
    for (const option of TEXT_EFFECT_MODE_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
      expect(option.help.trim().length).toBeGreaterThan(0);
    }
  });

  test("normalizes unknown values to the default", () => {
    expect(normalizeTextEffects("static")).toBe("static");
    expect(normalizeTextEffects("off")).toBe("off");
    expect(normalizeTextEffects("animated")).toBe("animated");
    expect(normalizeTextEffects("sparkly")).toBe("animated");
    expect(normalizeTextEffects("")).toBe("animated");
  });
});

describe("settings sections", () => {
  test("seven sections with unique ids, labels and blurbs", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual(["reading", "look", "pictures", "sound", "voice", "connections", "advanced"]);
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.label)).size).toBe(SETTINGS_SECTIONS.length);
    for (const section of SETTINGS_SECTIONS) expect(section.blurb.trim().length).toBeGreaterThan(0);
  });

  test("the remembered-section key lives next to the setup flag and never collides with it", () => {
    expect(SETTINGS_SECTION_KEY.startsWith("cue.visual-novel.")).toBe(true);
    expect(SETTINGS_SECTION_KEY).not.toBe(SETUP_DONE_KEY);
  });

  test("normalizes unknown or missing sections to Reading", () => {
    expect(normalizeSettingsSection("advanced")).toBe("advanced");
    expect(normalizeSettingsSection("appearance")).toBe("reading");
    expect(normalizeSettingsSection(null)).toBe("reading");
    expect(normalizeSettingsSection(undefined)).toBe("reading");
    expect(normalizeSettingsSection(3)).toBe("reading");
  });
});

describe("settings search", () => {
  const entries: SettingsSearchEntry[] = [
    { id: "a", label: "Text speed", section: "reading", keywords: "typing typewriter" },
    { id: "b", label: "Music volume", section: "sound", keywords: "bgm loudness" },
    { id: "c", label: "Sound effects volume", section: "sound", keywords: "sfx" },
    { id: "d", label: "Theme CSS", section: "advanced", keywords: "custom style" },
    { id: "e", label: "Text size", section: "look", keywords: "font scale" },
  ];

  test("an empty query finds nothing", () => {
    expect(searchSettings(entries, "")).toEqual([]);
    expect(searchSettings(entries, "   ")).toEqual([]);
  });

  test("matches word prefixes in labels, case- and accent-insensitive", () => {
    expect(searchSettings(entries, "VOL").map((entry) => entry.id)).toEqual(["b", "c"]);
    expect(searchSettings(entries, "vólume").map((entry) => entry.id)).toEqual(["b", "c"]);
  });

  test("every word must match; keywords and section names count", () => {
    expect(searchSettings(entries, "music vol").map((entry) => entry.id)).toEqual(["b"]);
    expect(searchSettings(entries, "typewriter").map((entry) => entry.id)).toEqual(["a"]);
    expect(searchSettings(entries, "advanced").map((entry) => entry.id)).toEqual(["d"]);
    expect(searchSettings(entries, "music css")).toEqual([]);
  });

  test("label matches rank above keyword matches, and a label prefix ranks first", () => {
    const ranked = searchSettings([
      { id: "kw", label: "Ignored tags", section: "advanced", keywords: "text filter" },
      { id: "label", label: "Text size", section: "look" },
      { id: "prefix", label: "Text effects", section: "look" },
    ], "text eff");
    expect(ranked.map((entry) => entry.id)).toEqual(["prefix"]);
    expect(searchSettings([
      { id: "kw", label: "Ignored tags", section: "advanced", keywords: "text filter" },
      { id: "label", label: "Text size", section: "look" },
    ], "text").map((entry) => entry.id)).toEqual(["label", "kw"]);
  });

  test("respects the result limit", () => {
    expect(searchSettings(entries, "s", 2)).toHaveLength(2);
  });
});
