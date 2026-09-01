import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ENVIRONMENT_DESCRIPTOR,
  emptySingleCharacter,
  normalizeSingleCharacter,
  seedSingleCharacter,
  singleCharacterTagBlock,
  splitDescriptionTags
} from "./visual-state.js";
import { SINGLE_CHARACTER_SCHEMA_VERSION } from "../../shared/character.js";

describe("single-character registry", () => {
  test("emptySingleCharacter is an unseeded frozen placeholder", () => {
    const empty = emptySingleCharacter();
    expect(empty.schemaVersion).toBe(SINGLE_CHARACTER_SCHEMA_VERSION);
    expect(empty.protagonist).toEqual({ name: "", tags: [] });
    expect(empty.environment).toBe(DEFAULT_ENVIRONMENT_DESCRIPTOR);
    expect(empty.updatedAt).toBe(new Date(0).toISOString());
  });

  test("emptySingleCharacter accepts an explicit environment", () => {
    expect(emptySingleCharacter("A sunlit courtyard").environment).toBe("A sunlit courtyard");
  });

  test("seedSingleCharacter trims the name and splits the description into tags", () => {
    const state = seedSingleCharacter("  Mira  ", "silver hair, green eyes, silver hair, red coat");
    expect(state.schemaVersion).toBe(SINGLE_CHARACTER_SCHEMA_VERSION);
    expect(state.protagonist.name).toBe("Mira");
    // Duplicate "silver hair" (case-differing this time) is de-duplicated.
    expect(state.protagonist.tags).toEqual(["silver hair", "green eyes", "red coat"]);
  });

  test("seedSingleCharacter rejects blank tags but keeps the identity", () => {
    const state = seedSingleCharacter("Mira", "silver hair,  ,,green eyes,   ");
    expect(state.protagonist.tags).toEqual(["silver hair", "green eyes"]);
  });

  test("singleCharacterTagBlock joins the frozen tag block", () => {
    const state = seedSingleCharacter("Mira", "silver hair, green eyes, red coat");
    expect(singleCharacterTagBlock(state)).toBe("silver hair, green eyes, red coat");
  });

  test("seed -> normalizeRoundTrip keeps the identity frozen", () => {
    const seeded = seedSingleCharacter("Mira", "silver hair, green eyes");
    const normalized = normalizeSingleCharacter(JSON.parse(JSON.stringify(seeded)));
    expect(normalized.protagonist).toEqual(seeded.protagonist);
    expect(normalized.protagonist.tags).toEqual(["silver hair", "green eyes"]);
  });
});

describe("splitDescriptionTags (robust normalized handling)", () => {
  test("trims, collapses whitespace, and drops empties", () => {
    expect(splitDescriptionTags("  silver   hair , , green eyes ,, ")).toEqual(["silver hair", "green eyes"]);
  });

  test("de-duplicates case-insensitively, preserving first-seen casing and order", () => {
    expect(splitDescriptionTags("Red Coat, red coat, BLUE SCARF, blue scarf")).toEqual(["Red Coat", "BLUE SCARF"]);
  });

  test("returns an empty array for blank input", () => {
    expect(splitDescriptionTags("")).toEqual([]);
    expect(splitDescriptionTags("  , ,  ")).toEqual([]);
  });
});

describe("schema-v1 profile migration", () => {
  test("migrates a legacy { schemaVersion: 1, profiles } record to the protagonist", () => {
    const legacy = {
      schemaVersion: 1,
      profiles: {
        mira: { name: "Mira", description: "silver hair, green eyes" },
        theo: { name: "Theo", description: "round glasses" }
      },
      updatedAt: "2024-01-01T00:00:00.000Z"
    };
    const state = normalizeSingleCharacter(legacy);
    expect(state.schemaVersion).toBe(SINGLE_CHARACTER_SCHEMA_VERSION);
    // First profile entry becomes the frozen protagonist.
    expect(state.protagonist.name).toBe("Mira");
    expect(state.protagonist.tags).toEqual(["silver hair", "green eyes"]);
    expect(state.updatedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  test("honours an explicit preferred protagonist name", () => {
    const legacy = {
      schemaVersion: 1,
      profiles: {
        mira: { name: "Mira", description: "silver hair" },
        theo: { name: "Theo", description: "round glasses" }
      }
    };
    const state = normalizeSingleCharacter(legacy, "theo");
    expect(state.protagonist.name).toBe("Theo");
  });

  test("migrates an ungated flat profile map", () => {
    const flat = { mira: { name: "Mira", description: "silver hair" } };
    const state = normalizeSingleCharacter(flat);
    expect(state.protagonist.name).toBe("Mira");
    expect(state.protagonist.tags).toEqual(["silver hair"]);
  });

  test("falls back to the empty state for garbage input", () => {
    const empty = normalizeSingleCharacter(null);
    expect(empty.protagonist).toEqual({ name: "", tags: [] });
    expect(normalizeSingleCharacter("nope").protagonist).toEqual({ name: "", tags: [] });
    expect(normalizeSingleCharacter({}).protagonist).toEqual({ name: "", tags: [] });
  });

  test("is non-destructive: does not mutate its input", () => {
    const legacy = {
      schemaVersion: 1,
      profiles: { mira: { name: "Mira", description: "silver hair" } }
    };
    const snapshot = JSON.parse(JSON.stringify(legacy));
    normalizeSingleCharacter(legacy);
    expect(legacy).toEqual(snapshot);
  });
});
