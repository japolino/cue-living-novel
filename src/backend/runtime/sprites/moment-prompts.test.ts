import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../../config.js";
import { SPRITE_INTERACTION_TAGS, SPRITE_INTERACTIONS, type SpriteInteraction, type SpriteStaging } from "../../../shared/sprites.js";
import { makePlan } from "../__fixtures__/sprite-staging-plans.js";
import {
  compileKeyMomentRequest,
  KEY_MOMENT_SIZE,
  keyMomentCharacterPhrase,
  keyMomentCountTags,
  keyMomentFaceTags,
  keyMomentScene,
  keyMomentScenes,
  promptTagKeys,
  type KeyMomentScene,
} from "./moment-prompts.js";

const config: VisualNovelConfig = { ...DEFAULT_CONFIG, promptPrefix: "masterpiece, best quality, artist:foo", promptSuffix: "depth of field", negativePrompt: "lowres, bad anatomy" };
const mira = { name: "Mira", identity: "1girl, silver hair, long hair, green eyes", attire: "white blouse, navy skirt", expression: "embarrassed" };
const kai = { name: "Kai", identity: "1boy, black hair, short hair, long hair", attire: "black jacket", expression: "smile" };
const rin = { name: "Rin", identity: "red hair, ponytail", attire: "school uniform", subjectCategory: "female" as const, expression: "idle" };
const plate = { location: "old observatory", timeOfDay: "night", weather: null, description: "brass telescope" };

function scene(interaction: SpriteInteraction, characters: KeyMomentScene["characters"], partner = false): KeyMomentScene {
  return { interaction, characters, partner, plate, light: "night" };
}

const tags = (prompt: string) => promptTagKeys(prompt);

describe("key-moment prompts: ComfyUI and other tag providers", () => {
  test("two characters: count tags, interaction, one phrase per character (outfit kept apart), framing, place, light, landscape", () => {
    const request = compileKeyMomentRequest({ config, provider: "comfyui", scene: scene("kiss", [mira, kai]) });
    const list = tags(request.prompt);
    expect(list.slice(0, 3)).toEqual(["masterpiece", "best quality", "artist:foo"]);
    expect(list).toContain("1girl");
    expect(list).toContain("1boy");
    expect(list).not.toContain("solo");
    for (const tag of ["kiss", "couple", "face-to-face", "closed eyes", "upper body", "old observatory", "night", "brass telescope", "moonlight", "depth of field"]) expect(list).toContain(tag);
    const prompt = request.prompt.replace(/\s+/g, " ");
    expect(prompt).toContain("a girl with silver hair, long hair, green eyes, wearing white blouse, navy skirt, embarrassed, raised eyebrows, furrowed brow");
    // "long hair" belongs to both characters: each phrase keeps it.
    expect(prompt).toContain("a boy with black hair, short hair, long hair, wearing black jacket, gentle smile");
    // The interaction sets the eyes: no contradicting eye tags from the expression.
    expect(list).not.toContain("half-closed eyes");
    expect(prompt.indexOf("kiss")).toBeLessThan(prompt.indexOf("a girl with"));
    expect(prompt.indexOf("a girl with")).toBeLessThan(prompt.indexOf("a boy with"));
    expect(request.parameters).toEqual({ width: KEY_MOMENT_SIZE.width, height: KEY_MOMENT_SIZE.height });
    expect(tags(request.negativePrompt)).toEqual(["lowres", "bad anatomy", "simple background", "white background", "multiple views", "text", "solo"]);
  });

  test("character phrase: clothing tags inside the identity become the outfit when no attire is set", () => {
    expect(keyMomentCharacterPhrase("girl", { name: "A", identity: "1girl, red hair, school uniform", attire: null }, "")).toBe("a girl with red hair, wearing school uniform");
    expect(keyMomentCharacterPhrase("other", { name: "B", identity: "robot, glowing eyes", attire: "cloak" }, "smile")).toBe("a person with robot, glowing eyes, wearing cloak, smile");
  });

  test("count tags follow the subjects: 2girls, 1boy + 1girl, 1other", () => {
    expect(keyMomentCountTags(["girl", "girl"])).toBe("2girls");
    expect(keyMomentCountTags(["boy", "girl"])).toBe("1girl, 1boy");
    expect(keyMomentCountTags(["boy", "boy"])).toBe("2boys");
    expect(keyMomentCountTags(["other"])).toBe("1other");
    const hug = tags(compileKeyMomentRequest({ config, provider: "swarmui", scene: scene("hug", [mira, rin]) }).prompt);
    expect(hug).toContain("2girls");
    expect(hug).not.toContain("1girl");
  });

  test("one character: solo pose, or a first-person view with an unknown partner", () => {
    const sitting = tags(compileKeyMomentRequest({ config, provider: "comfyui", scene: scene("sitting", [mira]) }).prompt);
    expect(sitting).toEqual(expect.arrayContaining(["1girl", "solo", "sitting", "full body"]));
    const pov = compileKeyMomentRequest({ config, provider: "comfyui", scene: scene("kiss", [mira], true) });
    expect(tags(pov.prompt)).toEqual(expect.arrayContaining(["1girl", "solo focus", "pov", "incoming kiss", "upper body"]));
    expect(tags(pov.prompt)).not.toContain("1boy");
    expect(tags(pov.negativePrompt)).not.toContain("solo");
  });

  test("no character: the place itself, like a plate", () => {
    const request = compileKeyMomentRequest({ config, provider: "comfyui", scene: scene("none", []) });
    expect(tags(request.prompt)).toEqual(expect.arrayContaining(["scenery", "no humans", "old observatory"]));
    expect(tags(request.negativePrompt)).toEqual(expect.arrayContaining(["1girl", "1boy", "people"]));
  });

  test("every interaction compiles for 1 and 2 characters with its own tags and framing", () => {
    for (const interaction of SPRITE_INTERACTIONS) {
      const spec = SPRITE_INTERACTION_TAGS[interaction];
      const pair = tags(compileKeyMomentRequest({ config, provider: "comfyui", scene: scene(interaction, [mira, kai]) }).prompt);
      for (const tag of promptTagKeys(spec.pair)) expect([interaction, pair.includes(tag)]).toEqual([interaction, true]);
      expect([interaction, pair.includes(spec.framing)]).toEqual([interaction, true]);
      const one = tags(compileKeyMomentRequest({ config, provider: "comfyui", scene: scene(interaction, [mira], spec.solo === null) }).prompt);
      const expected = spec.solo === null ? spec.pov! : spec.solo;
      for (const tag of promptTagKeys(expected)) expect([interaction, one.includes(tag)]).toEqual([interaction, true]);
      // NovelAI compiles too, with one caption per character.
      const nai = compileKeyMomentRequest({ config: { ...config, imageModel: "nai-diffusion-4-5-full" }, provider: "novelai", scene: scene(interaction, [mira, kai]) });
      expect((nai.parameters.characterTags as unknown[]).length).toBe(2);
    }
  });

  test("face tags: body words, @_@ and emphasis braces are dropped; idle adds nothing", () => {
    expect(keyMomentFaceTags("idle")).toBe("");
    expect(keyMomentFaceTags(null)).toBe("");
    expect(keyMomentFaceTags("embarrassed")).toBe("embarrassed, raised eyebrows, furrowed brow");
    expect(keyMomentFaceTags("embarrassed", true)).toBe("embarrassed, raised eyebrows, furrowed brow");
    expect(keyMomentFaceTags("think")).not.toMatch(/hand|chin|looking/);
  });
});

describe("key-moment prompts: NovelAI", () => {
  const nai = { ...config, imageModel: "nai-diffusion-4-5-full" };

  test("V4+: one character caption each with the mutual action tag; base keeps count, interaction, place", () => {
    const request = compileKeyMomentRequest({ config: nai, provider: "novelai", scene: scene("kiss", [mira, kai]) });
    const base = tags(request.prompt);
    expect(base).toEqual(expect.arrayContaining(["1girl", "1boy", "kiss", "upper body", "old observatory", "moonlight"]));
    expect(base).not.toContain("silver hair");
    const captions = (request.parameters.characterTags as Array<{ tags: string }>).map((caption) => caption.tags);
    expect(captions).toHaveLength(2);
    expect(captions[0]).toMatch(/^girl, silver hair, long hair, green eyes, white blouse, navy skirt/);
    expect(captions[0]).toMatch(/mutual#kiss$/);
    expect(captions[1]).toMatch(/^boy, black hair/);
    expect(captions[1]).toMatch(/mutual#kiss$/);
    expect(request.parameters).toMatchObject({ resolution: "1216x832", qualityToggle: false });
    expect(tags(request.negativePrompt)).toContain("solo");
  });

  test("V4+: directed actions (the boy carries in a mixed pair); one character has no action tag", () => {
    const carry = compileKeyMomentRequest({ config: nai, provider: "novelai", scene: scene("carrying", [mira, kai]) });
    const captions = (carry.parameters.characterTags as Array<{ tags: string }>).map((caption) => caption.tags);
    expect(captions[0]).toMatch(/target#princess carry$/);
    expect(captions[1]).toMatch(/source#princess carry$/);
    const pov = compileKeyMomentRequest({ config: nai, provider: "novelai", scene: scene("kiss", [mira], true) });
    const single = (pov.parameters.characterTags as Array<{ tags: string }>).map((caption) => caption.tags);
    expect(single).toHaveLength(1);
    expect(single[0]).not.toContain("#");
    expect(tags(pov.prompt)).toEqual(expect.arrayContaining(["1girl", "solo focus", "pov", "incoming kiss"]));
  });

  test("V3 (no captions): everything in one prompt", () => {
    const request = compileKeyMomentRequest({ config: { ...config, imageModel: "nai-diffusion-3" }, provider: "novelai", scene: scene("hug", [mira, rin]) });
    expect(request.parameters.characterTags).toEqual([]);
    expect(tags(request.prompt)).toEqual(expect.arrayContaining(["2girls", "hug", "silver hair", "red hair"]));
  });
});

describe("key-moment scene from a staged plan", () => {
  const plan = makePlan({
    paragraphs: ["Mira and Kai reach the observatory.", "She rises on her toes and kisses Kai.", "Nobody else is here."],
    cues: [{ p: 1, character: "Mira", pose: "smile", identity: "1girl, silver hair" }, { p: 2, character: "Mira", pose: "smile", identity: "1girl, silver hair" }],
  });
  const actorOf = (characterKey: string, focus: boolean, slot: "left" | "right" | "center", expression = "idle") => ({ characterKey, expression, slot, facing: "viewer" as const, focus, motion: "none" as const, emote: "none" as const, intensity: 3 });
  const staging: SpriteStaging = {
    version: 1,
    source: "planner",
    cast: [
      { characterKey: "mira", name: "Mira", identity: "1girl, silver hair", attire: "white blouse" },
      { characterKey: "kai", name: "Kai", identity: "1boy, black hair", attire: null, subjectCategory: "male" },
    ],
    plates: [{ plateKey: "plate_obs", location: "observatory", timeOfDay: "night", weather: null, description: "brass telescope" }],
    paragraphs: [
      { actors: [actorOf("mira", true, "left"), actorOf("kai", false, "right")], plateKey: "plate_obs", light: "night" },
      { actors: [actorOf("mira", true, "left", "embarrassed"), actorOf("kai", false, "right")], plateKey: null, light: "night", illustrate: true, moment: { interaction: "kiss", characters: ["mira", "kai"], partner: false } },
      { actors: [], plateKey: null, light: "dark", illustrate: true },
    ],
  };

  test("the staged moment decides: both cast members with outfit and staged expression, the inherited plate, the light", () => {
    const built = keyMomentScene(plan, staging, 1);
    expect(built.interaction).toBe("kiss");
    expect(built.partner).toBe(false);
    expect(built.characters.map((character) => [character.name, character.identity, character.attire, character.expression])).toEqual([
      ["Mira", "1girl, silver hair", "white blouse", "embarrassed"],
      ["Kai", "1boy, black hair", null, "idle"],
    ]);
    expect(built.characters[1]!.subjectCategory).toBe("male");
    expect(built.plate?.location).toBe("observatory");
    expect(built.light).toBe("night");
  });

  test("an older record without a moment uses the text rule; nobody staged falls back to the cue character", () => {
    const older = { ...staging, paragraphs: staging.paragraphs.map((paragraph, index) => (index === 1 ? { ...paragraph, moment: undefined } : paragraph)) };
    expect(keyMomentScene(plan, older, 1)).toMatchObject({ interaction: "kiss", partner: false });
    expect(keyMomentScene(plan, older, 1).characters.map((character) => character.name)).toEqual(["Kai", "Mira"]);
    const empty = keyMomentScene(plan, staging, 2);
    expect(empty.characters.map((character) => character.name)).toEqual(["Mira"]);
    expect(empty.characters[0]!.identity).toContain("silver hair");
    expect(empty.light).toBe("dark");
  });

  test("keyMomentScenes maps job ids at illustrated paragraphs only", () => {
    const scenes = keyMomentScenes({ ...plan, spriteStaging: staging }, [{ jobId: "a", paragraphIndex: 0 }, { jobId: "b", paragraphIndex: 1 }]);
    expect([...scenes.keys()]).toEqual(["b"]);
    expect(keyMomentScenes(plan, [{ jobId: "b", paragraphIndex: 1 }]).size).toBe(0);
  });
});
