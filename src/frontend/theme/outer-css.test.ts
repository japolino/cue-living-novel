import { describe, expect, test } from "bun:test";

import { THEME_PRESET_IDS } from "../../config.js";
import { VN_OUTER_CSS } from "./outer-css";

describe("outer safety root CSS", () => {
  test("defines shell chrome tokens for every preset", () => {
    for (const id of THEME_PRESET_IDS) {
      expect(VN_OUTER_CSS).toContain(`[data-vn-shell][data-vn-preset="${id}"]`);
    }
  });

  test("Back to chat stays visible, 44px tall and keyboard-visible", () => {
    const rule = VN_OUTER_CSS.slice(VN_OUTER_CSS.indexOf("[data-vn-exit] {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("min-height: 2.8rem");
    expect(body).not.toMatch(/display:\s*none|visibility:\s*hidden|opacity:\s*0[;\s]/);
    expect(VN_OUTER_CSS).toMatch(/\[data-vn-exit\]:focus-visible \{[^}]*outline: 3px solid/);
  });

  test("only the decorative chevron can be hidden", () => {
    const hidden = [...VN_OUTER_CSS.matchAll(/([^{}]+)\{[^}]*display:\s*none/g)].map((m) => m[1]!.trim());
    for (const selector of hidden) expect(selector).toBe("[data-vn-exit]::before");
  });

  test("stays local-only", () => {
    expect(VN_OUTER_CSS.toLowerCase()).not.toContain("url(");
    expect(VN_OUTER_CSS.toLowerCase()).not.toContain("@import");
  });
});
