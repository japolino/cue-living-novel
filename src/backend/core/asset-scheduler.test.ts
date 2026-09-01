import { describe, expect, test } from "bun:test";
import { AssetJobSchema, type AssetJob, type TurnKey } from "../../shared/contracts.js";
import { AssetScheduler } from "./asset-scheduler.js";
import { canAcceptAssetResult, compareTurnKeys } from "./guards.js";

const key: TurnKey = {
  chatId: "chat",
  assistantMessageId: "message",
  swipeId: 0,
  sourceFingerprint: "12345678abcdef",
  revision: 2
};

function job(jobId: string, provider: string, priority: AssetJob["priority"] = "background"): AssetJob {
  return AssetJobSchema.parse({
    jobId,
    ownerTurnKey: key,
    sceneId: "scene",
    sceneRevision: 3,
    paragraphIndex: 0,
    promptFingerprint: `prompt-${jobId}`,
    provider,
    priority,
    status: "queued",
    queuedAt: new Date().toISOString()
  });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("asset scheduler", () => {
  test("applies concurrency per provider and lets another provider progress", async () => {
    const scheduler = new AssetScheduler({ slow: { concurrency: 1 }, fast: { concurrency: 1 } });
    const gate = deferred();
    const events: string[] = [];
    const first = scheduler.schedule(job("one", "slow"), async () => {
      events.push("slow-1-start");
      await gate.promise;
      return { imageId: "image-one" };
    });
    const second = scheduler.schedule(job("two", "slow"), async () => {
      events.push("slow-2-start");
      return { imageId: "image-two" };
    });
    const fast = scheduler.schedule(job("three", "fast"), async () => {
      events.push("fast-start");
      return { imageId: "image-three" };
    });
    await flush();
    expect(events).toEqual(["slow-1-start", "fast-start"]);
    gate.resolve();
    await Promise.all([first.promise, second.promise, fast.promise]);
    expect(events).toEqual(["slow-1-start", "fast-start", "slow-2-start"]);
  });

  test("prioritizes visible queued work and waits for browser readiness", async () => {
    const scheduler = new AssetScheduler({ provider: { concurrency: 1 } });
    const gate = deferred();
    const order: string[] = [];
    const blocker = scheduler.schedule(job("blocker", "provider"), async () => {
      await gate.promise;
      return { imageId: "blocker-image" };
    });
    const background = scheduler.schedule(job("background", "provider"), async (asset) => {
      order.push(asset.jobId);
      return { imageId: "background-image" };
    });
    const visible = scheduler.schedule(job("visible", "provider", "visible"), async (asset) => {
      order.push(asset.jobId);
      return { imageId: "visible-image" };
    });
    gate.resolve();
    await Promise.all([blocker.promise, background.promise, visible.promise]);
    expect(order).toEqual(["visible", "background"]);
    expect(scheduler.get("visible")?.status).toBe("generated");
    expect(scheduler.markBrowserReady("visible").status).toBe("browser_ready");
  });

  test("cancels queued work without calling the executor", async () => {
    const scheduler = new AssetScheduler({ provider: { concurrency: 1 } });
    const gate = deferred();
    const blocker = scheduler.schedule(job("blocker", "provider"), async () => {
      await gate.promise;
      return { imageId: "blocker-image" };
    });
    let ran = false;
    const queued = scheduler.schedule(job("queued", "provider"), async () => {
      ran = true;
      return { imageId: "queued-image" };
    });
    expect(scheduler.cancel("queued")).toBe(true);
    expect((await queued.promise).status).toBe("cancelled");
    gate.resolve();
    await blocker.promise;
    expect(ran).toBe(false);
  });
});

describe("stale result guards", () => {
  test("reports the exact turn mismatch", () => {
    expect(compareTurnKeys({ ...key, sourceFingerprint: "different-source" }, key)).toEqual({ accepted: false, reason: "source_changed" });
  });

  test("accepts only the active turn and scene revision", () => {
    const asset = job("guard", "provider");
    expect(canAcceptAssetResult(key, { sceneId: "scene", revision: 3 }, asset)).toEqual({ accepted: true });
    expect(canAcceptAssetResult(key, { sceneId: "scene", revision: 4 }, asset)).toEqual({ accepted: false, reason: "scene_revision_changed" });
  });
});

