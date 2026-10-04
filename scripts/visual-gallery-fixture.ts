
import { VnStage } from "../src/frontend/stage/vn-stage.js";
import { VisualNovelSettingsPanel } from "../src/frontend/settings/panel.js";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../src/config.js";

function sceneDataUrl(colors: [string, string], label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="#ffe9a8" stop-opacity=".9"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#sky)"/>
    <circle cx="1240" cy="170" r="220" fill="url(#glow)"/>
    <path d="M0 590 Q260 420 520 590 T1040 560 T1600 570 V900 H0Z" fill="#0b1724" opacity=".78"/>
    <path d="M0 690 Q300 570 650 690 T1300 650 T1600 670 V900 H0Z" fill="#071019" opacity=".96"/>
    <path d="M735 710 Q710 555 750 400 Q800 310 850 400 Q890 555 865 710Z" fill="#14111f"/>
    <circle cx="800" cy="330" r="86" fill="#e8c1ae"/>
    <path d="M714 335 Q715 215 800 220 Q900 220 886 355 Q850 300 770 295Z" fill="#181226"/>
    <path d="M755 405 Q800 445 845 405 L895 690 Q800 745 705 690Z" fill="#6c254d"/>
    <text x="70" y="90" fill="#fff" opacity=".55" font-family="system-ui" font-size="32">${label}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const q = new URL(location.href).searchParams;
const view = q.get("view") ?? "stage";
const mount = document.createElement("div");
document.body.append(mount);

if (view === "settings") {
  Object.assign(mount.style, { position: "relative", minHeight: "100vh", background: "#08090d" });
  const memory = new Map<string, string>();
  if (!q.has("setup")) memory.set("cue.visual-novel.setup-done", "1");
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); } };
  let config = { ...DEFAULT_CONFIG } as VisualNovelConfig;
  const panel = new VisualNovelSettingsPanel({
    mount, setupStorage: storage as never,
    onSave: (patch) => { config = { ...config, ...patch }; panel.setConfig(config); queueMicrotask(() => panel.setSaveStatus({ kind: "saved" })); },
    onOpenPreview: () => {}, onRefreshConnections: () => {},
    onSaveSystemOneKey: () => panel.setSystemOneKeyStatus(true), onClearSystemOneKey: () => panel.setSystemOneKeyStatus(false),
    onScanAudio: () => ({ bgmCount: 3, sfxCount: 12 }), onImportAudio: () => {},
  } as never);
  panel.setConfig(config);
  panel.setConnectionCatalog("planner", { status: "ready", options: [
    { id: "text-1", name: "Studio text", provider: "OpenAI", model: "gpt-4o-mini", isDefault: true },
  ] } as never);
  panel.setConnectionCatalog("image", { status: "ready", options: [
    { id: "img-1", name: "Studio images", provider: "Stability", model: "sd3", isDefault: false },
  ] } as never);
  Object.assign(window, { gallery: { panel } });
} else {
  Object.assign(mount.style, { position: "fixed", inset: "0", background: "#08090d" });
  const mode = q.get("mode") === "standard" ? "standard" : "cyoa";
  const stage = new VnStage({
    mount, textSpeed: 0,
    themePreset: (q.get("preset") as never) ?? "lumiverse",
    onReroll: () => {}, onSubmit: async () => {}, onChoice: async () => {}, onExit: () => {},
  });
  const text = q.get("text") ?? "The last sunlight spills across the valley. *For a moment, neither of us says anything.* She turns, **eyes bright**, and whispers your name.";
  stage.loadTurn({
    mode,
    paragraphs: [
      { id: "p0", speaker: "Mira", text },
      { id: "p1", speaker: "", text: "By the time she turns toward you, the first stars have appeared over the ridge." },
      { id: "p2", speaker: "Mira", text: "\u201cSo,\u201d she asks quietly, \u201cwhere do we go from here?\u201d" },
    ],
    choices: [
      { id: "stay", label: "Stay until sunrise", value: "stay" },
      { id: "return", label: "Head back together", value: "return" },
      { id: "ask", label: "Ask what she wants", value: "ask" },
    ],
  } as never);
  void stage.setSceneImage({ url: sceneDataUrl(["#402b63", "#d77d72"], "Sunset overlook"), requestId: "s1", alt: "" });
  const amb = q.get("ambient"); if (amb) stage.applyAmbient(amb as never);
  Object.assign(window, { gallery: { stage } });
}
