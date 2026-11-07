import type { TurnView } from "../../protocol.js";
import type { TurnKey } from "../../shared/contracts.js";
import { compareTurnKeys } from "./guards.js";

/**
 * One chat's turn and picture work (per user): who owns the chat's turn, the
 * picture batch that turn runs, and what runs alongside. It replaces six
 * separate maps the controller used to keep in step by hand (the planning
 * queue stays the plan serializer; the runtime cancels it through a hook).
 * Every change goes through the transitions below, so the owner and its batch
 * always move together.
 *
 * Phase:
 * - `idle`: nothing owns the chat's turn. A late result of an aborted batch
 *   is refused.
 * - `planning`: a plan is queued or running and no turn owns the chat yet.
 * - `owned`: `turnKey` is the chat's turn; only its results are saved and
 *   sent. `batch` is its picture batch while one runs.
 *
 * Alongside the phase:
 * - `generating`: a reply is being generated (GENERATION_STARTED until it
 *   ends). No batch starts meanwhile: that reply replaces the turn.
 * - `intakeEpoch`: bumped by every event that makes an intake in flight stale.
 * - `provisional`: the text shown before the plan, so a view that reopens on
 *   the plan in flight shows it again. Only in memory.
 * - `settling`: settles once every batch started here (aborted or not) and
 *   every cleanup tracked here has returned. An aborted batch keeps running
 *   until its provider request returns (requests take no signal), so pictures
 *   resume only after this settles: no second paid request for the same
 *   picture, and no late "cancelled" save over the resumed record.
 *
 * | event                   | idle            | planning(op)        | owned(T, batch)                             |
 * |-------------------------|-----------------|---------------------|---------------------------------------------|
 * | planningStarted(op2)    | planning(op2)   | planning(op2)       | unchanged: T stays the turn until a claim   |
 * | planningSettled(op)     | unchanged       | idle if the same op | unchanged                                   |
 * | claim(T2)               | owned(T2)       | owned(T2)           | owned(T2); batch kept if T2 = T, else aborted |
 * | startBatch(T)           | refused         | refused             | owned(T, new batch); the old one is aborted |
 * | startBatch while generating | refused     | refused             | refused, and the claim is given back (idle) |
 * | batch finishes          |                 |                     | owned(T, null)                              |
 * | interrupt (Retry)       | unchanged       | idle (plans cancelled) | owned(T, null)                           |
 * | abort                   | idle            | idle                | idle (batch aborted)                        |
 * | onGenerationStarted     | idle, generating| idle, generating    | idle, generating (batch aborted)            |
 * | onGenerationEnded       | not generating  | not generating      | not generating                              |
 */

export type AssetBatch = {
  /** The turn the batch was started for. */
  readonly turnKey: TurnKey;
  readonly signal: AbortSignal;
  /** Resolves once the batch has returned, aborted or not. */
  readonly settled: Promise<void>;
};

export type ChatPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "planning"; readonly opId: string }
  | { readonly kind: "owned"; readonly turnKey: TurnKey; readonly batch: AssetBatch | null };

export type ProvisionalTurn = { readonly operationId: string; readonly view: TurnView };

export type BatchRefusal = "not_owner" | "generating";

export type BatchStart =
  | {
      readonly ok: true;
      readonly batch: AssetBatch;
      /** Whether the batch may still save and send a result of `turnKey`'s. */
      readonly owns: (turnKey: TurnKey) => boolean;
      /** The batch returned. Idempotent. */
      readonly finish: () => void;
    }
  | { readonly ok: false; readonly reason: BatchRefusal };

export type ChatRuntimeHooks = {
  /** Cancel the chat's plans, queued or running. */
  cancelPlanning(reason: string): void;
};

const IDLE: ChatPhase = { kind: "idle" };

export class ChatRuntime {
  private current: ChatPhase = IDLE;
  /** Aborts `current.batch`; set exactly while a batch is in the phase. */
  private batchController: AbortController | null = null;
  private replying = false;
  private epoch = 0;
  private pending: ProvisionalTurn | null = null;
  private settleChain: Promise<void> | null = null;

  constructor(private readonly hooks: ChatRuntimeHooks = { cancelPlanning: () => {} }) {}

  get phase(): ChatPhase {
    return this.current;
  }

  get generating(): boolean {
    return this.replying;
  }

  get intakeEpoch(): number {
    return this.epoch;
  }

  /** The turn that owns the chat, or null. */
  get owner(): TurnKey | null {
    return this.current.kind === "owned" ? this.current.turnKey : null;
  }

  /** The owner's batch while it runs. */
  get batch(): AssetBatch | null {
    return this.current.kind === "owned" ? this.current.batch : null;
  }

  /** Whether `turnKey` owns the chat's turn. */
  isOwnedBy(turnKey: TurnKey): boolean {
    return compareTurnKeys(this.owner, turnKey).accepted;
  }

  get settling(): Promise<void> | null {
    return this.settleChain;
  }

  /** A plan was queued for the chat. A turn that owns the chat keeps it until a plan claims. */
  planningStarted(opId: string): void {
    if (this.current.kind !== "owned") this.current = { kind: "planning", opId };
  }

  /** A plan settled without claiming (cancelled, failed, nothing to show). */
  planningSettled(opId: string): void {
    if (this.current.kind === "planning" && this.current.opId === opId) this.current = IDLE;
  }

  /**
   * `turnKey` becomes the chat's turn. A batch running for another turn is
   * aborted (nobody would show its pictures); the same turn's batch keeps
   * running.
   */
  claim(turnKey: TurnKey, reason = "Another turn took the chat."): void {
    const batch = this.batch;
    if (batch && compareTurnKeys(batch.turnKey, turnKey).accepted) {
      this.current = { kind: "owned", turnKey, batch };
      return;
    }
    this.stopBatch(reason);
    this.current = { kind: "owned", turnKey, batch: null };
  }

  /**
   * Give back the claim `turnKey` made (its save failed, or its batch could not
   * start). Only that very claim, and only before a batch runs for it:
   * whoever claimed the chat since keeps it.
   */
  release(turnKey: TurnKey): void {
    if (this.current.kind === "owned" && this.current.turnKey === turnKey && this.current.batch === null) this.current = IDLE;
  }

  /**
   * Start the owner's picture batch. Refused unless `turnKey` owns the chat (a
   * cancel, a close or another turn got there first, possibly while the caller
   * was still loading) and no reply is being generated. Refused for a reply
   * being generated, the claim is given back: if no reply follows, the turn's
   * pictures resume from idle like any stopped ones.
   */
  startBatch(turnKey: TurnKey): BatchStart {
    if (this.current.kind !== "owned" || !compareTurnKeys(this.current.turnKey, turnKey).accepted) {
      return { ok: false, reason: "not_owner" };
    }
    if (this.replying) {
      this.release(this.current.turnKey);
      return { ok: false, reason: "generating" };
    }
    this.stopBatch("A newer batch replaced this asset batch.");
    const controller = new AbortController();
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
    const batch: AssetBatch = { turnKey, signal: controller.signal, settled };
    this.batchController = controller;
    this.current = { kind: "owned", turnKey: this.current.turnKey, batch };
    this.track(settled);
    let finished = false;
    return {
      ok: true,
      batch,
      owns: (candidate) => !controller.signal.aborted && this.batch === batch && this.isOwnedBy(candidate),
      finish: () => {
        if (finished) return;
        finished = true;
        if (this.current.kind === "owned" && this.current.batch === batch) {
          this.batchController = null;
          this.current = { kind: "owned", turnKey: this.current.turnKey, batch: null };
        }
        resolveSettled();
      }
    };
  }

  /**
   * Retry: cancel the chat's plans and abort its batch, but keep the owner,
   * so nothing resumes in between; Retry claims the turn again itself.
   */
  interrupt(reason: string): void {
    this.hooks.cancelPlanning(reason);
    this.stopBatch(reason);
    if (this.current.kind === "planning") this.current = IDLE;
  }

  /**
   * Cancel the chat's plans and abort its batch; nothing owns the turn
   * anymore, so late results are refused. Returns the turn that owned it.
   */
  abort(reason: string): TurnKey | null {
    const dropped = this.owner;
    this.hooks.cancelPlanning(reason);
    this.stopBatch(reason);
    this.current = IDLE;
    return dropped;
  }

  /** A reply is being generated: it replaces the turn, so everything in flight stops. */
  onGenerationStarted(reason: string): TurnKey | null {
    this.replying = true;
    this.epoch += 1;
    return this.abort(reason);
  }

  /** The reply generation ended (with a reply or without). */
  onGenerationEnded(): void {
    this.replying = false;
  }

  bumpIntakeEpoch(): void {
    this.epoch += 1;
  }

  get provisional(): ProvisionalTurn | null {
    return this.pending;
  }

  showProvisional(turn: ProvisionalTurn): void {
    this.pending = turn;
  }

  /** The provisional text of plan `operationId`, if it is the one shown. */
  provisionalOf(operationId: string): ProvisionalTurn | null {
    return this.pending?.operationId === operationId ? this.pending : null;
  }

  dropProvisional(operationId: string): void {
    if (this.pending?.operationId === operationId) this.pending = null;
  }

  /** Count `work` in `settling` until it returns (resolved or rejected). */
  track(work: Promise<unknown>): void {
    const settled = Promise.all([this.settleChain, work.then(() => undefined, () => undefined)]).then(() => undefined);
    this.settleChain = settled;
    void settled.then(() => { if (this.settleChain === settled) this.settleChain = null; });
  }

  private stopBatch(reason: string): void {
    if (this.current.kind !== "owned" || !this.current.batch) return;
    this.batchController?.abort(reason);
    this.batchController = null;
    this.current = { kind: "owned", turnKey: this.current.turnKey, batch: null };
  }
}

/** The chats' runtimes, by user and chat. Entries are kept: an intake in flight compares its epoch. */
export class ChatRuntimes {
  private readonly chats = new Map<string, ChatRuntime>();

  constructor(private readonly cancelPlanning: (userId: string | undefined, chatId: string, reason: string) => void = () => {}) {}

  get(userId: string | undefined, chatId: string): ChatRuntime {
    const key = `${userId ?? "owner"}:${chatId}`;
    let runtime = this.chats.get(key);
    if (!runtime) {
      runtime = new ChatRuntime({ cancelPlanning: (reason) => this.cancelPlanning(userId, chatId, reason) });
      this.chats.set(key, runtime);
    }
    return runtime;
  }
}
