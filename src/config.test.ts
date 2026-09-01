import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG, normalizeConfig } from "./config";

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
