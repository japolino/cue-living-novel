/**
 * The exit control lives in this outer shadow root. User theme CSS is installed
 * in a nested shadow root and cannot select or hide the exit control.
 */
export const VN_OUTER_CSS = `
:host {
  /* Lumiverse scales its UI with body > * { zoom: var(--lumiverse-ui-scale) }.
     Plain viewport units are measured before that zoom, so a 90% UI scale would
     leave the stage covering 90% of the screen. Divide by the scale (the same
     pattern Lumiverse uses for its own full-screen layers) so the stage always
     covers the real viewport. */
  --vn-vw: calc(1vw / var(--lumiverse-ui-scale, 1));
  --vn-vh: calc(1vh / var(--lumiverse-ui-scale, 1));
  --vn-dvh: calc(1dvh / var(--lumiverse-ui-scale, 1));
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: block;
  width: calc(100 * var(--vn-vw));
  height: calc(100 * var(--vn-vh));
  height: calc(100 * var(--vn-dvh));
  overflow: hidden;
  color-scheme: dark;
}

[data-vn-shell] {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #08090d;
}

[data-vn-theme-host] {
  position: absolute;
  inset: 0;
  display: block;
}

[data-vn-exit] {
  position: absolute;
  z-index: 10;
  top: max(0.75rem, env(safe-area-inset-top));
  right: max(0.75rem, env(safe-area-inset-right));
  min-width: 2.8rem;
  min-height: 2.8rem;
  padding: 0.55rem 0.95rem;
  white-space: nowrap;
  border: 1px solid rgba(255, 255, 255, 0.65);
  border-radius: 999px;
  background: rgba(10, 11, 16, 0.82);
  color: #fff;
  font: 600 0.875rem/1 system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 0.25rem 1rem rgba(0, 0, 0, 0.35);
}

[data-vn-exit]:hover {
  background: rgba(36, 38, 48, 0.95);
}

[data-vn-exit]:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 3px;
}

@media (prefers-reduced-motion: no-preference) {
  [data-vn-exit] {
    transition: background-color 140ms ease, transform 140ms ease;
  }

  [data-vn-exit]:active {
    transform: scale(0.97);
  }
}
`;

