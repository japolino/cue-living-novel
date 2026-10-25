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
 * so hair and shoulders blend into the still parts.
 */
import type { SpriteFaceSpot, SpriteGeometry } from "./sprite-layer.js";

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
};

/** The rig of one image, from its geometry and face spot (detected box or framing estimate). */
export function puppetRig(geometry: SpriteGeometry, spot: SpriteFaceSpot): PuppetRig {
  const aspect = geometry.aspect;
  const faceH = Math.max(0.02, spot.top - spot.bottom);
  const faceW = Math.max(0.02, spot.w * aspect);
  const faceX = spot.dx * aspect;
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
    chestY: Math.max(0.08 * geometry.bh, spot.bottom - 1.15 * faceH),
    chestRx: 1.5 * faceW,
    chestRy: 0.85 * faceH,
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
};

export const PUPPET_REST: Readonly<PuppetPose> = { lift: 0, widen: 0, sway: 0, tilt: 0, bob: 0, nod: 0, stretch: 0 };

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
  if (pose.tilt || pose.bob || pose.nod) {
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

export type PuppetPoseInput = {
  /** Seconds. */
  time: number;
  /** From puppetPhase. */
  phase: number;
  figH: number;
  /** 0..1 each (the caller eases them when a setting changes). */
  breathing: number;
  sway: number;
  head: number;
  /** 0..1 talking level (eased in and out by the caller). */
  talk: number;
  reaction: { kind: PuppetReaction; age: number } | null;
  /** Overall strength: motion setting x effect intensity. */
  strength: number;
};

const TAU = Math.PI * 2;

/** The pose of one actor at a time. */
export function puppetPose(input: PuppetPoseInput): PuppetPose {
  const { phase, figH, strength } = input;
  if (strength <= 0) return { ...PUPPET_REST };
  const A = PUPPET_AMPLITUDE;
  // Each actor runs on its own clock and slightly different periods.
  const t = input.time + phase * 37.1;
  const breathPeriod = 3.9 + phase * 0.7;
  const theta = (TAU * t) / breathPeriod;
  const breath = clamp01(0.5 - 0.5 * Math.cos(theta) + 0.06 * Math.sin(2 * theta));
  const swayWave = 0.78 * Math.sin((TAU * t) / 7.3 + phase * 4.1) + 0.22 * Math.sin((TAU * t) / 3.1 + phase * 9.7);
  const tiltWave = 0.72 * Math.sin((TAU * t) / 5.9 + phase * 2.3) + 0.28 * Math.sin((TAU * t) / 2.3 + phase * 7.9);
  const bobWave = Math.sin((TAU * t) / 3.6 + phase * 5.3);

  let lift = A.lift * figH * breath * input.breathing;
  const widen = A.widen * breath * input.breathing;
  const sway = A.sway * figH * swayWave * input.sway;
  // The head balances the lean a little, then wanders on its own.
  let tilt = A.tilt * (tiltWave * 0.8 + swayWave * 0.3 * input.sway) * input.head;
  let bob = A.bob * figH * bobWave * input.head;
  let nod = 0;
  let stretch = 0;

  if (input.talk > 0) {
    // Syllable-like dips in short phrases, and a small roll.
    const phrase = 0.55 + 0.45 * Math.sin(TAU * t * 0.55 + phase * 3.3);
    const syllable = 0.5 - 0.5 * Math.cos(TAU * t * 2.7);
    bob -= A.talkBob * figH * phrase * syllable * input.talk;
    tilt += A.talkTilt * Math.sin(TAU * t * 1.15 + phase * 6.1) * input.talk;
  }

  const reaction = input.reaction;
  if (reaction && reaction.age >= 0) {
    const age = reaction.age;
    if (reaction.kind === "nod" && age < PUPPET_REACTION_MS.nod / 1000) {
      const s = Math.sin((Math.PI * age) / (PUPPET_REACTION_MS.nod / 1000));
      nod += A.nod * figH * s * s;
    } else if (reaction.kind === "bounce" && age < PUPPET_REACTION_MS.bounce / 1000) {
      stretch += A.bounce * Math.sin((TAU * age) / 0.38) * Math.exp(-age / 0.2);
      lift += A.lift * figH * 0.6 * Math.sin((Math.PI * Math.min(age, 0.3)) / 0.3);
    }
  }

  return {
    lift: lift * strength,
    widen: widen * strength,
    sway: sway * strength,
    tilt: tilt * strength,
    bob: bob * strength,
    nod: nod * strength,
    stretch: stretch * strength,
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
export function puppetGrid(cols = 18, rows = 28): PuppetGrid {
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
