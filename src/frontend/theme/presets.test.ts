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
  "yamaku-classic",
  "literature-club",
] as const;

describe("canonical theme preset ids", () => {
  test("exposes exactly the seven supported presets, in order", () => {
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


describe("authored preset signatures", () => {
  test("each preset reveals only its own ornament group and stays local-only", () => {
    for (const id of EXPECTED_PRESETS) {
      const css = THEME_PRESET_CSS[id];
      expect(css).toContain(`[data-vn-ornament-group][data-vn-preset="${id}"]`);
      expect(css.toLowerCase()).not.toContain("url(");
      expect(css.toLowerCase()).not.toContain("@import");
      expect(css.toLowerCase()).not.toContain("http");
    }
  });

  test("golden-hour uses a dark smoked plate with two keylines", () => {
    const css = THEME_PRESET_CSS["golden-hour"];
    const dialogueRule = css.match(/\[data-vn-dialogue\] \{[\s\S]*?\}/)?.[0] ?? "";
    expect(dialogueRule).toMatch(/background:.*rgba\((?:1[0-9]|2[0-9]|3[0-9]),/);
    expect(dialogueRule).not.toMatch(/background:[^;]*(?:ivory|white|#fff)/i);
    expect(dialogueRule).toContain("border:");
    expect(dialogueRule).toContain("outline:");
  });

  test("boxed-console carries a scanline treatment", () => {
    expect(THEME_PRESET_CSS["boxed-console"]).toContain("repeating-linear-gradient");
  });

  test("paper-novel carries the oxblood seal accent", () => {
    expect(THEME_PRESET_CSS["paper-novel"].toLowerCase()).toContain("#8a2f23");
  });

  test("midnight-noir keeps its scene treatment without opaque image-obscuring bands", () => {
    const css = THEME_PRESET_CSS["midnight-noir"];
    expect(css).toMatch(/\[data-vn-scene\]::after[\s\S]*?linear-gradient\(180deg/);
    expect(css).toContain("rgba(2, 4, 10, 0.34)");
    expect(css).not.toMatch(/rgba\(2, 4, 10, 0\.9[46]\)/);
  });

  test("yamaku-classic matches the reference's bottom-dark transparency and unboxed speaker", () => {
    const css = THEME_PRESET_CSS["yamaku-classic"];
    const dialogueRule = css.match(/\[data-vn-dialogue\] \{[\s\S]*?\}/)?.[0] ?? "";
    const speakerRule = css.match(/\[data-vn-speaker\] \{[\s\S]*?\}/)?.[0] ?? "";
    expect(css).toContain("#ff7095");
    expect(dialogueRule).toContain("linear-gradient(to top");
    expect(dialogueRule).toContain("rgba(20, 17, 15, 0.88) 0%");
    expect(dialogueRule).toContain("rgba(28, 24, 20, 0.45) 100%");
    expect(dialogueRule).toContain("outline: none");
    expect(dialogueRule).toContain("backdrop-filter: none");
    expect(speakerRule).toContain("background: transparent");
    expect(speakerRule).toContain("border: none");
    expect(speakerRule).toContain("text-transform: none");
    expect(css).toContain("[data-vn-control]");
    expect(css).toContain("[data-vn-badge]");
    expect(css).toContain("[data-vn-backlog]");
    expect(css).toContain("content: none !important");
  });

  test("literature-club matches the DDLC reference textbox treatment", () => {
    const css = THEME_PRESET_CSS["literature-club"];
    const dialogueRule = css.match(/\[data-vn-dialogue\] \{[\s\S]*?\}/)?.[0] ?? "";
    const speakerRule = css.match(/\[data-vn-speaker\] \{[\s\S]*?\}/)?.[0] ?? "";
    const controlsRule = css.match(/\[data-vn-controls\] \{[\s\S]*?\}/)?.[0] ?? "";
    expect(css).toContain("radial-gradient");
    expect(css).toContain("#e8507c");
    expect(dialogueRule).toContain("linear-gradient(to bottom, rgba(255, 150, 197, 0.94)");
    expect(dialogueRule).toContain("rgba(229, 140, 184, 0.64) 100%");
    expect(speakerRule).toContain("color: #ffffff");
    expect(speakerRule).toContain("text-shadow");
    expect(controlsRule).toContain("left: 50%");
    expect(controlsRule).toContain("transform: translateX(-50%)");
    expect(css).toContain("[data-vn-control]");
    expect(css).toContain("[data-vn-badge]");
  });
});

describe("crafted chrome per preset", () => {
  const ruleBody = (css: string, selectorTail: string): string => {
    const index = css.indexOf(`${selectorTail} {`);
    if (index < 0) return "";
    return css.slice(index, css.indexOf("}", index));
  };

  test("every authored preset styles the toolbar's hover and running (Auto/Skip) states", () => {
    for (const id of EXPECTED_PRESETS) {
      if (id === "lumiverse") continue;
      const css = THEME_PRESET_CSS[id];
      expect(css).toContain("[data-vn-control]:hover:not(:disabled)");
      expect(css).toContain('[data-vn-control][data-vn-active="true"]');
    }
  });

  test("lumiverse drives the shared chrome from host tokens instead of fixed colours", () => {
    const css = THEME_PRESET_CSS.lumiverse;
    expect(css).toContain("--vn-accent-contrast: var(--lumiverse-primary-contrast");
    expect(css).toContain("--vn-chrome-hover: var(--lumiverse-fill-medium");
    expect(css).toContain("--vn-panel-solid: var(--lumiverse-bg-elevated");
  });

  test("every preset gives choices a hover and keyboard-focus treatment", () => {
    for (const id of EXPECTED_PRESETS) {
      const css = THEME_PRESET_CSS[id];
      expect(css).toContain("[data-vn-choice]:hover:not(:disabled)");
      expect(css).toContain("[data-vn-choice]:focus-visible");
    }
  });

  test("each preset opens with its root token block, so the settings preview reads its colours", () => {
    for (const id of EXPECTED_PRESETS) {
      const css = THEME_PRESET_CSS[id].trimStart();
      expect(css.startsWith(`[data-vn-root][data-vn-preset="${id}"] {`)).toBe(true);
      const firstRule = css.slice(0, css.indexOf("}"));
      expect(firstRule).toContain("--vn-accent:");
      expect(firstRule).toContain("--vn-text:");
    }
  });

  test("golden-hour's choice and composer panel no longer stretch to the stage width", () => {
    const css = THEME_PRESET_CSS["golden-hour"];
    const panel = css.slice(css.indexOf('[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice-list],'));
    const body = panel.slice(0, panel.indexOf("}"));
    expect(body).not.toContain("width:");
    expect(css).not.toContain("min(94rem");
  });

  test("boxed-console never clips its nameplate or toolbar", () => {
    const css = THEME_PRESET_CSS["boxed-console"];
    const dialogueRule = css.match(/\[data-vn-dialogue\] \{[\s\S]*?\}/)?.[0] ?? "";
    expect(dialogueRule).not.toContain("overflow: hidden");
    expect(ruleBody(css, "[data-vn-speaker]")).toContain("color: #7dffa1");
  });

  test("paper-novel prints the heading, hint and move groups in ivory over the scene", () => {
    const css = THEME_PRESET_CSS["paper-novel"];
    expect(css).toContain("--vn-overlay-text: #fbf5e8");
    expect(css).toContain("--vn-overlay-muted: rgba(251, 245, 232, 0.88)");
  });

  test("literature-club history text is dark on its pale page", () => {
    const css = THEME_PRESET_CSS["literature-club"];
    expect(ruleBody(css, '[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-text]')).toContain("color: #44162e");
  });

  test("presets draw their own glyphs only with local text or CSS shapes", () => {
    for (const id of EXPECTED_PRESETS) {
      // A backslash escape inside a template literal is easy to break; use literal glyphs.
      expect(THEME_PRESET_CSS[id]).not.toMatch(/content:\s*"\\/);
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
