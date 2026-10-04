/**
 * Sprite mode backend: library, generation, cut bridge and views.
 * See docs/SPRITE_MODE.md.
 */
export { spriteStyleKey, spriteSeedFor, SPRITE_PROMPT_VERSION } from "./style.js";
export {
  SPRITE_LIBRARY_PATH,
  MAX_SPRITE_SETS,
  MAX_SPRITE_PLATES,
  SpriteLibraryStore,
  normalizeSpriteLibrary,
  pruneSpriteLibrary,
  type SpriteLibrary,
  type StoredPlate,
  type StoredSpriteImage,
  type StoredSpriteSet,
} from "./library.js";
export {
  compilePlateRequest,
  compileSpriteRequest,
  spriteImageSizeFor,
  NOVELAI_PLATE_SIZE,
  NOVELAI_SPRITE_SIZE,
  PLATE_SIZE,
  SPRITE_IMAGE_SIZE_PRESETS,
  SPRITE_SIZE,
} from "./prompts.js";
export { SpriteCutBridge, SPRITE_CUT_TIMEOUT_MS, pngSize } from "./cut-bridge.js";
export { plateView, spriteImageView, spriteLibraryView, spriteSetView, spriteTurnView, stagingPlateKeys } from "./views.js";
export { SpriteService, plateWorkKey, spriteWorkKey, type SpriteAction, type SpriteServiceDeps } from "./jobs.js";
