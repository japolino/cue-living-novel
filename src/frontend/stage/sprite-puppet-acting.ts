/**
 * Acting for the PNG puppet (docs/SPRITE_MODE.md, "Puppet acting"). Pure:
 *
 * - moods: how a character carries an expression (posture, shoulders, head
 *   pitch and tilt, breathing rate and depth, sway, trembling, a chuckle or
 *   a sob), scaled by the staging intensity;
 * - voice: the speaker's head follows the typed text, one pulse per
 *   syllable, a settle and a breath at commas, a dip at full stops, a punch
 *   at "!", a held tilt at "?", a droop at "…", a wiggle at "~";
 * - gestures: short timed moves (a listener's nod, a startle, the reaction
 *   to an emote or a staged motion).
 *
 * sprite-puppet-rig.ts turns all of it into one pose.
 */
import { spriteFallbackExpression, type SpriteEmote, type SpriteHotExpression, type SpriteMotion } from "../../shared/sprites.js";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
/** 0 → 1 → 0 over `duration` seconds. */
const pulse = (age: number, duration: number): number => {
  if (age <= 0 || age >= duration) return 0;
  const s = Math.sin((Math.PI * age) / duration);
  return s * s;
};
/** Rises over `rise`, holds, falls over the last `fall` seconds of `duration`. */
const hold = (age: number, rise: number, fall: number, duration: number): number =>
  age <= 0 || age >= duration ? 0 : smoothstep(0, rise, age) * (1 - smoothstep(duration - fall, duration, age));

/* ------------------------------------------------------------------------ */
/* Moods                                                                     */
/* ------------------------------------------------------------------------ */

/**
 * How a character carries itself. Rates, depths and amounts are factors
 * (1 = neutral); posture, shoulders, pitch, tremble, chuckle and sob are
 * levels (0 = neutral) the rig multiplies by its amplitudes.
 */
export type PuppetMood = {
  /** Breaths per second relative to the calm rate. */
  breathRate: number;
  breathDepth: number;
  swayAmp: number;
  swayRate: number;
  /** -1 slumped .. +1 drawn up (proud, tense, startled). */
  posture: number;
  /** 0..1 shoulders raised (tension, fear, shyness). */
  shoulders: number;
  /** Head pitch: + looks down, - lifts the chin. */
  pitch: number;
  /** Held head roll (radians), toward the character's side. */
  tilt: number;
  /** 0..1 fast small shaking. */
  tremble: number;
  /** 0..1 bursts of laughter in the chest and shoulders. */
  chuckle: number;
  /** 0..1 irregular sobbing catches in the breath. */
  sob: number;
  /** How big the talking head moves. */
  energy: number;
};

export const PUPPET_NEUTRAL_MOOD: Readonly<PuppetMood> = {
  breathRate: 1, breathDepth: 1, swayAmp: 1, swayRate: 1,
  posture: 0, shoulders: 0, pitch: 0, tilt: 0, tremble: 0, chuckle: 0, sob: 0, energy: 1,
};

const mood = (m: Partial<PuppetMood>): PuppetMood => ({ ...PUPPET_NEUTRAL_MOOD, ...m });

/** One mood per hot-set expression; rare expressions use their hot-set fallback. */
export const PUPPET_MOODS: Readonly<Record<SpriteHotExpression, PuppetMood>> = {
  idle: mood({}),
  smile: mood({ swayAmp: 1.15, swayRate: 1.1, posture: 0.15, tilt: 2.5 * DEG, energy: 1.15 }),
  laughing: mood({ breathRate: 1.3, breathDepth: 0.8, swayAmp: 1.2, posture: 0.1, pitch: -0.25, tilt: 3 * DEG, chuckle: 1, energy: 1.3 }),
  sad: mood({ breathRate: 0.75, breathDepth: 1.3, swayAmp: 0.6, swayRate: 0.7, posture: -0.75, pitch: 0.6, energy: 0.6 }),
  crying_with_eyes_open: mood({ breathRate: 0.9, breathDepth: 1.1, swayAmp: 0.5, swayRate: 0.8, posture: -0.6, pitch: 0.45, sob: 1, energy: 0.7 }),
  angry: mood({ breathRate: 1.45, breathDepth: 1.35, swayAmp: 0.45, swayRate: 1.2, posture: 0.45, shoulders: 0.5, pitch: 0.15, tremble: 0.25, energy: 1.4 }),
  surprised: mood({ breathRate: 1.2, breathDepth: 0.6, swayAmp: 0.5, posture: 0.55, shoulders: 0.4, pitch: -0.35, energy: 1.2 }),
  embarrassed: mood({ breathRate: 1.15, swayAmp: 0.85, swayRate: 1.3, posture: -0.15, shoulders: 0.45, pitch: 0.35, tilt: 4 * DEG, energy: 0.75 }),
  worried: mood({ breathRate: 1.2, breathDepth: 0.8, swayAmp: 0.7, posture: -0.25, shoulders: 0.35, pitch: 0.2, tremble: 0.1, energy: 0.85 }),
  thinking: mood({ breathRate: 0.85, swayAmp: 0.7, swayRate: 0.8, pitch: 0.1, tilt: 6 * DEG, energy: 0.8 }),
  smug: mood({ breathRate: 0.9, swayAmp: 0.9, swayRate: 0.85, posture: 0.4, pitch: -0.2, tilt: 3.5 * DEG }),
  scared: mood({ breathRate: 1.6, breathDepth: 0.7, swayAmp: 0.4, posture: -0.35, shoulders: 0.75, pitch: 0.2, tremble: 0.7, energy: 0.9 }),
};

/** Staging intensity 1..5 scales how far a mood is from neutral. */
const INTENSITY_GAIN = [0.55, 0.8, 1, 1.2, 1.4] as const;

/** The mood of an expression id (any catalogue id) at a staging intensity (1..5, 3 = as listed). */
export function puppetMoodFor(expression: string | null | undefined, intensity = 3): PuppetMood {
  const base = PUPPET_MOODS[spriteFallbackExpression(expression)];
  const level = Math.max(1, Math.min(5, Math.round(Number.isFinite(intensity) ? intensity : 3)));
  const k = INTENSITY_GAIN[level - 1]!;
  const out = { ...PUPPET_NEUTRAL_MOOD };
  for (const key of Object.keys(out) as Array<keyof PuppetMood>) {
    const neutral = PUPPET_NEUTRAL_MOOD[key];
    out[key] = neutral + (base[key] - neutral) * k;
  }
  return out;
}

/** Move `current` toward `target` by the fraction `t` (0..1), in place. */
export function easeMood(current: PuppetMood, target: PuppetMood, t: number): PuppetMood {
  for (const key of Object.keys(current) as Array<keyof PuppetMood>) current[key] += (target[key] - current[key]) * t;
  return current;
}

/* ------------------------------------------------------------------------ */
/* Voice: the head follows the typed text                                    */
/* ------------------------------------------------------------------------ */

export type PuppetVoice = {
  prev: string;
  prevVowel: boolean;
  dots: number;
  syllables: number;
  /** Syllables so far in the current word (the first one carries the beat). */
  wordSyllables: number;
  syllableAt: number;
  syllableGain: number;
  stopAt: number;
  exclaimAt: number;
  questionAt: number;
  trailAt: number;
  playAt: number;
  breathAt: number;
  breathGain: number;
  /** Last syllable or punctuation (spaces do not count). */
  lastAt: number;
};

/** What a typed chunk was, strongest first: listeners react to the phrase ends. */
export type PuppetVoiceEvent = "exclaim" | "question" | "trail" | "stop" | "pause" | "play" | "syllable";
const EVENT_RANK: Readonly<Record<PuppetVoiceEvent, number>> = { exclaim: 7, question: 6, trail: 5, stop: 4, pause: 3, play: 2, syllable: 1 };

export function puppetVoice(): PuppetVoice {
  return {
    prev: " ", prevVowel: false, dots: 0, syllables: 0, wordSyllables: 0,
    syllableAt: -Infinity, syllableGain: 0, stopAt: -Infinity, exclaimAt: -Infinity, questionAt: -Infinity,
    trailAt: -Infinity, playAt: -Infinity, breathAt: -Infinity, breathGain: 0, lastAt: -Infinity,
  };
}

const VOWEL = /[aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿœаеёиоуыэюяіїєαεηιουωάέήίόύώ]/i;
/** Kana, CJK ideographs and Hangul syllables: one syllable per character. */
const SYLLABIC = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/;
const LETTER = /\p{L}/u;
const PAUSE = new Set([",", ";", ":", "—", "–", "、", "，", "；", "："]);

/** Feed typed text (one or more characters) at `time` seconds; returns the strongest event, or null. */
export function puppetVoiceType(voice: PuppetVoice, text: string, time: number): PuppetVoiceEvent | null {
  let strongest: PuppetVoiceEvent | null = null;
  const note = (event: PuppetVoiceEvent) => {
    voice.lastAt = time;
    if (!strongest || EVENT_RANK[event] > EVENT_RANK[strongest]) strongest = event;
  };
  const breathe = (gain: number) => {
    // Two marks in a row ("?!", ", —") make one breath, the deeper of the two.
    voice.breathGain = time - voice.breathAt < 0.3 ? Math.max(gain, voice.breathGain) : gain;
    voice.breathAt = time;
  };
  for (const ch of text) {
    const prev = voice.prev;
    if (ch === "." || ch === "。") {
      voice.dots = ch === "." ? voice.dots + 1 : 1;
      if (voice.dots === 3) {
        voice.trailAt = time;
        voice.stopAt = -Infinity;
        breathe(0.7);
        note("trail");
      } else if (voice.dots === 1) {
        voice.stopAt = time;
        breathe(1);
        note("stop");
      }
    } else {
      voice.dots = 0;
      if (ch === "…") {
        voice.trailAt = time;
        breathe(0.7);
        note("trail");
      } else if (ch === "!" || ch === "！") {
        if (prev !== "!" && prev !== "！" && prev !== "?" && prev !== "？") {
          voice.exclaimAt = time;
          breathe(1);
          note("exclaim");
        }
      } else if (ch === "?" || ch === "？") {
        if (prev !== "?" && prev !== "？") {
          voice.questionAt = time;
          breathe(0.8);
          note("question");
        }
      } else if (PAUSE.has(ch)) {
        breathe(0.55);
        note("pause");
      } else if (ch === "~" || ch === "〜" || ch === "～") {
        voice.playAt = time;
        note("play");
      } else if (SYLLABIC.test(ch)) {
        voice.syllableAt = time;
        voice.syllableGain = voice.syllables % 2 === 0 ? 1 : 0.5;
        voice.syllables += 1;
        note("syllable");
      } else if (VOWEL.test(ch) && !voice.prevVowel) {
        // Word starts carry the beat; the syllables inside a word barely move the head.
        voice.syllableAt = time;
        voice.syllableGain = voice.wordSyllables === 0 ? 1 : 0.45;
        voice.syllables += 1;
        voice.wordSyllables += 1;
        note("syllable");
      }
    }
    if (!LETTER.test(ch)) voice.wordSyllables = 0;
    voice.prevVowel = VOWEL.test(ch);
    voice.prev = ch;
  }
  return strongest;
}

export type PuppetVoiceSample = {
  /** 1 while text is arriving, fading out after a short gap (the generic talk motion fills the gap). */
  active: number;
  /** Syllable pulse 0..1 (the jaw and head dip). */
  syllable: number;
  /** "!" punch 0..1. */
  exclaim: number;
  /** Full-stop dip 0..1. */
  stop: number;
  /** "?" held tilt 0..1. */
  question: number;
  /** "…" droop 0..1. */
  trail: number;
  /** Breath after a pause 0..1. */
  inhale: number;
  /** "~" wiggle -1..1. */
  play: number;
};

export const PUPPET_SILENT: Readonly<PuppetVoiceSample> = { active: 0, syllable: 0, exclaim: 0, stop: 0, question: 0, trail: 0, inhale: 0, play: 0 };

export function puppetVoiceSample(voice: PuppetVoice, time: number): PuppetVoiceSample {
  const since = (at: number) => time - at;
  // Soft attacks: a sharp one reads as a twitch on a flat image.
  const a = since(voice.syllableAt);
  const syllable = a < 0 || a > 0.8 ? 0 : (a < 0.08 ? smoothstep(0, 0.08, a) : Math.exp(-(a - 0.08) / 0.16)) * voice.syllableGain;
  const e = since(voice.exclaimAt);
  const exclaim = e < 0 || e > 1 ? 0 : (e < 0.12 ? smoothstep(0, 0.12, e) : Math.exp(-(e - 0.12) / 0.22));
  const q = since(voice.questionAt);
  const question = q < 0 || q > 2.4 ? 0 : smoothstep(0, 0.25, q) * (q < 0.9 ? 1 : Math.exp(-(q - 0.9) / 0.6));
  const t = since(voice.trailAt);
  const trail = t < 0 || t > 3.2 ? 0 : smoothstep(0, 0.5, t) * (t < 1.2 ? 1 : Math.exp(-(t - 1.2) / 0.9));
  const b = since(voice.breathAt) - 0.06;
  const inhale = pulse(b, 0.55) * voice.breathGain;
  const p = since(voice.playAt);
  const play = p < 0 || p > 0.9 ? 0 : Math.sin(TAU * 3.2 * p) * (1 - p / 0.9);
  return {
    active: clamp01(1 - (since(voice.lastAt) - 0.3) / 0.25),
    syllable,
    exclaim,
    stop: pulse(since(voice.stopAt), 0.6),
    question,
    trail,
    inhale,
    play,
  };
}

/* ------------------------------------------------------------------------ */
/* Speech and narration in one paragraph                                     */
/* ------------------------------------------------------------------------ */

/**
 * In a paragraph with quotes the speaker only speaks inside them; the
 * narration around them ("she said, looking away") leaves it quiet. A
 * paragraph without quotes is all speech.
 */
export type PuppetSpeech = { quoted: boolean; inside: boolean };

const QUOTE = /["“”「」『』«»]/;
const OPEN_QUOTE = new Set(["“", "「", "『", "«"]);
const CLOSE_QUOTE = new Set(["”", "」", "』", "»"]);

export function puppetSpeech(paragraph: string): PuppetSpeech {
  return { quoted: QUOTE.test(paragraph), inside: false };
}

/** Whether the typing is in narration now (the speaker stays quiet). */
export function puppetNarrating(speech: PuppetSpeech): boolean {
  return speech.quoted && !speech.inside;
}

/** The spoken part of freshly typed text (the quote marks themselves drop out); follows the quotes as it goes. */
export function puppetSpoken(speech: PuppetSpeech, text: string): string {
  if (!speech.quoted) return text;
  let spoken = "";
  for (const ch of text) {
    if (ch === "\"") speech.inside = !speech.inside;
    else if (OPEN_QUOTE.has(ch)) speech.inside = true;
    else if (CLOSE_QUOTE.has(ch)) speech.inside = false;
    else if (speech.inside) spoken += ch;
  }
  return spoken;
}

/* ------------------------------------------------------------------------ */
/* Gestures                                                                  */
/* ------------------------------------------------------------------------ */

export type PuppetGestureKind =
  | "nod" | "bounce" | "listen" | "startle" | "jolt" | "flinch" | "puff" | "slump" | "wonder"
  | "hop" | "groove" | "droop" | "shake" | "tremble" | "turn_away" | "lean_in" | "step_back";

/** Seconds each gesture lasts (it ends at rest, so dropping it never pops). */
export const PUPPET_GESTURE_S: Readonly<Record<PuppetGestureKind, number>> = {
  nod: 0.5, bounce: 0.75, listen: 0.6, startle: 0.45, jolt: 0.6, flinch: 0.6, puff: 1.0, slump: 1.4, wonder: 1.6,
  hop: 0.8, groove: 2.6, droop: 1.8, shake: 0.9, tremble: 1.1, turn_away: 1.3, lean_in: 1.0, step_back: 0.9,
};

/** Emote reactions: the body answers the mark. */
export const PUPPET_EMOTE_GESTURE: Readonly<Partial<Record<SpriteEmote, PuppetGestureKind>>> = {
  exclaim: "jolt", sweat: "flinch", anger: "puff", gloom: "slump", question: "wonder",
  heart: "hop", sparkle: "hop", music: "groove", ellipsis: "droop",
};

/** Staged motions the puppet acts out on top of the CSS move (hop and bounce get their squash from the physics). */
export const PUPPET_MOTION_GESTURE: Readonly<Partial<Record<SpriteMotion, PuppetGestureKind>>> = {
  nod: "nod", shake: "shake", tremble: "tremble", turn_away: "turn_away", lean_in: "lean_in", step_back: "step_back", sink: "slump",
};

/**
 * A gesture's contribution. Units: `nod`, `lift`, `sway`, `turn`,
 * `shoulders`, `posture` in multiples of the rig amplitudes, `stretch` as a
 * fraction, `tilt` in radians, `tremble` as a level.
 */
export type PuppetGestureDelta = {
  nod: number; lift: number; stretch: number; tilt: number; turn: number;
  shoulders: number; posture: number; sway: number; tremble: number;
};

export const puppetGestureDelta = (): PuppetGestureDelta => ({ nod: 0, lift: 0, stretch: 0, tilt: 0, turn: 0, shoulders: 0, posture: 0, sway: 0, tremble: 0 });

/** Add one gesture at `age` seconds into `out` (gain scales it; side ±1 picks the turn and tilt direction). */
export function puppetGesture(kind: PuppetGestureKind, age: number, gain: number, side: number, out: PuppetGestureDelta): PuppetGestureDelta {
  if (age < 0 || age >= PUPPET_GESTURE_S[kind] || !gain) return out;
  const g = gain;
  switch (kind) {
    case "nod":
      out.nod += g * pulse(age, 0.5);
      break;
    case "listen":
      out.nod += g * 0.55 * pulse(age, 0.6);
      break;
    case "bounce":
      out.stretch += g * 0.016 * Math.sin((TAU * age) / 0.38) * Math.exp(-age / 0.2);
      out.lift += g * 0.6 * Math.sin((Math.PI * Math.min(age, 0.3)) / 0.3);
      break;
    case "hop":
      out.stretch += g * 0.012 * Math.sin((TAU * age) / 0.36) * Math.exp(-age / 0.22);
      out.lift += g * 0.5 * pulse(age, 0.4);
      break;
    case "startle":
      out.stretch += g * 0.007 * pulse(age, 0.3);
      out.shoulders += g * 0.8 * pulse(age, 0.45);
      out.nod -= g * 0.4 * pulse(age, 0.35);
      break;
    case "jolt": {
      const s = age < 0.12 ? age / 0.12 : Math.exp(-(age - 0.12) / 0.12) * Math.cos((TAU * (age - 0.12)) / 0.3);
      out.stretch += g * 0.012 * s * (1 - smoothstep(0.45, 0.6, age));
      out.shoulders += g * pulse(age, 0.5);
      out.nod -= g * 0.5 * pulse(age, 0.4);
      break;
    }
    case "flinch": {
      const s = pulse(age, 0.6);
      out.posture -= g * 0.6 * s;
      out.shoulders += g * 0.7 * s;
      out.stretch -= g * 0.006 * s;
      out.turn -= g * 0.4 * side * s;
      break;
    }
    case "puff": {
      const s = pulse(age, 1.0);
      out.posture += g * 0.8 * s;
      out.shoulders += g * 0.6 * s;
      out.lift += g * 1.2 * s;
      out.tremble += g * 0.8 * s;
      break;
    }
    case "slump": {
      const s = hold(age, 0.35, 0.7, 1.4);
      out.posture -= g * s;
      out.nod += g * 0.8 * s;
      break;
    }
    case "wonder": {
      const s = hold(age, 0.3, 0.5, 1.6);
      out.tilt += g * 7 * DEG * side * s;
      out.nod -= g * 0.25 * s;
      break;
    }
    case "groove": {
      const env = hold(age, 0.3, 0.6, 2.6);
      out.sway += g * 0.8 * Math.sin(TAU * age) * env;
      out.nod += g * 0.35 * (0.5 - 0.5 * Math.cos(TAU * 2 * age)) * env;
      break;
    }
    case "droop": {
      const s = hold(age, 0.5, 0.6, 1.8);
      out.nod += g * 0.7 * s;
      out.posture -= g * 0.3 * s;
      break;
    }
    case "shake":
      out.turn += g * Math.sin((TAU * age) / 0.3) * hold(age, 0.08, 0.35, 0.9);
      break;
    case "tremble":
      out.tremble += g * hold(age, 0.1, 0.4, 1.1);
      break;
    case "turn_away": {
      const s = hold(age, 0.35, 0.4, 1.3);
      out.turn -= g * 1.3 * side * s;
      out.tilt -= g * 3 * DEG * side * s;
      break;
    }
    case "lean_in": {
      const s = pulse(age, 1.0);
      out.posture += g * 0.5 * s;
      out.nod += g * 0.5 * s;
      break;
    }
    case "step_back": {
      const s = pulse(age, 0.9);
      out.posture += g * 0.3 * s;
      out.nod -= g * 0.6 * s;
      break;
    }
  }
  return out;
}

/** A stable pseudo-random 0..1 from a number (sob catches, glance timing). */
export function puppetNoise(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}
