import { z } from "zod";

export const MAX_PANEL_HTML = 100_000;
export const MAX_PANELS = 12;
export const MAX_PANEL_TOTAL = 300_000;
export const PanelArtifactSchema = z.object({
  id: z.string().max(160),
  title: z.string().max(120),
  html: z.string().max(MAX_PANEL_HTML),
  paragraphIndex: z.number().int().nonnegative(),
  followKey: z.string().max(160).optional(),
}).strict();
export type PanelArtifact = z.infer<typeof PanelArtifactSchema>;

export function panelHash(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

export function escapePanelText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export type PanelSpan = { start: number; end: number; html: string; title: string; followKey?: string };
const ROOTS = new Set(["div", "section", "article", "aside", "table", "svg", "details", "figure"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** Complete, balanced block roots only. Offsets refer to the untouched source. */
export function extractPanelSpans(source: string): PanelSpan[] {
  if (source.length > 1_000_000) return [];
  const spans: PanelSpan[] = [];
  let total = 0;
  const token = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const excluded: Array<{ start: number; end: number }> = [];
  const fences = [...source.matchAll(/^\s*```([^\n]*)/gm)];
  for (let i = 0; i < fences.length; i += 2) {
    const open = fences[i]!;
    if (!/^(?:html|svg)\s*$/i.test(open[1]?.trim() ?? "")) excluded.push({ start: open.index, end: fences[i + 1] ? fences[i + 1]!.index + fences[i + 1]![0].length : source.length });
  }
  for (const match of source.matchAll(/(?<!`)`(?!`)[^`\n]*`(?!`)/g)) excluded.push({ start: match.index, end: match.index + match[0].length });
  const unclosedComment = source.lastIndexOf("<!--");
  if (unclosedComment > source.lastIndexOf("-->")) excluded.push({ start: unclosedComment, end: source.length });
  excluded.sort((a, b) => a.start - b.start);
  let exclusion = 0;
  const stack: string[] = [];
  let start = -1;
  let styleStart = -1;
  let styleEnd = -1;
  let raw: string | null = null;
  for (const match of source.matchAll(token)) {
    if (spans.length >= MAX_PANELS) break;
    while (excluded[exclusion] && excluded[exclusion]!.end <= match.index) exclusion++;
    if (excluded[exclusion] && excluded[exclusion]!.start <= match.index) continue;
    const name = match[1]?.toLowerCase();
    if (!name) continue;
    const closing = match[0].startsWith("</");
    if (raw && !(closing && name === raw)) continue;
    if (raw) raw = null;
    const at = match.index;
    if (!closing && (name === "script" || name === "style" || name === "textarea")) raw = name;
    if (stack.length === 0) {
      if (name === "style") {
        if (!closing) styleStart = at;
        else styleEnd = at + match[0].length;
        continue;
      }
      if (closing || !ROOTS.has(name)) continue;
      start = styleEnd >= 0 && !source.slice(styleEnd, at).trim() ? styleStart : at;
    }
    if (closing) {
      if (stack.at(-1) !== name) { stack.length = 0; start = -1; continue; }
      stack.pop();
    } else if (!VOID.has(name) && !/\/\s*>$/.test(match[0])) stack.push(name);
    if (stack.length === 0 && start >= 0) {
      let end = at + match[0].length;
      let begin = start;
      const before = source.slice(0, begin).match(/```(?:html|svg)\s*\n\s*$/i);
      const after = source.slice(end).match(/^\s*\n```/);
      const html = source.slice(begin, end);
      if (before && after) { begin -= before[0].length; end += after[0].length; }
      if (html.length <= MAX_PANEL_HTML && spans.length < MAX_PANELS && total + html.length <= MAX_PANEL_TOTAL && !/<Choice\b/i.test(html)) {
        spans.push({ start: begin, end, html, title: name === "svg" ? "SVG illustration" : "Inline card" });
        total += html.length;
      }
      start = styleStart = styleEnd = -1;
    }
  }
  return spans;
}

/** Preserve lengths and newlines, so filtering cannot shift source paragraph IDs. */
export function maskPanelSpans(source: string, spans: readonly Pick<PanelSpan, "start" | "end">[]): string {
  let result = source;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, span.start) + result.slice(span.start, span.end).replace(/[^\r\n]/g, " ") + result.slice(span.end);
  }
  return result;
}
