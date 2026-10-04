import { VN_EFFECTS_CSS } from "./effects-css.js";
import { VN_TEXT_EFFECTS_CSS } from "./text-effects-css.js";

export const VN_BASE_CSS = `
:host {
  --vn-accent: #d8a8ff;
  --vn-text: #fff;
  --vn-muted-text: rgba(255, 255, 255, 0.76);
  --vn-dialogue-bg: linear-gradient(180deg, rgba(21, 16, 33, 0.78), rgba(8, 9, 15, 0.94));
  --vn-dialogue-border: rgba(255, 255, 255, 0.3);
  --vn-dialogue-width: min(72rem, calc(100 * var(--vn-vw, 1vw) - 3rem));
  --vn-font-family: ui-rounded, "Segoe UI", system-ui, sans-serif;
  --vn-dialogue-font-size: clamp(1rem, 1.1 * var(--vn-vw, 1vw) + 0.75rem, 1.35rem);
  --vn-transition-duration: 280ms;
  /* Reader text size multiplier (config textScale); the host sets it on the root. */
  --vn-text-scale: 1;
  /* Height of a toolbar chip. Grows to a 44px touch target on coarse pointers. */
  --vn-control-size: 2rem;
  display: block;
  width: 100%;
  height: 100%;
  font-family: var(--vn-font-family);
  color: var(--vn-text);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

button,
textarea {
  font: inherit;
}

[hidden] {
  display: none !important;
}

/* Typewriter: untyped text keeps its place in the layout (so lines never
   re-wrap while typing) but is not painted until it is revealed. */
[data-vn-typing-rest],
[data-vn-typing-pending] {
  visibility: hidden !important;
}

[data-vn-root] {
  /*
   * Chrome tokens. Declared on the root (not :host) so a preset that changes
   * --vn-accent / --vn-text on the root also re-derives these. Presets may set
   * any of them directly; custom CSS can too.
   */
  --vn-accent-contrast: #160d1f;
  --vn-focus-ring: var(--vn-accent);
  --vn-chrome-bg: rgba(13, 12, 22, 0.8);
  --vn-chrome-border: rgba(255, 255, 255, 0.18);
  --vn-chrome-text: var(--vn-muted-text);
  --vn-chrome-hover: rgba(255, 255, 255, 0.1);
  --vn-control-radius: 999px;
  --vn-panel-bg: rgba(14, 13, 24, 0.86);
  --vn-panel-solid: #12101d;
  --vn-panel-border: rgba(255, 255, 255, 0.16);
  /* Text drawn straight on the scene (Your turn heading, hint, move groups). */
  --vn-overlay-text: var(--vn-text);
  --vn-overlay-muted: var(--vn-muted-text);
  --vn-odds-good: #86e3a6;
  --vn-odds-fair: #f2d27e;
  --vn-odds-poor: #f4a0a0;
  --vn-interaction-width: min(42rem, 100%);
  --vn-composer-width: min(48rem, 100%);
  /* Space kept free above the dialogue box for the reply area. */
  --vn-interaction-clearance: calc(11.5rem + var(--vn-nameplate-lift, 0rem));
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 100%;
  min-height: calc(100 * var(--vn-dvh, 1dvh));
  overflow: hidden;
  background: #08090d;
  touch-action: manipulation;
}

[data-vn-scene] {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* Establish a stacking context so the readability scrim (z-index 3) stays
     beneath the dialogue box (z-index 2) instead of painting over it. */
  isolation: isolate;
  background:
    radial-gradient(circle at 50% 35%, rgba(73, 58, 91, 0.55), transparent 48%),
    #08090d;
}

[data-vn-scene-image] {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
  opacity: 1;
  user-select: none;
  -webkit-user-drag: none;
  transform: scale(1);
  transform-origin: center center;
  transition: opacity var(--vn-transition-duration, 280ms) ease, transform 2s ease;
}

[data-vn-scene-image][data-vn-layer="active"] {
  z-index: 1;
}

[data-vn-scene-image][data-vn-layer="incoming"] {
  z-index: 2;
}

/*
 * User-selectable scene-image fit. The stage sets data-vn-scene-image-fit on
 * the image element whenever the saved config changes, so object-fit always
 * reflects the persisted setting (cover is the backward-compatible default).
 */
[data-vn-scene-image][data-vn-scene-image-fit="contain"] {
  object-fit: contain;
}

[data-vn-scene-image][data-vn-scene-image-fit="fill"] {
  object-fit: fill;
}

[data-vn-scene-image][data-vn-scene-image-fit="none"] {
  object-fit: none;
}

[data-vn-scene-image][data-vn-scene-image-fit="scale-down"] {
  object-fit: scale-down;
}

[data-vn-scene-image][data-vn-empty="true"] {
  opacity: 0;
  pointer-events: none;
}

/*
 * Camera zoom / push-in: CSS transform on scene image (scale 1.12 with smooth 2s ease)
 */
[data-vn-scene-image].vn-zoom-in,
[data-vn-scene-image][data-vn-zoom="in"],
[data-vn-scene].vn-zoom-in [data-vn-scene-image],
[data-vn-scene][data-vn-zoom="in"] [data-vn-scene-image],
[data-vn-root].vn-zoom-in [data-vn-scene-image],
[data-vn-root][data-vn-zoom="in"] [data-vn-scene-image],
[data-vn-root][data-vn-effect="zoom_in"] [data-vn-scene-image] {
  transform: scale(1.12);
}

[data-vn-scrim] {
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.2), transparent 30%),
    linear-gradient(0deg, rgba(0, 0, 0, 0.72), transparent 45%);
}

/*
 * Screen flashes: Fullscreen overlay <div data-vn-flash> supporting white flash,
 * red flash, and fade to black.
 */
[data-vn-flash] {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  opacity: 0;
}

/*
 * Shared framework-owned ornament layer. It is a direct child of the root,
 * sits above the scene and below the narrative/interaction content, never
 * intercepts clicks, and is invisible to assistive tech. Each preset reveals
 * only its own group via a scoped rule in its own CSS block.
 */
[data-vn-ornaments] {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
  color: var(--vn-accent);
}

[data-vn-ornaments] svg {
  display: block;
  width: 100%;
  height: 100%;
}

/* Only the active preset's ornament group is shown (see presets.ts). */
[data-vn-ornament-group] {
  display: none;
}

[data-vn-status-stack] {
  position: absolute;
  z-index: 3;
  /* The Panels launcher (panel-dock) sits at the top-left corner, 44px tall at
     12px from the top. Start the status badges below it so they are never
     covered by that button. */
  --vn-status-top-clearance: 3.6rem;
  top: calc(max(0.85rem, env(safe-area-inset-top)) + var(--vn-status-top-clearance));
  left: max(0.85rem, env(safe-area-inset-left));
  display: flex;
  max-width: min(36rem, calc(100 * var(--vn-vw, 1vw) - 10rem));
  flex-wrap: wrap;
  gap: 0.45rem;
  pointer-events: none;
}

/* While the reply area is open, keep status cards in the left margin beside it. */
[data-vn-root]:has([data-vn-interaction]:not([hidden])) [data-vn-status-stack] {
  z-index: 5;
  max-width: clamp(16rem, calc((100 * var(--vn-vw, 1vw) - 42rem) / 2 - 1.75rem), 28rem);
}

[data-vn-badge] {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2rem;
  padding: 0.38rem 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(8, 9, 15, 0.78);
  color: var(--vn-text);
  font-size: 0.82rem;
  font-weight: 500;
  line-height: 1.2;
  box-shadow: 0 0.2rem 0.8rem rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(0.7rem);
  user-select: none;
  transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease, border-color 160ms ease;
}

[data-vn-badge-icon] {
  display: inline-block;
  flex-shrink: 0;
  width: 0.95rem;
  height: 0.95rem;
  vertical-align: middle;
}

[data-vn-badge-icon="spinner"] {
  color: var(--vn-accent);
  animation: vn-spin 1.4s linear infinite;
  transform-origin: center;
}

[data-vn-badge-icon="spinner"] .vn-spinner-head {
  animation: vn-spinner-dash 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  transform-origin: center;
}

[data-vn-badge-icon="image"] {
  color: #93c5fd;
  animation: vn-pulse 1.35s ease-in-out infinite;
}

[data-vn-badge-icon="check"] {
  color: #86efac;
}

[data-vn-badge-icon="alert"] {
  color: #fde047;
}

[data-vn-badge-icon="reroll"] {
  color: var(--vn-accent);
  transition: transform 300ms ease;
}

[data-vn-badge-kind="loading"] {
  border-color: rgba(216, 168, 255, 0.38);
  background: linear-gradient(135deg, rgba(25, 18, 38, 0.88), rgba(8, 9, 15, 0.92));
}

[data-vn-badge-kind="loading"]:not(:has([data-vn-badge-icon]))::before {
  width: 0.72rem;
  height: 0.72rem;
  margin-right: 0.45rem;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: var(--vn-accent);
  border-radius: 50%;
  content: "";
  animation: vn-spin 800ms linear infinite;
}

[data-vn-badge-kind="image"] {
  border-color: rgba(147, 197, 253, 0.42);
  background: linear-gradient(135deg, rgba(16, 26, 44, 0.88), rgba(8, 12, 20, 0.92));
  color: #dbeafe;
}

[data-vn-badge-kind="success"] {
  border-color: rgba(74, 222, 128, 0.45);
  background: linear-gradient(135deg, rgba(14, 34, 22, 0.88), rgba(6, 18, 12, 0.92));
  color: #bbf7d0;
}

[data-vn-badge-kind="warning"] {
  border-color: rgba(251, 191, 36, 0.5);
  background: linear-gradient(135deg, rgba(38, 28, 10, 0.88), rgba(20, 14, 6, 0.92));
  color: #fef08a;
}

[data-vn-badge-kind="reroll"] {
  border-color: rgba(216, 168, 255, 0.45);
  background: linear-gradient(135deg, rgba(30, 20, 48, 0.92), rgba(12, 10, 22, 0.94));
  color: var(--vn-text);
  cursor: pointer;
  pointer-events: auto;
}

[data-vn-badge][data-vn-badge-interactive="true"],
button[data-vn-badge] {
  cursor: pointer;
  pointer-events: auto;
}

[data-vn-badge][data-vn-badge-interactive="true"]:hover,
button[data-vn-badge]:hover {
  border-color: var(--vn-accent);
  background: linear-gradient(135deg, rgba(48, 30, 76, 0.95), rgba(20, 15, 34, 0.95));
  transform: translateY(-1px);
  box-shadow: 0 0.35rem 1.1rem rgba(0, 0, 0, 0.35), 0 0 0.75rem rgba(216, 168, 255, 0.25);
}

[data-vn-badge][data-vn-badge-interactive="true"]:hover [data-vn-badge-icon="reroll"],
button[data-vn-badge]:hover [data-vn-badge-icon="reroll"] {
  transform: rotate(180deg);
}

[data-vn-badge][data-vn-badge-interactive="true"]:active,
button[data-vn-badge]:active {
  transform: translateY(0);
}

[data-vn-badge-kind="error"] {
  align-items: flex-start;
  max-width: min(28rem, 100%);
  padding: 0.7rem 0.9rem;
  border-color: rgba(255, 132, 151, 0.7);
  border-radius: 0.8rem;
  background: rgba(62, 10, 23, 0.9);
  color: #fecdd3;
  pointer-events: auto;
  user-select: text;
}

[data-vn-badge-kind="error"] [data-vn-badge-icon] {
  margin-top: 0.15rem;
}

/* Errors keep a red edge, title and icon in every preset (presets restyle the card itself). */
[data-vn-badge-kind="error"] {
  position: relative;
  padding-left: 1.05rem;
}

[data-vn-badge-kind="error"]::before {
  position: absolute;
  top: 0.65rem;
  bottom: 0.65rem;
  left: 0.3rem;
  width: 3px;
  border-radius: 3px;
  background: var(--vn-error, #ff8497);
  content: "";
}

[data-vn-badge-kind="error"] [data-vn-badge-icon="alert"] {
  color: var(--vn-error, #ff8497);
}

[data-vn-badge-kind="error"] [data-vn-badge-title] {
  color: var(--vn-error-title, #ffc2cc);
}

[data-vn-badge-body] {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

[data-vn-badge-title] {
  color: #fff;
  font-size: 0.86rem;
  font-weight: 750;
}

[data-vn-badge-kind="error"] [data-vn-badge-text] {
  font-weight: 450;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

[data-vn-badge-details] {
  font-size: 0.76rem;
}

[data-vn-badge-details] summary {
  cursor: pointer;
  color: rgba(254, 205, 211, 0.85);
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

[data-vn-badge-details] pre {
  max-height: 9rem;
  margin: 0.35rem 0 0;
  padding: 0.5rem 0.6rem;
  overflow: auto;
  border-radius: 0.4rem;
  background: rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.85);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.72rem;
  line-height: 1.4;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

[data-vn-badge-actions] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.7rem;
  margin-top: 0.15rem;
}

[data-vn-badge-action] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 2.1rem;
  padding: 0.35rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.08));
  color: #fff;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 0.2rem 0.6rem rgba(0, 0, 0, 0.25);
  transition: background-color 140ms ease, border-color 140ms ease, transform 140ms ease;
}

[data-vn-badge-action]:hover {
  border-color: #fff;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.14));
}

[data-vn-badge-action]:active {
  transform: translateY(1px) scale(0.98);
}

[data-vn-badge-note] {
  color: rgba(254, 205, 211, 0.85);
  font-size: 0.76rem;
  font-weight: 450;
}

@media (pointer: coarse), (max-width: 640px) {
  /* 2.8rem = 44.8px: stays >= 44px after device-pixel rounding on 2.x/3x screens. */
  [data-vn-badge-action] {
    min-height: 2.8rem;
  }

  [data-vn-badge][data-vn-badge-interactive="true"],
  button[data-vn-badge] {
    min-height: 2.8rem;
  }
}

[data-vn-narrative] {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  place-items: end center;
  padding:
    1.5rem
    max(1.5rem, env(safe-area-inset-right))
    max(1.5rem, env(safe-area-inset-bottom))
    max(1.5rem, env(safe-area-inset-left));
  pointer-events: none;
}

[data-vn-dialogue] {
  position: relative;
  width: var(--vn-dialogue-width);
  min-height: 8.5rem;
  padding: 1.6rem 4rem 1.45rem 1.8rem;
  border: 1px solid var(--vn-dialogue-border);
  border-radius: 1rem;
  background: var(--vn-dialogue-bg);
  box-shadow:
    0 1.2rem 3rem rgba(0, 0, 0, 0.45),
    0 0.2rem 0.6rem rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(1.2rem) saturate(1.15);
  pointer-events: auto;
}

[data-vn-speaker] {
  position: absolute;
  top: -1.35rem;
  left: 1.8rem;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  min-height: 2.1rem;
  padding: 0.34rem 1.15rem;
  border: 1px solid color-mix(in srgb, var(--vn-accent) 40%, var(--vn-dialogue-border));
  border-radius: 0.55rem;
  background: var(--vn-dialogue-bg);
  color: var(--vn-accent);
  font-size: 0.88rem;
  font-weight: 750;
  letter-spacing: 0.12em;
  line-height: 1.2;
  text-transform: uppercase;
  box-shadow:
    0 0.35rem 1rem rgba(0, 0, 0, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -2px 0 color-mix(in srgb, var(--vn-accent) 65%, transparent);
  backdrop-filter: blur(1.2rem);
}

[data-vn-speaker][hidden] {
  display: none !important;
}

[data-vn-dialogue-text] {
  margin: 0;
  color: var(--vn-text);
  font-size: calc(var(--vn-dialogue-font-size) * var(--vn-text-scale, 1));
  line-height: 1.6;
  letter-spacing: 0.005em;
  text-wrap: pretty;
  white-space: pre-wrap;
}

[data-vn-dialogue-text] em,
[data-vn-dialogue-text] i {
  font-style: italic;
}

[data-vn-dialogue-text] strong,
[data-vn-dialogue-text] b {
  font-weight: 700;
}

[data-vn-dialogue-text] code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  padding: 0.1em 0.35em;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 0.25rem;
}

[data-vn-dialogue-text] del,
[data-vn-dialogue-text] s {
  text-decoration: line-through;
}

[data-vn-dialogue-text] mark {
  background: rgba(255, 220, 100, 0.35);
  color: inherit;
  padding: 0.1em 0.25em;
  border-radius: 0.2rem;
}

[data-vn-dialogue-text] u {
  text-decoration: underline;
}

[data-vn-dialogue-text] .vn-transmission {
  font-style: italic;
  opacity: 0.72;
  color: var(--vn-muted-text, #9ca3af);
  filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.15));
}

[data-vn-dialogue-footer] {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem 0.9rem;
  margin-top: 0.75rem;
  min-height: 1.1rem;
}

[data-vn-progress] {
  display: block;
  color: var(--vn-muted-text);
  font-size: 0.78rem;
}

/* Plain-words playback state: "Auto play on", "Skipping text you have read", ... */
[data-vn-reading-state] {
  display: inline-block;
  color: var(--vn-accent);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

[data-vn-reading-state][data-vn-playback="skip-stopped"] {
  color: var(--vn-muted-text);
  font-weight: 500;
}

[data-vn-continue] {
  position: absolute;
  right: 1rem;
  bottom: 1rem;
  display: grid;
  width: 2.4rem;
  height: 2.4rem;
  place-items: center;
  padding: 0;
  border: 1px solid var(--vn-chrome-border);
  border-radius: 999px;
  background:
    radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.16), transparent 70%),
    var(--vn-chrome-bg);
  color: var(--vn-accent);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  box-shadow: 0 0.25rem 0.8rem rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  transform: translateY(6px);
  transition:
    opacity 240ms ease,
    transform 240ms cubic-bezier(0.175, 0.885, 0.32, 1.275),
    border-color 160ms ease,
    box-shadow 160ms ease;
}

/* A drawn chevron (no font glyph), so it stays crisp in every font stack. */
[data-vn-continue]::before {
  display: block;
  width: 0.5rem;
  height: 0.5rem;
  margin-top: -0.22rem;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  border-radius: 0 0 1px 0;
  content: "";
  transform: rotate(45deg);
}

[data-vn-continue][data-vn-ready="true"] {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

/* The control keeps its place while it cannot advance; it only fades. */
[data-vn-continue]:disabled {
  cursor: default;
  animation: none;
}

[data-vn-continue][data-vn-ready="true"]:hover {
  border-color: var(--vn-accent);
  box-shadow: 0 0.25rem 0.8rem rgba(0, 0, 0, 0.3), 0 0 0 3px color-mix(in srgb, var(--vn-accent) 22%, transparent);
  animation: none;
}

[data-vn-continue][data-vn-ready="true"]:active {
  transform: translateY(1px) scale(0.94);
}

@keyframes vn-continue-bob {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}

[data-vn-continue]:focus-visible,
[data-vn-submit]:focus-visible,
[data-vn-input]:focus-visible,
[data-vn-badge]:focus-visible,
[data-vn-badge-action]:focus-visible,
[data-vn-badge-details] summary:focus-visible {
  outline: 3px solid var(--vn-focus-ring);
  outline-offset: 3px;
}

/* Choices sit in a scrolling list; a tighter ring stays inside its padding. */
[data-vn-choice]:focus-visible {
  outline: 3px solid var(--vn-focus-ring);
  outline-offset: 2px;
}

/* The reply field shows its focus with a softer ring: it is focused on arrival. */
[data-vn-input]:focus-visible {
  outline-width: 2px;
  outline-offset: 2px;
}

[data-vn-interaction] {
  position: absolute;
  z-index: 4;
  inset: 0;
  display: grid;
  align-content: safe center;
  justify-items: center;
  gap: 0.85rem;
  /* The bottom padding keeps the reply area above the dialogue box, so the
     last line stays readable while the reader chooses. */
  padding:
    max(4.5rem, env(safe-area-inset-top))
    max(1.25rem, env(safe-area-inset-right))
    calc(var(--vn-interaction-clearance) + env(safe-area-inset-bottom, 0px))
    max(1.25rem, env(safe-area-inset-left));
  overflow-y: auto;
  background:
    radial-gradient(ellipse 70% 60% at 50% 45%, rgba(4, 5, 9, 0.42), transparent 75%),
    linear-gradient(180deg, rgba(4, 5, 9, 0.18), rgba(4, 5, 9, 0.38));
  /* The scrim is only a visual; the reading toolbar beneath stays clickable. */
  pointer-events: none;
}

[data-vn-interaction] > * {
  pointer-events: auto;
}

/* Mid-size screens: status cards and a centred reply area would collide, so
   the reply area settles just above the dialogue box instead. */
@media (min-width: 641px) and (max-width: 1180px) {
  [data-vn-root]:has([data-vn-status-stack] > *) [data-vn-interaction] {
    align-content: safe end;
  }
}

/* "Your turn" heading: names the hand-off from reading to replying. */
[data-vn-interaction-heading] {
  display: grid;
  gap: 0.3rem;
  width: var(--vn-interaction-width);
  padding: 0 0.35rem;
  text-align: left;
  pointer-events: none;
}

[data-vn-interaction-title] {
  display: flex;
  align-items: center;
  gap: 0.65em;
  margin: 0;
  color: var(--vn-overlay-text);
  font-size: 0.86rem;
  font-weight: 750;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55), 0 2px 14px rgba(0, 0, 0, 0.55);
}

[data-vn-interaction-title]::before {
  flex: none;
  width: 0.55em;
  height: 0.55em;
  border-radius: 999px;
  background: var(--vn-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vn-accent) 22%, transparent), 0 0 0.7rem var(--vn-accent);
  content: "";
}

/* A fading rule after the words ties the heading to the panel below. */
[data-vn-interaction-title]::after {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--vn-accent) 70%, transparent), transparent);
  content: "";
}

[data-vn-interaction-hint] {
  margin: 0;
  color: var(--vn-overlay-muted);
  font-size: 0.88rem;
  line-height: 1.4;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), 0 1px 10px rgba(0, 0, 0, 0.6);
}

[data-vn-interaction-hint]:empty {
  display: none;
}

/* Moves from a game-engine extension (Warp etc.): compact chips above the reply options. */
[data-vn-game-choices] {
  display: grid;
  width: var(--vn-interaction-width);
  max-height: min(34 * var(--vn-vh, 1vh), 20rem);
  gap: 0.6rem;
  padding: 0.3rem 0.35rem;
  overflow: auto;
}

[data-vn-game-group] {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

[data-vn-game-group-label] {
  flex-basis: 100%;
  color: var(--vn-overlay-muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6), 0 1px 8px rgba(0, 0, 0, 0.6);
}

[data-vn-game-choice] {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  min-height: 2.5rem;
  padding: 0.4rem 0.5rem 0.4rem 0.95rem;
  border: 1px solid var(--vn-chrome-border);
  border-radius: 999px;
  background-color: var(--vn-panel-bg);
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 70%);
  color: var(--vn-text);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 0.3rem 0.9rem rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(0.8rem);
  transition: transform 160ms ease, border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
}

/* Chips without odds keep even padding on both sides. */
[data-vn-game-choice]:not(:has([data-vn-game-odds])) {
  padding-right: 0.95rem;
}

[data-vn-game-choice]:hover:not(:disabled) {
  border-color: var(--vn-accent);
  background-color: color-mix(in srgb, var(--vn-accent) 16%, var(--vn-panel-solid));
  transform: translateY(-1px);
  box-shadow: 0 0.45rem 1.1rem rgba(0, 0, 0, 0.32), 0 0 0 3px color-mix(in srgb, var(--vn-accent) 16%, transparent);
}

[data-vn-game-choice]:active:not(:disabled) {
  transform: translateY(0) scale(0.97);
}

[data-vn-game-choice]:focus-visible {
  outline: 3px solid var(--vn-focus-ring);
  outline-offset: 3px;
}

[data-vn-game-choice]:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

[data-vn-game-odds] {
  --vn-odds: var(--vn-odds-fair);
  padding: 0.12rem 0.5rem;
  border: 1px solid color-mix(in srgb, var(--vn-odds) 45%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--vn-odds) 16%, transparent);
  color: var(--vn-odds);
  font-size: 0.74rem;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

[data-vn-game-odds="good"] { --vn-odds: var(--vn-odds-good); }
[data-vn-game-odds="fair"] { --vn-odds: var(--vn-odds-fair); }
[data-vn-game-odds="poor"] { --vn-odds: var(--vn-odds-poor); }

[data-vn-choice-list] {
  display: grid;
  width: var(--vn-interaction-width);
  max-height: min(calc(100 * var(--vn-dvh, 1dvh) - var(--vn-interaction-clearance) - 10rem), 42rem);
  gap: 0.7rem;
  margin: 0;
  padding: 0.5rem 0.65rem 0.5rem 0.4rem;
  overflow: auto;
  list-style: none;
}

/*
 * CYOA choices. A lit edge on the left (inset shadow, so presets keep both
 * pseudo-elements free) grows on hover and focus, the row slides a little
 * toward the reader, and a drawn chevron appears on the right.
 */
[data-vn-choice] {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  width: 100%;
  min-height: 3.3rem;
  padding: 0.8rem 1.15rem 0.8rem 1.4rem;
  border: 1px solid var(--vn-chrome-border);
  border-radius: 0.8rem;
  background-color: var(--vn-panel-bg);
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.07), transparent 65%);
  color: var(--vn-text);
  font-size: 1rem;
  font-weight: 560;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
  box-shadow:
    inset 3px 0 0 color-mix(in srgb, var(--vn-accent) 55%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 0.45rem 1.25rem rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(0.8rem);
  transition:
    transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
    border-color 160ms ease,
    background-color 160ms ease,
    box-shadow 200ms ease,
    color 160ms ease;
}

[data-vn-choice]::after {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  margin-left: auto;
  border-top: 2px solid currentColor;
  border-right: 2px solid currentColor;
  color: var(--vn-accent);
  content: "";
  opacity: 0;
  transform: translateX(-6px) rotate(45deg);
  transition: opacity 160ms ease, transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

[data-vn-choice]:hover:not(:disabled),
[data-vn-choice]:focus-visible {
  border-color: color-mix(in srgb, var(--vn-accent) 80%, white);
  background-color: color-mix(in srgb, var(--vn-accent) 18%, var(--vn-panel-solid));
  box-shadow:
    inset 5px 0 0 var(--vn-accent),
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    0 0.6rem 1.6rem rgba(0, 0, 0, 0.36),
    0 0 1.2rem color-mix(in srgb, var(--vn-accent) 22%, transparent);
}

[data-vn-choice]:hover:not(:disabled) {
  transform: translateX(4px);
}

[data-vn-choice]:hover:not(:disabled)::after,
[data-vn-choice]:focus-visible::after {
  opacity: 1;
  transform: translateX(0) rotate(45deg);
}

[data-vn-choice]:active:not(:disabled) {
  transform: translateX(4px) scale(0.985);
  transition-duration: 80ms;
}

[data-vn-choice]:disabled,
[data-vn-submit]:disabled,
[data-vn-input]:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

[data-vn-interaction]:has([data-vn-input-form]:not([hidden])) [data-vn-interaction-heading],
[data-vn-interaction]:has([data-vn-input-form]:not([hidden])) [data-vn-game-choices] {
  width: var(--vn-composer-width);
}

[data-vn-input-form] {
  display: grid;
  width: var(--vn-composer-width);
  gap: 0.7rem;
  padding: 0.85rem;
  border: 1px solid var(--vn-panel-border);
  border-radius: 1rem;
  background-color: var(--vn-panel-bg);
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 40%);
  box-shadow: 0 1rem 2.6rem rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(1rem);
}

[data-vn-input] {
  width: 100%;
  min-height: 6rem;
  max-height: calc(35 * var(--vn-vh, 1vh));
  resize: vertical;
  padding: 0.85rem 1rem;
  border: 1px solid var(--vn-chrome-border);
  border-radius: 0.65rem;
  background: rgba(0, 0, 0, 0.28);
  color: var(--vn-text);
  font-size: 1rem;
  line-height: 1.5;
  caret-color: var(--vn-accent);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

[data-vn-input]:focus {
  border-color: color-mix(in srgb, var(--vn-accent) 70%, transparent);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35), 0 0 0 3px color-mix(in srgb, var(--vn-accent) 18%, transparent);
}

[data-vn-input]::placeholder {
  color: var(--vn-muted-text);
  opacity: 0.85;
}

[data-vn-submit] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  justify-self: end;
  gap: 0.5rem;
  min-height: 2.75rem;
  padding: 0.55rem 1.05rem 0.55rem 1.3rem;
  border: 1px solid color-mix(in srgb, var(--vn-accent), white 28%);
  border-radius: 999px;
  background-color: var(--vn-accent);
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0) 55%);
  color: var(--vn-accent-contrast);
  font-weight: 750;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 0.35rem 1rem color-mix(in srgb, var(--vn-accent) 30%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
}

[data-vn-submit]:hover:not(:disabled) {
  filter: brightness(1.06);
  transform: translateY(-1px);
  box-shadow: 0 0.5rem 1.3rem color-mix(in srgb, var(--vn-accent) 42%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

[data-vn-submit]:active:not(:disabled) {
  transform: translateY(0) scale(0.97);
}

[data-vn-submit-icon] {
  display: inline-flex;
  transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

[data-vn-submit-icon] svg,
[data-vn-control-icon] svg,
[data-vn-backlog-close] svg,
[data-vn-empty-icon] svg {
  display: block;
  width: 1em;
  height: 1em;
  overflow: visible;
}

[data-vn-submit]:hover:not(:disabled) [data-vn-submit-icon] {
  transform: translateX(2px);
}

[data-vn-empty-state] {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 2rem;
  color: var(--vn-muted-text);
  text-align: center;
  pointer-events: none;
}

[data-vn-empty-card] {
  display: grid;
  justify-items: center;
  gap: 0.8rem;
  max-width: 27rem;
  padding: 1.5rem 1.75rem 1.6rem;
  border: 1px solid var(--vn-panel-border);
  border-radius: 1rem;
  background-color: var(--vn-panel-bg);
  box-shadow: 0 1rem 2.6rem rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(1rem);
}

[data-vn-empty-icon] {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--vn-accent) 40%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--vn-accent) 14%, transparent);
  color: var(--vn-accent);
  font-size: 1.25rem;
}

[data-vn-empty-text] {
  margin: 0;
  color: var(--vn-text);
  font-size: 0.95rem;
  line-height: 1.55;
  text-wrap: pretty;
}

@keyframes vn-spin {
  to { transform: rotate(1turn); }
}

@keyframes vn-spin-smooth {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@keyframes vn-spinner-dash {
  0% {
    stroke-dasharray: 1 55;
    stroke-dashoffset: 0;
  }
  50% {
    stroke-dasharray: 40 16;
    stroke-dashoffset: -12;
  }
  100% {
    stroke-dasharray: 1 55;
    stroke-dashoffset: -56.55;
  }
}

@media (max-width: 640px) {
  :host {
    --vn-dialogue-width: 100%;
    --vn-dialogue-font-size: 1rem;
  }

  [data-vn-root] {
    /* Leave the dialogue box and its toolbar reachable below the reply area. */
    --vn-interaction-clearance: calc(var(--vn-control-size) + 13rem + var(--vn-nameplate-lift, 0rem));
    --vn-interaction-width: 100%;
    --vn-composer-width: 100%;
  }

  [data-vn-narrative] {
    padding: 0.75rem max(0.75rem, env(safe-area-inset-right)) max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
  }

  [data-vn-dialogue] {
    min-height: 8rem;
    padding: 1.3rem 3.6rem 1.15rem 1.2rem;
    border-radius: 0.8rem;
  }

  [data-vn-interaction] {
    align-content: safe end;
    gap: 0.7rem;
    padding-top: max(3.75rem, env(safe-area-inset-top));
  }

  /* Status badges sit under the top bar; start the reply area below them. */
  [data-vn-root]:has([data-vn-status-stack] > *) [data-vn-interaction] {
    padding-top: calc(max(0.85rem, env(safe-area-inset-top)) + 7.25rem);
  }

  [data-vn-choice-list] {
    gap: 0.55rem;
    max-height: calc(100 * var(--vn-dvh, 1dvh) - var(--vn-interaction-clearance) - 8rem);
  }

  [data-vn-choice] {
    min-height: 3rem;
    padding: 0.7rem 1rem 0.7rem 1.2rem;
    font-size: 0.95rem;
  }

  [data-vn-input] {
    min-height: 5rem;
  }

  [data-vn-game-choices] {
    max-height: min(30 * var(--vn-vh, 1vh), 16rem);
    gap: 0.45rem;
    padding-right: 0;
    padding-left: 0;
  }

  [data-vn-game-group] {
    gap: 0.4rem;
  }

  [data-vn-game-choice] {
    min-height: 2.75rem;
    padding: 0.3rem 0.4rem 0.3rem 0.75rem;
    font-size: 0.85rem;
  }
}

@media (prefers-reduced-motion: no-preference) {
  [data-vn-scene-image] {
    transition: opacity var(--vn-transition-duration) ease;
  }

  /* "backwards" fill: the entrance never pins transform, so hover and press
     transforms keep working once it ends. */
  [data-vn-dialogue],
  [data-vn-choice],
  [data-vn-game-choices],
  [data-vn-input-form],
  [data-vn-empty-card] {
    animation: vn-enter var(--vn-transition-duration) cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  }

  [data-vn-choice-list] li:nth-child(2) [data-vn-choice] { animation-delay: 45ms; }
  [data-vn-choice-list] li:nth-child(3) [data-vn-choice] { animation-delay: 90ms; }
  [data-vn-choice-list] li:nth-child(4) [data-vn-choice] { animation-delay: 135ms; }
  [data-vn-choice-list] li:nth-child(n + 5) [data-vn-choice] { animation-delay: 180ms; }

  [data-vn-continue][data-vn-ready="true"]:not(:hover) {
    animation: vn-continue-bob 1.4s ease-in-out infinite;
  }

  [data-vn-control="skip"][data-vn-active="true"] [data-vn-control-icon] {
    animation: vn-skip-nudge 0.7s ease-in-out infinite;
  }

  @keyframes vn-skip-nudge {
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(2px); }
  }

  [data-vn-badge] {
    animation: vn-badge-enter 220ms ease backwards;
  }

  [data-vn-badge-icon="check"] {
    animation: vn-badge-pop 320ms cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
  }

  @keyframes vn-enter {
    from { opacity: 0; transform: translateY(0.6rem); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes vn-badge-enter {
    from { opacity: 0; transform: translateY(-0.35rem) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes vn-badge-pop {
    0% { transform: scale(0.5); opacity: 0; }
    65% { transform: scale(1.2); opacity: 1; }
    100% { transform: scale(1); }
  }

  @keyframes vn-pulse {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(0.22rem); }
  }

  /*
   * Shared decorative keyframes, referenced by preset CSS. All preset
   * animation is authored under this same no-preference media query and the
   * reduced-motion block below zeroes durations/iterations globally.
   */
  @keyframes vn-sparkle {
    0%, 100% { opacity: 0.4; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.15); }
  }

  @keyframes vn-glow-breathe {
    0%, 100% { box-shadow: 0 1rem 3rem rgba(80, 45, 10, 0.5), inset 0 0 0 1px rgba(255, 236, 196, 0.08); }
    50% { box-shadow: 0 1rem 3.4rem rgba(120, 70, 15, 0.6), inset 0 0 0 1px rgba(255, 236, 196, 0.14); }
  }

  @keyframes vn-chevron-bob {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(0.18rem); }
  }

  @keyframes vn-console-caret {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0; }
  }

  @keyframes vn-led-blink {
    0%, 60% { opacity: 1; }
    61%, 100% { opacity: 0.18; }
  }

  @keyframes vn-hud-scan {
    0% { transform: translateY(-8rem); }
    100% { transform: translateY(110%); }
  }

  @keyframes vn-noir-sweep {
    0% { transform: translateX(-130%) skewX(-12deg); }
    100% { transform: translateX(150%) skewX(-12deg); }
  }

  @keyframes vn-film-flicker {
    0%, 100% { opacity: 0.02; }
    50% { opacity: 0.06; }
  }

  /*
   * Ornament micro-motion. Only the active preset's group is displayed, and
   * these selectors live inside the ornaments layer, so they never animate
   * page content. data-vn-anim-delay staggers the twinkle.
   */
  [data-vn-ornaments] [data-vn-anim="sparkle"] {
    animation: vn-sparkle 2.4s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  [data-vn-ornaments] [data-vn-anim="led"] {
    animation: vn-led-blink 1.6s steps(1) infinite;
  }

  /* Effect intensity "off" also stills the decorative ornament twinkle. */
  [data-vn-root][data-vn-effect-intensity="off"] [data-vn-ornaments] [data-vn-anim] {
    animation: none;
  }

  [data-vn-anim-delay="0s"] { animation-delay: 0s; }
  [data-vn-anim-delay="0.6s"] { animation-delay: 0.6s; }
  [data-vn-anim-delay="1.2s"] { animation-delay: 1.2s; }
  [data-vn-anim-delay="1.8s"] { animation-delay: 1.8s; }
  [data-vn-anim-delay="0.3s"] { animation-delay: 0.3s; }

  /*
   * Camera & Screen Effects:
   * - Screen shake: Keyframe animation for impacts, earthquakes, shocks (300ms)
   * - Screen flashes: White and red fullscreen flashes
   * - Fade to black: Scene blackout transition
   */
  @keyframes vn-shake {
    0%, 100% {
      transform: translate3d(0, 0, 0);
    }
    15% {
      transform: translate3d(-4px, 2px, 0);
    }
    30% {
      transform: translate3d(4px, -3px, 0);
    }
    45% {
      transform: translate3d(-4px, -2px, 0);
    }
    60% {
      transform: translate3d(3px, 3px, 0);
    }
    75% {
      transform: translate3d(-2px, 1px, 0);
    }
    90% {
      transform: translate3d(2px, -1px, 0);
    }
  }

  .vn-shake,
  [data-vn-shake],
  [data-vn-root].vn-shake,
  [data-vn-root][data-vn-shake],
  [data-vn-scene].vn-shake,
  [data-vn-scene][data-vn-shake] {
    animation: vn-shake 300ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }

  @keyframes vn-flash-white {
    0% {
      opacity: 0.88;
      background-color: #ffffff;
    }
    100% {
      opacity: 0;
      background-color: #ffffff;
    }
  }

  @keyframes vn-flash-red {
    0% {
      opacity: 0.82;
      background-color: #e53935;
    }
    100% {
      opacity: 0;
      background-color: #e53935;
    }
  }

  @keyframes vn-fade-to-black {
    0% {
      opacity: 0;
      background-color: #000000;
    }
    35% {
      opacity: 1;
      background-color: #000000;
    }
    65% {
      opacity: 1;
      background-color: #000000;
    }
    100% {
      opacity: 0;
      background-color: #000000;
    }
  }

  [data-vn-flash].vn-flash-white,
  [data-vn-flash][data-vn-flash="white"] {
    background-color: #ffffff;
    animation: vn-flash-white 500ms cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
  }

  [data-vn-flash].vn-flash-red,
  [data-vn-flash][data-vn-flash="red"] {
    background-color: #e53935;
    animation: vn-flash-red 500ms cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
  }

  [data-vn-flash].vn-fade-to-black,
  [data-vn-flash][data-vn-flash="fade_to_black"],
  [data-vn-flash][data-vn-flash="black"] {
    background-color: #000000;
    animation: vn-fade-to-black 1000ms ease-in-out forwards;
  }
}

@media (prefers-reduced-motion: reduce) {
  /* Suppress disorienting vestibular camera motion effects while preserving UI loading spinners and timers */
  .vn-shake,
  [data-vn-shake],
  [data-vn-root].vn-shake,
  [data-vn-root][data-vn-shake],
  [data-vn-scene].vn-shake,
  [data-vn-scene][data-vn-shake] {
    animation: none !important;
    transform: none !important;
  }

  [data-vn-scene-image] {
    transform: none !important;
    transition: none !important;
  }

  [data-vn-scene-image].vn-zoom-in,
  [data-vn-scene-image][data-vn-zoom="in"],
  [data-vn-scene].vn-zoom-in [data-vn-scene-image],
  [data-vn-scene][data-vn-zoom="in"] [data-vn-scene-image],
  [data-vn-root].vn-zoom-in [data-vn-scene-image],
  [data-vn-root][data-vn-zoom="in"] [data-vn-scene-image],
  [data-vn-root][data-vn-effect="zoom_in"] [data-vn-scene-image] {
    transform: none !important;
    transition: none !important;
  }

  [data-vn-flash] {
    animation: none !important;
    opacity: 0 !important;
  }
}

/*
 * In-stage dialogue navigation & controls: Previous, Backlog, Auto-play, Skip.
 * The four buttons share one plate (a segmented strip) that straddles the
 * dialogue box's top edge. Each button carries a small inline-SVG icon and a
 * word; aria-pressed / data-vn-active mark Auto and Skip while they run.
 */
[data-vn-controls] {
  position: absolute;
  top: calc(-0.5 * var(--vn-control-size) - 0.55rem);
  right: 1.5rem;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding: 0.2rem;
  border: 1px solid var(--vn-chrome-border);
  border-radius: calc(var(--vn-control-radius) + 0.2rem);
  background: var(--vn-chrome-bg);
  box-shadow: 0 0.35rem 1.1rem rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(0.9rem) saturate(1.1);
  user-select: none;
}

@media (max-width: 640px) {
  [data-vn-controls] {
    /* Sit above the nameplate: strip height plus the nameplate overhang and a gap.
       On phones the strip spans the box so each button gets an even share. */
    top: calc(-1 * (var(--vn-control-size) + 2.15rem));
    right: 0.5rem;
    left: 0.5rem;
    gap: 0.1rem;
  }

  [data-vn-controls] > [data-vn-control] {
    flex: 1 1 0;
    min-width: 0;
  }

  /* Tighter word spacing so four labelled buttons fit 360px in every preset. */
  [data-vn-control] [data-vn-control-label] {
    font-size: min(1em, 0.74rem);
    font-variant: normal;
    letter-spacing: 0.02em;
    text-transform: none;
  }

  [data-vn-controls] > [data-vn-control] {
    padding-right: 0.4rem;
    padding-left: 0.4rem;
  }
}

/*
 * Touch: every reading control is at least 44 x 44 CSS px. Narrow screens
 * get the same size even when pointer emulation is missing, because they are
 * almost always touched. 2.8rem (44.8px) keeps a margin above 44px so
 * device-pixel rounding on 2.x/3x screens never reports 43.99px.
 */
@media (pointer: coarse), (max-width: 640px) {
  :host {
    --vn-control-size: 2.8rem;
  }

  [data-vn-control] {
    min-width: 2.8rem;
    padding-right: 0.7rem;
    padding-left: 0.7rem;
  }

  [data-vn-continue] {
    width: 2.8rem;
    height: 2.8rem;
  }

  [data-vn-backlog-close] {
    width: 2.8rem;
    height: 2.8rem;
  }
}

@media (max-width: 380px) {
  /* Very narrow phones: icons carry the meaning; labels stay for assistive tech via aria-label. */
  [data-vn-control] [data-vn-control-label] {
    font-size: 0.7rem;
  }

  [data-vn-control] {
    padding-right: 0.5rem;
    padding-left: 0.5rem;
  }
}

[data-vn-control] {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.38rem;
  min-height: var(--vn-control-size);
  padding: 0.25rem 0.7rem;
  border: 1px solid transparent;
  border-radius: var(--vn-control-radius);
  background: transparent;
  color: var(--vn-chrome-text);
  font-size: 0.76rem;
  font-weight: 650;
  letter-spacing: 0.03em;
  line-height: 1;
  text-transform: none;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 120ms ease;
}

[data-vn-control]:hover:not(:disabled) {
  background: var(--vn-chrome-hover);
  color: var(--vn-text);
}

[data-vn-control]:active:not(:disabled) {
  transform: scale(0.95);
}

[data-vn-control][data-vn-active="true"],
[data-vn-control][aria-pressed="true"] {
  border-color: color-mix(in srgb, var(--vn-accent), white 25%);
  background-color: var(--vn-accent);
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.25), rgba(255, 255, 255, 0) 60%);
  color: var(--vn-accent-contrast);
  font-weight: 750;
  box-shadow: 0 0 0.85rem color-mix(in srgb, var(--vn-accent) 50%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

[data-vn-control][data-vn-active="true"]:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--vn-accent), white 12%);
  color: var(--vn-accent-contrast);
}

[data-vn-control]:focus-visible {
  outline: 2px solid var(--vn-focus-ring);
  outline-offset: 2px;
}

[data-vn-control]:disabled {
  cursor: default;
  opacity: 0.4;
}

[data-vn-control-icon] {
  display: inline-flex;
  flex: none;
  font-size: 0.95rem;
  line-height: 1;
  opacity: 0.9;
}

/* While Auto runs, the countdown ring takes the play icon's place. */
[data-vn-control="auto"][data-vn-active="true"] [data-vn-control-icon] {
  display: none;
}

[data-vn-skip-description] {
  display: none;
}

/*
 * Auto-play animated countdown ring
 */
[data-vn-auto-ring] {
  display: none;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

[data-vn-control="auto"][data-vn-active="true"] [data-vn-auto-ring] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

[data-vn-auto-ring] svg {
  display: block;
  width: 14px;
  height: 14px;
}

.vn-auto-track {
  stroke: currentColor;
  opacity: 0.28;
}

.vn-auto-bar {
  stroke: currentColor;
  stroke-linecap: round;
  transform-origin: center;
  transform: rotate(-90deg);
}

/*
 * Fullscreen / Modal Dialogue History Backlog
 */
[data-vn-backlog] {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, color-mix(in srgb, var(--vn-accent) 10%, transparent), transparent 70%),
    rgba(8, 9, 15, 0.93);
  backdrop-filter: blur(1.5rem);
  padding: clamp(1.2rem, 3 * var(--vn-vw, 1vw), 3rem);
  color: var(--vn-text);
  animation: vn-fade-in 180ms ease forwards;
}

[data-vn-backlog][hidden] {
  display: none !important;
}

[data-vn-backlog-header] {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: min(52rem, 100%);
  margin: 0 auto 1rem;
  /* The outer "Back to chat" button owns the top-right corner; keep Close clear
     of it when the centred header reaches that corner. */
  padding: 0 clamp(0rem, calc(7.5rem - (100 * var(--vn-vw, 1vw) - 52rem) / 2), 7.5rem) 0.9rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--vn-accent) 35%, transparent);
}

[data-vn-backlog-title] {
  margin: 0;
  color: var(--vn-accent);
  font-size: 1.1rem;
  font-weight: 750;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

[data-vn-backlog-close] {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  padding: 0;
  border: 1px solid var(--vn-chrome-border);
  border-radius: 999px;
  background: var(--vn-chrome-bg);
  color: var(--vn-text);
  font-size: 1rem;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, transform 140ms ease;
}

[data-vn-backlog-close]:hover {
  border-color: var(--vn-accent);
  background: var(--vn-chrome-hover);
}

[data-vn-backlog-close]:active {
  transform: scale(0.94);
}

[data-vn-backlog-close]:focus-visible {
  outline: 2px solid var(--vn-focus-ring);
  outline-offset: 2px;
}

[data-vn-backlog-content] {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  width: min(52rem, 100%);
  margin: 0 auto;
  padding-right: 0.75rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}

[data-vn-backlog-content]:focus-visible {
  outline: 2px solid var(--vn-focus-ring);
  outline-offset: 4px;
  border-radius: 0.5rem;
}

[data-vn-backlog-content]::-webkit-scrollbar {
  width: 6px;
}

[data-vn-backlog-content]::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--vn-accent) 45%, transparent);
  border-radius: 3px;
}

[data-vn-backlog-item] {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.85rem 1.1rem 0.9rem 1.2rem;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.04);
  box-shadow: inset 3px 0 0 var(--vn-accent);
}

/* The newest entry (closest to the current line) reads a little brighter. */
[data-vn-backlog-item]:last-child {
  border-color: color-mix(in srgb, var(--vn-accent) 30%, transparent);
  background: color-mix(in srgb, var(--vn-accent) 7%, rgba(255, 255, 255, 0.03));
}

[data-vn-backlog-speaker] {
  color: var(--vn-accent);
  font-size: 0.78rem;
  font-weight: 750;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

[data-vn-backlog-text] {
  margin: 0;
  color: var(--vn-text);
  font-size: 1.02rem;
  line-height: 1.6;
}

@keyframes vn-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  [data-vn-backlog] {
    animation: none;
  }

  [data-vn-choice],
  [data-vn-game-choice],
  [data-vn-control],
  [data-vn-submit],
  [data-vn-continue],
  [data-vn-badge] {
    transition-property: background-color, border-color, color, box-shadow, opacity;
  }

  [data-vn-choice]:hover:not(:disabled),
  [data-vn-choice]:focus-visible,
  [data-vn-choice]:active:not(:disabled),
  [data-vn-game-choice]:hover:not(:disabled),
  [data-vn-submit]:hover:not(:disabled) {
    transform: none;
  }
}

${VN_EFFECTS_CSS}

${VN_TEXT_EFFECTS_CSS}
`;
