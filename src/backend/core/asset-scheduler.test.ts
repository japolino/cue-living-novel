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


describe("Finding #2: asset scheduler prompt reuse and dependent propagation", () => {
  test("propagates generation result from owner to dependent job", async () => {
    const scheduler = new AssetScheduler({ testp: { concurrency: 2 } });
    const events: Array<{ jobId: string; status: string }> = [];
    scheduler.subscribe((j) => events.push({ jobId: j.jobId, status: j.status }));

    const ownerJob = job("owner", "testp");
    const depJob = { ...job("dep", "testp"), promptFingerprint: ownerJob.promptFingerprint };

    let calls = 0;
    const first = scheduler.schedule(ownerJob, async () => {
      calls++;
      return { imageId: "shared-image-123" };
    });
    const second = scheduler.schedule(depJob, async () => {
      calls++;
      return { imageId: "should-not-be-called" };
    });

    expect(second.reused).toBe(true);
    expect(second.job.jobId).toBe("dep");

    const [r1, r2] = await Promise.all([first.promise, second.promise]);
    expect(calls).toBe(1);
    expect(r1.status).toBe("generated");
    expect(r2.status).toBe("generated");
    expect(r1.imageId).toBe("shared-image-123");
    expect(r2.imageId).toBe("shared-image-123");
    expect(scheduler.get("owner")?.status).toBe("generated");
    expect(scheduler.get("dep")?.status).toBe("generated");
  });

  test("propagates failure to dependent job", async () => {
    const scheduler = new AssetScheduler({ testp: { concurrency: 1 } });
    const ownerJob = job("owner-fail", "testp");
    const depJob = { ...job("dep-fail", "testp"), promptFingerprint: ownerJob.promptFingerprint };

    const first = scheduler.schedule(ownerJob, async () => {
      throw new Error("Provider explosion");
    });
    const second = scheduler.schedule(depJob, async () => {
      return { imageId: "unused" };
    });

    const [firstResult, secondResult] = await Promise.allSettled([first.promise, second.promise]);
    expect(firstResult.status).toBe("rejected");
    expect(secondResult.status).toBe("rejected");
    expect(scheduler.get("owner-fail")?.status).toBe("failed");
    expect(scheduler.get("dep-fail")?.status).toBe("failed");
    expect(scheduler.get("dep-fail")?.error).toBe("Provider explosion");
  });

  test("cancelling owner cancels dependent job", async () => {
    const scheduler = new AssetScheduler({ testp: { concurrency: 1 } });
    const gate = deferred();
    const blocker = scheduler.schedule(job("blocker", "testp"), async () => {
      await gate.promise;
      return { imageId: "blocker" };
    });

    const ownerJob = job("queued-owner", "testp");
    const depJob = { ...job("queued-dep", "testp"), promptFingerprint: ownerJob.promptFingerprint };

    const first = scheduler.schedule(ownerJob, async () => ({ imageId: "img" }));
    const second = scheduler.schedule(depJob, async () => ({ imageId: "img" }));

    expect(scheduler.cancel("queued-owner")).toBe(true);
    expect(scheduler.get("queued-owner")?.status).toBe("cancelled");
    expect(scheduler.get("queued-dep")?.status).toBe("cancelled");
    expect((await first.promise).status).toBe("cancelled");
    expect((await second.promise).status).toBe("cancelled");

    gate.resolve();
    await blocker.promise;
  });

  test("cancelling dependent job does not cancel owner job", async () => {
    const scheduler = new AssetScheduler({ testp: { concurrency: 1 } });
    const gate = deferred();
    const blocker = scheduler.schedule(job("blocker-2", "testp"), async () => {
      await gate.promise;
      return { imageId: "blocker" };
    });

    const ownerJob = job("owner-survive", "testp");
    const depJob = { ...job("dep-cancel", "testp"), promptFingerprint: ownerJob.promptFingerprint };

    let ran = false;
    const first = scheduler.schedule(ownerJob, async () => {
      ran = true;
      return { imageId: "survived" };
    });
    const second = scheduler.schedule(depJob, async () => ({ imageId: "img" }));

    expect(scheduler.cancel("dep-cancel")).toBe(true);
    expect(scheduler.get("dep-cancel")?.status).toBe("cancelled");
    expect(scheduler.get("owner-survive")?.status).toBe("queued");

    gate.resolve();
    await blocker.promise;
    await first.promise;
    expect(ran).toBe(true);
    expect(scheduler.get("owner-survive")?.status).toBe("generated");
  });

  test("scheduling after owner completed immediately reuses generated result", async () => {
    const scheduler = new AssetScheduler({ testp: { concurrency: 1 } });
    const ownerJob = job("owner-done", "testp");
    const depJob = { ...job("dep-late", "testp"), promptFingerprint: ownerJob.promptFingerprint };

    const first = scheduler.schedule(ownerJob, async () => ({ imageId: "done-image" }));
    await first.promise;
    expect(scheduler.get("owner-done")?.status).toBe("generated");

    const second = scheduler.schedule(depJob, async () => ({ imageId: "unused" }));
    expect(second.reused).toBe(true);
    expect(second.job.status).toBe("generated");
    expect(second.job.imageId).toBe("done-image");
    const res = await second.promise;
    expect(res.status).toBe("generated");
    expect(res.imageId).toBe("done-image");
  });
});
