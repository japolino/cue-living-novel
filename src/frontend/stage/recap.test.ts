import { describe, expect, test } from "bun:test";
import { SPRITE_HOT_SET, type SpriteActorStage, type SpriteImageView, type SpriteSetView, type SpriteTurnView } from "../../shared/sprites";
import { USER_PARAGRAPH_PREFIX, buildWaitingRecap, recapExcerpt, sceneAt, sceneKickerPlace, sceneMetaLine } from "./recap";

/** The waiting screen's recap: who was in the reply, what they said and how they looked. */
const actor = (characterKey: string, patch: Partial<SpriteActorStage> = {}): SpriteActorStage => ({
  characterKey, expression: "idle", slot: "center", facing: "viewer", focus: false, motion: "none", emote: "none", intensity: 3, ...patch,
});
const ready = (expression: string, url: string): SpriteImageView => ({ expression, status: "ready", url, bbox: [0.1, 0, 0.8, 1], width: 832, height: 1216 });
function set(setKey: string, name: string, images: SpriteImageView[]): SpriteSetView {
  const expressions: Record<string, SpriteImageView> = {};
  for (const id of SPRITE_HOT_SET) expressions[id] = { expression: id, status: "queued" };
  for (const image of images) expressions[image.expression] = image;
  return { setKey, name, attire: null, expressions, readyCount: images.length, updatedAt: "" };
}

const sprites: SpriteTurnView = {
  staging: {
    version: 1,
    source: "planner",
    cast: [
      { characterKey: "mira", name: "Mira Hale", identity: "", attire: null },
      { characterKey: "ren", name: "Ren", identity: "", attire: null },
    ],
    plates: [],
    paragraphs: [
      { actors: [actor("mira", { focus: true, motion: "hop" })], plateKey: null, light: "day" },
      { actors: [actor("mira", { slot: "left" }), actor("ren", { slot: "right", focus: true, emote: "anger" })], plateKey: null, light: "day" },
      { actors: [actor("ren", { slot: "right" }), actor("mira", { slot: "left", expression: "smile" })], plateKey: null, light: "day" },
      { actors: [actor("ren", { slot: "right" }), actor("mira", { slot: "left", expression: "smile" })], plateKey: null, light: "day" },
    ],
  },
  sets: {
    mira: set("set_mira", "Mira Hale", [ready("idle", "/mira/idle.png"), ready("smile", "/mira/smile.png")]),
    ren: set("set_ren", "Ren", [ready("idle", "/ren/idle.png")]),
  },
  plates: {},
};

const scenes = [
  { startParagraph: 0, location: "Kitchen, Hale house", timeOfDay: "morning", weather: "rain" },
  { startParagraph: 2, location: "Porch", timeOfDay: "noon", weather: null },
];

const base = {
  sprites,
  scenes,
  readerName: "Alex",
  sent: "Good morning.",
  writer: "Mira",
  backgroundUrl: "/bg.png",
};

describe("waiting screen recap", () => {
  test("the first quoted line is the excerpt, else the paragraph's start", () => {
    expect(recapExcerpt("She looks up. “Morning already?” she asks.")).toBe("Morning already?");
    expect(recapExcerpt("「おはよう」と言った。")).toBe("おはよう");
    expect(recapExcerpt("“Sorry, the train stopped twice,” Aoi says.")).toBe("Sorry, the train stopped twice");
    expect(recapExcerpt("「ごめん、」と言った。")).toBe("ごめん");
    expect(recapExcerpt("The **kettle** sings   on the stove.")).toBe("The kettle sings on the stove.");
    expect(recapExcerpt("x".repeat(200), 20)).toBe(`${"x".repeat(19)}…`);
  });

  test("the scene in effect at a paragraph", () => {
    expect(sceneAt(scenes, 0)?.location).toBe("Kitchen, Hale house");
    expect(sceneAt(scenes, 1)?.location).toBe("Kitchen, Hale house");
    expect(sceneAt(scenes, 3)?.location).toBe("Porch");
    expect(sceneAt([], 0)).toBeNull();
  });

  test("kicker and meta words", () => {
    expect(sceneKickerPlace("Living room, 221B Baker Street")).toBe("221B Baker Street");
    expect(sceneKickerPlace("Porch")).toBeNull();
    expect(sceneKickerPlace(null)).toBeNull();
    expect(sceneMetaLine(scenes[0]!, 11)).toBe("rain · morning · 11 paragraphs");
    expect(sceneMetaLine(scenes[1]!, 1)).toBe("noon · 1 paragraph");
    expect(sceneMetaLine(null, 0)).toBe("");
  });

  test("characters on stage at the end come first, each with their lines, pictures and moves", () => {
    const recap = buildWaitingRecap({
      ...base,
      paragraphs: [
        { id: "t:0", text: "“Morning!” Mira bounds in.", speaker: "Mira" },
        { id: "t:1", text: "“Too loud,” Ren mutters.", speaker: "Ren" },
        { id: "t:2", text: "The rain eases off.", speaker: "" },
        { id: "t:3", text: "“Come outside,” Mira Hale says, smiling.", speaker: "Mira Hale" },
      ],
    });
    // Ren stands first in the final paragraph's actors, so Ren leads.
    expect(recap.characters.map((character) => [character.key, character.onStage])).toEqual([["ren", true], ["mira", true]]);
    const mira = recap.characters.find((character) => character.key === "mira")!;
    expect(mira.name).toBe("Mira Hale");
    expect(mira.lines.map((line) => [line.index, line.excerpt, line.chip, line.image?.url])).toEqual([
      [0, "Morning!", "Hops", "/mira/idle.png"],
      [3, "Come outside", "Smile", "/mira/smile.png"],
    ]);
    expect(mira.image?.url).toBe("/mira/smile.png");
    const ren = recap.characters.find((character) => character.key === "ren")!;
    expect(ren.lines[0]!.chip).toBe("Angry");
    expect(recap.paragraphCount).toBe(4);
    expect(recap.scene?.location).toBe("Porch");
    expect(recap.entries.map((entry) => entry.kind)).toEqual(["character", "character", "narration", "character"]);
    expect(recap.entries[2]!.speaker).toBe("");
    expect(recap).toMatchObject({ sent: "Good morning.", writer: "Mira", backgroundUrl: "/bg.png" });
  });

  test("the reader's own lines are entries but not characters, and do not count as paragraphs", () => {
    const recap = buildWaitingRecap({
      ...base,
      sprites: null,
      paragraphs: [
        { id: `${USER_PARAGRAPH_PREFIX}1`, text: "Good morning.", speaker: "Alex" },
        { id: "t:0", text: "“Hi,” says Ren.", speaker: "Ren" },
        { id: "t:1", text: "Alex waves back.", speaker: "Alex" },
      ],
    });
    expect(recap.entries.map((entry) => [entry.kind, entry.index])).toEqual([["reader", 0], ["character", 0], ["reader", 1]]);
    expect(recap.characters.map((character) => character.key)).toEqual(["name:ren"]);
    expect(recap.characters[0]!.image).toBeNull();
    expect(recap.characters[0]!.onStage).toBe(false);
    expect(recap.paragraphCount).toBe(2);
  });

  test("inner voices go to their own list with their family colour", () => {
    const recap = buildWaitingRecap({
      ...base,
      sprites: null,
      paragraphs: [
        { id: "t:0", text: "You could just leave.", speaker: "LOGIC" },
        { id: "t:1", text: "“Stay,” Ren says.", speaker: "Ren" },
      ],
    });
    expect(recap.voices.map((voice) => [voice.name, voice.kind, voice.color])).toEqual([["LOGIC", "voice", "#5cb8e6"]]);
    expect(recap.voices[0]!.lines[0]!.chip).toBe("Inner voice");
    expect(recap.characters.map((character) => character.key)).toEqual(["name:ren"]);
  });

  test("a first name finds its cast member only when it is unique", () => {
    const shared: SpriteTurnView = {
      ...sprites,
      staging: {
        ...sprites.staging,
        cast: [...sprites.staging.cast, { characterKey: "mira2", name: "Mira Stone", identity: "", attire: null }],
        paragraphs: [{ actors: [actor("mira", { focus: true })], plateKey: null, light: "day" }],
      },
    };
    const recap = buildWaitingRecap({ ...base, sprites: shared, paragraphs: [{ id: "t:0", text: "“Hello.”", speaker: "Mira" }] });
    // "Mira" could be either: it stays a character of its own, and Mira Hale is only on stage.
    expect(recap.characters.map((character) => [character.key, character.lines.length])).toEqual([["mira", 0], ["name:mira", 1]]);
  });
});
