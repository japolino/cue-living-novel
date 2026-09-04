import {
  DEFAULT_CONFIG,
  SCENE_IMAGE_FITS,
  THEME_PRESET_IDS,
  type VisualNovelConfig,
  type VisualNovelPromptPreset,
  type VisualNovelSceneImageFit,
  type VisualNovelThemePreset,
} from "../../config.js";

export type SettingsPanelOptions = {
  mount: HTMLElement;
  onSave: (patch: Partial<VisualNovelConfig>) => void;
  onOpenPreview: () => void;
  onRefreshConnections: () => void;
  onScanAudio?: (directory: string) => Promise<{ bgmCount: number; sfxCount: number } | void> | void;
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
form { display: grid; gap: .85rem; max-width: 54rem; padding: 1rem 1rem 0; }
details[data-section] { border: 1px solid var(--lumiverse-border, rgba(255,255,255,.16)); border-radius: .85rem; background: var(--lumiverse-card-bg, rgba(255,255,255,.035)); }
details[data-section] > summary { list-style: none; display: flex; align-items: center; gap: .55rem; padding: .8rem 1rem; font-size: 1rem; font-weight: 750; cursor: pointer; user-select: none; border-radius: .85rem; }
details[data-section] > summary::-webkit-details-marker { display: none; }
details[data-section] > summary::before { content: "\\25B8"; font-size: .8em; color: var(--lumiverse-primary, #a986ff); transition: transform .15s ease; }
details[data-section][open] > summary::before { transform: rotate(90deg); }
details[data-section] > summary:hover { background: var(--lumiverse-fill-medium, rgba(255,255,255,.06)); }
details[data-section] > summary > small { margin-left: auto; font-weight: 400; text-align: right; }
[data-section-body] { display: grid; gap: .8rem; padding: .2rem 1rem 1rem; }
p { margin: 0; color: var(--lumiverse-text-muted, rgba(255,255,255,.68)); }
label { display: grid; gap: .35rem; font-weight: 650; }
label[data-check] { grid-template-columns: auto 1fr; align-items: center; font-weight: 500; }
small { color: var(--lumiverse-text-muted, rgba(255,255,255,.68)); font-weight: 400; }
[data-connection-status][data-kind="error"] { color: var(--lumiverse-danger, #ff8ca0); }
input, select, textarea, button { font: inherit; }
input[type="range"] { width: 100%; accent-color: var(--lumiverse-primary, #a986ff); cursor: pointer; }
[data-audio-status] { display: inline-block; margin-left: .5rem; font-style: italic; color: var(--lumiverse-text-muted, rgba(255,255,255,.75)); }
input[type="text"], input[type="number"], select, textarea { width: 100%; padding: .65rem .75rem; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.2)); border-radius: .55rem; background: var(--lumiverse-bg-elevated, #171822); color: inherit; }
textarea { min-height: 10rem; resize: vertical; font-family: var(--lumiverse-font-mono, ui-monospace, monospace); font-size: .82rem; }
[data-row] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .8rem; }
[data-preset-row] { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto auto; gap: .5rem; align-items: center; }
[data-preset-row] button { white-space: nowrap; }
@media (max-width: 620px) { [data-preset-row] { grid-template-columns: 1fr 1fr; } }
[data-actions] { display: flex; flex-wrap: wrap; gap: .65rem; }
button { min-height: 2.5rem; padding: .55rem 1rem; border: 1px solid var(--lumiverse-border, rgba(255,255,255,.24)); border-radius: 999px; background: var(--lumiverse-fill-medium, rgba(255,255,255,.1)); color: inherit; cursor: pointer; }
button[type="submit"] { border-color: var(--lumiverse-primary, #a986ff); background: var(--lumiverse-primary, #a986ff); color: var(--lumiverse-primary-contrast, #121018); font-weight: 750; }
button[type="submit"][data-dirty] { box-shadow: 0 0 0 3px color-mix(in srgb, var(--lumiverse-primary, #a986ff) 40%, transparent); }
button[data-reset][data-confirming] { border-color: var(--lumiverse-danger, #ff8ca0); color: var(--lumiverse-danger, #ff8ca0); background: transparent; }
[data-actionbar] { position: sticky; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; margin: 0 -1rem; padding: .8rem 1rem; background: var(--lumiverse-bg-elevated, #171822); border-top: 1px solid var(--lumiverse-border, rgba(255,255,255,.16)); box-shadow: 0 -8px 20px rgba(0,0,0,.3); }
[data-actionbar] [data-status] { margin: 0 0 0 auto; min-height: 0; text-align: right; }
[data-status][data-kind="saved"] { color: var(--lumiverse-success, #8ce8b0); }
[data-status][data-kind="dirty"] { color: var(--lumiverse-warning, #ffd08a); }
[data-status][data-kind="error"] { color: var(--lumiverse-danger, #ff8ca0); }
@media (max-width: 620px) { [data-row] { grid-template-columns: 1fr; } form { padding: .65rem .65rem 0; } [data-actionbar] { margin: 0 -.65rem; padding: .7rem .65rem; } }
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
  "yamaku-classic": "Yamaku classic (sentimental)",
  "literature-club": "Literature club (pastel pop)",
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
  private readonly audioStatus: HTMLElement | null;
  private readonly options: SettingsPanelOptions;
  private dirty = false;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;

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
        <details data-section open>
          <summary>Presentation</summary>
          <div data-section-body>
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
            <label data-check><input name="referenceAnchoring" type="checkbox" /><span>Character reference anchoring (reuse each character's first portrait as an identity reference for later images)</span></label>
            <label data-check><input name="useNativeCardImages" type="checkbox" /><span>Use native card images / expressions (disables external image generation)</span></label>
            <label data-check><input name="generateChoices" type="checkbox" /><span>Generate choices when the response has no authored Choice tags</span></label>
          </div>
        </details>
        <details data-section open>
          <summary>Generation connections</summary>
          <div data-section-body>
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
          </div>
        </details>
        <details data-section>
          <summary>Planning context</summary>
          <div data-section-body>
            <label>Recent messages<input name="includeRecentMessages" type="number" min="0" max="30" step="1" /></label>
            <label data-check><input name="includeCharacterContext" type="checkbox" /><span>Include character-card context</span></label>
            <label data-check><input name="includePersonaContext" type="checkbox" /><span>Include active persona context</span></label>
            <label data-check><input name="includeLorebookContext" type="checkbox" /><span>Include activated lorebook context</span></label>
            <label data-check><input name="debugLogging" type="checkbox" /><span>Verbose debug logging (host events, planning, assets, anchoring) to the Lumiverse log and browser console</span></label>
          </div>
        </details>
        <details data-section>
          <summary>Text &amp; Dialogue Flow</summary>
          <div data-section-body>
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
          </div>
        </details>
        <details data-section>
          <summary>Audio &amp; Atmosphere</summary>
          <div data-section-body>
            <label>Audio storage prefix
              <input name="audioDirectory" type="text" placeholder="audio" />
              <small>Folder inside the extension's scoped Lumiverse storage, scanned recursively for BGM and SFX.</small>
            </label>
            <div data-actions>
              <button type="button" data-scan-audio>Scan Audio</button>
              <small data-audio-status role="status"></small>
            </div>
            <div data-row>
              <label>BGM volume (<span data-bgm-val>70%</span>)
                <input name="bgmVolume" type="range" min="0" max="1" step="0.05" />
              </label>
              <label>SFX volume (<span data-sfx-val>80%</span>)
                <input name="sfxVolume" type="range" min="0" max="1" step="0.05" />
              </label>
            </div>
          </div>
        </details>
        <details data-section>
          <summary>Prompt</summary>
          <div data-section-body>
            <label>Preset
              <div data-preset-row>
                <select name="promptPresetSelect"><option value="">Custom (no preset)</option></select>
                <input name="promptPresetName" type="text" placeholder="Preset name" />
                <button type="button" data-preset-save>Save preset</button>
                <button type="button" data-preset-delete>Delete</button>
              </div>
              <small>Selecting a preset fills the positive and negative fields below. "Save preset" stores the current fields under the name.</small>
            </label>
            <label>Positive prefix<input name="promptPrefix" type="text" /></label>
            <label>Positive suffix<input name="promptSuffix" type="text" /></label>
            <label>Negative prompt<input name="negativePrompt" type="text" /></label>
            <label>Planner instructions<textarea name="customPlannerInstructions"></textarea></label>
          </div>
        </details>
        <details data-section>
          <summary>Content Filtering &amp; Regex</summary>
          <div data-section-body>
            <label>Ignored tags
              <input name="ignoredTags" type="text" placeholder="status, stats, system, inventory" />
              <small>Comma-separated tags to omit from dialogue and image planning (e.g. &lt;status&gt;, [Status]).</small>
            </label>
            <label>Display regex rules
              <textarea name="displayRegexRules" spellcheck="false" placeholder="/§([^§]+)§/g => <em class=&quot;vn-transmission&quot;>$1</em>"></textarea>
              <small>One rule per line: <code>/pattern/flags =&gt; replacement</code> or <code>pattern =&gt; replacement</code>.</small>
            </label>
          </div>
        </details>
        <details data-section>
          <summary>Custom CSS</summary>
          <div data-section-body>
            <p>Selectors beginning with data-vn are stable. Remote imports and URL fetches are removed.</p>
            <label>Theme CSS<textarea name="customCss" spellcheck="false"></textarea></label>
          </div>
        </details>
        <div data-actionbar>
          <button type="submit" data-save>Save settings</button>
          <button type="button" data-open-preview>Open preview</button>
          <button type="button" data-reset>Reset defaults</button>
          <span data-status role="status" aria-live="polite"></span>
        </div>
      </form>`;
    this.root.append(style, ...Array.from(body.childNodes));
    options.mount.append(this.host);
    this.form = this.root.querySelector("form")!;
    this.status = this.root.querySelector("[data-status]")!;
    this.audioStatus = this.root.querySelector("[data-audio-status]");

    const bgmInput = control<HTMLInputElement>(this.root, "bgmVolume");
    const sfxInput = control<HTMLInputElement>(this.root, "sfxVolume");
    const bgmVal = this.root.querySelector<HTMLElement>("[data-bgm-val]");
    const sfxVal = this.root.querySelector<HTMLElement>("[data-sfx-val]");

    const updateVolumeLabels = () => {
      if (bgmVal) bgmVal.textContent = `${Math.round(Number(bgmInput.value) * 100)}%`;
      if (sfxVal) sfxVal.textContent = `${Math.round(Number(sfxInput.value) * 100)}%`;
    };
    bgmInput.addEventListener("input", updateVolumeLabels);
    sfxInput.addEventListener("input", updateVolumeLabels);

    this.root.querySelector("[data-scan-audio]")?.addEventListener("click", async () => {
      const dir = control<HTMLInputElement>(this.root, "audioDirectory").value.trim();
      if (this.audioStatus) this.audioStatus.textContent = "Scanning audio files...";
      try {
        if (this.options.onScanAudio) {
          const res = await this.options.onScanAudio(dir);
          if (res && typeof res === "object" && "bgmCount" in res) {
            if (this.audioStatus) this.audioStatus.textContent = `Scanned ${res.bgmCount} BGM, ${res.sfxCount} SFX.`;
          }
        }
      } catch (err) {
        if (this.audioStatus) this.audioStatus.textContent = err instanceof Error ? err.message : String(err);
      }
    });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        this.options.onSave(this.read());
        this.markClean();
        this.setStatus("Settings saved.", "saved", 3000);
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : String(error), "error");
      }
    });
    // Any manual edit flags unsaved changes next to the always-visible Save button.
    const markDirty = () => this.markDirty();
    this.form.addEventListener("input", markDirty);
    this.form.addEventListener("change", markDirty);
    // Ctrl+S / Cmd+S saves from anywhere inside the panel.
    this.form.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        this.form.requestSubmit();
      }
    });
    this.root.querySelector("[data-open-preview]")?.addEventListener("click", () => options.onOpenPreview());
    this.root.querySelector("[data-refresh-connections]")?.addEventListener("click", () => options.onRefreshConnections());
    control<HTMLSelectElement>(this.root, "imageConnectionId").addEventListener("change", (e) => {
      this.selectedConnectionIds.image = (e.target as HTMLSelectElement).value || null;
      this.updateImageModelHint();
    });
    control<HTMLSelectElement>(this.root, "parserConnectionId").addEventListener("change", (e) => {
      this.selectedConnectionIds.planner = (e.target as HTMLSelectElement).value || null;
    });
    // Reset is destructive (it immediately saves the defaults), so it needs a
    // second confirming click within four seconds.
    const resetButton = this.root.querySelector<HTMLButtonElement>("[data-reset]");
    resetButton?.addEventListener("click", () => {
      if (!resetButton.hasAttribute("data-confirming")) {
        resetButton.setAttribute("data-confirming", "");
        resetButton.textContent = "Confirm reset?";
        this.setStatus("Click again to reset every setting to its default.", "dirty");
        if (this.resetTimer) clearTimeout(this.resetTimer);
        this.resetTimer = setTimeout(() => {
          resetButton.removeAttribute("data-confirming");
          resetButton.textContent = "Reset defaults";
          this.setStatus("", "idle");
        }, 4000);
        return;
      }
      if (this.resetTimer) clearTimeout(this.resetTimer);
      resetButton.removeAttribute("data-confirming");
      resetButton.textContent = "Reset defaults";
      this.setConfig(DEFAULT_CONFIG);
      this.options.onSave(DEFAULT_CONFIG);
      this.markClean();
      this.setStatus("Defaults restored.", "saved", 3000);
    });

    // Prompt presets: selecting fills the fields; save/delete persist instantly.
    const presetSelect = control<HTMLSelectElement>(this.root, "promptPresetSelect");
    const presetName = control<HTMLInputElement>(this.root, "promptPresetName");
    presetSelect.addEventListener("change", () => {
      const preset = this.promptPresets.find((candidate) => candidate.id === presetSelect.value);
      if (!preset) return;
      control<HTMLInputElement>(this.root, "promptPrefix").value = preset.positive;
      control<HTMLInputElement>(this.root, "negativePrompt").value = preset.negative;
      presetName.value = preset.name;
      this.markDirty();
    });
    this.root.querySelector("[data-preset-save]")?.addEventListener("click", () => {
      const name = presetName.value.trim();
      if (!name) {
        this.setStatus("Give the preset a name first.", "error");
        return;
      }
      const positive = control<HTMLInputElement>(this.root, "promptPrefix").value;
      const negative = control<HTMLInputElement>(this.root, "negativePrompt").value;
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
      try {
        this.options.onSave({ promptPresets: this.promptPresets.map((preset) => ({ ...preset })) });
        this.setStatus(`Preset "${name}" ${existing ? "updated" : "saved"}.`, "saved", 3000);
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : String(error), "error");
      }
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
      try {
        this.options.onSave({ promptPresets: this.promptPresets.map((preset) => ({ ...preset })) });
        this.setStatus(`Preset "${selected.name}" deleted.`, "saved", 3000);
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : String(error), "error");
      }
    });
  }

  private markDirty(): void {
    if (this.dirty) return;
    this.dirty = true;
    this.root.querySelector("[data-save]")?.setAttribute("data-dirty", "");
    this.setStatus("Unsaved changes", "dirty");
  }

  private markClean(): void {
    this.dirty = false;
    this.root.querySelector("[data-save]")?.removeAttribute("data-dirty");
  }

  private setStatus(text: string, kind: "idle" | "saved" | "dirty" | "error", clearAfterMs?: number): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    this.status.textContent = text;
    this.status.dataset.kind = kind;
    if (clearAfterMs) {
      this.statusTimer = setTimeout(() => {
        // Do not clobber a dirty notice that appeared after saving.
        if (this.status.dataset.kind === kind) {
          this.status.textContent = this.dirty ? "Unsaved changes" : "";
          this.status.dataset.kind = this.dirty ? "dirty" : "idle";
        }
      }, clearAfterMs);
    }
  }

  setAudioStatus(message: string): void {
    if (this.audioStatus) this.audioStatus.textContent = message;
  }

  setConfig(config: VisualNovelConfig): void {
    control<HTMLSelectElement>(this.root, "mode").value = config.mode;
    control<HTMLSelectElement>(this.root, "themePreset").value = config.themePreset;
    control<HTMLSelectElement>(this.root, "sceneImageFit").value = config.sceneImageFit;
    control<HTMLInputElement>(this.root, "autoEnter").checked = config.autoEnter;
    control<HTMLInputElement>(this.root, "generateImages").checked = config.generateImages;
    control<HTMLInputElement>(this.root, "referenceAnchoring").checked = config.referenceAnchoring;
    control<HTMLInputElement>(this.root, "useNativeCardImages").checked = config.useNativeCardImages;
    control<HTMLInputElement>(this.root, "generateChoices").checked = config.generateChoices;
    control<HTMLInputElement>(this.root, "maxImagesPerTurn").value = String(config.maxImagesPerTurn);
    control<HTMLInputElement>(this.root, "textSpeed").value = String(config.textSpeed);
    control<HTMLInputElement>(this.root, "autoPlayDelay").value = String(config.autoPlayDelay);
    control<HTMLSelectElement>(this.root, "skipMode").value = config.skipMode;
    control<HTMLInputElement>(this.root, "audioDirectory").value = config.audioDirectory;
    control<HTMLInputElement>(this.root, "bgmVolume").value = String(config.bgmVolume);
    control<HTMLInputElement>(this.root, "sfxVolume").value = String(config.sfxVolume);
    const bgmLabel = this.root.querySelector<HTMLElement>("[data-bgm-val]");
    const sfxLabel = this.root.querySelector<HTMLElement>("[data-sfx-val]");
    if (bgmLabel) bgmLabel.textContent = `${Math.round(config.bgmVolume * 100)}%`;
    if (sfxLabel) sfxLabel.textContent = `${Math.round(config.sfxVolume * 100)}%`;
    this.selectedConnectionIds.planner = config.parserConnectionId;
    this.selectedConnectionIds.image = config.imageConnectionId;
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
    this.promptPresets = config.promptPresets.map((preset) => ({ ...preset }));
    this.renderPromptPresetOptions(control<HTMLSelectElement>(this.root, "promptPresetSelect").value);
    control<HTMLTextAreaElement>(this.root, "customPlannerInstructions").value = config.customPlannerInstructions;
    control<HTMLInputElement>(this.root, "ignoredTags").value = config.ignoredTags;
    control<HTMLTextAreaElement>(this.root, "displayRegexRules").value = config.displayRegexRules;
    control<HTMLTextAreaElement>(this.root, "customCss").value = config.customCss;
    this.updateImageModelHint();
    // The form now mirrors the saved config exactly.
    this.markClean();
    if (this.status.dataset.kind === "dirty") this.setStatus("", "idle");
  }

  setConnectionCatalog(kind: ConnectionCatalogKind, state: ConnectionCatalogState): void {
    this.connectionStates[kind] = state;
    const select = control<HTMLSelectElement>(
      this.root,
      kind === "planner" ? "parserConnectionId" : "imageConnectionId",
    );
    const configId = select.value || this.selectedConnectionIds[kind];
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
      referenceAnchoring: control<HTMLInputElement>(this.root, "referenceAnchoring").checked,
      useNativeCardImages: control<HTMLInputElement>(this.root, "useNativeCardImages").checked,
      generateChoices: control<HTMLInputElement>(this.root, "generateChoices").checked,
      maxImagesPerTurn: Number(control<HTMLInputElement>(this.root, "maxImagesPerTurn").value),
      textSpeed: Number(control<HTMLInputElement>(this.root, "textSpeed").value),
      autoPlayDelay: Number(control<HTMLInputElement>(this.root, "autoPlayDelay").value),
      skipMode: control<HTMLSelectElement>(this.root, "skipMode").value === "all" ? "all" : "read",
      audioDirectory: control<HTMLInputElement>(this.root, "audioDirectory").value.trim(),
      bgmVolume: Number(control<HTMLInputElement>(this.root, "bgmVolume").value),
      sfxVolume: Number(control<HTMLInputElement>(this.root, "sfxVolume").value),
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
      promptPresets: this.promptPresets.map((preset) => ({ ...preset })),
      customPlannerInstructions: control<HTMLTextAreaElement>(this.root, "customPlannerInstructions").value,
      ignoredTags: control<HTMLInputElement>(this.root, "ignoredTags").value,
      displayRegexRules: control<HTMLTextAreaElement>(this.root, "displayRegexRules").value,
      customCss: control<HTMLTextAreaElement>(this.root, "customCss").value
    };
  }

  private selectedConnectionIds: Record<ConnectionCatalogKind, string | null> = {
    planner: null,
    image: null,
  };

  private promptPresets: VisualNovelPromptPreset[] = [];

  private renderPromptPresetOptions(selectedId: string): void {
    const select = control<HTMLSelectElement>(this.root, "promptPresetSelect");
    const options = [
      { value: "", label: "Custom (no preset)" },
      ...this.promptPresets.map((preset) => ({ value: preset.id, label: preset.name }))
    ];
    select.replaceChildren(...options.map((item) => {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      return option;
    }));
    select.value = this.promptPresets.some((preset) => preset.id === selectedId) ? selectedId : "";
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
