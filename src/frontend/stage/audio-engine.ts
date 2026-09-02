export interface AudioPlayerElement {
  src: string;
  volume: number;
  loop: boolean;
  paused: boolean;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(event: string, listener: (...args: unknown[]) => void): void;
  removeEventListener(event: string, listener: (...args: unknown[]) => void): void;
}

export type AudioFactory = (src: string) => AudioPlayerElement;

export function createMockAudioPlayer(src: string): AudioPlayerElement {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let currentVolume = 1;
  let isPaused = true;

  return {
    src,
    loop: false,
    currentTime: 0,
    get volume() {
      return currentVolume;
    },
    set volume(val: number) {
      currentVolume = Math.max(0, Math.min(1, val));
    },
    get paused() {
      return isPaused;
    },
    async play() {
      isPaused = false;
      const playListeners = listeners.get("play");
      playListeners?.forEach((fn) => fn());
    },
    pause() {
      isPaused = true;
      const pauseListeners = listeners.get("pause");
      pauseListeners?.forEach((fn) => fn());
    },
    addEventListener(event: string, listener: (...args: unknown[]) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(listener);
    },
    removeEventListener(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
    },
  };
}

export function formatAudioUrl(src: string): string {
  const trimmed = src.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return `file:///${trimmed.replace(/\\/g, "/")}`;
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/api/")) {
    return `file://${trimmed}`;
  }
  return trimmed;
}

function defaultAudioFactory(src: string): AudioPlayerElement {
  const formatted = formatAudioUrl(src);
  if (typeof Audio !== "undefined") {
    const audio = new Audio(formatted);
    return audio as unknown as AudioPlayerElement;
  }
  return createMockAudioPlayer(formatted);
}

export interface AudioEngineOptions {
  bgmVolume?: number;
  sfxVolume?: number;
  crossfadeDuration?: number;
  audioFactory?: AudioFactory;
}

interface ActiveBgm {
  player: AudioPlayerElement;
  src: string;
  fadeTimer?: ReturnType<typeof setInterval> | undefined;
}

const DEFAULT_CROSSFADE_DURATION_MS = 1500;

export class AudioEngine {
  private bgmVolume: number;
  private sfxVolume: number;
  private readonly crossfadeDuration: number;
  private readonly audioFactory: AudioFactory;
  private activeBgm: ActiveBgm | null = null;
  private outgoingBgm: ActiveBgm | null = null;
  private activeSfx = new Set<AudioPlayerElement>();
  private destroyed = false;

  constructor(options: AudioEngineOptions = {}) {
    this.bgmVolume = Math.max(0, Math.min(1, options.bgmVolume ?? 0.7));
    this.sfxVolume = Math.max(0, Math.min(1, options.sfxVolume ?? 0.8));
    this.crossfadeDuration = options.crossfadeDuration ?? DEFAULT_CROSSFADE_DURATION_MS;
    this.audioFactory = options.audioFactory ?? defaultAudioFactory;
  }

  getBgmVolume(): number {
    return this.bgmVolume;
  }

  setBgmVolume(volume: number): void {
    this.bgmVolume = Math.max(0, Math.min(1, volume));
    if (this.activeBgm && !this.activeBgm.fadeTimer) {
      this.activeBgm.player.volume = this.bgmVolume;
    }
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    for (const sfx of this.activeSfx) {
      sfx.volume = this.sfxVolume;
    }
  }

  getCurrentBgm(): string | null {
    return this.activeBgm?.src ?? null;
  }

  /**
   * Play or crossfade to a new BGM track.
   * If the track is already playing, maintains playback and ensures volume is restored.
   * If a previous track is playing, smoothly fades it out over 1.5s while fading in the new track.
   */
  playBgm(src: string, options: { crossfadeDuration?: number } = {}): void {
    if (this.destroyed) return;
    const cleanSrc = src ? src.trim() : "";
    if (!cleanSrc) {
      this.stopBgm(options);
      return;
    }

    const duration = options.crossfadeDuration ?? this.crossfadeDuration;

    // Already playing the exact same track?
    if (this.activeBgm && this.activeBgm.src === cleanSrc) {
      if (this.activeBgm.player.paused) {
        this.activeBgm.player.play().catch(() => {});
      }
      this.fadeVolume(this.activeBgm, this.bgmVolume, duration);
      return;
    }

    // Fade out previous active track
    if (this.activeBgm) {
      this.fadeOutAndCleanup(this.activeBgm, duration);
      this.activeBgm = null;
    }

    // Create and start new BGM track
    const player = this.audioFactory(cleanSrc);
    player.loop = true;
    player.volume = 0;

    const bgm: ActiveBgm = { player, src: cleanSrc };
    this.activeBgm = bgm;

    player.play().catch(() => {
      // Browser autoplay policy or headless stub error
    });

    this.fadeVolume(bgm, this.bgmVolume, duration);
  }

  /**
   * Stop current BGM with a smooth fade-out.
   */
  stopBgm(options: { fadeDuration?: number; crossfadeDuration?: number } = {}): void {
    const duration = options.fadeDuration ?? options.crossfadeDuration ?? this.crossfadeDuration;
    if (this.activeBgm) {
      this.fadeOutAndCleanup(this.activeBgm, duration);
      this.activeBgm = null;
    }
    if (this.outgoingBgm) {
      this.fadeOutAndCleanup(this.outgoingBgm, duration);
      this.outgoingBgm = null;
    }
  }

  /**
   * Play a one-shot SFX cue.
   */
  playSfx(src: string, options: { volume?: number } = {}): void {
    if (this.destroyed) return;
    const cleanSrc = src ? src.trim() : "";
    if (!cleanSrc || this.sfxVolume <= 0) return;

    const player = this.audioFactory(cleanSrc);
    player.loop = false;
    const sfxVol = Math.max(0, Math.min(1, (options.volume ?? 1) * this.sfxVolume));
    player.volume = sfxVol;

    this.activeSfx.add(player);

    const onEnded = () => {
      this.activeSfx.delete(player);
      player.removeEventListener("ended", onEnded);
      player.removeEventListener("error", onEnded);
    };

    player.addEventListener("ended", onEnded);
    player.addEventListener("error", onEnded);

    player.play().catch(() => {
      this.activeSfx.delete(player);
    });
  }

  /**
   * Stop all audio immediately.
   */
  stopAll(): void {
    if (this.activeBgm) {
      this.clearFade(this.activeBgm);
      this.activeBgm.player.pause();
      this.activeBgm = null;
    }
    if (this.outgoingBgm) {
      this.clearFade(this.outgoingBgm);
      this.outgoingBgm.player.pause();
      this.outgoingBgm = null;
    }
    for (const sfx of this.activeSfx) {
      sfx.pause();
    }
    this.activeSfx.clear();
  }

  destroy(): void {
    this.destroyed = true;
    this.stopAll();
  }

  private clearFade(item: ActiveBgm): void {
    if (item.fadeTimer) {
      clearInterval(item.fadeTimer);
      item.fadeTimer = undefined;
    }
  }

  private fadeVolume(item: ActiveBgm, targetVolume: number, durationMs: number): void {
    this.clearFade(item);
    if (durationMs <= 0) {
      item.player.volume = targetVolume;
      return;
    }

    const startVolume = item.player.volume;
    const startTime = Date.now();
    const intervalMs = 25;

    item.fadeTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const newVolume = startVolume + (targetVolume - startVolume) * progress;
      item.player.volume = Math.max(0, Math.min(1, newVolume));

      if (progress >= 1) {
        this.clearFade(item);
        item.player.volume = targetVolume;
      }
    }, intervalMs);
  }

  private fadeOutAndCleanup(item: ActiveBgm, durationMs: number): void {
    this.clearFade(item);
    this.outgoingBgm = item;

    if (durationMs <= 0) {
      item.player.pause();
      if (this.outgoingBgm === item) this.outgoingBgm = null;
      return;
    }

    const startVolume = item.player.volume;
    const startTime = Date.now();
    const intervalMs = 25;

    item.fadeTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const newVolume = startVolume * (1 - progress);
      item.player.volume = Math.max(0, Math.min(1, newVolume));

      if (progress >= 1) {
        this.clearFade(item);
        item.player.pause();
        if (this.outgoingBgm === item) this.outgoingBgm = null;
      }
    }, intervalMs);
  }
}
