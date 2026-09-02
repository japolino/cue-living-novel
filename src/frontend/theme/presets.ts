import { THEME_PRESET_IDS, type VisualNovelThemePreset } from "../../config.js";

/**
 * Built-in visual presets for the VN stage.
 *
 * Every preset is a self-contained CSS block scoped under
 * `[data-vn-root][data-vn-preset="<id>"]`, so rules never leak between
 * presets and never touch the Exit control. The stage applies exactly one
 * preset at a time by setting `data-vn-preset` on its root element.
 *
 * The preset ids and the `ThemePresetId` / `ThemePreset` type live in
 * `src/config.ts` (host-neutral, shared by backend and frontend). This module
 * only supplies the frontend CSS payload for each id.
 */

export type ThemePresetId = VisualNovelThemePreset;

export type ThemePresetCss = string;

/* ------------------------------------------------------------------ */
/* lumiverse — the current default look (host-token mapped baseline)   */
/*                                                                     */
/* The Lumiverse host page defines `--lumiverse-*` custom properties.  */
/* This preset maps the VN tokens on to the real host tokens so the    */
/* stage inherits the host's native text, accent, card, border, font   */
/* and key-control styling. Every mapping carries a hard fallback so a */
/* host that does not expose a token still lands on the old baseline.  */
/* ------------------------------------------------------------------ */

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

[data-vn-root][data-vn-preset="lumiverse"] [data-vn-dialogue] {
  border-color: var(--lumiverse-border, rgba(255, 255, 255, 0.3));
}

[data-vn-root][data-vn-preset="lumiverse"] [data-vn-speaker] {
  color: var(--lumiverse-primary, #d8a8ff);
}

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

[data-vn-root][data-vn-preset="lumiverse"] [data-vn-choice]:hover:not(:disabled) {
  border-color: var(--lumiverse-primary, #d8a8ff);
}

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
`;

/* ------------------------------------------------------------------ */
/* golden-hour — warm amber / ivory plate / capsule identity           */
/* ------------------------------------------------------------------ */

const GOLDEN_HOUR_CSS = `
[data-vn-root][data-vn-preset="golden-hour"] {
  --vn-accent: #e0a63c;
  --vn-text: #fff6e2;
  --vn-muted-text: rgba(255, 244, 218, 0.72);
  --vn-dialogue-bg: linear-gradient(180deg, rgba(255, 249, 232, 0.97), rgba(255, 241, 214, 0.94));
  --vn-dialogue-border: rgba(196, 146, 58, 0.9);
  --vn-font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
}

[data-vn-root][data-vn-preset="golden-hour"] [data-vn-speaker] {
  color: #e0a63c;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

[data-vn-root][data-vn-preset="golden-hour"] [data-vn-dialogue] {
  border-width: 2px;
  border-radius: 1.35rem;
  box-shadow: 0 1rem 3rem rgba(80, 45, 10, 0.35);
}

[data-vn-root][data-vn-preset="golden-hour"] [data-vn-interaction] {
  background: rgba(6, 3, 0, 0.4);
}

[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice] {
  border: 1px solid rgba(224, 166, 60, 0.85);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(84, 60, 20, 0.96), rgba(30, 20, 8, 0.98));
  color: #fff2d8;
  font-weight: 600;
  letter-spacing: 0.02em;
}

[data-vn-root][data-vn-preset="golden-hour"] [data-vn-choice]:hover:not(:disabled) {
  border-color: #ffd27a;
  background: linear-gradient(180deg, rgba(120, 88, 32, 0.96), rgba(52, 34, 12, 0.98));
}

[data-vn-root][data-vn-preset="golden-hour"] [data-vn-input-form] {
  border: 1px solid rgba(224, 166, 60, 0.8);
  border-radius: 1.25rem;
}

[data-vn-root][data-vn-preset="golden-hour"] [data-vn-input] {
  border: 1px solid rgba(224, 166, 60, 0.6);
  border-radius: 999px;
  background: rgba(8, 5, 1, 0.6);
  color: #fff6e2;
}

[data-vn-root][data-vn-preset="golden-hour"] [data-vn-submit] {
  border-color: #f5c96a;
  background: #e0a63c;
  color: #241503;
}

[data-vn-root][data-vn-preset="golden-hour"] [data-vn-continue] {
  border: 1px solid rgba(224, 166, 60, 0.8);
  background: rgba(224, 166, 60, 0.18);
  color: #fff6e2;
}
`;

/* ------------------------------------------------------------------ */
/* boxed-console — flat, sharp corners, monospace console              */
/* ------------------------------------------------------------------ */

const BOXED_CONSOLE_CSS = `
[data-vn-root][data-vn-preset="boxed-console"] {
  --vn-accent: #a3ff12;
  --vn-text: #f4f6f4;
  --vn-muted-text: rgba(244, 246, 244, 0.72);
  --vn-dialogue-bg: #101418;
  --vn-dialogue-border: #2b2f31;
  --vn-font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
}

[data-vn-root][data-vn-preset="boxed-console"] [data-vn-dialogue] {
  border: 1px solid #2b2f31;
  border-radius: 0;
  box-shadow: 6px 6px 0 rgba(0, 0, 0, 0.55);
}

[data-vn-root][data-vn-preset="boxed-console"] [data-vn-speaker] {
  color: #a3ff12;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice] {
  border: 1px solid #3a3f41;
  border-radius: 0;
  background: #16181a;
  color: #f4f6f4;
}

[data-vn-root][data-vn-preset="boxed-console"] [data-vn-choice]:hover:not(:disabled) {
  border-color: #a3ff12;
  background: #1c211a;
}

[data-vn-root][data-vn-preset="boxed-console"] [data-vn-input-form] {
  border: 1px solid #3a3f41;
  border-radius: 0;
  background: #0f1112;
}

[data-vn-root][data-vn-preset="boxed-console"] [data-vn-input] {
  border: 1px solid #3a3f41;
  border-radius: 0;
  background: #0b0d0e;
  color: #f4f6f4;
}

[data-vn-root][data-vn-preset="boxed-console"] [data-vn-submit] {
  border: 1px solid #a3ff12;
  border-radius: 0;
  background: #a3ff12;
  color: #10140a;
}
`;

/* ------------------------------------------------------------------ */
/* paper-novel — light reading, serif, ink on cream                    */
/* ------------------------------------------------------------------ */

const PAPER_NOVEL_CSS = `
[data-vn-root][data-vn-preset="paper-novel"] {
  --vn-accent: #7a4a12;
  --vn-text: #2a2320;
  --vn-muted-text: rgba(74, 64, 56, 0.72);
  --vn-dialogue-bg: #fbf7ef;
  --vn-dialogue-border: rgba(122, 90, 40, 0.4);
  --vn-font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
}

[data-vn-root][data-vn-preset="paper-novel"] [data-vn-dialogue] {
  border: 1px solid rgba(122, 90, 40, 0.4);
  border-radius: 0.6rem;
  box-shadow: 0 0.6rem 1.6rem rgba(60, 45, 25, 0.18);
  color: #2a2320;
}

[data-vn-root][data-vn-preset="paper-novel"] [data-vn-speaker] {
  color: #7a4a12;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice] {
  border: 1px solid rgba(122, 90, 40, 0.45);
  border-radius: 0.6rem;
  background: #fffdf7;
  color: #2a2320;
}

[data-vn-root][data-vn-preset="paper-novel"] [data-vn-choice]:hover:not(:disabled) {
  border-color: #7a4a12;
  background: #fbf2e2;
}

[data-vn-root][data-vn-preset="paper-novel"] [data-vn-input-form] {
  border: 1px solid rgba(122, 90, 40, 0.45);
  border-radius: 0.6rem;
  background: #fffdf7;
}

[data-vn-root][data-vn-preset="paper-novel"] [data-vn-input] {
  border: 1px solid rgba(122, 90, 40, 0.4);
  border-radius: 0.5rem;
  background: #fbf4e6;
  color: #2a2320;
}

[data-vn-root][data-vn-preset="paper-novel"] [data-vn-submit] {
  border-color: #6a3f0e;
  background: #7a4a12;
  color: #fff8ec;
}
`;

/* ------------------------------------------------------------------ */
/* midnight-noir — cinematic dark, gold on deep blue-black             */
/* ------------------------------------------------------------------ */

const MIDNIGHT_NOIR_CSS = `
[data-vn-root][data-vn-preset="midnight-noir"] {
  --vn-accent: #d9a441;
  --vn-text: #eef0f2;
  --vn-muted-text: rgba(214, 222, 230, 0.66);
  --vn-dialogue-bg: linear-gradient(180deg, rgba(8, 12, 18, 0.92), rgba(4, 6, 10, 0.96));
  --vn-dialogue-border: rgba(217, 164, 65, 0.5);
  --vn-font-family: Georgia, "Iowan Old Style", serif;
}

[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-dialogue] {
  border-width: 1px;
  border-radius: 0.5rem;
  box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.6);
}

[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-speaker] {
  color: #d9a441;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice] {
  border: 1px solid rgba(217, 164, 65, 0.55);
  border-radius: 0.55rem;
  background: rgba(10, 13, 19, 0.9);
  color: #eef0f2;
}

[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-choice]:hover:not(:disabled) {
  border-color: #e9b95e;
  background: rgba(22, 27, 36, 0.94);
}

[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-input-form] {
  border: 1px solid rgba(217, 164, 65, 0.5);
  border-radius: 0.6rem;
  background: rgba(6, 9, 14, 0.92);
}

[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-input] {
  border: 1px solid rgba(217, 164, 65, 0.4);
  border-radius: 0.5rem;
  background: rgba(12, 16, 22, 0.7);
  color: #eef0f2;
}

[data-vn-root][data-vn-preset="midnight-noir"] [data-vn-submit] {
  border-color: #f0c76a;
  background: #d9a441;
  color: #0a0602;
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
