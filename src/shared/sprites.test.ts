import { describe, expect, test } from "bun:test";
import { POSE_EXPRESSION_CATALOGUE } from "./character.js";
import {
  SPRITE_EXPRESSION_FALLBACK,
  SPRITE_HOT_SET,
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
