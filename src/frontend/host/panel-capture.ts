import { MAX_PANEL_HTML, MAX_PANELS } from "../../shared/panels.js";

/** Snapshot only. Never move nodes or take ownership of another extension's mounts. */
export function captureSimTrackerCards(message: Element | null, document: Document): Array<{ title: string; html: string }> {
  const sources = [...(message?.querySelectorAll(".sst-message-tracker-host") ?? []), ...document.querySelectorAll(".sst-side-tracker-root")];
  const results: Array<{ title: string; html: string }> = [];
  for (const source of sources.slice(0, MAX_PANELS)) {
    const clone = source.cloneNode(true) as Element;
    const originalInputs = source.querySelectorAll<HTMLInputElement>("input");
    clone.querySelectorAll<HTMLInputElement>("input").forEach((input, index) => {
      input.toggleAttribute("checked", originalInputs[index]?.checked ?? false);
    });
    const html = clone.innerHTML;
    if (html.length > MAX_PANEL_HTML) continue;
    results.push({ title: source.classList.contains("sst-side-tracker-root") ? "SimTracker sidebar" : "SimTracker", html });
  }
  return results;
}
