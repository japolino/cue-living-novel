import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  isTextEffectId,
  stripTextEffectTags,
  TEXT_EFFECT_AUTHOR_GUIDE,
  TEXT_EFFECT_CATALOGUE,
  TEXT_EFFECT_IDS,
} from "./text-effects";

describe("text effect catalogue", () => {
  test("lists every id exactly once, in id order", () => {
    expect(TEXT_EFFECT_CATALOGUE.map((effect) => effect.id)).toEqual([...TEXT_EFFECT_IDS]);
    expect(new Set(TEXT_EFFECT_IDS).size).toBe(TEXT_EFFECT_IDS.length);
  });

  test("each entry has a label, a sentence, and a closed example using its own tag", () => {
    for (const effect of TEXT_EFFECT_CATALOGUE) {
      expect(effect.label.length).toBeGreaterThan(1);
      expect(effect.description).toMatch(/\.$/);
      expect(effect.example.startsWith(`<${effect.id}>`)).toBe(true);
      expect(effect.example.endsWith(`</${effect.id}>`)).toBe(true);
      expect(typeof effect.perLetter).toBe("boolean");
      expect(typeof effect.motion).toBe("boolean");
    }
  });

  test("the author guide names every tag and asks to close them", () => {
    for (const id of TEXT_EFFECT_IDS) expect(TEXT_EFFECT_AUTHOR_GUIDE).toContain(`<${id}>`);
    expect(TEXT_EFFECT_AUTHOR_GUIDE).toMatch(/close/i);
  });

  test("isTextEffectId accepts catalogue ids only", () => {
    expect(isTextEffectId("wave")).toBe(true);
    expect(isTextEffectId("Wave")).toBe(false);
    expect(isTextEffectId("sparkle")).toBe(false);
    expect(isTextEffectId(undefined)).toBe(false);
  });
});

describe("stripTextEffectTags", () => {
  test("removes effect tags and keeps the words", () => {
    expect(stripTextEffectTags('"<shake>No!</shake>" she <WHISPER>said</Whisper>.')).toBe('"No!" she said.');
    expect(stripTextEffectTags("<rainbow><wave>la la</wave></rainbow>")).toBe("la la");
    expect(stripTextEffectTags("unclosed <glow>light")).toBe("unclosed light");
  });

  test("leaves other markup and plain text alone", () => {
    expect(stripTextEffectTags("<b>bold</b> <sparkle>x</sparkle> 3 < 4")).toBe("<b>bold</b> <sparkle>x</sparkle> 3 < 4");
    expect(stripTextEffectTags("")).toBe("");
    expect(stripTextEffectTags("no tags")).toBe("no tags");
  });

  test("is stateless across calls (no shared lastIndex)", () => {
    for (let i = 0; i < 3; i += 1) expect(stripTextEffectTags("<wave>a</wave>")).toBe("a");
  });
});

describe("README text effects table", () => {
  test("lists every catalogue example and the author guide", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    const section = readme.slice(readme.indexOf("## Text effects"), readme.indexOf("## Run the standalone preview"));
    for (const effect of TEXT_EFFECT_CATALOGUE) {
      expect(section).toContain(`| \`${effect.example}\` | ${effect.label} | ${effect.description} |`);
    }
    for (const line of TEXT_EFFECT_AUTHOR_GUIDE.split("\n")) expect(section).toContain(line);
  });
});
