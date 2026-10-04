import type { SpeechSettings } from "../../speech-config.js";
import { DEFAULT_SPEECH_SETTINGS } from "../../speech-config.js";
import { DELIVERY_ADAPTER_VERSION, deliveryTagAllowedForModel, formatOutboundText } from "./delivery.js";
import { resolveVoiceForParagraph } from "./voice-resolution.js";
import { stripTextEffectTags } from "../../shared/text-effects.js";
import { SpeechTransportError, type TtsTransport } from "./transport.js";

/**
 * Frontend speech player for the CURRENT assistant paragraph.
 *
 * Design rules (see .cache/tts/HYPOTHESES.md):
 * - default-off: while disabled, inactive, hidden, or disposed, NO request is
 *   ever issued, no matter how many state updates arrive;
 * - one voice per whole paragraph (paragraph speaker metadata is name-level
 *   only; mixed narration/dialogue inside one paragraph is a documented limit);
 * - at most one in-flight synthesis request; no automatic retries; no prefetch;
 * - every boundary (cursor change, chat change, deactivate, hidden page,
 *   settings change, disposal) bumps the epoch, aborts the in-flight request,
 *   and drops any late completion — a stale response never plays and is never
 *   cached;
 * - an unconfigured voice yields a truthful "unconfigured" status, never a
 *   silent first-profile fallback;
 * - a session-only LRU blob cache; every object URL is revoked exactly once.
 */

export type SpeechCursor = {
  chatId: string;
  messageId: string;
  sourceFingerprint: string;
  paragraphIndex: number;
  text: string;
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
  | { kind: "blocked"; message: string }
  | { kind: "unconfigured"; message: string }
  | { kind: "error"; message: string };

/** Narrow audio-element surface so tests can inject a fake. */
export type SpeechAudioElement = {
  src: string;
  volume: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export type SpeechControllerOptions = {
  transport: TtsTransport;
  onStatus?: (status: SpeechStatus) => void;
  createAudio?: () => SpeechAudioElement;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  maxCacheItems?: number;
  maxCacheBytes?: number;
};

const DEFAULT_MAX_CACHE_ITEMS = 16;
const DEFAULT_MAX_CACHE_BYTES = 32 * 1024 * 1024;

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
  private readonly transport: TtsTransport;
  private readonly onStatus: (status: SpeechStatus) => void;
  private readonly createAudio: () => SpeechAudioElement;
  private readonly createObjectUrl: (blob: Blob) => string;
  private readonly revokeObjectUrl: (url: string) => void;
  private readonly maxCacheItems: number;
  private readonly maxCacheBytes: number;

  private settings: SpeechSettings = DEFAULT_SPEECH_SETTINGS;
  private cursor: SpeechCursor | null = null;
  private active = false;
  private visible = true;
  private disposed = false;
  /** Any boundary bump invalidates in-flight work and late completions. */
  private epoch = 0;
  private inflight: AbortController | null = null;
  /** Session LRU: cache key -> revocable object URL. Never stores failures. */
  private readonly cache = new Map<string, { url: string; bytes: number }>();
  private cacheBytes = 0;
  private audio: SpeechAudioElement | null = null;
  /** Cache key currently loaded into the audio element (for pause/resume). */
  private loadedKey: string | null = null;
  private playState: "stopped" | "playing" | "paused" = "stopped";
  /** True while an audio.play() promise is unsettled; pause() during this window is remembered. */
  private starting = false;
  private pauseRequested = false;
  /** Autoplay may only start after one successful user-gesture play. */
  private gestureUnlocked = false;
  private status: SpeechStatus = { kind: "off" };

  constructor(options: SpeechControllerOptions) {
    this.transport = options.transport;
    this.onStatus = options.onStatus ?? (() => undefined);
    this.createAudio = options.createAudio ?? (() => new Audio());
    this.createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
    this.revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
    this.maxCacheItems = options.maxCacheItems ?? DEFAULT_MAX_CACHE_ITEMS;
    this.maxCacheBytes = options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
  }

  getStatus(): SpeechStatus {
    return this.status;
  }

  setSettings(next: SpeechSettings): void {
    if (this.disposed) return;
    const previous = this.settings;
    this.settings = next;
    if (this.audio) this.audio.volume = next.volume;
    const voicesChanged = JSON.stringify({ ...previous, volume: 0, autoplay: false })
      !== JSON.stringify({ ...next, volume: 0, autoplay: false });
    if (voicesChanged) {
      // A profile/voice/delivery change invalidates everything synthesized so far.
      this.stop("settings-changed");
      this.clearCache();
      this.publishBaseline();
    }
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    if (!active) {
      this.stop("deactivated");
      this.clearCache();
    }
    this.publishBaseline();
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.abortInflight("hidden");
      if (this.playState === "playing") this.pause();
    }
  }

  /** Chat switch/fork: hard boundary — cursor, playback, and cache all reset. */
  onChatChanged(): void {
    if (this.disposed) return;
    this.cursor = null;
    this.stop("chat-changed");
    this.clearCache();
    this.publishBaseline();
  }

  /**
   * Point at the current assistant paragraph. An IDENTICAL cursor (same chat,
   * message, fingerprint, paragraph, text) is a no-op so same-turn rebroadcasts
   * and image/asset updates never replay speech.
   */
  setCursor(cursor: SpeechCursor | null): void {
    if (this.disposed) return;
    if (cursor && this.cursor && sameCursorIdentity(this.cursor, cursor)) return;
    this.cursor = cursor;
    this.stop("cursor-changed");
    this.publishBaseline();
    if (cursor && this.settings.autoplay && this.gestureUnlocked && this.eligible()) {
      void this.playCurrent({ auto: true });
    }
  }

  pause(): void {
    if (this.disposed) return;
    if (this.starting) {
      // Playback was dispatched but audio.play() has not settled yet: remember
      // the pause so the post-await path settles to paused instead of playing.
      this.pauseRequested = true;
      this.audio?.pause();
      this.playState = "paused";
      this.publish({ kind: "paused", ...this.speakerLabel() });
      return;
    }
    if (this.playState !== "playing") return;
    this.audio?.pause();
    this.playState = "paused";
    this.publish({ kind: "paused", ...this.speakerLabel() });
  }

  stop(reason: string): void {
    void reason;
    if (this.disposed) return;
    this.pauseRequested = false;
    this.starting = false;
    this.abortInflight(reason);
    if (this.audio && this.playState !== "stopped") {
      this.audio.pause();
      try { this.audio.currentTime = 0; } catch { /* not seekable yet */ }
    }
    this.playState = "stopped";
    this.loadedKey = null;
    this.publishBaseline();
  }

  /**
   * Manual Play/Resume for the current paragraph. This is the only entry point
   * that can start a synthesis request, and only when every eligibility gate
   * holds at dispatch time AND when the response arrives.
   */
  async playCurrent(options: { auto?: boolean } = {}): Promise<void> {
    if (this.disposed || !this.settings.enabled) return;
    if (!this.eligible()) {
      this.publishBaseline();
      return;
    }
    const cursor = this.cursor!;
    const resolved = resolveVoiceForParagraph(this.settings, {
      chatId: cursor.chatId,
      paragraphSpeaker: cursor.paragraphSpeaker,
      turnSpeaker: cursor.turnSpeaker,
    });
    if (!resolved.ref) {
      const who = resolved.role === "narrator" ? "the narrator" : `“${resolved.speakerName}”`;
      this.publish({
        kind: "unconfigured",
        message: `No voice is set for ${who}. Choose one under Settings → Visual novel speech.`,
      });
      return;
    }
    // Resume without new requests when the same audio is merely paused. Every
    // boundary (cursor/settings/chat/close) clears the paused state, so a
    // paused player always holds audio for the current cursor and settings.
    // Profile-revision checking happens on each FRESH Play dispatch below.
    if (this.playState === "paused" && this.loadedKey !== null && this.audio) {
      await this.tryPlay(this.audio, this.loadedKey, options.auto === true, this.epoch);
      return;
    }

    this.abortInflight("superseded");
    const myEpoch = ++this.epoch;
    const abort = new AbortController();
    this.inflight = abort;
    this.publish({ kind: "loading", ...this.speakerLabel() });

    // Refresh the profile revision first (host DB read, never a provider call):
    // the cache key includes updated_at + model + effective voice + default-
    // parameter fingerprint, so a host-side profile edit can never silently
    // replay audio synthesized under the previous revision.
    let snapshot;
    try {
      snapshot = await this.transport.getProfile(resolved.ref.connectionId, abort.signal);
    } catch (error) {
      if (this.inflight === abort) this.inflight = null;
      if (this.disposed || myEpoch !== this.epoch) return;
      if (error instanceof SpeechTransportError && error.kind === "timeout") {
        this.publish({ kind: "error", message: error.message });
        return;
      }
      if (error instanceof SpeechTransportError && error.kind === "aborted") {
        this.publishBaseline();
        return;
      }
      // Without current revision metadata we refuse to guess: no synthesis.
      this.publish({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (this.disposed || myEpoch !== this.epoch) return;

    // Tags are injected only for a Gemini-family model on the selected profile,
    // or through the clearly-labeled all-providers compatibility opt-in.
    const tagAllowed = deliveryTagAllowedForModel(
      this.settings.deliveryMode,
      snapshot.model,
      this.settings.deliveryAllProviders,
    );
    // Text effect tags (<shake>, <whisper>, ...) are display markup: never read them aloud.
    const spoken = stripTextEffectTags(cursor.text);
    const outbound = tagAllowed
      ? formatOutboundText(spoken, this.settings.deliveryMode, this.settings.deliveryTag)
      : spoken;
    const effectiveVoice = resolved.ref.voice || snapshot.voice;
    const key = [
      "v" + DELIVERY_ADAPTER_VERSION,
      resolved.ref.connectionId,
      snapshot.updatedAt,
      snapshot.model,
      effectiveVoice,
      resolved.ref.parameters?.speed ?? "",
      snapshot.parametersFingerprint,
      outbound,
    ].join("\u0000");

    const cached = this.cache.get(key);
    if (cached) {
      if (this.inflight === abort) this.inflight = null;
      // LRU touch.
      this.cache.delete(key);
      this.cache.set(key, cached);
      await this.playUrl(cached.url, key, myEpoch, options.auto === true);
      return;
    }

    let blob: Blob;
    try {
      blob = await this.transport.synthesize({ ref: resolved.ref, text: outbound }, abort.signal);
    } catch (error) {
      if (this.inflight === abort) this.inflight = null;
      if (this.disposed || myEpoch !== this.epoch) return; // superseded: stay quiet
      if (error instanceof SpeechTransportError && error.kind === "timeout") {
        this.publish({ kind: "error", message: error.message });
        return;
      }
      if (error instanceof SpeechTransportError && error.kind === "aborted") {
        this.publishBaseline();
        return;
      }
      this.publish({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (this.inflight === abort) this.inflight = null;
    // A response that lands after any boundary is dropped: never played, never cached.
    if (this.disposed || myEpoch !== this.epoch) return;
    if (blob.size === 0) {
      this.publish({ kind: "error", message: "The TTS endpoint returned empty audio." });
      return;
    }
    const url = this.createObjectUrl(blob);
    this.cache.set(key, { url, bytes: blob.size });
    this.cacheBytes += blob.size;
    // Protect the entry being played: eviction must take older entries first
    // and never revoke this URL before the element loads it.
    this.evictOverflow(key);
    await this.playUrl(url, key, myEpoch, options.auto === true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.pauseRequested = false;
    this.starting = false;
    this.abortInflight("disposed");
    if (this.audio) {
      this.audio.pause();
      this.audio.removeEventListener("ended", this.handleEnded);
      this.audio.src = "";
    }
    this.playState = "stopped";
    this.loadedKey = null;
    this.clearCache();
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

  private ensureAudio(): SpeechAudioElement {
    if (!this.audio) {
      this.audio = this.createAudio();
      this.audio.addEventListener("ended", this.handleEnded);
    }
    this.audio.volume = this.settings.volume;
    return this.audio;
  }

  private readonly handleEnded = (): void => {
    if (this.disposed) return;
    this.playState = "stopped";
    this.publishBaseline();
  };

  private async playUrl(url: string, key: string, myEpoch: number, auto: boolean): Promise<void> {
    // A boundary that lands before the element is touched must leave it alone:
    // never point shared audio at a stale URL.
    if (myEpoch !== this.epoch || this.disposed) return;
    const audio = this.ensureAudio();
    audio.src = url;
    try { audio.currentTime = 0; } catch { /* not seekable yet */ }
    if (myEpoch !== this.epoch || this.disposed) return;
    this.loadedKey = key;
    await this.tryPlay(audio, key, auto, myEpoch);
  }

  private async tryPlay(audio: SpeechAudioElement, key: string, auto: boolean, myEpoch: number): Promise<void> {
    audio.volume = this.settings.volume;
    this.starting = true;
    try {
      await audio.play();
    } catch (error) {
      this.starting = false;
      // A stop/dispose that lands while play() is pending already published
      // its own state; a late rejection must not overwrite it or resurrect.
      if (this.disposed || myEpoch !== this.epoch) return;
      this.pauseRequested = false;
      this.playState = "paused";
      this.loadedKey = key;
      // Browser autoplay policy rejection is expected for auto starts; a manual
      // gesture Play from the dock is the recovery path. Never retried silently.
      this.publish({
        kind: "blocked",
        message: auto
          ? "The browser blocked automatic sound. Press Play once to allow speech."
          : `Playback was blocked: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    this.starting = false;
    // Late success after stop/dispose: pause the element again and stay quiet.
    if (this.disposed || myEpoch !== this.epoch) {
      try { audio.pause(); } catch { /* already torn down */ }
      return;
    }
    if (this.pauseRequested) {
      this.pauseRequested = false;
      try { audio.pause(); } catch { /* not pausable yet */ }
      this.playState = "paused";
      this.loadedKey = key;
      this.publish({ kind: "paused", ...this.speakerLabel() });
      return;
    }
    if (!auto) this.gestureUnlocked = true;
    this.playState = "playing";
    this.publish({ kind: "playing", ...this.speakerLabel() });
  }

  /**
   * Evict oldest entries while over either cap. `protectKey` (the entry being
   * played, if any) is evicted last: older entries go first, and a lone
   * oversized entry is kept over the byte cap so its URL stays valid for the
   * element. Everything removed here is revoked exactly once.
   */
  private evictOverflow(protectKey?: string): void {
    while (this.cache.size > this.maxCacheItems || this.cacheBytes > this.maxCacheBytes) {
      const oldestEvictable = (): string | undefined => {
        let fallback: string | undefined;
        for (const candidate of this.cache.keys()) {
          if (candidate === this.loadedKey || candidate === protectKey) {
            fallback ??= candidate;
            continue;
          }
          return candidate;
        }
        return fallback;
      };
      const victim = oldestEvictable();
      if (victim === undefined) break;
      const entry = this.cache.get(victim)!;
      if (victim === this.loadedKey || victim === protectKey) {
        // A URL the element holds (or is about to load) cannot be revoked yet.
        // Keep a lone entry cached over the cap; otherwise drop tracking and
        // revoke later at clearCache/dispose, after the element moved on.
        if (this.cache.size === 1) break;
        this.cache.delete(victim);
        this.cacheBytes -= entry.bytes;
        this.pendingRevoke.push(entry.url);
        continue;
      }
      this.cache.delete(victim);
      this.cacheBytes -= entry.bytes;
      this.revokeObjectUrl(entry.url);
    }
  }

  private pendingRevoke: string[] = [];

  private clearCache(): void {
    for (const entry of this.cache.values()) this.revokeObjectUrl(entry.url);
    this.cache.clear();
    this.cacheBytes = 0;
    for (const url of this.pendingRevoke.splice(0)) this.revokeObjectUrl(url);
    if (this.audio) this.audio.src = "";
    this.loadedKey = null;
  }
}
