import type { VisualNovelEffectIntensity } from "../../config.js";
import type { AmbientEffect, StageEffect } from "../store/index.js";

/**
 * Bounded effect presentation for the beginner "Effects" preference.
 *
 * The host filters the planner's per-paragraph effect ids BEFORE they reach
 * the stage, so the choice is enforced regardless of stage internals:
 * - "full": every effect passes through unchanged (pre-redesign behavior);
 * - "gentle": strong shakes and screen flashes are dropped or softened;
 * - "off": no one-shot effect plays at all.
 *
 * Ambient overlays (rain, snow, fog...) are atmospheric, not vestibular, and
 * stay on at every level; only the flashing `danger_pulse` is replaced by the
 * static `vignette_dark` below "full". The OS `prefers-reduced-motion` rule in
 * the theme CSS is layered on top of this and is never disabled here.
 */

/** One-shot effects that are dropped at "gentle" (strong shake, screen flash, camera shock). */
export const STRONG_STAGE_EFFECTS: ReadonlySet<StageEffect> = new Set<StageEffect>([
  "shake_hard",
  "rumble",
  "flash_white",
  "flash_red",
  "lightning",
  "zoom_punch",
  "blur_pulse",
  "heartbeat",
]);

/** Strong effects that still have a mild equivalent at "gentle". */
const GENTLE_DOWNGRADES: Readonly<Partial<Record<StageEffect, StageEffect>>> = {
  shake_hard: "shake",
  rumble: "shake",
};

export function presentEffect(
  effect: StageEffect,
  intensity: VisualNovelEffectIntensity,
): StageEffect | null {
  if (intensity === "off") return null;
  if (intensity === "full") return effect;
  if (!STRONG_STAGE_EFFECTS.has(effect)) return effect;
  return GENTLE_DOWNGRADES[effect] ?? null;
}

export function presentAmbient(
  ambient: AmbientEffect | null,
  intensity: VisualNovelEffectIntensity,
): AmbientEffect | null {
  if (intensity === "full") return ambient;
  return ambient === "danger_pulse" ? "vignette_dark" : ambient;
}
