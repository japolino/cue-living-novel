import { describe, expect, test } from "bun:test";
import { provisionalTurnView, settledSpeakers, type ProvisionalSpeakerNames } from "./provisional-turn.js";

const names: ProvisionalSpeakerNames = {
  characters: [{ name: "Mira Kael", aliases: ["Fox girl"] }, { name: "Kai" }],
  persona: "Theo",
};

describe("settledSpeakers", () => {
  test("a script line names its speaker (markdown, aliases, first names)", () => {
    expect(settledSpeakers([
      "Mira Kael: Stay close.",
      "**Kai:** \"Fine.\"",
      "Fox girl: *grins*",
      "Mira: Over here.",
      "Theo: I nod.",
    ], names)).toEqual(["Mira Kael", "Kai", "Mira Kael", "Mira Kael", "Theo"]);
  });

  test("a speech tag ties the paragraph's quotes to one known name", () => {
    expect(settledSpeakers([
      "\"Over here,\" Mira says, waving the lantern.",
      "Kai quietly asks, \"Is it safe?\"",
      "“Wait!” Mira Kael shouted.",
      "*\"Hm,\"* Kai murmurs.",
    ], names)).toEqual(["Mira Kael", "Kai", "Mira Kael", "Kai"]);
  });

  test("anything the text does not settle stays narration", () => {
    expect(settledSpeakers([
      "Mira looks at Kai.",
      "\"Leave,\" Mira says. \"Now,\" Kai says.",
      "\"Hello,\" she says.",
      "A stranger: \"Who goes there?\"",
      "Location: the old observatory",
      "Mira says nothing for a while.",
      "\"Hi,\" you say.",
    ], names)).toEqual(["", "", "", "", "", "", ""]);
  });

  test("an inverted tag settles too; a script with two speakers does not", () => {
    expect(settledSpeakers([
      "\"Over here,\" says Mira, waving.",
      "Mira: Stay close.\nKai: Fine.",
      "Kai: Fine.\nKai: Really.",
    ], names)).toEqual(["Mira Kael", "", "Kai"]);
  });

  test("only tags outside the quotes count, and every speaker in the paragraph must be that one name", () => {
    expect(settledSpeakers([
      // Reported speech inside the quotes is not a tag.
      "\"You came,\" she says. \"Mira said you wouldn't.\"",
      "Her phone buzzes. \"Kai says he's stuck at work.\"",
      // A second speaker in the first person.
      "\"Leave,\" Mira murmurs. \"No,\" I say.",
      // A beat that may give the first quote to someone else.
      "Kai looks up. \"Now?\" \"Now,\" Mira says.",
      // Several people, or an unknown subject.
      "Kai and Mira laugh, \"Fine!\"",
      "\"Halt,\" the guard says.",
    ], names)).toEqual(["", "", "", "", "", ""]);
  });

  test("no known names: every paragraph is narration", () => {
    expect(settledSpeakers(["Mira: hi"], { characters: [] })).toEqual([""]);
  });
});

describe("provisionalTurnView", () => {
  test("text, panels and settled speakers only; trimmed like TurnPlan; previous ambient carried", () => {
    const view = provisionalTurnView({
      chatId: "chat",
      messageId: "m1",
      swipeId: 2,
      sourceFingerprint: "fp",
      revision: 4,
      speaker: "Mira",
      userSpeaker: "Theo",
      paragraphs: ["  The door creaks.  ", "\"Who's there?\" Kai asks."],
      panelSource: "raw",
      names,
      previousAmbient: "rain",
    });
    expect(view).toEqual({
      chatId: "chat",
      messageId: "m1",
      swipeId: 2,
      sourceFingerprint: "fp",
      revision: 4,
      speaker: "Mira",
      userSpeaker: "Theo",
      paragraphs: ["The door creaks.", "\"Who's there?\" Kai asks."],
      panelSource: "raw",
      paragraphSpeakers: ["", "Kai"],
      ambients: ["rain", "rain"],
      choices: [],
      assets: [],
      status: "planning",
      provisional: true,
    });
  });

  test("a previous scene without ambient data leaves the stage's ambient alone", () => {
    const view = provisionalTurnView({ chatId: "c", messageId: "m", swipeId: 0, sourceFingerprint: "fp", revision: 1, speaker: "Mira", userSpeaker: "You", paragraphs: ["Hi."], names });
    expect(Object.hasOwn(view, "ambients")).toBe(false);
    expect(provisionalTurnView({ chatId: "c", messageId: "m", swipeId: 0, sourceFingerprint: "fp", revision: 1, speaker: "Mira", userSpeaker: "You", paragraphs: ["Hi."], names, previousAmbient: null }).ambients).toEqual([null]);
  });
});
