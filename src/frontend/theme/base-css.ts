export const VN_BASE_CSS = `
:host {
  --vn-accent: #d8a8ff;
  --vn-text: #fff;
  --vn-muted-text: rgba(255, 255, 255, 0.76);
  --vn-dialogue-bg: linear-gradient(180deg, rgba(21, 16, 33, 0.78), rgba(8, 9, 15, 0.94));
  --vn-dialogue-border: rgba(255, 255, 255, 0.3);
  --vn-dialogue-width: min(72rem, calc(100vw - 3rem));
  --vn-font-family: ui-rounded, "Segoe UI", system-ui, sans-serif;
  --vn-dialogue-font-size: clamp(1rem, 1.1vw + 0.75rem, 1.35rem);
  --vn-transition-duration: 280ms;
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

[data-vn-root] {
  position: relative;
  isolation: isolate;
  width: 100%;
  height: 100%;
  min-height: 100dvh;
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
  top: max(0.85rem, env(safe-area-inset-top));
  left: max(0.85rem, env(safe-area-inset-left));
  display: flex;
  max-width: min(36rem, calc(100vw - 9rem));
  flex-wrap: wrap;
  gap: 0.45rem;
  pointer-events: none;
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
  border-color: rgba(255, 132, 151, 0.7);
  background: rgba(62, 10, 23, 0.88);
  color: #fecdd3;
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
  min-height: 9rem;
  padding: 1.6rem 4rem 1.55rem 1.7rem;
  border: 1px solid var(--vn-dialogue-border);
  border-radius: 1.1rem;
  background: var(--vn-dialogue-bg);
  box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(1rem);
  pointer-events: auto;
}

[data-vn-speaker] {
  display: block;
  margin: 0 0 0.55rem;
  color: var(--vn-accent);
  font-size: 0.95rem;
  font-weight: 750;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

[data-vn-dialogue-text] {
  margin: 0;
  color: var(--vn-text);
  font-size: var(--vn-dialogue-font-size);
  line-height: 1.55;
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

[data-vn-progress] {
  display: block;
  margin-top: 0.75rem;
  color: var(--vn-muted-text);
  font-size: 0.78rem;
}

[data-vn-continue] {
  position: absolute;
  right: 1rem;
  bottom: 1rem;
  display: grid;
  width: 2.4rem;
  height: 2.4rem;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.38);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--vn-text);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transform: translateY(6px);
  transition: opacity 240ms ease, transform 240ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

[data-vn-continue]::before {
  content: "\u25bc";
}

[data-vn-continue][data-vn-ready="true"] {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

@media (prefers-reduced-motion: no-preference) {
  [data-vn-continue][data-vn-ready="true"]:not(:hover) {
    animation: vn-continue-bob 1.5s ease-in-out infinite;
  }
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
[data-vn-choice]:focus-visible,
[data-vn-submit]:focus-visible,
[data-vn-input]:focus-visible {
  outline: 3px solid var(--vn-accent);
  outline-offset: 3px;
}

[data-vn-interaction] {
  position: absolute;
  z-index: 4;
  inset: 0;
  display: grid;
  place-items: center;
  padding:
    max(4.5rem, env(safe-area-inset-top))
    max(1.25rem, env(safe-area-inset-right))
    max(1.25rem, env(safe-area-inset-bottom))
    max(1.25rem, env(safe-area-inset-left));
  background: rgba(4, 5, 9, 0.34);
}

[data-vn-choice-list] {
  display: grid;
  width: min(46rem, 100%);
  max-height: min(70vh, 42rem);
  gap: 0.8rem;
  margin: 0;
  padding: 0.5rem;
  overflow: auto;
  list-style: none;
}

[data-vn-choice] {
  width: 100%;
  min-height: 3.4rem;
  padding: 0.85rem 1.2rem;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 0.85rem;
  background: rgba(16, 14, 26, 0.88);
  color: var(--vn-text);
  text-align: left;
  cursor: pointer;
  box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(0.8rem);
}

[data-vn-choice]:hover:not(:disabled) {
  border-color: var(--vn-accent);
  background: rgba(35, 27, 50, 0.96);
}

[data-vn-choice]:disabled,
[data-vn-submit]:disabled,
[data-vn-input]:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

[data-vn-input-form] {
  display: grid;
  width: min(52rem, 100%);
  gap: 0.8rem;
  padding: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 1rem;
  background: rgba(10, 10, 17, 0.9);
  box-shadow: 0 0.8rem 2.5rem rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(1rem);
}

[data-vn-input] {
  width: 100%;
  min-height: 7rem;
  max-height: 35vh;
  resize: vertical;
  padding: 0.9rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 0.7rem;
  background: rgba(255, 255, 255, 0.07);
  color: var(--vn-text);
  line-height: 1.5;
}

[data-vn-input]::placeholder {
  color: var(--vn-muted-text);
}

[data-vn-submit] {
  justify-self: end;
  min-height: 2.8rem;
  padding: 0.65rem 1.2rem;
  border: 1px solid color-mix(in srgb, var(--vn-accent), white 28%);
  border-radius: 999px;
  background: var(--vn-accent);
  color: #17101d;
  font-weight: 750;
  cursor: pointer;
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

  [data-vn-narrative] {
    padding: 0.75rem max(0.75rem, env(safe-area-inset-right)) max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
  }

  [data-vn-dialogue] {
    min-height: 8rem;
    padding: 1.2rem 3.5rem 1.15rem 1.15rem;
    border-radius: 0.8rem;
  }

  [data-vn-interaction] {
    place-items: end center;
    padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
  }

  [data-vn-choice-list] {
    width: 100%;
    max-height: 62vh;
  }

  [data-vn-input-form] {
    width: 100%;
  }
}

@media (prefers-reduced-motion: no-preference) {
  [data-vn-scene-image] {
    transition: opacity var(--vn-transition-duration) ease;
  }

  [data-vn-dialogue],
  [data-vn-choice],
  [data-vn-input-form] {
    animation: vn-enter var(--vn-transition-duration) ease both;
  }

  [data-vn-continue] {
    animation: vn-pulse 1.35s ease-in-out infinite;
  }

  [data-vn-badge] {
    animation: vn-badge-enter 220ms ease both;
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
 * In-stage dialogue navigation & controls: Backlog, Auto-play, Skip
 */
[data-vn-controls] {
  position: absolute;
  top: -2.3rem;
  right: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  z-index: 5;
  user-select: none;
}

[data-vn-control] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.28rem 0.68rem;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  background: rgba(14, 16, 26, 0.78);
  color: var(--vn-muted-text);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 0.15rem 0.6rem rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(0.5rem);
  transition: all 140ms ease;
}

[data-vn-control]:hover {
  background: rgba(36, 40, 60, 0.9);
  color: var(--vn-text);
  border-color: rgba(255, 255, 255, 0.45);
}

[data-vn-control][data-vn-active="true"] {
  background: var(--vn-accent);
  color: #0d0f17;
  border-color: var(--vn-accent);
  font-weight: 750;
  box-shadow: 0 0 0.75rem rgba(216, 168, 255, 0.45);
}

[data-vn-control]:focus-visible {
  outline: 2px solid var(--vn-accent);
  outline-offset: 2px;
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
  stroke: rgba(13, 15, 23, 0.25);
}

.vn-auto-bar {
  stroke: #0d0f17;
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
  background: rgba(8, 9, 15, 0.92);
  backdrop-filter: blur(1.5rem);
  padding: clamp(1.2rem, 3vw, 3rem);
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
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.16);
}

[data-vn-backlog-title] {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--vn-accent);
}

[data-vn-backlog-close] {
  display: grid;
  place-items: center;
  width: 2.2rem;
  height: 2.2rem;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: var(--vn-text);
  font-size: 1.1rem;
  cursor: pointer;
  transition: all 140ms ease;
}

[data-vn-backlog-close]:hover {
  background: rgba(255, 255, 255, 0.22);
  border-color: #fff;
  transform: scale(1.05);
}

[data-vn-backlog-close]:focus-visible {
  outline: 2px solid var(--vn-accent);
  outline-offset: 2px;
}

[data-vn-backlog-content] {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 1.2rem;
  padding-right: 0.75rem;
}

[data-vn-backlog-content]::-webkit-scrollbar {
  width: 6px;
}

[data-vn-backlog-content]::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.25);
  border-radius: 3px;
}

[data-vn-backlog-item] {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.85rem 1.1rem;
  border-radius: 0.75rem;
  background: rgba(255, 255, 255, 0.04);
  border-left: 3px solid var(--vn-accent);
}

[data-vn-backlog-speaker] {
  font-size: 0.85rem;
  font-weight: 750;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vn-accent);
}

[data-vn-backlog-text] {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.5;
  color: var(--vn-text);
}

@keyframes vn-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

