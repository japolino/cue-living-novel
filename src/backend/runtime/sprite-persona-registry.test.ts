import assert from "node:assert/strict";
import test from "node:test";
import type { CharacterRegistry } from "../../shared/identity.js";
import type { SpriteStaging } from "../../shared/sprites.js";
import { assertStagingInvariants, makePlan, stagingInput } from "./__fixtures__/sprite-staging-plans.js";
import { deterministicSpriteStaging, isPersonaName, sanitizeStoredStaging } from "./sprite-staging.js";

/**
 * Persona and registry aliases in sprite staging. Shapes follow two real turns:
 * a scene-mode turn staged later with the persona "Jay" in its cast, and a
 * sprite turn where the registry alias "Suzu" of "Rat Musume" became a second
 * member with an empty identity.
 */

const RAT_TAGS = "silver-brown hair, large rounded pink mouse ears, dark glassy eyes, long pale pink hairless tail";
const REGISTRY: CharacterRegistry = {
  "rat-musume": { id: "rat-musume", name: "Rat Musume", aliases: ["Roommate", "Suzu"], tags: RAT_TAGS, subjectCategory: "female" },
};

const actorsOf = (staging: SpriteStaging, index: number) =>
  staging.paragraphs[index]!.actors.map((actor) => `${actor.characterKey}@${actor.slot}${actor.focus ? "*" : ""}`);

const ratScene = { start: 0, location: "Apartment", timeOfDay: "night", character: "Rat Musume", characterId: "rat-musume", cast: ["Rat Musume"], identity: RAT_TAGS, attire: null };

function suzuPlan() {
  return makePlan({
    scenes: [ratScene],
    paragraphs: [
      "The apartment is quiet.",
      "\"You're home late,\" Rat Musume says.",
      "\"Traffic,\" you answer.",
      "\"Hm,\" Kai says from the couch.",
      "Suzu laughs softly.",
      "\"Dinner is ready,\" Suzu says.",
    ],
    speakers: ["", "Rat Musume", "Jay", "Kai", "", "Suzu"],
    cues: [{ p: 1, character: "Rat Musume", characterId: "rat-musume", pose: "smile", identity: RAT_TAGS }],
  });
}

test("registry: an alias speaker joins the canonical member (one member, registry identity)", () => {
  const staging = deterministicSpriteStaging(stagingInput(suzuPlan(), { personaName: "Jay", registry: REGISTRY }));
  assertStagingInvariants(staging, 6);
  assert.deepEqual(staging.cast.map((member) => member.name).sort(), ["Kai", "Rat Musume"]);
  const rat = staging.cast.find((member) => member.name === "Rat Musume")!;
  assert.equal(rat.characterKey, "rat-musume");
  assert.equal(rat.identity, RAT_TAGS);
  // "Suzu says": the canonical actor speaks.
  assert.ok(actorsOf(staging, 5).includes("rat-musume@left*"));
});

test("registry: a paragraph that names the alias counts as a mention of the member", () => {
  const withRegistry = deterministicSpriteStaging(stagingInput(suzuPlan(), { personaName: "Jay", registry: REGISTRY }));
  // p4 is narration with Rat Musume and Kai on stage; "Suzu laughs" is about Rat Musume.
  assert.deepEqual(actorsOf(withRegistry, 4), ["rat-musume@left*", "kai@right"]);
  assert.equal(withRegistry.paragraphs[4]!.actors[0]!.expression, "laughing");
  const without = deterministicSpriteStaging(stagingInput(suzuPlan(), { personaName: "Jay" }));
  assert.equal(without.paragraphs[4]!.actors.some((actor) => actor.characterKey === "rat-musume" && actor.focus), false);
});

test("registry: an alias-only character with no identity gets the entry's tags", () => {
  const plan = makePlan({
    scenes: [{ start: 0, location: "Apartment", character: null, cast: [] }],
    paragraphs: ["\"Welcome back,\" Suzu says."],
    speakers: ["Suzu"],
  });
  const staging = deterministicSpriteStaging(stagingInput(plan, { registry: REGISTRY }));
  assert.deepEqual(staging.cast, [{ characterKey: "rat-musume", name: "Rat Musume", identity: RAT_TAGS, attire: null }]);
});

test("no registry (or an empty one): staging is unchanged, a genuinely unknown name stays its own member", () => {
  const without = deterministicSpriteStaging(stagingInput(suzuPlan(), { personaName: "Jay" }));
  assert.deepEqual(without.cast.map((member) => [member.characterKey, member.identity === ""]), [
    ["rat-musume", false], ["kai", true], ["suzu", true],
  ]);
  const empty = deterministicSpriteStaging(stagingInput(suzuPlan(), { personaName: "Jay", registry: {} }));
  assert.deepEqual(empty, without);
  // An unrelated registry does not touch these names either.
  const other: CharacterRegistry = { mira: { id: "mira", name: "Mira", aliases: ["Mimi"], tags: "1girl, brown hair", subjectCategory: "female" } };
  assert.deepEqual(deterministicSpriteStaging(stagingInput(suzuPlan(), { personaName: "Jay", registry: other })), without);
});

test("persona: the persona never joins the cast when its name is given", () => {
  const staging = deterministicSpriteStaging(stagingInput(suzuPlan(), { personaName: "Jay", registry: REGISTRY }));
  assert.equal(staging.cast.some((member) => member.name === "Jay"), false);
  const leaked = deterministicSpriteStaging(stagingInput(suzuPlan(), { registry: REGISTRY }));
  assert.equal(leaked.cast.some((member) => member.name === "Jay"), true, "without the persona name the bug comes back");
});

/* Stored staging (turns staged before the fix). */

const actor = (characterKey: string, slot: "left" | "center" | "right", focus = false, expression = "idle") =>
  ({ characterKey, expression, slot, facing: "viewer" as const, focus, motion: "none" as const, emote: "none" as const, intensity: 3 });

function storedWithJay(): SpriteStaging {
  // c33 shape: Rat Musume alone, then Jay enters and speaks.
  return {
    version: 1,
    source: "planner",
    cast: [
      { characterKey: "rat-musume", name: "Rat Musume", characterId: "rat-musume", identity: RAT_TAGS, attire: null },
      { characterKey: "jay", name: "Jay", identity: "", attire: null },
    ],
    plates: [],
    paragraphs: [
      { actors: [actor("rat-musume", "center", true)], plateKey: null, light: "night" },
      { actors: [actor("rat-musume", "left"), actor("jay", "right", true)], plateKey: null, light: "night" },
      { actors: [actor("rat-musume", "left"), actor("jay", "right")], plateKey: null, light: "night" },
      { actors: [actor("rat-musume", "left", true, "smile"), actor("jay", "right")], plateKey: null, light: "night" },
    ],
  };
}

test("sanitize: a stored staging drops the persona from the cast and every paragraph", () => {
  const clean = sanitizeStoredStaging(storedWithJay(), { personaName: "Jay" });
  assertStagingInvariants(clean, 4);
  assert.deepEqual(clean.cast.map((member) => member.characterKey), ["rat-musume"]);
  assert.deepEqual(actorsOf(clean, 0), ["rat-musume@center*"]);
  // The persona's line focuses nobody.
  assert.deepEqual(actorsOf(clean, 1), ["rat-musume@center"]);
  // A narration paragraph left with one actor focuses it.
  assert.deepEqual(actorsOf(clean, 2), ["rat-musume@center*"]);
  assert.deepEqual(actorsOf(clean, 3), ["rat-musume@center*"]);
  assert.equal(clean.paragraphs[3]!.actors[0]!.expression, "smile");
});

test("sanitize: generic persona names go too; nothing to fix returns the same object", () => {
  const stored = storedWithJay();
  stored.cast[1] = { ...stored.cast[1]!, name: "You" };
  assert.deepEqual(sanitizeStoredStaging(stored, {}).cast.map((member) => member.name), ["Rat Musume"]);
  assert.equal(isPersonaName("{{user}}"), true);
  assert.equal(isPersonaName("Rat Musume"), false);
  const plain = storedWithJay();
  assert.equal(sanitizeStoredStaging(plain, { personaName: "Alex", registry: REGISTRY }), plain);
  assert.equal(sanitizeStoredStaging(plain, {}), plain);
});

function storedWithSuzu(): SpriteStaging {
  // 561632ec shape: "Suzu" (alias of rat-musume) staged as a second member.
  return {
    version: 1,
    source: "classifier",
    cast: [
      { characterKey: "rat-musume", name: "Rat Musume", characterId: "rat-musume", identity: RAT_TAGS, attire: null },
      { characterKey: "suzu", name: "Suzu", identity: "", attire: "apron" },
    ],
    plates: [],
    paragraphs: [
      { actors: [actor("rat-musume", "center", true)], plateKey: null, light: "night" },
      { actors: [actor("rat-musume", "left"), actor("suzu", "right", true, "smile")], plateKey: null, light: "night" },
      { actors: [actor("rat-musume", "left"), actor("suzu", "right")], plateKey: null, light: "night" },
      { actors: [actor("suzu", "center", true, "laughing")], plateKey: null, light: "night", illustrate: true, moment: { interaction: "none", characters: ["suzu", "rat-musume"] } },
    ],
  } as SpriteStaging;
}

test("sanitize: a split alias member folds into the canonical member", () => {
  const clean = sanitizeStoredStaging(storedWithSuzu(), { personaName: "Jay", registry: REGISTRY });
  assertStagingInvariants(clean, 4);
  assert.deepEqual(clean.cast, [
    // The canonical identity stays; the empty attire is filled from the alias.
    { characterKey: "rat-musume", name: "Rat Musume", characterId: "rat-musume", identity: RAT_TAGS, attire: "apron" },
  ]);
  assert.deepEqual(actorsOf(clean, 0), ["rat-musume@center*"]);
  // Both in one paragraph: one actor, the alias's focus and look carry over.
  assert.deepEqual(actorsOf(clean, 1), ["rat-musume@center*"]);
  assert.equal(clean.paragraphs[1]!.actors[0]!.expression, "smile");
  assert.deepEqual(actorsOf(clean, 2), ["rat-musume@center*"]);
  // Alias alone: remapped in place.
  assert.deepEqual(actorsOf(clean, 3), ["rat-musume@center*"]);
  assert.equal(clean.paragraphs[3]!.actors[0]!.expression, "laughing");
  assert.deepEqual(clean.paragraphs[3]!.moment?.characters, ["rat-musume"]);
});

test("sanitize: an alias member alone gets the registry identity; without a registry nothing changes", () => {
  const stored: SpriteStaging = {
    version: 1,
    source: "planner",
    cast: [{ characterKey: "suzu", name: "Suzu", identity: "", attire: null }],
    plates: [],
    paragraphs: [{ actors: [actor("suzu", "center", true)], plateKey: null, light: "neutral" }],
  };
  const clean = sanitizeStoredStaging(stored, { registry: REGISTRY });
  assert.deepEqual(clean.cast, [{ characterKey: "suzu", name: "Suzu", identity: RAT_TAGS, attire: null }]);
  assert.equal(sanitizeStoredStaging(stored, {}), stored);
  assert.equal(sanitizeStoredStaging(storedWithSuzu(), {}).cast.length, 2);
});
