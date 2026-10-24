import type { Paragraph } from "../../shared/contracts.js";
import { codeRanges, escapePanelText, MAX_PANEL_HTML, MAX_PANELS, type PanelArtifact } from "../../shared/panels.js";
import { STAGE_INLINE_TAGS } from "../../shared/stage-markup.js";
import { TEXT_EFFECT_TAG_PATTERN } from "../../shared/text-effects.js";

/*
 * "Skip non-story blocks": structural rules (no LLM) plus the K/S line check
 * shared with Choir. Everything here is pure; the LLM call and its cache live
 * in runtime/story-check.ts.
 */

/** Reasoning and interface elements: removed with their content, never shown. */
export const NON_STORY_DROP_TAG = /^(?:think|thinking|reasoning|analysis|redacted_thinking|script|style|canvas|input|button|select|textarea|option|progress|meter|nav|form|dialog|(?:loom|tool|function)(?:[_-][\w-]+)?)$/i;
/** Status elements: removed from the story, kept as a plain-text Panels card. */
export const NON_STORY_CARD_TAG = /^(?:tracker|stats|status|state|ext_tracker(?:[_-][\w-]+)?)$/i;
const REASONING_TAG = /^(?:think|thinking|reasoning|analysis|redacted_thinking)$/i;
/** HTML void elements: never open, so `<input>` covers only itself. */
const VOID_TAG = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

export type MarkupRange = { start: number; end: number; card?: string };

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    result[match[1]!.toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? "").toLowerCase();
  }
  return result;
}

/**
 * Character ranges of non-story markup in a message: comments, reasoning and
 * interface elements, status elements (with the card title), and elements an
 * author hid or marked as a tracker/HUD (Choir's attribute rules). A closing
 * reasoning tag without an opener ends a reasoning preamble that starts the
 * message. An unclosed element that starts a line covers its block (up to a
 * blank line); one inside prose covers only its own tag. Markup inside fenced
 * or inline code is text and stays.
 */
export function nonStoryMarkupRanges(content: string): MarkupRange[] {
  const ranges: MarkupRange[] = [];
  const code = codeRanges(content, true);
  const inCode = (at: number) => code.some((range) => range.start <= at && at < range.end);
  for (const match of content.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) if (!inCode(match.index)) ranges.push({ start: match.index, end: match.index + match[0].length });
  const tag = /<(\/?)([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  const open: Array<{ name: string; start: number; end: number; attrs: string }> = [];
  let match: RegExpExecArray | null;
  let firstOpenReasoning = Infinity;
  while ((match = tag.exec(content))) {
    const [whole, slash, rawName, attrText] = match;
    if (inCode(match.index)) continue;
    const name = rawName!.toLowerCase();
    if (!slash) {
      if (REASONING_TAG.test(name)) firstOpenReasoning = Math.min(firstOpenReasoning, match.index);
      if (VOID_TAG.test(name) || /\/\s*$/.test(attrText ?? "")) {
        if (NON_STORY_DROP_TAG.test(name)) ranges.push({ start: match.index, end: match.index + whole.length });
      } else {
        open.push({ name, start: match.index, end: match.index + whole.length, attrs: attrText ?? "" });
      }
      continue;
    }
    if (REASONING_TAG.test(name) && match.index < firstOpenReasoning) {
      ranges.push({ start: 0, end: match.index + whole.length });
      continue;
    }
    const at = open.map((entry) => entry.name).lastIndexOf(name);
    if (at < 0) continue;
    const element = open[at]!;
    open.length = at;
    const range = { start: element.start, end: match.index + whole.length };
    const attrs = attributes(element.attrs);
    const identity = `${attrs.class ?? ""} ${attrs.id ?? ""}`;
    if (NON_STORY_DROP_TAG.test(name)) ranges.push(range);
    else if (NON_STORY_CARD_TAG.test(name) || /\b(?:tracker|stats|status-panel|hud)\b/.test(identity)) ranges.push({ ...range, card: name });
    else if ("hidden" in attrs || attrs["aria-hidden"] === "true" || /^(?:status|alert|navigation|toolbar|menu|menubar|dialog|alertdialog|progressbar)$/.test(attrs.role ?? "")
      || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/.test(attrs.style ?? "")) ranges.push(range);
  }
  for (const element of open) {
    if (!NON_STORY_DROP_TAG.test(element.name) && !NON_STORY_CARD_TAG.test(element.name)) continue;
    const startsLine = !content.slice(content.lastIndexOf("\n", element.start - 1) + 1, element.start).trim();
    if (!startsLine) {
      ranges.push({ start: element.start, end: element.end });
      continue;
    }
    const blank = content.slice(element.start).search(/\n[ \t]*\n/);
    ranges.push({ start: element.start, end: blank < 0 ? content.length : element.start + blank, ...(NON_STORY_CARD_TAG.test(element.name) ? { card: element.name } : {}) });
  }
  // Outermost ranges only: a status element inside a dropped one is dropped.
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  return ranges.filter((range, index) => !ranges.slice(0, index).some((outer) => outer.start <= range.start && range.end <= outer.end));
}

const BRACKETED_ONLY = /^[*_]*(?:(?:\[[^\]\n]*\]|【[^】\n]*】|〔[^〕\n]*〕)\s*)+[*_]*$/;
/** Field syntax (`Mood: tired`, `a | b`, `HP=3`): a bracketed line without it may be a sound or an action, so the check decides. */
const FIELD_SYNTAX = /[:|=：]/;
/** `[Mood: tired | Trust: 40%]` or `<Hero: Jay | Level: 1>` inside a line. */
const PIPE_BRACKET = /\[[^\]\n]*\|[^\]\n]*\]|<[^<>\n]*\|[^<>\n]*>/g;
const BRACED_FIELDS = /^[*_]*\{[^{}\n]*[|=:][^{}\n]*\}[*_]*$/;
const PLACEHOLDER_ONLY = /^(?:INLAY\[[^\]\n]*\]|\{\{[^{}\n]*\}\}|\s)+$/i;
const RULE_ONLY = /^[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬+|=_~*\-\s]{3,}$/;
/** An HTML tag: a name, then attributes in HTML syntax (`<Incoming call: Mom>` is not one). */
const TAG = /<\/?([a-z][\w:-]*)(?:\s+[a-z_:@][\w:.-]*(?<!:)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/gi;
const EFFECT_TAG = new RegExp(`^${TEXT_EFFECT_TAG_PATTERN.source}$`, "i");
/** `<Kai>`, `<sigh>`: a name alone in angle brackets, no attributes. */
const BARE_TAG = /^<([a-z][\w-]*)>$/i;

function inlineCode(line: string): Array<{ start: number; end: number }> {
  return [...line.matchAll(/`[^`\n]*`/g)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

const inside = (ranges: ReadonlyArray<{ start: number; end: number }>, at: number) => ranges.some((range) => range.start <= at && at < range.end);

/** The words of a line, to classify it: every tag removed (`<br>` as a space), inline code kept. */
export function plainLine(line: string): string {
  const code = inlineCode(line);
  return line.replace(TAG, (tag: string, _name: string, offset: number) => inside(code, offset) ? tag : /^<br\b/i.test(tag) ? " " : "")
    .replace(/\s+/g, " ").trim();
}

/**
 * A story line as the stage should get it: markup the stage cannot render is
 * removed; stage tags (font, span, ruby, br, ...), text-effect tags and inline
 * code stay byte for byte. In a line with words, a bare `<Name>` that is never
 * closed is text (a chat speaker `<Kai> are u coming`, an emote `*<sigh>*`).
 * Unchanged lines come back as they were.
 */
function storyText(line: string, words: boolean): string {
  const code = inlineCode(line);
  const lower = line.toLowerCase();
  let removed = false;
  const text = line.replace(TAG, (tag: string, name: string, offset: number) => {
    if (inside(code, offset) || EFFECT_TAG.test(tag) || STAGE_INLINE_TAGS.has(name.toLowerCase())) return tag;
    if (words && BARE_TAG.test(tag) && !lower.includes(`</${name.toLowerCase()}>`)) return tag;
    removed = true;
    return "";
  });
  return removed ? text.replace(/[ \t]{2,}/g, " ").trim() : line;
}

export type StructuralLine = { text: string; skip?: "status" | "markup" };

/**
 * One cleaned paragraph line, or why it is not story. `status` lines (bracketed
 * or braced fields) go to the "Not story" card; `markup` lines (placeholders,
 * rules, tags with nothing to show) are dropped. Lines are classified by their
 * words (`plainLine`); a story line keeps its own text except for markup the
 * stage cannot render.
 */
export function structuralLine(line: string): StructuralLine {
  const trimmed = line.trim();
  if (PLACEHOLDER_ONLY.test(trimmed) || RULE_ONLY.test(trimmed)) return { skip: "markup", text: trimmed };
  const plain = plainLine(trimmed);
  if (!plain) {
    // Tags only: stage markup (an effect or a <font> spanning the next lines) stays.
    const kept = storyText(line, false);
    return kept.trim() ? { text: kept } : { skip: "markup", text: trimmed };
  }
  if ((BRACKETED_ONLY.test(plain) && FIELD_SYNTAX.test(plain)) || BRACED_FIELDS.test(plain)) return { skip: "status", text: plain };
  const story = storyText(line, true);
  const unpiped = story.replace(PIPE_BRACKET, "");
  const text = unpiped === story ? story : unpiped.replace(/[ \t]{2,}/g, " ").trim();
  if (!plainLine(text) || PLACEHOLDER_ONLY.test(text)) return { skip: "status", text: plain };
  return { text };
}

/*
 * The K/S line check. SYSTEM text and parsing are Choir 1.1.6's frozen
 * skip-bench winner (src/core.js SKIP_CHECK_SYSTEM / parseSkipRows); keep the
 * prompt verbatim, it was measured as is. Bump STORY_CHECK_VERSION whenever the
 * prompt, the line preparation or the structural rules change: it keys the cache.
 */
export const STORY_CHECK_VERSION = 2;
export const STORY_CHECK_SYSTEM = `You clean AI roleplay replies for an audiobook that reads only the STORY.
Label every numbered line of the reply: K = story, S = not story (skip).
S: model reasoning/planning, checklists, word counts, writing rules, recaps/summaries, setting checks, final reviews,
trackers/status panels/HUD (date/time/location stamps, stats, attire lists, relationship meters, threads),
character profile/sheet entries, choice menus offered to the user, OOC/author notes, commentary addressed to the user,
credits, settings, banners, image placeholders/markup codes, game logs, counters, hidden spoiler sections,
and the headers/labels of such blocks. A meta block stays S even if it quotes dialogue.
K: narration, dialogue, thoughts, sound effects, and in-world text that characters see, write, send or read in the scene
(letters, texts, chat/stream comments, forms, signs, songs). Prose containing a colon is still K.
When unsure, use K: cutting story is much worse than reading a meta line.

Example 1 lines:
0: Mira pushed the door open. Rain dripped from her coat.
1: "You're late," Tom said.
2: [Status] Day 3 | 21:40 | Harbor Inn
3: Mira — Mood: tired | Trust: 40%
4: What will you do?
5: - Ask about the letter
Example 1 answer: 
0 K
1 K
2 S
3 S
4 S
5 S
Example 2 lines:
0: Okay, I need to show her fear first, then the reveal. Keep it under 400 words.
1: The note on the table read: MEET ME AT THE PIER.
2: Kai: are u coming or not
3: She typed back with shaking fingers.
Example 2 answer: 
0 S
1 K
2 K
3 K

Answer with one row per line, nothing else: the line number, a space, then K or S. Example:
0 K
1 S`;

/** Text the check sees for a line: display markup removed, as in Choir's transcript lines. */
export function storyCheckText(line: string): string {
  return plainLine(line.replace(new RegExp(TEXT_EFFECT_TAG_PATTERN.source, "gi"), "")).replace(/[*`]/g, "").replace(/^\s*#{1,6}\s+/, "").replace(/\s+/g, " ").trim();
}

/** `width` shortens every line; a retry with line heads gets past some providers' content blocks. */
export function storyCheckMessages(lines: readonly string[], width = 160): Array<{ role: "system" | "user"; content: string }> {
  const numbered = lines.map((line, index) => `${index}: ${Array.from(line).slice(0, width).join("")}`).join("\n");
  return [
    { role: "system", content: STORY_CHECK_SYSTEM },
    { role: "user", content: `Reply to label (${lines.length} lines):\n${numbered}\n\nReturn exactly ${lines.length} labels.` },
  ];
}

/** Rows are `index K|S`; missing rows stay story. Null when the answer has no rows at all. */
export function parseStoryLabels(text: string, count: number): string | null {
  const labels: string[] = Array(count).fill("K");
  let rows = 0;
  for (const [, index, label] of String(text || "").matchAll(/^\D{0,3}(\d+)\s*[:=\-]?\s*\W{0,2}([KSks])\b/gm)) {
    if (Number(index) < count) {
      labels[Number(index)] = label!.toUpperCase();
      rows += 1;
    }
  }
  return rows ? labels.join("") : null;
}

/** Cache key of one check: the exact lines it labels plus the method version. */
export function storyCheckKey(lines: readonly string[]): string {
  const source = `${STORY_CHECK_VERSION}\0${lines.join("\n")}`;
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

/** Every line of every paragraph the check labels, in order, as the check sees it (not Cue's Panels pointer). */
export function storyLines(paragraphs: readonly Paragraph[]): string[] {
  return paragraphs.filter((paragraph) => paragraph.text !== PANELS_ONLY_TEXT)
    .flatMap((paragraph) => paragraph.text.split("\n").map(storyCheckText).filter(Boolean));
}

/** The paragraph shown for a reply whose whole text went to Panels. */
export const PANELS_ONLY_TEXT = "A new panel is available in Panels.";
export const NON_STORY_CARD_TITLE = "Not story";
export const NON_STORY_FOLLOW_KEY = "nonstory";

/** Text taken out of the story; `at` is the paragraph index (before re-indexing) it sat at or before. */
export type NonStoryBlock = { at: number; text: string };

/**
 * The plain-text card that keeps skipped status/meta lines readable in Panels,
 * unlocked at the first paragraph that follows them. `paragraphFor` maps a
 * block position to a paragraph index of the final narrative.
 */
export function nonStoryCard(blocks: readonly NonStoryBlock[], paragraphFor: (at: number) => number): PanelArtifact | null {
  const used = blocks.filter((block) => block.text.trim());
  if (!used.length) return null;
  const text = used.map((block) => block.text).join("\n\n");
  const html = `<pre>${escapePanelText(text)}</pre>`;
  if (html.length > MAX_PANEL_HTML) return null;
  return {
    id: `panel-nonstory-${storyCheckKey([text])}`,
    title: NON_STORY_CARD_TITLE,
    html,
    paragraphIndex: paragraphFor(Math.min(...used.map((block) => block.at))),
    followKey: NON_STORY_FOLLOW_KEY,
  };
}

type CheckedNarrative = {
  paragraphs: Paragraph[];
  panels: PanelArtifact[];
  choices: Array<{ unlocksAfterParagraph: number }>;
  nonStory?: NonStoryBlock[];
};

/**
 * Drop the lines labelled S from the paragraphs (labels follow storyLines'
 * order). Emptied paragraphs disappear and the rest are re-indexed; panels and
 * choices follow, and the skipped lines join the "Not story" card. A reply
 * with no story at all (a refusal, an OOC answer) is shown as one short
 * pointer to that card, as a panel-only reply already is.
 */
export type CheckedParagraphs = {
  /** Lines removed. */
  skipped: number;
  /** For every paragraph index before the check: the index of the paragraph that now takes its place (itself or the next one kept). */
  paragraphMap: number[];
  /** Paragraph indexes (before the check) that no longer exist. */
  removedParagraphs: number[];
};

export function applyStoryLabels<T extends CheckedNarrative>(narrative: T, labels: string): T & CheckedParagraphs {
  let lineIndex = 0;
  let skipped = 0;
  const blocks: NonStoryBlock[] = [];
  const kept: Paragraph[] = [];
  const newIndex = new Map<number, number>();
  for (const paragraph of narrative.paragraphs) {
    const keep: string[] = [];
    let current: NonStoryBlock | null = null;
    let labelled = 0;
    let story = 0;
    const lines = paragraph.text === PANELS_ONLY_TEXT ? [] : paragraph.text.split("\n");
    for (const line of lines) {
      const text = storyCheckText(line);
      // A line the check never saw (a lone effect tag, a code fence) stays with its paragraph.
      if (!text) {
        keep.push(line);
        continue;
      }
      labelled += 1;
      if (labels[lineIndex++] === "S") {
        skipped += 1;
        if (current) current.text += `\n${text}`;
        else blocks.push(current = { at: paragraph.index, text });
      } else {
        current = null;
        story += 1;
        keep.push(line);
      }
    }
    if (!lines.length) keep.push(paragraph.text);
    // A paragraph survives with at least one story line, or when the check saw none of it.
    if (story || !labelled) {
      newIndex.set(paragraph.index, kept.length);
      kept.push({ ...paragraph, index: kept.length, text: keep.join("\n") });
    }
  }
  if (!skipped) return { ...narrative, skipped: 0, paragraphMap: narrative.paragraphs.map((paragraph) => paragraph.index), removedParagraphs: [] };
  const removedParagraphs = narrative.paragraphs.filter((paragraph) => !newIndex.has(paragraph.index)).map((paragraph) => paragraph.index);
  if (!kept.length) {
    newIndex.set(narrative.paragraphs[0]!.index, 0);
    kept.push({ index: 0, sourceIndex: narrative.paragraphs[0]!.sourceIndex, text: PANELS_ONLY_TEXT });
  }
  // A panel, card or choice tied to a removed paragraph moves to the next paragraph that stays.
  const remap = (index: number) => {
    for (let old = index; old < narrative.paragraphs.length; old += 1) {
      const mapped = newIndex.get(old);
      if (mapped !== undefined) return mapped;
    }
    return kept.length - 1;
  };
  const panels = narrative.panels.filter((panel) => panel.followKey !== NON_STORY_FOLLOW_KEY)
    .map((panel) => ({ ...panel, paragraphIndex: remap(panel.paragraphIndex) }));
  const nonStory = [...(narrative.nonStory ?? []), ...blocks].sort((a, b) => a.at - b.at);
  const card = nonStoryCard(nonStory, remap);
  if (card && panels.length < MAX_PANELS) panels.push(card);
  return {
    ...narrative,
    paragraphs: kept,
    panels,
    nonStory,
    choices: narrative.choices.map((choice) => ({ ...choice, unlocksAfterParagraph: kept.length - 1 })),
    skipped,
    paragraphMap: narrative.paragraphs.map((paragraph) => remap(paragraph.index)),
    removedParagraphs,
  };
}
