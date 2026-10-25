import {
  characterOverrideWith,
  characterOverrideWithout,
  effectiveConfig,
  isCharacterScopedKey,
  type CharacterConfigOverride,
  type VisualNovelConfig,
} from "../../config.js";
import type { CharacterConfigView } from "../../protocol.js";

/**
 * Settings saved per character, on the frontend side: the open chat's config
 * and the two layers it is made of (the shared settings, and its character's
 * own values on top), kept in step with the backend's `vn_state` and
 * `vn_config` and with saves made before the backend answers.
 */

/** What Settings needs to offer "<name> only". */
export type CharacterScopeView = {
  characterId: string;
  name: string;
  shared: VisualNovelConfig;
  overrides: CharacterConfigOverride;
};

/** The config the open chat uses, and its layers while it has a character. */
export type ConfigLayers = { config: VisualNovelConfig; scope: CharacterConfigView | null };

type ConfigMessage = { config: VisualNovelConfig; chatId?: string; characterScope?: CharacterConfigView | null };

/**
 * The layers after a `vn_state` or `vn_config` while `openChatId` is open.
 * A message with layers for the open chat replaces both. A message without
 * layers carries the shared settings alone (System One key flows, an older
 * backend): the character's own values already known stay on top. A message
 * meant for another chat (the reader switched meanwhile) only brings its
 * shared layer.
 */
export function layersFromBackend(previous: ConfigLayers | null, message: ConfigMessage, openChatId: string): ConfigLayers {
  const scope = message.characterScope;
  if (scope !== undefined) {
    const forChat = scope ? scope.chatId : message.chatId;
    if (forChat === undefined || forChat === openChatId) return { config: message.config, scope };
    return rebased(previous, scope ? scope.shared : message.config, openChatId);
  }
  return rebased(previous, message.config, openChatId);
}

function rebased(previous: ConfigLayers | null, shared: VisualNovelConfig, openChatId: string): ConfigLayers {
  const keep = previous?.scope && previous.scope.chatId === openChatId ? previous.scope : null;
  if (!keep) return { config: shared, scope: null };
  return { config: effectiveConfig(shared, keep.overrides), scope: { ...keep, shared } };
}

/**
 * The layers right after a save, before the backend answers. A save for the
 * character changes its own values (one that matches the shared value again
 * is dropped); a shared save changes the shared layer, under any own values.
 */
export function layersAfterSave(layers: ConfigLayers, patch: Partial<VisualNovelConfig>, forCharacter: boolean): ConfigLayers {
  const scope = layers.scope;
  if (!scope) return { config: { ...layers.config, ...patch }, scope: null };
  if (forCharacter) {
    const overrides = characterOverrideWith(scope.shared, scope.overrides, patch);
    return { config: effectiveConfig(scope.shared, overrides), scope: { ...scope, overrides } };
  }
  const shared = { ...scope.shared, ...patch };
  return { config: effectiveConfig(shared, scope.overrides), scope: { ...scope, shared } };
}

/** The layers right after "Use shared" (`keys`) or "Use shared settings for <name>" (no keys). */
export function layersAfterReset(layers: ConfigLayers, keys?: readonly string[]): ConfigLayers {
  const scope = layers.scope;
  if (!scope) return layers;
  const overrides = characterOverrideWithout(scope.overrides, keys);
  return { config: effectiveConfig(scope.shared, overrides), scope: { ...scope, overrides } };
}

/** Another chat opened: until its state arrives, the shared settings apply and no character scope is offered. */
export function layersOnChatSwitch(layers: ConfigLayers | null): ConfigLayers | null {
  if (!layers?.scope) return layers;
  return { config: layers.scope.shared, scope: null };
}

/** The scope Settings shows for these layers (null: only the shared settings). */
export function scopeViewOf(layers: ConfigLayers | null): CharacterScopeView | null {
  const scope = layers?.scope;
  return scope ? { characterId: scope.characterId, name: scope.name, shared: scope.shared, overrides: scope.overrides } : null;
}

/**
 * The config key a Settings control edits. Most controls are named after
 * their key; the step choices beside a number field and the setup guide's
 * theme tiles edit another control's key.
 */
const CONTROL_KEYS: Readonly<Record<string, string>> = {
  textSpeedStep: "textSpeed",
  autoPlayStep: "autoPlayDelay",
  textScaleStep: "textScale",
  setupThemePreset: "themePreset",
};

export function settingKeyForControl(name: string): string {
  return CONTROL_KEYS[name] ?? name;
}

/** Whether a Settings control edits a setting one character can have of its own. */
export function controlIsPerCharacter(name: string): boolean {
  return isCharacterScopedKey(settingKeyForControl(name));
}

/** The short line under the scope switch. */
export function scopeHelp(view: CharacterScopeView, editing: "shared" | "character"): string {
  if (editing === "character") return `Changes here are saved for ${view.name} only. Dimmed settings are shared by all characters.`;
  const own = Object.keys(view.overrides).length;
  if (own === 0) return "Changes here apply to every character.";
  return `Changes here apply to every character. ${view.name} keeps ${own} setting${own === 1 ? "" : "s"} of its own, marked below.`;
}
