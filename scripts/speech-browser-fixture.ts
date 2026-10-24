import { SpeechController, type SpeechStatus } from "../src/frontend/speech/controller.js";
import { SpeechDock } from "../src/frontend/speech/ui.js";
import { SpeechSettingsSection } from "../src/frontend/speech/settings-ui.js";
import { ChoirBridge, type ChoirBridgeApi, type ChoirParagraphRequest } from "../src/frontend/host/choir-bridge.js";
import { normalizeSpeechSettings, type SpeechSettings } from "../src/speech-config.js";

/**
 * Offline browser fixture for read aloud: a fake Choir on `window.__CHOIR_API__`
 * (recorded, never leaving the page) behind the real ChoirBridge, with the
 * real controller, dock and settings card. No real host, no provider, no paid
 * calls.
 */

const fixture = {
  paragraphs: [] as Array<{ text: string; speaker?: string | undefined; paragraphIndex?: number | undefined }>,
  stopCalls: 0,
  patches: [] as SpeechSettings[],
  statuses: [] as SpeechStatus[],
  muteCalls: [] as boolean[],
  choirSoundCalls: [] as boolean[],
  choirCanControlSound: false,
  /** Settles the paragraph Choir is reading, with a late "playing" first when asked. */
  finishParagraph: null as ((lateStatus?: boolean) => void) | null,
  config: normalizeSpeechSettings({}),
};

const choirApi: ChoirBridgeApi = {
  version: 1,
  isAvailable: () => true,
  isNarratorMuted: () => false,
  setNarratorMuted: (muted) => { fixture.muteCalls.push(muted); },
  openDrawer: () => {},
  stop: () => { fixture.stopCalls += 1; },
  playParagraph: (request: ChoirParagraphRequest) => new Promise((resolve) => {
    fixture.paragraphs.push({ text: request.text, speaker: request.speaker, paragraphIndex: request.paragraphIndex });
    request.onStatus?.({ kind: "playing" });
    fixture.finishParagraph = (lateStatus = false) => {
      if (lateStatus) request.onStatus?.({ kind: "playing" });
      resolve({ played: 1 });
    };
  }),
};
Object.defineProperty(choirApi, "setSoundEnabled", {
  get: () => fixture.choirCanControlSound ? (on: boolean) => { fixture.choirSoundCalls.push(on); } : undefined,
});
(window as unknown as { __CHOIR_API__: ChoirBridgeApi }).__CHOIR_API__ = choirApi;
const choirBridge = new ChoirBridge(window);

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
  choirBridge,
  onStatus: (status) => { fixture.statuses.push(status); dock.setStatus(status); },
});

function apply(config: SpeechSettings): void {
  fixture.config = config;
  section.setConfig(config);
  controller.setSettings(config);
  // Like the host: the dock shows while read aloud is on and Choir is there.
  dock.setEnabled(config.enabled && choirBridge.isAvailable());
}

const settingsMount = document.createElement("div");
document.body.append(settingsMount);
const section = new SpeechSettingsSection({
  mount: settingsMount,
  // Simulate the backend round-trip: normalize + echo, like vn_set_config -> vn_config.
  onSave: (speech) => { fixture.patches.push(speech); apply(normalizeSpeechSettings(speech)); },
  onOpenChoir: () => {},
  isChoirAvailable: () => choirBridge.isAvailable(),
  onMuteNarratorChange: (muted) => choirBridge.setNarratorMuted(muted),
  canControlChoirSound: () => choirBridge.canControlSound(),
  onChoirSoundChange: (on) => choirBridge.setSoundEnabled(on),
});
apply(fixture.config);

// The card a page without Choir would render (mounted second).
const noChoirMount = document.createElement("div");
noChoirMount.setAttribute("data-no-choir-section", "");
document.body.append(noChoirMount);
new SpeechSettingsSection({ mount: noChoirMount, onSave: () => {}, isChoirAvailable: () => false }).setConfig(normalizeSpeechSettings({}));

Object.assign(window, {
  speechFixture: Object.assign(fixture, {
    controller,
    section,
    dock,
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
  }),
});
document.body.setAttribute("data-speech-fixture-ready", "1");
