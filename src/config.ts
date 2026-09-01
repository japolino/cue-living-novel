export type VisualNovelMode = "standard" | "cyoa";

export type VisualNovelConfig = {
  enabled: boolean;
  autoEnter: boolean;
  mode: VisualNovelMode;
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
};

export const DEFAULT_CONFIG: VisualNovelConfig = {
  enabled: true,
  autoEnter: false,
  mode: "standard",
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
  promptSuffix: "wide composition, centered subject, stable eye-level camera, dialogue-safe lower frame",
  negativePrompt: "low quality, blurry, malformed hands, text, subtitles, speech bubble, watermark, logo, frame, border",
  customPlannerInstructions: "",
  customCss: "",
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

function integer(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.round(number)))
    : fallback;
}

export function normalizeConfig(value: unknown): VisualNovelConfig {
  const input = record(value);
  return {
    enabled: bool(input.enabled, DEFAULT_CONFIG.enabled),
    autoEnter: bool(input.autoEnter, DEFAULT_CONFIG.autoEnter),
    mode: input.mode === "cyoa" ? "cyoa" : "standard",
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
    promptSuffix: stringValue(input.promptSuffix, DEFAULT_CONFIG.promptSuffix),
    negativePrompt: stringValue(input.negativePrompt, DEFAULT_CONFIG.negativePrompt),
    customPlannerInstructions: stringValue(input.customPlannerInstructions, DEFAULT_CONFIG.customPlannerInstructions),
    customCss: stringValue(input.customCss, DEFAULT_CONFIG.customCss)
  };
}
