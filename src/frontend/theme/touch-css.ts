/**
 * Touch mode CSS (sprite-touch-ui.ts, docs/SPRITE_MODE.md "Touch"):
 * the hand cursor that follows the pointer over a character and plays the
 * touch where it lands, the short line in a bubble above the head, and the
 * heart gauges at the top of the stage. Interpolated into VN_BASE_CSS.
 * Motion "off" (`data-vn-touch-still`) and reduced motion keep all of it
 * still: the hand and the bubble appear and fade, nothing moves.
 */
export const VN_TOUCH_CSS = `
/* Over a character in touch mode, the drawn hand replaces the pointer. */
[data-vn-root][data-vn-touch="on"][data-vn-touch-hover] {
  cursor: none;
}
/* Phones: the hand button is its icon alone so five controls fit 360px (it keeps its name, "Touch mode"). */
@media (max-width: 640px) {
  [data-vn-root] [data-vn-controls] > [data-vn-control="touch"] {
    flex: 0 0 auto;
    /* Still a 44px touch target (the shared phone rule lets controls shrink to nothing). */
    min-width: 2.8rem;
    padding-right: 0.55rem;
    padding-left: 0.55rem;
  }
  [data-vn-root] [data-vn-control="touch"] [data-vn-control-label] {
    display: none;
  }
  /* Presets with word buttons and no icons keep the word. */
  [data-vn-root][data-vn-preset="cinema"] [data-vn-control="touch"] [data-vn-control-label],
  [data-vn-root][data-vn-preset="literature-club"] [data-vn-control="touch"] [data-vn-control-label] {
    display: inline;
  }
}
[data-vn-touch-layer] {
  position: absolute;
  inset: 0;
  z-index: 7;
  pointer-events: none;
  overflow: hidden;
}
/* The waiting screen's line-up is touchable too: the hand and the gauges go above it. */
[data-vn-root]:has(> [data-vn-waiting]:not([hidden])) [data-vn-touch-layer] {
  z-index: 12;
}
[data-vn-touch-layer][hidden] {
  display: none;
}
[data-vn-touch-cursor] {
  position: absolute;
  top: 0;
  left: 0;
  width: 3.2rem;
  height: 3.2rem;
  margin: -1.6rem 0 0 -1.6rem;
  opacity: 0;
  transition: opacity 140ms ease;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.35));
  will-change: transform;
}
[data-vn-touch-cursor][data-vn-touch-visible] {
  opacity: 1;
}
[data-vn-touch-cursor] svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  transform-origin: 50% 85%;
}
/* The finger's tip is the hot spot: lift the hand so the tip sits on the pointer. */
[data-vn-touch-cursor][data-vn-touch-hand="finger"] svg {
  translate: 0.3rem 1.2rem;
}
[data-vn-touch-cursor][data-vn-touch-hand="palm"] svg {
  translate: 0 0.6rem;
}

/* The line: a small speech bubble above the head. */
[data-vn-touch-bubble] {
  position: absolute;
  top: 0;
  left: 0;
  max-width: min(16rem, calc(100% - 2rem));
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--vn-chrome-border);
  border-radius: 0.9rem;
  background: var(--vn-panel-bg);
  color: var(--vn-text);
  font-size: calc(0.95rem * var(--vn-text-scale, 1));
  line-height: 1.3;
  text-align: center;
  white-space: normal;
  overflow-wrap: anywhere;
  box-shadow: 0 0.35rem 1rem rgba(0, 0, 0, 0.35);
  translate: -50% -100%;
  opacity: 1;
  transition: opacity 220ms ease;
}
[data-vn-touch-bubble]::after {
  content: "";
  position: absolute;
  left: var(--vn-touch-tail, 50%);
  bottom: -0.38rem;
  width: 0.7rem;
  height: 0.7rem;
  margin-left: -0.35rem;
  background: inherit;
  border-right: 1px solid var(--vn-chrome-border);
  border-bottom: 1px solid var(--vn-chrome-border);
  rotate: 45deg;
}
[data-vn-touch-bubble][data-vn-touch-out] {
  opacity: 0;
}
[data-vn-touch-bubble] [data-vn-touch-name] {
  display: block;
  font-size: 0.72em;
  letter-spacing: 0.04em;
  color: var(--vn-accent);
}
/* Read aloud between the name and the line, never shown. */
[data-vn-touch-bubble] [data-vn-touch-sep] {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* Heart gauges: one per character on stage while touch mode is on. */
[data-vn-touch-hud] {
  position: absolute;
  z-index: 6;
  top: max(0.85rem, env(safe-area-inset-top));
  left: 50%;
  translate: -50% 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.35rem;
  max-width: calc(100% - 8.5rem);
  margin: 0;
  padding: 0;
  list-style: none;
  pointer-events: auto;
}
[data-vn-touch-gauge] {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.3rem 0.2rem 0.45rem;
  border: 1px solid var(--vn-chrome-border);
  border-radius: 999px;
  background: var(--vn-chrome-bg);
  color: var(--vn-chrome-text);
  font-size: 0.78rem;
  line-height: 1.2;
  backdrop-filter: blur(0.6rem);
  white-space: nowrap;
}
[data-vn-touch-heart] {
  position: relative;
  display: inline-block;
  width: 1.15rem;
  height: 1.15rem;
  flex: none;
}
[data-vn-touch-heart] svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
/* The filled heart, cut from the bottom up to the bond. */
[data-vn-touch-heart] svg + svg {
  clip-path: inset(calc((1 - var(--vn-touch-bond, 0)) * 100%) 0 0 0);
  transition: clip-path 420ms ease;
}
[data-vn-touch-gauge] [data-vn-touch-gauge-name] {
  color: var(--vn-text);
  max-width: 7rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
[data-vn-touch-gauge] [data-vn-touch-tier] {
  opacity: 0.8;
}
[data-vn-touch-refresh] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.9rem;
  height: 1.9rem;
  padding: 0 0.45rem;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
[data-vn-touch-refresh]:hover:not(:disabled) {
  background: var(--vn-chrome-hover);
}
[data-vn-touch-refresh]:focus-visible {
  outline: 2px solid var(--vn-focus-ring);
  outline-offset: 1px;
}
[data-vn-touch-refresh]:disabled {
  opacity: 0.6;
  cursor: progress;
}
[data-vn-touch-refresh][data-vn-touch-lines="failed"] {
  color: #ffb4a8;
}
@media (pointer: coarse), (max-width: 640px) {
  [data-vn-touch-refresh] {
    min-width: 2.8rem;
    height: 2.8rem;
  }
  [data-vn-touch-hud] {
    max-width: calc(100% - 7.5rem);
  }
  [data-vn-touch-gauge] [data-vn-touch-tier] {
    display: none;
  }
}

@media (prefers-reduced-motion: no-preference) {
  [data-vn-touch-layer]:not([data-vn-touch-still]) [data-vn-touch-cursor][data-vn-touch-anim="pat"] svg { animation: vn-touch-pat 460ms ease-in-out; }
  [data-vn-touch-layer]:not([data-vn-touch-still]) [data-vn-touch-cursor][data-vn-touch-anim="stroke"] svg { animation: vn-touch-stroke 520ms ease-in-out; }
  [data-vn-touch-layer]:not([data-vn-touch-still]) [data-vn-touch-cursor][data-vn-touch-anim="squish"] svg { animation: vn-touch-squish 460ms ease-in-out; }
  [data-vn-touch-layer]:not([data-vn-touch-still]) [data-vn-touch-cursor][data-vn-touch-anim="poke"] svg { animation: vn-touch-poke 360ms ease-out; }
  [data-vn-touch-layer]:not([data-vn-touch-still]) [data-vn-touch-cursor][data-vn-touch-anim="huff"] svg { animation: vn-touch-poke 360ms ease-out; }
  [data-vn-touch-layer]:not([data-vn-touch-still]) [data-vn-touch-bubble][data-vn-touch-in] {
    animation: vn-touch-bubble-in 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  /* The waiting screen's line-up figures answer a touch like the sprites (sprite-css.ts keyframes). */
  [data-vn-waiting][data-vn-waiting-motion="true"] [data-vn-figure-touch="pat"] [data-vn-figure-body] { animation: vn-sprite-touch-pat 520ms cubic-bezier(0.3, 0.7, 0.4, 1) both; }
  [data-vn-waiting][data-vn-waiting-motion="true"] [data-vn-figure-touch="stroke"] [data-vn-figure-body] { animation: vn-sprite-touch-stroke 520ms ease-in-out both; }
  [data-vn-waiting][data-vn-waiting-motion="true"] [data-vn-figure-touch="squish"] [data-vn-figure-body] { animation: vn-sprite-touch-squish 520ms ease-out both; }
  [data-vn-waiting][data-vn-waiting-motion="true"] [data-vn-figure-touch="poke"] [data-vn-figure-body] { animation: vn-sprite-touch-poke 520ms cubic-bezier(0.25, 1, 0.5, 1) both; }
  [data-vn-waiting][data-vn-waiting-motion="true"] [data-vn-figure-touch="huff"] [data-vn-figure-body] { animation: vn-sprite-touch-huff 520ms linear both; }
}

@keyframes vn-touch-pat {
  0%, 100% { transform: none; }
  25% { transform: translateY(0.35rem) scale(1.04, 0.94); }
  50% { transform: translateY(-0.2rem); }
  75% { transform: translateY(0.3rem) scale(1.03, 0.96); }
}
@keyframes vn-touch-stroke {
  0%, 100% { transform: none; }
  35% { transform: translateX(-0.45rem) rotate(-8deg); }
  70% { transform: translateX(0.45rem) rotate(8deg); }
}
@keyframes vn-touch-squish {
  0%, 100% { transform: none; }
  40% { transform: scale(0.82, 1.04); }
  70% { transform: scale(0.92, 1); }
}
@keyframes vn-touch-poke {
  0%, 100% { transform: none; }
  35% { transform: translate(-0.25rem, -0.45rem) scale(0.92); }
}
@keyframes vn-touch-bubble-in {
  from { opacity: 0; scale: 0.85; }
  to { opacity: 1; scale: 1; }
}
`;
