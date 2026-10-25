import { TEXT_EFFECT_IDS, isTextEffectId } from "../../shared/text-effects.js";
import { STAGE_INLINE_TAGS } from "../../shared/stage-markup.js";

export type CustomRegexRule = {
  pattern: RegExp;
  replacement: string;
};

/**
 * Parse custom regex rules from user settings.
 * Supports:
 *   /pattern/flags => replacement
 *   pattern => replacement
 */
export function parseCustomRegexRules(input: string | undefined): CustomRegexRule[] {
  if (!input) return [];
  const rules: CustomRegexRule[] = [];
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    const regexMatch = trimmed.match(/^\/(.+)\/([a-z]*)\s*=>\s*(.*)$/);
    if (regexMatch) {
      try {
        const pattern = new RegExp(regexMatch[1]!, regexMatch[2] || "g");
        rules.push({ pattern, replacement: regexMatch[3] ?? "" });
        continue;
      } catch {
        // Skip invalid regex
      }
    }

    const simpleMatch = trimmed.split("=>");
    if (simpleMatch.length >= 2) {
      try {
        const rawPattern = simpleMatch[0]!.trim();
        const replacement = simpleMatch.slice(1).join("=>").trim();
        const pattern = new RegExp(rawPattern, "g");
        rules.push({ pattern, replacement });
      } catch {
        // Skip invalid regex
      }
    }
  }
  return rules;
}

/**
 * Escape HTML special characters (&, <, >) for safe rendering.
 * Quotes (' and ") do not have syntactic meaning in HTML text nodes
 * and are preserved so dialogue quotes remain natural.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Parse standard Markdown syntax:
 * - Bold + Italic: ***text***, ___text___, **_text_**, __*text*__
 * - Bold: **text**, __text__
 * - Italic: *text*, _text_
 * - Strikethrough: ~~text~~
 * - Inline code: `text`
 */
function parseMarkdown(text: string): string {
  // 1. Triple formatting (bold + italic)
  let md = text
    .replace(/\*\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/(^|[^\w])___([^\s_](?:[\s\S]*?[^\s_])?)___(?=[^\w]|$)/g, "$1<strong><em>$2</em></strong>")
    .replace(/\*\*_(.+?)_\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/__\*(.+?)\*__/g, "<strong><em>$1</em></strong>");

  // 2. Bold (**text** or __text__)
  md = md
    .replace(/\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__([^\s_](?:[\s\S]*?[^\s_])?)__(?=[^\w]|$)/g, "$1<strong>$2</strong>");

  // 3. Italic (*text* or _text_)
  md = md
    .replace(/\*([^\s*](?:[\s\S]*?[^\s*])?)\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_([^\s_](?:[\s\S]*?[^\s_])?)_(?=[^\w]|$)/g, "$1<em>$2</em>");

  // 4. Strikethrough (~~text~~)
  md = md.replace(/~~([^\s~](?:[\s\S]*?[^\s~])?)~~/g, "<del>$1</del>");

  // 5. Inline code (`text`)
  md = md.replace(/`([^`]+)`/g, "<code>$1</code>");

  return md;
}

const ALLOWED_TAGS = STAGE_INLINE_TAGS;

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  font: new Set(["color", "style", "face", "size"]),
  span: new Set(["class", "style", "data-vn-text-fx"]),
  em: new Set(["class", "style"]),
  strong: new Set(["class", "style"]),
  b: new Set(["class", "style"]),
  i: new Set(["class", "style"]),
  code: new Set(["class", "style"]),
  mark: new Set(["class", "style"]),
};

/**
 * Safely restore allowed HTML tags and sanitize their attributes.
 * Prevents XSS (scripts, event handlers, javascript: URIs, untrusted tags).
 */
function sanitizeAndRestoreAllowedHtml(escapedText: string): string {
  // Matches escaped tags: &lt;tag-name ...&gt; or &lt;/tag-name&gt;
  return escapedText.replace(/&lt;(\/?[a-zA-Z][a-zA-Z0-9]*)(.*?)&gt;/gs, (fullMatch, rawTag: string, rawAttrs: string) => {
    const isClosing = rawTag.startsWith("/");
    const tagName = (isClosing ? rawTag.slice(1) : rawTag).toLowerCase();

    if (!ALLOWED_TAGS.has(tagName)) {
      return fullMatch;
    }

    if (isClosing) {
      return `</${tagName}>`;
    }

    if (tagName === "br") {
      return "<br>";
    }

    const allowedAttrSet = ALLOWED_ATTRS[tagName];
    if (!allowedAttrSet) {
      return `<${tagName}>`;
    }

    // Extract attributes: name="val", name='val', name=val
    const attrRegex = /([a-zA-Z_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
    const safeAttrs: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(rawAttrs)) !== null) {
      const attrName = match[1]!.toLowerCase();
      if (!allowedAttrSet.has(attrName)) continue;

      let val = match[2] ?? match[3] ?? match[4] ?? "";

      if (attrName === "style") {
        // Disallow dangerous CSS expressions or url imports
        if (/javascript:|expression\(|url\(|behavior:|vbscript:/i.test(val)) {
          continue;
        }
        val = val.replace(/"/g, "&quot;");
      } else if (attrName === "data-vn-text-fx") {
        // Only catalogue ids; anything else drops the attribute.
        val = val.trim().toLowerCase();
        if (!isTextEffectId(val)) continue;
      } else if (attrName === "class" || attrName === "face" || attrName === "color" || attrName === "size") {
        val = val.replace(/[^a-zA-Z0-9_#.,\s-]/g, "");
      }

      safeAttrs.push(`${attrName}="${val}"`);
    }

    const attrStr = safeAttrs.length > 0 ? ` ${safeAttrs.join(" ")}` : "";
    return `<${tagName}${attrStr}>`;
  });
}

// Escaped effect tags (`&lt;shake&gt;`, `&lt;/Shake&gt;`) or an inline code
// span, which is skipped so `<shake>` inside backticks stays literal.
const ESCAPED_TEXT_EFFECT_TOKEN = new RegExp(
  `<code\\b[^>]*>[\\s\\S]*?<\\/code>|&lt;\\s*(\\/?)\\s*(${TEXT_EFFECT_IDS.join("|")})\\s*&gt;`,
  "gi",
);

/**
 * Turn escaped catalogue tags into effect spans. Tags are paired with a
 * stack, so output is always balanced: a closing tag closes the nearest open
 * tag with the same id (inner unclosed tags are dropped), stray closing tags
 * and tags left open at the end are dropped. An unclosed tag therefore never
 * swallows the rest of the paragraph or breaks later markup.
 */
function restoreTextEffectTags(escapedText: string): string {
  if (escapedText.indexOf("&lt;") === -1) return escapedText;
  type Token = { start: number; end: number; closing: boolean; id: string };
  const tokens: Token[] = [];
  for (const match of escapedText.matchAll(ESCAPED_TEXT_EFFECT_TOKEN)) {
    if (match[2] === undefined) continue; // code span
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      closing: match[1] === "/",
      id: match[2].toLowerCase(),
    });
  }
  if (tokens.length === 0) return escapedText;
  const replacement = new Map<Token, string>();
  const open: Token[] = [];
  for (const token of tokens) {
    replacement.set(token, "");
    if (!token.closing) {
      open.push(token);
      continue;
    }
    let depth = open.length - 1;
    while (depth >= 0 && open[depth]!.id !== token.id) depth -= 1;
    if (depth < 0) continue; // stray closing tag
    // Tags opened after the matching one were never closed: drop them.
    open.length = depth + 1;
    const opener = open.pop()!;
    replacement.set(opener, `<span data-vn-text-fx="${opener.id}">`);
    replacement.set(token, "</span>");
  }
  let output = "";
  let cursor = 0;
  for (const token of tokens) {
    output += escapedText.slice(cursor, token.start) + replacement.get(token);
    cursor = token.end;
  }
  return output + escapedText.slice(cursor);
}

/**
 * Format raw paragraph text for rich display:
 * 1. Strip inline image tags (<img="name">, {{img::name}})
 * 2. Apply user custom display regex rules
 * 3. Escape HTML special characters
 * 4. Parse markdown syntax (**bold**, *italic*, _italic_, ~~strike~~, `code`)
 * 5. Sanitize and allow safe HTML tags (<font>, <span>, <em>, etc.)
 * 6. Turn paired text effect tags (<shake>, <rainbow>, ... see
 *    src/shared/text-effects.ts) into `<span data-vn-text-fx="id">`.
 *    Display regex rules run first, so a rule may emit these tags too.
 */
export type DialogueFormatOptions = {
  stripMarkdown?: boolean;
  forceQuotes?: boolean;
  hasSpeaker?: boolean;
  /** Wrap quoted runs in `<span data-vn-quote>` (see markDialogueQuotes). */
  markQuotes?: boolean;
};

function stripMarkdown(text: string): string {
  // Strip metadata tags like **Time**: ..., **Location**: ...
  let md = text
    .replace(/(?:\*\*|__)?(?:Time|Location|Costume|Scene|Date|Setting)(?:\*\*)?\s*:[^\n]*(?:\r?\n|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 1. Triple formatting (bold + italic)
  md = md
    .replace(/\*\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*\*/g, "$1")
    .replace(/(^|[^\w])___([^\s_](?:[\s\S]*?[^\s_])?)___(?=[^\w]|$)/g, "$1$2")
    .replace(/\*\*_(.+?)_\*\*/g, "$1")
    .replace(/__\*(.+?)\*__/g, "$1");

  // 2. Bold (**text** or __text__)
  md = md
    .replace(/\*\*([^\s*](?:[\s\S]*?[^\s*])?)\*\*/g, "$1")
    .replace(/(^|[^\w])__([^\s_](?:[\s\S]*?[^\s_])?)__(?=[^\w]|$)/g, "$1$2");

  // 3. Italic (*text* or _text_)
  md = md
    .replace(/\*([^\s*](?:[\s\S]*?[^\s*])?)\*/g, "$1")
    .replace(/(^|[^\w])_([^\s_](?:[\s\S]*?[^\s_])?)_(?=[^\w]|$)/g, "$1$2");

  // 4. Strikethrough (~~text~~)
  md = md.replace(/~~([^\s~](?:[\s\S]*?[^\s~])?)~~/g, "$1");

  // 5. Inline code (`text`)
  md = md.replace(/`([^`]+)`/g, "$1");

  return md;
}

function applyDialogueQuotes(text: string, hasSpeaker: boolean): string {
  const trimmed = text.trim();
  if (!trimmed || !hasSpeaker) return text;
  if (/[“"”「」]/.test(trimmed)) return text;
  return `"${trimmed}"`;
}

export function formatDialogueText(
  rawText: string,
  regexRules: CustomRegexRule[] = [],
  options: DialogueFormatOptions = {},
): string {
  if (!rawText) return "";

  // 1. Strip inline card images / asset markers
  let text = rawText
    .replace(/<img\s*=\s*["'][^"']+["']\s*\/?>/gi, "")
    .replace(/<img\b[^>]*?\bsrc\s*=\s*["'][^"']+["'][^>]*?\/?>/gi, "")
    .replace(/\{\{img::[^\}]+\}\}/gi, "");

  // 2. Apply custom regex rules
  for (const { pattern, replacement } of regexRules) {
    try {
      text = text.replace(pattern, replacement);
    } catch {
      // Ignore rule execution failures
    }
  }

  // 3. Escape HTML special characters
  let formatted = escapeHtml(text);

  // 4. Parse or strip markdown syntax
  if (options.stripMarkdown) {
    formatted = stripMarkdown(formatted);
  } else {
    formatted = parseMarkdown(formatted);
  }

  // 5. Apply quotes if necessary for spoken dialogue
  if (options.forceQuotes) {
    formatted = applyDialogueQuotes(formatted, Boolean(options.hasSpeaker));
  }

  // 6. Restore sanitized safe tags
  formatted = sanitizeAndRestoreAllowedHtml(formatted);

  // 7. Paired text effect tags become effect spans (unpaired ones are dropped)
  formatted = restoreTextEffectTags(formatted);

  // 8. Spoken words get a hook of their own (the stage asks for it)
  if (options.markQuotes) {
    formatted = markDialogueQuotes(formatted);
  }

  return formatted;
}

/** Attribute on the span around a quoted run (`markDialogueQuotes`). */
export const DIALOGUE_QUOTE_ATTRIBUTE = "data-vn-quote";

/** Quote marks that open spoken dialogue, with the mark that closes each. */
const DIALOGUE_QUOTE_CLOSERS: ReadonlyMap<string, string> = new Map([
  ["「", "」"],
  ["『", "』"],
  ["“", "”"],
  ['"', '"'],
]);

const VOID_TAGS: ReadonlySet<string> = new Set(["br"]);

type QuoteRun = {
  /** Token and character index of the opening mark. */
  startToken: number;
  startChar: number;
  /** Token and character index just past the closing mark. */
  endToken: number;
  endChar: number;
  /** Every tag opened inside the run closes inside it, in order. */
  balanced: boolean;
};

/**
 * Wrap each quoted run of formatted dialogue markup (「…」, 『…』, “…”, "…",
 * marks included) in `<span data-vn-quote>`, so a theme can set spoken words
 * apart from narration (Cinema does; the others leave it unstyled).
 *
 * Only text is scanned: tags are never split and text inside `<code>` never
 * opens or closes a quote. A run whose markup is balanced (every tag opened
 * in it closes in it) gets one span, effect spans and all; a run that crosses
 * a tag boundary (`<em>"Wait</em> here"`) gets one span per text piece, so
 * the output always nests. A quote still open when the paragraph ends is
 * narration (a stray inch mark, or a quote that goes on in the next
 * paragraph). The text and its order are unchanged, so the typewriter and
 * text effects see the same characters.
 */
export function markDialogueQuotes(html: string): string {
  if (!html) return html;
  // Even indices are text, odd ones are tags (sanitized markup has no stray `<`).
  const tokens = html.split(/(<[^>]*>)/);
  const runs: QuoteRun[] = [];
  const stack: string[] = [];
  let codeDepth = 0;
  let open: { closer: string; token: number; char: number; depth: number; clean: boolean } | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (index % 2 === 1) {
      const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(token);
      if (!match) continue;
      const name = match[2]!.toLowerCase();
      if (VOID_TAGS.has(name)) continue;
      if (match[1] === "/") {
        if (name === "code" && codeDepth > 0) codeDepth -= 1;
        if (stack[stack.length - 1] === name) {
          stack.pop();
          // Closing a tag opened before the run makes it cross a boundary.
          if (open && stack.length < open.depth) open.clean = false;
        } else {
          // A stray or misnested closing tag: never wrap across it.
          const at = stack.lastIndexOf(name);
          if (at >= 0) stack.length = at;
          if (open) open.clean = false;
        }
      } else {
        stack.push(name);
        if (name === "code") codeDepth += 1;
      }
      continue;
    }
    if (codeDepth > 0) continue;
    for (let char = 0; char < token.length; char += 1) {
      const mark = token[char]!;
      if (open) {
        if (mark !== open.closer) continue;
        runs.push({
          startToken: open.token,
          startChar: open.char,
          endToken: index,
          endChar: char + 1,
          balanced: open.clean && stack.length === open.depth,
        });
        open = null;
        continue;
      }
      const closer = DIALOGUE_QUOTE_CLOSERS.get(mark);
      if (closer) open = { closer, token: index, char, depth: stack.length, clean: true };
    }
  }
  if (runs.length === 0) return html;

  // Insertions per text token: [position, markup]; a close sorts before an
  // open at the same position, so back-to-back quotes stay separate spans.
  const OPEN = `<span ${DIALOGUE_QUOTE_ATTRIBUTE}>`;
  const CLOSE = "</span>";
  const inserts = new Map<number, Array<[number, string]>>();
  const add = (token: number, at: number, markup: string): void => {
    const list = inserts.get(token) ?? [];
    list.push([at, markup]);
    inserts.set(token, list);
  };
  for (const run of runs) {
    if (run.balanced) {
      add(run.startToken, run.startChar, OPEN);
      add(run.endToken, run.endChar, CLOSE);
      continue;
    }
    for (let token = run.startToken; token <= run.endToken; token += 2) {
      const from = token === run.startToken ? run.startChar : 0;
      const to = token === run.endToken ? run.endChar : tokens[token]!.length;
      if (to <= from) continue;
      add(token, from, OPEN);
      add(token, to, CLOSE);
    }
  }
  for (const [token, list] of inserts) {
    list.sort((a, b) => a[0] - b[0] || (a[1] === CLOSE ? -1 : 0) - (b[1] === CLOSE ? -1 : 0));
    const text = tokens[token]!;
    let output = "";
    let cursor = 0;
    for (const [at, markup] of list) {
      output += text.slice(cursor, at) + markup;
      cursor = at;
    }
    tokens[token] = output + text.slice(cursor);
  }
  return tokens.join("");
}

