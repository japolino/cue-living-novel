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

test("renders complex nested markdown and underscore formatting", () => {
  assert.equal(
    formatDialogueText("**bold and *italic* inside**"),
    "<strong>bold and <em>italic</em> inside</strong>"
  );
  assert.equal(
    formatDialogueText("*italic and **bold** inside*"),
    "<em>italic and <strong>bold</strong> inside</em>"
  );
  assert.equal(
    formatDialogueText("***triple asterisk***"),
    "<strong><em>triple asterisk</em></strong>"
  );
  assert.equal(
    formatDialogueText("___triple underscore___"),
    "<strong><em>triple underscore</em></strong>"
  );
  assert.equal(
    formatDialogueText("This is _italic_ and __bold__ with underscores."),
    "This is <em>italic</em> and <strong>bold</strong> with underscores."
  );
  assert.equal(
    formatDialogueText("variable_name_with_underscores"),
    "variable_name_with_underscores"
  );
  assert.equal(
    formatDialogueText("`inline code` and ~~strikethrough~~"),
    "<code>inline code</code> and <del>strikethrough</del>"
  );
});

test("renders font tags with multiple attributes and preserves quotes", () => {
  const input = '<font color="#4a7c59" style="font-weight:bold">"Taking the bait?"</font> you murmur. <font color="#e05275" style="letter-spacing:0.03em">"Maybe I am."</font>';
  const result = formatDialogueText(input);
  assert.match(result, /<font color="#4a7c59" style="font-weight:bold">"Taking the bait\?"<\/font>/);
  assert.match(result, /<font color="#e05275" style="letter-spacing:0.03em">"Maybe I am\."<\/font>/);
});

test("renders font tags wrapping markdown italic", () => {
  const input = '<font color="#e05275">*Look at you trying to sound so collected,*</font>';
  const result = formatDialogueText(input);
  assert.equal(result, '<font color="#e05275"><em>Look at you trying to sound so collected,</em></font>');
});

test("strips dangerous attributes like onmouseover from font or span", () => {
  const input = '<font onmouseover="alert(1)" color="red">danger</font>';
  const result = formatDialogueText(input);
  assert.doesNotMatch(result, /onmouseover/);
  assert.match(result, /<font color="red">danger<\/font>/);
});
