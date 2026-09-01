export type PlanningStage = "queued" | "running" | "completed" | "failed" | "cancelled";

export type PlanningOperation = {
  id: string;
  userId: string | undefined;
  chatId: string;
  sourceId: string;
  dedupeId: string;
  controller: AbortController;
  stage: PlanningStage;
};

export type PlanningTask<T> = (operation: PlanningOperation) => Promise<T>;

export type ScheduledPlanning<T> = {
  operation: PlanningOperation;
  promise: Promise<T>;
  reused: boolean;
};

function compoundKey(parts: readonly (string | null | undefined)[]): string {
  return JSON.stringify(parts.map((part) => part ?? null));
}

function operationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `vn-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function abortError(reason: unknown = "Planning cancelled."): Error {
  const error = new Error(typeof reason === "string" ? reason : "Planning cancelled.");
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || (error instanceof Error && error.name === "AbortError"));
}

/** Serializes narrative planning per chat. Different chats remain independent. */
export class PlanningQueue {
  private readonly operations = new Map<string, ScheduledPlanning<unknown>>();
  private readonly chatTails = new Map<string, Promise<void>>();

  enqueue<T>(
    userId: string | undefined,
    chatId: string,
    sourceId: string,
    task: PlanningTask<T>,
    dedupeId = sourceId
  ): ScheduledPlanning<T> {
    const dedupeKey = compoundKey([userId, chatId, dedupeId]);
    const existing = this.operations.get(dedupeKey) as ScheduledPlanning<T> | undefined;
    if (existing) return { ...existing, reused: true };

    const operation: PlanningOperation = {
      id: operationId(),
      userId,
      chatId,
      sourceId,
      dedupeId,
      controller: new AbortController(),
      stage: "queued"
    };
    const chatKey = compoundKey([userId, chatId]);
    const previous = this.chatTails.get(chatKey) ?? Promise.resolve();
    const execute = async (): Promise<T> => {
      if (operation.controller.signal.aborted) {
        operation.stage = "cancelled";
        throwIfAborted(operation.controller.signal);
      }
      operation.stage = "running";
      try {
        const result = await task(operation);
        throwIfAborted(operation.controller.signal);
        operation.stage = "completed";
        return result;
      } catch (error) {
        operation.stage = isAbortError(error, operation.controller.signal) ? "cancelled" : "failed";
        throw error;
      }
    };
    const promise = previous.then(execute, execute);
    const tail = promise.then(() => undefined, () => undefined);
    const scheduled: ScheduledPlanning<T> = { operation, promise, reused: false };
    this.operations.set(dedupeKey, scheduled as ScheduledPlanning<unknown>);
    this.chatTails.set(chatKey, tail);
    void tail.finally(() => {
      if (this.operations.get(dedupeKey)?.promise === promise) this.operations.delete(dedupeKey);
      if (this.chatTails.get(chatKey) === tail) this.chatTails.delete(chatKey);
    });
    return scheduled;
  }

  cancelChat(userId: string | undefined, chatId: string, operationId?: string, reason = "Planning cancelled."): string[] {
    const cancelled: string[] = [];
    for (const scheduled of this.operations.values()) {
      const operation = scheduled.operation;
      if (operation.userId !== userId || operation.chatId !== chatId) continue;
      if (operationId && operation.id !== operationId) continue;
      if (!operation.controller.signal.aborted) {
        operation.controller.abort(reason);
        operation.stage = "cancelled";
      }
      cancelled.push(operation.id);
    }
    return cancelled;
  }

  active(): readonly PlanningOperation[] {
    return [...this.operations.values()].map(({ operation }) => operation);
  }
}
