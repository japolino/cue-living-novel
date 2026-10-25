/**
 * The real frontend host (`setupVisualNovelFrontend`) on the stage tests' fake
 * DOM, with a fake Spindle frontend context: tests feed it backend messages
 * and read what the reader sees.
 */
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../../config.js";
import type { BackendResponse, TurnView } from "../../../protocol.js";
import { FakeEvent, FakeNode, installFakeDocument } from "../../stage/stage-test-dom.js";
import { setupVisualNovelFrontend } from "../controller.js";

type Globals = Record<string, unknown>;

/** Browser pieces the host touches outside the stage, stubbed; returns the restore. */
function installHostGlobals(audio: string[]): () => void {
  const restoreDocument = installFakeDocument();
  const g = globalThis as Globals;
  const doc = g.document as Globals;
  const previous = { ...Object.fromEntries(["window", "ResizeObserver", "MutationObserver", "Audio", "Image", "fetch", "addEventListener", "removeEventListener"].map((key) => [key, g[key]])) };
  // Host requests (TTS profiles, synthesis) stay pending: tests see what starts, not what answers.
  g.fetch = () => new Promise<Response>(() => {});
  doc.addEventListener = () => {};
  doc.removeEventListener = () => {};
  doc.hidden = false;
  // Other extensions' widgets the host looks for (Panels capture): none here.
  doc.querySelectorAll ??= () => [];
  g.window = globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  g.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  g.Audio = class {
    volume = 1; loop = false; currentTime = 0; paused = true; src: string;
    constructor(src = "") { this.src = src; audio.push(src); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    addEventListener() {} removeEventListener() {} removeAttribute() {} load() {}
  };
  g.Image = class {
    decoding = ""; private listeners = new Map<string, () => void>(); private value = "";
    get src() { return this.value; }
    set src(url: string) { this.value = url; setTimeout(() => this.listeners.get("load")?.(), 0); }
    addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); }
    removeEventListener(type: string) { this.listeners.delete(type); }
    decode() { return Promise.resolve(); }
  };
  const proto = FakeNode.prototype as unknown as Globals;
  const hadToggle = "toggleAttribute" in proto;
  const hadRect = "getBoundingClientRect" in proto;
  proto.getBoundingClientRect ??= () => ({ x: 0, y: 0, top: 0, left: 0, right: 1280, bottom: 720, width: 1280, height: 720 });
  proto.toggleAttribute ??= function (this: FakeNode, name: string, force?: boolean) {
    const on = force ?? !this.hasAttribute(name);
    if (on) this.setAttribute(name, ""); else this.removeAttribute(name);
    return on;
  };
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete g[key]; else g[key] = value;
    }
    if (!hadToggle) delete proto.toggleAttribute;
    if (!hadRect) delete proto.getBoundingClientRect;
    restoreDocument();
  };
}

export type HostHarness = ReturnType<typeof bootHost>;

export function bootHost(options: { chatId?: string; config?: Partial<VisualNovelConfig> } = {}) {
  const chatId = options.chatId ?? "chat";
  const audio: string[] = [];
  const restore = installHostGlobals(audio);
  const sent: Array<Record<string, unknown>> = [];
  const root = new FakeNode("div");
  let backend: (payload: unknown) => void = () => {};
  let toggle: () => void = () => {};
  const ctx = {
    ui: {
      mountApp: () => ({ root, setVisible() {}, destroy() {} }),
      mount: () => new FakeNode("div"),
      registerComponentOverride: () => ({ destroy() {} }),
      registerInputBarAction: () => ({ setLabel() {}, destroy() {}, onClick: (fn: () => void) => { toggle = fn; return () => {}; } }),
    },
    events: { on: () => () => {} },
    getActiveChat: () => ({ chatId, characterId: "c1" }),
    dom: { findMessageElement: () => null },
    messages: { getLatestMessageId: () => "m1" },
    ready: () => {},
    onBackendMessage: (fn: (payload: unknown) => void) => { backend = fn; return () => {}; },
    sendToBackend: (message: Record<string, unknown>) => { sent.push(message); },
  };
  const cleanup = setupVisualNovelFrontend(ctx as never);
  const config: VisualNovelConfig = { ...DEFAULT_CONFIG, textSpeed: 0, ...options.config };
  const query = (selector: string) => root.querySelector(selector);
  const harness = {
    chatId, sent, audio, root,
    receive: (message: BackendResponse) => backend(message),
    /** A `vn_state` for this chat (the host's answer to activation and reopening). */
    state: (turn: TurnView | null) => backend({ type: "vn_state", chatId, config, turn }),
    /** The input bar button: opens or closes the view. */
    toggle: () => toggle(),
    text: () => query("[data-vn-dialogue-text]")?.textContent ?? "",
    speaker: () => {
      const plate = query("[data-vn-speaker]");
      return plate && !plate.hidden ? plate.textContent : "";
    },
    badges: () => root.querySelectorAll("[data-vn-badge]").map((badge) => badge.textContent.trim()),
    flash: () => query("[data-vn-flash]")?.getAttribute("data-vn-flash") ?? null,
    /** The speech dock's status line ("Speech ready — Mira"). */
    speech: () => query("[data-status]")?.textContent ?? "",
    /** The speech dock's Play button. */
    play: () => query("[data-dock] button")!.dispatchEvent(new FakeEvent("click")),
    sceneImage: () => query("[data-vn-scene-image][data-vn-layer='active']")?.getAttribute("src") ?? null,
    continueDisabled: () => Boolean(query("[data-vn-continue]")?.disabled),
    /** Type a reply into the composer and send it. */
    reply: (content: string) => {
      const input = query("[data-vn-input]")!;
      (input as unknown as { value: string }).value = content;
      input.dispatchEvent(new FakeEvent("input"));
      query("[data-vn-input-form]")!.dispatchEvent(new FakeEvent("submit"));
    },
    /** Back one paragraph, as a click on the stage's button. */
    previous: () => query("[data-vn-control='previous']")!.dispatchEvent(new FakeEvent("click")),
    /** Continue, as a click on the stage's button. */
    next: () => query("[data-vn-continue]")!.dispatchEvent(new FakeEvent("click")),
    destroy: () => { cleanup(); restore(); },
  };
  return harness;
}

/** Let queued timers and promise callbacks run. */
export const flush = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));
