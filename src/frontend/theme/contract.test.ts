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

test("custom CSS removes remote imports and URL fetches", () => {
  const result = sanitizeVnUserCss(`@im/**/port "https://example.com/theme.css";\n[data-vn-root] { background: u\\72l(https://example.com/pixel); color: white; }`);
  assert.doesNotMatch(result, /@import|example\.com/);
  assert.match(result, /color: white/);
});
