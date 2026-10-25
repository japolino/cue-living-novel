import assert from "node:assert/strict";
import test from "node:test";
import { formatDialogueText, parseCustomRegexRules } from "./rich-text.js";
import { TEXT_EFFECT_IDS } from "../../shared/text-effects.js";

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

test("strips markdown formatting when stripMarkdown is requested", () => {
  const input = "*I stretch, a languid motion.* **Time**: Wednesday\nHello **world**!";
  const result = formatDialogueText(input, [], { stripMarkdown: true });
  assert.equal(result, "I stretch, a languid motion. Hello world!");
});

test("forces dialogue quotes on spoken dialogue lines when forceQuotes is requested", () => {
  const input = "W-What kind?!";
  const result = formatDialogueText(input, [], { forceQuotes: true, hasSpeaker: true });
  assert.equal(result, '"W-What kind?!"');
});

test("preserves existing quotes when forceQuotes is requested", () => {
  const input = '"Already quoted!"';
  const result = formatDialogueText(input, [], { forceQuotes: true, hasSpeaker: true });
  assert.equal(result, '"Already quoted!"');
});


// ---- Inline text effects ------------------------------------------------

test("text effect tags become effect spans, case-insensitive", () => {
  assert.equal(formatDialogueText("<shake>No!</shake>"), '<span data-vn-text-fx="shake">No!</span>');
  assert.equal(formatDialogueText("<RAINBOW>magic</Rainbow>"), '<span data-vn-text-fx="rainbow">magic</span>');
  assert.equal(formatDialogueText("< wave >la</ wave >"), '<span data-vn-text-fx="wave">la</span>');
});

test("every catalogue id is recognised", () => {
  for (const id of TEXT_EFFECT_IDS) {
    assert.equal(formatDialogueText(`<${id}>x</${id}>`), `<span data-vn-text-fx="${id}">x</span>`);
  }
});

test("text effects nest", () => {
  assert.equal(
    formatDialogueText("<rainbow><wave>la la</wave></rainbow>"),
    '<span data-vn-text-fx="rainbow"><span data-vn-text-fx="wave">la la</span></span>',
  );
});

test("unclosed effect tags are dropped and never swallow the paragraph", () => {
  assert.equal(formatDialogueText("<shake>No! and **then** more"), "No! and <strong>then</strong> more");
  // An inner tag left open is dropped; the outer pair still works.
  assert.equal(formatDialogueText("<rainbow><wave>la</rainbow> after"), '<span data-vn-text-fx="rainbow">la</span> after');
  // Stray closing tags disappear too.
  assert.equal(formatDialogueText("plain</shake> text"), "plain text");
  // Later markup keeps working.
  assert.equal(formatDialogueText("<glow>a <em>b</em> c"), "a <em>b</em> c");
});

test("crossed effect tags stay balanced", () => {
  const result = formatDialogueText("<shake>a<wave>b</shake>c</wave>");
  assert.equal(result, '<span data-vn-text-fx="shake">ab</span>c');
});

test("markdown inside effects keeps working", () => {
  assert.equal(
    formatDialogueText("<shout>**STOP** *now*</shout>"),
    '<span data-vn-text-fx="shout"><strong>STOP</strong> <em>now</em></span>',
  );
});

test("effect tags in inline code stay literal", () => {
  assert.equal(formatDialogueText("Type `<shake>x</shake>` to shake."), "Type <code>&lt;shake&gt;x&lt;/shake&gt;</code> to shake.");
});

test("unknown tags and effect tags with attributes stay escaped text", () => {
  assert.equal(formatDialogueText("<sparkle>hi</sparkle>"), "&lt;sparkle&gt;hi&lt;/sparkle&gt;");
  const xss = formatDialogueText('<shake onmouseover="alert(1)">x</shake>');
  assert.doesNotMatch(xss, /<span[^>]*onmouseover/);
  assert.doesNotMatch(xss, /<shake/);
  assert.match(xss, /&lt;shake onmouseover/);
});

test("effect content stays escaped", () => {
  const result = formatDialogueText('<wave><script>alert(1)</script></wave>');
  assert.equal(result, '<span data-vn-text-fx="wave">&lt;script&gt;alert(1)&lt;/script&gt;</span>');
});

test("the span attribute form accepts catalogue ids only", () => {
  assert.equal(
    formatDialogueText('<span data-vn-text-fx="Wave">la</span>'),
    '<span data-vn-text-fx="wave">la</span>',
  );
  assert.equal(formatDialogueText('<span data-vn-text-fx="x&quot; onclick=alert(1)">la</span>'), "<span>la</span>");
  assert.equal(formatDialogueText("<span data-vn-text-fx='nope' class=\"a\">la</span>"), '<span class="a">la</span>');
});

test("display regex rules can emit effect tags", () => {
  const rules = parseCustomRegexRules("/\\b(magic)\\b/gi => <rainbow>$1</rainbow>");
  assert.equal(
    formatDialogueText("Real Magic here.", rules),
    'Real <span data-vn-text-fx="rainbow">Magic</span> here.',
  );
});

test("effects survive the markdown-stripping presets and forced quotes", () => {
  const result = formatDialogueText("<shake>**No!**</shake>", [], { stripMarkdown: true, forceQuotes: true, hasSpeaker: true });
  assert.equal(result, '"<span data-vn-text-fx="shake">No!</span>"');
});

// ---- Spoken words (markQuotes) ------------------------------------------

const quoted = (text: string, rules: ReturnType<typeof parseCustomRegexRules> = []) =>
  formatDialogueText(text, rules, { markQuotes: true });

test("quotes are only marked when asked", () => {
  assert.equal(formatDialogueText('"Hi," she said.'), '"Hi," she said.');
});

test("every dialogue quote style is wrapped, marks included", () => {
  assert.equal(quoted("「やあ」と彼は言った。"), "<span data-vn-quote>「やあ」</span>と彼は言った。");
  assert.equal(quoted("『静かに』"), "<span data-vn-quote>『静かに』</span>");
  assert.equal(quoted("He said “wait” twice."), "He said <span data-vn-quote>“wait”</span> twice.");
  assert.equal(
    quoted('"Hi," she said. "Bye."'),
    '<span data-vn-quote>"Hi,"</span> she said. <span data-vn-quote>"Bye."</span>',
  );
});

test("narration-only text and unclosed quotes stay narration", () => {
  assert.equal(quoted("The rain went on."), "The rain went on.");
  assert.equal(quoted('He was 5\'11" tall.'), 'He was 5\'11" tall.');
  assert.equal(quoted("「まだ続く"), "「まだ続く");
});

test("other quote marks inside a quote do not end it", () => {
  assert.equal(quoted("「彼は『はい』と言った」"), "<span data-vn-quote>「彼は『はい』と言った」</span>");
  assert.equal(quoted('“A "word" here”'), '<span data-vn-quote>“A "word" here”</span>');
});

test("back-to-back quotes stay separate spans", () => {
  assert.equal(quoted('"A""B"'), '<span data-vn-quote>"A"</span><span data-vn-quote>"B"</span>');
});

test("a quote around effect and markdown tags is one span", () => {
  assert.equal(
    quoted('She yelled "<shout>STOP!</shout>" and ran.'),
    'She yelled <span data-vn-quote>"<span data-vn-text-fx="shout">STOP!</span>"</span> and ran.',
  );
  assert.equal(quoted('"It is **mine**," he said.'), '<span data-vn-quote>"It is <strong>mine</strong>,"</span> he said.');
});

test("a quote inside a tag stays inside it", () => {
  assert.equal(
    quoted('<font color="#4a7c59">"Taking the bait?"</font> you murmur.'),
    '<font color="#4a7c59"><span data-vn-quote>"Taking the bait?"</span></font> you murmur.',
  );
});

test("a quote that crosses a tag boundary is wrapped piece by piece and stays well-formed", () => {
  assert.equal(
    quoted('<em>"Wait</em> here," she said.'),
    '<em><span data-vn-quote>"Wait</span></em><span data-vn-quote> here,"</span> she said.',
  );
  assert.equal(
    quoted('"Hi <em>there" she</em> said.'),
    '<span data-vn-quote>"Hi </span><em><span data-vn-quote>there"</span> she</em> said.',
  );
});

test("quote marks inside inline code are literal", () => {
  assert.equal(quoted('Type `"rm"` then "go".'), 'Type <code>"rm"</code> then <span data-vn-quote>"go"</span>.');
});

test("display regex output is marked too", () => {
  const rules = parseCustomRegexRules('/@@(.+?)@@/g => <font color="#f0a">"$1"</font>');
  assert.equal(quoted("Then @@Run@@ she said.", rules), 'Then <font color="#f0a"><span data-vn-quote>"Run"</span></font> she said.');
});

test("quote marking keeps every character and adds only its own spans", () => {
  const input = 'A <wave>"la</wave> la" and 「b」 `"c"` <font color="red">"d"</font>';
  const plain = (html: string) => html.replace(/<[^>]*>/g, "");
  const before = formatDialogueText(input);
  const after = quoted(input);
  assert.equal(plain(after), plain(before));
  assert.equal(after.replaceAll("<span data-vn-quote>", "").replace(/<\/span>/g, "").length, before.replace(/<\/span>/g, "").length);
  const opened = after.match(/<span data-vn-quote>/g)?.length ?? 0;
  assert.ok(opened >= 3);
  assert.equal((after.match(/<\/span>/g)?.length ?? 0) - (before.match(/<\/span>/g)?.length ?? 0), opened);
});

test("forced quotes mark the whole spoken line", () => {
  assert.equal(
    formatDialogueText("W-What kind?!", [], { forceQuotes: true, hasSpeaker: true, markQuotes: true }),
    '<span data-vn-quote>"W-What kind?!"</span>',
  );
});
