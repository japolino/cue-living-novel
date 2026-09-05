import type { AssetJob, AssetJobPriority } from "../../shared/contracts.js";
import { AssetJobSchema } from "../../shared/contracts.js";
import { abortError, isAbortError } from "./planning-queue.js";

export type ProviderPolicy = {
  concurrency: number;
};

export type AssetExecutionResult = {
  imageId: string;
  imageUrl?: string | null;
};

export type AssetExecutor = (job: Readonly<AssetJob>, signal: AbortSignal) => Promise<AssetExecutionResult>;
export type AssetJobListener = (job: Readonly<AssetJob>) => void;

type ScheduledAsset = {
  job: AssetJob;
  executor: AssetExecutor;
  controller: AbortController;
  sequence: number;
  promise: Promise<AssetJob>;
  resolve: (job: AssetJob) => void;
  reject: (error: unknown) => void;
  dependents: ScheduledAsset[];
  parentJobId?: string;
};

const priorityRank: Record<AssetJobPriority, number> = { visible: 0, next: 1, background: 2 };

function now(): string {
  return new Date().toISOString();
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function terminal(status: AssetJob["status"]): boolean {
  return status === "browser_ready" || status === "failed" || status === "cancelled";
}

/**
 * Owns provider concurrency and job state. Planning can finish without waiting
 * for this scheduler, and each provider drains its own queue independently.
 */
export class AssetScheduler {
  private readonly policies = new Map<string, ProviderPolicy>();
  private readonly scheduled = new Map<string, ScheduledAsset>();
  private readonly promptOwners = new Map<string, string>();
  private readonly runningByProvider = new Map<string, number>();
  private readonly listeners = new Set<AssetJobListener>();
  private sequence = 0;

  constructor(policies: Readonly<Record<string, ProviderPolicy>> = {}) {
    for (const [provider, policy] of Object.entries(policies)) this.setProviderPolicy(provider, policy);
  }

  setProviderPolicy(provider: string, policy: ProviderPolicy): void {
    if (!Number.isInteger(policy.concurrency) || policy.concurrency < 1) throw new Error("Provider concurrency must be a positive integer.");
    this.policies.set(provider, { ...policy });
    this.drain(provider);
  }

  subscribe(listener: AssetJobListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  schedule(jobInput: AssetJob, executor: AssetExecutor): { job: AssetJob; promise: Promise<AssetJob>; reused: boolean } {
    const job = AssetJobSchema.parse(jobInput);
    if (job.status !== "queued") throw new Error("Only queued asset jobs can be scheduled.");
    const existing = this.scheduled.get(job.jobId);
    if (existing) return { job: existing.job, promise: existing.promise, reused: true };

    const promptKey = JSON.stringify([job.ownerTurnKey.chatId, job.ownerTurnKey.assistantMessageId, job.ownerTurnKey.swipeId, job.ownerTurnKey.revision, job.promptFingerprint]);
    const matchingJobId = this.promptOwners.get(promptKey);
    const matching = matchingJobId ? this.scheduled.get(matchingJobId) : undefined;

    if (matching && matching.job.status === "generated") {
      const timestamp = now();
      const reusedJob = AssetJobSchema.parse({
        ...job,
        status: "generated",
        imageId: matching.job.imageId,
        imageUrl: matching.job.imageUrl,
        startedAt: timestamp,
        generatedAt: timestamp,
        finishedAt: matching.job.finishedAt
      });
      const result = deferred<AssetJob>();
      const item: ScheduledAsset = {
        job: reusedJob,
        executor,
        controller: new AbortController(),
        sequence: this.sequence++,
        promise: result.promise,
        resolve: result.resolve,
        reject: result.reject,
        dependents: []
      };
      this.scheduled.set(reusedJob.jobId, item);
      this.emit(reusedJob);
      result.resolve(reusedJob);
      return { job: reusedJob, promise: result.promise, reused: true };
    }

    if (matching && !terminal(matching.job.status)) {
      const result = deferred<AssetJob>();
      const item: ScheduledAsset = {
        job,
        executor,
        controller: new AbortController(),
        sequence: this.sequence++,
        promise: result.promise,
        resolve: result.resolve,
        reject: result.reject,
        dependents: [],
        parentJobId: matching.job.jobId
      };
      this.scheduled.set(job.jobId, item);
      matching.dependents.push(item);
      if (priorityRank[job.priority] < priorityRank[matching.job.priority]) {
        this.reprioritize(matching.job.jobId, job.priority);
      }
      this.emit(job);
      return { job, promise: result.promise, reused: true };
    }

    const result = deferred<AssetJob>();
    const item: ScheduledAsset = {
      job,
      executor,
      controller: new AbortController(),
      sequence: this.sequence++,
      promise: result.promise,
      resolve: result.resolve,
      reject: result.reject,
      dependents: []
    };
    this.scheduled.set(job.jobId, item);
    this.promptOwners.set(promptKey, job.jobId);
    this.emit(job);
    this.drain(job.provider);
    return { job, promise: result.promise, reused: false };
  }

  reprioritize(jobId: string, priority: AssetJobPriority): AssetJob | null {
    const item = this.scheduled.get(jobId);
    if (!item || item.job.status !== "queued") return null;
    item.job = AssetJobSchema.parse({ ...item.job, priority });
    this.emit(item.job);
    this.drain(item.job.provider);
    return item.job;
  }

  markBrowserReady(jobId: string): AssetJob {
    const item = this.required(jobId);
    if (item.job.status !== "generated") throw new Error("Only a generated asset can become browser-ready.");
    const timestamp = now();
    item.job = AssetJobSchema.parse({ ...item.job, status: "browser_ready", readyAt: timestamp, finishedAt: timestamp });
    this.emit(item.job);
    return item.job;
  }

  cancel(jobId: string, reason = "Asset generation cancelled."): boolean {
    const item = this.scheduled.get(jobId);
    if (!item || terminal(item.job.status)) return false;
    item.controller.abort(reason);
    if (item.parentJobId) {
      const parent = this.scheduled.get(item.parentJobId);
      if (parent) {
        parent.dependents = parent.dependents.filter((d) => d.job.jobId !== jobId);
      }
    }
    if (item.job.status === "queued") {
      item.job = AssetJobSchema.parse({
        ...item.job,
        status: "cancelled",
        imageId: null,
        imageUrl: null,
        generatedAt: null,
        readyAt: null,
        error: null,
        finishedAt: now()
      });
      this.emit(item.job);
      item.resolve(item.job);
      this.drain(item.job.provider);
    }
    for (const dep of [...item.dependents]) {
      this.cancel(dep.job.jobId, reason);
    }
    return true;
  }

  cancelTurn(predicate: (job: Readonly<AssetJob>) => boolean, reason?: string): string[] {
    const cancelled: string[] = [];
    for (const item of this.scheduled.values()) {
      if (predicate(item.job) && this.cancel(item.job.jobId, reason)) cancelled.push(item.job.jobId);
    }
    return cancelled;
  }

  get(jobId: string): AssetJob | null {
    return this.scheduled.get(jobId)?.job ?? null;
  }

  snapshot(): readonly AssetJob[] {
    return [...this.scheduled.values()].map(({ job }) => job);
  }

  private required(jobId: string): ScheduledAsset {
    const item = this.scheduled.get(jobId);
    if (!item) throw new Error(`Unknown asset job: ${jobId}`);
    return item;
  }

  private emit(job: AssetJob): void {
    for (const listener of this.listeners) listener(job);
  }

  private drain(provider: string): void {
    const policy = this.policies.get(provider) ?? { concurrency: 1 };
    let running = this.runningByProvider.get(provider) ?? 0;
    if (running >= policy.concurrency) return;
    const candidates = [...this.scheduled.values()]
      .filter((item) => item.job.provider === provider && item.job.status === "queued" && !item.parentJobId)
      .sort((left, right) => priorityRank[left.job.priority] - priorityRank[right.job.priority] || left.sequence - right.sequence);
    for (const item of candidates) {
      if (running >= policy.concurrency) break;
      running += 1;
      this.runningByProvider.set(provider, running);
      void this.run(item).finally(() => {
        const nextRunning = Math.max(0, (this.runningByProvider.get(provider) ?? 1) - 1);
        this.runningByProvider.set(provider, nextRunning);
        this.drain(provider);
      });
    }
  }

  private async run(item: ScheduledAsset): Promise<void> {
    if (item.controller.signal.aborted) {
      this.cancel(item.job.jobId, item.controller.signal.reason);
      return;
    }
    const started = now();
    item.job = AssetJobSchema.parse({ ...item.job, status: "generating", startedAt: started });
    this.emit(item.job);
    for (const dep of item.dependents) {
      if (dep.job.status === "queued") {
        dep.job = AssetJobSchema.parse({ ...dep.job, status: "generating", startedAt: started });
        this.emit(dep.job);
      }
    }
    try {
      const result = await item.executor(item.job, item.controller.signal);
      if (item.controller.signal.aborted) throw abortError(item.controller.signal.reason);
      const generated = now();
      item.job = AssetJobSchema.parse({
        ...item.job,
        status: "generated",
        imageId: result.imageId,
        imageUrl: result.imageUrl ?? null,
        generatedAt: generated
      });
      this.emit(item.job);
      item.resolve(item.job);

      for (const dep of item.dependents) {
        if (!terminal(dep.job.status)) {
          dep.job = AssetJobSchema.parse({
            ...dep.job,
            status: "generated",
            startedAt: dep.job.startedAt ?? started,
            imageId: result.imageId,
            imageUrl: result.imageUrl ?? null,
            generatedAt: generated
          });
          this.emit(dep.job);
          dep.resolve(dep.job);
        }
      }
    } catch (error) {
      const cancelled = isAbortError(error, item.controller.signal);
      const finished = now();
      item.job = AssetJobSchema.parse({
        ...item.job,
        status: cancelled ? "cancelled" : "failed",
        startedAt: item.job.startedAt ?? (cancelled ? null : finished),
        imageId: null,
        imageUrl: null,
        generatedAt: null,
        readyAt: null,
        error: cancelled ? null : error instanceof Error ? error.message : String(error),
        finishedAt: finished
      });
      this.emit(item.job);
      if (cancelled) item.resolve(item.job);
      else item.reject(error);

      for (const dep of item.dependents) {
        if (!terminal(dep.job.status)) {
          dep.job = AssetJobSchema.parse({
            ...dep.job,
            status: cancelled ? "cancelled" : "failed",
            startedAt: dep.job.startedAt ?? (cancelled ? null : finished),
            imageId: null,
            imageUrl: null,
            generatedAt: null,
            readyAt: null,
            error: cancelled ? null : error instanceof Error ? error.message : String(error),
            finishedAt: finished
          });
          this.emit(dep.job);
          if (cancelled) dep.resolve(dep.job);
          else dep.reject(error);
        }
      }
    }
  }
}
