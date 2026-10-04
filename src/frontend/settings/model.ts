import {
  DEFAULT_CONFIG,
  EFFECT_INTENSITIES,
  REFERENCE_SOURCES,
  SCENE_IMAGE_FITS,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_EFFECT_MODES,
  THEME_PRESET_IDS,
  PRESENTATION_MODES,
  SPRITE_CUTOUT_QUALITIES,
  type VisualNovelPresentationMode,
  type VisualNovelSpriteCutout,
  type VisualNovelConfig,
  type VisualNovelEffectIntensity,
  type VisualNovelReferenceSource,
  type VisualNovelSceneImageFit,
  type VisualNovelTextEffectMode,
  type VisualNovelThemePreset,
} from "../../config.js";
import { THEME_PRESET_CSS } from "../theme/presets.js";
import {
  DEFAULT_SPRITE_MODEL_URL,
  SPRITE_HOT_SET,
  bestAvailableExpression,
  type PlateView,
  type SpriteImageStatus,
  type SpriteImageView,
  type SpriteSetView,
} from "../../shared/sprites.js";
import type { CutoutModelState } from "../sprites/cutout/index.js";

/* ------------------------------------------------------------------------ */
/* Image source: one choice that maps onto two stored flags.                 */
/* ------------------------------------------------------------------------ */

export type ImageSource = "card" | "generated" | "text";

export const IMAGE_SOURCE_OPTIONS: ReadonlyArray<{ value: ImageSource; label: string; help: string }> = [
  { value: "card", label: "Character pictures", help: "Uses the pictures already on the character card. Free." },
  { value: "generated", label: "Generated illustrations", help: "Draws a new picture for each scene with your image connection. Costs depend on that connection." },
  { value: "text", label: "Text only", help: "No pictures. Just the novel-style reading view." },
];

export function imageSourceFromConfig(config: Pick<VisualNovelConfig, "generateImages" | "useNativeCardImages">): ImageSource {
  if (config.useNativeCardImages) return "card";
  return config.generateImages ? "generated" : "text";
}

/** Only the flags that must change for the chosen source; nothing else is touched. */
export function imageSourcePatch(source: ImageSource): Partial<Pick<VisualNovelConfig, "useNativeCardImages" | "generateImages">> {
  switch (source) {
    // Card pictures win over generation in the backend, so the generate flag can stay as it was.
    case "card": return { useNativeCardImages: true };
    case "generated": return { useNativeCardImages: false, generateImages: true };
    case "text": return { useNativeCardImages: false, generateImages: false };
  }
}

/* ------------------------------------------------------------------------ */
/* Reference image source (shown only while the reference toggle is on).     */
/* ------------------------------------------------------------------------ */

export const REFERENCE_SOURCE_OPTIONS: ReadonlyArray<{ value: VisualNovelReferenceSource; label: string; help: string }> = [
  { value: "captured", label: "Captured render (default)", help: "The first generated picture of each character becomes their reference." },
  { value: "card", label: "Card sprites", help: "One fixed sprite per character from the card's assets; characters the card does not know still use captured renders." },
];

export function normalizeReferenceSource(value: string): VisualNovelReferenceSource {
  return (REFERENCE_SOURCES as readonly string[]).includes(value)
    ? value as VisualNovelReferenceSource
    : DEFAULT_CONFIG.referenceSource;
}

/* ------------------------------------------------------------------------ */
/* Picture budget presets. 0 (unlimited) is only reachable through Custom.   */
/* ------------------------------------------------------------------------ */

export type BudgetPresetId = "light" | "balanced" | "rich" | "custom";

export const BUDGET_PRESETS: ReadonlyArray<{ id: Exclude<BudgetPresetId, "custom">; label: string; value: number; help: string }> = [
  { id: "light", label: "Light", value: 1, help: "1 picture per reply" },
  { id: "balanced", label: "Balanced", value: 4, help: "Up to 4 pictures per reply" },
  { id: "rich", label: "Rich", value: 8, help: "Up to 8 pictures per reply" },
];

export function budgetPresetFor(maxImagesPerTurn: number): BudgetPresetId {
  return BUDGET_PRESETS.find((preset) => preset.value === maxImagesPerTurn)?.id ?? "custom";
}

export function budgetValueFor(preset: Exclude<BudgetPresetId, "custom">): number {
  return BUDGET_PRESETS.find((candidate) => candidate.id === preset)!.value;
}

export function describeBudget(maxImagesPerTurn: number): string {
  if (maxImagesPerTurn <= 0) return "No limit. Every planned scene gets a picture, so costs can grow with long replies.";
  if (maxImagesPerTurn === 1) return "1 picture per reply.";
  return `Up to ${maxImagesPerTurn} pictures per reply.`;
}

/* ------------------------------------------------------------------------ */
/* Named reading paces.                                                      */
/* ------------------------------------------------------------------------ */

export type NamedStep = { label: string; value: number };

export const TEXT_SPEED_STEPS: readonly NamedStep[] = [
  { label: "Instant", value: 0 },
  { label: "Quick", value: 10 },
  { label: "Normal", value: 20 },
  { label: "Slow", value: 40 },
];

export const AUTO_PLAY_STEPS: readonly NamedStep[] = [
  { label: "Short", value: 1000 },
  { label: "Normal", value: 2000 },
  { label: "Long", value: 4000 },
];

/** Returns the matching named step, or null when the stored value is a custom one. */
export function namedStepFor(steps: readonly NamedStep[], value: number): NamedStep | null {
  return steps.find((step) => step.value === value) ?? null;
}

export function describeTextSpeed(value: number): string {
  const step = namedStepFor(TEXT_SPEED_STEPS, value);
  if (step) return step.label;
  return `Custom (${value} ms per letter)`;
}

export function describeAutoPlay(value: number): string {
  const step = namedStepFor(AUTO_PLAY_STEPS, value);
  if (step) return `${step.label} (${value / 1000} s)`;
  return `Custom (${(value / 1000).toFixed(2).replace(/\.?0+$/, "")} s)`;
}

/* ------------------------------------------------------------------------ */
/* Text size and scene effects.                                              */
/* ------------------------------------------------------------------------ */

export const TEXT_SCALE_STEPS: readonly NamedStep[] = [
  { label: "Smaller", value: 0.9 },
  { label: "Normal", value: 1 },
  { label: "Large", value: 1.2 },
  { label: "Largest", value: 1.45 },
];

export function describeTextScale(value: number): string {
  const step = namedStepFor(TEXT_SCALE_STEPS, value);
  return step ? step.label : `Custom (${Math.round(value * 100)}%)`;
}

export const EFFECT_INTENSITY_OPTIONS: ReadonlyArray<{ value: VisualNovelEffectIntensity; label: string; help: string }> = [
  { value: "full", label: "Full", help: "Rain, sparkles, shakes and flashes as the story calls for them." },
  { value: "gentle", label: "Gentle", help: "Softer, slower effects. No flashes or shakes." },
  { value: "off", label: "Off", help: "Still scenes only." },
];

export function normalizeEffectIntensity(value: string): VisualNovelEffectIntensity {
  return (EFFECT_INTENSITIES as readonly string[]).includes(value)
    ? value as VisualNovelEffectIntensity
    : DEFAULT_CONFIG.effectIntensity;
}

export { TEXT_SCALE_MIN, TEXT_SCALE_MAX };

/* ------------------------------------------------------------------------ */
/* Inline text effects (<shake>, <rainbow>, ...).                            */
/* ------------------------------------------------------------------------ */

export const TEXT_EFFECT_MODE_OPTIONS: ReadonlyArray<{ value: VisualNovelTextEffectMode; label: string; help: string }> = [
  { value: "animated", label: "Animated", help: "Tagged words move: shake, wave, rainbow and more." },
  { value: "static", label: "Still", help: "Keeps the colour and style of each effect, without movement." },
  { value: "off", label: "Off", help: "Tagged words look like normal dialogue." },
];

export function normalizeTextEffects(value: string): VisualNovelTextEffectMode {
  return (TEXT_EFFECT_MODES as readonly string[]).includes(value)
    ? value as VisualNovelTextEffectMode
    : DEFAULT_CONFIG.textEffects;
}

/* ------------------------------------------------------------------------ */
/* Picture fit in plain words.                                               */
/* ------------------------------------------------------------------------ */

export const SCENE_IMAGE_FIT_OPTIONS: ReadonlyArray<{ value: VisualNovelSceneImageFit; label: string; help: string }> = [
  { value: "cover", label: "Fill the stage", help: "Crops the edges so the picture covers everything." },
  { value: "contain", label: "Show the whole picture", help: "Leaves bars at the sides or top when shapes differ." },
  { value: "fill", label: "Stretch to fit", help: "Fills everything by stretching. Can look distorted." },
  { value: "none", label: "Original size", help: "No scaling. Large pictures get cropped, small ones sit centred." },
  { value: "scale-down", label: "Shrink only if too large", help: "Like the original size, but never bigger than the stage." },
];

export function normalizeSceneImageFit(value: string): VisualNovelSceneImageFit {
  return (SCENE_IMAGE_FITS as readonly string[]).includes(value)
    ? value as VisualNovelSceneImageFit
    : DEFAULT_CONFIG.sceneImageFit;
}

/* ------------------------------------------------------------------------ */
/* Themes.                                                                   */
/* ------------------------------------------------------------------------ */

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

export function normalizeThemePreset(value: string): VisualNovelThemePreset {
  return (THEME_PRESET_IDS as readonly string[]).includes(value)
    ? value as VisualNovelThemePreset
    : DEFAULT_CONFIG.themePreset;
}

export type ThemePreviewTokens = {
  accent: string;
  text: string;
  mutedText: string;
  dialogueBg: string;
  dialogueBorder: string;
  fontFamily: string;
};

const PREVIEW_FALLBACK: ThemePreviewTokens = {
  accent: "var(--lumiverse-primary, #d8a8ff)",
  text: "var(--lumiverse-text, #fff)",
  mutedText: "var(--lumiverse-text-muted, rgba(255, 255, 255, 0.76))",
  dialogueBg: "var(--lumiverse-card-bg, linear-gradient(180deg, rgba(21, 16, 33, 0.78), rgba(8, 9, 15, 0.94)))",
  dialogueBorder: "var(--lumiverse-border, rgba(255, 255, 255, 0.3))",
  fontFamily: "var(--lumiverse-font-family, ui-rounded, \"Segoe UI\", system-ui, sans-serif)",
};

function cssVariable(css: string, name: string): string | null {
  // First declaration wins: each preset opens with its root token block.
  const match = new RegExp(`${name.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);`).exec(css);
  return match?.[1]?.trim() ?? null;
}

/**
 * Reads the preview colours straight out of the preset's own CSS, so the sample
 * in settings can never disagree with the stage.
 */
export function themePreviewTokens(preset: VisualNovelThemePreset): ThemePreviewTokens {
  const css = THEME_PRESET_CSS[preset] ?? "";
  return {
    accent: cssVariable(css, "--vn-accent") ?? PREVIEW_FALLBACK.accent,
    text: cssVariable(css, "--vn-text") ?? PREVIEW_FALLBACK.text,
    mutedText: cssVariable(css, "--vn-muted-text") ?? PREVIEW_FALLBACK.mutedText,
    dialogueBg: cssVariable(css, "--vn-dialogue-bg") ?? PREVIEW_FALLBACK.dialogueBg,
    dialogueBorder: cssVariable(css, "--vn-dialogue-border") ?? PREVIEW_FALLBACK.dialogueBorder,
    fontFamily: cssVariable(css, "--vn-font-family") ?? PREVIEW_FALLBACK.fontFamily,
  };
}

/* ------------------------------------------------------------------------ */
/* Connections.                                                              */
/* ------------------------------------------------------------------------ */

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
    result.push({ value: selectedId, label: `Saved connection no longer exists (${selectedId}) — pick another`, missing: true });
  }
  return result;
}

export type ConnectionReadiness = {
  /** ready = usable now; attention = usable but worth a look; blocked = will not work as saved. */
  level: "ready" | "loading" | "attention" | "blocked";
  /** One short line for the summary row. */
  title: string;
  /** What to do about it, when anything. */
  action: string | null;
  /** Which button helps: refresh the list, or pick a different connection. */
  fix: "refresh" | "choose" | null;
};

const KIND_NOUN: Record<ConnectionCatalogKind, string> = {
  planner: "story reader",
  image: "image",
};

export function connectionReadiness(
  kind: ConnectionCatalogKind,
  state: ConnectionCatalogState,
  selectedId: string | null,
): ConnectionReadiness {
  const noun = KIND_NOUN[kind];
  if (state.status === "idle" || state.status === "loading") {
    return { level: "loading", title: `Checking ${noun} connections…`, action: null, fix: null };
  }
  if (state.status === "error") {
    return {
      level: "blocked",
      title: `Could not load ${noun} connections`,
      action: `${state.error} Try again, or keep the Lumiverse default.`,
      fix: "refresh",
    };
  }
  if (selectedId) {
    const selected = state.options.find((option) => option.id === selectedId);
    if (!selected) {
      return {
        level: "blocked",
        title: `Saved ${noun} connection is missing`,
        action: `“${selectedId}” is no longer in Lumiverse. Pick another connection or use the Lumiverse default.`,
        fix: "choose",
      };
    }
    return { level: "ready", title: `Available (not tested) — ${connectionOptionLabel(selected)}`, action: null, fix: null };
  }
  const fallback = state.options.find((option) => option.isDefault);
  if (fallback) {
    return { level: "ready", title: `Lumiverse default — ${connectionOptionLabel(fallback).replace(/ · Default$/, "")} (not tested)`, action: null, fix: null };
  }
  if (state.options.length === 0) {
    return {
      level: "attention",
      title: `No saved ${noun} connections`,
      action: `Add one in Lumiverse settings, then choose Refresh. Refreshing is free.`,
      fix: "refresh",
    };
  }
  return {
    level: "attention",
    title: "Using the Lumiverse default",
    action: `Lumiverse has no default ${noun} connection marked. Pick one of your ${state.options.length} saved connections to be sure.`,
    fix: "choose",
  };
}

/* ------------------------------------------------------------------------ */
/* Reset.                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Defaults for every setting, except the things people made or imported:
 * prompt presets and the music folder are kept.
 */
export function resetPatch(current: Pick<VisualNovelConfig, "promptPresets" | "audioDirectory">): VisualNovelConfig {
  return {
    ...DEFAULT_CONFIG,
    promptPresets: current.promptPresets.map((preset) => ({ ...preset })),
    audioDirectory: current.audioDirectory,
  };
}

/* ------------------------------------------------------------------------ */
/* Settings navigation and search.                                           */
/* ------------------------------------------------------------------------ */

export type SettingsSectionId = "reading" | "look" | "pictures" | "sound" | "voice" | "connections" | "advanced";

export const SETTINGS_SECTIONS: ReadonlyArray<{ id: SettingsSectionId; label: string; blurb: string }> = [
  { id: "reading", label: "Reading", blurb: "How the story plays and how you answer." },
  { id: "look", label: "Look", blurb: "Theme, text and scene effects." },
  { id: "pictures", label: "Pictures", blurb: "Where pictures come from and how many." },
  { id: "sound", label: "Sound", blurb: "Music, sound effects and volume." },
  { id: "voice", label: "Voice", blurb: "Read paragraphs aloud with your Lumiverse TTS profiles." },
  { id: "connections", label: "Connections", blurb: "The models Cue uses to read the story." },
  { id: "advanced", label: "Advanced", blurb: "Prompts, filters, CSS and technical controls." },
];

/** Where the last open settings section is remembered (same storage as the setup flag). */
export const SETTINGS_SECTION_KEY = "cue.visual-novel.settings-section";

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value) ? value as SettingsSectionId : "reading";
}

export type SettingsSearchEntry = {
  /** Opaque id the panel uses to find the target element. */
  id: string;
  label: string;
  section: SettingsSectionId;
  /** Extra words that should also find this setting. */
  keywords?: string;
};

function searchWords(value: string): string[] {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Settings matching every word of the query (prefix match per word), best first:
 * label starts with the query, then label words, then keywords and section name.
 */
export function searchSettings(entries: readonly SettingsSearchEntry[], query: string, limit = 8): SettingsSearchEntry[] {
  const terms = searchWords(query);
  if (terms.length === 0) return [];
  const phrase = terms.join(" ");
  const scored: Array<{ entry: SettingsSearchEntry; score: number; order: number }> = [];
  entries.forEach((entry, order) => {
    const labelWords = searchWords(entry.label);
    const sectionLabel = SETTINGS_SECTIONS.find((section) => section.id === entry.section)?.label ?? entry.section;
    const otherWords = [...searchWords(entry.keywords ?? ""), ...searchWords(sectionLabel)];
    let score = 0;
    for (const term of terms) {
      if (labelWords.some((word) => word.startsWith(term))) score += 3;
      else if (otherWords.some((word) => word.startsWith(term))) score += 1;
      else return;
    }
    if (labelWords.join(" ").startsWith(phrase)) score += 5;
    scored.push({ entry, score, order });
  });
  scored.sort((left, right) => right.score - left.score || left.order - right.order);
  return scored.slice(0, limit).map(({ entry }) => entry);
}

/* ------------------------------------------------------------------------ */
/* First-use guide.                                                          */
/* ------------------------------------------------------------------------ */

export const SETUP_DONE_KEY = "cue.visual-novel.setup-done";

export type SetupFlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function safeStorage(): SetupFlagStorage | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = `${SETUP_DONE_KEY}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export function jsonObject(value: string, label: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); }
  catch { throw new Error(`${label} contains invalid JSON. Fix that field in Advanced before applying.`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

/* ------------------------------------------------------------------------ */
/* NovelAI Parameters & Effective Connection                                 */
/* ------------------------------------------------------------------------ */

export function effectiveImageConnection(
  state: ConnectionCatalogState,
  selectedId: string | null,
): ConnectionOption | null {
  if (state.status !== "ready") return null;
  if (selectedId) {
    return state.options.find((option) => option.id === selectedId) ?? null;
  }
  return state.options.find((option) => option.isDefault) ?? null;
}

export function isNovelAiConnection(connection: ConnectionOption | null): boolean {
  return Boolean(connection && connection.provider.trim().toLowerCase() === "novelai");
}

export type NovelAiSamplerOption = {
  value: string;
  label: string;
};

export const NOVELAI_SAMPLER_OPTIONS: readonly NovelAiSamplerOption[] = [
  { value: "k_euler_ancestral", label: "Euler Ancestral (Recommended)" },
  { value: "k_euler", label: "Euler" },
  { value: "k_dpmpp_2m", label: "DPM++ 2M (Recommended)" },
  { value: "k_dpmpp_2s_ancestral", label: "DPM++ 2S Ancestral" },
  { value: "k_dpmpp_sde", label: "DPM++ SDE" },
  { value: "ddim_v3", label: "DDIM" },
];

export const NOVELAI_DEFAULT_SAMPLER = "k_euler_ancestral";
export const NOVELAI_DEFAULT_STEPS = 28;
export const NOVELAI_DEFAULT_GUIDANCE = 5;
export const NOVELAI_STEPS_MIN = 1;
export const NOVELAI_STEPS_MAX = 50;
export const NOVELAI_GUIDANCE_MIN = 1;
export const NOVELAI_GUIDANCE_MAX = 20;

export type NovelAiResolutionPresetId = "landscape" | "portrait" | "square" | "custom";

export type NovelAiResolutionPreset = {
  id: Exclude<NovelAiResolutionPresetId, "custom">;
  label: string;
  resolution: string;
  width: number;
  height: number;
  help: string;
};

export const NOVELAI_RESOLUTION_PRESETS: readonly NovelAiResolutionPreset[] = [
  { id: "landscape", label: "Landscape (1216×832)", resolution: "1216x832", width: 1216, height: 832, help: "1216×832 · Within Opus size limit" },
  { id: "portrait", label: "Portrait (832×1216)", resolution: "832x1216", width: 832, height: 1216, help: "832×1216 · Within Opus size limit" },
  { id: "square", label: "Square (1024×1024)", resolution: "1024x1024", width: 1024, height: 1024, help: "1024×1024 · Within Opus size limit" },
];

export const NOVELAI_DEFAULT_RESOLUTION = "1216x832";
export const NOVELAI_NOTICE = "These sizes fit the Opus size limit. Free generation also depends on your plan, model usage limits, 28 steps or fewer, and generation mode. Reference images or custom settings may cost Anlas.";

export function novelAiResolutionPresetFor(resolution: string | undefined | null): NovelAiResolutionPresetId {
  const norm = (resolution ?? "").trim().toLowerCase();
  const found = NOVELAI_RESOLUTION_PRESETS.find((p) => p.resolution.toLowerCase() === norm);
  return found ? found.id : "custom";
}

export function snapDimension(value: number, fallback = 1024): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(2048, Math.max(64, Math.round(value / 64) * 64));
}

export function parseDimensions(resolution: string | undefined | null): { width: number; height: number } {
  const norm = (resolution ?? "").trim();
  const parts = norm.split("x").map((part) => Number(part.trim()));
  const w = parts[0];
  const h = parts[1];
  if (parts.length === 2 && typeof w === "number" && typeof h === "number" && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: Math.round(w), height: Math.round(h) };
  }
  return { width: 1216, height: 832 };
}

export function buildNovelAiSamplerOptions(currentSampler: string): NovelAiSamplerOption[] {
  const norm = currentSampler.trim();
  const exists = NOVELAI_SAMPLER_OPTIONS.some((opt) => opt.value === norm);
  if (exists || !norm) {
    return [...NOVELAI_SAMPLER_OPTIONS];
  }
  return [
    ...NOVELAI_SAMPLER_OPTIONS,
    { value: norm, label: `Custom (${norm})` },
  ];
}

export type NovelAiParameters = {
  steps: number;
  guidance: number;
  sampler: string;
  /** null = random (the provider picks one per image). */
  seed: number | null;
  resolution: string;
  preset: NovelAiResolutionPresetId;
  width: number;
  height: number;
};

/** NovelAI accepts seeds as integers in [0, 2^53]. */
export const NOVELAI_SEED_MAX = 9007199254740992;

/** Parse a seed field; empty, non-integer, negative, or out-of-range means random (null). */
export function parseNovelAiSeed(value: unknown): number | null {
  const n = typeof value === "string" ? (value.trim() === "" ? NaN : Number(value)) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= NOVELAI_SEED_MAX ? n : null;
}

export function readNovelAiParameters(params: Record<string, unknown> | undefined | null): NovelAiParameters {
  const p = params ?? {};

  let steps = NOVELAI_DEFAULT_STEPS;
  if (typeof p.steps === "number" && Number.isFinite(p.steps)) {
    steps = Math.min(NOVELAI_STEPS_MAX, Math.max(NOVELAI_STEPS_MIN, Math.round(p.steps)));
  } else if (typeof p.steps === "string" && p.steps.trim() !== "") {
    const num = Number(p.steps);
    if (Number.isFinite(num)) {
      steps = Math.min(NOVELAI_STEPS_MAX, Math.max(NOVELAI_STEPS_MIN, Math.round(num)));
    }
  }

  let guidance = NOVELAI_DEFAULT_GUIDANCE;
  const rawGuidance = p.guidance !== undefined ? p.guidance : p.scale;
  if (typeof rawGuidance === "number" && Number.isFinite(rawGuidance)) {
    guidance = Math.min(NOVELAI_GUIDANCE_MAX, Math.max(NOVELAI_GUIDANCE_MIN, rawGuidance));
  } else if (typeof rawGuidance === "string" && rawGuidance.trim() !== "") {
    const num = Number(rawGuidance);
    if (Number.isFinite(num)) {
      guidance = Math.min(NOVELAI_GUIDANCE_MAX, Math.max(NOVELAI_GUIDANCE_MIN, num));
    }
  }

  const sampler = typeof p.sampler === "string" && p.sampler.trim() ? p.sampler.trim() : NOVELAI_DEFAULT_SAMPLER;
  const resStr = typeof p.resolution === "string" && p.resolution.trim() ? p.resolution.trim() : NOVELAI_DEFAULT_RESOLUTION;
  const preset = novelAiResolutionPresetFor(resStr);
  const dims = parseDimensions(resStr);

  return {
    steps,
    guidance,
    sampler,
    seed: parseNovelAiSeed(p.seed),
    resolution: resStr,
    preset,
    width: dims.width,
    height: dims.height,
  };
}

/* ------------------------------------------------------------------------ */
/* Sprite mode: presentation, cut-out quality, model state, library.         */
/* ------------------------------------------------------------------------ */

export const PRESENTATION_MODE_OPTIONS: ReadonlyArray<{ value: VisualNovelPresentationMode; label: string; help: string }> = [
  { value: "scene", label: "Scene pictures", help: "Paints a new picture for each scene. Slower, and limited per reply." },
  { value: "sprites", label: "Character sprites", help: "Reuses cut-out characters over background plates, so every paragraph gets its own expression." },
];

export function normalizePresentationMode(value: string): VisualNovelPresentationMode {
  return (PRESENTATION_MODES as readonly string[]).includes(value)
    ? value as VisualNovelPresentationMode
    : DEFAULT_CONFIG.presentationMode;
}

export const SPRITE_CUTOUT_OPTIONS: ReadonlyArray<{ value: VisualNovelSpriteCutout; label: string; help: string }> = [
  { value: "best", label: "Best (downloads a 176 MB model once)", help: "Clean edges, also on white clothes and hair. The model stays in this browser." },
  { value: "basic", label: "Basic (no download)", help: "Removes the plain background without a model. Edges can be rougher." },
];

export function normalizeSpriteCutout(value: string): VisualNovelSpriteCutout {
  return (SPRITE_CUTOUT_QUALITIES as readonly string[]).includes(value)
    ? value as VisualNovelSpriteCutout
    : DEFAULT_CONFIG.spriteCutout;
}

/** "12.3 MB" style sizes for the model download. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, "") : Math.round(mb)} MB`;
}

export type CutoutModelSummary = {
  level: "ready" | "loading" | "attention" | "blocked";
  title: string;
  detail: string;
  /** Which button to show. */
  action: "download" | "retry" | "remove" | null;
  /** 0..1 while downloading with a known size; null otherwise. */
  progress: number | null;
};

/** Plain-words status of the cut-out model for the settings row. */
export function describeCutoutModel(state: CutoutModelState, quality: VisualNovelSpriteCutout, modelUrl = ""): CutoutModelSummary {
  let host = "";
  try { host = modelUrl ? new URL(modelUrl).hostname : ""; } catch { host = ""; }
  const from = host ? ` from ${host}` : "";
  const basicNote = quality === "basic" ? " Not used while cut-out quality is Basic." : "";
  switch (state.state) {
    case "absent":
      return {
        level: quality === "basic" ? "ready" : "attention",
        title: "Model not downloaded",
        detail: quality === "basic"
          ? "Basic quality needs no model."
          : `It downloads once${from} when the first sprite is cut. You can download it now instead.`,
        action: quality === "basic" ? null : "download",
        progress: null,
      };
    case "downloading": {
      const total = state.totalBytes && state.totalBytes > 0 ? state.totalBytes : null;
      const progress = total ? Math.min(1, Math.max(0, state.receivedBytes / total)) : null;
      return {
        level: "loading",
        title: total ? `Downloading the model… ${Math.round(progress! * 100)}%` : "Downloading the model…",
        detail: total ? `${formatBytes(state.receivedBytes)} of ${formatBytes(total)}${from}.` : `${formatBytes(state.receivedBytes)} so far${from}.`,
        action: null,
        progress,
      };
    }
    case "loading":
      return { level: "loading", title: "Loading the model…", detail: "Starting the cut-out model in this browser.", action: null, progress: null };
    case "ready":
      return {
        level: "ready",
        title: "Model ready",
        detail: `${formatBytes(state.bytes)} stored in this browser · runs on ${state.backend === "webgpu" ? "the graphics card (WebGPU)" : "the processor (WebAssembly)"}.${basicNote}`,
        action: "remove",
        progress: null,
      };
    case "unsupported":
      return { level: "blocked", title: "This browser cannot run the model", detail: `${state.reason} Basic cut-out is used instead.`, action: null, progress: null };
    case "error":
      return { level: "blocked", title: "The model could not be prepared", detail: `${state.error} Basic cut-out is used until this works.`, action: "retry", progress: null };
  }
}

/** Sprite model URL for Advanced: https (or http on this computer). Empty restores the default. */
export function parseSpriteModelUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_SPRITE_MODEL_URL;
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error("Sprite model URL is not a valid web address. Fix it in Advanced before applying."); }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error("Sprite model URL must start with https://. Fix it in Advanced before applying.");
  return url.toString();
}

export const SPRITE_STATUS_LABELS: Record<SpriteImageStatus, string> = {
  missing: "Not made yet",
  queued: "Waiting",
  generating: "Drawing",
  cutting: "Cutting out",
  ready: "Ready",
  failed: "Failed",
};

/** True while the backend is still working on the image. */
export function spriteStatusBusy(status: SpriteImageStatus): boolean {
  return status === "queued" || status === "generating" || status === "cutting";
}

/** "crying_with_eyes_open" -> "Crying with eyes open". */
export function expressionLabel(id: string): string {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Expression";
}

/** The hot set first, in its fixed order, then any rare expressions alphabetically. */
export function orderedExpressions(set: Pick<SpriteSetView, "expressions">): SpriteImageView[] {
  const known = set.expressions;
  const hot = SPRITE_HOT_SET.map((id) => known[id] ?? { expression: id, status: "missing" as const });
  const rare = Object.keys(known).filter((id) => !(SPRITE_HOT_SET as readonly string[]).includes(id)).sort().map((id) => known[id]!);
  return [...hot, ...rare];
}

export function countReady(set: Pick<SpriteSetView, "expressions">): number {
  return Object.values(set.expressions).filter((image) => image.status === "ready").length;
}

/** The picture that represents a set: idle when ready, else the first ready hot-set sprite. */
export function setCoverImage(set: Pick<SpriteSetView, "expressions">): SpriteImageView | null {
  const ready = new Set(Object.values(set.expressions).filter((image) => image.status === "ready" && image.url).map((image) => image.expression));
  const id = bestAvailableExpression("idle", ready);
  return id ? set.expressions[id] ?? null : null;
}

/** Applies one live image update to a set; returns a new set with a fresh ready count. */
export function mergeSpriteImage(set: SpriteSetView, image: SpriteImageView): SpriteSetView {
  const expressions = { ...set.expressions, [image.expression]: image };
  return { ...set, expressions, readyCount: countReady({ expressions }), updatedAt: new Date().toISOString() };
}

/** Adds or replaces one plate (by key). */
export function mergePlate(plates: readonly PlateView[], plate: PlateView): PlateView[] {
  const index = plates.findIndex((candidate) => candidate.plateKey === plate.plateKey);
  if (index < 0) return [...plates, plate];
  const next = plates.slice();
  next[index] = plate;
  return next;
}

/** Newest first; name breaks ties so the order is stable. */
export function sortSpriteSets(sets: readonly SpriteSetView[]): SpriteSetView[] {
  return [...sets].sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || left.name.localeCompare(right.name));
}

export function plateDetails(plate: Pick<PlateView, "timeOfDay" | "weather">): string {
  return [plate.timeOfDay, plate.weather].map((part) => (part ?? "").trim()).filter(Boolean).join(" · ");
}

export type SpriteLibrarySummary = {
  sets: number;
  readySprites: number;
  totalSprites: number;
  plates: number;
  readyPlates: number;
  busy: number;
  failed: number;
};

export function summarizeSpriteLibrary(sets: readonly SpriteSetView[], plates: readonly PlateView[]): SpriteLibrarySummary {
  let readySprites = 0, totalSprites = 0, busy = 0, failed = 0;
  for (const set of sets) {
    for (const image of orderedExpressions(set)) {
      totalSprites += 1;
      if (image.status === "ready") readySprites += 1;
      else if (image.status === "failed") failed += 1;
      else if (spriteStatusBusy(image.status)) busy += 1;
    }
  }
  for (const plate of plates) {
    if (plate.status === "failed") failed += 1;
    else if (spriteStatusBusy(plate.status)) busy += 1;
  }
  return { sets: sets.length, readySprites, totalSprites, plates: plates.length, readyPlates: plates.filter((plate) => plate.status === "ready").length, busy, failed };
}

export function describeSpriteLibrary(summary: SpriteLibrarySummary): string {
  if (summary.sets === 0 && summary.plates === 0) return "No sprites yet.";
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const parts = [`${plural(summary.sets, "character")} (${summary.readySprites}/${summary.totalSprites} sprites ready)`, `${plural(summary.plates, "background")}`];
  if (summary.busy) parts.push(`${summary.busy} in progress`);
  if (summary.failed) parts.push(`${summary.failed} failed`);
  return parts.join(" · ");
}
