/**
 * 3D backgrounds (docs/SPRITE_MODE.md, "3D backgrounds"): the plate drawn
 * in WebGL over its flat scene image, moved by its depth map.
 *
 * The camera follows the mouse on desktop and drifts slowly on touch
 * screens; a plate dollies in a little when it appears. The shader is a
 * backward warp: every screen pixel finds the plate point that lands there
 * (a few fixed-point steps on the depth under it), so nothing tears or
 * leaves holes; the nearest pixels shift PLATE_PARALLAX_SHIFT of the plate
 * width at camera x = 1, the farthest not at all. The sprites move with the
 * floor they stand on (its depth, `plateFloorNear`), so they never slide.
 *
 * The flat `<img>` stays underneath: the canvas fades in only once the depth
 * map and the picture are on the GPU, and out on a plate change, a fit it
 * cannot draw, Motion off, reduced motion or any WebGL failure. At rest
 * (camera 0, zoom 1) the canvas shows exactly the flat picture.
 */
import type { PlateDepthMap } from "./plate-depth-kernel.js";

/** Lateral shift of the nearest pixels at camera x = 1, as a share of the plate width. */
export const PLATE_PARALLAX_SHIFT = 0.03;
/** Zoom a plate dollies in to when it appears ("gentle" Motion: half the way). */
export const PLATE_DOLLY_ZOOM = 1.05;
/** Time the dolly takes, ms. */
export const PLATE_DOLLY_MS = 9000;
/** Time constant of the camera following its target, s. */
const FOLLOW_S = 0.45;
/** Time constant of the camera returning to rest when the canvas goes, s. */
const RELEASE_S = 0.2;
/** Slow drift on touch screens: amplitude per axis and period, s. */
const DRIFT = { x: 0.45, y: 0.2, periodX: 17, periodY: 23 } as const;
/** Largest canvas side in device px (the plate itself is about 1216 px wide). */
const MAX_CANVAS_PX = 2560;

export type PlateParallaxMotion = "off" | "gentle" | "full";
/** Plate uv = offset + screen uv * scale (uv 0..1, y down); `contain`: outside the plate is empty. */
export type PlateFit = { offsetX: number; offsetY: number; scaleX: number; scaleY: number; contain: boolean };

/** How a fit maps the screen onto the plate; null for fits the canvas does not draw. */
export function plateFitTransform(fit: string, plateW: number, plateH: number, viewW: number, viewH: number): PlateFit | null {
  if (!(plateW > 0 && plateH > 0 && viewW > 0 && viewH > 0)) return null;
  let sx: number;
  let sy: number;
  if (fit === "fill") { sx = viewW / plateW; sy = viewH / plateH; }
  else if (fit === "cover" || fit === "contain") {
    const s = fit === "cover" ? Math.max(viewW / plateW, viewH / plateH) : Math.min(viewW / plateW, viewH / plateH);
    sx = s;
    sy = s;
  } else return null;
  const drawnW = plateW * sx;
  const drawnH = plateH * sy;
  return { offsetX: (drawnW - viewW) / (2 * drawnW), offsetY: (drawnH - viewH) / (2 * drawnH), scaleX: viewW / drawnW, scaleY: viewH / drawnH, contain: fit === "contain" };
}

/** Width the plate is drawn at on screen (CSS px), for the sprites' shift. */
export function plateDrawnWidth(fit: string, plateW: number, plateH: number, viewW: number, viewH: number): number {
  const t = plateFitTransform(fit, plateW, plateH, viewW, viewH);
  return t ? viewW / t.scaleX : 0;
}

/**
 * How near the floor the sprites stand on is (0 = far .. 1 = nearest): the
 * median over a band low in the middle of the plate (rows 86-96%, columns
 * 25-75%), where the figures' feet are.
 */
export function plateFloorNear(map: PlateDepthMap): number {
  const values: number[] = [];
  const y0 = Math.floor(map.height * 0.86);
  const y1 = Math.max(y0 + 1, Math.ceil(map.height * 0.96));
  const x0 = Math.floor(map.width * 0.25);
  const x1 = Math.max(x0 + 1, Math.ceil(map.width * 0.75));
  for (let y = y0; y < Math.min(map.height, y1); y += 1) {
    for (let x = x0; x < Math.min(map.width, x1); x += 1) values.push(1 - map.depth[y * map.width + x]! / 255);
  }
  if (!values.length) return 1;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)]!;
}

/** Dolly zoom `elapsedMs` after a plate appeared (ease-out to the motion level's zoom). */
export function plateDollyZoom(elapsedMs: number, motion: PlateParallaxMotion): number {
  if (motion === "off") return 1;
  const t = Math.min(1, Math.max(0, elapsedMs / PLATE_DOLLY_MS));
  const eased = 1 - (1 - t) ** 3;
  return 1 + (PLATE_DOLLY_ZOOM - 1) * (motion === "gentle" ? 0.5 : 1) * eased;
}

/**
 * Camera target from the mouse over the stage: -1..1 per axis. The eye moves
 * toward the pointer, so near things shift away from it.
 */
export function pointerCamera(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  if (!(rect.width > 0 && rect.height > 0)) return { x: 0, y: 0 };
  const clamp = (v: number): number => Math.min(1, Math.max(-1, v));
  return {
    x: clamp(1 - ((clientX - rect.left) / rect.width) * 2),
    y: clamp(1 - ((clientY - rect.top) / rect.height) * 2),
  };
}

const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
uniform sampler2D uPlate;
uniform sampler2D uDepth;
uniform vec4 uFit;
uniform vec2 uCam;
uniform vec2 uShift;
uniform float uZoom;
uniform float uContain;
varying vec2 vUv;
vec2 mirrorUv(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
void main() {
  vec2 p = uFit.xy + vUv * uFit.zw;
  if (uContain > 0.5 && (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0)) { gl_FragColor = vec4(0.0); return; }
  vec2 s = p;
  for (int i = 0; i < 4; i++) {
    float near = 1.0 - texture2D(uDepth, clamp(s, 0.0, 1.0)).r;
    s = 0.5 + (p - 0.5 - uShift * near * uCam) / (1.0 + (uZoom - 1.0) * near);
  }
  gl_FragColor = vec4(texture2D(uPlate, mirrorUv(s)).rgb, 1.0);
}`;

type Gl = {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  plate: WebGLTexture;
  depth: WebGLTexture;
  uniforms: Record<"uPlate" | "uDepth" | "uFit" | "uCam" | "uShift" | "uZoom" | "uContain", WebGLUniformLocation | null>;
};

export type PlateParallaxOptions = {
  /** The stage's `[data-vn-scene]`; the canvas goes in right after its scene images. */
  scene: HTMLElement;
  /** The sprite layer, moved with the floor. */
  sprites: () => HTMLElement | null;
  /** Depth of a plate URL (plate-depth-service.ts by default, tests stub it). */
  depthFor: (url: string) => Promise<PlateDepthMap>;
  /** Decoded picture of a plate URL (defaults to an `<img>` decode). */
  loadImage?: (url: string) => Promise<HTMLImageElement>;
};

const loadImage = async (url: string): Promise<HTMLImageElement> => {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
};

const media = (query: string): boolean => {
  try {
    return typeof matchMedia === "function" && matchMedia(query).matches;
  } catch {
    return false;
  }
};

export class PlateParallax {
  readonly canvas: HTMLCanvasElement;
  private readonly options: PlateParallaxOptions;
  private enabled = true;
  private motion: PlateParallaxMotion = "full";
  private fit = "cover";
  private url: string | null = null;
  private token = 0;
  private gl: Gl | null = null;
  private broken = false;
  private ready = false;
  private shown: { url: string; map: PlateDepthMap; image: HTMLImageElement; floorNear: number } | null = null;
  private cam = { x: 0, y: 0 };
  private target = { x: 0, y: 0 };
  private zoom = 1;
  private dollyStart = 0;
  private frame = 0;
  private lastTime = 0;
  private spritesMoved = false;
  private destroyed = false;
  private listening = false;

  constructor(options: PlateParallaxOptions) {
    this.options = options;
    const canvas = document.createElement("canvas");
    // A scene image for the camera-effect CSS (zoom, punch, tilt, blur) and reduced-motion rules.
    canvas.setAttribute("data-vn-scene-image", "");
    canvas.setAttribute("data-vn-plate-depth", "");
    canvas.setAttribute("aria-hidden", "true");
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    this.canvas = canvas;
  }

  /** The setting (`spritePlateDepth`). */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.refresh();
  }

  /** Motion (`effectIntensity`): "off" keeps the flat plate, "gentle" halves the movement. */
  setMotion(motion: PlateParallaxMotion): void {
    if (this.motion === motion) return;
    this.motion = motion;
    this.refresh();
  }

  /** Scene image fit (`sceneImageFit`): cover, contain and fill are drawn; others stay flat. */
  setFit(fit: string): void {
    if (this.fit === fit) return;
    this.fit = fit;
    this.refresh();
  }

  /** The plate on screen (null: none, a key illustration, scene mode). Cheap to call on every render. */
  show(url: string | null): void {
    if (url === this.url) return;
    this.url = url;
    this.hide();
    this.request();
  }

  /** Whether the canvas shows the plate in 3D (tests, diagnostics). */
  isActive(): boolean {
    return this.ready;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.token += 1;
    if (this.frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.listening) {
      document.removeEventListener("pointermove", this.onPointerMove);
      document.removeEventListener("pointerout", this.onPointerOut);
    }
    this.clearSprites();
    this.releaseGl();
    this.canvas.remove();
  }

  private allowed(): boolean {
    return this.enabled && this.motion !== "off" && !this.broken && !media("(prefers-reduced-motion: reduce)");
  }

  private refresh(): void {
    this.hide();
    this.request();
  }

  private request(): void {
    const url = this.url;
    const token = ++this.token;
    if (!url || !this.allowed() || !plateFitTransform(this.fit, 1, 1, 1, 1)) return;
    // No WebGL, no depth: the model is not even downloaded.
    if (!this.ensureGl()) return;
    this.mount();
    const cached = this.shown && this.shown.url === url ? this.shown : null;
    const ready = cached
      ? Promise.resolve({ map: cached.map, image: cached.image })
      : Promise.all([this.options.depthFor(url), (this.options.loadImage ?? loadImage)(url)]).then(([map, image]) => ({ map, image }));
    ready.then(({ map, image }) => {
      if (token !== this.token || this.destroyed || this.url !== url || !this.allowed()) return;
      this.present(url, map, image);
    }).catch(() => { /* no depth: the plate stays flat */ });
  }

  private present(url: string, map: PlateDepthMap, image: HTMLImageElement): void {
    const gl = this.ensureGl();
    if (!gl) return;
    const max = gl.gl.getParameter(gl.gl.MAX_TEXTURE_SIZE) as number;
    if (!image.naturalWidth || image.naturalWidth > max || image.naturalHeight > max) return;
    try {
      const g = gl.gl;
      g.activeTexture(g.TEXTURE0);
      g.bindTexture(g.TEXTURE_2D, gl.plate);
      g.pixelStorei(g.UNPACK_ALIGNMENT, 4);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, image);
      g.activeTexture(g.TEXTURE1);
      g.bindTexture(g.TEXTURE_2D, gl.depth);
      g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
      g.texImage2D(g.TEXTURE_2D, 0, g.LUMINANCE, map.width, map.height, 0, g.LUMINANCE, g.UNSIGNED_BYTE, map.depth);
    } catch {
      // A picture WebGL may not read (cross-origin without CORS): stay flat.
      return;
    }
    this.shown = { url, map, image, floorNear: plateFloorNear(map) };
    this.ready = true;
    if (!this.listening) {
      this.listening = true;
      document.addEventListener("pointermove", this.onPointerMove, { passive: true });
      document.addEventListener("pointerout", this.onPointerOut, { passive: true });
    }
    this.cam = { x: 0, y: 0 };
    this.zoom = 1;
    this.dollyStart = performance.now();
    this.draw();
    this.canvas.dataset.vnReady = "true";
    this.wake();
  }

  /** Puts the canvas right after the flat images (above the active one, under the incoming one), once WebGL works. */
  private mount(): void {
    if (this.canvas.isConnected) return;
    const images = this.options.scene.querySelectorAll("[data-vn-scene-image]");
    const last = images[images.length - 1];
    if (last?.parentNode) last.parentNode.insertBefore(this.canvas, last.nextSibling);
    else this.options.scene.prepend(this.canvas);
  }

  private hide(): void {
    this.ready = false;
    delete this.canvas.dataset.vnReady;
    // The camera eases back to rest while the canvas fades, the sprites with it
    // (nothing to ease before WebGL ever drew).
    if (this.gl || this.spritesMoved) this.wake();
  }

  private ensureGl(): Gl | null {
    if (this.gl) return this.gl;
    if (this.broken) return null;
    try {
      const attributes: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
      const gl = (this.canvas.getContext("webgl", attributes) ?? this.canvas.getContext("experimental-webgl", attributes)) as WebGLRenderingContext | null;
      if (!gl) throw new Error("no WebGL");
      const compile = (type: number, source: string): WebGLShader => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
        return shader;
      };
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
      gl.useProgram(program);
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // One triangle over the whole screen.
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "aPos");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const texture = (unit: number): WebGLTexture => {
        const t = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      };
      const plate = texture(0);
      const depth = texture(1);
      const uniforms = {} as Gl["uniforms"];
      for (const name of ["uPlate", "uDepth", "uFit", "uCam", "uShift", "uZoom", "uContain"] as const) uniforms[name] = gl.getUniformLocation(program, name);
      gl.uniform1i(uniforms.uPlate, 0);
      gl.uniform1i(uniforms.uDepth, 1);
      this.gl = { gl, program, buffer, plate, depth, uniforms };
      return this.gl;
    } catch {
      this.broken = true;
      return null;
    }
  }

  private releaseGl(): void {
    const current = this.gl;
    this.gl = null;
    if (!current) return;
    const { gl } = current;
    try {
      gl.deleteTexture(current.plate);
      gl.deleteTexture(current.depth);
      gl.deleteBuffer(current.buffer);
      gl.deleteProgram(current.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch { /* already gone */ }
  }

  private draw(): void {
    const current = this.gl;
    const shown = this.shown;
    if (!current || !shown) return;
    const { gl, uniforms } = current;
    const cssW = this.canvas.clientWidth || this.options.scene.clientWidth;
    const cssH = this.canvas.clientHeight || this.options.scene.clientHeight;
    if (!cssW || !cssH) return;
    const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? Math.min(2, devicePixelRatio) : 1;
    const shrink = Math.min(1, MAX_CANVAS_PX / Math.max(cssW * dpr, cssH * dpr));
    const width = Math.max(1, Math.round(cssW * dpr * shrink));
    const height = Math.max(1, Math.round(cssH * dpr * shrink));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const fit = plateFitTransform(this.fit, shown.image.naturalWidth, shown.image.naturalHeight, cssW, cssH);
    if (!fit) return;
    gl.viewport(0, 0, width, height);
    gl.uniform4f(uniforms.uFit, fit.offsetX, fit.offsetY, fit.scaleX, fit.scaleY);
    gl.uniform2f(uniforms.uCam, this.cam.x, this.cam.y);
    gl.uniform2f(uniforms.uShift, PLATE_PARALLAX_SHIFT, (PLATE_PARALLAX_SHIFT * shown.image.naturalWidth) / shown.image.naturalHeight);
    gl.uniform1f(uniforms.uZoom, this.zoom);
    gl.uniform1f(uniforms.uContain, fit.contain ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private amplitude(): number {
    return this.motion === "gentle" ? 0.5 : 1;
  }

  private goal(now: number): { x: number; y: number } {
    if (!this.ready) return { x: 0, y: 0 };
    if (media("(hover: none) and (pointer: coarse)")) {
      const t = now / 1000;
      const a = this.amplitude();
      return { x: DRIFT.x * a * Math.sin((2 * Math.PI * t) / DRIFT.periodX), y: DRIFT.y * a * Math.sin((2 * Math.PI * t) / DRIFT.periodY) };
    }
    return this.target;
  }

  private wake(): void {
    if (this.frame || this.destroyed) return;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.frame = 0;
    if (this.destroyed) return;
    if (this.ready && !this.allowed()) this.hide();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const goal = this.goal(now);
    const k = 1 - Math.exp(-dt / (this.ready ? FOLLOW_S : RELEASE_S));
    this.cam.x += (goal.x - this.cam.x) * k;
    this.cam.y += (goal.y - this.cam.y) * k;
    const dolly = now - this.dollyStart;
    this.zoom = this.ready ? plateDollyZoom(dolly, this.motion) : this.zoom + (1 - this.zoom) * k;
    this.draw();
    this.moveSprites();
    const moving = Math.abs(goal.x - this.cam.x) > 1e-3 || Math.abs(goal.y - this.cam.y) > 1e-3;
    const busy = this.ready
      ? moving || dolly < PLATE_DOLLY_MS || media("(hover: none) and (pointer: coarse)")
      : moving || Math.abs(this.zoom - 1) > 1e-4;
    // hide() above may have woken the loop already.
    if (busy && !this.frame) this.frame = requestAnimationFrame(this.tick);
    else if (!busy && !this.ready) this.clearSprites();
  };

  private moveSprites(): void {
    const sprites = this.options.sprites();
    const shown = this.shown;
    if (!sprites || !shown) return;
    const width = plateDrawnWidth(this.fit, shown.image.naturalWidth, shown.image.naturalHeight, this.options.scene.clientWidth, this.options.scene.clientHeight);
    const near = shown.floorNear;
    const shift = PLATE_PARALLAX_SHIFT * width * near;
    const x = shift * this.cam.x;
    const y = shift * this.cam.y;
    const scale = 1 + (this.zoom - 1) * near;
    sprites.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(5)})`;
    this.spritesMoved = true;
  }

  private clearSprites(): void {
    if (!this.spritesMoved) return;
    this.spritesMoved = false;
    this.options.sprites()?.style.removeProperty("transform");
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" || !this.ready) return;
    this.target = pointerCamera(event.clientX, event.clientY, this.options.scene.getBoundingClientRect());
    const a = this.amplitude();
    this.target.x *= a;
    this.target.y *= a;
    this.wake();
  };

  private readonly onPointerOut = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" || event.relatedTarget) return;
    // Left the window: back to the middle.
    this.target = { x: 0, y: 0 };
    this.wake();
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.gl = null;
    this.hide();
  };

  private readonly onContextRestored = (): void => {
    if (this.shown && this.shown.url === this.url && this.allowed()) this.present(this.shown.url, this.shown.map, this.shown.image);
  };
}
