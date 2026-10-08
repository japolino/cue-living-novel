import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { SPRITE_HOT_SET, spriteSetKeyFor, plateKeyFor, type SpriteStaging } from "../../../shared/sprites.js";
import {
  MAX_SPRITE_PLATES,
  MAX_SPRITE_SETS,
  SPRITE_LIBRARY_PATH,
  SpriteLibraryStore,
  emptySpriteLibrary,
  newPlate,
  newSpriteSet,
  normalizeSpriteLibrary,
  pruneSpriteLibrary,
} from "./library.js";
import { spriteSeedFor, spriteSetSeedFor } from "./style.js";
import { missingSetView, spriteLibraryView, spriteSetView, spriteTurnView, stagingPlateKeys } from "./views.js";

const STYLE = "style_test";
const member = { name: "Mira", identity: "1girl, silver hair", attire: null };

function storage() {
  const data = new Map<string, unknown>();
  const writes: Array<{ path: string; value: string; userId?: string }> = [];
  let delayMs = 0;
  const spindle = {
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown; userId?: string }) => {
        const value = data.get(`${options.userId ?? "owner"}:${path}`);
        return value === undefined ? options.fallback : JSON.parse(JSON.stringify(value));
      },
      setJson: async (path: string, value: unknown, options: { userId?: string } = {}) => {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        const text = JSON.stringify(value);
        writes.push({ path, value: text, ...(options.userId ? { userId: options.userId } : {}) });
        data.set(`${options.userId ?? "owner"}:${path}`, JSON.parse(text));
      },
    },
  } as unknown as SpindleAPI;
  return { spindle, data, writes, setDelay: (ms: number) => { delayMs = ms; } };
}

describe("sprite library: shape and bounds", () => {
  test("a new set lists the whole hot set as missing, with a fixed seed", () => {
    const set = newSpriteSet(member, spriteSetKeyFor(member, STYLE), STYLE, "2026-01-01T00:00:00.000Z");
    expect(Object.keys(set.images)).toEqual([...SPRITE_HOT_SET]);
    expect(Object.values(set.images).every((image) => image.status === "missing")).toBe(true);
    expect(set.seed).toBe(newSpriteSet(member, set.setKey, STYLE, "x").seed);
  });

  test("normalize drops bad entries one by one and rejects other versions", () => {
    const good = newSpriteSet(member, "set_a", STYLE, "2026-01-01T00:00:00.000Z");
    const library = normalizeSpriteLibrary({
      version: 1,
      sets: { set_a: good, set_bad: { setKey: "set_bad" }, set_wrong_key: { ...good, setKey: "other" } },
      plates: { p: { plateKey: "p" } },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(Object.keys(library.sets)).toEqual(["set_a"]);
    expect(library.plates).toEqual({});
    expect(normalizeSpriteLibrary({ version: 2, sets: { set_a: good } }).sets).toEqual({});
    expect(normalizeSpriteLibrary("garbage").sets).toEqual({});
  });

  test("a bad image entry is dropped without losing its set", () => {
    const good = newSpriteSet(member, "set_a", STYLE, "2026-01-01T00:00:00.000Z");
    const library = normalizeSpriteLibrary({ version: 1, sets: { set_a: { ...good, images: { ...good.images, smile: { status: "weird" } } } }, plates: {} });
    expect(library.sets.set_a).toBeDefined();
    expect(library.sets.set_a!.images.smile).toBeUndefined();
    expect(library.sets.set_a!.images.idle).toBeDefined();
  });

  test("prune keeps the newest 64 sets and 128 plates by last use", () => {
    const library = emptySpriteLibrary();
    for (let index = 0; index < MAX_SPRITE_SETS + 5; index += 1) {
      const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      library.sets[`set_${index}`] = newSpriteSet({ ...member, name: `C${index}` }, `set_${index}`, STYLE, stamp);
    }
    // An old set used just now survives.
    library.sets.set_0!.usedAt = new Date(Date.UTC(2027, 0, 1)).toISOString();
    for (let index = 0; index < MAX_SPRITE_PLATES + 3; index += 1) {
      const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      library.plates[`plate_${index}`] = newPlate({ plateKey: `plate_${index}`, location: `L${index}`, timeOfDay: null, weather: null, description: "" }, STYLE, stamp);
    }
    const dropped = pruneSpriteLibrary(library);
    expect(Object.keys(library.sets)).toHaveLength(MAX_SPRITE_SETS);
    expect(Object.keys(library.plates)).toHaveLength(MAX_SPRITE_PLATES);
    expect(library.sets.set_0).toBeDefined();
    expect(dropped.sets.map((set) => set.setKey).sort()).toEqual(["set_1", "set_2", "set_3", "set_4", "set_5"]);
    expect(dropped.plates.map((plate) => plate.plateKey).sort()).toEqual(["plate_0", "plate_1", "plate_2"]);
  });
});

describe("sprite library: seeds and the duplicate check (schema compatibility)", () => {
  test("a new set starts at seed round 0; images record no seed, no check, no retry", () => {
    const set = newSpriteSet(member, "set_a", STYLE, "2026-01-01T00:00:00.000Z");
    expect(set.seedRound).toBe(0);
    expect(set.seed).toBe(spriteSetSeedFor("set_a", 0));
    expect(set.images.idle).toMatchObject({ seed: null, ownSeed: false, twoFigures: null, autoRetried: false });
  });

  test("set seeds differ per round and stay 32-bit", () => {
    const seeds = [0, 1, 2, 3].map((round) => spriteSetSeedFor("set_a", round));
    expect(new Set(seeds).size).toBe(4);
    expect(seeds[0]).toBe(spriteSeedFor("set_a"));
    for (const seed of seeds) expect(seed >= 0 && seed < 2 ** 32 && Number.isInteger(seed)).toBe(true);
  });

  test("v1 data without the new fields still parses (generated images keep their own regeneration seed)", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const legacyImage = (expression: string, attempts: number) => ({
      expression, status: attempts ? "ready" : "queued", rawImageId: attempts ? `raw-${expression}` : null, rawImageUrl: null, cutImageId: null, cutUrl: null,
      bbox: null, width: null, height: null, quality: null, upgrade: null, error: null, attempts, cutAttempts: 0, createdAt: now, updatedAt: now,
    });
    const legacySet = {
      setKey: "set_a", styleKey: STYLE, name: "Mira", identity: "1girl", attire: null, seed: 7,
      images: { idle: legacyImage("idle", 1), smile: legacyImage("smile", 0) }, createdAt: now, updatedAt: now, usedAt: now,
    };
    const library = normalizeSpriteLibrary({ version: 1, sets: { set_a: legacySet }, plates: {}, updatedAt: now });
    const set = library.sets.set_a!;
    expect(set.seed).toBe(7);
    expect(set.seedRound).toBe(0);
    expect(set.images.idle).toMatchObject({ seed: null, ownSeed: true, twoFigures: null, autoRetried: false });
    expect(set.images.smile).toMatchObject({ ownSeed: false });
    // Stored values round-trip.
    const again = normalizeSpriteLibrary(JSON.parse(JSON.stringify({ ...library, sets: { set_a: { ...set, seedRound: 2, images: { ...set.images, idle: { ...set.images.idle!, ownSeed: false, twoFigures: true, autoRetried: true, seed: 9 } } } } })));
    expect(again.sets.set_a!.seedRound).toBe(2);
    expect(again.sets.set_a!.images.idle).toMatchObject({ seed: 9, ownSeed: false, twoFigures: true, autoRetried: true });
  });
});

describe("sprite library store: persistence", () => {
  test("loads once per user, persists per user, and survives a new store", async () => {
    const { spindle, data } = storage();
    const store = new SpriteLibraryStore(spindle);
    await store.update("u1", (library, now) => { library.sets.set_a = newSpriteSet(member, "set_a", STYLE, now); });
    await store.update("u2", (library, now) => { library.plates.p1 = newPlate({ plateKey: "p1", location: "Pier", timeOfDay: null, weather: null, description: "" }, STYLE, now); });
    expect(Object.keys((data.get(`u1:${SPRITE_LIBRARY_PATH}`) as { sets: object }).sets)).toEqual(["set_a"]);
    expect(Object.keys((data.get(`u2:${SPRITE_LIBRARY_PATH}`) as { plates: object }).plates)).toEqual(["p1"]);
    const reloaded = await new SpriteLibraryStore(spindle).get("u1");
    expect(reloaded.sets.set_a?.name).toBe("Mira");
    expect(reloaded.plates).toEqual({});
  });

  test("bursts of updates are serialized and coalesced; the last write holds the final state", async () => {
    const { spindle, writes, setDelay } = storage();
    setDelay(5);
    const store = new SpriteLibraryStore(spindle);
    await store.get("u");
    const updates = Array.from({ length: 10 }, (_, index) => store.update("u", (library, now) => {
      library.sets[`set_${index}`] = newSpriteSet({ ...member, name: `C${index}` }, `set_${index}`, STYLE, now);
    }));
    await Promise.all(updates);
    await store.flush("u");
    expect(writes.length).toBeLessThanOrEqual(3);
    const last = JSON.parse(writes.at(-1)!.value) as { sets: Record<string, unknown> };
    expect(Object.keys(last.sets)).toHaveLength(10);
  });

  test("pruned entries are reported so their images can be deleted", async () => {
    const { spindle } = storage();
    const pruned: string[] = [];
    const store = new SpriteLibraryStore(spindle, { limits: { sets: 1 }, onPruned: (_user, dropped) => pruned.push(...dropped.sets.map((set) => set.setKey)) });
    await store.update("u", (library) => { library.sets.old = newSpriteSet(member, "old", STYLE, "2026-01-01T00:00:00.000Z"); });
    await store.update("u", (library) => { library.sets.new = newSpriteSet(member, "new", STYLE, "2026-02-01T00:00:00.000Z"); });
    expect(pruned).toEqual(["old"]);
    expect(Object.keys((await store.get("u")).sets)).toEqual(["new"]);
  });
});

describe("sprite views", () => {
  test("a set view always lists the hot set; urls only for ready cut-outs", () => {
    const set = newSpriteSet(member, "set_a", STYLE, "2026-01-01T00:00:00.000Z");
    set.images.idle = { ...set.images.idle!, status: "ready", cutImageId: "cut1", cutUrl: "/api/v1/images/cut1", bbox: [0.1, 0.05, 0.8, 0.95], width: 832, height: 1216, rawImageId: "raw1" };
    set.images.smile = { ...set.images.smile!, status: "failed", error: "provider down" };
    set.images.sad = { ...set.images.sad!, status: "cutting", rawImageId: "raw2", cutUrl: null };
    set.images.happy_tears = { ...set.images.idle!, expression: "happy_tears", status: "queued", cutUrl: null, cutImageId: null };
    const view = spriteSetView(set);
    expect(Object.keys(view.expressions)).toEqual([...SPRITE_HOT_SET, "happy_tears"]);
    expect(view.readyCount).toBe(1);
    expect(view.expressions.idle).toEqual({ expression: "idle", status: "ready", url: "/api/v1/images/cut1", bbox: [0.1, 0.05, 0.8, 0.95], width: 832, height: 1216 });
    expect(view.expressions.smile).toEqual({ expression: "smile", status: "failed", error: "provider down" });
    expect(view.expressions.sad).toEqual({ expression: "sad", status: "cutting" });
    expect(view.expressions.happy_tears?.url).toBeUndefined();
  });

  test("a ready image the duplicate check flagged says so; other statuses do not", () => {
    const set = newSpriteSet(member, "set_a", STYLE, "2026-01-01T00:00:00.000Z");
    set.images.idle = { ...set.images.idle!, status: "ready", cutImageId: "cut1", cutUrl: "/api/v1/images/cut1", rawImageId: "raw1", twoFigures: true };
    set.images.smile = { ...set.images.smile!, status: "cutting", rawImageId: "raw2", twoFigures: true };
    set.images.sad = { ...set.images.sad!, status: "ready", cutImageId: "cut3", cutUrl: "/api/v1/images/cut3", rawImageId: "raw3", twoFigures: false };
    const view = spriteSetView(set);
    expect(view.expressions.idle!.twoFigures).toBe(true);
    expect(view.expressions.smile!.twoFigures).toBeUndefined();
    expect(view.expressions.sad!.twoFigures).toBeUndefined();
  });

  test("turn view keys sets by characterKey and plates by plateKey, missing ones included", () => {
    const placeKey = plateKeyFor({ location: "Observatory", timeOfDay: "night" }, STYLE);
    const staging: SpriteStaging = {
      version: 1,
      source: "planner",
      cast: [
        { characterKey: "mira", name: "Mira", identity: "1girl, silver hair", attire: null },
        { characterKey: "kai", name: "Kai", identity: "1boy, black hair", attire: "coat" },
      ],
      plates: [{ plateKey: placeKey, location: "Observatory", timeOfDay: "night", weather: null, description: "dome" }],
      paragraphs: [{ actors: [], plateKey: placeKey, light: "night" }, { actors: [], plateKey: "plate_reused", light: "night" }],
    };
    const library = emptySpriteLibrary();
    const miraKey = spriteSetKeyFor(staging.cast[0]!, STYLE);
    library.sets[miraKey] = newSpriteSet(staging.cast[0]!, miraKey, STYLE, "2026-01-01T00:00:00.000Z");
    library.plates.plate_reused = newPlate({ plateKey: "plate_reused", location: "Dome", timeOfDay: "night", weather: null, description: "" }, STYLE, "2026-01-01T00:00:00.000Z");
    library.plates.plate_reused.status = "ready";
    library.plates.plate_reused.url = "/api/v1/images/plate1";
    expect(stagingPlateKeys(staging)).toEqual([placeKey, "plate_reused"]);
    const view = spriteTurnView(staging, library, STYLE);
    expect(view.staging).toBe(staging);
    expect(view.sets.mira?.setKey).toBe(miraKey);
    expect(view.sets.kai).toEqual(missingSetView(staging.cast[1]!, spriteSetKeyFor(staging.cast[1]!, STYLE)));
    expect(view.plates[placeKey]?.status).toBe("missing");
    expect(view.plates.plate_reused).toEqual({ plateKey: "plate_reused", location: "Dome", timeOfDay: "night", weather: null, status: "ready", url: "/api/v1/images/plate1" });
  });

  test("library view is newest first", () => {
    const library = emptySpriteLibrary();
    library.sets.a = newSpriteSet({ ...member, name: "A" }, "a", STYLE, "2026-01-01T00:00:00.000Z");
    library.sets.b = newSpriteSet({ ...member, name: "B" }, "b", STYLE, "2026-03-01T00:00:00.000Z");
    expect(spriteLibraryView(library).sets.map((set) => set.name)).toEqual(["B", "A"]);
  });
});

describe("sprite library: face boxes", () => {
  test("old images without a face load as unknown; a box and null persist", () => {
    const set = newSpriteSet(member, "set_a", STYLE, "2026-01-01T00:00:00.000Z");
    const ready = { ...set.images.idle!, status: "ready" as const, cutImageId: "c1", cutUrl: "/api/v1/images/c1", bbox: [0, 0, 1, 1] as [number, number, number, number] };
    const raw = JSON.parse(JSON.stringify({ version: 1, sets: { set_a: { ...set, images: {
      idle: ready,
      smile: { ...ready, expression: "smile", face: [0.4, 0.1, 0.2, 0.15] },
      sad: { ...ready, expression: "sad", face: null },
    } } }, plates: {}, updatedAt: "x" }));
    const images = normalizeSpriteLibrary(raw).sets.set_a!.images;
    expect("face" in images.idle!).toBe(false);
    expect(images.smile!.face).toEqual([0.4, 0.1, 0.2, 0.15]);
    expect(images.sad!.face).toBeNull();
    const view = spriteSetView(normalizeSpriteLibrary(raw).sets.set_a!);
    expect("face" in view.expressions.idle!).toBe(false);
    expect(view.expressions.smile!.face).toEqual([0.4, 0.1, 0.2, 0.15]);
    expect(view.expressions.sad!.face).toBeNull();
  });
});
