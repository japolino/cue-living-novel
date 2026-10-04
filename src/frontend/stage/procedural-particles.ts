import type { AmbientEffect, StageEffect } from "../store";
import { svgDataUri } from "../theme/effects-css";

/**
 * Procedural stage particles (ambient weather + one-shot bursts).
 *
 * Markup is plain HTML (`<i>` / `<b>` nodes) styled by VN_EFFECTS_CSS. Every
 * particle carries its seeded placement and timing as inline custom
 * properties; the stylesheet turns those into compositor-only animations on
 * the independent `translate` / `rotate` / `scale` / `transform` / `opacity`
 * properties, so one node can fall, sway and tumble at the same time.
 * Overlays are size containers, so `cqw` / `cqh` / `cqmin` units keep fields
 * aspect-correct at 1280x720 and 390x844 alike. Rain uses a few scrolling
 * tiles (seeded SVG textures) instead of hundreds of nodes.
 *
 * Node budget at "full" (asserted by tests): every ambient stays under ~120
 * nodes; "gentle" hides every other `.vn-pt` particle via CSS. In sprite mode
 * particle ambients also get a sparse front copy (generateFrontAmbientMarkup).
 */

/**
 * Deterministic pseudo-random helper based on an integer avalanche hash.
 * A plain linear-congruential progression correlates across sequential
 * indices and visibly arranges particles into diagonal lattice lines, so the
 * seed/index pair is avalanched first. Deterministic across platforms, which
 * keeps tests stable and markup byte-identical.
 */
function pseudo(seed: number, index: number, min: number, max: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  // `^` yields a signed 32-bit int; force unsigned so v stays inside [0, 1].
  h = (h ^ (h >>> 16)) >>> 0;
  const v = h / 0xffffffff;
  return min + v * (max - min);
}

/**
 * Stratified horizontal placement: particle `index` of `count` lands inside
 * its own even slice of [min, max] with hash jitter. Random sampling alone
 * visibly clumps at these particle counts; stratification guarantees the
 * whole width is covered while still looking organic.
 */
function strat(seed: number, index: number, count: number, min: number, max: number): number {
  const jitter = pseudo(seed, index, 0.06, 0.94);
  return min + ((index + jitter) / count) * (max - min);
}

/** Fixed-precision number formatting (keeps markup compact and stable). */
function n(value: number, digits = 1): string {
  return Number(value.toFixed(digits)).toString();
}

/** Inline style from custom-property pairs. */
function vars(entries: Record<string, string>): string {
  return Object.entries(entries).map(([k, v]) => `${k}:${v}`).join(";");
}

export function generateAmbientMarkup(effect: AmbientEffect): string {
  switch (effect) {
    case "rain":
      return generateRainMarkup(false);
    case "heavy_rain":
      return generateRainMarkup(true);
    case "snow":
      return generateSnowMarkup();
    case "sakura":
      return generateSakuraMarkup();
    case "fog":
      return generateFogMarkup();
    case "fireflies":
      return generateFirefliesMarkup();
    case "embers":
      return generateEmbersMarkup();
    case "vignette_dark":
    case "sepia_flashback":
    case "desaturate":
    case "dream_haze":
    case "danger_pulse":
      // Mood grades are pure CSS: scene-image filters plus the overlay's own
      // background and ::before / ::after layers (grain, bloom, edge pulse).
      return "";
  }
}

export function generateCueEffectMarkup(effect: StageEffect): string {
  switch (effect) {
    case "speed_lines":
      return generateSpeedLinesMarkup();
    case "sparkle_burst":
      return generateSparkleBurstMarkup();
    case "hearts_burst":
      return generateHeartsBurstMarkup();
    case "confetti":
      return generateConfettiMarkup();
    case "lightning":
      return generateLightningMarkup();
    default:
      return "";
  }
}

/* -------------------------------------------------------------------------- */
/* Rain                                                                        */
/* -------------------------------------------------------------------------- */

interface StreakGroup {
  count: number;
  len: [number, number];
  width: number;
  alpha: [number, number];
  color: string;
}

interface RainLayerSpec {
  cls: string;
  seed: number;
  /** Tile size in CSS px (density stays constant at any stage size). */
  w: number;
  h: number;
  /** Fall speed in px per second. */
  speed: number;
  /** Pre-baked softness (stdDeviation) for near, out-of-focus streaks. */
  blur?: number;
  groups: StreakGroup[];
}

/**
 * One seamless rain texture: seeded streaks that fade in from the tail and
 * brighten toward the leading drop. Streaks crossing the bottom edge are
 * wrapped to the top so a vertical scroll by one tile height is seamless.
 * A tile can carry several depth groups (thin far streaks + longer mid ones)
 * so the field keeps its depth with only two scrolling layers.
 */
function rainTile(spec: RainLayerSpec): string {
  const rects: string[] = [];
  const gradients: string[] = [];
  spec.groups.forEach((group, g) => {
    const seed = spec.seed + g * 10;
    gradients.push(`<linearGradient id="g${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${group.color}" stop-opacity="0"/><stop offset=".7" stop-color="${group.color}" stop-opacity=".55"/><stop offset="1" stop-color="${group.color}" stop-opacity="1"/></linearGradient>`);
    for (let i = 0; i < group.count; i++) {
      const x = strat(seed, i, group.count, group.width, spec.w - group.width);
      const y = pseudo(seed + 1, i, 0, spec.h);
      const len = pseudo(seed + 2, i, group.len[0], group.len[1]);
      const alpha = pseudo(seed + 3, i, group.alpha[0], group.alpha[1]);
      const rect = (top: number) =>
        `<rect x="${n(x - group.width / 2)}" y="${n(top)}" width="${n(group.width, 2)}" height="${n(len)}" rx="${n(group.width / 2, 2)}" fill="url(#g${g})" opacity="${n(alpha, 2)}"/>`;
      rects.push(rect(y));
      if (y + len > spec.h) rects.push(rect(y - spec.h));
    }
  });
  const filter = spec.blur ? `<filter id="b" x="-50%" y="-5%" width="200%" height="110%"><feGaussianBlur stdDeviation="${spec.blur}"/></filter>` : "";
  const body = spec.blur ? `<g filter="url(#b)">${rects.join("")}</g>` : rects.join("");
  return svgDataUri(`<defs>${gradients.join("")}${filter}</defs>${body}`, spec.w, spec.h);
}

function rainLayer(spec: RainLayerSpec, tilt: number): string {
  const style = vars({
    "--tile": rainTile(spec),
    "--tw": `${spec.w}px`,
    "--th": `${spec.h}px`,
    "--dur": `${n(spec.h / spec.speed, 3)}s`,
    "--tilt": `${tilt}deg`,
    "--slope": n(Math.tan((tilt * Math.PI) / 180), 3),
  });
  return `<div class="vn-rain-layer ${spec.cls}" style="${style}"><i></i></div>`;
}

function generateRainMarkup(heavy: boolean): string {
  const prefix = heavy ? "vn-heavy-rain" : "vn-rain";
  const tilt = heavy ? 13 : 8;
  // Two scrolling sheets keep compositing cheap: a back sheet (fine far
  // streaks + mid streaks) and a fast, soft, out-of-focus front sheet.
  const layers: RainLayerSpec[] = [
    {
      cls: `${prefix}-bg`, seed: heavy ? 201 : 101, w: 280, h: 400, speed: heavy ? 1500 : 1150,
      groups: [
        { count: heavy ? 40 : 24, len: [12, 26], width: 1, alpha: [0.22, 0.42], color: "#b4c8e2" },
        { count: heavy ? 22 : 13, len: [30, 54], width: 1.4, alpha: [0.38, 0.62], color: "#c9dbf2" },
      ],
    },
    {
      cls: `${prefix}-fg`, seed: heavy ? 221 : 121, w: 430, h: 520, speed: heavy ? 2700 : 2200, blur: 0.7,
      groups: [{ count: heavy ? 9 : 6, len: [70, 130], width: 2.4, alpha: [0.42, 0.66], color: "#e6f0ff" }],
    },
  ];


  const splashCount = heavy ? 22 : 14;
  const splashes: string[] = [];
  for (let i = 0; i < splashCount; i++) {
    const dur = pseudo(305, i, 0.55, 0.95);
    splashes.push(`<i class="vn-pt vn-splash" style="${vars({
      left: `${n(strat(301, i, splashCount, 2, 98))}%`,
      top: `${n(pseudo(302, i, 74, 97))}%`,
      "--sz": `${n(pseudo(303, i, 10, heavy ? 26 : 20))}px`,
      "--dur": `${n(dur, 2)}s`,
      "--dl": `${n(-pseudo(304, i, 0, dur), 2)}s`,
    })}"></i>`);
  }

  let lens = "";
  if (heavy) {
    // Wet lens: water beads on the camera glass. A few grow heavy and run.
    const dropCount = 12;
    const drops: string[] = [];
    for (let i = 0; i < dropCount; i++) {
      const run = i % 4 === 1;
      const dur = pseudo(315, i, 9, 15);
      drops.push(`<i class="vn-pt vn-drop${run ? " vn-drop--run" : ""}" style="${vars({
        left: `${n(strat(311, i, dropCount, 3, 95))}%`,
        top: `${n(pseudo(312, i, run ? 4 : 6, run ? 40 : 82))}%`,
        "--sz": `${n(pseudo(313, i, 9, 24))}px`,
        "--sq": n(pseudo(314, i, 0.9, 1.2), 2),
        "--dur": `${n(dur, 2)}s`,
        "--dl": `${n(-pseudo(316, i, 0, dur), 2)}s`,
      })}"></i>`);
    }
    lens = `<div class="vn-rain-mist"></div><div class="vn-rain-lens" data-vn-lens-droplets>${drops.join("")}</div>`;
  }

  return `<div class="vn-rain-wash"></div>${layers.map((layer) => rainLayer(layer, tilt)).join("")}<div class="vn-rain-splashes">${splashes.join("")}</div>${lens}`;
}

/* -------------------------------------------------------------------------- */
/* Snow                                                                        */
/* -------------------------------------------------------------------------- */

interface FallLayer {
  cls: string;
  seed: number;
  count: number;
  size: [number, number];
  fall: [number, number];
  opacity: [number, number];
}

/**
 * Falling particle: seeded column (`left`), resting row (`--y`, shown under
 * reduced motion), and independent fall / sway / spin durations so the field
 * never moves in lockstep.
 */
function fallingParticle(cls: string, layer: FallLayer, i: number, extra: Record<string, string> = {}): string {
  const fall = pseudo(layer.seed + 2, i, layer.fall[0], layer.fall[1]);
  const sway = pseudo(layer.seed + 4, i, 2.6, 5.2);
  return `<i class="vn-pt ${cls}" style="${vars({
    left: `${n(strat(layer.seed, i, layer.count, 0.5, 99.5))}%`,
    "--y": `${n(pseudo(layer.seed + 1, i, 2, 96))}cqh`,
    "--sz": `${n(pseudo(layer.seed + 3, i, layer.size[0], layer.size[1]))}px`,
    "--o": n(pseudo(layer.seed + 5, i, layer.opacity[0], layer.opacity[1]), 2),
    "--fd": `${n(fall, 2)}s`,
    "--sd": `${n(sway, 2)}s`,
    "--dl": `${n(-pseudo(layer.seed + 6, i, 0, fall), 2)}s`,
    "--sdl": `${n(-pseudo(layer.seed + 7, i, 0, sway), 2)}s`,
    "--dx": `${n(pseudo(layer.seed + 8, i, -7, 3))}cqw`,
    "--sw": `${n(pseudo(layer.seed + 9, i, 8, 26))}px`,
    ...extra,
  })}"></i>`;
}

function generateSnowMarkup(): string {
  const far: FallLayer = { cls: "vn-snow-bg", seed: 10, count: 50, size: [3.5, 6], fall: [11, 16], opacity: [0.55, 0.85] };
  const mid: FallLayer = { cls: "vn-snow-mg", seed: 20, count: 32, size: [9, 15], fall: [7.5, 10.5], opacity: [0.75, 0.95] };
  const near: FallLayer = { cls: "vn-snow-fg", seed: 30, count: 12, size: [24, 36], fall: [4.6, 6.4], opacity: [0.7, 0.95] };
  const group = (layer: FallLayer, cls: (i: number) => string, extra?: (i: number) => Record<string, string>) => {
    const out: string[] = [];
    for (let i = 0; i < layer.count; i++) out.push(fallingParticle(cls(i), layer, i, extra?.(i)));
    return `<div class="vn-fx-layer ${layer.cls}">${out.join("")}</div>`;
  };
  return [
    `<div class="vn-snow-chill"></div>`,
    group(far, () => "vn-flake vn-flake--far"),
    group(mid, () => "vn-flake vn-flake--mid"),
    // Near flakes: crystal and soft bokeh alternate; crystals turn slowly.
    group(near, (i) => (i % 3 === 0 ? "vn-flake vn-flake--bokeh" : "vn-flake vn-flake--crystal"), (i) => ({
      "--rd": `${n(pseudo(37, i, 6, 12), 2)}s`,
      ...(i % 3 === 0 ? { "--sz": `${n(pseudo(38, i, 40, 64))}px` } : {}),
    })),
  ].join("");
}

/* -------------------------------------------------------------------------- */
/* Sakura                                                                      */
/* -------------------------------------------------------------------------- */

function generateSakuraMarkup(): string {
  const far: FallLayer = { cls: "vn-sakura-bg", seed: 40, count: 20, size: [10, 14], fall: [12, 16], opacity: [0.6, 0.8] };
  const mid: FallLayer = { cls: "vn-sakura-mg", seed: 50, count: 18, size: [17, 23], fall: [8.5, 11.5], opacity: [0.85, 0.97] };
  const near: FallLayer = { cls: "vn-sakura-fg", seed: 60, count: 9, size: [30, 42], fall: [5.6, 7.4], opacity: [0.88, 1] };
  const group = (layer: FallLayer, depth: string) => {
    const out: string[] = [];
    for (let i = 0; i < layer.count; i++) {
      // Tumble axis is seeded per petal so no two flip the same way.
      const ax = n(pseudo(layer.seed + 10, i, 0.4, 1), 2);
      const ay = n(pseudo(layer.seed + 11, i, -0.6, 0.9), 2);
      out.push(fallingParticle(`vn-petal vn-petal--${depth} vn-petal--${"abc"[i % 3]}`, layer, i, {
        "--rd": `${n(pseudo(layer.seed + 12, i, 2.2, 4.4), 2)}s`,
        "--ax": `${ax} ${ay} 0.8`,
        "--r0": `${Math.round(pseudo(layer.seed + 13, i, -60, 60))}deg`,
        "--dx": `${n(pseudo(layer.seed + 8, i, -26, -8))}cqw`,
      }));
    }
    return `<div class="vn-fx-layer ${layer.cls}">${out.join("")}</div>`;
  };
  return `<div class="vn-sakura-light"></div>${group(far, "far")}${group(mid, "mid")}${group(near, "near")}`;
}

/* -------------------------------------------------------------------------- */
/* Fireflies & embers                                                          */
/* -------------------------------------------------------------------------- */

function generateFirefliesMarkup(): string {
  const count = 26;
  const flies: string[] = [];
  for (let i = 0; i < count; i++) {
    const near = i % 5 === 2;
    const far = i % 3 === 0 && !near;
    const wander = pseudo(56, i, 12, 20);
    const blink = pseudo(57, i, 2.6, 4.8);
    const offset = (seed: number) => `${n(pseudo(seed, i, -46, 46))}px ${n(pseudo(seed + 1, i, -34, 34))}px`;
    flies.push(`<i class="vn-pt vn-firefly${near ? " vn-firefly--near" : far ? " vn-firefly--far" : ""}" style="${vars({
      left: `${n(strat(50, i, count, 2, 98))}%`,
      top: `${n(pseudo(51, i, near ? 30 : 14, 88))}%`,
      "--sz": `${n(near ? pseudo(52, i, 44, 64) : far ? pseudo(52, i, 12, 16) : pseudo(52, i, 20, 30))}px`,
      "--wd": `${n(wander, 2)}s`,
      "--bd": `${n(blink, 2)}s`,
      "--dl": `${n(-pseudo(53, i, 0, wander), 2)}s`,
      "--bdl": `${n(-pseudo(54, i, 0, blink), 2)}s`,
      "--p1": offset(58),
      "--p2": offset(60),
      "--p3": offset(62),
    })}"></i>`);
  }
  return `<div class="vn-firefly-haze"></div><div class="vn-fx-layer vn-fireflies">${flies.join("")}</div>`;
}

function generateEmbersMarkup(): string {
  const count = 44;
  const sparks: string[] = [];
  for (let i = 0; i < count; i++) {
    const kind = i % 7 === 3 ? "bokeh" : i % 3 === 1 ? "streak" : i % 2 === 0 ? "far" : "spark";
    const rise = kind === "bokeh" ? pseudo(63, i, 5.5, 7.5) : kind === "far" ? pseudo(63, i, 5.2, 7.2) : pseudo(63, i, 3.2, 5.2);
    const size = kind === "bokeh" ? pseudo(61, i, 26, 40) : kind === "far" ? pseudo(61, i, 5, 8) : pseudo(61, i, 9, 14);
    sparks.push(`<i class="vn-pt vn-ember vn-ember--${kind}" style="${vars({
      left: `${n(strat(60, i, count, 1, 99))}%`,
      "--y": `${n(pseudo(64, i, 8, 92))}cqh`,
      "--sz": `${n(size)}px`,
      "--fd": `${n(rise, 2)}s`,
      "--dl": `${n(-pseudo(62, i, 0, rise), 2)}s`,
      "--dx": `${n(pseudo(65, i, -4, 10))}cqw`,
      "--sw": `${n(pseudo(66, i, 8, 22))}px`,
      "--sd": `${n(pseudo(67, i, 1.1, 2.2), 2)}s`,
      "--fl": `${n(pseudo(68, i, 0.12, 0.3), 2)}s`,
    })}"></i>`);
  }
  return `<div class="vn-ember-glow"></div><div class="vn-fx-layer vn-embers">${sparks.join("")}</div>`;
}

/* -------------------------------------------------------------------------- */
/* Fog                                                                         */
/* -------------------------------------------------------------------------- */

function generateFogMarkup(): string {
  // Three seamless noise banks (textures live in VN_EFFECTS_CSS) drifting at
  // different speeds and directions, denser toward the ground.
  return [
    `<div class="vn-fog-wash"></div>`,
    `<div class="vn-fog-layer vn-fog-layer-1"><i></i></div>`,
    `<div class="vn-fog-layer vn-fog-layer-2"><i></i></div>`,
    `<div class="vn-fog-layer vn-fog-layer-3"><i></i></div>`,
  ].join("");
}

/* -------------------------------------------------------------------------- */
/* Front ambient layer (sprite mode)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Particle ambients that get a front copy in sprite mode. Mood grades have no
 * particles: in sprite mode the stage raises their overlay above the sprites.
 */
export const FRONT_AMBIENT_EFFECTS = ["rain", "heavy_rain", "snow", "sakura", "fireflies", "embers", "fog"] as const satisfies readonly AmbientEffect[];

export type FrontAmbientEffect = (typeof FRONT_AMBIENT_EFFECTS)[number];

/** Front density bound: front particles per back particle (asserted by tests). */
export const FRONT_AMBIENT_MAX_DENSITY = 0.4;

/** Front rain streaks (the back sheets draw hundreds per screen). */
export const FRONT_RAIN_STREAKS = { rain: 7, heavy_rain: 10 } as const;

/** Lens drops on the front layer for heavy rain (the back layer has 12). */
export const FRONT_LENS_DROPS = 5;

export function isFrontAmbientEffect(effect: AmbientEffect | null | undefined): effect is FrontAmbientEffect {
  return (FRONT_AMBIENT_EFFECTS as readonly string[]).includes(effect ?? "");
}

/**
 * Foreground copy of a particle ambient, drawn in front of the sprites (and
 * below the dialogue) so weather surrounds the characters. Lighter, larger
 * and faster than the back overlay, and sparse: at most
 * FRONT_AMBIENT_MAX_DENSITY of the back layer's particles. "gentle" halves
 * it (CSS hides every other `.vn-pt`), reduced motion hides the whole layer.
 * Empty for mood grades.
 */
export function generateFrontAmbientMarkup(effect: AmbientEffect): string {
  switch (effect) {
    case "rain":
      return generateFrontRainMarkup(false);
    case "heavy_rain":
      return generateFrontRainMarkup(true);
    case "snow":
      return generateFrontSnowMarkup();
    case "sakura":
      return generateFrontSakuraMarkup();
    case "fireflies":
      return generateFrontFirefliesMarkup();
    case "embers":
      return generateFrontEmbersMarkup();
    case "fog":
      return `<div class="vn-fog-layer vn-fog-layer-3 vn-fog-front"><i></i></div>`;
    default:
      return "";
  }
}

function generateFrontRainMarkup(heavy: boolean): string {
  const tilt = heavy ? 13 : 8;
  const slope = Math.tan((tilt * Math.PI) / 180);
  // A few big, soft, fast streaks close to the lens. Single nodes rather than
  // another full-stage scrolling sheet: far cheaper to composite, and
  // "gentle" halves them like any other particle.
  const count = heavy ? FRONT_RAIN_STREAKS.heavy_rain : FRONT_RAIN_STREAKS.rain;
  const streaks: string[] = [];
  for (let i = 0; i < count; i++) {
    const fall = pseudo(heavy ? 247 : 147, i, heavy ? 0.26 : 0.32, heavy ? 0.36 : 0.44);
    streaks.push(`<i class="vn-pt vn-streak" style="${vars({
      left: `${n(strat(heavy ? 241 : 141, i, count, 2, 108))}%`,
      "--y": `${n(pseudo(heavy ? 242 : 142, i, 4, 90))}cqh`,
      "--sz": `${n(pseudo(heavy ? 243 : 143, i, 150, 260))}px`,
      "--o": n(pseudo(heavy ? 244 : 144, i, heavy ? 0.34 : 0.26, heavy ? 0.52 : 0.42), 2),
      "--fd": `${n(fall, 2)}s`,
      "--dl": `${n(-pseudo(heavy ? 246 : 146, i, 0, fall), 2)}s`,
      "--dx": `calc(-112cqh * ${n(slope, 3)})`,
      "--tilt": `${tilt}deg`,
    })}"></i>`);
  }
  let lens = "";
  if (heavy) {
    // The wet lens sits on the camera glass, so in sprite mode it moves in
    // front of the characters (the back copy is hidden by CSS).
    const dropCount = FRONT_LENS_DROPS;
    const drops: string[] = [];
    for (let i = 0; i < dropCount; i++) {
      const run = i % 3 === 1;
      const dur = pseudo(335, i, 9, 15);
      drops.push(`<i class="vn-pt vn-drop${run ? " vn-drop--run" : ""}" style="${vars({
        left: `${n(strat(331, i, dropCount, 4, 94))}%`,
        top: `${n(pseudo(332, i, run ? 4 : 6, run ? 40 : 80))}%`,
        "--sz": `${n(pseudo(333, i, 11, 26))}px`,
        "--sq": n(pseudo(334, i, 0.9, 1.2), 2),
        "--dur": `${n(dur, 2)}s`,
        "--dl": `${n(-pseudo(336, i, 0, dur), 2)}s`,
      })}"></i>`);
    }
    lens = `<div class="vn-rain-lens" data-vn-lens-droplets>${drops.join("")}</div>`;
  }
  return `<div class="vn-fx-layer vn-rain-front">${streaks.join("")}</div>${lens}`;
}

/** Front falling layer: same seeded falling particle as the back layers. */
function frontFallGroup(layer: FallLayer, cls: (i: number) => string, extra?: (i: number) => Record<string, string>): string {
  const out: string[] = [];
  for (let i = 0; i < layer.count; i++) out.push(fallingParticle(cls(i), layer, i, extra?.(i)));
  return `<div class="vn-fx-layer ${layer.cls}">${out.join("")}</div>`;
}

function generateFrontSnowMarkup(): string {
  // Large out-of-focus flakes drifting past the lens.
  const near: FallLayer = { cls: "vn-snow-front", seed: 130, count: 10, size: [46, 84], fall: [3.4, 4.6], opacity: [0.3, 0.55] };
  return frontFallGroup(near, () => "vn-flake vn-flake--bokeh vn-flake--front", (i) => ({
    "--sw": `${n(pseudo(139, i, 18, 40))}px`,
  }));
}

function generateFrontSakuraMarkup(): string {
  const near: FallLayer = { cls: "vn-sakura-front", seed: 160, count: 6, size: [46, 64], fall: [4.2, 5.6], opacity: [0.55, 0.75] };
  return frontFallGroup(near, () => "vn-petal vn-petal--far vn-petal--front", (i) => ({
    "--rd": `${n(pseudo(172, i, 2.6, 4.2), 2)}s`,
    "--ax": `${n(pseudo(170, i, 0.4, 1), 2)} ${n(pseudo(171, i, -0.6, 0.9), 2)} 0.8`,
    "--r0": `${Math.round(pseudo(173, i, -60, 60))}deg`,
    "--dx": `${n(pseudo(168, i, -34, -14))}cqw`,
  }));
}

function generateFrontFirefliesMarkup(): string {
  const count = 5;
  const flies: string[] = [];
  for (let i = 0; i < count; i++) {
    const wander = pseudo(156, i, 8, 13);
    const blink = pseudo(157, i, 2.8, 4.6);
    const offset = (seed: number) => `${n(pseudo(seed, i, -80, 80))}px ${n(pseudo(seed + 1, i, -50, 50))}px`;
    flies.push(`<i class="vn-pt vn-firefly vn-firefly--near vn-firefly--front" style="${vars({
      left: `${n(strat(150, i, count, 4, 96))}%`,
      top: `${n(pseudo(151, i, 34, 86))}%`,
      "--sz": `${n(pseudo(152, i, 78, 116))}px`,
      "--wd": `${n(wander, 2)}s`,
      "--bd": `${n(blink, 2)}s`,
      "--dl": `${n(-pseudo(153, i, 0, wander), 2)}s`,
      "--bdl": `${n(-pseudo(154, i, 0, blink), 2)}s`,
      "--p1": offset(158),
      "--p2": offset(160),
      "--p3": offset(162),
    })}"></i>`);
  }
  return `<div class="vn-fx-layer vn-fireflies-front">${flies.join("")}</div>`;
}

function generateFrontEmbersMarkup(): string {
  const count = 7;
  const sparks: string[] = [];
  for (let i = 0; i < count; i++) {
    const streak = i % 3 === 1;
    const rise = pseudo(163, i, 2.4, 3.6);
    sparks.push(`<i class="vn-pt vn-ember vn-ember--${streak ? "streak" : "bokeh"} vn-ember--front" style="${vars({
      left: `${n(strat(160, i, count, 3, 97))}%`,
      "--y": `${n(pseudo(164, i, 10, 90))}cqh`,
      "--sz": `${n(streak ? pseudo(161, i, 14, 19) : pseudo(161, i, 40, 64))}px`,
      "--fd": `${n(rise, 2)}s`,
      "--dl": `${n(-pseudo(162, i, 0, rise), 2)}s`,
      "--dx": `${n(pseudo(165, i, -6, 14))}cqw`,
      "--sw": `${n(pseudo(166, i, 14, 34))}px`,
      "--sd": `${n(pseudo(167, i, 1.1, 2), 2)}s`,
      "--fl": `${n(pseudo(168, i, 0.14, 0.3), 2)}s`,
    })}"></i>`);
  }
  return `<div class="vn-fx-layer vn-embers-front">${sparks.join("")}</div>`;
}

/* -------------------------------------------------------------------------- */
/* One-shot bursts                                                             */
/* -------------------------------------------------------------------------- */

const BURST_SVG_ATTRS = `viewBox="0 0 800 600" preserveAspectRatio="none" aria-hidden="true"`;

/**
 * Manga focus lines: tapered wedges converge on an irregular clear centre.
 * Two interleaved sets flicker against each other while the frame settles.
 */
function generateSpeedLinesMarkup(): string {
  const count = 76;
  const sets: [string[], string[]] = [[], []];
  for (let i = 0; i < count; i++) {
    const angle = ((i + pseudo(70, i, -0.35, 0.35)) / count) * Math.PI * 2;
    const inner = pseudo(71, i, 0.5, 0.78);
    const half = (pseudo(72, i, 0.25, 1.15) * Math.PI) / 180;
    const outer = 1.35;
    const point = (a: number, r: number) => `${n(400 + 400 * r * Math.cos(a))},${n(300 + 300 * r * Math.sin(a))}`;
    const opacity = n(pseudo(73, i, 0.55, 0.95), 2);
    sets[i % 2]!.push(`<polygon points="${point(angle, inner)} ${point(angle - half, outer)} ${point(angle + half, outer)}" opacity="${opacity}"/>`);
  }
  return `<svg class="vn-speed-lines" ${BURST_SVG_ATTRS}>
    <defs><radialGradient id="vn-sl-focus" cx="50%" cy="50%" r="72%"><stop offset=".45" stop-color="#05060a" stop-opacity="0"/><stop offset="1" stop-color="#05060a" stop-opacity=".42"/></radialGradient></defs>
    <rect class="vn-speed-lines-vignette" width="800" height="600" fill="url(#vn-sl-focus)"/>
    <g class="vn-speed-lines-a" fill="#fff">${sets[0].join("")}</g>
    <g class="vn-speed-lines-b" fill="#fff">${sets[1].join("")}</g>
  </svg>`.replace(/\n\s*/g, "");
}

/** Shared burst particle: flies from the origin to (--tx, --ty). */
function burstParticle(cls: string, style: Record<string, string>): string {
  return `<i class="vn-pt ${cls}" style="${vars(style)}"></i>`;
}

function generateSparkleBurstMarkup(): string {
  const count = 22;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const angle = ((i + pseudo(80, i, -0.3, 0.3)) / count) * Math.PI * 2;
    const dist = pseudo(81, i, 16, 42);
    out.push(burstParticle(`vn-sparkle vn-sparkle--${"abcd"[i % 4]}`, {
      "--tx": `${n(Math.cos(angle) * dist)}cqmin`,
      "--ty": `${n(Math.sin(angle) * dist * 0.85)}cqmin`,
      "--sz": `${n(pseudo(82, i, 26, 58))}px`,
      "--dl": `${Math.round(pseudo(83, i, 0, 110))}ms`,
      "--rot": `${Math.round(pseudo(84, i, 45, 140))}deg`,
    }));
  }
  const dust = 14;
  for (let i = 0; i < dust; i++) {
    const angle = ((i + 0.5 + pseudo(85, i, -0.4, 0.4)) / dust) * Math.PI * 2;
    const dist = pseudo(86, i, 24, 46);
    out.push(burstParticle("vn-sparkle-dust", {
      "--tx": `${n(Math.cos(angle) * dist)}cqmin`,
      "--ty": `${n(Math.sin(angle) * dist * 0.85)}cqmin`,
      "--sz": `${n(pseudo(87, i, 5, 10))}px`,
      "--dl": `${Math.round(pseudo(88, i, 40, 160))}ms`,
    }));
  }
  return `<div class="vn-burst vn-burst--sparkle"><b class="vn-burst-bloom"></b><b class="vn-burst-ring"></b>${out.join("")}</div>`;
}

function generateHeartsBurstMarkup(): string {
  const count = 16;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const soft = i % 5 === 4;
    const x = strat(90, i, count, -34, 34);
    out.push(burstParticle(`vn-heart vn-heart--${"abc"[i % 3]}${soft ? " vn-heart--soft" : ""}`, {
      "--tx": `${n(x)}cqmin`,
      "--ty": `${n(-pseudo(91, i, 22, 46))}cqh`,
      "--sw": `${n(pseudo(94, i, -5, 5))}cqmin`,
      "--sz": `${n(soft ? pseudo(92, i, 60, 84) : pseudo(92, i, 28, 54))}px`,
      "--dl": `${Math.round(pseudo(93, i, 0, 170))}ms`,
      "--r0": `${Math.round(pseudo(95, i, -22, 22))}deg`,
    }));
  }
  return `<div class="vn-burst vn-burst--hearts"><b class="vn-burst-bloom"></b>${out.join("")}</div>`;
}

function generateConfettiMarkup(): string {
  const count = 46;
  const shapes = ["rect", "ribbon", "rect", "dot", "square"];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`<i class="vn-pt vn-confetti-piece vn-confetti--${shapes[i % shapes.length]} vn-confetti--c${i % 6}" style="${vars({
      left: `${n(strat(100, i, count, 4, 96))}%`,
      top: `${n(pseudo(101, i, 4, 40))}%`,
      "--kx": `${n(pseudo(102, i, -4, 4))}cqw`,
      "--ky": `${n(-pseudo(103, i, 2, 6))}cqh`,
      "--tx": `${n(pseudo(104, i, -8, 8))}cqw`,
      "--ty": `${n(pseudo(105, i, 50, 76))}cqh`,
      "--ax": `${n(pseudo(106, i, 0.2, 1), 2)} ${n(pseudo(107, i, -1, 1), 2)} ${n(pseudo(108, i, 0.1, 0.6), 2)}`,
      "--spin": `${Math.round(pseudo(109, i, 540, 1260)) * (i % 2 ? 1 : -1)}deg`,
      "--dl": `${Math.round(pseudo(110, i, 0, 90))}ms`,
    })}"></i>`);
  }
  return `<div class="vn-burst vn-burst--confetti">${out.join("")}</div>`;
}

/** Jagged bolt polyline from the top edge toward the horizon, plus forks. */
function generateLightningMarkup(): string {
  const segments = 11;
  const x0 = 545;
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = x0 - 60 * t + (i === 0 ? 0 : pseudo(120, i, -26, 26));
    const y = -10 + t * 400 + (i === 0 || i === segments ? 0 : pseudo(121, i, -10, 10));
    points.push([x, y]);
  }
  const fork = (from: number, seed: number, dir: number, steps: number) => {
    const out: Array<[number, number]> = [points[from]!];
    let [x, y] = points[from]!;
    for (let i = 1; i <= steps; i++) {
      x += dir * pseudo(seed, i, 14, 30);
      y += pseudo(seed + 1, i, 22, 36);
      out.push([x, y]);
    }
    return out;
  };
  const d = (pts: Array<[number, number]>) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}`;
  const main = d(points);
  const forks = [fork(3, 122, 1, 4), fork(6, 124, -1, 3), fork(8, 126, 1, 2)].map(d);
  const path = (dd: string, cls: string) => `<path class="${cls}" d="${dd}" vector-effect="non-scaling-stroke"/>`;
  return `<div class="vn-bolt"><b class="vn-bolt-sky"></b><svg ${BURST_SVG_ATTRS}>
    <g class="vn-bolt-glow">${path(main, "vn-bolt-main")}${forks.map((f) => path(f, "vn-bolt-fork")).join("")}</g>
    <g class="vn-bolt-core">${path(main, "vn-bolt-main")}${forks.map((f) => path(f, "vn-bolt-fork")).join("")}</g>
  </svg></div>`.replace(/\n\s*/g, "");
}
