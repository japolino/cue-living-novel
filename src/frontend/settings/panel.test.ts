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
    for (const name of ["generateChoices", "autoEnter", "referenceAnchoring", "parserConnectionId", "imageConnectionId",
      "textSpeed", "autoPlayDelay", "textScale", "maxImagesPerTurn", "bgmVolume", "sfxVolume", "systemOneApiKey",
      "novelAiSteps", "novelAiGuidance", "novelAiSampler", "novelAiSeed", "novelAiWidth", "novelAiHeight"]) {
      expect(names.filter((candidate) => candidate === name)).toEqual([name]);
    }
  });

  test("one Motion control (effectIntensity) also decides the text effects; no text effects setting of its own", () => {
    expect(source).toContain('optionList("effectIntensity", EFFECT_INTENSITY_OPTIONS)');
    expect(source).not.toContain('name="textEffects"');
    expect(source).not.toContain('optionList("textEffects"');
    expect(source).toContain("textEffectModeFor(config.effectIntensity)");
    expect(advancedKeys).not.toContain("effectIntensity");
  });

  test("the text effects reference renders from the shared catalogue, not a copy", () => {
    expect(source).toContain("TEXT_EFFECT_CATALOGUE.map(");
    expect(source).toContain("applyTextEffects(preview)");
    expect(source).toContain("VN_TEXT_EFFECTS_CSS");
    expect(TEXT_EFFECT_CATALOGUE.length).toBeGreaterThan(0);
  });

  test("sprite mode: presentation and cut-out quality save at once, the model URL saves when committed and valid", () => {
    expect(source).toContain('optionList("presentationMode", PRESENTATION_MODE_OPTIONS)');
    expect(source).toContain('case "presentationMode": return { presentationMode: normalizePresentationMode(target.value) };');
    expect(source).toContain('case "spriteCutout": return { spriteCutout: normalizeSpriteCutout(target.value) };');
    expect(advancedKeys).toContain("spriteModelUrl");
    expect(advancedKeys).not.toContain("presentationMode");
    expect(advancedKeys).not.toContain("spriteCutout");
    expect(source).toContain('case "spriteModelUrl": return parseSpriteModelUrl(text());');
  });

  test("sprite puppet: motion, its parts, acting, physics, outline and focus blur save at once, sprite mode only", () => {
    for (const name of ["spriteMotion", "spriteBreathing", "spriteSway", "spriteHeadMotion", "spriteActing", "spritePhysics", "spriteOutline", "spriteFocusBlur"]) {
      expect(names.filter((candidate) => candidate === name)).toEqual([name]);
      expect(source).toContain(`case "${name}": return { ${name}: `);
      expect(advancedKeys).not.toContain(name);
    }
    expect(source).toContain('this.root.querySelector<HTMLElement>("[data-sprites-look]")!.hidden = !sprites;');
  });

  test("character motion reads as not applying under Motion Still or reduced motion, with a note", () => {
    expect(source).toContain('<p data-motion-note hidden></p>');
    expect(source).toContain("spriteMotionHold(config.effectIntensity,");
    expect(source).toContain('motionGroup.toggleAttribute("data-inactive", hold !== null);');
  });

  test("System One mode, URL and model save live; no Apply or Discard remains", () => {
    expect(advancedKeys).not.toContain("systemOneMode");
    expect(advancedKeys).not.toContain("systemOneApiUrl");
    expect(advancedKeys).not.toContain("systemOneModel");
    expect(source).toContain('case "systemOneMode": return');
    expect(source).not.toContain("data-apply");
    expect(source).not.toContain("data-discard");
    expect(source).toContain("data-undo-toast");
  });

  const advancedPane = source.slice(source.indexOf('${pane("advanced"'), source.indexOf('" data-advanced-settings")}'));
  const picturesPane = source.slice(source.indexOf('${pane("pictures"'), source.indexOf('${pane("sound"'));

  test("image size: one control for both modes, in Advanced (saved at once), hidden for NovelAI", () => {

    expect(source.match(/optionList\("spriteImageSize"/g)).toHaveLength(1);
    expect(source).toContain('case "spriteImageSize": return { spriteImageSize: normalizeSpriteImageSize(target.value) };');
    expect(source).toContain('this.setRadio("spriteImageSize", config.spriteImageSize);');
    expect(advancedKeys).not.toContain("spriteImageSize");
    expect(picturesPane).not.toContain("spriteImageSize");
    expect(advancedPane).toContain('optionList("spriteImageSize", SPRITE_IMAGE_SIZE_OPTIONS)');
    // Scene pictures use it too, so it is not a scene-only or sprite-only group.
    const group = advancedPane.slice(advancedPane.indexOf('${group("Image size"'), advancedPane.indexOf('${group("Expressions per character"'));
    expect(group).not.toContain("sceneOnly");
    expect(group).toContain("scenes scene pictures");
    expect(source).toContain("this.root.querySelector<HTMLElement>('[data-group-id=\"sprite-size\"]')!.hidden = isNovelAi;");
  });

  test("expressions per character: one control right after Image size in Advanced, shown only for sprites", () => {
    expect(source.match(/optionList\("spriteExpressionCount"/g)).toHaveLength(1);
    expect(source).toContain('case "spriteExpressionCount": return { spriteExpressionCount: normalizeSpriteExpressionCount(target.value) };');
    expect(source).toContain('this.setRadio("spriteExpressionCount", String(config.spriteExpressionCount));');
    expect(source).toContain("this.spriteLibrary.setExpressionCount(config.spriteExpressionCount);");
    expect(advancedKeys).not.toContain("spriteExpressionCount");
    expect(picturesPane).not.toContain("spriteExpressionCount");
    expect(advancedPane.indexOf('optionList("spriteImageSize"')).toBeLessThan(advancedPane.indexOf('optionList("spriteExpressionCount"'));
    expect(source).toContain("this.root.querySelector<HTMLElement>('[data-group-id=\"sprite-expressions\"]')!.hidden = !sprites;");
  });

  test("Pictures starts with where pictures come from and the image connection; NovelAI sampling and System One details are in Advanced", () => {
    const generated = picturesPane.slice(picturesPane.indexOf("<div data-generated-only>"));
    expect(generated.indexOf('${group("Image connection"')).toBeLessThan(generated.indexOf('${group("How the story is shown"'));
    expect(generated.indexOf('${group("Image connection"')).toBeLessThan(generated.indexOf("data-novelai-controls"));
    expect(picturesPane).toContain('name="novelAiWidth"');
    for (const name of ["novelAiSteps", "novelAiGuidance", "novelAiSampler", "novelAiSeed", "systemOneMode", "systemOneApiUrl", "systemOneModel"]) {
      expect(advancedPane).toContain(`name="${name}"`);
    }
    const connections = source.slice(source.indexOf('${pane("connections"'), source.indexOf('${pane("advanced"'));
    expect(connections).toContain('name="systemOneOn"');
    expect(connections).toContain('name="systemOneApiKey"');
    expect(connections).not.toContain('name="systemOneMode"');
    expect(source).toContain('case "systemOneOn": return { systemOneMode: checked ? "on" : "off" };');
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
