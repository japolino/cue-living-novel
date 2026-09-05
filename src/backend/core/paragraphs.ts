import type { Choice, Paragraph } from "../../shared/contracts.js";
import { escapePanelText, extractPanelSpans, maskPanelSpans, panelHash, MAX_PANELS, MAX_PANEL_HTML, MAX_PANEL_TOTAL, type PanelArtifact, type PanelSpan } from "../../shared/panels.js";

export type PrepareNarrativeOptions = {
  ignoredTags?: readonly string[];
};

export type PreparedNarrative = {
  paragraphs: Paragraph[];
  choices: Choice[];
  panels: PanelArtifact[];
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

const INLINE_IMG_REGEX = /<img\s*=\s*["']([^"']+)["']\s*\/?>|<img\s*=\s*([^\s"'>][^\s>]*?)[\s>]|<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*?\/?>|\{\{img::([^\}]+)\}\}/gi;

/**
 * Extract inline card asset references like `<img="asset_name">`,
 * `<img src="asset_name">`, or `{{img::asset_name}}`.
 */
export function extractInlineCardImages(text: string): { text: string; assetNames: string[] } {
  const assetNames: string[] = [];
  const cleaned = text.replace(INLINE_IMG_REGEX, (_match, p1, p2, p3, p4) => {
    const name = (p1 || p2 || p3 || p4 || "").trim();
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
      const name = (match[1] || match[2] || match[3] || match[4] || "").trim();
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
  let offset = 0;
  for (const block of splitBlocks(content)) {
    const start = content.indexOf(block.text, offset);
    offset = start + block.text.length;
    const extracted = extractChoices(masked.slice(start, offset));
    rawChoices.push(...extracted.choices);
    const text = cleanNarrativeBlock(stripIgnoredTags(extracted.text, options.ignoredTags ?? []));
    if (text) {
      paragraphs.push({ index: paragraphs.length, sourceIndex: block.sourceIndex, text });
      paragraphEnds.push(offset);
    }
  }
  if (!paragraphs.length && spans.length) paragraphs.push({ index: 0, sourceIndex: 0, text: "A new panel is available in Panels." });
  const panels = spans.sort((a, b) => a.start - b.start).slice(0, MAX_PANELS).map((span, index): PanelArtifact => ({
    id: `panel-${index}-${panelHash(span.html)}`,
    title: span.title,
    html: span.html,
    paragraphIndex: Math.min(Math.max(0, paragraphs.length - 1), paragraphEnds.filter((end) => end <= span.start).length),
    ...(span.followKey ? { followKey: span.followKey } : {}),
  }));
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
  return { paragraphs, choices, panels };
}
