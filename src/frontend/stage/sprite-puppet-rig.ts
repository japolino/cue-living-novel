/**
 * PNG-puppet rig and motion (docs/SPRITE_MODE.md, "Puppet motion"). Pure
 * math, shared by the WebGL warp in sprite-puppet.ts (one vertex grid per
 * image) and the emote marks, so a mark follows the moving head exactly.
 *
 * Units: image heights, measured from the figure's anchor (bbox
 * bottom-centre), x to the right of the unmirrored image, y up. A cut-out
 * is not rigid here: breathing lifts the upper body and widens the chest
 * band, the sway bends the body from the feet (the top moves most), and the
 * head turns around a neck pivot under the face box with a smooth falloff,
 * so hair and shoulders blend into the still parts. Acting adds posture
 * above the waist, raised shoulders, and a 2.5D turn of the head and torso
 * (the middle of the face moves more than its outline, which reads as a
 * yaw); physics trails the loose parts and the hair.
 */
import type { SpriteFaceSpot, SpriteGeometry } from "./sprite-layer.js";
import { puppetShiftGesture, type PuppetShiftKind } from "./sprite-puppet-fx.js";
import {
  PUPPET_NEUTRAL_MOOD,
  puppetGesture,
  puppetGestureDelta,
  puppetNoise,
  type PuppetGestureKind,
  type PuppetMood,
  type PuppetVoiceSample,
} from "./sprite-puppet-acting.js";

export type PuppetRig = {
  /** Image aspect (width / height). */
  aspect: number;
  /** Anchor in normalized image coordinates (bbox bottom-centre). */
  cx: number;
  by: number;
  /** Figure height (bbox height). */
  figH: number;
  /** Face centre and size. */
  faceX: number;
  faceY: number;
  faceW: number;
  faceH: number;
  /** Neck pivot the head turns around. */
  neckX: number;
  neckY: number;
  /** Chest centre and radii: the band that widens when breathing in. */
  chestX: number;
  chestY: number;
  chestRx: number;
  chestRy: number;
  /** Where the posture bends: the upper body grows or sinks above it. */
  waistY: number;
};

/** The rig of one image, from its geometry and face spot (detected box or framing estimate). */
export function puppetRig(geometry: SpriteGeometry, spot: SpriteFaceSpot): PuppetRig {
  const aspect = geometry.aspect;
  const faceH = Math.max(0.02, spot.top - spot.bottom);
  const faceW = Math.max(0.02, spot.w * aspect);
  const faceX = spot.dx * aspect;
  const chestY = Math.max(0.08 * geometry.bh, spot.bottom - 1.15 * faceH);
  return {
    aspect,
    cx: geometry.cx,
    by: geometry.by,
    figH: geometry.bh,
    faceX,
    faceY: (spot.top + spot.bottom) / 2,
    faceW,
    faceH,
    neckX: faceX,
    neckY: spot.bottom - 0.1 * faceH,
    chestX: faceX * 0.6,
    chestY,
    chestRx: 1.5 * faceW,
    chestRy: 0.85 * faceH,
    waistY: Math.max(0.05 * geometry.bh, chestY - 1.5 * faceH),
  };
}

export type PuppetPose = {
  /** Upper-body rise from breathing (image heights). */
  lift: number;
  /** Chest widening from breathing (fraction of the local width). */
  widen: number;
  /** Horizontal offset of the figure top from the sway (image heights); the bend grows with height squared. */
  sway: number;
  /** Head roll around the neck (radians, + = counterclockwise on the unmirrored image). */
  tilt: number;
  /** Head rise (image heights, + = up). */
  bob: number;
  /** Head dip with a slight squash toward the neck (image heights, + = down). */
  nod: number;
  /** Whole-figure stretch from the feet (fraction, + = taller). */
  stretch: number;
  /** Upper-body scale above the waist (fraction, + = drawn up, - = slumped). */
  posture: number;
  /** Shoulder rise (image heights); the head is not lifted. */
  shoulders: number;
  /** Head yaw as the shift of the face centre (image heights, + = toward the image's right). */
  turn: number;
  /** Torso yaw, the same way around the chest (image heights). */
  bodyTurn: number;
  /** Trail of the loose parts (hems, sleeves) from the physics (image heights). */
  lagX: number;
  lagY: number;
  /** Trail of the hair around the head (image heights at the tips). */
  hairX: number;
  hairY: number;
};

export const PUPPET_REST: Readonly<PuppetPose> = {
  lift: 0, widen: 0, sway: 0, tilt: 0, bob: 0, nod: 0, stretch: 0,
  posture: 0, shoulders: 0, turn: 0, bodyTurn: 0, lagX: 0, lagY: 0, hairX: 0, hairY: 0,
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * Displacement of the image point (x, y) under a pose, in image heights
 * (y up). Writes into `out` and returns it.
 */
export function puppetDisplace(rig: PuppetRig, pose: PuppetPose, x: number, y: number, out: [number, number] = [0, 0]): [number, number] {
  let dx = 0;
  let dy = 0;
  const h = Math.max(0, y);
  // Bounce: a stretch from the feet, a little narrower while taller.
  if (pose.stretch) {
    dy += pose.stretch * h;
    dx -= pose.stretch * 0.5 * x;
  }
  // Posture: the upper body grows (drawn up) or sinks (slumped) above the waist, a little narrower when taller.
  if (pose.posture) {
    const w = smoothstep(rig.waistY - 0.4 * rig.faceH, rig.waistY + 0.9 * rig.faceH, y);
    if (w > 0) {
      dy += pose.posture * (y - rig.waistY) * w;
      dx -= pose.posture * 0.3 * (x - rig.chestX) * w;
    }
  }
  // Shoulders: a band beside and below the neck rises; the head stays.
  if (pose.shoulders) {
    const ax = Math.abs(x - rig.neckX);
    const sy = rig.neckY - 0.35 * rig.faceH;
    const band = Math.exp(-(((y - sy) / (0.6 * rig.faceH)) ** 2));
    const side = smoothstep(0.3 * rig.faceW, 0.85 * rig.faceW, ax) * (1 - smoothstep(2.4 * rig.faceW, 3.4 * rig.faceW, ax));
    const below = 1 - smoothstep(rig.neckY - 0.1 * rig.faceH, rig.neckY + 0.25 * rig.faceH, y);
    dy += pose.shoulders * band * side * below;
  }
  // Torso turn: the middle of the chest shifts more than its sides.
  if (pose.bodyTurn) {
    const nx = (x - rig.chestX) / (1.6 * rig.chestRx);
    const ny = (y - rig.chestY) / (2.2 * rig.chestRy);
    dx += pose.bodyTurn * Math.max(0, 1 - nx * nx) * Math.exp(-ny * ny);
  }
  // Loose parts (hems, sleeves, wide hair) trail the body; the feet and the spine stay.
  if (pose.lagX || pose.lagY) {
    const spine = rig.neckX * clamp01(y / Math.max(1e-3, rig.neckY));
    const loose = smoothstep(0.7 * rig.faceW, 2.4 * rig.faceW, Math.abs(x - spine)) * smoothstep(0, 0.25 * rig.figH, y);
    dx += pose.lagX * loose;
    dy += pose.lagY * loose;
  }
  // Hair: outside the face, at the sides down to the shoulders and over the crown; tips trail most.
  if (pose.hairX || pose.hairY) {
    const ax = Math.abs(x - rig.faceX);
    const top = rig.faceY + 0.5 * rig.faceH;
    const sideHair = smoothstep(0.55 * rig.faceW, 1.15 * rig.faceW, ax) * (1 - smoothstep(1.9 * rig.faceW, 2.8 * rig.faceW, ax))
      * smoothstep(rig.neckY - 1.3 * rig.faceH, rig.neckY - 0.2 * rig.faceH, y);
    const crown = smoothstep(top - 0.1 * rig.faceH, top + 0.45 * rig.faceH, y) * (1 - smoothstep(1.5 * rig.faceW, 2.5 * rig.faceW, ax));
    const hair = Math.max(sideHair, crown);
    if (hair > 0) {
      const reach = Math.min(1.4, Math.hypot(x - rig.neckX, y - rig.faceY) / (1.6 * rig.faceH));
      dx += pose.hairX * hair * reach;
      dy += pose.hairY * hair * reach * 0.5;
    }
  }
  // Breathing: everything above the chest rises; the chest band widens.
  if (pose.lift) dy += pose.lift * smoothstep(rig.chestY - 1.4 * rig.chestRy, rig.chestY + 0.6 * rig.chestRy, y);
  if (pose.widen) {
    const nx = (x - rig.chestX) / rig.chestRx;
    const ny = (y - rig.chestY) / rig.chestRy;
    dx += (x - rig.chestX) * pose.widen * Math.exp(-(nx * nx + ny * ny));
  }
  // Sway: a bend from the feet (the top moves most); the local turn keeps widths.
  if (pose.sway) {
    const k = pose.sway / (rig.figH * rig.figH);
    const height = Math.min(h, rig.figH * 1.15);
    dx += k * height * height;
    dy -= x * 2 * k * height;
  }
  // Head: turns around the neck; the weight fades below the neck and beyond the hair.
  if (pose.tilt || pose.bob || pose.nod || pose.turn) {
    const px = x - rig.neckX;
    const py = y - rig.neckY;
    const weight = smoothstep(-0.55 * rig.faceH, 0.2 * rig.faceH, py)
      * (1 - smoothstep(0.9 * rig.faceW, 2 * rig.faceW, Math.abs(x - rig.faceX)));
    if (weight > 0) {
      const angle = pose.tilt * weight;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      dx += px * cos - py * sin - px;
      dy += px * sin + py * cos - py + pose.bob * weight;
      dy -= pose.nod * weight * (0.7 + 0.5 * clamp01(py / (2 * rig.faceH)));
      // 2.5D yaw: the face's middle moves, its outline stays.
      if (pose.turn) {
        const nx = (x - rig.faceX) / (1.3 * rig.faceW);
        const ny = (y - rig.faceY) / (1.1 * rig.faceH);
        dx += pose.turn * Math.max(0, 1 - nx * nx) * Math.exp(-ny * ny) * weight;
      }
    }
  }
  out[0] = dx;
  out[1] = dy;
  return out;
}

/** Where the face centre is under a pose (image heights from the anchor, y up). */
export function puppetFaceOffset(rig: PuppetRig, pose: PuppetPose): [number, number] {
  return puppetDisplace(rig, pose, rig.faceX, rig.faceY);
}

/* ------------------------------------------------------------------------ */
/* Motion over time                                                          */
/* ------------------------------------------------------------------------ */

/** Amplitudes at 100% strength (lengths in figure heights, angles in radians). */
export const PUPPET_AMPLITUDE = {
  lift: 0.0045,
  widen: 0.022,
  sway: 0.0075,
  tilt: (1.8 * Math.PI) / 180,
  bob: 0.0016,
  talkBob: 0.0042,
  talkTilt: (0.7 * Math.PI) / 180,
  nod: 0.012,
  bounce: 0.016,
  /** Mood posture at level 1 (fraction of the upper body). */
  posture: 0.016,
  /** Shoulder rise at level 1. */
  shoulders: 0.008,
  /** Head pitch at level 1 (as a nod). */
  pitch: 0.011,
  /**
   * Head yaw at full gaze, as a fraction of the face width. It slides the
   * face's middle inside its outline, which reads as liquid when large, so
   * looking at someone is mostly the head tilt and lean below.
   */
  turn: 0.035,
  /** Torso yaw at full gaze. */
  bodyTurn: 0.0012,
  /** Head tilt toward whoever is looked at, at full gaze. */
  gazeTilt: (1.6 * Math.PI) / 180,
  /** Lean of the figure top toward whoever is looked at, at full gaze. */
  gazeLean: 0.0022,
  /** Tremble sway at level 1. */
  tremble: 0.0012,
  /** Held tilt at a "?". */
  questionTilt: (6 * Math.PI) / 180,
} as const;

/** Speaker reaction when a line starts: a small nod, or a bounce for bright expressions. */
export type PuppetReaction = "nod" | "bounce";
export const PUPPET_REACTION_MS: Readonly<Record<PuppetReaction, number>> = { nod: 500, bounce: 750 };

const BOUNCY_EXPRESSIONS = new Set(["smile", "laughing", "surprised", "happy", "excited", "smug"]);

export function puppetReactionFor(expression: string | null | undefined): PuppetReaction {
  return expression && BOUNCY_EXPRESSIONS.has(expression) ? "bounce" : "nod";
}

/** A stable 0..1 phase per character, so actors do not breathe or sway in step. */
export function puppetPhase(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10007) / 10007;
}

/**
 * Where a breath is (0..1): 0 lungs empty, rising to full at 0.5, then the
 * exhale. Each actor breathes on its own phase and period (3.9–4.6 s).
 */
export function puppetBreathCycle(clock: number, phase: number): number {
  const turns = (clock + phase * 37.1) / (3.9 + phase * 0.7);
  return turns - Math.floor(turns);
}

/** Physics offsets the caller simulated (image heights). */
export type PuppetPhysics = {
  /** Trail of the body's loose mass (from the body spring). */
  bodyX: number;
  bodyY: number;
  /** Trail of the hair (from the hair spring). */
  hairX: number;
  hairY: number;
  /** Wind push on the loose parts and hair. */
  windX: number;
};

export type PuppetPoseInput = {
  /** Seconds. */
  time: number;
  /** From puppetPhase. */
  phase: number;
  figH: number;
  /** Face width (image heights); the head turn scales with it. */
  faceW?: number;
  /** 0..1 each (the caller eases them when a setting changes). */
  breathing: number;
  sway: number;
  head: number;
  /** 0..1 talking level (eased in and out by the caller). */
  talk: number;
  reaction: { kind: PuppetReaction; age: number } | null;
  /** Overall strength: motion setting x effect intensity. */
  strength: number;
  /**
   * Breath and sway clocks (seconds at the calm rate), integrated by the
   * caller so a mood change speeds them up without a jump. Default: `time`.
   */
  clocks?: { breath: number; sway: number };
  /** 0..1 acting weight (setting, eased); 0 = only the idle motion. */
  acting?: number;
  mood?: PuppetMood;
  voice?: PuppetVoiceSample | null;
  /** -1..1 where the character looks (image space, + = the image's right), eased by the caller. */
  gaze?: number;
  /** ±1: the side the character tilts its head to when it looks at no one. */
  side?: number;
  gestures?: ReadonlyArray<{ kind: PuppetGestureKind; age: number; gain: number; side: number }>;
  physics?: PuppetPhysics | null;
  /** An expression change playing (sprite-puppet-fx.ts): its body move, whatever the acting setting. */
  shift?: { kind: PuppetShiftKind; age: number; gain: number } | null;
};

const TAU = Math.PI * 2;

/** The pose of one actor at a time. */
export function puppetPose(input: PuppetPoseInput): PuppetPose {
  const { phase, figH, strength } = input;
  if (strength <= 0) return { ...PUPPET_REST };
  const A = PUPPET_AMPLITUDE;
  const faceW = input.faceW ?? 0.15 * figH;
  const act = clamp01(input.acting ?? 0);
  const m = input.mood ?? PUPPET_NEUTRAL_MOOD;
  // The mood's distance from neutral, scaled by the acting weight.
  const mix = (value: number, neutral: number) => neutral + (value - neutral) * act;
  const depth = mix(m.breathDepth, 1);
  const swayAmp = mix(m.swayAmp, 1);
  const energy = mix(m.energy, 1);
  const head = input.head;
  const gaze = (input.gaze ?? 0) * act;
  // Head tilts lean toward whoever is looked at, else to the character's own side.
  const side = Math.abs(gaze) > 0.05 ? Math.sign(gaze) : (input.side ?? 1);

  // Each actor runs on its own clock and slightly different periods.
  const t = input.time + phase * 37.1;
  const ts = (input.clocks?.sway ?? input.time) + phase * 37.1;
  const theta = TAU * puppetBreathCycle(input.clocks?.breath ?? input.time, phase);
  const breath = clamp01(0.5 - 0.5 * Math.cos(theta) + 0.06 * Math.sin(2 * theta));
  const swayWave = 0.78 * Math.sin((TAU * ts) / 7.3 + phase * 4.1) + 0.22 * Math.sin((TAU * ts) / 3.1 + phase * 9.7);
  const tiltWave = 0.72 * Math.sin((TAU * ts) / 5.9 + phase * 2.3) + 0.28 * Math.sin((TAU * ts) / 2.3 + phase * 7.9);
  const bobWave = Math.sin((TAU * ts) / 3.6 + phase * 5.3);

  let lift = A.lift * figH * breath * input.breathing * depth;
  let widen = A.widen * breath * input.breathing * depth;
  let sway = A.sway * figH * swayWave * input.sway * swayAmp;
  // The head balances the lean a little, then wanders on its own.
  let tilt = A.tilt * (tiltWave * 0.8 + swayWave * 0.3 * input.sway) * head;
  let bob = A.bob * figH * bobWave * head;
  let nod = 0;
  let stretch = 0;
  let posture = m.posture * act;
  let shoulders = m.shoulders * act;
  let turn = 0;
  let tremble = m.tremble * act;

  // Mood: a held head pitch and tilt; a sob catches the breath; laughter shakes the chest.
  nod += m.pitch * act * A.pitch * figH * head;
  tilt += m.tilt * act * side * head;
  if (m.sob * act > 0) {
    const k = Math.floor(t / 0.42);
    const catchAt = k * 0.42 + 0.08 + 0.2 * puppetNoise(k + phase * 31);
    const spike = puppetNoise(k * 1.7 + phase) < 0.55 ? Math.exp(-(((t - catchAt) / 0.08) ** 2)) : 0;
    lift += m.sob * act * spike * 0.9 * A.lift * figH;
    shoulders += m.sob * act * spike * 0.5;
    nod += m.sob * act * spike * 0.25 * A.nod * figH * head;
  }
  if (m.chuckle * act > 0) {
    const burst = clamp01((Math.sin((TAU * t) / 2.4 + phase * 5) + 0.2) * 1.5);
    const beat = (0.5 - 0.5 * Math.cos(TAU * 4.6 * t)) ** 2;
    const c = m.chuckle * act * burst * beat;
    lift += c * 0.8 * A.lift * figH;
    shoulders += c * 0.5;
    stretch += c * 0.004;
  }

  if (input.talk > 0) {
    const voice = input.voice;
    const live = voice ? voice.active * act : 0;
    // Without typed text (or acting), syllable-like dips in short phrases and a small roll.
    if (live < 1) {
      const phrase = 0.55 + 0.45 * Math.sin(TAU * t * 0.55 + phase * 3.3);
      const syllable = 0.5 - 0.5 * Math.cos(TAU * t * 2.7);
      bob -= A.talkBob * figH * phrase * syllable * input.talk * (1 - live) * energy;
      tilt += A.talkTilt * Math.sin(TAU * t * 1.15 + phase * 6.1) * input.talk * (1 - live);
    }
    // With typed text: the head follows the syllables and the punctuation.
    if (voice && act > 0) {
      const k = input.talk * act;
      bob -= A.talkBob * figH * voice.syllable * energy * k * voice.active;
      tilt += A.talkTilt * 0.6 * voice.syllable * Math.sin(t * 9.1 + phase * 6) * k;
      nod += A.nod * figH * (0.6 * voice.exclaim + 0.45 * voice.stop + 0.4 * voice.trail) * k * head;
      stretch += 0.006 * voice.exclaim * energy * k;
      tilt += A.questionTilt * voice.question * side * k * head;
      nod -= A.nod * figH * 0.25 * voice.question * k * head;
      sway += A.sway * figH * 0.9 * voice.play * k;
      lift += A.lift * figH * 0.8 * voice.inhale * k;
      posture -= 0.3 * voice.trail * k;
    }
  }

  // The line-start reaction plays whatever the head setting (that one is the idle wander).
  const reaction = input.reaction;
  if (reaction && reaction.age >= 0) {
    const r = puppetGesture(reaction.kind, reaction.age, 1, side, puppetGestureDelta());
    nod += r.nod * A.nod * figH;
    lift += r.lift * A.lift * figH;
    stretch += r.stretch;
  }
  // An expression change's take, melt, flare or blush plays whatever the acting and head settings.
  if (input.shift && input.shift.age >= 0) {
    const sd = puppetShiftGesture(input.shift.kind, input.shift.age, input.shift.gain, puppetGestureDelta());
    nod += sd.nod * A.nod * figH;
    lift += sd.lift * A.lift * figH;
    stretch += sd.stretch;
    tilt += sd.tilt;
    shoulders += sd.shoulders;
    posture += sd.posture;
  }
  // Gestures: listener nods, emote and staged-motion reactions.
  const d = puppetGestureDelta();
  for (const g of input.gestures ?? []) puppetGesture(g.kind, g.age, g.gain, g.side, d);
  nod += d.nod * A.nod * figH * head;
  lift += d.lift * A.lift * figH;
  stretch += d.stretch;
  tilt += d.tilt * head;
  turn += d.turn * A.turn * faceW * head;
  shoulders += d.shoulders;
  posture += d.posture;
  sway += d.sway * A.sway * figH;
  tremble += d.tremble;

  // Attention: the head tilts and turns a little toward whoever is looked at, the body leans a hair.
  turn += gaze * A.turn * faceW * head;
  tilt += gaze * A.gazeTilt * head;
  sway += gaze * A.gazeLean * figH;
  const bodyTurn = gaze * A.bodyTurn * figH;

  // A shiver, not a spasm: a few hertz, in the body and shoulders; the head rolls only a hair
  // (a fast head roll on a warped image reads as convulsing).
  if (tremble > 0) {
    const j1 = Math.sin(TAU * 6.3 * t) + 0.5 * Math.sin(TAU * 8.9 * t + 1.3);
    const j2 = Math.sin(TAU * 7.1 * t + 0.4) + 0.4 * Math.sin(TAU * 9.7 * t + 2.1);
    sway += tremble * A.tremble * figH * j1 * 0.6;
    tilt += tremble * 0.18 * (Math.PI / 180) * j2 * head;
    shoulders += tremble * 0.06 * (1 + 0.7 * j2);
  }

  // Physics: the body's loose mass shears and squashes; hems, sleeves and hair trail.
  let lagX = 0;
  let lagY = 0;
  let hairX = 0;
  let hairY = 0;
  const p = input.physics;
  if (p) {
    sway += p.bodyX * 0.7;
    stretch += p.bodyY * 0.9;
    widen -= p.bodyY * 0.4;
    lagX = p.bodyX * 1.1 + p.windX;
    lagY = p.bodyY * 0.5;
    hairX = p.hairX + p.windX * 0.8;
    hairY = p.hairY;
  }

  const s = strength;
  return {
    lift: lift * s,
    widen: widen * s,
    sway: sway * s,
    tilt: tilt * s,
    bob: bob * s,
    nod: nod * s,
    stretch: stretch * s,
    posture: Math.max(-1.5, Math.min(1.5, posture)) * A.posture * s,
    shoulders: Math.max(-0.5, Math.min(1.6, shoulders)) * A.shoulders * figH * s,
    turn: turn * s,
    bodyTurn: bodyTurn * s,
    lagX: lagX * s,
    lagY: lagY * s,
    hairX: hairX * s,
    hairY: hairY * s,
  };
}

/* ------------------------------------------------------------------------ */
/* Mesh                                                                       */
/* ------------------------------------------------------------------------ */

export type PuppetGrid = {
  cols: number;
  rows: number;
  /** Texture coordinates per vertex (u, v), v down. */
  uv: Float32Array;
  indices: Uint16Array;
};

/** A cols x rows grid of quads over the whole image. */
export function puppetGrid(cols = 24, rows = 36): PuppetGrid {
  const uv = new Float32Array((cols + 1) * (rows + 1) * 2);
  let k = 0;
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      uv[k++] = c / cols;
      uv[k++] = r / rows;
    }
  }
  const indices = new Uint16Array(cols * rows * 6);
  k = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      indices[k++] = a; indices[k++] = d; indices[k++] = b;
      indices[k++] = b; indices[k++] = d; indices[k++] = e;
    }
  }
  return { cols, rows, uv, indices };
}

/** Clip-space positions of the grid's vertices under a pose (the canvas covers the image box). */
export function puppetMeshPositions(rig: PuppetRig, pose: PuppetPose, grid: PuppetGrid, out = new Float32Array(grid.uv.length)): Float32Array {
  const scratch: [number, number] = [0, 0];
  const { uv } = grid;
  for (let i = 0; i < uv.length; i += 2) {
    const u = uv[i]!;
    const v = uv[i + 1]!;
    puppetDisplace(rig, pose, (u - rig.cx) * rig.aspect, rig.by - v, scratch);
    out[i] = 2 * (u + scratch[0] / rig.aspect) - 1;
    out[i + 1] = 1 - 2 * (v - scratch[1]);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Look: CSS light, tint and rim read back for the shader                    */
/* ------------------------------------------------------------------------ */

/** A colour transform as a 3x3 matrix (row-major) plus an offset: c' = M c + o. */
export type ColorMatrix = { m: number[]; o: [number, number, number] };

export const IDENTITY_COLOR: Readonly<ColorMatrix> = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0] };

const amount = (raw: string, fallback: number): number => {
  const text = raw.trim();
  if (!text) return fallback;
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return fallback;
  return text.endsWith("%") ? value / 100 : value;
};

const angle = (raw: string): number => {
  const text = raw.trim();
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return 0;
  if (text.endsWith("rad")) return value;
  if (text.endsWith("turn")) return value * TAU;
  if (text.endsWith("grad")) return (value * Math.PI) / 200;
  return (value * Math.PI) / 180;
};

const saturateMatrix = (s: number): number[] => [
  0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
];

/** One CSS filter function as a colour matrix (Filter Effects 1), or null when it is not a colour filter. */
function filterFunction(name: string, arg: string): ColorMatrix | null {
  switch (name) {
    case "brightness": {
      const a = Math.max(0, amount(arg, 1));
      return { m: [a, 0, 0, 0, a, 0, 0, 0, a], o: [0, 0, 0] };
    }
    case "contrast": {
      const a = Math.max(0, amount(arg, 1));
      const o = 0.5 - 0.5 * a;
      return { m: [a, 0, 0, 0, a, 0, 0, 0, a], o: [o, o, o] };
    }
    case "saturate":
      return { m: saturateMatrix(Math.max(0, amount(arg, 1))), o: [0, 0, 0] };
    case "grayscale": {
      const s = 1 - clamp01(amount(arg, 1));
      return { m: [
        0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s,
        0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s,
        0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s,
      ], o: [0, 0, 0] };
    }
    case "sepia": {
      const s = 1 - clamp01(amount(arg, 1));
      return { m: [
        0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s,
        0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s,
        0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s,
      ], o: [0, 0, 0] };
    }
    case "invert": {
      const a = clamp01(amount(arg, 1));
      const d = 1 - 2 * a;
      return { m: [d, 0, 0, 0, d, 0, 0, 0, d], o: [a, a, a] };
    }
    case "hue-rotate": {
      const r = angle(arg);
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      return { m: [
        0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
        0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
        0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
      ], o: [0, 0, 0] };
    }
    default:
      return null;
  }
}

/** b after a: (B ∘ A)(c) = B (A c + oA) + oB. */
function compose(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const m: number[] = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      m.push(b.m[r * 3]! * a.m[c]! + b.m[r * 3 + 1]! * a.m[3 + c]! + b.m[r * 3 + 2]! * a.m[6 + c]!);
    }
  }
  const o: [number, number, number] = [0, 0, 0];
  for (let r = 0; r < 3; r += 1) {
    o[r] = b.m[r * 3]! * a.o[0] + b.m[r * 3 + 1]! * a.o[1] + b.m[r * 3 + 2]! * a.o[2] + b.o[r]!;
  }
  return { m, o };
}

/**
 * A computed CSS `filter` value ("brightness(0.8) saturate(0.78)") as one
 * colour matrix, functions applied left to right. Non-colour functions
 * (blur, drop-shadow, opacity) are skipped; "none" is the identity.
 */
export function cssFilterMatrix(filter: string | null | undefined): ColorMatrix {
  let result: ColorMatrix = { m: [...IDENTITY_COLOR.m], o: [0, 0, 0] };
  if (!filter || filter === "none") return result;
  const pattern = /([a-z-]+)\(([^()]*)\)/gi;
  for (const match of filter.matchAll(pattern)) {
    const next = filterFunction(match[1]!.toLowerCase(), match[2]!);
    if (next) result = compose(result, next);
  }
  return result;
}

/** "rgb(255, 244, 214)" / "rgba(0, 0, 0, 0)" / "rgb(1 2 3 / 50%)" as 0..1 floats; null when unreadable. */
export function parseCssColor(value: string | null | undefined): [number, number, number, number] | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (text === "transparent") return [0, 0, 0, 0];
  const match = /^rgba?\(([^)]*)\)$/.exec(text);
  if (match) {
    const parts = match[1]!.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (part: string) => clamp01(part.endsWith("%") ? Number.parseFloat(part) / 100 : Number.parseFloat(part) / 255);
    const alpha = parts[3] === undefined ? 1 : clamp01(amount(parts[3], 1));
    const rgb = parts.slice(0, 3).map(channel);
    return rgb.some((n) => !Number.isFinite(n)) ? null : [rgb[0]!, rgb[1]!, rgb[2]!, alpha];
  }
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex && (hex.length === 3 || hex.length === 6)) {
    const full = hex.length === 3 ? [...hex].map((ch) => ch + ch).join("") : hex;
    return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255).concat(1) as [number, number, number, number];
  }
  return null;
}

/** Blend modes the shader knows (the ones the light presets use, plus a few). */
export const PUPPET_BLEND_MODES = ["normal", "multiply", "screen", "overlay", "soft-light"] as const;

export function puppetBlendIndex(mode: string | null | undefined): number {
  const index = (PUPPET_BLEND_MODES as readonly string[]).indexOf((mode ?? "").trim());
  return index < 0 ? 0 : index;
}
