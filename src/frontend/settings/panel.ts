import {
  DEFAULT_CONFIG,
  SCENE_IMAGE_FITS,
  THEME_PRESET_IDS,
  type VisualNovelConfig,
  type VisualNovelSceneImageFit,
  type VisualNovelThemePreset,
} from "../../config.js";

export type SettingsPanelOptions = {
  mount: HTMLElement;
  onSave: (patch: Partial<VisualNovelConfig>) => void;
  onOpenPreview: () => void;
  onRefreshConnections: () => void;
};

export type ConnectionCatalogKind = "planner" | "image";

export type ConnectionOption = {
  id: string;
  name: string;
  provider: string;
  model: string;
  isDefault: boolean;
};

export type ConnectionCatalogState =
  | { status: "idle" | "loading"; options: readonly ConnectionOption[] }
  | { status: "ready"; options: readonly ConnectionOption[] }
  | { status: "error"; options: readonly ConnectionOption[]; error: string };

export type ConnectionSelectOption = {
  value: string;
  label: string;
  missing?: boolean;
};

export function connectionOptionLabel(option: ConnectionOption): string {
  const details = [option.provider, option.model].filter(Boolean).join(" · ");
  return `${option.name}${details ? ` (${details})` : ""}${option.isDefault ? " · Default" : ""}`;
}

export function buildConnectionSelectOptions(
  options: readonly ConnectionOption[],
  selectedId: string | null,
): ConnectionSelectOption[] {
  const sorted = [...options].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  const result: ConnectionSelectOption[] = [
    { value: "", label: "Lumiverse default" },
    ...sorted.map((option) => ({ value: option.id, label: connectionOptionLabel(option) })),
  ];
  if (selectedId && !options.some((option) => option.id === selectedId)) {
    result.push({ value: selectedId, label: `Missing: ${selectedId}`, missing: true });
  }
  return result;
}

const PANEL_CSS = `
:host { display: block; color: var(--lumiverse-text, #f5f5f7); font: 14px/1.5 var(--lumiverse-font-family, system-ui, sans-serif); }
* { box-sizing: border-box; }
form { display: grid; gap: 1rem; max-width: 54rem; padding: 1rem; }
section { display: grid; gap: .8rem; padding: 1rem; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.16)); border-radius: .85rem; background: var(--lumiverse-card-bg, rgba(255,255,255,.035)); }
h2 { margin: 0; font-size: 1rem; }
p { margin: 0; color: var(--lumiverse-text-muted, rgba(255,255,255,.68)); }
label { display: grid; gap: .35rem; font-weight: 650; }
label[data-check] { grid-template-columns: auto 1fr; align-items: center; font-weight: 500; }
small { color: var(--lumiverse-text-muted, rgba(255,255,255,.68)); font-weight: 400; }
[data-connection-status][data-kind="error"] { color: var(--lumiverse-danger, #ff8ca0); }
input, select, textarea, button { font: inherit; }
input[type="text"], input[type="number"], select, textarea { width: 100%; padding: .65rem .75rem; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.2)); border-radius: .55rem; background: var(--lumiverse-bg-elevated, #171822); color: inherit; }
textarea { min-height: 10rem; resize: vertical; font-family: var(--lumiverse-font-mono, ui-monospace, monospace); font-size: .82rem; }
[data-row] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .8rem; }
[data-actions] { display: flex; flex-wrap: wrap; gap: .65rem; }
button { min-height: 2.5rem; padding: .55rem 1rem; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.24)); border-radius: 999px; background: var(--lumiverse-fill-medium, rgba(255,255,255,.1)); color: inherit; cursor: pointer; }
button[type="submit"] { border-color: var(--lumiverse-primary, #a986ff); background: var(--lumiverse-primary, #a986ff); color: var(--lumiverse-primary-contrast, #121018); font-weight: 750; }
[data-status] { min-height: 1.4em; }
@media (max-width: 620px) { [data-row] { grid-template-columns: 1fr; } form { padding: .65rem; } }
`;

function control<T extends HTMLElement>(root: ParentNode, name: string): T {
  const element = root.querySelector<T>(`[name="${name}"]`);
  if (!element) throw new Error(`Missing settings control: ${name}`);
  return element;
}

function jsonObject(value: string, label: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed: unknown = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function normalizeSceneImageFit(value: string): VisualNovelSceneImageFit {
  return (SCENE_IMAGE_FITS as readonly string[]).includes(value)
    ? value as VisualNovelSceneImageFit
    : DEFAULT_CONFIG.sceneImageFit;
}

function normalizeThemePreset(value: string): VisualNovelThemePreset {
  return (THEME_PRESET_IDS as readonly string[]).includes(value)
    ? value as VisualNovelThemePreset
    : DEFAULT_CONFIG.themePreset;
}

/**
 * Human-readable labels for each built-in theme preset. The order of `values`
 * always mirrors the canonical `THEME_PRESET_IDS`, so the settings selector
 * and the preset CSS map can never drift apart.
 */
export const THEME_PRESET_LABELS: Record<VisualNovelThemePreset, string> = {
  lumiverse: "Lumiverse (host default)",
  "golden-hour": "Golden hour",
  "boxed-console": "Boxed console",
  "paper-novel": "Paper novel",
  "midnight-noir": "Midnight noir",
};

export const THEME_PRESET_OPTIONS: ReadonlyArray<{
  value: VisualNovelThemePreset;
  label: string;
}> = THEME_PRESET_IDS.map((value) => ({ value, label: THEME_PRESET_LABELS[value] }));

export class VisualNovelSettingsPanel {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly form: HTMLFormElement;
  private readonly status: HTMLElement;
  private readonly options: SettingsPanelOptions;

  constructor(options: SettingsPanelOptions) {
    this.options = options;
    this.host = document.createElement("div");
    this.host.setAttribute("data-vn-settings", "");
    this.root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    const body = document.createElement("div");
    body.innerHTML = `
      <form>
        <section>
          <h2>Presentation</h2>
          <div data-row>
            <label>Mode<select name="mode"><option value="standard">Standard input</option><option value="cyoa">CYOA choices</option></select></label>
            <label>Images per turn<input name="maxImagesPerTurn" type="number" min="0" max="12" step="1" /><small>0 = unlimited (all distinct cues)</small></label>
          </div>
          <label>Theme style
            <select name="themePreset">${THEME_PRESET_OPTIONS.map(({ value, label }) => `<option value="${value}">${label}</option>`).join("")}</select>
            <small>Predefined look for the stage. Custom CSS below is always applied on top.</small>
          </label>
          <label>Scene image fit
            <select name="sceneImageFit">
              <option value="cover">Cover (crop to fill)</option>
              <option value="contain">Contain (fit with letterboxing)</option>
              <option value="fill">Stretch (distort to fill)</option>
              <option value="none">Original size (intrinsic)</option>
              <option value="scale-down">Scale down (intrinsic unless too large)</option>
            </select>
            <small>How the scene image fills the stage.</small>
          </label>
          <label data-check><input name="autoEnter" type="checkbox" /><span>Enter visual novel mode automatically when a chat opens</span></label>
          <label data-check><input name="generateImages" type="checkbox" /><span>Generate scene images</span></label>
          <label data-check><input name="useNativeCardImages" type="checkbox" /><span>Use native card images / expressions (disables external image generation)</span></label>
          <label data-check><input name="generateChoices" type="checkbox" /><span>Generate choices when the response has no authored Choice tags</span></label>
        </section>
        <section>
          <h2>Generation connections</h2>
          <p>Choose a saved Lumiverse connection or follow the host default.</p>
          <label>Planner connection
            <select name="parserConnectionId"><option value="">Lumiverse default</option></select>
            <small data-connection-status="planner" role="status"></small>
          </label>
          <label>Image connection
            <select name="imageConnectionId"><option value="">Lumiverse default</option></select>
            <small data-connection-status="image" role="status"></small>
          </label>
          <div data-actions><button type="button" data-refresh-connections>Refresh connections</button></div>
          <label>Image model override
            <input name="imageModel" type="text" placeholder="Use the selected connection model" />
            <small data-image-model-hint>Leave blank to use the model configured on the selected image connection.</small>
          </label>
          <label>Image concurrency<input name="imageConcurrency" type="number" min="1" max="6" step="1" /></label>
          <div data-row>
            <label>Planner parameters<textarea name="parserParameters" spellcheck="false"></textarea></label>
            <label>Image parameters<textarea name="imageParameters" spellcheck="false"></textarea></label>
          </div>
        </section>
        <section>
          <h2>Planning context</h2>
          <label>Recent messages<input name="includeRecentMessages" type="number" min="0" max="30" step="1" /></label>
          <label data-check><input name="includeCharacterContext" type="checkbox" /><span>Include character-card context</span></label>
          <label data-check><input name="includePersonaContext" type="checkbox" /><span>Include active persona context</span></label>
          <label data-check><input name="includeLorebookContext" type="checkbox" /><span>Include activated lorebook context</span></label>
          <label data-check><input name="debugLogging" type="checkbox" /><span>Write planner fallback details to the Lumiverse log</span></label>
        </section>
        <section>
          <h2>Text &amp; Dialogue Flow</h2>
          <div data-row>
            <label>Text typing speed (ms/char)
              <input name="textSpeed" type="number" min="0" max="100" step="5" />
              <small>0 = instant reveal, 20 = default typewriter speed.</small>
            </label>
            <label>Auto-play delay (ms)
              <input name="autoPlayDelay" type="number" min="500" max="10000" step="250" />
              <small>Base pause after text finishes before advancing automatically.</small>
            </label>
          </div>
          <label>Skip mode
            <select name="skipMode">
              <option value="read">Skip read only (pauses on unread text)</option>
              <option value="all">Skip all (fast forwards continuously)</option>
            </select>
            <small>Behavior when fast forward Skip is toggled.</small>
          </label>
        </section>
        <section>
          <h2>Prompt</h2>
          <label>Positive prefix<input name="promptPrefix" type="text" /></label>
          <label>Positive suffix<input name="promptSuffix" type="text" /></label>
          <label>Negative prompt<input name="negativePrompt" type="text" /></label>
          <label>Planner instructions<textarea name="customPlannerInstructions"></textarea></label>
        </section>
        <section>
          <h2>Content Filtering & Regex</h2>
          <label>Ignored tags
            <input name="ignoredTags" type="text" placeholder="status, stats, system, inventory" />
            <small>Comma-separated tags to omit from dialogue and image planning (e.g. &lt;status&gt;, [Status]).</small>
          </label>
          <label>Display regex rules
            <textarea name="displayRegexRules" spellcheck="false" placeholder="/§([^§]+)§/g => <em class=&quot;vn-transmission&quot;>$1</em>"></textarea>
            <small>One rule per line: <code>/pattern/flags =&gt; replacement</code> or <code>pattern =&gt; replacement</code>.</small>
          </label>
        </section>
        <section>
          <h2>Custom CSS</h2>
          <p>Selectors beginning with data-vn are stable. Remote imports and URL fetches are removed.</p>
          <label>Theme CSS<textarea name="customCss" spellcheck="false"></textarea></label>
        </section>
        <div data-actions><button type="submit">Save settings</button><button type="button" data-open-preview>Open preview</button><button type="button" data-reset>Reset defaults</button></div>
        <p data-status role="status" aria-live="polite"></p>
      </form>`;
    this.root.append(style, ...Array.from(body.childNodes));
    options.mount.append(this.host);
    this.form = this.root.querySelector("form")!;
    this.status = this.root.querySelector("[data-status]")!;
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        this.options.onSave(this.read());
        this.status.textContent = "Settings saved.";
      } catch (error) {
        this.status.textContent = error instanceof Error ? error.message : String(error);
      }
    });
    this.root.querySelector("[data-open-preview]")?.addEventListener("click", () => options.onOpenPreview());
    this.root.querySelector("[data-refresh-connections]")?.addEventListener("click", () => options.onRefreshConnections());
    control<HTMLSelectElement>(this.root, "imageConnectionId").addEventListener("change", () => this.updateImageModelHint());
    this.root.querySelector("[data-reset]")?.addEventListener("click", () => {
      this.setConfig(DEFAULT_CONFIG);
      this.options.onSave(DEFAULT_CONFIG);
      this.status.textContent = "Defaults restored.";
    });
  }

  setConfig(config: VisualNovelConfig): void {
    control<HTMLSelectElement>(this.root, "mode").value = config.mode;
    control<HTMLSelectElement>(this.root, "themePreset").value = config.themePreset;
    control<HTMLSelectElement>(this.root, "sceneImageFit").value = config.sceneImageFit;
    control<HTMLInputElement>(this.root, "autoEnter").checked = config.autoEnter;
    control<HTMLInputElement>(this.root, "generateImages").checked = config.generateImages;
    control<HTMLInputElement>(this.root, "useNativeCardImages").checked = config.useNativeCardImages;
    control<HTMLInputElement>(this.root, "generateChoices").checked = config.generateChoices;
    control<HTMLInputElement>(this.root, "maxImagesPerTurn").value = String(config.maxImagesPerTurn);
    control<HTMLInputElement>(this.root, "textSpeed").value = String(config.textSpeed);
    control<HTMLInputElement>(this.root, "autoPlayDelay").value = String(config.autoPlayDelay);
    control<HTMLSelectElement>(this.root, "skipMode").value = config.skipMode;
    this.renderConnectionSelect("planner", this.connectionStates.planner, config.parserConnectionId);
    this.renderConnectionSelect("image", this.connectionStates.image, config.imageConnectionId);
    control<HTMLInputElement>(this.root, "imageModel").value = config.imageModel;
    control<HTMLInputElement>(this.root, "imageConcurrency").value = String(config.imageConcurrency);
    control<HTMLTextAreaElement>(this.root, "parserParameters").value = JSON.stringify(config.parserParameters, null, 2);
    control<HTMLTextAreaElement>(this.root, "imageParameters").value = JSON.stringify(config.imageParameters, null, 2);
    control<HTMLInputElement>(this.root, "includeRecentMessages").value = String(config.includeRecentMessages);
    control<HTMLInputElement>(this.root, "includeCharacterContext").checked = config.includeCharacterContext;
    control<HTMLInputElement>(this.root, "includePersonaContext").checked = config.includePersonaContext;
    control<HTMLInputElement>(this.root, "includeLorebookContext").checked = config.includeLorebookContext;
    control<HTMLInputElement>(this.root, "debugLogging").checked = config.debugLogging;
    control<HTMLInputElement>(this.root, "promptPrefix").value = config.promptPrefix;
    control<HTMLInputElement>(this.root, "promptSuffix").value = config.promptSuffix;
    control<HTMLInputElement>(this.root, "negativePrompt").value = config.negativePrompt;
    control<HTMLTextAreaElement>(this.root, "customPlannerInstructions").value = config.customPlannerInstructions;
    control<HTMLInputElement>(this.root, "ignoredTags").value = config.ignoredTags;
    control<HTMLTextAreaElement>(this.root, "displayRegexRules").value = config.displayRegexRules;
    control<HTMLTextAreaElement>(this.root, "customCss").value = config.customCss;
    this.updateImageModelHint();
  }

  setConnectionCatalog(kind: ConnectionCatalogKind, state: ConnectionCatalogState): void {
    this.connectionStates[kind] = state;
    const configId = control<HTMLSelectElement>(
      this.root,
      kind === "planner" ? "parserConnectionId" : "imageConnectionId",
    ).value || null;
    this.renderConnectionSelect(kind, state, configId);
    if (kind === "image") this.updateImageModelHint();
  }

  destroy(): void {
    this.host.remove();
  }

  private read(): Partial<VisualNovelConfig> {
    const optional = (name: string): string | null => control<HTMLInputElement | HTMLSelectElement>(this.root, name).value.trim() || null;
    return {
      mode: control<HTMLSelectElement>(this.root, "mode").value === "cyoa" ? "cyoa" : "standard",
      themePreset: normalizeThemePreset(control<HTMLSelectElement>(this.root, "themePreset").value),
      sceneImageFit: normalizeSceneImageFit(control<HTMLSelectElement>(this.root, "sceneImageFit").value),
      autoEnter: control<HTMLInputElement>(this.root, "autoEnter").checked,
      generateImages: control<HTMLInputElement>(this.root, "generateImages").checked,
      useNativeCardImages: control<HTMLInputElement>(this.root, "useNativeCardImages").checked,
      generateChoices: control<HTMLInputElement>(this.root, "generateChoices").checked,
      maxImagesPerTurn: Number(control<HTMLInputElement>(this.root, "maxImagesPerTurn").value),
      textSpeed: Number(control<HTMLInputElement>(this.root, "textSpeed").value),
      autoPlayDelay: Number(control<HTMLInputElement>(this.root, "autoPlayDelay").value),
      skipMode: control<HTMLSelectElement>(this.root, "skipMode").value === "all" ? "all" : "read",
      parserConnectionId: optional("parserConnectionId"),
      imageConnectionId: optional("imageConnectionId"),
      imageModel: control<HTMLInputElement>(this.root, "imageModel").value.trim(),
      imageConcurrency: Number(control<HTMLInputElement>(this.root, "imageConcurrency").value),
      parserParameters: jsonObject(control<HTMLTextAreaElement>(this.root, "parserParameters").value, "Planner parameters"),
      imageParameters: jsonObject(control<HTMLTextAreaElement>(this.root, "imageParameters").value, "Image parameters"),
      includeRecentMessages: Number(control<HTMLInputElement>(this.root, "includeRecentMessages").value),
      includeCharacterContext: control<HTMLInputElement>(this.root, "includeCharacterContext").checked,
      includePersonaContext: control<HTMLInputElement>(this.root, "includePersonaContext").checked,
      includeLorebookContext: control<HTMLInputElement>(this.root, "includeLorebookContext").checked,
      debugLogging: control<HTMLInputElement>(this.root, "debugLogging").checked,
      promptPrefix: control<HTMLInputElement>(this.root, "promptPrefix").value,
      promptSuffix: control<HTMLInputElement>(this.root, "promptSuffix").value,
      negativePrompt: control<HTMLInputElement>(this.root, "negativePrompt").value,
      customPlannerInstructions: control<HTMLTextAreaElement>(this.root, "customPlannerInstructions").value,
      ignoredTags: control<HTMLInputElement>(this.root, "ignoredTags").value,
      displayRegexRules: control<HTMLTextAreaElement>(this.root, "displayRegexRules").value,
      customCss: control<HTMLTextAreaElement>(this.root, "customCss").value
    };
  }

  private readonly connectionStates: Record<ConnectionCatalogKind, ConnectionCatalogState> = {
    planner: { status: "idle", options: [] },
    image: { status: "idle", options: [] },
  };

  private renderConnectionSelect(
    kind: ConnectionCatalogKind,
    state: ConnectionCatalogState,
    selectedId: string | null,
  ): void {
    const name = kind === "planner" ? "parserConnectionId" : "imageConnectionId";
    const select = control<HTMLSelectElement>(this.root, name);
    const options = buildConnectionSelectOptions(state.options, selectedId);
    select.replaceChildren(...options.map((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      if (item.missing) option.dataset.missing = "true";
      return option;
    }));
    select.value = selectedId ?? "";

    const status = this.root.querySelector<HTMLElement>(`[data-connection-status="${kind}"]`)!;
    status.dataset.kind = state.status;
    if (state.status === "loading") {
      status.textContent = `Loading ${kind} connections…`;
    } else if (state.status === "error") {
      status.textContent = state.error;
    } else if (state.status === "ready" && state.options.length === 0) {
      status.textContent = `No saved ${kind} connections found. Lumiverse default remains available.`;
    } else if (state.status === "ready") {
      status.textContent = `${state.options.length} saved ${kind} connection${state.options.length === 1 ? "" : "s"}.`;
    } else {
      status.textContent = "Connection list has not loaded yet.";
    }
  }

  private updateImageModelHint(): void {
    const select = control<HTMLSelectElement>(this.root, "imageConnectionId");
    const selected = this.connectionStates.image.options.find((option) => option.id === select.value);
    const modelInput = control<HTMLInputElement>(this.root, "imageModel");
    const hint = this.root.querySelector<HTMLElement>("[data-image-model-hint]")!;
    if (selected?.model) {
      modelInput.placeholder = selected.model;
      hint.textContent = `Leave blank to use ${selected.model} from ${selected.name}.`;
    } else {
      modelInput.placeholder = "Use the selected connection model";
      hint.textContent = "Leave blank to use the model configured on the selected image connection.";
    }
  }
}
