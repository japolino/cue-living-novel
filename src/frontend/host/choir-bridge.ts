/**
 * Companion extension bridge to Choir.
 *
 * Connects Cue to the Choir extension running in the same Lumiverse page window:
 * - Detects presence via window.__CHOIR_API__ and choir-available-v1 / choir-ping-v1 events.
 * - Controls Narrator Muting and opens Choir's voice setup drawer.
 * - Optionally (newer Choir) switches Choir's sound on/off and reports the music track playing.
 * - Slices and synthesizes paragraph speech via Choir's atomic dialogue/narration pipeline.
 */

export interface ChoirParagraphRequest {
  text: string;
  speaker?: string | undefined;
  nextText?: string | undefined;
  chatId?: string;
  messageId?: string;
  paragraphIndex?: number;
  signal?: AbortSignal;
  onStatus?: (status: { kind: "idle" | "loading" | "playing"; speaker?: string; message?: string }) => void;
}

/** The track Choir's music bed is playing; `credit` is the CC BY line to show. */
export type ChoirMusic = { title: string; credit: string };

export interface ChoirBridgeApi {
  version: number;
  isAvailable: () => boolean;
  getConfig?: () => Record<string, unknown>;
  isNarratorMuted: () => boolean;
  setNarratorMuted: (muted: boolean) => void;
  openDrawer: () => void;
  stop: () => void;
  playParagraph: (options: ChoirParagraphRequest) => Promise<{ played: number }>;
  /** Sets Choir's sound effects, ambience and music toggles together. */
  setSoundEnabled?: (on: boolean) => void;
  getMusic?: () => ChoirMusic | null;
}

export class ChoirBridge {
  private dead = false;
  private listeners = new Set<(available: boolean) => void>();
  private musicListeners = new Set<(music: ChoirMusic | null) => void>();
  private targetWindow: Window | null = null;
  private onAnnounceBound: ((event: Event) => void) | null = null;
  private onUnavailableBound: ((event: Event) => void) | null = null;
  private onMusicBound: ((event: Event) => void) | null = null;

  constructor(targetWindow: Window | null = typeof window !== "undefined" ? window : null) {
    this.targetWindow = targetWindow;
    if (this.targetWindow) {
      this.onAnnounceBound = () => this.handleAvailability(true);
      this.onUnavailableBound = () => this.handleAvailability(false);
      this.onMusicBound = (event) => this.emitMusic((event as CustomEvent<ChoirMusic | null>).detail ?? null);
      this.targetWindow.addEventListener("choir-available-v1", this.onAnnounceBound);
      this.targetWindow.addEventListener("choir-unavailable-v1", this.onUnavailableBound);
      this.targetWindow.addEventListener("choir-music-v1", this.onMusicBound);
      // Ping to check if Choir is already mounted
      this.targetWindow.dispatchEvent(new CustomEvent("choir-ping-v1"));
    }
  }

  private get api(): ChoirBridgeApi | null {
    if (this.dead || !this.targetWindow) return null;
    const api = (this.targetWindow as unknown as { __CHOIR_API__?: ChoirBridgeApi }).__CHOIR_API__;
    if (api && typeof api.isAvailable === "function" && api.isAvailable()) {
      return api;
    }
    return null;
  }

  isAvailable(): boolean {
    return Boolean(this.api);
  }

  isNarratorMuted(): boolean {
    return Boolean(this.api?.isNarratorMuted());
  }

  setNarratorMuted(muted: boolean): void {
    this.api?.setNarratorMuted(muted);
  }

  openDrawer(): void {
    this.api?.openDrawer();
  }

  stop(): void {
    this.api?.stop();
  }

  canControlSound(): boolean {
    return typeof this.api?.setSoundEnabled === "function";
  }

  setSoundEnabled(on: boolean): void {
    this.api?.setSoundEnabled?.(on);
  }

  getMusic(): ChoirMusic | null {
    return this.api?.getMusic?.() ?? null;
  }

  async playParagraph(options: ChoirParagraphRequest): Promise<{ played: number }> {
    const api = this.api;
    if (!api) {
      options.onStatus?.({ kind: "idle", message: "Choir extension is not active" });
      return { played: 0 };
    }
    return api.playParagraph(options);
  }

  onAvailabilityChange(callback: (available: boolean) => void): () => void {
    this.listeners.add(callback);
    callback(this.isAvailable());
    return () => this.listeners.delete(callback);
  }

  /** Calls back with the track playing now, then on every change; null when nothing plays or Choir leaves. */
  onMusicChange(callback: (music: ChoirMusic | null) => void): () => void {
    this.musicListeners.add(callback);
    callback(this.getMusic());
    return () => this.musicListeners.delete(callback);
  }

  private handleAvailability(available: boolean): void {
    if (this.dead) return;
    for (const listener of this.listeners) {
      try {
        listener(available);
      } catch {
        // Safe dispatch
      }
    }
    if (!available) this.emitMusic(null);
  }

  private emitMusic(music: ChoirMusic | null): void {
    if (this.dead) return;
    for (const listener of this.musicListeners) {
      try {
        listener(music);
      } catch {
        // Safe dispatch
      }
    }
  }

  destroy(): void {
    this.dead = true;
    if (this.targetWindow && this.onAnnounceBound && this.onUnavailableBound && this.onMusicBound) {
      this.targetWindow.removeEventListener("choir-available-v1", this.onAnnounceBound);
      this.targetWindow.removeEventListener("choir-unavailable-v1", this.onUnavailableBound);
      this.targetWindow.removeEventListener("choir-music-v1", this.onMusicBound);
    }
    this.listeners.clear();
    this.musicListeners.clear();
  }
}
