import type { SpeechSettings } from "../../speech-config.js";
import { DEFAULT_SPEECH_SETTINGS } from "../../speech-config.js";
import { stripTextEffectTags } from "../../shared/text-effects.js";
import type { ChoirBridge } from "../host/choir-bridge.js";

/**
 * Frontend read-aloud player for the CURRENT assistant paragraph, voiced by
 * the Choir companion extension.
 *
 * Design rules:
 * - default-off: while disabled, inactive, hidden, or disposed, NO request is
 *   ever issued, no matter how many state updates arrive;
 * - with read aloud on, each new paragraph is read as it appears, once the
 *   page has had a user gesture (browser autoplay policy) or after one Play;
 * - one paragraph at a time; no automatic retries; no prefetch;
 * - every boundary (cursor change, chat change, deactivate, hidden page,
 *   settings change, disposal) bumps the epoch and aborts the paragraph in
 *   flight, and a late status is dropped — a stale paragraph never plays;
 * - without Choir, Play reports a truthful "unconfigured" status and nothing
 *   is read.
 */

export type SpeechCursor = {
  chatId: string;
  messageId: string;
  sourceFingerprint: string;
  paragraphIndex: number;
  text: string;
  nextText?: string | undefined;
  /** Raw paragraph attribution: "" narrator, name, or null/undefined = unknown. */
  paragraphSpeaker: string | null | undefined;
  turnSpeaker: string;
};

export type SpeechStatus =
  | { kind: "off" }
  | { kind: "idle"; speaker?: string }
  | { kind: "loading"; speaker?: string }
  | { kind: "playing"; speaker?: string }
  | { kind: "paused"; speaker?: string }
  | { kind: "unconfigured"; message: string }
  | { kind: "error"; message: string };

export type SpeechControllerOptions = {
  choirBridge?: Pick<ChoirBridge, "isAvailable" | "stop" | "playParagraph"> | undefined;
  onStatus?: ((status: SpeechStatus) => void) | undefined;
  /** Whether the page has had a user gesture yet; defaults to `navigator.userActivation`. */
  hasUserActivation?: (() => boolean) | undefined;
};

/** Shown when read aloud is on but Choir is not running in this page. */
export const CHOIR_MISSING_MESSAGE = "Read aloud needs the Choir extension. Turn Choir on to hear this paragraph.";

function pageHasUserActivation(): boolean {
  const activation = typeof navigator !== "undefined"
    ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
    : undefined;
  return activation ? activation.hasBeenActive : true;
}

function sameCursorIdentity(left: SpeechCursor, right: SpeechCursor): boolean {
  return left.chatId === right.chatId
    && left.messageId === right.messageId
    && left.sourceFingerprint === right.sourceFingerprint
    && left.paragraphIndex === right.paragraphIndex
    && left.text === right.text
    && (left.paragraphSpeaker ?? null) === (right.paragraphSpeaker ?? null)
    && left.turnSpeaker === right.turnSpeaker;
}

export class SpeechController {
  private readonly choirBridge: SpeechControllerOptions["choirBridge"];
  private readonly onStatus: (status: SpeechStatus) => void;
  private readonly hasUserActivation: () => boolean;

  private settings: SpeechSettings = DEFAULT_SPEECH_SETTINGS;
  private cursor: SpeechCursor | null = null;
  private active = false;
  private visible = true;
  private disposed = false;
  /** Any boundary bump invalidates the paragraph in flight and its late statuses. */
  private epoch = 0;
  private inflight: AbortController | null = null;
  /** A manual Play counts as the user gesture the browser asks for. */
  private gestureUnlocked = false;
  private status: SpeechStatus = { kind: "off" };

  constructor(options: SpeechControllerOptions) {
    this.choirBridge = options.choirBridge;
    this.onStatus = options.onStatus ?? (() => undefined);
    this.hasUserActivation = options.hasUserActivation ?? pageHasUserActivation;
  }

  getStatus(): SpeechStatus {
    return this.status;
  }

  setSettings(next: SpeechSettings): void {
    if (this.disposed) return;
    const previous = this.settings;
    this.settings = next;
    // Only these change what is read; reading before the plan only changes when.
    if (previous.enabled !== next.enabled || previous.muteNarrator !== next.muteNarrator) {
      this.stop("settings-changed");
    }
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) this.stop("deactivated");
    this.publishBaseline();
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (!visible && this.inflight) this.pause();
  }

  /** Chat switch/fork: hard boundary — cursor and playback reset. */
  onChatChanged(): void {
    if (this.disposed) return;
    this.cursor = null;
    this.stop("chat-changed");
  }

  /**
   * Point at the current assistant paragraph. An IDENTICAL cursor (same chat,
   * message, fingerprint, paragraph, text) is a no-op so same-turn rebroadcasts
   * and image/asset updates never replay speech. A new paragraph is read at
   * once while read aloud is on.
   */
  setCursor(cursor: SpeechCursor | null): void {
    if (this.disposed) return;
    if (cursor && this.cursor && sameCursorIdentity(this.cursor, cursor)) return;
    this.cursor = cursor;
    // Choir hands off between paragraphs itself (the aborted one stops its own
    // speech), so its ambience and music beds keep running across paragraphs.
    this.abortInflight("cursor-changed");
    this.publishBaseline();
    if (cursor && this.eligible() && this.choirBridge?.isAvailable() && (this.gestureUnlocked || this.hasUserActivation())) {
      void this.playCurrent();
    }
  }

  pause(): void {
    if (this.disposed || !this.inflight) return;
    this.choirBridge?.stop();
    // Drop the paragraph in flight so its late status cannot undo the pause.
    this.abortInflight("paused");
    this.publish({ kind: "paused", ...this.speakerLabel() });
  }

  stop(reason: string): void {
    if (this.disposed) return;
    if (this.inflight) this.choirBridge?.stop();
    this.abortInflight(reason);
    this.publishBaseline();
  }

  /**
   * Play (or play again) the current paragraph through Choir. Choir cannot
   * resume mid-paragraph, so Play after Pause starts the paragraph over.
   */
  async playCurrent(): Promise<void> {
    if (this.disposed || !this.settings.enabled) return;
    if (!this.eligible()) {
      this.publishBaseline();
      return;
    }
    const bridge = this.choirBridge;
    if (!bridge?.isAvailable()) {
      this.publish({ kind: "unconfigured", message: CHOIR_MISSING_MESSAGE });
      return;
    }
    const cursor = this.cursor!;
    this.gestureUnlocked = true;
    this.abortInflight("superseded");
    const myEpoch = this.epoch;
    const abort = new AbortController();
    this.inflight = abort;
    this.publish({ kind: "loading", ...this.speakerLabel() });

    try {
      await bridge.playParagraph({
        text: stripTextEffectTags(cursor.text),
        speaker: this.speakerLabel().speaker,
        nextText: cursor.nextText ? stripTextEffectTags(cursor.nextText) : undefined,
        chatId: cursor.chatId,
        messageId: cursor.messageId,
        paragraphIndex: cursor.paragraphIndex,
        signal: abort.signal,
        onStatus: (st) => {
          if (this.disposed || myEpoch !== this.epoch) return;
          const speaker = st.speaker ?? this.speakerLabel().speaker;
          if (st.kind === "playing") {
            this.publish(speaker !== undefined ? { kind: "playing", speaker } : { kind: "playing" });
          } else if (st.kind === "loading") {
            this.publish(speaker !== undefined ? { kind: "loading", speaker } : { kind: "loading" });
          } else if (st.kind === "idle") {
            this.publish(speaker !== undefined ? { kind: "idle", speaker } : { kind: "idle" });
          }
        },
      });
      if (this.disposed || myEpoch !== this.epoch) return;
      this.inflight = null;
      this.publishBaseline();
    } catch (err) {
      if (this.disposed || myEpoch !== this.epoch) return;
      this.inflight = null;
      if (abort.signal.aborted) {
        this.publishBaseline();
        return;
      }
      this.publish({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.inflight) this.choirBridge?.stop();
    this.abortInflight("disposed");
    this.disposed = true;
  }

  /* ----------------------------------------------------------------------- */

  private eligible(): boolean {
    return !this.disposed
      && this.settings.enabled
      && this.active
      && this.visible
      && this.cursor !== null
      && stripTextEffectTags(this.cursor.text).trim().length > 0;
  }

  private speakerLabel(): { speaker?: string } {
    const cursor = this.cursor;
    if (!cursor) return {};
    const attributed = cursor.paragraphSpeaker;
    const name = attributed === undefined || attributed === null ? cursor.turnSpeaker : attributed;
    return name.trim() ? { speaker: name } : { speaker: "Narrator" };
  }

  private publish(status: SpeechStatus): void {
    this.status = status;
    this.onStatus(status);
  }

  private publishBaseline(): void {
    if (this.disposed) return;
    this.publish(this.eligible() ? { kind: "idle", ...this.speakerLabel() } : { kind: "off" });
  }

  private abortInflight(reason: string): void {
    this.epoch += 1;
    if (this.inflight) {
      const controller = this.inflight;
      this.inflight = null;
      controller.abort(reason);
    }
  }
}
