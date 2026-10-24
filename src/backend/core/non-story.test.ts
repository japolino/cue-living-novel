import { describe, expect, test } from "bun:test";
import {
  applyStoryLabels, NON_STORY_CARD_TITLE, nonStoryMarkupRanges, PANELS_ONLY_TEXT, parseStoryLabels,
  storyCheckKey, storyCheckMessages, storyLines, structuralLine, STORY_CHECK_SYSTEM,
} from "./non-story.js";
import { prepareNarrative } from "./paragraphs.js";

const cut = (content: string) => nonStoryMarkupRanges(content).map((range) => content.slice(range.start, range.end));

describe("non-story markup", () => {
  test("finds comments, reasoning, interface and hidden elements but leaves story markup", () => {
    const content = "<!-- inlay -->A <b>bold</b> line.\n<think>plan the scene</think>\n<span class=\"hud\">HP 3</span> <i>She ran.</i>\n<div hidden>secret</div><form><input></form>";
    expect(cut(content)).toEqual(["<!-- inlay -->", "<think>plan the scene</think>", "<span class=\"hud\">HP 3</span>", "<div hidden>secret</div>", "<form><input></form>"]);
    expect(nonStoryMarkupRanges("<tracker>Day 3</tracker>")[0]?.card).toBe("tracker");
    expect(nonStoryMarkupRanges("<span class=\"statistics\">x</span>")).toEqual([]);
  });

  test("a closing reasoning tag without an opener ends a reasoning preamble", () => {
    expect(cut("I should open with rain.\n</think>\n\nRain fell.")).toEqual(["I should open with rain.\n</think>"]);
    expect(cut("<think>a</think> Story. </think>")).toEqual(["<think>a</think>"]);
  });

  test("an unclosed reasoning or status element covers only its own block", () => {
    expect(cut("<thinking>draft the reply\nkeep it short\n\nShe smiled.")).toEqual(["<thinking>draft the reply\nkeep it short"]);
    expect(cut("<details>open spoiler")).toEqual([]);
  });
});

describe("structural line rules", () => {
  test("bracketed headers, brace fields and table rows are status lines", () => {
    expect(structuralLine("[Elsie: Slightly dislike it]")).toEqual({ skip: "status", text: "[Elsie: Slightly dislike it]" });
    expect(structuralLine("**【상태창】 〔Day 2〕**")).toMatchObject({ skip: "status" });
    expect(structuralLine("{Date: Spring, Year 1|Time: Afternoon}")).toMatchObject({ skip: "status" });
    expect(structuralLine("{YEARS = 1423}")).toMatchObject({ skip: "status" });
    expect(structuralLine("| HP | 40 |")).toMatchObject({ skip: "status" });
    expect(structuralLine("[Day 3 | 21:40 | Harbor Inn]")).toMatchObject({ skip: "status" });
  });

  test("placeholders, rules and tag-only lines are dropped as markup", () => {
    for (const line of ["INLAY[{{inlay::d862f885}}]", "INLAY[]", "{{img::door}}", "---", "═══════", "* * *", "<lb-xnai id=\"scene-2\"></lb-xnai>", "<scenecard>"]) {
      expect(structuralLine(line).skip).toBe("markup");
    }
  });

  test("story lines keep their words: tags unwrap, pipe brackets go, effect tags stay", () => {
    expect(structuralLine("<font color=\"#E28743\">\"Hello,\"</font> she said.")).toEqual({ text: "\"Hello,\" she said." });
    expect(structuralLine("<shake>Run!</shake> <Hero: Jay | Level: 1>")).toEqual({ text: "<shake>Run!</shake>" });
    expect(structuralLine("\"Fine.\" [Mood: tired | Trust: 40%] She left.")).toEqual({ text: "\"Fine.\" She left." });
    expect(structuralLine("She read the sign [closed] and left. I <3 you, x < y.")).toEqual({ text: "She read the sign [closed] and left. I <3 you, x < y." });
    expect(structuralLine("Kai: are u coming or not")).toEqual({ text: "Kai: are u coming or not" });
  });
});

describe("story check prompt and parsing", () => {
  test("rows parse by index, keep missing rows as story and refuse answers without rows", () => {
    expect(parseStoryLabels("Sure:\n0 K\n2: S\n- 3 s\n9 S", 4)).toBe("KKSS");
    expect(parseStoryLabels("I cannot help with that.", 3)).toBeNull();
    expect(parseStoryLabels("", 2)).toBeNull();
  });

  test("the prompt is Choir's frozen check, with lines cut to the requested width", () => {
    const [system, user] = storyCheckMessages(["x".repeat(200), "Kai: hi"], 60);
    expect(system!.content).toBe(STORY_CHECK_SYSTEM);
    expect(system!.content).toMatch(/^You clean AI roleplay replies/);
    expect(system!.content).toMatch(/Example 2 answer: \n0 S\n1 K/);
    expect(user!.content).toBe(`Reply to label (2 lines):\n0: ${"x".repeat(60)}\n1: Kai: hi\n\nReturn exactly 2 labels.`);
  });

  test("lines are what the check sees and the cache key follows them", () => {
    const lines = storyLines([{ index: 0, sourceIndex: 0, text: "*Rain fell.*\n<shake>Run!</shake>" }, { index: 1, sourceIndex: 2, text: "## Day 3" }]);
    expect(lines).toEqual(["Rain fell.", "Run!", "Day 3"]);
    expect(storyCheckKey(lines)).toBe(storyCheckKey(["Rain fell.", "Run!", "Day 3"]));
    expect(storyCheckKey(lines)).not.toBe(storyCheckKey(["Rain fell.", "Run!"]));
  });
});

describe("applying story labels", () => {
  const narrative = () => ({
    paragraphs: [
      { index: 0, sourceIndex: 0, text: "Okay, I need to plan this.\nKeep it short." },
      { index: 1, sourceIndex: 1, text: "Rain fell on the inn.\n\"You're late,\" Tom said." },
      { index: 2, sourceIndex: 3, text: "Mood: tired\nTrust: 40%" },
      { index: 3, sourceIndex: 4, text: "She sat down." },
    ],
    panels: [{ id: "p", title: "Inline card", html: "<div>x</div>", paragraphIndex: 2 }],
    choices: [{ id: "c", label: "Go", submission: "Go", source: "authored" as const, unlocksAfterParagraph: 3 }],
  });

  test("drops S lines, re-indexes paragraphs and moves panels, choices and the card", () => {
    const checked = applyStoryLabels(narrative(), "SSKSSSK");
    expect(checked.paragraphs).toEqual([
      { index: 0, sourceIndex: 1, text: "Rain fell on the inn." },
      { index: 1, sourceIndex: 4, text: "She sat down." },
    ]);
    expect(checked.skipped).toBe(5);
    expect(checked.paragraphMap).toEqual([0, 0, 1, 1]);
    expect(checked.removedParagraphs).toEqual([0, 2]);
    expect(checked.panels[0]).toMatchObject({ id: "p", paragraphIndex: 1 });
    expect(checked.panels[1]).toMatchObject({ title: NON_STORY_CARD_TITLE, followKey: "nonstory", paragraphIndex: 0 });
    expect(checked.panels[1]!.html).toBe("<pre>Okay, I need to plan this.\nKeep it short.\n\n&quot;You&#39;re late,&quot; Tom said.\n\nMood: tired\nTrust: 40%</pre>");
    expect(checked.choices[0]!.unlocksAfterParagraph).toBe(1);
  });

  test("all-story labels change nothing", () => {
    const input = narrative();
    const checked = applyStoryLabels(input, "KKKKKKK");
    expect(checked.paragraphs).toBe(input.paragraphs);
    expect(checked.skipped).toBe(0);
    expect(checked.paragraphMap).toEqual([0, 1, 2, 3]);
  });

  test("a reply with no story at all becomes one pointer to the card", () => {
    const checked = applyStoryLabels(narrative(), "SSSSSSS");
    expect(checked.paragraphs).toEqual([{ index: 0, sourceIndex: 0, text: PANELS_ONLY_TEXT }]);
    expect(checked.removedParagraphs).toEqual([0, 1, 2, 3]);
    expect(checked.panels.map((panel) => panel.title)).toEqual(["Inline card", NON_STORY_CARD_TITLE]);
  });
});

describe("prepareNarrative with skipNonStory", () => {
  const reply = [
    "<think>Plan: rain, then Tom.</think>",
    "Rain fell on the inn. <!-- seed -->",
    "[Day 3 | 21:40 | Harbor Inn]\n\"You're late,\" Tom said. <font color=\"red\">Really late.</font>",
    "<status>HP 40/100</status>",
    "INLAY[{{inlay::a1}}]\n---",
  ].join("\n\n");

  test("removes reasoning and markup, cards status lines and keeps the story", () => {
    const prepared = prepareNarrative(reply, { skipNonStory: true });
    expect(prepared.paragraphs).toEqual([
      { index: 0, sourceIndex: 1, text: "Rain fell on the inn." },
      { index: 1, sourceIndex: 2, text: "\"You're late,\" Tom said. Really late." },
    ]);
    expect(prepared.panels.map((panel) => [panel.title, panel.paragraphIndex])).toEqual([["status", 1], [NON_STORY_CARD_TITLE, 1]]);
    expect(prepared.nonStory).toEqual([{ at: 1, text: "[Day 3 | 21:40 | Harbor Inn]" }]);
  });

  test("off by option: the reply is prepared exactly as before", () => {
    const prepared = prepareNarrative(reply);
    expect(prepared.paragraphs.map((paragraph) => paragraph.sourceIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(prepared.nonStory).toBeUndefined();
  });

  test("structural cleanup never leaves a reply without a paragraph", () => {
    expect(prepareNarrative("<Ryou>\n<wiki>", { skipNonStory: true }).paragraphs).toEqual([{ index: 0, sourceIndex: 0, text: "<Ryou>\n<wiki>" }]);
    expect(prepareNarrative("[Day 3]", { skipNonStory: true }).paragraphs).toEqual([{ index: 0, sourceIndex: 0, text: PANELS_ONLY_TEXT }]);
  });
});
