/**
 * The exit control lives in this outer shadow root. User theme CSS is installed
 * in a nested shadow root and cannot select or hide the exit control.
 */
export const VN_OUTER_CSS = `
:host {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: block;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
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
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding: 0.55rem 0.8rem;
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

