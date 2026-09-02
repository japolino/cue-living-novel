import { describe, expect, test } from "bun:test";
import { extractInlineCardImages, prepareNarrative } from "./paragraphs.js";

describe("narrative preparation", () => {
  test("keeps paragraph source indexes after removing metadata", () => {
    const prepared = prepareNarrative("First paragraph.\n\n<Think>hidden</Think>\n\nSecond paragraph.", { ignoredTags: ["Think"] });
    expect(prepared.paragraphs).toEqual([
      { index: 0, sourceIndex: 0, text: "First paragraph." },
      { index: 1, sourceIndex: 2, text: "Second paragraph." }
    ]);
  });

  test("extracts single authored choices with attributes", () => {
    const prepared = prepareNarrative([
      "The door waits.",
      "",
      "<Choice id=\"enter\" value=\"I enter the room.\">Enter</Choice>",
      "<Choice message='I walk away.'>Leave</Choice>"
    ].join("\n"));
    expect(prepared.paragraphs).toEqual([{ index: 0, sourceIndex: 0, text: "The door waits." }]);
    expect(prepared.choices).toEqual([
      { id: "enter", label: "Enter", submission: "I enter the room.", source: "authored", unlocksAfterParagraph: 0 },
      { id: expect.stringMatching(/^choice-/), label: "Leave", submission: "I walk away.", source: "authored", unlocksAfterParagraph: 0 }
    ]);
  });

  test("does not renumber narrative blocks around a choice block", () => {
    const prepared = prepareNarrative("Before.\n\n<Choice>Continue</Choice>\n\nAfter.");
    expect(prepared.paragraphs).toEqual([
      { index: 0, sourceIndex: 0, text: "Before." },
      { index: 1, sourceIndex: 2, text: "After." }
    ]);
  });

  test("extracts a bullet list from one Choice block and creates stable unique IDs", () => {
    const content = "Answer now.\n\n<Choice>\n- Yes\n- No\n- Yes\n</Choice>";
    const first = prepareNarrative(content);
    const second = prepareNarrative(content);
    expect(first.choices.map(({ label }) => label)).toEqual(["Yes", "No", "Yes"]);
    expect(new Set(first.choices.map(({ id }) => id))).toHaveLength(3);
    expect(first.choices.map(({ id }) => id)).toEqual(second.choices.map(({ id }) => id));
  });

  test("extractInlineCardImages extracts asset names and strips tags", () => {
    const raw = 'Look at this: <img="neeko_excited"> and {{img::neeko_smug}} with <img src="neeko_neutral">';
    const extracted = extractInlineCardImages(raw);
    expect(extracted.assetNames).toEqual(["neeko_excited", "neeko_smug", "neeko_neutral"]);
    expect(extracted.text).toBe("Look at this:  and  with ");
  });

  test("prepareNarrative strips inline card images from paragraphs", () => {
    const content = 'Neeko says hello! <img="neeko_wave">\n\nShe winks. {{img::neeko_wink}}';
    const prepared = prepareNarrative(content);
    expect(prepared.paragraphs).toEqual([
      { index: 0, sourceIndex: 0, text: "Neeko says hello!" },
      { index: 1, sourceIndex: 1, text: "She winks." },
    ]);
  });

  test("prepareNarrative strips custom ignoredTags including bracket syntax", () => {
    const content = [
      "Before status window.",
      "",
      "<status>",
      "HP: 100/100",
      "MP: 50/50",
      "</status>",
      "",
      "[Status]",
      "Level 5 Adventurer",
      "[/Status]",
      "",
      "After status window.",
    ].join("\n");
    const prepared = prepareNarrative(content, { ignoredTags: ["status"] });
    expect(prepared.paragraphs).toEqual([
      { index: 0, sourceIndex: 0, text: "Before status window." },
      { index: 1, sourceIndex: 3, text: "After status window." },
    ]);
  });

  test("extractChoices rejects numeric attributes.value and preserves actual choice text", () => {
    const content = 'Some story text.\n\n<Choice id="2" value="2">Step closer and call her bluff</Choice>';
    const prepared = prepareNarrative(content);
    expect(prepared.choices).toEqual([
      {
        id: "2",
        label: "Step closer and call her bluff",
        submission: "Step closer and call her bluff",
        source: "authored",
        unlocksAfterParagraph: 0,
      },
    ]);
  });
});
