import { describe, expect, test } from "bun:test";
import { PlanningQueue, throwIfAborted } from "./planning-queue.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("planning queue", () => {
  test("orders one chat while another chat runs independently", async () => {
    const queue = new PlanningQueue();
    const gate = deferred();
    const events: string[] = [];
    const first = queue.enqueue("user", "a", "m1", async () => {
      events.push("a1-start");
      await gate.promise;
      events.push("a1-end");
    });
    const second = queue.enqueue("user", "a", "m2", async () => { events.push("a2"); });
    const other = queue.enqueue("user", "b", "m1", async () => { events.push("b1"); });
    await flush();
    expect(events).toEqual(["a1-start", "b1"]);
    gate.resolve();
    await Promise.all([first.promise, second.promise, other.promise]);
    expect(events).toEqual(["a1-start", "b1", "a1-end", "a2"]);
  });

  test("deduplicates and aborts queued work before invoking its task", async () => {
    const queue = new PlanningQueue();
    const gate = deferred();
    const first = queue.enqueue(undefined, "a", "m1", async () => gate.promise);
    const duplicate = queue.enqueue<void>(undefined, "a", "m1", async () => { throw new Error("must not run"); });
    let ran = false;
    const queued = queue.enqueue(undefined, "a", "m2", async (operation) => {
      ran = true;
      throwIfAborted(operation.controller.signal);
    });
    expect(duplicate.reused).toBe(true);
    expect(duplicate.promise).toBe(first.promise);
    queue.cancelChat(undefined, "a", queued.operation.id);
    gate.resolve();
    await first.promise;
    await expect(queued.promise).rejects.toHaveProperty("name", "AbortError");
    expect(ran).toBe(false);
    expect(queued.operation.stage).toBe("cancelled");
  });
});
