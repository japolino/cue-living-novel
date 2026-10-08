import type { SpindleAPI } from "lumiverse-spindle-types";
import { z } from "zod";
import {
  SPRITE_HOT_SET,
  type SpriteCastMember,
  type SpriteImageStatus,
  type SpritePlateRef,
} from "../../../shared/sprites.js";
import { spriteSeedFor, spriteSetSeedFor } from "./style.js";

/**
 * The per-user sprite library: sprite sets (one cut-out per expression for a
 * character + outfit + image style) and background plates. One JSON index in
 * `spindle.userStorage`, shared by every chat of the user and bounded to the
 * newest sets and plates (by last use).
 *
 * The library is also the work queue: an image in status "queued" is wanted,
 * "generating" is (or was, before a restart) in the provider, "cutting" waits
 * for the browser cut-out. See jobs.ts.
 */

export const SPRITE_LIBRARY_PATH = "sprites/library.json";
export const SPRITE_LIBRARY_VERSION = 1 as const;
export const MAX_SPRITE_SETS = 64;
export const MAX_SPRITE_PLATES = 128;

const StatusSchema = z.enum(["missing", "queued", "generating", "cutting", "ready", "failed"]);
const Id = z.string().trim().min(1).max(512);
const Stamp = z.string().min(1).max(64);
const BboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const StoredSpriteImageSchema = z.object({
  expression: z.string().trim().min(1).max(80),
  status: StatusSchema,
  rawImageId: Id.nullable().default(null),
  rawImageUrl: z.string().min(1).max(2048).nullable().default(null),
  cutImageId: Id.nullable().default(null),
  cutUrl: z.string().min(1).max(2048).nullable().default(null),
  bbox: BboxSchema.nullable().default(null),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  quality: z.enum(["best", "basic"]).nullable().default(null),
  /**
   * A "basic" cut made while "best" was selected (the model was not ready)
   * is re-cut once, silently, from the raw render: "pending" until that cut
   * settles, then "done" (never retried again).
   */
  upgrade: z.enum(["pending", "done"]).nullable().default(null),
  error: z.string().max(2000).nullable().default(null),
  /** Finished provider generations (success or failure); varies the regeneration seed. */
  attempts: z.number().int().nonnegative().default(0),
  /** Cut requests that timed out for the current raw image. */
  cutAttempts: z.number().int().nonnegative().default(0),
  /** Seed of the current raw render (null: none yet, or made before seeds were recorded). */
  seed: z.number().int().nonnegative().nullable().default(null),
  /**
   * The next render uses its own seed (`spriteSeedFor(setKey, attempts)`)
   * instead of the set's shared seed: after a failure, a single-expression
   * regenerate, or an automatic retry. Stored data without the field: own
   * seed once it has been generated (the v1 rule, see normalizeSpriteLibrary).
   */
  ownSeed: z.boolean().default(false),
  /**
   * Browser duplicate check of the current cut-out ("two figures side by
   * side"); null until checked (or from a frontend without the check).
   */
  twoFigures: z.boolean().nullable().default(null),
  /** This image already had its one automatic regeneration after a flagged check. */
  autoRetried: z.boolean().default(false),
  /**
   * Face box of the current cut-out (browser face detector), normalized to
   * the whole image. null: no face found. Absent: not detected yet (older
   * data; the stage detects it once and saves it with `vn_sprite_face`).
   */
  face: BboxSchema.nullable().optional(),
  createdAt: Stamp,
  updatedAt: Stamp,
});
export type StoredSpriteImage = z.infer<typeof StoredSpriteImageSchema>;

export const StoredSpriteSetSchema = z.object({
  setKey: Id,
  styleKey: Id,
  name: z.string().trim().min(1).max(200),
  characterId: z.string().trim().min(1).max(200).optional(),
  identity: z.string().max(4000),
  attire: z.string().max(2000).nullable(),
  subjectCategory: z.enum(["female", "male", "nonbinary", "nonhuman", "unknown"]).optional(),
  /** Shared seed of the set's first renders (same pose across expressions). */
  seed: z.number().int().nonnegative(),
  /** How often the shared seed was drawn again (flagged idle, idle regenerated); 0 = the original. */
  seedRound: z.number().int().nonnegative().default(0),
  images: z.record(z.string(), z.unknown()).transform((raw) => {
    const images: Record<string, StoredSpriteImage> = {};
    for (const [key, value] of Object.entries(raw)) {
      const parsed = StoredSpriteImageSchema.safeParse(value);
      if (!parsed.success || parsed.data.expression !== key) continue;
      // v1 data: an image that was generated before regenerates with its own seed.
      if (typeof (value as { ownSeed?: unknown } | null)?.ownSeed !== "boolean") parsed.data.ownSeed = parsed.data.attempts > 0;
      images[key] = parsed.data;
    }
    return images;
  }),
  createdAt: Stamp,
  updatedAt: Stamp,
  usedAt: Stamp,
});
export type StoredSpriteSet = z.infer<typeof StoredSpriteSetSchema>;

export const StoredPlateSchema = z.object({
  plateKey: Id,
  styleKey: Id,
  location: z.string().max(1000),
  timeOfDay: z.string().max(200).nullable(),
  weather: z.string().max(200).nullable(),
  description: z.string().max(4000),
  status: StatusSchema,
  imageId: Id.nullable().default(null),
  url: z.string().min(1).max(2048).nullable().default(null),
  error: z.string().max(2000).nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
  seed: z.number().int().nonnegative(),
  createdAt: Stamp,
  updatedAt: Stamp,
  usedAt: Stamp,
});
export type StoredPlate = z.infer<typeof StoredPlateSchema>;

export type SpriteLibrary = {
  version: typeof SPRITE_LIBRARY_VERSION;
  sets: Record<string, StoredSpriteSet>;
  plates: Record<string, StoredPlate>;
  updatedAt: string;
};

export function emptySpriteLibrary(): SpriteLibrary {
  return { version: SPRITE_LIBRARY_VERSION, sets: {}, plates: {}, updatedAt: new Date(0).toISOString() };
}

/** Parse a stored library; bad entries are dropped one by one, never the whole library. */
export function normalizeSpriteLibrary(raw: unknown): SpriteLibrary {
  const library = emptySpriteLibrary();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return library;
  const record = raw as { version?: unknown; sets?: unknown; plates?: unknown; updatedAt?: unknown };
  if (record.version !== SPRITE_LIBRARY_VERSION) return library;
  if (typeof record.updatedAt === "string") library.updatedAt = record.updatedAt;
  if (record.sets && typeof record.sets === "object" && !Array.isArray(record.sets)) {
    for (const [key, value] of Object.entries(record.sets as Record<string, unknown>)) {
      const parsed = StoredSpriteSetSchema.safeParse(value);
      if (parsed.success && parsed.data.setKey === key) library.sets[key] = parsed.data;
    }
  }
  if (record.plates && typeof record.plates === "object" && !Array.isArray(record.plates)) {
    for (const [key, value] of Object.entries(record.plates as Record<string, unknown>)) {
      const parsed = StoredPlateSchema.safeParse(value);
      if (parsed.success && parsed.data.plateKey === key) library.plates[key] = parsed.data;
    }
  }
  return library;
}

export function newSpriteImage(expression: string, now: string, status: SpriteImageStatus = "missing"): StoredSpriteImage {
  return {
    expression,
    status,
    rawImageId: null,
    rawImageUrl: null,
    cutImageId: null,
    cutUrl: null,
    bbox: null,
    width: null,
    height: null,
    quality: null,
    upgrade: null,
    error: null,
    attempts: 0,
    cutAttempts: 0,
    seed: null,
    ownSeed: false,
    twoFigures: null,
    autoRetried: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function newSpriteSet(
  member: Pick<SpriteCastMember, "name" | "identity" | "attire"> & Partial<Pick<SpriteCastMember, "characterId" | "subjectCategory">>,
  setKey: string,
  styleKey: string,
  now: string,
): StoredSpriteSet {
  const images: Record<string, StoredSpriteImage> = {};
  for (const expression of SPRITE_HOT_SET) images[expression] = newSpriteImage(expression, now);
  return {
    setKey,
    styleKey,
    name: member.name.trim() || "Character",
    ...(member.characterId ? { characterId: member.characterId } : {}),
    identity: member.identity,
    attire: member.attire,
    ...(member.subjectCategory ? { subjectCategory: member.subjectCategory } : {}),
    seed: spriteSetSeedFor(setKey, 0),
    seedRound: 0,
    images,
    createdAt: now,
    updatedAt: now,
    usedAt: now,
  };
}

export function newPlate(ref: SpritePlateRef, styleKey: string, now: string): StoredPlate {
  return {
    plateKey: ref.plateKey,
    styleKey,
    location: ref.location,
    timeOfDay: ref.timeOfDay,
    weather: ref.weather,
    description: ref.description,
    status: "missing",
    imageId: null,
    url: null,
    error: null,
    attempts: 0,
    seed: spriteSeedFor(ref.plateKey),
    createdAt: now,
    updatedAt: now,
    usedAt: now,
  };
}

/** Every image id a set owns (raw renders and cut-outs). */
export function setImageIds(set: StoredSpriteSet): string[] {
  const ids: string[] = [];
  for (const image of Object.values(set.images)) {
    if (image.rawImageId) ids.push(image.rawImageId);
    if (image.cutImageId) ids.push(image.cutImageId);
  }
  return ids;
}

/** Newest first: last use, then insertion order (later insert wins a tie). */
function newestKeys<T extends { usedAt: string }>(entries: Record<string, T>): string[] {
  return Object.entries(entries)
    .map(([key, value], index) => ({ key, usedAt: Date.parse(value.usedAt) || 0, index }))
    .sort((left, right) => right.usedAt - left.usedAt || right.index - left.index)
    .map((entry) => entry.key);
}

export type PruneResult = { sets: StoredSpriteSet[]; plates: StoredPlate[] };

/** Keep the newest MAX_SPRITE_SETS sets and MAX_SPRITE_PLATES plates. Returns what was dropped. */
export function pruneSpriteLibrary(
  library: SpriteLibrary,
  limits: { sets?: number; plates?: number } = {},
): PruneResult {
  const maxSets = limits.sets ?? MAX_SPRITE_SETS;
  const maxPlates = limits.plates ?? MAX_SPRITE_PLATES;
  const dropped: PruneResult = { sets: [], plates: [] };
  const setKeys = newestKeys(library.sets);
  for (const key of setKeys.slice(maxSets)) {
    dropped.sets.push(library.sets[key]!);
    delete library.sets[key];
  }
  const plateKeys = newestKeys(library.plates);
  for (const key of plateKeys.slice(maxPlates)) {
    dropped.plates.push(library.plates[key]!);
    delete library.plates[key];
  }
  return dropped;
}

function userKey(userId: string | undefined): string {
  return userId ?? "owner";
}

/**
 * In-memory, write-through cache of each user's library. Mutations are
 * synchronous on the cached object (one load per user), and persistence is
 * serialized and coalesced: a burst of updates writes the latest state once
 * or twice, never out of order.
 */
export class SpriteLibraryStore {
  private readonly cache = new Map<string, SpriteLibrary>();
  private readonly loading = new Map<string, Promise<SpriteLibrary>>();
  private readonly writes = new Map<string, { tail: Promise<void>; pending: Promise<void> | null }>();

  constructor(
    private readonly spindle: SpindleAPI,
    private readonly options: { limits?: { sets?: number; plates?: number }; onPruned?: (userId: string | undefined, dropped: PruneResult) => void } = {},
  ) {}

  /** The user's library (loaded once, then served from memory). Treat as read-only outside `update`. */
  async get(userId: string | undefined): Promise<SpriteLibrary> {
    const key = userKey(userId);
    const cached = this.cache.get(key);
    if (cached) return cached;
    let pending = this.loading.get(key);
    if (!pending) {
      pending = (async () => {
        let raw: unknown = null;
        try {
          raw = await this.spindle.userStorage.getJson<unknown>(SPRITE_LIBRARY_PATH, { fallback: null, ...(userId ? { userId } : {}) });
        } catch {
          raw = null;
        }
        const library = this.cache.get(key) ?? normalizeSpriteLibrary(raw);
        this.cache.set(key, library);
        return library;
      })();
      this.loading.set(key, pending);
      pending.finally(() => { if (this.loading.get(key) === pending) this.loading.delete(key); }).catch(() => undefined);
    }
    return pending;
  }

  /**
   * Apply a synchronous mutation, prune to the bounds, and persist. Returns
   * the mutator's result once the write that includes it has landed.
   */
  async update<T>(userId: string | undefined, mutate: (library: SpriteLibrary, now: string) => T): Promise<T> {
    const library = await this.get(userId);
    const now = new Date().toISOString();
    const result = mutate(library, now);
    library.updatedAt = now;
    const dropped = pruneSpriteLibrary(library, this.options.limits);
    if (dropped.sets.length || dropped.plates.length) this.options.onPruned?.(userId, dropped);
    await this.persist(userId);
    return result;
  }

  /** Wait until every write requested so far has landed. */
  async flush(userId: string | undefined): Promise<void> {
    const entry = this.writes.get(userKey(userId));
    if (!entry) return;
    await (entry.pending ?? entry.tail);
  }

  private persist(userId: string | undefined): Promise<void> {
    const key = userKey(userId);
    const entry = this.writes.get(key) ?? { tail: Promise.resolve(), pending: null };
    this.writes.set(key, entry);
    // A write that has not started yet will already carry this state.
    if (entry.pending) return entry.pending;
    const run = entry.tail.then(async () => {
      entry.pending = null;
      const library = this.cache.get(key);
      if (!library) return;
      await this.spindle.userStorage.setJson(SPRITE_LIBRARY_PATH, library, { ...(userId ? { userId } : {}) });
    });
    entry.pending = run;
    entry.tail = run.catch(() => undefined);
    return run;
  }
}
