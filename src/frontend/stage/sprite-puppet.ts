/**
 * PNG-puppet renderer for cut-out sprites (docs/SPRITE_MODE.md, "Puppet
 * motion"). The sprite layer stays the DOM it always was (actor > body >
 * figure > two image layers, plus the marks box); this adds a canvas to each
 * image layer and, with WebGL, draws the cut-out through a warped vertex
 * grid (sprite-puppet-rig.ts): breathing in the chest band, a sway that
 * bends from the feet, and a head that tilts and bobs around a neck pivot
 * placed from the face box. Everything the CSS did to the static image is
 * done in the same pass (light filter, tint, rim light, mood grade), plus
 * the sticker outline (baked once, sprite-outline.ts) and the focus blur of
 * characters who are not speaking. CSS motions on the body (hop, nod,
 * shake...), the crossfade, enter/exit and the dimming still apply on top,
 * since the canvas sits where the img was.
 *
 * Acting (sprite-puppet-acting.ts): the body carries the staged mood, the
 * speaker's head follows the typed text (`typed`), listeners turn to the
 * speaker and nod at the ends of sentences, characters glance at each other
 * when nobody speaks, and emotes and staged motions get a body reaction.
 * Physics (sprite-puppet-physics.ts): the anchor of each figure is tracked
 * on screen, so a slot change, a staged hop or an entrance makes the loose
 * parts and the hair trail and settle; the weather ambient adds wind.
 *
 * One WebGL context draws every layer and copies the result into the
 * layer's 2D canvas; one rAF loop runs while any actor is in puppet mode and
 * pauses when the page is hidden, the stage is off screen, or a key
 * illustration covers the sprites.
 *
 * Fallback ("css" mode): no WebGL (or only a software one), the OS asks for
 * reduced motion, Motion is "off", or the motion strength is 0. The img and
 * today's CSS breathing and talking bob show; the outline, when set, is the
 * baked canvas shown statically.
 */
import { DEFAULT_CONFIG, spritePuppetSettings, type VisualNovelSpritePuppet } from "../../config.js";
import type { SpriteEmote, SpriteMotion } from "../../shared/sprites.js";
import type { SpriteFaceSpot, SpriteGeometry } from "./sprite-layer.js";
import { bakeSpriteOutline } from "./sprite-outline.js";
import {
  PUPPET_EMOTE_GESTURE,
  PUPPET_GESTURE_S,
  PUPPET_MOTION_GESTURE,
  PUPPET_NEUTRAL_MOOD,
  easeMood,
  puppetMoodFor,
  puppetNoise,
  puppetVoice,
  puppetVoiceSample,
  puppetVoiceType,
  type PuppetGestureKind,
  type PuppetMood,
  type PuppetVoice,
} from "./sprite-puppet-acting.js";
import {
  PUPPET_BODY_SPRING,
  PUPPET_HAIR_SPRING,
  puppetSpring,
  puppetTracker,
  puppetWind,
  puppetWindPush,
  springKick,
  springStep,
  trackPoint,
  type PuppetSpring,
  type PuppetTracker,
} from "./sprite-puppet-physics.js";
import { puppetQuality, puppetQualityFrame, puppetRenderScale } from "./sprite-puppet-quality.js";
import {
  PUPPET_ARRIVAL_S,
  PUPPET_CALM_AIR,
  PUPPET_SHIFT,
  PUPPET_SWEEP,
  puppetArrivalBlur,
  puppetAtmosphere,
  puppetDangerBeat,
  puppetExhaleStarted,
  puppetFireFlicker,
  puppetFireflies,
  puppetMouth,
  puppetPuff,
  puppetPuffAt,
  puppetShiftFor,
  puppetShiftGain,
  puppetShiftReveal,
  puppetSnowFrame,
  type PuppetAtmosphere,
  type PuppetPuff,
  type PuppetShiftKind,
} from "./sprite-puppet-fx.js";
import {
  IDENTITY_COLOR,
  PUPPET_REACTION_MS,
  cssFilterMatrix,
  parseCssColor,
  puppetBlendIndex,
  puppetBreathCycle,
  puppetDisplace,
  puppetFaceOffset,
  puppetGrid,
  puppetMeshPositions,
  puppetPhase,
  puppetPose,
  puppetRig,
  type ColorMatrix,
  type PuppetGrid,
  type PuppetPose,
  type PuppetReaction,
  type PuppetRig,
} from "./sprite-puppet-rig.js";

export type PuppetImage = {
  url: string;
  geometry: SpriteGeometry;
  spot: SpriteFaceSpot;
};

export type PuppetActorRef = {
  key: string;
  el: HTMLElement;
  /** The element the staged motions move (its anchor is tracked for the physics). */
  body: HTMLElement;
  marks: HTMLElement;
  layers: readonly [HTMLElement, HTMLElement];
};

/** "gl": the warped canvas; "css": the img and the CSS idle motion. */
export type PuppetMode = "gl" | "css";

/** What an actor's transitions and atmosphere are doing now (sprite snapshot, tests). */
export type PuppetEffects = {
  /** The expression change playing, if any, and how far the new image has spread (0..1). */
  shift: PuppetShiftKind | null;
  reveal: number;
  /** Blur now (CSS px): a focus pull or the dimming. */
  blur: number;
  /** Breath clouds in the air. */
  puffs: number;
  /** The weather and light on the character (snow: what has settled). */
  air: PuppetAtmosphere;
};

/** Blur of characters who are not speaking (CSS px), with `spriteFocusBlur`. */
export const PUPPET_FOCUS_BLUR_PX = 1;
/** Motion "gentle" scales the puppet like the CSS motions (--vn-sprite-fx in sprite-css.ts). */
export const PUPPET_GENTLE = 0.55;
/** Rim light width in image heights (matches --vn-sprite-rim-w in sprite-css.ts). */
const RIM_WIDTH = 0.0055;
const MAX_DPR = 2;
const MAX_BACKING = 2048;
const BAKE_CACHE = 8;
const TEXTURE_CACHE = 8;

/**
 * Test seam: software WebGL (SwiftShader, llvmpipe) is refused by default,
 * since warping full-size sprites on the CPU every frame costs more than it
 * gives; the browser fixtures turn this on to exercise the WebGL path.
 * `renderScale` pins the adaptive render scale (null: adaptive).
 */
export const puppetGlOptions: { allowSoftware: boolean; renderScale: number | null } = { allowSoftware: false, renderScale: null };

type Look = {
  key: string;
  light: ColorMatrix;
  air: ColorMatrix;
  tint: [number, number, number, number];
  tintMode: number;
  rim: [number, number, number, number];
  rimX: number;
  rimY: number;
  flip: number;
};

type ActorState = {
  ref: PuppetActorRef;
  phase: number;
  mode: PuppetMode;
  tainted: boolean;
  talking: boolean;
  reaction: { kind: PuppetReaction; start: number } | null;
  /** Eased 0..1 weights, so a toggle or a line start never snaps. */
  breathing: number;
  sway: number;
  head: number;
  talk: number;
  dim: number;
  marksMoved: boolean;
  /** The staged expression's mood, and the mood the body carries now (eased toward it). */
  moodTarget: PuppetMood;
  mood: PuppetMood;
  /** Eased weights of the acting and physics settings. */
  acting: number;
  physics: number;
  /** Breath and sway clocks: they run faster or slower with the mood, without jumps. */
  clocks: { breath: number; sway: number };
  voice: PuppetVoice;
  /** The syllable beat through a soft spring (the head follows the words, it does not twitch on each vowel). */
  syllable: number;
  syllableV: number;
  gestures: Gesture[];
  /** Where the character looks (image space, -1..1) and its spring. */
  gaze: number;
  gazeV: number;
  /** ±1: the side its head tilts to when it looks at no one. */
  side: number;
  /** Anchor x on screen (CSS px), refreshed a few times a second. */
  screenX: number;
  /** Last listener reaction, and the idle glance schedule (seconds). */
  heardAt: number;
  glanceAt: number;
  glanceUntil: number;
  glanceDir: number;
  body: PuppetSpring;
  hair: PuppetSpring;
  bodyTrack: PuppetTracker;
  headTrack: PuppetTracker;
  /** The last pose drawn for the active layer. */
  pose: PuppetPose | null;
  /** An expression change playing in the shader; its clock starts when the new image first draws. */
  shift: Shift | null;
  /** The body's part of the last shift (it settles a little after the images have changed). */
  take: { kind: PuppetShiftKind; start: number; gain: number } | null;
  /** The layer a finished shift left behind: not drawn while it is still "leaving". */
  gone: HTMLElement | null;
  /** The sprite state last seen (entering, shown, exiting) and since when (seconds): the focus pull. */
  arrival: { state: string; since: number };
  /** The atmosphere on this character now (eased toward the scene's), and the snow settled on it. */
  air: PuppetAtmosphere;
  snow: number;
  /** Breath clouds in the air, the breath cycle last frame, and the last cloud's time. */
  puffs: PuppetPuff[];
  breathCycle: number;
  puffAt: number;
  /** Blur of the focus pull or the dimming (CSS px), this frame. */
  blur: number;
};

type Shift = {
  kind: PuppetShiftKind;
  gain: number;
  incoming: HTMLElement;
  outgoing: HTMLElement;
  /** When it was asked for, and when the new image first drew (seconds; null until then). */
  asked: number;
  start: number | null;
};

/** A shift whose new image has not drawn by then plays as the CSS crossfade instead (seconds). */
const SHIFT_START_LIMIT = 0.6;
/** Extra time the sprite layer waits for a shift that starts a little late (ms). */
const SHIFT_SLACK_MS = 120;
/** At most this many breath clouds per character. */
const PUFF_LIMIT = 6;

type Gesture = { kind: PuppetGestureKind; start: number; gain: number; side: number };

type LayerState = {
  el: HTMLElement;
  actor: ActorState;
  image: PuppetImage | null;
  rig: PuppetRig | null;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  showing: "puppet" | "outline" | null;
  /** Texture or bake (url|outline radius) the canvas is drawn from. */
  sourceKey: string | null;
  waiting: string | null;
  look: Look | null;
  lookAt: number;
  lookSteady: number;
};

type TextureEntry = { tex: WebGLTexture; width: number; height: number; used: number };

type GlState = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  webgl2: boolean;
  grid: PuppetGrid;
  positions: Float32Array<ArrayBuffer>;
  posBuffer: WebGLBuffer;
  /** The plain and effects variants of the fragment shader; `uniforms` are the current one's. */
  programs: Record<"plain" | "fx", GlProgram>;
  current: "plain" | "fx";
  uniforms: GlUniforms;
};

type GlUniforms = Record<
  "tex" | "blur" | "lod" | "light" | "lightOffset" | "air" | "airOffset" | "tint" | "tintMode" | "rim" | "rimOffset"
  | "reveal" | "revealGlow" | "revealShape" | "figure" | "texel" | "atmoA" | "atmoB" | "flyPos" | "flyGlow" | "fogColor",
  WebGLUniformLocation | null
>;

type GlProgram = { program: WebGLProgram; uniforms: GlUniforms };

const VERTEX_SHADER = `
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/* Mirrors the CSS stack of an image layer: img (light filter) -> ::after tint
   (blend mode, masked by the figure) -> ::before rim (screen, the figure
   minus itself shifted away from the light) -> layer filter (mood grade).
   Colours are premultiplied in the texture and in the output.
   On top (sprite-puppet-fx.ts): the reveal mask of an expression change
   (with its glowing edge), the blur of a focus pull (mip bias), and the
   atmosphere: shimmer and glow (dream haze), colour split (danger pulse),
   wet sheen and running drops (rain), firelight (embers), ground mist (fog),
   film grain (flashback), settling snow, and firefly glows. Those compile
   only into the VN_FX variant: a layer draws with it while a change or the
   weather touches it, else with the plain one (a software renderer pays for
   every branch, even one a uniform turns off). */
const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uBlur;
uniform float uLod;
uniform mat3 uLight;
uniform vec3 uLightOffset;
uniform mat3 uAir;
uniform vec3 uAirOffset;
uniform vec4 uTint;
uniform float uTintMode;
uniform vec4 uRim;
uniform vec2 uRimOffset;
uniform vec4 uReveal;
uniform vec4 uRevealGlow;
uniform vec4 uRevealShape;
uniform vec4 uFigure;
uniform vec2 uTexel;
uniform vec4 uAtmoA;
uniform vec4 uAtmoB;
uniform vec4 uFlyPos;
uniform vec2 uFlyGlow;
uniform vec3 uFogColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec4 tap(vec2 uv) {
  return texture2D(uTex, uv, uLod);
}

vec4 figure(vec2 uv) {
  // Without a blur the plain lookup: the bias form costs more where sampling runs in software.
  if (uBlur.x <= 0.0 && uBlur.y <= 0.0) return texture2D(uTex, uv);
  vec4 sum = tap(uv) * 4.0;
  sum += (tap(uv + vec2(uBlur.x, 0.0)) + tap(uv - vec2(uBlur.x, 0.0))
    + tap(uv + vec2(0.0, uBlur.y)) + tap(uv - vec2(0.0, uBlur.y))) * 2.0;
  sum += tap(uv + uBlur) + tap(uv - uBlur)
    + tap(uv + vec2(uBlur.x, -uBlur.y)) + tap(uv + vec2(-uBlur.x, uBlur.y));
  return sum / 16.0;
}

float softLight(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}

float overlay(float b, float s) {
  return b <= 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s);
}

vec3 blendMode(vec3 b, vec3 s, float mode) {
  if (mode < 0.5) return s;
  if (mode < 1.5) return b * s;
  if (mode < 2.5) return b + s - b * s;
  if (mode < 3.5) return vec3(overlay(b.r, s.r), overlay(b.g, s.g), overlay(b.b, s.b));
  return vec3(softLight(b.r, s.r), softLight(b.g, s.g), softLight(b.b, s.b));
}

/* How much of this layer shows during an expression change: the new image
   spreads from the face (or from the top down, or at a cut) through a soft,
   grainy edge; the old one goes just behind that edge, in a band of its own,
   so one of the two is always opaque and the figure never turns see-through. */
float revealMask(vec2 uv) {
  if (uReveal.z < -0.5) return 1.0;
  float w = max(uReveal.y, 0.001);
  vec2 q = vec2(uv.x * uFigure.x, uv.y);
  float field;
  float n;
  if (uReveal.z < 0.5) {
    field = length(q - vec2(uRevealShape.x * uFigure.x, uRevealShape.y)) / max(uRevealShape.z, 0.01);
    n = vnoise(q * 14.0) * 0.65 + vnoise(q * 37.0) * 0.35;
  } else if (uReveal.z < 1.5) {
    field = (uv.y - uFigure.y) / max(uFigure.z, 0.01);
    n = vnoise(vec2(q.x * 26.0, q.y * 2.5)) * 0.8 + vnoise(q * 40.0) * 0.2;
  } else {
    field = 0.0;
    n = 0.0;
  }
  field = mix(field, n, uRevealShape.w);
  // The gap between the two bands absorbs small differences between the two images' rigs.
  float gap = 0.1;
  float p = uReveal.x * (1.0 + 2.0 * w + gap);
  if (uReveal.w < 0.0) return 1.0 - smoothstep(field + w + gap, field + 2.0 * w + gap, p);
  return smoothstep(field, field + w, p);
}

void main() {
  vec2 uv = vUv;
#ifdef VN_FX
  float haze = uAtmoB.x;
  if (haze > 0.0) uv.x += sin(uv.y * 26.0 + uAtmoB.w * 1.7) * 0.0016 * haze;
#endif
  vec4 t = figure(uv);
#ifdef VN_FX
  float beat = uAtmoB.y;
  if (beat > 0.001) {
    vec2 o = vec2(uTexel.x * 3.0 * beat, 0.0);
    vec4 rs = figure(uv + o);
    vec4 bs = figure(uv - o);
    t = vec4(rs.r, t.g, bs.b, max(t.a, max(rs.a, bs.a)));
  }
  vec4 halo = vec4(0.0);
  if (haze > 0.0) {
    vec4 bloom = texture2D(uTex, uv, uLod + 4.0);
    halo = vec4(mix(bloom.rgb, vec3(bloom.a), 0.55), bloom.a) * 0.38 * haze;
  }
  float mask = revealMask(uv);
  if (t.a * mask < 0.002) {
    gl_FragColor = halo * mask;
    return;
  }
#else
  if (t.a < 0.002) {
    gl_FragColor = vec4(0.0);
    return;
  }
#endif
  vec3 c = clamp(t.rgb / t.a, 0.0, 1.0);
  c = clamp(uLight * c + uLightOffset, 0.0, 1.0);
  c = mix(c, blendMode(c, uTint.rgb, uTintMode), uTint.a);
  float shifted = texture2D(uTex, uv - uRimOffset).a;
  c = mix(c, c + uRim.rgb - c * uRim.rgb, uRim.a * clamp(1.0 - shifted, 0.0, 1.0));
  float a = t.a;
#ifdef VN_FX
  // Height in the figure: 0 at the feet, 1 at the top of the head.
  float h = clamp((uFigure.w - uv.y) / max(uFigure.z, 0.01), 0.0, 1.0);
  float time = uAtmoB.w;
  float wet = uAtmoA.y;
  if (wet > 0.0) {
    float above = texture2D(uTex, uv - vec2(0.0, uTexel.y * 3.0)).a;
    float top = clamp(t.a - above, 0.0, 1.0);
    c *= 1.0 - 0.1 * wet;
    c = mix(c, c * c * 1.12 + 0.02, 0.25 * wet);
    c += vec3(0.8, 0.88, 1.0) * top * 0.24 * wet;
    float cell = uv.x / (uTexel.x * 9.0);
    float col = floor(cell);
    float r = hash(vec2(col, 3.7));
    if (r > 0.8) {
      float y = fract(uv.y * 1.6 - time * (0.22 + 0.35 * fract(r * 7.0)) + r * 13.0);
      float drop = smoothstep(0.0, 0.012, y) * (1.0 - smoothstep(0.012, 0.08, y));
      float across = 1.0 - abs(fract(cell) - 0.5) * 2.0;
      c += vec3(0.85, 0.9, 1.0) * drop * smoothstep(0.55, 1.0, across) * 0.3 * wet;
    }
  }
  float fire = uAtmoA.z;
  if (fire > 0.0) {
    float k = fire * (0.12 + 0.22 * (1.0 - h) * (1.0 - h));
    c += vec3(1.0, 0.5, 0.18) * k * (0.55 + 0.45 * c);
  }
  if (uFlyGlow.x + uFlyGlow.y > 0.0) {
    vec2 d1 = (uv - uFlyPos.xy) * vec2(uFigure.x, 1.0);
    vec2 d2 = (uv - uFlyPos.zw) * vec2(uFigure.x, 1.0);
    float g = uFlyGlow.x * exp(-dot(d1, d1) / 0.0018) + uFlyGlow.y * exp(-dot(d2, d2) / 0.0018);
    c += vec3(0.72, 1.0, 0.42) * g * 0.5;
  }
  float snow = uAtmoB.z;
  if (snow > 0.001) {
    float far = texture2D(uTex, uv - vec2(0.0, uTexel.y * 6.0)).a;
    float top = clamp(t.a * (1.0 - far) * 1.6, 0.0, 1.0);
    float n = vnoise(uv / (uTexel * 4.0)) * 0.7 + vnoise(uv / (uTexel * 13.0)) * 0.3;
    float flake = top * smoothstep(1.0 - snow, 1.0 - snow + 0.12, n);
    c = mix(c, vec3(0.95, 0.97, 1.0), flake * 0.92);
  }
#endif
  c = clamp(uAir * clamp(c, 0.0, 1.0) + uAirOffset, 0.0, 1.0);
#ifdef VN_FX
  float fog = uAtmoA.x;
  if (fog > 0.0) {
    float drift = vnoise(vec2(uv.x * 5.0 + time * 0.04, uv.y * 3.0)) - 0.5;
    float mist = fog * (1.0 - smoothstep(0.0, 0.5, h + drift * 0.16)) * 0.62;
    c = mix(c, uFogColor, mist);
    a *= 1.0 - mist * 0.4;
  }
  float grain = uAtmoA.w;
  if (grain > 0.0) {
    c += (hash(floor(uv / uTexel) + floor(time * 24.0)) - 0.5) * 0.09 * grain;
    c *= 1.0 + (hash(vec2(floor(time * 12.0), 1.3)) - 0.5) * 0.05 * grain;
  }
  float glow = uReveal.w > 0.0 && uReveal.z > -0.5 ? mask * (1.0 - mask) * 4.0 : 0.0;
  c = clamp(c + uRevealGlow.rgb * uRevealGlow.a * glow, 0.0, 1.0);
  a *= mask;
  vec4 col = vec4(c * a, a);
  gl_FragColor = col + halo * mask * (1.0 - col.a);
#else
  gl_FragColor = vec4(c * a, a);
#endif
}`;

/** A colour through a colour matrix, clamped to 0..1. */
function applyColor(matrix: ColorMatrix, rgb: readonly [number, number, number]): [number, number, number] {
  const m = matrix.m;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    out[i] = Math.max(0, Math.min(1, m[i * 3]! * rgb[0] + m[i * 3 + 1]! * rgb[1] + m[i * 3 + 2]! * rgb[2] + matrix.o[i]!));
  }
  return out;
}

/** Row-major 3x3 -> the column-major array uniformMatrix3fv wants. */
const columnMajor = (m: readonly number[]): Float32Array => new Float32Array([m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!]);

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** The head's syllable beat: a critically damped spring at about 3.5 Hz keeps the words' rhythm, drops the vowel ticks. */
function followSyllable(actor: ActorState, target: number, dt: number): void {
  const omega = Math.PI * 2 * 3.5;
  const steps = Math.max(1, Math.ceil(dt * 240));
  const h = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    actor.syllableV += (omega * omega * (target - actor.syllable) - 2 * omega * actor.syllableV) * h;
    actor.syllable += actor.syllableV * h;
  }
}

/** Whether a context renders on the CPU (not every browser flags that as a performance caveat). */
function softwareRenderer(gl: WebGLRenderingContext): boolean {
  const info = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null;
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
}

/** The shared context, or null when WebGL (hardware, unless allowed) is not available. */
function createGl(doc: Document): GlState | null {
  let canvas: HTMLCanvasElement;
  try {
    canvas = doc.createElement("canvas");
  } catch {
    return null;
  }
  if (typeof canvas.getContext !== "function") return null;
  const attributes: WebGLContextAttributes = {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: !puppetGlOptions.allowSoftware,
  };
  let gl: WebGLRenderingContext | null = null;
  let webgl2 = false;
  try {
    gl = canvas.getContext("webgl2", attributes) as WebGLRenderingContext | null;
    webgl2 = gl !== null;
    gl ??= canvas.getContext("webgl", attributes) as WebGLRenderingContext | null;
  } catch {
    return null;
  }
  if (!gl) return null;
  if (!puppetGlOptions.allowSoftware && softwareRenderer(gl)) {
    (gl.getExtension("WEBGL_lose_context") as { loseContext(): void } | null)?.loseContext();
    return null;
  }
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  if (!vertex) return null;
  const link = (source: string): GlProgram | null => {
    const fragment = compile(gl!, gl!.FRAGMENT_SHADER, source);
    const program = gl!.createProgram();
    if (!fragment || !program) return null;
    gl!.attachShader(program, vertex);
    gl!.attachShader(program, fragment);
    // Both variants read the same buffers.
    gl!.bindAttribLocation(program, 0, "aUv");
    gl!.bindAttribLocation(program, 1, "aPos");
    gl!.linkProgram(program);
    if (!gl!.getProgramParameter(program, gl!.LINK_STATUS)) return null;
    const uniform = (name: string) => gl!.getUniformLocation(program, name);
    const uniforms: GlUniforms = {
      tex: uniform("uTex"),
      blur: uniform("uBlur"),
      light: uniform("uLight"),
      lightOffset: uniform("uLightOffset"),
      air: uniform("uAir"),
      airOffset: uniform("uAirOffset"),
      tint: uniform("uTint"),
      tintMode: uniform("uTintMode"),
      rim: uniform("uRim"),
      rimOffset: uniform("uRimOffset"),
      lod: uniform("uLod"),
      reveal: uniform("uReveal"),
      revealGlow: uniform("uRevealGlow"),
      revealShape: uniform("uRevealShape"),
      figure: uniform("uFigure"),
      texel: uniform("uTexel"),
      atmoA: uniform("uAtmoA"),
      atmoB: uniform("uAtmoB"),
      flyPos: uniform("uFlyPos"),
      flyGlow: uniform("uFlyGlow"),
      fogColor: uniform("uFogColor"),
    };
    gl!.useProgram(program);
    gl!.uniform1i(uniforms.tex, 0);
    return { program, uniforms };
  };
  const fx = link(FRAGMENT_SHADER.replace("\n", "\n#define VN_FX\n"));
  const plain = link(FRAGMENT_SHADER);
  if (!fx || !plain) return null;
  gl.useProgram(plain.program);

  const grid = puppetGrid();
  const uvBuffer = gl.createBuffer();
  const posBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  if (!uvBuffer || !posBuffer || !indexBuffer) return null;
  const aUv = 0;
  const aPos = 1;
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, grid.uv, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
  const positions = new Float32Array(grid.uv.length);
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, grid.indices, gl.STATIC_DRAW);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);
  gl.activeTexture(gl.TEXTURE0);

  return { canvas, gl, webgl2, grid, positions, posBuffer, programs: { plain, fx }, current: "plain", uniforms: plain.uniforms };
}

const reducedMotionQuery = (): MediaQueryList | null =>
  typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export type SpritePuppetOptions = {
  /** The `[data-vn-sprites]` element (resolved lazily, like the sprite layer does). */
  container: () => HTMLElement;
};

export class SpritePuppet {
  private settings: VisualNovelSpritePuppet = spritePuppetSettings(DEFAULT_CONFIG);
  private readonly actors = new Map<string, ActorState>();
  private readonly layerStates = new Map<HTMLElement, LayerState>();
  /** undefined: not tried yet; null: not available (or lost). */
  private glState: GlState | null | undefined;
  private readonly textures = new Map<string, TextureEntry>();
  private readonly bakes = new Map<string, HTMLCanvasElement>();
  private raf = 0;
  private lastFrame = 0;
  /** Fewer canvas pixels while frames run long (sprite-puppet-quality.ts). */
  private readonly quality = puppetQuality();
  /** The danger pulse's beat this frame (readBeat). */
  private beat = 0;
  /** When the actors' screen positions were last read (seconds). */
  private placedAt = -Infinity;
  private paused = false;
  private onScreen = true;
  private destroyed = false;
  private watching = false;
  private rootEl: HTMLElement | null = null;
  private sceneEl: HTMLElement | null = null;
  private reducedQuery: MediaQueryList | null = null;
  private readonly cleanups: Array<() => void> = [];
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: SpritePuppetOptions) {}

  /* ---- API used by the sprite layer --------------------------------- */

  setSettings(settings: VisualNovelSpritePuppet): void {
    this.settings = spritePuppetSettings(settings);
    this.refresh();
  }

  getSettings(): VisualNovelSpritePuppet {
    return { ...this.settings };
  }

  /** Motion strength in effect now (0 when Motion is off or reduced motion is asked for). */
  strength(): number {
    if (this.reducedQuery?.matches ?? reducedMotionQuery()?.matches) return 0;
    const level = this.rootEl?.dataset.vnEffectIntensity;
    if (level === "off") return 0;
    return (this.settings.spriteMotion / 100) * (level === "gentle" ? PUPPET_GENTLE : 1);
  }

  attach(ref: PuppetActorRef): void {
    if (this.destroyed || this.actors.has(ref.key)) return;
    this.watch();
    const actor: ActorState = {
      ref,
      phase: puppetPhase(ref.key),
      mode: "css",
      tainted: false,
      talking: false,
      reaction: null,
      breathing: this.settings.spriteBreathing ? 1 : 0,
      sway: this.settings.spriteSway ? 1 : 0,
      head: this.settings.spriteHeadMotion ? 1 : 0,
      talk: 0,
      dim: 0,
      marksMoved: false,
      moodTarget: { ...PUPPET_NEUTRAL_MOOD },
      mood: { ...PUPPET_NEUTRAL_MOOD },
      acting: this.settings.spriteActing ? 1 : 0,
      physics: this.settings.spritePhysics ? 1 : 0,
      clocks: { breath: 0, sway: 0 },
      voice: puppetVoice(),
      syllable: 0,
      syllableV: 0,
      gestures: [],
      gaze: 0,
      gazeV: 0,
      side: puppetPhase(`${ref.key}/side`) < 0.5 ? -1 : 1,
      screenX: 0,
      heardAt: -Infinity,
      glanceAt: 0,
      glanceUntil: 0,
      glanceDir: 0,
      body: puppetSpring(),
      hair: puppetSpring(),
      bodyTrack: puppetTracker(),
      headTrack: puppetTracker(),
      pose: null,
      shift: null,
      take: null,
      gone: null,
      arrival: { state: "", since: 0 },
      air: { ...PUPPET_CALM_AIR },
      snow: 0,
      puffs: [],
      breathCycle: -1,
      puffAt: -Infinity,
      blur: 0,
    };
    ref.el.dataset.vnPuppet = "css";
    this.actors.set(ref.key, actor);
    for (const el of ref.layers) {
      this.layerStates.set(el, {
        el, actor, image: null, rig: null, canvas: null, ctx: null, showing: null, sourceKey: null, waiting: null,
        look: null, lookAt: 0, lookSteady: 0,
      });
    }
  }

  /** Forget an actor (its element, when given, must be the one attached under the key). */
  detach(key: string, el?: HTMLElement): void {
    const actor = this.actors.get(key);
    if (!actor || (el && actor.ref.el !== el)) return;
    this.endShift(actor);
    this.actors.delete(key);
    for (const el of actor.ref.layers) {
      const state = this.layerStates.get(el);
      if (state?.canvas) {
        state.canvas.width = 0;
        state.canvas.height = 0;
      }
      this.layerStates.delete(el);
    }
    this.evict();
  }

  /** A layer now shows `image` (or the same image with a new face box). */
  fill(layer: HTMLElement, image: PuppetImage): void {
    const state = this.layerStates.get(layer);
    if (!state || this.destroyed) return;
    const sameUrl = state.image?.url === image.url;
    state.image = image;
    state.rig = puppetRig(image.geometry, image.spot);
    if (!sameUrl && state.showing) {
      // The canvas still holds the previous image until the new one is ready.
      state.sourceKey = null;
      this.show(state, null);
    }
    this.prepare(state);
    if (state.actor.mode === "gl") this.drawNow(state);
  }

  empty(layer: HTMLElement): void {
    const state = this.layerStates.get(layer);
    if (!state) return;
    state.image = null;
    state.rig = null;
    state.sourceKey = null;
    this.show(state, null);
  }

  /** Talking state of an actor; `reaction` plays once when a line starts. */
  setTalking(key: string, talking: boolean, reaction: PuppetReaction | null = null): void {
    const actor = this.actors.get(key);
    if (!actor) return;
    if (talking && !actor.talking) {
      actor.voice = puppetVoice();
      // Kept in any mode: an actor staged mid-line (a plan that lands after its
      // text) is still "css" here, until the refresh that follows applyStage.
      if (reaction) actor.reaction = { kind: reaction, start: now() / 1000 };
    }
    actor.talking = talking;
  }

  /** The staged expression (any catalogue id) and intensity (1..5): the mood the body carries. */
  setMood(key: string, expression: string | null | undefined, intensity: number): void {
    const actor = this.actors.get(key);
    if (actor) actor.moodTarget = puppetMoodFor(expression, intensity);
  }

  /** An emote just appeared: the body answers it (a jolt for "!", a slump for gloom...). */
  emote(key: string, emote: SpriteEmote): void {
    const actor = this.actors.get(key);
    const kind = PUPPET_EMOTE_GESTURE[emote];
    if (actor && kind) this.gesture(actor, kind, 1);
  }

  /** A staged motion just started: the head and posture act it out on top of the CSS move. */
  motion(key: string, motion: SpriteMotion): void {
    const actor = this.actors.get(key);
    const kind = PUPPET_MOTION_GESTURE[motion];
    if (actor && kind) this.gesture(actor, kind, kind === "nod" ? 1.6 : 1);
  }

  /**
   * Text the typewriter just revealed for the current line: the talking
   * actors follow it, and the others react at the ends of sentences. In the
   * cold, a pause or a sentence end lets a breath cloud out.
   */
  typed(text: string): void {
    if (!text || this.destroyed) return;
    const time = now() / 1000;
    for (const actor of this.actors.values()) {
      if (!actor.talking || actor.mode !== "gl") continue;
      const event = puppetVoiceType(actor.voice, text, time);
      if (event === "stop" || event === "exclaim" || event === "question") this.listen(actor, event, time);
      if (event && event !== "syllable" && actor.air.breath > 0.3) this.puff(actor, time, event === "pause" ? 0.75 : 0.9);
    }
  }

  /**
   * An expression change on `key`: the new image (on `incoming`) spreads
   * over the old one (`outgoing`) in the shader, in the style the transition
   * setting and the new emotion pick. Returns how long the old layer must
   * stay (ms), or 0 when the CSS crossfade plays instead (CSS mode,
   * "classic", still). Call it before the incoming layer is filled.
   */
  shift(key: string, incoming: HTMLElement, outgoing: HTMLElement, expression: string | null | undefined, intensity: number): number {
    const actor = this.actors.get(key);
    if (!actor || actor.mode !== "gl" || this.destroyed) return 0;
    const strength = this.strength();
    const kind = strength > 0 ? puppetShiftFor(expression, this.settings.spriteTransitions) : null;
    if (!kind) return 0;
    this.endShift(actor);
    const gentle = this.rootEl?.dataset.vnEffectIntensity === "gentle" ? 0.6 : 1;
    actor.shift = { kind, gain: puppetShiftGain(intensity) * gentle, incoming, outgoing, asked: now() / 1000, start: null };
    actor.gone = null;
    // The new layer shows at once (sprite-css.ts), so nothing older may sit on its canvas until the first draw.
    this.clearCanvas(incoming);
    incoming.dataset.vnSpriteShift = kind;
    outgoing.dataset.vnSpriteShift = kind;
    this.schedule();
    return Math.round(PUPPET_SHIFT[kind].duration * 1000) + SHIFT_SLACK_MS;
  }

  /** The transition and atmosphere state of an actor (tests and debugging), or null in CSS mode. */
  effectsFor(key: string): PuppetEffects | null {
    const actor = this.actors.get(key);
    if (!actor || actor.mode !== "gl") return null;
    const time = now() / 1000;
    const shift = actor.shift;
    return {
      shift: shift?.kind ?? null,
      reveal: shift ? (shift.start === null ? 0 : puppetShiftReveal(shift.kind, time - shift.start)) : 1,
      blur: Math.round(actor.blur * 100) / 100,
      puffs: actor.puffs.filter((puff) => puppetPuffAt(puff, time) !== null).length,
      air: { ...actor.air, snow: actor.snow },
    };
  }

  /** The last pose drawn for an actor (tests and debugging), or null in CSS mode. */
  poseFor(key: string): PuppetPose | null {
    const actor = this.actors.get(key);
    return actor?.mode === "gl" && actor.pose ? { ...actor.pose } : null;
  }

  /** 0..1: how much the speaker's head follows typed text now. */
  voiceActive(key: string): number {
    const actor = this.actors.get(key);
    return actor?.talking ? puppetVoiceSample(actor.voice, now() / 1000).active : 0;
  }

  /** Pause while a key illustration covers the sprites. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.schedule();
  }

  modeFor(key: string): PuppetMode | null {
    return this.actors.get(key)?.mode ?? null;
  }

  /** Whether the rAF loop is scheduled now. */
  isRunning(): boolean {
    return this.raf !== 0;
  }

  /** The render scale in effect: a factor on the canvases' full backing size. */
  renderScale(): number {
    return puppetGlOptions.renderScale ?? puppetRenderScale(this.quality);
  }

  /** Re-decide every actor's mode (settings, Motion, reduced motion, WebGL) and get its layers ready. */
  refresh(): void {
    if (this.destroyed) return;
    const strength = this.strength();
    const gl = strength > 0 && this.actors.size > 0 ? this.gl() : null;
    for (const actor of this.actors.values()) {
      const mode: PuppetMode = gl && !actor.tainted ? "gl" : "css";
      if (actor.mode !== mode) {
        actor.mode = mode;
        actor.ref.el.dataset.vnPuppet = mode;
        if (mode === "css") {
          this.resetMarks(actor);
          this.endShift(actor);
          actor.puffs = [];
        }
      }
      for (const el of actor.ref.layers) {
        const state = this.layerStates.get(el);
        if (state) this.prepare(state);
      }
    }
    this.evict();
    this.schedule();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    const gl = this.glState?.gl;
    if (gl) {
      for (const entry of this.textures.values()) gl.deleteTexture(entry.tex);
      (gl.getExtension("WEBGL_lose_context") as { loseContext(): void } | null)?.loseContext();
    }
    this.textures.clear();
    this.bakes.clear();
    this.actors.clear();
    this.layerStates.clear();
    this.glState = null;
  }

  /* ---- environment ---------------------------------------------------- */

  private watch(): void {
    if (this.watching) return;
    this.watching = true;
    const container = this.options.container();
    this.rootEl = typeof container.closest === "function" ? container.closest<HTMLElement>("[data-vn-root]") : null;
    this.sceneEl = typeof container.closest === "function" ? container.closest<HTMLElement>("[data-vn-scene]") : null;
    this.reducedQuery = reducedMotionQuery();
    const refresh = () => this.refresh();
    if (this.reducedQuery && typeof this.reducedQuery.addEventListener === "function") {
      this.reducedQuery.addEventListener("change", refresh);
      this.cleanups.push(() => this.reducedQuery?.removeEventListener("change", refresh));
    }
    if (this.rootEl && typeof MutationObserver === "function") {
      const observer = new MutationObserver(refresh);
      observer.observe(this.rootEl, { attributes: true, attributeFilter: ["data-vn-effect-intensity"] });
      this.cleanups.push(() => observer.disconnect());
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      const visibility = () => this.schedule();
      document.addEventListener("visibilitychange", visibility);
      this.cleanups.push(() => document.removeEventListener("visibilitychange", visibility));
    }
    if (typeof IntersectionObserver === "function") {
      const observer = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        this.onScreen = entry.isIntersecting;
        this.schedule();
      });
      observer.observe(container);
      this.cleanups.push(() => observer.disconnect());
    }
    if (typeof ResizeObserver === "function") {
      // A new stage size changes the outline radius in image pixels: re-bake when it moved enough.
      const observer = new ResizeObserver(() => {
        if (this.settings.spriteOutline <= 0) return;
        if (this.resizeTimer) clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => {
          this.resizeTimer = null;
          for (const state of this.layerStates.values()) this.prepare(state);
          this.evict();
        }, 200);
      });
      observer.observe(container);
      this.cleanups.push(() => observer.disconnect());
    }
  }

  private gl(): GlState | null {
    if (this.glState !== undefined) return this.glState;
    const doc = typeof document !== "undefined" ? document : null;
    this.glState = doc ? createGl(doc) : null;
    const canvas = this.glState?.canvas;
    if (canvas && typeof canvas.addEventListener === "function") {
      canvas.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        this.textures.clear();
        this.glState = null;
        this.refresh();
      });
    }
    return this.glState;
  }

  /* ---- layers --------------------------------------------------------- */

  private imgOf(state: LayerState): HTMLImageElement | null {
    return typeof state.el.querySelector === "function" ? state.el.querySelector("img") : null;
  }

  /** Outline radius in image pixels for the size the layer is shown at (0 = none). */
  private outlineRadius(state: LayerState, img: HTMLImageElement): number {
    const px = this.settings.spriteOutline;
    if (px <= 0) return 0;
    const shown = state.el.offsetHeight || 0;
    const ratio = shown > 0 ? img.naturalHeight / shown : 1.4;
    return Math.max(0.5, Math.round(px * ratio * 2) / 2);
  }

  /** Get a layer's canvas ready for its mode: a texture (gl), a baked outline (css), or nothing (the img). */
  private prepare(state: LayerState): void {
    const image = state.image;
    const img = this.imgOf(state);
    if (!image || !img) {
      this.show(state, null);
      return;
    }
    if (!img.complete || !(img.naturalWidth > 0)) {
      this.waitFor(state, img, image.url);
      return;
    }
    const radius = this.outlineRadius(state, img);
    const key = `${image.url}|${radius}|${radius > 0 ? this.settings.spriteOutlineColor : ""}`;
    if (state.actor.mode === "gl") {
      if (state.sourceKey === key && this.textures.has(key)) return;
      if (!this.texture(key, img, radius)) {
        // A cross-origin image without CORS cannot be a texture: this actor stays on the CSS path.
        state.actor.tainted = true;
        queueMicrotask(() => this.refresh());
        return;
      }
      state.sourceKey = key;
      if (state.showing === "outline") this.show(state, null);
      this.drawNow(state);
      return;
    }
    if (radius <= 0) {
      state.sourceKey = null;
      this.show(state, null);
      return;
    }
    if (state.sourceKey === key && state.showing === "outline") return;
    const baked = this.bake(key, img, radius);
    const canvas = this.canvasOf(state);
    if (!baked || !canvas || !state.ctx) {
      this.show(state, null);
      return;
    }
    canvas.width = baked.width;
    canvas.height = baked.height;
    state.ctx.clearRect(0, 0, baked.width, baked.height);
    state.ctx.drawImage(baked, 0, 0);
    state.sourceKey = key;
    this.show(state, "outline");
  }

  private waitFor(state: LayerState, img: HTMLImageElement, url: string): void {
    if (state.waiting === url || typeof img.addEventListener !== "function") return;
    state.waiting = url;
    const done = () => {
      img.removeEventListener("load", done);
      img.removeEventListener("error", done);
      if (state.waiting === url) state.waiting = null;
      if (!this.destroyed && state.image?.url === url) {
        this.prepare(state);
        this.schedule();
      }
    };
    img.addEventListener("load", done);
    img.addEventListener("error", done);
  }

  private canvasOf(state: LayerState): HTMLCanvasElement | null {
    if (state.canvas) return state.canvas;
    try {
      const canvas = document.createElement("canvas");
      if (typeof canvas.getContext !== "function") return null;
      canvas.setAttribute("aria-hidden", "true");
      canvas.hidden = true;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      state.el.append(canvas);
      state.canvas = canvas;
      state.ctx = ctx;
      return canvas;
    } catch {
      return null;
    }
  }

  private show(state: LayerState, what: LayerState["showing"]): void {
    if (state.showing === what) return;
    state.showing = what;
    if (what) state.el.dataset.vnSpriteCanvas = what;
    else delete state.el.dataset.vnSpriteCanvas;
    if (state.canvas) state.canvas.hidden = what === null;
  }

  private bake(key: string, img: HTMLImageElement, radius: number): HTMLCanvasElement | null {
    const cached = this.bakes.get(key);
    if (cached) {
      this.bakes.delete(key);
      this.bakes.set(key, cached);
      return cached;
    }
    const baked = bakeSpriteOutline(img, img.naturalWidth, img.naturalHeight, radius, document, this.settings.spriteOutlineColor);
    if (!baked) return null;
    this.bakes.set(key, baked);
    while (this.bakes.size > BAKE_CACHE) {
      const oldest = this.bakes.keys().next().value as string;
      this.bakes.delete(oldest);
    }
    return baked;
  }

  private texture(key: string, img: HTMLImageElement, radius: number): TextureEntry | null {
    const found = this.textures.get(key);
    if (found) {
      found.used = now();
      return found;
    }
    const state = this.glState;
    if (!state) return null;
    const source: TexImageSource | null = radius > 0 ? this.bake(key, img, radius) : img;
    if (!source) return null;
    const gl = state.gl;
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      gl.deleteTexture(tex);
      return null;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (state.webgl2) {
      // Sprites draw smaller than their pixels: mipmaps keep line art from sparkling.
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    const width = radius > 0 ? (source as HTMLCanvasElement).width : img.naturalWidth;
    const height = radius > 0 ? (source as HTMLCanvasElement).height : img.naturalHeight;
    const entry = { tex, width, height, used: now() };
    this.textures.set(key, entry);
    return entry;
  }

  /** Drop textures no layer uses beyond the cache size, oldest first. */
  private evict(): void {
    if (this.textures.size <= TEXTURE_CACHE) return;
    const inUse = new Set([...this.layerStates.values()].map((state) => state.sourceKey));
    const idle = [...this.textures.entries()].filter(([key]) => !inUse.has(key)).sort((a, b) => a[1].used - b[1].used);
    for (const [key, entry] of idle) {
      if (this.textures.size <= TEXTURE_CACHE) break;
      this.glState?.gl.deleteTexture(entry.tex);
      this.textures.delete(key);
    }
  }

  /* ---- acting --------------------------------------------------------- */

  private gesture(actor: ActorState, kind: PuppetGestureKind, gain: number, delay = 0): void {
    if (actor.mode !== "gl") return;
    const side = Math.abs(actor.gaze) > 0.1 ? Math.sign(actor.gaze) : actor.side;
    actor.gestures.push({ kind, start: now() / 1000 + delay, gain, side });
    if (actor.gestures.length > 6) actor.gestures.shift();
  }

  /** Listeners answer a sentence end: a nod at ".", a small start at "!", a tilt at "?". */
  private listen(speaker: ActorState, event: "stop" | "exclaim" | "question", time: number): void {
    for (const other of this.actors.values()) {
      if (other === speaker || other.talking || other.mode !== "gl" || !this.onStage(other)) continue;
      const delay = 0.15 + 0.3 * other.phase;
      if (event === "stop" && time - other.heardAt > 2.2) this.gesture(other, "listen", 1, delay);
      else if (event === "exclaim" && time - other.heardAt > 4) this.gesture(other, "startle", 0.6, delay * 0.5);
      else if (event === "question" && time - other.heardAt > 4) this.gesture(other, "wonder", 0.5, delay);
      else continue;
      other.heardAt = time;
    }
  }

  private onStage(actor: ActorState): boolean {
    const state = actor.ref.el.dataset.vnSpriteState;
    return actor.ref.el.isConnected && (state === "shown" || state === "entering");
  }

  /**
   * Where everyone looks, once per frame: listeners turn to the speaker, the
   * speaker half-turns to the nearest listener; with nobody speaking, each
   * character now and then glances at the nearest other one (or aside).
   */
  private attend(time: number, dt: number): void {
    if (time - this.placedAt > 0.25 || time < this.placedAt) {
      this.placedAt = time;
      for (const actor of this.actors.values()) actor.screenX = actor.ref.el.getBoundingClientRect().left;
    }
    const present = [...this.actors.values()].filter((actor) => actor.mode === "gl" && this.onStage(actor));
    const speaker = present.find((actor) => actor.talking) ?? null;
    for (const actor of present) {
      const others = present.filter((other) => other !== actor);
      let nearest: ActorState | null = null;
      for (const other of others) {
        if (!nearest || Math.abs(other.screenX - actor.screenX) < Math.abs(nearest.screenX - actor.screenX)) nearest = other;
      }
      let target = 0;
      if (speaker && speaker !== actor) {
        target = Math.sign(speaker.screenX - actor.screenX);
      } else if (speaker === actor) {
        target = nearest ? 0.35 * Math.sign(nearest.screenX - actor.screenX) : 0;
      } else {
        if (!actor.glanceAt) actor.glanceAt = time + 4 + 6 * actor.phase;
        if (time >= actor.glanceAt) {
          const roll = puppetNoise(time * 0.37 + actor.phase * 91);
          actor.glanceUntil = time + 1.2 + 0.9 * roll;
          actor.glanceDir = nearest ? Math.sign(nearest.screenX - actor.screenX) : (roll < 0.5 ? -0.5 : 0.5);
          actor.glanceAt = time + 7 + 7 * puppetNoise(time * 0.11 + actor.phase * 17);
        }
        if (time < actor.glanceUntil) target = actor.glanceDir;
      }
      // Screen to image space: a mirrored figure looks the other way in its own image.
      if (actor.ref.el.dataset.vnSpriteMirrored === "true") target = -target;
      // A critically damped spring: the head turns and settles without overshoot (a wobbling
      // turn reads as liquid on a flat image).
      const omega = Math.PI * 2 * 1.2;
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) {
        actor.gazeV += (omega * omega * (target - actor.gaze) - 2 * omega * actor.gazeV) * h;
        actor.gaze += actor.gazeV * h;
      }
    }
  }

  /** Follow-through: track the figure's anchor and its head, and run the springs. */
  private simulate(actor: ActorState, state: LayerState, time: number, dt: number): void {
    const rig = state.rig;
    const height = state.el.offsetHeight;
    if (!rig || !(height > 0)) return;
    const flip = actor.ref.el.dataset.vnSpriteMirrored === "true" ? -1 : 1;
    const anchor = actor.ref.body.getBoundingClientRect();
    const [bvx, bvy] = trackPoint(actor.bodyTrack, (anchor.left / height) * flip, -anchor.top / height, dt);
    springKick(actor.body, bvx, bvy);
    springKick(actor.hair, bvx * 0.8, bvy * 0.8);
    // The head's own motion (nods, turns, bounces) swings the hair.
    const [fx, fy] = puppetFaceOffset(rig, this.poseOf(actor, rig, time, false));
    const [hvx, hvy] = trackPoint(actor.headTrack, fx, fy, dt, 0.1);
    springKick(actor.hair, hvx, hvy);
    springStep(actor.body, dt, PUPPET_BODY_SPRING);
    springStep(actor.hair, dt, PUPPET_HAIR_SPRING);
  }

  /* ---- drawing -------------------------------------------------------- */

  private schedule(): void {
    if (this.raf || this.destroyed || typeof requestAnimationFrame !== "function" || !this.shouldRun()) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private shouldRun(): boolean {
    if (this.paused || !this.onScreen || !this.glState) return false;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
    for (const actor of this.actors.values()) if (actor.mode === "gl") return true;
    return false;
  }

  private readonly tick = (time: number): void => {
    this.raf = 0;
    if (this.destroyed || !this.shouldRun()) return;
    const dt = this.lastFrame ? Math.min(0.1, Math.max(0, (time - this.lastFrame) / 1000)) : 1 / 60;
    this.lastFrame = time;
    puppetQualityFrame(this.quality, time);
    this.beat = this.readBeat();
    this.attend(time / 1000, dt);
    for (const actor of this.actors.values()) {
      if (actor.mode === "gl") this.drawActor(actor, time / 1000, dt);
    }
    this.schedule();
  };

  /** Draw a layer right away (a new image), so the canvas never shows a stale frame. */
  private drawNow(state: LayerState): void {
    if (!this.glState || !state.rig || state.actor.mode !== "gl") return;
    this.drawLayer(state, this.poseOf(state.actor, state.rig, now() / 1000), now());
    this.schedule();
  }

  private poseOf(actor: ActorState, rig: PuppetRig, time: number, withPhysics = true): PuppetPose {
    const reaction = actor.reaction && time - actor.reaction.start <= PUPPET_REACTION_MS[actor.reaction.kind] / 1000
      ? { kind: actor.reaction.kind, age: time - actor.reaction.start }
      : null;
    const pw = withPhysics ? actor.physics : 0;
    const flip = actor.ref.el.dataset.vnSpriteMirrored === "true" ? -1 : 1;
    return puppetPose({
      time,
      phase: actor.phase,
      figH: rig.figH,
      faceW: rig.faceW,
      breathing: actor.breathing,
      sway: actor.sway,
      head: actor.head,
      talk: actor.talk,
      reaction,
      strength: this.strength(),
      clocks: actor.clocks,
      acting: actor.acting,
      mood: actor.mood,
      voice: actor.talk > 0 ? { ...puppetVoiceSample(actor.voice, time), syllable: actor.syllable } : null,
      gaze: actor.gaze,
      side: actor.side,
      gestures: actor.gestures.map((g) => ({ kind: g.kind, age: time - g.start, gain: g.gain * actor.acting, side: g.side })),
      shift: actor.take ? { kind: actor.take.kind, age: time - actor.take.start, gain: actor.take.gain } : null,
      physics: pw > 0.001
        ? {
          bodyX: actor.body.x * pw,
          bodyY: actor.body.y * pw,
          hairX: actor.hair.x * pw,
          hairY: actor.hair.y * pw,
          // The weather blows toward the stage's right; in a mirrored figure's own image that is its left.
          windX: puppetWindPush(puppetWind(this.sceneEl?.dataset.vnSceneAmbient), time, actor.phase) * flip * pw,
        }
        : null,
    });
  }

  private drawActor(actor: ActorState, time: number, dt: number): void {
    const s = this.settings;
    const ease = (value: number, target: number, tau: number) => value + (target - value) * (1 - Math.exp(-dt / tau));
    actor.breathing = ease(actor.breathing, s.spriteBreathing ? 1 : 0, 0.4);
    actor.sway = ease(actor.sway, s.spriteSway ? 1 : 0, 0.4);
    actor.head = ease(actor.head, s.spriteHeadMotion ? 1 : 0, 0.4);
    actor.talk = ease(actor.talk, actor.talking ? 1 : 0, actor.talking ? 0.15 : 0.3);
    actor.dim = ease(actor.dim, s.spriteFocusBlur && actor.ref.el.dataset.vnSpriteDim === "true" ? 1 : 0, 0.11);
    // Settings fade in and out, then settle exactly (so "off" really is off).
    const settle = (value: number, target: number) => (Math.abs(target - value) < 0.02 ? target : value);
    actor.acting = settle(ease(actor.acting, s.spriteActing ? 1 : 0, 0.4), s.spriteActing ? 1 : 0);
    actor.physics = settle(ease(actor.physics, s.spritePhysics ? 1 : 0, 0.3), s.spritePhysics ? 1 : 0);
    easeMood(actor.mood, actor.moodTarget, 1 - Math.exp(-dt / 0.6));
    // The clocks tick at the mood's rates, so a faster breath never jumps in phase.
    actor.clocks.breath += dt * (1 + (actor.mood.breathRate - 1) * actor.acting);
    actor.clocks.sway += dt * (1 + (actor.mood.swayRate - 1) * actor.acting);
    if (actor.reaction && time - actor.reaction.start > PUPPET_REACTION_MS[actor.reaction.kind] / 1000) actor.reaction = null;
    if (actor.gestures.length) actor.gestures = actor.gestures.filter((g) => time - g.start < PUPPET_GESTURE_S[g.kind]);
    followSyllable(actor, actor.talk > 0 ? puppetVoiceSample(actor.voice, time).syllable : 0, dt);
    this.frameEffects(actor, time, dt);
    const active = this.activeLayer(actor);
    if (active && actor.physics > 0.001) this.simulate(actor, active, time, dt);
    let marked = false;
    for (const el of actor.ref.layers) {
      const state = this.layerStates.get(el);
      const role = el.dataset.vnSpriteLayer;
      if (!state?.rig || (role !== "active" && role !== "leaving") || el === actor.gone) continue;
      const pose = this.poseOf(actor, state.rig, time);
      if (!this.drawLayer(state, pose, time * 1000)) continue;
      if (role === "active") {
        actor.pose = pose;
        marked = this.placeMarks(actor, state, pose);
      }
    }
    if (!marked) this.resetMarks(actor);
  }

  private activeLayer(actor: ActorState): LayerState | undefined {
    return actor.ref.layers.map((el) => this.layerStates.get(el)).find((state) => state?.el.dataset.vnSpriteLayer === "active" && state.rig);
  }

  /* ---- transitions and atmosphere ------------------------------------ */

  /** Finish a shift now: both layers go back to the CSS rules, and the old image is cleared. */
  private endShift(actor: ActorState): void {
    const shift = actor.shift;
    if (!shift) return;
    actor.shift = null;
    delete shift.incoming.dataset.vnSpriteShift;
    delete shift.outgoing.dataset.vnSpriteShift;
    // The sprite layer may already have retired the old layer (a slow frame let its timer run first).
    if (shift.outgoing.dataset.vnSpriteLayer !== "active") {
      actor.gone = shift.outgoing;
      this.clearCanvas(shift.outgoing);
    }
  }

  private clearCanvas(el: HTMLElement): void {
    const state = this.layerStates.get(el);
    if (state?.canvas && state.ctx) state.ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
  }

  /** Whether the stage is cold (the sprite layer reads the plate; snow counts on its own). */
  private coldScene(): boolean {
    return this.options.container().dataset.vnSpriteCold === "true";
  }

  /**
   * Once per frame for an actor: the shift's end, the focus pull, the
   * atmosphere easing toward the scene's (weather changes fade in and out),
   * settling snow, and breath clouds on each exhale and while it speaks.
   */
  private frameEffects(actor: ActorState, time: number, dt: number): void {
    const s = this.settings;
    const shift = actor.shift;
    if (shift) {
      const late = shift.start === null && time - shift.asked > SHIFT_START_LIMIT;
      if (late || (shift.start !== null && time - shift.start >= PUPPET_SHIFT[shift.kind].duration)) this.endShift(actor);
    }
    if (actor.take && time - actor.take.start > PUPPET_SHIFT[actor.take.kind].duration + 0.5) actor.take = null;
    if (actor.gone && actor.gone.dataset.vnSpriteLayer !== "leaving") actor.gone = null;

    const state = actor.ref.el.dataset.vnSpriteState ?? "";
    if (state !== actor.arrival.state) actor.arrival = { state, since: time };
    let blur = actor.dim * PUPPET_FOCUS_BLUR_PX;
    if (s.spriteTransitions !== "classic" && (state === "entering" || state === "exiting")) {
      blur = Math.max(blur, puppetArrivalBlur(state, (time - actor.arrival.since) / PUPPET_ARRIVAL_S[state]));
    }
    actor.blur = blur;

    const level = s.spriteAtmosphere ? (this.rootEl?.dataset.vnEffectIntensity === "gentle" ? 0.6 : 1) : 0;
    const target = puppetAtmosphere(this.sceneEl?.dataset.vnSceneAmbient, this.coldScene());
    // The weather changes over a second or so; switching the setting off fades like the other settings.
    const k = 1 - Math.exp(-dt / (s.spriteAtmosphere ? 1.2 : 0.4));
    for (const key of Object.keys(actor.air) as Array<keyof PuppetAtmosphere>) {
      const goal = target[key] * level;
      const next = actor.air[key] + (goal - actor.air[key]) * k;
      actor.air[key] = Math.abs(next - goal) < 0.003 ? goal : next;
    }
    actor.snow = puppetSnowFrame(actor.snow, actor.air.snow, dt, s.spriteAtmosphere, k);

    const cycle = puppetBreathCycle(actor.clocks.breath, actor.phase);
    if (actor.air.breath > 0.3) {
      if (actor.breathCycle >= 0 && puppetExhaleStarted(actor.breathCycle, cycle)) this.puff(actor, time, 1);
      // Words carry breath too: a little vapour every so often while the line types.
      else if (actor.talking && time - actor.puffAt > 0.8 && puppetVoiceSample(actor.voice, time).active > 0.5) this.puff(actor, time, 0.55);
    }
    actor.breathCycle = cycle;
    if (actor.puffs.length) actor.puffs = actor.puffs.filter((puff) => puppetPuffAt(puff, time) !== null);
  }

  /** A breath cloud at the mouth, heading the way the figure faces. */
  private puff(actor: ActorState, time: number, size: number): void {
    const state = this.activeLayer(actor);
    const rig = state?.rig;
    if (!rig || !this.onStage(actor)) return;
    const facing = actor.ref.el.dataset.vnSpriteFacing;
    // In its own image a figure turned to a side faces left (SPRITE_NATURAL_FACING); mirroring turns it.
    const dir = facing === "left" || facing === "right" ? -1 : 0;
    const [mx, my] = puppetMouth(rig.faceX, rig.faceY, rig.faceW, rig.faceH, dir);
    const [dx, dy] = puppetDisplace(rig, actor.pose ?? this.poseOf(actor, rig, time), mx, my);
    actor.puffs.push(puppetPuff(mx + dx, my + dy, dir, rig.faceW, time, size, puppetNoise(time * 7.3 + actor.phase * 11)));
    if (actor.puffs.length > PUFF_LIMIT) actor.puffs.shift();
    actor.puffAt = time;
  }

  /** The danger pulse's beat now (0..1), read from the overlay's animated opacity. */
  private readBeat(): number {
    if (this.sceneEl?.dataset.vnSceneAmbient !== "danger_pulse") return 0;
    const overlay = this.rootEl?.querySelector("[data-vn-ambient]");
    return overlay ? puppetDangerBeat(Number.parseFloat(getComputedStyle(overlay, "::before").opacity)) : 0;
  }

  /** Breath clouds over the figure, lit like it (light preset and mood grade). */
  private drawPuffs(state: LayerState, rig: PuppetRig, look: Look, width: number, height: number, time: number): void {
    const ctx = state.ctx;
    const actor = state.actor;
    if (!ctx) return;
    const white = applyColor(look.air, applyColor(look.light, [0.96, 0.97, 1]));
    const rgb = white.map((v) => Math.round(v * 255)).join(", ");
    for (const puff of actor.puffs) {
      const at = puppetPuffAt(puff, time);
      if (!at) continue;
      const alpha = at.alpha * Math.min(1, actor.air.breath);
      const cx = (rig.cx + at.x / rig.aspect) * width;
      const cy = (rig.by - at.y) * height;
      const r = at.r * height;
      for (let i = 0; i < 3; i += 1) {
        const ox = (puppetNoise(puff.seed * 13 + i) - 0.5) * r * 0.9;
        const oy = (puppetNoise(puff.seed * 29 + i) - 0.5) * r * 0.6;
        const rr = r * (0.55 + 0.45 * puppetNoise(puff.seed * 41 + i));
        const gradient = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rr);
        gradient.addColorStop(0, `rgba(${rgb}, ${(alpha * 0.6).toFixed(3)})`);
        gradient.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx + ox, cy + oy, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** The emote box follows the face (the marks are not mirrored, so x flips for mirrored sprites). */
  private placeMarks(actor: ActorState, state: LayerState, pose: PuppetPose): boolean {
    const emote = actor.ref.marks.firstElementChild as HTMLElement | null;
    if (!emote || emote.hidden || !state.rig) return false;
    const [dx, dy] = puppetFaceOffset(state.rig, pose);
    const height = state.el.offsetHeight || 0;
    const flip = actor.ref.el.dataset.vnSpriteMirrored === "true" ? -1 : 1;
    actor.ref.marks.style.setProperty("translate", `${(dx * height * flip).toFixed(2)}px ${(-dy * height).toFixed(2)}px`);
    actor.marksMoved = true;
    return true;
  }

  private resetMarks(actor: ActorState): void {
    if (!actor.marksMoved) return;
    actor.marksMoved = false;
    actor.ref.marks.style.removeProperty("translate");
  }

  /**
   * The CSS look of a layer, read back from computed styles: the img's
   * filter (light preset, its transition, lightning), the tint and rim
   * pseudo-elements, and the mood grade. Re-read every frame while it
   * changes or lightning flashes, else every 150 ms.
   */
  private look(state: LayerState, time: number): Look {
    const lightning = this.sceneEl?.hasAttribute("data-vn-lightning") ?? false;
    if (state.look && !lightning && state.lookSteady >= 2 && time - state.lookAt < 150) return state.look;
    state.lookAt = time;
    const img = this.imgOf(state);
    const layer = getComputedStyle(state.el);
    const before = getComputedStyle(state.el, "::before");
    const after = getComputedStyle(state.el, "::after");
    const filter = img ? getComputedStyle(img).filter : "none";
    const air = layer.getPropertyValue("--vn-sprite-air-filter").trim();
    const rimX = before.getPropertyValue("--vn-sprite-rim-x");
    const rimY = before.getPropertyValue("--vn-sprite-rim-y");
    const flip = before.getPropertyValue("--vn-sprite-rim-flip");
    const key = [filter, air, after.backgroundColor, after.opacity, after.mixBlendMode, before.backgroundColor, before.opacity, rimX, rimY, flip].join("|");
    if (state.look?.key === key) {
      state.lookSteady += 1;
      return state.look;
    }
    state.lookSteady = 0;
    const tint = parseCssColor(after.backgroundColor) ?? [0, 0, 0, 0];
    const rim = parseCssColor(before.backgroundColor) ?? [0, 0, 0, 0];
    const number = (raw: string, fallback: number) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? value : fallback;
    };
    state.look = {
      key,
      light: cssFilterMatrix(filter),
      air: air ? cssFilterMatrix(air) : { m: [...IDENTITY_COLOR.m], o: [0, 0, 0] },
      tint: [tint[0], tint[1], tint[2], tint[3] * number(after.opacity, 0)],
      tintMode: puppetBlendIndex(after.mixBlendMode),
      rim: [rim[0], rim[1], rim[2], rim[3] * number(before.opacity, 0)],
      rimX: number(rimX, 0),
      rimY: number(rimY, 1),
      flip: number(flip, 1),
    };
    return state.look;
  }

  private drawLayer(state: LayerState, pose: PuppetPose, time: number): boolean {
    const g = this.glState;
    const rig = state.rig;
    const entry = state.sourceKey ? this.textures.get(state.sourceKey) : undefined;
    if (!g || !rig || !entry) return false;
    const cssW = state.el.offsetWidth;
    const cssH = state.el.offsetHeight;
    if (!(cssW > 0 && cssH > 0)) return false;
    const canvas = this.canvasOf(state);
    const ctx = state.ctx;
    if (!canvas || !ctx) return false;
    // Backing size: the CSS size at the device pixel ratio, never above the image's own pixels,
    // times the render scale (fewer pixels while frames run long).
    const dpr = Math.min(MAX_DPR, (typeof devicePixelRatio === "number" && devicePixelRatio > 0) ? devicePixelRatio : 1);
    const scale = Math.max(0.25, Math.min(dpr, entry.width / cssW, MAX_BACKING / Math.max(cssW, cssH)) * this.renderScale());
    const width = Math.max(1, Math.round(cssW * scale));
    const height = Math.max(1, Math.round(cssH * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (g.canvas.width < width || g.canvas.height < height) {
      g.canvas.width = Math.max(g.canvas.width, Math.ceil(width / 256) * 256);
      g.canvas.height = Math.max(g.canvas.height, Math.ceil(height / 256) * 256);
    }
    const gl = g.gl;
    const look = this.look(state, time);
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    puppetMeshPositions(rig, pose, g.grid, g.positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.positions);
    this.useVariant(this.needsEffects(state) ? "fx" : "plain");
    const u = g.uniforms;
    const actor = state.actor;
    const t = time / 1000;
    const blur = actor.blur;
    gl.uniform2f(u.blur, blur / cssW, blur / cssH);
    // A big blur (the focus pull) samples blurrier mip levels, so 9 taps stay smooth.
    gl.uniform1f(u.lod, blur > 2 ? Math.log2((blur * scale) / 2) : 0);
    this.revealUniforms(state, rig, t);
    this.airUniforms(state, rig, look, t, width, height);
    gl.uniformMatrix3fv(u.light, false, columnMajor(look.light.m));
    gl.uniform3f(u.lightOffset, ...look.light.o);
    gl.uniformMatrix3fv(u.air, false, columnMajor(look.air.m));
    gl.uniform3f(u.airOffset, ...look.air.o);
    gl.uniform4f(u.tint, ...look.tint);
    gl.uniform1f(u.tintMode, look.tintMode);
    gl.uniform4f(u.rim, ...look.rim);
    gl.uniform2f(u.rimOffset, (RIM_WIDTH * look.rimX * look.flip) / rig.aspect, RIM_WIDTH * look.rimY);
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.drawElements(gl.TRIANGLES, g.grid.indices.length, gl.UNSIGNED_SHORT, 0);
    entry.used = time;
    // The frame sits in the bottom-left corner of the shared drawing buffer.
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(g.canvas, 0, g.canvas.height - height, width, height, 0, 0, width, height);
    if (actor.puffs.length && state.el.dataset.vnSpriteLayer === "active") this.drawPuffs(state, rig, look, width, height, t);
    this.show(state, "puppet");
    return true;
  }

  /** Whether a change or the weather touches this layer now (else it draws with the plain shader). */
  private needsEffects(state: LayerState): boolean {
    const actor = state.actor;
    const shift = actor.shift;
    if (shift && (state.el === shift.incoming || state.el === shift.outgoing)) return true;
    const air = actor.air;
    return air.fog > 0.001 || air.wet > 0.001 || air.fire > 0.001 || air.grain > 0.001 || air.haze > 0.001
      || air.pulse * this.beat > 0.001 || air.fireflies > 0.01 || actor.snow > 0.001;
  }

  private useVariant(variant: "plain" | "fx"): void {
    const g = this.glState!;
    if (g.current === variant) return;
    g.current = variant;
    g.uniforms = g.programs[variant].uniforms;
    g.gl.useProgram(g.programs[variant].program);
  }

  /** The expression change's mask for this layer: the new image spreads, the old one goes behind the edge. */
  private revealUniforms(state: LayerState, rig: PuppetRig, time: number): void {
    const g = this.glState!;
    const u = g.uniforms;
    const actor = state.actor;
    const shift = actor.shift;
    const faceU = rig.cx + rig.faceX / rig.aspect;
    const faceV = rig.by - rig.faceY;
    const top = rig.by - rig.figH;
    g.gl.uniform4f(u.figure, rig.aspect, top, rig.figH, rig.by);
    if (!shift || (state.el !== shift.incoming && state.el !== shift.outgoing)) {
      g.gl.uniform4f(u.reveal, 1, 0, -1, 1);
      g.gl.uniform4f(u.revealGlow, 0, 0, 0, 0);
      return;
    }
    const incoming = state.el === shift.incoming;
    if (incoming && shift.start === null) {
      // The new image is ready: the change starts now.
      shift.start = time;
      actor.take = { kind: shift.kind, start: time, gain: shift.gain };
    }
    const spec = PUPPET_SHIFT[shift.kind];
    const progress = shift.start === null ? 0 : puppetShiftReveal(shift.kind, time - shift.start);
    const reach = Math.hypot(Math.max(faceU, 1 - faceU) * rig.aspect * 0.85, Math.max(faceV - top, rig.by - faceV));
    g.gl.uniform4f(u.reveal, progress, spec.edge, PUPPET_SWEEP[spec.sweep], incoming ? 1 : -1);
    g.gl.uniform4f(u.revealGlow, spec.glow[0], spec.glow[1], spec.glow[2], spec.glow[3] * Math.min(1.4, shift.gain));
    g.gl.uniform4f(u.revealShape, faceU, faceV, reach, spec.grain);
  }

  /** The scene's weather and light on this layer. */
  private airUniforms(state: LayerState, rig: PuppetRig, look: Look, time: number, width: number, height: number): void {
    const g = this.glState!;
    const u = g.uniforms;
    const actor = state.actor;
    const air = actor.air;
    // In full-scale pixels, so the render scale doesn't change the effects' size on screen.
    const scale = this.renderScale();
    g.gl.uniform2f(u.texel, scale / width, scale / height);
    g.gl.uniform4f(u.atmoA, air.fog, air.wet, air.fire > 0.001 ? air.fire * puppetFireFlicker(time, actor.phase) : 0, air.grain);
    g.gl.uniform4f(u.atmoB, air.haze, air.pulse * this.beat, actor.snow, time % 1000);
    if (air.fireflies > 0.01) {
      const [a, b] = puppetFireflies(time, actor.phase, rig.faceX, rig.faceY, rig.figH);
      const uv = (fly: { x: number; y: number }): [number, number] => [rig.cx + fly.x / rig.aspect, rig.by - fly.y];
      g.gl.uniform4f(u.flyPos, ...uv(a!), ...uv(b!));
      g.gl.uniform2f(u.flyGlow, a!.glow * air.fireflies, b!.glow * air.fireflies);
    } else {
      g.gl.uniform2f(u.flyGlow, 0, 0);
    }
    if (air.fog > 0.001) g.gl.uniform3f(u.fogColor, ...applyColor(look.light, [0.8, 0.84, 0.9]));
  }
}
