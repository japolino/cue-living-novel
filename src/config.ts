export type VisualNovelMode = "standard" | "cyoa";

export const SCENE_IMAGE_FITS = ["cover", "contain", "fill", "none", "scale-down"] as const;
export type VisualNovelSceneImageFit = (typeof SCENE_IMAGE_FITS)[number];

/**
 * The canonical, host-neutral set of built-in visual-novel theme presets.
 *
 * These identifiers are the single source of truth shared by the backend config
 * normalization (src/config.ts), the frontend preset CSS map, and the stage /
 * settings wiring. They deliberately live here — not in the frontend `theme`
 * module — so the shared config never imports browser or frontend code.
 */
export const THEME_PRESET_IDS = [
  "lumiverse",
  "golden-hour",
  "boxed-console",
  "paper-novel",
  "midnight-noir",
] as const;

export type VisualNovelThemePreset = (typeof THEME_PRESET_IDS)[number];

export type VisualNovelConfig = {
  themePreset: VisualNovelThemePreset;
  enabled: boolean;
  autoEnter: boolean;
  mode: VisualNovelMode;
  sceneImageFit: VisualNovelSceneImageFit;
  debugLogging: boolean;
  generateImages: boolean;
  generateChoices: boolean;
  parserConnectionId: string | null;
  parserParameters: Record<string, unknown>;
  imageConnectionId: string | null;
  imageModel: string;
  imageParameters: Record<string, unknown>;
  maxImagesPerTurn: number;
  imageConcurrency: number;
  includeRecentMessages: number;
  includeCharacterContext: boolean;
  includePersonaContext: boolean;
  includeLorebookContext: boolean;
  promptPrefix: string;
  promptSuffix: string;
  negativePrompt: string;
  customPlannerInstructions: string;
  customCss: string;
  ignoredTags: string;
  displayRegexRules: string;
  useNativeCardImages: boolean;
  textSpeed: number;
  autoPlayDelay: number;
  skipMode: "read" | "all";
  audioDirectory: string;
  bgmVolume: number;
  sfxVolume: number;
};

export const DEFAULT_CONFIG: VisualNovelConfig = {
  themePreset: "lumiverse",
  enabled: true,
  autoEnter: false,
  mode: "standard",
  sceneImageFit: "cover",
  debugLogging: false,
  generateImages: true,
  generateChoices: true,
  parserConnectionId: null,
  parserParameters: {},
  imageConnectionId: null,
  imageModel: "",
  imageParameters: {},
  maxImagesPerTurn: 4,
  imageConcurrency: 2,
  includeRecentMessages: 8,
  includeCharacterContext: true,
  includePersonaContext: true,
  includeLorebookContext: false,
  promptPrefix: "masterpiece, best quality, anime visual novel scene",
  promptSuffix: "",
  negativePrompt: "low quality, blurry, malformed hands, text, subtitles, speech bubble, watermark, logo, frame, border",
  customPlannerInstructions: "",
  customCss: "",
  ignoredTags: "",
  displayRegexRules: "",
  useNativeCardImages: false,
  textSpeed: 20,
  autoPlayDelay: 2000,
  skipMode: "read",
  audioDirectory: "",
  bgmVolume: 0.7,
  sfxVolume: 0.8,
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nullableString(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function floatBetween(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
}

function integer(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.round(number)))
    : fallback;
}

function sceneImageFit(value: unknown): VisualNovelSceneImageFit {
  return typeof value === "string" && (SCENE_IMAGE_FITS as readonly string[]).includes(value)
    ? value as VisualNovelSceneImageFit
    : DEFAULT_CONFIG.sceneImageFit;
}


/**
 * The pre-1.0 default prompt suffix duplicated camera framing as prose. The
 * compact Inlay-style camera tags now own framing, so the exact legacy default
 * is retired to an empty suffix; any user-customized suffix is preserved.
 */
const LEGACY_DEFAULT_PROMPT_SUFFIX = "wide composition, centered subject, stable eye-level camera, dialogue-safe lower frame";

function retiredLegacySuffix(value: string): string {
  return value.trim() === LEGACY_DEFAULT_PROMPT_SUFFIX ? "" : value;
}

export function normalizeConfig(value: unknown): VisualNovelConfig {
  const input = record(value);
  const themePreset = (THEME_PRESET_IDS as readonly string[]).includes(input.themePreset as string)
    ? input.themePreset as VisualNovelThemePreset
    : "lumiverse";
  return {
    themePreset,
    enabled: bool(input.enabled, DEFAULT_CONFIG.enabled),
    autoEnter: bool(input.autoEnter, DEFAULT_CONFIG.autoEnter),
    mode: input.mode === "cyoa" ? "cyoa" : "standard",
    sceneImageFit: sceneImageFit(input.sceneImageFit),
    debugLogging: bool(input.debugLogging, DEFAULT_CONFIG.debugLogging),
    generateImages: bool(input.generateImages, DEFAULT_CONFIG.generateImages),
    generateChoices: bool(input.generateChoices, DEFAULT_CONFIG.generateChoices),
    parserConnectionId: nullableString(input.parserConnectionId),
    parserParameters: record(input.parserParameters),
    imageConnectionId: nullableString(input.imageConnectionId),
    imageModel: stringValue(input.imageModel, DEFAULT_CONFIG.imageModel),
    imageParameters: record(input.imageParameters),
    maxImagesPerTurn: integer(input.maxImagesPerTurn, 0, 12, DEFAULT_CONFIG.maxImagesPerTurn),
    imageConcurrency: integer(input.imageConcurrency, 1, 6, DEFAULT_CONFIG.imageConcurrency),
    includeRecentMessages: integer(input.includeRecentMessages, 0, 30, DEFAULT_CONFIG.includeRecentMessages),
    includeCharacterContext: bool(input.includeCharacterContext, DEFAULT_CONFIG.includeCharacterContext),
    includePersonaContext: bool(input.includePersonaContext, DEFAULT_CONFIG.includePersonaContext),
    includeLorebookContext: bool(input.includeLorebookContext, DEFAULT_CONFIG.includeLorebookContext),
    promptPrefix: stringValue(input.promptPrefix, DEFAULT_CONFIG.promptPrefix),
    promptSuffix: retiredLegacySuffix(stringValue(input.promptSuffix, DEFAULT_CONFIG.promptSuffix)),
    negativePrompt: stringValue(input.negativePrompt, DEFAULT_CONFIG.negativePrompt),
    customPlannerInstructions: stringValue(input.customPlannerInstructions, DEFAULT_CONFIG.customPlannerInstructions),
    customCss: stringValue(input.customCss, DEFAULT_CONFIG.customCss),
    ignoredTags: stringValue(input.ignoredTags, DEFAULT_CONFIG.ignoredTags),
    displayRegexRules: stringValue(input.displayRegexRules, DEFAULT_CONFIG.displayRegexRules),
    useNativeCardImages: bool(input.useNativeCardImages, DEFAULT_CONFIG.useNativeCardImages),
    textSpeed: integer(input.textSpeed, 0, 100, DEFAULT_CONFIG.textSpeed),
    autoPlayDelay: integer(input.autoPlayDelay, 500, 10000, DEFAULT_CONFIG.autoPlayDelay),
    skipMode: input.skipMode === "all" ? "all" : "read",
    audioDirectory: stringValue(input.audioDirectory, DEFAULT_CONFIG.audioDirectory).trim(),
    bgmVolume: floatBetween(input.bgmVolume, 0, 1, DEFAULT_CONFIG.bgmVolume),
    sfxVolume: floatBetween(input.sfxVolume, 0, 1, DEFAULT_CONFIG.sfxVolume),
  };
}
