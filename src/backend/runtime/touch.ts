import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  normalizeTouchBond,
  normalizeTouchLinePack,
  parseTouchLinePack,
  touchLineMessages,
  touchStoreKey,
  type TouchCharacterRef,
  type TouchCharacterState,
  type TouchLinePack,
  type TouchLineSubject,
} from "../../shared/touch.js";
import { chatCharacterId } from "./config-scope.js";
import { lightGoogleThinking, resolvePlannerConnection, type ResolvedPlannerConnection } from "./connections.js";
import { extractResponseContent } from "./planner.js";
import { loadConfig, scopedKey, serializedWrite, usableCharacterId } from "./storage.js";

/**
 * Touch mode on the backend (docs/SPRITE_MODE.md, "Touch"): each
 * character's bond meter and in-character line pack, saved per character
 * card in their own file. Only the stage reads them (`vn_touch_*`): the
 * planner, the story and the prompts never do (touch.test.ts checks no
 * story module imports this one).
 *
 * File: `{ schemaVersion: 1, characters: { "<store key>": { name, bond, pack, packAt, updatedAt } } }`,
 * keyed by `touchStoreKey` (the character's card, or its name under the
 * chat's card).
 *
 * The line pack is one model call per character on the story reader's
 * connection, made once and cached; Refresh makes it again. Calls for the
 * same character while one runs share it.
 */

export const TOUCH_STORE_PATH = "touch-characters.json";
export const TOUCH_STORE_SCHEMA_VERSION = 1 as const;
/** At most this many characters are kept (the least recently touched go first). */
export const TOUCH_STORE_LIMIT = 300;
/** Output budget of the line-pack call (about 65 short lines of JSON). */
export const TOUCH_LINES_MAX_TOKENS = 1500;

export type StoredTouchCharacter = {
  name: string;
  bond: number;
  pack: TouchLinePack | null;
  /** When the pack was made. */
  packAt?: string;
  updatedAt: string;
};

const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

/** Entries with a usable key; bad bonds become 0 and bad packs null. */
export function normalizeTouchStore(raw: unknown): Record<string, StoredTouchCharacter> {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).characters : null;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const characters: Record<string, StoredTouchCharacter> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (!key || key.length > 500 || RESERVED.has(key) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    characters[key] = {
      name: typeof entry.name === "string" ? entry.name.slice(0, 200) : "",
      bond: normalizeTouchBond(entry.bond),
      pack: normalizeTouchLinePack(entry.pack),
      ...(typeof entry.packAt === "string" ? { packAt: entry.packAt } : {}),
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date(0).toISOString(),
    };
  }
  return characters;
}

/** Keep the most recently touched `limit` characters. */
export function trimTouchStore(characters: Record<string, StoredTouchCharacter>, limit = TOUCH_STORE_LIMIT): Record<string, StoredTouchCharacter> {
  const entries = Object.entries(characters);
  if (entries.length <= limit) return characters;
  entries.sort((left, right) => right[1].updatedAt.localeCompare(left[1].updatedAt));
  return Object.fromEntries(entries.slice(0, limit));
}

const options = (userId?: string) => (userId ? { userId } : undefined);

/** Every saved character. A file that cannot be read counts as none (touch mode starts fresh). */
export async function loadTouchStore(spindle: SpindleAPI, userId?: string): Promise<Record<string, StoredTouchCharacter>> {
  try {
    return normalizeTouchStore(await spindle.userStorage.getJson<unknown>(TOUCH_STORE_PATH, { fallback: null, ...(options(userId) ?? {}) }));
  } catch {
    return {};
  }
}

/** Change one character's entry as one step per user (bond saves and new packs never overwrite each other). */
export async function changeTouchCharacter(
  spindle: SpindleAPI,
  userId: string | undefined,
  key: string,
  change: (current: StoredTouchCharacter | null) => StoredTouchCharacter | null,
): Promise<StoredTouchCharacter | null> {
  let result: StoredTouchCharacter | null = null;
  await serializedWrite(scopedKey(userId, TOUCH_STORE_PATH), async () => {
    const characters = await loadTouchStore(spindle, userId);
    const next = change(characters[key] ?? null);
    result = next ?? characters[key] ?? null;
    if (!next) return;
    characters[key] = next;
    await spindle.userStorage.setJson(TOUCH_STORE_PATH, { schemaVersion: TOUCH_STORE_SCHEMA_VERSION, characters: trimTouchStore(characters) }, {
      indent: 2,
      ...(options(userId) ?? {}),
    });
  });
  return result;
}

/** The store key of a character in a chat. */
async function storeKeyFor(spindle: SpindleAPI, userId: string | undefined, chatId: string, ref: TouchCharacterRef): Promise<string> {
  const chatCard = await chatCharacterId(spindle, chatId, userId);
  const own = ref.characterId && usableCharacterId(ref.characterId) ? ref.characterId : undefined;
  return touchStoreKey({ name: ref.name, ...(own ? { characterId: own } : {}) }, chatCard, chatId);
}

/** `vn_touch_get`: the saved bond and pack of each character (bond 0 and no pack for a new one). */
export async function touchStates(spindle: SpindleAPI, userId: string | undefined, chatId: string, refs: readonly TouchCharacterRef[]): Promise<TouchCharacterState[]> {
  const characters = await loadTouchStore(spindle, userId);
  const states: TouchCharacterState[] = [];
  for (const ref of refs) {
    const saved = characters[await storeKeyFor(spindle, userId, chatId, ref)];
    states.push({ characterKey: ref.characterKey, bond: saved?.bond ?? 0, pack: saved?.pack ?? null });
  }
  return states;
}

/** `vn_touch_bond`: save a character's bond. */
export async function saveTouchBond(spindle: SpindleAPI, userId: string | undefined, chatId: string, ref: TouchCharacterRef, bond: number): Promise<void> {
  const key = await storeKeyFor(spindle, userId, chatId, ref);
  const value = normalizeTouchBond(bond);
  await changeTouchCharacter(spindle, userId, key, (current) =>
    current?.bond === value ? null : { name: ref.name, bond: value, pack: current?.pack ?? null, ...(current?.packAt ? { packAt: current.packAt } : {}), updatedAt: new Date().toISOString() });
}

/** Card text for the line pack: description and personality, with the card's macros named. */
export function touchCardText(card: { description?: unknown; personality?: unknown } | null, name: string): string {
  if (!card) return "";
  const named = (text: unknown) => (typeof text === "string" ? text.replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, "the reader").trim() : "");
  return [named(card.description), named(card.personality)].filter(Boolean).join("\n\n");
}

/** Parameters of the line-pack call: JSON mode where the provider has one, a little warmth, a small budget. */
export function touchLineParameters(connection: ResolvedPlannerConnection | null, overrides: Record<string, unknown>): Record<string, unknown> {
  const parameters: Record<string, unknown> = { ...overrides };
  for (const key of ["response_format", "responseMimeType", "responseSchema", "max_tokens", "maxOutputTokens"]) delete parameters[key];
  const provider = connection?.provider?.toLowerCase() ?? "";
  if (provider === "google") {
    parameters.responseMimeType = "application/json";
    if (!parameters.thinkingConfig) {
      const thinking = lightGoogleThinking(connection?.model ?? "");
      if (thinking) parameters.thinkingConfig = thinking;
    }
  } else if (["openai", "custom", "openrouter", "deepseek", "moonshot", "cerebras"].includes(provider)) {
    parameters.response_format = { type: "json_object" };
  }
  return { temperature: 0.9, ...parameters, max_tokens: TOUCH_LINES_MAX_TOKENS };
}

/** Line-pack calls running now, per user and character (a second ask shares the first). */
const running = new Map<string, Promise<TouchLinePack>>();

/**
 * `vn_touch_lines`: a character's pack, from the store, or one model call
 * when there is none or `refresh` asks for new lines. Throws when the call
 * fails or answers with nothing usable (the stage keeps the generic lines).
 */
export async function touchLinePack(
  spindle: SpindleAPI,
  userId: string | undefined,
  chatId: string,
  ref: TouchCharacterRef,
  refresh: boolean,
): Promise<TouchLinePack> {
  const key = await storeKeyFor(spindle, userId, chatId, ref);
  if (!refresh) {
    const saved = (await loadTouchStore(spindle, userId))[key]?.pack;
    if (saved) return saved;
  }
  const flight = `${userId ?? "owner"}\0${key}`;
  const pending = running.get(flight);
  if (pending) return pending;
  const work = (async () => {
    const config = await loadConfig(spindle, userId);
    if (!config.spriteTouchLines) throw new Error("In-character touch lines are off in Settings.");
    let card: { description?: unknown; personality?: unknown } | null = null;
    if (ref.characterId && usableCharacterId(ref.characterId)) {
      try {
        card = await spindle.characters.get(ref.characterId, userId) as typeof card;
      } catch {
        // The name and appearance tags still make lines.
      }
    }
    const subject: TouchLineSubject = { name: ref.name, ...(ref.identity ? { identity: ref.identity } : {}), card: touchCardText(card, ref.name) };
    const connection = await resolvePlannerConnection(spindle, config, userId);
    const response = await spindle.generate.raw({
      type: "raw",
      messages: touchLineMessages(subject),
      ...(connection ? { provider: connection.provider, model: connection.model, connection_id: connection.id } : {}),
      parameters: touchLineParameters(connection, config.parserParameters),
      reasoning: { source: "off" },
      ...(userId ? { userId } : {}),
    } as Parameters<SpindleAPI["generate"]["raw"]>[0]);
    const content = extractResponseContent(response);
    const pack = typeof content === "string" ? parseTouchLinePack(content) : normalizeTouchLinePack(content);
    if (!pack) throw new Error("The model's answer had no usable lines.");
    const packAt = new Date().toISOString();
    await changeTouchCharacter(spindle, userId, key, (current) => ({
      name: ref.name, bond: current?.bond ?? 0, pack, packAt, updatedAt: packAt,
    }));
    return pack;
  })();
  running.set(flight, work);
  try {
    return await work;
  } finally {
    if (running.get(flight) === work) running.delete(flight);
  }
}
