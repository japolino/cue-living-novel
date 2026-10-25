/**
 * Interface sounds (config `interfaceSounds`, `interfaceSoundVolume`): a soft
 * tick per typed character and a short rising pop, synthesized with WebAudio
 * (no files). They are interface sounds, not story sound: Choir's music and
 * effects do not silence them (Cue's own packs step aside for those, these
 * do not), but a voice reading the story aloud does (`setHold`): the host
 * holds them while Cue's read aloud loads or plays, or while Choir reads
 * replies by itself.
 *
 * One shared instance (`interfaceSounds`) serves every stage screen, so the
 * waiting screen's `playInterfacePop()` follows the same switch, volume and
 * hold as the typewriter. The audio context is made on the first sound.
 */

/** Ticks come at most this often (ms), however fast the text types. */
export const TYPING_TICK_GAP_MS = 60;
/** Length of the pop (ms). */
export const POP_SOUND_MS = 150;
/** Two pops closer than this (one click that sparks and presses a sprite) play once. */
export const POP_MIN_GAP_MS = 80;
/** Interface sounds stay small: volume 1 plays at this share of full scale. */
const MASTER_GAIN = 0.32;

/** Touch mode's soft sounds (sprite-touch.ts `TouchSound`). */
export type TouchSoundKind = "pat" | "stroke" | "squish" | "poke" | "huff";

/**
 * One gliding tone per touch: wave, start and end pitch (Hz), length (s)
 * and level (share of the volume). A pat is a soft low tap, a stroke a slow
 * rising hum, a squish a falling boing, a poke a quick boop, a huff a low
 * grumble.
 */
export const TOUCH_SOUNDS: Readonly<Record<TouchSoundKind, { wave: OscillatorType; from: number; to: number; seconds: number; level: number }>> = {
  pat: { wave: "sine", from: 250, to: 165, seconds: 0.11, level: 0.85 },
  stroke: { wave: "triangle", from: 420, to: 640, seconds: 0.22, level: 0.4 },
  squish: { wave: "sine", from: 620, to: 230, seconds: 0.17, level: 0.75 },
  poke: { wave: "sine", from: 900, to: 680, seconds: 0.07, level: 0.7 },
  huff: { wave: "triangle", from: 230, to: 150, seconds: 0.16, level: 0.6 },
};

/** Whether a typed piece of text ticks now: it is visible text and the last tick is `gap` ms old. */
export function shouldTick(text: string, now: number, lastTickAt: number, gap = TYPING_TICK_GAP_MS): boolean {
  if (!/\S/u.test(text)) return false;
  return now - lastTickAt >= gap;
}

/** The parts of an AudioContext the sounds use (tests pass a fake). */
export type InterfaceAudioContext = Pick<AudioContext, "currentTime" | "state" | "destination" | "createOscillator" | "createGain" | "resume">;

export type InterfaceSoundsOptions = {
  /** Makes the audio context on the first sound (default: the browser's). Null: no sound here. */
  createContext?: () => InterfaceAudioContext | null;
  /** Clock in ms (default performance.now). */
  now?: () => number;
  random?: () => number;
};

function browserContext(): InterfaceAudioContext | null {
  const scope = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (typeof Ctor !== "function") return null;
  try {
    return new Ctor({ latencyHint: "interactive" });
  } catch {
    return null;
  }
}

const clockNow = (): number => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());

export class InterfaceSounds {
  private enabled = false;
  private volume = 0.4;
  private hold: (() => boolean) | null = null;
  private context: InterfaceAudioContext | null = null;
  private contextTried = false;
  private lastTickAt = Number.NEGATIVE_INFINITY;
  private lastPopAt = Number.NEGATIVE_INFINITY;
  private readonly createContext: () => InterfaceAudioContext | null;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(options: InterfaceSoundsOptions = {}) {
    this.createContext = options.createContext ?? browserContext;
    this.now = options.now ?? clockNow;
    this.random = options.random ?? Math.random;
  }

  /** The reader's switch and volume (0..1). */
  configure(settings: { enabled: boolean; volume: number }): void {
    this.enabled = Boolean(settings.enabled);
    this.volume = Number.isFinite(settings.volume) ? Math.max(0, Math.min(1, settings.volume)) : 0.4;
  }

  /** While this answers true (a voice reads aloud) no interface sound plays. */
  setHold(hold: (() => boolean) | null): void {
    this.hold = hold;
  }

  /** Drop `hold` if it is still the one in place (a stage that set it goes away). */
  releaseHold(hold: () => boolean): void {
    if (this.hold === hold) this.hold = null;
  }

  /** Whether a sound may play now: switched on, audible, and no voice reading aloud. */
  canPlay(): boolean {
    if (!this.enabled || this.volume <= 0) return false;
    try {
      return !this.hold?.();
    } catch {
      // Cannot tell whether a voice reads: stay quiet.
      return false;
    }
  }

  /** The typewriter revealed `text`: a tick, at most every TYPING_TICK_GAP_MS. True when one played. */
  typed(text: string): boolean {
    if (!this.canPlay()) return false;
    const now = this.now();
    if (!shouldTick(text, now, this.lastTickAt)) return false;
    if (!this.play("tick")) return false;
    this.lastTickAt = now;
    return true;
  }

  /** The rising pop (~0.15 s). True when it played. */
  pop(): boolean {
    if (!this.canPlay()) return false;
    const now = this.now();
    if (now - this.lastPopAt < POP_MIN_GAP_MS) return false;
    if (!this.play("pop")) return false;
    this.lastPopAt = now;
    return true;
  }

  /** A touch in touch mode: its soft sound, at most one per POP_MIN_GAP_MS. True when it played. */
  touch(kind: TouchSoundKind): boolean {
    if (!this.canPlay()) return false;
    const now = this.now();
    if (now - this.lastPopAt < POP_MIN_GAP_MS) return false;
    const sound = TOUCH_SOUNDS[kind];
    const context = sound ? this.audio() : null;
    if (!sound || !context) return false;
    try {
      const t = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = sound.wave;
      oscillator.frequency.setValueAtTime(sound.from, t);
      oscillator.frequency.exponentialRampToValueAtTime(sound.to, t + sound.seconds * 0.85);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, this.volume * MASTER_GAIN * sound.level), t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + sound.seconds);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(t);
      oscillator.stop(t + sound.seconds + 0.01);
    } catch {
      return false;
    }
    this.lastPopAt = now;
    return true;
  }

  private audio(): InterfaceAudioContext | null {
    if (!this.contextTried) {
      this.contextTried = true;
      this.context = this.createContext();
    }
    const context = this.context;
    // Made before the reader's first gesture: it starts suspended until one.
    if (context && context.state === "suspended") void context.resume().catch(() => {});
    return context && context.state !== "closed" ? context : null;
  }

  private play(kind: "tick" | "pop"): boolean {
    const context = this.audio();
    if (!context) return false;
    try {
      const t = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const level = this.volume * MASTER_GAIN;
      if (kind === "tick") {
        // A soft wooden tick: a short triangle blip falling in pitch, its pitch varied a little.
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(1750 * (0.93 + this.random() * 0.14), t);
        oscillator.frequency.exponentialRampToValueAtTime(1100, t + 0.03);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * 0.45), t + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(t);
        oscillator.stop(t + 0.045);
      } else {
        // A bubble pop: a sine sweeping up an octave and a half, quick in, quick out.
        const end = POP_SOUND_MS / 1000;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(340, t);
        oscillator.frequency.exponentialRampToValueAtTime(940, t + end * 0.8);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * 0.9), t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + end);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(t);
        oscillator.stop(t + end + 0.01);
      }
      return true;
    } catch {
      return false;
    }
  }
}

/** The one instance every stage screen shares (configured by VnStage.setStageFeel). */
export const interfaceSounds = new InterfaceSounds();

/** Play the rising pop (~0.15 s) if interface sounds are on and no voice reads aloud. True when it played. */
export function playInterfacePop(): boolean {
  return interfaceSounds.pop();
}

/** A typing tick for revealed `text` (throttled to one per TYPING_TICK_GAP_MS). True when it played. */
export function playTypingTick(text = "a"): boolean {
  return interfaceSounds.typed(text);
}
