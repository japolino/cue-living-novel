import { describe, expect, test } from "bun:test";
import { POSE_EXPRESSION_CATALOGUE } from "./character.js";
import {
  DEFAULT_SPRITE_EXPRESSION_COUNT,
  SPRITE_EXPRESSION_COUNTS,
  SPRITE_EXPRESSION_FALLBACK,
  SPRITE_HOT_SET,
  SPRITE_SET_4,
  SPRITE_SET_8,
  normalizeSpriteExpressionCount,
  spriteExpressionChain,
  spriteExpressionSet,
  spriteSetExpressionFor,
  spriteSetListing,
  spriteSetReadyCount,
  SpriteStagingSchema,
  bestAvailableExpression,
  plateKeyFor,
  spriteFallbackExpression,
  spriteSetKeyFor,
} from "./sprites.js";

describe("sprite expressions", () => {
  test("hot set ids exist in the catalogue", () => {
    const ids = new Set(POSE_EXPRESSION_CATALOGUE.map((pose) => pose.id));
    for (const id of SPRITE_HOT_SET) expect(ids.has(id)).toBe(true);
  });
  test("every catalogue expression has a hot-set fallback", () => {
    for (const pose of POSE_EXPRESSION_CATALOGUE) {
      expect(SPRITE_HOT_SET as readonly string[]).toContain(SPRITE_EXPRESSION_FALLBACK[pose.id]!);
    }
  });
  test("fallback and best available", () => {
    expect(spriteFallbackExpression("giggling")).toBe("laughing");
    expect(spriteFallbackExpression(null)).toBe("idle");
    expect(spriteFallbackExpression("not-an-id")).toBe("idle");
    expect(bestAvailableExpression("giggling", new Set(["giggling", "laughing"]))).toBe("giggling");
    expect(bestAvailableExpression("giggling", new Set(["laughing"]))).toBe("laughing");
    expect(bestAvailableExpression("giggling", new Set(["idle"]))).toBe("idle");
    expect(bestAvailableExpression("giggling", new Set(["sad"]))).toBe("sad");
    expect(bestAvailableExpression("giggling", new Set())).toBeNull();
  });
});

describe("set sizes (spriteExpressionCount)", () => {
  test("the 4, 8 and 12 sets", () => {
    expect([...SPRITE_EXPRESSION_COUNTS]).toEqual([4, 8, 12]);
    expect(DEFAULT_SPRITE_EXPRESSION_COUNT).toBe(4);
    expect([...spriteExpressionSet(4)]).toEqual(["idle", "smile", "sad", "angry"]);
    expect([...spriteExpressionSet(8)]).toEqual(["idle", "smile", "laughing", "sad", "angry", "surprised", "embarrassed", "smug"]);
    expect([...spriteExpressionSet(12)]).toEqual([...SPRITE_HOT_SET]);
    // Every smaller set is part of the bigger one, idle first.
    for (const id of SPRITE_SET_4) expect(SPRITE_SET_8 as readonly string[]).toContain(id);
    for (const id of SPRITE_SET_8) expect(SPRITE_HOT_SET as readonly string[]).toContain(id);
    for (const count of SPRITE_EXPRESSION_COUNTS) expect(spriteExpressionSet(count)[0]).toBe("idle");
  });
  test("every catalogue id maps into each set (catalogue -> 12 fallback -> 8 or 4 reduction)", () => {
    for (const count of SPRITE_EXPRESSION_COUNTS) {
      const set = spriteExpressionSet(count) as readonly string[];
      for (const pose of POSE_EXPRESSION_CATALOGUE) expect(set).toContain(spriteSetExpressionFor(pose.id, count));
      for (const id of SPRITE_HOT_SET) expect(set).toContain(spriteSetExpressionFor(id, count));
      expect(spriteSetExpressionFor("not-an-id", count)).toBe("idle");
      expect(spriteSetExpressionFor(null, count)).toBe("idle");
      // Members of the set map to themselves.
      for (const id of set) expect(spriteSetExpressionFor(id, count) as string).toBe(id);
    }
  });
  test("the reduction map", () => {
    expect(spriteSetExpressionFor("worried", 8)).toBe("sad");
    expect(spriteSetExpressionFor("scared", 8)).toBe("surprised");
    expect(spriteSetExpressionFor("thinking", 8)).toBe("idle");
    expect(spriteSetExpressionFor("crying_with_eyes_open", 8)).toBe("sad");
    expect(spriteSetExpressionFor("scared", 4)).toBe("sad");
    expect(spriteSetExpressionFor("laughing", 4)).toBe("smile");
    expect(spriteSetExpressionFor("surprised", 4)).toBe("idle");
    expect(spriteSetExpressionFor("embarrassed", 4)).toBe("smile");
    expect(spriteSetExpressionFor("smug", 4)).toBe("smile");
    // A rare id goes through its 12-set fallback first.
    expect(spriteSetExpressionFor("smirk", 12)).toBe("smug");
    expect(spriteSetExpressionFor("smirk", 8)).toBe("smug");
    expect(spriteSetExpressionFor("smirk", 4)).toBe("smile");
    expect(spriteSetExpressionFor("nervous", 4)).toBe("sad");
    expect(spriteSetExpressionFor("shocked", 4)).toBe("idle");
  });
  test("normalize: missing or unknown values are 4", () => {
    expect(normalizeSpriteExpressionCount(undefined)).toBe(4);
    expect(normalizeSpriteExpressionCount(6)).toBe(4);
    expect(normalizeSpriteExpressionCount("8")).toBe(8);
    expect(normalizeSpriteExpressionCount(12)).toBe(12);
    expect(normalizeSpriteExpressionCount("all")).toBe(4);
  });
  test("chain and best available: any image that exists is used, nearest first", () => {
    expect(spriteExpressionChain("scared")).toEqual(["scared", "surprised", "sad"]);
    expect(spriteExpressionChain("happy_tears")).toEqual(["happy_tears", "crying_with_eyes_open", "sad"]);
    expect(spriteExpressionChain("smirk")).toEqual(["smirk", "smug", "smile"]);
    expect(spriteExpressionChain(null)).toEqual(["idle"]);
    // 4 mode with an old "surprised" image: it is shown.
    expect(bestAvailableExpression("shocked", new Set(["idle", "surprised"]))).toBe("surprised");
    expect(bestAvailableExpression("scared", new Set(["idle", "sad", "smile", "angry"]))).toBe("sad");
    expect(bestAvailableExpression("worried", new Set(["idle", "sad"]))).toBe("sad");
    expect(bestAvailableExpression("smug", new Set(["idle", "smile"]))).toBe("smile");
  });
  test("set listing and ready counts follow the size; existing images stay listed", () => {
    const expressions: Record<string, { status: "ready" | "missing" | "queued" | "failed"; url?: string }> = {
      idle: { status: "ready", url: "/i" },
      smile: { status: "missing" },
      surprised: { status: "ready", url: "/s" },
      worried: { status: "missing" },
      happy_tears: { status: "failed" },
    };
    expect(spriteSetListing(expressions, 4)).toEqual(["idle", "smile", "sad", "angry", "surprised", "happy_tears"]);
    // Progress counts the active set only (surprised is listed and shown, not counted).
    expect(spriteSetReadyCount(expressions, 4)).toEqual({ ready: 1, total: 4 });
    expect(spriteSetReadyCount({}, 4)).toEqual({ ready: 0, total: 4 });
    expect(spriteSetReadyCount({}, 8)).toEqual({ ready: 0, total: 8 });
    expect(spriteSetReadyCount({}, 12)).toEqual({ ready: 0, total: 12 });
    expect(spriteSetListing(expressions, 12).slice(0, 12)).toEqual([...SPRITE_HOT_SET]);
  });
});

describe("sprite keys", () => {
  test("plate keys ignore case and spacing, and depend on style", () => {
    const a = plateKeyFor({ location: "School  Rooftop", timeOfDay: "Sunset", weather: null }, "s1");
    expect(a).toBe(plateKeyFor({ location: "school rooftop", timeOfDay: "sunset" }, "s1"));
    expect(a).not.toBe(plateKeyFor({ location: "school rooftop", timeOfDay: "sunset" }, "s2"));
    expect(a).not.toBe(plateKeyFor({ location: "school rooftop", timeOfDay: "night" }, "s1"));
  });
  test("set keys change with outfit", () => {
    const base = { name: "Mira", identity: "long black hair, red eyes", attire: "school uniform" };
    expect(spriteSetKeyFor(base, "s")).not.toBe(spriteSetKeyFor({ ...base, attire: "pajamas" }, "s"));
    expect(spriteSetKeyFor(base, "s")).toBe(spriteSetKeyFor({ ...base, name: " mira " }, "s"));
  });
});

describe("staging schema", () => {
  test("accepts a minimal staging and applies defaults", () => {
    const parsed = SpriteStagingSchema.parse({
      version: 1,
      source: "planner",
      cast: [{ characterKey: "mira", name: "Mira", identity: "black hair", attire: null }],
      plates: [],
      paragraphs: [{ actors: [{ characterKey: "mira", expression: "smile", slot: "center" }], plateKey: null }],
    });
    expect(parsed.paragraphs[0]!.actors[0]).toEqual({ characterKey: "mira", expression: "smile", slot: "center", facing: "viewer", focus: false, motion: "none", emote: "none", intensity: 3 });
    expect(parsed.paragraphs[0]!.light).toBe("neutral");
  });
  test("rejects more than three actors", () => {
    const actor = (key: string) => ({ characterKey: key, expression: "idle", slot: "center" });
    expect(() => SpriteStagingSchema.parse({ version: 1, source: "planner", cast: [], plates: [], paragraphs: [{ actors: ["a", "b", "c", "d"].map(actor), plateKey: null }] })).toThrow();
  });
});
