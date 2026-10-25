import { DEFAULT_SPEECH_SETTINGS, normalizeSpeechSettings, type SpeechSettings } from "./speech-config.js";
import { DEFAULT_SPRITE_EXPRESSION_COUNT, DEFAULT_SPRITE_MODEL_URL, SPRITE_EXPRESSION_COUNTS, normalizeSpriteExpressionCount, type SpriteExpressionCount } from "./shared/sprites.js";

export const SCENE_IMAGE_FITS = ["cover", "contain", "fill", "none", "scale-down"] as const;
export type VisualNovelSceneImageFit = (typeof SCENE_IMAGE_FITS)[number];

/**
 * How strongly one-shot stage effects (shake, flash, zoom) are presented.
 * - "full": every planned effect plays (the pre-redesign behavior, the default);
 * - "gentle": strong shakes and screen flashes are dropped or softened;
 * - "off": no one-shot effects at all.
 * The OS `prefers-reduced-motion` setting is honored by the theme CSS on top of
 * this and is never overridden by it.
 */
export const EFFECT_INTENSITIES = ["off", "gentle", "full"] as const;
export type VisualNovelEffectIntensity = (typeof EFFECT_INTENSITIES)[number];
/**
 * How inline text effects (<shake>, <rainbow>, ... see src/shared/text-effects.ts)
 * render in dialogue: "animated" plays them, "static" keeps their colour and
 * styling without motion, "off" shows plain text. OS reduced-motion always
 * downgrades "animated" to "static".
 */
export const TEXT_EFFECT_MODES = ["animated", "static", "off"] as const;
/**
 * How the stage shows a reply. "scene" paints one full picture per cue (the
 * original pipeline). "sprites" stages reusable character cut-outs over
 * reusable background plates (see docs/SPRITE_MODE.md).
 */
export const PRESENTATION_MODES = ["scene", "sprites"] as const;
export type VisualNovelPresentationMode = (typeof PRESENTATION_MODES)[number];
/**
 * Sprite cut-out quality: "best" downloads and runs the segmentation model,
 * "basic" never downloads anything. "studio" (experimental, opt-in) runs a
 * larger BiRefNet model from `spriteStudioModelUrl` on WebGPU and cuts like
 * "best" where that cannot run (docs/SPRITE_MODE.md, "Studio cut-out").
 */
export const SPRITE_CUTOUT_QUALITIES = ["studio", "best", "basic"] as const;
export type VisualNovelSpriteCutout = (typeof SPRITE_CUTOUT_QUALITIES)[number];
/**
 * Sprite mode only: full scene illustrations for key moments (sitting,
 * running, kissing, fighting, a reveal) that a standing sprite cannot show.
 * "off" never paints one; "few" paints at most KEY_ILLUSTRATION_CAP.few per
 * reply through the scene-image pipeline.
 */
export const KEY_ILLUSTRATION_MODES = ["off", "few"] as const;
export type VisualNovelKeyIllustrations = (typeof KEY_ILLUSTRATION_MODES)[number];
/**
 * Sprite mode only: pixel size of generated sprites, plates and key moments on
 * providers that take a width and height (ComfyUI, SwarmUI). "standard"
 * (624×912 / 912×624) is fast and fits small GPUs; "upscaled" (832×1216 /
 * 1216×832) is sharper but slower and needs more VRAM. NovelAI always uses
 * its largest free size (832×1216 / 1216×832), whatever this says.
 */
export const SPRITE_IMAGE_SIZES = ["standard", "upscaled"] as const;
export type VisualNovelSpriteImageSize = (typeof SPRITE_IMAGE_SIZES)[number];
/**
 * Sprite mode only: expressions Cue makes per character, 4 (the default,
 * fastest), 8 or 12 (the whole hot set). Other expressions show the nearest
 * one of the set (src/shared/sprites.ts, spriteSetExpressionFor). Not part
 * of the set key: changing it keeps every image.
 */
export const SPRITE_EXPRESSION_COUNT_VALUES = SPRITE_EXPRESSION_COUNTS;
export type VisualNovelSpriteExpressionCount = SpriteExpressionCount;
/** Key illustrations per reply for each mode. */
export const KEY_ILLUSTRATION_CAP: Readonly<Record<VisualNovelKeyIllustrations, number>> = { off: 0, few: 1 };
/**
 * Sprite mode only: PNG-puppet motion of the cut-outs (docs/SPRITE_MODE.md,
 * "Puppet motion"). `spriteMotion` is the strength in percent (0 = still,
 * 100 = default, up to SPRITE_MOTION_MAX); breathing, body sway and head
 * movement switch on and off separately. `spriteOutline` is a white sticker
 * outline in px (0 = none). `spriteFocusBlur` blurs the characters who are
 * not speaking a little. `spriteActing` (off by default) lets the body carry
 * the mood, the speaker's head follow the typed words and the others look at
 * whoever speaks ("Puppet acting"); `spritePhysics` lets hair and loose clothes
 * trail and settle ("Puppet physics"). `spriteTransitions` picks how
 * expression changes, entrances and exits play ("Puppet transitions"):
 * "expressive" (the style follows the new emotion), "soft" (one gentle
 * dissolve) or "classic" (the CSS crossfade and fade). `spriteAtmosphere`
 * puts the scene's weather and light on the characters ("Puppet
 * atmosphere"). Motion (`effectIntensity`) "off" and the OS reduced-motion
 * setting still stop all movement.
 */
export const SPRITE_MOTION_MAX = 150;
export const SPRITE_OUTLINE_MAX = 6;
export const SPRITE_TRANSITION_STYLES = ["expressive", "soft", "classic"] as const;
export type VisualNovelSpriteTransitions = (typeof SPRITE_TRANSITION_STYLES)[number];
export type VisualNovelSpritePuppet = Pick<VisualNovelConfig,
  "spriteMotion" | "spriteBreathing" | "spriteSway" | "spriteHeadMotion" | "spriteActing" | "spritePhysics" | "spriteOutline" | "spriteFocusBlur"
  | "spriteTransitions" | "spriteAtmosphere">;
/**
 * How the stage answers the reader's hand (VnStage.setStageFeel): click
 * sparks, pressing a sprite to make it bounce, the interface sounds (typing
 * ticks and a pop, with their own volume), and extra inner-voice names.
 */
export type VisualNovelStageFeel = Pick<VisualNovelConfig,
  "clickEffect" | "spritePressBounce" | "interfaceSounds" | "interfaceSoundVolume" | "innerVoices">;
export type VisualNovelTextEffectMode = (typeof TEXT_EFFECT_MODES)[number];

/**
 * The Motion setting (`effectIntensity`) decides the text effects too: tagged
 * words move with "full" and "gentle" (smaller and slower), and keep their
 * style without moving with "off".
 */
export function textEffectModeFor(intensity: VisualNovelEffectIntensity): VisualNovelTextEffectMode {
  return intensity === "off" ? "static" : "animated";
}

/**
 * Where a character's reference anchor image comes from.
 * - "captured": the first render of the character in the chat (the default, unchanged behaviour);
 * - "card": one fixed sprite per character resolved from the card's assets. Characters the card
 *   does not know still use captured renders.
 */
export const REFERENCE_SOURCES = ["captured", "card"] as const;
export type VisualNovelReferenceSource = (typeof REFERENCE_SOURCES)[number];

/**
 * What a click or tap on the stage shows at the pointer: a small gold spark
 * burst with a little "!" ("sparks-pop"), the sparks alone ("sparks", the
 * default), or nothing. Motion "off" and the OS reduced-motion setting turn
 * it off whatever this says (src/frontend/stage/click-sparks.ts).
 */
export const CLICK_EFFECTS = ["sparks-pop", "sparks", "off"] as const;
export type VisualNovelClickEffect = (typeof CLICK_EFFECTS)[number];

/** Dialogue text scale bounds (multiplier over the theme's dialogue font size). */
export const TEXT_SCALE_MIN = 0.8;
export const TEXT_SCALE_MAX = 1.6;

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
  "yamaku-classic",
  "literature-club",
  "cinema",
  "nvl",
  "daylight",
] as const;

export type VisualNovelThemePreset = (typeof THEME_PRESET_IDS)[number];

/**
 * The card shown when a reply opens, while its pictures are prepared:
 * "title" (the scene's place, time and weather over the card's background
 * picture) or "off".
 */
export const OPENING_CARD_MODES = ["title", "off"] as const;
export type VisualNovelOpeningCard = (typeof OPENING_CARD_MODES)[number];
/** The opening card shows at least this long (ms), unless the reader taps. */
export const OPENING_CARD_MIN_MS_MAX = 5000;
/**
 * The waiting screen while the next reply is written: the backdrop, and what
 * it recalls of the reply just read on top (see docs and waiting-screen.ts).
 */
export const WAITING_BACKDROPS = ["card", "tidy", "daylight", "cast", "off"] as const;
export type VisualNovelWaitingBackdrop = (typeof WAITING_BACKDROPS)[number];
export const WAITING_RECAPS = ["auto", "lineup", "cards", "film", "off"] as const;
export type VisualNovelWaitingRecap = (typeof WAITING_RECAPS)[number];

/** A named prompt preset: a positive (prefix) and a negative block. */
export type VisualNovelPromptPreset = {
  id: string;
  name: string;
  positive: string;
  negative: string;
};

export type VisualNovelConfig = {
  themePreset: VisualNovelThemePreset;
  enabled: boolean;
  autoEnter: boolean;
  sceneImageFit: VisualNovelSceneImageFit;
  debugLogging: boolean;
  generateImages: boolean;
  /** Anchor each character's appearance to their captured reference portrait. */
  referenceAnchoring: boolean;
  /** Where the reference anchor image comes from ("captured" render or "card" sprite). */
  referenceSource: VisualNovelReferenceSource;
  /** Suggested replies at Your turn when the reply has no choices of its own (above the reply box). */
  generateChoices: boolean;
  parserConnectionId: string | null;
  systemOneMode: "off" | "compare" | "on";
  systemOneApiUrl: string;
  systemOneModel: string;
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
  promptPresets: VisualNovelPromptPreset[];
  /** Append character creation/source reference to character tags: Character \(Source\) */
  originalReference: boolean;
  /** Creation/source name (e.g. "doki doki literature club") */
  originalCreationName: string;
  novelAiQualityTags: boolean;
  novelAiUseDefaultNegative: boolean;
  customPlannerInstructions: string;
  customCss: string;
  ignoredTags: string;
  /** Keep reasoning, trackers, recaps, menus and other non-story lines out of paragraphs (one short LLM check per reply). */
  skipNonStory: boolean;
  displayRegexRules: string;
  useNativeCardImages: boolean;
  textSpeed: number;
  autoPlayDelay: number;
  /**
   * Motion: how strongly stage effects play, and whether tagged dialogue
   * words (<shake>, <rainbow>, ...) move (see textEffectModeFor). Default "full".
   */
  effectIntensity: VisualNovelEffectIntensity;
  /** Full scene pictures (default) or sprite mode. */
  presentationMode: VisualNovelPresentationMode;
  /** Sprite cut-out quality. */
  spriteCutout: VisualNovelSpriteCutout;
  /** Sprite mode: full illustrations for a few key moments per reply. */
  keyIllustrations: VisualNovelKeyIllustrations;
  /** Sprite mode: image size on ComfyUI / SwarmUI (NovelAI ignores it). */
  spriteImageSize: VisualNovelSpriteImageSize;
  /** Sprite mode: expressions per character (4, 8 or 12). */
  spriteExpressionCount: VisualNovelSpriteExpressionCount;
  /** Where the sprite cut-out model is downloaded from (once, then cached in the browser). */
  spriteModelUrl: string;
  /** Where the Studio cut-out model is downloaded from; "" (default): none, "studio" cuts like "best". */
  spriteStudioModelUrl: string;
  /** Sprite mode: puppet motion strength in percent (0..SPRITE_MOTION_MAX). */
  spriteMotion: number;
  /** Sprite mode: the chest rises and falls. */
  spriteBreathing: boolean;
  /** Sprite mode: the body sways, bending from the feet. */
  spriteSway: boolean;
  /** Sprite mode: the head tilts and bobs on its own around the neck. */
  spriteHeadMotion: boolean;
  /** Sprite mode: posture follows the mood, the speaker's head follows the words, the others look at the speaker. */
  spriteActing: boolean;
  /** Sprite mode: hair and loose clothes trail, overshoot and settle; wind makes them flutter. */
  spritePhysics: boolean;
  /** Sprite mode: white sticker outline width in px (0 = none, up to SPRITE_OUTLINE_MAX). */
  spriteOutline: number;
  /** Sprite mode: blur the characters who are not speaking a little. */
  spriteFocusBlur: boolean;
  /** Sprite mode: how expression changes, entrances and exits play (SPRITE_TRANSITION_STYLES). */
  spriteTransitions: VisualNovelSpriteTransitions;
  /** Sprite mode: the scene's weather and light on the characters (breath in the cold, firelight, rain, mist...). */
  spriteAtmosphere: boolean;
  /** A click or tap on the stage: gold sparks with a "!", sparks alone, or nothing. */
  clickEffect: VisualNovelClickEffect;
  /** Sprite mode: pressing a character squishes it and it bounces back; that click does not read on. */
  spritePressBounce: boolean;
  /** Soft typing ticks and a pop, synthesized in the browser. Never while a voice reads aloud. */
  interfaceSounds: boolean;
  /** Volume of the interface sounds, 0..1. */
  interfaceSoundVolume: number;
  /** More inner-voice names (comma separated): their lines dim everyone and light the screen edges. */
  innerVoices: string;
  /** Dialogue text size multiplier, 1 = the theme's own size. */
  textScale: number;
  audioDirectory: string;
  bgmVolume: number;
  sfxVolume: number;
  /** Default-off speech (TTS) settings. See src/speech-config.ts. */
  speech: SpeechSettings;
  /** The card shown when a reply opens ("title" or "off"). */
  openingCard: VisualNovelOpeningCard;
  /** The opening card shows at least this long (ms, 0..OPENING_CARD_MIN_MS_MAX). */
  openingCardMinMs: number;
  /** The opening card and the waiting screen use the card's own background picture (`bg`, `background`, `배경`). */
  cardBackground: boolean;
  /** The scene's place, time and weather stay at the top left while reading. */
  locationLabel: boolean;
  /** The waiting screen's backdrop. */
  waitingBackdrop: VisualNovelWaitingBackdrop;
  /** What the waiting screen recalls of the reply just read. */
  waitingRecap: VisualNovelWaitingRecap;
  /** A new reply starts by itself when it is ready; off: the opening card waits for a tap. */
  playOnArrival: boolean;
  /** Your turn opens the reply box; off: the box waits behind a Reply button. */
  replyBoxAtEnd: boolean;
};

export const DEFAULT_CONFIG: VisualNovelConfig = {
  themePreset: "lumiverse",
  enabled: true,
  autoEnter: false,
  sceneImageFit: "cover",
  debugLogging: false,
  generateImages: true,
  referenceAnchoring: true,
  referenceSource: "captured",
  generateChoices: true,
  parserConnectionId: null,
  systemOneMode: "off",
  systemOneApiUrl: "https://api.typesafe.ai",
  systemOneModel: "jev-latest",
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
  promptPresets: [],
  originalReference: false,
  originalCreationName: "",
  novelAiQualityTags: true,
  novelAiUseDefaultNegative: true,
  customPlannerInstructions: "",
  customCss: "",
  ignoredTags: "",
  skipNonStory: true,
  displayRegexRules: "",
  useNativeCardImages: false,
  textSpeed: 20,
  autoPlayDelay: 2000,
  effectIntensity: "full",
  presentationMode: "scene",
  spriteCutout: "best",
  keyIllustrations: "off",
  spriteImageSize: "standard",
  spriteExpressionCount: DEFAULT_SPRITE_EXPRESSION_COUNT,
  spriteModelUrl: DEFAULT_SPRITE_MODEL_URL,
  spriteStudioModelUrl: "",
  spriteMotion: 100,
  spriteBreathing: true,
  spriteSway: true,
  spriteHeadMotion: true,
  spriteActing: false,
  spritePhysics: true,
  spriteOutline: 0,
  spriteFocusBlur: true,
  spriteTransitions: "expressive",
  spriteAtmosphere: true,
  clickEffect: "sparks",
  spritePressBounce: true,
  interfaceSounds: false,
  interfaceSoundVolume: 0.4,
  innerVoices: "",
  textScale: 1,
  audioDirectory: "",
  bgmVolume: 0.7,
  sfxVolume: 0.5,
  speech: DEFAULT_SPEECH_SETTINGS,
  openingCard: "title",
  openingCardMinMs: 1500,
  cardBackground: true,
  locationLabel: true,
  waitingBackdrop: "card",
  waitingRecap: "auto",
  playOnArrival: true,
  replyBoxAtEnd: true,
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

/** `value` when it is one of `options`, else `fallback`. */
function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? value as T : fallback;
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

function promptPresetList(value: unknown): VisualNovelPromptPreset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const presets: VisualNovelPromptPreset[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    presets.push({
      id,
      name,
      positive: typeof record.positive === "string" ? record.positive : "",
      negative: typeof record.negative === "string" ? record.negative : ""
    });
    if (presets.length >= 32) break;
  }
  return presets;
}

function referenceSource(value: unknown): VisualNovelReferenceSource {
  return typeof value === "string" && (REFERENCE_SOURCES as readonly string[]).includes(value)
    ? value as VisualNovelReferenceSource
    : DEFAULT_CONFIG.referenceSource;
}

function effectIntensity(value: unknown): VisualNovelEffectIntensity {
  return typeof value === "string" && (EFFECT_INTENSITIES as readonly string[]).includes(value)
    ? value as VisualNovelEffectIntensity
    : DEFAULT_CONFIG.effectIntensity;
}

function presentationMode(value: unknown): VisualNovelPresentationMode {
  return typeof value === "string" && (PRESENTATION_MODES as readonly string[]).includes(value)
    ? value as VisualNovelPresentationMode
    : DEFAULT_CONFIG.presentationMode;
}

function spriteCutout(value: unknown): VisualNovelSpriteCutout {
  return typeof value === "string" && (SPRITE_CUTOUT_QUALITIES as readonly string[]).includes(value)
    ? value as VisualNovelSpriteCutout
    : DEFAULT_CONFIG.spriteCutout;
}

function keyIllustrations(value: unknown): VisualNovelKeyIllustrations {
  return typeof value === "string" && (KEY_ILLUSTRATION_MODES as readonly string[]).includes(value)
    ? value as VisualNovelKeyIllustrations
    : DEFAULT_CONFIG.keyIllustrations;
}

function spriteImageSize(value: unknown): VisualNovelSpriteImageSize {
  return typeof value === "string" && (SPRITE_IMAGE_SIZES as readonly string[]).includes(value)
    ? value as VisualNovelSpriteImageSize
    : DEFAULT_CONFIG.spriteImageSize;
}

/** A model URL: https, or http on this machine; anything else is `fallback`. */
function modelUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      ? url.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

function spriteModelUrl(value: unknown): string {
  return modelUrl(value, DEFAULT_CONFIG.spriteModelUrl);
}

/** The stage feel settings of a config (what VnStage.setStageFeel needs). */
export function stageFeelSettings(config: VisualNovelStageFeel): VisualNovelStageFeel {
  return {
    clickEffect: config.clickEffect,
    spritePressBounce: config.spritePressBounce,
    interfaceSounds: config.interfaceSounds,
    interfaceSoundVolume: config.interfaceSoundVolume,
    innerVoices: config.innerVoices,
  };
}

/** The puppet settings of a config (what the sprite layer needs). */
export function spritePuppetSettings(config: VisualNovelSpritePuppet): VisualNovelSpritePuppet {
  return {
    spriteMotion: config.spriteMotion,
    spriteBreathing: config.spriteBreathing,
    spriteSway: config.spriteSway,
    spriteHeadMotion: config.spriteHeadMotion,
    spriteActing: config.spriteActing,
    spritePhysics: config.spritePhysics,
    spriteOutline: config.spriteOutline,
    spriteFocusBlur: config.spriteFocusBlur,
    spriteTransitions: config.spriteTransitions,
    spriteAtmosphere: config.spriteAtmosphere,
  };
}

export function normalizeSpriteTransitions(value: unknown): VisualNovelSpriteTransitions {
  return typeof value === "string" && (SPRITE_TRANSITION_STYLES as readonly string[]).includes(value)
    ? value as VisualNovelSpriteTransitions
    : DEFAULT_CONFIG.spriteTransitions;
}

function textScale(value: unknown): number {
  const scale = floatBetween(value, TEXT_SCALE_MIN, TEXT_SCALE_MAX, DEFAULT_CONFIG.textScale);
  return Math.round(scale * 100) / 100;
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

/**
 * Settings that merged into others. Each applies only while its retired key
 * is still stored; the next save writes the merged value without it, so each
 * happens once.
 * - `textEffects` "static" (tagged words kept still) or "off" (plain text,
 *   no longer offered) became Motion: such a config loads with Motion Still,
 *   so text that did not move still does not (scene effects stop too).
 * - `mode`: Suggest replies did nothing outside "cyoa". They cost
 *   story-reader tokens on every reply, so a config saved with another mode
 *   (the old default "standard") loads with them off.
 */
function migrateRetired(input: Record<string, unknown>): Record<string, unknown> {
  const next = { ...input };
  if (input.textEffects === "static" || input.textEffects === "off") next.effectIntensity = "off";
  if ("mode" in input && input.mode !== "cyoa") next.generateChoices = false;
  return next;
}

export function normalizeConfig(value: unknown): VisualNovelConfig {
  const input = migrateRetired(record(value));
  const themePreset = (THEME_PRESET_IDS as readonly string[]).includes(input.themePreset as string)
    ? input.themePreset as VisualNovelThemePreset
    : "lumiverse";
  return {
    themePreset,
    enabled: bool(input.enabled, DEFAULT_CONFIG.enabled),
    autoEnter: bool(input.autoEnter, DEFAULT_CONFIG.autoEnter),
    sceneImageFit: sceneImageFit(input.sceneImageFit),
    debugLogging: bool(input.debugLogging, DEFAULT_CONFIG.debugLogging),
    generateImages: bool(input.generateImages, DEFAULT_CONFIG.generateImages),
    referenceAnchoring: bool(input.referenceAnchoring, DEFAULT_CONFIG.referenceAnchoring),
    referenceSource: referenceSource(input.referenceSource),
    generateChoices: bool(input.generateChoices, DEFAULT_CONFIG.generateChoices),
    parserConnectionId: nullableString(input.parserConnectionId),
    systemOneMode: input.systemOneMode === "compare" || input.systemOneMode === "on" ? input.systemOneMode : "off",
    systemOneApiUrl: stringValue(input.systemOneApiUrl, DEFAULT_CONFIG.systemOneApiUrl).trim() || DEFAULT_CONFIG.systemOneApiUrl,
    systemOneModel: stringValue(input.systemOneModel, DEFAULT_CONFIG.systemOneModel).trim() || DEFAULT_CONFIG.systemOneModel,
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
    promptPresets: promptPresetList(input.promptPresets),
    originalReference: bool(input.originalReference, DEFAULT_CONFIG.originalReference),
    originalCreationName: stringValue(input.originalCreationName, DEFAULT_CONFIG.originalCreationName).trim(),
    novelAiQualityTags: bool(input.novelAiQualityTags, DEFAULT_CONFIG.novelAiQualityTags),
    novelAiUseDefaultNegative: bool(input.novelAiUseDefaultNegative, DEFAULT_CONFIG.novelAiUseDefaultNegative),
    customPlannerInstructions: stringValue(input.customPlannerInstructions, DEFAULT_CONFIG.customPlannerInstructions),
    customCss: stringValue(input.customCss, DEFAULT_CONFIG.customCss),
    ignoredTags: stringValue(input.ignoredTags, DEFAULT_CONFIG.ignoredTags),
    skipNonStory: bool(input.skipNonStory, DEFAULT_CONFIG.skipNonStory),
    displayRegexRules: stringValue(input.displayRegexRules, DEFAULT_CONFIG.displayRegexRules),
    useNativeCardImages: bool(input.useNativeCardImages, DEFAULT_CONFIG.useNativeCardImages),
    textSpeed: integer(input.textSpeed, 0, 100, DEFAULT_CONFIG.textSpeed),
    autoPlayDelay: integer(input.autoPlayDelay, 500, 10000, DEFAULT_CONFIG.autoPlayDelay),
    effectIntensity: effectIntensity(input.effectIntensity),
    presentationMode: presentationMode(input.presentationMode),
    spriteCutout: spriteCutout(input.spriteCutout),
    keyIllustrations: keyIllustrations(input.keyIllustrations),
    spriteImageSize: spriteImageSize(input.spriteImageSize),
    spriteExpressionCount: normalizeSpriteExpressionCount(input.spriteExpressionCount),
    spriteModelUrl: spriteModelUrl(input.spriteModelUrl),
    spriteStudioModelUrl: modelUrl(input.spriteStudioModelUrl, DEFAULT_CONFIG.spriteStudioModelUrl),
    spriteMotion: integer(input.spriteMotion, 0, SPRITE_MOTION_MAX, DEFAULT_CONFIG.spriteMotion),
    spriteBreathing: bool(input.spriteBreathing, DEFAULT_CONFIG.spriteBreathing),
    spriteSway: bool(input.spriteSway, DEFAULT_CONFIG.spriteSway),
    spriteHeadMotion: bool(input.spriteHeadMotion, DEFAULT_CONFIG.spriteHeadMotion),
    spriteActing: bool(input.spriteActing, DEFAULT_CONFIG.spriteActing),
    spritePhysics: bool(input.spritePhysics, DEFAULT_CONFIG.spritePhysics),
    spriteOutline: integer(input.spriteOutline, 0, SPRITE_OUTLINE_MAX, DEFAULT_CONFIG.spriteOutline),
    spriteFocusBlur: bool(input.spriteFocusBlur, DEFAULT_CONFIG.spriteFocusBlur),
    spriteTransitions: normalizeSpriteTransitions(input.spriteTransitions),
    spriteAtmosphere: bool(input.spriteAtmosphere, DEFAULT_CONFIG.spriteAtmosphere),
    clickEffect: (CLICK_EFFECTS as readonly string[]).includes(input.clickEffect as string)
      ? input.clickEffect as VisualNovelClickEffect
      : DEFAULT_CONFIG.clickEffect,
    spritePressBounce: bool(input.spritePressBounce, DEFAULT_CONFIG.spritePressBounce),
    interfaceSounds: bool(input.interfaceSounds, DEFAULT_CONFIG.interfaceSounds),
    interfaceSoundVolume: Math.round(floatBetween(input.interfaceSoundVolume, 0, 1, DEFAULT_CONFIG.interfaceSoundVolume) * 100) / 100,
    innerVoices: stringValue(input.innerVoices, DEFAULT_CONFIG.innerVoices).slice(0, 2000),
    textScale: textScale(input.textScale),
    audioDirectory: stringValue(input.audioDirectory, DEFAULT_CONFIG.audioDirectory).trim(),
    bgmVolume: floatBetween(input.bgmVolume, 0, 1, DEFAULT_CONFIG.bgmVolume),
    sfxVolume: floatBetween(input.sfxVolume, 0, 1, DEFAULT_CONFIG.sfxVolume),
    speech: normalizeSpeechSettings(input.speech),
    openingCard: oneOf(input.openingCard, OPENING_CARD_MODES, DEFAULT_CONFIG.openingCard),
    openingCardMinMs: integer(input.openingCardMinMs, 0, OPENING_CARD_MIN_MS_MAX, DEFAULT_CONFIG.openingCardMinMs),
    cardBackground: bool(input.cardBackground, DEFAULT_CONFIG.cardBackground),
    locationLabel: bool(input.locationLabel, DEFAULT_CONFIG.locationLabel),
    waitingBackdrop: oneOf(input.waitingBackdrop, WAITING_BACKDROPS, DEFAULT_CONFIG.waitingBackdrop),
    waitingRecap: oneOf(input.waitingRecap, WAITING_RECAPS, DEFAULT_CONFIG.waitingRecap),
    playOnArrival: bool(input.playOnArrival, DEFAULT_CONFIG.playOnArrival),
    replyBoxAtEnd: bool(input.replyBoxAtEnd, DEFAULT_CONFIG.replyBoxAtEnd),
  };
}
