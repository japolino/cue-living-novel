import { SpeechController, type SpeechAudioElement, type SpeechStatus } from "../src/frontend/speech/controller.js";
import { createSpeechTransport } from "../src/frontend/speech/transport.js";
import { SpeechDock } from "../src/frontend/speech/ui.js";
import { SpeechSettingsSection } from "../src/frontend/speech/settings-ui.js";
import { normalizeSpeechSettings, type SpeechSettings } from "../src/speech-config.js";

/**
 * Offline browser fixture for the speech feature: a tiny in-page host with
 * INTERCEPTED Lumiverse TTS endpoints (recorded, never leaving the page),
 * the real transport/controller/dock/settings-card code, and a recording
 * audio element. No real host, no provider, no paid calls.
 */

type RecordedRequest = { method: string; url: string; body: unknown };

const profiles: Record<string, Record<string, unknown>> = {
  "gem-1": { id: "gem-1", name: "Gemini voice", provider: "openrouter_tts", model: "google/gemini-2.5-flash-tts", voice: "Kore", is_default: true, updated_at: "rev-1", default_parameters: {} },
  "oai-1": { id: "oai-1", name: "OpenAI voice", provider: "openai_tts", model: "gpt-4o-mini-tts", voice: "alloy", is_default: false, updated_at: "rev-1", default_parameters: {} },
};

const fixture = {
  requests: [] as RecordedRequest[],
  patches: [] as SpeechSettings[],
  statuses: [] as SpeechStatus[],
  playCalls: 0,
  pauseCalls: 0,
  holdSynthesis: false,
  releaseSynthesis: null as (() => void) | null,
  config: normalizeSpeechSettings({}),
  choirCanControlSound: false,
  choirSoundCalls: [] as boolean[],
  choirPatches: [] as SpeechSettings[],
  bumpProfile(id: string, revision: string) { profiles[id]!.updated_at = revision; },
  setProfileVoice(id: string, voice: string) { profiles[id]!.voice = voice; },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  fixture.requests.push({ method: init.method ?? "GET", url, body });
  const path = url.split("?")[0]!;
  if (path === "/api/v1/tts-connections") return json({ data: Object.values(profiles), total: Object.keys(profiles).length });
  const voicesMatch = /^\/api\/v1\/tts-connections\/([^/]+)\/voices$/.exec(path);
  if (voicesMatch) return json({ voices: [{ id: "Kore", name: "Kore (Firm)" }, { id: "Puck", name: "Puck (Upbeat)" }], provider: "openrouter_tts" });
  const profileMatch = /^\/api\/v1\/tts-connections\/([^/]+)$/.exec(path);
  if (profileMatch) {
    const profile = profiles[profileMatch[1]!];
    return profile ? json(profile) : json({ error: "Not found" }, 404);
  }
  if (path === "/api/v1/tts/synthesize") {
    if (fixture.holdSynthesis) {
      await new Promise<void>((resolve) => { fixture.releaseSynthesis = resolve; });
      fixture.releaseSynthesis = null;
    }
    return new Response(new Blob([new Uint8Array(64)], { type: "audio/mpeg" }), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  }
  return json({ error: `unhandled ${path}` }, 500);
};

class RecordingAudio implements SpeechAudioElement {
  src = "";
  volume = 1;
  currentTime = 0;
  private listeners = new Map<string, Array<() => void>>();
  async play(): Promise<void> { fixture.playCalls += 1; }
  pause(): void { fixture.pauseCalls += 1; }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  emitEnded(): void { for (const listener of this.listeners.get("ended") ?? []) listener(); }
}

const audio = new RecordingAudio();
const transport = createSpeechTransport({ fetchImpl });

// A small fixed strip like the overlay corner: never covers the settings below.
const dockMount = document.createElement("div");
Object.assign(dockMount.style, { position: "fixed", left: "0", bottom: "0", width: "420px", height: "90px" });
document.body.append(dockMount);
Object.assign(document.body.style, { margin: "0", background: "#0a0a12", minHeight: "100vh" });

const dock = new SpeechDock({
  mount: dockMount,
  onPlay: () => { void controller.playCurrent(); },
  onPause: () => controller.pause(),
  onStop: () => controller.stop("user-stop"),
});
const controller = new SpeechController({
  transport,
  onStatus: (status) => { fixture.statuses.push(status); dock.setStatus(status); },
  createAudio: () => audio,
});
const settingsMount = document.createElement("div");
document.body.append(settingsMount);
const section = new SpeechSettingsSection({
  mount: settingsMount,
  onSave: (speech) => {
    // Simulate the backend round-trip: normalize + echo, like vn_set_config -> vn_config.
    fixture.patches.push(speech);
    fixture.config = normalizeSpeechSettings(speech);
    section.setConfig(fixture.config);
    controller.setSettings(fixture.config);
    dock.setEnabled(fixture.config.enabled);
  },
  listProfiles: () => transport.listProfiles(new AbortController().signal),
  listVoices: (connectionId) => transport.listVoices(connectionId, new AbortController().signal),
  getChatId: () => "chat-1",
});
section.setConfig(fixture.config);
controller.setSettings(fixture.config);
dock.setEnabled(fixture.config.enabled);

// The same card as the host renders it with Choir installed (mounted second).
const choirMount = document.createElement("div");
choirMount.setAttribute("data-choir-section", "");
document.body.append(choirMount);
const choirSection = new SpeechSettingsSection({
  mount: choirMount,
  onSave: (speech) => { fixture.choirPatches.push(speech); choirSection.setConfig(normalizeSpeechSettings(speech)); },
  onOpenChoir: () => {},
  isChoirAvailable: () => true,
  canControlChoirSound: () => fixture.choirCanControlSound,
  onChoirSoundChange: (on) => { fixture.choirSoundCalls.push(on); },
});
choirSection.setConfig(normalizeSpeechSettings({}));

Object.assign(window, {
  speechFixture: Object.assign(fixture, {
    controller,
    activate: () => { controller.setActive(true); dock.setOverlayActive(true); },
    deactivate: () => { controller.setActive(false); dock.setOverlayActive(false); },
    setCursor: (paragraphIndex: number, text: string, paragraphSpeaker: string | null | undefined) => {
      controller.setCursor({
        chatId: "chat-1",
        messageId: "msg-1",
        sourceFingerprint: "fp-1",
        paragraphIndex,
        text,
        paragraphSpeaker,
        turnSpeaker: "Mira",
      });
    },
    endAudio: () => audio.emitEnded(),
    dock,
    choirSection,
    applySpeech: (patch: Record<string, unknown>) => {
      fixture.config = normalizeSpeechSettings({ ...fixture.config, ...patch });
      section.setConfig(fixture.config);
      controller.setSettings(fixture.config);
      dock.setEnabled(fixture.config.enabled);
    },
  }),
});
document.body.setAttribute("data-speech-fixture-ready", "1");
