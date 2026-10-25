/**
 * Transitions and atmosphere for the PNG puppet (docs/SPRITE_MODE.md,
 * "Puppet transitions" and "Puppet atmosphere"). Pure:
 *
 * - shifts: how an expression change plays. The new face spreads out from
 *   the old one through a soft, grainy edge (the face first, where the change
 *   is); the new emotion picks the style: a squash-and-cut take for surprise
 *   or laughter, a slow melt from the top for sadness, a fast ember-edged
 *   flare for anger, a pink-edged blush for embarrassment;
 * - arrivals: a focus pull as a character enters (blurred to sharp) and
 *   leaves (sharp to blurred);
 * - atmosphere: the scene's weather and light on the characters: breath
 *   clouds and settling snow in the cold, firelight from embers, drifting
 *   firefly glows, a wet sheen in the rain, ground mist in fog, a glow in
 *   dream haze, a colour split on the danger pulse, grain in a flashback.
 *
 * sprite-puppet.ts draws all of it (the shader, the breath clouds on the
 * layer canvas); sprite-puppet-rig.ts adds a shift's body move to the pose.
 */
import { spriteFallbackExpression, type SpriteHotExpression } from "../../shared/sprites.js";
import type { VisualNovelSpriteTransitions } from "../../config.js";
import { puppetNoise, type PuppetGestureDelta } from "./sprite-puppet-acting.js";

const TAU = Math.PI * 2;
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

/* ------------------------------------------------------------------------ */
/* Shifts: expression changes                                                */
/* ------------------------------------------------------------------------ */

export const PUPPET_SHIFT_KINDS = ["soft", "pop", "melt", "flare", "blush"] as const;
export type PuppetShiftKind = (typeof PUPPET_SHIFT_KINDS)[number];

/** How the new image spreads over the old one (shader `uReveal.z`). */
export const PUPPET_SWEEP = { face: 0, down: 1, cut: 2 } as const;

export type PuppetShiftSpec = {
  /** Seconds. */
  duration: number;
  /** From the face outward, from the top of the figure down, or a cut. */
  sweep: keyof typeof PUPPET_SWEEP;
  /** Soft edge width, as a fraction of the sweep. */
  edge: number;
  /** How much noise breaks up the edge (0..1). */
  grain: number;
  /** Colour glowing along the edge (0..1 rgb) and its strength at intensity 3 (0 = none). */
  glow: readonly [number, number, number, number];
  /** Pop: where in the shift the cut falls (0..1). */
  cut?: number;
};

export const PUPPET_SHIFT: Readonly<Record<PuppetShiftKind, PuppetShiftSpec>> = {
  soft: { duration: 0.36, sweep: "face", edge: 0.3, grain: 0.3, glow: [1, 1, 1, 0] },
  pop: { duration: 0.46, sweep: "cut", edge: 0.05, grain: 0, glow: [1, 1, 1, 0], cut: 0.28 },
  melt: { duration: 0.72, sweep: "down", edge: 0.42, grain: 0.45, glow: [0.66, 0.76, 1, 0.22] },
  flare: { duration: 0.28, sweep: "face", edge: 0.16, grain: 0.5, glow: [1, 0.42, 0.16, 0.9] },
  blush: { duration: 0.46, sweep: "face", edge: 0.24, grain: 0.25, glow: [1, 0.56, 0.68, 0.6] },
};

const SHIFT_BY_EXPRESSION: Readonly<Record<SpriteHotExpression, PuppetShiftKind>> = {
  idle: "soft",
  smile: "soft",
  laughing: "pop",
  sad: "melt",
  crying_with_eyes_open: "melt",
  angry: "flare",
  surprised: "pop",
  embarrassed: "blush",
  worried: "soft",
  thinking: "soft",
  smug: "soft",
  scared: "pop",
};

/** The shift for a change to `expression` (any catalogue id) under a transition style, or null for the CSS crossfade. */
export function puppetShiftFor(expression: string | null | undefined, style: VisualNovelSpriteTransitions): PuppetShiftKind | null {
  if (style === "classic") return null;
  if (style === "soft") return "soft";
  return SHIFT_BY_EXPRESSION[spriteFallbackExpression(expression)];
}

/** Staging intensity 1..5 scales the glow and the body's take. */
export function puppetShiftGain(intensity: number): number {
  const level = Math.max(1, Math.min(5, Math.round(Number.isFinite(intensity) ? intensity : 3)));
  return [0.6, 0.8, 1, 1.2, 1.4][level - 1]!;
}

/**
 * How far the new image has spread at `age` seconds (0..1, eased per kind).
 * The shader turns it into a mask with the kind's sweep, edge and grain.
 */
export function puppetShiftReveal(kind: PuppetShiftKind, age: number): number {
  const spec = PUPPET_SHIFT[kind];
  const t = clamp01(age / spec.duration);
  switch (kind) {
    case "pop": {
      const cut = spec.cut ?? 0.3;
      return smoothstep(cut - 0.04, cut + 0.04, t);
    }
    case "melt": return 1 - (1 - t) * (1 - t);
    case "flare": return 1 - (1 - t) ** 3;
    default: return t * t * (3 - 2 * t);
  }
}

/** The body's part of a shift at `age` seconds (gesture units, see puppetGesture), added into `out`. */
export function puppetShiftGesture(kind: PuppetShiftKind, age: number, gain: number, out: PuppetGestureDelta): PuppetGestureDelta {
  if (age < 0 || age >= PUPPET_SHIFT[kind].duration + 0.5 || !gain) return out;
  const g = gain;
  switch (kind) {
    case "pop": {
      // A take: squash down to the cut, spring up past rest, settle.
      const cutAt = PUPPET_SHIFT.pop.duration * (PUPPET_SHIFT.pop.cut ?? 0.3);
      const squash = age < cutAt ? smoothstep(0, cutAt, age) : Math.exp(-(age - cutAt) / 0.05);
      const spring = age < cutAt ? 0 : Math.sin((TAU * (age - cutAt)) / 0.42) * Math.exp(-(age - cutAt) / 0.16);
      out.stretch += g * (-0.022 * squash + 0.016 * spring);
      out.shoulders += g * 0.7 * pulse(age - cutAt * 0.5, 0.4);
      out.nod -= g * 0.35 * pulse(age - cutAt, 0.35);
      break;
    }
    case "melt": {
      const s = pulse(age, 0.95);
      out.posture -= g * 0.45 * s;
      out.nod += g * 0.5 * s;
      break;
    }
    case "flare": {
      const s = pulse(age, 0.4);
      out.shoulders += g * 0.9 * s;
      out.stretch += g * 0.008 * s;
      break;
    }
    case "blush": {
      const s = pulse(age, 0.7);
      out.shoulders += g * 0.55 * s;
      out.nod += g * 0.4 * s;
      out.tilt += g * 0.05 * s;
      break;
    }
    default:
      break;
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Arrivals: the focus pull                                                  */
/* ------------------------------------------------------------------------ */

/** Blur (CSS px at the sprite's size) at the start of an entrance and at the end of an exit. */
export const PUPPET_ARRIVAL_BLUR_PX = 9;
/** Entrance and exit lengths (seconds; SPRITE_ENTER_MS and SPRITE_EXIT_MS in sprite-layer.ts). */
export const PUPPET_ARRIVAL_S = { entering: 0.46, exiting: 0.42 } as const;

/** Focus-pull blur in px: `progress` 0..1 through an entrance (sharpening) or an exit (softening). */
export function puppetArrivalBlur(state: "entering" | "exiting", progress: number): number {
  const t = clamp01(progress);
  return state === "entering" ? PUPPET_ARRIVAL_BLUR_PX * (1 - t) ** 2 : PUPPET_ARRIVAL_BLUR_PX * t * t;
}

/* ------------------------------------------------------------------------ */
/* Atmosphere                                                                */
/* ------------------------------------------------------------------------ */

/** The scene's weather and light on a character (each 0..1, before the time-varying parts). */
export type PuppetAtmosphere = {
  /** Ground mist rising over the legs. */
  fog: number;
  /** Wet sheen on top edges and drops running down. */
  wet: number;
  /** Warm firelight from below (flickered per frame, puppetFireFlicker). */
  fire: number;
  /** Film grain and flicker. */
  grain: number;
  /** Glow halo and a slow shimmer. */
  haze: number;
  /** Colour split on the danger pulse (times the pulse, read from the overlay). */
  pulse: number;
  /** How much snow settles on hair and shoulders when it has had time to. */
  snow: number;
  /** Drifting firefly glows. */
  fireflies: number;
  /** Breath clouds (a cold scene). */
  breath: number;
};

export const PUPPET_CALM_AIR: Readonly<PuppetAtmosphere> = { fog: 0, wet: 0, fire: 0, grain: 0, haze: 0, pulse: 0, snow: 0, fireflies: 0, breath: 0 };

/** The atmosphere of an ambient effect (`data-vn-scene-ambient`) in a scene that is cold or not. */
export function puppetAtmosphere(ambient: string | null | undefined, cold: boolean): PuppetAtmosphere {
  const air = { ...PUPPET_CALM_AIR };
  switch (ambient) {
    case "snow": air.snow = 0.6; air.breath = 1; break;
    case "rain": air.wet = 0.5; break;
    case "heavy_rain": air.wet = 1; break;
    case "fog": air.fog = 1; break;
    case "embers": air.fire = 1; break;
    case "fireflies": air.fireflies = 1; break;
    case "dream_haze": air.haze = 1; break;
    case "danger_pulse": air.pulse = 1; break;
    case "sepia_flashback": air.grain = 1; break;
    case "desaturate": air.grain = 0.4; break;
    default: break;
  }
  if (cold) air.breath = 1;
  return air;
}

/** Words in a plate's location, time or weather that make it cold enough to see breath. */
const COLD_WORDS = /\b(snow\w*|winter\w*|cold\w*|frost\w*|freez\w*|blizzard\w*|ic[ey]|icicle\w*|sleet\w*|glacier\w*|arctic|tundra|subzero|wintry)\b/i;

/** Whether a plate (location, time of day, weather) reads as cold. */
export function puppetColdPlace(place: { location?: string | null; timeOfDay?: string | null; weather?: string | null } | null | undefined): boolean {
  if (!place) return false;
  return COLD_WORDS.test([place.location, place.timeOfDay, place.weather].filter(Boolean).join(" "));
}

/** Firelight flicker at a time (0.55..1): two slow waves and a quick crackle. */
export function puppetFireFlicker(time: number, phase: number): number {
  const slow = 0.5 + 0.3 * Math.sin(TAU * 0.37 * time + phase * 7) + 0.2 * Math.sin(TAU * 0.91 * time + phase * 3);
  const crackle = puppetNoise(Math.floor(time * 11) + phase * 53);
  return 0.55 + 0.45 * clamp01(slow * 0.75 + crackle * 0.25);
}

/** The danger pulse (0..1) from the overlay's animated opacity (0.3 at rest, 1 at the beat). */
export function puppetDangerBeat(opacity: number): number {
  return Number.isFinite(opacity) ? clamp01((opacity - 0.3) / 0.7) : 0;
}

/**
 * Two fireflies drifting around a character's upper body: positions in
 * image space (x from the anchor, y up, in image heights) and glow (0..1).
 */
export function puppetFireflies(time: number, phase: number, faceX: number, faceY: number, figH: number): Array<{ x: number; y: number; glow: number }> {
  const out: Array<{ x: number; y: number; glow: number }> = [];
  for (let i = 0; i < 2; i += 1) {
    const s = phase * 13 + i * 5.7;
    const r = figH * (0.18 + 0.08 * i);
    const a = TAU * (0.05 + 0.03 * i) * time + s;
    const x = faceX + r * Math.cos(a) * 0.9 + figH * 0.03 * Math.sin(TAU * 0.23 * time + s);
    const y = faceY - figH * (0.12 + 0.12 * i) + r * 0.45 * Math.sin(a * 1.7) + figH * 0.02 * Math.sin(TAU * 0.31 * time + s * 2);
    // Fireflies blink: a soft glow that comes and goes.
    const glow = smoothstep(0.15, 0.6, 0.5 + 0.5 * Math.sin(TAU * (0.21 + 0.07 * i) * time + s * 3));
    out.push({ x, y, glow });
  }
  return out;
}

/** Snow coverage grows toward its target while it snows (about 40 s to settle) and melts away faster. */
export function puppetSnowStep(coverage: number, target: number, dt: number): number {
  const tau = target > coverage ? 40 : 8;
  return coverage + (target - coverage) * (1 - Math.exp(-dt / tau));
}

/* ------------------------------------------------------------------------ */
/* Breath clouds                                                             */
/* ------------------------------------------------------------------------ */

/** A breath cloud, born at the mouth (image space: x from the anchor, y up, image heights). */
export type PuppetPuff = { born: number; x: number; y: number; vx: number; vy: number; size: number; seed: number };

/** Seconds a breath cloud lives. */
export const PUPPET_PUFF_S = 1.7;

/**
 * The mouth: a little below the face centre, toward the side the figure
 * faces in its own image (`dir` -1 = image left, 0 = the viewer).
 */
export function puppetMouth(faceX: number, faceY: number, faceW: number, faceH: number, dir: number): [number, number] {
  return [faceX + dir * 0.22 * faceW, faceY - 0.3 * faceH];
}

/** A new breath cloud at the mouth (displaced by the pose already) heading forward and up. */
export function puppetPuff(x: number, y: number, dir: number, faceW: number, time: number, size: number, seed: number): PuppetPuff {
  const forward = dir === 0 ? 0 : dir * faceW * (0.5 + 0.25 * puppetNoise(seed * 3.1));
  const drift = dir === 0 ? (puppetNoise(seed * 7.7) - 0.5) * faceW * 0.4 : 0;
  return {
    born: time,
    x,
    y,
    vx: forward + drift,
    vy: faceW * (dir === 0 ? 0.42 : 0.24),
    size: faceW * size,
    seed,
  };
}

/**
 * How a breath cloud looks at `time`: centre (image space), radius (image
 * heights) and opacity, or null once it has faded. It slows, rises, grows
 * and thins out.
 */
export function puppetPuffAt(puff: PuppetPuff, time: number): { x: number; y: number; r: number; alpha: number } | null {
  const age = time - puff.born;
  if (age < 0 || age >= PUPPET_PUFF_S) return null;
  const t = age / PUPPET_PUFF_S;
  // Exhaled air slows quickly (drag), then drifts up as it warms.
  const travel = (1 - Math.exp(-age / 0.45)) * 0.45;
  const wobble = Math.sin(TAU * (0.7 * age + puff.seed)) * puff.size * 0.15 * t;
  return {
    x: puff.x + puff.vx * travel + wobble,
    y: puff.y + puff.vy * travel + puff.size * 0.6 * t * t,
    r: puff.size * (0.35 + 1.25 * Math.sqrt(t)),
    alpha: 0.34 * smoothstep(0, 0.1, t) * (1 - smoothstep(0.25, 1, t)),
  };
}

/** Whether a breath clock crossed into an exhale (cycle 0.5) between two frames; see puppetBreathCycle. */
export function puppetExhaleStarted(before: number, after: number): boolean {
  if (after === before) return false;
  // The cycle wraps at 1; an exhale starts when it passes 0.5.
  return before <= after ? before < 0.5 && after >= 0.5 : before < 0.5 || after >= 0.5;
}
