import { expect, test } from "bun:test";
import { planTurn } from "./planner.js";
import { emptySingleCharacter } from "../core/visual-state.js";
import { compileImagePrompt, resolveCueCharacterVisualState } from "./images.js";
import { DEFAULT_CONFIG } from "../../config.js";
import { loadCharacterAppearance, mergePlannerCharacters } from "./storage.js";

const content = "The catgirl listens.\n\nA shark girl enters.\n\nShe changes clothes.";
const message: any = { id: "m", chat_id: "chat", index_in_chat: 2, is_user: false, name: "Scenario", content, send_date: 1, swipe_id: 0, swipes: [content], extra: {}, role: "assistant" };
const config = { ...DEFAULT_CONFIG, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false };
const frozen = { ...emptySingleCharacter(), protagonist: { name: "Neko", tags: ["catgirl", "cat ears", "black hair"] } };
const scene = { startParagraph: 0, boundary: { claimedNewScene: true, reason: "location_change", location: "Apartment" }, environment: { location: "Apartment", timeOfDay: "evening", weather: null, lighting: "warm", description: "A quiet apartment.", persistentElements: [] }, cast: ["Neko"], basePrompt: "apartment", compositionLock: "centered" };
const roster = [{ name: "Neko", description: "catgirl, cat ears, black hair" }, { name: "Shark Girl", description: "shark girl, shark tail, gray skin, blue eyes" }];
async function run(output: any, overrides: any = {}) {
  const spindle: any = { generate: { raw: async () => ({ text: JSON.stringify(output) }) }, log: { warn() {} } };
  return planTurn(spindle, { chatId: "chat", message, content, previousScene: null, previousContinuity: null, recentMessages: [], config, singleCharacter: frozen, characterAppearance: {}, ...overrides });
}

test("unknown new subjects never inherit a previous body", async () => {
  for (const name of ["Shark Girl", "Guard", "Visitor", "Aetherborn"]) {
    const result = await run({ scenes: [{ ...scene, character: name, cast: [name] }], cues: [{ paragraphIndex: 0, character: name }], characters: [] });
    const cue = result.plan.visualCues[0]!;
    expect(cue.character).toBe(name);
    expect(cue.resolvedIdentity).toBe("");
    expect(result.plan.planningStatus).toBe("partial");
    expect(compileImagePrompt(config, result.plan.scenes[0]!, cue)).not.toContain("cat ears");
  }
});

test("future cues do not override an explicit opening cast, including repaired opening cues", async () => {
  for (const cues of [[{ paragraphIndex: 0 }, { paragraphIndex: 1, character: "Shark Girl" }], [{ paragraphIndex: 1, character: "Shark Girl", attire: "red swimsuit" }]]) {
    const result = await run({ scenes: [scene], cues, characters: roster });
    expect(result.plan.scenes[0]?.character).toBe("Neko");
    expect(result.plan.visualCues[0]?.resolvedIdentity).toContain("cat ears");
    expect(result.plan.visualCues[0]?.resolvedAttire).toBeNull();
    expect(result.plan.visualCues[1]?.character).toBe("Shark Girl");
    expect(result.plan.visualCues[1]?.resolvedIdentity).not.toContain("cat ears");
    expect(result.singleCharacter.protagonist.name).toBe("Shark Girl");
  }
});

test("wardrobe events stay at their paragraph even beyond the image limit", async () => {
  const result = await run({ scenes: [scene, { ...scene, startParagraph: 2, attire: "red swimsuit" }], cues: [{ paragraphIndex: 0 }, { paragraphIndex: 1, attire: "blue pajamas" }, { paragraphIndex: 2 }], characters: roster }, { config: { ...config, maxImagesPerTurn: 1 } });
  expect(result.plan.visualCues).toHaveLength(1);
  expect(result.plan.scenes[0]?.attire).toBeNull();
  expect(resolveCueCharacterVisualState(result.plan.scenes[0]!, result.plan.visualCues[0]!).attire).toBe("");
  expect(result.plan.continuityDeltas.map((d) => d.paragraphIndex)).toEqual([1, 2]);
  expect(result.plan.terminalVisualState?.attire).toBe("red swimsuit");
  expect(result.plan.terminalContinuity.characters.Neko?.wardrobe.attire).toBe("red swimsuit");
});

test("species labels and open-ended typed anatomy survive the final subject prompt", async () => {
  for (const character of [roster[1]!, { name: "Visitor", description: "blue eyes", species: "Aetherborn", anatomy: ["gills"] }]) {
    const result = await run({ scenes: [{ ...scene, character: character.name, cast: [character.name] }], cues: [{ paragraphIndex: 0, character: character.name }], characters: [character] });
    const prompt = compileImagePrompt(config, result.plan.scenes[0]!, result.plan.visualCues[0]!);
    expect(prompt).toContain(character.name === "Visitor" ? "Aetherborn species" : "shark girl");
    if (character.name === "Visitor") expect(prompt).toContain("gills anatomy");
  }
});

test("chat-scoped rosters cannot inherit a same-name character from another chat or the legacy global map", async () => {
  const data = new Map<string, unknown>([["character-appearance.json", { Guard: "cat ears, black hair" }]]);
  const spindle: any = { userStorage: { getJson: async (path: string, options: any) => data.get(path) ?? options.fallback, setJson: async (path: string, value: unknown) => { data.set(path, value); } } };
  expect(await loadCharacterAppearance(spindle, "owner", "A")).toEqual({});
  await mergePlannerCharacters(spindle, [{ name: "Guard", description: "gray skin, blue eyes" }], "owner", "A");
  await mergePlannerCharacters(spindle, [{ name: "Guard", description: "red hair, green eyes" }], "owner", "B");
  expect((await loadCharacterAppearance(spindle, "owner", "A")).Guard).toBe("gray skin, blue eyes");
  expect((await loadCharacterAppearance(spindle, "owner", "B")).Guard).toBe("red hair, green eyes");
});
