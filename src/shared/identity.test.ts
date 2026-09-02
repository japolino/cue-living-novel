import { describe, expect, test } from "bun:test";
import {
  appearanceMapKeyFor,
  buildCanonicalIdentity,
  characterAppearanceKey,
  distillVisualTags,
  hasIdentityDocumentNoise,
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


describe("distillVisualTags", () => {
  test("extracts visual fields from the real markdown card shape and rejects all other fields", () => {
    const card = `## Basic Information
**Full Name:** Tachibana Hina
**Age:** 18
**Gender:** Female
**Nationality:** Japanese
**Occupation:** High School Student
## Physical Appearance
**Hair:** Golden blonde short cut
**Eyes:** Brilliant red irises with stark white pupils
**Facial Features:** Round, naturally flushed cheeks
**Clothing Style:** Black high school uniform with red sailor ribbon, completely shaved intimate areas, Plump, soft cheeks
## Personality
**General Demeanor:** Dual-faced - proper lady in public, teasing devil with {{user}}
**Habits:** Twirling hair when thinking, secretly taking photos of {{user}} without permission
## Speech Pattern
**Catchphrases:** "Hmph, she sits on {{user}}'s lap."`;
    expect(distillVisualTags(card)).toEqual([
      "18-year-old",
      "female",
      "Golden blonde short cut",
      "Brilliant red irises with stark white pupils",
      "round face",
      "naturally flushed cheeks",
      "Black high school uniform",
      "red sailor ribbon"
    ]);
    const joined = distillVisualTags(card).join(", ");
    for (const rejected of ["##", "**", "{{", "Twirling", "Catchphrases", "shaved", "Plump", "soft cheeks", "lap"]) {
      expect(joined).not.toContain(rejected);
    }
  });

  test("rejects document noise in stored identity while accepting compact planner tags", () => {
    expect(hasIdentityDocumentNoise("## Appearance **Hair:** blonde")).toBe(true);
    expect(hasIdentityDocumentNoise("golden blonde short hair, brilliant red eyes, black uniform")).toBe(false);
    expect(distillVisualTags("18-year-old petite Japanese girl, golden blonde short hair, brilliant red eyes, black sailor uniform"))
      .toEqual(["18-year-old petite Japanese girl", "golden blonde short hair", "brilliant red eyes", "black sailor uniform"]);
  });

  test("distillVisualTags extracts monster girl and furry fields (species, ears, tail, horns, wings, fur)", () => {
    const card = `
# Character Profile: Vespera
Species: Demon girl
Ears: pointy elf ears
Horns: two black curved horns
Wings: large bat wings
Tail: spade demon tail
Hair: crimson red waist-length hair
Eyes: glowing golden eyes
Clothing: leather gothic dress, spiked choker
`;
    const tags = distillVisualTags(card);
    expect(tags).toContain("pointy elf ears");
    expect(tags).toContain("two black curved horns");
    expect(tags).toContain("large bat wings");
    expect(tags).toContain("spade demon tail");
    expect(tags).toContain("crimson red waist-length hair");
    expect(tags).toContain("glowing golden eyes");
    expect(tags).toContain("leather gothic dress");
  });

  test("distillVisualTags extracts anthro / furry features", () => {
    const card = `
Species: Snow Leopard
Race: Anthro / Furry
Features: feline muzzle, spotted white fur, furry paws, long bushy tail
Hair: short white hair
Eyes: ice blue eyes
Attire: sleeveless martial arts gi, fingerless gloves
`;
    const tags = distillVisualTags(card);
    expect(tags).toContain("short white hair");
    expect(tags).toContain("ice blue eyes");
    expect(tags).toContain("sleeveless martial arts gi");
  });
});
