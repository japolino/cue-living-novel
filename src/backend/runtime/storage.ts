import type { SpindleAPI } from "lumiverse-spindle-types";
import { normalizeConfig, type VisualNovelConfig } from "../../config.js";
import { AssetJobSchema, SceneStateSchema, TurnPlanSchema, type AssetJob, type SceneState, type TurnPlan } from "../../shared/contracts.js";
import {
  normalizeSingleCharacter
} from "../core/visual-state.js";
import {
  SINGLE_CHARACTER_SCHEMA_VERSION,
  type SingleCharacterState
} from "../../shared/character.js";
import {
  appearanceMapKeyFor,
  characterAppearanceKey,
  distillVisualTags,
  hasIdentityDocumentNoise,
  isUsableIdentity,
  normalizeCharacterName,
  splitTags,
  toUsableTags,
  type CharacterAppearanceMap
} from "../../shared/identity.js";

export type StoredTurnRecord = {
  schemaVersion: 1;
  speaker: string;
  userSpeaker?: string;
  status: "planning" | "ready" | "failed" | "cancelled";
  plan: TurnPlan;
  jobs: AssetJob[];
  error?: string;
  updatedAt: string;
  settingsSnapshot?: Record<string, unknown>;
  attempts?: Array<{
    attemptNumber: number;
    timestamp: string;
    settings: Record<string, unknown>;
    error?: string | null;
  }>;
};

export type StoredChatState = {
  schemaVersion: 1;
  activeTurnPath: string | null;
  latestScene: SceneState | null;
  terminalContinuity: TurnPlan["terminalContinuity"] | null;
  updatedAt: string;
};

const writeTails = new Map<string, Promise<void>>();

function safeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function scopedKey(userId: string | undefined, path: string): string {
  return `${userId ?? "owner"}:${path}`;
}

async function serializedWrite(taskKey: string, writer: () => Promise<void>): Promise<void> {
  const previous = writeTails.get(taskKey) ?? Promise.resolve();
  const current = previous.then(writer, writer);
  const tail = current.then(() => undefined, () => undefined);
  writeTails.set(taskKey, tail);
  try {
    await current;
  } finally {
    if (writeTails.get(taskKey) === tail) writeTails.delete(taskKey);
  }
}

function userOptions(userId?: string): { userId: string } | undefined {
  return userId ? { userId } : undefined;
}

export function turnPath(chatId: string, messageId: string, swipeId: string | number | null): string {
  return `turns/${safeSegment(chatId)}/${safeSegment(messageId)}/${safeSegment(String(swipeId ?? 0))}.json`;
}

export function chatStatePath(chatId: string): string {
  return `chats/${safeSegment(chatId)}/state.json`;
}

/** Path of the persisted single-character visual state for a chat. */
export function singleCharacterStatePath(chatId: string): string {
  return `chats/${safeSegment(chatId)}/visual-state.json`;
}


/**
 * Migrate an arbitrary stored value into a `SingleCharacterState`.
 *
 * Handles the old `{ schemaVersion: 1, profiles }` visual-profile records (the
 * first profile, or `protagonistName` when supplied, becomes the frozen
 * protagonist; the description is split into normalized tags) as well as
 * already-migrated new-style records. `environment` overrides the stored /
 * default descriptor (e.g. the latest scene's `environment.description`).
 */
export function migrateVisualProfilesToSingleCharacter(
  raw: unknown,
  options: { protagonistName?: string; environment?: string } = {}
): SingleCharacterState {
  const normalized = normalizeSingleCharacter(raw, options.protagonistName);
  const rawTags = normalized.protagonist.tags.join(", ");
  // Old Cue builds could persist an entire markdown card as appearance. Never
  // promote that document into canonical memory; leave the name key repairable.
  const tags = hasIdentityDocumentNoise(rawTags)
    ? []
    : toUsableTags(normalized.protagonist.name, normalized.protagonist.tags);
  const state = { ...normalized, protagonist: { name: normalized.protagonist.name, tags } };
  if (options.environment && options.environment.trim()) {
    return { ...state, environment: options.environment.trim() };
  }
  return state;
}

/**
 * Load the single-character visual state for a chat, migrating any legacy
 * v1 profile record present at the path. Returns the empty state when nothing
 * is stored yet.
 */
export async function loadSingleCharacterState(
  spindle: SpindleAPI,
  chatId: string,
  userId?: string
): Promise<SingleCharacterState> {
  const raw = await spindle.userStorage.getJson<unknown>(singleCharacterStatePath(chatId), {
    fallback: null,
    ...(userOptions(userId) ?? {})
  });
  return migrateVisualProfilesToSingleCharacter(raw);
}

/**
 * Persist the single-character visual state for a chat.
 *
 * Freeze rule: once a protagonist is seeded (a non-empty `name`), later saves
 * NEVER overwrite `protagonist` — the identity block is frozen. Only
 * `environment` and `updatedAt` change on subsequent turns. A brand-new chat
 * (no stored protagonist, or a stored legacy record whose migrated protagonist
 * is empty) adopts the incoming protagonist exactly once.
 */
export async function saveSingleCharacterState(
  spindle: SpindleAPI,
  chatId: string,
  state: SingleCharacterState,
  userId?: string
): Promise<void> {
  const path = singleCharacterStatePath(chatId);
  await serializedWrite(scopedKey(userId, path), async () => {
    const existingRaw = await spindle.userStorage.getJson<unknown>(path, {
      fallback: null,
      ...(userOptions(userId) ?? {})
    });
    const existing = migrateVisualProfilesToSingleCharacter(existingRaw);
    // Freeze only a USEABLE appearance baseline. A poisoned name-only / empty
    // state is not frozen, so it can be repaired once a richer identity exists.
    const existingName = normalizeCharacterName(existing.protagonist.name);
    const existingUsable = isUsableIdentity(existingName, existing.protagonist.tags);
    const incomingName = normalizeCharacterName(state.protagonist.name);
    const incomingUsable = isUsableIdentity(incomingName, state.protagonist.tags);
    const sameCharacter = characterAppearanceKey(existingName) === characterAppearanceKey(incomingName);
    let protagonist: SingleCharacterState["protagonist"];
    if (sameCharacter && existingUsable) {
      // Continuing the same character: freeze initial seed to prevent prompt drift
      protagonist = { name: existing.protagonist.name, tags: toUsableTags(existing.protagonist.name, existing.protagonist.tags) };
    } else if (incomingUsable) {
      // New character or first usable identity: adopt incoming
      protagonist = { name: state.protagonist.name, tags: toUsableTags(state.protagonist.name, state.protagonist.tags) };
    } else if (existingUsable) {
      protagonist = { name: existing.protagonist.name, tags: toUsableTags(existing.protagonist.name, existing.protagonist.tags) };
    } else {
      // Neither source carries a real appearance baseline. Keep the existing name
      // as the memory key, but NEVER inject the name as an appearance tag.
      const name = incomingName || existingName;
      protagonist = { name, tags: [] };
    }
    await spindle.userStorage.setJson(path, {
      schemaVersion: SINGLE_CHARACTER_SCHEMA_VERSION,
      protagonist,
      environment: state.environment,
      updatedAt: new Date().toISOString()
    }, {
      indent: 2,
      ...(userOptions(userId) ?? {})
    });
  });
}

/** Path of the durable global character-appearance map (name -> canonical tags). */
export function characterAppearancePath(): string {
  return "character-appearance.json";
}

/** Marker path recording that the one-time chat-state appearance migration ran. */
export function appearanceMigrationMarkerPath(): string {
  return "character-appearance-migrated.json";
}

/** Normalize a raw stored map into usable entries only (never name-only / degraded). */
function normalizeAppearanceMap(raw: unknown): CharacterAppearanceMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const map: CharacterAppearanceMap = {};
  for (const [name, rawTags] of Object.entries(raw as Record<string, unknown>)) {
    const cleanName = normalizeCharacterName(name);
    if (typeof rawTags !== "string" || hasIdentityDocumentNoise(rawTags)) continue;
    const tags = splitTags(rawTags);
    if (!cleanName || !isUsableIdentity(cleanName, tags)) continue;
    map[name] = toUsableTags(cleanName, tags).join(", ");
  }
  return map;
}

/**
 * Load the durable global character-appearance map and run the one-time batch
 * migration/repair over existing `chats/<id>/visual-state.json` records. Inlay
 * behavior: a good baseline learned in chat A is reused exactly in chat B.
 */
export async function loadCharacterAppearance(
  spindle: SpindleAPI,
  userId?: string
): Promise<CharacterAppearanceMap> {
  const raw = await spindle.userStorage.getJson<unknown>(characterAppearancePath(), {
    fallback: {},
    ...(userOptions(userId) ?? {})
  });
  const base = normalizeAppearanceMap(raw);
  return migrateCharacterAppearanceStates(spindle, base, userId);
}

/** Persist the global character-appearance map (serialized). */
export async function saveCharacterAppearance(
  spindle: SpindleAPI,
  map: CharacterAppearanceMap,
  userId?: string
): Promise<void> {
  const path = characterAppearancePath();
  const normalized = normalizeAppearanceMap(map);
  await serializedWrite(scopedKey(userId, path), () => spindle.userStorage.setJson(path, normalized, {
    indent: 2,
    ...(userOptions(userId) ?? {})
  }));
}

/**
 * Merge a resolved single-character identity into the global map. Preserves an
 * existing usable baseline exactly; only fills missing entries or repairs
 * degraded (name-only / empty) entries. Names are memory keys, never tags.
 */
export async function mergeCharacterAppearanceFromState(
  spindle: SpindleAPI,
  state: SingleCharacterState,
  userId?: string
): Promise<void> {
  const name = normalizeCharacterName(state.protagonist.name);
  const tags = toUsableTags(name, state.protagonist.tags);
  if (!name || tags.length === 0) return;
  const path = characterAppearancePath();
  await serializedWrite(scopedKey(userId, path), async () => {
    const existingRaw = await spindle.userStorage.getJson<unknown>(path, {
      fallback: {},
      ...(userOptions(userId) ?? {})
    });
    const existing = normalizeAppearanceMap(existingRaw);
    const existingKey = appearanceMapKeyFor(existing, name);
    if (existingKey && isUsableIdentity(name, splitTags(existing[existingKey] ?? ""))) return;
    if (existingKey) delete existing[existingKey];
    existing[name] = tags.join(", ");
    await spindle.userStorage.setJson(path, existing, {
      indent: 2,
      ...(userOptions(userId) ?? {})
    });
  });
}

/**
 * Merge planner-extracted characters into the durable global appearance map.
 * Ensures characters introduced across scenes are remembered for subsequent turns.
 */
export async function mergePlannerCharacters(
  spindle: SpindleAPI,
  characters: Array<{ name: string; description: string }>,
  userId?: string
): Promise<void> {
  if (!characters || characters.length === 0) return;
  const path = characterAppearancePath();
  await serializedWrite(scopedKey(userId, path), async () => {
    const existingRaw = await spindle.userStorage.getJson<unknown>(path, {
      fallback: {},
      ...(userOptions(userId) ?? {})
    });
    const existing = normalizeAppearanceMap(existingRaw);
    let changed = false;
    for (const char of characters) {
      const name = normalizeCharacterName(char.name);
      if (!name) continue;
      const key = characterAppearanceKey(name);
      if (!key) continue;
      const tags = distillVisualTags(char.description);
      if (tags.length === 0) continue;
      const existingKey = appearanceMapKeyFor(existing, name);
      if (!existingKey || !isUsableIdentity(name, splitTags(existing[existingKey] ?? ""))) {
        if (existingKey) delete existing[existingKey];
        existing[name] = tags.join(", ");
        changed = true;
      }
    }
    if (changed) {
      await spindle.userStorage.setJson(path, existing, {
        indent: 2,
        ...(userOptions(userId) ?? {})
      });
    }
  });
}


/**
 * One-time batch migration/repair. Lists every `chats/<id>/visual-state.json`,
 * selects the richest usable identity per character name, merges it into (and
 * never degrades) the global map, and repairs poisoned name-only chat states.
 * Safe to call repeatedly; guarded by a persisted marker.
 */
export async function migrateCharacterAppearanceStates(
  spindle: SpindleAPI,
  base: CharacterAppearanceMap,
  userId?: string
): Promise<CharacterAppearanceMap> {
  const markerPath = appearanceMigrationMarkerPath();
  let marked = false;
  try {
    marked = await spindle.userStorage.getJson<boolean>(markerPath, {
      fallback: false,
      ...(userOptions(userId) ?? {})
    });
  } catch {
    marked = false;
  }
  if (marked) return base;

  let chatPaths: string[] = [];
  if (typeof spindle.userStorage.list === "function") {
    try {
      const listed = await spindle.userStorage.list("chats/", userId);
      chatPaths = (Array.isArray(listed) ? listed : []).filter((file) => file.endsWith("visual-state.json"));
    } catch {
      chatPaths = [];
    }
  }

  const candidates = new Map<string, { name: string; tags: string[] }>();
  for (const [name, rawTags] of Object.entries(base)) {
    const key = characterAppearanceKey(name);
    const tags = splitTags(rawTags);
    if (key && isUsableIdentity(name, tags)) candidates.set(key, { name, tags });
  }
  const chatStates = new Map<string, SingleCharacterState>();
  for (const file of chatPaths) {
    let raw: unknown;
    try {
      raw = await spindle.userStorage.getJson<unknown>(file, {
        fallback: null,
        ...(userOptions(userId) ?? {})
      });
    } catch {
      continue;
    }
    const state = migrateVisualProfilesToSingleCharacter(raw);
    chatStates.set(file, state);
    const key = characterAppearanceKey(state.protagonist.name);
    if (!key || !isUsableIdentity(state.protagonist.name, state.protagonist.tags)) continue;
    const tags = toUsableTags(state.protagonist.name, state.protagonist.tags);
    const existing = candidates.get(key);
    if (!existing || tags.length > existing.tags.length) {
      candidates.set(key, { name: state.protagonist.name, tags });
    }
  }

  const next: CharacterAppearanceMap = {};
  for (const [, candidate] of candidates) {
    if (candidate.tags.length) next[candidate.name] = candidate.tags.join(", ");
  }
  for (const [name, tags] of Object.entries(base)) {
    const key = characterAppearanceKey(name);
    if (!next[key]) next[name] = tags;
  }

  // Repair poisoned chat states with the richest usable baseline per name.
  for (const [file, state] of chatStates) {
    if (isUsableIdentity(state.protagonist.name, state.protagonist.tags)) continue;
    const key = characterAppearanceKey(state.protagonist.name);
    const best = candidates.get(key);
    if (!best || best.tags.length === 0) continue;
    await serializedWrite(scopedKey(userId, file), () => spindle.userStorage.setJson(file, {
      schemaVersion: SINGLE_CHARACTER_SCHEMA_VERSION,
      protagonist: { name: best.name, tags: [...best.tags] },
      environment: state.environment,
      updatedAt: new Date().toISOString()
    }, {
      indent: 2,
      ...(userOptions(userId) ?? {})
    }));
  }

  if (JSON.stringify(next) !== JSON.stringify(base)) {
    await saveCharacterAppearance(spindle, next, userId);
  }
  await serializedWrite(scopedKey(userId, markerPath), () => spindle.userStorage.setJson(markerPath, true, {
    indent: 2,
    ...(userOptions(userId) ?? {})
  }));
  return next;
}

export async function loadConfig(spindle: SpindleAPI, userId?: string): Promise<VisualNovelConfig> {
  const raw = await spindle.userStorage.getJson<unknown>("config.json", {
    fallback: {},
    ...(userOptions(userId) ?? {})
  });
  return normalizeConfig(raw);
}

export async function updateConfig(
  spindle: SpindleAPI,
  patch: Partial<VisualNovelConfig>,
  userId?: string
): Promise<VisualNovelConfig> {
  const current = await loadConfig(spindle, userId);
  const next = normalizeConfig({ ...current, ...patch });
  await serializedWrite(scopedKey(userId, "config.json"), () => spindle.userStorage.setJson("config.json", next, {
    indent: 2,
    ...(userOptions(userId) ?? {})
  }));
  return next;
}

export async function loadChatState(spindle: SpindleAPI, chatId: string, userId?: string): Promise<StoredChatState> {
  const raw = await spindle.userStorage.getJson<Partial<StoredChatState>>(chatStatePath(chatId), {
    fallback: {},
    ...(userOptions(userId) ?? {})
  });
  return {
    schemaVersion: 1,
    activeTurnPath: typeof raw.activeTurnPath === "string" ? raw.activeTurnPath : null,
    latestScene: raw.latestScene ? SceneStateSchema.parse(raw.latestScene) : null,
    terminalContinuity: raw.terminalContinuity ? TurnPlanSchema.shape.terminalContinuity.parse(raw.terminalContinuity) : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString()
  };
}

export async function saveChatState(
  spindle: SpindleAPI,
  chatId: string,
  state: StoredChatState,
  userId?: string
): Promise<void> {
  const path = chatStatePath(chatId);
  await serializedWrite(scopedKey(userId, path), () => spindle.userStorage.setJson(path, state, {
    indent: 2,
    ...(userOptions(userId) ?? {})
  }));
}

export async function loadTurnRecord(
  spindle: SpindleAPI,
  path: string | null,
  userId?: string
): Promise<StoredTurnRecord | null> {
  if (!path) return null;
  const raw = await spindle.userStorage.getJson<Partial<StoredTurnRecord> | null>(path, {
    fallback: null,
    ...(userOptions(userId) ?? {})
  });
  if (!raw?.plan || typeof raw.speaker !== "string") return null;
  const status = raw.status === "planning" || raw.status === "failed" || raw.status === "cancelled" ? raw.status : "ready";
  return {
    schemaVersion: 1,
    speaker: raw.speaker,
    status,
    plan: TurnPlanSchema.parse(raw.plan),
    jobs: Array.isArray(raw.jobs) ? raw.jobs.map((job) => AssetJobSchema.parse(job)) : [],
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
    ...(raw.settingsSnapshot && typeof raw.settingsSnapshot === "object" ? { settingsSnapshot: raw.settingsSnapshot as Record<string, unknown> } : {}),
    ...(Array.isArray(raw.attempts) ? { attempts: raw.attempts as NonNullable<StoredTurnRecord["attempts"]> } : {}),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString()
  };
}

export async function saveTurnRecord(
  spindle: SpindleAPI,
  path: string,
  record: StoredTurnRecord,
  userId?: string
): Promise<void> {
  await serializedWrite(scopedKey(userId, path), () => spindle.userStorage.setJson(path, record, {
    indent: 2,
    ...(userOptions(userId) ?? {})
  }));
}

/* ------------------------------------------------------------------ *
 * Character reference portraits (image anchoring).
 * ------------------------------------------------------------------ */

/** A stored canonical reference portrait for one character in one chat. */
export type StoredPortrait = {
  /** Display name at capture time (the map key is the case-insensitive form). */
  name: string;
  /** Persisted Lumiverse image ID of the canonical portrait. */
  imageId: string;
  /** Raw base64 image bytes (no data-URL prefix). */
  data: string;
  mimeType: string;
  createdAt: string;
  /** Source prompt used when capturing this portrait, for provenance. */
  prompt?: string;
};

export type PortraitRecord = {
  schemaVersion: 1;
  portraits: Record<string /* characterAppearanceKey */, StoredPortrait>;
  updatedAt: string;
};

/** Path of the per-chat canonical portrait store. */
export function portraitStatePath(chatId: string): string {
  return `chats/${safeSegment(chatId)}/portraits.json`;
}

export const VALID_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif"
]);

function isStoredPortrait(value: unknown): value is StoredPortrait {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.name !== "string" || !record.name.trim() ||
    typeof record.imageId !== "string" || !record.imageId.trim() ||
    typeof record.data !== "string" || !record.data.trim() ||
    typeof record.mimeType !== "string" || !VALID_IMAGE_MIMES.has(record.mimeType.toLowerCase())
  ) {
    return false;
  }
  const cleanData = record.data.trim();
  return /^[A-Za-z0-9+/]+={0,2}$/.test(cleanData);
}

function normalizePortraitRecord(raw: unknown): PortraitRecord {
  const empty: PortraitRecord = { schemaVersion: 1, portraits: {}, updatedAt: new Date(0).toISOString() };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const record = raw as Record<string, unknown>;
  const source = record.portraits && typeof record.portraits === "object" && !Array.isArray(record.portraits)
    ? record.portraits as Record<string, unknown>
    : {};
  const portraits: Record<string, StoredPortrait> = {};
  for (const [rawKey, value] of Object.entries(source)) {
    const key = characterAppearanceKey(rawKey);
    if (!key || !isStoredPortrait(value)) continue;
    portraits[key] = value;
  }
  return {
    schemaVersion: 1,
    portraits,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : empty.updatedAt
  };
}

/** Load the per-chat portrait map, keyed by `characterAppearanceKey(name)`. */
export async function loadPortraits(
  spindle: SpindleAPI,
  chatId: string,
  userId?: string
): Promise<Record<string, StoredPortrait>> {
  const raw = await spindle.userStorage.getJson<unknown>(portraitStatePath(chatId), {
    fallback: null,
    ...(userOptions(userId) ?? {})
  });
  return normalizePortraitRecord(raw).portraits;
}

/**
 * Persist a canonical portrait for a character. First-wins by default: an
 * existing portrait for the same character is never overwritten unless
 * `options.replace` is true, so the anchor image stays stable for the life of
 * the chat.
 * Returns whether this portrait became the stored one.
 */
export async function savePortrait(
  spindle: SpindleAPI,
  chatId: string,
  portrait: StoredPortrait,
  userId?: string,
  options?: { replace?: boolean }
): Promise<boolean> {
  const key = characterAppearanceKey(portrait.name);
  if (!key || !isStoredPortrait(portrait)) return false;
  const path = portraitStatePath(chatId);
  let stored = false;
  await serializedWrite(scopedKey(userId, path), async () => {
    const raw = await spindle.userStorage.getJson<unknown>(path, {
      fallback: null,
      ...(userOptions(userId) ?? {})
    });
    const record = normalizePortraitRecord(raw);
    if (record.portraits[key] && !options?.replace) return;
    record.portraits[key] = portrait;
    record.updatedAt = new Date().toISOString();
    await spindle.userStorage.setJson(path, record, {
      indent: 2,
      ...(userOptions(userId) ?? {})
    });
    stored = true;
  });
  return stored;
}

/**
 * Delete a character's canonical portrait from the store, allowing it to be
 * re-seeded on subsequent generations. Returns whether a portrait was deleted.
 */
export async function deletePortrait(
  spindle: SpindleAPI,
  chatId: string,
  characterName: string,
  userId?: string
): Promise<boolean> {
  const key = characterAppearanceKey(characterName);
  if (!key) return false;
  const path = portraitStatePath(chatId);
  let deleted = false;
  await serializedWrite(scopedKey(userId, path), async () => {
    const raw = await spindle.userStorage.getJson<unknown>(path, {
      fallback: null,
      ...(userOptions(userId) ?? {})
    });
    const record = normalizePortraitRecord(raw);
    if (!record.portraits[key]) return;
    delete record.portraits[key];
    record.updatedAt = new Date().toISOString();
    await spindle.userStorage.setJson(path, record, {
      indent: 2,
      ...(userOptions(userId) ?? {})
    });
    deleted = true;
  });
  return deleted;
}

/**
 * Reset all stored canonical portraits for a chat.
 */
export async function resetPortraits(
  spindle: SpindleAPI,
  chatId: string,
  userId?: string
): Promise<void> {
  const path = portraitStatePath(chatId);
  await serializedWrite(scopedKey(userId, path), async () => {
    await spindle.userStorage.setJson(path, {
      schemaVersion: 1,
      portraits: {},
      updatedAt: new Date().toISOString()
    }, {
      indent: 2,
      ...(userOptions(userId) ?? {})
    });
  });
}
