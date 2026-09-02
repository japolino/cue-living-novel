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
 * Escape HTML special characters for safe rendering before applying allowed formatting.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Allow safe HTML tags after markdown and regex processing.
 * Tags permitted: <font color="...">, <span style="...">, <em>, <strong>, <b>, <i>, <del>, <s>, <ruby>, <rt>, <mark>.
 */
function sanitizeAllowedHtml(html: string): string {
  // Re-enable safe tags that were either escaped or introduced by regex / markdown
  return html
    // <font color="..."> ... </font>
    .replace(/&lt;font\s+color=(?:&quot;|")(#?[a-zA-Z0-9_-]+)(?:&quot;|")&gt;([\s\S]*?)&lt;\/font&gt;/gi, '<font color="$1">$2</font>')
    // <span class="..."> or <span style="...">
    .replace(/&lt;span\s+(class|style)=(?:&quot;|")([^"&]+)(?:&quot;|")&gt;([\s\S]*?)&lt;\/span&gt;/gi, '<span $1="$2">$3</span>')
    // <em ...> ... </em>
    .replace(/&lt;em(?:\s+class=(?:&quot;|")([^"&]+)(?:&quot;|"))?&gt;([\s\S]*?)&lt;\/em&gt;/gi, (_m, cls, body) => cls ? `<em class="${cls}">${body}</em>` : `<em>${body}</em>`)
    // <strong> ... </strong>
    .replace(/&lt;strong&gt;([\s\S]*?)&lt;\/strong&gt;/gi, "<strong>$1</strong>")
    // <b> ... </b>
    .replace(/&lt;b&gt;([\s\S]*?)&lt;\/b&gt;/gi, "<b>$1</b>")
    // <i> ... </i>
    .replace(/&lt;i&gt;([\s\S]*?)&lt;\/i&gt;/gi, "<i>$1</i>");
}

/**
 * Format raw paragraph text for rich display:
 * 1. Strip inline image tags (<img="name">, {{img::name}})
 * 2. Apply user custom display regex rules
 * 3. Escape HTML
 * 4. Parse markdown (**bold**, *italic*, ~~strike~~, `code`)
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
  // Bold: **text**
  formatted = formatted.replace(/\*\*([^\*]+)\*\*/g, "<strong>$1</strong>");
  // Italic: *text*
  formatted = formatted.replace(/\*([^\*]+)\*/g, "<em>$1</em>");
  // Strikethrough: ~~text~~
  formatted = formatted.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // Inline code: `text`
  formatted = formatted.replace(/`([^`]+)`/g, "<code>$1</code>");

  // 5. Restore sanitized safe tags
  formatted = sanitizeAllowedHtml(formatted);

  return formatted;
}
