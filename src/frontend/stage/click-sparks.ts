/**
 * Click sparks (config `clickEffect`, docs/SPRITE_MODE.md "Stage feel"): a
 * small gold spark burst at the pointer for every click or tap on the stage,
 * with a little "!" popping up in "sparks-pop". Self-contained (inline
 * styles and the Web Animations API, no stylesheet), so any stage screen can
 * spawn it into its own root: the waiting screen reuses it.
 *
 * Motion "off" and the OS reduced-motion setting turn it off
 * (`clickEffectFor`); `spawnClickSparks` also checks reduced motion itself.
 */
import type { VisualNovelClickEffect, VisualNovelEffectIntensity } from "../../config.js";

export type ClickSparkMode = VisualNovelClickEffect;

/** How long the sparks fly (ms). */
export const CLICK_SPARK_MS = 300;
/** How long the "!" pops (ms). */
export const CLICK_POP_MS = 440;
/** Sparks per burst. */
export const CLICK_SPARK_COUNT = 7;
/** Bursts alive at once per container; a fast clicker drops the oldest. */
export const CLICK_SPARK_MAX_BURSTS = 6;

const GOLD = "#ffd56b";
const GOLD_DEEP = "#e8a92e";
/** A four-point star. */
const STAR = "polygon(50% 0%, 64% 36%, 100% 50%, 64% 64%, 50% 100%, 36% 64%, 0% 50%, 36% 36%)";

/**
 * The click effect in force: the reader's choice, unless Motion is "off" or
 * the OS asks for reduced motion (then none).
 */
export function clickEffectFor(
  setting: ClickSparkMode | string | undefined,
  intensity: VisualNovelEffectIntensity,
  reducedMotion: boolean,
): ClickSparkMode {
  if (setting === "off" || intensity === "off" || reducedMotion) return "off";
  return setting === "sparks-pop" ? "sparks-pop" : "sparks";
}

export type SparkVector = {
  /** Where the spark ends, in px from the pointer. */
  dx: number;
  dy: number;
  /** Spark size in px. */
  size: number;
  /** Start delay in ms. */
  delay: number;
};

/** One burst: sparks spread evenly around the pointer with a little jitter, 16-30 px out, 8-12 px wide. */
export function sparkVectors(count = CLICK_SPARK_COUNT, random: () => number = Math.random): SparkVector[] {
  const start = random() * Math.PI * 2;
  const step = (Math.PI * 2) / Math.max(1, count);
  return Array.from({ length: count }, (_, index) => {
    const angle = start + index * step + (random() - 0.5) * step * 0.5;
    const distance = 16 + random() * 14;
    return {
      dx: Math.round(Math.cos(angle) * distance * 10) / 10,
      dy: Math.round(Math.sin(angle) * distance * 10) / 10,
      size: Math.round((8 + random() * 4) * 10) / 10,
      delay: Math.round(random() * 40),
    };
  });
}

const prefersReducedMotion = (): boolean => {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/**
 * A point in client px (a pointer event's clientX / clientY) as px inside
 * the container, so a zoomed or scaled host still puts the burst under the
 * pointer.
 */
export function containerPoint(container: Pick<HTMLElement, "offsetWidth" | "offsetHeight"> & Partial<Pick<HTMLElement, "getBoundingClientRect">>, x: number, y: number): { x: number; y: number } {
  if (typeof container.getBoundingClientRect !== "function") return { x, y };
  const rect = container.getBoundingClientRect();
  const sx = rect.width > 0 && container.offsetWidth > 0 ? container.offsetWidth / rect.width : 1;
  const sy = rect.height > 0 && container.offsetHeight > 0 ? container.offsetHeight / rect.height : 1;
  return { x: (x - rect.left) * sx, y: (y - rect.top) * sy };
}

const liveBursts = new WeakMap<object, HTMLElement[]>();

const css = (element: HTMLElement, style: Record<string, string>): void => {
  Object.assign(element.style, style);
};

const play = (element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): void => {
  if (typeof element.animate === "function") element.animate(keyframes, options);
};

/**
 * Spawn one burst at a point (client px) inside `container`, which must be
 * positioned (relative or absolute). Returns the burst element (it removes
 * itself), or null when the mode is "off" or the OS asks for reduced motion.
 * Decorative: aria-hidden, no pointer events, never selectable.
 */
export function spawnClickSparks(
  container: HTMLElement,
  x: number,
  y: number,
  mode: ClickSparkMode,
  options: { random?: () => number } = {},
): HTMLElement | null {
  if (mode === "off" || typeof document === "undefined" || prefersReducedMotion()) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const point = containerPoint(container, x, y);
  const random = options.random ?? Math.random;

  const burst = document.createElement("span");
  burst.setAttribute("data-vn-click-sparks", mode);
  burst.setAttribute("aria-hidden", "true");
  css(burst, {
    position: "absolute",
    left: `${Math.round(point.x)}px`,
    top: `${Math.round(point.y)}px`,
    width: "0",
    height: "0",
    zIndex: "15",
    pointerEvents: "none",
    userSelect: "none",
    webkitUserSelect: "none",
  });

  // A soft glint under the sparks.
  const glint = document.createElement("i");
  glint.setAttribute("data-vn-click-glint", "");
  css(glint, {
    position: "absolute",
    left: "-14px",
    top: "-14px",
    width: "28px",
    height: "28px",
    borderRadius: "50%",
    background: `radial-gradient(circle, rgba(255, 248, 214, 1) 0%, ${GOLD}cc 30%, ${GOLD}00 70%)`,
    opacity: "0",
  });
  burst.append(glint);
  play(glint, [
    { opacity: 1, transform: "scale(0.3)" },
    { opacity: 0.85, transform: "scale(1)", offset: 0.3 },
    { opacity: 0, transform: "scale(1.4)" },
  ], { duration: CLICK_SPARK_MS - 40, easing: "ease-out", fill: "forwards" });

  for (const spark of sparkVectors(CLICK_SPARK_COUNT, random)) {
    const element = document.createElement("i");
    element.setAttribute("data-vn-click-spark", "");
    const half = spark.size / 2;
    css(element, {
      position: "absolute",
      left: `${-half}px`,
      top: `${-half}px`,
      width: `${spark.size}px`,
      height: `${spark.size}px`,
      background: `radial-gradient(circle, #fffdf2 0%, #ffe9a6 35%, ${GOLD} 70%, ${GOLD_DEEP} 100%)`,
      clipPath: STAR,
      filter: "drop-shadow(0 0 2px rgba(255, 196, 70, 0.9))",
      opacity: "0",
    });
    burst.append(element);
    // Out fast to full size, then drift on while shrinking and fading.
    play(element, [
      { opacity: 1, transform: "translate(0, 0) scale(0.6) rotate(0deg)", easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
      { opacity: 1, transform: `translate(${spark.dx * 0.7}px, ${spark.dy * 0.7}px) scale(1.15) rotate(25deg)`, offset: 0.45, easing: "ease-in" },
      { opacity: 0, transform: `translate(${spark.dx}px, ${spark.dy}px) scale(0.3) rotate(45deg)` },
    ], { duration: CLICK_SPARK_MS, delay: spark.delay, fill: "forwards" });
  }

  if (mode === "sparks-pop") {
    const pop = document.createElement("b");
    pop.setAttribute("data-vn-click-pop", "");
    pop.textContent = "!";
    css(pop, {
      position: "absolute",
      left: "6px",
      top: "-30px",
      font: "900 22px/1 system-ui, sans-serif",
      color: GOLD,
      textShadow: "0 0 1px #6e3500, 1px 1px 0 #6e3500, -1px 1px 0 #6e3500, 1px -1px 0 #6e3500, -1px -1px 0 #6e3500, 0 2px 4px rgba(0, 0, 0, 0.45)",
      transformOrigin: "50% 100%",
      opacity: "0",
    });
    burst.append(pop);
    play(pop, [
      { opacity: 0, transform: "translateY(10px) scale(0.2) rotate(-12deg)" },
      { opacity: 1, transform: "translateY(-2px) scale(1.18) rotate(6deg)", offset: 0.35 },
      { opacity: 1, transform: "translateY(-4px) scale(1) rotate(0deg)", offset: 0.7 },
      { opacity: 0, transform: "translateY(-10px) scale(0.95) rotate(0deg)" },
    ], { duration: CLICK_POP_MS, easing: "ease-out", fill: "forwards" });
  }

  container.append(burst);
  const alive = liveBursts.get(container) ?? [];
  alive.push(burst);
  while (alive.length > CLICK_SPARK_MAX_BURSTS) alive.shift()?.remove();
  liveBursts.set(container, alive);
  setTimeout(() => {
    burst.remove();
    const list = liveBursts.get(container);
    const index = list?.indexOf(burst) ?? -1;
    if (list && index !== -1) list.splice(index, 1);
  }, (mode === "sparks-pop" ? CLICK_POP_MS : CLICK_SPARK_MS + 40) + 60);
  return burst;
}
