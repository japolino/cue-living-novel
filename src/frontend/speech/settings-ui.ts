import { DEFAULT_SPEECH_SETTINGS, type SpeechSettings } from "../../speech-config.js";
import { SETTINGS_TOKENS_CSS } from "../settings/controls-css.js";

/**
 * Self-contained read-aloud settings. The host controller mounts it inside the
 * settings panel's Voice section (`VisualNovelSettingsPanel.voiceMount()`),
 * which is shown only while the Choir extension is present; it keeps its own
 * shadow root and save path, and shares the panel's look through
 * SETTINGS_TOKENS_CSS. Voices are cast in Choir, so Cue has no voice pickers.
 */
export type SpeechSettingsSectionOptions = {
  mount: HTMLElement;
  onSave: (speech: SpeechSettings) => void;
  onOpenChoir?: (() => void) | undefined;
  isChoirAvailable?: (() => boolean) | undefined;
  onMuteNarratorChange?: ((muted: boolean) => void) | undefined;
  /** True when the installed Choir can switch its sound on and off for Cue. */
  canControlChoirSound?: (() => boolean) | undefined;
  onChoirSoundChange?: ((on: boolean) => void) | undefined;
};

const SECTION_CSS = `${SETTINGS_TOKENS_CSS}
[data-speech-root] { display: grid; gap: .9rem; }
[data-speech-card] { display: grid; gap: .75rem; min-width: 0; margin: 0; padding: 1rem 1.05rem 1.1rem; border: 1px solid var(--set-border); border-radius: var(--set-radius); background: var(--set-surface); }
[data-speech-card] > header { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem .65rem; }
h3 { flex: 1 1 auto; font-size: .98rem; font-weight: 650; line-height: 1.3; }
[data-speech-state] { padding: .05rem .6rem; border-radius: 999px; border: 1px solid var(--set-border); font-size: .76rem; font-weight: 650; color: var(--set-muted); }
[data-speech-state][data-on] { border-color: color-mix(in srgb, var(--set-success) 60%, transparent); color: var(--set-success); }
.check { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: .7rem; min-height: var(--set-control); padding: .45rem .2rem; font-weight: 550; cursor: pointer; }
.check input { margin-top: .17rem; }
.check small { margin-top: .1rem; }
.actions { display: flex; flex-wrap: wrap; gap: .55rem .75rem; align-items: center; }
:host { container-type: inline-size; }
@container (max-width: 520px) {
  [data-speech-card] { padding: .85rem .8rem .95rem; }
}
`;

function card(title: string, ...children: Node[]): HTMLElement {
  const section = document.createElement("section");
  section.setAttribute("data-speech-card", "");
  const header = document.createElement("header");
  const heading = document.createElement("h3");
  heading.textContent = title;
  header.append(heading);
  section.append(header, ...children);
  return section;
}

function checkRow(field: string, checked: boolean, title: string, help: string, onChange: (checked: boolean) => void): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("data-speech-field", field);
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const text = document.createElement("span");
  text.textContent = title;
  const small = document.createElement("small");
  small.textContent = help;
  text.append(small);
  label.append(input, text);
  return label;
}

export class SpeechSettingsSection {
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private settings: SpeechSettings = DEFAULT_SPEECH_SETTINGS;
  private destroyed = false;

  constructor(private readonly options: SpeechSettingsSectionOptions) {
    this.host = document.createElement("div");
    this.host.className = "vn-speech-settings";
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.render();
    options.mount.appendChild(this.host);
  }

  setConfig(speech: SpeechSettings): void {
    if (this.destroyed) return;
    const changed = JSON.stringify(this.settings) !== JSON.stringify(speech);
    this.settings = speech;
    if (changed) this.render();
  }

  /** Re-renders after the host's Choir capabilities change (Choir loaded or left). */
  refresh(): void {
    if (!this.destroyed) this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.host.remove();
  }

  /* ---------------------------------------------------------------------- */

  private save(mutate: (next: SpeechSettings) => void): void {
    const next: SpeechSettings = { ...this.settings };
    mutate(next);
    this.settings = next;
    this.options.onSave(next);
    this.render();
  }

  private render(): void {
    if (this.destroyed) return;
    const settings = this.settings;
    const style = document.createElement("style");
    style.textContent = SECTION_CSS;
    const body = document.createElement("div");
    body.setAttribute("data-speech-root", "");

    if (!this.options.isChoirAvailable?.()) {
      const note = document.createElement("p");
      note.className = "muted";
      note.textContent = "Read aloud is voiced by the Choir extension. Install and turn on Choir in Lumiverse to use it.";
      body.append(card("Read aloud", note));
      this.shadow.replaceChildren(style, body);
      return;
    }

    const summaryState = document.createElement("span");
    summaryState.setAttribute("data-speech-state", "");
    summaryState.toggleAttribute("data-on", settings.enabled);
    summaryState.textContent = settings.enabled ? "On" : "Off";

    const enable = checkRow(
      "enable",
      settings.enabled,
      "Read each paragraph aloud",
      "Off by default. Choir reads each paragraph as it appears, with the voices you cast in Choir. Each paragraph is one request on the voice service set up in Choir, which may cost credits.",
      (checked) => this.save((next) => { next.enabled = checked; }),
    );
    const muteNarrator = checkRow(
      "mute-narrator",
      settings.muteNarrator,
      "Mute narrator (dialogue only)",
      "Only character dialogue is voiced. Descriptive narration and story beats stay silent.",
      (checked) => {
        this.options.onMuteNarratorChange?.(checked);
        this.save((next) => { next.muteNarrator = checked; });
      },
    );
    const speechCard = card("Read aloud", enable, muteNarrator);
    speechCard.querySelector("header")!.append(summaryState);
    if (this.options.canControlChoirSound?.()) {
      speechCard.append(checkRow(
        "choir-sound",
        settings.choirSound,
        "Sound from Choir",
        "On by default. While read aloud is on, Choir plays Freesound sound effects, looping ambience and incompetech music with each paragraph, and Cue's own music and sound effects stay quiet. Off keeps Cue's own sound.",
        (checked) => {
          this.options.onChoirSoundChange?.(checked);
          this.save((next) => { next.choirSound = checked; });
        },
      ));
    }

    const openChoir = document.createElement("button");
    openChoir.type = "button";
    openChoir.setAttribute("data-speech-field", "open-choir");
    openChoir.textContent = "Open Choir voice setup";
    openChoir.addEventListener("click", () => this.options.onOpenChoir?.());
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(openChoir);
    const castingNote = document.createElement("p");
    castingNote.className = "muted";
    castingNote.textContent = "Choir casts the narrator, your persona and each character, with Gemini voice styles, Fish Audio voices and voices for new characters.";
    const castingWrap = document.createElement("div");
    castingWrap.append(castingNote, actions);

    body.append(speechCard, card("Voices", castingWrap));
    this.shadow.replaceChildren(style, body);
  }
}
