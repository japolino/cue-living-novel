import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { SceneStateSchema, TurnPlanSchema, VisualCueSchema, type SceneState } from "../../shared/contracts.js";
import { emptySingleCharacter, seedSingleCharacter } from "../core/visual-state.js";
import { resolveCueTimeline } from "../core/cue-state.js";
import { planTurn } from "./planner.js";
import { classifySubject, compileImagePrompt, cueCharacterName, resolveCueCharacterVisualState } from "./images.js";
import {
  characterRegistryPath,
  loadCharacterAppearance,
  loadCharacterRegistry,
  mergeCharacterRegistry,
  mergePlannerCharacters,
  saveCharacterRegistry,
  saveSingleCharacterState,
  singleCharacterStatePath
} from "./storage.js";
import { sendState } from "./controller.js";
import { chatStatePath, type StoredChatState, type StoredTurnRecord } from "./storage.js";

const KITSUNE_TAGS = "fox ears, fox tail, silver hair, amber eyes, red kimono";
const content = "The fox girl tilts her head.\n\nShe laughs.\n\nA guard walks in.";
const message: any = { id: "m1", chat_id: "chat", index_in_chat: 2, is_user: false, name: "Kitsune", content, send_date: 1, swipe_id: 0, swipes: [content], extra: {}, role: "assistant" };
const config = { ...DEFAULT_CONFIG, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false };
const camera = { framing: "upper body", angle: "eye level", perspective: "straight-on", lens: null, subjectAnchor: "center", horizon: "upper middle third", safeDialogueRegion: "lower quarter", aspectRatio: "16:9" };
const environment = { location: "Shrine", timeOfDay: "dusk", weather: null, lighting: "lanterns", description: "A quiet shrine.", persistentElements: [] };
const scene = { startParagraph: 0, boundary: { claimedNewScene: false, reason: "none", location: "Shrine" }, environment, cast: [], basePrompt: "shrine, lanterns", compositionLock: "centered" };

function previousKitsuneScene(overrides: Partial<SceneState> = {}): SceneState {
  return SceneStateSchema.parse({
    sceneId: "scene-kitsune", revision: 1, startParagraph: 0, environment, cast: ["Kitsune"], character: "Kitsune", characterId: "kitsune", subjectCategory: "female",
    attire: "red kimono", continuity: { revision: 1, characters: { Kitsune: { present: true, appearance: {}, wardrobe: { attire: "red kimono" }, pose: null, expression: null, props: [] } }, facts: {} },
    basePrompt: "shrine, lanterns", identityPrompt: KITSUNE_TAGS, cameraLock: camera, compositionLock: "centered", activeAssetId: null, priorSceneId: null, ...overrides
  });
}

function memorySpindle(seed: Array<[string, unknown]> = []) {
  const data = new Map<string, unknown>(seed);
  const spindle = {
    chats: { get: async () => ({ character_id: null }) },
    characters: { get: async () => null },
    personas: { getActive: async () => null },
    connections: { get: async () => null },
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    },
    generate: { raw: async () => ({ content: "{}" }) },
    log: { warn() {}, info() {}, error() {} }
  } as unknown as SpindleAPI & { generate: { raw: () => Promise<unknown> } };
  return { spindle, data };
}

async function run(output: unknown, overrides: Record<string, unknown> = {}) {
  const { spindle } = memorySpindle();
  spindle.generate = { raw: async () => ({ content: JSON.stringify(output) }) } as any;
  const registry = { kitsune: { id: "kitsune", name: "Kitsune", aliases: [], tags: KITSUNE_TAGS, subjectCategory: "female" as const } };
  return planTurn(spindle, {
    chatId: "chat", message, content, previousScene: previousKitsuneScene(), previousContinuity: previousKitsuneScene().continuity,
    recentMessages: [], config, singleCharacter: seedSingleCharacter("Kitsune", KITSUNE_TAGS),
    characterAppearance: { Kitsune: KITSUNE_TAGS }, characterRegistry: registry, ...overrides
  });
}

describe("explicit alias resolution before the timeline", () => {
  test("Kitsune relabelled 'Fox girl' with an explicit characterId keeps body, wardrobe and subject", async () => {
    const result = await run({
      scenes: [{ ...scene, character: "Fox girl", characterId: "kitsune", cast: ["Fox girl"] }],
      cues: [{ paragraphIndex: 0, character: "Fox girl", characterId: "kitsune", expression: "smile" }, { paragraphIndex: 1, character: "Fox girl", characterId: "kitsune" }],
      characters: [{ name: "Fox girl", characterId: "kitsune", description: "fox ears, fox tail" }]
    });
    expect(result.usedFallback).toBe(false);
    for (const cue of result.plan.visualCues) {
      expect(cue.character).toBe("Kitsune");
      expect(cue.characterId).toBe("kitsune");
      expect(cue.subjectCategory).toBe("female");
      expect(cue.resolvedIdentity).toContain("silver hair");
      expect(cue.resolvedAttire).toBe("red kimono");
      const prompt = compileImagePrompt(config, result.plan.scenes[0]!, cue);
      expect(prompt).toContain("1girl, solo");
      expect(prompt).toContain("silver hair");
      expect(prompt).toContain("red kimono");
      expect(prompt).not.toContain("1other");
    }
    expect(result.plan.scenes[0]?.character).toBe("Kitsune");
    expect(result.plan.scenes[0]?.cast).toEqual(["Kitsune"]);
    expect(result.plan.scenes[0]?.activeAssetId).toBeNull();
    expect(result.plan.planningStatus).toBe("planned");
    expect(result.singleCharacter.protagonist.name).toBe("Kitsune");
    expect(result.extractedCharacters).toEqual([{ name: "Kitsune", description: "fox ears, fox tail" }]);
    expect(result.characterRegistry.kitsune?.aliases).toEqual(["Fox girl"]);
    expect(result.characterRegistry.kitsune?.tags).toBe(KITSUNE_TAGS);
    expect(result.plan.terminalVisualState).toMatchObject({ character: "Kitsune", characterId: "kitsune", subjectCategory: "female", attire: "red kimono" });
    // Portrait lookup key stays the canonical name, so the reference lifecycle is unchanged.
    expect(cueCharacterName(result.plan.scenes[0]!, result.plan.visualCues[0]!)).toBe("Kitsune");
  });

  test("an alias declared on the known entry resolves cues that carry only the label", async () => {
    const result = await run({
      scenes: [scene],
      cues: [{ paragraphIndex: 0, character: "Fox girl" }],
      characters: [{ name: "Kitsune", aliases: ["Fox girl"], description: KITSUNE_TAGS }]
    });
    expect(result.plan.visualCues[0]?.character).toBe("Kitsune");
    expect(result.plan.visualCues[0]?.resolvedAttire).toBe("red kimono");
    expect(result.plan.paragraphSpeakers).toEqual([null, null, null]);
  });

  test("a stored alias from an earlier turn resolves without any planner metadata", async () => {
    const registry = { kitsune: { id: "kitsune", name: "Kitsune", aliases: ["Fox girl"], tags: KITSUNE_TAGS, subjectCategory: "female" as const } };
    const result = await run({ scenes: [scene], cues: [{ paragraphIndex: 0, character: "Fox girl" }], characters: [], speakers: [{ paragraphIndex: 0, name: "Fox girl" }] }, { characterRegistry: registry });
    expect(result.plan.visualCues[0]?.character).toBe("Kitsune");
    expect(result.plan.visualCues[0]?.resolvedIdentity).toBe(KITSUNE_TAGS);
    // Nameplates keep the literal label; the alias is merely accepted as a known speaker.
    expect(result.plan.paragraphSpeakers[0]).toBe("Fox girl");
  });

  test("without an explicit alias, a same-species label is a new subject and never inherits Kitsune", async () => {
    const described = await run({
      scenes: [scene],
      cues: [{ paragraphIndex: 0, character: "Fox girl" }],
      characters: [{ name: "Fox girl", description: "fox ears, white hair, blue eyes" }]
    });
    const cue = described.plan.visualCues[0]!;
    expect(cue.character).toBe("Fox girl");
    expect(cue.characterId).toBe("fox-girl");
    expect(cue.resolvedIdentity).toContain("white hair");
    expect(cue.resolvedIdentity).not.toContain("silver hair");
    expect(cue.resolvedAttire).toBeNull();
    expect(described.characterRegistry.kitsune?.aliases).toEqual([]);
    expect(Object.keys(described.characterRegistry).sort()).toEqual(["fox-girl", "kitsune"]);

    const undescribed = await run({ scenes: [scene], cues: [{ paragraphIndex: 0, character: "Fox girl" }], characters: [] });
    expect(undescribed.plan.visualCues[0]?.resolvedIdentity).toBe("");
    expect(undescribed.plan.planningStatus).toBe("partial");
  });

  test("two kitsune characters stay distinct and each cue compiles its own body", async () => {
    const result = await run({
      scenes: [scene],
      cues: [{ paragraphIndex: 0, character: "Kitsune" }, { paragraphIndex: 1, character: "Yuki" }],
      characters: [{ name: "Yuki", description: "kitsune, fox ears, white hair, blue eyes", subjectCategory: "female" }]
    });
    const [first, second] = result.plan.visualCues;
    expect(first?.characterId).toBe("kitsune");
    expect(second?.characterId).toBe("yuki");
    expect(second?.resolvedIdentity).toContain("white hair");
    expect(second?.resolvedIdentity).not.toContain("silver hair");
    expect(second?.resolvedAttire).toBeNull();
    expect(compileImagePrompt(config, result.plan.scenes[0]!, second!)).toContain("1girl, solo");
  });

  test("a genuine switch to a different character adopts that character, and the return restores the original by id", async () => {
    const switched = await run({
      scenes: [{ ...scene, character: "Shark Girl", cast: ["Shark Girl"] }],
      cues: [{ paragraphIndex: 0, character: "Shark Girl" }],
      characters: [{ name: "Shark Girl", description: "shark girl, sharp teeth, dorsal fin, grey hair" }]
    });
    expect(switched.plan.scenes[0]?.character).toBe("Shark Girl");
    expect(switched.plan.scenes[0]?.characterId).toBe("shark-girl");
    expect(switched.plan.scenes[0]?.identityPrompt).toContain("dorsal fin");
    expect(switched.singleCharacter.protagonist.name).toBe("Shark Girl");

    const returned = await run({
      scenes: [scene],
      cues: [{ paragraphIndex: 0, character: "the fox", characterId: "kitsune" }],
      characters: []
    }, {
      previousScene: switched.plan.scenes[0], previousContinuity: switched.plan.terminalContinuity,
      singleCharacter: switched.singleCharacter, characterRegistry: switched.characterRegistry,
      characterAppearance: { Kitsune: KITSUNE_TAGS, "Shark Girl": "shark girl, sharp teeth, dorsal fin, grey hair" }
    });
    const cue = returned.plan.visualCues[0]!;
    expect(cue.character).toBe("Kitsune");
    expect(cue.characterId).toBe("kitsune");
    expect(cue.resolvedIdentity).toBe(KITSUNE_TAGS);
    expect(cue.resolvedAttire).toBe("red kimono");
    // A cue-only id link resolves this turn but is not persisted as an alias.
    expect(returned.characterRegistry.kitsune?.aliases).toEqual([]);
    expect(returned.singleCharacter.protagonist.name).toBe("Kitsune");
  });

  test("scene/cue id links never persist aliases or create entries; an unknown id is ignored", async () => {
    const unknownId = await run({
      scenes: [scene],
      cues: [{ paragraphIndex: 0, character: "Guard", characterId: "gate-guard" }],
      characters: [{ name: "Guard", description: "male, gray skin, blue eyes" }]
    });
    expect(unknownId.plan.visualCues[0]?.character).toBe("Guard");
    expect(unknownId.plan.visualCues[0]?.characterId).toBe("guard");
    expect(Object.keys(unknownId.characterRegistry).sort()).toEqual(["guard", "kitsune"]);

    const linked = await run({ scenes: [{ ...scene, character: "Vixen", characterId: "kitsune" }], cues: [{ paragraphIndex: 0 }], characters: [] });
    expect(linked.plan.scenes[0]?.character).toBe("Kitsune");
    expect(linked.plan.visualCues[0]?.resolvedIdentity).toBe(KITSUNE_TAGS);
    expect(linked.characterRegistry.kitsune?.aliases).toEqual([]);
    expect(Object.keys(linked.characterRegistry)).toEqual(["kitsune"]);
  });

  test("a known id paired with another known label never steals that entity in a cue", async () => {
    const registry = {
      kitsune: { id: "kitsune", name: "Kitsune", aliases: [], tags: KITSUNE_TAGS, subjectCategory: "female" as const },
      "shark-girl": { id: "shark-girl", name: "Shark Girl", aliases: [], tags: "shark girl, dorsal fin, grey hair", subjectCategory: "female" as const }
    };
    const result = await run({
      scenes: [scene],
      cues: [{ paragraphIndex: 0, character: "Shark Girl", characterId: "kitsune" }],
      characters: [{ name: "Shark Girl", characterId: "kitsune", description: "shark girl, dorsal fin" }]
    }, { characterRegistry: registry, characterAppearance: { Kitsune: KITSUNE_TAGS, "Shark Girl": "shark girl, dorsal fin, grey hair" } });
    const cue = result.plan.visualCues[0]!;
    expect(cue.character).toBe("Shark Girl");
    expect(cue.characterId).toBe("shark-girl");
    expect(cue.resolvedIdentity).toContain("dorsal fin");
    expect(cue.resolvedIdentity).not.toContain("silver hair");
    expect(result.characterRegistry.kitsune?.aliases).toEqual([]);
    expect(result.rejectedAliases).toEqual([{ alias: "Shark Girl", requestedFor: "Kitsune", ownedBy: "Shark Girl" }]);
  });

  test("a per-turn subjectCategory that disagrees with the durable one is reported, not applied", async () => {
    const result = await run({
      scenes: [scene],
      cues: [{ paragraphIndex: 0, character: "Kitsune" }],
      characters: [{ name: "Kitsune", description: "fox ears, fox tail", subjectCategory: "nonhuman" }]
    });
    expect(result.plan.visualCues[0]?.subjectCategory).toBe("female");
    expect(compileImagePrompt(config, result.plan.scenes[0]!, result.plan.visualCues[0]!)).toContain("1girl, solo");
    expect(result.characterRegistry.kitsune?.subjectCategory).toBe("female");
    expect(result.rejectedSubjects).toEqual([{ name: "Kitsune", requested: "nonhuman", durable: "female" }]);
  });

  test("an appearance-map entry cannot override the registry's stable baseline, in prompts or planner context", async () => {
    const { spindle } = memorySpindle();
    let systemMessage = "";
    spindle.generate = { raw: async (request: { messages: Array<{ content: string }> }) => { systemMessage = request.messages[0]!.content; return { content: JSON.stringify({ scenes: [scene], cues: [{ paragraphIndex: 0, character: "Kitsune" }], characters: [{ name: "Kitsune", description: "fox ears, blonde hair, green eyes, blue dress" }] }) }; } } as any;
    const result = await planTurn(spindle, {
      chatId: "chat", message, content, previousScene: null, previousContinuity: null, recentMessages: [], config,
      singleCharacter: emptySingleCharacter(),
      characterAppearance: { Kitsune: "fox ears, blonde hair, green eyes, blue dress" },
      characterRegistry: { kitsune: { id: "kitsune", name: "Kitsune", aliases: [], tags: KITSUNE_TAGS, subjectCategory: "female" } }
    });
    expect(result.plan.visualCues[0]?.resolvedIdentity).toBe(KITSUNE_TAGS);
    expect(result.plan.visualCues[0]?.resolvedIdentity).not.toContain("blonde");
    expect(result.characterRegistry.kitsune?.tags).toBe(KITSUNE_TAGS);
    expect(systemMessage).toContain(`Kitsune: ${KITSUNE_TAGS} [id: kitsune; subject: female]`);
    expect(systemMessage).not.toContain("blonde hair");
  });

  test("alias conflicts and persona aliases are refused", async () => {
    const result = await run({
      scenes: [scene],
      cues: [{ paragraphIndex: 0, character: "Kitsune" }],
      characters: [
        { name: "Shark Girl", aliases: ["Kitsune", "User"], description: "shark girl, dorsal fin, grey hair" },
        { name: "User", description: "brown hair, glasses" }
      ]
    });
    expect(result.rejectedAliases).toEqual([{ alias: "Kitsune", requestedFor: "Shark Girl", ownedBy: "Kitsune" }]);
    expect(result.characterRegistry["shark-girl"]?.aliases).toEqual([]);
    expect(result.characterRegistry.user).toBeUndefined();
    expect(result.plan.visualCues[0]?.character).toBe("Kitsune");
  });

  test("the planner is told the stable ids, aliases and subject class of known characters", async () => {
    const { spindle } = memorySpindle();
    let systemMessage = "";
    spindle.generate = { raw: async (request: { messages: Array<{ content: string }> }) => { systemMessage = request.messages[0]!.content; return { content: JSON.stringify({ scenes: [scene], cues: [{ paragraphIndex: 0 }], characters: [] }) }; } } as any;
    await planTurn(spindle, {
      chatId: "chat", message, content, previousScene: null, previousContinuity: null, recentMessages: [], config,
      singleCharacter: seedSingleCharacter("Kitsune", KITSUNE_TAGS), characterAppearance: {},
      characterRegistry: { kitsune: { id: "kitsune", name: "Kitsune", aliases: ["Fox girl"], tags: KITSUNE_TAGS, subjectCategory: "female" } }
    });
    expect(systemMessage).toContain(`Kitsune: ${KITSUNE_TAGS} [id: kitsune; aliases: Fox girl; subject: female]`);
    expect(systemMessage).toContain("characterId");
    expect(systemMessage).toContain("subjectCategory");
  });
});

describe("timeline canonicalization", () => {
  const registry = { kitsune: { id: "kitsune", name: "Kitsune", aliases: ["Fox girl"], tags: KITSUNE_TAGS, subjectCategory: "female" as const } };
  const base = { paragraphs: 2, roster: [], appearances: {}, registry, baseline: { name: "Kitsune", identity: KITSUNE_TAGS }, isPersona: () => false, isReset: (value: string) => value === "baseline" };

  test("wardrobe recorded under an alias in old continuity folds into the canonical character", () => {
    const timeline = resolveCueTimeline({ ...base, proposals: [{ startParagraph: 0, cast: [] }], cues: [{ paragraphIndex: 0, character: "Fox girl" }],
      previousCharacter: "Fox girl", previousAttire: null,
      continuity: { revision: 1, characters: { "Fox girl": { present: true, appearance: {}, wardrobe: { attire: "blue yukata" }, pose: null, expression: null, props: [] } }, facts: {} } });
    expect(timeline.snapshots[0]).toEqual({ character: "Kitsune", characterId: "kitsune", subjectCategory: "female", identity: KITSUNE_TAGS, attire: "blue yukata" });
  });

  test("an explicit characterId on a cue outranks a mismatching label", () => {
    const timeline = resolveCueTimeline({ ...base, proposals: [{ startParagraph: 0, cast: [] }], cues: [{ paragraphIndex: 1, character: "Mysterious woman", characterId: "kitsune", attire: "black cloak" }],
      previousCharacter: "Kitsune", previousAttire: "red kimono", continuity: { revision: 0, characters: {}, facts: {} } });
    expect(timeline.snapshots[1]!.character).toBe("Kitsune");
    expect(timeline.snapshots[1]!.attire).toBe("black cloak");
    expect(timeline.deltas[0]?.delta.characterUpdates.Kitsune?.wardrobe?.attire).toBe("black cloak");
  });

  test("unregistered subjects get a derived id and a text-derived category, never the baseline body", () => {
    const timeline = resolveCueTimeline({ ...base, roster: [{ name: "Guard", description: "male, gray skin, blue eyes" }], proposals: [{ startParagraph: 0, cast: [] }], cues: [{ paragraphIndex: 0, character: "Guard" }],
      previousCharacter: "Kitsune", previousAttire: null, continuity: { revision: 0, characters: {}, facts: {} } });
    expect(timeline.snapshots[0]).toMatchObject({ character: "Guard", characterId: "guard", subjectCategory: "male", attire: null });
    expect(timeline.snapshots[0]!.identity).not.toContain("silver hair");
  });
});

describe("subject classification in the prompt compiler", () => {
  test("animal ears without a gender word no longer produce 1other", () => {
    for (const identity of ["kitsune, fox ears, fox tail, silver hair", "cat ears, black hair", "wolf ears, wolf tail, school uniform", "animal ears, fluffy tail"]) {
      expect(classifySubject(identity)).toEqual(["girl", "1girl, solo"]);
    }
    expect(classifySubject("dog, golden retriever, four legs")).toEqual(["other", "1other, solo"]);
    expect(classifySubject("anthro wolf male warrior, gray fur")).toEqual(["boy", "1boy, solo"]);
  });

  test("a persisted category wins over identity text, including explicit nonbinary and nonhuman", () => {
    expect(classifySubject("cat ears, black hair", "male")).toEqual(["boy", "1boy, solo"]);
    expect(classifySubject("girl, cat ears", "nonbinary")).toEqual(["other", "1other, solo"]);
    expect(classifySubject("fox girl", "nonhuman")).toEqual(["other", "1other, solo"]);
    expect(classifySubject("fox girl", "unknown")).toEqual(["girl", "1girl, solo"]);
  });

  test("cues carry their category into the compiled prompt; scenes supply it only for the same character", () => {
    const sceneState = previousKitsuneScene({ identityPrompt: "kitsune, fox ears, fox tail, silver hair", subjectCategory: "male" });
    const cue = VisualCueSchema.parse({ cueId: "c", paragraphIndex: 0, sceneId: sceneState.sceneId, sceneRevision: 1, kind: "flattened_scene", poseExpressionId: "smile", assetJobId: "j", promptDelta: "" });
    const fromScene = resolveCueCharacterVisualState(sceneState, cue);
    expect(fromScene.characterId).toBe("kitsune");
    expect(fromScene.subjectCategory).toBe("male");
    expect(compileImagePrompt(config, sceneState, cue)).toContain("1boy, solo");

    const other = VisualCueSchema.parse({ ...cue, character: "Guard", resolvedIdentity: "gray skin, blue eyes" });
    expect(resolveCueCharacterVisualState(sceneState, other).subjectCategory).toBe("unknown");
    expect(resolveCueCharacterVisualState(sceneState, other).characterId).toBe("guard");
    const explicit = VisualCueSchema.parse({ ...cue, characterId: "kitsune", subjectCategory: "nonbinary" });
    expect(compileImagePrompt(config, sceneState, explicit)).toContain("1other, solo");
  });

  test("records planned before the identity fields existed still parse and default to unknown", () => {
    const legacyScene = SceneStateSchema.parse({ sceneId: "s", revision: 1, startParagraph: 0, environment, cast: ["Neko"], character: "Neko", continuity: { revision: 0, characters: {}, facts: {} }, basePrompt: "room", identityPrompt: "cat ears, black hair", cameraLock: camera, compositionLock: "centered" });
    const cue = VisualCueSchema.parse({ cueId: "c", paragraphIndex: 0, sceneId: "s", sceneRevision: 1, kind: "flattened_scene", assetJobId: "j" });
    const state = resolveCueCharacterVisualState(legacyScene, cue);
    expect(state.subjectCategory).toBe("unknown");
    expect(state.characterId).toBe("neko");
    expect(compileImagePrompt(config, legacyScene, cue)).toContain("1girl, solo");
    const plan = TurnPlanSchema.parse({ schemaVersion: 1, key: { chatId: "c", assistantMessageId: "m", swipeId: 0, sourceFingerprint: "abcdefgh", revision: 1 }, paragraphs: [{ index: 0, sourceIndex: 0, text: "x" }], scenes: [legacyScene], visualCues: [cue], initialContinuity: legacyScene.continuity, terminalContinuity: legacyScene.continuity, terminalVisualState: { character: "Neko", identity: "cat ears", attire: null }, planningStatus: "planned", createdAt: new Date().toISOString() });
    expect(plan.terminalVisualState?.characterId).toBeUndefined();
  });
});

describe("registry persistence", () => {
  test("old chats promote the roster and visual state into ids without writing on load", async () => {
    const { spindle, data } = memorySpindle([
      ["chats/old/characters.json", { Kitsune: KITSUNE_TAGS, Guard: "male, gray skin, blue eyes" }],
      [singleCharacterStatePath("old"), { schemaVersion: 2, protagonist: { name: "Kitsune", tags: KITSUNE_TAGS.split(", ") }, environment: "shrine", updatedAt: "2020-01-01T00:00:00.000Z" }]
    ]);
    const registry = await loadCharacterRegistry(spindle, "old");
    expect(Object.keys(registry).sort()).toEqual(["guard", "kitsune"]);
    expect(registry.kitsune).toMatchObject({ name: "Kitsune", aliases: [], tags: KITSUNE_TAGS, subjectCategory: "unknown" });
    expect(registry.guard?.subjectCategory).toBe("male");
    expect(data.has(characterRegistryPath("old"))).toBe(false);
  });

  test("merges persist aliases, refuse conflicts, keep baselines and survive reloads", async () => {
    const { spindle, data } = memorySpindle([["chats/c/characters.json", { Kitsune: KITSUNE_TAGS }]]);
    const first = await mergeCharacterRegistry(spindle, "c", [{ name: "Fox girl", characterId: "kitsune", tags: "fox ears, torn kimono", subjectCategory: "female" }]);
    expect(first.registry.kitsune).toMatchObject({ aliases: ["Fox girl"], tags: KITSUNE_TAGS, subjectCategory: "female" });
    const stored = data.get(characterRegistryPath("c")) as { schemaVersion: number; characters: Record<string, unknown> };
    expect(stored.schemaVersion).toBe(1);
    expect(Object.keys(stored.characters)).toEqual(["kitsune"]);

    const second = await mergeCharacterRegistry(spindle, "c", [{ name: "Shark Girl", aliases: ["Fox girl"], tags: "shark girl, dorsal fin" }]);
    expect(second.rejectedAliases).toEqual([{ alias: "Fox girl", requestedFor: "Shark Girl", ownedBy: "Kitsune" }]);
    const reloaded = await loadCharacterRegistry(spindle, "c");
    expect(Object.keys(reloaded).sort()).toEqual(["kitsune", "shark-girl"]);
    expect(reloaded.kitsune?.aliases).toEqual(["Fox girl"]);

    // A later roster entry for a brand-new name is promoted; existing ids are untouched.
    await mergePlannerCharacters(spindle, [{ name: "Guard", description: "gray skin, blue eyes" }], undefined, "c");
    const withGuard = await loadCharacterRegistry(spindle, "c");
    expect(withGuard.guard?.tags).toBe("gray skin, blue eyes");
    expect(withGuard.kitsune?.id).toBe("kitsune");
    expect(await loadCharacterAppearance(spindle, undefined, "c")).toMatchObject({ Kitsune: KITSUNE_TAGS });
  });

  test("saveCharacterRegistry keeps every entry and is idempotent", async () => {
    const { spindle, data } = memorySpindle();
    const registry = { kitsune: { id: "kitsune", name: "Kitsune", aliases: ["Fox girl"], tags: KITSUNE_TAGS, subjectCategory: "female" as const }, ghost: { id: "ghost", name: "Ghost", aliases: [], tags: "", subjectCategory: "unknown" as const } };
    await saveCharacterRegistry(spindle, "c", registry);
    const once = JSON.stringify((data.get(characterRegistryPath("c")) as { characters: unknown }).characters);
    await saveCharacterRegistry(spindle, "c", registry);
    expect(JSON.stringify((data.get(characterRegistryPath("c")) as { characters: unknown }).characters)).toBe(once);
    expect(await loadCharacterRegistry(spindle, "c")).toEqual(registry);
  });

  test("registries are chat scoped", async () => {
    const { spindle } = memorySpindle();
    await mergeCharacterRegistry(spindle, "A", [{ name: "Kitsune", aliases: ["Fox girl"], tags: KITSUNE_TAGS }]);
    await mergeCharacterRegistry(spindle, "B", [{ name: "Fox girl", tags: "fox ears, white hair" }]);
    expect((await loadCharacterRegistry(spindle, "A")).kitsune?.aliases).toEqual(["Fox girl"]);
    expect(Object.keys(await loadCharacterRegistry(spindle, "B"))).toEqual(["fox-girl"]);
  });
});

describe("controller integration", () => {
  test("the next turn reloads the saved registry from storage and resolves a bare alias label", async () => {
    const turn1 = "The fox girl grins.";
    const turn2 = "Fox girl waves.";
    const reads: string[] = [];
    const { spindle, data } = memorySpindle([
      ["config.json", { generateImages: false, maxImagesPerTurn: 4, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false }],
      ["chats/chat-reload/characters.json", { Kitsune: KITSUNE_TAGS }],
      [singleCharacterStatePath("chat-reload"), { schemaVersion: 2, protagonist: { name: "Kitsune", tags: KITSUNE_TAGS.split(", ") }, environment: "shrine", updatedAt: "2020-01-01T00:00:00.000Z" }]
    ]);
    const rawGet = spindle.userStorage.getJson.bind(spindle.userStorage);
    (spindle.userStorage as any).getJson = async (path: string, options: { fallback: unknown }) => { reads.push(path); return rawGet(path, options); };
    const messageFor = (id: string, text: string) => ({ id, content: text, is_user: false, name: "Kitsune", chat_id: "chat-reload", index_in_chat: 1, send_date: 1, swipe_id: 0, swipes: [text], swipe_dates: [1], extra: {}, parent_message_id: "u", branch_id: null, created_at: 1, role: "assistant" });
    (spindle as any).sendToFrontend = () => {};

    // Turn 1: the planner links the label to the known id.
    (spindle as any).chat = { getMessages: async () => [messageFor("a1", turn1)] };
    spindle.generate = { raw: async () => ({ content: JSON.stringify({
      scenes: [scene], cues: [{ paragraphIndex: 0, character: "Fox girl", characterId: "kitsune" }],
      characters: [{ name: "Fox girl", characterId: "kitsune", description: "fox ears", subjectCategory: "female" }]
    }) }) } as any;
    await sendState(spindle, "chat-reload", "owner");
    expect((data.get(characterRegistryPath("chat-reload")) as { characters: Record<string, { aliases: string[] }> }).characters.kitsune?.aliases).toEqual(["Fox girl"]);

    // Turn 2: only the bare label, no ids, no character entries. The stored registry must resolve it.
    // Clearing the chat pointer makes sendState bootstrap the newest assistant message, like a reload.
    data.delete(chatStatePath("chat-reload"));
    reads.length = 0;
    (spindle as any).chat = { getMessages: async () => [messageFor("a1", turn1), messageFor("a2", turn2)] };
    spindle.generate = { raw: async () => ({ content: JSON.stringify({ scenes: [scene], cues: [{ paragraphIndex: 0, character: "Fox girl", attire: "blue yukata" }], characters: [] }) }) } as any;
    await sendState(spindle, "chat-reload", "owner");
    expect(reads).toContain(characterRegistryPath("chat-reload"));
    const state = data.get(chatStatePath("chat-reload")) as StoredChatState;
    const record = data.get(state.activeTurnPath!) as StoredTurnRecord;
    expect(record.plan.key.assistantMessageId).toBe("a2");
    const cue = record.plan.visualCues[0]!;
    expect(cue.character).toBe("Kitsune");
    expect(cue.characterId).toBe("kitsune");
    expect(cue.subjectCategory).toBe("female");
    expect(cue.resolvedIdentity).toBe(KITSUNE_TAGS);
    expect(cue.resolvedAttire).toBe("blue yukata");
    expect(compileImagePrompt(config, record.plan.scenes[0]!, cue)).toContain("1girl, solo");
    expect(state.latestScene).toMatchObject({ character: "Kitsune", characterId: "kitsune", attire: "blue yukata" });
    expect(Object.keys(data.get("chats/chat-reload/characters.json") as Record<string, string>)).toEqual(["Kitsune"]);
    const registry = await loadCharacterRegistry(spindle, "chat-reload");
    expect(Object.keys(registry)).toEqual(["kitsune"]);
  });

  test("a planned turn persists the registry and the terminal subject id/category", async () => {
    const turnContent = "The fox girl grins.\n\nShe twirls in a blue yukata.";
    const { spindle, data } = memorySpindle([
      ["config.json", { generateImages: false, maxImagesPerTurn: 4, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false }],
      ["chats/chat-reg/characters.json", { Kitsune: KITSUNE_TAGS }],
      [singleCharacterStatePath("chat-reg"), { schemaVersion: 2, protagonist: { name: "Kitsune", tags: KITSUNE_TAGS.split(", ") }, environment: "shrine", updatedAt: "2020-01-01T00:00:00.000Z" }]
    ]);
    (spindle as any).chat = { getMessages: async () => [{ id: "a1", content: turnContent, is_user: false, name: "Kitsune", chat_id: "chat-reg", index_in_chat: 1, send_date: 1, swipe_id: 0, swipes: [turnContent], swipe_dates: [1], extra: {}, parent_message_id: "u", branch_id: null, created_at: 1, role: "assistant" }] };
    (spindle as any).sendToFrontend = () => {};
    spindle.generate = { raw: async () => ({ content: JSON.stringify({
      scenes: [{ ...scene, character: "Fox girl", characterId: "kitsune" }],
      cues: [{ paragraphIndex: 0, character: "Fox girl", characterId: "kitsune" }, { paragraphIndex: 1, character: "Fox girl", characterId: "kitsune", attire: "blue yukata" }],
      characters: [{ name: "Fox girl", characterId: "kitsune", description: "fox ears, fox tail", subjectCategory: "female" }]
    }) }) } as any;
    await sendState(spindle, "chat-reg", "owner");
    const state = data.get(chatStatePath("chat-reg")) as StoredChatState;
    const record = data.get(state.activeTurnPath!) as StoredTurnRecord;
    expect(record.plan.visualCues.map((cue: { character?: string | null | undefined }) => cue.character)).toEqual(["Kitsune", "Kitsune"]);
    expect(state.latestScene).toMatchObject({ character: "Kitsune", characterId: "kitsune", subjectCategory: "female", attire: "blue yukata", identityPrompt: KITSUNE_TAGS });
    const stored = data.get(characterRegistryPath("chat-reg")) as { characters: Record<string, { aliases: string[]; subjectCategory: string }> };
    expect(stored.characters.kitsune).toMatchObject({ aliases: ["Fox girl"], subjectCategory: "female" });
    const roster = data.get("chats/chat-reg/characters.json") as Record<string, string>;
    expect(Object.keys(roster)).toEqual(["Kitsune"]);
    const visual = data.get(singleCharacterStatePath("chat-reg")) as { protagonist: { name: string } };
    expect(visual.protagonist.name).toBe("Kitsune");
  });
});
