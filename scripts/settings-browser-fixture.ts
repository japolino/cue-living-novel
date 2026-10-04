import { VisualNovelSettingsPanel, type SettingsPanelOptions } from "../src/frontend/settings/panel.js";
import { SpeechSettingsSection } from "../src/frontend/speech/settings-ui.js";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../src/config.js";
import { normalizeSpeechSettings } from "../src/speech-config.js";
import { SPRITE_HOT_SET, type PlateView, type SpriteImageStatus, type SpriteImageView, type SpriteSetView } from "../src/shared/sprites.js";

/**
 * Sprite library fixture. Thumbnails are small copies of the owner's bake-off
 * cut-outs (scripts/fixtures/sprite-library), served by the test server.
 */
const BBOX: Record<string, [number, number, number, number]> = {
  mira: [0.1298, 0.0181, 0.7548, 0.9819],
  sora: [0.0325, 0, 0.9579, 1],
  ren: [0.0577, 0, 0.8702, 1],
  elise: [0, 0.0189, 1, 0.9811],
  yuki: [0.0865, 0.0222, 0.7704, 0.9778],
};
function spriteImage(art: string, expression: string, status: SpriteImageStatus, error?: string): SpriteImageView {
  return status === "ready"
    ? { expression, status, url: `/sprites/${art}.webp`, bbox: BBOX[art], width: 832, height: 1216 }
    : { expression, status, ...(error ? { error } : {}) };
}
function spriteSet(setKey: string, name: string, attire: string | null, art: string, statuses: Partial<Record<string, SpriteImageStatus>>, updatedAt: string, fallback: SpriteImageStatus = "ready", errors: Record<string, string> = {}): SpriteSetView {
  const expressions: Record<string, SpriteImageView> = {};
  for (const id of [...SPRITE_HOT_SET, ...Object.keys(statuses).filter((id) => !(SPRITE_HOT_SET as readonly string[]).includes(id))]) {
    expressions[id] = spriteImage(art, id, statuses[id] ?? fallback, errors[id]);
  }
  return { setKey, name, attire, expressions, readyCount: Object.values(expressions).filter((image) => image.status === "ready").length, updatedAt };
}
const spriteLibrary = {
  sets: [
    spriteSet("set_yuki", "Yuki", "black and white maid uniform, frilled headband", "yuki", {}, "2026-09-28T10:00:00.000Z"),
    spriteSet("set_mira", "Mira", "navy sailor uniform, red neckerchief", "mira", { worried: "generating", thinking: "cutting", smug: "queued", scared: "failed", playful_winking: "ready" }, "2026-10-03T21:00:00.000Z", "ready", { scared: "Image generation timed out after 120 s." }),
    spriteSet("set_sora", "Sora", "yellow raincoat, shorts", "sora", {}, "2026-10-03T20:00:00.000Z"),
    spriteSet("set_ren", "Ren", null, "ren", { idle: "ready", smile: "ready", laughing: "generating", sad: "queued", crying_with_eyes_open: "queued" }, "2026-10-03T19:00:00.000Z", "missing"),
    spriteSet("set_elise", "Elise", "purple witch robe, pointed hat", "elise", { idle: "generating" }, "2026-10-03T18:00:00.000Z", "missing"),
  ],
  plates: [
    { plateKey: "plate_classroom", location: "Classroom", timeOfDay: "afternoon", weather: "clear", status: "ready", url: "/sprites/classroom_day.webp" },
    { plateKey: "plate_park", location: "Park under cherry trees", timeOfDay: "morning", weather: null, status: "ready", url: "/sprites/park_sakura.webp" },
    { plateKey: "plate_street", location: "Shopping street", timeOfDay: "night", weather: "rain", status: "ready", url: "/sprites/street_night.webp" },
    { plateKey: "plate_bedroom", location: "Mira's bedroom", timeOfDay: "evening", weather: null, status: "generating" },
    { plateKey: "plate_rooftop", location: "School rooftop", timeOfDay: "sunset", weather: "windy", status: "failed", error: "The provider rejected the prompt (content filter)." },
    { plateKey: "plate_station", location: "Train station", timeOfDay: "night", weather: "snow", status: "queued" },
  ] as PlateView[],
};

// A tiny in-page host: applies patches like the real controller, records every
// call, and acknowledges saves so the panel can show "Saved".
const mount = document.createElement("div");
Object.assign(mount.style, { position: "relative", minHeight: "100vh", background: "#08090d" });
document.body.append(mount);

const query = new URL(location.href).searchParams;
const memory = new Map<string, string>();
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
if (query.has("setupDone")) memory.set("cue.visual-novel.setup-done", "1");
if (query.has("light")) {
  // A light Lumiverse theme: the panel reads these host tokens.
  Object.assign(mount.style, { background: "#f6f4fa" });
  for (const [name, value] of Object.entries({
    "--lumiverse-primary": "#6d4fd6", "--lumiverse-primary-contrast": "#ffffff", "--lumiverse-text": "#1d1b24", "--lumiverse-text-muted": "rgba(29,27,36,.66)",
    "--lumiverse-border": "rgba(29,27,36,.16)", "--lumiverse-card-bg": "rgba(255,255,255,.75)", "--lumiverse-bg-elevated": "#ffffff", "--lumiverse-fill-medium": "rgba(29,27,36,.06)",
    "--lumiverse-success": "#18794e", "--lumiverse-warning": "#9a5b00", "--lumiverse-danger": "#c2264a",
  })) mount.style.setProperty(name, value);
}

const fixture = {
  config: { ...DEFAULT_CONFIG, imageParameters: { steps: 28 }, customCss: "[data-vn-dialogue] { opacity: .9; }", ignoredTags: "status, inventory" } as VisualNovelConfig,
  patches: [] as Array<Partial<VisualNovelConfig>>,
  ackMode: (query.get("ack") ?? "sync") as "sync" | "manual",
  previews: 0,
  refreshes: 0,
  scans: [] as string[],
  savedSystemOneKeys: [] as string[],
  clearedSystemOneKeys: 0,
  panel: null as VisualNovelSettingsPanel | null,
  speechPatches: [] as unknown[],
  speechListings: 0,
  /** Destroys and rebuilds the panel on the same storage, like reopening the settings tab. */
  remount: () => {},
  storage: null as unknown,
  spriteLibrary,
  spriteActions: [] as unknown[],
  libraryRequests: 0,
  modelPrepares: 0,
  modelClears: 0,
  /** "auto" answers library requests at once (narrow-layout pages); "manual" leaves it to the test. */
  libraryMode: (query.has("sprites") ? "auto" : "manual") as "auto" | "manual",
};
const panelOptions: SettingsPanelOptions = {
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
  onSaveSystemOneKey: (key) => { fixture.savedSystemOneKeys.push(key); panel.setSystemOneKeyStatus(true); },
  onClearSystemOneKey: () => { fixture.clearedSystemOneKeys += 1; panel.setSystemOneKeyStatus(false); },
  onScanAudio: (directory) => { fixture.scans.push(directory); return { bgmCount: 3, sfxCount: 12 }; },
  onImportAudio: () => {},
  onSpriteAction: (action) => { fixture.spriteActions.push(action); },
  onRequestSpriteLibrary: () => {
    fixture.libraryRequests += 1;
    if (fixture.libraryMode === "auto") queueMicrotask(() => panel.setSpriteLibrary(spriteLibrary.sets, spriteLibrary.plates));
  },
  onPrepareCutoutModel: () => { fixture.modelPrepares += 1; },
  onClearCutoutModel: () => { fixture.modelClears += 1; panel.setCutoutModelState({ state: "absent" }); },
};
let panel = new VisualNovelSettingsPanel(panelOptions);
// Mount the speech section inside the Voice section, like the controller does.
let speech: SpeechSettingsSection | null = null;
function mountSpeech(): void {
  speech = new SpeechSettingsSection({
    mount: panel.voiceMount(),
    onSave: (next) => { fixture.speechPatches.push(next); speech?.setConfig(normalizeSpeechSettings(next)); },
    listProfiles: async () => { fixture.speechListings += 1; return []; },
    listVoices: async () => [],
    getChatId: () => "chat-1",
  });
  speech.setConfig(normalizeSpeechSettings({}));
}
if (!query.has("noSpeech")) mountSpeech();
fixture.panel = panel;
fixture.storage = memory;
fixture.remount = () => {
  speech?.destroy();
  panel.destroy();
  panel = new VisualNovelSettingsPanel(panelOptions);
  fixture.panel = panel;
  if (!query.has("noSpeech")) mountSpeech();
  panel.setConfig(fixture.config);
};
if (query.has("sprites")) fixture.config = { ...fixture.config, presentationMode: "sprites" };
if (query.has("light")) fixture.config = { ...fixture.config, themePreset: "paper-novel" };
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
