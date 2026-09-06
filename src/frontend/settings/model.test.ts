import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG, THEME_PRESET_IDS, SCENE_IMAGE_FITS, EFFECT_INTENSITIES } from "../../config.js";
import {
  AUTO_PLAY_STEPS,
  BUDGET_PRESETS,
  EFFECT_INTENSITY_OPTIONS,
  IMAGE_SOURCE_OPTIONS,
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
} from "./model";

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
