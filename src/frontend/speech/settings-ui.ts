import {
  DEFAULT_SPEECH_SETTINGS,
  type SpeechSettings,
  type SpeechVoiceRef,
} from "../../speech-config.js";
import { GEMINI_AUDIO_TAG_SUGGESTIONS } from "./delivery.js";
import { characterOverrideKey, speakerNameKey } from "./voice-resolution.js";
import type { SafeTtsProfile, VoiceOption } from "./transport.js";
import { SETTINGS_TOKENS_CSS } from "../settings/controls-css.js";

/**
 * Self-contained speech settings. The host controller mounts it inside the
 * settings panel's Voice section (`VisualNovelSettingsPanel.voiceMount()`);
 * it keeps its own shadow root and save path, and shares the panel's look
 * through SETTINGS_TOKENS_CSS.
 *
 * Truthfulness rules:
 * - profiles/voices load ONLY on explicit button presses (the voices endpoint
 *   may contact the provider for metadata; it never synthesizes);
 * - a saved profile id missing from the loaded list is shown as
 *   "saved profile not in this list", never silently replaced;
 * - custom/free-text voice ids are preserved verbatim;
 * - delivery tags are documented as Gemini-family guidance only.
 */
export type SpeechSettingsSectionOptions = {
  mount: HTMLElement;
  onSave: (speech: SpeechSettings) => void;
  listProfiles: () => Promise<SafeTtsProfile[]>;
  listVoices: (connectionId: string) => Promise<VoiceOption[]>;
  /** Active chat id, used to scope per-character overrides. Empty = no chat. */
  getChatId: () => string;
};

const SECTION_CSS = `${SETTINGS_TOKENS_CSS}
[data-speech-root] { display: grid; gap: .9rem; }
[data-speech-card], fieldset { display: grid; gap: .75rem; min-width: 0; margin: 0; padding: 1rem 1.05rem 1.1rem; border: 1px solid var(--set-border); border-radius: var(--set-radius); background: var(--set-surface); }
[data-speech-card] > header { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem .65rem; }
h3, legend { font-size: .98rem; font-weight: 650; line-height: 1.3; }
h3 { flex: 1 1 auto; }
legend { float: left; width: 100%; padding: 0; margin: 0 0 .1rem; }
[data-speech-state] { padding: .05rem .6rem; border-radius: 999px; border: 1px solid var(--set-border); font-size: .76rem; font-weight: 650; color: var(--set-muted); }
[data-speech-state][data-on] { border-color: color-mix(in srgb, var(--set-success) 60%, transparent); color: var(--set-success); }
label, .field { display: grid; gap: .35rem; font-weight: 600; font-size: .93rem; min-width: 0; }
.check { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: .7rem; min-height: var(--set-control); padding: .45rem .2rem; font-weight: 550; cursor: pointer; }
.check input { margin-top: .17rem; }
.check small { margin-top: .1rem; }
.row { display: grid; gap: .5rem; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: end; }
.voice-row { display: grid; gap: .5rem; grid-template-columns: minmax(0, 1fr) auto; align-items: end; }
.actions { display: flex; flex-wrap: wrap; gap: .55rem .75rem; align-items: center; }
.actions small { flex: 1 1 14rem; }
:host { container-type: inline-size; }
@container (max-width: 520px) {
  .row, .voice-row { grid-template-columns: 1fr; }
  [data-speech-card], fieldset { padding: .85rem .8rem .95rem; }
}
[data-speech-status][data-tone="error"] { color: var(--set-danger); }
.warn { padding: .5rem .7rem; border-radius: .6rem; background: color-mix(in srgb, var(--set-warning) 10%, transparent); font-size: .84rem; color: var(--set-warning); }
`;

function moreDisclosure(text: string): HTMLDetailsElement {
  const details = document.createElement("details");
  details.setAttribute("data-more", "");
  const summary = document.createElement("summary");
  summary.textContent = "More";
  const body = document.createElement("p");
  body.textContent = text;
  details.append(summary, body);
  return details;
}

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

type ProfilesState =
  | { status: "idle" | "loading"; profiles: SafeTtsProfile[] }
  | { status: "ready"; profiles: SafeTtsProfile[] }
  | { status: "error"; profiles: SafeTtsProfile[]; error: string };

export class SpeechSettingsSection {
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  private settings: SpeechSettings = DEFAULT_SPEECH_SETTINGS;
  private profiles: ProfilesState = { status: "idle", profiles: [] };
  private voiceOptions = new Map<string, VoiceOption[]>();
  /**
   * Character names typed via "Add" that have no saved voice yet. They are
   * kept as local drafts — never written to config — because the normalizer
   * drops voice refs with an empty profile id, which would make a freshly
   * added row vanish on the save echo before a profile can be chosen.
   */
  private pendingOverrideNames = new Set<string>();
  /** Uncommitted character name in the Add input; preserved across re-renders. */
  private draftAddName = "";
  /** Uncommitted text values for actively edited fields (e.g. delivery tag, voice inputs). */
  private activeDrafts = new Map<string, string>();
  /** Tracked chat id to clear uncommitted name drafts on chat switch. */
  private lastChatId = "";
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
    const previous = this.settings;
    this.settings = speech;
    // Drafts that have since been saved (here or elsewhere) stop being drafts.
    let draftsRemoved = false;
    for (const key of [...this.pendingOverrideNames]) {
      if (speech.characters[key]) {
        this.pendingOverrideNames.delete(key);
        draftsRemoved = true;
      }
    }
    const changed = JSON.stringify(previous) !== JSON.stringify(speech);
    if (changed || draftsRemoved) {
      this.render();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.host.remove();
  }

  /* ---------------------------------------------------------------------- */

  private save(mutate: (next: SpeechSettings) => void): void {
    const next: SpeechSettings = JSON.parse(JSON.stringify(this.settings)) as SpeechSettings;
    mutate(next);
    this.settings = next;
    this.options.onSave(next);
    this.render();
  }

  private profileSelect(
    selected: SpeechVoiceRef | null,
    fieldKey: string,
    onChange: (ref: SpeechVoiceRef | null) => void,
  ): HTMLSelectElement {
    const select = document.createElement("select");
    select.setAttribute("data-speech-field", fieldKey);
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Not set";
    select.appendChild(none);
    for (const profile of this.profiles.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      const details = [profile.provider, profile.model].filter(Boolean).join(" · ");
      option.textContent = `${profile.name}${details ? ` (${details})` : ""}${profile.isDefault ? " · Default" : ""}`;
      select.appendChild(option);
    }
    if (selected && !this.profiles.profiles.some((profile) => profile.id === selected.connectionId)) {
      const missing = document.createElement("option");
      missing.value = selected.connectionId;
      missing.textContent = this.profiles.status === "ready"
        ? `Saved profile not in this list (${selected.connectionId})`
        : `Saved profile (${selected.connectionId}) — press “Load profiles” to check`;
      select.appendChild(missing);
    }
    select.value = selected?.connectionId ?? "";
    select.addEventListener("change", () => {
      const id = select.value;
      if (!id) { onChange(null); return; }
      // Keep a previously chosen voice override only when the profile stays the same.
      const voice = selected && selected.connectionId === id ? selected.voice : "";
      onChange({ connectionId: id, voice });
    });
    return select;
  }

  private voiceField(
    selected: SpeechVoiceRef | null,
    fieldKey: string,
    onChange: (ref: SpeechVoiceRef) => void,
  ): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "field";
    const label = document.createElement("span");
    label.textContent = "Voice (optional)";
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("data-speech-field", fieldKey);
    input.placeholder = "Profile default voice";
    const draftVoice = this.activeDrafts.get(fieldKey);
    input.value = draftVoice !== undefined ? draftVoice : (selected?.voice ?? "");
    input.disabled = !selected;
    const listId = `voices-${Math.random().toString(36).slice(2, 8)}`;
    const datalist = document.createElement("datalist");
    datalist.id = listId;
    input.setAttribute("list", listId);
    if (selected) {
      for (const voice of this.voiceOptions.get(selected.connectionId) ?? []) {
        const option = document.createElement("option");
        option.value = voice.id; // the returned id, never the display name
        option.label = voice.name;
        datalist.appendChild(option);
      }
    }
    input.addEventListener("input", () => {
      this.activeDrafts.set(fieldKey, input.value);
      if (selected) selected.voice = input.value;
    });
    input.addEventListener("change", () => {
      this.activeDrafts.delete(fieldKey);
      if (selected) onChange({ ...selected, voice: input.value });
    });
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.textContent = "Load voices";
    loadButton.disabled = !selected;
    const status = document.createElement("small");
    loadButton.addEventListener("click", async () => {
      if (!selected) return;
      loadButton.disabled = true;
      status.textContent = "Asking the host for this profile’s voices…";
      try {
        const voices = await this.options.listVoices(selected.connectionId);
        this.voiceOptions.set(selected.connectionId, voices);
        status.textContent = voices.length ? `${voices.length} voice(s) listed. Free text is still allowed.` : "The provider listed no voices; type a voice id manually.";
        datalist.replaceChildren(...voices.map((voice) => {
          const option = document.createElement("option");
          option.value = voice.id;
          option.label = voice.name;
          return option;
        }));
      } catch (error) {
        status.textContent = `Could not list voices: ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        loadButton.disabled = !selected;
      }
    });
    const row = document.createElement("div");
    row.className = "voice-row";
    const inputWrap = document.createElement("div");
    inputWrap.append(input, datalist);
    row.append(inputWrap, loadButton);
    wrap.append(label, row, status);
    return wrap;
  }

  private voiceRefEditor(
    title: string,
    help: string,
    selected: SpeechVoiceRef | null,
    fieldPrefix: string,
    apply: (next: SpeechSettings, ref: SpeechVoiceRef | null) => void,
  ): HTMLElement {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = title;
    const helpEl = document.createElement("small");
    helpEl.textContent = help;
    const select = this.profileSelect(selected, `${fieldPrefix}-profile`, (ref) => this.save((next) => apply(next, ref)));
    const voice = this.voiceField(selected, `${fieldPrefix}-voice`, (ref) => this.save((next) => apply(next, ref)));
    fieldset.append(legend, helpEl, select, voice);
    return fieldset;
  }

  private render(): void {
    if (this.destroyed) return;

    // Capture focus & text selection before DOM replacement
    const activeEl = this.shadow.activeElement as HTMLElement | null;
    const activeField = activeEl?.getAttribute("data-speech-field");
    let selectionStart: number | null = null;
    let selectionEnd: number | null = null;
    if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
      try {
        selectionStart = activeEl.selectionStart;
        selectionEnd = activeEl.selectionEnd;
        if (activeField) {
          this.activeDrafts.set(activeField, activeEl.value);
        }
      } catch { /* ignored for non-text inputs */ }
    }

    const currentChatId = this.options.getChatId();
    if (currentChatId !== this.lastChatId) {
      this.lastChatId = currentChatId;
      this.draftAddName = "";
      this.activeDrafts.clear();
    }

    const settings = this.settings;
    const style = document.createElement("style");
    style.textContent = SECTION_CSS;
    const body = document.createElement("div");
    body.setAttribute("data-speech-root", "");
    // Kept for hosts/tests that read the visible on/off state.
    const summaryState = document.createElement("span");
    summaryState.setAttribute("data-speech-state", "");
    summaryState.toggleAttribute("data-on", settings.enabled);
    summaryState.textContent = settings.enabled ? "On" : "Off";

    // Enable
    const enable = document.createElement("label");
    enable.className = "check";
    const enableInput = document.createElement("input");
    enableInput.type = "checkbox";
    enableInput.setAttribute("data-speech-field", "enable");
    enableInput.checked = settings.enabled;
    enableInput.addEventListener("change", () => this.save((next) => { next.enabled = enableInput.checked; }));
    const enableText = document.createElement("span");
    enableText.innerHTML = "Read the current paragraph aloud with your saved Lumiverse TTS profiles<small>Off by default. Text is sent only when you press Play (or turn on auto-play). Each request can cost provider credits.</small>";
    enableText.append(moreDisclosure("Cue sends text to your Lumiverse server, which forwards it to the TTS provider of the chosen profile. Cue never reads or stores API keys."));
    enable.append(enableInput, enableText);

    // Host autoplay overlap warning (truthful: coordination not verified).
    const overlap = document.createElement("p");
    overlap.className = "warn";
    overlap.textContent = "If Lumiverse’s own TTS auto-play is also on, both may speak the same message. Cue does not change that setting; turn one of them off.";

    // Profiles loader
    const loadRow = document.createElement("div");
    loadRow.className = "actions";
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.setAttribute("data-speech-field", "load-profiles");
    loadButton.textContent = this.profiles.status === "loading" ? "Loading profiles…" : "Load profiles";
    loadButton.disabled = this.profiles.status === "loading";
    const loadStatus = document.createElement("small");
    loadStatus.setAttribute("data-speech-status", "");
    if (this.profiles.status === "ready") loadStatus.textContent = `${this.profiles.profiles.length} saved TTS profile(s). Listing is metadata only — nothing was synthesized or tested.`;
    if (this.profiles.status === "error") { loadStatus.textContent = this.profiles.error; loadStatus.setAttribute("data-tone", "error"); }
    if (this.profiles.status === "idle") loadStatus.textContent = "Profiles are listed only when you ask. Saved choices keep working without loading this list.";
    loadButton.addEventListener("click", async () => {
      this.profiles = { status: "loading", profiles: this.profiles.profiles };
      this.render();
      try {
        const profiles = await this.options.listProfiles();
        this.profiles = { status: "ready", profiles };
      } catch (error) {
        this.profiles = { status: "error", profiles: this.profiles.profiles, error: `Could not list profiles: ${error instanceof Error ? error.message : String(error)}` };
      }
      this.render();
    });
    loadRow.append(loadButton, loadStatus);

    const narrator = this.voiceRefEditor(
      "Narrator voice",
      "Used for narration paragraphs. When not set, the character default is tried; otherwise narration stays silent with a hint.",
      settings.narrator,
      "narrator",
      (next, ref) => { next.narrator = ref; },
    );
    const fallback = this.voiceRefEditor(
      "Character default voice",
      "Used for any speaking character without an override below.",
      settings.characterDefault,
      "character-default",
      (next, ref) => { next.characterDefault = ref; },
    );

    // Per-character overrides, scoped to the active chat.
    const overrides = document.createElement("fieldset");
    const overridesLegend = document.createElement("legend");
    overridesLegend.textContent = "Character voices (this chat)";
    overrides.appendChild(overridesLegend);
    const overridesHelp = document.createElement("small");
    const chatId = currentChatId;
    overridesHelp.textContent = chatId
      ? "Overrides are matched by the speaker name shown on the nameplate and apply to this chat only, so the same name in another chat keeps its own voice. A paragraph mixing narration and dialogue is spoken with one voice."
      : "Open a chat first to add character overrides (they are scoped per chat).";
    overrides.appendChild(overridesHelp);
    if (chatId) {
      const prefix = `chat::${chatId}::`;
      for (const [key, ref] of Object.entries(settings.characters)) {
        if (!key.startsWith(prefix)) continue;
        const row = document.createElement("div");
        row.className = "row";
        row.setAttribute("data-speech-override-row", key.slice(prefix.length));
        const name = document.createElement("input");
        name.type = "text";
        name.value = key.slice(prefix.length);
        name.disabled = true;
        const select = this.profileSelect(ref, `override-profile-${key}`, (nextRef) => this.save((next) => {
          if (nextRef) next.characters[key] = nextRef;
          else delete next.characters[key];
        }));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => this.save((next) => { delete next.characters[key]; }));
        row.append(name, select, remove);
        overrides.appendChild(row);
        overrides.appendChild(this.voiceField(ref, `override-voice-${key}`, (nextRef) => this.save((next) => { next.characters[key] = nextRef; })));
      }
      for (const key of [...this.pendingOverrideNames].sort()) {
        if (!key.startsWith(prefix) || settings.characters[key]) continue;
        const row = document.createElement("div");
        row.className = "row";
        row.setAttribute("data-speech-draft-row", key.slice(prefix.length));
        const name = document.createElement("input");
        name.type = "text";
        name.value = key.slice(prefix.length);
        name.disabled = true;
        const select = this.profileSelect(null, `draft-profile-${key}`, (nextRef) => {
          // Nothing is saved until a real profile is chosen; picking
          // "Not set" keeps the draft on screen.
          if (!nextRef) return;
          this.pendingOverrideNames.delete(key);
          this.save((next) => { next.characters[key] = nextRef; });
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => {
          this.pendingOverrideNames.delete(key);
          this.render();
        });
        row.append(name, select, remove);
        overrides.appendChild(row);
      }
      const addRow = document.createElement("div");
      addRow.className = "row";
      const addName = document.createElement("input");
      addName.type = "text";
      addName.setAttribute("data-speech-field", "add-character-name");
      addName.placeholder = "Character name (as shown on the nameplate)";
      addName.value = this.draftAddName;
      addName.addEventListener("input", () => {
        this.draftAddName = addName.value;
      });
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.setAttribute("data-speech-field", "add-character-button");
      addButton.textContent = "Add";

      const commitAdd = () => {
        const name = (this.draftAddName || addName.value).trim();
        if (!name || !speakerNameKey(name)) return;
        const key = characterOverrideKey(chatId, name);
        if (settings.characters[key] || this.pendingOverrideNames.has(key)) return;
        // Local draft only: saving an empty profile id would be dropped by
        // the config normalizer and the row would vanish on the save echo.
        this.pendingOverrideNames.add(key);
        this.draftAddName = "";
        this.render();
      };

      addName.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitAdd();
        }
      });
      addButton.addEventListener("click", commitAdd);

      const spacer = document.createElement("span");
      addRow.append(addName, spacer, addButton);
      overrides.appendChild(addRow);
    }

    // Delivery mode
    const delivery = document.createElement("fieldset");
    const deliveryLegend = document.createElement("legend");
    deliveryLegend.textContent = "Delivery style (experimental)";
    const deliveryHelp = document.createElement("small");
    deliveryHelp.textContent = "“Gemini audio tags” adds one tag like [whispers] to the spoken text only. The visible prose never changes.";
    const deliveryMore = moreDisclosure("This follows Google’s Gemini speech-generation guide. It is probabilistic guidance for Gemini-family TTS models routed through your profile and has no exhaustive supported list. Other providers may read the bracket text aloud. Cue never makes extra LLM calls to pick emotions — you choose the tag.");
    const modeSelect = document.createElement("select");
    modeSelect.setAttribute("data-speech-field", "delivery-mode");
    for (const [value, label] of [["none", "None — send the prose unchanged (default)"], ["gemini-audio-tags", "Gemini audio tags — prepend a chosen [tag]"]] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      modeSelect.appendChild(option);
    }
    modeSelect.value = settings.deliveryMode;
    modeSelect.addEventListener("change", () => this.save((next) => { next.deliveryMode = modeSelect.value === "gemini-audio-tags" ? "gemini-audio-tags" : "none"; }));
    const tagLabel = document.createElement("label");
    const tagTitle = document.createElement("span");
    tagTitle.textContent = "Tag (without brackets)";
    const tagInput = document.createElement("input");
    tagInput.type = "text";
    tagInput.setAttribute("data-speech-field", "delivery-tag");
    tagInput.placeholder = "e.g. whispers — empty sends no tag";
    const draftTag = this.activeDrafts.get("delivery-tag");
    tagInput.value = draftTag !== undefined ? draftTag : settings.deliveryTag;
    const tagListId = "gemini-tags";
    const tagList = document.createElement("datalist");
    tagList.id = tagListId;
    for (const tag of GEMINI_AUDIO_TAG_SUGGESTIONS) {
      const option = document.createElement("option");
      option.value = tag;
      tagList.appendChild(option);
    }
    tagInput.setAttribute("list", tagListId);
    tagInput.addEventListener("input", () => {
      this.activeDrafts.set("delivery-tag", tagInput.value);
      this.settings.deliveryTag = tagInput.value;
    });
    tagInput.addEventListener("change", () => {
      this.activeDrafts.delete("delivery-tag");
      this.save((next) => { next.deliveryTag = tagInput.value.trim(); });
    });
    tagLabel.append(tagTitle, tagInput, tagList);
    tagLabel.hidden = settings.deliveryMode !== "gemini-audio-tags";
    const compat = document.createElement("label");
    compat.className = "check";
    const compatInput = document.createElement("input");
    compatInput.type = "checkbox";
    compatInput.setAttribute("data-speech-field", "delivery-compat");
    compatInput.checked = settings.deliveryAllProviders;
    compatInput.addEventListener("change", () => this.save((next) => { next.deliveryAllProviders = compatInput.checked; }));
    const compatText = document.createElement("span");
    compatText.innerHTML = "Compatibility: also send the tag to non-Gemini profiles<small>Off by default. Cue checks the selected profile’s model before each Play and only adds the tag for Gemini-family models. On sends the tag to any provider, which may read it aloud.</small>";
    compat.append(compatInput, compatText);
    compat.hidden = settings.deliveryMode !== "gemini-audio-tags";
    delivery.append(deliveryLegend, deliveryHelp, deliveryMore, modeSelect, tagLabel, compat);

    // Autoplay + volume
    const autoplay = document.createElement("label");
    autoplay.className = "check";
    const autoplayInput = document.createElement("input");
    autoplayInput.type = "checkbox";
    autoplayInput.setAttribute("data-speech-field", "autoplay");
    autoplayInput.checked = settings.autoplay;
    autoplayInput.addEventListener("change", () => this.save((next) => { next.autoplay = autoplayInput.checked; }));
    const autoplayText = document.createElement("span");
    autoplayText.innerHTML = "Auto-play each new paragraph<small>Starts only after you press Play once (browsers require a user gesture). Each paragraph is one synthesis request on your TTS profile.</small>";
    autoplay.append(autoplayInput, autoplayText);

    const volume = document.createElement("label");
    const volumeTitle = document.createElement("span");
    volumeTitle.textContent = `Speech volume (${Math.round(settings.volume * 100)}%)`;
    const volumeInput = document.createElement("input");
    volumeInput.type = "range";
    volumeInput.setAttribute("data-speech-field", "volume");
    volumeInput.min = "0";
    volumeInput.max = "1";
    volumeInput.step = "0.05";
    volumeInput.value = String(settings.volume);
    volumeInput.addEventListener("change", () => this.save((next) => { next.volume = Number(volumeInput.value); }));
    volume.append(volumeTitle, volumeInput);

    const speechCard = card("Speech", enable, overlap);
    speechCard.querySelector("header")!.append(summaryState);
    body.append(
      speechCard,
      card("TTS profiles", loadRow),
      narrator,
      fallback,
      overrides,
      delivery,
      card("Playback", autoplay, volume),
    );
    this.shadow.replaceChildren(style, body);

    // Restore focus and text selection if an input had active focus
    if (activeField) {
      // Find element by iterating attributes to avoid selector syntax errors with special characters
      const allElements = Array.from(this.shadow.querySelectorAll<HTMLElement>("[data-speech-field]"));
      const restored = allElements.find((el) => el.getAttribute("data-speech-field") === activeField) ?? null;
      if (restored) {
        restored.focus();
        if ((restored instanceof HTMLInputElement || restored instanceof HTMLTextAreaElement) && selectionStart !== null && selectionEnd !== null) {
          try {
            restored.setSelectionRange(selectionStart, selectionEnd);
          } catch { /* ignored */ }
        }
      }
    }
  }
}
