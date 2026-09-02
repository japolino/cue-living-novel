import assert from "node:assert/strict";
import test from "node:test";
import { formatDialogueText, parseCustomRegexRules } from "./rich-text.js";

test("parses custom regex rules with flags", () => {
  const input = `/§([^§]+)§/g => <em class="vn-transmission">$1</em>\n/foo/i => bar`;
  const rules = parseCustomRegexRules(input);
  assert.equal(rules.length, 2);
  assert.equal(rules[0]!.replacement, '<em class="vn-transmission">$1</em>');
});

test("renders markdown bold and italic safely", () => {
  const result = formatDialogueText("Hello **bold** and *italic* world!");
  assert.match(result, /<strong>bold<\/strong>/);
  assert.match(result, /<em>italic<\/em>/);
});

test("renders <font color> tags safely", () => {
  const input = '<font color="#D98AE8">"Too late. Word is in jungle now."</font>';
  const result = formatDialogueText(input);
  assert.match(result, /<font color="#D98AE8">/);
  assert.match(result, /Too late/);
});

test("applies regex transformation for transmission keys like §Krrk—§", () => {
  const rules = parseCustomRegexRules('/§([^§]+)§/g => <em class="vn-transmission">$1</em>');
  const result = formatDialogueText("§Krrk—§ Did you hear that?", rules);
  assert.match(result, /<em class="vn-transmission">Krrk—<\/em>/);
});

test("strips inline card img tags completely from formatted text", () => {
  const result = formatDialogueText('Hello <img="neeko_excited"> there!');
  assert.equal(result, "Hello  there!");
});

test("escapes unsafe HTML script tags", () => {
  const result = formatDialogueText('<script>alert("xss")</script>');
  assert.doesNotMatch(result, /<script>/);
  assert.match(result, /&lt;script&gt;/);
});
