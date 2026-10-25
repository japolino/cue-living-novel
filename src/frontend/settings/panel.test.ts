import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { THEME_PRESET_IDS } from "../../config.js";
import { THEME_PRESET_LABELS, THEME_PRESET_OPTIONS } from "./panel";
import { TEXT_EFFECT_CATALOGUE } from "../../shared/text-effects.js";
import {
  WAITING_BACKDROP_OPTIONS,
  WAITING_RECAP_OPTIONS,
  describeOpeningCardMin,
  normalizeOpeningCard,
  normalizeWaitingBackdrop,
  normalizeWaitingRecap,
  openingCardMinFrom,
} from "./reading-flow";
import { CHARACTER_SCOPED_KEYS, WAITING_BACKDROPS, WAITING_RECAPS } from "../../config.js";
import { settingKeyForControl } from "./character-scope";

describe("theme preset settings options", () => {
  test("the selector exposes exactly the canonical presets", () => {
    expect(THEME_PRESET_OPTIONS.map(({ value }) => value)).toEqual([...THEME_PRESET_IDS]);
    expect(THEME_PRESET_OPTIONS.length).toBe(10);
  });

  test("the new layouts have plain labels and no game brand names", () => {
    expect(THEME_PRESET_LABELS.cinema).toMatch(/^Cinema/);
    expect(THEME_PRESET_LABELS.nvl).toMatch(/^NVL/);
    expect(THEME_PRESET_LABELS.daylight).toMatch(/^Daylight/);
    for (const id of ["cinema", "nvl", "daylight"] as const) {
      expect(THEME_PRESET_LABELS[id]).not.toMatch(/archive|risu|ddlc|doki/i);
    }
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
      "textSpeed", "autoPlayDelay", "textScale", "maxImagesPerTurn", "bgmVolume", "sfxVolume", "systemOneOn", "decisionConnectionId",
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

  test("sprite puppet: motion, its parts, acting, physics, atmosphere, outline and focus blur save at once, sprite mode only", () => {
    for (const name of ["spriteMotion", "spriteBreathing", "spriteSway", "spriteHeadMotion", "spriteActing", "spritePhysics", "spriteAtmosphere", "spriteOutline", "spriteFocusBlur"]) {
      expect(names.filter((candidate) => candidate === name)).toEqual([name]);
      expect(source).toContain(`case "${name}": return { ${name}: `);
      expect(advancedKeys).not.toContain(name);
    }
    expect(source).toContain('this.root.querySelector<HTMLElement>("[data-sprites-look]")!.hidden = !sprites;');
  });

  test("reading flow: the opening card, the waiting screen and the reply box save at once, each once", () => {
    for (const name of ["openingCardMinMs", "playOnArrival", "cardBackground", "locationLabel", "replyBoxAtEnd"]) {
      expect(names.filter((candidate) => candidate === name)).toEqual([name]);
    }
    for (const name of ["openingCard", "openingCardMinMs", "playOnArrival", "cardBackground", "locationLabel", "replyBoxAtEnd", "waitingBackdrop", "waitingRecap"]) {
      expect(source).toContain(`case "${name}": return { ${name}: `);
      expect(advancedKeys).not.toContain(name);
    }
    expect(source).toContain('optionList("openingCard", OPENING_CARD_OPTIONS)');
    expect(source).toContain('optionList("waitingBackdrop", WAITING_BACKDROP_OPTIONS)');
    expect(source).toContain('optionList("waitingRecap", WAITING_RECAP_OPTIONS)');
    // The preview and replay buttons show only when the host can open Cue for them.
    expect(source).toContain("previewWaiting.hidden = !this.options.onPreviewWaiting;");
    expect(source).toContain("replayOpening.hidden = !this.options.onReplayOpening;");
  });

  test("reading flow options: one per setting value, and odd values fall back to the defaults", () => {
    expect(WAITING_BACKDROP_OPTIONS.map((option) => option.value)).toEqual([...WAITING_BACKDROPS]);
    expect(WAITING_RECAP_OPTIONS.map((option) => option.value)).toEqual([...WAITING_RECAPS]);
    expect(normalizeOpeningCard("off")).toBe("off");
    expect(normalizeOpeningCard("huge")).toBe("title");
    expect(normalizeWaitingBackdrop("daylight")).toBe("daylight");
    expect(normalizeWaitingBackdrop("neon")).toBe("card");
    expect(normalizeWaitingRecap("film")).toBe("film");
    expect(normalizeWaitingRecap("")).toBe("auto");
    expect(openingCardMinFrom("2250")).toBe(2250);
    expect(openingCardMinFrom("99999")).toBe(5000);
    expect(openingCardMinFrom("-4")).toBe(0);
    expect(openingCardMinFrom("x")).toBe(1500);
    expect(describeOpeningCardMin(0)).toBe("until ready");
    expect(describeOpeningCardMin(1000)).toBe("1 s");
    expect(describeOpeningCardMin(1500)).toBe("1.5 s");
    expect(describeOpeningCardMin(1750)).toBe("1.75 s");
  });

  test("expression changes: one option list in Character motion, saved at once and synced", () => {
    expect(source.match(/optionList\("spriteTransitions"/g)).toHaveLength(1);
    expect(source).toContain('case "spriteTransitions": return { spriteTransitions: normalizeSpriteTransitions(target.value) };');
    expect(source).toContain('this.setRadio("spriteTransitions", config.spriteTransitions);');
    expect(advancedKeys).not.toContain("spriteTransitions");
    const motion = source.slice(source.indexOf('${group("Character motion"'), source.indexOf('${group("Character look"'));
    expect(motion).toContain('optionList("spriteTransitions", SPRITE_TRANSITION_OPTIONS)');
    expect(motion).toContain('name="spriteAtmosphere"');
  });

  test("stage feel: press-to-bounce in Character motion; click effect, interface sounds and inner voices in Look, saving at once", () => {
    for (const name of ["spritePressBounce", "clickEffect", "interfaceSounds", "interfaceSoundVolume", "innerVoices"]) {
      expect(source).toContain(`case "${name}": return { ${name}: `);
      expect(advancedKeys).not.toContain(name);
    }
    for (const name of ["spritePressBounce", "interfaceSounds", "interfaceSoundVolume", "innerVoices"]) {
      expect(names.filter((candidate) => candidate === name)).toEqual([name]);
    }
    expect(source).toContain('segments("clickEffect", CLICK_EFFECT_OPTIONS, false)');
    // Inside the Look pane, after the sprite groups and before the text effect tags; not in Reading.
    const look = source.slice(source.indexOf('${pane("look"'), source.indexOf('${pane("pictures"'));
    const motion = look.indexOf('id: "sprite-motion"');
    expect(motion).toBeGreaterThan(-1);
    expect(look.indexOf('name="spritePressBounce"')).toBeLessThan(motion);
    expect(look.indexOf('id: "stage-feel"')).toBeGreaterThan(look.indexOf('id: "sprite-look"'));
    expect(look.indexOf('id: "stage-feel"')).toBeLessThan(look.indexOf('id: "text-fx"'));
    // The reader's text is not overwritten while being typed.
    expect(source).toContain("if (this.root.activeElement !== voices) voices.value = config.innerVoices;");
  });

  test("character size and outline colour: in Look, saved at once, synced, knobs off while matching is off", () => {
    for (const name of ["spriteOutlineColor", "spriteSizeMatch", "spriteSizeMatchFace", "spriteSizeMatchMax", "spriteSizeMatchMin", "spriteSizeMatchCenter"]) {
      expect(source).toContain(`case "${name}": return { ${name}: `);
      expect(advancedKeys).not.toContain(name);
    }
    for (const name of ["spriteOutlineColor", "spriteSizeMatchFace", "spriteSizeMatchMax", "spriteSizeMatchMin", "spriteSizeMatchCenter"]) {
      expect(names.filter((candidate) => candidate === name)).toEqual([name]);
    }
    expect(source.match(/optionList\("spriteSizeMatch"/g)).toHaveLength(1);
    expect(source).toContain('<input name="spriteOutlineColor" type="color" />');
    expect(source).toContain('this.setRadio("spriteSizeMatch", config.spriteSizeMatch);');
    expect(source).toContain('input.disabled = config.spriteSizeMatch === "off";');
    expect(source).toContain("outlineColor.disabled = config.spriteOutline <= 0;");
    // Right after Character look, inside the Look pane.
    const look = source.slice(source.indexOf('${pane("look"'), source.indexOf('${pane("pictures"'));
    expect(look.indexOf('id: "character-size"')).toBeGreaterThan(look.indexOf('id: "sprite-look"'));
    // Its own group id: "sprite-size" is Advanced → Image size (hidden for NovelAI).
    expect(source.match(/id: "sprite-size"/g)).toHaveLength(1);
    expect(look.indexOf('name="spriteOutlineColor"')).toBeLessThan(look.indexOf('id: "sprite-look"'));
    expect(source).toContain("const patch = spriteSizeMatchSettings(DEFAULT_CONFIG);");
  });

  test("character motion reads as not applying under Motion Still or reduced motion, with a note", () => {
    expect(source).toContain('<p data-motion-note hidden></p>');
    expect(source).toContain("spriteMotionHold(config.effectIntensity,");
    expect(source).toContain('motionGroup.toggleAttribute("data-inactive", hold !== null);');
  });

  test("System One mode saves live; no Apply or Discard remains", () => {
    expect(advancedKeys).not.toContain("systemOneMode");
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

  test("sprite cut-out hides for NovelAI V5, whose sprites arrive transparent", () => {
    expect(source.match(/id: "cutout"/g)).toHaveLength(1);
    expect(source).toContain("this.root.querySelector<HTMLElement>('[data-group-id=\"cutout\"]')!.hidden = isNovelAi && novelAiDrawsTransparentSprites(effective, config.imageModel);");
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
    for (const name of ["novelAiSteps", "novelAiGuidance", "novelAiSampler", "novelAiSeed", "systemOneMode"]) {
      expect(advancedPane).toContain(`name="${name}"`);
    }
    const connections = source.slice(source.indexOf('${pane("connections"'), source.indexOf('${pane("advanced"'));
    expect(connections).toContain('name="systemOneOn"');
    expect(connections).not.toContain('name="systemOneMode"');
    expect(source).toContain('case "systemOneOn": return { systemOneMode: checked ? "on" : "off" };');
  });

  test("the Decision connection is one of Lumiverse's, chosen in Connections: no key, URL or model of Cue's own", () => {
    const connections = source.slice(source.indexOf('${pane("connections"'), source.indexOf('${pane("advanced"'));
    expect(connections).toContain('${group("Decision connection"');
    expect(source).not.toMatch(/>[^<>]*System One[^<>]*</);
    expect(connections).toContain('<select name="decisionConnectionId" data-connection-select="decision" aria-label="Decision connection"><option value="">Lumiverse default</option></select>');
    expect(source).toMatch(/case "decisionConnectionId":\s+return \{ decisionConnectionId: target\.value\.trim\(\) \|\| null \};/);
    expect(source).toContain('this.renderConnectionSelects("decision", config.decisionConnectionId);');
    for (const name of ["systemOneApiKey", "systemOneApiUrl", "systemOneModel"]) expect(source).not.toContain(`name="${name}"`);
    expect(connections).toContain("data-decision-status");
    expect(connections).toContain("<button type=\"button\" data-check-decisions>Check again</button>");
    expect(connections).toContain("<button type=\"button\" data-open-decision-connections>Open Lumiverse Connections</button>");
    expect(connections).toContain("Connections → Decision models");
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

describe("settings panel: settings saved per character", () => {
  const source = readFileSync(new URL("./panel.ts", import.meta.url), "utf8");
  const names = [...source.matchAll(/name="([A-Za-z]+)"/g)].map((match) => match[1]!);
  const listed = [...source.matchAll(/(?:optionList|segments)\("([A-Za-z]+)"/g)].map((match) => match[1]!);
  const controls = new Set([...names, ...listed, ...(source.includes("${group(\"Theme\", themeTiles()") ? ["themePreset"] : [])]);
  const scopeBar = source.slice(source.indexOf("<section data-scope"), source.indexOf("</section>", source.indexOf("<section data-scope")));

  test("the scope switch sits at the top, outside the form, with plain choices", () => {
    expect(source.indexOf("<div data-topbar>")).toBeLessThan(source.indexOf("<section data-scope"));
    expect(source.indexOf("<section data-scope")).toBeLessThan(source.indexOf("<section data-setup"));
    expect(source.indexOf("<section data-scope")).toBeLessThan(source.indexOf("<form"));
    expect(scopeBar).toContain(">All characters</label>");
    expect(scopeBar).toContain("<span data-scope-name></span> only");
    expect(names.filter((name) => name === "settingsScope")).toHaveLength(2);
    expect(scopeBar).toContain("data-scope-clear");
    // Hidden until the host names the open chat's character.
    expect(source).toContain("bar.hidden = !view;");
  });

  test("every per-character setting has a control in the panel, so its marker has a place", () => {
    for (const key of CHARACTER_SCOPED_KEYS) {
      expect([...controls].some((name) => settingKeyForControl(name) === key)).toBe(true);
    }
  });

  test("saves in \"<name> only\" carry the character; shared settings there are refused, not saved", () => {
    expect(source).toContain("this.options.onSave(patch, { characterId: character.characterId });");
    expect(source).toContain("if (character && unscopedKeys(patch).length > 0)");
    expect(source).toContain("That setting is shared by all characters. Choose All characters at the top to change it.");
  });

  test("shared settings are locked by the one key list, with a note; Reset defaults stays shared", () => {
    expect(source).toContain("controlIsPerCharacter(control.name)");
    expect(source).toContain('child.setAttribute("inert", "");');
    expect(source).toContain("Shared by all characters. Choose All characters at the top to change these.");
    expect(source).toContain('{ id: "maintenance", sharedOnly: true,');
    expect(source).not.toMatch(/const [A-Z_]*CHARACTER[A-Z_]* = \[/);
  });

  test("own values get a marker and a way back; the whole character has one too, confirmed by a second click", () => {
    expect(source).toContain("Only for ${view.name}");
    expect(source).toContain("${view.name} has its own value");
    expect(source).toContain('button.textContent = "Use shared";');
    expect(source).toContain("button.dataset.useShared = key;");
    expect(source).toContain("clear.textContent = `Use shared settings for ${view.name}`;");
    expect(source).toContain("Confirm: use shared settings for ${view.name}?");
    expect(source).toContain("this.options.onResetCharacter(view.characterId, keys);");
  });

  test("another character starts on All characters; the setup guide waits in \"<name> only\"", () => {
    expect(source).toContain('if (!scope || scope.characterId !== this.scopeView?.characterId) this.editing = "shared";');
    expect(source).toContain("card.hidden = characterScope || this.sessionSetupHidden || this.setupDone();");
  });
});
