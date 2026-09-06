import { VisualNovelSettingsPanel } from "../src/frontend/settings/panel.js";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../src/config.js";

// A tiny in-page host: applies patches like the real controller, records every
// call, and acknowledges saves so the panel can show "Saved".
const mount = document.createElement("div");
Object.assign(mount.style, { position: "relative", minHeight: "100vh", background: "#08090d" });
document.body.append(mount);

const query = new URL(location.href).searchParams;
const memory = new Map<string, string>();
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
if (query.has("setupDone")) memory.set("cue.visual-novel.setup-done", "1");

const fixture = {
  config: { ...DEFAULT_CONFIG, imageParameters: { steps: 28 }, customCss: "[data-vn-dialogue] { opacity: .9; }", ignoredTags: "status, inventory" } as VisualNovelConfig,
  patches: [] as Array<Partial<VisualNovelConfig>>,
  ackMode: (query.get("ack") ?? "sync") as "sync" | "manual",
  previews: 0,
  refreshes: 0,
  scans: [] as string[],
  panel: null as VisualNovelSettingsPanel | null,
};
const panel = new VisualNovelSettingsPanel({
  mount,
  setupStorage: storage,
  onSave: (patch) => {
    fixture.patches.push(patch);
    fixture.config = { ...fixture.config, ...patch };
    panel.setConfig(fixture.config);
    if (fixture.ackMode === "sync") queueMicrotask(() => panel.setSaveStatus({ kind: "saved" }));
  },
  onOpenPreview: () => { fixture.previews += 1; },
  onRefreshConnections: () => { fixture.refreshes += 1; },
  onScanAudio: (directory) => { fixture.scans.push(directory); return { bgmCount: 3, sfxCount: 12 }; },
  onImportAudio: () => {},
});
fixture.panel = panel;
if (query.has("card")) fixture.config = { ...fixture.config, useNativeCardImages: true, themePreset: "midnight-noir" };
panel.setConfig(fixture.config);
if (!query.has("noCatalog")) {
  panel.setConnectionCatalog("planner", { status: "ready", options: [
    { id: "text-1", name: "Studio text", provider: "OpenAI", model: "gpt-4o-mini", isDefault: true },
    { id: "text-2", name: "Local text", provider: "Ollama", model: "llama3", isDefault: false },
  ] });
  panel.setConnectionCatalog("image", { status: "ready", options: [
    { id: "img-1", name: "Studio images", provider: "Stability", model: "sd3", isDefault: false },
  ] });
}
Object.assign(window, { settingsFixture: fixture });
