import { describe, expect, test } from "bun:test";
import {
  SceneImageCache,
  canonicalJson,
  sceneEpisodeOf,
  sceneImageCacheKey,
  sceneImageScope,
  type SceneImageIdentity,
  type SceneImageProvenance
} from "./scene-image-cache.js";

const scope = sceneImageScope(undefined, "chat-1");

function identity(overrides: Partial<{ [K in keyof SceneImageIdentity]: Partial<SceneImageIdentity[K]> }> = {}): SceneImageIdentity {
  const base: SceneImageIdentity = {
    subject: { characterId: "mira", subjectCategory: "female" },
    appearance: { identity: "silver hair, green eyes, red coat", attire: "red coat" },
    environment: { location: "Library", timeWeather: "night", lighting: "lamplight", description: null, persistentElements: ["oak shelves"] },
    pose: { id: "smile", suffix: "gentle smile, eyes relaxed" },
    action: null,
    framing: { framing: "upper body", angle: "eye level", perspective: "straight-on" },
    request: {
      prompt: "masterpiece, 1girl, solo, ...",
      negativePrompt: "low quality",
      provider: "comfyui",
      connectionId: "conn-1",
      model: "anima",
      parameters: { steps: 20 },
      promptSyntax: "comfyui",
      referenceAnchoring: false
    }
  };
  const merged = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    const current = (base as unknown as Record<string, unknown>)[key];
    merged[key] = current !== null && typeof current === "object"
      ? { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) }
      : value;
  }
  return merged as SceneImageIdentity;
}

const provenance: SceneImageProvenance = {
  provider: "comfyui",
  connectionId: "conn-1",
  model: "anima",
  promptFingerprint: "fp",
  assistantMessageId: "m1",
  swipeId: 0,
  jobId: "job-1"
};

function fill(cache: SceneImageCache, key: string, imageId: string, episode = "initial:0") {
  return cache.store(scope, key, { imageId, episode, provenance }, cache.admission(scope));
}

describe("scene image cache key", () => {
  test("is deterministic and independent of object key order", () => {
    const a = sceneImageCacheKey(identity());
    const reordered = Object.fromEntries(Object.entries(identity()).reverse()) as SceneImageIdentity;
    reordered.request = Object.fromEntries(Object.entries(identity().request).reverse()) as SceneImageIdentity["request"];
    const b = sceneImageCacheKey(reordered);
    expect(a).toBe(b);
    expect(a).toBe(sceneImageCacheKey(identity()));
    expect(a.startsWith("scene-v2:")).toBe(true);
  });

  test("canonical JSON sorts keys recursively but preserves array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(canonicalJson([{ z: 1, y: 2 }])).toBe('[{"y":2,"z":1}]');
  });

  test("every structured field changes the key (exact compatibility, no relaxed match)", () => {
    const base = sceneImageCacheKey(identity());
    const variants: SceneImageIdentity[] = [
      identity({ subject: { characterId: "rin" } }),
      identity({ subject: { subjectCategory: "unknown" } }),
      identity({ appearance: { identity: "silver hair, green eyes, blue coat" } }),
      identity({ appearance: { attire: "blue coat" } }),
      identity({ environment: { location: "Street" } }),
      identity({ environment: { timeWeather: "night, rain" } }),
      identity({ environment: { lighting: "moonlight" } }),
      identity({ environment: { description: "dust motes" } }),
      identity({ environment: { persistentElements: ["oak shelves", "candle"] } }),
      identity({ environment: { persistentElements: [] } }),
      identity({ pose: { id: "idle", suffix: "neutral" } }),
      identity({ action: "holding brass key" as never }),
      identity({ framing: { framing: "full body" } }),
      identity({ request: { prompt: "different" } }),
      identity({ request: { negativePrompt: "different" } }),
      identity({ request: { provider: "novelai" } }),
      identity({ request: { connectionId: "conn-1::wf" } }),
      identity({ request: { model: "other" } }),
      identity({ request: { parameters: { steps: 21 } } }),
      identity({ request: { parameters: { steps: 20, referenceStrength: 0.4 } } }),
      identity({ request: { promptSyntax: "novelai" } }),
      identity({ request: { referenceAnchoring: true } })
    ];
    const keys = variants.map((variant) => sceneImageCacheKey(variant));
    for (const key of keys) expect(key).not.toBe(base);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("same display name with a different durable id never collides", () => {
    const fox1 = identity({ subject: { characterId: "fox-girl-yuki" } });
    const fox2 = identity({ subject: { characterId: "fox-girl-ren" } });
    expect(sceneImageCacheKey(fox1)).not.toBe(sceneImageCacheKey(fox2));
  });
});

describe("scene episodes", () => {
  test("derive from the prior scene id, never the scene id", () => {
    expect(sceneEpisodeOf({ priorSceneId: "scene-a" })).toBe("scene-a");
    expect(sceneEpisodeOf({ priorSceneId: null })).toBe("initial:0");
    expect(sceneEpisodeOf({}, 3)).toBe("initial:3");
  });
});

describe("SceneImageCache lookup / store / bounds", () => {
  test("misses before store, hits after, and counts one generation avoided per hit", () => {
    const cache = new SceneImageCache();
    const key = sceneImageCacheKey(identity());
    expect(cache.lookup(scope, key, "initial:0")).toEqual({ status: "miss", reason: "absent" });
    const stored = fill(cache, key, "img-1");
    expect(stored.stored).toBe(true);
    const hit = cache.lookup(scope, key, "initial:0");
    expect(hit.status).toBe("hit");
    if (hit.status === "hit") {
      expect(hit.entry.imageId).toBe("img-1");
      expect(hit.entry.imageUrl).toBe("/api/v1/images/img-1");
      expect(hit.entry.hits).toBe(1);
    }
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses.absent).toBe(1);
    expect(stats.generationsAvoided).toBe(1);
    expect(stats.stores).toBe(1);
  });

  test("scopes are isolated: another chat never sees the entry", () => {
    const cache = new SceneImageCache();
    const key = sceneImageCacheKey(identity());
    fill(cache, key, "img-1");
    expect(cache.lookup(sceneImageScope(undefined, "chat-2"), key, "initial:0").status).toBe("miss");
    expect(cache.lookup(sceneImageScope("user-b", "chat-1"), key, "initial:0").status).toBe("miss");
  });

  test("a different physical episode retires the entry on sight", () => {
    const cache = new SceneImageCache();
    const key = sceneImageCacheKey(identity());
    fill(cache, key, "img-1", "scene-a");
    expect(cache.lookup(scope, key, "scene-b")).toEqual({ status: "miss", reason: "episode_retired" });
    expect(cache.size).toBe(0);
    expect(cache.stats().invalidations.scene_boundary).toBe(1);
    // Even returning to the original episode no longer finds it.
    expect(cache.lookup(scope, key, "scene-a").status).toBe("miss");
  });

  test("retainEpisodes keeps only reachable episodes", () => {
    const cache = new SceneImageCache();
    const a = sceneImageCacheKey(identity({ pose: { id: "a" } }));
    const b = sceneImageCacheKey(identity({ pose: { id: "b" } }));
    const c = sceneImageCacheKey(identity({ pose: { id: "c" } }));
    fill(cache, a, "img-a", "ep-1");
    fill(cache, b, "img-b", "ep-2");
    fill(cache, c, "img-c", "ep-3");
    expect(cache.retainEpisodes(scope, ["ep-2", "ep-3"])).toBe(1);
    expect(cache.peek(scope, a)).toBeNull();
    expect(cache.peek(scope, b)?.imageId).toBe("img-b");
    expect(cache.peek(scope, c)?.imageId).toBe("img-c");
  });

  test("bounds entries with LRU eviction and never touches anything but the pointer", () => {
    const cache = new SceneImageCache({ maxEntries: 2 });
    const keys = ["a", "b", "c"].map((pose) => sceneImageCacheKey(identity({ pose: { id: pose } })));
    fill(cache, keys[0]!, "img-a");
    fill(cache, keys[1]!, "img-b");
    // Touch "a" so "b" becomes least recently used.
    expect(cache.lookup(scope, keys[0]!, "initial:0").status).toBe("hit");
    fill(cache, keys[2]!, "img-c");
    expect(cache.size).toBe(2);
    expect(cache.peek(scope, keys[1]!)).toBeNull();
    expect(cache.lookup(scope, keys[1]!, "initial:0")).toEqual({ status: "miss", reason: "evicted" });
    expect(cache.stats().evictions).toBe(1);
  });

  test("bounds bytes and keeps the entry just stored even when it alone exceeds the limit", () => {
    const small = new SceneImageCache({ maxBytes: 10 });
    const key = sceneImageCacheKey(identity());
    expect(fill(small, key, "img-1").stored).toBe(true);
    expect(small.size).toBe(1);
    expect(small.bytes).toBeGreaterThan(10);
    const other = sceneImageCacheKey(identity({ pose: { id: "b" } }));
    fill(small, other, "img-2");
    expect(small.size).toBe(1);
    expect(small.peek(scope, other)?.imageId).toBe("img-2");
    expect(small.stats().evictions).toBe(1);
  });

  test("rejects late results: stale admission, aborted signal, missing image id, wrong scope", () => {
    const cache = new SceneImageCache();
    const key = sceneImageCacheKey(identity());
    const token = cache.admission(scope);
    cache.bumpEpoch(scope, "new turn");
    expect(cache.store(scope, key, { imageId: "img", episode: "e", provenance }, token)).toEqual({ stored: false, reason: "stale_admission" });
    const fresh = cache.admission(scope);
    const controller = new AbortController();
    controller.abort("cancelled");
    expect(cache.store(scope, key, { imageId: "img", episode: "e", provenance }, fresh, controller.signal)).toEqual({ stored: false, reason: "aborted" });
    expect(cache.store(scope, key, { imageId: "  ", episode: "e", provenance }, fresh)).toEqual({ stored: false, reason: "no_image_id" });
    expect(cache.store("other:chat", key, { imageId: "img", episode: "e", provenance }, fresh)).toEqual({ stored: false, reason: "wrong_scope" });
    expect(cache.size).toBe(0);
    expect(cache.stats().rejections).toEqual({ stale_admission: 1, aborted: 1, no_image_id: 1, wrong_scope: 1 });
  });

  test("bumping the epoch keeps existing entries (content keyed) but rejects tokens minted before", () => {
    const cache = new SceneImageCache();
    const key = sceneImageCacheKey(identity());
    fill(cache, key, "img-1");
    const before = cache.admission(scope);
    cache.bumpEpoch(scope, "swipe");
    expect(cache.isAdmitted(before)).toBe(false);
    expect(cache.lookup(scope, key, "initial:0").status).toBe("hit");
  });

  test("invalidateScope drops entries, bumps epoch and generation so 'initial' lineages never collide", () => {
    const cache = new SceneImageCache();
    const key = sceneImageCacheKey(identity());
    const before = cache.admission(scope);
    fill(cache, key, "img-1", sceneEpisodeOf({ priorSceneId: null }, cache.generation(scope)));
    expect(cache.invalidateScope(scope, "scope_cleared")).toBe(1);
    expect(cache.generation(scope)).toBe(1);
    expect(cache.isAdmitted(before)).toBe(false);
    expect(cache.lookup(scope, key, sceneEpisodeOf({ priorSceneId: null }, cache.generation(scope)))).toEqual({ status: "miss", reason: "invalidated" });
    expect(cache.stats().invalidations.scope_cleared).toBe(1);
  });

  test("invalidateImage drops every pointer at that image across scopes", () => {
    const cache = new SceneImageCache();
    const key = sceneImageCacheKey(identity());
    fill(cache, key, "img-shared");
    cache.store("owner:chat-2", key, { imageId: "img-shared", episode: "x", provenance }, cache.admission("owner:chat-2"));
    expect(cache.invalidateImage("img-shared", "image_deleted")).toBe(2);
    expect(cache.size).toBe(0);
  });

  test("clear resets everything", () => {
    const cache = new SceneImageCache();
    const key = sceneImageCacheKey(identity());
    fill(cache, key, "img-1");
    cache.bumpEpoch(scope);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.epoch(scope)).toBe(0);
    expect(cache.stats().stores).toBe(0);
  });

  test("replacing an entry counts as a replacement and keeps byte accounting exact", () => {
    const cache = new SceneImageCache();
    const key = sceneImageCacheKey(identity());
    fill(cache, key, "img-1");
    const bytesBefore = cache.bytes;
    const replaced = fill(cache, key, "img-2");
    expect(replaced.stored && replaced.replaced).toBe(true);
    expect(cache.bytes).toBe(bytesBefore);
    expect(cache.stats().replacements).toBe(1);
    expect(cache.peek(scope, key)?.imageId).toBe("img-2");
  });
});

describe("SceneImageCache in-flight ownership", () => {
  const key = "scene-v2:key";

  test("first claimant owns; waiters receive the owner's entry without a second generation", async () => {
    const cache = new SceneImageCache();
    const owner = cache.claim(scope, key);
    expect(owner.role).toBe("owner");
    const waiter = cache.claim(scope, key);
    expect(waiter.role).toBe("waiter");
    expect(cache.inFlightFor(scope, key)).toBe(true);
    const stored = fill(cache, key, "img-1");
    if (owner.role === "owner" && stored.stored) owner.settle({ kind: "entry", entry: stored.entry });
    if (waiter.role === "waiter") {
      const outcome = await waiter.promise;
      expect(outcome).toEqual({ kind: "entry", entry: stored.stored ? stored.entry : (null as never) });
    }
    expect(cache.inFlightFor(scope, key)).toBe(false);
    expect(cache.stats().waits.count).toBe(1);
  });

  test("an aborted owner releases waiters immediately; the next claimant becomes owner", async () => {
    const cache = new SceneImageCache();
    const ownerController = new AbortController();
    const owner = cache.claim(scope, key, ownerController.signal);
    const waiter = cache.claim(scope, key);
    ownerController.abort("superseded");
    if (waiter.role === "waiter") expect(await waiter.promise).toEqual({ kind: "aborted" });
    const next = cache.claim(scope, key);
    expect(next.role).toBe("owner");
    // A late settle from the aborted owner is ignored.
    if (owner.role === "owner") owner.settle({ kind: "failed", error: new Error("late") });
    expect(cache.inFlightFor(scope, key)).toBe(true);
  });

  test("a waiter abort rejects only that waiter with an AbortError", async () => {
    const cache = new SceneImageCache();
    cache.claim(scope, key);
    const waiterController = new AbortController();
    const waiter = cache.claim(scope, key, waiterController.signal);
    waiterController.abort("gone");
    if (waiter.role === "waiter") {
      await expect(waiter.promise).rejects.toMatchObject({ name: "AbortError" });
    }
    expect(cache.inFlightFor(scope, key)).toBe(true);
  });

  test("owner failure is delivered once to waiters (no retry cascade)", async () => {
    const cache = new SceneImageCache();
    const owner = cache.claim(scope, key);
    const waiter = cache.claim(scope, key);
    const error = new Error("provider down");
    if (owner.role === "owner") owner.settle({ kind: "failed", error });
    if (waiter.role === "waiter") expect(await waiter.promise).toEqual({ kind: "failed", error });
    expect(cache.inFlightFor(scope, key)).toBe(false);
  });

  test("clear releases waiters so nothing hangs", async () => {
    const cache = new SceneImageCache();
    cache.claim(scope, key);
    const waiter = cache.claim(scope, key);
    cache.clear();
    if (waiter.role === "waiter") expect(await waiter.promise).toEqual({ kind: "released" });
  });

  test("an already-aborted owner releases in a microtask", async () => {
    const cache = new SceneImageCache();
    const controller = new AbortController();
    controller.abort();
    const owner = cache.claim(scope, key, controller.signal);
    expect(owner.role).toBe("owner");
    await Promise.resolve();
    expect(cache.inFlightFor(scope, key)).toBe(false);
  });
});
