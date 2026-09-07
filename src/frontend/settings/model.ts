import {
  DEFAULT_CONFIG,
  EFFECT_INTENSITIES,
  SCENE_IMAGE_FITS,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  THEME_PRESET_IDS,
  type VisualNovelConfig,
  type VisualNovelEffectIntensity,
  type VisualNovelSceneImageFit,
  type VisualNovelThemePreset,
} from "../../config.js";
import { THEME_PRESET_CSS } from "../theme/presets.js";

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
  resolution: string;
  preset: NovelAiResolutionPresetId;
  width: number;
  height: number;
};

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
    resolution: resStr,
    preset,
    width: dims.width,
    height: dims.height,
  };
}
