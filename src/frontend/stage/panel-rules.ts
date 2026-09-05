import type { PanelArtifact } from "../../shared/panels.js";

export type PanelRule = { id: string; title: string; pattern: string; flags: string; template: string };

/** This function is serialized into a disposable worker; keep it self-contained. */
export function evaluatePanelRule(source: string, rule: PanelRule): Array<{ html: string; end: number }> {
  if (source.length > 1_000_000 || rule.pattern.length > 4000 || rule.template.length > 100_000) throw new Error("Rule or source exceeds the panel size limit.");
  if (/\{\{/.test(rule.template)) throw new Error("Host macros must be resolved before importing this template.");
  const flags = [...new Set((rule.flags + "g").split(""))].join("");
  const pattern = new RegExp(rule.pattern, flags);
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const results: Array<{ html: string; end: number }> = [];
  for (const match of source.matchAll(pattern)) {
    if (!match[0]) throw new Error("Panel rules must not match empty text.");
    const html = rule.template.replace(/\$(\$|&|\d{1,2}|<[^>]+>|['`])/g, (_token, group: string) => {
      if (group === "$") return "$";
      if (group === "&") return escape(match[0]);
      const capture = group.startsWith("<") ? match.groups?.[group.slice(1, -1)] : match[Number(group)];
      if (capture === undefined) throw new Error(`Missing or unsupported capture $${group}.`);
      return escape(capture);
    });
    if (html.length > 100_000) throw new Error("Rendered card exceeds 100 KB.");
    results.push({ html, end: match.index + match[0].length });
    if (results.length >= 12) break;
  }
  return results;
}

export function renderPanelRule(source: string, rule: PanelRule, paragraphIndex: number): Promise<PanelArtifact[]> {
  return new Promise((resolve, reject) => {
    const code = `const evaluate = ${evaluatePanelRule.toString()}; onmessage = ({data}) => { try { postMessage({items:evaluate(data.source,data.rule)}); } catch(e) {postMessage({error:String(e.message || e)})} };`;
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    let worker: Worker;
    try { worker = new Worker(url); } catch (error) { URL.revokeObjectURL(url); reject(error); return; }
    const cleanup = () => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Regex timed out. Simplify the pattern.")); }, 500);
    worker.onerror = () => { cleanup(); reject(new Error("Panel rule worker could not run.")); };
    worker.onmessage = ({ data }: MessageEvent<{ error?: string; items?: Array<{ html: string }> }>) => {
      cleanup();
      if (data.error) { reject(new Error(data.error)); return; }
      resolve((data.items ?? []).map((item, i) => ({ id: `rule:${rule.id}:${i}`, title: rule.title, html: item.html, paragraphIndex, ...(data.items?.length === 1 ? { followKey: `rule:${rule.id}` } : {}) })));
    };
    worker.postMessage({ source, rule });
  });
}
