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
  normalizeSceneImageFit,
  normalizeThemePreset,
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
  NOVELAI_STEPS_MAX,
  NOVELAI_STEPS_MIN,
  type ConnectionCatalogKind,
  type ConnectionCatalogState,
  type ImageSource,
  type SetupFlagStorage,
} from "./model.js";

export {
  THEME_PRESET_LABELS,
  THEME_PRESET_OPTIONS,
  buildConnectionSelectOptions,
  connectionOptionLabel,
  type ConnectionCatalogKind,
  type ConnectionCatalogState,
  type ConnectionOption,
  type ConnectionSelectOption,
} from "./model.js";

export type SaveStatus = { kind: "saved" } | { kind: "error"; error: string };

export type SettingsPanelOptions = {
  mount: HTMLElement;
  /** Receives partial patches. Everyday controls call this on every change; Advanced calls it on Apply. */
  onSave: (patch: Partial<VisualNovelConfig>) => void;
  onOpenPreview: () => void;
  onRefreshConnections: () => void;
  onScanAudio?: (directory: string) => Promise<{ bgmCount: number; sfxCount: number } | void> | void;
  /** Import user-picked audio files into the extension's scoped storage. */
  onImportAudio?: (files: readonly File[]) => Promise<void> | void;
  /** Where the "setup guide done" flag lives. Defaults to localStorage when available. */
  setupStorage?: SetupFlagStorage | null;
};

/** Keys the Advanced section owns. Everything else saves as soon as it changes. */
const ADVANCED_KEYS = [
  "imageModel", "imageConcurrency", "parserParameters", "imageParameters", "audioDirectory",
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

const PANEL_CSS = `
:host { display: block; color: var(--lumiverse-text, #f5f5f7); font: 15px/1.5 var(--lumiverse-font-family, system-ui, sans-serif); }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
[data-shell] { display: grid; gap: .9rem; max-width: 54rem; padding: 1rem 1rem 0; }
p, h2, h3 { margin: 0; }
h2 { font-size: 1.05rem; font-weight: 650; }
h3 { font-size: .95rem; font-weight: 650; }
.muted { color: var(--lumiverse-text-muted, rgba(255,255,255,.68)); }
small, .help { display: block; font-size: .85rem; font-weight: 400; color: var(--lumiverse-text-muted, rgba(255,255,255,.68)); }
button, input, select, textarea { font: inherit; }
button { min-height: 2.75rem; padding: .55rem 1.1rem; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.24)); border-radius: 999px; background: var(--lumiverse-fill-medium, rgba(255,255,255,.1)); color: inherit; cursor: pointer; }
button[data-primary] { border-color: var(--lumiverse-primary, #a986ff); background: var(--lumiverse-primary, #a986ff); color: var(--lumiverse-primary-contrast, #121018); font-weight: 650; }
button[data-quiet] { background: transparent; }
button:disabled { opacity: .55; cursor: default; }
button[data-reset][data-confirming] { border-color: var(--lumiverse-danger, #ff8ca0); color: var(--lumiverse-danger, #ff8ca0); background: transparent; }
:is(button, summary, select, input, textarea, [data-tile]):focus-visible, label:has(> input:focus-visible) { outline: 2px solid var(--lumiverse-primary, #a986ff); outline-offset: 3px; }
input[type="text"], input[type="number"], select, textarea { width: 100%; min-height: 2.75rem; padding: .6rem .75rem; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.2)); border-radius: .6rem; background: var(--lumiverse-bg-elevated, #171822); color: inherit; }
textarea { min-height: 9rem; resize: vertical; font-family: var(--lumiverse-font-mono, ui-monospace, monospace); font-size: .82rem; }
input[type="range"] { width: 100%; height: 2.75rem; margin: 0; accent-color: var(--lumiverse-primary, #a986ff); cursor: pointer; }
input[type="checkbox"], input[type="radio"] { width: 1.25rem; height: 1.25rem; margin: 0; accent-color: var(--lumiverse-primary, #a986ff); }

[data-novelai-controls] { display: grid; gap: .9rem; margin-top: .75rem; padding: .85rem; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.14)); border-radius: .7rem; background: var(--lumiverse-fill-subtle, rgba(255,255,255,.03)); }
[data-novelai-controls] a { color: var(--lumiverse-primary, #a986ff); text-decoration: underline; text-underline-offset: 2px; }

/* Cards and sections */
[data-card] { border: 1px solid var(--lumiverse-border, rgba(255,255,255,.16)); border-radius: .9rem; background: var(--lumiverse-card-bg, rgba(255,255,255,.035)); }
details[data-section] > summary { list-style: none; display: flex; align-items: center; gap: .6rem; min-height: 3.25rem; padding: .7rem 1rem; cursor: pointer; user-select: none; border-radius: .9rem; }
details[data-section] > summary::-webkit-details-marker { display: none; }
details[data-section] > summary::before { content: ""; width: .45rem; height: .45rem; border-right: 2px solid var(--lumiverse-primary, #a986ff); border-bottom: 2px solid var(--lumiverse-primary, #a986ff); transform: rotate(-45deg); flex: none; }
details[data-section][open] > summary::before { transform: rotate(45deg); }
details[data-section] > summary:hover { background: var(--lumiverse-fill-medium, rgba(255,255,255,.06)); }
details[data-section] > summary h2 { flex: 1; }
details[data-section] > summary [data-summary] { font-size: .85rem; text-align: right; color: var(--lumiverse-text-muted, rgba(255,255,255,.68)); }
[data-section-body] { display: grid; gap: 1rem; padding: .25rem 1rem 1.1rem; }
[data-subsection] { border-color: var(--lumiverse-border, rgba(255,255,255,.1)); }
[data-subsection] > summary { min-height: 2.75rem; }
[data-subsection] > summary h3 { flex: 1; }
[data-field] { display: grid; gap: .4rem; }
[data-field] > span:first-child, legend { font-weight: 600; }
fieldset { margin: 0; padding: 0; border: 0; min-width: 0; display: grid; gap: .45rem; }
legend { padding: 0; margin-bottom: .4rem; }
label[data-check] { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: .7rem; min-height: 2.75rem; padding: .55rem .25rem; font-weight: 500; }
label[data-check] input { margin-top: .15rem; }
[data-row] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .9rem; }
[data-actions] { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }

/* Segmented choices (named steps) */
[data-segments] { display: flex; flex-wrap: wrap; gap: .4rem; }
[data-segments] label { position: relative; display: inline-flex; align-items: center; min-height: 2.75rem; padding: .45rem 1rem; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.2)); border-radius: 999px; cursor: pointer; background: var(--lumiverse-bg-elevated, #171822); }
[data-segments] label:has(input:checked) { border-color: var(--lumiverse-primary, #a986ff); background: color-mix(in srgb, var(--lumiverse-primary, #a986ff) 22%, transparent); font-weight: 600; }
[data-segments] input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
[data-segments] label:has(input:focus-visible) { outline: 2px solid var(--lumiverse-primary, #a986ff); outline-offset: 3px; }

/* Option lists (image source, fit) */
[data-options] { display: grid; gap: .45rem; }
[data-options] label { display: grid; grid-template-columns: auto 1fr; gap: .75rem; align-items: start; min-height: 2.75rem; padding: .7rem .85rem; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.14)); border-radius: .7rem; cursor: pointer; }
[data-options] label:has(input:checked) { border-color: var(--lumiverse-primary, #a986ff); background: color-mix(in srgb, var(--lumiverse-primary, #a986ff) 12%, transparent); }
[data-options] label input { margin-top: .15rem; }
[data-options] label b { display: block; font-weight: 600; }

/* Theme tiles */
[data-tiles] { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: .6rem; }
[data-tiles] label { position: relative; display: grid; gap: .45rem; padding: .5rem; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.14)); border-radius: .75rem; cursor: pointer; background: var(--lumiverse-bg-elevated, #171822); }
[data-tiles] label:has(input:checked) { border-color: var(--lumiverse-primary, #a986ff); box-shadow: 0 0 0 1px var(--lumiverse-primary, #a986ff); }
[data-tiles] label:has(input:focus-visible) { outline: 2px solid var(--lumiverse-primary, #a986ff); outline-offset: 3px; }
[data-tiles] input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }
[data-tiles] span { font-size: .85rem; font-weight: 600; text-align: center; }
[data-swatch] { display: grid; align-content: end; height: 3.6rem; padding: .35rem .45rem; border-radius: .5rem; background: #08090d; overflow: hidden; }
[data-swatch] i { display: block; height: 1.7rem; padding: .25rem .4rem; border-radius: .35rem; border: 1px solid var(--swatch-border); background: var(--swatch-bg); color: var(--swatch-text); font: 600 .62rem/1.2 var(--swatch-font); font-style: normal; white-space: nowrap; overflow: hidden; }
[data-swatch] i::before { content: "Mira"; display: block; color: var(--swatch-accent); font-size: .55rem; }

/* Setup guide */
[data-setup] { display: grid; gap: .9rem; padding: 1rem; border-color: color-mix(in srgb, var(--lumiverse-primary, #a986ff) 55%, transparent); }
[data-setup] header { display: flex; flex-wrap: wrap; gap: .3rem .8rem; align-items: baseline; }
[data-setup] ol { display: grid; gap: .9rem; margin: 0; padding: 0; list-style: none; counter-reset: step; }
[data-setup] li { display: grid; grid-template-columns: 2rem 1fr; gap: .7rem; }
[data-setup] li::before { counter-increment: step; content: counter(step); display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: 50%; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.24)); font-weight: 650; font-size: .9rem; }
[data-setup] li > div { display: grid; gap: .5rem; }
[data-setup] footer { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
[data-setup] footer small { flex: 1 1 14rem; }

/* Readiness rows */
[data-readiness] { display: grid; grid-template-columns: auto 1fr; gap: .6rem; align-items: start; padding: .55rem .7rem; border-radius: .6rem; background: var(--lumiverse-fill-medium, rgba(255,255,255,.06)); }
[data-readiness]::before { content: ""; width: .6rem; height: .6rem; margin-top: .45rem; border-radius: 50%; background: var(--lumiverse-text-muted, #999); }
[data-readiness][data-level="ready"]::before { background: var(--lumiverse-success, #8ce8b0); }
[data-readiness][data-level="attention"]::before { background: var(--lumiverse-warning, #ffd08a); }
[data-readiness][data-level="blocked"]::before { background: var(--lumiverse-danger, #ff8ca0); }
[data-readiness] b { font-weight: 600; }
[data-readiness] [data-actions] { margin-top: .3rem; }

/* Live sample */
[data-sample] { position: sticky; top: 0; z-index: 4; display: grid; gap: .4rem; padding: .6rem; background: var(--lumiverse-bg-elevated, #171822); }
[data-sample-stage] { position: relative; height: 9.5rem; border-radius: .6rem; overflow: hidden; background: radial-gradient(circle at 50% 35%, rgba(73,58,91,.55), transparent 48%), #08090d; font-family: var(--sample-font); color: var(--sample-text); }
[data-sample-picture] { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: var(--sample-fit, cover); }
[data-sample-dialogue] { position: absolute; left: .6rem; right: .6rem; bottom: .6rem; min-height: 4.2rem; padding: .5rem .8rem .6rem; border: 1px solid var(--sample-border); border-radius: .55rem; background: var(--sample-bg); font-size: calc(.88rem * var(--sample-scale, 1)); line-height: 1.4; }
[data-sample-speaker] { display: block; color: var(--sample-accent); font-weight: 700; font-size: .8em; letter-spacing: .02em; }
[data-sample-text] { margin: 0; min-height: 2.6em; }
[data-sample-caret] { display: inline-block; width: .5em; height: 1em; margin-left: .15em; vertical-align: -.15em; background: var(--sample-accent); opacity: 0; }
[data-sample-stage][data-typing] [data-sample-caret] { opacity: 1; }
[data-sample-next] { position: absolute; right: .8rem; bottom: .4rem; font-size: .7rem; color: var(--sample-muted); }
[data-sample-label] { display: flex; flex-wrap: wrap; gap: .4rem .8rem; align-items: center; font-size: .8rem; }
[data-sample-label] > .muted { flex: 1 1 12rem; }
[data-sample-label] button { min-height: 2rem; padding: .2rem .8rem; font-size: .8rem; }
[data-sample][data-effects="off"] [data-sample-picture] { filter: saturate(.85); }
[data-sample][data-effects="gentle"] [data-sample-picture] { filter: saturate(.95); }

/* Footer */
[data-actionbar] { position: sticky; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; margin: 0 -1rem; padding: .7rem 1rem; background: var(--lumiverse-bg-elevated, #171822); border-top: 1px solid var(--lumiverse-border, rgba(255,255,255,.16)); }
[data-status] { flex: 1 1 12rem; min-height: 1.5rem; font-size: .9rem; }
[data-status-echo] { margin-left: auto; font-size: .8rem; }
:is([data-status], [data-status-echo])[data-kind="saved"] { color: var(--lumiverse-success, #8ce8b0); }
:is([data-status], [data-status-echo])[data-kind="dirty"], :is([data-status], [data-status-echo])[data-kind="saving"] { color: var(--lumiverse-warning, #ffd08a); }
:is([data-status], [data-status-echo])[data-kind="error"] { color: var(--lumiverse-danger, #ff8ca0); }
/* Keep focused controls clear of the sticky sample and footer when the browser scrolls to them. */
input, select, textarea, button, summary { scroll-margin-top: 12rem; scroll-margin-bottom: 5rem; }
[data-preset-row] { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto auto; gap: .5rem; align-items: center; }
[data-preset-row] button { white-space: nowrap; }
[data-sound-empty] { display: grid; gap: .6rem; padding: 1rem; border: 1px dashed var(--lumiverse-border, rgba(255,255,255,.24)); border-radius: .75rem; text-align: center; justify-items: center; }
[data-sound-empty] p { font-weight: 600; }
[data-audio-status] { font-style: italic; }

@media (max-width: 620px) {
  [data-shell] { padding: .65rem .65rem 0; }
  [data-row], [data-preset-row] { grid-template-columns: 1fr; }
  [data-actionbar] { margin: 0 -.65rem; padding: .6rem .65rem; }
  [data-sample] { position: static; }
  [data-sample-stage] { height: 8.5rem; }
  details[data-section] > summary [data-summary] { display: none; }
}
`;

type StatusKind = "idle" | "saved" | "saving" | "dirty" | "error";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function segments(name: string, steps: ReadonlyArray<{ label: string; value: number | string }>, withCustom: boolean): string {
  const items = steps.map((step) => `<label><input type="radio" name="${name}" value="${step.value}" />${esc(step.label)}</label>`);
  if (withCustom) items.push(`<label><input type="radio" name="${name}" value="custom" />Custom</label>`);
  return `<div data-segments role="radiogroup">${items.join("")}</div>`;
}

function imageSourceOptions(name: string): string {
  return `<div data-options>${IMAGE_SOURCE_OPTIONS.map((option) =>
    `<label><input type="radio" name="${name}" value="${option.value}" /><span><b>${esc(option.label)}</b><small>${esc(option.help)}</small></span></label>`).join("")}</div>`;
}

function themeTiles(name = "themePreset"): string {
  return `<div data-tiles role="radiogroup">${THEME_PRESET_OPTIONS.map(({ value, label }) => {
    const tokens = themePreviewTokens(value);
    const style = `--swatch-accent:${tokens.accent};--swatch-text:${tokens.text};--swatch-bg:${tokens.dialogueBg};--swatch-border:${tokens.dialogueBorder};--swatch-font:${tokens.fontFamily}`;
    return `<label><input type="radio" name="${name}" value="${value}" /><span data-swatch style="${esc(style)}"><i>The wind picks up…</i></span><span>${esc(label.replace(/ \(.*\)$/, ""))}</span></label>`;
  }).join("")}</div>`;
}

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
  private sampleLine = 0;
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
    this.wire();
    this.renderSetupVisibility();
    this.syncFromConfig(DEFAULT_CONFIG);
  }

  /* ---------------------------------------------------------------------- */
  /* Markup                                                                  */
  /* ---------------------------------------------------------------------- */

  private template(): string {
    return `
    <div data-shell>
      <section data-card data-setup aria-labelledby="setup-title" hidden>
        <header>
          <h2 id="setup-title">Get started</h2>
          <small>Three choices. Nothing is generated until you send a message.</small>
        </header>
        <ol>
          <li><div>
            <h3>Story reader</h3>
            <small>Cue reads each reply to pick speakers, moods and scenes. This does not replace your chat model.</small>
            <div data-readiness="planner" data-level="loading"><div><b data-readiness-title></b><small data-readiness-action></small><div data-actions hidden><button type="button" data-refresh-connections>Refresh</button></div></div></div>
            <label data-field><span>Connection</span><select name="setupParserConnectionId" data-connection-select="planner"><option value="">Lumiverse default</option></select></label>
          </div></li>
          <li><div>
            <h3>Pictures</h3>
            ${imageSourceOptions("setupImageSource")}
            <div data-setup-image-connection hidden>
              <div data-readiness="image" data-level="loading"><div><b data-readiness-title></b><small data-readiness-action></small><div data-actions hidden><button type="button" data-refresh-connections>Refresh</button></div></div></div>
              <label data-field><span>Image connection</span><select name="setupImageConnectionId" data-connection-select="image"><option value="">Lumiverse default</option></select></label>
            </div>
          </div></li>
          <li><div>
            <h3>Look</h3>
            <small>The sample below updates as you choose. Text size, effects and picture fit are under Appearance.</small>
            ${themeTiles("setupThemePreset")}
          </div></li>
        </ol>
        <footer>
          <button type="button" data-primary data-setup-done>Done</button>
          <button type="button" data-open-preview>Open preview</button>
          <small>You can change any of this later. Choices here are saved as you make them.</small>
        </footer>
      </section>

      <section data-card data-sample aria-label="Story sample" data-effects="full">
        <div data-sample-stage>
          <img data-sample-picture alt="" src="${SAMPLE_PICTURE}" />
          <div data-sample-dialogue><span data-sample-speaker>Mira</span><p data-sample-text><span data-sample-words></span><span data-sample-caret aria-hidden="true"></span></p><span data-sample-next aria-hidden="true"></span></div>
        </div>
        <div data-sample-label><span class="muted">Sample only. Rendered here, no connections used.</span><span data-status-echo aria-hidden="true"></span><button type="button" data-quiet data-sample-replay>Replay</button></div>
      </section>

      <form novalidate>
        <details data-card data-section="reading" open>
          <summary><h2>Reading</h2><span data-summary></span></summary>
          <div data-section-body>
            <fieldset data-live>
              <legend>Text speed</legend>
              ${segments("textSpeedStep", TEXT_SPEED_STEPS, true)}
              <label data-field data-custom="textSpeed" hidden><span>Milliseconds per letter</span><input name="textSpeed" type="number" min="0" max="100" step="1" /><small>0 shows each line at once.</small></label>
            </fieldset>
            <fieldset data-live>
              <legend>Pause before the next line (auto-play)</legend>
              ${segments("autoPlayStep", AUTO_PLAY_STEPS, true)}
              <label data-field data-custom="autoPlayDelay" hidden><span>Milliseconds</span><input name="autoPlayDelay" type="number" min="500" max="10000" step="250" /></label>
            </fieldset>
            <div data-row data-live>
              <label data-field><span>How you reply</span><select name="mode"><option value="standard">Write your own reply</option><option value="cyoa">Choose from suggestions</option></select></label>
              <label data-field><span>Fast forward</span><select name="skipMode"><option value="read">Skip only text you have read</option><option value="all">Skip everything</option></select></label>
            </div>
            <div data-live>
              <label data-check><input name="generateChoices" type="checkbox" /><span>Suggest choices when the reply has none</span></label>
              <label data-check><input name="autoEnter" type="checkbox" /><span>Open the novel view automatically when a chat opens</span></label>
            </div>
          </div>
        </details>

        <details data-card data-section="appearance">
          <summary><h2>Appearance</h2><span data-summary></span></summary>
          <div data-section-body>
            <fieldset data-live>
              <legend>Theme</legend>
              ${themeTiles()}
            </fieldset>
            <fieldset data-live>
              <legend>Text size</legend>
              ${segments("textScaleStep", TEXT_SCALE_STEPS, true)}
              <label data-field data-custom="textScale" hidden><span>Scale (1 = normal)</span><input name="textScale" type="number" min="${TEXT_SCALE_MIN}" max="${TEXT_SCALE_MAX}" step="0.05" /></label>
            </fieldset>
            <fieldset data-live>
              <legend>Scene effects</legend>
              <div data-options>${EFFECT_INTENSITY_OPTIONS.map((option) =>
                `<label><input type="radio" name="effectIntensity" value="${option.value}" /><span><b>${esc(option.label)}</b><small>${esc(option.help)}</small></span></label>`).join("")}</div>
            </fieldset>
            <fieldset data-live>
              <legend>Picture fit</legend>
              <div data-options>${SCENE_IMAGE_FIT_OPTIONS.map((option) =>
                `<label><input type="radio" name="sceneImageFit" value="${option.value}" /><span><b>${esc(option.label)}</b><small>${esc(option.help)}</small></span></label>`).join("")}</div>
            </fieldset>
          </div>
        </details>

        <details data-card data-section="images">
          <summary><h2>Images</h2><span data-summary></span></summary>
          <div data-section-body>
            <fieldset data-live>
              <legend>Where pictures come from</legend>
              ${imageSourceOptions("imageSource")}
            </fieldset>
            <div data-generated-only>
              <fieldset data-live>
                <legend>Pictures per reply</legend>
                ${segments("budgetPreset", BUDGET_PRESETS.map((preset) => ({ label: preset.label, value: preset.id })), true)}
                <small data-budget-help></small>
                <label data-field data-custom="maxImagesPerTurn" hidden><span>Maximum pictures per reply</span><input name="maxImagesPerTurn" type="number" min="0" max="12" step="1" /><small>0 removes the limit. Long replies can then cost more than you expect.</small></label>
              </fieldset>
              <div data-live>
                <label data-check><input name="referenceAnchoring" type="checkbox" /><span>Keep each character looking the same between pictures<small>Reuses a character's first portrait as a reference for later ones.</small></span></label>
              </div>
              <div data-field data-live>
                <span>Image connection</span>
                <div data-readiness="image" data-level="loading"><div><b data-readiness-title></b><small data-readiness-action></small><div data-actions hidden><button type="button" data-refresh-connections>Refresh</button></div></div></div>
                <select name="imageConnectionId" data-connection-select="image" aria-label="Image connection"><option value="">Lumiverse default</option></select>
              </div>
              <div data-novelai-controls hidden>
                <fieldset data-live>
                  <legend>NovelAI image dimensions</legend>
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
                <div data-row data-live>
                  <label data-field><span>Sampling steps <small data-novelai-steps-help>(≤28 within Opus limit)</small></span><input name="novelAiSteps" type="number" min="${NOVELAI_STEPS_MIN}" max="${NOVELAI_STEPS_MAX}" step="1" /></label>
                  <label data-field><span>Prompt guidance (CFG scale)</span><input name="novelAiGuidance" type="number" min="${NOVELAI_GUIDANCE_MIN}" max="${NOVELAI_GUIDANCE_MAX}" step="0.5" /></label>
                </div>
                <div data-field data-live>
                  <span>Sampler</span>
                  <select name="novelAiSampler" aria-label="NovelAI sampler"></select>
                </div>
              </div>
            </div>
          </div>
        </details>

        <details data-card data-section="sound">
          <summary><h2>Sound</h2><span data-summary></span></summary>
          <div data-section-body>
            <div data-sound-empty>
              <p>No music yet</p>
              <small>Import a folder of .mp3, .ogg, .wav, .m4a or .flac files. Cue plays them as background music and sound effects when a scene calls for them.</small>
              <div data-actions><button type="button" data-primary data-import-audio>Import music folder…</button><button type="button" data-scan-audio>Check library</button></div>
            </div>
            <div data-sound-ready hidden>
              <p data-sound-counts></p>
              <div data-actions><button type="button" data-import-audio>Import more…</button><button type="button" data-scan-audio>Check library</button></div>
            </div>
            <small data-audio-status role="status" aria-live="polite"></small>
            <div data-row data-live>
              <label data-field><span>Music volume <span data-bgm-val>70%</span></span><input name="bgmVolume" type="range" min="0" max="1" step="0.05" /></label>
              <label data-field><span>Sound effects volume <span data-sfx-val>80%</span></span><input name="sfxVolume" type="range" min="0" max="1" step="0.05" /></label>
            </div>
          </div>
        </details>

        <details data-card data-section="advanced" data-advanced-settings>
          <summary><h2>Advanced</h2><span data-summary>Applies when you choose Apply</span></summary>
          <div data-section-body>
            <p class="muted">Technical controls. Changes here wait until you choose <b>Apply advanced settings</b>. Everything above saves on its own.</p>

            <details data-card data-section data-subsection>
              <summary><h3>Connections and models</h3></summary>
              <div data-section-body>
                <div data-field>
                  <span>Story reader connection</span>
                  <div data-readiness="planner" data-level="loading"><div><b data-readiness-title></b><small data-readiness-action></small><div data-actions hidden><button type="button" data-refresh-connections>Refresh</button></div></div></div>
                  <select name="parserConnectionId" data-connection-select="planner" aria-label="Story reader connection"><option value="">Lumiverse default</option></select>
                  <small>Saves when changed. Reads the conversation to choose images and speakers.</small>
                </div>
                <div data-actions><button type="button" data-refresh-connections>Refresh connection list</button><small>Refreshing is free. Connections are listed, not tested.</small></div>
                <label data-field><span>Image model override</span><input name="imageModel" type="text" placeholder="Use the selected connection model" /><small data-image-model-hint>Leave blank to use the model configured on the selected image connection.</small></label>
                <label data-field><span>Images generated at the same time</span><input name="imageConcurrency" type="number" min="1" max="6" step="1" /></label>
                <div data-row>
                  <label data-field><span>Story reader parameters (JSON)</span><textarea name="parserParameters" spellcheck="false"></textarea></label>
                  <label data-field><span>Image parameters (JSON)</span><textarea name="imageParameters" spellcheck="false"></textarea></label>
                </div>
              </div>
            </details>

            <details data-card data-section data-subsection>
              <summary><h3>What the story reader sees</h3></summary>
              <div data-section-body>
                <label data-field><span>Recent messages</span><input name="includeRecentMessages" type="number" min="0" max="30" step="1" /></label>
                <label data-check><input name="includeCharacterContext" type="checkbox" /><span>Include character-card context</span></label>
                <label data-check><input name="includePersonaContext" type="checkbox" /><span>Include active persona context</span></label>
                <label data-check><input name="includeLorebookContext" type="checkbox" /><span>Include activated lorebook context</span></label>
                <label data-check><input name="debugLogging" type="checkbox" /><span>Verbose debug logging<small>Writes host events, planning, assets and anchoring to the Lumiverse log and browser console. While on, story text, the raw planner response and resolved character, wardrobe and environment state are written to the log.</small></span></label>
              </div>
            </details>

            <details data-card data-section data-subsection>
              <summary><h3>Image prompts</h3></summary>
              <div data-section-body>
                <div data-field>
                  <span>Preset</span>
                  <div data-preset-row>
                    <select name="promptPresetSelect" aria-label="Prompt preset"><option value="">Custom (no preset)</option></select>
                    <input name="promptPresetName" type="text" placeholder="Preset name" aria-label="Preset name" />
                    <button type="button" data-preset-save>Save preset</button>
                    <button type="button" data-preset-delete>Delete</button>
                  </div>
                  <small>Choosing a preset fills the positive and negative fields. Save preset stores the current fields under the name, right away.</small>
                </div>
                <label data-field><span>Positive prefix</span><input name="promptPrefix" type="text" /></label>
                <label data-field><span>Positive suffix</span><input name="promptSuffix" type="text" /></label>
                <label data-field><span>Negative prompt</span><input name="negativePrompt" type="text" /></label>
                <label data-check><input name="originalReference" type="checkbox" /><span>Include character creation / series reference tag</span></label>
                <label data-field><span>Creation / series name</span><input name="originalCreationName" type="text" placeholder="e.g. doki doki literature club" /><small>When enabled, character tags become: Character \\(Creation\\), e.g. Miyo \\(doki doki literature club\\).</small></label>
                <label data-field><span>Story reader instructions</span><textarea name="customPlannerInstructions"></textarea></label>
              </div>
            </details>

            <details data-card data-section data-subsection>
              <summary><h3>Text filtering and regex</h3></summary>
              <div data-section-body>
                <label data-field><span>Ignored tags</span><input name="ignoredTags" type="text" placeholder="status, stats, system, inventory" /><small>Comma-separated tag names, such as status, inventory, WORLD_VOICE. Removes the whole matching block from dialogue and image planning, including multiline blocks. Recognized status blocks stay available as plain-text cards in Panels. The chat message is not edited.</small></label>
                <label data-field><span>Display regex rules</span><textarea name="displayRegexRules" spellcheck="false" placeholder="/§([^§]+)§/g => <em class=&quot;vn-transmission&quot;>$1</em>"></textarea><small>Dialogue formatting only. One rule per line: <code>/pattern/flags =&gt; replacement</code> or <code>pattern =&gt; replacement</code>. An empty replacement hides a match from dialogue, not from image planning. Only safe inline formatting renders here. For full HTML/SVG cards, open Panels in the novel view.</small></label>
              </div>
            </details>

            <details data-card data-section data-subsection>
              <summary><h3>Custom CSS and storage</h3></summary>
              <div data-section-body>
                <label data-field><span>Theme CSS</span><textarea name="customCss" spellcheck="false"></textarea><small>Selectors beginning with data-vn are stable. Remote imports and URL fetches are removed.</small></label>
                <label data-field><span>Music storage folder</span><input name="audioDirectory" type="text" placeholder="audio" /><small>Folder inside the extension's scoped Lumiverse storage, scanned recursively for music and sound effects.</small></label>
              </div>
            </details>

            <div data-actions>
              <button type="submit" data-primary data-apply>Apply advanced settings</button>
              <button type="button" data-reset>Reset defaults</button>
              <button type="button" data-quiet data-show-setup>Show setup guide</button>
            </div>
            <small>Reset returns every setting to its default. Your saved prompt presets and music folder are kept.</small>
          </div>
        </details>

        <div data-actionbar>
          <span data-status role="status" aria-live="polite"></span>
          <button type="submit" data-primary data-apply-bar hidden>Apply advanced settings</button>
          <button type="button" data-open-preview>Open preview</button>
        </div>
      </form>
    </div>`;
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

  private wire(): void {
    const advanced = this.root.querySelector<HTMLDetailsElement>("[data-advanced-settings]")!;

    // Everyday controls save the moment they change; Advanced controls become drafts.
    this.form.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
      if (advanced.contains(target)) {
        if ((ADVANCED_KEYS as readonly string[]).includes(target.name)) this.markDraft(target.name as AdvancedKey);
        return;
      }
      this.handleLiveChange(target);
    });
    this.form.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (advanced.contains(target)) {
        if ((ADVANCED_KEYS as readonly string[]).includes(target.name)) this.markDraft(target.name as AdvancedKey);
        return;
      }
      // Sliders and number fields preview while dragging or typing; the save happens on change.
      if (target.name === "bgmVolume" || target.name === "sfxVolume") this.updateVolumeLabels();
      if (target.name === "textSpeed") this.restartSample();
      if (target.name === "textScale") this.root.querySelector<HTMLElement>("[data-sample-stage]")!.style.setProperty("--sample-scale", String(clamp(Number(target.value), TEXT_SCALE_MIN, TEXT_SCALE_MAX, this.config.textScale)));
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

    // A failed validation inside a closed section must open that section.
    this.form.addEventListener("invalid", (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      for (let parent = event.target.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
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
      case "themePreset":
      case "setupThemePreset":
        return { themePreset: normalizeThemePreset(target.value) };
      case "sceneImageFit": return { sceneImageFit: normalizeSceneImageFit(target.value) };
      case "effectIntensity": return { effectIntensity: normalizeEffectIntensity(target.value) };
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
    this.root.querySelector<HTMLElement>("[data-apply-bar]")!.hidden = !dirty;
    this.root.querySelector<HTMLElement>("[data-advanced-settings] [data-summary]")!.textContent = dirty
      ? `${this.drafts.size} unapplied change${this.drafts.size === 1 ? "" : "s"}`
      : "Applies when you choose Apply";
    if (dirty) this.setStatus("Advanced changes are not applied yet.", "dirty");
    else if (this.status.dataset.kind === "dirty") this.setStatus("", "idle");
  }

  private applyAdvanced(): void {
    let patch: Partial<VisualNovelConfig>;
    try {
      patch = this.readAdvanced();
    } catch (error) {
      const advanced = this.root.querySelector<HTMLDetailsElement>("[data-advanced-settings]")!;
      advanced.open = true;
      for (const section of advanced.querySelectorAll("details")) section.open = true;
      this.setStatus(error instanceof Error ? error.message : String(error), "error");
      return;
    }
    this.pendingEverydayFields = {};
    this.config = { ...this.config, ...patch };
    this.drafts.clear();
    this.refreshStatus();
    this.save(patch, "Advanced settings applied.");
  }

  private readAdvanced(): Partial<VisualNovelConfig> {
    return {
      imageModel: this.control<HTMLInputElement>("imageModel").value.trim(),
      imageConcurrency: clamp(Math.round(Number(this.control<HTMLInputElement>("imageConcurrency").value)), 1, 6, DEFAULT_CONFIG.imageConcurrency),
      parserParameters: jsonObject(this.control<HTMLTextAreaElement>("parserParameters").value, "Story reader parameters"),
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
    this.root.querySelector<HTMLElement>("[data-budget-help]")!.textContent = describeBudget(config.maxImagesPerTurn);

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
    const summary = (section: string, text: string) => {
      const element = this.root.querySelector<HTMLElement>(`details[data-section="${section}"] > summary [data-summary]`);
      if (element) element.textContent = text;
    };
    summary("reading", `${describeTextSpeed(config.textSpeed)} · ${config.mode === "cyoa" ? "Choose from suggestions" : "Write your own reply"}`);
    const fit = SCENE_IMAGE_FIT_OPTIONS.find((option) => option.value === config.sceneImageFit)?.label ?? config.sceneImageFit;
    summary("appearance", `${THEME_PRESET_LABELS[config.themePreset].replace(/ \(.*\)$/, "")} · ${describeTextScale(config.textScale)} text · ${fit}`);
    const source = imageSourceFromConfig(config);
    const sourceLabel = IMAGE_SOURCE_OPTIONS.find((option) => option.value === source)?.label ?? source;
    const budget = budgetPresetFor(config.maxImagesPerTurn);
    const budgetLabel = budget === "custom" ? (config.maxImagesPerTurn === 0 ? "No limit" : `${config.maxImagesPerTurn} per reply`) : BUDGET_PRESETS.find((preset) => preset.id === budget)!.label;
    summary("images", source === "generated" ? `${sourceLabel} · ${budgetLabel}` : sourceLabel);
    const library = this.audioLibrary ? `${this.audioLibrary.bgmCount} track${this.audioLibrary.bgmCount === 1 ? "" : "s"}` : "No music yet";
    summary("sound", `${library} · ${Math.round(config.bgmVolume * 100)}%`);
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
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    this.renderConnectionSelects(kind, kind === "planner" ? this.config.parserConnectionId : this.config.imageConnectionId);
    if (kind === "image") {
      this.updateImageModelHint();
      this.syncNovelAiControls(this.config, imageSourceFromConfig(this.config));
    }
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
    const echo = this.root.querySelector<HTMLElement>("[data-status-echo]");
    if (echo) {
      // Long messages belong to the footer; the sample row only echoes short states.
      echo.textContent = text.length <= 40 ? text : "";
      echo.dataset.kind = kind;
    }
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
    for (const timer of [this.statusTimer, this.resetTimer, this.saveTimer, this.sampleTimer]) if (timer) clearTimeout(timer);
    this.host.remove();
  }
}

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}
