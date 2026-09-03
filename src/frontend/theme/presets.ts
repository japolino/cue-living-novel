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
  --vn-dialogue-bg: var(--lumiverse-card-bg, linear-gradient(180deg, rgba(21, 16, 33, 0.78), rgba(8, 9, 15, 0.94)));
  --vn-dialogue-border: var(--lumiverse-border, rgba(255, 255, 255, 0.3));
  --vn-dialogue-width: min(72rem, calc(100vw - 3rem));
  --vn-font-family: var(--lumiverse-font-family, ui-rounded, "Segoe UI", system-ui, sans-serif);
  --vn-dialogue-font-size: clamp(1rem, 1.1vw + 0.75rem, 1.35rem);
  --vn-transition-duration: 280ms;
}

[data-vn-root][data-vn-preset="lumiverse"] [data-vn-ornament-group][data-vn-preset="lumiverse"] { display: block; }
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-dialogue] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.3));
  box-shadow: 0 1rem 3rem rgba(8, 5, 18, 0.48), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-speaker] { color: var(--lumiverse-primary, #d8a8ff); }
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-continue] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.38));
  background: var(--lumiverse-fill-medium, rgba(255, 255, 255, 0.1));
  color: var(--lumiverse-text, #fff);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-choice] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.4));
  background: var(--lumiverse-bg-elevated, rgba(16, 14, 26, 0.88));
  color: var(--lumiverse-text, #fff);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-choice]:hover:not(:disabled) { border-color: var(--lumiverse-primary, #d8a8ff); }
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-input-form] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.32));
  background: var(--lumiverse-bg-elevated, rgba(10, 10, 17, 0.9));
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-input] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.3));
  background: var(--lumiverse-bg-elevated, rgba(255, 255, 255, 0.07));
  color: var(--lumiverse-text, #fff);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-submit] {
  border-color: var(--lumiverse-primary, #d8a8ff);
  background: var(--lumiverse-primary, #d8a8ff);
  color: var(--lumiverse-primary-contrast, #17101d);
}
@media (prefers-reduced-motion: no-preference) {
  [data-vn-root][data-vn-preset="lumiverse"] [data-vn-continue] { transition: box-shadow 180ms ease, border-color 180ms ease; }
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-control] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.28));
  background: var(--lumiverse-fill-medium, rgba(20, 16, 32, 0.78));
  color: var(--vn-muted-text);
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-control]:hover {
  border-color: var(--lumiverse-primary, #d8a8ff);
  color: var(--vn-text);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-control][data-vn-active="true"] {
  background: var(--lumiverse-primary, #d8a8ff);
  color: #0b0714;
  border-color: var(--lumiverse-primary, #d8a8ff);
  box-shadow: 0 0 0.75rem rgba(216, 168, 255, 0.5);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-badge] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.3));
  background: rgba(18, 14, 28, 0.85);
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="lumiverse"] [data-vn-backlog] {
  background: rgba(10, 8, 18, 0.94);
  font-family: var(--vn-font-family);
}
`;

/* golden-hour — afternoon light through smoked glass */
const GOLDEN_HOUR_CSS = `
[data-vn-root][data-vn-preset="golden-hour"] {
  --vn-accent: #e2b06a;
  --vn-text: #fff6e2;
  --vn-muted-text: rgba(255, 244, 218, 0.78);
  --vn-dialogue-bg: linear-gradient(180deg, rgba(36, 25, 17, 0.84), rgba(18, 12, 8, 0.94));
  --vn-dialogue-border: rgba(226, 176, 106, 0.9);
  --vn-dialogue-width: min(96rem, calc(100vw - 3rem));
  --vn-font-family: ui-rounded, "Segoe UI", system-ui, sans-serif;
  --vn-dialogue-font-size: clamp(1.05rem, 1.15vw + 0.76rem, 1.42rem);
  --vn-transition-duration: 320ms;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-ornament-group][data-vn-preset="golden-hour"] { display: block; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-scene]::after {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 52% 40%, rgba(255, 191, 105, 0.16) 0 24%, transparent 55%), radial-gradient(ellipse at center, transparent 34%, rgba(32, 20, 12, 0.74) 100%);
  content: "";
  pointer-events: none;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-dialogue] {
  min-height: 8.5rem;
  padding: 1.6rem 4rem 1.45rem 2.6rem;
  border: 1px solid rgba(226, 176, 106, 0.92);
  outline: 1px solid rgba(247, 206, 139, 0.45);
  outline-offset: -5px;
  border-radius: 1.25rem;
  background: linear-gradient(180deg, rgba(38, 27, 18, 0.88), rgba(18, 12, 8, 0.95));
  box-shadow: 0 1rem 3rem rgba(80, 45, 10, 0.5), inset 0 1px 0 rgba(255, 240, 205, 0.16);
  backdrop-filter: blur(1rem) saturate(1.08);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-dialogue]::before {
  position: absolute;
  inset: 2px;
  border: 1px solid rgba(255, 238, 200, 0.22);
  border-radius: 1.5rem;
  content: "";
  pointer-events: none;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-speaker] {
  position: absolute;
  z-index: 2;
  top: -1.05rem;
  left: 1.7rem;
  margin: 0;
  padding: 0.42rem 1.15rem;
  border: 1px solid rgba(226, 176, 106, 0.96);
  border-radius: 999px;
  background: linear-gradient(180deg, #3a2b1e, #1c130c);
  color: #f3d69a;
  font-size: 0.88rem;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  box-shadow: inset 0 0 0 2px rgba(12, 7, 3, 0.7), 0 0 0 2px rgba(244, 202, 131, 0.36), 0 0.4rem 1rem rgba(0, 0, 0, 0.34);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-speaker]::before,
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-speaker]::after { color: #f8d0a9; content: "✦"; font-size: 0.7rem; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-speaker]::before { margin-right: 0.55rem; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-speaker]::after { margin-left: 0.55rem; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-dialogue-text] { color: #fff6e2; line-height: 1.62; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-progress] { color: rgba(255, 220, 166, 0.7); letter-spacing: 0.08em; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-continue] {
  right: 1.45rem;
  bottom: 0.8rem;
  display: flex;
  width: auto;
  height: auto;
  gap: 0.55rem;
  padding: 0.4rem 0.5rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #eba763;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-continue]::before { content: "Click to continue"; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-continue]::after { color: #f8d0a9; content: "»"; font-size: 1.2rem; letter-spacing: -0.08em; line-height: 0.75; text-shadow: 0 0 6px rgba(248, 208, 169, 0.55); }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-interaction] {
  place-items: end center;
  padding-bottom: max(2rem, env(safe-area-inset-bottom));
  background: radial-gradient(ellipse at center, rgba(255, 184, 96, 0.06), rgba(19, 11, 6, 0.58));
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice-list],
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-input-form] {
  width: min(94rem, calc(100vw - 3rem));
  padding: 2rem 3rem;
  border: 1px solid rgba(226, 176, 106, 0.9);
  outline: 1px solid rgba(255, 238, 200, 0.2);
  outline-offset: -5px;
  border-radius: 1.7rem;
  background: linear-gradient(180deg, rgba(38, 27, 18, 0.9), rgba(18, 12, 8, 0.97));
  box-shadow: 0 1rem 3rem rgba(80, 45, 10, 0.5), inset 0 1px 0 rgba(255, 240, 205, 0.14);
  backdrop-filter: blur(1rem) saturate(1.08);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice-list] { gap: 1rem; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice] {
  position: relative;
  min-height: 3.5rem;
  overflow: hidden;
  border: 1px solid rgba(226, 176, 106, 0.92);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(52, 38, 24, 0.98), rgba(22, 15, 9, 0.99));
  color: #fff2d8;
  font-weight: 650;
  letter-spacing: 0.02em;
  text-align: center;
  box-shadow: inset 0 1px 0 rgba(255, 238, 200, 0.2), inset 0 0 0 3px rgba(15, 9, 5, 0.5), 0 0.4rem 1.2rem rgba(0, 0, 0, 0.35);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]::before {
  position: absolute;
  inset: 1px;
  border-radius: 999px;
  background: linear-gradient(120deg, transparent 30%, rgba(255, 238, 200, 0.18) 50%, transparent 70%);
  content: "";
  pointer-events: none;
  transform: translateX(-120%);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]:hover:not(:disabled) { border-color: #ffd58d; background: linear-gradient(180deg, rgba(72, 51, 29, 0.99), rgba(29, 18, 9, 0.99)); }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-input-form] { gap: 0.9rem; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-input-form]::after { color: #d9a461; content: "Enter to send"; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; }
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-input] {
  min-height: 7rem;
  border: 1px solid rgba(226, 176, 106, 0.8);
  border-radius: 0.9rem;
  background: rgba(9, 6, 3, 0.68);
  color: #fff6e2;
  box-shadow: inset 0 1px 0 rgba(255, 238, 200, 0.1);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-submit] {
  width: 3rem;
  min-width: 3rem;
  padding: 0;
  border: 1px solid #f5c96a;
  border-radius: 0.75rem;
  background: #2b1d10;
  color: #f5c96a;
  font-size: 0;
  box-shadow: inset 0 0 0 2px rgba(226, 176, 106, 0.18);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-submit]::before { content: "✈"; font-size: 1.15rem; }
@media (prefers-reduced-motion: no-preference) {
  [data-vn-root][data-vn-preset="golden-hour"] [data-vn-dialogue] { animation: vn-enter var(--vn-transition-duration) ease both, vn-glow-breathe 5s ease-in-out var(--vn-transition-duration) infinite; }
  [data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]::before { transition: transform 600ms ease; }
  [data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]:hover:not(:disabled)::before { transform: translateX(120%); }
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-controls] {
  top: -1.35rem;
  right: 2rem;
  gap: 0.35rem;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-control] {
  padding: 0.22rem 0.65rem;
  border: 1px solid rgba(226, 176, 106, 0.5);
  border-radius: 0.5rem;
  background: rgba(32, 22, 14, 0.92);
  color: #f7ce8b;
  font-family: var(--vn-font-family);
  font-size: 0.72rem;
  box-shadow: 0 2px 8px rgba(30, 15, 5, 0.4);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-control]:hover {
  border-color: #f7ce8b;
  background: rgba(48, 32, 20, 0.94);
  color: #fff8eb;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-control][data-vn-active="true"] {
  background: #e2b06a;
  color: #1a1006;
  border-color: #f7ce8b;
  box-shadow: 0 0 0.85rem rgba(226, 176, 106, 0.6);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-badge] {
  border: 1px solid rgba(226, 176, 106, 0.55);
  background: linear-gradient(135deg, rgba(38, 26, 16, 0.9), rgba(20, 14, 8, 0.94));
  color: #fff6e2;
  box-shadow: 0 0.2rem 0.8rem rgba(50, 25, 10, 0.35);
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-badge-icon="spinner"] {
  color: #e2b06a;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-backlog] {
  background: rgba(18, 12, 8, 0.95);
  color: #fff6e2;
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-backlog-title] {
  color: #e2b06a;
}
[data-vn-root][data-vn-preset="golden-hour"] [data-vn-backlog-close] {
  border: 1px solid rgba(226, 176, 106, 0.5);
  background: rgba(36, 25, 16, 0.85);
  color: #f7ce8b;
}
`;

/* boxed-console — segmented phosphor hardware HUD */
const BOXED_CONSOLE_CSS = `
[data-vn-root][data-vn-preset="boxed-console"] {
  --vn-accent: #7dffa1;
  --vn-text: #e7f9eb;
  --vn-muted-text: rgba(190, 222, 197, 0.74);
  --vn-dialogue-bg: linear-gradient(180deg, #0e1412, #080d0b);
  --vn-dialogue-border: #31483a;
  --vn-dialogue-width: min(86rem, calc(100vw - 3rem));
  --vn-font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  --vn-transition-duration: 180ms;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-ornament-group][data-vn-preset="boxed-console"] { display: block; filter: drop-shadow(0 0 6px rgba(125, 255, 161, 0.35)); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-dialogue] {
  overflow: hidden;
  padding-top: 2rem;
  border: 1px solid #405b49;
  outline: 1px solid #17251d;
  outline-offset: -5px;
  border-radius: 2px;
  background: repeating-linear-gradient(0deg, rgba(125, 255, 161, 0.035) 0 1px, transparent 1px 4px), linear-gradient(180deg, #0e1412, #080d0b);
  box-shadow: 8px 8px 0 rgba(0, 0, 0, 0.62), inset 4px 0 0 rgba(125, 255, 161, 0.14);
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-dialogue]::before {
  position: absolute;
  top: 0.65rem;
  right: 0.8rem;
  left: 0.8rem;
  height: 1px;
  background: #7dffa1;
  box-shadow: 0 4px 0 rgba(125, 255, 161, 0.18);
  content: "";
  opacity: 0.7;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-speaker] { color: #7dffa1; font-weight: 800; letter-spacing: 0.18em; text-shadow: 0 0 8px rgba(125, 255, 161, 0.48); text-transform: uppercase; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-speaker]::before { content: "> "; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-speaker]::after { color: #7dffa1; content: " _"; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-dialogue-text] { text-shadow: 0 0 5px rgba(125, 255, 161, 0.13); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-progress] { border-top: 1px solid #24382c; padding-top: 0.5rem; letter-spacing: 0.12em; text-transform: uppercase; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-continue] { width: 2.7rem; height: 2.2rem; border: 1px solid #7dffa1; border-radius: 0; background: #0a110d; color: #7dffa1; box-shadow: 3px 3px 0 rgba(125, 255, 161, 0.22); text-shadow: 0 0 8px rgba(125, 255, 161, 0.65); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-continue]::before { content: "▸"; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-interaction] { background: rgba(2, 7, 4, 0.72); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice-list],
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-input-form] { border: 1px solid #405b49; border-radius: 0; background: repeating-linear-gradient(0deg, rgba(125, 255, 161, 0.03) 0 1px, transparent 1px 4px), #080d0b; box-shadow: 8px 8px 0 rgba(0, 0, 0, 0.62); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice] { position: relative; padding-left: 2.7rem; border: 1px solid #31483a; border-radius: 0; background: #0d1410; color: #e7f9eb; letter-spacing: 0.04em; box-shadow: inset 4px 0 0 #24382c; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]::before { position: absolute; left: 1rem; color: #7dffa1; content: ">"; opacity: 0.28; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:hover:not(:disabled) { border-color: #7dffa1; background: #122019; color: #fff; box-shadow: inset 6px 0 0 #7dffa1; text-shadow: 0 0 7px rgba(125, 255, 161, 0.35); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:hover:not(:disabled)::before { opacity: 1; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-input-form] { padding: 1.2rem; }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-input] { border: 1px solid #405b49; border-radius: 0; background: #050907; color: #e7f9eb; caret-color: #7dffa1; box-shadow: inset 4px 0 0 rgba(125, 255, 161, 0.25); }
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-submit] { border: 1px solid #7dffa1; border-radius: 0; background: #7dffa1; color: #061009; box-shadow: 4px 4px 0 #294b33; letter-spacing: 0.12em; text-transform: uppercase; }
@media (prefers-reduced-motion: no-preference) {
  [data-vn-root][data-vn-preset="boxed-console"] [data-vn-speaker]::after { animation: vn-console-caret 1s steps(1) infinite; }
  [data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice] { transition: border-color 120ms steps(2), box-shadow 120ms steps(2); }
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-control] {
  border: 1px solid #16a34a;
  border-radius: 0;
  background: #020803;
  color: #4ade80;
  font-family: var(--vn-font-family);
  letter-spacing: 0.08em;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-control]:hover {
  border-color: #4ade80;
  background: #0f2e17;
  color: #86efac;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-control][data-vn-active="true"] {
  background: #22c55e;
  color: #020803;
  border-color: #22c55e;
  box-shadow: 0 0 10px #22c55e;
  font-weight: 700;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-badge] {
  border: 1px solid #22c55e;
  border-radius: 0;
  background: #020803;
  color: #86efac;
  font-family: var(--vn-font-family);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.25);
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-badge-icon="spinner"] {
  color: #4ade80;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-backlog] {
  background: #020803;
  color: #86efac;
  font-family: var(--vn-font-family);
  border: 2px solid #22c55e;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-backlog-title] {
  color: #4ade80;
  letter-spacing: 0.1em;
}
[data-vn-root][data-vn-preset="boxed-console"] [data-vn-backlog-close] {
  border: 1px solid #22c55e;
  border-radius: 0;
  background: #0f2e17;
  color: #86efac;
}
`;

/* paper-novel — aged letterpress page */
const PAPER_NOVEL_CSS = `
[data-vn-root][data-vn-preset="paper-novel"] {
  --vn-accent: #8a2f23;
  --vn-text: #29221e;
  --vn-muted-text: rgba(70, 57, 48, 0.78);
  --vn-dialogue-bg: #efe6d3;
  --vn-dialogue-border: rgba(101, 75, 43, 0.46);
  --vn-dialogue-width: min(78rem, calc(100vw - 3rem));
  --vn-font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
  --vn-dialogue-font-size: clamp(1.05rem, 1vw + 0.82rem, 1.35rem);
  --vn-transition-duration: 360ms;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-ornament-group][data-vn-preset="paper-novel"] { display: block; color: #8a2f23; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-dialogue] {
  padding: 2.55rem 3.6rem 2rem 3.2rem;
  border: 1px solid rgba(101, 75, 43, 0.46);
  outline: 1px solid rgba(101, 75, 43, 0.22);
  outline-offset: -6px;
  border-radius: 2px;
  background: linear-gradient(180deg, rgba(122, 90, 40, 0.045) 0 1px, transparent 1px 3px), #efe6d3;
  color: #29221e;
  box-shadow: 0 0.7rem 1.8rem rgba(57, 40, 22, 0.25), inset 0 0 1.5rem rgba(94, 68, 36, 0.1);
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-dialogue]::before {
  position: absolute;
  top: 1rem;
  right: 2rem;
  left: 2rem;
  height: 4px;
  border-top: 1px solid #8a2f23;
  border-bottom: 1px solid rgba(138, 47, 35, 0.5);
  content: "";
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-speaker] { margin-bottom: 0.8rem; padding-bottom: 0.38rem; border-bottom: 1px solid rgba(138, 47, 35, 0.42); color: #8a2f23; font-variant: small-caps; font-weight: 700; letter-spacing: 0.12em; text-transform: lowercase; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-dialogue-text] { color: #29221e; line-height: 1.68; text-shadow: 0 1px rgba(255, 255, 255, 0.24); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-progress] { color: #715f50; font-style: italic; text-align: center; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-continue] { border: 0; border-radius: 0; background: transparent; color: #8a2f23; font-size: 1.35rem; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-continue]::before { content: "❦"; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-interaction] { background: rgba(45, 35, 25, 0.36); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice-list],
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-input-form] { padding: 1.5rem; border: 1px solid rgba(101, 75, 43, 0.46); border-radius: 2px; background: #efe6d3; color: #29221e; box-shadow: 0 0.8rem 2rem rgba(57, 40, 22, 0.3), inset 0 0 0 6px rgba(255, 250, 238, 0.35); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice] { position: relative; padding-left: 2.2rem; border: 0; border-bottom: 1px solid rgba(101, 75, 43, 0.32); border-radius: 0; background: transparent; color: #29221e; box-shadow: none; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]::before { position: absolute; left: 0.7rem; color: #8a2f23; content: "⁃"; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; background: #8a2f23; content: ""; transform: scaleX(0); transform-origin: left; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]:hover:not(:disabled) { border-color: rgba(138, 47, 35, 0.35); background: rgba(138, 47, 35, 0.055); }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-input] { border: 1px solid rgba(101, 75, 43, 0.48); border-radius: 2px; background: rgba(255, 250, 238, 0.52); color: #29221e; caret-color: #8a2f23; }
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-submit] { border: 1px solid #632018; border-radius: 2px; background: #8a2f23; color: #fff8ec; box-shadow: 3px 3px 0 rgba(75, 32, 24, 0.28); font-variant: small-caps; letter-spacing: 0.08em; }
@media (prefers-reduced-motion: no-preference) {
  [data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]::after { transition: transform 260ms ease; }
  [data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]:hover:not(:disabled)::after { transform: scaleX(1); }
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-control] {
  border: 1px solid #c2b59b;
  border-radius: 0.35rem;
  background: #f4eee2;
  color: #605043;
  font-family: var(--vn-font-family);
  box-shadow: 0 1px 3px rgba(45, 35, 25, 0.12);
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-control]:hover {
  border-color: #8a2f23;
  background: #ebe0cb;
  color: #8a2f23;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-control][data-vn-active="true"] {
  background: #8a2f23;
  color: #fbf5e8;
  border-color: #8a2f23;
  box-shadow: 0 2px 6px rgba(138, 47, 35, 0.3);
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge] {
  border: 1px solid #b8ab8e;
  border-radius: 0.4rem;
  background: #f8f3e8;
  color: #2b221a;
  font-family: var(--vn-font-family);
  box-shadow: 0 2px 8px rgba(50, 40, 30, 0.12);
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-badge-icon="spinner"] {
  color: #8a2f23;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog] {
  background: #fbf6ec;
  color: #2b221a;
  font-family: var(--vn-font-family);
  border: 4px double #8a2f23;
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog-title] {
  color: #8a2f23;
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="paper-novel"] [data-vn-backlog-close] {
  border: 1px solid #c2b59b;
  border-radius: 0.35rem;
  background: #ebe0cb;
  color: #8a2f23;
}
`;

/* midnight-noir — cinema marquee and art-deco geometry */
const MIDNIGHT_NOIR_CSS = `
[data-vn-root][data-vn-preset="midnight-noir"] {
  --vn-accent: #d9a441;
  --vn-text: #f3efe5;
  --vn-muted-text: rgba(222, 218, 207, 0.7);
  --vn-dialogue-bg: linear-gradient(180deg, rgba(28, 30, 34, 0.92) 0%, rgba(14, 16, 18, 0.96) 100%);
  --vn-dialogue-border: rgba(165, 150, 135, 0.75);
  --vn-dialogue-width: min(86rem, calc(100vw - 2.5rem));
  --vn-font-family: Georgia, "Iowan Old Style", serif;
  --vn-transition-duration: 420ms;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-ornament-group][data-vn-preset="midnight-noir"] { display: block; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-scene]::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(2, 4, 10, 0.18) 0%, transparent 18% 76%, rgba(2, 4, 10, 0.34) 100%), radial-gradient(ellipse at center, transparent 62%, rgba(2, 5, 13, 0.22) 100%);
  content: "";
  pointer-events: none;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue] {
  position: relative;
  min-height: 8.5rem;
  padding: 1.55rem 3.8rem 1.45rem 2.4rem;
  border: 1px solid rgba(165, 150, 135, 0.75);
  outline: 1px solid rgba(80, 70, 60, 0.55);
  outline-offset: -3px;
  border-radius: 0.35rem;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.012) 0 1px, transparent 1px 4px), linear-gradient(180deg, rgba(28, 30, 34, 0.92) 0%, rgba(14, 16, 18, 0.96) 100%);
  box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(1.2rem) saturate(1.1);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue]::before {
  position: absolute;
  top: 0.75rem;
  right: 1.2rem;
  left: 1.2rem;
  height: 2px;
  border-top: 1px solid rgba(165, 150, 135, 0.65);
  border-bottom: 1px solid rgba(217, 164, 65, 0.3);
  content: "";
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue]::after {
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 35%, rgba(255, 226, 166, 0.1) 50%, transparent 65%);
  content: "";
  pointer-events: none;
  transform: translateX(-130%);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-speaker] {
  position: absolute;
  top: -1.35rem;
  left: 2rem;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 1.4rem;
  border: 1px solid rgba(165, 150, 135, 0.8);
  border-bottom: none;
  border-radius: 0.35rem 0.35rem 0 0;
  background: rgba(22, 24, 25, 0.96);
  color: #d9a441;
  font-weight: 700;
  font-size: 1.15rem;
  letter-spacing: 0.05em;
  box-shadow: 0 -3px 10px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  text-shadow: 0 0 12px rgba(217, 164, 65, 0.22);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue-text] {
  color: #f3efe5;
  line-height: 1.62;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-controls] {
  top: -1.35rem;
  right: 2rem;
  gap: 0.35rem;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-control] {
  padding: 0.22rem 0.65rem;
  border: 1px solid rgba(165, 150, 135, 0.5);
  border-bottom: none;
  border-radius: 0.25rem 0.25rem 0 0;
  background: rgba(20, 22, 24, 0.92);
  color: #c5b9a8;
  font-family: var(--vn-font-family);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  box-shadow: 0 -2px 6px rgba(0, 0, 0, 0.35);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-control]:hover {
  border-color: #efc76e;
  background: rgba(30, 34, 42, 0.96);
  color: #fff8e8;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-control][data-vn-active="true"] {
  background: #d9a441;
  color: #090b10;
  border-color: #efc76e;
  box-shadow: 0 0 12px rgba(217, 164, 65, 0.5);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-progress] {
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-continue] {
  width: 2.7rem;
  height: 2rem;
  border: 1px solid #d9a441;
  border-radius: 0;
  background: #0a0f1c;
  color: #d9a441;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-continue]::before {
  content: "››";
  letter-spacing: -0.12em;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-interaction] {
  background: linear-gradient(180deg, rgba(2, 4, 10, 0.88) 0 9%, rgba(3, 6, 13, 0.48) 9% 89%, rgba(2, 4, 10, 0.9) 89% 100%);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice-list],
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-input-form] {
  padding: 1.4rem;
  border: 1px solid rgba(217, 164, 65, 0.58);
  border-radius: 2px;
  background: linear-gradient(180deg, rgba(10, 15, 28, 0.97), rgba(4, 7, 14, 0.99));
  box-shadow: 0 1.4rem 4rem rgba(0, 0, 0, 0.72), inset 0 0 0 4px rgba(217, 164, 65, 0.04);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice] {
  border: 1px solid rgba(217, 164, 65, 0.48);
  border-radius: 0;
  background: rgba(10, 15, 28, 0.94);
  color: #f3efe5;
  letter-spacing: 0.08em;
  box-shadow: inset 0 0 0 3px #060a13;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]:hover:not(:disabled) {
  border-color: #e9b95e;
  background: rgba(24, 30, 43, 0.98);
  color: #fff9ea;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-input] {
  border: 1px solid rgba(217, 164, 65, 0.48);
  border-radius: 0;
  background: #080d19;
  color: #f3efe5;
  caret-color: #d9a441;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-submit] {
  border: 1px solid #efc76e;
  border-radius: 0;
  background: #d9a441;
  color: #090b10;
  box-shadow: inset 0 0 0 3px rgba(4, 7, 14, 0.28);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
@media (prefers-reduced-motion: no-preference) {
  [data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue]::after { animation: vn-noir-sweep 2.2s ease-out 280ms 1; }
  [data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice] { transition: border-color 180ms ease, background 180ms ease; }
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-badge] {
  border: 1px solid rgba(217, 164, 65, 0.45);
  border-radius: 0;
  background: rgba(8, 12, 22, 0.92);
  color: #f3efe5;
  font-family: var(--vn-font-family);
  box-shadow: inset 0 0 0 2px #050810, 0 4px 12px rgba(0, 0, 0, 0.4);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-badge-icon="spinner"] {
  color: #d9a441;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-backlog] {
  background: rgba(6, 9, 17, 0.96);
  color: #f3efe5;
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-backlog-title] {
  color: #d9a441;
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-backlog-close] {
  border: 1px solid rgba(217, 164, 65, 0.5);
  border-radius: 0;
  background: rgba(20, 26, 40, 0.9);
  color: #efc76e;
}
`;

/* yamaku-classic — nostalgic school romance visual novel (Katawa Shoujo style) */
const YAMAKU_CLASSIC_CSS = `
[data-vn-root][data-vn-preset="yamaku-classic"] {
  --vn-accent: #ff7095;
  --vn-text: #ffffff;
  --vn-muted-text: rgba(255, 255, 255, 0.72);
  --vn-dialogue-bg: linear-gradient(to top, rgba(20, 17, 15, 0.88) 0%, rgba(25, 22, 19, 0.7) 50%, rgba(28, 24, 20, 0.45) 100%);
  --vn-dialogue-border: rgba(175, 160, 145, 0.7);
  --vn-dialogue-width: min(78rem, calc(100vw - 1.8rem));
  --vn-font-family: "Segoe Print", "Comic Sans MS", "Trebuchet MS", cursive;
  --vn-dialogue-font-size: clamp(1.18rem, 1.25vw + 0.75rem, 1.58rem);
  --vn-transition-duration: 280ms;
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
  padding: 1.15rem 3.8rem 1.35rem 1.15rem;
  border: 1px solid rgba(175, 160, 145, 0.7);
  outline: none;
  border-radius: 0;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 0, transparent 2px), linear-gradient(to top, rgba(20, 17, 15, 0.88) 0%, rgba(25, 22, 19, 0.7) 50%, rgba(28, 24, 20, 0.45) 100%);
  box-shadow: 0 0.65rem 1.8rem rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-dialogue]::before {
  position: absolute;
  z-index: 0;
  right: -1px;
  bottom: 100%;
  left: -1px;
  height: 3.5rem;
  background: linear-gradient(to top, rgba(18, 15, 12, 0.5) 0%, rgba(24, 21, 18, 0.22) 58%, transparent 100%);
  content: "";
  pointer-events: none;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-speaker] {
  position: absolute;
  top: -2.75rem;
  left: 0.15rem;
  z-index: 5;
  display: inline-block;
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
  line-height: 1.52;
  letter-spacing: 0.005em;
  text-shadow: 0 1px 2px #000, 1px 0 2px #000, 0 -1px 2px #000, -1px 0 2px #000, 0 2px 3px rgba(0, 0, 0, 0.9);
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-controls] {
  top: -2.55rem;
  right: 0.5rem;
  z-index: 5;
  gap: 0.2rem;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-control] {
  padding: 0.18rem 0.52rem;
  border: 1px solid rgba(226, 221, 211, 0.28);
  border-radius: 0;
  background: rgba(18, 15, 12, 0.28);
  color: rgba(255, 255, 255, 0.68);
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: none;
  box-shadow: none;
  backdrop-filter: none;
  opacity: 0.55;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-control]:hover {
  border-color: rgba(255, 112, 149, 0.72);
  color: #ffffff;
  background: rgba(32, 24, 21, 0.58);
  opacity: 1;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-control][data-vn-active="true"] {
  background: rgba(255, 112, 149, 0.82);
  color: #190e12;
  border-color: rgba(255, 220, 229, 0.75);
  box-shadow: 0 0 8px rgba(255, 112, 149, 0.35);
  opacity: 1;
}
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
  padding: 0.2rem;
  border: none;
  border-radius: 0;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  box-shadow: none;
  transition: opacity 160ms ease;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-continue]::before {
  content: none !important;
  display: none !important;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-continue]::after {
  content: "➔";
  color: #ffffff;
  font-family: "Segoe UI Symbol", "Arial Unicode MS", sans-serif;
  font-size: 1.6rem;
  font-weight: 900;
  line-height: 1;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.95)) drop-shadow(0 0 2px #000);
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-continue]:hover {
  color: #ff94ab;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-progress] {
  display: none;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-choice] {
  border: 1px solid rgba(195, 182, 168, 0.6);
  border-radius: 0.25rem;
  background: rgba(36, 33, 29, 0.94);
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
  text-shadow: 0 1px 2px #000;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-choice]:hover:not(:disabled) {
  border-color: #ff7396;
  background: rgba(48, 38, 34, 0.98);
  color: #ff7396;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-badge] {
  border: 1px solid rgba(195, 182, 168, 0.5);
  border-radius: 0.35rem;
  background: rgba(32, 28, 24, 0.92);
  color: #ffffff;
  font-family: var(--vn-font-family);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-badge-icon="spinner"] {
  color: #ff7396;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-backlog] {
  background: rgba(24, 21, 18, 0.96);
  color: #ffffff;
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-backlog-title] {
  color: #ff7396;
}
[data-vn-root][data-vn-preset="yamaku-classic"] [data-vn-backlog-close] {
  border: 1px solid rgba(195, 182, 168, 0.5);
  border-radius: 0.25rem;
  background: rgba(36, 28, 24, 0.85);
  color: #ff7396;
}
`;
const LITERATURE_CLUB_CSS = `
[data-vn-root][data-vn-preset="literature-club"] {
  --vn-accent: #e8507c;
  --vn-text: #ffffff;
  --vn-muted-text: rgba(255, 235, 245, 0.85);
  --vn-dialogue-bg: linear-gradient(to bottom, rgba(255, 150, 197, 0.94) 0%, rgba(250, 146, 193, 0.86) 45%, rgba(229, 140, 184, 0.64) 100%);
  --vn-dialogue-border: #ffd9ea;
  --vn-dialogue-width: min(74rem, calc(100vw - 2.5rem));
  --vn-font-family: "Comic Sans MS", "Comfortaa", "Nunito", "Trebuchet MS", ui-rounded, sans-serif;
  --vn-dialogue-font-size: clamp(1.12rem, 1.2vw + 0.8rem, 1.46rem);
  --vn-transition-duration: 260ms;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-ornament-group][data-vn-preset="literature-club"] { display: block; }
[data-vn-root][data-vn-preset="literature-club"] [data-vn-dialogue] {
  position: relative;
  min-height: 9rem;
  padding: 1.55rem 3.6rem 2.35rem 2.3rem;
  border: 3px solid #ffd9ea;
  border-radius: 0.9rem;
  background-image: radial-gradient(circle, rgba(234, 108, 163, 0.28) 33%, transparent 36%), linear-gradient(to bottom, rgba(255, 150, 197, 0.94) 0%, rgba(250, 146, 193, 0.86) 45%, rgba(229, 140, 184, 0.64) 100%);
  background-size: 2.8rem 2.8rem, 100% 100%;
  box-shadow: 0 6px 24px rgba(150, 60, 95, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(0.2rem);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-speaker] {
  position: absolute;
  top: -2.6rem;
  left: 1.4rem;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 1.45rem 0.34rem;
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
  bottom: 0.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
  gap: 1.05rem;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-control] {
  padding: 0.1rem 0.2rem;
  border: none;
  border-radius: 0;
  background: transparent;
  color: #6a2b3e;
  font-family: var(--vn-font-family);
  font-size: 0.82rem;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0.02em;
  box-shadow: none;
  backdrop-filter: none;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-control]:hover {
  background: transparent;
  color: #ffffff;
  box-shadow: none;
  text-shadow: 0 1px 2px rgba(150, 60, 95, 0.6);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-control][data-vn-active="true"] {
  background: transparent;
  color: #e8507c;
  border: none;
  box-shadow: none;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.55);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-continue] {
  position: absolute;
  right: 1.05rem;
  bottom: 0.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: auto;
  padding: 0.2rem;
  border: none;
  border-radius: 0;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  box-shadow: none;
  filter: drop-shadow(0 1px 2px rgba(150, 60, 95, 0.7));
  transition: transform 160ms ease, opacity 160ms ease;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-continue]::before {
  content: none !important;
  display: none !important;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-continue]::after {
  content: "▶";
  color: #ffffff;
  font-size: 1.1rem;
  line-height: 1;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-continue]:hover {
  transform: scale(1.15);
  color: #ffe4ec;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-progress] {
  display: none;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-auto-ring] .vn-auto-track {
  stroke: rgba(255, 255, 255, 0.35);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-auto-ring] .vn-auto-bar {
  stroke: #ffffff;
}

[data-vn-root][data-vn-preset="literature-club"] [data-vn-choice] {
  border: 2.5px solid #ffffff;
  border-radius: 1rem;
  background: rgba(255, 240, 246, 0.96);
  color: #7a1f44;
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(232, 80, 124, 0.25);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-choice]:hover:not(:disabled) {
  border-color: #e8507c;
  background: #ffffff;
  color: #e8507c;
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(232, 80, 124, 0.4);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge] {
  border: 2.5px solid #ffffff;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(255, 240, 246, 0.96), rgba(255, 215, 230, 0.96));
  color: #9d244f;
  font-family: var(--vn-font-family);
  font-weight: 700;
  box-shadow: 0 4px 14px rgba(232, 80, 124, 0.32);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-badge-icon="spinner"] {
  color: #e8507c;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog] {
  background: rgba(255, 242, 247, 0.96);
  background-image: radial-gradient(circle, rgba(232, 80, 124, 0.16) 20%, transparent 20%);
  background-size: 1.5rem 1.5rem;
  color: #44162e;
  border: 4px solid #ffffff;
  border-radius: 1.5rem;
  box-shadow: 0 1rem 3rem rgba(232, 80, 124, 0.35);
  font-family: var(--vn-font-family);
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-title] {
  color: #c43868;
  font-weight: 800;
}
[data-vn-root][data-vn-preset="literature-club"] [data-vn-backlog-close] {
  border: 2px solid #ffa0bc;
  border-radius: 999px;
  background: #ffffff;
  color: #c43868;
  font-weight: 700;
}
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
