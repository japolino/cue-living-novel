import { describe, expect, test } from "bun:test";
import { normalizeConfig } from "../../config.js";
import type { CharacterConfigView } from "../../protocol.js";
import {
  controlIsPerCharacter,
  layersAfterReset,
  layersAfterSave,
  layersFromBackend,
  layersOnChatSwitch,
  scopeHelp,
  scopeViewOf,
  settingKeyForControl,
} from "./character-scope.js";

/** The frontend's copy of the two layers: what the stage and Settings use between backend answers. */

const shared = normalizeConfig({ themePreset: "golden-hour", textSpeed: 30 });
const scope = (overrides: CharacterConfigView["overrides"] = {}, chatId = "chat-mira"): CharacterConfigView => ({
  chatId, characterId: "card-mira", name: "Mira", shared, overrides,
});
const withOwn = () => {
  const view = scope({ themePreset: "midnight-noir" });
  return { config: normalizeConfig({ ...shared, themePreset: "midnight-noir" }), scope: view };
};

describe("layers from the backend", () => {
  test("a state for the open chat brings both layers", () => {
    const layers = layersFromBackend(null, { config: withOwn().config, chatId: "chat-mira", characterScope: scope({ themePreset: "midnight-noir" }) }, "chat-mira");
    expect(layers.config.themePreset).toBe("midnight-noir");
    expect(layers.scope?.characterId).toBe("card-mira");
  });

  test("a chat without a character, or the home screen: shared only", () => {
    expect(layersFromBackend(withOwn(), { config: shared, chatId: "chat-group", characterScope: null }, "chat-group")).toEqual({ config: shared, scope: null });
    expect(layersFromBackend(withOwn(), { config: shared, chatId: "", characterScope: null }, "")).toEqual({ config: shared, scope: null });
  });

  test("a config without layers is the shared one: known own values stay on top", () => {
    const newer = normalizeConfig({ ...shared, systemOneMode: "on" });
    const layers = layersFromBackend(withOwn(), { config: newer }, "chat-mira");
    expect(layers.config.systemOneMode).toBe("on");
    expect(layers.config.themePreset).toBe("midnight-noir");
    expect(layers.scope?.shared).toBe(newer);
  });

  test("an answer for a chat that is no longer open only brings its shared layer", () => {
    const stale = layersFromBackend(withOwn(), { config: normalizeConfig({ ...shared, themePreset: "daylight" }), chatId: "chat-theo", characterScope: { ...scope({ themePreset: "daylight" }, "chat-theo"), characterId: "card-theo" } }, "chat-mira");
    expect(stale.scope?.characterId).toBe("card-mira");
    expect(stale.config.themePreset).toBe("midnight-noir");
    // Known layers for another chat are dropped.
    expect(layersFromBackend(withOwn(), { config: shared }, "chat-theo")).toEqual({ config: shared, scope: null });
  });
});

describe("layers between saves and answers", () => {
  test("a save for the character changes its own values only", () => {
    const layers = layersAfterSave(withOwn(), { textScale: 1.3 }, true);
    expect(layers.scope?.overrides).toEqual({ themePreset: "midnight-noir", textScale: 1.3 });
    expect(layers.scope?.shared).toBe(shared);
    expect(layers.config.textScale).toBe(1.3);
    // Choosing the shared value again drops the own value.
    expect(layersAfterSave(layers, { themePreset: "golden-hour" }, true).scope?.overrides).toEqual({ textScale: 1.3 });
  });

  test("a shared save changes the shared layer; an own value still wins", () => {
    const layers = layersAfterSave(withOwn(), { themePreset: "daylight", textSpeed: 45 }, false);
    expect(layers.scope?.shared.themePreset).toBe("daylight");
    expect(layers.config.themePreset).toBe("midnight-noir");
    expect(layers.config.textSpeed).toBe(45);
    // Without a character it is the old behaviour.
    expect(layersAfterSave({ config: shared, scope: null }, { textSpeed: 45 }, true).config.textSpeed).toBe(45);
  });

  test("Use shared: one setting or all", () => {
    const two = layersAfterSave(withOwn(), { textScale: 1.3 }, true);
    expect(layersAfterReset(two, ["themePreset"]).scope?.overrides).toEqual({ textScale: 1.3 });
    const none = layersAfterReset(two);
    expect(none.scope?.overrides).toEqual({});
    expect(none.config).toBe(shared);
  });

  test("a chat switch falls back to the shared settings until the new chat answers", () => {
    expect(layersOnChatSwitch(withOwn())).toEqual({ config: shared, scope: null });
    const plain = { config: shared, scope: null };
    expect(layersOnChatSwitch(plain)).toBe(plain);
    expect(layersOnChatSwitch(null)).toBeNull();
  });

  test("the scope Settings shows", () => {
    expect(scopeViewOf(withOwn())).toEqual({ characterId: "card-mira", name: "Mira", shared, overrides: { themePreset: "midnight-noir" } });
    expect(scopeViewOf({ config: shared, scope: null })).toBeNull();
    expect(scopeViewOf(null)).toBeNull();
  });
});

describe("Settings controls and their scope", () => {
  test("step choices and the setup guide's theme edit another control's setting", () => {
    expect(settingKeyForControl("textSpeedStep")).toBe("textSpeed");
    expect(settingKeyForControl("autoPlayStep")).toBe("autoPlayDelay");
    expect(settingKeyForControl("textScaleStep")).toBe("textScale");
    expect(settingKeyForControl("setupThemePreset")).toBe("themePreset");
    expect(settingKeyForControl("themePreset")).toBe("themePreset");
  });

  test("which controls a character can have of its own", () => {
    for (const name of ["themePreset", "textSpeedStep", "presentationMode", "customCss", "displayRegexRules", "innerVoices"]) expect(controlIsPerCharacter(name)).toBe(true);
    for (const name of ["imageSource", "budgetPreset", "parserConnectionId", "systemOneApiKey", "bgmVolume", "autoEnter", "promptPresetSelect", "settingsScope"]) expect(controlIsPerCharacter(name)).toBe(false);
  });

  test("the line under the switch says which characters a change reaches", () => {
    const view = scopeViewOf(withOwn())!;
    expect(scopeHelp(view, "character")).toContain("for Mira only");
    expect(scopeHelp(view, "shared")).toContain("every character");
    expect(scopeHelp(view, "shared")).toContain("Mira keeps 1 setting of its own");
    expect(scopeHelp({ ...view, overrides: {} }, "shared")).toBe("Changes here apply to every character.");
  });
});
