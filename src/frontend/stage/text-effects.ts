/**
 * DOM decoration for inline dialogue text effects.
 *
 * `formatDialogueText` emits `<span data-vn-text-fx="<id>">` wrappers;
 * `applyTextEffects` then prepares them in place so CSS can animate them:
 *
 * - Effects that move or colour single letters (see SPLIT_EFFECTS) have
 *   their text split into words and letters:
 *     <span data-vn-text-fx-word>            (white-space: nowrap)
 *       <span data-vn-text-fx-ch style="--vn-ch: 3">L</span>...
 *     </span>
 *   Whitespace stays as plain text between words, so lines still break
 *   between words and never inside one. `--vn-ch` is the letter index,
 *   counted across the outermost split effect (nested effects continue the
 *   count), and drives staggered animation.
 * - Whole-span effects (glow, whisper) are CSS only and keep their text.
 * - A split effect that touches a word outside it (`"<shout>STOP!</shout>"`)
 *   is wrapped with those word fragments in a nowrap glue span, so the line
 *   never breaks between the quote and the first letter.
 *
 * Guarantees: idempotent (already split text is never split again); every
 * visible character stays in a text node and no character is added or
 * removed (the stage typewriter empties all text nodes and refills them one
 * character at a time); letters are grapheme clusters (emoji, combining
 * marks, and flags stay whole); the work is capped per effect and per call,
 * and text past a cap stays plain inside its effect span.
 *
 * Works in any container (stage dialogue, backlog, settings reference card);
 * it uses only basic DOM node APIs.
 */
import { TEXT_EFFECT_ATTRIBUTE, isTextEffectId, type TextEffectId } from "../../shared/text-effects.js";

/** Effects whose text is split into letter spans. */
export const SPLIT_TEXT_EFFECTS: ReadonlySet<TextEffectId> = new Set<TextEffectId>([
  "shake",
  "tremble",
  "wave",
  "bounce",
  "rainbow",
  "pulse",
  "glitch",
  "shout",
  "fade",
]);

/** Letters split per outermost effect span; the rest stays plain text. */
export const MAX_TEXT_EFFECT_LETTERS_PER_SPAN = 240;
/** Letters split per `applyTextEffects` call (all spans together). */
export const MAX_TEXT_EFFECT_LETTERS_PER_CALL = 2400;

export const TEXT_EFFECT_WORD_ATTRIBUTE = "data-vn-text-fx-word";
export const TEXT_EFFECT_LETTER_ATTRIBUTE = "data-vn-text-fx-ch";
export const TEXT_EFFECT_GLUE_ATTRIBUTE = "data-vn-text-fx-glue";
/** CSS custom property with the letter index. */
export const TEXT_EFFECT_INDEX_PROPERTY = "--vn-ch";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

type DomNode = Node;

type Segmenter = { segment(input: string): Iterable<{ segment: string }> };
let cachedSegmenter: Segmenter | null | undefined;

function graphemeSegmenter(): Segmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  const IntlWithSegmenter = Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => Segmenter;
  };
  try {
    cachedSegmenter = typeof IntlWithSegmenter.Segmenter === "function"
      ? new IntlWithSegmenter.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

// Fallback joiners: combining marks, variation selectors, ZWJ sequences,
// emoji modifiers, and tag characters attach to the previous code point.
const JOINS_PREVIOUS = /^(?:\p{M}|[\u200d\ufe00-\ufe0f]|\u{1f3fb}|\u{1f3fc}|\u{1f3fd}|\u{1f3fe}|\u{1f3ff}|[\u{e0020}-\u{e007f}])$/u;
const REGIONAL_INDICATOR = /^[\u{1f1e6}-\u{1f1ff}]$/u;

/** Split text into user-perceived characters (grapheme clusters). */
export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  const segmenter = graphemeSegmenter();
  if (segmenter) return Array.from(segmenter.segment(text), (part) => part.segment);
  return splitGraphemesFallback(text);
}

/**
 * Approximate grapheme split for engines without Intl.Segmenter: keeps
 * combining marks, variation selectors, ZWJ emoji, skin tones, tag
 * sequences, and flag pairs whole.
 */
export function splitGraphemesFallback(text: string): string[] {
  const out: string[] = [];
  let joinNext = false;
  let pendingFlag = false;
  for (const codePoint of Array.from(text)) {
    const last = out.length - 1;
    if (last >= 0 && (joinNext || JOINS_PREVIOUS.test(codePoint))) {
      out[last] += codePoint;
      joinNext = codePoint === "\u200d";
      continue;
    }
    if (last >= 0 && pendingFlag && REGIONAL_INDICATOR.test(codePoint)) {
      out[last] += codePoint;
      pendingFlag = false;
      continue;
    }
    out.push(codePoint);
    joinNext = false;
    pendingFlag = REGIONAL_INDICATOR.test(codePoint);
  }
  return out;
}

const WHITESPACE = /^\s+$/u;

function isElement(node: DomNode): node is Element {
  return node.nodeType === ELEMENT_NODE;
}

function effectIdOf(node: DomNode): TextEffectId | null {
  if (!isElement(node)) return null;
  const id = node.getAttribute(TEXT_EFFECT_ATTRIBUTE);
  return isTextEffectId(id) ? id : null;
}

function isSplitEffect(node: DomNode): boolean {
  const id = effectIdOf(node);
  return id !== null && SPLIT_TEXT_EFFECTS.has(id);
}

function isDecoration(node: DomNode): boolean {
  return isElement(node)
    && (node.hasAttribute(TEXT_EFFECT_LETTER_ATTRIBUTE) || node.hasAttribute(TEXT_EFFECT_WORD_ATTRIBUTE));
}

function documentOf(node: DomNode): Document {
  return (node.ownerDocument ?? (globalThis as { document?: Document }).document)!;
}

/** True when a split effect encloses `node` (looking up to `root` inclusive). */
function hasSplitAncestor(node: DomNode, root: DomNode): boolean {
  if (node === root) return false;
  let current = node.parentNode;
  while (current) {
    if (isSplitEffect(current)) return true;
    if (current === root) return false;
    current = current.parentNode;
  }
  return false;
}

/** Collect effect spans under (and including) `root`, in document order. */
function collectEffectSpans(root: DomNode, out: Element[]): void {
  if (isElement(root) && effectIdOf(root)) out.push(root);
  for (const child of Array.from(root.childNodes)) {
    if (isElement(child)) collectEffectSpans(child, out);
  }
}

/** Text nodes under `node` that are not yet decorated, in document order. */
function collectPlainTextNodes(node: DomNode, out: Text[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      out.push(child as Text);
    } else if (isElement(child) && !isDecoration(child)) {
      collectPlainTextNodes(child, out);
    }
  }
}

/** Highest letter index already used inside `span` (for idempotent reruns). */
function existingLetterCount(span: DomNode): number {
  let count = 0;
  const walk = (node: DomNode): void => {
    for (const child of Array.from(node.childNodes)) {
      if (!isElement(child)) continue;
      if (child.hasAttribute(TEXT_EFFECT_LETTER_ATTRIBUTE)) count += 1;
      else walk(child);
    }
  };
  walk(span);
  return count;
}

type Budget = { call: number };

function splitTextNode(textNode: Text, startIndex: number, spanLimit: number, budget: Budget): number {
  const text = textNode.textContent ?? "";
  const parent = textNode.parentNode;
  // Nothing to split: leave the node itself in place (no churn on reruns).
  if (!text || !parent || WHITESPACE.test(text) || startIndex >= spanLimit || budget.call <= 0) return startIndex;
  const doc = documentOf(textNode);
  const graphemes = splitGraphemes(text);
  const fragment: DomNode[] = [];
  let index = startIndex;
  let plain = "";
  let word: Element | null = null;
  const flushPlain = (): void => {
    if (plain) fragment.push(doc.createTextNode(plain));
    plain = "";
  };
  for (const grapheme of graphemes) {
    if (WHITESPACE.test(grapheme)) {
      word = null;
      plain += grapheme;
      continue;
    }
    if (index >= spanLimit || budget.call <= 0) {
      word = null;
      plain += grapheme;
      continue;
    }
    flushPlain();
    if (!word) {
      word = doc.createElement("span");
      word.setAttribute(TEXT_EFFECT_WORD_ATTRIBUTE, "");
      fragment.push(word);
    }
    const letter = doc.createElement("span");
    letter.setAttribute(TEXT_EFFECT_LETTER_ATTRIBUTE, "");
    (letter as HTMLElement).style.setProperty(TEXT_EFFECT_INDEX_PROPERTY, String(index));
    letter.appendChild(doc.createTextNode(grapheme));
    word.appendChild(letter);
    index += 1;
    budget.call -= 1;
  }
  flushPlain();
  for (const node of fragment) parent.insertBefore(node, textNode);
  parent.removeChild(textNode);
  return index;
}

const TRAILING_WORD = /\S+$/u;
const LEADING_WORD = /^\S+/u;

/**
 * Browsers allow a line break next to an inline-block letter even inside a
 * word, so `"<shout>STOP!</shout>"` could strand the quote at a line end.
 * Wrap the touching word fragments and the effect span in a glue span
 * (`text-wrap-mode: nowrap` on the glue, `wrap` again inside the effect):
 *   <span data-vn-text-fx-glue>"<span data-vn-text-fx>…</span>"</span>
 * Text and order are unchanged; only text outside the span is regrouped.
 */
function glueToNeighbours(span: Element): void {
  const parent = span.parentNode;
  if (!parent || (isElement(parent) && parent.hasAttribute(TEXT_EFFECT_GLUE_ATTRIBUTE))) return;
  const before = span.previousSibling;
  const after = span.nextSibling;
  const lead = before && before.nodeType === TEXT_NODE ? TRAILING_WORD.exec(before.textContent ?? "")?.[0] ?? "" : "";
  const tail = after && after.nodeType === TEXT_NODE ? LEADING_WORD.exec(after.textContent ?? "")?.[0] ?? "" : "";
  if (!lead && !tail) return;
  const doc = documentOf(span);
  const glue = doc.createElement("span");
  glue.setAttribute(TEXT_EFFECT_GLUE_ATTRIBUTE, "");
  parent.insertBefore(glue, span);
  if (lead && before) {
    const rest = (before.textContent ?? "").slice(0, -lead.length);
    if (rest) before.textContent = rest;
    else parent.removeChild(before);
    glue.appendChild(doc.createTextNode(lead));
  }
  glue.appendChild(span);
  if (tail && after) {
    const rest = (after.textContent ?? "").slice(tail.length);
    if (rest) after.textContent = rest;
    else parent.removeChild(after);
    glue.appendChild(doc.createTextNode(tail));
  }
}

/**
 * Decorate every `[data-vn-text-fx]` span under `root` (and `root` itself
 * when it is one). Safe to call repeatedly on the same tree.
 */
export function applyTextEffects(root: ParentNode): void {
  const rootNode = root as unknown as DomNode;
  if (!rootNode || typeof rootNode.childNodes === "undefined") return;
  const spans: Element[] = [];
  collectEffectSpans(rootNode, spans);
  if (spans.length === 0) return;
  const budget: Budget = { call: MAX_TEXT_EFFECT_LETTERS_PER_CALL };
  for (const span of spans) {
    if (!isSplitEffect(span) || hasSplitAncestor(span, rootNode)) continue;
    // Outermost split effect: number every letter below it, nested effects
    // included, so staggered animations flow across the whole phrase.
    let index = existingLetterCount(span);
    const textNodes: Text[] = [];
    collectPlainTextNodes(span, textNodes);
    for (const textNode of textNodes) {
      if (budget.call <= 0) break;
      index = splitTextNode(textNode, index, MAX_TEXT_EFFECT_LETTERS_PER_SPAN, budget);
    }
    if (index > 0 && span !== rootNode) glueToNeighbours(span);
  }
}
