import { THEME_PRESET_IDS, type VisualNovelThemePreset } from "../../config.js";

/** Built-in visual presets. Every rule stays under its own preset root. */
export type ThemePresetId = VisualNovelThemePreset;
export type ThemePresetCss = string;

/* lumiverse — host-neutral and token-led */
const LUMIVERSE_CSS = `
[data-vn-root][data-vn-preset="lumiverse"] {
  --vn-accent: var(--lumiverse-primary, #d8a8ff);
  --vn-text: var(--lumiverse-text, #fff);
  --vn-muted-text: var(--lumiverse-text-muted, rgba(255, 255, 255, 0.76));
  --vn-dialogue-bg: var(--lumiverse-card-bg, linear-gradient(180deg, rgba(21, 16, 33, 0.8), rgba(8, 9, 15, 0.94)));
  --vn-dialogue-border: var(--lumiverse-border, rgba(255, 255, 255, 0.28));
  --vn-dialogue-width: min(70rem, calc(100 * var(--vn-vw, 1vw) - 3rem));
  --vn-font-family: var(--lumiverse-font-family, ui-rounded, "Segoe UI", system-ui, sans-serif);
  --vn-dialogue-font-size: clamp(1rem, 1.1 * var(--vn-vw, 1vw) + 0.75rem, 1.35rem);
  --vn-transition-duration: 280ms;
  /* Chrome follows the host surface and key-control tokens. */
  --vn-accent-contrast: var(--lumiverse-primary-contrast, #17101d);
  --vn-chrome-bg: color-mix(in srgb, var(--lumiverse-bg-elevated, #14111f) 84%, transparent);
  --vn-chrome-border: var(--lumiverse-border, rgba(255, 255, 255, 0.18));
  --vn-chrome-hover: var(--lumiverse-fill-medium, rgba(255, 255, 255, 0.1));
  --vn-panel-bg: color-mix(in srgb, var(--lumiverse-bg-elevated, #12101d) 88%, transparent);
  --vn-panel-solid: var(--lumiverse-bg-elevated, #12101d);
  --vn-panel-border: var(--lumiverse-border, rgba(255, 255, 255, 0.16));
}

[data-vn-root][data-vn-preset="lumiverse"] [data-vn-ornament-group][data-vn-preset="lumiverse"] { display: block; }
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-dialogue] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.28));
  box-shadow:
    0 1.2rem 3rem rgba(8, 5, 18, 0.5),
    0 0.2rem 0.6rem rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    inset 0 2px 0 -1px color-mix(in srgb, var(--lumiverse-primary, #d8a8ff) 30%, transparent);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-speaker] { color: var(--lumiverse-primary, #d8a8ff); }
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-continue] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.3));
  background: var(--lumiverse-fill-medium, rgba(255, 255, 255, 0.1));
  color: var(--lumiverse-text, #fff);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-continue][data-vn-ready="true"]:hover { color: var(--lumiverse-primary, #d8a8ff); }
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-choice] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.22));
  color: var(--lumiverse-text, #fff);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-choice]:hover:not(:disabled),
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-choice]:focus-visible { border-color: var(--lumiverse-primary, #d8a8ff); }
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-input] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.22));
  color: var(--lumiverse-text, #fff);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-submit] {
  border-color: var(--lumiverse-primary, #d8a8ff);
  background-color: var(--lumiverse-primary, #d8a8ff);
  color: var(--lumiverse-primary-contrast, #17101d);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-control],
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-badge],
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-backlog] { font-family: var(--vn-font-family); }
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-badge] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.24));
  background: color-mix(in srgb, var(--lumiverse-bg-elevated, #12101d) 88%, transparent);
}
`;

/* golden-hour — afternoon light through smoked glass, gold filigree */
const GOLDEN_HOUR_CSS = `
[data-vn-root][data-vn-preset="golden-hour"] {
  --vn-accent: #e2b06a;
  --vn-text: #fff6e2;
  --vn-muted-text: rgba(255, 238, 205, 0.8);
  --vn-dialogue-bg: linear-gradient(180deg, rgba(40, 28, 18, 0.9), rgba(18, 12, 8, 0.95));
  --vn-dialogue-border: rgba(226, 176, 106, 0.9);
  --vn-dialogue-width: min(80rem, calc(100 * var(--vn-vw, 1vw) - 3rem));
  --vn-font-family: ui-rounded, "Segoe UI", system-ui, sans-serif;
  --vn-dialogue-font-size: clamp(1.05rem, 1.15 * var(--vn-vw, 1vw) + 0.76rem, 1.42rem);
  --vn-transition-duration: 320ms;
  --vn-accent-contrast: #1f1306;
  --vn-chrome-bg: linear-gradient(180deg, rgba(48, 34, 21, 0.94), rgba(22, 15, 9, 0.96));
  --vn-chrome-border: rgba(226, 176, 106, 0.62);
  --vn-chrome-text: #f3d69a;
  --vn-chrome-hover: rgba(226, 176, 106, 0.16);
  --vn-panel-bg: rgba(30, 21, 13, 0.92);
  --vn-panel-solid: #1e150d;
  --vn-panel-border: rgba(226, 176, 106, 0.8);
  --vn-focus-ring: #ffd58d;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-ornament-group][data-vn-preset="golden-hour"] { display: block; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-scene]::after {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 52% 40%, rgba(255, 191, 105, 0.16) 0 24%, transparent 55%), radial-gradient(ellipse at center, transparent 38%, rgba(32, 20, 12, 0.7) 100%);
  content: "";
  pointer-events: none;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-dialogue] {
  min-height: 8.5rem;
  padding: 1.75rem 4.2rem 1.5rem 2.6rem;
  border: 1px solid rgba(226, 176, 106, 0.92);
  outline: 1px solid rgba(247, 206, 139, 0.4);
  outline-offset: -6px;
  border-radius: 1.25rem;
  background: radial-gradient(ellipse 60% 120% at 50% -30%, rgba(255, 200, 120, 0.14), transparent 70%), linear-gradient(180deg, rgba(40, 28, 18, 0.9), rgba(18, 12, 8, 0.95));
  box-shadow:
    0 1.1rem 3rem rgba(60, 32, 8, 0.55),
    0 0 0 1px rgba(10, 6, 2, 0.6),
    inset 0 1px 0 rgba(255, 240, 205, 0.2);
  backdrop-filter: blur(1rem) saturate(1.08);
}
/* Filigree: a gold rule fades out from the centre of the top edge... */
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-dialogue]::before {
  position: absolute;
  top: -1px;
  left: 50%;
  width: min(18rem, 40%);
  height: 1px;
  background: linear-gradient(90deg, transparent, #f6dca4 35%, #fff1cf 50%, #f6dca4 65%, transparent);
  box-shadow: 0 0 6px rgba(246, 220, 164, 0.6);
  content: "";
  pointer-events: none;
  transform: translateX(-50%);
}
/* ...and a small gold diamond sits on it. */
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-dialogue]::after {
  position: absolute;
  top: -5px;
  left: 50%;
  width: 9px;
  height: 9px;
  margin-left: -4.5px;
  border: 1px solid #fff1cf;
  background: linear-gradient(135deg, #fff1cf, #d29a52);
  box-shadow: 0 0 0 2px rgba(18, 12, 8, 0.9), 0 0 8px rgba(246, 220, 164, 0.7);
  content: "";
  pointer-events: none;
  transform: rotate(45deg);
}
@media (max-width: 640px) {
  [data-vn-root][data-vn-preset="golden-hour"] [data-vn-dialogue]::before,
  [data-vn-root][data-vn-preset="golden-hour"] [data-vn-dialogue]::after { display: none; }
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-speaker] {
  position: absolute;
  z-index: 2;
  top: -1.1rem;
  left: 1.7rem;
  margin: 0;
  padding: 0.4rem 1.2rem;
  border: 1px solid rgba(226, 176, 106, 0.96);
  border-radius: 999px;
  background: linear-gradient(180deg, #45321f, #1c130c);
  color: #f6dca4;
  font-size: 0.86rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.6);
  box-shadow: inset 0 0 0 2px rgba(12, 7, 3, 0.7), 0 0 0 2px rgba(244, 202, 131, 0.3), 0 0.4rem 1rem rgba(0, 0, 0, 0.35);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-speaker]::before,
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-speaker]::after { color: #f8d0a9; content: "✦"; font-size: 0.66rem; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-speaker]::before { margin-right: 0.6rem; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-speaker]::after { margin-left: 0.6rem; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-dialogue-text] { color: #fff6e2; line-height: 1.65; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35); }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-progress] { color: rgba(255, 220, 166, 0.72); letter-spacing: 0.12em; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-continue] {
  right: 1.45rem;
  bottom: 0.85rem;
  display: flex;
  width: auto;
  height: auto;
  min-height: 2.2rem;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.85rem 0.35rem 1rem;
  border: 1px solid rgba(226, 176, 106, 0.55);
  border-radius: 999px;
  background: rgba(20, 13, 7, 0.6);
  color: #f0b46a;
  font-size: 0.7rem;
  font-weight: 750;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  box-shadow: none;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-continue]::before {
  width: auto;
  height: auto;
  margin: 0;
  border: 0;
  content: "Continue";
  transform: none;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-continue]::after { color: #f8d0a9; content: "»"; font-size: 1.15rem; letter-spacing: -0.08em; line-height: 0.75; text-shadow: 0 0 6px rgba(248, 208, 169, 0.6); }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-continue][data-vn-ready="true"]:hover { border-color: #ffd58d; color: #ffd58d; box-shadow: 0 0 0.9rem rgba(226, 176, 106, 0.35); }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-interaction] {
  background:
    radial-gradient(ellipse 70% 60% at 50% 45%, rgba(24, 14, 6, 0.5), transparent 75%),
    radial-gradient(ellipse at center, rgba(255, 184, 96, 0.05), rgba(19, 11, 6, 0.45));
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-interaction-title]::before { background: #f3d69a; box-shadow: 0 0 0 3px rgba(226, 176, 106, 0.25), 0 0 0.8rem #e2b06a; transform: rotate(45deg); border-radius: 1px; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice-list],
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-input-form] {
  border: 1px solid rgba(226, 176, 106, 0.88);
  outline: 1px solid rgba(255, 238, 200, 0.18);
  outline-offset: -6px;
  border-radius: 1.4rem;
  background:
    radial-gradient(ellipse 70% 80% at 50% -20%, rgba(255, 200, 120, 0.12), transparent 70%),
    linear-gradient(180deg, rgba(38, 27, 18, 0.93), rgba(18, 12, 8, 0.97));
  box-shadow: 0 1rem 3rem rgba(60, 32, 8, 0.55), inset 0 1px 0 rgba(255, 240, 205, 0.16);
  backdrop-filter: blur(1rem) saturate(1.08);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice-list] { gap: 0.75rem; padding: 1.35rem 1.5rem; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-input-form] { gap: 0.8rem; padding: 1.15rem 1.25rem; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice] {
  justify-content: center;
  min-height: 3.3rem;
  overflow: hidden;
  padding-right: 2.6rem;
  padding-left: 2.6rem;
  border: 1px solid rgba(226, 176, 106, 0.85);
  border-radius: 999px;
  background-color: #2c1f13;
  background-image: linear-gradient(180deg, rgba(255, 228, 180, 0.12), rgba(0, 0, 0, 0.18));
  color: #fff2d8;
  font-weight: 650;
  letter-spacing: 0.03em;
  text-align: center;
  box-shadow: inset 0 1px 0 rgba(255, 238, 200, 0.2), inset 0 0 0 3px rgba(15, 9, 5, 0.55), 0 0.35rem 1rem rgba(0, 0, 0, 0.32);
}
/* Light sweep across the pill on hover. */
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]::before {
  position: absolute;
  inset: 1px;
  border-radius: 999px;
  background: linear-gradient(120deg, transparent 30%, rgba(255, 238, 200, 0.2) 50%, transparent 70%);
  content: "";
  pointer-events: none;
  transform: translateX(-120%);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]::after {
  position: absolute;
  right: 1.35rem;
  color: #f3d69a;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]:hover:not(:disabled),
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]:focus-visible {
  border-color: #ffd58d;
  background-color: #4a3420;
  color: #fff8eb;
  box-shadow: inset 0 1px 0 rgba(255, 238, 200, 0.28), inset 0 0 0 3px rgba(15, 9, 5, 0.45), 0 0 0 1px rgba(255, 213, 141, 0.35), 0 0 1.4rem rgba(226, 176, 106, 0.3);
  transform: translateY(-1px);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]:active:not(:disabled) { transform: translateY(0) scale(0.985); }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-input] {
  border: 1px solid rgba(226, 176, 106, 0.6);
  border-radius: 0.9rem;
  background: rgba(9, 6, 3, 0.62);
  color: #fff6e2;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.45);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-submit] {
  border: 1px solid #f5d08a;
  background-color: #e2b06a;
  background-image: linear-gradient(180deg, #f6d796, #d29a52);
  color: #1f1306;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: 0.82rem;
  box-shadow: inset 0 1px 0 rgba(255, 248, 225, 0.6), inset 0 0 0 2px rgba(120, 72, 20, 0.25), 0 0.35rem 1rem rgba(80, 45, 10, 0.45);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-game-choice] {
  border-color: rgba(226, 176, 106, 0.6);
  background-color: rgba(34, 24, 15, 0.92);
  color: #fff2d8;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-game-choice]:hover:not(:disabled) { border-color: #ffd58d; background-color: #3e2b1a; }
@media (prefers-reduced-motion: no-preference) {
  [data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]::before { transition: transform 650ms ease; }
  [data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]:hover:not(:disabled)::before,
  [data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]:focus-visible::before { transform: translateX(120%); }
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-controls] {
  right: 2rem;
  gap: 0;
  padding: 0.18rem;
  box-shadow: inset 0 0 0 2px rgba(12, 7, 3, 0.65), 0 0 0 1px rgba(244, 202, 131, 0.18), 0 0.35rem 1rem rgba(30, 15, 5, 0.45);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-control] {
  color: #f3d69a;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-control] + [data-vn-control]::before {
  position: absolute;
  top: 28%;
  bottom: 28%;
  left: -1px;
  width: 1px;
  background: rgba(226, 176, 106, 0.35);
  content: "";
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-control]:hover:not(:disabled) { color: #fff8eb; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-control][data-vn-active="true"] {
  border-color: #ffe0a3;
  background-image: linear-gradient(180deg, #f6d796, #d29a52);
  color: #1f1306;
  box-shadow: 0 0 0.9rem rgba(226, 176, 106, 0.55), inset 0 1px 0 rgba(255, 248, 225, 0.6);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-badge] {
  border: 1px solid rgba(226, 176, 106, 0.6);
  background: linear-gradient(135deg, rgba(42, 29, 18, 0.92), rgba(20, 14, 8, 0.95));
  color: #fff6e2;
  box-shadow: inset 0 0 0 2px rgba(12, 7, 3, 0.5), 0 0.25rem 0.8rem rgba(50, 25, 10, 0.4);
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-badge-icon="spinner"] { color: #e2b06a; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-backlog] {
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, rgba(226, 176, 106, 0.14), transparent 70%),
    rgba(18, 12, 8, 0.96);
  color: #fff6e2;
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-backlog-title] { color: #f3d69a; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-backlog-title]::before { margin-right: 0.6rem; color: #f8d0a9; content: "✦"; font-size: 0.8em; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-backlog-item] { border-color: rgba(226, 176, 106, 0.18); background: rgba(255, 220, 160, 0.04); }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-backlog-close] { border-color: rgba(226, 176, 106, 0.6); color: #f3d69a; }
`;

/* boxed-console — segmented phosphor hardware HUD */
const BOXED_CONSOLE_CSS = `
[data-vn-root][data-vn-preset="boxed-console"] {
  --vn-accent: #7dffa1;
  --vn-text: #e7f9eb;
  --vn-muted-text: rgba(190, 222, 197, 0.78);
  --vn-dialogue-bg: linear-gradient(180deg, #0e1412, #080d0b);
  --vn-dialogue-border: #3d5a47;
  --vn-dialogue-width: min(84rem, calc(100 * var(--vn-vw, 1vw) - 3rem));
  --vn-font-family: ui-monospace, "Cascadia Code", "Cascadia Mono", Consolas, monospace;
  --vn-transition-duration: 180ms;
  --vn-accent-contrast: #04110a;
  --vn-chrome-bg: #050a07;
  --vn-chrome-border: #2f4a39;
  --vn-chrome-text: #8fe8a9;
  --vn-chrome-hover: rgba(125, 255, 161, 0.12);
  --vn-control-radius: 0px;
  --vn-panel-bg: #070c09;
  --vn-panel-solid: #070c09;
  --vn-panel-border: #3d5a47;
  --vn-odds-good: #7dffa1;
  --vn-odds-fair: #f2e27e;
  --vn-odds-poor: #ff8f8f;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-ornament-group][data-vn-preset="boxed-console"] { display: block; filter: drop-shadow(0 0 6px rgba(125, 255, 161, 0.35)); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-dialogue] {
  padding-top: 2.1rem;
  border: 1px solid #4a6b55;
  outline: 1px solid #17251d;
  outline-offset: -5px;
  border-radius: 2px;
  background: repeating-linear-gradient(0deg, rgba(125, 255, 161, 0.035) 0 1px, transparent 1px 4px), radial-gradient(ellipse 80% 100% at 50% 0%, rgba(125, 255, 161, 0.07), transparent 70%), linear-gradient(180deg, #0e1412, #080d0b);
  box-shadow: 8px 8px 0 rgba(0, 0, 0, 0.62), inset 4px 0 0 rgba(125, 255, 161, 0.16), inset 0 0 2.5rem rgba(0, 0, 0, 0.45);
}
/* Header rule inside the frame, broken where the nameplate tab sits. */
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-dialogue]::before {
  position: absolute;
  top: 0.7rem;
  right: 0.8rem;
  left: 0.8rem;
  height: 1px;
  background: linear-gradient(90deg, transparent 0 10rem, rgba(125, 255, 161, 0.7) 10rem);
  box-shadow: 0 4px 0 rgba(125, 255, 161, 0.14);
  content: "";
  pointer-events: none;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-speaker] {
  top: -1rem;
  left: 1.1rem;
  min-height: 1.9rem;
  padding: 0.3rem 0.85rem;
  border: 1px solid #7dffa1;
  border-radius: 0;
  background: #050a07;
  color: #7dffa1;
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-shadow: 0 0 8px rgba(125, 255, 161, 0.55);
  text-transform: uppercase;
  box-shadow: 3px 3px 0 rgba(125, 255, 161, 0.2), 0 0 0.8rem rgba(125, 255, 161, 0.15);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-speaker]::before { content: "> "; opacity: 0.7; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-speaker]::after { color: #7dffa1; content: "_"; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-dialogue-text] { line-height: 1.62; text-shadow: 0 0 6px rgba(125, 255, 161, 0.16); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-progress] { padding-top: 0.5rem; border-top: 1px solid #24382c; letter-spacing: 0.14em; text-transform: uppercase; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-continue] {
  width: 2.8rem;
  height: 2.2rem;
  border: 1px solid #7dffa1;
  border-radius: 0;
  background: #0a110d;
  color: #7dffa1;
  box-shadow: 3px 3px 0 rgba(125, 255, 161, 0.22);
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-continue]::before {
  width: 0;
  height: 0;
  margin: 0 0 0 0.15rem;
  border-top: 0.35rem solid transparent;
  border-bottom: 0.35rem solid transparent;
  border-left: 0.5rem solid currentColor;
  border-right: 0;
  border-radius: 0;
  filter: drop-shadow(0 0 4px rgba(125, 255, 161, 0.8));
  transform: none;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-continue][data-vn-ready="true"]:hover { background: #7dffa1; color: #04110a; box-shadow: 3px 3px 0 rgba(125, 255, 161, 0.35); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-interaction] { background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.18) 0 1px, transparent 1px 3px), rgba(2, 7, 4, 0.62); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-interaction-title] { color: #7dffa1; font-family: var(--vn-font-family); text-shadow: 0 0 8px rgba(125, 255, 161, 0.5), 0 1px 2px #000; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-interaction-title]::before { width: 0.6em; height: 0.9em; border-radius: 0; box-shadow: 0 0 8px #7dffa1; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-interaction-title]::after { background: repeating-linear-gradient(90deg, rgba(125, 255, 161, 0.6) 0 6px, transparent 6px 10px); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice-list],
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-input-form] {
  border: 1px solid #4a6b55;
  border-radius: 0;
  background: repeating-linear-gradient(0deg, rgba(125, 255, 161, 0.03) 0 1px, transparent 1px 4px), #070c09;
  box-shadow: 8px 8px 0 rgba(0, 0, 0, 0.62), inset 0 0 0 1px #17251d;
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice-list] { gap: 0.35rem; padding: 0.85rem; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-input-form] { padding: 1rem; }
/* Menu rows: a dim prompt; the row under the pointer or focus inverts like a terminal selection bar. */
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice] {
  min-height: 3rem;
  padding-left: 2.6rem;
  border: 1px solid transparent;
  border-radius: 0;
  background-color: transparent;
  background-image: none;
  color: #e7f9eb;
  font-weight: 500;
  letter-spacing: 0.04em;
  box-shadow: none;
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]::before { position: absolute; left: 1rem; color: #7dffa1; content: ">"; opacity: 0.4; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]::after {
  width: 0.55em;
  height: 1.1em;
  border: 0;
  background: currentColor;
  color: #04110a;
  transform: none;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:hover:not(:disabled),
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:focus-visible {
  border-color: #7dffa1;
  background-color: #7dffa1;
  color: #04110a;
  box-shadow: 0 0 1rem rgba(125, 255, 161, 0.35);
  text-shadow: none;
  transform: none;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:hover:not(:disabled)::before,
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:focus-visible::before { color: #04110a; opacity: 1; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:hover:not(:disabled)::after,
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:focus-visible::after { transform: none; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:active:not(:disabled) { transform: none; background-color: #b4ffc9; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:focus-visible { outline-color: #e7f9eb; outline-offset: 2px; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-input] { border: 1px solid #3d5a47; border-radius: 0; background: #030604; color: #e7f9eb; caret-color: #7dffa1; box-shadow: inset 4px 0 0 rgba(125, 255, 161, 0.3); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-input]:focus { border-color: #7dffa1; box-shadow: inset 4px 0 0 #7dffa1, 0 0 0.8rem rgba(125, 255, 161, 0.2); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-submit] {
  border: 1px solid #7dffa1;
  border-radius: 0;
  background-color: #7dffa1;
  background-image: none;
  color: #04110a;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  box-shadow: 4px 4px 0 #294b33;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-submit]:hover:not(:disabled) { filter: none; background-color: #b4ffc9; box-shadow: 4px 4px 0 #294b33, 0 0 1rem rgba(125, 255, 161, 0.35); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-submit]:active:not(:disabled) { transform: translate(3px, 3px); box-shadow: 1px 1px 0 #294b33; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-game-choice] { border-color: #3d5a47; border-radius: 0; background-color: #070c09; background-image: none; color: #e7f9eb; letter-spacing: 0.03em; box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.6); backdrop-filter: none; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-game-choice]:hover:not(:disabled) { border-color: #7dffa1; background-color: #10261a; box-shadow: 3px 3px 0 rgba(125, 255, 161, 0.25); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-game-odds] { border-radius: 0; }
@media (prefers-reduced-motion: no-preference) {
  [data-vn-root][data-vn-preset="boxed-console"] [data-vn-speaker]::after { animation: vn-console-caret 1s steps(1) infinite; }
  [data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:hover:not(:disabled)::after,
  [data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:focus-visible::after { animation: vn-console-caret 1s steps(1) infinite; }
  [data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice] { transition: background-color 90ms steps(2), color 90ms steps(2), border-color 90ms steps(2); }
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-controls] {
  right: 1.25rem;
  gap: 0.25rem;
  padding: 0.22rem;
  border-color: #4a6b55;
  box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.6);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-control] {
  border-color: #24382c;
  font-family: var(--vn-font-family);
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-control]:hover:not(:disabled) { border-color: #7dffa1; color: #c9ffd8; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-control][data-vn-active="true"] {
  border-color: #7dffa1;
  background-image: none;
  color: #04110a;
  box-shadow: 0 0 10px rgba(125, 255, 161, 0.6);
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-control]:active:not(:disabled) { transform: translate(1px, 1px); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-badge] {
  border: 1px solid #3fae63;
  border-radius: 0;
  background: #030805;
  color: #a6f5bd;
  font-family: var(--vn-font-family);
  box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.6), 0 0 8px rgba(34, 197, 94, 0.2);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-badge-icon="spinner"] { color: #7dffa1; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-badge-action] { border-radius: 0; border-color: #7dffa1; background: transparent; color: #7dffa1; box-shadow: none; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-badge-action]:hover { background: #7dffa1; color: #04110a; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-backlog] {
  background: repeating-linear-gradient(0deg, rgba(125, 255, 161, 0.025) 0 1px, transparent 1px 4px), #020803;
  color: #a6f5bd;
  font-family: var(--vn-font-family);
  box-shadow: inset 0 0 0 2px #2a7a45;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-backlog-title] { color: #7dffa1; letter-spacing: 0.2em; text-shadow: 0 0 8px rgba(125, 255, 161, 0.5); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-backlog-title]::before { content: "> "; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-backlog-item] { border-radius: 0; border-color: #17251d; background: rgba(125, 255, 161, 0.03); box-shadow: inset 3px 0 0 #2f7d4a; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-backlog-item]:last-child { border-color: #2f4a39; box-shadow: inset 3px 0 0 #7dffa1; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-backlog-text] { color: #d9f7e1; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-backlog-close] { border-radius: 0; border-color: #3fae63; background: #0b1a10; color: #a6f5bd; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-backlog-close]:hover { background: #7dffa1; color: #04110a; }
`;

/* paper-novel — aged letterpress page */
const PAPER_NOVEL_CSS = `
[data-vn-root][data-vn-preset="paper-novel"] {
  --vn-accent: #8a2f23;
  --vn-text: #29221e;
  --vn-muted-text: rgba(70, 57, 48, 0.82);
  --vn-dialogue-bg: #efe6d3;
  --vn-dialogue-border: rgba(101, 75, 43, 0.5);
  --vn-dialogue-width: min(74rem, calc(100 * var(--vn-vw, 1vw) - 3rem));
  --vn-font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
  --vn-dialogue-font-size: clamp(1.05rem, 1 * var(--vn-vw, 1vw) + 0.82rem, 1.35rem);
  --vn-transition-duration: 360ms;
  --vn-accent-contrast: #fbf5e8;
  --vn-chrome-bg: #f3ebda;
  --vn-chrome-border: rgba(101, 75, 43, 0.42);
  --vn-chrome-text: #5a4a3d;
  --vn-chrome-hover: rgba(138, 47, 35, 0.08);
  --vn-control-radius: 2px;
  --vn-panel-bg: #f1e8d6;
  --vn-panel-solid: #f1e8d6;
  --vn-panel-border: rgba(101, 75, 43, 0.5);
  /* Heading and hint sit on the scene, not on paper: print them in ivory. */
  --vn-overlay-text: #fbf5e8;
  --vn-overlay-muted: rgba(251, 245, 232, 0.88);
  --vn-odds-good: #2f6b3a;
  --vn-odds-fair: #87570f;
  --vn-odds-poor: #8a2f23;
  --vn-error: #8a2f23;
  --vn-error-title: #8a2f23;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-ornament-group][data-vn-preset="paper-novel"] { display: block; color: #e9d9b8; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-dialogue] {
  padding: 2.5rem 3.8rem 1.9rem 3.2rem;
  border: 1px solid rgba(101, 75, 43, 0.5);
  outline: 1px solid rgba(101, 75, 43, 0.22);
  outline-offset: -7px;
  border-radius: 2px;
  background:
    radial-gradient(ellipse 70% 90% at 15% 0%, rgba(255, 252, 242, 0.55), transparent 60%),
    radial-gradient(ellipse 60% 80% at 100% 100%, rgba(150, 110, 55, 0.13), transparent 60%),
    repeating-linear-gradient(0deg, rgba(122, 90, 40, 0.04) 0 1px, transparent 1px 3px),
    #efe6d3;
  color: #29221e;
  box-shadow: 0 0.8rem 2rem rgba(40, 26, 12, 0.35), 0 0.15rem 0.35rem rgba(40, 26, 12, 0.25), inset 0 0 2rem rgba(94, 68, 36, 0.12);
  backdrop-filter: none;
}
/* Running-head double rule in oxblood ink. */
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-dialogue]::before {
  position: absolute;
  top: 1.05rem;
  right: 2rem;
  left: 2rem;
  height: 4px;
  border-top: 1px solid #8a2f23;
  border-bottom: 1px solid rgba(138, 47, 35, 0.45);
  content: "";
  pointer-events: none;
}
/* Fleuron centred on the running head. */
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-dialogue]::after {
  position: absolute;
  top: 0.62rem;
  left: 50%;
  padding: 0 0.6rem;
  background: #efe6d3;
  color: #8a2f23;
  content: "❦";
  font-size: 0.85rem;
  line-height: 1;
  pointer-events: none;
  transform: translateX(-50%);
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-speaker] {
  top: -1.2rem;
  left: 2.4rem;
  padding: 0.32rem 1.1rem 0.28rem;
  border: 1px solid rgba(101, 75, 43, 0.5);
  border-bottom-color: #8a2f23;
  border-radius: 2px 2px 0 0;
  background: #f6efe0;
  color: #8a2f23;
  font-size: 1rem;
  font-variant: small-caps;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: lowercase;
  box-shadow: 0 -0.2rem 0.6rem rgba(40, 26, 12, 0.2), inset 0 -2px 0 rgba(138, 47, 35, 0.85);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-dialogue-text] { color: #29221e; line-height: 1.7; letter-spacing: 0.002em; text-shadow: 0 1px rgba(255, 255, 255, 0.28); hanging-punctuation: first; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-dialogue-footer] { justify-content: center; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-progress] { color: #715f50; font-style: italic; letter-spacing: 0.06em; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-reading-state] { font-style: italic; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-continue] {
  border: 1px solid rgba(138, 47, 35, 0.4);
  background: #f6efe0;
  color: #8a2f23;
  box-shadow: 0 0.15rem 0.4rem rgba(40, 26, 12, 0.18);
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-continue][data-vn-ready="true"]:hover { border-color: #8a2f23; background: #8a2f23; color: #fbf5e8; box-shadow: 0 0.2rem 0.5rem rgba(75, 32, 24, 0.35); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-interaction] { background: radial-gradient(ellipse 70% 60% at 50% 45%, rgba(30, 20, 12, 0.5), transparent 75%), rgba(40, 28, 18, 0.32); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-interaction-title] { font-family: var(--vn-font-family); font-variant: small-caps; letter-spacing: 0.14em; text-transform: lowercase; font-size: 1.05rem; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75), 0 2px 14px rgba(0, 0, 0, 0.6); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-interaction-title]::before { background: #c0503f; box-shadow: 0 0 0 3px rgba(251, 245, 232, 0.25); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-interaction-title]::after { background: linear-gradient(90deg, rgba(251, 245, 232, 0.7), transparent); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-interaction-hint] { font-style: italic; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice-list],
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-input-form] {
  border: 1px solid rgba(101, 75, 43, 0.5);
  border-radius: 2px;
  background: radial-gradient(ellipse 70% 90% at 15% 0%, rgba(255, 252, 242, 0.55), transparent 60%), #efe6d3;
  color: #29221e;
  box-shadow: 0 0.9rem 2.2rem rgba(30, 20, 10, 0.4), inset 0 0 0 6px rgba(255, 250, 238, 0.35), inset 0 0 0 7px rgba(101, 75, 43, 0.2);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice-list] { gap: 0.15rem; padding: 1.1rem 1.5rem; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-input-form] { padding: 1.25rem; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice] {
  min-height: 3.1rem;
  padding-left: 2.3rem;
  border: 0;
  border-bottom: 1px solid rgba(101, 75, 43, 0.28);
  border-radius: 0;
  background-color: transparent;
  background-image: none;
  color: #29221e;
  font-size: 1.05rem;
  font-weight: 400;
  box-shadow: none;
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice-list] li:last-child [data-vn-choice] { border-bottom-color: transparent; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]::before { position: absolute; left: 0.75rem; color: #8a2f23; content: "❧"; opacity: 0.55; transition: opacity 200ms ease, transform 200ms ease; }
/* The underline is drawn in ink from the left on hover. */
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  width: auto;
  height: 2px;
  margin: 0;
  border: 0;
  background: #8a2f23;
  opacity: 1;
  transform: scaleX(0);
  transform-origin: left;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]:hover:not(:disabled),
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]:focus-visible {
  background-color: rgba(138, 47, 35, 0.06);
  color: #6e2219;
  box-shadow: none;
  transform: none;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]:hover:not(:disabled)::before,
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]:focus-visible::before { opacity: 1; transform: translateX(2px); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]:hover:not(:disabled)::after,
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]:focus-visible::after { transform: scaleX(1); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]:active:not(:disabled) { transform: none; background-color: rgba(138, 47, 35, 0.12); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-input] { border: 1px solid rgba(101, 75, 43, 0.48); border-radius: 2px; background: rgba(255, 250, 238, 0.6); color: #29221e; font-family: var(--vn-font-family); caret-color: #8a2f23; box-shadow: inset 0 1px 3px rgba(80, 55, 25, 0.15); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-input]:focus { border-color: #8a2f23; box-shadow: inset 0 1px 3px rgba(80, 55, 25, 0.15), 0 0 0 3px rgba(138, 47, 35, 0.14); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-submit] {
  border: 1px solid #632018;
  border-radius: 2px;
  background-color: #8a2f23;
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent 60%);
  color: #fff8ec;
  font-variant: small-caps;
  letter-spacing: 0.1em;
  box-shadow: 3px 3px 0 rgba(75, 32, 24, 0.28);
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-submit]:hover:not(:disabled) { filter: none; background-color: #9c3a2c; box-shadow: 3px 3px 0 rgba(75, 32, 24, 0.32); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-submit]:active:not(:disabled) { transform: translate(2px, 2px); box-shadow: 1px 1px 0 rgba(75, 32, 24, 0.3); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-game-choice] {
  border: 1px solid rgba(101, 75, 43, 0.5);
  border-radius: 2px;
  background-color: #f1e8d6;
  background-image: none;
  color: #29221e;
  font-weight: 500;
  box-shadow: 0 0.3rem 0.8rem rgba(30, 20, 10, 0.35);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-game-choice]:hover:not(:disabled) { border-color: #8a2f23; background-color: #f7f0e1; color: #6e2219; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-game-odds] { border-radius: 2px; background: rgba(255, 255, 255, 0.4); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-game-group-label] { font-variant: small-caps; letter-spacing: 0.12em; text-transform: lowercase; font-size: 0.85rem; }
@media (prefers-reduced-motion: no-preference) {
  [data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]::after { transition: transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1); }
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-controls] {
  right: 2rem;
  gap: 0;
  padding: 0.15rem;
  border-color: rgba(101, 75, 43, 0.45);
  background: #f3ebda;
  box-shadow: 0 0.2rem 0.6rem rgba(40, 26, 12, 0.22), inset 0 0 0 3px rgba(255, 250, 238, 0.5);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-control] {
  font-family: var(--vn-font-family);
  font-size: 0.86rem;
  font-variant: small-caps;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: lowercase;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-control] + [data-vn-control]::before {
  position: absolute;
  top: 30%;
  bottom: 30%;
  left: -1px;
  width: 1px;
  background: rgba(101, 75, 43, 0.3);
  content: "";
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-control]:hover:not(:disabled) { color: #8a2f23; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-control][data-vn-active="true"] {
  border-color: #632018;
  background-image: none;
  color: #fbf5e8;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15);
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge] {
  border: 1px solid rgba(101, 75, 43, 0.5);
  border-radius: 2px;
  background: #f6efe0;
  color: #2b221a;
  font-family: var(--vn-font-family);
  box-shadow: 0 0.25rem 0.7rem rgba(40, 26, 12, 0.3);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-icon="spinner"],
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-icon="reroll"] { color: #8a2f23; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-icon="image"] { color: #2d5a87; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-icon="check"] { color: #2f6b3a; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-icon="alert"] { color: #87570f; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge][data-vn-badge-interactive="true"]:hover,
[data-vn-root][data-vn-preset="paper-novel"] button[data-vn-badge]:hover { border-color: #8a2f23; background: #fbf6ea; box-shadow: 0 0.3rem 0.8rem rgba(40, 26, 12, 0.35); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-kind="error"] { border-color: #8a2f23; background: #f8eee6; color: #4a1a12; box-shadow: 0 0.3rem 0.9rem rgba(40, 26, 12, 0.35); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-title] { color: #8a2f23; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-details] summary,
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-note] { color: #6b4a3a; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-details] pre { background: rgba(101, 75, 43, 0.1); color: #3a2c22; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-action] { border-radius: 2px; border-color: #632018; background: #8a2f23; color: #fbf5e8; box-shadow: none; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-action]:hover { background: #9c3a2c; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog] {
  background: radial-gradient(ellipse 70% 60% at 20% 0%, rgba(255, 252, 242, 0.7), transparent 60%), #f4ecdb;
  color: #2b221a;
  font-family: var(--vn-font-family);
  box-shadow: inset 0 0 0 6px #f4ecdb, inset 0 0 0 7px rgba(138, 47, 35, 0.6), inset 0 0 0 10px #f4ecdb, inset 0 0 0 11px rgba(138, 47, 35, 0.35);
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog-header] { border-bottom-color: rgba(138, 47, 35, 0.5); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog-title] { color: #8a2f23; font-variant: small-caps; letter-spacing: 0.14em; text-transform: lowercase; font-size: 1.35rem; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog-item] { border: 0; border-bottom: 1px solid rgba(101, 75, 43, 0.22); border-radius: 0; background: transparent; box-shadow: none; padding-left: 0.2rem; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog-item]:last-child { border-bottom-color: transparent; background: transparent; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog-speaker] { color: #8a2f23; font-variant: small-caps; text-transform: lowercase; letter-spacing: 0.1em; font-size: 0.95rem; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog-text] { color: #29221e; line-height: 1.7; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog-content]::-webkit-scrollbar-thumb { background: rgba(138, 47, 35, 0.4); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog-close] { border-radius: 2px; border-color: rgba(101, 75, 43, 0.5); background: #ebe0cb; color: #8a2f23; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog-close]:hover { border-color: #8a2f23; background: #8a2f23; color: #fbf5e8; }
`;

/* midnight-noir — cinema marquee and art-deco geometry */
const MIDNIGHT_NOIR_CSS = `
[data-vn-root][data-vn-preset="midnight-noir"] {
  --vn-accent: #d9a441;
  --vn-text: #f3efe5;
  --vn-muted-text: rgba(222, 218, 207, 0.74);
  --vn-dialogue-bg: linear-gradient(180deg, rgba(16, 21, 34, 0.93) 0%, rgba(7, 10, 18, 0.97) 100%);
  --vn-dialogue-border: rgba(196, 170, 120, 0.7);
  --vn-dialogue-width: min(82rem, calc(100 * var(--vn-vw, 1vw) - 2.5rem));
  --vn-font-family: Georgia, "Iowan Old Style", serif;
  --vn-transition-duration: 420ms;
  --vn-accent-contrast: #090b10;
  --vn-chrome-bg: rgba(9, 13, 24, 0.95);
  --vn-chrome-border: rgba(217, 164, 65, 0.5);
  --vn-chrome-text: #d6cab6;
  --vn-chrome-hover: rgba(217, 164, 65, 0.12);
  --vn-control-radius: 0px;
  --vn-panel-bg: rgba(9, 14, 26, 0.95);
  --vn-panel-solid: #090e1a;
  --vn-panel-border: rgba(217, 164, 65, 0.58);
  --vn-focus-ring: #efc76e;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-ornament-group][data-vn-preset="midnight-noir"] { display: block; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-scene]::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(2, 4, 10, 0.18) 0%, transparent 18% 76%, rgba(2, 4, 10, 0.34) 100%), radial-gradient(ellipse at center, transparent 62%, rgba(2, 5, 13, 0.24) 100%);
  content: "";
  pointer-events: none;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue] {
  position: relative;
  min-height: 8.5rem;
  padding: 1.7rem 4rem 1.45rem 2.4rem;
  border: 1px solid rgba(196, 170, 120, 0.7);
  outline: 1px solid rgba(217, 164, 65, 0.22);
  outline-offset: -5px;
  border-radius: 2px;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.012) 0 1px, transparent 1px 4px), linear-gradient(180deg, rgba(16, 21, 34, 0.93) 0%, rgba(7, 10, 18, 0.97) 100%);
  box-shadow: 0 1.2rem 3rem rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 236, 196, 0.12);
  backdrop-filter: blur(1.2rem) saturate(1.1);
}
/* Art-deco double rule with stepped ends across the top of the plate. */
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue]::before {
  position: absolute;
  top: 0.75rem;
  right: 1.2rem;
  left: 1.2rem;
  height: 3px;
  border-top: 1px solid rgba(217, 164, 65, 0.55);
  border-bottom: 1px solid rgba(196, 170, 120, 0.25);
  background: linear-gradient(90deg, #d9a441 0 0.6rem, transparent 0.6rem calc(100% - 0.6rem), #d9a441 calc(100% - 0.6rem)) top / 100% 1px no-repeat;
  content: "";
  pointer-events: none;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue]::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 35%, rgba(255, 226, 166, 0.09) 50%, transparent 65%);
  content: "";
  pointer-events: none;
  transform: translateX(-130%);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-speaker] {
  position: absolute;
  top: -2.15rem;
  left: 2rem;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 2.2rem;
  padding: 0.3rem 1.4rem;
  border: 1px solid rgba(196, 170, 120, 0.75);
  border-bottom: none;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(180deg, #141a2b, #0b0f1b);
  color: #e6b354;
  font-weight: 700;
  font-size: 1.1rem;
  font-style: italic;
  letter-spacing: 0.06em;
  text-transform: none;
  box-shadow: 0 -3px 10px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 236, 196, 0.15), inset 0 2px 0 -1px rgba(217, 164, 65, 0.6);
  text-shadow: 0 0 12px rgba(217, 164, 65, 0.3);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-speaker]::before,
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-speaker]::after { width: 0.32rem; height: 0.32rem; background: #d9a441; content: ""; transform: rotate(45deg); opacity: 0.85; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue-text] { color: #f3efe5; line-height: 1.66; letter-spacing: 0.01em; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-progress] { letter-spacing: 0.24em; text-transform: uppercase; color: rgba(217, 164, 65, 0.7); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-continue] {
  width: 2.8rem;
  height: 2.1rem;
  border: 1px solid #d9a441;
  border-radius: 0;
  background: #0a0f1c;
  color: #d9a441;
  box-shadow: inset 0 0 0 3px #060a13;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-continue]::before { margin: 0 0 0 -0.2rem; transform: rotate(-45deg); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-continue][data-vn-ready="true"]:hover { background: #d9a441; color: #090b10; box-shadow: inset 0 0 0 3px rgba(9, 11, 16, 0.25), 0 0 0.9rem rgba(217, 164, 65, 0.4); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-interaction] { background: radial-gradient(ellipse 70% 60% at 50% 45%, rgba(2, 4, 10, 0.55), transparent 75%), linear-gradient(180deg, rgba(2, 4, 10, 0.6) 0 8%, rgba(3, 6, 13, 0.42) 8% 90%, rgba(2, 4, 10, 0.6) 90% 100%); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-interaction-title] { font-family: var(--vn-font-family); letter-spacing: 0.32em; font-weight: 600; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-interaction-title]::before { border-radius: 0; transform: rotate(45deg); box-shadow: 0 0 0.6rem rgba(217, 164, 65, 0.7); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice-list],
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-input-form] {
  padding: 1.25rem;
  border: 1px solid rgba(217, 164, 65, 0.6);
  border-radius: 2px;
  background: linear-gradient(180deg, rgba(12, 18, 32, 0.97), rgba(4, 7, 14, 0.98));
  box-shadow: 0 1.4rem 4rem rgba(0, 0, 0, 0.72), inset 0 0 0 4px #04070e, inset 0 0 0 5px rgba(217, 164, 65, 0.22);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice-list] { gap: 0.6rem; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice] {
  justify-content: center;
  padding-right: 2.6rem;
  padding-left: 2.6rem;
  border: 1px solid rgba(217, 164, 65, 0.42);
  border-radius: 0;
  background-color: rgba(10, 15, 28, 0.95);
  background-image: none;
  color: #f3efe5;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-align: center;
  box-shadow: inset 0 0 0 3px #060a13;
}
/* Deco diamonds flank the line; they light up with the frame. */
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]::before,
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]::after {
  position: absolute;
  top: 50%;
  width: 0.4rem;
  height: 0.4rem;
  margin: -0.2rem 0 0;
  border: 1px solid rgba(217, 164, 65, 0.6);
  background: transparent;
  content: "";
  opacity: 1;
  transform: rotate(45deg);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]::before { left: 1.2rem; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]::after { right: 1.2rem; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]:hover:not(:disabled),
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]:focus-visible {
  border-color: #efc76e;
  background-color: #161d2e;
  color: #fff6df;
  box-shadow: inset 0 0 0 3px #060a13, inset 0 0 0 4px rgba(217, 164, 65, 0.45), 0 0 1.4rem rgba(217, 164, 65, 0.2);
  transform: none;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]:hover:not(:disabled)::before,
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]:hover:not(:disabled)::after,
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]:focus-visible::before,
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]:focus-visible::after { background: #d9a441; border-color: #efc76e; transform: rotate(45deg); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]:active:not(:disabled) { transform: scale(0.99); background-color: #1d2538; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-input] { border: 1px solid rgba(217, 164, 65, 0.45); border-radius: 0; background: #070b16; color: #f3efe5; font-family: var(--vn-font-family); caret-color: #d9a441; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-submit] {
  border: 1px solid #efc76e;
  border-radius: 0;
  background-color: #d9a441;
  background-image: linear-gradient(180deg, #ecc26e, #c98f2c);
  color: #090b10;
  font-size: 0.82rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  box-shadow: inset 0 0 0 3px rgba(4, 7, 14, 0.28), 0 0.4rem 1.2rem rgba(0, 0, 0, 0.5);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-game-choice] { border-color: rgba(217, 164, 65, 0.45); border-radius: 0; background-color: rgba(9, 14, 26, 0.95); background-image: none; letter-spacing: 0.05em; box-shadow: inset 0 0 0 2px #060a13, 0 0.3rem 0.9rem rgba(0, 0, 0, 0.4); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-game-choice]:hover:not(:disabled) { border-color: #efc76e; background-color: #161d2e; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-game-odds] { border-radius: 0; }
@media (prefers-reduced-motion: no-preference) {
  [data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue]::after { animation: vn-noir-sweep 2.2s ease-out 280ms 1; }
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-controls] {
  top: calc(-1 * (var(--vn-control-size) + 0.15rem));
  right: 2rem;
  gap: 0;
  padding: 0.15rem 0.15rem 0;
  border-bottom: none;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(180deg, #141a2b, #0b0f1b);
  box-shadow: 0 -3px 10px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 236, 196, 0.12);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-control] {
  font-family: var(--vn-font-family);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
/* The tab underline lights in amber on hover and while a mode runs. */
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-control]::after {
  position: absolute;
  right: 0.6rem;
  bottom: 0.15rem;
  left: 0.6rem;
  height: 1px;
  background: #d9a441;
  content: "";
  transform: scaleX(0);
  transition: transform 200ms ease;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-control]:hover:not(:disabled) { color: #fff8e8; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-control]:hover:not(:disabled)::after { transform: scaleX(1); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-control][data-vn-active="true"] {
  border-color: transparent;
  background-color: transparent;
  background-image: none;
  color: #efc76e;
  box-shadow: none;
  text-shadow: 0 0 10px rgba(217, 164, 65, 0.55);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-control][data-vn-active="true"]:hover:not(:disabled) { background-color: rgba(217, 164, 65, 0.12); color: #ffd98a; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-control][data-vn-active="true"]::after { height: 2px; transform: scaleX(1); }
@media (max-width: 640px) {
  [data-vn-root][data-vn-preset="midnight-noir"] [data-vn-controls] {
    top: calc(-1 * (var(--vn-control-size) + 2.85rem));
    right: 1rem;
    padding-bottom: 0.15rem;
    border-bottom: 1px solid rgba(217, 164, 65, 0.5);
    border-radius: 2px;
  }
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-badge] {
  border: 1px solid rgba(217, 164, 65, 0.45);
  border-radius: 0;
  background: rgba(8, 12, 22, 0.94);
  color: #f3efe5;
  font-family: var(--vn-font-family);
  box-shadow: inset 0 0 0 2px #050810, 0 4px 12px rgba(0, 0, 0, 0.45);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-badge-icon="spinner"],
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-badge-icon="reroll"] { color: #d9a441; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-badge-action] { border-radius: 0; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-backlog] {
  background: radial-gradient(ellipse 80% 50% at 50% 0%, rgba(217, 164, 65, 0.1), transparent 70%), rgba(5, 8, 16, 0.97);
  color: #f3efe5;
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-backlog-title] { color: #d9a441; letter-spacing: 0.32em; font-weight: 600; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-backlog-item] { border-radius: 0; border-color: rgba(217, 164, 65, 0.14); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-backlog-speaker] { font-style: italic; text-transform: none; letter-spacing: 0.06em; font-size: 0.95rem; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-backlog-close] { border-radius: 0; border-color: rgba(217, 164, 65, 0.5); background: rgba(16, 22, 36, 0.92); color: #efc76e; }
`;

/* yamaku-classic — nostalgic school romance visual novel (Katawa Shoujo style) */
const YAMAKU_CLASSIC_CSS = `
[data-vn-root][data-vn-preset="yamaku-classic"] {
  --vn-accent: #ff7095;
  --vn-text: #ffffff;
  --vn-muted-text: rgba(255, 255, 255, 0.78);
  --vn-dialogue-bg: linear-gradient(to top, rgba(20, 17, 15, 0.88) 0%, rgba(25, 22, 19, 0.7) 50%, rgba(28, 24, 20, 0.45) 100%);
  --vn-dialogue-border: rgba(175, 160, 145, 0.7);
  --vn-dialogue-width: min(78rem, calc(100 * var(--vn-vw, 1vw) - 1.8rem));
  --vn-font-family: "Segoe Print", "Comic Sans MS", "Trebuchet MS", cursive;
  --vn-dialogue-font-size: clamp(1.18rem, 1.25 * var(--vn-vw, 1vw) + 0.75rem, 1.58rem);
  --vn-transition-duration: 280ms;
  --vn-nameplate-lift: 1.4rem;
  --vn-interaction-width: min(36rem, 100%);
  --vn-accent-contrast: #1c0d12;
  --vn-chrome-bg: transparent;
  --vn-chrome-border: transparent;
  --vn-chrome-text: rgba(255, 255, 255, 0.88);
  --vn-chrome-hover: rgba(255, 255, 255, 0.08);
  --vn-control-radius: 2px;
  --vn-panel-bg: rgba(34, 30, 26, 0.92);
  --vn-panel-solid: #221e1a;
  --vn-panel-border: rgba(195, 182, 168, 0.55);
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-ornament-group][data-vn-preset="yamaku-classic"] { display: block; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-narrative] {
  padding-right: max(0.9rem, env(safe-area-inset-right));
  padding-bottom: max(1.25rem, env(safe-area-inset-bottom));
  padding-left: max(0.9rem, env(safe-area-inset-left));
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-dialogue] {
  position: relative;
  overflow: visible;
  min-height: 9rem;
  padding: 1.2rem 3.8rem 1.35rem 1.25rem;
  border: 1px solid rgba(175, 160, 145, 0.7);
  outline: none;
  border-radius: 0;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.06) 0, transparent 2px), linear-gradient(to top, rgba(20, 17, 15, 0.88) 0%, rgba(25, 22, 19, 0.7) 50%, rgba(28, 24, 20, 0.45) 100%);
  box-shadow: 0 0.65rem 1.8rem rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 0 0 1px rgba(0, 0, 0, 0.25);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-dialogue]::before {
  position: absolute;
  z-index: 0;
  right: -1px;
  bottom: 100%;
  left: -1px;
  height: 3.75rem;
  background: linear-gradient(to top, rgba(18, 15, 12, 0.5) 0%, rgba(24, 21, 18, 0.22) 58%, transparent 100%);
  content: "";
  pointer-events: none;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-speaker] {
  position: absolute;
  top: -2.75rem;
  left: 0.2rem;
  z-index: 5;
  display: inline-block;
  min-height: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  color: #ff7095;
  font-family: "Segoe Print", "Comic Sans MS", cursive;
  font-size: 1.45rem;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0;
  text-transform: none;
  text-shadow: 0 1px 2px #000, 1px 0 2px #000, 0 -1px 2px #000, -1px 0 2px #000, 0 2px 4px rgba(0, 0, 0, 0.9);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-dialogue-text] {
  position: relative;
  z-index: 1;
  color: #ffffff;
  font-family: "Comic Sans MS", "Segoe Print", "Trebuchet MS", cursive;
  font-weight: 600;
  line-height: 1.55;
  letter-spacing: 0.005em;
  text-shadow: 0 1px 2px #000, 1px 0 2px #000, 0 -1px 2px #000, -1px 0 2px #000, 0 2px 3px rgba(0, 0, 0, 0.9);
}
/* Quiet text-button row on the top edge, readable over any scene thanks to the outline shadow. */
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-controls] {
  top: -2.6rem;
  right: 0.35rem;
  z-index: 5;
  gap: 0.1rem;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}
@media (max-width: 640px) {
  [data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-controls] {
    /* The handwritten nameplate hangs 2.75rem above the box. */
    top: calc(-1 * (var(--vn-control-size) + 3rem));
    right: 0.35rem;
  }
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-control] {
  padding: 0.2rem 0.55rem;
  border: 1px solid transparent;
  color: rgba(255, 255, 255, 0.9);
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 0.74rem;
  font-weight: 650;
  letter-spacing: 0.03em;
  text-shadow: 0 1px 2px #000, 0 0 3px #000;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-control-icon] { filter: drop-shadow(0 1px 1px #000) drop-shadow(0 0 2px rgba(0, 0, 0, 0.9)); }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-control]:hover:not(:disabled) {
  border-color: rgba(255, 112, 149, 0.55);
  background: rgba(20, 16, 14, 0.55);
  color: #ffffff;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-control][data-vn-active="true"] {
  border-color: rgba(255, 220, 229, 0.75);
  background-color: rgba(255, 112, 149, 0.9);
  background-image: none;
  color: #1c0d12;
  text-shadow: none;
  box-shadow: 0 0 8px rgba(255, 112, 149, 0.4);
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-control][data-vn-active="true"] [data-vn-control-icon] { filter: none; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-control]:disabled { opacity: 0.45; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-continue] {
  position: absolute;
  z-index: 2;
  right: 1.15rem;
  bottom: 0.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: auto;
  min-width: 2.4rem;
  min-height: 2.4rem;
  padding: 0.2rem;
  border: none;
  border-radius: 0;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  box-shadow: none;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-continue]::before {
  content: none !important;
  display: none !important;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-continue]::after {
  content: "➔";
  color: inherit;
  font-family: "Segoe UI Symbol", "Arial Unicode MS", sans-serif;
  font-size: 1.6rem;
  font-weight: 900;
  line-height: 1;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.95)) drop-shadow(0 0 2px #000);
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-continue][data-vn-ready="true"]:hover { color: #ff94ab; border-color: transparent; box-shadow: none; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-progress] {
  display: none;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-interaction-title],
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-interaction-hint],
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-game-group-label] { text-shadow: 0 1px 2px #000, 1px 0 2px #000, -1px 0 2px #000, 0 -1px 2px #000; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-choice-list] { gap: 0.6rem; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-choice] {
  justify-content: center;
  padding-right: 2.4rem;
  padding-left: 2.4rem;
  border: 1px solid rgba(195, 182, 168, 0.6);
  border-radius: 2px;
  background-color: rgba(36, 32, 28, 0.92);
  background-image: linear-gradient(to top, rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.04));
  color: #ffffff;
  font-family: "Comic Sans MS", "Segoe Print", "Trebuchet MS", cursive;
  font-weight: 600;
  text-align: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: none;
  text-shadow: 0 1px 2px #000;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-choice]::after { position: absolute; right: 1.1rem; color: #ff7095; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-choice]:hover:not(:disabled),
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-choice]:focus-visible {
  border-color: #ff7396;
  background-color: rgba(52, 40, 36, 0.97);
  color: #ff8fab;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255, 115, 150, 0.35);
  transform: none;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-choice]:active:not(:disabled) { transform: scale(0.99); }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-input-form] { border-radius: 2px; background-image: linear-gradient(to top, rgba(0, 0, 0, 0.18), transparent); }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-input] { border-radius: 2px; border-color: rgba(195, 182, 168, 0.5); }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-submit] { border-radius: 2px; border-color: rgba(255, 220, 229, 0.7); }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-game-choice] { border-radius: 2px; border-color: rgba(195, 182, 168, 0.55); background-image: none; backdrop-filter: none; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-game-odds] { border-radius: 2px; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-badge] {
  border: 1px solid rgba(195, 182, 168, 0.5);
  border-radius: 2px;
  background: rgba(32, 28, 24, 0.92);
  color: #ffffff;
  font-family: "Segoe UI", system-ui, sans-serif;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-badge-icon="spinner"],
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-badge-icon="reroll"] { color: #ff7396; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-badge-action] { border-radius: 2px; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-backlog] {
  background: rgba(22, 19, 16, 0.96);
  color: #ffffff;
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-backlog-title] { color: #ff7396; font-family: "Segoe Print", "Comic Sans MS", cursive; letter-spacing: 0.04em; text-transform: none; font-size: 1.5rem; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-backlog-item] { border-radius: 0; background: rgba(255, 255, 255, 0.03); box-shadow: none; border-color: transparent; border-bottom-color: rgba(195, 182, 168, 0.18); }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-backlog-item]:last-child { background: rgba(255, 112, 149, 0.06); border-color: rgba(255, 112, 149, 0.25); }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-backlog-speaker] { color: #ff7095; font-family: "Segoe Print", "Comic Sans MS", cursive; text-transform: none; letter-spacing: 0; font-size: 1.05rem; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-backlog-text] { font-family: "Comic Sans MS", "Segoe Print", "Trebuchet MS", cursive; }
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-backlog-close] {
  border: 1px solid rgba(195, 182, 168, 0.5);
  border-radius: 2px;
  background: rgba(36, 28, 24, 0.85);
  color: #ff7396;
}
`;

/* literature-club — pink club-room textbox (Doki Doki Literature Club style) */
const LITERATURE_CLUB_CSS = `
[data-vn-root][data-vn-preset="literature-club"] {
  --vn-accent: #e8507c;
  --vn-text: #ffffff;
  --vn-muted-text: rgba(255, 235, 245, 0.88);
  --vn-dialogue-bg: linear-gradient(to bottom, rgba(255, 150, 197, 0.94) 0%, rgba(250, 146, 193, 0.86) 45%, rgba(229, 140, 184, 0.64) 100%);
  --vn-dialogue-border: #ffd9ea;
  --vn-dialogue-width: min(74rem, calc(100 * var(--vn-vw, 1vw) - 2.5rem));
  --vn-font-family: "Comic Sans MS", "Comfortaa", "Nunito", "Trebuchet MS", ui-rounded, sans-serif;
  --vn-dialogue-font-size: clamp(1.12rem, 1.2 * var(--vn-vw, 1vw) + 0.8rem, 1.46rem);
  --vn-transition-duration: 260ms;
  --vn-nameplate-lift: 1.3rem;
  --vn-interaction-width: min(34rem, 100%);
  --vn-accent-contrast: #ffffff;
  --vn-focus-ring: #b8285a;
  --vn-chrome-bg: rgba(255, 240, 246, 0.96);
  --vn-chrome-border: #ffffff;
  --vn-chrome-text: #7a2446;
  --vn-chrome-hover: rgba(232, 80, 124, 0.12);
  --vn-panel-bg: rgba(255, 244, 249, 0.97);
  --vn-panel-solid: #fff4f9;
  --vn-panel-border: #ffffff;
  --vn-odds-good: #2c7a47;
  --vn-odds-fair: #9a6510;
  --vn-odds-poor: #b8285a;
  --vn-error: #c43868;
  --vn-error-title: #b8285a;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-ornament-group][data-vn-preset="literature-club"] { display: block; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-dialogue] {
  position: relative;
  min-height: 9rem;
  padding: 1.6rem 3.6rem 2.6rem 2.3rem;
  border: 3px solid #ffd9ea;
  border-radius: 0.9rem;
  background-image: radial-gradient(circle, rgba(234, 108, 163, 0.28) 33%, transparent 36%), linear-gradient(to bottom, rgba(255, 150, 197, 0.94) 0%, rgba(250, 146, 193, 0.86) 45%, rgba(229, 140, 184, 0.64) 100%);
  background-size: 2.8rem 2.8rem, 100% 100%;
  box-shadow: 0 6px 24px rgba(150, 60, 95, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.6), inset 0 0 0 1px rgba(214, 96, 146, 0.35);
  backdrop-filter: blur(0.2rem);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-speaker] {
  position: absolute;
  top: -2.6rem;
  left: 1.4rem;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 1.5rem 0.34rem;
  border: 2.5px solid #ffe7f1;
  border-radius: 0.7rem;
  background: linear-gradient(180deg, #ffdcea 0%, #ffb9d5 55%, #ffa9cb 100%);
  color: #ffffff;
  font-family: "Comic Sans MS", "Comfortaa", ui-rounded, sans-serif;
  font-weight: 800;
  font-size: 1.3rem;
  letter-spacing: 0.02em;
  text-transform: none;
  text-shadow: 0 1.5px 2px #c4577f, 1.5px 0 2px #c4577f, 0 -1.5px 2px #c4577f, -1.5px 0 2px #c4577f, 0 2px 3px rgba(150, 60, 95, 0.55);
  box-shadow: 0 4px 12px rgba(150, 60, 95, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-dialogue-text] {
  color: #ffffff;
  font-family: "Comic Sans MS", "Comfortaa", "Trebuchet MS", ui-rounded, sans-serif;
  font-weight: 700;
  line-height: 1.55;
  text-shadow: 0 1.5px 2px rgba(97, 58, 78, 0.95), 1.5px 0 2px rgba(97, 58, 78, 0.95), 0 -1.5px 2px rgba(97, 58, 78, 0.95), -1.5px 0 2px rgba(97, 58, 78, 0.95);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-controls] {
  top: auto;
  right: auto;
  bottom: 0.45rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  gap: 0.9rem;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}
@media (max-width: 640px) {
  [data-vn-root][data-vn-preset="literature-club"] [data-vn-controls] {
    /* Left-aligned so the row never runs under the continue arrow. */
    left: 1.2rem;
    right: 3.2rem;
    transform: none;
    justify-content: flex-start;
    gap: 0.35rem;
  }

  [data-vn-root][data-vn-preset="literature-club"] [data-vn-dialogue] {
    padding-bottom: calc(var(--vn-control-size) + 1rem);
  }
}
/* DDLC-style quick menu: plain words along the bottom of the textbox. */
[data-vn-root][data-vn-preset="literature-club"] [data-vn-control] {
  padding: 0.1rem 0.3rem;
  border: none;
  background: transparent;
  color: #6a2140;
  font-family: var(--vn-font-family);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.45);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-control-icon] { display: none; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-control]:hover:not(:disabled) {
  background: transparent;
  color: #ffffff;
  text-shadow: 0 1px 2px #b8285a, 1px 0 2px #b8285a, -1px 0 2px #b8285a, 0 -1px 2px #b8285a;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-control][data-vn-active="true"] {
  border: none;
  background-color: transparent;
  background-image: none;
  color: #ffffff;
  box-shadow: none;
  text-shadow: 0 1px 2px #b8285a, 1px 0 2px #b8285a, -1px 0 2px #b8285a, 0 -1px 2px #b8285a;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-control][data-vn-active="true"]:hover:not(:disabled) { background-color: transparent; color: #fff0f6; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-control][data-vn-active="true"]::after {
  position: absolute;
  right: 0.3rem;
  bottom: 0;
  left: 0.3rem;
  height: 2px;
  border-radius: 2px;
  background: #ffffff;
  box-shadow: 0 1px 2px #b8285a;
  content: "";
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-control]:disabled { opacity: 0.5; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-control]:focus-visible { outline-color: #ffffff; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-auto-ring] { color: #ffffff; filter: drop-shadow(0 1px 1px #b8285a); }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-continue] {
  position: absolute;
  right: 1.05rem;
  bottom: 0.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: auto;
  min-width: 2.2rem;
  min-height: 2.2rem;
  padding: 0.2rem;
  border: none;
  border-radius: 0;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  box-shadow: none;
  filter: drop-shadow(0 1px 2px rgba(150, 60, 95, 0.75));
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-continue]::before {
  content: none !important;
  display: none !important;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-continue]::after {
  content: "▶";
  color: inherit;
  font-size: 1.1rem;
  line-height: 1;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-continue][data-vn-ready="true"]:hover { color: #fff0f6; border-color: transparent; box-shadow: none; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-progress] {
  display: none;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-interaction-title] { font-family: var(--vn-font-family); letter-spacing: 0.06em; text-transform: none; font-size: 1.15rem; text-shadow: 0 1.5px 2px #c4577f, 1.5px 0 2px #c4577f, 0 -1.5px 2px #c4577f, -1.5px 0 2px #c4577f; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-interaction-title]::before { width: 0.8em; height: 0.8em; border-radius: 0; background: none; box-shadow: none; content: "♥"; color: #ff9cc0; font-size: 1em; line-height: 0.8; text-shadow: 0 1px 2px #b8285a; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-interaction-title]::after { background: linear-gradient(90deg, rgba(255, 255, 255, 0.85), transparent); height: 2px; border-radius: 2px; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-interaction-hint] { font-weight: 700; text-shadow: 0 1px 2px rgba(150, 60, 95, 0.9), 0 0 6px rgba(150, 60, 95, 0.6); }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-choice-list] { gap: 0.7rem; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-choice] {
  justify-content: center;
  padding-right: 2.4rem;
  padding-left: 2.4rem;
  border: 2.5px solid #ffffff;
  border-radius: 1rem;
  background-color: rgba(255, 240, 246, 0.97);
  background-image: none;
  color: #7a1f44;
  font-family: var(--vn-font-family);
  font-weight: 700;
  text-align: center;
  box-shadow: 0 4px 14px rgba(232, 80, 124, 0.28), inset 0 0 0 1px rgba(255, 170, 200, 0.6);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-choice]::after { position: absolute; right: 1.1rem; color: #e8507c; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-choice]:hover:not(:disabled),
[data-vn-root][data-vn-preset="literature-club"] [data-vn-choice]:focus-visible {
  border-color: #ff8fb5;
  background-color: #ffffff;
  color: #b8285a;
  box-shadow: 0 7px 20px rgba(232, 80, 124, 0.42), inset 0 0 0 1px rgba(232, 80, 124, 0.35);
  transform: translateY(-2px);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-choice]:active:not(:disabled) { transform: translateY(0) scale(0.98); background-color: #ffe6f0; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-input-form] {
  border: 3px solid #ffffff;
  border-radius: 1.1rem;
  background-color: rgba(255, 238, 245, 0.96);
  background-image: radial-gradient(circle, rgba(232, 80, 124, 0.1) 22%, transparent 24%);
  background-size: 1.4rem 1.4rem;
  box-shadow: 0 0.8rem 2rem rgba(150, 60, 95, 0.35);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-input] {
  border: 2px solid #ffb3cd;
  border-radius: 0.8rem;
  background: #ffffff;
  color: #4a1730;
  font-family: var(--vn-font-family);
  box-shadow: inset 0 1px 3px rgba(150, 60, 95, 0.15);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-input]::placeholder { color: #a8577a; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-input]:focus { border-color: #e8507c; box-shadow: inset 0 1px 3px rgba(150, 60, 95, 0.15), 0 0 0 3px rgba(232, 80, 124, 0.2); }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-submit] {
  border: 2.5px solid #ffffff;
  background-color: #e8507c;
  background-image: linear-gradient(180deg, #cf3865, #b02656);
  color: #ffffff;
  font-family: var(--vn-font-family);
  text-shadow: 0 1px 1px #7a1538;
  box-shadow: 0 4px 12px rgba(232, 80, 124, 0.4);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-game-choice] {
  border: 2px solid #ffffff;
  background-color: rgba(255, 240, 246, 0.97);
  background-image: none;
  color: #7a1f44;
  font-family: var(--vn-font-family);
  font-weight: 700;
  box-shadow: 0 3px 10px rgba(232, 80, 124, 0.3);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-game-choice]:hover:not(:disabled) { border-color: #ff8fb5; background-color: #ffffff; color: #b8285a; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-game-group-label] { color: #ffffff; text-shadow: 0 1px 2px #b8285a, 0 0 4px #b8285a; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge] {
  border: 2.5px solid #ffffff;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(255, 240, 246, 0.97), rgba(255, 215, 230, 0.97));
  color: #8f1f48;
  font-family: var(--vn-font-family);
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(232, 80, 124, 0.32);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-icon="spinner"],
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-icon="reroll"] { color: #e8507c; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-icon="image"] { color: #3b6fb0; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-icon="check"] { color: #2c7a47; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-icon="alert"] { color: #9a6510; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge][data-vn-badge-interactive="true"]:hover,
[data-vn-root][data-vn-preset="literature-club"] button[data-vn-badge]:hover { border-color: #ff8fb5; background: #ffffff; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-kind="error"] { border-radius: 1rem; background: #fff0f4; color: #6a1530; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-title] { color: #b8285a; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-details] summary,
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-note] { color: #8f3a5c; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-details] pre { background: rgba(232, 80, 124, 0.08); color: #4a1730; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-action] { border-color: #e8507c; background: #e8507c; color: #ffffff; box-shadow: none; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-action]:hover { background: #d43f6c; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog] {
  background-color: rgba(255, 242, 247, 0.97);
  background-image: radial-gradient(circle, rgba(232, 80, 124, 0.14) 20%, transparent 22%);
  background-size: 1.5rem 1.5rem;
  color: #44162e;
  border: 4px solid #ffffff;
  border-radius: 1.5rem;
  box-shadow: inset 0 0 0 2px #ffc2d7, 0 1rem 3rem rgba(232, 80, 124, 0.35);
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-header] { border-bottom: 2px dashed #ffb3cd; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-title] { color: #c43868; font-weight: 800; letter-spacing: 0.08em; text-transform: none; font-size: 1.4rem; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-item] { border: 2px solid #ffffff; border-radius: 1rem; background: rgba(255, 255, 255, 0.85); box-shadow: 0 2px 8px rgba(232, 80, 124, 0.15); }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-item]:last-child { border-color: #ffb3cd; background: #ffffff; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-speaker] { color: #c43868; text-transform: none; letter-spacing: 0.02em; font-size: 0.95rem; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-text] { color: #44162e; font-weight: 600; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-content]::-webkit-scrollbar-thumb { background: #ffb3cd; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-close] {
  border: 2px solid #ffa0bc;
  background: #ffffff;
  color: #c43868;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-close]:hover { border-color: #e8507c; background: #ffe6f0; }
`;

export const THEME_PRESET_CSS: Record<ThemePresetId, string> = {
  lumiverse: LUMIVERSE_CSS,
  "golden-hour": GOLDEN_HOUR_CSS,
  "boxed-console": BOXED_CONSOLE_CSS,
  "paper-novel": PAPER_NOVEL_CSS,
  "midnight-noir": MIDNIGHT_NOIR_CSS,
  "yamaku-classic": YAMAKU_CLASSIC_CSS,
  "literature-club": LITERATURE_CLUB_CSS,
};

export const isThemePresetId = (value: unknown): value is ThemePresetId =>
  typeof value === "string" && (THEME_PRESET_IDS as readonly string[]).includes(value);
