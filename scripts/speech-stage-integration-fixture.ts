import { VnStage } from "../src/frontend/stage/vn-stage.js";
import { PanelDock } from "../src/frontend/stage/panel-dock.js";
import { SpeechDock } from "../src/frontend/speech/ui.js";
import { SpeechController } from "../src/frontend/speech/controller.js";
import { ChoirBridge, type ChoirBridgeApi } from "../src/frontend/host/choir-bridge.js";
import { normalizeSpeechSettings } from "../src/speech-config.js";
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

/** A fake Choir: each paragraph keeps "playing" until `finishParagraph()` (or an abort). */
let finishParagraph: (() => void) | null = null;
const choirApi: ChoirBridgeApi = {
  version: 1,
  isAvailable: () => true,
  isNarratorMuted: () => false,
  setNarratorMuted: () => {},
  openDrawer: () => {},
  stop: () => { logs.push("choir:stop"); },
  playParagraph: (request) => new Promise((resolve) => {
    logs.push(`choir:play:${request.paragraphIndex}`);
    request.onStatus?.({ kind: "playing" });
    finishParagraph = () => { logs.push(`choir:ended:${request.paragraphIndex}`); resolve({ played: 1 }); };
    request.signal?.addEventListener("abort", () => resolve({ played: 0 }));
  }),
};
(window as unknown as { __CHOIR_API__: ChoirBridgeApi }).__CHOIR_API__ = choirApi;
const choirBridge = new ChoirBridge(window);

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
  choirBridge,
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

speech.setSettings(normalizeSpeechSettings({ enabled: true }));
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

(window as any).fixture = {
  logs,
  stage,
  speech,
  speechDock,
  syncCursor,
  finishParagraph: () => finishParagraph?.(),
};
document.body.setAttribute("data-integration-ready", "1");
