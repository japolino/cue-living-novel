/**
 * Visual Novel Stage Visual Effects & Ambient Stylesheets
 *
 * Camera moves, screen flashes, one-shot particle bursts, ambient weather and
 * mood grades. Particle markup comes from stage/procedural-particles.ts; every
 * shape is a local inline SVG data URI built here (no network assets).
 *
 * Layering contract:
 * - ambient weather / grades live in `[data-vn-ambient]` inside the scene
 *   (under the readability scrim and the dialogue box);
 * - sprite mode adds a front ambient copy (`[data-vn-ambient-front]`) in
 *   front of the sprites, raises grades over them, and lights the plate
 *   behind them for lightning (`[data-vn-plate-light]`), see "SPRITE MODE
 *   DEPTH" below;
 * - bursts live in `[data-vn-fx]` above the scene, below the dialogue box;
 * - nothing here ever takes pointer events.
 *
 * Motion only animates transform / translate / rotate / scale / opacity (and
 * filter on the scene image for blur_pulse). `prefers-reduced-motion` freezes
 * every particle in place and keeps grades static; the stage's
 * `data-vn-effect-intensity="gentle"` halves particle density.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Inline SVG image as a CSS `url(...)`. Base64 keeps the value free of quotes
 * and of the namespace URL text, so it is safe inside inline style attributes.
 */
export function svgDataUri(body: string, width: number, height: number): string {
  const svg = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${body}</svg>`;
  return `url(data:image/svg+xml;base64,${btoa(svg)})`;
}

/* ---------------------------------- shapes --------------------------------- */

const PETAL_PATH = "M20 46C10 39 3.5 28 5 16C6 8 11 3.5 16.5 4.5L20 10.5L23.5 4.5C29 3.5 34 8 35 16C36.5 28 30 39 20 46Z";

function petal(edge: string, mid: string, center: string, blur = 0): string {
  const filter = blur ? `<filter id="b" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${blur}"/></filter>` : "";
  return svgDataUri(
    `<defs><radialGradient id="g" cx="50%" cy="88%" r="85%"><stop offset="0" stop-color="${center}"/><stop offset=".55" stop-color="${mid}"/><stop offset="1" stop-color="${edge}"/></radialGradient>${filter}</defs>` +
      `<g${blur ? ' filter="url(#b)"' : ""}><path d="${PETAL_PATH}" fill="url(#g)"/>` +
      `<path d="M20 44C19.5 34 19.6 22 20 12" stroke="${edge}" stroke-opacity=".35" stroke-width=".9" fill="none"/></g>`,
    40,
    50,
  );
}

const SHAPE_PETAL_A = petal("#f39ab4", "#ffc6d5", "#fff4f7");
const SHAPE_PETAL_B = petal("#e9799d", "#fbb0c6", "#ffe9f0");
const SHAPE_PETAL_C = petal("#f7c1d0", "#ffe1ea", "#ffffff");
const SHAPE_PETAL_SOFT = petal("#f5a8bf", "#ffcbd9", "#fff2f6", 1.6);

function flakeArm(angle: number): string {
  return `<g transform="rotate(${angle} 32 32)"><path d="M32 32V5M32 13l-6-6M32 13l6-6M32 22l-8-6M32 22l8-6"/></g>`;
}

const FLAKE_ARMS = [0, 60, 120, 180, 240, 300].map(flakeArm).join("");
const SHAPE_FLAKE = svgDataUri(
  `<defs><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter></defs>` +
    `<g stroke="#eef6ff" stroke-width="7" stroke-linecap="round" fill="none" opacity=".6" filter="url(#b)">${FLAKE_ARMS}</g>` +
    `<g stroke="#ffffff" stroke-width="3.6" stroke-linecap="round" fill="none">${FLAKE_ARMS}</g>` +
    `<circle cx="32" cy="32" r="4" fill="#fff"/>`,
  64,
  64,
);

const SPARKLE_PATH = "M32 2C33.6 22 42 30.4 62 32C42 33.6 33.6 42 32 62C30.4 42 22 33.6 2 32C22 30.4 30.4 22 32 2Z";

function sparkle(color: string): string {
  return svgDataUri(
    `<defs><filter id="b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="3.2"/></filter>` +
      `<radialGradient id="c"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>` +
      `<path d="${SPARKLE_PATH}" fill="${color}" opacity=".85" filter="url(#b)"/>` +
      `<path d="${SPARKLE_PATH}" fill="${color}"/>` +
      `<path d="${SPARKLE_PATH}" fill="#fff" transform="translate(32 32) scale(.45) translate(-32 -32)"/>` +
      `<circle cx="32" cy="32" r="9" fill="url(#c)"/>`,
    64,
    64,
  );
}

const SHAPE_SPARKLE_A = sparkle("#ffd66b");
const SHAPE_SPARKLE_B = sparkle("#fff6dc");
const SHAPE_SPARKLE_C = sparkle("#8ff0ff");
const SHAPE_SPARKLE_D = sparkle("#ffb0d4");

const HEART_PATH = "M32 55C14 42 5 31 5 19C5 10 11.5 4 19.5 4C25 4 29.5 7 32 12C34.5 7 39 4 44.5 4C52.5 4 59 10 59 19C59 31 50 42 32 55Z";

function heart(light: string, base: string, deep: string, soft = false): string {
  const blur = soft ? 4.5 : 2.6;
  return svgDataUri(
    `<defs><filter id="b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="${blur}"/></filter>` +
      `<linearGradient id="g" x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="${light}"/><stop offset=".5" stop-color="${base}"/><stop offset="1" stop-color="${deep}"/></linearGradient></defs>` +
      (soft
        ? `<path d="${HEART_PATH}" fill="url(#g)" opacity=".5" filter="url(#b)" transform="translate(32 30) scale(.82) translate(-32 -30)"/>`
        : `<path d="${HEART_PATH}" fill="${base}" opacity=".6" filter="url(#b)"/>` +
          `<path d="${HEART_PATH}" fill="url(#g)" transform="translate(32 30) scale(.86) translate(-32 -30)"/>` +
          `<ellipse cx="21" cy="17" rx="7" ry="4.2" transform="rotate(-32 21 17)" fill="#fff" opacity=".55"/>`),
    64,
    60,
  );
}

const SHAPE_HEART_A = heart("#ff9fb6", "#ff4d7a", "#c4194a");
const SHAPE_HEART_B = heart("#ffd0dc", "#ff86a6", "#e24f7a");
const SHAPE_HEART_C = heart("#f4c2ff", "#d667ff", "#9a2fd0");
const SHAPE_HEART_SOFT = heart("#ffc2d2", "#ff7aa0", "#e0457a", true);

/**
 * Seamless (stitched) fractal noise rendered as soft white mist. The vertical
 * density profile (`stops`: offset/opacity pairs, top to bottom) is baked into
 * the texture, so the drifting layers need no per-frame CSS mask.
 */
function mistNoise(width: number, height: number, freq: string, seed: number, alphaGain: number, alphaOffset: number, stops: Array<[number, number]>): string {
  const gradient = stops.map(([offset, opacity]) => `<stop offset="${offset}" stop-color="#fff" stop-opacity="${opacity}"/>`).join("");
  return svgDataUri(
    `<defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1">${gradient}</linearGradient><mask id="m"><rect width="${width}" height="${height}" fill="url(#v)"/></mask></defs>` +
      `<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="4" seed="${seed}" stitchTiles="stitch"/>` +
      `<feColorMatrix values="0 0 0 0 .9 0 0 0 0 .93 0 0 0 0 .97 ${alphaGain} 0 0 0 ${alphaOffset}"/></filter>` +
      `<g mask="url(#m)"><rect width="${width}" height="${height}" filter="url(#n)"/></g>`,
    width,
    height,
  );
}

const TEX_FOG_FAR = mistNoise(1024, 384, "0.0039 0.0104", 7, 1.9, -0.62, [[0, 0], [0.4, 1], [0.72, 1], [1, 0]]);
const TEX_FOG_MID = mistNoise(896, 384, "0.0045 0.013", 13, 2.1, -0.7, [[0, 0], [0.35, 1], [1, 1]]);
const TEX_FOG_NEAR = mistNoise(1280, 448, "0.0031 0.0089", 21, 2.4, -0.78, [[0, 0], [0.55, 1], [1, 1]]);
const TEX_FOG_BANK = mistNoise(896, 384, "0.0045 0.013", 13, 2.1, -0.7, [[0, 0], [0.75, 1], [1, 1]]);

/** Seamless monochrome film grain (used with an overlay blend). */
const TEX_GRAIN = svgDataUri(
  `<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".82" numOctaves="2" seed="5" stitchTiles="stitch"/>` +
    `<feColorMatrix values="1.6 0 0 0 -.3 1.6 0 0 0 -.3 1.6 0 0 0 -.3 0 0 0 0 1"/></filter><rect width="160" height="160" filter="url(#n)"/>`,
  160,
  160,
);

export const VN_EFFECTS_CSS = `
/* ==========================================================================
   CAMERA & SCREEN EFFECTS (ONE-SHOT)
   Root (UI) moves are kept small so the dialogue stays readable; the scene
   carries the big motion and over-scales slightly so edges never show.
   ========================================================================== */

/* Shake: refines the base 300ms jolt into a damped hit. */
@keyframes vn-shake-root {
  0%, 100% { transform: translate3d(0, 0, 0); }
  12% { transform: translate3d(-3px, 2px, 0); }
  28% { transform: translate3d(3px, -2px, 0); }
  46% { transform: translate3d(-2px, -1px, 0); }
  66% { transform: translate3d(1px, 1px, 0); }
  84% { transform: translate3d(-0.5px, 0, 0); }
}

@keyframes vn-shake-scene {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1.02); }
  12% { transform: translate3d(-5px, 3px, 0) rotate(-0.25deg) scale(1.02); }
  28% { transform: translate3d(5px, -3px, 0) rotate(0.2deg) scale(1.02); }
  46% { transform: translate3d(-3px, -2px, 0) scale(1.02); }
  66% { transform: translate3d(2px, 1px, 0) scale(1.02); }
  84% { transform: translate3d(-1px, 0, 0) scale(1.02); }
}

[data-vn-root].vn-shake,
[data-vn-root][data-vn-shake="true"] {
  animation: vn-shake-root 300ms cubic-bezier(0.33, 0, 0.3, 1) both;
}

[data-vn-scene].vn-shake,
[data-vn-scene][data-vn-shake="true"] {
  animation: vn-shake-scene 300ms cubic-bezier(0.33, 0, 0.3, 1) both;
}

/* Shake Hard: violent impact / explosion with a decaying, slightly rotating recoil */
@keyframes vn-shake-hard {
  0%, 100% { transform: translate3d(0, 0, 0); }
  8% { transform: translate3d(-6px, 4px, 0); }
  18% { transform: translate3d(6px, -4px, 0); }
  30% { transform: translate3d(-5px, -3px, 0); }
  44% { transform: translate3d(4px, 3px, 0); }
  58% { transform: translate3d(-3px, 1px, 0); }
  72% { transform: translate3d(2px, -1px, 0); }
  86% { transform: translate3d(-1px, 0, 0); }
}

@keyframes vn-shake-hard-scene {
  0%, 100% { transform: translate3d(0, 0, 0) rotate(0deg) scale(1.04); }
  8% { transform: translate3d(-14px, 9px, 0) rotate(-0.7deg) scale(1.05); }
  18% { transform: translate3d(15px, -10px, 0) rotate(0.6deg) scale(1.05); }
  30% { transform: translate3d(-12px, -7px, 0) rotate(-0.45deg) scale(1.045); }
  44% { transform: translate3d(9px, 7px, 0) rotate(0.3deg) scale(1.04); }
  58% { transform: translate3d(-6px, 3px, 0) rotate(-0.2deg) scale(1.04); }
  72% { transform: translate3d(4px, -2px, 0) rotate(0.1deg) scale(1.04); }
  86% { transform: translate3d(-2px, 1px, 0) scale(1.04); }
}

.vn-shake-hard,
[data-vn-shake="hard"],
[data-vn-root].vn-shake-hard,
[data-vn-root][data-vn-shake="hard"] {
  animation: vn-shake-hard 500ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
}

[data-vn-scene].vn-shake-hard,
[data-vn-scene][data-vn-shake="hard"] {
  animation: vn-shake-hard-scene 500ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
}

/* Rumble: continuous low-amplitude tremor that swells in and settles out */
@keyframes vn-rumble {
  0%, 100% { transform: translate3d(0, 0, 0); }
  10% { transform: translate3d(-1px, 1px, 0); }
  20% { transform: translate3d(1.5px, -1px, 0); }
  30% { transform: translate3d(-1.5px, -1px, 0); }
  40% { transform: translate3d(1.5px, 1px, 0); }
  50% { transform: translate3d(-2px, 0.5px, 0); }
  60% { transform: translate3d(1.5px, -1px, 0); }
  70% { transform: translate3d(-1px, 1px, 0); }
  80% { transform: translate3d(1px, -0.5px, 0); }
  90% { transform: translate3d(-0.5px, 0.5px, 0); }
}

@keyframes vn-rumble-scene {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1.015); }
  6% { transform: translate3d(-1.5px, 1px, 0) scale(1.015); }
  12% { transform: translate3d(2px, -1.5px, 0) scale(1.015); }
  18% { transform: translate3d(-3px, -1px, 0) scale(1.015); }
  24% { transform: translate3d(3px, 2px, 0) scale(1.015); }
  30% { transform: translate3d(-3.5px, 1px, 0) scale(1.015); }
  36% { transform: translate3d(3px, -2px, 0) scale(1.015); }
  42% { transform: translate3d(-3.5px, -1.5px, 0) scale(1.015); }
  48% { transform: translate3d(3.5px, 1.5px, 0) scale(1.015); }
  54% { transform: translate3d(-3px, 2px, 0) scale(1.015); }
  60% { transform: translate3d(3px, -1.5px, 0) scale(1.015); }
  66% { transform: translate3d(-2.5px, 1px, 0) scale(1.015); }
  72% { transform: translate3d(2.5px, -1px, 0) scale(1.015); }
  78% { transform: translate3d(-2px, -1px, 0) scale(1.015); }
  84% { transform: translate3d(1.5px, 1px, 0) scale(1.015); }
  90% { transform: translate3d(-1px, 0.5px, 0) scale(1.015); }
  95% { transform: translate3d(0.5px, -0.5px, 0) scale(1.015); }
}

.vn-rumble,
[data-vn-shake="rumble"],
[data-vn-root].vn-rumble,
[data-vn-root][data-vn-shake="rumble"] {
  animation: vn-rumble 800ms linear both;
}

[data-vn-scene].vn-rumble,
[data-vn-scene][data-vn-shake="rumble"] {
  animation: vn-rumble-scene 800ms linear both;
}

/* Zoom Out: the camera pulls back from a close framing to the full shot.
   (Ends at scale 1 so a cover-fit image never reveals its edges.) */
@keyframes vn-zoom-pull {
  0% { transform: scale(1.14); }
  100% { transform: scale(1); }
}

[data-vn-scene-image].vn-zoom-out,
[data-vn-scene-image][data-vn-zoom="out"],
[data-vn-scene].vn-zoom-out [data-vn-scene-image],
[data-vn-scene][data-vn-zoom="out"] [data-vn-scene-image],
[data-vn-root].vn-zoom-out [data-vn-scene-image],
[data-vn-root][data-vn-zoom="out"] [data-vn-scene-image] {
  transform: scale(1);
  animation: vn-zoom-pull 1.6s cubic-bezier(0.22, 0.68, 0.18, 1) both;
}

/* Zoom Punch: sharp punch-in, small rebound, settle */
@keyframes vn-zoom-punch {
  0% { transform: scale(1); animation-timing-function: cubic-bezier(0.2, 0.9, 0.3, 1); }
  16% { transform: scale(1.17); animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1); }
  42% { transform: scale(0.985); animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1); }
  66% { transform: scale(1.012); animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1); }
  100% { transform: scale(1); }
}

[data-vn-scene-image].vn-zoom-punch,
[data-vn-scene-image][data-vn-zoom="punch"],
[data-vn-scene].vn-zoom-punch [data-vn-scene-image],
[data-vn-scene][data-vn-zoom="punch"] [data-vn-scene-image] {
  animation: vn-zoom-punch 450ms linear both;
}

/* Tilt: Dutch-angle cant. The scale covers the rotated corners at 16:9 and portrait. */
@keyframes vn-tilt {
  0% { transform: rotate(0deg) scale(1); animation-timing-function: cubic-bezier(0.3, 0, 0.2, 1); }
  32% { transform: rotate(2.2deg) scale(1.095); animation-timing-function: linear; }
  68% { transform: rotate(2.4deg) scale(1.1); animation-timing-function: cubic-bezier(0.5, 0, 0.3, 1); }
  100% { transform: rotate(0deg) scale(1); }
}

[data-vn-scene-image].vn-tilt,
[data-vn-scene-image][data-vn-tilt="true"],
[data-vn-scene].vn-tilt [data-vn-scene-image],
[data-vn-scene][data-vn-tilt="true"] [data-vn-scene-image] {
  animation: vn-tilt 700ms linear both;
}

/* Heartbeat: lub-dub pulse of the scene plus a red edge vignette */
@keyframes vn-heartbeat {
  0% { transform: scale(1); }
  12% { transform: scale(1.04); }
  24% { transform: scale(1.005); }
  36% { transform: scale(1.06); }
  62% { transform: scale(1); }
  100% { transform: scale(1); }
}

@keyframes vn-heartbeat-flash {
  0% { opacity: 0; }
  12% { opacity: 0.8; }
  24% { opacity: 0.25; }
  36% { opacity: 1; }
  70% { opacity: 0.08; }
  100% { opacity: 0; }
}

.vn-heartbeat,
[data-vn-heartbeat],
[data-vn-root].vn-heartbeat,
[data-vn-root][data-vn-heartbeat],
[data-vn-scene].vn-heartbeat,
[data-vn-scene][data-vn-heartbeat] {
  animation: vn-heartbeat 850ms cubic-bezier(0.3, 0.2, 0.3, 1) both;
}

[data-vn-flash].vn-heartbeat-flash {
  background: radial-gradient(ellipse 80% 75% at 50% 44%, rgba(160, 0, 30, 0) 38%, rgba(185, 12, 42, 0.42) 78%, rgba(110, 0, 18, 0.78) 100%);
  animation: vn-heartbeat-flash 850ms ease-out both;
}

/* Blur Pulse: camera defocus shock with a brief exposure lift */
@keyframes vn-blur-pulse {
  0% { filter: blur(0px) brightness(1); }
  28% { filter: blur(7px) brightness(1.12) saturate(0.9); }
  100% { filter: blur(0px) brightness(1); }
}

[data-vn-scene-image].vn-blur-pulse,
[data-vn-scene-image][data-vn-blur],
[data-vn-scene].vn-blur-pulse [data-vn-scene-image],
[data-vn-scene][data-vn-blur] [data-vn-scene-image] {
  animation: vn-blur-pulse 650ms cubic-bezier(0.3, 0, 0.2, 1) both;
}

/* Flash red: hot edges, lighter centre, so it reads as a hit rather than a flat wash */
@keyframes vn-flash-red-hit {
  0% { opacity: 0.86; }
  100% { opacity: 0; }
}

[data-vn-flash].vn-flash-red,
[data-vn-flash][data-vn-flash="red"] {
  background: radial-gradient(ellipse 85% 80% at 50% 45%, rgba(255, 92, 72, 0.5) 0%, rgba(214, 26, 36, 0.86) 68%, rgba(120, 4, 14, 0.96) 100%);
  animation: vn-flash-red-hit 500ms cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
}

/* Fades & Flashes: Fade from Black, Fade to White, Lightning */
@keyframes vn-fade-from-black {
  0% { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes vn-fade-to-white {
  0% { opacity: 0; }
  35% { opacity: 1; }
  70% { opacity: 1; }
  100% { opacity: 0; }
}

/* Lightning: double strike. The flash peaks are short so the bolt drawn in
   [data-vn-fx] stays readable between them. */
@keyframes vn-lightning {
  0% { opacity: 0; }
  3% { opacity: 0.82; }
  9% { opacity: 0.06; }
  17% { opacity: 0; }
  21% { opacity: 0.66; }
  28% { opacity: 0.1; }
  44% { opacity: 0.04; }
  100% { opacity: 0; }
}

[data-vn-flash].vn-fade-from-black,
[data-vn-flash][data-vn-flash="fade_from_black"] {
  background: #000000;
  animation: vn-fade-from-black 800ms cubic-bezier(0.45, 0, 0.2, 1) forwards;
}

[data-vn-flash].vn-fade-to-white,
[data-vn-flash][data-vn-flash="fade_to_white"] {
  background: radial-gradient(ellipse 90% 85% at 50% 42%, #ffffff 0%, #fffdf8 55%, #f1f0f6 100%);
  animation: vn-fade-to-white 800ms cubic-bezier(0.45, 0, 0.55, 1) forwards;
}

[data-vn-flash].vn-lightning,
[data-vn-flash][data-vn-flash="lightning"] {
  background: radial-gradient(ellipse 120% 95% at 66% 6%, #f7f9ff 0%, #dfe7fb 48%, #aebcde 100%);
  animation: vn-lightning 550ms linear forwards;
}

/* ==========================================================================
   ONE-SHOT BURSTS ([data-vn-fx], above the scene, below the dialogue box)
   ========================================================================== */

[data-vn-fx] {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  overflow: hidden;
  container-type: size;
}

[data-vn-fx] svg,
[data-vn-flash] svg {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

[data-vn-fx][data-vn-effect],
[data-vn-flash][data-vn-effect] {
  opacity: 1;
}

.vn-burst,
.vn-bolt {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

[data-vn-fx] .vn-pt,
[data-vn-fx] .vn-burst > b,
[data-vn-fx] .vn-bolt > b {
  position: absolute;
  display: block;
  pointer-events: none;
}

.vn-burst .vn-pt {
  left: var(--ox);
  top: var(--oy);
  width: var(--sz);
  height: var(--sz);
  margin: calc(var(--sz) / -2) 0 0 calc(var(--sz) / -2);
  background: center / contain no-repeat;
  opacity: 0;
}

.vn-burst-bloom {
  left: var(--ox);
  top: var(--oy);
  width: 56cqmin;
  height: 56cqmin;
  margin: -28cqmin 0 0 -28cqmin;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 250, 228, 0.7) 0%, rgba(255, 222, 160, 0.26) 34%, rgba(255, 210, 150, 0) 68%);
  mix-blend-mode: screen;
  opacity: 0;
  animation: vn-burst-bloom 700ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
}

.vn-burst-ring {
  left: var(--ox);
  top: var(--oy);
  width: 40cqmin;
  height: 40cqmin;
  margin: -20cqmin 0 0 -20cqmin;
  border-radius: 50%;
  border: 2px solid rgba(255, 246, 214, 0.75);
  box-shadow: 0 0 18px rgba(255, 230, 170, 0.45), inset 0 0 14px rgba(255, 230, 170, 0.35);
  opacity: 0;
  animation: vn-burst-ring 620ms cubic-bezier(0.1, 0.8, 0.3, 1) both;
}

@keyframes vn-burst-bloom {
  0% { opacity: 0; transform: scale(0.3); }
  20% { opacity: 1; transform: scale(0.95); }
  100% { opacity: 0; transform: scale(1.25); }
}

@keyframes vn-burst-ring {
  0% { opacity: 0.9; transform: scale(0.1); }
  100% { opacity: 0; transform: scale(1.35); }
}

@keyframes vn-burst-fly {
  from { translate: 0 0; }
  to { translate: var(--tx) var(--ty); }
}

/* Sparkle Burst: four-point glints fly out from the focus point and twinkle */
.vn-burst--sparkle { --ox: 50%; --oy: 42%; }

.vn-burst .vn-sparkle--a { background-image: ${SHAPE_SPARKLE_A}; }
.vn-burst .vn-sparkle--b { background-image: ${SHAPE_SPARKLE_B}; }
.vn-burst .vn-sparkle--c { background-image: ${SHAPE_SPARKLE_C}; }
.vn-burst .vn-sparkle--d { background-image: ${SHAPE_SPARKLE_D}; }

.vn-burst .vn-sparkle {
  animation:
    vn-burst-fly 700ms cubic-bezier(0.12, 0.8, 0.25, 1) var(--dl) both,
    vn-sparkle-twinkle 720ms ease-out var(--dl) both;
}

@keyframes vn-sparkle-twinkle {
  0% { opacity: 0; transform: scale(0.2) rotate(0deg); }
  14% { opacity: 1; transform: scale(1.2) rotate(calc(var(--rot) * 0.3)); }
  34% { opacity: 1; transform: scale(0.8) rotate(calc(var(--rot) * 0.55)); }
  52% { opacity: 1; transform: scale(1.06) rotate(calc(var(--rot) * 0.72)); }
  72% { opacity: 0.9; transform: scale(0.72) rotate(calc(var(--rot) * 0.86)); }
  100% { opacity: 0; transform: scale(0.2) rotate(var(--rot)); }
}

.vn-burst .vn-sparkle-dust {
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0 28%, rgba(255, 238, 190, 0.7) 48%, rgba(255, 238, 190, 0) 72%);
  animation:
    vn-burst-fly 740ms cubic-bezier(0.1, 0.75, 0.3, 1) var(--dl) both,
    vn-dust-fade 680ms ease-out var(--dl) both;
}

@keyframes vn-dust-fade {
  0% { opacity: 0; }
  20% { opacity: 1; }
  70% { opacity: 0.8; }
  100% { opacity: 0; }
}

/* Hearts Burst: hearts pop with a lub-dub beat and float upward with a sway */
.vn-burst--hearts { --ox: 50%; --oy: 62%; }

.vn-burst--hearts .vn-burst-bloom {
  background: radial-gradient(circle, rgba(255, 196, 214, 0.62) 0%, rgba(255, 120, 160, 0.22) 36%, rgba(255, 120, 160, 0) 68%);
}

.vn-burst .vn-heart--a { background-image: ${SHAPE_HEART_A}; }
.vn-burst .vn-heart--b { background-image: ${SHAPE_HEART_B}; }
.vn-burst .vn-heart--c { background-image: ${SHAPE_HEART_C}; }
.vn-burst .vn-heart--soft { background-image: ${SHAPE_HEART_SOFT}; }

.vn-burst .vn-heart {
  height: calc(var(--sz) * 0.94);
  animation:
    vn-heart-rise 820ms cubic-bezier(0.2, 0.65, 0.35, 1) var(--dl) both,
    vn-heart-beat 820ms linear var(--dl) both;
}

@keyframes vn-heart-rise {
  from { translate: 0 4cqh; }
  to { translate: var(--tx) var(--ty); }
}

@keyframes vn-heart-beat {
  0% { opacity: 0; transform: translateX(0) rotate(var(--r0)) scale(0.2); }
  14% { opacity: 1; transform: translateX(calc(var(--sw) * -0.4)) rotate(var(--r0)) scale(1.22); }
  26% { opacity: 1; transform: translateX(calc(var(--sw) * -0.6)) rotate(var(--r0)) scale(0.92); }
  38% { opacity: 1; transform: translateX(calc(var(--sw) * -0.4)) rotate(var(--r0)) scale(1.08); }
  72% { opacity: 0.95; transform: translateX(var(--sw)) rotate(calc(var(--r0) * -0.5)) scale(1); }
  100% { opacity: 0; transform: translateX(calc(var(--sw) * 0.5)) rotate(calc(var(--r0) * -0.8)) scale(0.78); }
}

/* Confetti: pieces kick up, then fall under gravity while flipping in 3D */
.vn-burst .vn-confetti-piece {
  width: 11px;
  height: 18px;
  margin: -9px 0 0 -5px;
  border-radius: 1.5px;
  background: linear-gradient(118deg, var(--c1) 0%, var(--c1) 42%, var(--c3) 52%, var(--c2) 100%);
  animation:
    vn-confetti-path 1100ms linear var(--dl) both,
    vn-confetti-flip 1100ms linear var(--dl) both,
    vn-confetti-life 1100ms linear var(--dl) both;
}

.vn-burst .vn-confetti--ribbon { width: 6px; height: 28px; margin: -14px 0 0 -3px; border-radius: 3px; }
.vn-burst .vn-confetti--dot { width: 11px; height: 11px; margin: -5px 0 0 -5px; border-radius: 50%; }
.vn-burst .vn-confetti--square { width: 13px; height: 13px; margin: -6px 0 0 -6px; }

.vn-confetti--c0 { --c1: #ff5d73; --c2: #c9304b; --c3: #ffb3bf; }
.vn-confetti--c1 { --c1: #ffc94a; --c2: #d69a12; --c3: #fff0b8; }
.vn-confetti--c2 { --c1: #4fd1a5; --c2: #23966f; --c3: #b8f5df; }
.vn-confetti--c3 { --c1: #5aa7ff; --c2: #2c6fcf; --c3: #c4e0ff; }
.vn-confetti--c4 { --c1: #b07cff; --c2: #7a46d4; --c3: #e3d1ff; }
.vn-confetti--c5 { --c1: #fff4e0; --c2: #d9c49f; --c3: #ffffff; }

@keyframes vn-confetti-path {
  0% { translate: 0 0; animation-timing-function: cubic-bezier(0.2, 0.6, 0.35, 1); }
  14% { translate: var(--kx) var(--ky); animation-timing-function: cubic-bezier(0.38, 0, 0.78, 0.78); }
  100% { translate: calc(var(--kx) + var(--tx)) var(--ty); }
}

@keyframes vn-confetti-flip {
  from { rotate: var(--ax) 0deg; }
  to { rotate: var(--ax) var(--spin); }
}

@keyframes vn-confetti-life {
  0% { opacity: 0; scale: 0.4; }
  6% { opacity: 1; scale: 1; }
  78% { opacity: 1; }
  100% { opacity: 0; scale: 1; }
}

/* Speed Lines: manga focus lines with a clear centre and alternating flicker */
[data-vn-fx] .vn-speed-lines {
  position: absolute;
  inset: 0;
  animation: vn-speed-lines-pop 650ms cubic-bezier(0.12, 0.9, 0.22, 1) both;
}

.vn-speed-lines-a { animation: vn-speed-lines-flicker 120ms steps(1, end) infinite; }
.vn-speed-lines-b { animation: vn-speed-lines-flicker 120ms steps(1, end) -60ms infinite; }

@keyframes vn-speed-lines-pop {
  0% { opacity: 0; transform: scale(1.14); }
  12% { opacity: 1; transform: scale(1.03); }
  72% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.99); }
}

@keyframes vn-speed-lines-flicker {
  0% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* Lightning bolt (paired with the double flash on [data-vn-flash]) */
.vn-bolt svg {
  position: absolute;
  inset: 0;
  overflow: visible;
  filter: drop-shadow(0 0 3px rgba(226, 236, 255, 0.95)) drop-shadow(0 0 14px rgba(120, 160, 255, 0.85));
  opacity: 0;
  animation: vn-bolt-strike 540ms linear both;
}

.vn-bolt path {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.vn-bolt-glow path { stroke: #9dbcff; stroke-opacity: 0.45; stroke-width: 9px; }
.vn-bolt-glow .vn-bolt-fork { stroke-width: 5px; }
.vn-bolt-core path { stroke: #ffffff; stroke-width: 2.6px; }
.vn-bolt-core .vn-bolt-fork { stroke-width: 1.4px; stroke: #eef3ff; }

.vn-bolt .vn-bolt-sky {
  inset: 0;
  background: radial-gradient(ellipse 60% 60% at 66% 0%, rgba(205, 222, 255, 0.6) 0%, rgba(150, 180, 255, 0.18) 45%, rgba(150, 180, 255, 0) 72%);
  mix-blend-mode: screen;
  opacity: 0;
  animation: vn-bolt-strike 540ms linear both;
}

@keyframes vn-bolt-strike {
  0% { opacity: 0; }
  3% { opacity: 1; }
  10% { opacity: 0.2; }
  17% { opacity: 0.35; }
  21% { opacity: 1; }
  40% { opacity: 0.85; }
  70% { opacity: 0.3; }
  100% { opacity: 0; }
}

/* ==========================================================================
   AMBIENT OVERLAY & MOOD GRADES (PERSISTENT, SCENE-LEVEL)
   ========================================================================== */

[data-vn-ambient] {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  overflow: hidden;
  container-type: size;
}

[data-vn-ambient] svg {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

[data-vn-ambient] .vn-fx-layer,
[data-vn-ambient] .vn-rain-wash,
[data-vn-ambient] .vn-rain-lens,
[data-vn-ambient] .vn-rain-splashes,
[data-vn-ambient] .vn-snow-chill,
[data-vn-ambient] .vn-sakura-light,
[data-vn-ambient] .vn-firefly-haze,
[data-vn-ambient] .vn-fog-wash {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

[data-vn-ambient] .vn-pt {
  position: absolute;
  display: block;
  pointer-events: none;
}

/* Shared film grain for the photographic grades */
[data-vn-ambient].vn-ambient-vignette_dark::after,
[data-vn-ambient].vn-ambient-sepia_flashback::after,
[data-vn-ambient].vn-ambient-desaturate::after,
[data-vn-ambient].vn-ambient-danger_pulse::after {
  content: "";
  position: absolute;
  inset: -64px;
  background: ${TEX_GRAIN} 0 0 / 160px 160px repeat;
  mix-blend-mode: overlay;
  opacity: 0.16;
  pointer-events: none;
}

@keyframes vn-grain {
  0% { transform: translate3d(0, 0, 0); }
  17% { transform: translate3d(-23px, 14px, 0); }
  33% { transform: translate3d(31px, -9px, 0); }
  50% { transform: translate3d(-12px, -27px, 0); }
  67% { transform: translate3d(19px, 22px, 0); }
  83% { transform: translate3d(-34px, 5px, 0); }
}

/* Mood Grade: Vignette Dark (deep elliptical falloff + fine grain) */
[data-vn-ambient].vn-ambient-vignette_dark {
  background:
    radial-gradient(ellipse 78% 72% at 50% 44%, rgba(0, 0, 0, 0) 36%, rgba(4, 4, 12, 0.38) 68%, rgba(0, 0, 0, 0.8) 100%);
  opacity: 1;
}

[data-vn-scene].vn-ambient-vignette_dark [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="vignette_dark"] [data-vn-scene-image] {
  filter: contrast(1.06) brightness(0.94);
}

/* Mood Grade: Sepia Flashback (aged print: warm tone, burnt edges, projector flicker, grain) */
[data-vn-scene].vn-ambient-sepia_flashback [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="sepia_flashback"] [data-vn-scene-image] {
  filter: sepia(0.72) contrast(1.1) brightness(1.02) saturate(0.88);
}

[data-vn-ambient].vn-ambient-sepia_flashback {
  background:
    radial-gradient(ellipse 80% 75% at 50% 45%, rgba(255, 226, 170, 0.14) 0%, rgba(150, 92, 34, 0.1) 58%, rgba(58, 30, 8, 0.62) 100%);
  opacity: 1;
}

[data-vn-ambient].vn-ambient-sepia_flashback::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(104deg, rgba(255, 196, 120, 0) 0%, rgba(255, 196, 120, 0.16) 16%, rgba(255, 196, 120, 0) 38%);
  mix-blend-mode: screen;
  pointer-events: none;
  animation: vn-projector-flicker 3.3s steps(1, end) infinite;
}

[data-vn-ambient].vn-ambient-sepia_flashback::after {
  opacity: 0.24;
  animation: vn-grain 0.6s steps(1, end) infinite;
}

@keyframes vn-projector-flicker {
  0% { opacity: 1; }
  9% { opacity: 0.72; }
  13% { opacity: 1; }
  41% { opacity: 0.85; }
  44% { opacity: 1; }
  77% { opacity: 0.66; }
  80% { opacity: 0.95; }
}

/* Mood Grade: Desaturate (bleak, cold, melancholic) */
[data-vn-scene].vn-ambient-desaturate [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="desaturate"] [data-vn-scene-image] {
  filter: grayscale(0.88) contrast(1.08) brightness(0.92);
}

[data-vn-ambient].vn-ambient-desaturate {
  background:
    radial-gradient(ellipse 82% 78% at 50% 44%, rgba(10, 14, 22, 0) 48%, rgba(10, 14, 24, 0.5) 100%),
    linear-gradient(180deg, rgba(120, 140, 172, 0.14), rgba(70, 86, 112, 0.18));
  opacity: 1;
}

[data-vn-ambient].vn-ambient-desaturate::after {
  opacity: 0.12;
}

/* Mood Grade: Dream Haze (bloom, pastel light, drifting glow, soft edges) */
[data-vn-scene].vn-ambient-dream_haze [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="dream_haze"] [data-vn-scene-image] {
  filter: brightness(1.08) contrast(0.9) saturate(1.14) blur(0.6px);
}

[data-vn-ambient].vn-ambient-dream_haze {
  background:
    radial-gradient(ellipse 85% 80% at 50% 42%, rgba(255, 240, 248, 0) 44%, rgba(246, 230, 255, 0.5) 100%),
    radial-gradient(circle at 50% 38%, rgba(255, 236, 246, 0.18) 0%, rgba(230, 212, 255, 0.1) 60%, rgba(186, 166, 226, 0.2) 100%);
  opacity: 1;
}

[data-vn-ambient].vn-ambient-dream_haze::before {
  content: "";
  position: absolute;
  inset: -12%;
  background:
    radial-gradient(circle at 22% 30%, rgba(255, 226, 242, 0.34), rgba(255, 226, 242, 0) 24%),
    radial-gradient(circle at 76% 58%, rgba(214, 206, 255, 0.3), rgba(214, 206, 255, 0) 26%),
    radial-gradient(circle at 58% 16%, rgba(255, 248, 226, 0.3), rgba(255, 248, 226, 0) 18%),
    radial-gradient(circle at 34% 78%, rgba(255, 214, 236, 0.22), rgba(255, 214, 236, 0) 20%);
  pointer-events: none;
  animation: vn-dream-drift 16s ease-in-out infinite alternate;
}

@keyframes vn-dream-drift {
  0% { transform: translate3d(-2%, 1%, 0) scale(1); opacity: 0.8; }
  50% { opacity: 1; }
  100% { transform: translate3d(2.5%, -1.5%, 0) scale(1.06); opacity: 0.85; }
}

/* Mood Grade: Danger Pulse (lub-dub red edge pulse, unobtrusive to dialogue) */
@keyframes vn-danger-pulse {
  0% { opacity: 0.3; }
  10% { opacity: 0.85; }
  20% { opacity: 0.45; }
  30% { opacity: 1; }
  62% { opacity: 0.3; }
  100% { opacity: 0.3; }
}

[data-vn-scene].vn-ambient-danger_pulse [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="danger_pulse"] [data-vn-scene-image] {
  filter: contrast(1.08) saturate(1.08) brightness(0.95);
}

[data-vn-ambient].vn-ambient-danger_pulse {
  background: radial-gradient(ellipse 80% 76% at 50% 46%, rgba(20, 0, 0, 0) 46%, rgba(30, 0, 4, 0.42) 100%);
  opacity: 1;
}

[data-vn-ambient].vn-ambient-danger_pulse::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 78% 74% at 50% 46%, rgba(200, 20, 20, 0) 50%, rgba(210, 22, 30, 0.3) 78%, rgba(235, 24, 36, 0.66) 100%);
  pointer-events: none;
  animation: vn-danger-pulse 1.9s ease-in-out infinite;
}

/* ==========================================================================
   AMBIENT WEATHER & PARTICLES
   Falling particles share one keyframe: --y is the resting row (shown under
   reduced motion), --dx the wind drift, --fd / --dl the seeded timing.
   ========================================================================== */

@keyframes vn-pt-fall {
  from { translate: calc(var(--dx) * -0.5) calc(-6cqh - var(--y) - var(--sz) * 1.5); }
  to { translate: calc(var(--dx) * 0.5) calc(106cqh - var(--y)); }
}

@keyframes vn-pt-sway {
  from { transform: translateX(calc(var(--sw) * -1)); }
  to { transform: translateX(var(--sw)); }
}

@keyframes vn-pt-spin {
  from { rotate: 0deg; }
  to { rotate: 360deg; }
}

/* Rain: tiled multi-depth streak sheets, wet wash, ground splashes */
[data-vn-scene].vn-ambient-rain [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="rain"] [data-vn-scene-image] {
  filter: brightness(0.9) saturate(0.84) contrast(1.04);
}

[data-vn-scene].vn-ambient-heavy_rain [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="heavy_rain"] [data-vn-scene-image] {
  filter: blur(1.2px) brightness(0.8) saturate(0.76) contrast(1.05);
}

[data-vn-ambient] .vn-rain-wash {
  background: linear-gradient(180deg, rgba(12, 20, 36, 0.34) 0%, rgba(20, 32, 52, 0.14) 46%, rgba(70, 92, 124, 0.14) 100%);
}

.vn-ambient-heavy_rain .vn-rain-wash {
  background: linear-gradient(180deg, rgba(8, 14, 28, 0.5) 0%, rgba(18, 28, 48, 0.24) 46%, rgba(80, 100, 132, 0.2) 100%);
}

/* Skewed (not rotated) frame: streaks and their fall direction slant together,
   and the layer only needs extra width, not a 1.5x oversized square. */
[data-vn-ambient] .vn-rain-layer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: calc(-100cqh * var(--slope));
  transform: skewX(calc(var(--tilt) * -1));
  transform-origin: 0 0;
  pointer-events: none;
}

[data-vn-ambient] .vn-rain-layer > i {
  position: absolute;
  display: block;
  left: 0;
  right: 0;
  top: calc(var(--th) * -1);
  bottom: 0;
  background-image: var(--tile);
  background-size: var(--tw) var(--th);
  will-change: transform;
  animation: vn-rain-scroll var(--dur) linear infinite;
}

@keyframes vn-rain-scroll {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(0, var(--th), 0); }
}

.vn-rain-fg, .vn-heavy-rain-fg { opacity: 0.9; }

[data-vn-ambient] .vn-splash {
  width: var(--sz);
  height: calc(var(--sz) * 0.3);
  margin-left: calc(var(--sz) / -2);
  border-radius: 50%;
  border: 1px solid rgba(214, 230, 252, 0.7);
  box-shadow: 0 0 5px rgba(196, 220, 255, 0.3);
  opacity: 0;
  animation: vn-rain-splash var(--dur) ease-out var(--dl) infinite;
}

[data-vn-ambient] .vn-splash::before,
[data-vn-ambient] .vn-splash::after {
  content: "";
  position: absolute;
  bottom: 55%;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: rgba(228, 240, 255, 0.85);
}

[data-vn-ambient] .vn-splash::before { left: 30%; translate: 0 -4px; }
[data-vn-ambient] .vn-splash::after { right: 28%; translate: 0 -6px; }

@keyframes vn-rain-splash {
  0% { transform: scale(0.15); opacity: 0; }
  10% { opacity: 0.9; }
  100% { transform: scale(1.2); opacity: 0; }
}

/* Heavy rain: low storm mist and water beads on the lens */
[data-vn-ambient] .vn-rain-mist {
  position: absolute;
  left: 0;
  bottom: 0;
  width: calc(100% + 896px);
  height: 46%;
  background: ${TEX_FOG_BANK} 0 0 / 896px 100% repeat-x;
  opacity: 0.42;
  pointer-events: none;
  animation: vn-mist-drift 34s linear infinite;
}

@keyframes vn-mist-drift {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(-896px, 0, 0); }
}

[data-vn-ambient] .vn-drop {
  width: var(--sz);
  height: calc(var(--sz) * var(--sq));
  border-radius: 47% 53% 50% 50% / 42% 42% 58% 58%;
  background:
    radial-gradient(ellipse 26% 20% at 36% 28%, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0) 100%),
    radial-gradient(ellipse 58% 34% at 52% 84%, rgba(222, 236, 255, 0.42), rgba(222, 236, 255, 0) 100%),
    radial-gradient(circle at 50% 46%, rgba(150, 175, 210, 0.05) 42%, rgba(6, 12, 24, 0.42) 100%);
  box-shadow: 0 1px 1.5px rgba(0, 0, 0, 0.3);
  opacity: 0.72;
}

[data-vn-ambient] .vn-drop--run {
  animation: vn-drop-run var(--dur) linear var(--dl) infinite;
}

[data-vn-ambient] .vn-drop--run::after {
  content: "";
  position: absolute;
  left: 32%;
  width: 36%;
  bottom: 70%;
  height: calc(var(--sz) * 3);
  border-radius: 50% 50% 40% 40%;
  background: linear-gradient(to bottom, rgba(220, 234, 255, 0), rgba(220, 234, 255, 0.24));
}

@keyframes vn-drop-run {
  0%, 52% { translate: 0 0; opacity: 0.72; animation-timing-function: cubic-bezier(0.55, 0, 0.9, 0.5); }
  90% { translate: 0.4cqw 34cqh; opacity: 0.6; }
  100% { translate: 0.5cqw 42cqh; opacity: 0; }
}

/* Snow: soft far/mid flakes, near bokeh and turning six-point crystals */
[data-vn-scene].vn-ambient-snow [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="snow"] [data-vn-scene-image] {
  filter: saturate(0.82) brightness(1.03) contrast(0.96);
}

[data-vn-ambient] .vn-snow-chill {
  background: linear-gradient(180deg, rgba(186, 212, 244, 0.12) 0%, rgba(206, 224, 248, 0.04) 55%, rgba(234, 242, 255, 0.16) 100%);
}

[data-vn-ambient] .vn-flake {
  top: var(--y);
  width: var(--sz);
  height: var(--sz);
  margin-left: calc(var(--sz) / -2);
  border-radius: 50%;
  background: radial-gradient(circle, #ffffff 0 40%, rgba(240, 247, 255, 0.55) 60%, rgba(240, 247, 255, 0) 76%);
  opacity: var(--o);
  animation:
    vn-pt-fall var(--fd) linear var(--dl) infinite,
    vn-pt-sway var(--sd) ease-in-out var(--sdl) infinite alternate;
}

[data-vn-ambient] .vn-flake--far {
  background: #f4f9ff;
  box-shadow: 0 0 3px 1px rgba(236, 244, 255, 0.55);
  animation: vn-pt-fall var(--fd) linear var(--dl) infinite;
}

[data-vn-ambient] .vn-flake--bokeh {
  background: radial-gradient(circle, rgba(255, 255, 255, 0.62) 0%, rgba(240, 247, 255, 0.42) 38%, rgba(240, 247, 255, 0) 70%);
}

[data-vn-ambient] .vn-flake--crystal {
  border-radius: 0;
  background: ${SHAPE_FLAKE} center / contain no-repeat;
  animation:
    vn-pt-fall var(--fd) linear var(--dl) infinite,
    vn-pt-sway var(--sd) ease-in-out var(--sdl) infinite alternate,
    vn-pt-spin var(--rd) linear var(--dl) infinite;
}

/* Sakura: notched petals that fall on the wind and tumble in 3D */
[data-vn-ambient] .vn-sakura-light {
  background:
    radial-gradient(ellipse 70% 60% at 12% 0%, rgba(255, 206, 220, 0.2), rgba(255, 206, 220, 0) 70%),
    linear-gradient(180deg, rgba(255, 226, 236, 0.06), rgba(255, 210, 226, 0.08));
  mix-blend-mode: screen;
}

[data-vn-ambient] .vn-petal {
  top: var(--y);
  width: var(--sz);
  height: calc(var(--sz) * 1.2);
  margin-left: calc(var(--sz) / -2);
  background: ${SHAPE_PETAL_A} center / contain no-repeat;
  opacity: var(--o);
  animation:
    vn-pt-fall var(--fd) linear var(--dl) infinite,
    vn-pt-sway var(--sd) ease-in-out var(--sdl) infinite alternate,
    vn-petal-tumble var(--rd) linear var(--dl) infinite;
}

[data-vn-ambient] .vn-petal--b { background-image: ${SHAPE_PETAL_B}; }
[data-vn-ambient] .vn-petal--c { background-image: ${SHAPE_PETAL_C}; }
[data-vn-ambient] .vn-petal--far { background-image: ${SHAPE_PETAL_SOFT}; }

@keyframes vn-petal-tumble {
  from { rotate: var(--ax) var(--r0); }
  to { rotate: var(--ax) calc(var(--r0) + 360deg); }
}

/* Fireflies: wandering glows with an irregular slow blink, at three depths */
[data-vn-scene].vn-ambient-fireflies [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="fireflies"] [data-vn-scene-image] {
  filter: brightness(0.84) saturate(0.92) contrast(1.04);
}

[data-vn-ambient] .vn-firefly-haze {
  background:
    radial-gradient(ellipse 90% 55% at 50% 100%, rgba(160, 214, 96, 0.14), rgba(160, 214, 96, 0) 70%),
    linear-gradient(180deg, rgba(10, 18, 40, 0.24), rgba(10, 18, 40, 0) 60%);
}

[data-vn-ambient] .vn-firefly {
  width: var(--sz);
  height: var(--sz);
  margin: calc(var(--sz) / -2) 0 0 calc(var(--sz) / -2);
  border-radius: 50%;
  background: radial-gradient(circle, #fbffe2 0 8%, rgba(232, 255, 150, 0.95) 15%, rgba(200, 255, 96, 0.42) 32%, rgba(176, 240, 84, 0.12) 52%, rgba(176, 240, 84, 0) 70%);
  opacity: 0.5;
  animation:
    vn-firefly-wander var(--wd) ease-in-out var(--dl) infinite,
    vn-firefly-blink var(--bd) ease-in-out var(--bdl) infinite;
}

[data-vn-ambient] .vn-firefly--far {
  background: radial-gradient(circle, #f6ffd0 0 12%, rgba(214, 255, 120, 0.6) 26%, rgba(190, 250, 90, 0) 66%);
}

[data-vn-ambient] .vn-firefly--near {
  background: radial-gradient(circle, rgba(246, 255, 200, 0.62) 0%, rgba(214, 255, 120, 0.36) 28%, rgba(190, 250, 90, 0.1) 50%, rgba(190, 250, 90, 0) 68%);
}

@keyframes vn-firefly-wander {
  0%, 100% { translate: 0 0; }
  25% { translate: var(--p1); }
  50% { translate: var(--p2); }
  75% { translate: var(--p3); }
}

@keyframes vn-firefly-blink {
  0%, 100% { opacity: 0.28; scale: 0.74; }
  36% { opacity: 0.36; scale: 0.82; }
  50% { opacity: 1; scale: 1.06; }
  62% { opacity: 0.9; scale: 1; }
  80% { opacity: 0.34; scale: 0.8; }
}

/* Embers: rising sparks with glow, flicker and wobble over a heat glow */
[data-vn-scene].vn-ambient-embers [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="embers"] [data-vn-scene-image] {
  filter: saturate(1.08) contrast(1.06) sepia(0.12);
}

[data-vn-ambient] .vn-ember-glow {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 80%;
  background: radial-gradient(ellipse 90% 80% at 50% 100%, rgba(255, 120, 40, 0.34) 0%, rgba(255, 90, 30, 0.12) 48%, rgba(255, 80, 20, 0) 78%);
  pointer-events: none;
  animation: vn-ember-heat 2.8s ease-in-out infinite alternate;
}

@keyframes vn-ember-heat {
  from { opacity: 0.62; }
  to { opacity: 1; }
}

[data-vn-ambient] .vn-ember {
  top: var(--y);
  width: var(--sz);
  height: var(--sz);
  margin-left: calc(var(--sz) / -2);
  border-radius: 50%;
  background: radial-gradient(circle, #fff8e0 0 16%, #ffcb66 30%, rgba(255, 118, 36, 0.82) 48%, rgba(255, 70, 20, 0) 72%);
  opacity: 0.9;
  animation:
    vn-ember-rise var(--fd) linear var(--dl) infinite,
    vn-ember-life var(--fd) linear var(--dl) infinite,
    vn-ember-wobble var(--sd) ease-in-out var(--dl) infinite alternate,
    vn-ember-flicker var(--fl) ease-in-out infinite alternate;
}

[data-vn-ambient] .vn-ember--streak {
  width: calc(var(--sz) * 0.6);
  height: calc(var(--sz) * 3.2);
  border-radius: 50% / 22%;
  background: radial-gradient(ellipse 50% 22% at 50% 18%, #fff4d0 0 30%, rgba(255, 196, 92, 0.9) 60%, rgba(255, 140, 40, 0) 100%),
    linear-gradient(to bottom, rgba(255, 150, 50, 0.85), rgba(255, 90, 20, 0));
}

[data-vn-ambient] .vn-ember--far {
  background: radial-gradient(circle, #ffe2a8 0 20%, rgba(255, 130, 40, 0.7) 44%, rgba(255, 90, 20, 0) 72%);
}

[data-vn-ambient] .vn-ember--bokeh {
  background: radial-gradient(circle, rgba(255, 196, 110, 0.55) 0%, rgba(255, 140, 56, 0.3) 40%, rgba(255, 110, 40, 0) 70%);
}

@keyframes vn-ember-rise {
  from { translate: calc(var(--dx) * -0.3) calc(104cqh - var(--y)); }
  to { translate: var(--dx) calc(-8cqh - var(--y)); }
}

@keyframes vn-ember-life {
  0% { opacity: 0; }
  8% { opacity: 1; }
  62% { opacity: 0.88; }
  100% { opacity: 0; }
}

@keyframes vn-ember-wobble {
  from { transform: translateX(calc(var(--sw) * -1)) rotate(-10deg); }
  to { transform: translateX(var(--sw)) rotate(10deg); }
}

@keyframes vn-ember-flicker {
  from { scale: 0.7; }
  to { scale: 1.08; }
}

/* Fog: three seamless noise banks drifting at different speeds, denser low */
[data-vn-scene].vn-ambient-fog [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="fog"] [data-vn-scene-image] {
  filter: contrast(0.88) saturate(0.8) brightness(1.02);
}

[data-vn-ambient] .vn-fog-wash {
  background: linear-gradient(180deg, rgba(222, 232, 244, 0.1) 0%, rgba(216, 228, 242, 0.2) 52%, rgba(228, 236, 246, 0.42) 100%);
}

[data-vn-ambient] .vn-fog-layer {
  position: absolute;
  left: 0;
  right: 0;
  overflow: hidden;
  pointer-events: none;
  animation: vn-fog-breathe var(--bd, 13s) ease-in-out infinite alternate;
}

[data-vn-ambient] .vn-fog-layer > i {
  position: absolute;
  display: block;
  top: 0;
  bottom: 0;
  left: 0;
  width: calc(100% + var(--fw));
  background-size: var(--fw) 100%;
  background-repeat: repeat-x;
  will-change: transform;
  animation: vn-fog-drift var(--fd) linear infinite;
}

@keyframes vn-fog-drift {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(calc(var(--fw) * -1), 0, 0); }
}

@keyframes vn-fog-breathe {
  from { opacity: var(--o0); }
  to { opacity: var(--o1); }
}

.vn-fog-layer-1 {
  top: 0;
  height: 78%;
  --fw: 1024px;
  --fd: 120s;
  --bd: 14s;
  --o0: 0.36;
  --o1: 0.58;
}

.vn-fog-layer-1 > i { background-image: ${TEX_FOG_FAR}; }

.vn-fog-layer-2 {
  top: 26%;
  height: 74%;
  --fw: 896px;
  --fd: 84s;
  --bd: 17s;
  --o0: 0.38;
  --o1: 0.62;
}

.vn-fog-layer-2 > i {
  background-image: ${TEX_FOG_MID};
  animation-direction: reverse;
}

.vn-fog-layer-3 {
  bottom: 0;
  height: 54%;
  --fw: 1280px;
  --fd: 58s;
  --bd: 11s;
  --o0: 0.72;
  --o1: 0.95;
}

.vn-fog-layer-3 > i { background-image: ${TEX_FOG_NEAR}; }

/* ==========================================================================
   SPRITE MODE DEPTH (front ambient, grades over sprites, lightning, parallax)
   Scoped to [data-vn-presentation="sprites"] and to the sprite-mode-only
   layers ([data-vn-ambient-front], [data-vn-plate-light]), so scene mode
   renders exactly as before. Layer depth for camera moves: plate 1x,
   sprites 1 + --vn-depth-sprites, front 1 + --vn-depth-front
   (SPRITE_DEPTH in stage/sprite-depth.ts).
   ========================================================================== */

[data-vn-root][data-vn-presentation="sprites"] {
  --vn-depth-sprites: 0.15;
  --vn-depth-front: 0.4;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-sprites] {
  --vn-depth: var(--vn-depth-sprites, 0.15);
  transform-origin: 50% 50%;
  transition: filter 600ms ease, scale 2s ease;
}

/* Front ambient: a sparse, larger, faster copy of the weather in front of
   the sprites (z 4) and still inside the scene, so below the dialogue. */
[data-vn-ambient][data-vn-ambient-front] {
  z-index: 5;
  --vn-depth: var(--vn-depth-front, 0.4);
  transform-origin: 50% 50%;
  transition: scale 2s ease;
}

[data-vn-ambient-front] .vn-front-sheet { opacity: 1; }
[data-vn-ambient-front] .vn-fireflies-front { opacity: 0.55; }
[data-vn-ambient-front] .vn-embers-front { opacity: 0.7; }
[data-vn-ambient-front] .vn-snow-front { opacity: 0.9; }

[data-vn-ambient-front] .vn-fog-front {
  height: 30%;
  --fw: 1280px;
  --fd: 32s;
  --bd: 9s;
  --o0: 0.26;
  --o1: 0.44;
}

/* "gentle" halves the front layer too (.vn-pt thinning applies already). */
[data-vn-effect-intensity="gentle"] [data-vn-ambient-front] .vn-rain-layer > i {
  background-image: var(--tile-gentle, var(--tile));
}

[data-vn-effect-intensity="gentle"] [data-vn-ambient-front] .vn-fog-front {
  --o0: 0.13;
  --o1: 0.22;
}

@media (prefers-reduced-motion: no-preference) {
  /* The wet lens is on the camera glass: in sprite mode it is drawn by the front layer. */
  [data-vn-root][data-vn-presentation="sprites"] [data-vn-ambient]:not([data-vn-ambient-front]) .vn-rain-lens {
    display: none;
  }
}

/* Mood grades cover the plate and the characters alike (never the dialogue). */
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-scene-ambient="vignette_dark"] > [data-vn-ambient]:not([data-vn-ambient-front]),
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-scene-ambient="sepia_flashback"] > [data-vn-ambient]:not([data-vn-ambient-front]),
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-scene-ambient="desaturate"] > [data-vn-ambient]:not([data-vn-ambient-front]),
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-scene-ambient="dream_haze"] > [data-vn-ambient]:not([data-vn-ambient-front]),
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-scene-ambient="danger_pulse"] > [data-vn-ambient]:not([data-vn-ambient-front]) {
  z-index: 5;
}

/* Lightning: the bolt and the sky light sit behind the characters; the full
   screen flash is softer so the rim-lit silhouettes read (sprite-css.ts). */
[data-vn-plate-light] {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  pointer-events: none;
  container-type: size;
}

[data-vn-plate-light]::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 120% 95% at 66% 0%, rgba(240, 245, 255, 0.95) 0%, rgba(196, 214, 255, 0.6) 42%, rgba(150, 176, 236, 0.22) 78%, rgba(150, 176, 236, 0) 100%);
  mix-blend-mode: screen;
  opacity: 0;
  pointer-events: none;
}

[data-vn-scene][data-vn-lightning] [data-vn-plate-light]::before {
  animation: vn-plate-lightning 550ms linear both;
}

[data-vn-plate-light] svg {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

[data-vn-plate-light] .vn-bolt > b {
  position: absolute;
  display: block;
  pointer-events: none;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-flash][data-vn-flash="lightning"] {
  animation: vn-lightning-soft 550ms linear forwards;
}

@keyframes vn-plate-lightning {
  0% { opacity: 0; }
  3% { opacity: 1; }
  9% { opacity: 0.18; }
  17% { opacity: 0.06; }
  21% { opacity: 0.88; }
  30% { opacity: 0.3; }
  52% { opacity: 0.1; }
  100% { opacity: 0; }
}

@keyframes vn-lightning-soft {
  0% { opacity: 0; }
  3% { opacity: 0.3; }
  9% { opacity: 0.03; }
  17% { opacity: 0; }
  21% { opacity: 0.22; }
  28% { opacity: 0.04; }
  100% { opacity: 0; }
}

/* ---- Parallax --------------------------------------------------------------
   Plate-only camera moves (zoom in / out / punch, tilt) scale the sprites and
   the front layer by (1 + depth) times the plate's amount; scene-level moves
   (shakes, rumble, heartbeat) already carry them 1x, so they add depth x. */

@media (prefers-reduced-motion: no-preference) {
  [data-vn-root][data-vn-presentation="sprites"] [data-vn-scene-image] {
    /* Base CSS drops the 2s zoom transition when motion is allowed; keep it
       here so the plate and the sprites push in together. */
    transition: opacity var(--vn-transition-duration, 280ms) ease, transform 2s ease;
  }
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-zoom="in"] [data-vn-sprites],
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-zoom="in"] [data-vn-ambient-front] {
  scale: calc(1 + 0.12 * (1 + var(--vn-depth)));
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-zoom="out"] [data-vn-sprites],
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-zoom="out"] [data-vn-ambient-front] {
  animation: vn-depth-zoom-pull 1.6s cubic-bezier(0.22, 0.68, 0.18, 1) both;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-zoom="punch"] [data-vn-sprites],
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-zoom="punch"] [data-vn-ambient-front] {
  animation: vn-depth-zoom-punch 450ms linear both;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-tilt="true"] [data-vn-sprites],
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-tilt="true"] [data-vn-ambient-front] {
  animation: vn-depth-tilt 700ms linear both;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-heartbeat] [data-vn-sprites],
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-heartbeat] [data-vn-ambient-front] {
  animation: vn-depth-heartbeat 850ms cubic-bezier(0.3, 0.2, 0.3, 1) both;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-shake="true"] [data-vn-sprites],
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-shake="true"] [data-vn-ambient-front] {
  animation: vn-depth-shake 300ms cubic-bezier(0.33, 0, 0.3, 1) both;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-shake="hard"] [data-vn-sprites],
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-shake="hard"] [data-vn-ambient-front] {
  animation: vn-depth-shake-hard 500ms cubic-bezier(0.25, 0.1, 0.25, 1) both;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-shake="rumble"] [data-vn-sprites],
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-shake="rumble"] [data-vn-ambient-front] {
  animation: vn-depth-rumble 800ms linear both;
}

@keyframes vn-depth-zoom-pull {
  0% { scale: calc(1 + 0.14 * (1 + var(--vn-depth))); }
  100% { scale: 1; }
}

@keyframes vn-depth-zoom-punch {
  0% { scale: 1; animation-timing-function: cubic-bezier(0.2, 0.9, 0.3, 1); }
  16% { scale: calc(1 + 0.17 * (1 + var(--vn-depth))); animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1); }
  42% { scale: calc(1 - 0.015 * (1 + var(--vn-depth))); animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1); }
  66% { scale: calc(1 + 0.012 * (1 + var(--vn-depth))); animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1); }
  100% { scale: 1; }
}

@keyframes vn-depth-tilt {
  0% { rotate: 0deg; scale: 1; animation-timing-function: cubic-bezier(0.3, 0, 0.2, 1); }
  32% { rotate: calc(2.2deg * (1 + var(--vn-depth))); scale: calc(1 + 0.095 * (1 + var(--vn-depth))); animation-timing-function: linear; }
  68% { rotate: calc(2.4deg * (1 + var(--vn-depth))); scale: calc(1 + 0.1 * (1 + var(--vn-depth))); animation-timing-function: cubic-bezier(0.5, 0, 0.3, 1); }
  100% { rotate: 0deg; scale: 1; }
}

@keyframes vn-depth-heartbeat {
  0% { scale: 1; }
  12% { scale: calc(1 + 0.04 * var(--vn-depth)); }
  24% { scale: calc(1 + 0.005 * var(--vn-depth)); }
  36% { scale: calc(1 + 0.06 * var(--vn-depth)); }
  62% { scale: 1; }
  100% { scale: 1; }
}

@keyframes vn-depth-shake {
  0%, 100% { translate: 0 0; }
  12% { translate: calc(-5px * var(--vn-depth)) calc(3px * var(--vn-depth)); }
  28% { translate: calc(5px * var(--vn-depth)) calc(-3px * var(--vn-depth)); }
  46% { translate: calc(-3px * var(--vn-depth)) calc(-2px * var(--vn-depth)); }
  66% { translate: calc(2px * var(--vn-depth)) calc(1px * var(--vn-depth)); }
  84% { translate: calc(-1px * var(--vn-depth)) 0; }
}

@keyframes vn-depth-shake-hard {
  0%, 100% { translate: 0 0; }
  8% { translate: calc(-14px * var(--vn-depth)) calc(9px * var(--vn-depth)); }
  18% { translate: calc(15px * var(--vn-depth)) calc(-10px * var(--vn-depth)); }
  30% { translate: calc(-12px * var(--vn-depth)) calc(-7px * var(--vn-depth)); }
  44% { translate: calc(9px * var(--vn-depth)) calc(7px * var(--vn-depth)); }
  58% { translate: calc(-6px * var(--vn-depth)) calc(3px * var(--vn-depth)); }
  72% { translate: calc(4px * var(--vn-depth)) calc(-2px * var(--vn-depth)); }
  86% { translate: calc(-2px * var(--vn-depth)) calc(1px * var(--vn-depth)); }
}

@keyframes vn-depth-rumble {
  0%, 100% { translate: 0 0; }
  6% { translate: calc(-1.5px * var(--vn-depth)) calc(1px * var(--vn-depth)); }
  12% { translate: calc(2px * var(--vn-depth)) calc(-1.5px * var(--vn-depth)); }
  18% { translate: calc(-3px * var(--vn-depth)) calc(-1px * var(--vn-depth)); }
  24% { translate: calc(3px * var(--vn-depth)) calc(2px * var(--vn-depth)); }
  30% { translate: calc(-3.5px * var(--vn-depth)) calc(1px * var(--vn-depth)); }
  36% { translate: calc(3px * var(--vn-depth)) calc(-2px * var(--vn-depth)); }
  42% { translate: calc(-3.5px * var(--vn-depth)) calc(-1.5px * var(--vn-depth)); }
  48% { translate: calc(3.5px * var(--vn-depth)) calc(1.5px * var(--vn-depth)); }
  54% { translate: calc(-3px * var(--vn-depth)) calc(2px * var(--vn-depth)); }
  60% { translate: calc(3px * var(--vn-depth)) calc(-1.5px * var(--vn-depth)); }
  66% { translate: calc(-2.5px * var(--vn-depth)) calc(1px * var(--vn-depth)); }
  72% { translate: calc(2.5px * var(--vn-depth)) calc(-1px * var(--vn-depth)); }
  78% { translate: calc(-2px * var(--vn-depth)) calc(-1px * var(--vn-depth)); }
  84% { translate: calc(1.5px * var(--vn-depth)) calc(1px * var(--vn-depth)); }
  90% { translate: calc(-1px * var(--vn-depth)) calc(0.5px * var(--vn-depth)); }
  95% { translate: calc(0.5px * var(--vn-depth)) calc(-0.5px * var(--vn-depth)); }
}

/* ---- Idle plate drift ------------------------------------------------------
   A few pixels over many seconds, on the independent translate property; the
   tiny overscale keeps the edges covered. Every plate camera animation lists
   the drift first so it keeps running through zooms, tilts and blur pulses. */

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene-image] {
  --vn-plate-drift: vn-plate-drift 34s ease-in-out -8.5s infinite alternate;
  scale: 1.012;
  animation: var(--vn-plate-drift);
}

[data-vn-root][data-vn-presentation="sprites"][data-vn-effect-intensity="off"] [data-vn-scene-image],
[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene]:has(> [data-vn-sprites][data-vn-sprite-illustrated]) [data-vn-scene-image] {
  /* A key-moment illustration is one flat picture: no drift (camera effects
     move it like a scene-mode image). */
  --vn-plate-drift: none;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-zoom="out"] [data-vn-scene-image] {
  animation: var(--vn-plate-drift), vn-zoom-pull 1.6s cubic-bezier(0.22, 0.68, 0.18, 1) both;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-zoom="punch"] [data-vn-scene-image] {
  animation: var(--vn-plate-drift), vn-zoom-punch 450ms linear both;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-tilt="true"] [data-vn-scene-image] {
  animation: var(--vn-plate-drift), vn-tilt 700ms linear both;
}

[data-vn-root][data-vn-presentation="sprites"] [data-vn-scene][data-vn-blur] [data-vn-scene-image] {
  animation: var(--vn-plate-drift), vn-blur-pulse 650ms cubic-bezier(0.3, 0, 0.2, 1) both;
}

@keyframes vn-plate-drift {
  0% { translate: -0.45% 0.2%; }
  100% { translate: 0.45% -0.2%; }
}

/* Reduced motion: no drift, no parallax, no front particles, no lightning
   light; only the static grades stay. */
@media (prefers-reduced-motion: reduce) {
  [data-vn-root][data-vn-presentation="sprites"] [data-vn-scene-image] {
    --vn-plate-drift: none;
  }

  [data-vn-root][data-vn-presentation="sprites"] [data-vn-sprites],
  [data-vn-ambient][data-vn-ambient-front] {
    animation: none !important;
    scale: none !important;
    translate: none !important;
    rotate: none !important;
  }

  [data-vn-ambient][data-vn-ambient-front],
  [data-vn-plate-light] {
    display: none !important;
  }
}

/* ==========================================================================
   EFFECT INTENSITY: "gentle" halves particle density and drops near layers
   ========================================================================== */

[data-vn-effect-intensity="gentle"] [data-vn-ambient] .vn-pt:nth-child(2n),
[data-vn-effect-intensity="gentle"] [data-vn-fx] .vn-pt:nth-child(3n),
[data-vn-effect-intensity="gentle"] [data-vn-ambient] .vn-rain-fg,
[data-vn-effect-intensity="gentle"] [data-vn-ambient] .vn-heavy-rain-fg {
  display: none;
}

[data-vn-effect-intensity="gentle"] [data-vn-ambient]::after {
  animation: none;
}

/* ==========================================================================
   PREFERS-REDUCED-MOTION OVERRIDES
   Static grade only: particles freeze at their seeded resting positions,
   transient elements (splashes, runs, flicker, bolt) are hidden.
   ========================================================================== */

@media (prefers-reduced-motion: reduce) {
  /* Suppress camera motion, shakes, punches, tilts, and rapid particle motion */
  .vn-shake-hard,
  .vn-rumble,
  .vn-heartbeat,
  [data-vn-shake="hard"],
  [data-vn-shake="rumble"],
  [data-vn-heartbeat],
  .vn-zoom-punch,
  .vn-tilt,
  [data-vn-zoom="punch"],
  [data-vn-tilt],
  .vn-blur-pulse,
  [data-vn-blur] {
    animation: none !important;
    transform: none !important;
    filter: none !important;
  }

  [data-vn-scene-image].vn-zoom-out,
  [data-vn-scene-image][data-vn-zoom="out"],
  [data-vn-scene][data-vn-zoom="out"] [data-vn-scene-image],
  [data-vn-root][data-vn-zoom="out"] [data-vn-scene-image] {
    animation: none !important;
  }

  [data-vn-ambient] *,
  [data-vn-ambient] *::before,
  [data-vn-ambient] *::after,
  [data-vn-ambient]::before,
  [data-vn-ambient]::after,
  [data-vn-fx] *,
  .vn-rain-bg, .vn-rain-mg, .vn-rain-fg,
  .vn-heavy-rain-bg, .vn-heavy-rain-mg, .vn-heavy-rain-fg,
  .vn-snow-bg, .vn-snow-mg, .vn-snow-fg,
  .vn-sakura-bg, .vn-sakura-mg, .vn-sakura-fg, .vn-petal,
  .vn-firefly, .vn-ember,
  .vn-fog-layer-1, .vn-fog-layer-2, .vn-fog-layer-3 {
    animation: none !important;
  }

  [data-vn-ambient] .vn-splash,
  [data-vn-ambient] .vn-drop--run::after,
  [data-vn-fx] .vn-bolt,
  [data-vn-fx] .vn-burst-ring {
    display: none !important;
  }

  [data-vn-ambient] .vn-fog-layer { opacity: var(--o1); }
  [data-vn-ambient] .vn-firefly { opacity: 0.7; }

  /* Bursts: particles rest at their destinations; only the frame fades. */
  [data-vn-fx] .vn-burst .vn-pt {
    opacity: 1;
    translate: var(--tx, 0) var(--ty, 0);
  }

  [data-vn-fx] .vn-burst .vn-confetti-piece {
    translate: 0 calc(var(--ty) * 0.45);
    rotate: var(--ax) 35deg;
  }

  [data-vn-fx][data-vn-effect] {
    animation: vn-fx-still-fade var(--vn-fx-still, 800ms) linear both !important;
  }

  [data-vn-ambient].vn-ambient-danger_pulse::before {
    animation: none !important;
    opacity: 0.6 !important;
  }
}

[data-vn-fx][data-vn-effect="speed_lines"] { --vn-fx-still: 650ms; }
[data-vn-fx][data-vn-effect="sparkle_burst"] { --vn-fx-still: 850ms; }
[data-vn-fx][data-vn-effect="hearts_burst"] { --vn-fx-still: 950ms; }
[data-vn-fx][data-vn-effect="confetti"] { --vn-fx-still: 1200ms; }
[data-vn-fx][data-vn-effect="lightning"] { --vn-fx-still: 550ms; }

@keyframes vn-fx-still-fade {
  0% { opacity: 0; }
  15% { opacity: 1; }
  75% { opacity: 1; }
  100% { opacity: 0; }
}
`;
