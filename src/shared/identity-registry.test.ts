import { describe, expect, test } from "bun:test";
import {
  characterIdFor,
  mergeCharacterDeclarations,
  normalizeCharacterId,
  normalizeCharacterRegistry,
  normalizeSubjectCategory,
  registryToAppearanceMap,
  resolveCharacterReference,
  canonicalCharacterName,
  stripAnatomyCompounds,
  subjectCategoryFromTags,
  subjectPromptFor,
  type CharacterRegistry
} from "./identity.js";

describe("subject category is separate from anatomy", () => {
  test("animal ears, tails and species words never classify the subject", () => {
    for (const tags of [
      "kitsune, fox ears, fox tail, silver hair",
      "cat ears, black hair",
      "wolf ears, wolf tail, school uniform",
      "animal ears, fluffy tail",
      "dog, golden retriever ears",
      "Aetherborn species, gills anatomy, blue eyes"
    ]) {
      expect(subjectCategoryFromTags(tags)).toBe("unknown");
    }
  });

  test("explicit gender words decide the category, including species-gender compounds", () => {
    expect(subjectCategoryFromTags("fox girl, fox ears")).toBe("female");
    expect(subjectCategoryFromTags("female, kitsune, fox ears")).toBe("female");
    expect(subjectCategoryFromTags(["1girl", "cat ears"])).toBe("female");
    expect(subjectCategoryFromTags("anthro wolf male warrior, gray fur")).toBe("male");
    expect(subjectCategoryFromTags("catboy, cat ears")).toBe("male");
    expect(subjectCategoryFromTags("male, elf")).toBe("male");
  });

  test("woman forms are female, never a *man conflict (regression)", () => {
    for (const tags of ["woman, red hair", "policewoman, blue uniform", "young woman, cat ears", "businesswoman, glasses", "catwoman, black suit"]) {
      expect(subjectCategoryFromTags(tags)).toBe("female");
    }
    expect(subjectCategoryFromTags("fisherman, beard")).toBe("male");
    expect(subjectCategoryFromTags("policeman, cap")).toBe("male");
    expect(subjectCategoryFromTags("woman, man")).toBe("unknown");
  });

  test("explicit nonbinary and nonhuman are honoured and conflicts stay unknown", () => {
    expect(subjectCategoryFromTags("nonbinary, short hair, cat ears")).toBe("nonbinary");
    expect(subjectCategoryFromTags("agender, silver hair")).toBe("nonbinary");
    expect(subjectCategoryFromTags("quadruped, four legs, wolf")).toBe("nonhuman");
    expect(subjectCategoryFromTags("monster species, gills anatomy")).toBe("nonhuman");
    expect(subjectCategoryFromTags("girl, man")).toBe("unknown");
  });

  test("planner/card values normalize to the closed category set", () => {
    expect(normalizeSubjectCategory("Female (she/her)")).toBe("female");
    expect(normalizeSubjectCategory("non-binary")).toBe("nonbinary");
    expect(normalizeSubjectCategory("NON_HUMAN")).toBe("nonhuman");
    expect(normalizeSubjectCategory("Male")).toBe("male");
    expect(normalizeSubjectCategory("kitsune")).toBe("unknown");
    expect(normalizeSubjectCategory(null)).toBe("unknown");
  });

  test("anatomy compounds are stripped while species-gender compounds survive", () => {
    expect(stripAnatomyCompounds("fox girl, fox ears, fox tail")).toBe("fox girl, ,");
    expect(stripAnatomyCompounds("cat ears, black hair")).toBe(", black hair");
    expect(stripAnatomyCompounds("wolf girl ears")).toBe("");
  });

  test("subject prompts map categories and leave unknown undecided", () => {
    expect(subjectPromptFor("female")).toEqual(["girl", "1girl, solo"]);
    expect(subjectPromptFor("male")).toEqual(["boy", "1boy, solo"]);
    expect(subjectPromptFor("nonbinary")).toEqual(["other", "1other, solo"]);
    expect(subjectPromptFor("nonhuman")).toEqual(["other", "1other, solo"]);
    expect(subjectPromptFor("unknown")).toBeNull();
  });
});

describe("stable character ids", () => {
  test("ids derive from the canonical name and ignore parentheticals and case", () => {
    expect(characterIdFor("Kitsune")).toBe("kitsune");
    expect(characterIdFor("  Fox Girl (Yuki) ")).toBe("fox-girl");
    expect(characterIdFor("Élodie")).toBe("elodie");
    expect(characterIdFor("")).toBe("");
  });

  test("non-Latin names still get a stable non-empty id", () => {
    const id = characterIdFor("雪");
    expect(id).toMatch(/^char-[0-9a-f]{8}$/);
    expect(characterIdFor("雪")).toBe(id);
  });

  test("planner-supplied ids are normalized, prefixes dropped, junk rejected", () => {
    expect(normalizeCharacterId("char:Kitsune")).toBe("kitsune");
    expect(normalizeCharacterId(" Shark Girl ")).toBe("shark-girl");
    expect(normalizeCharacterId(42)).toBe("");
    expect(normalizeCharacterId("   ")).toBe("");
  });
});

describe("explicit alias resolution", () => {
  const seeded = (): CharacterRegistry => mergeCharacterDeclarations({}, [
    { name: "Kitsune", tags: "fox ears, fox tail, silver hair, amber eyes, red kimono", subjectCategory: "female" }
  ]).registry;

  test("a label becomes an alias only through an explicit id or alias declaration", () => {
    const viaId = mergeCharacterDeclarations(seeded(), [{ name: "Fox girl", characterId: "kitsune", tags: "fox ears" }]);
    expect(Object.keys(viaId.registry)).toEqual(["kitsune"]);
    expect(viaId.registry.kitsune!.aliases).toEqual(["Fox girl"]);
    expect(resolveCharacterReference(viaId.registry, { name: "fox girl" })?.name).toBe("Kitsune");
    expect(canonicalCharacterName(viaId.registry, { name: "FOX GIRL" })).toBe("Kitsune");

    const viaAliases = mergeCharacterDeclarations(seeded(), [{ name: "Kitsune", aliases: ["Fox girl", "the fox"] }]);
    expect(viaAliases.registry.kitsune!.aliases).toEqual(["Fox girl", "the fox"]);
    expect(canonicalCharacterName(viaAliases.registry, { name: "the fox" })).toBe("Kitsune");
  });

  test("appearance or species never infers an alias: a same-species label stays a new subject", () => {
    const report = mergeCharacterDeclarations(seeded(), [{ name: "Fox girl", tags: "fox ears, fox tail, silver hair" }]);
    expect(Object.keys(report.registry).sort()).toEqual(["fox-girl", "kitsune"]);
    expect(report.registry.kitsune!.aliases).toEqual([]);
    expect(canonicalCharacterName(report.registry, { name: "Fox girl" })).toBe("Fox girl");
  });

  test("two distinct characters of the same species keep separate ids and bodies", () => {
    const report = mergeCharacterDeclarations(seeded(), [
      { name: "Yuki", tags: "kitsune, fox ears, white hair, blue eyes", subjectCategory: "female" }
    ]);
    expect(report.registry.yuki!.tags).toContain("white hair");
    expect(report.registry.kitsune!.tags).toContain("silver hair");
    expect(resolveCharacterReference(report.registry, { name: "Yuki" })?.id).toBe("yuki");
  });

  test("alias conflicts are rejected and reported, the first owner keeps the name", () => {
    const first = mergeCharacterDeclarations(seeded(), [{ name: "Kitsune", aliases: ["Fox girl"] }]).registry;
    const report = mergeCharacterDeclarations(first, [{ name: "Shark Girl", aliases: ["Fox girl", "Kitsune"], tags: "shark girl, dorsal fin" }]);
    expect(report.rejectedAliases).toEqual([
      { alias: "Fox girl", requestedFor: "Shark Girl", ownedBy: "Kitsune" },
      { alias: "Kitsune", requestedFor: "Shark Girl", ownedBy: "Kitsune" }
    ]);
    expect(report.registry["shark-girl"]!.aliases).toEqual([]);
    expect(canonicalCharacterName(report.registry, { name: "Fox girl" })).toBe("Kitsune");
  });

  test("unknown ids fall back to the name; unknown id and unknown name create a new entry under that id", () => {
    const known = mergeCharacterDeclarations(seeded(), [{ name: "Kitsune", characterId: "vixen-9" }]);
    expect(Object.keys(known.registry)).toEqual(["kitsune"]);
    expect(resolveCharacterReference(seeded(), { name: "Kitsune", characterId: "nope" })?.id).toBe("kitsune");

    const fresh = mergeCharacterDeclarations(seeded(), [{ name: "Guard", characterId: "gate-guard", tags: "gray skin, blue eyes" }]);
    expect(fresh.registry["gate-guard"]!.name).toBe("Guard");
    expect(resolveCharacterReference(fresh.registry, { characterId: "gate-guard" })?.name).toBe("Guard");
    expect(resolveCharacterReference(fresh.registry, { name: "Nobody" })).toBeUndefined();
  });

  test("id collisions between different names get a numeric suffix", () => {
    const report = mergeCharacterDeclarations(seeded(), [{ name: "Guard", characterId: "kitsune", tags: "gray skin, blue eyes" }]);
    // The explicit id belongs to Kitsune, so "Guard" is treated as her alias; nothing is lost.
    expect(Object.keys(report.registry)).toEqual(["kitsune"]);
    expect(report.registry.kitsune!.aliases).toEqual(["Guard"]);
    const two = mergeCharacterDeclarations({ "fox-girl": { id: "fox-girl", name: "Fox Girl", aliases: [], tags: "", subjectCategory: "unknown" } }, [
      { name: "Fox-Girl", tags: "red hair" }
    ]);
    // A different name key whose derived id is taken gets a suffix; the original id is untouched.
    expect(Object.keys(two.registry)).toEqual(["fox-girl", "fox-girl-2"]);
    expect(two.registry["fox-girl"]!.name).toBe("Fox Girl");
    expect(two.registry["fox-girl-2"]!.name).toBe("Fox-Girl");
  });

  test("a usable baseline is never overwritten; an incomplete later description only fills an empty one", () => {
    const later = mergeCharacterDeclarations(seeded(), [{ name: "Fox girl", characterId: "kitsune", tags: "fox ears, torn kimono" }]);
    expect(later.registry.kitsune!.tags).toBe("fox ears, fox tail, silver hair, amber eyes, red kimono");
    const empty = mergeCharacterDeclarations({}, [{ name: "Ghost" }, { name: "Ghost", tags: "pale skin, white robe" }]);
    expect(empty.registry.ghost!.tags).toBe("pale skin, white robe");
  });

  test("subject category is durable: it is filled once and a later per-turn value is reported, not applied", () => {
    const fromTags = mergeCharacterDeclarations({}, [{ name: "Neko", tags: "cat ears, black hair" }]).registry;
    expect(fromTags.neko!.subjectCategory).toBe("unknown");
    const filled = mergeCharacterDeclarations(fromTags, [{ name: "Neko", tags: "catgirl, cat ears" }]).registry;
    expect(filled.neko!.subjectCategory).toBe("female");
    const stays = mergeCharacterDeclarations(filled, [{ name: "Neko", tags: "cat boy" }]);
    expect(stays.registry.neko!.subjectCategory).toBe("female");
    expect(stays.rejectedSubjects).toEqual([]);
    const drift = mergeCharacterDeclarations(stays.registry, [{ name: "Neko", subjectCategory: "nonhuman" }]);
    expect(drift.registry.neko!.subjectCategory).toBe("female");
    expect(drift.rejectedSubjects).toEqual([{ name: "Neko", requested: "nonhuman", durable: "female" }]);
    // An explicit value does fill an unknown category on first sight.
    const explicitFirst = mergeCharacterDeclarations({}, [{ name: "Rei", tags: "silver hair", subjectCategory: "nonbinary" }]).registry;
    expect(explicitFirst.rei!.subjectCategory).toBe("nonbinary");
  });

  test("a wrong durable category can be corrected only by the entity's own baseline tags", () => {
    // A first-sight planner slip marked a fox girl as nonhuman.
    const wrong = mergeCharacterDeclarations({}, [{ name: "Kitsune", tags: "fox girl, fox ears, silver hair", subjectCategory: "nonhuman" }]).registry;
    expect(wrong.kitsune!.subjectCategory).toBe("nonhuman");
    // A request that disagrees with the baseline words is still rejected...
    const bad = mergeCharacterDeclarations(wrong, [{ name: "Kitsune", subjectCategory: "male", tags: "fox boy" }]);
    expect(bad.registry.kitsune!.subjectCategory).toBe("nonhuman");
    expect(bad.rejectedSubjects).toEqual([{ name: "Kitsune", requested: "male", durable: "nonhuman" }]);
    // ...but one that matches the frozen baseline ("fox girl") is applied.
    const fixed = mergeCharacterDeclarations(wrong, [{ name: "Kitsune", subjectCategory: "female", tags: "fox ears" }]);
    expect(fixed.registry.kitsune!.subjectCategory).toBe("female");
    expect(fixed.rejectedSubjects).toEqual([]);
    // A baseline without gender words offers no correction path; the per-turn description is never consulted.
    const noWords = mergeCharacterDeclarations({}, [{ name: "Neko", tags: "cat ears, black hair", subjectCategory: "male" }]).registry;
    const attempt = mergeCharacterDeclarations(noWords, [{ name: "Neko", tags: "catgirl", subjectCategory: "female" }]);
    expect(attempt.registry.neko!.subjectCategory).toBe("male");
    expect(attempt.rejectedSubjects).toEqual([{ name: "Neko", requested: "female", durable: "male" }]);
  });

  test("a known id paired with a label owned by another entity never steals that entity", () => {
    const registry = mergeCharacterDeclarations(seeded(), [
      { name: "Shark Girl", tags: "shark girl, dorsal fin, grey hair" },
      { name: "Fox girl", tags: "fox ears, white hair" }
    ]).registry;
    // Both known, different: the label wins, the id is ignored.
    expect(resolveCharacterReference(registry, { name: "Kitsune", characterId: "shark-girl" })?.id).toBe("kitsune");
    expect(canonicalCharacterName(registry, { name: "Fox girl", characterId: "kitsune" })).toBe("Fox girl");
    const report = mergeCharacterDeclarations(registry, [{ name: "Fox girl", characterId: "kitsune", tags: "fox ears" }]);
    expect(Object.keys(report.registry).sort()).toEqual(["fox-girl", "kitsune", "shark-girl"]);
    expect(report.registry.kitsune!.aliases).toEqual([]);
    expect(report.registry["fox-girl"]!.tags).toBe("fox ears, white hair");
    expect(report.rejectedAliases).toEqual([{ alias: "Fox girl", requestedFor: "Kitsune", ownedBy: "Fox girl" }]);
  });

  test("persona-like or empty declarations are ignored", () => {
    const report = mergeCharacterDeclarations({}, [{ name: "" }, { name: "   ", characterId: "" }]);
    expect(report.registry).toEqual({});
    expect(report.changed).toBe(false);
  });
});

describe("registry records", () => {
  test("old and corrupt records normalize without losing valid entries", () => {
    const registry = normalizeCharacterRegistry({
      schemaVersion: 1,
      characters: {
        kitsune: { id: "kitsune", name: "Kitsune", aliases: ["Fox girl", "Kitsune", 7], tags: ["fox ears", "silver hair"], subjectCategory: "female" },
        broken: { name: "" },
        "kitsune-2": { id: "kitsune-2", name: "Kitsune", aliases: ["Vixen"], tags: "red hair" },
        doc: { name: "Doc", tags: "# Appearance\nHair: red" },
        "shark-girl": { name: "Shark Girl", aliases: ["Fox girl"], tags: "shark girl, dorsal fin", subjectCategory: "creature" }
      }
    });
    // Duplicate canonical names keep only the first stored entry.
    expect(Object.keys(registry).sort()).toEqual(["doc", "kitsune", "shark-girl"]);
    expect(registry.kitsune!.aliases).toEqual(["Fox girl"]);
    expect(registry.kitsune!.tags).toBe("fox ears, silver hair");
    expect(registry["shark-girl"]!.aliases).toEqual([]);
    expect(registry["shark-girl"]!.subjectCategory).toBe("nonhuman");
    expect(registry.doc!.tags).toBe("");
    expect(normalizeCharacterRegistry(null)).toEqual({});
    expect(normalizeCharacterRegistry([1, 2])).toEqual({});
  });

  test("registry projects onto the legacy appearance map using canonical names only", () => {
    const registry = mergeCharacterDeclarations({}, [
      { name: "Kitsune", aliases: ["Fox girl"], tags: "fox ears, silver hair" },
      { name: "Ghost" }
    ]).registry;
    expect(registryToAppearanceMap(registry)).toEqual({ Kitsune: "fox ears, silver hair" });
  });
});
