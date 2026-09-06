import { describe, expect, test } from "bun:test";
import { AmbientEffectSchema, StageEffectSchema } from "../../shared/contracts.js";
import { deriveWeatherAmbient, normalizeAmbientEffect, normalizeStageEffect } from "./planner-effects.js";

describe("planner effect normalization", () => {
  test("preserves every canonical id and normalizes case and separators", () => {
    for (const id of StageEffectSchema.options) {
      expect(normalizeStageEffect(id)).toBe(id);
      expect(normalizeStageEffect(` ${id.toUpperCase().replaceAll("_", "-")} `)).toBe(id);
    }
    for (const id of AmbientEffectSchema.options) {
      expect(normalizeAmbientEffect(id)).toBe(id);
      expect(normalizeAmbientEffect(id.toUpperCase().replaceAll("_", " "))).toBe(id);
    }
  });
  test("maps stage synonyms from the effects audit", () => {
    const groups: Record<string, string> = {
      "flash_white": "flash white_flash flash_white_screen shock",
      "flash_red": "red_flash",
      "shake_hard": "hard_shake heavy_shake screen_shake explosion impact earthquake quake",
      "rumble": "tremor shaking",
      "fade_to_black": "blackout black_out fade_out fadeout fade cut_to_black scene_cut",
      "fade_from_black": "fade_in fadein",
      "fade_to_white": "whiteout white_out",
      "lightning": "thunder thunderclap lightning_strike storm",
      "zoom_in": "zoom zoomin close_up",
      "zoom_out": "zoomout",
      "zoom_punch": "punch punch_in snap_zoom sudden_reveal",
      "sparkle_burst": "sparkle sparkles glitter",
      "hearts_burst": "heart hearts heart_burst love kiss confession",
      "heartbeat": "pulse heart_beat pounding fear tension",
      "blur_pulse": "blur focus_pulse",
      "speed_lines": "speedlines motion_lines",
      "confetti": "celebration party cheer",
      "tilt": "dutch_angle"
    };
    for (const [expected, synonyms] of Object.entries(groups)) {
      for (const synonym of synonyms.split(" ")) expect(normalizeStageEffect(synonym)).toBe(StageEffectSchema.parse(expected));
    }
  });
  test("maps ambient synonyms from the effects audit", () => {
    const groups: Record<string, string> = {
      "rain": "raining rainy light_rain drizzle showers rainfall",
      "heavy_rain": "downpour storm thunderstorm rainstorm heavy_rainfall",
      "snow": "snowfall snowing snowy blizzard flurries",
      "sakura": "cherry_blossoms petals falling_petals blossoms",
      "fog": "mist misty foggy haze",
      "fireflies": "firefly glowing_bugs",
      "embers": "ember sparks cinders",
      "vignette_dark": "vignette dark_vignette darkness shadowy",
      "sepia_flashback": "sepia flashback memory old_photo",
      "desaturate": "desaturated grayscale greyscale monochrome black_and_white bw colorless",
      "dream_haze": "dream dreamy hazy dreamlike soft_focus",
      "danger_pulse": "danger dread tension alarm threat red_pulse"
    };
    for (const [expected, synonyms] of Object.entries(groups)) {
      for (const synonym of synonyms.split(" ")) expect(normalizeAmbientEffect(synonym)).toBe(AmbientEffectSchema.parse(expected));
    }
  });

  test("accepts nested arrays, value objects, quoted strings and lists", () => {
    for (const key of ["effect", "ambient", "type", "name", "id", "value"]) {
      expect(normalizeStageEffect({ [key]: ["hard shake"] })).toBe("shake_hard");
      expect(normalizeAmbientEffect([{ [key]: "downpour" }])).toBe("heavy_rain");
    }
    for (const value of ["'shake_hard'", '"shake_hard"', "`shake_hard`", "shake_hard!", "shake_hard.", "[shake_hard]", "“shake_hard”", "shake_hard, flash_white", "'shake_hard'; 'flash_white'", "shake_hard/flash_white", "shake_hard|flash_white"]) {
      expect(normalizeStageEffect(value)).toBe("shake_hard");
    }
    expect(normalizeAmbientEffect("'mist', rain")).toBe("fog");
    expect(normalizeAmbientEffect("dream haze")).toBe("dream_haze");
    expect(normalizeAmbientEffect("haze")).toBe("fog");
  });

  test("does not silently replace the first list item or cross catalogues", () => {
    expect(normalizeStageEffect(["invalid", "shake"])).toBeNull();
    expect(normalizeAmbientEffect("invalid, rain")).toBeNull();
    expect(normalizeStageEffect("rain")).toBeNull();
    expect(normalizeAmbientEffect("shake_hard")).toBeNull();
    expect(normalizeStageEffect("storm")).toBe("lightning");
    expect(normalizeAmbientEffect("storm")).toBe("heavy_rain");
  });

  test("rejects unknown values, prototype names and recursive input safely", () => {
    const recursive: Record<string, unknown> = {};
    recursive.value = recursive;
    for (const value of [null, undefined, false, 42, {}, [], "", "none", "null", "off", "unknown", "constructor", "toString", "__proto__", recursive]) {
      expect(normalizeStageEffect(value)).toBeNull();
      expect(normalizeAmbientEffect(value)).toBeNull();
    }
  });
});

describe("weather ambient fallback", () => {
  test("derives only weather overlays with a fixed priority", () => {
    const cases: Record<string, string> = {
      rain: "rain", "light rain": "rain", "Rainy outside": "rain", drizzle: "rain",
      "heavy rain": "heavy_rain", heavy_rain: "heavy_rain", downpour: "heavy_rain",
      "A thunderstorm overnight": "heavy_rain", storm: "heavy_rain",
      snow: "snow", "gentle snowfall": "snow", snowing: "snow", blizzard: "snow",
      fog: "fog", "dense mist": "fog", foggy: "fog",
      "rain and fog": "rain", "snow and rain": "snow", "heavy rain and snow": "heavy_rain"
    };
    for (const [input, expected] of Object.entries(cases)) expect(deriveWeatherAmbient(input)).toBe(AmbientEffectSchema.parse(expected));
  });

  test("does not infer moods, substrings, absent or uncertain weather", () => {
    for (const value of [null, undefined, {}, ["rain"], 42, "", "sunny", "clear", "dream", "dream haze", "dread", "flashback", "haze", "brainstorm", "rainbow", "no rain", "not snowing", "without fog", "chance of rain", "rain stopped"]) {
      expect(deriveWeatherAmbient(value)).toBeNull();
    }
  });
});
