import { describe, expect, test } from "bun:test";

import { THEME_PRESET_IDS, type VisualNovelThemePreset } from "../../config.js";
import {
  isThemePresetId,
  THEME_PRESET_CSS,
} from "./presets";
import {
  THEME_STYLE_LAYER_ATTRIBUTE,
  THEME_STYLE_LAYER_ORDER,
} from "./style-layers";

const EXPECTED_PRESETS = [
  "lumiverse",
  "golden-hour",
  "boxed-console",
  "paper-novel",
  "midnight-noir",
] as const;

describe("canonical theme preset ids", () => {
  test("exposes exactly the five supported presets, in order", () => {
    expect(THEME_PRESET_IDS).toEqual(EXPECTED_PRESETS);
  });

  test("never contains the removed retro preset", () => {
    expect(THEME_PRESET_IDS).not.toContain("retro-crt");
    expect(Object.keys(THEME_PRESET_CSS)).not.toContain("retro-crt");
  });
});

describe("preset CSS map", () => {
  test("has exactly one block per canonical id and nothing extra", () => {
    expect(Object.keys(THEME_PRESET_CSS).sort()).toEqual([...EXPECTED_PRESETS].sort());
    for (const id of EXPECTED_PRESETS) {
      expect(typeof THEME_PRESET_CSS[id]).toBe("string");
      expect(THEME_PRESET_CSS[id].length).toBeGreaterThan(0);
    }
  });

  test("every block is scoped under its own data-vn-preset root selector", () => {
    for (const id of EXPECTED_PRESETS) {
      const css = THEME_PRESET_CSS[id];
      expect(css).toContain(`[data-vn-root][data-vn-preset="${id}"]`);
    }
  });

  test("no preset rule can leak into another preset root closure", () => {
    for (const id of EXPECTED_PRESETS) {
      const css = THEME_PRESET_CSS[id];
      for (const other of EXPECTED_PRESETS) {
        if (other === id) continue;
        expect(css).not.toMatch(new RegExp(`\\[data-vn-root\\]\\[data-vn-preset="${other}"\\]`));
      }
    }
  });

  test("no preset styles the safety Exit control that lives in the outer root", () => {
    for (const id of EXPECTED_PRESETS) {
      expect(THEME_PRESET_CSS[id]).not.toContain("data-vn-exit");
    }
  });
});

describe("isThemePresetId", () => {
  test("accepts exactly the canonical ids", () => {
    for (const id of EXPECTED_PRESETS) {
      expect(isThemePresetId(id)).toBe(true);
    }
  });

  test("rejects unknown ids and non-strings", () => {
    expect(isThemePresetId("retro-crt")).toBe(false);
    expect(isThemePresetId("other")).toBe(false);
    expect(isThemePresetId(42)).toBe(false);
    expect(isThemePresetId(null)).toBe(false);
  });
});

describe("lumiverse preset maps real host tokens", () => {
  const css = THEME_PRESET_CSS.lumiverse;
  const token = (name: string): string => `var(--lumiverse-${name}`;

  test("maps text and accent tokens", () => {
    expect(css).toContain(token("text"));
    expect(css).toContain(token("text-muted"));
    expect(css).toContain(token("primary"));
  });

  test("maps card and border tokens", () => {
    expect(css).toContain(token("card-bg"));
    expect(css).toContain(token("border"));
  });

  test("maps the font token", () => {
    expect(css).toContain(token("font-family"));
  });

  test("maps key-control tokens (submit, continue, choice, input)", () => {
    for (const selector of ["[data-vn-submit]", "[data-vn-continue]", "[data-vn-choice]", "[data-vn-input]"]) {
      expect(css).toContain(selector);
    }
    expect(css).toContain(token("primary-contrast"));
    expect(css).toContain(token("fill-medium"));
    expect(css).toContain(token("bg-elevated"));
  });

  test("every host-token reference keeps a fallback value", () => {
    const tokenRefs = css.match(/var\(--lumiverse-[a-z0-9-]+/g) ?? [];
    expect(tokenRefs.length).toBeGreaterThan(0);
    for (const ref of tokenRefs) {
      const segment = css.slice(css.indexOf(ref));
      expect(segment).toMatch(/,/);
    }
  });
});

describe("theme style layer order", () => {
  test("lays base before preset and preset before user", () => {
    expect(THEME_STYLE_LAYER_ORDER).toEqual(["base", "preset", "user"]);
  });

  test("labels each layer with a distinct data-vn-* attribute", () => {
    expect(THEME_STYLE_LAYER_ATTRIBUTE.base).toBe("data-vn-base-css");
    expect(THEME_STYLE_LAYER_ATTRIBUTE.preset).toBe("data-vn-preset-css");
    expect(THEME_STYLE_LAYER_ATTRIBUTE.user).toBe("data-vn-user-css");
    const attributes = Object.values(THEME_STYLE_LAYER_ATTRIBUTE);
    expect(new Set(attributes).size).toBe(attributes.length);
  });
});

// Keep a small helper so a config typed as VisualNovelThemePreset is used
// (guards against a future removal of the type from the shared config module).
const preset: VisualNovelThemePreset = "lumiverse";
test("VisualNovelThemePreset unions the canonical ids", () => {
  expect(preset).toBe("lumiverse");
});
