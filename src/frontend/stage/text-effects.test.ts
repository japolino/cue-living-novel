import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument, parseHtml } from "./stage-test-dom";
import { formatDialogueText } from "./rich-text";
import {
  applyTextEffects,
  MAX_TEXT_EFFECT_LETTERS_PER_SPAN,
  splitGraphemes,
  splitGraphemesFallback,
  TEXT_EFFECT_GLUE_ATTRIBUTE,
} from "./text-effects";

const html = (markup: string): FakeNode => {
  const root = new FakeNode("p");
  for (const node of parseHtml(markup)) root.appendChild(node);
  return root;
};
const apply = (root: FakeNode) => applyTextEffects(root as unknown as ParentNode);
const letters = (root: FakeNode) => root.querySelectorAll("[data-vn-text-fx-ch]");
const index = (letter: FakeNode) => letter.style["--vn-ch"];
const textNodes = (node: FakeNode, out: FakeNode[] = []): FakeNode[] => {
  for (const child of node.children) {
    if (child.isText) out.push(child);
    else textNodes(child, out);
  }
  return out;
};

describe("applyTextEffects", () => {
  let restore: () => void;
  beforeEach(() => { restore = installFakeDocument(); });
  afterEach(() => restore());

  test("splits per-letter effects into words and indexed letters", () => {
    const root = html(formatDialogueText("<wave>La la</wave>"));
    apply(root);
    const span = root.querySelector('[data-vn-text-fx="wave"]')!;
    const words = span.querySelectorAll("[data-vn-text-fx-word]");
    expect(words.length).toBe(2);
    expect(words.map((w) => w.textContent)).toEqual(["La", "la"]);
    expect(letters(root).map((l) => l.textContent)).toEqual(["L", "a", "l", "a"]);
    expect(letters(root).map(index)).toEqual(["0", "1", "2", "3"]);
    // The space stays a plain, breakable text node between the words.
    expect(span.children.map((c) => (c.isText ? `text:${c.textContent}` : "word"))).toEqual(["word", "text: ", "word"]);
    expect(root.textContent).toBe("La la");
  });

  test("every letter is its own text node so the typewriter can reveal it", () => {
    const root = html(formatDialogueText("<shake>No!</shake>"));
    apply(root);
    for (const letter of letters(root)) {
      expect(letter.children.length).toBe(1);
      expect(letter.children[0]!.isText).toBe(true);
    }
  });

  test("is idempotent", () => {
    const root = html(formatDialogueText('He said "<shake>No way</shake>" twice.'));
    apply(root);
    const once = root.innerHTML;
    const nodes = textNodes(root);
    apply(root);
    apply(root);
    expect(root.innerHTML).toBe(once);
    // Same text node objects: a rerun never swaps nodes under the typewriter.
    expect(textNodes(root)).toEqual(nodes);
    expect(letters(root).length).toBe(5);
  });

  test("whole-span effects keep their text untouched", () => {
    const markup = formatDialogueText("<glow>The seal</glow> <whisper>breaks</whisper>");
    const root = html(markup);
    apply(root);
    expect(letters(root).length).toBe(0);
    expect(root.querySelector('[data-vn-text-fx="glow"]')!.children.length).toBe(1);
  });

  test("nested effects continue one letter count and split once", () => {
    const root = html(formatDialogueText("<rainbow>ab <wave>cd</wave> <strong>ef</strong></rainbow>"));
    apply(root);
    expect(letters(root).map((l) => l.textContent).join("")).toBe("abcdef");
    expect(letters(root).map(index)).toEqual(["0", "1", "2", "3", "4", "5"]);
    const wave = root.querySelector('[data-vn-text-fx="wave"]')!;
    expect(wave.querySelectorAll("[data-vn-text-fx-ch]").length).toBe(2);
    expect(root.querySelector("strong")!.querySelectorAll("[data-vn-text-fx-ch]").length).toBe(2);
    // No letter inside a letter.
    for (const letter of letters(root)) expect(letter.querySelectorAll("[data-vn-text-fx-ch]").length).toBe(0);
  });

  test("keeps emoji, flags and combining marks whole", () => {
    const root = html(formatDialogueText("<bounce>e\u0301👨‍👩‍👧🇯🇵👍🏽</bounce>"));
    apply(root);
    expect(letters(root).map((l) => l.textContent)).toEqual(["e\u0301", "👨‍👩‍👧", "🇯🇵", "👍🏽"]);
  });

  test("grapheme split with and without Intl.Segmenter agree on common cases", () => {
    const sample = "e\u0301👨‍👩‍👧🇯🇵🇫🇷👍🏽a b";
    const expected = ["e\u0301", "👨‍👩‍👧", "🇯🇵", "🇫🇷", "👍🏽", "a", " ", "b"];
    expect(splitGraphemes(sample)).toEqual(expected);
    expect(splitGraphemesFallback(sample)).toEqual(expected);
    expect(splitGraphemesFallback("❤️‍🔥!")).toEqual(["❤️‍🔥", "!"]);
  });

  test("glues a touching quote to the first and last letters", () => {
    const root = html(formatDialogueText('She yelled "<shout>STOP!</shout>" and ran.'));
    apply(root);
    const glue = root.querySelector(`[${TEXT_EFFECT_GLUE_ATTRIBUTE}]`)!;
    expect(glue).toBeTruthy();
    expect(glue.textContent).toBe('"STOP!"');
    expect(glue.children[0]!.textContent).toBe('"');
    expect(glue.children[1]!.getAttribute("data-vn-text-fx")).toBe("shout");
    expect(glue.children[2]!.textContent).toBe('"');
    expect(root.textContent).toBe('She yelled "STOP!" and ran.');
  });

  test("no glue when spaces surround the effect", () => {
    const root = html(formatDialogueText("a <wave>b</wave> c"));
    apply(root);
    expect(root.querySelector(`[${TEXT_EFFECT_GLUE_ATTRIBUTE}]`)).toBeNull();
  });

  test("caps the letters split per effect; the rest stays plain text", () => {
    const long = "x".repeat(MAX_TEXT_EFFECT_LETTERS_PER_SPAN + 50);
    const root = html(formatDialogueText(`<wave>${long} tail</wave>`));
    apply(root);
    expect(letters(root).length).toBe(MAX_TEXT_EFFECT_LETTERS_PER_SPAN);
    expect(root.textContent).toBe(`${long} tail`);
    apply(root);
    expect(letters(root).length).toBe(MAX_TEXT_EFFECT_LETTERS_PER_SPAN);
    expect(root.textContent).toBe(`${long} tail`);
  });

  test("works when the root is the effect span itself", () => {
    const [span] = parseHtml('<span data-vn-text-fx="wave">hi</span>');
    apply(span!);
    expect(letters(span!).length).toBe(2);
  });

  test("ignores spans with unknown effect ids and empty roots", () => {
    const root = html('<span data-vn-text-fx="nope">hi</span>');
    apply(root);
    expect(letters(root).length).toBe(0);
    apply(new FakeNode("p"));
  });
});
