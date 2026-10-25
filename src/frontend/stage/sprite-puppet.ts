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
import type { SpriteFaceSpot, SpriteGeometry } from "./sprite-layer.js";
import { bakeSpriteOutline } from "./sprite-outline.js";
import {
  IDENTITY_COLOR,
  PUPPET_REACTION_MS,
  cssFilterMatrix,
  parseCssColor,
  puppetBlendIndex,
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
  marks: HTMLElement;
  layers: readonly [HTMLElement, HTMLElement];
};

/** "gl": the warped canvas; "css": the img and the CSS idle motion. */
export type PuppetMode = "gl" | "css";

/** Blur of characters who are not speaking (CSS px), with `spriteFocusBlur`. */
export const PUPPET_FOCUS_BLUR_PX = 1.2;
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
 */
export const puppetGlOptions = { allowSoftware: false };

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
};

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
  uniforms: Record<"tex" | "blur" | "light" | "lightOffset" | "air" | "airOffset" | "tint" | "tintMode" | "rim" | "rimOffset", WebGLUniformLocation | null>;
};

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
   Colours are premultiplied in the texture and in the output. */
const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uBlur;
uniform mat3 uLight;
uniform vec3 uLightOffset;
uniform mat3 uAir;
uniform vec3 uAirOffset;
uniform vec4 uTint;
uniform float uTintMode;
uniform vec4 uRim;
uniform vec2 uRimOffset;

vec4 figure(vec2 uv) {
  if (uBlur.x <= 0.0 && uBlur.y <= 0.0) return texture2D(uTex, uv);
  vec4 sum = texture2D(uTex, uv) * 4.0;
  sum += (texture2D(uTex, uv + vec2(uBlur.x, 0.0)) + texture2D(uTex, uv - vec2(uBlur.x, 0.0))
    + texture2D(uTex, uv + vec2(0.0, uBlur.y)) + texture2D(uTex, uv - vec2(0.0, uBlur.y))) * 2.0;
  sum += texture2D(uTex, uv + uBlur) + texture2D(uTex, uv - uBlur)
    + texture2D(uTex, uv + vec2(uBlur.x, -uBlur.y)) + texture2D(uTex, uv + vec2(-uBlur.x, uBlur.y));
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

void main() {
  vec4 t = figure(vUv);
  if (t.a < 0.002) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec3 c = clamp(t.rgb / t.a, 0.0, 1.0);
  c = clamp(uLight * c + uLightOffset, 0.0, 1.0);
  c = mix(c, blendMode(c, uTint.rgb, uTintMode), uTint.a);
  float shifted = texture2D(uTex, vUv - uRimOffset).a;
  c = mix(c, c + uRim.rgb - c * uRim.rgb, uRim.a * clamp(1.0 - shifted, 0.0, 1.0));
  c = clamp(uAir * c + uAirOffset, 0.0, 1.0);
  gl_FragColor = vec4(c * t.a, t.a);
}`;

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
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const grid = puppetGrid();
  const uvBuffer = gl.createBuffer();
  const posBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  if (!uvBuffer || !posBuffer || !indexBuffer) return null;
  const aUv = gl.getAttribLocation(program, "aUv");
  const aPos = gl.getAttribLocation(program, "aPos");
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

  const uniform = (name: string) => gl!.getUniformLocation(program, name);
  const uniforms = {
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
  };
  gl.uniform1i(uniforms.tex, 0);
  return { canvas, gl, webgl2, grid, positions, posBuffer, uniforms };
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
    if (talking && !actor.talking && reaction && actor.mode === "gl") actor.reaction = { kind: reaction, start: now() / 1000 };
    actor.talking = talking;
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
        if (mode === "css") this.resetMarks(actor);
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
    const key = `${image.url}|${radius}`;
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
    const baked = bakeSpriteOutline(img, img.naturalWidth, img.naturalHeight, radius);
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

  private poseOf(actor: ActorState, rig: PuppetRig, time: number): PuppetPose {
    const reaction = actor.reaction && time - actor.reaction.start <= PUPPET_REACTION_MS[actor.reaction.kind] / 1000
      ? { kind: actor.reaction.kind, age: time - actor.reaction.start }
      : null;
    return puppetPose({
      time,
      phase: actor.phase,
      figH: rig.figH,
      breathing: actor.breathing,
      sway: actor.sway,
      head: actor.head,
      talk: actor.talk,
      reaction,
      strength: this.strength(),
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
    if (actor.reaction && time - actor.reaction.start > PUPPET_REACTION_MS[actor.reaction.kind] / 1000) actor.reaction = null;
    let marked = false;
    for (const el of actor.ref.layers) {
      const state = this.layerStates.get(el);
      const role = el.dataset.vnSpriteLayer;
      if (!state?.rig || (role !== "active" && role !== "leaving")) continue;
      const pose = this.poseOf(actor, state.rig, time);
      if (!this.drawLayer(state, pose, time * 1000)) continue;
      if (role === "active") marked = this.placeMarks(actor, state, pose);
    }
    if (!marked) this.resetMarks(actor);
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
    // Backing size: the CSS size at the device pixel ratio, never above the image's own pixels.
    const dpr = Math.min(MAX_DPR, (typeof devicePixelRatio === "number" && devicePixelRatio > 0) ? devicePixelRatio : 1);
    const scale = Math.max(0.25, Math.min(dpr, entry.width / cssW, MAX_BACKING / Math.max(cssW, cssH)));
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
    const u = g.uniforms;
    const blur = state.actor.dim * PUPPET_FOCUS_BLUR_PX;
    gl.uniform2f(u.blur, blur / cssW, blur / cssH);
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
    this.show(state, "puppet");
    return true;
  }
}
