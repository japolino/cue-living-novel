import assert from "node:assert/strict";
import test from "node:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { ContinuityStateSchema, type TurnPlan } from "../../shared/contracts.js";
import { plateKeyFor, type SpriteStaging } from "../../shared/sprites.js";
import { emptySingleCharacter } from "../core/visual-state.js";
import { assertStagingInvariants, makePlan, stagingInput } from "./__fixtures__/sprite-staging-plans.js";
import { planTurn } from "./planner.js";
import {
  buildSpriteStaging,
  deterministicSpriteStaging,
  enforceSpriteStagingInvariants,
  lightForEnvironment,
  spriteExpressionId,
  textCues,
} from "./sprite-staging.js";

const actorsOf = (staging: SpriteStaging, index: number) =>
  staging.paragraphs[index]!.actors.map((actor) => `${actor.characterKey}@${actor.slot}${actor.focus ? "*" : ""}`);

test("single speaker: one centered, focused actor with the scene identity and plate", () => {
  const plan = makePlan({
    paragraphs: ["Mira closes her book.", "\"You're late,\" Mira says.", "\"Sit down.\""],
    speakers: ["", "Mira", "Mira"],
  });
  const staging = deterministicSpriteStaging(stagingInput(plan));
  assertStagingInvariants(staging, 3);
  assert.equal(staging.source, "planner");
  assert.deepEqual(staging.cast, [{ characterKey: "mira", name: "Mira", identity: "1girl, brown hair, green eyes", attire: "school uniform" }]);
  const plateKey = plateKeyFor({ location: "Library", timeOfDay: "evening", weather: null }, "style-1");
  assert.deepEqual(staging.plates.map((plate) => plate.plateKey), [plateKey]);
  for (const index of [0, 1, 2]) {
    assert.deepEqual(actorsOf(staging, index), ["mira@center*"]);
    assert.equal(staging.paragraphs[index]!.plateKey, plateKey);
    assert.equal(staging.paragraphs[index]!.light, "indoor_warm");
  }
});

test("two speakers alternating keep stable slots and move the focus", () => {
  const plan = makePlan({
    paragraphs: ["\"Hello,\" Mira says.", "\"Hi,\" Kai answers.", "\"Late again?\"", "\"Sorry.\""],
    speakers: ["Mira", "Kai", "Mira", "Kai"],
    cues: [{ p: 1, character: "Kai", pose: "idle", identity: "1boy, black hair", attire: "hoodie" }],
  });
  const staging = deterministicSpriteStaging(stagingInput(plan));
  assertStagingInvariants(staging, 4);
  assert.deepEqual(actorsOf(staging, 0), ["mira@center*"]);
  assert.deepEqual(actorsOf(staging, 1), ["mira@left", "kai@right*"]);
  assert.deepEqual(actorsOf(staging, 2), ["mira@left*", "kai@right"]);
  assert.deepEqual(actorsOf(staging, 3), ["mira@left", "kai@right*"]);
  assert.deepEqual(staging.cast.map((member) => [member.characterKey, member.identity, member.attire]), [
    ["mira", "1girl, brown hair, green eyes", "school uniform"],
    ["kai", "1boy, black hair", "hoodie"],
  ]);
});

test("three speakers fill left, center, right; a fourth replaces the least recently active", () => {
  const plan = makePlan({
    paragraphs: ["Mira line.", "Kai line.", "Ren line.", "Mira again.", "Sora arrives and speaks.", "Kai replies."],
    speakers: ["Mira", "Kai", "Ren", "Mira", "Sora", "Kai"],
  });
  const staging = deterministicSpriteStaging(stagingInput(plan));
  assertStagingInvariants(staging, 6);
  assert.deepEqual(actorsOf(staging, 2), ["mira@left", "kai@center", "ren@right*"]);
  assert.deepEqual(actorsOf(staging, 3), ["mira@left*", "kai@center", "ren@right"]);
  // Kai spoke least recently (p1), so Kai steps off for Sora.
  assert.deepEqual(actorsOf(staging, 4), ["mira@left", "ren@center", "sora@right*"]);
  // Kai comes back in place of Ren (p2), the least recently active.
  assert.deepEqual(actorsOf(staging, 5), ["mira@left", "sora@center", "kai@right*"]);
});

test("narrator paragraphs keep the scene subject on stage; persona lines focus nobody and never cast the persona", () => {
  const plan = makePlan({
    paragraphs: ["Rain taps on the window.", "\"Can I sit?\" you ask.", "Mira smiles and nods.", "Alex shrugs."],
    speakers: ["", "Alex", "", "Alex"],
  });
  const staging = deterministicSpriteStaging(stagingInput(plan, { personaName: "Alex" }));
  assertStagingInvariants(staging, 4);
  assert.deepEqual(staging.cast.map((member) => member.characterKey), ["mira"]);
  assert.deepEqual(actorsOf(staging, 0), ["mira@center*"]);
  assert.deepEqual(actorsOf(staging, 1), ["mira@center"]);
  const p2 = staging.paragraphs[2]!.actors[0]!;
  assert.equal(p2.focus, true);
  assert.equal(p2.expression, "smile");
  assert.equal(p2.motion, "nod");
  assert.deepEqual(actorsOf(staging, 3), ["mira@center"]);
});

test("a scene change clears the stage, adds a new plate and light", () => {
  const plan = makePlan({
    paragraphs: ["\"Let's go,\" Mira says.", "\"Okay,\" Kai says.", "They leave.", "The park is dark and cold.", "\"Brr,\" Kai says."],
    speakers: ["Mira", "Kai", "", "", "Kai"],
    scenes: [
      { start: 0, location: "Library", timeOfDay: "afternoon", character: "Mira", identity: "1girl" },
      { start: 3, location: "City park", timeOfDay: "night", weather: "clear", character: null, cast: [] },
    ],
  });
  const staging = deterministicSpriteStaging(stagingInput(plan));
  assertStagingInvariants(staging, 5);
  assert.equal(staging.plates.length, 2);
  assert.equal(staging.paragraphs[0]!.plateKey, plateKeyFor({ location: "Library", timeOfDay: "afternoon" }, "style-1"));
  assert.equal(staging.paragraphs[3]!.plateKey, plateKeyFor({ location: "City park", timeOfDay: "night", weather: "clear" }, "style-1"));
  assert.deepEqual(actorsOf(staging, 2), ["mira@left", "kai@right"]);
  assert.deepEqual(actorsOf(staging, 3), []);
  assert.deepEqual(actorsOf(staging, 4), ["kai@center*"]);
  assert.equal(staging.paragraphs[0]!.light, "neutral");
  assert.equal(staging.paragraphs[4]!.light, "night");
});

test("a revisit of the same place, time and weather reuses one plate", () => {
  const plan = makePlan({
    paragraphs: ["a", "b", "c"],
    scenes: [
      { start: 0, location: "Café", timeOfDay: "morning", character: "Mira" },
      { start: 1, location: "Street", timeOfDay: "morning", character: "Mira" },
      { start: 2, location: "café", timeOfDay: "Morning", character: "Mira" },
    ],
  });
  const staging = deterministicSpriteStaging(stagingInput(plan));
  assertStagingInvariants(staging, 3);
  assert.equal(staging.plates.length, 2);
  assert.equal(staging.paragraphs[0]!.plateKey, staging.paragraphs[2]!.plateKey);
});

test("previous actors carry over while the scene continues, with their keys, slots and expressions", () => {
  const plan = makePlan({ paragraphs: ["\"So,\" Mira says.", "Mira waits."], speakers: ["Mira", ""] });
  const previousCast = [
    { characterKey: "mira", name: "Mira", identity: "old identity", attire: "old attire" },
    { characterKey: "kai-legacy", name: "Kai", characterId: "kai", identity: "1boy, black hair", attire: "hoodie" },
  ];
  const previousStage = {
    actors: [
      { characterKey: "kai-legacy", expression: "worried", slot: "right" as const, facing: "viewer" as const, focus: true, motion: "none" as const, emote: "none" as const, intensity: 3 },
      { characterKey: "mira", expression: "smug", slot: "left" as const, facing: "viewer" as const, focus: false, motion: "none" as const, emote: "none" as const, intensity: 3 },
    ],
    plateKey: "plate_unrelated",
    light: "neutral" as const,
  };
  const carried = deterministicSpriteStaging(stagingInput(plan, { previousCast, previousStage, previousSceneId: "scene-0" }));
  assertStagingInvariants(carried, 2);
  assert.deepEqual(actorsOf(carried, 0), ["mira@left*", "kai-legacy@right"]);
  assert.equal(carried.paragraphs[0]!.actors[1]!.expression, "worried", "a silent actor keeps the last expression");
  assert.equal(carried.paragraphs[0]!.actors[0]!.expression, "smug");
  const kai = carried.cast.find((member) => member.characterKey === "kai-legacy");
  assert.deepEqual(kai, previousCast[1]);
  assert.equal(carried.cast.find((member) => member.characterKey === "mira")!.identity, "1girl, brown hair, green eyes", "this turn's identity wins");

  // Another scene: nobody carries over.
  const fresh = deterministicSpriteStaging(stagingInput(plan, { previousCast, previousStage, previousSceneId: "scene-elsewhere" }));
  assert.deepEqual(actorsOf(fresh, 0), ["mira@center*"]);
  // Without a scene id, an equal plate key means the scene continues.
  const plateKey = plateKeyFor({ location: "Library", timeOfDay: "evening" }, "style-1");
  const byPlate = deterministicSpriteStaging(stagingInput(plan, { previousCast, previousStage: { ...previousStage, plateKey } }));
  assert.deepEqual(actorsOf(byPlate, 0), ["mira@left*", "kai-legacy@right"]);
  const noEvidence = deterministicSpriteStaging(stagingInput(plan, { previousCast, previousStage }));
  assert.deepEqual(actorsOf(noEvidence, 0), ["mira@center*"]);
});

test("a speaker named in previousCast keeps the previous characterKey", () => {
  const plan = makePlan({ paragraphs: ["\"Yo,\" Kai says."], speakers: ["Kai"], scenes: [{ start: 0, location: "Roof", character: null, cast: [] }] });
  const staging = deterministicSpriteStaging(stagingInput(plan, {
    previousCast: [{ characterKey: "kai-legacy", name: "Kai", characterId: "kai", identity: "1boy", attire: null }],
  }));
  assert.deepEqual(actorsOf(staging, 0), ["kai-legacy@center*"]);
  assert.equal(staging.cast[0]!.identity, "1boy");
});

test("expressions: cue pose first, keyword attribution per character, silent actors keep theirs, transient ones relax", () => {
  const plan = makePlan({
    paragraphs: [
      "\"Hey,\" Mira says.",
      "\"Guess what,\" Kai says. Mira frowns, worried.",
      "\"I won!\" Kai laughs.",
      "\"Really?\" Kai asks.",
      "\"Yes,\" Mira says.",
    ],
    speakers: ["Mira", "Kai", "Kai", "Kai", "Mira"],
    cues: [{ p: 0, character: "Mira", pose: "speak" }, { p: 4, character: "Mira", pose: "smile" }],
  });
  const staging = deterministicSpriteStaging(stagingInput(plan));
  assertStagingInvariants(staging, 5);
  const expr = (index: number, key: string) => staging.paragraphs[index]!.actors.find((actor) => actor.characterKey === key)!.expression;
  assert.equal(expr(0, "mira"), "idle", "scene-mode 'speak' folds to idle");
  assert.equal(expr(1, "mira"), "worried");
  assert.equal(expr(1, "kai"), "idle");
  assert.equal(expr(2, "kai"), "laughing");
  assert.equal(expr(2, "mira"), "worried", "silent actor keeps the expression");
  assert.equal(expr(3, "kai"), "idle", "a laugh relaxes when the speaker shows nothing new");
  assert.equal(expr(4, "mira"), "smile", "cue pose");
});

test("a single-character cue does not take an emotion the text gives to someone else", () => {
  const plan = makePlan({
    paragraphs: ["Mira looks up.", "Ren laughs at the joke."],
    speakers: [null, null],
    cues: [{ p: 0, character: "Mira", pose: "idle" }, { p: 1, character: "Mira", pose: "laugh" }],
  });
  const staging = deterministicSpriteStaging(stagingInput(plan));
  assert.equal(staging.paragraphs[1]!.actors[0]!.expression, "idle");
});

test("continuity marks a character absent and they leave the stage", () => {
  const plan = makePlan({
    paragraphs: ["\"Bye,\" Kai says.", "Kai walks out.", "Mira sighs."],
    speakers: ["Kai", "", ""],
    absentAt: [{ p: 1, name: "Kai" }],
  });
  const staging = deterministicSpriteStaging(stagingInput(plan));
  assertStagingInvariants(staging, 3);
  assert.deepEqual(actorsOf(staging, 0), ["mira@left", "kai@right*"]);
  assert.deepEqual(actorsOf(staging, 1), ["mira@center*"]);
});

test("cache cues bring their character in like visual cues", () => {
  const plan = makePlan({
    paragraphs: ["Mira waits.", "Kai appears at the door, smiling."],
    speakers: ["", ""],
    cues: [{ p: 1, character: "Kai", pose: "smile", cache: true, identity: "1boy" }],
  });
  const staging = deterministicSpriteStaging(stagingInput(plan));
  assertStagingInvariants(staging, 2);
  assert.deepEqual(actorsOf(staging, 1), ["mira@left", "kai@right*"]);
  assert.equal(staging.paragraphs[1]!.actors[1]!.expression, "smile");
});

test("the chat appearance map fills an identity the plan does not carry", () => {
  const plan = makePlan({ paragraphs: ["\"Hm,\" Kai says."], speakers: ["Kai"], scenes: [{ start: 0, location: "Hall", character: null, cast: [] }] });
  const staging = deterministicSpriteStaging(stagingInput(plan, { characterAppearance: { kai: "1boy, red scarf" } }));
  assert.equal(staging.cast[0]!.identity, "1boy, red scarf");
});

test("legacy plans without optional fields still stage every paragraph", () => {
  const plan = makePlan({ paragraphs: ["One.", "Two."] }) as Record<string, unknown>;
  for (const field of ["paragraphSpeakers", "visualCues", "cacheCues", "continuityDeltas", "terminalVisualState", "effectCues"]) delete plan[field];
  const scenes = plan.scenes as Array<Record<string, unknown>>;
  for (const field of ["character", "characterId", "identityPrompt", "attire", "cast"]) delete scenes[0]![field];
  const staging = deterministicSpriteStaging(stagingInput(plan as unknown as TurnPlan));
  assertStagingInvariants(staging, 2);
  assert.equal(staging.paragraphs[0]!.plateKey, staging.plates[0]!.plateKey);
  assert.deepEqual(actorsOf(staging, 0), []);

  const broken = deterministicSpriteStaging(stagingInput({ paragraphs: [{ index: 0, sourceIndex: 0, text: "x" }], scenes: null } as unknown as TurnPlan));
  assertStagingInvariants(broken, 1);
});

test("light presets from time of day, lighting and weather words", () => {
  const env = (location: string, timeOfDay: string | null, lighting: string | null = null, weather: string | null = null) => ({ location, timeOfDay, lighting, weather, description: location });
  assert.equal(lightForEnvironment(env("Beach", "noon")), "day");
  assert.equal(lightForEnvironment(env("Rooftop", "sunset")), "sunset");
  assert.equal(lightForEnvironment(env("Forest path", "night", null, "clear")), "night");
  assert.equal(lightForEnvironment(env("Bedroom", "night")), "indoor_warm");
  assert.equal(lightForEnvironment(env("Office", "afternoon", "flickering fluorescent tubes")), "indoor_cool");
  assert.equal(lightForEnvironment(env("Cellar", null, "a single candle")), "candle");
  assert.equal(lightForEnvironment(env("Cave", null, "pitch-black")), "dark");
  assert.equal(lightForEnvironment(env("Classroom", "morning")), "neutral");
  assert.equal(lightForEnvironment(env("the current setting", null)), "neutral");
  assert.equal(lightForEnvironment(null), "neutral");
});

test("motion and emote heuristics are conservative", () => {
  const actors = [{ key: "mira", patterns: [/Mira/i] }, { key: "kai", patterns: [/Kai/i] }];
  const cues = (text: string, fallback: string | null = "mira") => textCues(text, actors, fallback);
  assert.equal(cues("Mira nods slowly.").motions.get("mira"), "nod");
  assert.equal(cues("Mira does not nod.").motions.get("mira"), undefined);
  assert.equal(cues("Mira jumps to conclusions.").motions.get("mira"), undefined);
  assert.equal(cues("She shakes her head.").motions.get("mira"), "shake");
  assert.equal(cues("Kai steps back, trembling.").motions.get("kai"), "step_back");
  assert.equal(cues("Mira leans in closer.").motions.get("mira"), "lean_in");
  assert.equal(cues("Mira trembles violently.").intensities.get("mira"), 5);
  assert.equal(cues("Mira smiles at Kai, who blushes.").emotes.get("kai"), "blush");
  assert.equal(cues("Mira smiles at Kai, who blushes.").expressions.get("mira"), "smile");
  assert.equal(cues("Kai watches as Mira laughs.").expressions.get("mira"), "laughing");
  assert.equal(cues("\"...\"").emotes.get("mira"), "ellipsis");
  assert.equal(cues("\"I'm so angry!\" she says.").expressions.get("mira"), undefined, "quoted speech is not narration");
  assert.equal(cues("Mira hums a tune.").emotes.get("mira"), "music");
  assert.equal(cues("Ren nods.").motions.size, 0, "an unknown name gets nothing");
});

test("spriteExpressionId folds scene-mode poses and rejects unknown ids", () => {
  assert.equal(spriteExpressionId("laugh"), "laughing");
  assert.equal(spriteExpressionId("Surprise"), "surprised");
  assert.equal(spriteExpressionId("listen"), "idle");
  assert.equal(spriteExpressionId("crying with eyes open"), "crying_with_eyes_open");
  assert.equal(spriteExpressionId("nope"), null);
  assert.equal(spriteExpressionId(""), null);
});

test("enforceSpriteStagingInvariants repairs every broken invariant", () => {
  const actor = (characterKey: string, slot: "left" | "center" | "right", focus = false, expression = "idle") =>
    ({ characterKey, expression, slot, facing: "viewer" as const, focus, motion: "none" as const, emote: "none" as const, intensity: 3 });
  const repaired = enforceSpriteStagingInvariants({
    version: 1,
    source: "planner",
    cast: ["a", "b", "c", "d"].map((key) => ({ characterKey: key, name: key, identity: "", attire: null })),
    plates: [{ plateKey: "plate_1", location: "x", timeOfDay: null, weather: null, description: "" }],
    paragraphs: [
      { actors: [actor("a", "center", true), actor("a", "left"), actor("ghost", "right"), actor("b", "right", true, "bogus"), actor("c", "left"), actor("d", "left")], plateKey: "plate_missing", light: "day" },
    ],
  } as SpriteStaging);
  assertStagingInvariants(repaired, 1);
  assert.equal(repaired.paragraphs[0]!.plateKey, null);
  assert.equal(repaired.paragraphs[0]!.actors.length, 3);
  assert.equal(repaired.paragraphs[0]!.actors.find((item) => item.characterKey === "b")!.expression, "idle");
});

test("random plans always produce valid staging", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const names = ["Mira", "Kai", "Ren", "Sora", "Alex", "", null, "Narrator"];
  for (let round = 0; round < 60; round += 1) {
    const count = 1 + Math.floor(random() * 30);
    const paragraphs = Array.from({ length: count }, (_, index) => ["Mira smiles.", "Kai nods and laughs.", "\"...\"", "Ren steps back, trembling.", "Rain falls."][index % 5]!);
    const speakers = paragraphs.map(() => names[Math.floor(random() * names.length)]!);
    const sceneStarts = [0, ...Array.from({ length: Math.floor(random() * 3) }, () => 1 + Math.floor(random() * Math.max(1, count - 1)))]
      .filter((value, index, all) => value < count && all.indexOf(value) === index)
      .sort((left, right) => left - right);
    const plan = makePlan({
      paragraphs,
      speakers,
      scenes: sceneStarts.map((start, index) => ({ start, location: `Place ${index}`, timeOfDay: index % 2 ? "night" : "day", character: index % 2 ? null : "Mira" })),
      cues: paragraphs.map((_, p) => ({ p, character: ["Mira", "Kai", "Sora"][p % 3]!, pose: ["smile", "laugh", "speak", "lustful"][p % 4]! })).filter(() => random() < 0.4),
    });
    const previousStage = random() < 0.5 ? deterministicSpriteStaging(stagingInput(plan)).paragraphs.at(-1)! : null;
    const staging = deterministicSpriteStaging(stagingInput(plan, {
      personaName: "Alex",
      previousStage,
      previousCast: deterministicSpriteStaging(stagingInput(plan)).cast,
      previousSceneId: "scene-0",
    }));
    assertStagingInvariants(staging, count);
    assert.ok(!staging.cast.some((member) => member.name === "Alex"));
  }
});

test("a fallback-planned turn (no story reader) stages the companion and follows the text", async () => {
  const content = [
    "Mira looks up from her book and smiles.",
    "\"You're late,\" Mira says, tapping the table.",
    "Kai laughs nervously. \"Sorry, the train was delayed.\"",
    "Mira sighs and nods. \"Sit down, then.\"",
  ].join("\n\n");
  const message = {
    id: "a1", chat_id: "c1", index_in_chat: 1, is_user: false, name: "Mira", content, send_date: 1, swipe_id: 0, swipes: [], swipe_dates: [], extra: {},
    parent_message_id: null, branch_id: null, created_at: 1, role: "assistant" as const,
  };
  const spindle = {
    enclave: { get: async () => null },
    generate: { raw: async () => { throw new Error("no story reader"); } },
    storage: { list: async () => [] },
    log: { warn: () => {}, info: () => {} },
  } as unknown as SpindleAPI;
  const { plan } = await planTurn(spindle, {
    chatId: "c1", message, content, previousScene: null, previousContinuity: ContinuityStateSchema.parse({ revision: 0, characters: {}, facts: {} }),
    recentMessages: [], config: { ...DEFAULT_CONFIG }, singleCharacter: emptySingleCharacter(), characterAppearance: {},
  } as unknown as Parameters<typeof planTurn>[1]);
  const staging = await buildSpriteStaging(spindle, stagingInput(plan));
  assertStagingInvariants(staging, 4);
  assert.deepEqual(staging.cast.map((member) => member.name), ["Mira"]);
  assert.deepEqual(staging.paragraphs.map((stage) => stage.actors.map((actor) => [actor.expression, actor.motion])), [
    [["smile", "none"]],
    [["smile", "none"]],
    [["smile", "none"]],
    [["smile", "nod"]],
  ]);
});
