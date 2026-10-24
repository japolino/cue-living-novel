import type { Choice, Paragraph } from "../../shared/contracts.js";
import { escapePanelText, extractPanelSpans, maskPanelSpans, panelHash, MAX_PANELS, MAX_PANEL_HTML, MAX_PANEL_TOTAL, type PanelArtifact, type PanelSpan } from "../../shared/panels.js";
import { nonStoryCard, nonStoryMarkupRanges, PANELS_ONLY_TEXT, structuralLine, type NonStoryBlock } from "./non-story.js";

export type PrepareNarrativeOptions = {
  ignoredTags?: readonly string[];
  /** "Skip non-story blocks": structural cleanup of reasoning, status markup and placeholders (no LLM). */
  skipNonStory?: boolean;
};

export type PreparedNarrative = {
  paragraphs: Paragraph[];
  choices: Choice[];
  panels: PanelArtifact[];
  /** Status lines taken out of the story (skipNonStory); they also fill the "Not story" card. */
  nonStory?: NonStoryBlock[];
  /** Everything the structural pass carded (status lines, status elements as text): the reader finds it in Panels, the planner still reads it. */
  status?: string[];
};

type RawChoice = { id?: string | undefined; label: string; submission: string };

function splitBlocks(content: string): Array<{ sourceIndex: number; text: string }> {
  const blocks: Array<{ sourceIndex: number; text: string }> = [];
  let current: string[] = [];
  let sourceIndex = 0;
  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim()) current.push(line);
    else if (current.length > 0) {
      blocks.push({ sourceIndex, text: current.join("\n") });
      sourceIndex += 1;
      current = [];
    }
  }
  if (current.length > 0) blocks.push({ sourceIndex, text: current.join("\n") });
  return blocks;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]!.toLocaleLowerCase()] = match[2] ?? match[3] ?? "";
  }
  return attributes;
}

function cleanChoiceLine(value: string): string {
  return value.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s*)/, "").trim();
}

function extractChoices(content: string): { text: string; choices: RawChoice[] } {
  const choices: RawChoice[] = [];
  const text = content.replace(/<Choice\b([^>]*)>([\s\S]*?)<\/Choice>/gi, (_match, attributeSource: string, body: string) => {
    const attributes = parseAttributes(attributeSource);
    const nonemptyLines = body.split(/\r?\n/).map(cleanChoiceLine).filter(Boolean);
    const isList = nonemptyLines.length > 1 || /^\s*(?:[-*+]\s+|\d+[.)]\s*)/m.test(body);
    if (isList) {
      for (const line of nonemptyLines) choices.push({ label: line, submission: line });
    } else {
      const label = cleanChoiceLine(body);
      if (label) {
        const rawSubmission = (attributes.value ?? attributes.message ?? attributes.prompt ?? "").trim();
        const isNumeric = /^\s*(?:\d+|choice[_-]?\d+|option\s*\d+)\s*$/i.test(rawSubmission);
        const submission = (rawSubmission && !isNumeric) ? rawSubmission : label;
        choices.push({
          id: attributes.id?.trim() || undefined,
          label,
          submission
        });
      }
    }
    return "\n\n";
  });
  return { text, choices };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripIgnoredTags(content: string, tags: readonly string[]): string {
  let output = content;
  for (const rawTag of tags) {
    const tag = rawTag.trim().replace(/^[<\[]|[>\]]$/g, "").replace(/^\//, "");
    if (!tag) continue;
    const name = escapeRegExp(tag);
    output = output
      .replace(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}>`, "gi"), "")
      .replace(new RegExp(`<\\/?${name}\\b[^>]*>`, "gi"), "")
      .replace(new RegExp(`\\[${name}\\b[^\\]]*\][\\s\\S]*?\\[\\/${name}\\]`, "gi"), "")
      .replace(new RegExp(`\\[\\/?${name}\\b[^\\]]*\]`, "gi"), "");
  }
  return output;
}

// Inline card image tags supported across RisuAI, LumiRealm, and custom card formats:
// - Direct assignments: `<img="name">`, `<pimg="name">`, `<img=name>`, `<pimg=name>`
// - Attributes: `<img cmd="name">`, `<img src="name">`, `<pimg cmd="name">`, `<pimg src="name">`
//   Supports double/single/curly quotes or unquoted, with extra attributes and whitespace.
// - CBS/Risu macro tokens: `{{img::name}}`
const INLINE_IMG_REGEX =
  /<p?img\s*=\s*["'“”][^"'“”]+["'“”]\s*\/?>|<p?img\s*=\s*[^\s"'“”>][^\s>]*?[\s>]|<p?img\b[^>]*?\b(?:cmd|src)\s*=\s*["'“”][^"'“”]+["'“”][^>]*?\/?>|<p?img\b[^>]*?\b(?:cmd|src)\s*=\s*[^\s"'“”>]+[^>]*?\/?>|\{\{img::[^\}]+\}\}/gi;

/** Extract the referenced asset/expression name from any supported inline image tag. */
export function extractTagAssetName(tag: string): string {
  const direct =
    tag.match(/^<p?img\s*=\s*["'“”]([^"'“”]+)["'“”]\s*\/?>/i) ||
    tag.match(/^<p?img\s*=\s*([^\s"'“”>][^\s>]*?)[\s>]/i);
  if (direct?.[1]) return direct[1].trim();

  const macro = tag.match(/^\{\{img::([^\}]+)\}\}/i);
  if (macro?.[1]) return macro[1].trim();

  // For attribute-based tags, prefer `cmd` (the card expression/costume command) over `src`
  const cmd =
    tag.match(/\bcmd\s*=\s*["'“”]([^"'“”]+)["'“”]/i) ||
    tag.match(/\bcmd\s*=\s*([^\s"'“”>]+)/i);
  if (cmd?.[1]) return cmd[1].trim();

  const src =
    tag.match(/\bsrc\s*=\s*["'“”]([^"'“”]+)["'“”]/i) ||
    tag.match(/\bsrc\s*=\s*([^\s"'“”>]+)/i);
  if (src?.[1]) return src[1].trim();

  return "";
}

/**
 * Extract inline card asset references like `<img cmd="asset_name">`, `<img="asset_name">`,
 * `<pimg="asset_name">` (RisuAI/LumiRealm), `<img src="asset_name">`, or `{{img::asset_name}}`.
 */
export function extractInlineCardImages(text: string): { text: string; assetNames: string[] } {
  const assetNames: string[] = [];
  const cleaned = text.replace(INLINE_IMG_REGEX, (match) => {
    const name = extractTagAssetName(match);
    if (name) assetNames.push(name);
    return "";
  });
  return { text: cleaned, assetNames };
}

/**
 * Extract inline card asset references along with their target paragraphIndex in the plan.
 */
export function extractInlineCardImagesWithParagraphs(
  content: string,
  paragraphs: readonly Paragraph[],
): Array<{ name: string; paragraphIndex: number }> {
  const blocks = splitBlocks(content);
  const sourceToPara = new Map<number, number>();
  for (const paragraph of paragraphs) {
    sourceToPara.set(paragraph.sourceIndex, paragraph.index);
  }

  const results: Array<{ name: string; paragraphIndex: number }> = [];
  let lastKnownParaIndex = 0;
  let sawParagraph = false;

  for (const block of blocks) {
    const mapped = sourceToPara.get(block.sourceIndex);
    if (mapped !== undefined) {
      lastKnownParaIndex = mapped;
      sawParagraph = true;
    }

    const matches = [...block.text.matchAll(INLINE_IMG_REGEX)];
    if (matches.length === 0) continue;

    // An inline image marker depicts the preceding paragraph (the dialogue or
    // narration line it annotates). If the block produced no visible paragraph
    // (e.g. a standalone `<img=...>` line), fall back to the last paragraph we
    // have seen, which is still the line the expression belongs to.
    const paragraphIndex = sawParagraph ? lastKnownParaIndex : 0;

    for (const match of matches) {
      const name = extractTagAssetName(match[0]);
      if (name) {
        results.push({ name, paragraphIndex });
      }
    }
  }

  return results;
}

function cleanNarrativeBlock(block: string): string {
  // Strip caption pipes like | <"😏:caption"> or | <'caption'>
  let text = block.replace(/\|\s*<[^>]+>/g, "");

  // Strip inline card expression tags so they don't count as narrative lines
  const { text: withoutInlineImages } = extractInlineCardImages(text);
  return withoutInlineImages
    .replace(/CARDDATA:.*$/gim, "")
    .replace(/<Update Log\b[\s\S]*?<\/Update Log>/gi, "")
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\s*\|\s*$/.test(trimmed)) return false;
      return !/^\[(?:Date|FLOOR|RESERVEDFLOOR)\s*:/i.test(trimmed)
        && !/^<\s*(?:suggestion|scene\s+seed=|check)\b/i.test(trimmed);
    })
    .join("\n")
    .trim();
}

function stableChoiceId(label: string, index: number): string {
  let hash = 0x811c9dc5;
  const source = `${index}\0${label}`;
  for (let offset = 0; offset < source.length; offset += 1) {
    hash ^= source.charCodeAt(offset);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `choice-${hash.toString(16).padStart(8, "0")}`;
}

export function prepareNarrative(content: string, options: PrepareNarrativeOptions = {}): PreparedNarrative {
  content = content.replace(/\r\n?/g, "\n");
  const spans: PanelSpan[] = extractPanelSpans(content);
  const hidden: Array<{ start: number; end: number }> = [];
  for (const raw of options.ignoredTags ?? []) {
    const tag = raw.trim().replace(/^[<\[]|[>\]]$/g, "").replace(/^\//, "");
    if (!tag) continue;
    const name = escapeRegExp(tag);
    const pattern = new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}\\s*>|<\\/?${name}\\b[^>]*>|\\[${name}\\b[^\\]]*\\][\\s\\S]*?\\[\\/${name}\\]|\\[\\/?${name}\\b[^\\]]*\\]`, "gi");
    for (const match of content.matchAll(pattern)) {
      const range = { start: match.index, end: match.index + match[0].length };
      hidden.push(range);
      const nestedCards = spans.filter((span) => span.start < range.end && range.start < span.end);
      for (const card of nestedCards) spans.splice(spans.indexOf(card), 1);
      // Reasoning/private metadata is not a status-card source.
      if (/^(?:status|stats|inventory|hero|world_voice|tracker)$/i.test(tag)
        && match[0].length < MAX_PANEL_HTML / 6 && spans.length < MAX_PANELS) {
        spans.push({ ...range, html: nestedCards.length ? nestedCards.map((card) => card.html).join("\n") : `<pre>${escapePanelText(match[0])}</pre>`, title: tag, followKey: `tag:${tag.toLowerCase()}` });
      }
    }
  }
  const status: Array<{ at: number; text: string }> = [];
  const removedMarkup: Array<{ start: number; end: number }> = [];
  if (options.skipNonStory) {
    for (const range of nonStoryMarkupRanges(content)) {
      // A complete HTML block is already a Panels card; markup inside it stays there.
      if (spans.some((span) => span.start <= range.start && range.end <= span.end)) continue;
      hidden.push(range);
      removedMarkup.push(range);
      const nested = spans.filter((span) => span.start < range.end && range.start < span.end);
      for (const card of nested) spans.splice(spans.indexOf(card), 1);
      if (range.card) status.push({ at: range.start, text: content.slice(range.start, range.end).replace(/<[^>]*>/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim() });
      if (range.card && range.end - range.start < MAX_PANEL_HTML / 6 && spans.length < MAX_PANELS) {
        spans.push({ ...range, html: nested.length ? nested.map((card) => card.html).join("\n") : `<pre>${escapePanelText(content.slice(range.start, range.end))}</pre>`, title: range.card, followKey: `tag:${range.card}` });
      }
    }
  }
  // Multiple entities using the same marker cannot safely share a following pin.
  for (const span of spans) if (span.followKey && spans.filter((other) => other.followKey === span.followKey).length > 1) {
    const key = span.followKey;
    for (const other of spans) if (other.followKey === key) delete other.followKey;
  }
  let total = 0;
  const retained = spans.filter((span) => { if (span.html.length > MAX_PANEL_HTML || total + span.html.length > MAX_PANEL_TOTAL) return false; total += span.html.length; return true; });
  spans.splice(0, spans.length, ...retained);
  const masked = maskPanelSpans(content, [...spans, ...hidden]);
  const paragraphs: Paragraph[] = [];
  const rawChoices: RawChoice[] = [];
  const paragraphEnds: number[] = [];
  const nonStory: NonStoryBlock[] = [];
  let inFence = false;
  let offset = 0;
  for (const block of splitBlocks(content)) {
    const start = content.indexOf(block.text, offset);
    offset = start + block.text.length;
    const extracted = extractChoices(masked.slice(start, offset));
    rawChoices.push(...extracted.choices);
    let text = cleanNarrativeBlock(stripIgnoredTags(extracted.text, options.ignoredTags ?? []));
    if (options.skipNonStory && text) {
      // Markup removed inside a line leaves masking spaces behind.
      const touched = removedMarkup.some((range) => range.start < offset && start < range.end);
      // Code fences (which can span blocks) are shown as written.
      const lines = text.split("\n").map((line) => {
        const fence = /^\s*```/.test(line);
        if (fence) inFence = !inFence;
        return fence || inFence ? { text: line } : structuralLine(touched ? line.replace(/[ \t]{2,}/g, " ").trim() : line);
      });
      const skipped = lines.filter((line) => line.skip === "status").map((line) => line.text);
      if (skipped.length) {
        nonStory.push({ at: paragraphs.length, text: skipped.join("\n") });
        status.push({ at: start, text: skipped.join("\n") });
      }
      text = lines.filter((line) => !line.skip).map((line) => line.text).join("\n");
    }
    if (text) {
      paragraphs.push({ index: paragraphs.length, sourceIndex: block.sourceIndex, text });
      paragraphEnds.push(offset);
    }
  }
  // Structural cleanup never leaves a reply unrevealable: with nothing left, plan it as before.
  if (options.skipNonStory && !paragraphs.length && !spans.length && !nonStory.length) return prepareNarrative(content, { ...options, skipNonStory: false });
  if (!paragraphs.length && (spans.length || nonStory.length)) paragraphs.push({ index: 0, sourceIndex: 0, text: PANELS_ONLY_TEXT });
  const panels = spans.sort((a, b) => a.start - b.start).slice(0, MAX_PANELS).map((span, index): PanelArtifact => ({
    id: `panel-${index}-${panelHash(span.html)}`,
    title: span.title,
    html: span.html,
    paragraphIndex: Math.min(Math.max(0, paragraphs.length - 1), paragraphEnds.filter((end) => end <= span.start).length),
    ...(span.followKey ? { followKey: span.followKey } : {}),
  }));
  const card = nonStoryCard(nonStory, (at) => Math.min(at, Math.max(0, paragraphs.length - 1)));
  if (card && panels.length < MAX_PANELS) panels.push(card);
  const unlocksAfterParagraph = Math.max(0, paragraphs.length - 1);
  const usedIds = new Set<string>();
  const choices = rawChoices.map((choice, index): Choice => {
    const baseId = choice.id || stableChoiceId(choice.label, index);
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    return { id, label: choice.label, submission: choice.submission, source: "authored", unlocksAfterParagraph };
  });
  return { paragraphs, choices, panels, ...(options.skipNonStory ? { nonStory, status: status.sort((a, b) => a.at - b.at).map((entry) => entry.text).filter(Boolean) } : {}) };
}
