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
  background:
    radial-gradient(circle at 50% 35%, rgba(73, 58, 91, 0.55), transparent 48%),
    #08090d;
}

[data-vn-scene-image] {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
  opacity: 1;
  user-select: none;
  -webkit-user-drag: none;
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
}

[data-vn-scrim] {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.2), transparent 30%),
    linear-gradient(0deg, rgba(0, 0, 0, 0.72), transparent 45%);
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
  min-height: 2rem;
  padding: 0.38rem 0.7rem;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(8, 9, 15, 0.78);
  color: var(--vn-text);
  font-size: 0.82rem;
  box-shadow: 0 0.2rem 0.8rem rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(0.7rem);
}

[data-vn-badge-kind="loading"]::before {
  width: 0.72rem;
  height: 0.72rem;
  margin-right: 0.45rem;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: var(--vn-accent);
  border-radius: 50%;
  content: "";
  animation: vn-spin 800ms linear infinite;
}

[data-vn-badge-kind="error"] {
  border-color: rgba(255, 132, 151, 0.7);
  background: rgba(62, 10, 23, 0.88);
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
}

[data-vn-continue]::before {
  content: "\u25bc";
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

  @keyframes vn-enter {
    from { opacity: 0; transform: translateY(0.6rem); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes vn-pulse {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(0.22rem); }
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
`;

