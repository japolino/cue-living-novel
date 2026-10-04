/**
 * Shared look for Cue's settings surfaces. The main settings panel and the
 * speech section live in separate shadow roots, so both inline this string to
 * stay visually identical. Host tokens (`--lumiverse-*`) win; the fallbacks
 * are a dark theme.
 */
export const SETTINGS_TOKENS_CSS = `
:host {
  --set-accent: var(--lumiverse-primary, #a986ff);
  --set-accent-text: var(--lumiverse-primary-contrast, #121018);
  --set-text: var(--lumiverse-text, #f5f5f7);
  --set-muted: var(--lumiverse-text-muted, rgba(255,255,255,.7));
  --set-border: var(--lumiverse-border, rgba(255,255,255,.16));
  --set-surface: var(--lumiverse-card-bg, rgba(255,255,255,.035));
  --set-field: var(--lumiverse-bg-elevated, #171822);
  --set-hover: var(--lumiverse-fill-medium, rgba(255,255,255,.07));
  --set-success: var(--lumiverse-success, #8ce8b0);
  --set-warning: var(--lumiverse-warning, #ffd08a);
  --set-danger: var(--lumiverse-danger, #ff8ca0);
  --set-radius: .8rem;
  --set-control: 2.75rem;
  display: block;
  color: var(--set-text);
  font: 15px/1.5 var(--lumiverse-font-family, system-ui, sans-serif);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
p, h2, h3, h4 { margin: 0; }
button, input, select, textarea { font: inherit; color: inherit; }
.muted, small, .help { color: var(--set-muted); }
small, .help { display: block; font-size: .84rem; font-weight: 400; line-height: 1.45; }
button { min-height: var(--set-control); padding: .5rem 1.05rem; border: 1px solid var(--set-border); border-radius: 999px; background: var(--set-hover); cursor: pointer; font-weight: 550; transition: background-color .15s, border-color .15s; }
button:hover:not(:disabled) { border-color: color-mix(in srgb, var(--set-accent) 55%, var(--set-border)); }
button[data-primary] { border-color: var(--set-accent); background: var(--set-accent); color: var(--set-accent-text); font-weight: 650; }
button[data-primary]:hover:not(:disabled) { background: color-mix(in srgb, var(--set-accent) 88%, white); }
button[data-quiet] { background: transparent; }
button:disabled { opacity: .55; cursor: default; }
input[type="text"], input[type="number"], input[type="url"], input[type="password"], input[type="search"], select, textarea {
  width: 100%; min-height: var(--set-control); padding: .55rem .75rem; border: 1px solid var(--set-border); border-radius: .6rem; background: var(--set-field); transition: border-color .15s;
}
:is(input, select, textarea):hover:not(:disabled) { border-color: color-mix(in srgb, var(--set-accent) 40%, var(--set-border)); }
input:disabled { opacity: .6; }
textarea { min-height: 8rem; resize: vertical; font-family: var(--lumiverse-font-mono, ui-monospace, "Cascadia Mono", Consolas, monospace); font-size: .82rem; line-height: 1.45; }
input[type="range"] { width: 100%; height: var(--set-control); margin: 0; accent-color: var(--set-accent); cursor: pointer; }
input[type="checkbox"], input[type="radio"] { width: 1.2rem; height: 1.2rem; margin: 0; accent-color: var(--set-accent); }
:is(button, summary, select, input, textarea, [tabindex]):focus-visible { outline: 2px solid var(--set-accent); outline-offset: 2px; }
details[data-more] { font-size: .84rem; color: var(--set-muted); }
details[data-more] > summary { display: inline-flex; align-items: center; gap: .3rem; min-height: 1.75rem; cursor: pointer; color: var(--set-accent); font-weight: 600; list-style: none; border-radius: .3rem; }
details[data-more] > summary::-webkit-details-marker { display: none; }
details[data-more] > summary::after { content: ""; width: .38rem; height: .38rem; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-.1rem) rotate(45deg); }
details[data-more][open] > summary::after { transform: translateY(.1rem) rotate(-135deg); }
details[data-more] > :not(summary) { margin-top: .3rem; line-height: 1.5; }
details[data-more] code { font-size: .8rem; }
@media (pointer: coarse) { details[data-more] > summary { min-height: 2.75rem; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
