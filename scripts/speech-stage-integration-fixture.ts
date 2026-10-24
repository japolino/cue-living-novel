import { VnStage } from "../src/frontend/stage/vn-stage.js";
import { PanelDock } from "../src/frontend/stage/panel-dock.js";
import { SpeechDock } from "../src/frontend/speech/ui.js";
import { SpeechController, type SpeechAudioElement } from "../src/frontend/speech/controller.js";
import { createSpeechTransport } from "../src/frontend/speech/transport.js";
import { SpeechSettingsSection } from "../src/frontend/speech/settings-ui.js";
import { normalizeSpeechSettings, type SpeechSettings } from "../src/speech-config.js";
import type { VnTurnInput } from "../src/frontend/store/index.js";

// Emulate full application mounting in src/frontend/host/controller.ts
const appRoot = document.createElement("div");
appRoot.className = "visual-novel-preview-mount";
Object.assign(appRoot.style, {
  position: "fixed",
  inset: "0",
  width: "100%",
  height: "100dvh",
  zIndex: "9990",
  background: "#08090d",
});
document.body.append(appRoot);
document.body.style.margin = "0";

const logs: string[] = [];

class FakeAudio implements SpeechAudioElement {
  src = "";
  volume = 1;
  currentTime = 0;
  private listeners = new Map<string, Array<() => void>>();
  async play(): Promise<void> { logs.push("audio:play"); }
  pause(): void { logs.push("audio:pause"); }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  emitEnded(): void {
    logs.push("audio:ended");
    for (const listener of this.listeners.get("ended") ?? []) listener();
  }
}

const audio = new FakeAudio();

const profiles = [
  { id: "prof-1", name: "Gemini voice", provider: "google_tts", model: "gemini-2.5-flash-tts", voice: "Puck", is_default: true, updated_at: "100", default_parameters: {} }
];

const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
  const path = url.split("?")[0]!;
  if (path === "/api/v1/tts-connections") return new Response(JSON.stringify({ data: profiles, total: 1 }), { headers: { "Content-Type": "application/json" } });
  if (path === "/api/v1/tts-connections/prof-1") return new Response(JSON.stringify(profiles[0]), { headers: { "Content-Type": "application/json" } });
  if (path === "/api/v1/tts/synthesize") {
    logs.push("transport:synthesize");
    return new Response(new Blob([new Uint8Array(64)], { type: "audio/mpeg" }), { headers: { "Content-Type": "audio/mpeg" } });
  }
  return new Response("Not found", { status: 404 });
};

const transport = createSpeechTransport({ fetchImpl });

let speech: SpeechController;
let speechDock: SpeechDock;

const stage = new VnStage({
  mount: appRoot,
  textSpeed: 0,
  autoPlayDelay: 200,
  isAutoAdvanceHeld: () => {
    if (!speech) return false;
    const s = speech.getStatus();
    return s.kind === "loading" || s.kind === "playing" || s.kind === "paused";
  },
  onAdvance: (paragraphIndex) => {
    logs.push(`stage:advance:${paragraphIndex}`);
    syncCursor(paragraphIndex);
  },
});

const panels = new PanelDock(stage.panelMount);

speechDock = new SpeechDock({
  mount: stage.panelMount,
  onPlay: () => { logs.push("dock:play-click"); void speech.playCurrent(); },
  onPause: () => { logs.push("dock:pause-click"); speech.pause(); },
  onStop: () => { logs.push("dock:stop-click"); speech.stop("user-stop"); },
});

speech = new SpeechController({
  transport,
  createAudio: () => audio,
  onStatus: (status) => {
    logs.push(`speech:status:${status.kind}`);
    speechDock.setStatus(status);
    if (status.kind === "loading" || status.kind === "playing" || status.kind === "paused") {
      stage.holdAutoPlay();
    } else {
      stage.checkAutoPlay();
    }
  },
});

speech.setActive(true);
speechDock.setOverlayActive(true);

const initialConfig = normalizeSpeechSettings({
  enabled: true,
  narrator: { connectionId: "prof-1", voice: "Puck" },
});
speech.setSettings(initialConfig);
speechDock.setEnabled(true);

const turn: VnTurnInput = {
  paragraphs: [
    { id: "p-0", text: "Paragraph 0 story text." },
    { id: "p-1", text: "Paragraph 1 story text." },
    { id: "p-2", text: "Paragraph 2 story text." },
  ],
  choices: [],
};
stage.loadTurn(turn);

function syncCursor(idx: number): void {
  const p = turn.paragraphs[idx];
  speech.setCursor(p ? {
    chatId: "c-1",
    messageId: "m-1",
    sourceFingerprint: "fp-1",
    paragraphIndex: idx,
    text: p.text,
    paragraphSpeaker: "",
    turnSpeaker: "Narrator",
  } : null);
}
syncCursor(0);

const settingsMount = document.createElement("div");
Object.assign(settingsMount.style, {
  position: "fixed",
  right: "0",
  top: "0",
  bottom: "0",
  width: "520px",
  overflowY: "auto",
  zIndex: "10000",
  background: "#171822",
  padding: "10px",
  boxShadow: "0 0 20px rgba(0,0,0,0.8)",
  display: "none",
});
document.body.append(settingsMount);
let savedConfig = initialConfig;
const settingsSection = new SpeechSettingsSection({
  mount: settingsMount,
  onSave: (patch) => {
    logs.push("settings:save");
    savedConfig = normalizeSpeechSettings(patch);
    // Emulate host echoing vn_config
    settingsSection.setConfig(savedConfig);
    speech.setSettings(savedConfig);
  },
  listProfiles: async () => profiles.map(p => ({ id: p.id, name: p.name, provider: p.provider, model: p.model, voice: p.voice, isDefault: p.is_default })),
  listVoices: async () => [{ id: "Puck", name: "Puck" }],
  getChatId: () => "c-1",
});
settingsSection.setConfig(initialConfig);

(window as any).fixture = {
  logs,
  stage,
  speech,
  speechDock,
  settingsSection,
  audio,
  syncCursor,
};
document.body.setAttribute("data-integration-ready", "1");
