/**
 * Styles for inline dialogue text effects (`[data-vn-text-fx="<id>"]`), see
 * src/shared/text-effects.ts and src/frontend/stage/text-effects.ts.
 * Included in VN_BASE_CSS so every preset and the user CSS layer can restyle
 * it. The rules never depend on `[data-vn-root]`, so other shadow roots (the
 * settings panel reference card) can reuse this string as-is.
 *
 * Modes. The nearest ancestor with `data-vn-text-effects` decides:
 * - "animated" (also when no ancestor sets it): full effect;
 * - "static": colours, glow, and sizes stay, nothing moves (rainbow keeps a
 *   frozen gradient);
 * - "off": effect spans look like plain text.
 * `prefers-reduced-motion: reduce` behaves like "static". The stage's effect
 * intensity "gentle" (and "off", which only governs stage effects) makes
 * text motion smaller and slower.
 *
 * Composition. Split letters (`[data-vn-text-fx-ch]`) run one animation per
 * slot, and every slot animates its own properties, so nested effects add up
 * instead of replacing each other (the innermost effect wins a slot):
 *   move    translate / rotate / transform  shake tremble wave bounce glitch
 *   tint    color                          rainbow
 *   flicker opacity                        glitch fade
 *   enter   opacity / scale / filter, once when the letter appears
 *                                          shout fade
 * Words (`[data-vn-text-fx-word]`) have a "word" slot (scale) for pulse.
 * Effects pick a slot with a custom property, e.g.
 * `--vn-tfx-move: var(--vn-tfx-gate-motion, vn-tfx-wave)`; the mode sets the
 * gate to `none` to switch a whole slot off.
 *
 * Public tuning properties (set them in a preset or custom CSS):
 *   --vn-text-fx-amp            motion size multiplier (1)
 *   --vn-text-fx-speed          motion speed multiplier (1)
 *   --vn-text-fx-glow           glow colour
 *   --vn-text-fx-rainbow-mix    how much hue goes into the text colour (82%)
 *   --vn-text-fx-rainbow-1..7   the seven rainbow hues (bright defaults for
 *                               dark boxes; light presets use deeper ones)
 *   --vn-text-fx-split-a / -b   glitch colour split
 */
export const VN_TEXT_EFFECTS_CSS = `
/* ---- Text effects: modes ------------------------------------------------ */
[data-vn-text-effects="animated"] {
  --vn-tfx-gate-motion: initial;
  --vn-tfx-gate-color: initial;
  --vn-tfx-play: running;
}
[data-vn-text-effects="static"] {
  --vn-tfx-gate-motion: none;
  --vn-tfx-gate-color: initial;
  --vn-tfx-play: paused;
}
[data-vn-text-effects="off"] {
  --vn-tfx-gate-motion: none;
  --vn-tfx-gate-color: none;
  --vn-tfx-play: paused;
}
[data-vn-effect-intensity="gentle"],
[data-vn-effect-intensity="off"] {
  --vn-text-fx-amp: 0.55;
  --vn-text-fx-speed: 0.75;
}
@media (prefers-reduced-motion: reduce) {
  [data-vn-text-fx] {
    --vn-tfx-gate-motion: none;
    --vn-tfx-play: paused;
  }
}

/* ---- Text effects: structure -------------------------------------------- */
[data-vn-text-fx] {
  --vn-tfx-amp: var(--vn-text-fx-amp, 1);
  --vn-tfx-speed: var(--vn-text-fx-speed, 1);
}
@supports (text-wrap-mode: nowrap) {
  [data-vn-text-fx-glue] { text-wrap-mode: nowrap; }
  [data-vn-text-fx-glue] > [data-vn-text-fx] { text-wrap-mode: wrap; }
}
[data-vn-text-fx-word] {
  display: var(--vn-tfx-word-display, inline);
  white-space: nowrap;
  transform-origin: 50% 60%;
  animation-name: var(--vn-tfx-word, none);
  animation-duration: calc(var(--vn-tfx-word-dur, 1s) / var(--vn-tfx-speed, 1));
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-play-state: var(--vn-tfx-play, running);
}
[data-vn-text-fx-ch] {
  display: inline-block;
  transform-origin: 50% 70%;
  animation-name: var(--vn-tfx-move, none), var(--vn-tfx-tint, none), var(--vn-tfx-flicker, none), var(--vn-tfx-enter, none);
  animation-duration:
    calc(var(--vn-tfx-move-dur, 1s) / var(--vn-tfx-speed, 1)),
    calc(var(--vn-tfx-tint-dur, 1s) / var(--vn-tfx-speed, 1)),
    calc(var(--vn-tfx-flicker-dur, 1s) / var(--vn-tfx-speed, 1)),
    var(--vn-tfx-enter-dur, 0.4s);
  animation-timing-function:
    var(--vn-tfx-move-ease, ease-in-out),
    linear,
    var(--vn-tfx-flicker-ease, ease-in-out),
    var(--vn-tfx-enter-ease, ease-out);
  /* Loops start a whole number of cycles in the past (no wait, and frame 0
     lines up with the first letter), and each letter lags the previous one,
     so a wave or colour band travels left to right. */
  animation-delay:
    calc((var(--vn-ch, 0) * var(--vn-tfx-move-lag, 0ms) - 100 * var(--vn-tfx-move-dur, 1s)) / var(--vn-tfx-speed, 1)),
    calc((var(--vn-ch, 0) * var(--vn-tfx-tint-lag, 0ms) - 100 * var(--vn-tfx-tint-dur, 1s)) / var(--vn-tfx-speed, 1)),
    calc((var(--vn-ch, 0) * var(--vn-tfx-flicker-lag, 0ms) - 100 * var(--vn-tfx-flicker-dur, 1s)) / var(--vn-tfx-speed, 1)),
    0s;
  animation-iteration-count: infinite, infinite, infinite, 1;
  animation-fill-mode: none, none, none, backwards;
  animation-play-state: var(--vn-tfx-play, running);
}
/* While the typewriter has not reached a letter it is empty: hold its
   entrance until it appears. */
[data-vn-text-fx-ch]:empty {
  animation-name: var(--vn-tfx-move, none), var(--vn-tfx-tint, none), var(--vn-tfx-flicker, none), none;
}

/* ---- shake: hard jolts ------------------------------------------------- */
[data-vn-text-fx="shake"] {
  --vn-tfx-move: var(--vn-tfx-gate-motion, vn-tfx-shake);
  --vn-tfx-move-dur: 0.42s;
  --vn-tfx-move-lag: 157ms;
  --vn-tfx-move-ease: steps(1, end);
}
@keyframes vn-tfx-shake {
  0%, 100% { translate: 0 0; rotate: 0deg; }
  16% { translate: calc(var(--vn-tfx-amp) * 0.07em) calc(var(--vn-tfx-amp) * -0.06em); rotate: calc(var(--vn-tfx-amp) * -4deg); }
  33% { translate: calc(var(--vn-tfx-amp) * -0.06em) calc(var(--vn-tfx-amp) * 0.04em); rotate: calc(var(--vn-tfx-amp) * 4deg); }
  50% { translate: calc(var(--vn-tfx-amp) * 0.04em) calc(var(--vn-tfx-amp) * 0.06em); rotate: calc(var(--vn-tfx-amp) * 2deg); }
  66% { translate: calc(var(--vn-tfx-amp) * -0.07em) calc(var(--vn-tfx-amp) * -0.03em); rotate: calc(var(--vn-tfx-amp) * -3deg); }
  83% { translate: calc(var(--vn-tfx-amp) * 0.03em) calc(var(--vn-tfx-amp) * -0.07em); rotate: calc(var(--vn-tfx-amp) * 3deg); }
}

/* ---- tremble: a small nervous quiver ----------------------------------- */
[data-vn-text-fx="tremble"] {
  --vn-tfx-move: var(--vn-tfx-gate-motion, vn-tfx-tremble);
  --vn-tfx-move-dur: 0.24s;
  --vn-tfx-move-lag: 61ms;
  --vn-tfx-move-ease: linear;
}
@keyframes vn-tfx-tremble {
  0%, 100% { translate: 0 0; }
  25% { translate: calc(var(--vn-tfx-amp) * 0.022em) calc(var(--vn-tfx-amp) * -0.012em); }
  50% { translate: calc(var(--vn-tfx-amp) * -0.018em) calc(var(--vn-tfx-amp) * 0.014em); }
  75% { translate: calc(var(--vn-tfx-amp) * 0.012em) calc(var(--vn-tfx-amp) * 0.02em); }
}

/* ---- wave: a ripple travelling through the letters --------------------- */
[data-vn-text-fx="wave"] {
  --vn-tfx-move: var(--vn-tfx-gate-motion, vn-tfx-wave);
  --vn-tfx-move-dur: 1.6s;
  --vn-tfx-move-lag: 95ms;
  --vn-tfx-move-ease: ease-in-out;
}
@keyframes vn-tfx-wave {
  0%, 100% { translate: 0 calc(var(--vn-tfx-amp) * 0.07em); }
  50% { translate: 0 calc(var(--vn-tfx-amp) * -0.22em); }
}

/* ---- bounce: letters hop in turn --------------------------------------- */
[data-vn-text-fx="bounce"] {
  --vn-tfx-move: var(--vn-tfx-gate-motion, vn-tfx-bounce);
  --vn-tfx-move-dur: 1.3s;
  --vn-tfx-move-lag: 70ms;
  --vn-tfx-move-ease: linear;
}
@keyframes vn-tfx-bounce {
  0% { translate: 0 0; scale: 1 1; animation-timing-function: cubic-bezier(0.2, 0.7, 0.35, 1); }
  17% { translate: 0 calc(var(--vn-tfx-amp) * -0.36em); scale: 0.97 1.04; animation-timing-function: cubic-bezier(0.6, 0, 0.8, 0.4); }
  32% { translate: 0 0; scale: calc(1 + var(--vn-tfx-amp) * 0.08) calc(1 - var(--vn-tfx-amp) * 0.1); animation-timing-function: ease-out; }
  42%, 100% { translate: 0 0; scale: 1 1; }
}

/* ---- rainbow: colours flowing through the letters ---------------------- */
[data-vn-text-fx="rainbow"] {
  --vn-tfx-tint: var(--vn-tfx-gate-color, vn-tfx-rainbow);
  --vn-tfx-tint-dur: 2.8s;
  --vn-tfx-tint-lag: 300ms;
  --vn-tfx-rb-mix: var(--vn-text-fx-rainbow-mix, 82%);
}
/* Hues are listed backwards: with each letter lagging, a frozen frame
   reads red, orange, yellow, green... from left to right. */
@keyframes vn-tfx-rainbow {
  0%, 100% { color: color-mix(in oklab, var(--vn-text-fx-rainbow-1, #ff5a6e) var(--vn-tfx-rb-mix), currentColor); }
  14% { color: color-mix(in oklab, var(--vn-text-fx-rainbow-7, #c473ff) var(--vn-tfx-rb-mix), currentColor); }
  28% { color: color-mix(in oklab, var(--vn-text-fx-rainbow-6, #6e8bff) var(--vn-tfx-rb-mix), currentColor); }
  43% { color: color-mix(in oklab, var(--vn-text-fx-rainbow-5, #3fd0f0) var(--vn-tfx-rb-mix), currentColor); }
  57% { color: color-mix(in oklab, var(--vn-text-fx-rainbow-4, #5fe08a) var(--vn-tfx-rb-mix), currentColor); }
  71% { color: color-mix(in oklab, var(--vn-text-fx-rainbow-3, #ffd93a) var(--vn-tfx-rb-mix), currentColor); }
  86% { color: color-mix(in oklab, var(--vn-text-fx-rainbow-2, #ff9a3d) var(--vn-tfx-rb-mix), currentColor); }
}

/* ---- glow: a soft breathing light ---------------------------------------- */
[data-vn-text-fx="glow"] {
  --vn-tfx-glow: var(--vn-text-fx-glow, color-mix(in oklab, var(--vn-accent, #ffd889) 55%, #fff4c8));
  color: color-mix(in oklab, currentColor var(--vn-text-fx-glow-ink, 62%), var(--vn-tfx-glow));
  filter: drop-shadow(0 0 0.16em var(--vn-tfx-glow)) drop-shadow(0 0 0.42em color-mix(in srgb, var(--vn-tfx-glow) 55%, transparent));
  animation: var(--vn-tfx-gate-motion, vn-tfx-glow) calc(2.8s / var(--vn-tfx-speed, 1)) ease-in-out infinite;
  animation-play-state: var(--vn-tfx-play, running);
}
@keyframes vn-tfx-glow {
  0%, 100% { filter: drop-shadow(0 0 0.16em var(--vn-tfx-glow)) drop-shadow(0 0 0.42em color-mix(in srgb, var(--vn-tfx-glow) 55%, transparent)); }
  50% { filter: drop-shadow(0 0 0.24em var(--vn-tfx-glow)) drop-shadow(0 0 0.8em color-mix(in srgb, var(--vn-tfx-glow) 75%, transparent)) brightness(1.08); }
}

/* ---- pulse: words swell like a heartbeat --------------------------------- */
[data-vn-text-fx="pulse"] {
  --vn-tfx-word: var(--vn-tfx-gate-motion, vn-tfx-pulse);
  --vn-tfx-word-dur: 1.25s;
  --vn-tfx-word-display: inline-block;
}
/* A little side room so the swell never covers the spaces around a word. */
[data-vn-text-fx="pulse"] [data-vn-text-fx-word] {
  margin-inline: 0.05em;
}
@keyframes vn-tfx-pulse {
  0%, 100% { scale: 1; }
  14% { scale: calc(1 + var(--vn-tfx-amp) * 0.09); }
  28% { scale: 1; }
  40% { scale: calc(1 + var(--vn-tfx-amp) * 0.05); }
  58% { scale: 1; }
}

/* ---- glitch: colour split and sudden tearing ----------------------------- */
[data-vn-text-fx="glitch"] {
  --vn-tfx-move: var(--vn-tfx-gate-motion, vn-tfx-glitch);
  --vn-tfx-move-dur: 2.6s;
  --vn-tfx-move-lag: 37ms;
  --vn-tfx-move-ease: steps(1, end);
  --vn-tfx-flicker: var(--vn-tfx-gate-motion, vn-tfx-glitch-flicker);
  --vn-tfx-flicker-dur: 2.6s;
  --vn-tfx-flicker-lag: 37ms;
  --vn-tfx-flicker-ease: steps(1, end);
}
[data-vn-text-fx="glitch"] {
  text-shadow:
    0.05em 0 var(--vn-text-fx-split-a, rgba(255, 46, 108, 0.75)),
    -0.05em 0 var(--vn-text-fx-split-b, rgba(38, 214, 255, 0.75));
}
@keyframes vn-tfx-glitch {
  0%, 61%, 66%, 84%, 100% { translate: 0 0; transform: none; }
  62% { translate: calc(var(--vn-tfx-amp) * 0.09em) 0; transform: skewX(-14deg); }
  64% { translate: calc(var(--vn-tfx-amp) * -0.07em) calc(var(--vn-tfx-amp) * 0.03em); transform: none; }
  85% { translate: calc(var(--vn-tfx-amp) * -0.1em) 0; transform: skewX(10deg); }
  87% { translate: calc(var(--vn-tfx-amp) * 0.05em) 0; transform: none; }
  88% { translate: 0 0; }
}
@keyframes vn-tfx-glitch-flicker {
  0%, 62%, 64%, 85%, 88%, 100% { opacity: 1; }
  63% { opacity: 0.35; }
  86% { opacity: 0.55; }
}

/* ---- whisper: small, faint, slightly italic ------------------------------ */
[data-vn-text-fx="whisper"] {
  font-size: 0.88em;
  font-style: italic;
  letter-spacing: 0.03em;
  opacity: 0.8;
}

/* ---- shout: large and bold, letters punch in ----------------------------- */
[data-vn-text-fx="shout"] {
  font-size: 1.24em;
  font-weight: 800;
  letter-spacing: 0.015em;
  line-height: 1;
  --vn-tfx-enter: var(--vn-tfx-gate-motion, vn-tfx-shout-in);
  --vn-tfx-enter-dur: 0.32s;
  --vn-tfx-enter-ease: cubic-bezier(0.2, 0.9, 0.3, 1.25);
}
@keyframes vn-tfx-shout-in {
  0% { opacity: 0; scale: calc(1 + var(--vn-tfx-amp) * 0.8); }
  55% { opacity: 1; }
  100% { opacity: 1; scale: 1; }
}

/* ---- fade: letters drift in, then flicker like a ghost ------------------- */
[data-vn-text-fx="fade"] {
  --vn-tfx-enter: var(--vn-tfx-gate-motion, vn-tfx-fade-in);
  --vn-tfx-enter-dur: 1.2s;
  --vn-tfx-enter-ease: cubic-bezier(0.25, 0.6, 0.3, 1);
  --vn-tfx-flicker: var(--vn-tfx-gate-motion, vn-tfx-fade-ghost);
  --vn-tfx-flicker-dur: 3.6s;
  --vn-tfx-flicker-lag: 170ms;
}
@keyframes vn-tfx-fade-in {
  0% { opacity: 0; translate: 0 calc(var(--vn-tfx-amp) * -0.28em); filter: blur(0.12em); }
  100% { opacity: 1; translate: 0 0; filter: blur(0); }
}
@keyframes vn-tfx-fade-ghost {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.62; }
}

/* ---- light presets ------------------------------------------------------
   Dark ink on paper: deeper rainbow, a warm amber glow that keeps dark text,
   and a softer colour split. */
[data-vn-preset="paper-novel"] {
  --vn-text-fx-rainbow-mix: 90%;
  --vn-text-fx-rainbow-1: #c21f3c;
  --vn-text-fx-rainbow-2: #b04a00;
  --vn-text-fx-rainbow-3: #8a6500;
  --vn-text-fx-rainbow-4: #16793b;
  --vn-text-fx-rainbow-5: #05708f;
  --vn-text-fx-rainbow-6: #3349cc;
  --vn-text-fx-rainbow-7: #8130bd;
  --vn-text-fx-glow: #e8a33c;
  --vn-text-fx-glow-ink: 88%;
  --vn-text-fx-split-a: rgba(214, 0, 72, 0.55);
  --vn-text-fx-split-b: rgba(0, 150, 200, 0.55);
}

/* ---- off: effect spans read as plain text --------------------------------
   An "animated" or "static" container inside an "off" one opts back in. */
[data-vn-text-effects="off"] [data-vn-text-fx]:not([data-vn-text-effects="off"] :is([data-vn-text-effects="animated"], [data-vn-text-effects="static"]) *),
[data-vn-text-effects="off"] [data-vn-text-fx] [data-vn-text-fx-word]:not([data-vn-text-effects="off"] :is([data-vn-text-effects="animated"], [data-vn-text-effects="static"]) *),
[data-vn-text-effects="off"] [data-vn-text-fx] [data-vn-text-fx-ch]:not([data-vn-text-effects="off"] :is([data-vn-text-effects="animated"], [data-vn-text-effects="static"]) *) {
  display: inline;
  margin: 0;
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
  text-shadow: inherit;
  opacity: 1;
  filter: none;
  animation: none;
}
`;
