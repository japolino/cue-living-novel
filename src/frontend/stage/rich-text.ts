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

const ALLOWED_TAGS = new Set([
  "font",
  "span",
  "em",
  "strong",
  "b",
  "i",
  "del",
  "s",
  "u",
  "mark",
  "ruby",
  "rt",
  "rp",
  "code",
  "small",
  "sub",
  "sup",
  "br",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  font: new Set(["color", "style", "face", "size"]),
  span: new Set(["class", "style"]),
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
      } else if (attrName === "class" || attrName === "face" || attrName === "color" || attrName === "size") {
        val = val.replace(/[^a-zA-Z0-9_#.,\s-]/g, "");
      }

      safeAttrs.push(`${attrName}="${val}"`);
    }

    const attrStr = safeAttrs.length > 0 ? ` ${safeAttrs.join(" ")}` : "";
    return `<${tagName}${attrStr}>`;
  });
}

/**
 * Format raw paragraph text for rich display:
 * 1. Strip inline image tags (<img="name">, {{img::name}})
 * 2. Apply user custom display regex rules
 * 3. Escape HTML special characters
 * 4. Parse markdown syntax (**bold**, *italic*, _italic_, ~~strike~~, `code`)
 * 5. Sanitize and allow safe HTML tags (<font>, <span>, <em>, etc.)
 */
export function formatDialogueText(
  rawText: string,
  regexRules: CustomRegexRule[] = [],
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

  // 4. Parse markdown syntax
  formatted = parseMarkdown(formatted);

  // 5. Restore sanitized safe tags
  formatted = sanitizeAndRestoreAllowedHtml(formatted);

  return formatted;
}
