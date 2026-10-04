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
  /*
   * Shell chrome tokens. The stage mirrors the active preset onto this element
   * (data-vn-preset), so framework chrome that lives outside the theme root
   * (Back to chat, the Panels layer, the speech dock) matches the preset.
   * Custom properties inherit into those nested shadow roots. User CSS never
   * reaches this root, so the exit control always stays visible.
   */
  --vn-shell-bg: linear-gradient(180deg, rgba(30, 27, 44, 0.9), rgba(12, 11, 20, 0.9));
  --vn-shell-bg-hover: linear-gradient(180deg, rgba(48, 42, 68, 0.96), rgba(24, 21, 36, 0.96));
  --vn-shell-panel: #15141f;
  --vn-shell-field: #0e0d16;
  --vn-shell-button: #242331;
  --vn-shell-text: #ffffff;
  --vn-shell-muted: rgba(255, 255, 255, 0.72);
  --vn-shell-border: rgba(255, 255, 255, 0.38);
  --vn-shell-accent: #d8a8ff;
  --vn-shell-radius: 999px;
  --vn-shell-family: system-ui, "Segoe UI", sans-serif;
  --vn-shell-shadow: 0 0.3rem 1rem rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #08090d;
}

[data-vn-shell][data-vn-preset="lumiverse"] {
  --vn-shell-panel: var(--lumiverse-bg-elevated, #15141f);
  --vn-shell-text: var(--lumiverse-text, #ffffff);
  --vn-shell-muted: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.72));
  --vn-shell-border: var(--lumiverse-border, rgba(255, 255, 255, 0.38));
  --vn-shell-accent: var(--lumiverse-primary, #d8a8ff);
  --vn-shell-family: var(--lumiverse-font-family, system-ui, "Segoe UI", sans-serif);
}

[data-vn-shell][data-vn-preset="golden-hour"] {
  --vn-shell-bg: linear-gradient(180deg, rgba(52, 37, 23, 0.94), rgba(22, 15, 9, 0.95));
  --vn-shell-bg-hover: linear-gradient(180deg, rgba(74, 52, 31, 0.97), rgba(32, 21, 12, 0.97));
  --vn-shell-panel: #1e150d;
  --vn-shell-field: #120c07;
  --vn-shell-button: #2e2115;
  --vn-shell-text: #fff2d8;
  --vn-shell-muted: rgba(255, 232, 196, 0.76);
  --vn-shell-border: rgba(226, 176, 106, 0.75);
  --vn-shell-accent: #e2b06a;
  --vn-shell-shadow: inset 0 0 0 2px rgba(12, 7, 3, 0.6), 0 0.3rem 1rem rgba(40, 20, 5, 0.45);
}

[data-vn-shell][data-vn-preset="boxed-console"] {
  --vn-shell-bg: #050a07;
  --vn-shell-bg-hover: #10261a;
  --vn-shell-panel: #050a07;
  --vn-shell-field: #020503;
  --vn-shell-button: #0b1a10;
  --vn-shell-text: #b6f7c8;
  --vn-shell-muted: rgba(166, 245, 189, 0.72);
  --vn-shell-border: #3fae63;
  --vn-shell-accent: #7dffa1;
  --vn-shell-radius: 0px;
  --vn-shell-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  --vn-shell-shadow: 3px 3px 0 rgba(0, 0, 0, 0.6);
}

[data-vn-shell][data-vn-preset="paper-novel"] {
  --vn-shell-bg: #f3ebda;
  --vn-shell-bg-hover: #fbf5e8;
  --vn-shell-panel: #f3ebda;
  --vn-shell-field: #fbf7ee;
  --vn-shell-button: #ebe0cb;
  --vn-shell-text: #3a2c22;
  --vn-shell-muted: rgba(70, 57, 48, 0.82);
  --vn-shell-border: rgba(101, 75, 43, 0.55);
  --vn-shell-accent: #8a2f23;
  --vn-shell-radius: 2px;
  --vn-shell-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
  --vn-shell-shadow: 0 0.25rem 0.8rem rgba(30, 20, 10, 0.35);
}

[data-vn-shell][data-vn-preset="midnight-noir"] {
  --vn-shell-bg: linear-gradient(180deg, #141a2b, #0a0e19);
  --vn-shell-bg-hover: linear-gradient(180deg, #1d2538, #10162a);
  --vn-shell-panel: #0a0f1c;
  --vn-shell-field: #060a13;
  --vn-shell-button: #141a2b;
  --vn-shell-text: #f3efe5;
  --vn-shell-muted: rgba(222, 218, 207, 0.74);
  --vn-shell-border: rgba(217, 164, 65, 0.62);
  --vn-shell-accent: #d9a441;
  --vn-shell-radius: 0px;
  --vn-shell-family: Georgia, "Iowan Old Style", serif;
  --vn-shell-shadow: inset 0 0 0 2px #050810, 0 0.3rem 1rem rgba(0, 0, 0, 0.5);
}

[data-vn-shell][data-vn-preset="yamaku-classic"] {
  --vn-shell-bg: rgba(32, 28, 24, 0.9);
  --vn-shell-bg-hover: rgba(52, 42, 37, 0.96);
  --vn-shell-panel: #221e1a;
  --vn-shell-field: #171411;
  --vn-shell-button: #302a24;
  --vn-shell-text: #ffffff;
  --vn-shell-border: rgba(195, 182, 168, 0.6);
  --vn-shell-accent: #ff7095;
  --vn-shell-radius: 2px;
}

[data-vn-shell][data-vn-preset="literature-club"] {
  --vn-shell-bg: rgba(255, 240, 246, 0.97);
  --vn-shell-bg-hover: #ffffff;
  --vn-shell-panel: #fff4f9;
  --vn-shell-field: #ffffff;
  --vn-shell-button: #ffe3ee;
  --vn-shell-text: #8f1f48;
  --vn-shell-muted: rgba(122, 36, 70, 0.82);
  --vn-shell-border: #ffffff;
  --vn-shell-accent: #e8507c;
  --vn-shell-family: "Comic Sans MS", "Comfortaa", "Trebuchet MS", ui-rounded, sans-serif;
  --vn-shell-shadow: 0 4px 14px rgba(232, 80, 124, 0.35), inset 0 0 0 1px #ffc2d7;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-width: 2.8rem;
  min-height: 2.8rem;
  padding: 0.55rem 1rem 0.55rem 0.85rem;
  white-space: nowrap;
  border: 1px solid var(--vn-shell-border);
  border-radius: var(--vn-shell-radius);
  background: var(--vn-shell-bg);
  color: var(--vn-shell-text);
  font: 650 0.875rem/1 var(--vn-shell-family);
  letter-spacing: 0.01em;
  cursor: pointer;
  box-shadow: var(--vn-shell-shadow);
  backdrop-filter: blur(0.8rem);
}

/* A drawn back-chevron (no font glyph) in the preset accent. */
[data-vn-exit]::before {
  display: block;
  flex: none;
  width: 0.45rem;
  height: 0.45rem;
  border-bottom: 2px solid var(--vn-shell-accent);
  border-left: 2px solid var(--vn-shell-accent);
  content: "";
  transform: translateX(1px) rotate(45deg);
}

[data-vn-exit]:hover {
  border-color: var(--vn-shell-accent);
  background: var(--vn-shell-bg-hover);
}

@media (max-width: 400px) {
  /* Narrow phones: the words alone, so Panels and the speech dock keep room. */
  [data-vn-exit] {
    padding-right: 0.8rem;
    padding-left: 0.8rem;
    font-size: 0.8125rem;
  }

  [data-vn-exit]::before {
    display: none;
  }
}

[data-vn-exit]:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 3px;
  box-shadow: 0 0 0 6px rgba(0, 0, 0, 0.55);
}

@media (prefers-reduced-motion: no-preference) {
  [data-vn-exit] {
    transition: background-color 140ms ease, border-color 140ms ease, transform 140ms ease;
  }

  [data-vn-exit]::before {
    transition: transform 160ms ease;
  }

  [data-vn-exit]:hover::before {
    transform: translateX(-1px) rotate(45deg);
  }

  [data-vn-exit]:active {
    transform: scale(0.97);
  }
}
`;
