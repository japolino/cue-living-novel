import { describe, expect, test } from "bun:test";
import {
  appearanceMapKeyFor,
  buildCanonicalIdentity,
  characterAppearanceKey,
  isUsableIdentity,
  normalizeCharacterName,
  normalizeReferenceTags,
  sanitizeMemoryTags,
  toUsableTags,
  type CharacterAppearanceMap
} from "./identity.js";

describe("normalizeCharacterName / characterAppearanceKey", () => {
  test("strips parentheticals and collapses whitespace", () => {
    expect(normalizeCharacterName("  Hina  ")).toBe("Hina");
    expect(normalizeCharacterName("Hina (the girl)")).toBe("Hina");
  });

  test("keys are case-insensitive", () => {
    expect(characterAppearanceKey("Hina")).toBe("hina");
    expect(characterAppearanceKey("hInA")).toBe("hina");
  });
});

describe("normalizeReferenceTags", () => {
  test("drops null/none and de-duplicates", () => {
    expect(normalizeReferenceTags("silver hair, null, none, silver hair, green eyes")).toBe("silver hair, green eyes");
  });

  test("drops redundant sub-tagged entries (keeps the richer one)", () => {
    expect(normalizeReferenceTags("red coat, red wool coat")).toBe("red wool coat");
  });
});

describe("sanitizeMemoryTags (transient filtering)", () => {
  test("removes transient pose/expression/action/camera terms while keeping appearance", () => {
    const input = "silver hair, green eyes, standing, looking up, smug smirk, upper body, black uniform, red coat";
    expect(sanitizeMemoryTags(input)).toBe("silver hair, green eyes, black uniform, red coat");
  });

  test("removes posture / expression / environment / camera terms", () => {
    const input = "straight-on, eye level, medium shot, elegant posture, neutral expression, chair, window";
    expect(sanitizeMemoryTags(input)).toBe("");
  });

  test("keeps physical appearance, body and explicit attire", () => {
    const input = "petite, small slender build, golden blonde short hair, brilliant red eyes, black high school uniform, white pantyhose";
    expect(sanitizeMemoryTags(input)).toBe("petite, small slender build, golden blonde short hair, brilliant red eyes, black high school uniform, white pantyhose");
  });

  test("drops the expression term even when it is camel-cased or hyphenated", () => {
    expect(sanitizeMemoryTags("smug-smirk, red-eyes")).toBe("red-eyes");
  });
});

describe("toUsableTags / isUsableIdentity", () => {
  test("never treats the character name as an appearance tag", () => {
    expect(toUsableTags("Hina", ["Hina"])).toEqual([]);
    expect(toUsableTags("Hina", ["Hina", "silver hair"])).toEqual(["silver hair"]);
  });

  test("a name-only identity is never usable", () => {
    expect(isUsableIdentity("Hina", ["Hina"])).toBe(false);
    expect(isUsableIdentity("Hina", [])).toBe(false);
  });

  test("a real physical identity is usable", () => {
    expect(isUsableIdentity("Hina", ["silver hair", "green eyes"])).toBe(true);
  });

  test("sanitizes transient terms out of the usable tags", () => {
    expect(toUsableTags("Hina", ["silver hair", "standing", "blushing"])).toEqual(["silver hair"]);
  });
});

describe("appearanceMapKeyFor", () => {
  test("finds a key case-insensitively", () => {
    const map: CharacterAppearanceMap = { Hina: "silver hair" };
    expect(appearanceMapKeyFor(map, "hina")).toBe("Hina");
    expect(appearanceMapKeyFor(map, "missing")).toBeUndefined();
  });
});

describe("buildCanonicalIdentity", () => {
  test("produces a cleaned name + usable tags", () => {
    expect(buildCanonicalIdentity("  Hina  ", ["silver hair", "Hina", "red coat", "red wool coat"]))
      .toEqual({ name: "Hina", tags: ["silver hair", "red wool coat"] });
  });
});
