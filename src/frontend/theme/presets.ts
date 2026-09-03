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
  min-height: 12rem;
  padding: 2.55rem 4.2rem 2rem 3.2rem;
  border: 1px solid rgba(226, 176, 106, 0.92);
  outline: 1px solid rgba(247, 206, 139, 0.45);
  outline-offset: -5px;
  border-radius: 1.7rem;
  background: linear-gradient(180deg, rgba(38, 27, 18, 0.86), rgba(18, 12, 8, 0.95));
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
`;

/* midnight-noir — cinema marquee and art-deco geometry */
const MIDNIGHT_NOIR_CSS = `
[data-vn-root][data-vn-preset="midnight-noir"] {
  --vn-accent: #d9a441;
  --vn-text: #f3efe5;
  --vn-muted-text: rgba(222, 218, 207, 0.7);
  --vn-dialogue-bg: linear-gradient(180deg, rgba(10, 15, 28, 0.96), rgba(4, 7, 14, 0.98));
  --vn-dialogue-border: rgba(217, 164, 65, 0.62);
  --vn-dialogue-width: min(88rem, calc(100vw - 3rem));
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
  overflow: hidden;
  padding: 2.2rem 4rem 1.8rem 3rem;
  border: 1px solid rgba(217, 164, 65, 0.62);
  outline: 1px solid rgba(217, 164, 65, 0.22);
  outline-offset: -6px;
  border-radius: 2px;
  background: repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.012) 0 1px, transparent 1px 4px), linear-gradient(180deg, rgba(10, 15, 28, 0.97), rgba(4, 7, 14, 0.99));
  box-shadow: 0 1.4rem 4rem rgba(0, 0, 0, 0.72), inset 0 0 0 1px rgba(255, 236, 180, 0.06);
}
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue]::before { position: absolute; top: 0.8rem; right: 1rem; left: 1rem; height: 5px; border-top: 1px solid #d9a441; border-bottom: 1px solid rgba(217, 164, 65, 0.34); content: ""; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue]::after { position: absolute; inset: 0; background: linear-gradient(100deg, transparent 35%, rgba(255, 226, 166, 0.1) 50%, transparent 65%); content: ""; pointer-events: none; transform: translateX(-130%); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-speaker] { color: #d9a441; font-weight: 600; letter-spacing: 0.34em; text-transform: uppercase; text-shadow: 0 0 12px rgba(217, 164, 65, 0.22); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue-text] { color: #f3efe5; line-height: 1.62; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-progress] { letter-spacing: 0.2em; text-transform: uppercase; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-continue] { width: 2.7rem; height: 2rem; border: 1px solid #d9a441; border-radius: 0; background: #0a0f1c; color: #d9a441; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-continue]::before { content: "››"; letter-spacing: -0.12em; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-interaction] { background: linear-gradient(180deg, rgba(2, 4, 10, 0.88) 0 9%, rgba(3, 6, 13, 0.48) 9% 89%, rgba(2, 4, 10, 0.9) 89% 100%); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice-list],
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-input-form] { padding: 1.4rem; border: 1px solid rgba(217, 164, 65, 0.58); border-radius: 2px; background: linear-gradient(180deg, rgba(10, 15, 28, 0.97), rgba(4, 7, 14, 0.99)); box-shadow: 0 1.4rem 4rem rgba(0, 0, 0, 0.72), inset 0 0 0 4px rgba(217, 164, 65, 0.04); }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice] { border: 1px solid rgba(217, 164, 65, 0.48); border-radius: 0; background: rgba(10, 15, 28, 0.94); color: #f3efe5; letter-spacing: 0.08em; box-shadow: inset 0 0 0 3px #060a13; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]:hover:not(:disabled) { border-color: #e9b95e; background: rgba(24, 30, 43, 0.98); color: #fff9ea; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-input] { border: 1px solid rgba(217, 164, 65, 0.48); border-radius: 0; background: #080d19; color: #f3efe5; caret-color: #d9a441; }
[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-submit] { border: 1px solid #efc76e; border-radius: 0; background: #d9a441; color: #090b10; box-shadow: inset 0 0 0 3px rgba(4, 7, 14, 0.28); letter-spacing: 0.14em; text-transform: uppercase; }
@media (prefers-reduced-motion: no-preference) {
  [data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue]::after { animation: vn-noir-sweep 2.2s ease-out 280ms 1; }
  [data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice] { transition: border-color 180ms ease, background 180ms ease; }
}
`;

export const THEME_PRESET_CSS: Record<ThemePresetId, string> = {
  lumiverse: LUMIVERSE_CSS,
  "golden-hour": GOLDEN_HOUR_CSS,
  "boxed-console": BOXED_CONSOLE_CSS,
  "paper-novel": PAPER_NOVEL_CSS,
  "midnight-noir": MIDNIGHT_NOIR_CSS,
};

export const isThemePresetId = (value: unknown): value is ThemePresetId =>
  typeof value === "string" && (THEME_PRESET_IDS as readonly string[]).includes(value);
