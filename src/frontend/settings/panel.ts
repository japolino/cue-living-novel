import {
  DEFAULT_CONFIG,
  type VisualNovelConfig,
  type VisualNovelPromptPreset,
} from "../../config.js";
import {
  AUTO_PLAY_STEPS,
  BUDGET_PRESETS,
  EFFECT_INTENSITY_OPTIONS,
  IMAGE_SOURCE_OPTIONS,
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_KEY,
  TEXT_EFFECT_MODE_OPTIONS,
  REFERENCE_SOURCE_OPTIONS,
  SCENE_IMAGE_FIT_OPTIONS,
  SETUP_DONE_KEY,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEPS,
  TEXT_SPEED_STEPS,
  THEME_PRESET_LABELS,
  THEME_PRESET_OPTIONS,
  budgetPresetFor,
  buildConnectionSelectOptions,
  connectionReadiness,
  describeAutoPlay,
  describeBudget,
  describeTextScale,
  describeTextSpeed,
  imageSourceFromConfig,
  imageSourcePatch,
  jsonObject,
  namedStepFor,
  normalizeEffectIntensity,
  normalizeReferenceSource,
  normalizeSceneImageFit,
  normalizeSettingsSection,
  normalizeTextEffects,
  normalizeThemePreset,
  searchSettings,
  resetPatch,
  safeStorage,
  themePreviewTokens,
  buildNovelAiSamplerOptions,
  snapDimension,
  effectiveImageConnection,
  isNovelAiConnection,
  readNovelAiParameters,
  NOVELAI_DEFAULT_GUIDANCE,
  NOVELAI_DEFAULT_SAMPLER,
  NOVELAI_DEFAULT_STEPS,
  NOVELAI_GUIDANCE_MAX,
  NOVELAI_GUIDANCE_MIN,
  NOVELAI_NOTICE,
  NOVELAI_RESOLUTION_PRESETS,
  NOVELAI_SEED_MAX,
  parseNovelAiSeed,
  NOVELAI_STEPS_MAX,
  NOVELAI_STEPS_MIN,
  type ConnectionCatalogKind,
  type ConnectionCatalogState,
  type ImageSource,
  type SettingsSearchEntry,
  type SettingsSectionId,
  type SetupFlagStorage,
} from "./model.js";
import { SETTINGS_TOKENS_CSS } from "./controls-css.js";
import { TEXT_EFFECT_AUTHOR_GUIDE, TEXT_EFFECT_CATALOGUE } from "../../shared/text-effects.js";
import { formatDialogueText } from "../stage/rich-text.js";
import { applyTextEffects } from "../stage/text-effects.js";
import { VN_TEXT_EFFECTS_CSS } from "../theme/text-effects-css.js";

export {
  THEME_PRESET_LABELS,
  THEME_PRESET_OPTIONS,
  buildConnectionSelectOptions,
  connectionOptionLabel,
  type ConnectionCatalogKind,
  type ConnectionCatalogState,
  type ConnectionOption,
  type ConnectionSelectOption,
  type SettingsSectionId,
} from "./model.js";

export type SaveStatus = { kind: "saved" } | { kind: "error"; error: string };

export type SettingsPanelOptions = {
  mount: HTMLElement;
  /** Receives partial patches. Everyday controls call this on every change; Advanced calls it on Apply. */
  onSave: (patch: Partial<VisualNovelConfig>) => void;
  onOpenPreview: () => void;
  onRefreshConnections: () => void;
  onSaveSystemOneKey?: (key: string) => void;
  onClearSystemOneKey?: () => void;
  onScanAudio?: (directory: string) => Promise<{ bgmCount: number; sfxCount: number } | void> | void;
  /** Import user-picked audio files into the extension's scoped storage. */
  onImportAudio?: (files: readonly File[]) => Promise<void> | void;
  /** Where the "setup guide done" flag lives. Defaults to localStorage when available. */
  setupStorage?: SetupFlagStorage | null;
};

/** Keys the Advanced section owns. Everything else saves as soon as it changes. */
const ADVANCED_KEYS = [
  "novelAiQualityTags", "novelAiUseDefaultNegative",
  "imageModel", "imageConcurrency", "parserParameters", "imageParameters", "audioDirectory", "systemOneMode", "systemOneApiUrl", "systemOneModel",
  "includeRecentMessages", "includeCharacterContext", "includePersonaContext", "includeLorebookContext", "debugLogging",
  "promptPrefix", "promptSuffix", "negativePrompt", "originalReference", "originalCreationName", "customPlannerInstructions",
  "ignoredTags", "displayRegexRules", "customCss",
] as const;
type AdvancedKey = (typeof ADVANCED_KEYS)[number];

const SAMPLE_LINES: ReadonlyArray<{ speaker: string; text: string }> = [
  { speaker: "Mira", text: "The wind picks up as the first stars come out over the valley." },
  { speaker: "Mira", text: "“You came back,” she says, not quite hiding a smile." },
];

/** A local placeholder picture: a wide 16:9 dusk sky, so fit modes visibly differ in a short frame. */
const SAMPLE_PICTURE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#241b45"/><stop offset=".55" stop-color="#6a3d6a"/><stop offset="1" stop-color="#d7826f"/></linearGradient></defs><rect width="640" height="360" fill="url(#s)"/><g fill="#fff" opacity=".7"><circle cx="80" cy="70" r="1.6"/><circle cx="160" cy="120" r="1.2"/><circle cx="300" cy="60" r="1.4"/><circle cx="420" cy="110" r="1.1"/><circle cx="600" cy="50" r="1.5"/><circle cx="520" cy="90" r="1"/></g><circle cx="520" cy="168" r="34" fill="#ffe9a8" opacity=".9"/><path d="M0 250 Q120 200 250 245 T470 235 T640 225 V360 H0Z" fill="#141a2c" opacity=".9"/><path d="M0 290 Q150 250 320 290 T640 272 V360 H0Z" fill="#090d18"/></svg>`)}`;

const PANEL_CSS = `${SETTINGS_TOKENS_CSS}
[data-shell] { container-type: inline-size; display: grid; gap: .9rem; max-width: 66rem; padding: 1rem 1rem 0; }
h2 { font-size: 1.22rem; font-weight: 680; letter-spacing: -.01em; line-height: 1.25; }
h3 { font-size: .98rem; font-weight: 650; line-height: 1.3; }
code { font-family: var(--lumiverse-font-mono, ui-monospace, "Cascadia Mono", Consolas, monospace); font-size: .82em; }

/* Top bar: find, save status, preview */
[data-topbar] { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem .75rem; }
[data-search] { position: relative; flex: 1 1 10rem; min-width: 0; }
[data-search] > svg { position: absolute; left: .8rem; top: 50%; width: 1rem; height: 1rem; transform: translateY(-50%); color: var(--set-muted); pointer-events: none; }
[data-search] input { padding-left: 2.35rem; border-radius: 999px; }
[data-search] input::-webkit-search-cancel-button { cursor: pointer; }
[data-search-results] { position: absolute; z-index: 20; top: calc(100% + .35rem); left: 0; right: 0; display: grid; gap: .1rem; max-height: min(22rem, 60vh); overflow: auto; margin: 0; padding: .35rem; list-style: none; border: 1px solid var(--set-border); border-radius: var(--set-radius); background: var(--set-field); box-shadow: 0 18px 40px rgba(0,0,0,.35); }
[data-search-results] button { display: grid; grid-template-columns: 1fr auto; gap: .1rem .75rem; align-items: center; width: 100%; min-height: 2.75rem; padding: .45rem .7rem; border: 0; border-radius: .55rem; background: transparent; text-align: left; font-weight: 550; }
[data-search-results] button:is(:hover, :focus-visible, [data-active]) { background: color-mix(in srgb, var(--set-accent) 16%, transparent); }
[data-search-results] button span:last-child { font-size: .78rem; font-weight: 600; color: var(--set-muted); }
[data-search-results] button small { grid-column: 1 / -1; font-size: .78rem; }
[data-search-empty] { padding: .6rem .7rem; font-size: .88rem; color: var(--set-muted); }
[data-status] { flex: 0 1 auto; min-height: 1.4rem; font-size: .88rem; font-weight: 550; }
[data-status][data-kind="saved"] { color: var(--set-success); }
:is([data-status][data-kind="dirty"], [data-status][data-kind="saving"]) { color: var(--set-warning); }
[data-status][data-kind="error"] { color: var(--set-danger); }
[data-topbar] > [data-open-preview] { margin-left: auto; }

/* Layout: rail + panes on wide containers, tab strip on narrow ones */
[data-layout] { display: grid; grid-template-columns: minmax(0, 1fr); gap: .9rem; align-items: start; }
[data-nav] { min-width: 0; }
[data-nav] { position: sticky; top: 0; z-index: 8; margin: 0 -1rem; padding: .35rem 1rem; background: var(--set-field); border-bottom: 1px solid var(--set-border); }
[data-tablist] { display: flex; gap: .25rem; overflow-x: auto; scrollbar-width: thin; overscroll-behavior-x: contain; }
[data-tab] { position: relative; flex: none; display: inline-flex; align-items: center; gap: .45rem; min-height: var(--set-control); padding: .4rem .8rem; border: 1px solid transparent; border-radius: .6rem; background: transparent; color: var(--set-muted); font-weight: 600; text-align: left; white-space: nowrap; }
[data-tab] svg { flex: none; width: 1.1rem; height: 1.1rem; }
[data-tab]:focus-visible { outline: 2px solid var(--set-accent); outline-offset: -2px; }
[data-tab]:hover { color: var(--set-text); background: var(--set-hover); border-color: transparent; }
[data-tab][aria-selected="true"] { color: var(--set-text); background: color-mix(in srgb, var(--set-accent) 18%, transparent); }
[data-tab][aria-selected="true"] svg { color: var(--set-accent); }
[data-tab-text] { display: grid; min-width: 0; }
[data-tab-summary] { display: none; }
[data-tab-badge] { min-width: 1.35rem; height: 1.35rem; padding: 0 .35rem; border-radius: 999px; background: var(--set-warning); color: #1b1405; font-size: .72rem; font-weight: 750; line-height: 1.35rem; text-align: center; }
[data-tab-dot] { width: .5rem; height: .5rem; border-radius: 50%; background: var(--set-muted); }
[data-tab-dot][data-level="ready"] { background: var(--set-success); }
[data-tab-dot][data-level="attention"] { background: var(--set-warning); }
[data-tab-dot][data-level="blocked"] { background: var(--set-danger); }

@container (min-width: 700px) {
  [data-layout] { grid-template-columns: 12.5rem minmax(0, 1fr); gap: 1.25rem; }
  [data-nav] { top: .75rem; margin: 0; padding: 0; background: transparent; border: 0; }
  [data-tablist] { flex-direction: column; overflow: visible; }
  [data-tab] { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; width: 100%; min-height: 3.3rem; padding: .5rem .7rem; white-space: normal; }
  [data-tab][aria-selected="true"]::before { content: ""; position: absolute; left: -.2rem; top: .7rem; bottom: .7rem; width: 3px; border-radius: 3px; background: var(--set-accent); }
  [data-tab-summary] { display: block; overflow: hidden; font-size: .76rem; font-weight: 500; color: var(--set-muted); white-space: nowrap; text-overflow: ellipsis; }
}

/* Panes, groups and fields */
[data-panes] { display: grid; gap: .9rem; min-width: 0; }
[data-pane] { display: grid; gap: .9rem; min-width: 0; padding-bottom: 1rem; }
[data-pane]:focus-visible { outline-offset: 6px; border-radius: .4rem; }
[data-pane-head] { display: grid; gap: .2rem; padding: .1rem .1rem .15rem; }
[data-pane-head] p { color: var(--set-muted); font-size: .9rem; }
[data-group] { display: grid; gap: .85rem; padding: 1rem 1.05rem 1.1rem; border: 1px solid var(--set-border); border-radius: var(--set-radius); background: var(--set-surface); scroll-margin: 4.5rem 0 6rem; }
[data-group-head] { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem .65rem; }
[data-group-head] h3 { flex: 1 1 auto; }
[data-group-head] > small { flex-basis: 100%; }
[data-apply-chip] { display: inline-flex; align-items: center; gap: .3rem; padding: .05rem .55rem; border: 1px solid color-mix(in srgb, var(--set-warning) 55%, transparent); border-radius: 999px; color: var(--set-warning); font-size: .72rem; font-weight: 650; letter-spacing: .02em; white-space: nowrap; }
[data-field] { display: grid; gap: .35rem; min-width: 0; }
[data-field] > span:first-child, legend { font-weight: 600; font-size: .93rem; }
[data-field] > span:first-child small { display: inline; }
fieldset { margin: 0; padding: 0; border: 0; min-width: 0; display: grid; gap: .45rem; }
legend { padding: 0; margin-bottom: .45rem; }
label[data-check] { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: .7rem; min-height: var(--set-control); padding: .5rem .2rem; font-weight: 550; cursor: pointer; }
label[data-check] input { margin-top: .17rem; }
label[data-check] small { margin-top: .1rem; }
[data-row] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .9rem; align-items: start; }
[data-actions] { display: flex; flex-wrap: wrap; gap: .55rem; align-items: center; }
[data-actions] > small { flex: 1 1 12rem; }
:is([data-field], label[data-check], fieldset)[data-dirty] { position: relative; }
:is([data-field], label[data-check], fieldset)[data-dirty]::before { content: ""; position: absolute; left: -.6rem; top: .2rem; bottom: .2rem; width: 3px; border-radius: 3px; background: var(--set-warning); }
[data-flash] { animation: set-flash 1.6s ease-out; }
@keyframes set-flash { 0%, 35% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--set-accent) 70%, transparent); } 100% { box-shadow: 0 0 0 3px transparent; } }

/* Segmented choices */
[data-segments] { display: flex; flex-wrap: wrap; gap: .35rem; }
[data-segments] label { position: relative; display: inline-flex; align-items: center; min-height: var(--set-control); padding: .4rem 1rem; border: 1px solid var(--set-border); border-radius: 999px; cursor: pointer; background: var(--set-field); font-weight: 550; transition: background-color .15s, border-color .15s; }
[data-segments] label:hover { border-color: color-mix(in srgb, var(--set-accent) 45%, var(--set-border)); }
[data-segments] label:has(input:checked) { border-color: var(--set-accent); background: color-mix(in srgb, var(--set-accent) 22%, var(--set-field)); font-weight: 650; }
[data-segments] input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
:is([data-segments], [data-tiles]) label:has(input:focus-visible) { outline: 2px solid var(--set-accent); outline-offset: 2px; }

/* Option lists */
[data-options] { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 14rem), 1fr)); gap: .45rem; }
[data-options] label { display: grid; grid-template-columns: auto 1fr; gap: .7rem; align-items: start; min-height: var(--set-control); padding: .65rem .8rem; border: 1px solid var(--set-border); border-radius: .65rem; cursor: pointer; background: var(--set-field); transition: background-color .15s, border-color .15s; }
[data-options] label:hover { border-color: color-mix(in srgb, var(--set-accent) 45%, var(--set-border)); }
[data-options] label:has(input:checked) { border-color: var(--set-accent); background: color-mix(in srgb, var(--set-accent) 13%, var(--set-field)); }
[data-options] label:has(input:focus-visible) { outline: 2px solid var(--set-accent); outline-offset: 2px; }
[data-options] label input { margin-top: .15rem; }
[data-options] label b { display: block; font-weight: 620; }

/* Theme tiles */
[data-tiles] { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: .55rem; }
[data-tiles] label { position: relative; display: grid; gap: .4rem; padding: .45rem; border: 1px solid var(--set-border); border-radius: .75rem; cursor: pointer; background: var(--set-field); transition: border-color .15s, transform .15s; }
[data-tiles] label:hover { border-color: color-mix(in srgb, var(--set-accent) 50%, var(--set-border)); }
[data-tiles] label:has(input:checked) { border-color: var(--set-accent); box-shadow: 0 0 0 1px var(--set-accent); }
[data-tiles] label:has(input:checked) > span:last-child::after { content: " ✓"; color: var(--set-accent); }
[data-tiles] input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
[data-tiles] > label > span:last-child { font-size: .84rem; font-weight: 600; text-align: center; }
[data-swatch] { display: grid; align-content: end; height: 3.6rem; padding: .35rem .45rem; border-radius: .5rem; background: linear-gradient(160deg, #2a2140, #0a0b10 70%); overflow: hidden; }
[data-swatch] i { display: block; height: 1.75rem; padding: .22rem .4rem; border-radius: .35rem; border: 1px solid var(--swatch-border); background: var(--swatch-bg); color: var(--swatch-text); font: 600 .62rem/1.2 var(--swatch-font); font-style: normal; white-space: nowrap; overflow: hidden; }
[data-swatch] i::before { content: "Mira"; display: block; color: var(--swatch-accent); font-size: .55rem; }

/* Setup guide */
[data-setup] { display: grid; gap: 1rem; padding: 1.1rem 1.15rem 1.15rem; border: 1px solid color-mix(in srgb, var(--set-accent) 55%, var(--set-border)); border-radius: calc(var(--set-radius) + .1rem); background: linear-gradient(180deg, color-mix(in srgb, var(--set-accent) 10%, transparent), transparent 9rem), var(--set-surface); }
[data-setup] header { display: grid; gap: .2rem; }
[data-setup] ol { display: grid; gap: 1.1rem; margin: 0; padding: 0; list-style: none; counter-reset: step; }
[data-setup] li { position: relative; display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: .8rem; }
[data-setup] li::before { counter-increment: step; content: counter(step); display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 50%; background: color-mix(in srgb, var(--set-accent) 22%, var(--set-field)); color: var(--set-text); font-weight: 700; font-size: .9rem; }
[data-setup] li:not(:last-child)::after { content: ""; position: absolute; left: calc(1rem - 1px); top: 2.4rem; bottom: -.75rem; width: 2px; background: var(--set-border); }
[data-setup] li > div { display: grid; gap: .55rem; min-width: 0; }
[data-setup] footer { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; padding-top: .2rem; }
[data-setup] footer small { flex: 1 1 14rem; }

/* Readiness rows */
[data-readiness] { display: grid; grid-template-columns: auto 1fr; gap: .6rem; align-items: start; padding: .55rem .75rem; border-radius: .6rem; background: var(--set-hover); }
[data-readiness]::before { content: ""; width: .6rem; height: .6rem; margin-top: .45rem; border-radius: 50%; background: var(--set-muted); }
[data-readiness][data-level="ready"]::before { background: var(--set-success); }
[data-readiness][data-level="attention"]::before { background: var(--set-warning); }
[data-readiness][data-level="blocked"]::before { background: var(--set-danger); }
[data-readiness] b { font-weight: 600; }
[data-readiness] [data-actions] { margin-top: .3rem; }

/* Live sample */
[data-sample] { display: grid; gap: .35rem; }
[data-sample-stage] { position: relative; height: 8.25rem; border-radius: .7rem; overflow: hidden; background: radial-gradient(circle at 50% 35%, rgba(73,58,91,.55), transparent 48%), #08090d; font-family: var(--sample-font); color: var(--sample-text); border: 1px solid var(--set-border); }
[data-sample-picture] { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: var(--sample-fit, cover); }
[data-sample-dialogue] { position: absolute; left: .55rem; right: .55rem; bottom: .55rem; min-height: 3.9rem; padding: .45rem .8rem .55rem; border: 1px solid var(--sample-border); border-radius: .55rem; background: var(--sample-bg); font-size: calc(.86rem * var(--sample-scale, 1)); line-height: 1.4; }
[data-sample-speaker] { display: block; color: var(--sample-accent); font-weight: 700; font-size: .8em; letter-spacing: .02em; }
[data-sample-text] { margin: 0; min-height: 2.6em; }
[data-sample-caret] { display: inline-block; width: .5em; height: 1em; margin-left: .15em; vertical-align: -.15em; background: var(--sample-accent); opacity: 0; }
[data-sample-stage][data-typing] [data-sample-caret] { opacity: 1; }
[data-sample-next] { position: absolute; right: .8rem; bottom: .35rem; font-size: .7rem; color: var(--sample-muted); }
[data-sample-label] { display: flex; flex-wrap: wrap; gap: .3rem .8rem; align-items: center; font-size: .8rem; }
[data-sample-label] > .muted { flex: 1 1 12rem; }
[data-sample-label] button { min-height: 2rem; padding: .15rem .8rem; font-size: .8rem; }
[data-sample][data-effects="off"] [data-sample-picture] { filter: saturate(.85); }
[data-sample][data-effects="gentle"] [data-sample-picture] { filter: saturate(.95); }

/* Text effects reference */
[data-text-fx-list] { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15.5rem), 1fr)); gap: .5rem; margin: 0; padding: 0; list-style: none; }
[data-text-fx-item] { display: grid; gap: .4rem; align-content: start; padding: .65rem .7rem .7rem; border: 1px solid var(--set-border); border-radius: .65rem; background: var(--set-field); }
[data-text-fx-item] header { display: flex; align-items: baseline; gap: .5rem; }
[data-text-fx-item] header b { font-weight: 650; }
[data-text-fx-item] header small { margin-left: auto; font-size: .72rem; }
[data-text-fx-preview] { display: grid; align-items: center; min-height: 2.6rem; padding: .4rem .7rem; border: 1px solid var(--vn-dialogue-border, var(--set-border)); border-radius: .5rem; background: var(--vn-dialogue-bg, #10111a); color: var(--vn-text, #fff); font-family: var(--vn-font-family, inherit); font-size: 1rem; overflow: hidden; }
[data-text-fx-code] { display: flex; align-items: center; gap: .4rem; }
[data-text-fx-code] code { flex: 1; min-width: 0; padding: .2rem .45rem; border-radius: .4rem; background: var(--set-hover); overflow-wrap: anywhere; }
[data-text-fx-code] button { min-height: 2.25rem; padding: .2rem .75rem; font-size: .8rem; }
[data-copy-fallback] { display: grid; gap: .35rem; }
[data-copy-fallback] textarea { min-height: 5.5rem; }

/* Advanced jump list */
[data-jump] { display: flex; flex-wrap: wrap; gap: .35rem; }
[data-jump] button { min-height: 2.25rem; padding: .2rem .8rem; font-size: .82rem; font-weight: 550; background: transparent; }

/* Unapplied changes bar */
[data-draft-bar] { position: sticky; bottom: .75rem; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; gap: .55rem .75rem; padding: .6rem .7rem .6rem 1rem; border: 1px solid color-mix(in srgb, var(--set-warning) 50%, var(--set-border)); border-radius: var(--set-radius); background: color-mix(in srgb, var(--set-warning) 9%, var(--set-field)); box-shadow: 0 12px 32px rgba(0,0,0,.35); }
[data-draft-bar] > div:first-child { flex: 1 1 13rem; display: grid; }
[data-draft-count] { font-weight: 650; }
[data-draft-bar] small { font-size: .8rem; }
[data-draft-bar] [data-actions] { flex: none; }

[data-preset-row] { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto auto; gap: .5rem; align-items: center; }
[data-preset-row] button { white-space: nowrap; }
[data-sound-empty] { display: grid; gap: .6rem; padding: 1.1rem 1rem; border: 1px dashed var(--set-border); border-radius: .75rem; text-align: center; justify-items: center; }
[data-sound-empty] svg { width: 1.8rem; height: 1.8rem; color: var(--set-accent); }
[data-sound-empty] p, [data-sound-counts] { font-weight: 600; }
[data-audio-status] { font-style: italic; }
[data-novelai-controls] a { color: var(--set-accent); text-decoration: underline; text-underline-offset: 2px; }
[data-voice-empty] { padding: 1rem; border: 1px dashed var(--set-border); border-radius: .75rem; }
[data-reset][data-confirming] { border-color: var(--set-danger); color: var(--set-danger); background: transparent; }
input, select, textarea, button { scroll-margin: 4.5rem 0 8.5rem; }

@container (max-width: 520px) {
  [data-row], [data-preset-row] { grid-template-columns: 1fr; }
  [data-group] { padding: .85rem .8rem .95rem; }
  [data-topbar] > [data-open-preview] { margin-left: 0; }
  [data-sample-stage] { height: 7.5rem; }
}
@media (max-width: 520px) {
  [data-shell] { padding: .65rem .65rem 0; }
  [data-nav] { margin: 0 -.65rem; padding: .35rem .65rem; }
}
@media (prefers-reduced-motion: reduce) {
  [data-flash] { animation: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--set-accent) 70%, transparent); }
}

[data-generated-only] { display: grid; gap: .9rem; }
`;

type StatusKind = "idle" | "saved" | "saving" | "dirty" | "error";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function segments(name: string, steps: ReadonlyArray<{ label: string; value: number | string }>, withCustom: boolean): string {
  const items = steps.map((step) => `<label><input type="radio" name="${name}" value="${step.value}" />${esc(step.label)}</label>`);
  if (withCustom) items.push(`<label><input type="radio" name="${name}" value="custom" />Custom</label>`);
  return `<div data-segments>${items.join("")}</div>`;
}

function imageSourceOptions(name: string): string {
  return `<div data-options>${IMAGE_SOURCE_OPTIONS.map((option) =>
    `<label><input type="radio" name="${name}" value="${option.value}" /><span><b>${esc(option.label)}</b><small>${esc(option.help)}</small></span></label>`).join("")}</div>`;
}

function themeTiles(name = "themePreset"): string {
  return `<div data-tiles role="radiogroup" aria-label="Theme">${THEME_PRESET_OPTIONS.map(({ value, label }) => {
    const tokens = themePreviewTokens(value);
    const style = `--swatch-accent:${tokens.accent};--swatch-text:${tokens.text};--swatch-bg:${tokens.dialogueBg};--swatch-border:${tokens.dialogueBorder};--swatch-font:${tokens.fontFamily}`;
    return `<label><input type="radio" name="${name}" value="${value}" /><span data-swatch style="${esc(style)}"><i>The wind picks up…</i></span><span>${esc(label.replace(/ \(.*\)$/, ""))}</span></label>`;
  }).join("")}</div>`;
}


const ICONS: Record<SettingsSectionId, string> = {
  reading: '<path d="M4 5.5C6.5 4.5 9.5 4.6 12 6.3c2.5-1.7 5.5-1.8 8-.8v13c-2.5-1-5.5-.9-8 .8-2.5-1.7-5.5-1.8-8-.8z"/><path d="M12 6.3v13"/>',
  look: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.4-1.9-.5-1.2.3-2.4 1.6-2.4h1.6a3.9 3.9 0 0 0 3.9-3.9C20.5 7.3 16.7 3.5 12 3.5z"/><circle cx="7.6" cy="11.2" r="1.1"/><circle cx="10.6" cy="7.5" r="1.1"/><circle cx="15" cy="8" r="1.1"/>',
  pictures: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><circle cx="9" cy="10" r="1.7"/><path d="m4 17 5-4.5 3.5 3 3-2.5L20 17"/>',
  sound: '<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.8" cy="17.5" r="2.3"/><circle cx="16.8" cy="15.5" r="2.3"/>',
  voice: '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V20.5"/>',
  connections: '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5l1.4-1.4a4 4 0 0 1 5.6 5.6L16.6 12M13 17.5l-1.4 1.4a4 4 0 0 1-5.6-5.6L7.4 12"/>',
  advanced: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/><path d="M4 12h5M13 12h7"/><circle cx="11" cy="12" r="2"/>',
};

function icon(paths: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

/** Marks a searchable setting: the label shown in results plus extra words that also find it. */
function find(label: string, keywords = ""): string {
  return `data-find-label="${esc(label)}" data-find="${esc(keywords)}"`;
}

/** Long explanations sit behind a small disclosure so the default view stays scannable. */
function more(html: string): string {
  return `<details data-more><summary>More</summary><div>${html}</div></details>`;
}

function group(title: string, body: string, options: { id?: string; apply?: boolean; help?: string; find?: string } = {}): string {
  const chip = options.apply ? `<span data-apply-chip title="Changes here wait for the Apply button">Applies with Apply</span>` : "";
  const help = options.help ? `<small>${options.help}</small>` : "";
  return `<section data-group${options.id ? ` data-group-id="${options.id}"` : ""}${options.apply ? " data-apply-group" : ""} ${options.find ?? find(title)}><header data-group-head><h3>${esc(title)}</h3>${chip}${help}</header>${body}</section>`;
}

function optionList(name: string, options: ReadonlyArray<{ value: string; label: string; help: string }>): string {
  return `<div data-options>${options.map((option) =>
    `<label><input type="radio" name="${name}" value="${option.value}" /><span><b>${esc(option.label)}</b><small>${esc(option.help)}</small></span></label>`).join("")}</div>`;
}

function readinessRow(kind: ConnectionCatalogKind): string {
  return `<div data-readiness="${kind}" data-level="loading"><div><b data-readiness-title></b><small data-readiness-action></small><div data-actions hidden><button type="button" data-refresh-connections>Refresh</button></div></div></div>`;
}

function paneHead(id: SettingsSectionId): string {
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id)!;
  return `<header data-pane-head><h2 id="pane-${id}-title">${esc(section.label)}</h2><p>${esc(section.blurb)}</p></header>`;
}

function pane(id: SettingsSectionId, body: string, extra = ""): string {
  return `<section role="tabpanel" id="pane-${id}" data-pane="${id}" aria-labelledby="pane-${id}-title" tabindex="-1" hidden${extra}>${paneHead(id)}${body}</section>`;
}

const VOICE_SEARCH_ENTRIES: ReadonlyArray<{ label: string; keywords: string }> = [
  { label: "Read paragraphs aloud", keywords: "speech tts voice enable speak" },
  { label: "TTS profiles", keywords: "speech load profiles voice connection" },
  { label: "Narrator voice", keywords: "speech tts narration" },
  { label: "Character voices", keywords: "speech tts per character override default voice" },
  { label: "Delivery style", keywords: "speech gemini audio tags whisper emotion" },
  { label: "Speech volume", keywords: "speech tts autoplay auto-play loudness" },
];

export class VisualNovelSettingsPanel {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly form: HTMLFormElement;
  private readonly status: HTMLElement;
  private readonly options: SettingsPanelOptions;
  private readonly storage: SetupFlagStorage | null;
  private config: VisualNovelConfig = DEFAULT_CONFIG;
  private drafts = new Set<AdvancedKey>();
  private promptPresets: VisualNovelPromptPreset[] = [];
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private sampleTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private sampleLine = 0;
  private section: SettingsSectionId = "reading";
  private voiceMounted = false;
  private resizeObserver: ResizeObserver | null = null;
  private audioLibrary: { bgmCount: number; sfxCount: number } | null = null;
  private readonly connectionStates: Record<ConnectionCatalogKind, ConnectionCatalogState> = {
    planner: { status: "idle", options: [] },
    image: { status: "idle", options: [] },
  };

  constructor(options: SettingsPanelOptions) {
    this.options = options;
    this.storage = options.setupStorage === undefined ? safeStorage() : options.setupStorage;
    this.host = document.createElement("div");
    this.host.setAttribute("data-vn-settings", "");
    this.root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    const body = document.createElement("div");
    body.innerHTML = this.template();
    this.root.append(style, ...Array.from(body.childNodes));
    options.mount.append(this.host);
    this.form = this.root.querySelector("form")!;
    this.status = this.root.querySelector("[data-status]")!;
    // The live sample starts in Reading; openSection moves it to Look when needed.
    this.root.querySelector('[data-pane="reading"] [data-sample-slot]')!.append(this.root.querySelector("[data-sample]")!);
    this.renderTextEffectCards();
    this.wire();
    this.wireNavigation();
    this.wireSearch();
    this.renderSetupVisibility();
    this.openSection(this.rememberedSection(), { remember: false });
    this.syncFromConfig(DEFAULT_CONFIG);
  }

  /* ---------------------------------------------------------------------- */
  /* Markup                                                                  */
  /* ---------------------------------------------------------------------- */

  private template(): string {
    const tabs = SETTINGS_SECTIONS.map(({ id, label }) => `
          <button type="button" role="tab" id="tab-${id}" data-tab="${id}" aria-controls="pane-${id}" aria-selected="false" tabindex="-1" aria-labelledby="tab-${id}-label" aria-describedby="tab-${id}-summary">
            ${icon(ICONS[id])}<span data-tab-text><span id="tab-${id}-label" data-tab-label>${esc(label)}</span><span id="tab-${id}-summary" data-tab-summary></span></span>${id === "connections" ? '<span data-tab-dot data-level="loading" aria-hidden="true"></span>' : ""}<span data-tab-badge hidden></span>
          </button>`).join("");
    return `
    <div data-shell>
      <div data-topbar>
        <div data-search role="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
          <input type="search" data-settings-search aria-label="Find a setting" placeholder="Find a setting…" autocomplete="off" spellcheck="false" aria-controls="settings-search-results" aria-expanded="false" />
          <div id="settings-search-results" data-search-results hidden></div>
        </div>
        <span data-status role="status" aria-live="polite"></span>
        <button type="button" data-open-preview>Open preview</button>
      </div>

      <section data-setup aria-labelledby="setup-title" hidden>
        <header>
          <h2 id="setup-title">Get started</h2>
          <small>Three choices. Nothing is generated until you send a message.</small>
        </header>
        <ol>
          <li><div>
            <h3>Story reader</h3>
            <small>Cue reads each reply to pick speakers, moods and scenes. This does not replace your chat model.</small>
            ${readinessRow("planner")}
            <label data-field><span>Connection</span><select name="setupParserConnectionId" data-connection-select="planner"><option value="">Lumiverse default</option></select></label>
          </div></li>
          <li><div>
            <h3>Pictures</h3>
            ${imageSourceOptions("setupImageSource")}
            <div data-setup-image-connection hidden>
              ${readinessRow("image")}
              <label data-field><span>Image connection</span><select name="setupImageConnectionId" data-connection-select="image"><option value="">Lumiverse default</option></select></label>
            </div>
          </div></li>
          <li><div>
            <h3>Look</h3>
            <small>Text size, text effects and picture fit are in the Look section.</small>
            ${themeTiles("setupThemePreset")}
          </div></li>
        </ol>
        <footer>
          <button type="button" data-primary data-setup-done>Done</button>
          <button type="button" data-open-preview>Open preview</button>
          <small>You can change any of this later. Choices here are saved as you make them.</small>
        </footer>
      </section>

      <div data-layout>
        <nav data-nav aria-label="Settings sections">
          <div role="tablist" data-tablist aria-orientation="vertical">${tabs}
          </div>
        </nav>

        <form novalidate data-panes>
          ${pane("reading", `
            <div data-sample-slot></div>
            ${group("Pace", `
              <fieldset ${find("Text speed", "typing typewriter letters milliseconds")}>
                <legend>Text speed</legend>
                ${segments("textSpeedStep", TEXT_SPEED_STEPS, true)}
                <label data-field data-custom="textSpeed" hidden><span>Milliseconds per letter</span><input name="textSpeed" type="number" min="0" max="100" step="1" /><small>0 shows each line at once.</small></label>
              </fieldset>
              <fieldset ${find("Auto-play pause", "pause next line autoplay delay wait")}>
                <legend>Pause before the next line (auto-play)</legend>
                ${segments("autoPlayStep", AUTO_PLAY_STEPS, true)}
                <label data-field data-custom="autoPlayDelay" hidden><span>Milliseconds</span><input name="autoPlayDelay" type="number" min="500" max="10000" step="250" /></label>
              </fieldset>
              <label data-field ${find("Fast forward", "skip read unread")}><span>Fast forward</span><select name="skipMode"><option value="read">Skip only text you have read</option><option value="all">Skip everything</option></select></label>
            `, { find: find("Pace", "speed") })}
            ${group("Your turn", `
              <label data-field ${find("How you reply", "reply mode cyoa choose suggestions write standard")}><span>How you reply</span><select name="mode"><option value="standard">Write your own reply</option><option value="cyoa">Choose from suggestions</option></select></label>
              <label data-check ${find("Suggest choices", "choices options cyoa generate")}><input name="generateChoices" type="checkbox" /><span>Suggest choices when the reply has none</span></label>
            `)}
            ${group("Starting", `
              <label data-check ${find("Open automatically", "auto enter open novel view chat start")}><input name="autoEnter" type="checkbox" /><span>Open the novel view automatically when a chat opens</span></label>
            `)}
          `)}

          ${pane("look", `
            <div data-sample-slot></div>
            ${group("Theme", themeTiles(), { find: find("Theme", "preset style colours colors skin golden paper noir console yamaku literature") })}
            ${group("Text", `
              <fieldset ${find("Text size", "font scale bigger smaller large")}>
                <legend>Text size</legend>
                ${segments("textScaleStep", TEXT_SCALE_STEPS, true)}
                <label data-field data-custom="textScale" hidden><span>Scale (1 = normal)</span><input name="textScale" type="number" min="${TEXT_SCALE_MIN}" max="${TEXT_SCALE_MAX}" step="0.05" /></label>
              </fieldset>
              <fieldset ${find("Text effects", "shake rainbow wave animated letters still")}>
                <legend>Text effects</legend>
                ${optionList("textEffects", TEXT_EFFECT_MODE_OPTIONS)}
              </fieldset>
            `)}
            ${group("Scene", `
              <fieldset ${find("Scene effects", "rain sparkles shake flash intensity gentle motion")}>
                <legend>Scene effects</legend>
                ${optionList("effectIntensity", EFFECT_INTENSITY_OPTIONS)}
              </fieldset>
              <fieldset ${find("Picture fit", "image fit cover contain stretch crop scale")}>
                <legend>Picture fit</legend>
                ${optionList("sceneImageFit", SCENE_IMAGE_FIT_OPTIONS)}
              </fieldset>
            `)}
            ${group("Text effect tags", `
              <div data-actions><button type="button" data-copy-guide>Copy guide for your chat model</button><small>Paste it into a character card, lorebook entry or preset so the model uses the tags.</small></div>
              <div data-copy-fallback hidden><small data-copy-fallback-label>Copying is blocked here. The text is selected: press Ctrl+C (or ⌘C).</small><textarea readonly spellcheck="false" aria-label="Text to copy"></textarea></div>
              <ul data-text-fx-list data-vn-text-effects="animated"></ul>
            `, { id: "text-fx", help: "Wrap a few words of dialogue in a tag, for example &lt;shake&gt;No!&lt;/shake&gt;.", find: find("Text effect tags", "markup reference copy guide chat model shake rainbow wave glitch whisper shout") })}
          `)}

          ${pane("pictures", `
            ${group("Where pictures come from", imageSourceOptions("imageSource"), { find: find("Picture source", "image source card generated illustrations text only") })}
            <div data-generated-only>
              ${group("Pictures per reply", `
                <fieldset aria-label="Pictures per reply">
                  ${segments("budgetPreset", BUDGET_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })), true)}
                  <small data-budget-help></small>
                  <label data-field data-custom="maxImagesPerTurn" hidden><span>Maximum pictures per reply</span><input name="maxImagesPerTurn" type="number" min="0" max="12" step="1" /><small>0 removes the limit. Long replies can then cost more than you expect.</small></label>
                </fieldset>
              `, { find: find("Pictures per reply", "budget limit images cost light balanced rich") })}
              ${group("Consistent characters", `
                <label data-check><input name="referenceAnchoring" type="checkbox" /><span>Keep each character looking the same between pictures<small>Reuses a character's first portrait as a reference for later ones.</small></span></label>
                <fieldset data-reference-source hidden>
                  <legend>Reference image source</legend>
                  ${optionList("referenceSource", REFERENCE_SOURCE_OPTIONS)}
                </fieldset>
              `, { find: find("Consistent characters", "reference anchoring portrait same look sprites") })}
              ${group("Image connection", `
                <div data-field>
                  ${readinessRow("image")}
                  <select name="imageConnectionId" data-connection-select="image" aria-label="Image connection"><option value="">Lumiverse default</option></select>
                </div>
              `, { find: find("Image connection", "image model provider stability comfyui novelai") })}
              <section data-group data-novelai-controls hidden ${find("NovelAI", "novelai dimensions steps sampler seed guidance cfg anlas")}>
                <header data-group-head><h3>NovelAI</h3><small>Shown because the image connection is NovelAI.</small></header>
                <fieldset>
                  <legend>Image dimensions</legend>
                  ${segments("novelAiResolutionPreset", [
                    { label: "Landscape (1216×832)", value: "landscape" },
                    { label: "Portrait (832×1216)", value: "portrait" },
                    { label: "Square (1024×1024)", value: "square" },
                  ], true)}
                  <div data-custom="novelAiDimensions" data-row hidden>
                    <label data-field><span>Width</span><input name="novelAiWidth" type="number" min="64" max="2048" step="64" /></label>
                    <label data-field><span>Height</span><input name="novelAiHeight" type="number" min="64" max="2048" step="64" /></label>
                  </div>
                  <small data-novelai-cost-notice>${esc(NOVELAI_NOTICE)} <a href="https://docs.novelai.net/en/subscription/" target="_blank" rel="noopener noreferrer">NovelAI subscription docs</a></small>
                </fieldset>
                <div data-row>
                  <label data-field><span>Sampling steps <small data-novelai-steps-help>(≤28 within Opus limit)</small></span><input name="novelAiSteps" type="number" min="${NOVELAI_STEPS_MIN}" max="${NOVELAI_STEPS_MAX}" step="1" /></label>
                  <label data-field><span>Prompt guidance (CFG scale)</span><input name="novelAiGuidance" type="number" min="${NOVELAI_GUIDANCE_MIN}" max="${NOVELAI_GUIDANCE_MAX}" step="0.5" /></label>
                </div>
                <div data-row>
                  <div data-field>
                    <span>Sampler</span>
                    <select name="novelAiSampler" aria-label="NovelAI sampler"></select>
                  </div>
                  <div data-field>
                    <span>Seed <small>(empty = random each image)</small></span>
                    <div data-actions style="flex-wrap: nowrap"><input name="novelAiSeed" type="number" inputmode="numeric" min="0" max="${NOVELAI_SEED_MAX}" step="1" placeholder="Random" aria-label="Seed" /><button type="button" data-novelai-random-seed>Random</button></div>
                  </div>
                </div>
              </section>
            </div>
          `)}

          ${pane("sound", `
            ${group("Music library", `
              <div data-sound-empty>
                ${icon(ICONS.sound)}
                <p>No music yet</p>
                <small>Import a folder of .mp3, .ogg, .wav, .m4a or .flac files. Cue plays them as background music and sound effects when a scene calls for them.</small>
                <div data-actions><button type="button" data-primary data-import-audio>Import music folder…</button><button type="button" data-scan-audio>Check library</button></div>
              </div>
              <div data-sound-ready hidden>
                <p data-sound-counts></p>
                <div data-actions><button type="button" data-import-audio>Import more…</button><button type="button" data-scan-audio>Check library</button></div>
              </div>
              <small data-audio-status role="status" aria-live="polite"></small>
            `, { find: find("Music library", "import audio folder bgm sfx scan check") })}
            ${group("Volume", `
              <div data-row>
                <label data-field ${find("Music volume", "bgm loudness audio")}><span>Music volume <span data-bgm-val>70%</span></span><input name="bgmVolume" type="range" min="0" max="1" step="0.05" /></label>
                <label data-field ${find("Sound effects volume", "sfx loudness audio")}><span>Sound effects volume <span data-sfx-val>80%</span></span><input name="sfxVolume" type="range" min="0" max="1" step="0.05" /></label>
              </div>
            `, { find: "" })}
          `)}

          ${pane("voice", `
            <div data-speech-mount></div>
            <p data-voice-empty class="muted">Speech settings are not available in this host.</p>
          `)}

          ${pane("connections", `
            <div data-actions><button type="button" data-refresh-connections>Refresh connection list</button><small>Refreshing is free. Connections are listed, not tested.</small></div>
            ${group("Story reader", `
              <div data-field>
                ${readinessRow("planner")}
                <select name="parserConnectionId" data-connection-select="planner" aria-label="Story reader connection"><option value="">Lumiverse default</option></select>
                <small>Reads the conversation to choose pictures and speakers. Saves when changed.</small>
              </div>
            `, { find: find("Story reader connection", "planner parser model llm connection") })}
            ${group("Image connection", `
              <div data-actions><small>Chosen in Pictures, next to where pictures come from.</small><button type="button" data-goto="pictures" data-goto-target="imageConnectionId">Go to Pictures</button></div>
            `, { find: "" })}
            ${group("System One", `
              <label data-field ${find("System One decisions", "jev typesafe mode compare")}><span>System One decisions</span><select name="systemOneMode"><option value="off">Off</option><option value="compare">Compare with story reader</option><option value="on">Use for presentation and familiar scenes</option></select>${more("Jev makes bounded speaker, expression, audio, and scene decisions. Compare logs agreement without changing the turn.")}</label>
              <div data-row>
                <label data-field ${find("System One API URL", "jev endpoint url")}><span>API URL</span><input name="systemOneApiUrl" type="url" placeholder="https://api.typesafe.ai" /><small>Requests go through Lumiverse's HTTP proxy.</small></label>
                <label data-field ${find("System One model", "jev model")}><span>Model</span><input name="systemOneModel" type="text" placeholder="jev-latest" /></label>
              </div>
              <div data-field ${find("System One API key", "jev key secret password")}><span>API key</span><input name="systemOneApiKey" type="password" autocomplete="new-password" placeholder="Enter key" /><div data-actions><button type="button" data-save-system-one-key>Save key</button><button type="button" data-clear-system-one-key>Remove key</button><small data-system-one-key-status>Checking saved key…</small></div><small>The key saves at once, encrypted for this extension. It is never part of Cue settings.</small></div>
            `, { apply: true, help: "Optional. Mode, URL and model wait for Apply; the key saves on its own.", find: find("System One", "jev") })}
          `)}

          ${pane("advanced", `
            <p class="muted">Changes in this section wait until you choose <b>Apply</b>. Everything else saves on its own.</p>
            <div data-jump aria-label="Jump to">
              <button type="button" data-jump-to="prompts">Image prompts</button>
              <button type="button" data-jump-to="context">Story reader</button>
              <button type="button" data-jump-to="filtering">Text filtering</button>
              <button type="button" data-jump-to="models">Models and parameters</button>
              <button type="button" data-jump-to="css">Custom CSS</button>
              <button type="button" data-jump-to="storage">Storage and logs</button>
              <button type="button" data-jump-to="maintenance">Reset</button>
            </div>
            ${group("Image prompts", `
              <div data-field ${find("Prompt presets", "preset save delete positive negative")}>
                <span>Preset</span>
                <div data-preset-row>
                  <select name="promptPresetSelect" aria-label="Prompt preset"><option value="">Custom (no preset)</option></select>
                  <input name="promptPresetName" type="text" placeholder="Preset name" aria-label="Preset name" />
                  <button type="button" data-preset-save>Save preset</button>
                  <button type="button" data-preset-delete>Delete</button>
                </div>
                <small>Choosing a preset fills the fields below. Save preset stores them under the name at once.</small>
              </div>
              <div data-row>
                <label data-field ${find("Positive prefix", "prompt prefix tags")}><span>Positive prefix</span><input name="promptPrefix" type="text" /></label>
                <label data-field ${find("Positive suffix", "prompt suffix tags")}><span>Positive suffix</span><input name="promptSuffix" type="text" /></label>
              </div>
              <label data-field ${find("Negative prompt", "negative tags")}><span>Negative prompt</span><input name="negativePrompt" type="text" /></label>
              <div data-novelai-prompt-controls hidden>
                <label data-check ${find("NovelAI quality tags", "novelai quality tags")}><input name="novelAiQualityTags" type="checkbox" /><span>Add NovelAI model-specific quality tags${more("Tags are included in the sent prompt. V4.5 Curated also adds rating:general and reduces feet emphasis. Turn off for full control.")}</span></label>
                <label data-check ${find("NovelAI default negative", "novelai negative default")}><input name="novelAiUseDefaultNegative" type="checkbox" /><span>Use NovelAI defaults for an unchanged negative prompt${more("Your edited negative prompt is always preserved. An empty field stays empty. Native emphasis and separate character prompts are selected automatically for supported models.")}</span></label>
              </div>
              <label data-check ${find("Series reference tag", "creation series original reference")}><input name="originalReference" type="checkbox" /><span>Include character creation / series reference tag</span></label>
              <label data-field ${find("Creation / series name", "series franchise original")}><span>Creation / series name</span><input name="originalCreationName" type="text" placeholder="e.g. doki doki literature club" />${more("When enabled, NovelAI uses: Character, series name. Other profiles use: Character \\(Creation\\). Appearance tags follow as usual.")}</label>
            `, { id: "prompts", apply: true })}
            ${group("What the story reader sees", `
              <label data-field ${find("Recent messages", "context history messages story reader")}><span>Recent messages</span><input name="includeRecentMessages" type="number" min="0" max="30" step="1" /></label>
              <label data-check ${find("Character-card context", "character card context")}><input name="includeCharacterContext" type="checkbox" /><span>Include character-card context</span></label>
              <label data-check ${find("Persona context", "persona user context")}><input name="includePersonaContext" type="checkbox" /><span>Include active persona context</span></label>
              <label data-check ${find("Lorebook context", "lorebook world info context")}><input name="includeLorebookContext" type="checkbox" /><span>Include activated lorebook context</span></label>
              <label data-field ${find("Story reader instructions", "planner custom instructions prompt")}><span>Story reader instructions</span><textarea name="customPlannerInstructions"></textarea></label>
            `, { id: "context", apply: true })}
            ${group("Text filtering", `
              <label data-field ${find("Ignored tags", "status inventory hide strip blocks filter")}><span>Ignored tags</span><input name="ignoredTags" type="text" placeholder="status, stats, system, inventory" /><small>Comma-separated tag names. Removes the whole matching block from dialogue and image planning.</small>${more("For example status, inventory, WORLD_VOICE. Multiline blocks are removed too. Recognized status blocks stay available as plain-text cards in Panels. The chat message is not edited.")}</label>
              <label data-field ${find("Display regex rules", "regex replace formatting dialogue pattern")}><span>Display regex rules</span><textarea name="displayRegexRules" spellcheck="false" placeholder="/§([^§]+)§/g => <em class=&quot;vn-transmission&quot;>$1</em>"></textarea><small>One rule per line: <code>/pattern/flags =&gt; replacement</code>. Dialogue formatting only.</small>${more("<code>pattern =&gt; replacement</code> also works. An empty replacement hides a match from dialogue, not from image planning. Only safe inline formatting renders here. For full HTML/SVG cards, open Panels in the novel view.")}</label>
            `, { id: "filtering", apply: true })}
            ${group("Models and parameters", `
              <div data-row>
                <label data-field ${find("Image model override", "image model checkpoint")}><span>Image model override</span><input name="imageModel" type="text" placeholder="Use the selected connection model" /><small data-image-model-hint>Leave blank to use the model configured on the selected image connection.</small></label>
                <label data-field ${find("Images at the same time", "concurrency parallel images")}><span>Images generated at the same time</span><input name="imageConcurrency" type="number" min="1" max="6" step="1" /></label>
              </div>
              <div data-row>
                <label data-field ${find("Story reader parameters (JSON)", "planner parser json temperature parameters")}><span>Story reader parameters (JSON)</span><textarea name="parserParameters" spellcheck="false"></textarea></label>
                <label data-field ${find("Image parameters (JSON)", "image json parameters steps")}><span>Image parameters (JSON)</span><textarea name="imageParameters" spellcheck="false"></textarea></label>
              </div>
            `, { id: "models", apply: true })}
            ${group("Custom CSS", `
              <label data-field ${find("Theme CSS", "custom css style stylesheet")}><span>Theme CSS</span><textarea name="customCss" spellcheck="false"></textarea><small>Selectors beginning with data-vn are stable. Remote imports and URL fetches are removed.</small></label>
            `, { id: "css", apply: true, find: find("Custom CSS", "style stylesheet") })}
            ${group("Storage and logs", `
              <label data-field ${find("Music storage folder", "audio directory folder scoped storage")}><span>Music storage folder</span><input name="audioDirectory" type="text" placeholder="audio" /><small>Folder inside the extension's scoped Lumiverse storage, scanned for music and sound effects.</small></label>
              <label data-check ${find("Verbose debug logging", "debug log console verbose")}><input name="debugLogging" type="checkbox" /><span>Verbose debug logging<small>Writes host events, planning, assets and anchoring to the Lumiverse log and browser console.</small>${more("While on, story text, the raw planner response and resolved character, wardrobe and environment state are written to the log.")}</span></label>
            `, { id: "storage", apply: true, find: "" })}
            ${group("Reset and setup", `
              <div data-actions>
                <button type="button" data-reset>Reset defaults</button>
                <button type="button" data-quiet data-show-setup>Show setup guide</button>
              </div>
              <small>Reset returns every setting to its default and saves at once. Your saved prompt presets and music folder are kept.</small>
            `, { id: "maintenance", find: find("Reset defaults", "reset defaults setup guide onboarding start over") })}
          `, " data-advanced-settings")}

          <div data-draft-bar hidden>
            <div><span data-draft-count></span><small>Advanced changes are applied together.</small></div>
            <div data-actions>
              <button type="button" data-discard>Discard</button>
              <button type="submit" data-primary data-apply data-apply-bar>Apply</button>
            </div>
          </div>
        </form>
      </div>

      <section data-sample aria-label="Story sample" data-effects="full">
        <div data-sample-stage>
          <img data-sample-picture alt="" src="${SAMPLE_PICTURE}" />
          <div data-sample-dialogue><span data-sample-speaker>Mira</span><p data-sample-text><span data-sample-words></span><span data-sample-caret aria-hidden="true"></span></p><span data-sample-next aria-hidden="true"></span></div>
        </div>
        <div data-sample-label><span class="muted">Sample only. Rendered here, no connections used.</span><button type="button" data-quiet data-sample-replay>Replay</button></div>
      </section>
    </div>`;
  }

  /* ---------------------------------------------------------------------- */
  /* Navigation                                                              */
  /* ---------------------------------------------------------------------- */

  /** The section currently shown. */
  getSection(): SettingsSectionId {
    return this.section;
  }

  /**
   * Shows one section (deep link). Remembers it for the next visit unless
   * `remember: false`. `focus: true` moves keyboard focus to the section's tab.
   */
  openSection(id: SettingsSectionId | string, options: { focus?: boolean; remember?: boolean } = {}): void {
    const next = normalizeSettingsSection(id);
    this.section = next;
    for (const tab of this.root.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
      const selected = tab.dataset.tab === next;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && options.focus) tab.focus({ preventScroll: true });
      if (selected) {
        // Keep the active tab in view on the narrow, horizontally scrolling strip.
        const list = tab.parentElement!;
        if (list.scrollWidth > list.clientWidth) {
          const left = tab.offsetLeft - list.offsetLeft;
          if (left < list.scrollLeft) list.scrollLeft = left - 8;
          else if (left + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = left + tab.offsetWidth - list.clientWidth + 8;
        }
      }
    }
    for (const pane of this.root.querySelectorAll<HTMLElement>("[data-pane]")) pane.hidden = pane.dataset.pane !== next;
    // One live sample, shown only where it helps: Reading and Look.
    const slot = this.root.querySelector<HTMLElement>(`[data-pane="${next}"] [data-sample-slot]`);
    const sample = this.root.querySelector<HTMLElement>("[data-sample]")!;
    if (slot) {
      if (sample.parentElement !== slot) slot.append(sample);
      this.restartSample();
    } else if (this.sampleTimer) {
      clearTimeout(this.sampleTimer);
      this.sampleTimer = null;
    }
    if (options.remember !== false) {
      try { this.storage?.setItem(SETTINGS_SECTION_KEY, next); } catch { /* storage is optional */ }
    }
  }

  /**
   * Where the speech settings section mounts: inside the Voice section.
   * Calling it marks the Voice section as provided by the host.
   */
  voiceMount(): HTMLElement {
    this.voiceMounted = true;
    this.root.querySelector<HTMLElement>("[data-voice-empty]")!.hidden = true;
    return this.root.querySelector<HTMLElement>("[data-speech-mount]")!;
  }

  private rememberedSection(): SettingsSectionId {
    try { return normalizeSettingsSection(this.storage?.getItem(SETTINGS_SECTION_KEY)); } catch { return "reading"; }
  }

  private wireNavigation(): void {
    const tablist = this.root.querySelector<HTMLElement>("[data-tablist]")!;
    const tabs = () => Array.from(this.root.querySelectorAll<HTMLButtonElement>("[data-tab]"));
    tablist.addEventListener("click", (event) => {
      const tab = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-tab]");
      if (tab) this.openSection(tab.dataset.tab!);
    });
    tablist.addEventListener("keydown", (event) => {
      const list = tabs();
      const index = list.findIndex((tab) => tab === this.root.activeElement);
      if (index < 0) return;
      let next = -1;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % list.length;
      else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + list.length) % list.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = list.length - 1;
      if (next < 0) return;
      event.preventDefault();
      this.openSection(list[next]!.dataset.tab!, { focus: true });
    });
    // The rail is vertical on wide containers and a horizontal strip on narrow ones.
    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => {
        const nav = this.root.querySelector<HTMLElement>("[data-nav]")!;
        const vertical = getComputedStyle(this.root.querySelector<HTMLElement>("[data-tablist]")!).flexDirection === "column";
        tablist.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
        nav.dataset.orientation = vertical ? "vertical" : "horizontal";
      });
      this.resizeObserver.observe(this.host);
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-goto]")) {
      button.addEventListener("click", () => {
        const target = button.dataset.gotoTarget ? this.root.querySelector<HTMLElement>(`[name="${button.dataset.gotoTarget}"]`) : null;
        if (target) this.reveal(target);
        else this.openSection(button.dataset.goto!);
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-jump-to]")) {
      button.addEventListener("click", () => {
        const group = this.root.querySelector<HTMLElement>(`[data-group-id="${button.dataset.jumpTo}"]`);
        if (group) this.reveal(group);
      });
    }
  }

  /** Opens the section holding `element`, any closed disclosure around it, scrolls to it and focuses it. */
  private reveal(element: HTMLElement, options: { flash?: boolean; focus?: boolean } = {}): void {
    const pane = element.closest<HTMLElement>("[data-pane]");
    if (pane) this.openSection(pane.dataset.pane!);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    // Conditionally hidden settings (e.g. NovelAI-only) fall back to their nearest shown ancestor.
    let target: HTMLElement = element;
    while (target.parentElement && target !== pane && target.closest("[hidden]") && target.closest("[hidden]") !== pane) {
      target = target.parentElement;
    }
    target.scrollIntoView({ block: "center" });
    if (options.flash !== false) {
      const flashTarget = target.matches("[data-group], [data-field], fieldset, label") ? target : target.closest<HTMLElement>("[data-field], fieldset, label[data-check], [data-group]") ?? target;
      flashTarget.removeAttribute("data-flash");
      void flashTarget.offsetWidth;
      flashTarget.setAttribute("data-flash", "");
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => flashTarget.removeAttribute("data-flash"), 1700);
    }
    if (options.focus !== false) {
      const focusable = target.matches("input, select, textarea, button")
        ? target
        : target.querySelector<HTMLElement>("input:checked, input:not([type=hidden]), select, textarea, button");
      focusable?.focus({ preventScroll: true });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Search                                                                  */
  /* ---------------------------------------------------------------------- */

  private searchTargets = new Map<string, HTMLElement>();

  private searchEntries(): SettingsSearchEntry[] {
    const entries: SettingsSearchEntry[] = [];
    this.searchTargets.clear();
    let index = 0;
    for (const element of this.root.querySelectorAll<HTMLElement>("[data-pane] [data-find-label]")) {
      const section = element.closest<HTMLElement>("[data-pane]")!.dataset.pane as SettingsSectionId;
      const id = `s${index++}`;
      this.searchTargets.set(id, element);
      entries.push({ id, label: element.dataset.findLabel!, section, keywords: element.dataset.find ?? "" });
    }
    const voice = this.root.querySelector<HTMLElement>("[data-pane=\"voice\"]")!;
    if (this.voiceMounted) {
      for (const entry of VOICE_SEARCH_ENTRIES) {
        const id = `s${index++}`;
        this.searchTargets.set(id, voice);
        entries.push({ id, label: entry.label, section: "voice", keywords: entry.keywords });
      }
    }
    return entries;
  }

  private wireSearch(): void {
    const input = this.root.querySelector<HTMLInputElement>("[data-settings-search]")!;
    const results = this.root.querySelector<HTMLElement>("[data-search-results]")!;
    const close = () => { results.hidden = true; input.setAttribute("aria-expanded", "false"); };
    const jump = (id: string | undefined) => {
      const target = id ? this.searchTargets.get(id) : undefined;
      if (!target) return;
      close();
      if (target.matches("[data-pane]")) { this.openSection(target.dataset.pane!); target.focus({ preventScroll: true }); target.scrollIntoView({ block: "start" }); return; }
      this.reveal(target);
    };
    const render = () => {
      const query = input.value.trim();
      if (!query) { results.replaceChildren(); close(); return; }
      const matches = searchSettings(this.searchEntries(), query);
      if (matches.length === 0) {
        const empty = document.createElement("p");
        empty.setAttribute("data-search-empty", "");
        empty.textContent = `No setting matches “${query}”.`;
        results.replaceChildren(empty);
      } else {
        results.replaceChildren(...matches.map((match) => {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.searchResult = match.id;
          button.dataset.section = match.section;
          const label = document.createElement("span");
          label.textContent = match.label;
          const where = document.createElement("span");
          where.textContent = SETTINGS_SECTIONS.find((section) => section.id === match.section)!.label;
          button.append(label, where);
          const target = this.searchTargets.get(match.id);
          const pane = target?.closest("[data-pane]");
          const hiddenAncestor = target?.parentElement?.closest("[hidden]");
          if (hiddenAncestor && hiddenAncestor !== pane) {
            const note = document.createElement("small");
            note.textContent = "Not shown with your current choices";
            button.append(note);
          }
          button.addEventListener("click", () => jump(match.id));
          return button;
        }));
      }
      results.hidden = false;
      input.setAttribute("aria-expanded", "true");
    };
    input.addEventListener("input", render);
    input.addEventListener("focus", () => { if (input.value.trim()) render(); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        jump(results.querySelector<HTMLElement>("[data-search-result]")?.dataset.searchResult);
      } else if (event.key === "Escape") {
        if (input.value) { event.preventDefault(); input.value = ""; render(); }
      } else if (event.key === "ArrowDown") {
        const first = results.querySelector<HTMLElement>("[data-search-result]");
        if (first) { event.preventDefault(); first.focus(); }
      }
    });
    results.addEventListener("keydown", (event) => {
      const items = Array.from(results.querySelectorAll<HTMLElement>("[data-search-result]"));
      const index = items.indexOf(this.root.activeElement as HTMLElement);
      if (event.key === "ArrowDown" && index >= 0) { event.preventDefault(); items[Math.min(items.length - 1, index + 1)]!.focus(); }
      else if (event.key === "ArrowUp" && index >= 0) { event.preventDefault(); if (index === 0) input.focus(); else items[index - 1]!.focus(); }
      else if (event.key === "Escape") { event.preventDefault(); close(); input.focus(); }
    });
    this.root.addEventListener("focusin", (event) => {
      if (!(event.target instanceof Node) || !this.root.querySelector("[data-search]")!.contains(event.target)) close();
    });
    this.root.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Node) || !this.root.querySelector("[data-search]")!.contains(event.target)) close();
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Text effects reference                                                  */
  /* ---------------------------------------------------------------------- */

  private renderTextEffectCards(): void {
    // The stage's own effect styles, so previews match the novel view.
    const fxStyle = document.createElement("style");
    fxStyle.setAttribute("data-text-fx-css", "");
    fxStyle.textContent = VN_TEXT_EFFECTS_CSS;
    this.root.prepend(fxStyle);
    const guide = this.root.querySelector<HTMLButtonElement>("[data-copy-guide]")!;
    guide.addEventListener("click", () => void this.copyText(TEXT_EFFECT_AUTHOR_GUIDE, guide));
    const list = this.root.querySelector<HTMLElement>("[data-text-fx-list]")!;
    list.replaceChildren(...TEXT_EFFECT_CATALOGUE.map((effect) => {
      const item = document.createElement("li");
      item.dataset.textFxItem = effect.id;
      const header = document.createElement("header");
      const label = document.createElement("b");
      label.textContent = effect.label;
      const kind = document.createElement("small");
      kind.textContent = effect.motion ? (effect.perLetter ? "Moves · per letter" : "Moves") : "Still";
      header.append(label, kind);
      const description = document.createElement("small");
      description.textContent = effect.description;
      const preview = document.createElement("div");
      preview.dataset.textFxPreview = "";
      preview.setAttribute("aria-hidden", "true");
      preview.innerHTML = formatDialogueText(effect.example);
      applyTextEffects(preview);
      const codeRow = document.createElement("div");
      codeRow.dataset.textFxCode = "";
      const code = document.createElement("code");
      code.textContent = effect.example;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.dataset.copyExample = effect.id;
      copy.textContent = "Copy";
      copy.setAttribute("aria-label", `Copy ${effect.label} example`);
      copy.addEventListener("click", () => void this.copyText(effect.example, copy));
      codeRow.append(code, copy);
      item.append(header, description, preview, codeRow);
      return item;
    }));
  }

  private async copyText(text: string, button: HTMLButtonElement): Promise<void> {
    const fallback = this.root.querySelector<HTMLElement>("[data-copy-fallback]")!;
    const original = button.dataset.label ?? button.textContent ?? "";
    button.dataset.label = original;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      fallback.hidden = true;
      button.textContent = "Copied";
      if (this.copyTimer) clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => { button.textContent = original; }, 1500);
    } catch {
      // Hosts without clipboard permission: show the text selected for a manual copy.
      const area = fallback.querySelector("textarea")!;
      area.value = text;
      fallback.hidden = false;
      area.focus();
      area.select();
    }
  }

  private syncTextEffectMode(config: VisualNovelConfig): void {
    const list = this.root.querySelector<HTMLElement>("[data-text-fx-list]")!;
    list.setAttribute("data-vn-text-effects", config.textEffects);
    const tokens = themePreviewTokens(config.themePreset);
    list.style.setProperty("--vn-accent", tokens.accent);
    list.style.setProperty("--vn-text", tokens.text);
    list.style.setProperty("--vn-muted-text", tokens.mutedText);
    list.style.setProperty("--vn-dialogue-bg", tokens.dialogueBg);
    list.style.setProperty("--vn-dialogue-border", tokens.dialogueBorder);
    list.style.setProperty("--vn-font-family", tokens.fontFamily);
  }

  /* ---------------------------------------------------------------------- */
  /* Wiring                                                                  */
  /* ---------------------------------------------------------------------- */

  private control<T extends HTMLElement>(name: string): T {
    const element = this.root.querySelector<T>(`[name="${name}"]`);
    if (!element) throw new Error(`Missing settings control: ${name}`);
    return element;
  }

  private radioValue(name: string): string {
    const checked = this.root.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
    return checked?.value ?? "";
  }

  private setRadio(name: string, value: string): void {
    for (const radio of this.root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)) {
      radio.checked = radio.value === value;
    }
  }

  private isAdvanced(name: string): name is AdvancedKey {
    return (ADVANCED_KEYS as readonly string[]).includes(name);
  }

  private wire(): void {
    // Everyday controls save the moment they change; Advanced keys become drafts until Apply.
    this.form.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
      if (this.isAdvanced(target.name)) { this.markDraft(target.name); return; }
      this.handleLiveChange(target);
    });
    this.form.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (this.isAdvanced(target.name)) { this.markDraft(target.name); return; }
      // Sliders and number fields preview while dragging or typing; the save happens on change.
      if (target.name === "bgmVolume" || target.name === "sfxVolume") this.updateVolumeLabels();
      if (target.name === "textSpeed") this.restartSample();
      if (target.name === "textScale") this.root.querySelector<HTMLElement>("[data-sample-stage]")!.style.setProperty("--sample-scale", String(clamp(Number(target.value), TEXT_SCALE_MIN, TEXT_SCALE_MAX, this.config.textScale)));
    });
    // "Random" clears the NovelAI seed and saves (an explicit null overrides a stored seed).
    this.root.querySelector<HTMLButtonElement>("[data-novelai-random-seed]")?.addEventListener("click", () => {
      const seed = this.control<HTMLInputElement>("novelAiSeed");
      seed.value = "";
      this.handleLiveChange(seed);
    });
    // Setup-card copies of shared choices live outside the form.
    this.root.querySelector("[data-setup]")!.addEventListener("change", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) this.handleLiveChange(target);
    });

    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.applyAdvanced();
    });
    this.root.querySelector<HTMLButtonElement>("[data-save-system-one-key]")?.addEventListener("click", () => {
      const field = this.control<HTMLInputElement>("systemOneApiKey");
      const key = field.value.trim();
      if (!key) { this.setSystemOneKeyStatus(false, "Enter a key first."); return; }
      this.setSystemOneKeyStatus(false, "Saving key…");
      this.options.onSaveSystemOneKey?.(key);
      field.value = "";
    });
    this.root.querySelector<HTMLButtonElement>("[data-clear-system-one-key]")?.addEventListener("click", () => {
      this.setSystemOneKeyStatus(false, "Removing key…");
      this.options.onClearSystemOneKey?.();
      this.control<HTMLInputElement>("systemOneApiKey").value = "";
    });
    this.form.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.applyAdvanced();
      }
    });

    for (const button of this.root.querySelectorAll("[data-open-preview]")) {
      button.addEventListener("click", () => this.options.onOpenPreview());
    }
    for (const button of this.root.querySelectorAll("[data-refresh-connections]")) {
      button.addEventListener("click", () => {
        for (const kind of ["planner", "image"] as const) {
          this.setConnectionCatalog(kind, { status: "loading", options: this.connectionStates[kind].options });
        }
        this.options.onRefreshConnections();
      });
    }
    this.root.querySelector("[data-setup-done]")?.addEventListener("click", () => this.setSetupDone(true));
    this.root.querySelector("[data-show-setup]")?.addEventListener("click", () => {
      this.setSetupDone(false);
      this.root.querySelector<HTMLElement>("[data-setup]")?.scrollIntoView({ block: "start" });
    });
    this.root.querySelector("[data-sample-replay]")?.addEventListener("click", () => this.restartSample());

    // Sound.
    for (const button of this.root.querySelectorAll("[data-scan-audio]")) {
      button.addEventListener("click", async () => {
        const dir = this.control<HTMLInputElement>("audioDirectory").value.trim();
        this.setAudioStatus("Checking the music folder…");
        try {
          const result = await this.options.onScanAudio?.(dir);
          if (result && typeof result === "object" && "bgmCount" in result) this.setAudioLibrary(result);
        } catch (error) {
          this.setAudioStatus(error instanceof Error ? error.message : String(error));
        }
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-import-audio]")) {
      if (!this.options.onImportAudio) button.disabled = true;
      button.addEventListener("click", () => {
        if (!this.options.onImportAudio) return;
        const picker = document.createElement("input");
        picker.type = "file";
        picker.multiple = true;
        picker.setAttribute("webkitdirectory", "");
        picker.addEventListener("change", () => {
          const files = picker.files ? Array.from(picker.files) : [];
          if (files.length === 0) return;
          void this.options.onImportAudio?.(files);
        });
        picker.click();
      });
    }

    // Reset is destructive, so it needs a second confirming click within four seconds.
    const resetButton = this.root.querySelector<HTMLButtonElement>("[data-reset]")!;
    resetButton.addEventListener("click", () => {
      if (!resetButton.hasAttribute("data-confirming")) {
        resetButton.setAttribute("data-confirming", "");
        resetButton.textContent = "Confirm reset?";
        this.setStatus("Choose Confirm reset? to return every setting to its default. Presets and the music folder stay.", "dirty");
        if (this.resetTimer) clearTimeout(this.resetTimer);
        this.resetTimer = setTimeout(() => {
          resetButton.removeAttribute("data-confirming");
          resetButton.textContent = "Reset defaults";
          this.refreshStatus();
        }, 4000);
        return;
      }
      if (this.resetTimer) clearTimeout(this.resetTimer);
      resetButton.removeAttribute("data-confirming");
      resetButton.textContent = "Reset defaults";
      this.pendingEverydayFields = {};
      const patch = resetPatch(this.config);
      this.drafts.clear();
      this.refreshStatus();
      this.save(patch, "Defaults restored.");
      this.syncFromConfig(patch);
    });

    // Prompt presets keep their immediate save: they are a small library, not a draft.
    const presetSelect = this.control<HTMLSelectElement>("promptPresetSelect");
    const presetName = this.control<HTMLInputElement>("promptPresetName");
    presetSelect.addEventListener("change", () => {
      const preset = this.promptPresets.find((candidate) => candidate.id === presetSelect.value);
      if (!preset) return;
      this.control<HTMLInputElement>("promptPrefix").value = preset.positive;
      this.control<HTMLInputElement>("negativePrompt").value = preset.negative;
      presetName.value = preset.name;
      this.markDraft("promptPrefix");
      this.markDraft("negativePrompt");
    });
    this.root.querySelector("[data-preset-save]")?.addEventListener("click", () => {
      const name = presetName.value.trim();
      if (!name) {
        this.setStatus("Give the preset a name first.", "error");
        return;
      }
      const positive = this.control<HTMLInputElement>("promptPrefix").value;
      const negative = this.control<HTMLInputElement>("negativePrompt").value;
      const existing = this.promptPresets.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
      let id: string;
      if (existing) {
        existing.name = name;
        existing.positive = positive;
        existing.negative = negative;
        id = existing.id;
      } else {
        id = `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        this.promptPresets.push({ id, name, positive, negative });
      }
      this.renderPromptPresetOptions(id);
      this.save({ promptPresets: this.promptPresets.map((preset) => ({ ...preset })) }, `Preset “${name}” ${existing ? "updated" : "saved"}.`);
    });
    this.root.querySelector("[data-preset-delete]")?.addEventListener("click", () => {
      const selected = this.promptPresets.find((candidate) => candidate.id === presetSelect.value);
      if (!selected) {
        this.setStatus("Select a preset to delete.", "error");
        return;
      }
      this.promptPresets = this.promptPresets.filter((candidate) => candidate.id !== selected.id);
      this.renderPromptPresetOptions("");
      presetName.value = "";
      this.save({ promptPresets: this.promptPresets.map((preset) => ({ ...preset })) }, `Preset “${selected.name}” deleted.`);
    });

    // Discard puts every Advanced control back to the last value the host gave us.
    this.root.querySelector("[data-discard]")?.addEventListener("click", () => this.discardAdvanced());

    // A failed validation inside a hidden section must open that section.
    this.form.addEventListener("invalid", (event) => {
      if (event.target instanceof HTMLElement) this.reveal(event.target, { flash: false, focus: false });
    }, true);
  }

  /* ---------------------------------------------------------------------- */
  /* Everyday (immediate) saves                                              */
  /* ---------------------------------------------------------------------- */

  private handleLiveChange(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
    const patch = this.livePatchFor(target);
    if (!patch) return;
    const next = { ...this.config, ...patch };
    this.config = next;
    this.syncEveryday(next);
    this.save(patch);
  }

  private livePatchFor(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): Partial<VisualNovelConfig> | null {
    const name = target.name;
    const checked = target instanceof HTMLInputElement && target.checked;
    switch (name) {
      case "mode": return { mode: target.value === "cyoa" ? "cyoa" : "standard" };
      case "skipMode": return { skipMode: target.value === "all" ? "all" : "read" };
      case "generateChoices": return { generateChoices: checked };
      case "autoEnter": return { autoEnter: checked };
      case "referenceAnchoring": return { referenceAnchoring: checked };
      case "referenceSource": return { referenceSource: normalizeReferenceSource(target.value) };
      case "themePreset":
      case "setupThemePreset":
        return { themePreset: normalizeThemePreset(target.value) };
      case "sceneImageFit": return { sceneImageFit: normalizeSceneImageFit(target.value) };
      case "effectIntensity": return { effectIntensity: normalizeEffectIntensity(target.value) };
      case "textEffects": return { textEffects: normalizeTextEffects(target.value) };
      case "textScaleStep": {
        if (target.value === "custom") { this.showCustom("textScale", true); return null; }
        return { textScale: Number(target.value) };
      }
      case "textScale": return { textScale: clamp(Number(target.value), TEXT_SCALE_MIN, TEXT_SCALE_MAX, DEFAULT_CONFIG.textScale) };
      case "bgmVolume": return { bgmVolume: clamp(Number(target.value), 0, 1, DEFAULT_CONFIG.bgmVolume) };
      case "sfxVolume": return { sfxVolume: clamp(Number(target.value), 0, 1, DEFAULT_CONFIG.sfxVolume) };
      case "imageSource":
      case "setupImageSource":
        return imageSourcePatch(target.value as ImageSource);
      case "parserConnectionId":
      case "setupParserConnectionId":
        return { parserConnectionId: target.value.trim() || null };
      case "imageConnectionId":
      case "setupImageConnectionId":
        return { imageConnectionId: target.value.trim() || null };
      case "textSpeedStep": {
        if (target.value === "custom") { this.showCustom("textSpeed", true); return null; }
        return { textSpeed: Number(target.value) };
      }
      case "textSpeed": return { textSpeed: clamp(Math.round(Number(target.value)), 0, 100, DEFAULT_CONFIG.textSpeed) };
      case "autoPlayStep": {
        if (target.value === "custom") { this.showCustom("autoPlayDelay", true); return null; }
        return { autoPlayDelay: Number(target.value) };
      }
      case "autoPlayDelay": return { autoPlayDelay: clamp(Math.round(Number(target.value)), 500, 10000, DEFAULT_CONFIG.autoPlayDelay) };
      case "budgetPreset": {
        if (target.value === "custom") { this.showCustom("maxImagesPerTurn", true); return null; }
        const preset = BUDGET_PRESETS.find((candidate) => candidate.id === target.value);
        return preset ? { maxImagesPerTurn: preset.value } : null;
      }
      case "maxImagesPerTurn": return { maxImagesPerTurn: clamp(Math.round(Number(target.value)), 0, 12, DEFAULT_CONFIG.maxImagesPerTurn) };
      case "novelAiSteps":
      case "novelAiGuidance":
      case "novelAiSampler":
      case "novelAiSeed":
      case "novelAiResolutionPreset":
      case "novelAiWidth":
      case "novelAiHeight":
        return this.buildNovelAiPatch(target);
      default: return null;
    }
  }

  private buildNovelAiPatch(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): Partial<VisualNovelConfig> | null {
    // 1. Everyday onSave merges into the acknowledged host config plus any in-flight
    // pending everyday fields, without overwriting unrelated incoming keys.
    const nextForHost = {
      ...(this.config.imageParameters ?? {}),
      ...this.pendingEverydayFields,
    };
    const changed = this.applyNovelAiField(target, nextForHost);
    if (changed) {
      this.pendingEverydayFields[changed.key] = changed.value;
    }

    // 2. Rebase or retain Advanced editor draft without wiping or submitting unrelated draft keys.
    const hasDraft = this.drafts.has("imageParameters");
    if (hasDraft) {
      const editorText = this.control<HTMLTextAreaElement>("imageParameters").value;
      try {
        const parsedDraft = jsonObject(editorText, "Image parameters");
        // Valid draft: rebase the everyday field while keeping unrelated draft keys unapplied.
        const rebasedDraft = { ...parsedDraft };
        this.applyNovelAiField(target, rebasedDraft);
        this.control<HTMLTextAreaElement>("imageParameters").value = JSON.stringify(rebasedDraft, null, 2);
      } catch {
        // Invalid draft: retain it completely untouched in the editor.
      }
      // Update the synced baseline to the new host save so the draft remains dirty.
      this.synced.set("imageParameters", JSON.stringify(nextForHost, null, 2));
      this.markDraft("imageParameters");
    } else {
      const formatted = JSON.stringify(nextForHost, null, 2);
      this.control<HTMLTextAreaElement>("imageParameters").value = formatted;
      this.synced.set("imageParameters", formatted);
      this.drafts.delete("imageParameters");
    }
    this.refreshStatus();

    return { imageParameters: nextForHost };
  }

  private applyNovelAiField(
    target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    params: Record<string, unknown>,
  ): { key: string; value: unknown } | null {
    switch (target.name) {
      case "novelAiSteps": {
        const val = clamp(Math.round(Number(target.value)), NOVELAI_STEPS_MIN, NOVELAI_STEPS_MAX, NOVELAI_DEFAULT_STEPS);
        params.steps = val;
        return { key: "steps", value: val };
      }
      case "novelAiGuidance": {
        const val = clamp(Number(target.value), NOVELAI_GUIDANCE_MIN, NOVELAI_GUIDANCE_MAX, NOVELAI_DEFAULT_GUIDANCE);
        params.guidance = val;
        return { key: "guidance", value: val };
      }
      case "novelAiSampler": {
        const val = target.value.trim() || NOVELAI_DEFAULT_SAMPLER;
        params.sampler = val;
        return { key: "sampler", value: val };
      }
      case "novelAiSeed": {
        // Empty means random. Send an explicit null: the host merges Cue's
        // parameters over the connection defaults, and Lumiverse stores -1 for
        // "shuffle", which NovelAI rejects. null makes the provider pick a seed.
        const val = parseNovelAiSeed(target.value);
        params.seed = val;
        return { key: "seed", value: val };
      }
      case "novelAiResolutionPreset": {
        if (target.value === "custom") {
          this.showCustom("novelAiDimensions", true);
          if (!params.resolution) {
            const w = snapDimension(Number(this.control<HTMLInputElement>("novelAiWidth").value), 1216);
            const h = snapDimension(Number(this.control<HTMLInputElement>("novelAiHeight").value), 832);
            params.resolution = `${w}x${h}`;
            return { key: "resolution", value: params.resolution };
          }
          return { key: "resolution", value: params.resolution };
        } else {
          this.showCustomQuiet("novelAiDimensions", false);
          const preset = NOVELAI_RESOLUTION_PRESETS.find((p) => p.id === target.value);
          if (preset) {
            params.resolution = preset.resolution;
            this.control<HTMLInputElement>("novelAiWidth").value = String(preset.width);
            this.control<HTMLInputElement>("novelAiHeight").value = String(preset.height);
            return { key: "resolution", value: preset.resolution };
          }
          return null;
        }
      }
      case "novelAiWidth":
      case "novelAiHeight": {
        const w = snapDimension(Number(this.control<HTMLInputElement>("novelAiWidth").value), 1216);
        const h = snapDimension(Number(this.control<HTMLInputElement>("novelAiHeight").value), 832);
        params.resolution = `${w}x${h}`;
        this.control<HTMLInputElement>("novelAiWidth").value = String(w);
        this.control<HTMLInputElement>("novelAiHeight").value = String(h);
        return { key: "resolution", value: params.resolution };
      }
      default:
        return null;
    }
  }

  private syncNovelAiControls(config: VisualNovelConfig, source: ImageSource): void {
    const container = this.root.querySelector<HTMLElement>("[data-novelai-controls]");
    if (!container) return;
    const effective = effectiveImageConnection(this.connectionStates.image, config.imageConnectionId);
    const isNovelAi = source === "generated" && isNovelAiConnection(effective);
    const promptControls = this.root.querySelector<HTMLElement>("[data-novelai-prompt-controls]");
    if (promptControls) promptControls.hidden = !isNovelAi;
    container.hidden = !isNovelAi;
    if (!isNovelAi) return;

    const params = readNovelAiParameters(config.imageParameters);
    this.control<HTMLInputElement>("novelAiSteps").value = String(params.steps);
    this.control<HTMLInputElement>("novelAiGuidance").value = String(params.guidance);

    const samplerSelect = this.control<HTMLSelectElement>("novelAiSampler");
    const samplerOptions = buildNovelAiSamplerOptions(params.sampler);
    samplerSelect.replaceChildren(...samplerOptions.map((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      return option;
    }));
    samplerSelect.value = params.sampler;
    this.control<HTMLInputElement>("novelAiSeed").value = params.seed === null ? "" : String(params.seed);

    this.setRadio("novelAiResolutionPreset", params.preset);
    this.showCustomQuiet("novelAiDimensions", params.preset === "custom");
    this.control<HTMLInputElement>("novelAiWidth").value = String(params.width);
    this.control<HTMLInputElement>("novelAiHeight").value = String(params.height);
  }

  private showCustom(name: string, visible: boolean): void {
    const field = this.root.querySelector<HTMLElement>(`[data-custom="${name}"]`);
    if (!field) return;
    field.hidden = !visible;
    if (visible) this.control<HTMLInputElement>(name).focus();
  }

  private save(patch: Partial<VisualNovelConfig>, savedMessage = "Saved"): void {
    try {
      this.options.onSave(patch);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    this.setStatus("Saving…", "saving");
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.pendingSavedMessage = savedMessage;
    // Hosts that do not acknowledge saves still get an honest status line.
    this.saveTimer = setTimeout(() => {
      if (this.status.dataset.kind === "saving") this.setStatus("Sent to Lumiverse. Waiting for confirmation…", "saving");
    }, 5000);
  }

  private pendingSavedMessage = "Saved";
  private pendingEverydayFields: Record<string, unknown> = {};

  /** Host acknowledgement of the last save. Optional: older hosts never call it. */
  setSaveStatus(status: SaveStatus): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (status.kind === "saved") {
      if (Object.keys(this.pendingEverydayFields).length > 0) {
        // In-flight edits still pending later echo: keep honest saving status
        this.setStatus("Saving…", "saving");
      } else {
        this.setStatus(this.pendingSavedMessage, "saved", 3000);
      }
    } else {
      // Save error: clear pending fields so rejected edits never become phantom state
      this.pendingEverydayFields = {};
      this.setStatus(`Could not save: ${status.error}`, "error");
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Advanced (draft + Apply)                                                */
  /* ---------------------------------------------------------------------- */

  private markDraft(name: AdvancedKey): void {
    // A control that reads exactly what the host last gave us is not a draft. This also
    // absorbs the blur-time change event browsers fire after a programmatic value sync.
    if (this.advancedValue(name) === this.synced.get(name)) this.drafts.delete(name);
    else this.drafts.add(name);
    this.refreshStatus();
  }

  /** Last value written by a host sync, per Advanced control, in the control's own string form. */
  private readonly synced = new Map<AdvancedKey, string>();

  private advancedValue(name: AdvancedKey): string {
    const element = this.control<HTMLInputElement | HTMLTextAreaElement>(name);
    return element instanceof HTMLInputElement && element.type === "checkbox" ? String(element.checked) : element.value;
  }

  private refreshStatus(): void {
    const dirty = this.drafts.size > 0;
    const bar = this.root.querySelector<HTMLElement>("[data-draft-bar]")!;
    bar.hidden = !dirty;
    this.root.querySelector<HTMLElement>("[data-draft-count]")!.textContent =
      `${this.drafts.size} change${this.drafts.size === 1 ? "" : "s"} not applied yet`;
    // Mark each changed field, and count changes per section for the nav badges.
    const perSection = new Map<string, number>();
    for (const name of ADVANCED_KEYS) {
      const element = this.root.querySelector<HTMLElement>(`[name="${name}"]`);
      const field = element?.closest<HTMLElement>("[data-field], label[data-check], fieldset") ?? null;
      const changed = this.drafts.has(name);
      field?.toggleAttribute("data-dirty", changed);
      if (changed && element) {
        const section = element.closest<HTMLElement>("[data-pane]")?.dataset.pane ?? "advanced";
        perSection.set(section, (perSection.get(section) ?? 0) + 1);
      }
    }
    for (const tab of this.root.querySelectorAll<HTMLElement>("[data-tab]")) {
      const badge = tab.querySelector<HTMLElement>("[data-tab-badge]")!;
      const count = perSection.get(tab.dataset.tab!) ?? 0;
      badge.hidden = count === 0;
      badge.textContent = String(count);
      badge.setAttribute("aria-label", `${count} unapplied`);
    }
    if (dirty) this.setStatus("Advanced changes are not applied yet.", "dirty");
    else if (this.status.dataset.kind === "dirty") this.setStatus("", "idle");
  }

  private applyAdvanced(): void {
    if (this.drafts.size === 0) {
      this.setStatus("Nothing to apply. Everyday settings save on their own.", "saved", 3000);
      return;
    }
    let patch: Partial<VisualNovelConfig>;
    try {
      patch = this.readAdvanced();
    } catch (error) {
      // Show the field that failed, wherever the user is.
      for (const [name, label] of [["parserParameters", "Story reader parameters"], ["imageParameters", "Image parameters"]] as const) {
        try { jsonObject(this.control<HTMLTextAreaElement>(name).value, label); }
        catch { this.reveal(this.control<HTMLTextAreaElement>(name)); break; }
      }
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    this.pendingEverydayFields = {};
    this.config = { ...this.config, ...patch };
    this.drafts.clear();
    this.refreshStatus();
    this.save(patch, "Advanced settings applied.");
  }

  private discardAdvanced(): void {
    const count = this.drafts.size;
    this.drafts.clear();
    this.syncFromConfig(this.config);
    this.refreshStatus();
    if (count > 0) this.setStatus(`Discarded ${count} change${count === 1 ? "" : "s"}.`, "saved", 3000);
  }

  private readAdvanced(): Partial<VisualNovelConfig> {
    return {
      imageModel: this.control<HTMLInputElement>("imageModel").value.trim(),
      imageConcurrency: clamp(Math.round(Number(this.control<HTMLInputElement>("imageConcurrency").value)), 1, 6, DEFAULT_CONFIG.imageConcurrency),
      parserParameters: jsonObject(this.control<HTMLTextAreaElement>("parserParameters").value, "Story reader parameters"),
      systemOneMode: this.control<HTMLSelectElement>("systemOneMode").value as VisualNovelConfig["systemOneMode"],
      systemOneApiUrl: this.control<HTMLInputElement>("systemOneApiUrl").value.trim() || DEFAULT_CONFIG.systemOneApiUrl,
      systemOneModel: this.control<HTMLInputElement>("systemOneModel").value.trim() || DEFAULT_CONFIG.systemOneModel,
      imageParameters: jsonObject(this.control<HTMLTextAreaElement>("imageParameters").value, "Image parameters"),
      audioDirectory: this.control<HTMLInputElement>("audioDirectory").value.trim(),
      includeRecentMessages: clamp(Math.round(Number(this.control<HTMLInputElement>("includeRecentMessages").value)), 0, 30, DEFAULT_CONFIG.includeRecentMessages),
      includeCharacterContext: this.control<HTMLInputElement>("includeCharacterContext").checked,
      includePersonaContext: this.control<HTMLInputElement>("includePersonaContext").checked,
      includeLorebookContext: this.control<HTMLInputElement>("includeLorebookContext").checked,
      debugLogging: this.control<HTMLInputElement>("debugLogging").checked,
      promptPrefix: this.control<HTMLInputElement>("promptPrefix").value,
      promptSuffix: this.control<HTMLInputElement>("promptSuffix").value,
      negativePrompt: this.control<HTMLInputElement>("negativePrompt").value,
      novelAiQualityTags: this.control<HTMLInputElement>("novelAiQualityTags").checked,
      novelAiUseDefaultNegative: this.control<HTMLInputElement>("novelAiUseDefaultNegative").checked,
      originalReference: this.control<HTMLInputElement>("originalReference").checked,
      originalCreationName: this.control<HTMLInputElement>("originalCreationName").value.trim(),
      customPlannerInstructions: this.control<HTMLTextAreaElement>("customPlannerInstructions").value,
      ignoredTags: this.control<HTMLInputElement>("ignoredTags").value,
      displayRegexRules: this.control<HTMLTextAreaElement>("displayRegexRules").value,
      customCss: this.control<HTMLTextAreaElement>("customCss").value,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Sync from config                                                        */
  /* ---------------------------------------------------------------------- */

  /** Host-driven update. Advanced controls with unapplied drafts keep their draft text. */
  setConfig(config: VisualNovelConfig): void {
    const incoming = config.imageParameters ?? {};
    for (const [k, v] of Object.entries(this.pendingEverydayFields)) {
      if (incoming[k] === v) {
        delete this.pendingEverydayFields[k];
      }
    }
    if (Object.keys(this.pendingEverydayFields).length > 0) {
      this.config = {
        ...config,
        imageParameters: { ...incoming, ...this.pendingEverydayFields },
      };
    } else {
      this.config = config;
      if (this.status.dataset.kind === "saving") {
        this.setStatus(this.pendingSavedMessage, "saved", 3000);
      }
    }
    this.syncFromConfig(this.config);
  }

  private syncFromConfig(config: VisualNovelConfig): void {
    this.syncEveryday(config);
    const set = (name: AdvancedKey, apply: () => void) => {
      if (this.drafts.has(name)) return;
      apply();
      this.synced.set(name, this.advancedValue(name));
    };
    set("imageModel", () => { this.control<HTMLInputElement>("imageModel").value = config.imageModel; });
    set("imageConcurrency", () => { this.control<HTMLInputElement>("imageConcurrency").value = String(config.imageConcurrency); });
    set("parserParameters", () => { this.control<HTMLTextAreaElement>("parserParameters").value = JSON.stringify(config.parserParameters, null, 2); });
    set("systemOneMode", () => { this.control<HTMLSelectElement>("systemOneMode").value = config.systemOneMode; });
    set("systemOneApiUrl", () => { this.control<HTMLInputElement>("systemOneApiUrl").value = config.systemOneApiUrl; });
    set("systemOneModel", () => { this.control<HTMLInputElement>("systemOneModel").value = config.systemOneModel; });
    set("imageParameters", () => { this.control<HTMLTextAreaElement>("imageParameters").value = JSON.stringify(config.imageParameters, null, 2); });
    set("audioDirectory", () => { this.control<HTMLInputElement>("audioDirectory").value = config.audioDirectory; });
    set("includeRecentMessages", () => { this.control<HTMLInputElement>("includeRecentMessages").value = String(config.includeRecentMessages); });
    set("includeCharacterContext", () => { this.control<HTMLInputElement>("includeCharacterContext").checked = config.includeCharacterContext; });
    set("includePersonaContext", () => { this.control<HTMLInputElement>("includePersonaContext").checked = config.includePersonaContext; });
    set("includeLorebookContext", () => { this.control<HTMLInputElement>("includeLorebookContext").checked = config.includeLorebookContext; });
    set("debugLogging", () => { this.control<HTMLInputElement>("debugLogging").checked = config.debugLogging; });
    set("promptPrefix", () => { this.control<HTMLInputElement>("promptPrefix").value = config.promptPrefix; });
    set("promptSuffix", () => { this.control<HTMLInputElement>("promptSuffix").value = config.promptSuffix; });
    set("negativePrompt", () => { this.control<HTMLInputElement>("negativePrompt").value = config.negativePrompt; });
    set("novelAiQualityTags", () => { this.control<HTMLInputElement>("novelAiQualityTags").checked = config.novelAiQualityTags; });
    set("novelAiUseDefaultNegative", () => { this.control<HTMLInputElement>("novelAiUseDefaultNegative").checked = config.novelAiUseDefaultNegative; });
    set("originalReference", () => { this.control<HTMLInputElement>("originalReference").checked = config.originalReference; });
    set("originalCreationName", () => { this.control<HTMLInputElement>("originalCreationName").value = config.originalCreationName; });
    set("customPlannerInstructions", () => { this.control<HTMLTextAreaElement>("customPlannerInstructions").value = config.customPlannerInstructions; });
    set("ignoredTags", () => { this.control<HTMLInputElement>("ignoredTags").value = config.ignoredTags; });
    set("displayRegexRules", () => { this.control<HTMLTextAreaElement>("displayRegexRules").value = config.displayRegexRules; });
    set("customCss", () => { this.control<HTMLTextAreaElement>("customCss").value = config.customCss; });
    this.promptPresets = config.promptPresets.map((preset) => ({ ...preset }));
    this.renderPromptPresetOptions(this.control<HTMLSelectElement>("promptPresetSelect").value);
    this.updateImageModelHint();
  }

  private syncEveryday(config: VisualNovelConfig): void {
    this.control<HTMLSelectElement>("mode").value = config.mode;
    this.control<HTMLSelectElement>("skipMode").value = config.skipMode;
    this.control<HTMLInputElement>("generateChoices").checked = config.generateChoices;
    this.control<HTMLInputElement>("autoEnter").checked = config.autoEnter;
    this.control<HTMLInputElement>("referenceAnchoring").checked = config.referenceAnchoring;
    this.setRadio("referenceSource", config.referenceSource);
    this.root.querySelector<HTMLElement>("[data-reference-source]")!.hidden = !config.referenceAnchoring;

    const speedStep = namedStepFor(TEXT_SPEED_STEPS, config.textSpeed);
    this.setRadio("textSpeedStep", speedStep ? String(speedStep.value) : "custom");
    this.control<HTMLInputElement>("textSpeed").value = String(config.textSpeed);
    this.showCustomQuiet("textSpeed", !speedStep);

    const pauseStep = namedStepFor(AUTO_PLAY_STEPS, config.autoPlayDelay);
    this.setRadio("autoPlayStep", pauseStep ? String(pauseStep.value) : "custom");
    this.control<HTMLInputElement>("autoPlayDelay").value = String(config.autoPlayDelay);
    this.showCustomQuiet("autoPlayDelay", !pauseStep);

    this.setRadio("themePreset", config.themePreset);
    this.setRadio("setupThemePreset", config.themePreset);
    this.setRadio("sceneImageFit", config.sceneImageFit);
    this.setRadio("effectIntensity", config.effectIntensity);
    this.setRadio("textEffects", config.textEffects);
    this.syncTextEffectMode(config);
    const scaleStep = namedStepFor(TEXT_SCALE_STEPS, config.textScale);
    this.setRadio("textScaleStep", scaleStep ? String(scaleStep.value) : "custom");
    this.control<HTMLInputElement>("textScale").value = String(config.textScale);
    this.showCustomQuiet("textScale", !scaleStep);

    const source = imageSourceFromConfig(config);
    this.setRadio("imageSource", source);
    this.setRadio("setupImageSource", source);
    this.root.querySelector<HTMLElement>("[data-generated-only]")!.hidden = source !== "generated";
    this.root.querySelector<HTMLElement>("[data-setup-image-connection]")!.hidden = source !== "generated";

    const budget = budgetPresetFor(config.maxImagesPerTurn);
    this.setRadio("budgetPreset", budget);
    this.control<HTMLInputElement>("maxImagesPerTurn").value = String(config.maxImagesPerTurn);
    this.showCustomQuiet("maxImagesPerTurn", budget === "custom");
    this.root.querySelector<HTMLElement>("[data-budget-help]")!.textContent = config.systemOneMode === "on" && !config.useNativeCardImages
      ? `${config.maxImagesPerTurn > 0 ? `Up to ${config.maxImagesPerTurn} new pictures per reply.` : "No limit on new pictures."} With confident System One expressions, cached pictures can appear on additional paragraphs without using this allowance.`
      : describeBudget(config.maxImagesPerTurn);

    this.control<HTMLInputElement>("bgmVolume").value = String(config.bgmVolume);
    this.control<HTMLInputElement>("sfxVolume").value = String(config.sfxVolume);
    this.updateVolumeLabels();

    this.renderConnectionSelects("planner", config.parserConnectionId);
    this.renderConnectionSelects("image", config.imageConnectionId);
    this.syncNovelAiControls(config, source);
    this.updateSummaries(config);
    this.updateSample(config);
  }

  private showCustomQuiet(name: string, visible: boolean): void {
    const field = this.root.querySelector<HTMLElement>(`[data-custom="${name}"]`);
    if (field) field.hidden = !visible;
  }

  private updateVolumeLabels(): void {
    const bgm = this.control<HTMLInputElement>("bgmVolume");
    const sfx = this.control<HTMLInputElement>("sfxVolume");
    this.root.querySelector("[data-bgm-val]")!.textContent = `${Math.round(Number(bgm.value) * 100)}%`;
    this.root.querySelector("[data-sfx-val]")!.textContent = `${Math.round(Number(sfx.value) * 100)}%`;
  }

  private updateSummaries(config: VisualNovelConfig): void {
    const summary = (section: SettingsSectionId, text: string) => {
      const element = this.root.querySelector<HTMLElement>(`[data-tab="${section}"] [data-tab-summary]`);
      if (element) element.textContent = text;
    };
    summary("reading", `${describeTextSpeed(config.textSpeed)} · ${config.mode === "cyoa" ? "Choices" : "Write your own"}`);
    summary("look", `${THEME_PRESET_LABELS[config.themePreset].replace(/ \(.*\)$/, "")} · ${describeTextScale(config.textScale)} text`);
    const source = imageSourceFromConfig(config);
    const sourceLabel = IMAGE_SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source;
    const budget = budgetPresetFor(config.maxImagesPerTurn);
    const budgetLabel = budget === "custom" ? (config.maxImagesPerTurn === 0 ? "No limit" : `${config.maxImagesPerTurn} per reply`) : BUDGET_PRESETS.find((preset) => preset.id === budget)!.label;
    summary("pictures", source === "generated" ? `Generated · ${budgetLabel}` : sourceLabel);
    const library = this.audioLibrary ? `${this.audioLibrary.bgmCount} track${this.audioLibrary.bgmCount === 1 ? "" : "s"}` : "No music yet";
    summary("sound", `${library} · ${Math.round(config.bgmVolume * 100)}%`);
    summary("voice", config.speech?.enabled ? "On" : "Off");
    summary("advanced", "Applies with Apply");
  }

  /* ---------------------------------------------------------------------- */
  /* Live sample                                                             */
  /* ---------------------------------------------------------------------- */

  private updateSample(config: VisualNovelConfig): void {
    const stage = this.root.querySelector<HTMLElement>("[data-sample-stage]")!;
    const tokens = themePreviewTokens(config.themePreset);
    stage.style.setProperty("--sample-accent", tokens.accent);
    stage.style.setProperty("--sample-text", tokens.text);
    stage.style.setProperty("--sample-muted", tokens.mutedText);
    stage.style.setProperty("--sample-bg", tokens.dialogueBg);
    stage.style.setProperty("--sample-border", tokens.dialogueBorder);
    stage.style.setProperty("--sample-font", tokens.fontFamily);
    stage.style.setProperty("--sample-fit", config.sceneImageFit);
    stage.style.setProperty("--sample-scale", String(config.textScale));
    this.root.querySelector<HTMLElement>("[data-sample]")!.dataset.effects = config.effectIntensity;
    stage.dataset.preset = config.themePreset;
    const picture = this.root.querySelector<HTMLElement>("[data-sample-picture]")!;
    picture.hidden = imageSourceFromConfig(config) === "text";
    this.restartSample();
  }

  private restartSample(): void {
    if (this.sampleTimer) { clearTimeout(this.sampleTimer); this.sampleTimer = null; }
    const stage = this.root.querySelector<HTMLElement>("[data-sample-stage]")!;
    const text = this.root.querySelector<HTMLElement>("[data-sample-words]")!;
    const speaker = this.root.querySelector<HTMLElement>("[data-sample-speaker]")!;
    const next = this.root.querySelector<HTMLElement>("[data-sample-next]")!;
    const line = SAMPLE_LINES[this.sampleLine % SAMPLE_LINES.length]!;
    speaker.textContent = line.speaker;
    next.textContent = "";
    // No typing loop while the sample sits in a hidden section.
    const visible = Boolean(this.root.querySelector(`[data-pane="${this.section}"] [data-sample]`));
    const reduced = !visible || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
    const perChar = reduced ? 0 : clamp(Number(this.control<HTMLInputElement>("textSpeed").value), 0, 100, this.config.textSpeed);
    const pause = clamp(Number(this.control<HTMLInputElement>("autoPlayDelay").value), 500, 10000, this.config.autoPlayDelay);
    let shown = perChar === 0 ? line.text.length : 0;
    const tick = () => {
      text.textContent = line.text.slice(0, shown);
      if (shown < line.text.length) {
        stage.setAttribute("data-typing", "");
        shown += 1;
        this.sampleTimer = setTimeout(tick, perChar);
        return;
      }
      stage.removeAttribute("data-typing");
      next.textContent = `next line in ${(pause / 1000).toFixed(1).replace(/\.0$/, "")} s`;
      this.sampleTimer = setTimeout(() => {
        this.sampleLine = (this.sampleLine + 1) % SAMPLE_LINES.length;
        // Only two lines: after the second, hold instead of looping forever.
        if (this.sampleLine === 0) { next.textContent = ""; return; }
        this.restartSample();
      }, pause);
    };
    tick();
  }

  /* ---------------------------------------------------------------------- */
  /* Connections                                                             */
  /* ---------------------------------------------------------------------- */

  setConnectionCatalog(kind: ConnectionCatalogKind, state: ConnectionCatalogState): void {
    this.connectionStates[kind] = state;
    this.renderConnectionSelects(kind, kind === "planner" ? this.config.parserConnectionId
        : this.config.imageConnectionId);
    if (kind === "image") {
      this.updateImageModelHint();
      this.syncNovelAiControls(this.config, imageSourceFromConfig(this.config));
    }
  }

  setSystemOneKeyStatus(saved: boolean, message?: string): void {
    const status = this.root.querySelector<HTMLElement>("[data-system-one-key-status]");
    if (status) status.textContent = message ?? (saved ? "API key saved." : "No API key saved.");
  }

  private renderConnectionSelects(kind: ConnectionCatalogKind, selectedId: string | null): void {
    const state = this.connectionStates[kind];
    const options = buildConnectionSelectOptions(state.options, selectedId);
    for (const select of this.root.querySelectorAll<HTMLSelectElement>(`select[data-connection-select="${kind}"]`)) {
      select.replaceChildren(...options.map((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.label;
        if (item.missing) option.dataset.missing = "true";
        return option;
      }));
      select.value = selectedId ?? "";
    }
    const readiness = connectionReadiness(kind, state, selectedId);
    for (const row of this.root.querySelectorAll<HTMLElement>(`[data-readiness="${kind}"]`)) {
      row.dataset.level = readiness.level;
      row.querySelector("[data-readiness-title]")!.textContent = readiness.title;
      const action = row.querySelector<HTMLElement>("[data-readiness-action]")!;
      action.textContent = readiness.action ?? "";
      action.hidden = !readiness.action;
      row.querySelector<HTMLElement>("[data-actions]")!.hidden = readiness.fix !== "refresh";
    }
    if (kind === "planner") {
      const dot = this.root.querySelector<HTMLElement>('[data-tab="connections"] [data-tab-dot]');
      if (dot) dot.dataset.level = readiness.level;
      const summary = this.root.querySelector<HTMLElement>('[data-tab="connections"] [data-tab-summary]');
      if (summary) summary.textContent = { ready: "Story reader ready", loading: "Checking…", attention: "Needs a look", blocked: "Needs attention" }[readiness.level];
    }
  }

  private updateImageModelHint(): void {
    const selected = this.connectionStates.image.options.find((option) => option.id === this.config.imageConnectionId);
    const modelInput = this.control<HTMLInputElement>("imageModel");
    const hint = this.root.querySelector<HTMLElement>("[data-image-model-hint]")!;
    if (selected?.model) {
      modelInput.placeholder = selected.model;
      hint.textContent = `Leave blank to use ${selected.model} from ${selected.name}.`;
    } else {
      modelInput.placeholder = "Use the selected connection model";
      hint.textContent = "Leave blank to use the model configured on the selected image connection.";
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Sound                                                                   */
  /* ---------------------------------------------------------------------- */

  setAudioStatus(message: string): void {
    const status = this.root.querySelector<HTMLElement>("[data-audio-status]");
    if (status) status.textContent = message;
    // Hosts that only report text still drive the empty state.
    const scanned = /(\d+)\s*BGM,\s*(\d+)\s*SFX/i.exec(message);
    if (scanned) this.setAudioLibrary({ bgmCount: Number(scanned[1]), sfxCount: Number(scanned[2]) });
  }

  setAudioLibrary(library: { bgmCount: number; sfxCount: number }): void {
    this.audioLibrary = library;
    const empty = library.bgmCount === 0 && library.sfxCount === 0;
    this.root.querySelector<HTMLElement>("[data-sound-empty]")!.hidden = !empty;
    this.root.querySelector<HTMLElement>("[data-sound-ready]")!.hidden = empty;
    const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
    this.root.querySelector<HTMLElement>("[data-sound-counts]")!.textContent = `${plural(library.bgmCount, "music track")} and ${plural(library.sfxCount, "sound effect")} ready.`;
    this.updateSummaries(this.config);
  }

  /* ---------------------------------------------------------------------- */
  /* Setup guide                                                             */
  /* ---------------------------------------------------------------------- */

  private setupDone(): boolean {
    try { return this.storage?.getItem(SETUP_DONE_KEY) === "1"; } catch { return false; }
  }

  private setSetupDone(done: boolean): void {
    try {
      if (done) this.storage?.setItem(SETUP_DONE_KEY, "1");
      else this.storage?.removeItem(SETUP_DONE_KEY);
    } catch { /* storage is optional */ }
    this.sessionSetupHidden = done;
    this.renderSetupVisibility();
  }

  private sessionSetupHidden = false;

  private renderSetupVisibility(): void {
    const card = this.root.querySelector<HTMLElement>("[data-setup]")!;
    card.hidden = this.sessionSetupHidden || this.setupDone();
    this.root.querySelector<HTMLElement>("[data-show-setup]")!.hidden = !card.hidden;
  }

  /* ---------------------------------------------------------------------- */
  /* Status and lifecycle                                                    */
  /* ---------------------------------------------------------------------- */

  private setStatus(text: string, kind: StatusKind, clearAfterMs?: number): void {
    if (this.statusTimer) { clearTimeout(this.statusTimer); this.statusTimer = null; }
    this.status.textContent = text;
    this.status.dataset.kind = kind;
    if (clearAfterMs) {
      this.statusTimer = setTimeout(() => {
        if (this.status.dataset.kind !== kind) return;
        if (this.drafts.size > 0) this.setStatus("Advanced changes are not applied yet.", "dirty");
        else this.setStatus("", "idle");
      }, clearAfterMs);
    }
  }

  private renderPromptPresetOptions(selectedId: string): void {
    const select = this.control<HTMLSelectElement>("promptPresetSelect");
    const options = [
      { value: "", label: "Custom (no preset)" },
      ...this.promptPresets.map((preset) => ({ value: preset.id, label: preset.name })),
    ];
    select.replaceChildren(...options.map((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      return option;
    }));
    select.value = this.promptPresets.some((preset) => preset.id === selectedId) ? selectedId : "";
  }

  destroy(): void {
    for (const timer of [this.statusTimer, this.resetTimer, this.saveTimer, this.sampleTimer, this.flashTimer, this.copyTimer]) if (timer) clearTimeout(timer);
    this.resizeObserver?.disconnect();
    this.host.remove();
  }
}

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}
