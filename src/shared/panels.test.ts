import { describe, expect, test } from "bun:test";
import { extractPanelSpans, maskPanelSpans } from "./panels.js";
import { prepareNarrative } from "../backend/core/paragraphs.js";
import { evaluatePanelRule } from "../frontend/stage/panel-rules.js";

describe("panel extraction", () => {
  test("balances nested blocks and preserves surrounding narrative", () => {
    const source = 'Before.\n\n<style>.x{color:red}</style><div class="x"><div>HP</div><input type="checkbox"><label>Stats</label></div>\n\nAfter.';
    const spans = extractPanelSpans(source);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.html).toStartWith("<style>");
    expect(maskPanelSpans(source, spans).length).toBe(source.length);
    const result = prepareNarrative(source);
    expect(result.paragraphs.map((p) => p.text)).toEqual(["Before.", "After."]);
    expect(result.panels[0]!.paragraphIndex).toBe(1);
  });
  test("extracts fenced SVG and leaves ordinary formatting and code alone", () => {
    const source = 'A <span>word</span>.\n\n```svg\n<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>\n```\n\n`<div>code</div>`\n\n```js\n<div>example</div>\n```';
    const spans = extractPanelSpans(source);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.title).toBe("SVG illustration");
    expect(source.slice(spans[0]!.start, spans[0]!.end)).toStartWith("```svg");
  });
  test("does not consume truncated markup or confuse tags inside quoted attributes", () => {
    expect(extractPanelSpans('<div><span>unfinished')).toEqual([]);
    expect(extractPanelSpans('<div data-note=">">text</div>')).toHaveLength(1);
    expect(extractPanelSpans('<div>broken</section> remaining')).toEqual([]);
  });
  test("keeps source indexes while filtering multi-block and multiline status", () => {
    const result = prepareNarrative('Before\n\n<status>\nHP\n\nMP\n</status>\n\n[WORLD_VOICE: one\ntwo]\n\nAfter', { ignoredTags: ["status", "WORLD_VOICE"] });
    expect(result.paragraphs.map((p) => p.text)).toEqual(["Before", "After"]);
    expect(result.paragraphs[1]!.sourceIndex).toBe(4);
    expect(result.panels.map((p) => p.followKey)).toEqual(["tag:status", "tag:world_voice"]);
  });
  test("panel-only responses remain revealable", () => {
    const result = prepareNarrative('<svg><circle r="5"/></svg>');
    expect(result.paragraphs).toHaveLength(1);
    expect(result.panels[0]!.paragraphIndex).toBe(0);
  });
  test("does not extract VN choice controls hidden inside an HTML wrapper", () => {
    const result = prepareNarrative('<div>Choose.<Choice>Leave</Choice></div>');
    expect(result.panels).toEqual([]);
    expect(result.choices[0]!.label).toBe("Leave");
  });
  test("ignored reasoning cannot leak nested HTML into the panel drawer", () => {
    const result = prepareNarrative('Before\n\n<Think><div>Private</div></Think>\n\nAfter', { ignoredTags: ["Think"] });
    expect(result.panels).toEqual([]);
    expect(result.paragraphs.map((p) => p.text)).toEqual(["Before", "After"]);
  });
  test("duplicate tag sources are snapshots rather than ambiguous following pins", () => {
    const result = prepareNarrative('<status>Alice HP 10</status>\n\n<status>Bob HP 20</status>', { ignoredTags: ["status"] });
    expect(result.panels).toHaveLength(2);
    expect(result.panels.every((p) => !p.followKey)).toBe(true);
  });
  test("caps card count and rejects oversized cards", () => {
    expect(extractPanelSpans('<div>x</div>'.repeat(20))).toHaveLength(12);
    expect(extractPanelSpans(`<div>${"x".repeat(100_000)}</div>`)).toHaveLength(0);
  });
});

describe("panel template rules", () => {
  const rule = { id: "status", title: "Stats", pattern: "\\[STATUS: (.*?)\\]", flags: "g", template: "<div>$1</div>" };
  test("escapes captured markup and preserves Unicode", () => {
    expect(evaluatePanelRule('[STATUS: <img src=x> 유니크]', rule)[0]!.html).toBe('<div>&lt;img src=x&gt; 유니크</div>');
  });
  test("supports 36 captures without confusing $3 and $36", () => {
    const pattern = Array.from({ length: 36 }, () => "(\\d+)").join(",");
    expect(evaluatePanelRule(Array.from({ length: 36 }, (_, i) => i + 1).join(","), { ...rule, pattern, template: "$36 / $3 / $$" })[0]!.html).toBe("36 / 3 / $");
  });
  test("reports missing captures, empty matches, invalid patterns and macros", () => {
    expect(() => evaluatePanelRule('[STATUS: Jay]', { ...rule, template: "$36" })).toThrow("capture");
    expect(() => evaluatePanelRule('abc', { ...rule, pattern: "^" })).toThrow("empty");
    expect(() => evaluatePanelRule('abc', { ...rule, pattern: "[" })).toThrow();
    expect(() => evaluatePanelRule('abc', { ...rule, template: "{{getvar::lang}}" })).toThrow("macros");
  });
});
