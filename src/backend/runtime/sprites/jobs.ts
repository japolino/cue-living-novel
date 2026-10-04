import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../../config.js";
import type { FrontendRequest } from "../../../protocol.js";
import { REFERENCE_IMAGE_MAX_BYTES } from "../../../protocol.js";
import { AssetJobSchema, type AssetJob, type AssetJobPriority } from "../../../shared/contracts.js";
import { POSE_EXPRESSION_CATALOGUE } from "../../../shared/character.js";
import {
  SPRITE_HOT_SET,
  spriteFallbackExpression,
  spriteHash,
  spriteSetKeyFor,
  type SpriteCastMember,
  type SpritePlateRef,
  type SpriteStaging,
  type SpriteTurnView,
} from "../../../shared/sprites.js";
import { AssetScheduler } from "../../core/asset-scheduler.js";
import {
  parseDataUrl,
  referenceAnchoringEnabled,
  referenceParametersFor,
  resolveImageProfile,
  splitConnectionSelection,
} from "../images.js";
import { fetchReferenceImageViaFrontend } from "../reference-source.js";
import {
  SpriteCutBridge,
  type SpriteCutOutcome,
  type SpriteCutResultMessage,
  type SpriteCutTarget,
} from "./cut-bridge.js";
import {
  newPlate,
  newSpriteImage,
  newSpriteSet,
  setImageIds,
  SpriteLibraryStore,
  type PruneResult,
  type SpriteLibrary,
  type StoredPlate,
  type StoredSpriteImage,
  type StoredSpriteSet,
} from "./library.js";
import { compilePlateRequest, compileSpriteRequest } from "./prompts.js";
import { spriteSeedFor, spriteStyleKey } from "./style.js";
import { plateView, spriteImageView, spriteLibraryView, spriteTurnView, stagingPlateKeys } from "./views.js";

/**
 * Sprite generation service (one per backend worker). The library is the
 * queue: images in "queued" (or interrupted "generating") are started on
 * the per-provider `AssetScheduler`, generated sprites go to the browser for
 * the cut-out, and every state change is broadcast to the user's frontend.
 *
 * Generation only runs while the user has a Cue view open (the same rule as
 * scene mode); closing the last view pauses the work, opening one resumes it.
 */

export type SpriteServiceDeps = {
  /** Whether the user has a Cue view open (any chat). */
  isViewOpen: (userId: string | undefined) => boolean;
  /** The chat whose view is open (only used to label relay requests). */
  openChatId?: (userId: string | undefined) => string | null;
  loadConfig: (userId: string | undefined) => Promise<VisualNovelConfig>;
  log?: (line: string, userId: string | undefined) => void;
  cutTimeoutMs?: number;
  /** Cuts in flight per user (the browser runs them one at a time anyway). */
  maxOutstandingCuts?: number;
  referenceTimeoutMs?: number;
  /** Cuts that time out this many times fail. */
  maxCutTimeouts?: number;
  libraryLimits?: { sets?: number; plates?: number };
};

export type SpriteAction = Extract<FrontendRequest, { type: "vn_sprite_action" }>;

const REFERENCE_PROVIDERS = new Set(["novelai", "comfyui", "swarmui"]);
const PRIORITY_RANK: Record<AssetJobPriority, number> = { visible: 0, next: 1, background: 2 };
const HOT_INDEX = new Map<string, number>(SPRITE_HOT_SET.map((expression, index) => [expression, index]));
const CATALOGUE_IDS = new Set(POSE_EXPRESSION_CATALOGUE.map((entry) => entry.id));
const MAX_REFERENCE_MEMO = 8;

type WorkItem =
  | { kind: "sprite"; key: string; setKey: string; expression: string }
  | { kind: "plate"; key: string; plateKey: string };

type InflightWork = WorkItem & {
  jobId: string;
  priority: AssetJobPriority;
  /** Provider image produced by this job (kept even when the job is cancelled afterwards). */
  producedImageId?: string;
  producedImageUrl?: string;
};

type UserState = {
  scheduler: AssetScheduler | null;
  providerKey: string;
  concurrency: number;
  unsubscribe: (() => void) | null;
  inflight: Map<string, InflightWork>;
  byJobId: Map<string, string>;
  wanted: Map<string, AssetJobPriority>;
  /** Work an explicit library action asked for: runs even outside sprite mode. */
  explicit: Set<string>;
  pumping: Promise<void> | null;
  repump: boolean;
};

export function spriteWorkKey(setKey: string, expression: string): string {
  return `s\u0000${setKey}\u0000${expression}`;
}

export function plateWorkKey(plateKey: string): string {
  return `p\u0000${plateKey}`;
}

function userKey(userId: string | undefined): string {
  return userId ?? "owner";
}

function higher(left: AssetJobPriority | undefined, right: AssetJobPriority): AssetJobPriority {
  return left && PRIORITY_RANK[left] <= PRIORITY_RANK[right] ? left : right;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(signal: AbortSignal): Error {
  const error = new Error(typeof signal.reason === "string" ? signal.reason : "Sprite generation cancelled.");
  error.name = "AbortError";
  return error;
}

function imageUrlFor(imageId: string): string {
  return `/api/v1/images/${encodeURIComponent(imageId)}`;
}

let jobSequence = 0;

export class SpriteService {
  readonly library: SpriteLibraryStore;
  readonly bridge: SpriteCutBridge;
  private readonly users = new Map<string, UserState>();
  private readonly references = new Map<string, { imageId: string; data: string; mimeType: string }>();
  /** Relay misses per set (raw image id + until): later expressions do not wait for the same timeout again. */
  private readonly referenceMisses = new Map<string, { imageId: string; until: number }>();
  private readonly cutTasks = new Set<Promise<void>>();

  constructor(private readonly spindle: SpindleAPI, private readonly deps: SpriteServiceDeps) {
    this.library = new SpriteLibraryStore(spindle, {
      ...(deps.libraryLimits ? { limits: deps.libraryLimits } : {}),
      onPruned: (userId, dropped) => this.onPruned(userId, dropped),
    });
    this.bridge = new SpriteCutBridge({
      send: (message, userId) => this.spindle.sendToFrontend(message, userId),
      onSettled: (userId, target, outcome) => {
        const task = this.onCutSettled(userId, target, outcome).catch((error) => {
          this.spindle.log.warn(`Sprite cut-out handling failed: ${errorText(error)}`);
        });
        this.cutTasks.add(task);
        void task.finally(() => this.cutTasks.delete(task));
      },
      ...(deps.cutTimeoutMs !== undefined ? { timeoutMs: deps.cutTimeoutMs } : {}),
    });
  }

  /* ------------------------------------------------------------------ */
  /* Queries                                                             */
  /* ------------------------------------------------------------------ */

  async turnView(userId: string | undefined, staging: SpriteStaging, config: VisualNovelConfig): Promise<SpriteTurnView> {
    return spriteTurnView(staging, await this.library.get(userId), spriteStyleKey(config));
  }

  async libraryView(userId: string | undefined): Promise<{ sets: ReturnType<typeof spriteLibraryView>["sets"]; plates: ReturnType<typeof spriteLibraryView>["plates"] }> {
    return spriteLibraryView(await this.library.get(userId));
  }

  async sendLibrary(userId: string | undefined): Promise<void> {
    const view = await this.libraryView(userId);
    this.spindle.sendToFrontend({ type: "vn_sprite_library", sets: view.sets, plates: view.plates }, userId);
  }

  /** Plates of the current image style, newest first: staging reuses them for revisits. */
  async knownPlates(userId: string | undefined, config: VisualNovelConfig): Promise<SpritePlateRef[]> {
    const library = await this.library.get(userId);
    const styleKey = spriteStyleKey(config);
    return Object.values(library.plates)
      .filter((plate) => plate.styleKey === styleKey)
      .sort((left, right) => (Date.parse(right.usedAt) || 0) - (Date.parse(left.usedAt) || 0))
      .map((plate) => ({
        plateKey: plate.plateKey,
        location: plate.location,
        timeOfDay: plate.timeOfDay,
        weather: plate.weather,
        description: plate.description,
      }));
  }

  /** In-flight generation work of a user (tests and diagnostics). */
  inflightKeys(userId: string | undefined): string[] {
    return [...(this.users.get(userKey(userId))?.inflight.keys() ?? [])];
  }

  /** Resolve once no generation, cut handling or library write is pending for the user. */
  async settle(userId: string | undefined, timeoutMs = 5000): Promise<void> {
    const started = Date.now();
    for (;;) {
      const state = this.users.get(userKey(userId));
      if (state?.pumping) await state.pumping;
      if (this.cutTasks.size) await Promise.allSettled([...this.cutTasks]);
      await this.library.flush(userId);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      const busy = Boolean(state?.pumping) || this.cutTasks.size > 0 || [...(state?.inflight.values() ?? [])].length > 0;
      if (!busy) return;
      if (Date.now() - started > timeoutMs) return;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Ensure: a staged turn wants its sets and plates                     */
  /* ------------------------------------------------------------------ */

  /**
   * Make sure every set and plate a staging uses exists in the library and
   * its missing images are queued: requested expressions (and their hot-set
   * fallbacks) "visible", rare requested expressions "next", the rest of the
   * hot set "background"; the first plate "visible", other plates "next".
   * Failed images are not retried here (regenerate does that).
   */
  async ensureForStaging(userId: string | undefined, staging: SpriteStaging, config: VisualNovelConfig): Promise<void> {
    const styleKey = spriteStyleKey(config);
    const state = this.state(userId);
    const anchoring = referenceAnchoringEnabled(config);
    const changedImages: Array<[string, StoredSpriteImage]> = [];
    const changedPlates: StoredPlate[] = [];
    await this.library.update(userId, (library, now) => {
      for (const member of staging.cast) {
        const requested: string[] = [];
        for (const paragraph of staging.paragraphs) {
          for (const actor of paragraph.actors) {
            if (actor.characterKey === member.characterKey && !requested.includes(actor.expression)) requested.push(actor.expression);
          }
        }
        const visible = new Set<string>();
        for (const expression of requested) {
          visible.add(expression);
          visible.add(spriteFallbackExpression(expression));
        }
        const priorities = new Map<string, AssetJobPriority>();
        for (const expression of SPRITE_HOT_SET) priorities.set(expression, visible.has(expression) ? "visible" : "background");
        for (const expression of requested) {
          if (!HOT_INDEX.has(expression) && CATALOGUE_IDS.has(expression)) priorities.set(expression, "next");
        }
        this.ensureSet(library, member, styleKey, now, priorities, anchoring, state, changedImages);
      }
      const plateKeys = stagingPlateKeys(staging);
      const firstPlate = staging.paragraphs.find((paragraph) => paragraph.plateKey)?.plateKey ?? plateKeys[0];
      for (const plateKey of plateKeys) {
        let plate = library.plates[plateKey];
        if (!plate) {
          const ref = staging.plates.find((candidate) => candidate.plateKey === plateKey);
          if (!ref) continue;
          plate = newPlate(ref, styleKey, now);
          library.plates[plateKey] = plate;
        }
        plate.usedAt = now;
        if (plate.status === "missing") {
          plate.status = "queued";
          plate.updatedAt = now;
          changedPlates.push(plate);
        }
        const key = plateWorkKey(plateKey);
        state.wanted.set(key, higher(state.wanted.get(key), plateKey === firstPlate ? "visible" : "next"));
      }
    });
    for (const [setKey, image] of changedImages) this.broadcastImage(userId, setKey, image);
    for (const plate of changedPlates) this.broadcastPlate(userId, plate);
    await this.pump(userId);
  }

  /**
   * Explicit "Prepare for this chat": create the sets and queue every
   * hot-set expression ("idle" first). Runs even outside sprite mode.
   */
  async prepareCast(userId: string | undefined, cast: readonly SpriteCastMember[], config: VisualNovelConfig): Promise<number> {
    const styleKey = spriteStyleKey(config);
    const state = this.state(userId);
    const anchoring = referenceAnchoringEnabled(config);
    const changedImages: Array<[string, StoredSpriteImage]> = [];
    await this.library.update(userId, (library, now) => {
      for (const member of cast) {
        const priorities = new Map<string, AssetJobPriority>();
        for (const expression of SPRITE_HOT_SET) priorities.set(expression, expression === "idle" ? "visible" : "next");
        const setKey = this.ensureSet(library, member, styleKey, now, priorities, anchoring, state, changedImages);
        for (const expression of SPRITE_HOT_SET) state.explicit.add(spriteWorkKey(setKey, expression));
      }
    });
    for (const [setKey, image] of changedImages) this.broadcastImage(userId, setKey, image);
    await this.pump(userId);
    return cast.length;
  }

  private ensureSet(
    library: SpriteLibrary,
    member: Pick<SpriteCastMember, "name" | "identity" | "attire"> & Partial<Pick<SpriteCastMember, "characterId" | "subjectCategory">>,
    styleKey: string,
    now: string,
    priorities: Map<string, AssetJobPriority>,
    anchoring: boolean,
    state: UserState,
    changed: Array<[string, StoredSpriteImage]>,
  ): string {
    const setKey = spriteSetKeyFor(member, styleKey);
    let set = library.sets[setKey];
    if (!set) {
      set = newSpriteSet(member, setKey, styleKey, now);
      library.sets[setKey] = set;
    }
    set.usedAt = now;
    let best: AssetJobPriority = "background";
    for (const [expression, priority] of priorities) {
      let image = set.images[expression];
      if (!image) {
        image = newSpriteImage(expression, now);
        set.images[expression] = image;
      }
      if (image.status === "missing") {
        image.status = "queued";
        image.updatedAt = now;
        set.updatedAt = now;
        changed.push([setKey, image]);
      }
      if (image.status === "queued" || image.status === "generating") {
        const key = spriteWorkKey(setKey, expression);
        state.wanted.set(key, higher(state.wanted.get(key), priority));
        best = higher(best, priority);
      }
    }
    // With reference anchoring every expression waits for "idle", so idle
    // goes first at the best priority any expression of the set asked for.
    if (anchoring) {
      const idle = set.images.idle;
      if (idle && (idle.status === "queued" || idle.status === "generating")) {
        const key = spriteWorkKey(setKey, "idle");
        state.wanted.set(key, higher(state.wanted.get(key), best));
      }
    }
    return setKey;
  }

  /**
   * Re-queue failed images of a staged turn (the stage's Retry in sprite
   * mode). Ready images are kept.
   */
  async retryFailed(userId: string | undefined, staging: SpriteStaging, config: VisualNovelConfig): Promise<number> {
    const styleKey = spriteStyleKey(config);
    const state = this.state(userId);
    let count = 0;
    const changedImages: Array<[string, StoredSpriteImage]> = [];
    const changedPlates: StoredPlate[] = [];
    await this.library.update(userId, (library, now) => {
      for (const member of staging.cast) {
        const set = library.sets[spriteSetKeyFor(member, styleKey)];
        if (!set) continue;
        for (const image of Object.values(set.images)) {
          if (image.status !== "failed") continue;
          const next = image.rawImageId ? "cutting" : "queued";
          const previousCut = image.cutImageId;
          this.resetImage(image, next, now);
          // A re-cut replaces (and then deletes) the previous cut-out, if any.
          if (next === "cutting") image.cutImageId = previousCut;
          state.wanted.set(spriteWorkKey(set.setKey, image.expression), "visible");
          changedImages.push([set.setKey, image]);
          count += 1;
        }
      }
      for (const plateKey of stagingPlateKeys(staging)) {
        const plate = library.plates[plateKey];
        if (!plate || plate.status !== "failed") continue;
        plate.status = "queued";
        plate.error = null;
        plate.updatedAt = now;
        state.wanted.set(plateWorkKey(plateKey), "visible");
        changedPlates.push(plate);
        count += 1;
      }
    });
    for (const [setKey, image] of changedImages) this.broadcastImage(userId, setKey, image);
    for (const plate of changedPlates) this.broadcastPlate(userId, plate);
    await this.ensureForStaging(userId, staging, config);
    return count;
  }

  /** Reset an image for new work; a "cutting" reset keeps the raw render. */
  private resetImage(image: StoredSpriteImage, status: "queued" | "cutting", now: string): void {
    image.status = status;
    if (status === "queued") {
      image.rawImageId = null;
      image.rawImageUrl = null;
    }
    image.cutImageId = null;
    image.cutUrl = null;
    image.bbox = null;
    image.width = null;
    image.height = null;
    image.quality = null;
    image.upgrade = null;
    image.error = null;
    image.cutAttempts = 0;
    image.updatedAt = now;
  }

  /* ------------------------------------------------------------------ */
  /* View gating                                                          */
  /* ------------------------------------------------------------------ */

  /** A Cue view opened: resume queued work (sprite mode only) and re-send cuts the browser may have lost. */
  async onViewOpened(userId: string | undefined): Promise<void> {
    this.bridge.resend(userId, 10_000);
    await this.queueCutUpgrades(userId);
    await this.pump(userId);
  }

  /**
   * Cut-outs made with the "basic" fallback while "best" is selected (the
   * model was not ready yet) are re-cut once from the raw render. The old
   * cut stays on stage until the new one replaces it.
   */
  async queueCutUpgrades(userId: string | undefined): Promise<number> {
    const config = await this.deps.loadConfig(userId);
    if (config.spriteCutout !== "best") return 0;
    const library = await this.library.get(userId);
    const due = Object.values(library.sets).some((set) => Object.values(set.images).some((image) => image.status === "ready" && image.quality === "basic" && image.rawImageId && image.upgrade === null));
    if (!due) return 0;
    return this.library.update(userId, (lib, now) => {
      let count = 0;
      for (const set of Object.values(lib.sets)) {
        for (const image of Object.values(set.images)) {
          if (image.status !== "ready" || image.quality !== "basic" || !image.rawImageId || image.upgrade !== null) continue;
          image.upgrade = "pending";
          image.updatedAt = now;
          count += 1;
        }
      }
      return count;
    });
  }

  /** `vn_get_state`: a reloaded frontend lost its cut requests; re-send stale ones. */
  async onStateRequested(userId: string | undefined): Promise<void> {
    this.bridge.resend(userId, 10_000);
    await this.pump(userId);
  }

  /**
   * The user's last Cue view closed: cancel queued and running generations.
   * Their images stay "queued" (still wanted) and resume on the next open;
   * a render that finishes after the cancel is still kept.
   */
  pause(userId: string | undefined, reason = "The Cue view closed."): void {
    const state = this.users.get(userKey(userId));
    if (!state?.scheduler) return;
    for (const work of state.inflight.values()) state.scheduler.cancel(work.jobId, reason);
  }

  /* ------------------------------------------------------------------ */
  /* Pump: start queued work, send pending cuts                          */
  /* ------------------------------------------------------------------ */

  pump(userId: string | undefined): Promise<void> {
    const state = this.state(userId);
    if (state.pumping) {
      state.repump = true;
      return state.pumping;
    }
    const run = (async () => {
      do {
        state.repump = false;
        try {
          await this.pumpOnce(userId, state);
        } catch (error) {
          this.spindle.log.warn(`Sprite queue failed: ${errorText(error)}`);
        }
      } while (state.repump);
    })();
    state.pumping = run.finally(() => {
      state.pumping = null;
    });
    return state.pumping;
  }

  private async pumpOnce(userId: string | undefined, state: UserState): Promise<void> {
    if (!this.deps.isViewOpen(userId)) return;
    const config = await this.deps.loadConfig(userId);
    if (!this.deps.isViewOpen(userId)) return;
    const library = await this.library.get(userId);
    const spriteMode = config.presentationMode === "sprites";
    const anchoring = referenceAnchoringEnabled(config);
    if (config.generateImages) {
      const scheduler = this.schedulerFor(userId, state, config);
      const candidates: Array<{ item: WorkItem; priority: AssetJobPriority; order: number }> = [];
      let order = 0;
      for (const set of Object.values(library.sets)) {
        const idle = set.images.idle;
        const idleBlocks = anchoring && idle !== undefined && !idle.rawImageId && (idle.status === "queued" || idle.status === "generating");
        for (const [expression, image] of Object.entries(set.images)) {
          order += 1;
          if (image.status !== "queued" && image.status !== "generating") continue;
          const key = spriteWorkKey(set.setKey, expression);
          if (state.inflight.has(key)) continue;
          if (!spriteMode && !state.explicit.has(key)) continue;
          if (expression !== "idle" && idleBlocks) continue;
          candidates.push({
            item: { kind: "sprite", key, setKey: set.setKey, expression },
            priority: state.wanted.get(key) ?? "background",
            order: order * 100 + (HOT_INDEX.get(expression) ?? 50),
          });
        }
      }
      for (const plate of Object.values(library.plates)) {
        order += 1;
        if (plate.status !== "queued" && plate.status !== "generating") continue;
        const key = plateWorkKey(plate.plateKey);
        if (state.inflight.has(key)) continue;
        if (!spriteMode && !state.explicit.has(key)) continue;
        candidates.push({ item: { kind: "plate", key, plateKey: plate.plateKey }, priority: state.wanted.get(key) ?? "next", order: order * 100 });
      }
      candidates.sort((left, right) => PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] || left.order - right.order);
      for (const candidate of candidates) this.start(userId, state, scheduler, candidate.item, candidate.priority);
      // Raise queued work a newer turn now needs sooner.
      for (const work of state.inflight.values()) {
        const wanted = state.wanted.get(work.key);
        if (wanted && PRIORITY_RANK[wanted] < PRIORITY_RANK[work.priority]) {
          if (scheduler.reprioritize(work.jobId, wanted)) work.priority = wanted;
        }
      }
    }
    this.sendPendingCuts(userId, library, state);
  }

  private sendPendingCuts(userId: string | undefined, library: SpriteLibrary, state: UserState): void {
    const limit = Math.max(1, this.deps.maxOutstandingCuts ?? 2);
    let outstanding = this.bridge.outstanding(userId).length;
    if (outstanding >= limit) return;
    const pending: Array<{ target: SpriteCutTarget; rank: number }> = [];
    for (const set of Object.values(library.sets)) {
      for (const image of Object.values(set.images)) {
        const upgrade = image.status === "ready" && image.upgrade === "pending";
        if ((image.status !== "cutting" && !upgrade) || !image.rawImageId) continue;
        if (this.bridge.isOutstanding(userId, set.setKey, image.expression)) continue;
        const wanted = state.wanted.get(spriteWorkKey(set.setKey, image.expression));
        pending.push({ target: { setKey: set.setKey, expression: image.expression, imageId: image.rawImageId }, rank: upgrade ? 4 : wanted ? PRIORITY_RANK[wanted] : 3 });
      }
    }
    pending.sort((left, right) => left.rank - right.rank);
    for (const { target } of pending) {
      if (outstanding >= limit) break;
      this.bridge.request(userId, target);
      outstanding += 1;
    }
  }

  private state(userId: string | undefined): UserState {
    const key = userKey(userId);
    let state = this.users.get(key);
    if (!state) {
      state = {
        scheduler: null,
        providerKey: "",
        concurrency: 0,
        unsubscribe: null,
        inflight: new Map(),
        byJobId: new Map(),
        wanted: new Map(),
        explicit: new Set(),
        pumping: null,
        repump: false,
      };
      this.users.set(key, state);
    }
    return state;
  }

  private schedulerFor(userId: string | undefined, state: UserState, config: VisualNovelConfig): AssetScheduler {
    const providerKey = `image:${config.imageConnectionId ?? "default"}`;
    const concurrency = Math.max(1, Math.floor(config.imageConcurrency) || 1);
    // A drained scheduler is replaced so finished jobs never accumulate.
    if (state.scheduler && state.inflight.size === 0) {
      state.unsubscribe?.();
      state.scheduler = null;
      state.byJobId.clear();
    }
    if (!state.scheduler) {
      state.scheduler = new AssetScheduler({ [providerKey]: { concurrency } });
      state.unsubscribe = state.scheduler.subscribe((job) => this.onJobEvent(userId, state, job));
      state.providerKey = providerKey;
      state.concurrency = concurrency;
    } else if (state.providerKey === providerKey && state.concurrency !== concurrency) {
      state.scheduler.setProviderPolicy(providerKey, { concurrency });
      state.concurrency = concurrency;
    }
    return state.scheduler;
  }

  private start(userId: string | undefined, state: UserState, scheduler: AssetScheduler, item: WorkItem, priority: AssetJobPriority): void {
    jobSequence += 1;
    const jobId = `${item.kind}-${jobSequence}`;
    const now = new Date().toISOString();
    const job = AssetJobSchema.parse({
      jobId,
      ownerTurnKey: {
        chatId: "cue-sprite-library",
        assistantMessageId: item.kind === "sprite" ? item.setKey : item.plateKey,
        swipeId: null,
        sourceFingerprint: `sprites-${spriteHash(item.key)}`,
        revision: 0,
      },
      sceneId: "sprite-library",
      sceneRevision: 0,
      paragraphIndex: 0,
      // Unique per job: the scheduler must never share a result between regenerations.
      promptFingerprint: `${spriteHash(jobId)}${spriteHash(item.key)}`,
      provider: state.providerKey,
      priority,
      status: "queued",
      queuedAt: now,
    });
    const work: InflightWork = { ...item, jobId, priority };
    state.inflight.set(item.key, work);
    state.byJobId.set(jobId, item.key);
    state.wanted.delete(item.key);
    const executor = (_scheduled: Readonly<AssetJob>, signal: AbortSignal) => work.kind === "sprite"
      ? this.generateSprite(userId, work, signal)
      : this.generatePlate(userId, work, signal);
    const handle = scheduler.schedule(job, executor);
    handle.promise.then(
      (settled) => this.onJobSettled(userId, state, work, settled, null),
      (error: unknown) => this.onJobSettled(userId, state, work, null, error),
    ).catch((error) => this.spindle.log.warn(`Sprite job bookkeeping failed: ${errorText(error)}`));
  }

  private onJobEvent(userId: string | undefined, state: UserState, job: Readonly<AssetJob>): void {
    if (job.status !== "generating") return;
    const key = state.byJobId.get(job.jobId);
    const work = key ? state.inflight.get(key) : undefined;
    if (!work || work.jobId !== job.jobId) return;
    void this.library.update(userId, (library, now) => {
      if (work.kind === "sprite") {
        const image = library.sets[work.setKey]?.images[work.expression];
        if (!image || image.status !== "queued") return null;
        image.status = "generating";
        image.updatedAt = now;
        return () => this.broadcastImage(userId, work.setKey, image);
      }
      const plate = library.plates[work.plateKey];
      if (!plate || plate.status !== "queued") return null;
      plate.status = "generating";
      plate.updatedAt = now;
      return () => this.broadcastPlate(userId, plate);
    }).then((broadcast) => broadcast?.()).catch(() => undefined);
  }

  /* ------------------------------------------------------------------ */
  /* Executors                                                            */
  /* ------------------------------------------------------------------ */

  private async providerFor(config: VisualNovelConfig, userId: string | undefined): Promise<{ provider: string | null; config: VisualNovelConfig }> {
    const profile = await resolveImageProfile(this.spindle, config, userId);
    const provider = profile.provider;
    if (provider === "novelai" && !config.imageModel) {
      return { provider, config: { ...config, imageModel: profile.model || "nai-diffusion-4-5-full" } };
    }
    return { provider, config };
  }

  private async generateSprite(userId: string | undefined, work: InflightWork & { kind: "sprite" }, signal: AbortSignal): Promise<{ imageId: string; imageUrl: string }> {
    const loaded = await this.deps.loadConfig(userId);
    const { provider, config } = await this.providerFor(loaded, userId);
    const library = await this.library.get(userId);
    const set = library.sets[work.setKey];
    const image = set?.images[work.expression];
    if (!set || !image) throw new Error("This sprite set is no longer in the library.");
    const seed = image.attempts > 0 ? spriteSeedFor(work.setKey, image.attempts) : set.seed;
    const request = compileSpriteRequest({ config, provider, member: set, expression: work.expression, seed });
    const anchorable = referenceAnchoringEnabled(config) && provider !== null && REFERENCE_PROVIDERS.has(provider);
    const reference = anchorable && work.expression !== "idle" ? await this.idleReference(userId, set, signal) : null;
    const base = reference && provider
      ? { ...config.imageParameters, ...referenceParametersFor(provider, reference, config) }
      : { ...config.imageParameters, ...(provider === "comfyui" && config.imageParameters.denoise === undefined ? { denoise: 0.0 } : {}) };
    const captureIdle = anchorable && work.expression === "idle";
    return this.generate(userId, work, signal, config, request, base, captureIdle ? work.setKey : null);
  }

  private async generatePlate(userId: string | undefined, work: InflightWork & { kind: "plate" }, signal: AbortSignal): Promise<{ imageId: string; imageUrl: string }> {
    const loaded = await this.deps.loadConfig(userId);
    const { provider, config } = await this.providerFor(loaded, userId);
    const library = await this.library.get(userId);
    const plate = library.plates[work.plateKey];
    if (!plate) throw new Error("This background plate is no longer in the library.");
    const seed = plate.attempts > 0 ? spriteSeedFor(work.plateKey, plate.attempts) : plate.seed;
    const request = compilePlateRequest({ config, provider, plate, seed });
    const base = { ...config.imageParameters, ...(provider === "comfyui" && config.imageParameters.denoise === undefined ? { denoise: 0.0 } : {}) };
    return this.generate(userId, work, signal, config, request, base, null);
  }

  private async generate(
    userId: string | undefined,
    work: InflightWork,
    signal: AbortSignal,
    config: VisualNovelConfig,
    request: { prompt: string; negativePrompt: string; parameters: Record<string, unknown> },
    baseParameters: Record<string, unknown>,
    captureReferenceFor: string | null,
  ): Promise<{ imageId: string; imageUrl: string }> {
    const { connectionId, workflowId } = splitConnectionSelection(config.imageConnectionId);
    const parameters = { ...baseParameters, ...request.parameters, ...(workflowId ? { workflow_id: workflowId } : {}) };
    if (signal.aborted) throw abortError(signal);
    this.deps.log?.(`sprite job ${work.jobId} ${work.kind === "sprite" ? `${work.setKey}/${work.expression}` : work.plateKey} -> generating`, userId);
    const result = await this.spindle.imageGen.generate({
      ...(connectionId ? { connection_id: connectionId } : {}),
      prompt: request.prompt,
      ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
      ...(config.imageModel ? { model: config.imageModel } : {}),
      parameters,
      includeDataUrl: captureReferenceFor !== null,
      ...(userId ? { userId } : {}),
    });
    if (!result?.imageId) throw new Error("The image provider completed without a persisted image ID.");
    const imageUrl = result.imageUrl ?? imageUrlFor(result.imageId);
    work.producedImageId = result.imageId;
    work.producedImageUrl = imageUrl;
    if (captureReferenceFor) {
      const parsed = parseDataUrl(result.imageDataUrl);
      if (parsed && Math.floor(parsed.data.length * 3 / 4) <= REFERENCE_IMAGE_MAX_BYTES) {
        this.rememberReference(captureReferenceFor, { imageId: result.imageId, ...parsed });
      }
    }
    return { imageId: result.imageId, imageUrl };
  }

  private rememberReference(setKey: string, reference: { imageId: string; data: string; mimeType: string }): void {
    this.references.delete(setKey);
    this.references.set(setKey, reference);
    while (this.references.size > MAX_REFERENCE_MEMO) {
      const oldest = this.references.keys().next().value;
      if (oldest === undefined) break;
      this.references.delete(oldest);
    }
  }

  /** The set's idle render as a reference image: memory first, else relayed by the frontend. Null when unavailable. */
  private async idleReference(userId: string | undefined, set: StoredSpriteSet, signal: AbortSignal): Promise<{ data: string; mimeType: string } | null> {
    const idle = set.images.idle;
    if (!idle?.rawImageId) return null;
    const memo = this.references.get(set.setKey);
    if (memo && memo.imageId === idle.rawImageId) return memo;
    const miss = this.referenceMisses.get(set.setKey);
    if (miss && miss.imageId === idle.rawImageId && miss.until > Date.now()) return null;
    const dataUrl = await fetchReferenceImageViaFrontend(this.spindle, {
      chatId: this.deps.openChatId?.(userId) ?? "",
      imageId: idle.rawImageId,
      characterKey: set.setKey,
      userId,
      timeoutMs: this.deps.referenceTimeoutMs ?? 15_000,
      signal,
    });
    const parsed = parseDataUrl(dataUrl ?? undefined);
    if (!parsed || Math.floor(parsed.data.length * 3 / 4) > REFERENCE_IMAGE_MAX_BYTES) {
      if (!signal.aborted) {
        this.referenceMisses.set(set.setKey, { imageId: idle.rawImageId, until: Date.now() + 5 * 60_000 });
        while (this.referenceMisses.size > 64) {
          const oldest = this.referenceMisses.keys().next().value;
          if (oldest === undefined) break;
          this.referenceMisses.delete(oldest);
        }
      }
      return null;
    }
    this.referenceMisses.delete(set.setKey);
    const reference = { imageId: idle.rawImageId, ...parsed };
    this.rememberReference(set.setKey, reference);
    return reference;
  }

  /* ------------------------------------------------------------------ */
  /* Job results                                                          */
  /* ------------------------------------------------------------------ */

  private async onJobSettled(userId: string | undefined, state: UserState, work: InflightWork, job: AssetJob | null, error: unknown): Promise<void> {
    const current = state.inflight.get(work.key)?.jobId === work.jobId;
    if (current) state.inflight.delete(work.key);
    state.byJobId.delete(work.jobId);
    try {
      const imageId = job?.status === "generated" ? job.imageId : work.producedImageId ?? null;
      const imageUrl = job?.status === "generated" ? job.imageUrl ?? (imageId ? imageUrlFor(imageId) : null) : work.producedImageUrl ?? null;
      if (!current) {
        // Deleted or regenerated while in flight: the render belongs to nobody.
        if (imageId) await this.deleteImage(userId, imageId);
        return;
      }
      if (imageId && imageUrl) {
        await this.storeGenerated(userId, work, imageId, imageUrl);
        return;
      }
      if (job?.status === "cancelled") {
        await this.library.update(userId, (library, now) => {
          if (work.kind === "sprite") {
            const image = library.sets[work.setKey]?.images[work.expression];
            if (image?.status === "generating") {
              image.status = "queued";
              image.updatedAt = now;
              return () => this.broadcastImage(userId, work.setKey, image);
            }
          } else {
            const plate = library.plates[work.plateKey];
            if (plate?.status === "generating") {
              plate.status = "queued";
              plate.updatedAt = now;
              return () => this.broadcastPlate(userId, plate);
            }
          }
          return null;
        }).then((broadcast) => broadcast?.());
        return;
      }
      const message = errorText(error ?? job?.error ?? "Image generation failed.").slice(0, 1000) || "Image generation failed.";
      this.deps.log?.(`sprite job ${work.jobId} failed: ${message}`, userId);
      const broadcast = await this.library.update(userId, (library, now) => {
        if (work.kind === "sprite") {
          const image = library.sets[work.setKey]?.images[work.expression];
          if (!image || (image.status !== "queued" && image.status !== "generating")) return null;
          image.status = "failed";
          image.error = message;
          image.attempts += 1;
          image.updatedAt = now;
          return () => this.broadcastImage(userId, work.setKey, image);
        }
        const plate = library.plates[work.plateKey];
        if (!plate || (plate.status !== "queued" && plate.status !== "generating")) return null;
        plate.status = "failed";
        plate.error = message;
        plate.attempts += 1;
        plate.updatedAt = now;
        return () => this.broadcastPlate(userId, plate);
      });
      broadcast?.();
    } finally {
      if (current) state.explicit.delete(work.key);
      void this.pump(userId);
    }
  }

  private async storeGenerated(userId: string | undefined, work: InflightWork, imageId: string, imageUrl: string): Promise<void> {
    let orphan = false;
    const broadcast = await this.library.update(userId, (library, now) => {
      if (work.kind === "sprite") {
        const set = library.sets[work.setKey];
        const image = set?.images[work.expression];
        if (!set || !image || (image.status !== "queued" && image.status !== "generating")) {
          orphan = true;
          return null;
        }
        image.status = "cutting";
        image.rawImageId = imageId;
        image.rawImageUrl = imageUrl;
        image.cutImageId = null;
        image.cutUrl = null;
        image.error = null;
        image.cutAttempts = 0;
        image.attempts += 1;
        image.updatedAt = now;
        set.updatedAt = now;
        return () => this.broadcastImage(userId, work.setKey, image);
      }
      const plate = library.plates[work.plateKey];
      if (!plate || (plate.status !== "queued" && plate.status !== "generating")) {
        orphan = true;
        return null;
      }
      plate.status = "ready";
      plate.imageId = imageId;
      plate.url = imageUrl;
      plate.error = null;
      plate.attempts += 1;
      plate.updatedAt = now;
      return () => this.broadcastPlate(userId, plate);
    });
    if (orphan) await this.deleteImage(userId, imageId);
    broadcast?.();
  }

  /* ------------------------------------------------------------------ */
  /* Cut results                                                          */
  /* ------------------------------------------------------------------ */

  /** Route one `vn_sprite_cut_result` chunk (stale and unknown ids are ignored). */
  handleCutResult(userId: string | undefined, message: SpriteCutResultMessage): void {
    this.bridge.accept(userId, message);
  }

  private async onCutSettled(userId: string | undefined, target: SpriteCutTarget, outcome: SpriteCutOutcome): Promise<void> {
    const library = await this.library.get(userId);
    const current = (): StoredSpriteImage | null => {
      const image = library.sets[target.setKey]?.images[target.expression];
      if (!image || image.rawImageId !== target.imageId) return null;
      return image.status === "cutting" || (image.status === "ready" && image.upgrade === "pending") ? image : null;
    };
    const first = current();
    if (!first) return;
    if (first.status === "ready") {
      // A silent upgrade re-cut: any failure keeps the basic cut; it is tried only once.
      if (!outcome.ok || outcome.meta.quality !== "best") {
        await this.library.update(userId, (_library, now) => {
          const image = current();
          if (!image) return;
          image.upgrade = "done";
          image.updatedAt = now;
        });
        void this.pump(userId);
        return;
      }
    }
    if (!outcome.ok) {
      const limit = this.deps.maxCutTimeouts ?? 3;
      const broadcast = await this.library.update(userId, (_library, now) => {
        const image = current();
        if (!image) return null;
        if (outcome.timedOut) {
          image.cutAttempts += 1;
          image.updatedAt = now;
          if (image.cutAttempts < limit) return null; // Stays "cutting": the next pump re-sends it.
        }
        image.status = "failed";
        image.error = outcome.timedOut ? outcome.error : `Cut-out failed: ${outcome.error}`;
        image.updatedAt = now;
        return () => this.broadcastImage(userId, target.setKey, image);
      });
      broadcast?.();
      void this.pump(userId);
      return;
    }
    let uploaded: { id: string; url: string } | null = null;
    let uploadError: string | null = null;
    try {
      const dto = await this.spindle.images.upload({
        data: outcome.png,
        filename: `cue-sprite-${target.setKey}-${target.expression}.png`,
        mime_type: "image/png",
      }, userId);
      if (!dto?.id) throw new Error("The host returned no image id.");
      uploaded = { id: dto.id, url: imageUrlFor(dto.id) };
    } catch (error) {
      uploadError = errorText(error);
    }
    let stale = false;
    let replaced: string | null = null;
    const broadcast = await this.library.update(userId, (_library, now) => {
      const image = current();
      if (!image) {
        stale = true;
        return null;
      }
      if (!uploaded && image.status === "ready") {
        image.upgrade = "done";
        image.updatedAt = now;
        return null;
      }
      if (!uploaded) {
        image.status = "failed";
        image.error = `Could not save the cut-out: ${uploadError ?? "unknown error"}`;
        image.updatedAt = now;
        return () => this.broadcastImage(userId, target.setKey, image);
      }
      replaced = image.cutImageId && image.cutImageId !== uploaded.id ? image.cutImageId : null;
      image.status = "ready";
      image.cutImageId = uploaded.id;
      image.cutUrl = uploaded.url;
      image.bbox = outcome.meta.bbox;
      image.width = outcome.meta.width;
      image.height = outcome.meta.height;
      image.quality = outcome.meta.quality;
      // A basic cut while "best" is selected gets one silent upgrade later.
      image.upgrade = image.upgrade === "pending" ? "done" : null;
      image.error = null;
      image.cutAttempts = 0;
      image.updatedAt = now;
      const set = library.sets[target.setKey];
      if (set) set.updatedAt = now;
      return () => this.broadcastImage(userId, target.setKey, image);
    });
    if (stale && uploaded) await this.deleteImage(userId, uploaded.id);
    if (replaced) await this.deleteImage(userId, replaced);
    broadcast?.();
    void this.pump(userId);
  }

  /* ------------------------------------------------------------------ */
  /* Library actions                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * Run a settings/stage library action. Always answers with the whole
   * library (`vn_sprite_library`), also after a failure (which is thrown
   * after the reply so the caller can report it).
   */
  async action(
    userId: string | undefined,
    request: SpriteAction,
    context: { config: VisualNovelConfig; castForChat?: (chatId: string) => Promise<SpriteCastMember[]> },
  ): Promise<void> {
    try {
      await this.runAction(userId, request, context);
    } finally {
      await this.sendLibrary(userId);
    }
  }

  private async runAction(
    userId: string | undefined,
    request: SpriteAction,
    context: { config: VisualNovelConfig; castForChat?: (chatId: string) => Promise<SpriteCastMember[]> },
  ): Promise<void> {
    const state = this.state(userId);
    switch (request.action) {
      case "prepare_chat": {
        if (typeof request.chatId !== "string" || !request.chatId) throw new Error("Open a chat to prepare its sprites.");
        const cast = context.castForChat ? await context.castForChat(request.chatId) : [];
        if (cast.length === 0) throw new Error("No characters with a known appearance in this chat yet.");
        await this.prepareCast(userId, cast, context.config);
        return;
      }
      case "regenerate":
      case "recut": {
        const setKey = typeof request.setKey === "string" ? request.setKey : "";
        const library = await this.library.get(userId);
        const set = library.sets[setKey];
        if (!set) throw new Error("This sprite set is no longer in the library.");
        const expressions = typeof request.expression === "string" && request.expression
          ? [request.expression]
          : Object.keys(set.images);
        if (request.action === "recut") {
          const recuttable = expressions.filter((expression) => set.images[expression]?.rawImageId);
          if (recuttable.length === 0) throw new Error("There is no generated image to cut yet. Regenerate it instead.");
          for (const expression of recuttable) this.bridge.cancel(userId, (target) => target.setKey === setKey && target.expression === expression);
          const broadcasts = await this.library.update(userId, (lib, now) => {
            const fresh = lib.sets[setKey];
            if (!fresh) return [];
            const out: Array<() => void> = [];
            for (const expression of recuttable) {
              const image = fresh.images[expression];
              if (!image?.rawImageId || state.inflight.has(spriteWorkKey(setKey, expression))) continue;
              // The old cut stays in the gallery's history until the new one replaces it.
              const keepCut = { id: image.cutImageId };
              this.resetImage(image, "cutting", now);
              image.cutImageId = keepCut.id;
              state.wanted.set(spriteWorkKey(setKey, expression), "visible");
              out.push(() => this.broadcastImage(userId, setKey, image));
            }
            return out;
          });
          for (const broadcast of broadcasts) broadcast();
          await this.pump(userId);
          return;
        }
        const doomed: string[] = [];
        for (const expression of expressions) this.forget(userId, state, spriteWorkKey(setKey, expression), setKey, expression);
        const broadcasts = await this.library.update(userId, (lib, now) => {
          const fresh = lib.sets[setKey];
          if (!fresh) return [];
          const out: Array<() => void> = [];
          for (const expression of expressions) {
            let image = fresh.images[expression];
            if (!image) {
              if (!CATALOGUE_IDS.has(expression)) continue;
              image = newSpriteImage(expression, now);
              fresh.images[expression] = image;
            }
            if (image.rawImageId) doomed.push(image.rawImageId);
            if (image.cutImageId) doomed.push(image.cutImageId);
            this.resetImage(image, "queued", now);
            const key = spriteWorkKey(setKey, expression);
            state.wanted.set(key, expressions.length === 1 || expression === "idle" ? "visible" : "next");
            state.explicit.add(key);
            out.push(() => this.broadcastImage(userId, setKey, image));
          }
          fresh.updatedAt = now;
          fresh.usedAt = now;
          return out;
        });
        // A whole-set regeneration also renews the idle reference.
        if (expressions.includes("idle")) this.references.delete(setKey);
        for (const broadcast of broadcasts) broadcast();
        for (const id of doomed) await this.deleteImage(userId, id);
        await this.pump(userId);
        return;
      }
      case "delete_set": {
        const setKey = typeof request.setKey === "string" ? request.setKey : "";
        const library = await this.library.get(userId);
        const set = library.sets[setKey];
        if (!set) throw new Error("This sprite set is no longer in the library.");
        for (const expression of Object.keys(set.images)) this.forget(userId, state, spriteWorkKey(setKey, expression), setKey, expression);
        const doomed = await this.library.update(userId, (lib) => {
          const fresh = lib.sets[setKey];
          if (!fresh) return [];
          delete lib.sets[setKey];
          return setImageIds(fresh);
        });
        this.references.delete(setKey);
        for (const id of doomed) await this.deleteImage(userId, id);
        return;
      }
      case "regenerate_plate":
      case "delete_plate": {
        const plateKey = typeof request.plateKey === "string" ? request.plateKey : "";
        const library = await this.library.get(userId);
        if (!library.plates[plateKey]) throw new Error("This background plate is no longer in the library.");
        this.forget(userId, state, plateWorkKey(plateKey), null, null);
        const result = await this.library.update(userId, (lib, now) => {
          const plate = lib.plates[plateKey];
          if (!plate) return { doomed: null as string | null, broadcast: null as (() => void) | null };
          const doomed = plate.imageId;
          if (request.action === "delete_plate") {
            delete lib.plates[plateKey];
            return { doomed, broadcast: null };
          }
          plate.status = "queued";
          plate.imageId = null;
          plate.url = null;
          plate.error = null;
          plate.attempts = Math.max(plate.attempts, 1);
          plate.updatedAt = now;
          plate.usedAt = now;
          state.wanted.set(plateWorkKey(plateKey), "visible");
          state.explicit.add(plateWorkKey(plateKey));
          return { doomed, broadcast: () => this.broadcastPlate(userId, plate) };
        });
        result.broadcast?.();
        if (result.doomed) await this.deleteImage(userId, result.doomed);
        if (request.action === "regenerate_plate") await this.pump(userId);
        return;
      }
      default:
        throw new Error("Unknown sprite library action.");
    }
  }

  /** Stop tracking (and cancel) work for an item; its late result is discarded. */
  private forget(userId: string | undefined, state: UserState, key: string, setKey: string | null, expression: string | null): void {
    const work = state.inflight.get(key);
    if (work) {
      state.inflight.delete(key);
      state.scheduler?.cancel(work.jobId, "The sprite library changed.");
    }
    state.wanted.delete(key);
    state.explicit.delete(key);
    if (setKey && expression) this.bridge.cancel(userId, (target) => target.setKey === setKey && target.expression === expression);
  }

  private onPruned(userId: string | undefined, dropped: PruneResult): void {
    const state = this.state(userId);
    const doomed: string[] = [];
    for (const set of dropped.sets) {
      for (const expression of Object.keys(set.images)) this.forget(userId, state, spriteWorkKey(set.setKey, expression), set.setKey, expression);
      this.references.delete(set.setKey);
      doomed.push(...setImageIds(set));
    }
    for (const plate of dropped.plates) {
      this.forget(userId, state, plateWorkKey(plate.plateKey), null, null);
      if (plate.imageId) doomed.push(plate.imageId);
    }
    for (const id of doomed) void this.deleteImage(userId, id);
  }

  private async deleteImage(userId: string | undefined, imageId: string): Promise<void> {
    try {
      const api = (this.spindle as { images?: { delete?: (id: string, userId?: string) => Promise<boolean> } }).images;
      if (typeof api?.delete === "function") await api.delete(imageId, userId);
    } catch {
      // Best effort: the host may already have removed it.
    }
  }

  /* ------------------------------------------------------------------ */
  /* Broadcasts                                                           */
  /* ------------------------------------------------------------------ */

  private broadcastImage(userId: string | undefined, setKey: string, image: StoredSpriteImage): void {
    this.spindle.sendToFrontend({ type: "vn_sprite_update", setKey, image: spriteImageView(image) }, userId);
  }

  private broadcastPlate(userId: string | undefined, plate: StoredPlate): void {
    this.spindle.sendToFrontend({ type: "vn_plate_update", plate: plateView(plate) }, userId);
  }
}
