import type { SpindleAPI } from "lumiverse-spindle-types";
import { effectiveConfig, type VisualNovelConfig } from "../../config.js";
import type { CharacterConfigView } from "../../protocol.js";
import { loadCharacterConfigs, loadConfig, usableCharacterId } from "./storage.js";

/**
 * Settings saved per character, on the backend side: which character a chat
 * belongs to, and the config the chat uses (the shared settings with that
 * character's own on top). Every place that loads the config for a chat
 * (planning, pictures, sprites, the views sent to the frontend) goes through
 * `loadChatConfig`; machine-wide reads (audio import, the System One key)
 * keep `loadConfig`.
 */

/**
 * Chat id -> character card id (null: no character, e.g. a group chat), per
 * backend and user. A chat's card does not change, so a lookup is made once.
 * Failed or missing lookups are not remembered.
 */
const chatCharacters = new WeakMap<SpindleAPI, Map<string, string | null>>();
const CHAT_CHARACTER_CACHE_LIMIT = 500;

function cacheFor(spindle: SpindleAPI): Map<string, string | null> {
  let cache = chatCharacters.get(spindle);
  if (!cache) {
    cache = new Map();
    chatCharacters.set(spindle, cache);
  }
  return cache;
}

/** The chat's character card id, or null (no chat, no character, or the host could not say). */
export async function chatCharacterId(spindle: SpindleAPI, chatId: string, userId?: string): Promise<string | null> {
  if (!chatId) return null;
  const cache = cacheFor(spindle);
  const key = `${userId ?? "owner"}:${chatId}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let chat: { character_id?: unknown } | null;
  try {
    chat = await spindle.chats.get(chatId, userId);
  } catch {
    return null;
  }
  if (!chat) return null;
  const id = usableCharacterId(chat.character_id) ? chat.character_id : null;
  cache.set(key, id);
  if (cache.size > CHAT_CHARACTER_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return id;
}

/** The chat's character (id and the card's current name), or null. */
export async function chatCharacter(spindle: SpindleAPI, chatId: string, userId?: string): Promise<{ id: string; name: string } | null> {
  const id = await chatCharacterId(spindle, chatId, userId);
  if (!id) return null;
  let name = "";
  try {
    const card = await spindle.characters.get(id, userId);
    name = typeof card?.name === "string" ? card.name.trim() : "";
  } catch {
    // The name is only a label; the stored one stands in below.
  }
  if (!name) name = (await loadCharacterConfigs(spindle, userId))[id]?.name.trim() || "This character";
  return { id, name };
}

/**
 * The config a chat uses. Without a chat, or while no character has settings
 * of its own, this is the shared config and no chat lookup is made.
 */
export async function loadChatConfig(spindle: SpindleAPI, userId: string | undefined, chatId: string | null | undefined): Promise<VisualNovelConfig> {
  if (!chatId) return loadConfig(spindle, userId);
  const [shared, characters] = await Promise.all([loadConfig(spindle, userId), loadCharacterConfigs(spindle, userId)]);
  if (Object.keys(characters).length === 0) return shared;
  const id = await chatCharacterId(spindle, chatId, userId);
  const own = id ? characters[id]?.overrides : undefined;
  return own ? effectiveConfig(shared, own) : shared;
}

/**
 * A chat's config plus the layers Settings needs for its scope switch. The
 * layers are null without a chat or without a character.
 */
export async function loadConfigScope(
  spindle: SpindleAPI,
  userId: string | undefined,
  chatId: string | null | undefined
): Promise<{ config: VisualNovelConfig; characterScope: CharacterConfigView | null }> {
  if (!chatId) return { config: await loadConfig(spindle, userId), characterScope: null };
  const [shared, characters, character] = await Promise.all([
    loadConfig(spindle, userId),
    loadCharacterConfigs(spindle, userId),
    chatCharacter(spindle, chatId, userId)
  ]);
  if (!character) return { config: shared, characterScope: null };
  const overrides = characters[character.id]?.overrides ?? {};
  return {
    config: effectiveConfig(shared, overrides),
    characterScope: { chatId, characterId: character.id, name: character.name, shared, overrides }
  };
}
