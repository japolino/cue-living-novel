/**
 * Companion extension bridge to Choir.
 *
 * Connects Cue to the Choir extension running in the same Lumiverse page window:
 * - Detects presence via window.__CHOIR_API__ and choir-available-v1 / choir-ping-v1 events.
 * - Controls Narrator Muting and opens Choir's voice setup drawer.
 * - Slices and synthesizes paragraph speech via Choir's atomic dialogue/narration pipeline.
 */

export interface ChoirParagraphRequest {
  text: string;
  chatId?: string;
  messageId?: string;
  paragraphIndex?: number;
  signal?: AbortSignal;
  onStatus?: (status: { kind: "idle" | "loading" | "playing"; speaker?: string; message?: string }) => void;
}

export interface ChoirBridgeApi {
  version: number;
  isAvailable: () => boolean;
  getConfig?: () => Record<string, unknown>;
  isNarratorMuted: () => boolean;
  setNarratorMuted: (muted: boolean) => void;
  openDrawer: () => void;
  stop: () => void;
  playParagraph: (options: ChoirParagraphRequest) => Promise<{ played: number }>;
}

export class ChoirBridge {
  private dead = false;
  private listeners = new Set<(available: boolean) => void>();
  private targetWindow: Window | null = null;
  private onAnnounceBound: ((event: Event) => void) | null = null;
  private onUnavailableBound: ((event: Event) => void) | null = null;

  constructor(targetWindow: Window | null = typeof window !== "undefined" ? window : null) {
    this.targetWindow = targetWindow;
    if (this.targetWindow) {
      this.onAnnounceBound = () => this.handleAvailability(true);
      this.onUnavailableBound = () => this.handleAvailability(false);
      this.targetWindow.addEventListener("choir-available-v1", this.onAnnounceBound);
      this.targetWindow.addEventListener("choir-unavailable-v1", this.onUnavailableBound);
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

  private handleAvailability(available: boolean): void {
    if (this.dead) return;
    for (const listener of this.listeners) {
      try {
        listener(available);
      } catch {
        // Safe dispatch
      }
    }
  }

  destroy(): void {
    this.dead = true;
    if (this.targetWindow && this.onAnnounceBound && this.onUnavailableBound) {
      this.targetWindow.removeEventListener("choir-available-v1", this.onAnnounceBound);
      this.targetWindow.removeEventListener("choir-unavailable-v1", this.onUnavailableBound);
    }
    this.listeners.clear();
  }
}
