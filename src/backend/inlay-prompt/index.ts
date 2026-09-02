// vendored from japolino/inlay-illustrator@2247423
// Public surface for Cue's Inlay pipeline (Phase B: vendoring only).

// --- Prompt compiler ---
export {
  assemblePrompt,
  compilePrompt,
  renderPrompt,
  renderPromptWithCurrentAffixes,
  renderNegativeWithCurrentSelection,
  normalizePromptSection,
  normalizeReferenceTags,
  normalizeCharacterName,
  activePromptPreset,
  buildCharacterTagReference
} from "./prompt.js";

// --- Prompt-related types ---
export type {
  AssembledPrompt,
  CharacterJson,
  CreativeConcept,
  PromptEntry,
  SceneJson,
  ShotJson,
  CameraJson,
  ParsedPayload
} from "./types.js";

// --- Camera value sets ---
export {
  CAMERA_FRAMING_VALUES,
  CAMERA_ANGLE_VALUES,
  CAMERA_PERSPECTIVE_VALUES,
  CAMERA_FOCUS_VALUES
} from "./camera-diversity.js";

// --- Config (vendored as inlay-config.ts) ---
export type {
  Config,
  RawConfig,
  PromptPreset,
  PerspectiveMode
} from "./inlay-config.js";
export {
  DEFAULT_CONFIG,
  normalizeConfig,
  normalizePromptPresets,
  effectiveGenerationConfig
} from "./inlay-config.js";

// --- Deterministic shot resolution ---
export {
  projectDynamicVisibleTags,
  resolveShotPerspective,
  resolveIllustrationPlan,
  tagVisibilityRegions,
  visibilityModifiersFor,
  cameraViewOf,
  isFragmentCameraFraming,
  isFragmentRenderScope,
  baselineTags
} from "./shot-resolution.js";

// --- Domain types and continuity helpers ---
export {
  applyContinuityDelta,
  resolveContinuity,
  continuityDeltaBetween,
  reconcileContinuityState
} from "./domain.js";
export type {
  ResolvedShot,
  ResolvedCharacter,
  IllustrationInput,
  IllustrationPlan,
  PlannedShot,
  PlannedCharacter,
  ContinuityState,
  ContinuityDelta,
  CharacterContinuityState,
  CharacterFieldSources,
  CharacterFieldSource,
  ShotMode
} from "./domain.js";
