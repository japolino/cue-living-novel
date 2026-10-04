import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { THEME_PRESET_IDS } from "../../config.js";
import { THEME_PRESET_LABELS, THEME_PRESET_OPTIONS } from "./panel";
import { TEXT_EFFECT_CATALOGUE } from "../../shared/text-effects.js";

describe("theme preset settings options", () => {
  test("the selector exposes exactly the canonical five presets", () => {
    expect(THEME_PRESET_OPTIONS.map(({ value }) => value)).toEqual([...THEME_PRESET_IDS]);
    expect(THEME_PRESET_OPTIONS.length).toBe(7);
  });

  test("every option carries a non-empty, distinct label", () => {
    for (const option of THEME_PRESET_OPTIONS) {
      expect(option.value).toBeTruthy();
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
    const labels = THEME_PRESET_OPTIONS.map(({ label }) => label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("the label map covers every canonical preset id", () => {
    for (const id of THEME_PRESET_IDS) {
      expect(THEME_PRESET_LABELS[id].trim().length).toBeGreaterThan(0);
    }
  });
  test("lumiverse is the default host-token entry and is labelled as the host default", () => {
    expect(THEME_PRESET_LABELS.lumiverse).toMatch(/host default/i);
    expect(THEME_PRESET_OPTIONS[0]?.value).toBe("lumiverse");
  });
});

describe("settings panel markup", () => {
  const source = readFileSync(new URL("./panel.ts", import.meta.url), "utf8");
  const names = [...source.matchAll(/name="([A-Za-z]+)"/g)].map((match) => match[1]!);
  const advancedBlock = /const ADVANCED_KEYS = \[([\s\S]*?)\] as const;/.exec(source)![1]!;
  const advancedKeys = [...advancedBlock.matchAll(/"([A-Za-z]+)"/g)].map((match) => match[1]!);

  test("every Advanced key has exactly one control", () => {
    expect(advancedKeys.length).toBeGreaterThan(20);
    for (const key of advancedKeys) expect(names.filter((name) => name === key)).toEqual([key]);
  });

  test("everyday controls appear once (radio groups once per option list)", () => {
    for (const name of ["mode", "skipMode", "generateChoices", "autoEnter", "referenceAnchoring", "parserConnectionId", "imageConnectionId",
      "textSpeed", "autoPlayDelay", "textScale", "maxImagesPerTurn", "bgmVolume", "sfxVolume", "systemOneApiKey",
      "novelAiSteps", "novelAiGuidance", "novelAiSampler", "novelAiSeed", "novelAiWidth", "novelAiHeight"]) {
      expect(names.filter((candidate) => candidate === name)).toEqual([name]);
    }
  });

  test("the text effects mode control exists and saves as an everyday patch", () => {
    expect(source).toContain('optionList("textEffects", TEXT_EFFECT_MODE_OPTIONS)');
    expect(source).toContain('case "textEffects": return { textEffects: normalizeTextEffects(target.value) };');
    expect(advancedKeys).not.toContain("textEffects");
  });

  test("the text effects reference renders from the shared catalogue, not a copy", () => {
    expect(source).toContain("TEXT_EFFECT_CATALOGUE.map(");
    expect(source).toContain("applyTextEffects(preview)");
    expect(source).toContain("VN_TEXT_EFFECTS_CSS");
    expect(TEXT_EFFECT_CATALOGUE.length).toBeGreaterThan(0);
  });

  test("sprite mode: presentation and cut-out quality save at once, the model URL waits for Apply", () => {
    expect(source).toContain('optionList("presentationMode", PRESENTATION_MODE_OPTIONS)');
    expect(source).toContain('case "presentationMode": return { presentationMode: normalizePresentationMode(target.value) };');
    expect(source).toContain('case "spriteCutout": return { spriteCutout: normalizeSpriteCutout(target.value) };');
    expect(advancedKeys).toContain("spriteModelUrl");
    expect(advancedKeys).not.toContain("presentationMode");
    expect(advancedKeys).not.toContain("spriteCutout");
    expect(source).toContain('spriteModelUrl: parseSpriteModelUrl(');
  });

  test("sprite image size: one everyday control in the sprite-only block, before the cut-out", () => {
    expect(source.match(/optionList\("spriteImageSize"/g)).toHaveLength(1);
    expect(source).toContain('case "spriteImageSize": return { spriteImageSize: normalizeSpriteImageSize(target.value) };');
    expect(source).toContain('this.setRadio("spriteImageSize", config.spriteImageSize);');
    expect(advancedKeys).not.toContain("spriteImageSize");
    const spritesOnly = source.slice(source.indexOf("<div data-sprites-only hidden>"), source.indexOf('${group("Sprite library"'));
    expect(spritesOnly).toContain('optionList("spriteImageSize", SPRITE_IMAGE_SIZE_OPTIONS)');
    expect(spritesOnly.indexOf("spriteImageSize")).toBeLessThan(spritesOnly.indexOf('optionList("spriteCutout"'));
  });

  test("the sprite controls sit with the generated-picture settings in Pictures", () => {
    const pictures = source.slice(source.indexOf('${pane("pictures"'), source.indexOf('${pane("sound"'));
    expect(pictures).toContain("presentationMode");
    expect(pictures.indexOf("<div data-generated-only>")).toBeLessThan(pictures.indexOf("presentationMode"));
    expect(pictures).toContain("<div data-sprites-only hidden>");
    expect(pictures).toContain("data-sprite-library-mount");
    expect(pictures).toContain("sceneOnly: true");
  });

  test("key moments: one everyday control under \"How the story is shown\", only in sprite mode", () => {
    expect(source.match(/optionList\("keyIllustrations"/g)).toHaveLength(1);
    expect(source).toContain('case "keyIllustrations": return { keyIllustrations: normalizeKeyIllustrations(target.value) };');
    expect(advancedKeys).not.toContain("keyIllustrations");
    const presentation = source.slice(source.indexOf('${group("How the story is shown"'), source.indexOf('{ id: "presentation"'));
    expect(presentation).toContain('optionList("keyIllustrations", KEY_ILLUSTRATION_OPTIONS)');
    expect(presentation.indexOf("<div data-key-moments hidden>")).toBeLessThan(presentation.indexOf("keyIllustrations"));
    expect(presentation.indexOf("presentationMode")).toBeLessThan(presentation.indexOf("keyIllustrations"));
    // The block follows the presentation mode like the other sprite controls.
    expect(source).toContain('this.root.querySelector<HTMLElement>("[data-key-moments]")!.hidden = !sprites;');
  });

  test("there are no network assets in the panel styles", () => {
    expect(source).not.toMatch(/url\(\s*["']?https?:/i);
    expect(source).not.toMatch(/@import/i);
  });
});
