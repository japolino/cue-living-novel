/**
 * Temporary, in-memory scene-image cache.
 *
 * Reuse-first, generate-on-miss. Keys are hashes of a *structured* identity
 * (durable character id + subject class, closed-catalogue pose id, and the
 * exact provider request: compiled positive/negative prompt, connection,
 * provider, model, user image parameters). Never the display name, the prompt
 * text alone, or the turn key.
 *
 * Episodes: every entry belongs to one physical scene episode
 * (`scene.priorSceneId ?? "initial"`, see runtime/images.ts). A speaker switch
 * keeps the episode; an accepted physical boundary (location change, major
 * time jump, environment replacement, forced) starts a new one, so leaving a
 * room and coming back never reuses the earlier visit.
 *
 * Lifetime: the backend worker process. Nothing is persisted. Entries hold
 * only pointers (image id / url / provenance), never pixels. Eviction and
 * invalidation drop the pointer and nothing else: no image is ever deleted, no
 * turn record or portrait record is touched.
 *
 * This module is dependency free (no spindle, no prompt compiler) so it can
 * be unit tested in isolation. Runtime wiring lives in `runtime/images.ts`
 * and `runtime/controller.ts`.
 */

export type SceneImageScope = string;

/**
 * Structured exact-compatibility identity. Every field participates in the
 * key: the effective structured state the compiler consumed AND the exact
 * provider request it produced. Excluded on purpose: display name alone,
 * scene/cue/job ids, turn key, paragraph index, free-form `promptDelta`,
 * `cameraLock`/`compositionLock` (never rendered into the prompt), and the
 * internal reference-portrait payload (see runtime/images.ts).
 */
export type SceneImageIdentity = {
  /** Durable identity: registry id and persisted subject class, never the display name alone. */
  subject: { characterId: string; subjectCategory: string };
  /** Resolved identity tags after the wardrobe override, plus the wardrobe itself. */
  appearance: { identity: string; attire: string };
  /** Effective environment exactly as the compiler consumed it (lighting, time, weather, changes). */
  environment: {
    location: string;
    timeWeather: string;
    lighting: string | null;
    description: string | null;
    persistentElements: readonly string[];
  };
  /** Closed-catalogue pose/expression. */
  pose: { id: string; suffix: string };
  /** Compiled bounded action/prop tag, or null. */
  action: string | null;
  /** Compiled camera framing tags. */
  framing: { framing: string; angle: string; perspective: string };
  /** Exactly what the provider receives. */
  request: {
    prompt: string;
    negativePrompt: string;
    provider: string | null;
    connectionId: string | null;
    model: string;
    /** User-supplied image parameters (config.imageParameters, incl. any user
     *  source/reference settings), hashed before the internal portrait merge. */
    parameters: Record<string, unknown>;
    promptSyntax: string;
    /** The reference-anchoring settings toggle (not the portrait itself). */
    referenceAnchoring: boolean;
  };
};

export type SceneImageProvenance = {
  provider: string | null;
  connectionId: string | null;
  model: string;
  promptFingerprint: string;
  assistantMessageId: string;
  swipeId: string | number | null;
  jobId: string;
};

export type SceneImageCacheEntry = {
  key: string;
  scope: SceneImageScope;
  episode: string;
  imageId: string;
  imageUrl: string;
  provenance: SceneImageProvenance;
  /** Approximate metadata size in bytes (UTF-16 code units of the strings). */
  bytes: number;
  createdAt: number;
  lastUsedAt: number;
  hits: number;
};

export type SceneImageMissReason =
  | "absent" | "evicted" | "invalidated" | "episode_retired" | "bypass"
  | "asset_missing" | "asset_unverifiable" | "identity_unresolved" | "portrait_capture" | "disabled";
export type SceneImageRejectReason = "stale_admission" | "aborted" | "no_image_id" | "wrong_scope";
export type SceneImageInvalidationReason =
  | "forced_regeneration" | "asset_missing" | "asset_unverifiable" | "image_deleted"
  | "scene_boundary" | "chat_switch" | "scope_cleared" | "manual";

export type SceneImageLookup =
  | { status: "hit"; entry: SceneImageCacheEntry }
  | { status: "miss"; reason: SceneImageMissReason };

export type SceneImageStoreResult =
  | { stored: true; entry: SceneImageCacheEntry; replaced: boolean }
  | { stored: false; reason: SceneImageRejectReason };

/** Opaque proof that a batch started before the latest scope change. */
export type SceneImageAdmission = { readonly scope: SceneImageScope; readonly epoch: number };

/** How an owner finished. Only an abort lets waiters re-claim. */
export type SceneImageOutcome =
  | { kind: "entry"; entry: SceneImageCacheEntry }
  | { kind: "aborted" }
  | { kind: "failed"; error: unknown }
  | { kind: "released" };

export type SceneImageClaim =
  | { role: "owner"; settle: (outcome: SceneImageOutcome) => void }
  | { role: "waiter"; promise: Promise<SceneImageOutcome> };

export type SceneImageCacheStats = {
  hits: number;
  /** Results shared from an in-flight compatible generation (waiters). */
  sharedHits: number;
  misses: Record<SceneImageMissReason, number>;
  stores: number;
  replacements: number;
  rejections: Record<SceneImageRejectReason, number>;
  invalidations: Record<SceneImageInvalidationReason, number>;
  evictions: number;
  waits: { count: number; totalMs: number };
  generationsAvoided: number;
  entries: number;
  bytes: number;
  inFlight: number;
};

export type SceneImageCacheOptions = {
  /** Maximum entries across all scopes. Default 256. */
  maxEntries?: number;
  /** Maximum approximate metadata bytes across all scopes. Default 1 MiB. */
  maxBytes?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
};

export const DEFAULT_SCENE_CACHE_MAX_ENTRIES = 256;
export const DEFAULT_SCENE_CACHE_MAX_BYTES = 1024 * 1024;
export const SCENE_CACHE_KEY_VERSION = "scene-v2";

function fnv1a(source: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    value = Math.imul(value ^ source.charCodeAt(index), 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

/** Deterministic JSON: object keys sorted recursively, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return typeof value === "undefined" ? "null" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** Namespace for one user + chat. Cross-chat reuse is never allowed. */
export function sceneImageScope(userId: string | undefined, chatId: string): SceneImageScope {
  return `${userId ?? "owner"}:${chatId}`;
}

/**
 * Physical scene episode of a scene. The planner gives speaker-switch scenes a
 * new `sceneId` but an inherited `priorSceneId`; only an accepted physical
 * boundary points `priorSceneId` at the scene that was left. The first scene
 * of a chat has no prior scene.
 */
export function sceneEpisodeOf(scene: { priorSceneId?: string | null | undefined }, scopeGeneration = 0): string {
  return scene.priorSceneId?.trim() || `initial:${scopeGeneration}`;
}

/**
 * Hash the structured identity. Two hashes of the canonical JSON (forward and
 * reversed) keep the key short while making accidental collisions unlikely;
 * the version tag lets a future key layout change invalidate old entries.
 */
export function sceneImageCacheKey(identity: SceneImageIdentity): string {
  const canonical = canonicalJson(identity);
  return `${SCENE_CACHE_KEY_VERSION}:${fnv1a(canonical)}${fnv1a(canonical.split("").reverse().join(""))}:${canonical.length.toString(16)}`;
}

function entryBytes(scope: string, key: string, episode: string, imageId: string, imageUrl: string, provenance: SceneImageProvenance): number {
  return (scope.length + key.length + episode.length + imageId.length + imageUrl.length + canonicalJson(provenance).length) * 2;
}

function emptyMisses(): Record<SceneImageMissReason, number> {
  return { absent: 0, evicted: 0, invalidated: 0, episode_retired: 0, bypass: 0, asset_missing: 0, asset_unverifiable: 0, identity_unresolved: 0, portrait_capture: 0, disabled: 0 };
}

function emptyRejections(): Record<SceneImageRejectReason, number> {
  return { stale_admission: 0, aborted: 0, no_image_id: 0, wrong_scope: 0 };
}

function emptyInvalidations(): Record<SceneImageInvalidationReason, number> {
  return { forced_regeneration: 0, asset_missing: 0, asset_unverifiable: 0, image_deleted: 0, scene_boundary: 0, chat_switch: 0, scope_cleared: 0, manual: 0 };
}

function abortError(reason: unknown): Error {
  const error = new Error(typeof reason === "string" ? reason : "Scene image wait cancelled.");
  error.name = "AbortError";
  return error;
}

type InFlight = {
  promise: Promise<SceneImageOutcome>;
  resolve: (outcome: SceneImageOutcome) => void;
  settled: boolean;
};

export class SceneImageCache {
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  /** Insertion order == LRU order (Map preserves insertion; re-insert on touch). */
  private readonly entries = new Map<string, SceneImageCacheEntry>();
  /** Keys that were present once and were dropped, with the reason. Bounded. */
  private readonly tombstones = new Map<string, "evicted" | "invalidated">();
  private readonly epochs = new Map<SceneImageScope, number>();
  /** Advances only on explicit scope release (delete/reset/chat switch); disambiguates "initial" episodes. */
  private readonly generations = new Map<SceneImageScope, number>();
  private readonly inFlight = new Map<string, InFlight>();
  private bytesUsed = 0;
  private counters = SceneImageCache.freshCounters();

  private static freshCounters() {
    return {
      hits: 0,
      sharedHits: 0,
      misses: emptyMisses(),
      stores: 0,
      replacements: 0,
      rejections: emptyRejections(),
      invalidations: emptyInvalidations(),
      evictions: 0,
      waits: { count: 0, totalMs: 0 },
      generationsAvoided: 0
    };
  }

  constructor(options: SceneImageCacheOptions = {}) {
    const maxEntries = options.maxEntries ?? DEFAULT_SCENE_CACHE_MAX_ENTRIES;
    const maxBytes = options.maxBytes ?? DEFAULT_SCENE_CACHE_MAX_BYTES;
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("Scene cache maxEntries must be a positive integer.");
    if (!Number.isFinite(maxBytes) || maxBytes < 1) throw new Error("Scene cache maxBytes must be positive.");
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.now = options.now ?? (() => Date.now());
  }

  /* ---------------------------------------------------------------- *
   * Admission epochs (late results must not populate the active cache)
   * ---------------------------------------------------------------- */

  epoch(scope: SceneImageScope): number {
    return this.epochs.get(scope) ?? 0;
  }

  /** Mint an admission token for a batch that starts now. */
  admission(scope: SceneImageScope): SceneImageAdmission {
    return Object.freeze({ scope, epoch: this.epoch(scope) });
  }

  /** Whether results carrying this token may still be stored. */
  isAdmitted(token: SceneImageAdmission): boolean {
    return this.epoch(token.scope) === token.epoch;
  }

  /**
   * Advance the scope epoch. Every token minted before this call is stale.
   * Existing entries are NOT dropped: episodes and explicit invalidation own that.
   */
  bumpEpoch(scope: SceneImageScope, _reason?: string): number {
    const next = this.epoch(scope) + 1;
    this.epochs.set(scope, next);
    return next;
  }

  /* ---------------------------------------------------------------- *
   * Lookup / store
   * ---------------------------------------------------------------- */

  private composite(scope: SceneImageScope, key: string): string {
    return `${scope}\u0000${key}`;
  }

  /** Read without touching LRU order or counters. */
  peek(scope: SceneImageScope, key: string): SceneImageCacheEntry | null {
    return this.entries.get(this.composite(scope, key)) ?? null;
  }

  /**
   * Reuse-first read. A hit refreshes LRU order and counts as a generation
   * avoided. An entry from another physical scene episode is retired on sight.
   */
  lookup(scope: SceneImageScope, key: string, episode: string): SceneImageLookup {
    const composite = this.composite(scope, key);
    const entry = this.entries.get(composite);
    if (!entry) {
      const reason = this.tombstones.get(composite) ?? "absent";
      this.counters.misses[reason] += 1;
      return { status: "miss", reason };
    }
    if (entry.episode !== episode) {
      this.drop(composite, entry, "invalidated");
      this.counters.invalidations.scene_boundary += 1;
      this.counters.misses.episode_retired += 1;
      return { status: "miss", reason: "episode_retired" };
    }
    entry.hits += 1;
    entry.lastUsedAt = this.now();
    this.entries.delete(composite);
    this.entries.set(composite, entry);
    this.counters.hits += 1;
    this.counters.generationsAvoided += 1;
    return { status: "hit", entry };
  }

  /** Record a miss decided outside the cache (bypass, asset checks) so stats stay complete. */
  recordMiss(reason: SceneImageMissReason): void {
    this.counters.misses[reason] += 1;
  }

  /** A waiter received the owner's fresh result: a generation avoided without a lookup hit. */
  recordHitShared(): void {
    this.counters.sharedHits += 1;
    this.counters.generationsAvoided += 1;
  }

  /** Undo the "generation avoided" credit when a hit was later rejected (missing asset). */
  revokeHit(): void {
    if (this.counters.generationsAvoided > 0) this.counters.generationsAvoided -= 1;
    if (this.counters.hits > 0) this.counters.hits -= 1;
  }

  /**
   * Store a successful normal generation. Refused when the admission token is
   * stale (scene/chat/swipe/regen changed since the batch started), when the
   * signal is aborted, or when the result has no image id.
   */
  store(
    scope: SceneImageScope,
    key: string,
    value: { imageId: string | null | undefined; imageUrl?: string | null; episode: string; provenance: SceneImageProvenance },
    token: SceneImageAdmission,
    signal?: AbortSignal
  ): SceneImageStoreResult {
    if (token.scope !== scope) return this.reject("wrong_scope");
    if (!this.isAdmitted(token)) return this.reject("stale_admission");
    if (signal?.aborted) return this.reject("aborted");
    const imageId = value.imageId?.trim();
    if (!imageId) return this.reject("no_image_id");
    const imageUrl = value.imageUrl?.trim() || `/api/v1/images/${encodeURIComponent(imageId)}`;
    const composite = this.composite(scope, key);
    const timestamp = this.now();
    const previous = this.entries.get(composite);
    if (previous) {
      this.entries.delete(composite);
      this.bytesUsed -= previous.bytes;
    }
    const entry: SceneImageCacheEntry = {
      key,
      scope,
      episode: value.episode,
      imageId,
      imageUrl,
      provenance: { ...value.provenance },
      bytes: entryBytes(scope, key, value.episode, imageId, imageUrl, value.provenance),
      createdAt: timestamp,
      lastUsedAt: timestamp,
      hits: 0
    };
    this.entries.set(composite, entry);
    this.bytesUsed += entry.bytes;
    this.tombstones.delete(composite);
    this.counters.stores += 1;
    if (previous) this.counters.replacements += 1;
    this.enforceBounds(composite);
    return { stored: true, entry, replaced: Boolean(previous) };
  }

  private reject(reason: SceneImageRejectReason): SceneImageStoreResult {
    this.counters.rejections[reason] += 1;
    return { stored: false, reason };
  }

  private enforceBounds(keep: string): void {
    // Evict least recently used until within both bounds. The entry just
    // stored is kept even if it alone exceeds maxBytes, so one oversized key
    // never wedges the cache; it becomes the only entry instead.
    for (const [composite, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries && this.bytesUsed <= this.maxBytes) break;
      if (composite === keep) continue;
      this.drop(composite, entry, "evicted");
      this.counters.evictions += 1;
    }
  }

  private drop(composite: string, entry: SceneImageCacheEntry, reason: "evicted" | "invalidated"): void {
    this.entries.delete(composite);
    this.bytesUsed -= entry.bytes;
    this.tombstones.set(composite, reason);
    // Tombstones only inform miss reasons; keep them bounded.
    while (this.tombstones.size > this.maxEntries * 4) {
      const oldest = this.tombstones.keys().next().value;
      if (oldest === undefined) break;
      this.tombstones.delete(oldest);
    }
  }

  /* ---------------------------------------------------------------- *
   * Invalidation (never deletes images)
   * ---------------------------------------------------------------- */

  invalidate(scope: SceneImageScope, key: string, reason: SceneImageInvalidationReason = "manual"): boolean {
    const composite = this.composite(scope, key);
    const entry = this.entries.get(composite);
    if (!entry) return false;
    this.drop(composite, entry, "invalidated");
    this.counters.invalidations[reason] += 1;
    return true;
  }

  /** Drop every entry that points at this image id (any scope). */
  invalidateImage(imageId: string, reason: SceneImageInvalidationReason = "image_deleted"): number {
    let count = 0;
    for (const [composite, entry] of [...this.entries]) {
      if (entry.imageId !== imageId) continue;
      this.drop(composite, entry, "invalidated");
      this.counters.invalidations[reason] += 1;
      count += 1;
    }
    return count;
  }

  /**
   * Physical scene boundary: keep only the episodes an accepted plan can still
   * reach (its scenes' episodes) and retire everything else in the scope.
   */
  retainEpisodes(scope: SceneImageScope, episodes: Iterable<string>): number {
    const keep = new Set(episodes);
    let count = 0;
    for (const [composite, entry] of [...this.entries]) {
      if (entry.scope !== scope || keep.has(entry.episode)) continue;
      this.drop(composite, entry, "invalidated");
      this.counters.invalidations.scene_boundary += 1;
      count += 1;
    }
    return count;
  }

  /**
   * Scope generation: how many times this user+chat was explicitly released.
   * The runtime folds it into episodes that have no prior scene, so a chat
   * whose first scene was deleted and re-planned never shares entries with
   * the earlier "initial" lineage.
   */
  generation(scope: SceneImageScope): number {
    return this.generations.get(scope) ?? 0;
  }

  /** Drop every entry of one user+chat, advance its epoch (late results rejected) and its generation. */
  invalidateScope(scope: SceneImageScope, reason: SceneImageInvalidationReason = "scope_cleared"): number {
    this.generations.set(scope, this.generation(scope) + 1);
    let count = 0;
    for (const [composite, entry] of [...this.entries]) {
      if (entry.scope !== scope) continue;
      this.drop(composite, entry, "invalidated");
      this.counters.invalidations[reason] += 1;
      count += 1;
    }
    this.bumpEpoch(scope, reason);
    return count;
  }

  /** Drop everything, release in-flight waiters, reset counters. */
  clear(): void {
    for (const flight of this.inFlight.values()) {
      if (!flight.settled) {
        flight.settled = true;
        flight.resolve({ kind: "released" });
      }
    }
    this.inFlight.clear();
    this.entries.clear();
    this.tombstones.clear();
    this.epochs.clear();
    this.generations.clear();
    this.bytesUsed = 0;
    this.counters = SceneImageCache.freshCounters();
  }

  /* ---------------------------------------------------------------- *
   * Concurrent compatible requests: single owner, cancellation-safe waiters
   * ---------------------------------------------------------------- */

  /**
   * Claim the right to generate `key`. The first caller becomes the owner and
   * must `settle` exactly once. Later callers get a promise of the owner's
   * outcome: `entry` (use it), `aborted`/`released` (re-claim; the waiter may
   * become the new owner), or `failed` (fail once, no cascade of retries).
   * The owner's `signal` settles `aborted` immediately on abort so waiters never
   * wait on a doomed generation. A waiter's `signal` rejects its promise with an
   * AbortError.
   */
  claim(scope: SceneImageScope, key: string, signal?: AbortSignal): SceneImageClaim {
    const composite = this.composite(scope, key);
    const existing = this.inFlight.get(composite);
    if (existing && !existing.settled) {
      this.counters.waits.count += 1;
      const startedAt = this.now();
      const waited = existing.promise.then((outcome) => {
        this.counters.waits.totalMs += Math.max(0, this.now() - startedAt);
        return outcome;
      });
      if (!signal) return { role: "waiter", promise: waited };
      if (signal.aborted) return { role: "waiter", promise: Promise.reject(abortError(signal.reason)) };
      const promise = new Promise<SceneImageOutcome>((resolve, reject) => {
        const onAbort = (): void => reject(abortError(signal.reason));
        signal.addEventListener("abort", onAbort, { once: true });
        waited.then((outcome) => {
          signal.removeEventListener("abort", onAbort);
          resolve(outcome);
        }, (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        });
      });
      return { role: "waiter", promise };
    }

    let resolve!: (outcome: SceneImageOutcome) => void;
    const promise = new Promise<SceneImageOutcome>((resolvePromise) => {
      resolve = resolvePromise;
    });
    const flight: InFlight = { promise, resolve, settled: false };
    this.inFlight.set(composite, flight);
    const settle = (outcome: SceneImageOutcome): void => {
      if (flight.settled) return;
      flight.settled = true;
      if (this.inFlight.get(composite) === flight) this.inFlight.delete(composite);
      signal?.removeEventListener("abort", onOwnerAbort);
      flight.resolve(outcome);
    };
    const onOwnerAbort = (): void => settle({ kind: "aborted" });
    if (signal) {
      if (signal.aborted) {
        // Owner is already cancelled: release immediately so the next claimant owns it.
        queueMicrotask(() => settle({ kind: "aborted" }));
      } else {
        signal.addEventListener("abort", onOwnerAbort, { once: true });
      }
    }
    return { role: "owner", settle };
  }

  /** Whether a generation for this key is currently owned by someone. */
  inFlightFor(scope: SceneImageScope, key: string): boolean {
    const flight = this.inFlight.get(this.composite(scope, key));
    return Boolean(flight && !flight.settled);
  }

  /* ---------------------------------------------------------------- *
   * Inspection
   * ---------------------------------------------------------------- */

  stats(): SceneImageCacheStats {
    return {
      hits: this.counters.hits,
      sharedHits: this.counters.sharedHits,
      misses: { ...this.counters.misses },
      stores: this.counters.stores,
      replacements: this.counters.replacements,
      rejections: { ...this.counters.rejections },
      invalidations: { ...this.counters.invalidations },
      evictions: this.counters.evictions,
      waits: { ...this.counters.waits },
      generationsAvoided: this.counters.generationsAvoided,
      entries: this.entries.size,
      bytes: this.bytesUsed,
      inFlight: [...this.inFlight.values()].filter((flight) => !flight.settled).length
    };
  }

  /** Snapshot of entries (LRU order, oldest first), optionally for one scope. */
  snapshot(scope?: SceneImageScope): SceneImageCacheEntry[] {
    const list: SceneImageCacheEntry[] = [];
    for (const entry of this.entries.values()) {
      if (scope === undefined || entry.scope === scope) list.push({ ...entry, provenance: { ...entry.provenance } });
    }
    return list;
  }

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.bytesUsed;
  }

  get limits(): { maxEntries: number; maxBytes: number } {
    return { maxEntries: this.maxEntries, maxBytes: this.maxBytes };
  }
}

/** Short, log-friendly key prefix. */
export function shortSceneKey(key: string): string {
  return key.length > 26 ? `${key.slice(0, 26)}…` : key;
}
