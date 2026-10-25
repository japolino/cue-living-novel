import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { spritePuppetSettings, spriteSizeMatchSettings, stageFeelSettings, textEffectModeFor, type VisualNovelConfig, type VisualNovelEffectIntensity, type VisualNovelPresentationMode, type VisualNovelSpritePuppet, type VisualNovelSpriteSizeMatch, type VisualNovelStageFeel, type VisualNovelTextEffectMode } from "../../config.js";
import { REFERENCE_IMAGE_MAX_BYTES, REFERENCE_IMAGE_MIMES } from "../../protocol.js";
import type { AssetView, BackendResponse, ConnectionCatalogOption, DecisionStatus, FrontendRequest, TurnView } from "../../protocol.js";
import { AudioEngine, VnStage, isAmbientEffect, isStageEffect, type VnReadingFlow } from "../stage/index.js";
import type { AmbientEffect, StageEffect } from "../store/index.js";
import { VisualNovelSettingsPanel } from "../settings/panel.js";
import { cutoutDownloadNote } from "../settings/model.js";
import { DEFAULT_SPRITE_FACE_MODEL_URL, DEFAULT_SPRITE_MODEL_URL, spriteModelF16Url } from "../../shared/sprites.js";
import {
  clearCutoutModel,
  getCachedCutoutModelBytes,
  getCachedFaceModelBytes,
  getCutoutModelState,
  getFaceModelState,
  getStudioCutoutSupport,
  onCutoutModelArrived,
  onCutoutModelState,
  onFaceModelState,
  prepareCutoutModel,
  prepareFaceModel,
  prepareStudioCutoutModel,
  syncStudioCutout,
} from "../sprites/cutout/index.js";
import { canUpgradeTurn, type VnChoice, type VnTurnInput } from "../store/index.js";
import { createVnHeaderLauncher } from "./manual-launcher.js";
import { captureSimTrackerCards } from "./panel-capture.js";
import { GameBridge } from "./game-bridge.js";
import { connectImageBridge } from "./image-bridge.js";
import { PanelDock } from "../stage/panel-dock.js";
import { stagingContext, supportsVisualNovelOverlay, type ComponentOverrideHandle } from "./staging-context.js";
import { presentAmbient, presentEffect } from "./effect-presentation.js";
import {
  describeImageFailure,
  describeOperationError,
  describePlanningFailure,
  type HostStageError,
} from "./turn-status.js";
import { SpeechController, type SpeechCursor, type SpeechStatus } from "../speech/controller.js";
import { ChoirBridge } from "./choir-bridge.js";
import { PackSound } from "./pack-sound.js";
import { SpeechDock } from "../speech/ui.js";
import { SpeechSettingsSection } from "../speech/settings-ui.js";
import type { SpeechSettings } from "../../speech-config.js";
import { createSpriteCutService } from "../sprites/cut-service.js";
import { createSpriteFaceService } from "../sprites/face-service.js";
import { createNovelAiInsetService } from "../sprites/inset-service.js";
import { withPlate, withSpriteImage } from "../stage/sprite-layer.js";
import { spriteIllustrationViewFor, type PlateView, type SpriteIllustrationView, type SpriteImageView } from "../../shared/sprites.js";

const CLEANUP_KEY = Symbol.for("visual-novel-preview.frontend-cleanup");

/** Chunked bytes -> base64 that avoids call-stack limits on large audio files. */
function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

/**
 * Sound comes from Choir whenever Choir has its own sound on in this chat
 * (music, or effects and ambience with its Freesound key) and reads here:
 * through Cue's read aloud, or by itself (Choir's Auto). Cue's own audio
 * packs stay quiet then, so the two never play over each other; otherwise Cue
 * plays its packs, so the two never leave Cue silent.
 */
export function choirPlaysSound(speech: SpeechSettings | undefined, choir: Pick<ChoirBridge, "isAvailable" | "soundEnabled" | "readsByItself">): boolean {
  return choir.isAvailable() && choir.soundEnabled() && (Boolean(speech?.enabled) || choir.readsByItself());
}

/**
 * Whether a voice may be reading the story aloud now, which keeps the
 * interface sounds (typing ticks, the pop) quiet: Cue's read aloud is loading
 * or playing a paragraph, or Choir reads replies by itself (its Auto; Cue
 * cannot see when that reading starts or ends, so they stay quiet while it
 * is on). Choir's music and effects alone do not count: interface sounds are
 * not story sound.
 */
export function speechHoldsInterfaceSounds(status: Pick<SpeechStatus, "kind"> | null | undefined, choir: Pick<ChoirBridge, "readsByItself">): boolean {
  if (status?.kind === "loading" || status?.kind === "playing") return true;
  return choir.readsByItself();
}

/**
 * The status line under Use System One: the Decision connection it asks
 * (Lumiverse's default one), or what to set up in Lumiverse first.
 */
export function decisionStatusMessage(status: DecisionStatus): string {
  if (status.state === "ready") {
    const model = status.model ? ` (${status.model})` : "";
    return `Uses "${status.name ?? "Decision connection"}"${model}, Lumiverse's default Decision connection.`;
  }
  const reason = status.error ?? "No default Decision connection. In Lumiverse, open Connections → Decision models, add a connection and set it as default.";
  return `${reason} Until then, System One does not run and Cue uses the story reader.`;
}

/**
 * Answer a backend `vn_reference_fetch`: fetch the card asset from the
 * logged-in origin and relay it as a base64 data URL (the backend cannot
 * read image bytes itself). Always replies exactly once, with `dataUrl` or
 * `error`; no UI is involved and the base64 body is never logged.
 */
export async function relayReferenceFetch(
  message: { requestId: string; imageId: string },
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  send: (reply: Extract<FrontendRequest, { type: "vn_reference_image" }>) => void
): Promise<void> {
  try {
    const blob = await fetchLumiverseImage(message.imageId, fetchImpl);
    if (blob.size > REFERENCE_IMAGE_MAX_BYTES) throw new Error("Reference image exceeds the 8 MiB relay limit.");
    const mimeType = blob.type.toLowerCase();
    if (!REFERENCE_IMAGE_MIMES.has(mimeType)) throw new Error("Reference asset is not a supported image.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    send({ type: "vn_reference_image", requestId: message.requestId, dataUrl: `data:${mimeType};base64,${base64FromBytes(bytes)}` });
  } catch (error) {
    send({ type: "vn_reference_image", requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Fetch a Lumiverse image's bytes from the logged-in origin (same-origin
 * credentials). Shared by reference anchoring and the sprite cut-out.
 */
export async function fetchLumiverseImage(
  imageId: string,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<Blob> {
  const response = await fetchImpl(`/api/v1/images/${encodeURIComponent(imageId)}`, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`Image fetch failed (${response.status}).`);
  return response.blob();
}

function messageType(value: unknown): string {
  return value !== null && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"
    ? (value as { type: string }).type
    : "";
}

/**
 * Choose the image currently visible for a paragraph cursor.
 *
 * Pure and deterministic: among ready assets with `paragraphIndex <= cursor`,
 * pick the highest paragraph; when several share that paragraph, the FIRST one
 * in the turn's asset order wins (a stable tie) rather than the last. Previously
 * the `>=` comparison let the last asset at a shared paragraph win, so an asset
 * arriving later (or two distinct same-paragraph cues) could flip the background
 * with the cursor frozen.
 */
export function selectCurrentImage(turn: TurnView, paragraphIndex: number): AssetView | null {
  let match: AssetView | null = null;
  for (const asset of turn.assets) {
    if (asset.status !== "generated" && asset.status !== "browser_ready") continue;
    if (!asset.imageUrl || asset.paragraphIndex > paragraphIndex) continue;
    if (!match || asset.paragraphIndex > match.paragraphIndex) match = asset;
  }
  return match;
}

export function currentAssetError(turn: TurnView, paragraphIndex: number): string | null {
  const current = turn.assets.filter((asset) => asset.paragraphIndex <= paragraphIndex)
    .sort((a, b) => b.paragraphIndex - a.paragraphIndex)[0];
  return current?.status === "failed" ? current.error || "Image generation failed. Retry this turn." : null;
}

/**
 * Structured form of `currentAssetError`: a friendly message, the raw backend
 * text as detail, and a truthful statement of what "Try again" does (finished
 * images are kept; the whole turn is retried, never a single image).
 */
export function currentAssetFailure(turn: TurnView, paragraphIndex: number): HostStageError | null {
  const current = turn.assets.filter((asset) => asset.paragraphIndex <= paragraphIndex)
    .sort((a, b) => b.paragraphIndex - a.paragraphIndex)[0];
  return current?.status === "failed" ? describeImageFailure(turn, current.error) : null;
}

/**
 * Whether two turn deliveries refer to the same logical turn. Used to guard
 * against a re-broadcast of the same turn (a GENERATION_ENDED followed by a
 * MESSAGE_EDITED/SWIPE_EDITED/MESSAGE_SWIPED reconcile, or a `vn_retry_turn`)
 * resetting the paragraph cursor back to paragraph 0.
 */
export function sameTurnIdentity(
  left: Pick<TurnView, "chatId" | "messageId" | "sourceFingerprint">,
  right: Pick<TurnView, "chatId" | "messageId" | "sourceFingerprint">,
): boolean {
  return left.chatId === right.chatId
    && left.messageId === right.messageId
    && left.sourceFingerprint === right.sourceFingerprint;
}

/**
 * How a received turn should be applied to the stage. Pure so the same-turn
 * guard and load-turn decisions are testable without a DOM.
 *
 * A re-broadcast of the SAME logical turn is applied as "sync at the current
 * cursor" (never reset to paragraph 0); a genuinely different turn is a
 * "load-turn" that resets the narrative cursor while preserving the previous
 * scene's image until the new turn's scene image is generated and ready.
 */
export type TurnApplicationDecision =
  | { kind: "none" }
  | { kind: "planning" }
  | { kind: "error"; error: string }
  | { kind: "same-turn"; paragraphIndex: number }
  /** The planned turn (or other text) for the provisional one on the stage: upgrade it in place at the cursor. */
  | { kind: "upgrade"; paragraphIndex: number }
  | { kind: "load-turn" };

/**
 * How far the reader may read a reply's text before its visual plan lands:
 * the paragraph index they wait at, with "Preparing the scene", clamped to
 * the final paragraph (whose acknowledgement always waits: the plan brings
 * the choices). Infinity lets them read on to the end.
 */
export const PROVISIONAL_PLAN_HOLD = Number.POSITIVE_INFINITY;

/**
 * A provisional turn (text before the plan) that arrives for a turn already
 * planned, late or repeated, never replaces it.
 */
export function keepsPlannedTurn(previous: TurnView | null, next: TurnView): boolean {
  return Boolean(next.provisional && previous && !previous.provisional && sameTurnIdentity(previous, next));
}

/**
 * Whether the stage should preserve the currently displayed image across turns.
 * Preserving the image is only safe when advancing to a new turn within the SAME chat
 * and for the same speaker/card, so that the stage does not flash a blank screen while
 * the new turn's scene image generates.
 *
 * It must NEVER preserve the image when switching to a new chat, opening a new card,
 * or on the initial turn delivery.
 */
export function shouldPreserveImage(previous: TurnView | null, next: TurnView): boolean {
  if (!previous) return false;
  if (previous.chatId !== next.chatId) return false;
  const prevSpeaker = (previous.speaker || "").trim().toLowerCase();
  const nextSpeaker = (next.speaker || "").trim().toLowerCase();
  if (prevSpeaker && nextSpeaker && prevSpeaker !== nextSpeaker) return false;
  return true;
}

/**
 * Literal nameplate for one paragraph. The planner attributes a per-paragraph
 * speaker (`paragraphSpeakers`, parallel to `paragraphs`):
 * - a name -> that character/persona name is displayed;
 * - "" -> intentional narrator, the plate is hidden;
 * - null / absent -> unknown, fall back to the turn speaker (card name),
 *   which is exactly the pre-attribution behavior.
 */
export function nameplateForParagraph(view: TurnView, index: number): string {
  const attributed = view.paragraphSpeakers?.[index];
  return attributed === undefined || attributed === null ? view.speaker : attributed;
}

/**
 * Speech cursor for one paragraph of a ready turn. Preserves the raw tri-state
 * paragraph attribution ("" narrator / name / null-undefined unknown) so voice
 * resolution can mirror the nameplate exactly. Returns null for missing
 * paragraphs so planning/error states never produce a speakable cursor.
 */
export function speechCursorFor(view: TurnView, index: number): SpeechCursor | null {
  const text = view.paragraphs[index];
  if (typeof text !== "string") return null;
  const nextRaw = view.paragraphs[index + 1];
  return {
    chatId: view.chatId,
    messageId: view.messageId,
    sourceFingerprint: view.sourceFingerprint,
    paragraphIndex: index,
    text,
    nextText: typeof nextRaw === "string" ? nextRaw : undefined,
    paragraphSpeaker: view.paragraphSpeakers?.[index],
    turnSpeaker: view.speaker,
  };
}

/**
 * The validated one-shot stage effect for a paragraph, as a spreadable object,
 * after the user's effect-presentation preference ("full" keeps every effect).
 */
export function effectForParagraph(
  view: TurnView,
  index: number,
  intensity: VisualNovelEffectIntensity = "full",
): { effect?: StageEffect } {
  const effect = view.effects?.[index];
  if (!isStageEffect(effect)) return {};
  const presented = presentEffect(effect, intensity);
  return presented ? { effect: presented } : {};
}

/** The validated ambient effect for a paragraph, as a spreadable object. */
export function ambientForParagraph(
  view: TurnView,
  index: number,
  intensity: VisualNovelEffectIntensity = "full",
): { ambient?: AmbientEffect | null } {
  const ambient = view.ambients?.[index];
  if (ambient === null) return { ambient: null };
  return isAmbientEffect(ambient) ? { ambient: presentAmbient(ambient, intensity) } : {};
}

/** The turn-level opening ambient (paragraph 0's ambient, when valid). */
export function firstAmbient(view: TurnView, intensity: VisualNovelEffectIntensity = "full"): AmbientEffect | null {
  const ambient = view.ambients?.[0];
  return isAmbientEffect(ambient) ? presentAmbient(ambient, intensity) : null;
}

/** Build the stage input without turning absent ambient data into a clear. */
export function stageTurnInput(
  next: TurnView,
  preserveImage: boolean,
  intensity: VisualNovelEffectIntensity = "full",
  planHold: number = PROVISIONAL_PLAN_HOLD,
): VnTurnInput {
  return {
    paragraphs: next.paragraphs.map((text, index) => ({
      id: `${next.sourceFingerprint}:${index}`,
      text,
      speaker: nameplateForParagraph(next, index),
      ...effectForParagraph(next, index, intensity),
      ...ambientForParagraph(next, index, intensity)
    })),
    choices: next.choices.map((choice) => ({ id: choice.id, label: choice.label, value: choice.value })),
    preserveImage,
    ...(next.ambients !== undefined ? { ambient: firstAmbient(next, intensity) } : {}),
    ...(next.sprites ? { sprites: next.sprites } : {}),
    ...(next.scenes ? { scenes: next.scenes } : {}),
    cardBackgroundUrl: next.cardBackgroundUrl ?? null,
    writer: next.speaker,
    ...(next.provisional ? { planHold } : {})
  };
}

/** Same paragraphs and the same speakers for them. */
function sameTurnText(a: TurnView, b: TurnView): boolean {
  const same = (x: readonly unknown[] | undefined, y: readonly unknown[] | undefined) =>
    (x ?? []).length === (y ?? []).length && (x ?? []).every((value, index) => value === (y ?? [])[index]);
  return same(a.paragraphs, b.paragraphs) && same(a.paragraphSpeakers, b.paragraphSpeakers);
}

export function decideTurnApplication(
  previous: TurnView | null,
  next: TurnView,
  cursor: number,
  active: boolean,
  hasLoadedTurn: boolean,
  /**
   * The stage holds text that waits for its plan (`planHold`). The host's own
   * turn can be the planned one already: it arrived while the view was closed.
   */
  stageAwaitsPlan = false,
): TurnApplicationDecision {
  if (!active) return { kind: "none" };
  // Only treat a re-broadcast as the same turn when the stage is actually showing
  // it. A vn_state that arrives while inactive records the turn but never loads
  // the paragraphs, so the first active delivery still needs a real load-turn.
  const shown = Boolean(previous && hasLoadedTurn && sameTurnIdentity(previous, next));
  // The text before the plan reads like a turn, although its status is "planning".
  // The same text again is a cursor sync; other text for the same reply (Try
  // again after a failed line check) is applied where the reader is.
  if (next.provisional) {
    if (!shown) return { kind: "load-turn" };
    return previous && sameTurnText(previous, next) ? { kind: "same-turn", paragraphIndex: cursor } : { kind: "upgrade", paragraphIndex: cursor };
  }
  if (next.status === "planning") return { kind: "planning" };
  if (next.status === "failed") return { kind: "error", error: next.error ?? "Visual planning failed." };
  if (shown) {
    return previous?.provisional || stageAwaitsPlan ? { kind: "upgrade", paragraphIndex: cursor } : { kind: "same-turn", paragraphIndex: cursor };
  }
  return { kind: "load-turn" };
}

function replaceAsset(turn: TurnView, asset: AssetView): TurnView {
  const assets = turn.assets.some((entry) => entry.cueId === asset.cueId)
    ? turn.assets.map((entry) => entry.cueId === asset.cueId ? asset : entry)
    : [...turn.assets, asset];
  return { ...turn, assets };
}

export function computeAssetProgress(turn: TurnView | null): { current: number; total: number } | null {
  if (!turn || !turn.assets || turn.assets.length === 0) return null;
  // Cache-served extra swaps never generate; they must not inflate "n of m".
  const budgeted = turn.assets.filter((a) => a.source !== "cache");
  if (budgeted.length === 0) return null;
  const total = budgeted.length;
  // A cancelled picture is not done: it resumes when the view reopens, and
  // until then it is neither counted nor shown as a failure.
  const done = budgeted.filter(
    (a) =>
      a.status === "generated" ||
      a.status === "browser_ready" ||
      a.status === "failed",
  ).length;
  const inFlight = budgeted.filter((a) => a.status === "generating" || a.status === "queued").length;
  if (inFlight > 0) {
    const current = Math.min(total, done + 1);
    return { current, total };
  }
  return null;
}

/**
 * The subset of VnStage the controller pushes saved-config presentation onto.
 * Keeping this narrow lets tests exercise the live stage calls without a DOM.
 */
export type VisualStageThemeTarget = Pick<
  VnStage,
  "setThemePreset" | "setSceneImageFit" | "setUserCss" | "setDisplayRegexRules"
> & {
  setTextSpeed?: (speed: number) => void;
  setAutoPlayDelay?: (delay: number) => void;
  /** Dialogue text size multiplier (stage sets `--vn-text-scale`). */
  setTextScale?: (scale: number) => void;
  /** Lets the stage also gate its own heuristic effects (text-triggered shake). */
  setEffectIntensity?: (level: VisualNovelEffectIntensity) => void;
  /** Inline dialogue text effects mode (stage sets `data-vn-text-effects`). */
  setTextEffects?: (mode: VisualNovelTextEffectMode) => void;
  /** Scene pictures or sprite mode (stage shows or removes the sprite layer). */
  setPresentationMode?: (mode: VisualNovelPresentationMode) => void;
  /** Sprite puppet motion, outline and focus blur. */
  setSpritePuppet?: (settings: VisualNovelSpritePuppet) => void;
  /** Sprite size matching: every face at one size. */
  setSpriteSizeMatch?: (settings: VisualNovelSpriteSizeMatch) => void;
  /** How a reply opens, waits and ends (opening card, location label, waiting screen, playback). */
  setReadingFlow?: (flow: VnReadingFlow) => void;
  /** Click sparks, press-to-bounce, interface sounds and extra inner voices. */
  setStageFeel?: (settings: VisualNovelStageFeel) => void;
};

/** The reading-flow settings of a config (what the stage needs). */
export function readingFlowSettings(config: VisualNovelConfig): VnReadingFlow {
  return {
    openingCard: config.openingCard,
    openingCardMinMs: config.openingCardMinMs,
    cardBackground: config.cardBackground,
    locationLabel: config.locationLabel,
    waitingBackdrop: config.waitingBackdrop,
    waitingRecap: config.waitingRecap,
    playOnArrival: config.playOnArrival,
    replyBoxAtEnd: config.replyBoxAtEnd,
  };
}

/**
 * Push a config's presentation settings onto the stage. Applied on every save
 * and on every `vn_state` / `vn_config` response so the stage always mirrors
 * the persisted config: the active theme preset, the scene-image fit, the
 * user's custom CSS (which stays the final cascade layer), custom display regex rules,
 * and dialogue flow parameters (typewriter speed, auto-play delay, skip mode).
 */
export function applyVisualConfigToStage(
  stage: VisualStageThemeTarget,
  config: VisualNovelConfig,
): void {
  stage.setThemePreset(config.themePreset);
  stage.setSceneImageFit(config.sceneImageFit);
  stage.setUserCss(config.customCss);
  stage.setDisplayRegexRules(config.displayRegexRules);
  stage.setTextSpeed?.(config.textSpeed);
  stage.setAutoPlayDelay?.(config.autoPlayDelay);
  stage.setTextScale?.(config.textScale);
  stage.setEffectIntensity?.(config.effectIntensity);
  stage.setTextEffects?.(textEffectModeFor(config.effectIntensity));
  stage.setPresentationMode?.(config.presentationMode);
  stage.setSpritePuppet?.(spritePuppetSettings(config));
  stage.setSpriteSizeMatch?.(spriteSizeMatchSettings(config));
  stage.setReadingFlow?.(readingFlowSettings(config));
  stage.setStageFeel?.(stageFeelSettings(config));
}

/**
 * Whether the stage paints this turn itself in sprite mode (plates and
 * sprites from `turn.sprites`). Scene-image sync stays off then, so plates
 * and leftover scene assets never fight over the background.
 */
export function stageOwnsBackground(config: Pick<VisualNovelConfig, "presentationMode"> | null, turn: Pick<TurnView, "sprites"> | null): boolean {
  return config?.presentationMode === "sprites" && Boolean(turn?.sprites);
}

/**
 * Sprite mode: map a `vn_asset` of a key-moment job onto the turn's
 * `sprites.illustrations` (the backend no longer re-sends the turn). Returns
 * the turn unchanged and a null view when the asset is not a key
 * illustration of this turn (another paragraph, a stale job, scene mode).
 */
export function turnWithIllustrationAsset<T extends Pick<TurnView, "sprites">>(
  turn: T,
  asset: Pick<AssetView, "jobId" | "paragraphIndex" | "status" | "imageUrl">,
): { turn: T; view: SpriteIllustrationView | null } {
  const sprites = turn.sprites;
  if (!sprites?.staging.paragraphs[asset.paragraphIndex]?.illustrate) return { turn, view: null };
  const list = sprites.illustrations ?? [];
  const before = list.find((item) => item.paragraphIndex === asset.paragraphIndex);
  // The paragraph's job is the one the view already names (a new job only when none is known).
  if (before && before.jobId !== asset.jobId) return { turn, view: null };
  const view = spriteIllustrationViewFor(asset);
  if (before && before.status === view.status && before.url === view.url) return { turn, view };
  const illustrations = [...list.filter((item) => item.paragraphIndex !== asset.paragraphIndex), view]
    .sort((left, right) => left.paragraphIndex - right.paragraphIndex);
  return { turn: { ...turn, sprites: { ...sprites, illustrations } }, view };
}

/**
 * The failed key illustration at a paragraph (sprite mode), with the job's
 * error text when the turn knows it; null when the paragraph's picture is
 * not failed.
 */
export function failedIllustrationAt(turn: Pick<TurnView, "sprites" | "assets">, paragraphIndex: number): { jobId: string; error: string | null } | null {
  const sprites = turn.sprites;
  if (!sprites?.staging.paragraphs[paragraphIndex]?.illustrate) return null;
  const view = sprites.illustrations?.find((item) => item.paragraphIndex === paragraphIndex);
  if (view?.status !== "failed") return null;
  const asset = turn.assets.find((entry) => entry.jobId === view.jobId);
  return { jobId: view.jobId, error: asset?.error ?? null };
}

/** The non-blocking image card for a failed key illustration (its "Try again" is the turn retry). */
export function describeIllustrationFailure(error: string | null): HostStageError {
  return {
    message: "The picture for this key moment could not be made. The sprites stay on stage.",
    ...(error ? { detail: error } : {}),
    source: "image",
    retryable: true,
    retryScope: "Try again makes the key-moment picture again and keeps the reply.",
  };
}

/** Apply a `vn_sprite_update` to a turn's sprite view (unchanged turns are returned as is). */
export function turnWithSpriteImage<T extends Pick<TurnView, "sprites">>(turn: T, setKey: string, image: SpriteImageView): T {
  if (!turn.sprites) return turn;
  const { view, changed } = withSpriteImage(turn.sprites, setKey, image);
  return changed.length ? { ...turn, sprites: view } : turn;
}

/** Apply a `vn_plate_update` to a turn's sprite view (unchanged turns are returned as is). */
export function turnWithPlate<T extends Pick<TurnView, "sprites">>(turn: T, plate: PlateView): T {
  if (!turn.sprites) return turn;
  const { view, changed } = withPlate(turn.sprites, plate);
  return changed ? { ...turn, sprites: view } : turn;
}

/**
 * The subset of the settings panel the host reports back into. Every member
 * beyond the original three is optional so the host works with a panel that
 * has not adopted the redesign feedback yet.
 */
export type SettingsFeedbackTarget = {
  setConfig(config: VisualNovelConfig): void;
  setConnectionCatalog(kind: "planner" | "image", state: ConnectionCatalogFeedback): void;
  setDecisionStatus(message: string): void;
  setAudioStatus(message: string): void;
  /** Acknowledged save result: "saved" only after the backend echoes `vn_config`. */
  setSaveStatus?(status: { kind: "saved" } | { kind: "error"; error: string }): void;
  /** Exact library counts from the last scan/import. */
  setAudioLibrary?(library: { bgmCount: number; sfxCount: number }): void;
  /** Sprite mode: one sprite image changed (library gallery). */
  applySpriteUpdate?(setKey: string, image: SpriteImageView): void;
  /** Sprite mode: one plate changed (library gallery). */
  applyPlateUpdate?(plate: PlateView): void;
};

export type ConnectionCatalogFeedback =
  | { status: "idle" | "loading"; options: readonly ConnectionCatalogOption[] }
  | { status: "ready"; options: readonly ConnectionCatalogOption[] }
  | { status: "error"; options: readonly ConnectionCatalogOption[]; error: string };

/**
 * Truthful catalog states from a `vn_connection_catalog` response. A kind whose
 * listing failed is reported as an error (the backend lists each kind with
 * `allSettled`); "ready" only means "listed by Lumiverse", never "tested".
 */
export function connectionCatalogStates(message: {
  planner?: ConnectionCatalogOption[];
  image?: ConnectionCatalogOption[];
  errors?: { planner?: string; image?: string };
}): Record<"planner" | "image", ConnectionCatalogFeedback> {
  const forKind = (kind: "planner" | "image"): ConnectionCatalogFeedback => {
    const error = message.errors?.[kind];
    if (error) return { status: "error", options: [], error };
    return { status: "ready", options: message[kind] ?? [] };
  };
  return { planner: forKind("planner"), image: forKind("image") };
}

/**
 * The messages one state request sends, in order. The `vn_view` announcement
 * always precedes `vn_get_state` so a (re)started backend learns whether this
 * chat's view is open before it decides to plan; `viewOpen` repeats the flag on
 * the state request itself. Every boot, reconnect, activation, and chat switch
 * goes through this, which is how the backend relearns view state after a
 * restart. Without a chat there is nothing to announce.
 */
export function viewStateMessages(chatId: string, viewOpen: boolean | undefined): FrontendRequest[] {
  // `undefined` = say nothing about the view. Used for the boot request: a
  // page reload must not close a view the backend still holds open (and
  // abort its image batch) before the config says whether autoEnter reopens
  // it. The first vn_state reply settles the view explicitly.
  if (viewOpen === undefined) return [{ type: "vn_get_state", chatId }];
  if (!chatId) return [{ type: "vn_get_state", chatId, viewOpen }];
  return [
    { type: "vn_view", chatId, open: viewOpen },
    { type: "vn_get_state", chatId, viewOpen },
  ];
}

export function setupVisualNovelFrontend(baseContext: SpindleFrontendContext): () => void {
  const previousCleanup = (globalThis as Record<PropertyKey, unknown>)[CLEANUP_KEY];
  if (typeof previousCleanup === "function") previousCleanup();

  const ctx = stagingContext(baseContext);
  const app = ctx.ui.mountApp({ className: "visual-novel-preview-mount", position: "app-overlay" });
  Object.assign(app.root.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    // Divide by the Lumiverse UI scale: the mount sits under `body > * { zoom }`.
    height: "calc(100dvh / var(--lumiverse-ui-scale, 1))",
    zIndex: "9990"
  });
  app.setVisible(false);

  let active = false;
  const configRef: { current: VisualNovelConfig | null } = { current: null };
  // Browser-console mirror of the backend "listening" trace. Gated by the same
  // debugLogging setting; shows every backend message the frontend listens to.
  const vnDebug = (...parts: unknown[]): void => {
    if (configRef.current?.debugLogging) console.info("[VN]", ...parts);
  };
  let turn: TurnView | null = null;
  let pendingNextTurn: TurnView | null = null;
  // Where the reader was when Regenerate / Try again started; restored if the turn comes back unchanged.
  let retryResumePhase: "revealing" | "awaiting-input" | null = null;
  let overrideHandles: ComponentOverrideHandle[] = [];
  const acknowledgedAssets = new Set<string>();
  let destroyed = false;
  const audioEngine = new AudioEngine({
    bgmVolume: configRef.current?.bgmVolume ?? 0.7,
    sfxVolume: configRef.current?.sfxVolume ?? 0.5,
  });

  let speech: SpeechController;
  let speechDock: SpeechDock;

  /**
   * The text before the plan read aloud (speakBeforePlan): the speech cursor
   * that came from it, and the one whose speech actually started (loading or
   * playing). The upgrade leaves a started paragraph be and gives any other
   * the plan's speaker.
   */
  let provisionalCursorKey: string | null = null;
  let provisionalSpokenKey: string | null = null;
  const isSpeechHoldingAuto = (): boolean => {
    if (!speech) return false;
    const s = speech.getStatus();
    if (s.kind === "loading" || s.kind === "playing" || s.kind === "paused") return true;
    // Speech waits for the plan to know who speaks: auto play waits with it, so no paragraph goes unspoken.
    const settings = configRef.current?.speech;
    return Boolean(turn?.provisional && settings?.enabled && !settings.speakBeforePlan);
  };

  const syncSpeechCursor = (view: TurnView | null, paragraphIndex: number): void => {
    // The text before the plan is read only with speakBeforePlan; otherwise speech waits for the plan.
    const speakable = view && (view.status === "ready" || (view.provisional && configRef.current?.speech.speakBeforePlan));
    const cursor = speakable ? speechCursorFor(view, paragraphIndex) : null;
    const key = cursor && view?.provisional ? `${view.sourceFingerprint}:${paragraphIndex}` : null;
    if (key !== provisionalCursorKey) provisionalSpokenKey = null;
    provisionalCursorKey = key;
    speech?.setCursor(cursor);
  };
  /**
   * The first paragraph's sound and voice wait while the opening card is up:
   * the stage's onReadingStart runs them when it closes. Otherwise at once.
   */
  let readingStartWork: (() => void) | null = null;
  const whenReading = (work: () => void): void => {
    if (stage.isOpeningCardOpen()) {
      readingStartWork = work;
      speech?.setCursor(null);
      return;
    }
    readingStartWork = null;
    work();
  };
  const onVisibilityChanged = (): void => {
    if (speech) speech.setVisible(!document.hidden);
  };
  document.addEventListener("visibilitychange", onVisibilityChanged);

  const packSound = new PackSound(audioEngine);
  let turnOpeningBgm: string | null = null;
  /** Choir's switches can change inside Choir or with the chat, so this runs before each cue too. */
  function syncSoundSource(): void {
    packSound.useChoir(choirPlaysSound(configRef.current?.speech, choirBridge), active);
  }
  /** The music in effect at a paragraph, without its sound effect (a rewind, or the plan reaching the paragraph on screen). */
  function restoreMusicAt(activeTurn: TurnView | null, paragraphIndex: number): void {
    const earlierMusic = activeTurn?.audioCues?.filter((cue) => cue.paragraphIndex <= paragraphIndex && (cue.bgmUrl || cue.bgm))
      .sort((a, b) => b.paragraphIndex - a.paragraphIndex)[0];
    syncSoundSource();
    packSound.restore(earlierMusic?.bgmUrl || earlierMusic?.bgm || turnOpeningBgm);
  }
  function syncAudioForParagraph(activeTurn: TurnView, paragraphIndex: number): void {
    syncSoundSource();
    const cue = activeTurn.audioCues?.find((c) => c.paragraphIndex === paragraphIndex);
    if (!cue) return;
    const bgm = cue.bgmUrl || cue.bgm;
    const sfx = cue.sfxUrl || cue.sfx;
    if (bgm) vnDebug("audio", `p${paragraphIndex}`, "bgm ->", bgm);
    if (sfx) vnDebug("audio", `p${paragraphIndex}`, "sfx ->", sfx);
    packSound.play({ bgm, sfx });
  }

  // Moves from game-engine extensions (Warp etc.): shown on the stage, picked back to their owner.
  let gameBridge: GameBridge | null = null;
  const syncGameChoices = (): void => {
    const id = chatId();
    const choices = gameBridge?.choicesFor(id) ?? [];
    stage.setGameChoices(choices.map(({ id: choiceId, label, group, detail, odds }) => ({ id: choiceId, label, group, detail, odds })), gameBridge?.busyFor(id) ?? false);
  };

  const stage = new VnStage({
    mount: app.root,
    themePreset: configRef.current?.themePreset ?? "lumiverse",
    isAutoAdvanceHeld: () => isSpeechHoldingAuto(),
    isSpeechActive: () => speechHoldsInterfaceSounds(speech?.getStatus(), choirBridge),
    onExit: () => deactivate(),
    onPrevious: (paragraphIndex) => {
      panels.setCursor(paragraphIndex);
      // From the start under a replayed opening card: the voice waits for the card.
      const rewound = turn;
      whenReading(() => syncSpeechCursor(rewound, paragraphIndex));
      restoreMusicAt(turn, paragraphIndex);
      void syncImageForParagraph(paragraphIndex);
    },
    onAdvance: (paragraphIndex) => {
      panels.setCursor(paragraphIndex);
      if (pendingNextTurn) {
        const next = pendingNextTurn;
        pendingNextTurn = null;
        applyTurn(next, turn);
        return;
      }
      syncSpeechCursor(turn, paragraphIndex);
      if (turn) syncAudioForParagraph(turn, paragraphIndex);
      void syncImageForParagraph(paragraphIndex);
    },
    onChoice: async (choice: VnChoice) => {
      const raw = choice.value?.trim() ?? "";
      const isNumeric = /^\s*(?:\d+|choice[_-]?\d+|option\s*\d+)\s*$/i.test(raw);
      const submission = (!raw || isNumeric) ? choice.label : raw;
      await handleUserSubmission(submission);
    },
    onSubmit: async (content: string) => {
      await handleUserSubmission(content);
    },
    onGameChoice: async (choice) => {
      const activeChatId = chatId();
      const picked = gameBridge?.choicesFor(activeChatId).find((entry) => entry.id === choice.id);
      if (!picked || !gameBridge) throw new Error("That move isn't available anymore.");
      speech.setCursor(null);
      stage.presentUserParagraph(picked.label, turn?.userSpeaker || "You");
      gameBridge.pick(activeChatId, picked);
    },
    onReroll: () => {
      const activeChatId = chatId();
      if (!activeChatId) return;
      retryResumePhase = stage.getState().phase === "awaiting-input" ? "awaiting-input" : "revealing";
      stage.setPhase("planning");
      if (!turn) {
        // No turn exists (an unselected macro greeting): re-check the latest
        // message instead of retrying a turn that was never planned.
        ctx.sendToBackend({ type: "vn_refresh", chatId: activeChatId });
        return;
      }
      ctx.sendToBackend({
        type: "vn_retry_turn",
        chatId: activeChatId,
        messageId: turn.messageId,
      });
    },
    onSwipe: () => {
      const activeChatId = chatId();
      if (!activeChatId || !turn) return;
      retryResumePhase = stage.getState().phase === "awaiting-input" ? "awaiting-input" : "revealing";
      stage.setPhase("planning");
      ctx.sendToBackend({
        type: "vn_retry_turn",
        chatId: activeChatId,
        messageId: turn.messageId,
      });
    },
    onSpriteRetry: (setKey) => ctx.sendToBackend({ type: "vn_sprite_action", action: "retry_failed", setKey }),
    onReadingStart: () => {
      const work = readingStartWork;
      readingStartWork = null;
      work?.();
    },
  });
  // The cut-out model downloads in the background on first use (the first
  // sprites are cut with Basic meanwhile): the stage shows its progress, and
  // its arrival has the backend re-cut those sprites with it.
  stage.setSpriteNote(cutoutDownloadNote(getCutoutModelState()));
  const unsubStageCutout = onCutoutModelState((state) => stage.setSpriteNote(cutoutDownloadNote(state)));
  const unsubCutoutArrival = onCutoutModelArrived(() => ctx.sendToBackend({ type: "vn_sprite_cutout_ready" }));

  let panelCapture: { chatId: string; messageId: string; fingerprint: string | null; cards: Array<{ title: string; html: string }> } | null = null;
  // Speech (default-off TTS). Own player and lifecycle; never the SFX channel.
  // Mounted into stage.panelMount so it renders in front of the stage scene and background.
  const choirBridge = new ChoirBridge(typeof window !== "undefined" ? window : null);

  speechDock = new SpeechDock({
    mount: stage.panelMount,
    onPlay: () => { void speech.playCurrent(); },
    onPause: () => speech.pause(),
    onStop: () => speech.stop("user-stop"),
  });
  choirBridge.onMusicChange((music) => speechDock.setMusicCredit(music?.credit ?? null));
  speech = new SpeechController({
    choirBridge,
    onStatus: (status) => {
      speechDock.setStatus(status);
      if (provisionalCursorKey && (status.kind === "loading" || status.kind === "playing")) provisionalSpokenKey = provisionalCursorKey;
      if (status.kind === "loading" || status.kind === "playing" || status.kind === "paused") {
        stage.holdAutoPlay();
      } else if (active) {
        stage.checkAutoPlay();
      }
    },
  });

  gameBridge = new GameBridge(window, syncGameChoices);
  const imageBridge = connectImageBridge(window, chatId, (request) => ctx.sendToBackend(request));

  const panels = new PanelDock(stage.panelMount);
  const panelRequests = new Map<string, { resolve: (template: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  panels.onResolveTemplate = (template) => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { panelRequests.delete(requestId); reject(new Error("Host template resolution timed out.")); }, 10_000);
    panelRequests.set(requestId, { resolve, reject, timer });
    const context = ctx.getActiveChat();
    ctx.sendToBackend({ type: "vn_resolve_panel_template", chatId: context.chatId ?? "", ...(context.characterId ? { characterId: context.characterId } : {}), requestId, template });
  });
  panels.onCapture = () => {
    if (!turn) return [];
    const mounted = captureSimTrackerCards(ctx.dom.findMessageElement(turn.messageId), document);
    if (mounted.length) return mounted;
    return panelCapture?.chatId === turn.chatId && panelCapture.messageId === turn.messageId && panelCapture.fingerprint === turn.sourceFingerprint ? panelCapture.cards : [];
  };

  const action = ctx.ui.registerInputBarAction({
    id: "visual-novel-preview-toggle",
    label: "Open Cue",
    subtitle: "Open this chat as a full-screen visual novel",
    enabled: true
  });
  const headerLauncher = createVnHeaderLauncher(
    ctx.ui.mount("chat_header_right"),
    () => toggleVisualNovel(),
  );
  const settingsHandle = ctx.ui.registerSettingsTab?.({
    id: "visual-novel-preview",
    title: "Cue",
    shortName: "Cue",
    description: "Cue: reading, pictures, sound, voice and look of the visual-novel view",
    keywords: ["cue", "visual novel", "cyoa", "images", "custom css"],
    position: "after-display"
  });
  const settingsPanel: (VisualNovelSettingsPanel & SettingsFeedbackTarget) | null = settingsHandle ? new VisualNovelSettingsPanel({
    mount: settingsHandle.root,
    onOpenPreview: () => { if (!active) toggleVisualNovel(); },
    onPreviewWaiting: () => {
      if (!active) toggleVisualNovel();
      if (active) stage.previewWaitingScreen();
    },
    onReplayOpening: () => {
      if (!active) toggleVisualNovel();
      if (active) stage.replayOpeningCard();
    },
    onOpenPanelTools: () => {
      if (!active) toggleVisualNovel();
      if (active) panels.openTools();
    },
    onRefreshConnections: () => requestConnectionCatalog(),
    onCheckDecisions: () => ctx.sendToBackend({ type: "vn_get_decision_status" }),
    onOpenDecisionConnections: () => ctx.sendToBackend({ type: "vn_open_decision_connections" }),
    onScanAudio: (directory) => {
      ctx.sendToBackend({ type: "vn_scan_audio", directory });
    },
    onImportAudio: async (files) => {
      const supported = [".mp3", ".ogg", ".wav", ".m4a", ".flac"];
      const audioFiles = files.filter((file) => supported.some((extension) => file.name.toLowerCase().endsWith(extension)));
      if (audioFiles.length === 0) {
        settingsPanel?.setAudioStatus("No supported audio files (.mp3/.ogg/.wav/.m4a/.flac) in that folder.");
        return;
      }
      let sent = 0;
      let skipped = 0;
      for (const file of audioFiles) {
        if (file.size > 30 * 1024 * 1024) {
          skipped += 1;
          continue;
        }
        settingsPanel?.setAudioStatus(`Importing ${sent + 1}/${audioFiles.length}: ${file.name}…`);
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
          const dataBase64 = base64FromBytes(bytes);
          // The host WebSocket bridge rejects frontend->backend messages over
          // 4 MB, so larger files are sent as ordered chunks and reassembled.
          const chunkSize = 3_000_000;
          if (dataBase64.length <= chunkSize) {
            ctx.sendToBackend({ type: "vn_import_audio_file", relativePath, dataBase64 });
          } else {
            const chunkCount = Math.ceil(dataBase64.length / chunkSize);
            const transferId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
              ctx.sendToBackend({
                type: "vn_import_audio_file",
                relativePath,
                dataBase64: dataBase64.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize),
                transferId,
                chunkIndex,
                chunkCount
              });
            }
          }
          sent += 1;
          vnDebug("audio import", relativePath, `${bytes.length} bytes`, dataBase64.length > chunkSize ? `(${Math.ceil(dataBase64.length / chunkSize)} chunks)` : "");
        } catch {
          skipped += 1;
        }
      }
      ctx.sendToBackend({ type: "vn_import_audio_done", fileCount: sent });
      settingsPanel?.setAudioStatus(`Sent ${sent} file(s)${skipped ? `, skipped ${skipped}` : ""}; scanning…`);
    },
    onSave: (patch) => {
      const current = configRef.current;
      if (current) {
        const next = { ...current, ...patch };
        configRef.current = next;
        pushConfigToStage(next);
        audioEngine.setBgmVolume(next.bgmVolume);
        audioEngine.setSfxVolume(next.sfxVolume);
        syncSoundSource();
        settingsPanel?.setConfig(next);
      }
      ctx.sendToBackend({ type: "vn_set_config", patch, chatId: chatId() });
      // Turning System One on: check Lumiverse's Decision connection again (it may have been set up since).
      if (patch.systemOneMode && patch.systemOneMode !== "off") ctx.sendToBackend({ type: "vn_get_decision_status" });
    },
    // Sprite mode: library actions and requests go to the backend; the cut-out
    // model lives in this browser, so its buttons call the cut-out module.
    onSpriteAction: (action) => {
      ctx.sendToBackend({ type: "vn_sprite_action", ...action, ...(action.action === "prepare_chat" && !action.chatId ? { chatId: chatId() } : {}) });
    },
    onRequestSpriteLibrary: () => ctx.sendToBackend({ type: "vn_get_sprite_library" }),
    onPrepareCutoutModel: () => {
      const modelUrl = configRef.current?.spriteModelUrl ?? DEFAULT_SPRITE_MODEL_URL;
      const prepareBest = (): Promise<void> => prepareCutoutModel(modelUrl, spriteModelF16Url(modelUrl)).catch((error: unknown) => {
        settingsPanel?.setCutoutModelState({ state: "error", error: error instanceof Error ? error.message : String(error) });
      });
      // Studio quality prepares the Studio model; where it cannot run (no download then), the Best one (the cuts use it).
      const studioUrl = configRef.current?.spriteCutout === "studio" ? configRef.current.spriteStudioModelUrl : "";
      if (studioUrl) {
        void getStudioCutoutSupport()
          .then((reason) => (reason ? prepareBest() : prepareStudioCutoutModel(studioUrl).catch(prepareBest)))
          .finally(refreshStudioCutoutFile);
      } else void prepareBest();
      // The face finder (emote placement) comes along; its state shows its own errors.
      prepareFaceModel(DEFAULT_SPRITE_FACE_MODEL_URL).catch(() => {});
    },
    onClearCutoutModel: () => {
      clearCutoutModel()
        .then(() => {
          settingsPanel?.setCutoutModelCachedBytes(null);
          settingsPanel?.setStudioCutoutModelCachedBytes(null);
          settingsPanel?.setCutoutModelState(getCutoutModelState());
          settingsPanel?.setFaceModelCachedBytes(null);
          settingsPanel?.setFaceModelState(getFaceModelState());
        })
        .catch((error: unknown) => settingsPanel?.setCutoutModelState({ state: "error", error: error instanceof Error ? error.message : String(error) }));
    },
  }) : null;
  settingsPanel?.setCutoutModelState(getCutoutModelState());
  // A Studio download that ends (stored, or not) changes what settings say about its file.
  let studioDownloading = false;
  const unsubCutoutModel = settingsPanel ? onCutoutModelState((state) => {
    settingsPanel.setCutoutModelState(state);
    const downloading = state.state === "downloading" && state.studio === true;
    if (studioDownloading && !downloading) refreshStudioCutoutFile();
    studioDownloading = downloading;
  }) : () => {};
  settingsPanel?.setFaceModelState(getFaceModelState());
  const unsubFaceModel = settingsPanel ? onFaceModelState((state) => settingsPanel.setFaceModelState(state)) : () => {};
  if (settingsPanel) {
    getCachedFaceModelBytes(DEFAULT_SPRITE_FACE_MODEL_URL).then((bytes) => settingsPanel.setFaceModelCachedBytes(bytes)).catch(() => {});
  }
  // A model cached by an earlier visit is not loaded in this page yet: show it as downloaded.
  // With Studio quality (and its URL set) the Studio model's file too, and whether this device can run it.
  let cachedModelKey = "";
  function refreshCachedCutoutModel(bestUrl: string): void {
    const config = configRef.current;
    // The Studio model (about 3 GB of graphics memory) leaves when the settings no longer want it.
    if (config) syncStudioCutout(config.spriteCutout, config.spriteStudioModelUrl);
    const studioUrl = config?.spriteCutout === "studio" ? config.spriteStudioModelUrl : "";
    const key = `${bestUrl}\n${studioUrl}`;
    if (!settingsPanel || key === cachedModelKey) return;
    cachedModelKey = key;
    getCachedCutoutModelBytes(bestUrl, spriteModelF16Url(bestUrl))
      .then((bytes) => { if (cachedModelKey === key) settingsPanel.setCutoutModelCachedBytes(bytes); })
      .catch(() => {});
    refreshStudioCutoutFile();
    if (!studioUrl) settingsPanel.setStudioCutoutSupport(null);
    else getStudioCutoutSupport().then((reason) => { if (cachedModelKey === key) settingsPanel.setStudioCutoutSupport(reason); }).catch(() => {});
  }
  /** The Studio model's file in this browser ("studio" quality with its URL set; else none). */
  function refreshStudioCutoutFile(): void {
    const config = configRef.current;
    const studioUrl = config?.spriteCutout === "studio" ? config.spriteStudioModelUrl : "";
    if (!settingsPanel) return;
    if (!studioUrl) {
      settingsPanel.setStudioCutoutModelCachedBytes(null);
      return;
    }
    getCachedCutoutModelBytes(studioUrl)
      .then((bytes) => { if (configRef.current?.spriteStudioModelUrl === studioUrl) settingsPanel.setStudioCutoutModelCachedBytes(bytes); })
      .catch(() => {});
  }
  refreshCachedCutoutModel(DEFAULT_SPRITE_MODEL_URL);
  // Read-aloud settings render inside the panel's Voice section (own shadow
  // root, own save path), shown only while Choir is present.
  const speechSettings = settingsHandle ? new SpeechSettingsSection({
    mount: settingsPanel?.voiceMount() ?? settingsHandle.root,
    onSave: (speechPatch) => {
      // Applied at once, like the panel's onSave, so turning read aloud on hands the sound to Choir without waiting for the echo.
      if (configRef.current) {
        configRef.current = { ...configRef.current, speech: speechPatch };
        syncSoundSource();
      }
      ctx.sendToBackend({ type: "vn_set_config", patch: { speech: speechPatch }, chatId: chatId() });
    },
    onOpenChoir: () => choirBridge.openDrawer(),
    isChoirAvailable: () => choirBridge.isAvailable(),
    onMuteNarratorChange: (muted) => choirBridge.setNarratorMuted(muted),
  }) : null;
  choirBridge.onAvailabilityChange((available) => {
    settingsPanel?.setVoiceAvailable(available);
    speechSettings?.refresh();
    syncSpeechDock();
    syncSoundSource();
  });
  /** The dock shows only while read aloud is on and Choir is there to voice it. */
  function syncSpeechDock(): void {
    speechDock.setEnabled(Boolean(configRef.current?.speech.enabled) && choirBridge.isAvailable());
  }

  function chatId(): string {
    return ctx.getActiveChat().chatId ?? "";
  }

  // Presentation mode last pushed to the stage; a switch re-syncs the background.
  let stagePresentationMode: VisualNovelPresentationMode | null = null;
  function pushConfigToStage(config: VisualNovelConfig): void {
    applyVisualConfigToStage(stage, config);
    const changed = stagePresentationMode !== null && stagePresentationMode !== config.presentationMode;
    stagePresentationMode = config.presentationMode;
    if (changed && turn) void syncImageForParagraph(stage.getState().currentParagraphIndex);
  }

  // Sprite cut-outs: the backend cannot read image bytes, so the logged-in
  // frontend fetches the generated sprite, cuts it and relays the PNG.
  const spriteCuts = createSpriteCutService({
    sendToBackend: (request) => ctx.sendToBackend(request),
    fetchImage: (imageId) => fetchLumiverseImage(imageId, (input, init) => fetch(input, init)),
    getConfig: () => configRef.current,
  });
  // NovelAI V5 reference inset: the backend has no canvas, so the browser draws the inset canvas and mask.
  const spriteInsets = createNovelAiInsetService({
    sendToBackend: (request) => ctx.sendToBackend(request),
    fetchImage: (imageId) => fetchLumiverseImage(imageId, (input, init) => fetch(input, init)),
  });
  // Face backfill for older sprites (emote placement); never delays showing them.
  const spriteFaces = createSpriteFaceService({
    sendToBackend: (request) => ctx.sendToBackend(request),
    fetchImage: async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Image fetch failed (${response.status}).`);
      return response.blob();
    },
    getConfig: () => configRef.current,
  });

  let lastAnnouncedChatId = "";
  // True until the first vn_state answers the boot request; that reply decides
  // whether the view opens (autoEnter) or is explicitly closed.
  let bootPending = true;
  function requestState(options: { boot?: boolean } = {}): void {
    const current = chatId();
    // Leaving a chat (home screen, or another chat) closes the previous view
    // explicitly; the backend must not keep paying for a chat nobody is watching.
    if (lastAnnouncedChatId && lastAnnouncedChatId !== current && active) {
      ctx.sendToBackend({ type: "vn_view", chatId: lastAnnouncedChatId, open: false });
    }
    lastAnnouncedChatId = current;
    for (const message of viewStateMessages(current, options.boot ? undefined : active)) ctx.sendToBackend(message);
    syncGameChoices();
    gameBridge?.request(current);
  }

  const connectionOptions: Record<"planner" | "image", readonly ConnectionCatalogOption[]> = { planner: [], image: [] };
  function requestConnectionCatalog(): void {
    // Listing is free (no model call). Keep the previous options visible while loading.
    settingsPanel?.setConnectionCatalog("planner", { status: "loading", options: connectionOptions.planner });
    settingsPanel?.setConnectionCatalog("image", { status: "loading", options: connectionOptions.image });
    ctx.sendToBackend({ type: "vn_get_connection_catalog" });
  }

  /**
   * Hand a host error to the stage as a structured `VnStageErrorInput`: the
   * stage renders the title, a collapsed technical detail, and a user-initiated
   * "Try again" only when `retryable` is true. Never retries by itself.
   */
  /** Key of the failed key-illustration card on screen (sprite mode), or null. */
  let illustrationNotice: string | null = null;
  function reportStageError(error: HostStageError | null): void {
    illustrationNotice = null;
    stage.setError(error);
  }

  /**
   * Sprite mode: while the reader is on a key paragraph whose picture
   * failed, show the non-blocking image card (with "Try again"). Only this
   * card is cleared when the reader moves on or the picture arrives.
   */
  function syncIllustrationNotice(paragraphIndex: number): void {
    const failed = turn && stageOwnsBackground(configRef.current, turn) ? failedIllustrationAt(turn, paragraphIndex) : null;
    if (failed && turn) {
      const key = `${turn.messageId}:${turn.sourceFingerprint}:${failed.jobId}`;
      if (illustrationNotice === key) return;
      reportStageError(describeIllustrationFailure(failed.error));
      illustrationNotice = key;
      return;
    }
    if (illustrationNotice !== null) reportStageError(null);
  }

  function registerOverrides(): void {
    if (!ctx.ui.registerComponentOverride || overrideHandles.length > 0) return;
    const hiddenComponent = () => null;
    overrideHandles = (["BubbleMessage", "MinimalMessage", "InputArea"] as const).map((host) => ctx.ui.registerComponentOverride!({
      host,
      mode: "replace",
      priority: 10,
      component: hiddenComponent
    }));
  }

  function toggleVisualNovel(): void {
    try {
      if (active) deactivate();
      else activate();
    } catch (error) {
      stage.setError(error instanceof Error ? error.message : String(error));
      app.setVisible(true);
    }
  }

  function destroyOverrides(): void {
    for (const handle of overrideHandles.splice(0)) handle.destroy();
  }

  function activate(): void {
    if (destroyed || active) return;
    if (!supportsVisualNovelOverlay(ctx)) {
      throw new Error("This Lumiverse build does not expose the staging component override contract.");
    }
    active = true;
    const captureMessageId = turn?.messageId ?? ctx.messages.getLatestMessageId();
    panelCapture = captureMessageId ? { chatId: chatId(), messageId: captureMessageId, fingerprint: turn?.sourceFingerprint ?? null, cards: captureSimTrackerCards(ctx.dom.findMessageElement(captureMessageId), document) } : null;
    registerOverrides();
    app.setVisible(true);
    action.setLabel("Exit Cue");
    headerLauncher.setActive(true);
    const activeChatId = chatId();
    if (!turn || turn.chatId !== activeChatId) {
      turn = null;
      stage.reset();
    }
    speech.setActive(true);
    speechDock.setOverlayActive(true);
    requestState();
    stage.focus();
  }

  function deactivate(): void {
    if (destroyed) return;
    const wasActive = active;
    active = false;
    // Tell the backend this chat's view closed so it stops paying for the
    // in-flight batch and skips upcoming replies. Only when actually open;
    // repeats would be harmless (the backend close is idempotent).
    const activeChatId = chatId();
    if (wasActive && activeChatId) ctx.sendToBackend({ type: "vn_view", chatId: activeChatId, open: false });
    // Closing the view stops speech, aborts any request, and clears the session cache.
    stage.toggleAutoPlay(false);
    speech.setActive(false);
    speechDock.setOverlayActive(false);
    audioEngine.stopAll();
    destroyOverrides();
    app.setVisible(false);
    action.setLabel("Open Cue");
    headerLauncher.setActive(false);
  }

  async function submit(content: string): Promise<void> {
    const activeChatId = chatId();
    if (!activeChatId) throw new Error("No chat is active.");
    const trimmed = content.trim();
    if (!trimmed) throw new Error("Enter a response first.");
    const requestId = globalThis.crypto?.randomUUID?.() ?? `vn-submit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    ctx.sendToBackend({ type: "vn_submit", chatId: activeChatId, content: trimmed, requestId });
  }

  async function handleUserSubmission(content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) throw new Error("Enter a response first.");
    const userSpeaker = turn?.userSpeaker || "You";
    speech.setCursor(null);
    stage.presentUserParagraph(trimmed, userSpeaker);
    await submit(trimmed);
  }

  async function syncImageForParagraph(paragraphIndex: number): Promise<void> {
    if (!turn) return;
    if (stageOwnsBackground(configRef.current, turn)) {
      syncIllustrationNotice(paragraphIndex);
      return;
    }
    const assetFailure = currentAssetFailure(turn, paragraphIndex);
    if (assetFailure) reportStageError(assetFailure);
    const asset = selectCurrentImage(turn, paragraphIndex);
    if (!asset?.imageUrl) {
      vnDebug("image sync", `p${paragraphIndex}`, "no decodable asset yet");
      return;
    }
    vnDebug("image sync", `p${paragraphIndex}`, `using cue p${asset.paragraphIndex}`, asset.status, asset.imageUrl);
    const loaded = await stage.setSceneImage({
      url: asset.imageUrl,
      alt: `Generated scene for paragraph ${asset.paragraphIndex + 1}`,
      requestId: `${turn.sourceFingerprint}:${asset.cueId}:${asset.imageId ?? asset.imageUrl}`
    });
    if (!loaded || asset.status === "browser_ready") return;
    const acknowledgementKey = `${turn.sourceFingerprint}:${asset.jobId}`;
    if (acknowledgedAssets.has(acknowledgementKey)) return;
    acknowledgedAssets.add(acknowledgementKey);
    ctx.sendToBackend({
      type: "vn_asset_ready",
      chatId: turn.chatId,
      messageId: turn.messageId,
      jobId: asset.jobId,
      sourceFingerprint: turn.sourceFingerprint
    });
  }

  /**
   * Apply an incoming turn delivery. Re-broadcasting the SAME logical turn must
   * not reset the cursor back to paragraph 0 (a GENERATION_ENDED followed by a
   * MESSAGE_EDITED/SWIPE_EDITED/MESSAGE_SWIPED reconcile, or a `vn_retry_turn`,
   * re-sends the identical turn). A genuinely different turn within the same
   * chat preserves the previous scene image until the new turn's scene image is
   * generated, preventing a blank screen between turns.
   */
  function applyTurn(next: TurnView, previous: TurnView | null): void {
    // The text before the plan, late or repeated, never replaces the planned turn.
    if (keepsPlannedTurn(previous, next)) return;
    if (panelCapture) {
      if (panelCapture.chatId !== next.chatId || panelCapture.messageId !== next.messageId || (panelCapture.fingerprint !== null && panelCapture.fingerprint !== next.sourceFingerprint)) panelCapture = null;
      else panelCapture.fingerprint = next.sourceFingerprint;
    }
    turn = next;
    spriteFaces.wantView(next.sprites);
    stage.setAssetProgress(computeAssetProgress(next));
    const staged = stage.getState();
    const decision = decideTurnApplication(previous, next, staged.currentParagraphIndex, active, staged.paragraphs.length > 0, staged.planHold !== null);
    vnDebug("turn decision", decision.kind, {
      message: next.messageId,
      paragraphs: next.paragraphs.length,
      choices: next.choices.length,
      status: next.status
    });
    if (decision.kind === "none") return;
    if (decision.kind === "planning") {
      speech.setCursor(null);
      stage.setPhase("planning");
      return;
    }
    if (decision.kind === "error") {
      speech.setCursor(null);
      reportStageError(describePlanningFailure(next));
      return;
    }
    if (decision.kind === "same-turn") {
      // A retry that kept this turn (images only, or a replan of the same
      // text) never reloads it: end its planning phase where the reader was.
      // A retry while the text waited for its plan shows that text again.
      if (stage.getState().phase === "planning" && (next.status === "ready" || next.provisional)) {
        stage.resumeAfterRetry(next.provisional ? "revealing" : retryResumePhase ?? "revealing");
      }
      retryResumePhase = null;
      // Identical cursor identity: SpeechController treats this as a no-op, so
      // a same-turn rebroadcast (e.g. an image/asset update) never replays speech.
      syncSpeechCursor(next, decision.paragraphIndex);
      panels.setTurn(next, decision.paragraphIndex);
      stage.setSpriteTurn(next.sprites ?? null);
      void syncImageForParagraph(decision.paragraphIndex);
      return;
    }
    retryResumePhase = null;
    const intensity = configRef.current?.effectIntensity ?? "full";
    if (decision.kind === "upgrade") {
      const input = stageTurnInput(next, true, intensity);
      if (canUpgradeTurn(stage.getState(), input) && stage.isOpeningCardOpen()) {
        // The plan landed under the opening card: reading has not started, so
        // the opening paragraph plays whole (effect, sound, voice) when it closes.
        const cursor = decision.paragraphIndex;
        provisionalCursorKey = null;
        provisionalSpokenKey = null;
        panels.setTurn(next, cursor);
        stage.upgradeTurn(input);
        whenReading(() => {
          syncSpeechCursor(next, cursor);
          syncAudioForParagraph(next, cursor);
        });
        void syncImageForParagraph(cursor);
        return;
      }
      if (canUpgradeTurn(stage.getState(), input)) {
        const cursor = decision.paragraphIndex;
        // Speech first, so auto play that resumes with the plan waits on it. A
        // paragraph already read aloud before the plan is not read again.
        if (provisionalSpokenKey !== `${next.sourceFingerprint}:${cursor}`) syncSpeechCursor(next, cursor);
        provisionalCursorKey = null;
        provisionalSpokenKey = null;
        panels.setTurn(next, cursor);
        // The opening paragraph the plan reached right away plays its moment,
        // sound effect included; otherwise only its music: the moment has passed.
        if (stage.upgradeTurn(input)) syncAudioForParagraph(next, cursor);
        else restoreMusicAt(next, cursor);
        void syncImageForParagraph(cursor);
        return;
      }
      // The text changed after all: load the planned turn from the start.
    }
    panels.setTurn(next, 0);
    const preserveImage = shouldPreserveImage(previous, next);
    turnOpeningBgm = preserveImage ? packSound.currentMusic : null;
    stage.loadTurn(stageTurnInput(next, preserveImage, intensity));
    void syncImageForParagraph(0);
    whenReading(() => {
      syncSpeechCursor(next, 0);
      syncAudioForParagraph(next, 0);
    });
  }

  function routeBackend(payload: unknown): void {
    const type = messageType(payload);
    const message = payload as BackendResponse;
    if (message.type === "vn_external_image") { imageBridge.result(message.result); return; }
    if (message.type === "vn_panel_template") {
      const pending = panelRequests.get(message.requestId);
      if (!pending) return;
      panelRequests.delete(message.requestId); clearTimeout(pending.timer);
      if (message.error || message.chatId !== chatId()) pending.reject(new Error(message.error ?? "The active chat changed."));
      else pending.resolve(message.template ?? "");
      return;
    }
    if (type && type !== "vn_asset") vnDebug("received", type, payload);
    if (type === "vn_connection_catalog" && message.type === "vn_connection_catalog") {
      const states = connectionCatalogStates(message);
      connectionOptions.planner = states.planner.options;
      connectionOptions.image = states.image.options;
      settingsPanel?.setConnectionCatalog("planner", states.planner);
      settingsPanel?.setConnectionCatalog("image", states.image);
      return;
    }
    if (type === "vn_decision_status" && message.type === "vn_decision_status") {
      settingsPanel?.setDecisionStatus(decisionStatusMessage(message.status));
      return;
    }
    if (type === "vn_sprite_library" && message.type === "vn_sprite_library") {
      settingsPanel?.setSpriteLibrary(message.sets, message.plates);
      return;
    }
    if (type === "vn_audio_scanned" && message.type === "vn_audio_scanned") {
      settingsPanel?.setAudioStatus(`Scanned ${message.bgmCount} BGM, ${message.sfxCount} SFX.`);
      settingsPanel?.setAudioLibrary?.({ bgmCount: message.bgmCount, sfxCount: message.sfxCount });
      return;
    }
    if (type === "vn_state" && message.type === "vn_state") {
      configRef.current = message.config;
      imageBridge.fit(message.config.sceneImageFit);
      pushConfigToStage(configRef.current);
      audioEngine.setBgmVolume(configRef.current.bgmVolume);
      audioEngine.setSfxVolume(configRef.current.sfxVolume);
      syncSoundSource();
      speech.setSettings(configRef.current.speech);
      syncSpeechDock();
      speechSettings?.setConfig(configRef.current.speech);
      settingsPanel?.setConfig(configRef.current);
      refreshCachedCutoutModel(configRef.current.spriteModelUrl);
      // The home screen has no chat to show.
      if (configRef.current?.autoEnter && !active && chatId()) activate();
      if (bootPending) {
        // The boot request said nothing about the view. Now that the config is
        // known: autoEnter has just reopened it; otherwise the view the backend
        // may still hold open from before the reload is closed for real.
        bootPending = false;
        const bootChatId = chatId();
        if (!active && bootChatId) ctx.sendToBackend({ type: "vn_view", chatId: bootChatId, open: false });
      }
      if (message.turn && message.turn.chatId === chatId()) {
        applyTurn(message.turn, turn);
      } else {
        turn = null;
        speech.setCursor(null);
        panels.setTurn(null);
        stage.reset();
        // An open chat with no reply yet: the reply box is there, so the story can start here.
        if (active) stage.setPhase(chatId() ? "awaiting-input" : "idle");
      }
      return;
    }
    if (type === "vn_config" && message.type === "vn_config") {
      imageBridge.fit(message.config.sceneImageFit);
      // The echo of a persisted config is the only save acknowledgment the
      // transport offers; "saved" is claimed here and nowhere earlier.
      configRef.current = message.config;
      pushConfigToStage(configRef.current);
      audioEngine.setBgmVolume(configRef.current.bgmVolume);
      audioEngine.setSfxVolume(configRef.current.sfxVolume);
      syncSoundSource();
      speech.setSettings(configRef.current.speech);
      syncSpeechDock();
      speechSettings?.setConfig(configRef.current.speech);
      settingsPanel?.setConfig(configRef.current);
      refreshCachedCutoutModel(configRef.current.spriteModelUrl);
      settingsPanel?.setSaveStatus?.({ kind: "saved" });
      return;
    }
    if ((type === "vn_turn" && message.type === "vn_turn") || (type === "vn_turn_text" && message.type === "vn_turn_text")) {
      if (message.turn.chatId !== chatId()) return;
      // The text before the plan comes only as vn_turn_text, and only that carries it.
      if ((message.type === "vn_turn_text") !== Boolean(message.turn.provisional)) return;
      if (stage.isReadingUserParagraph()) {
        if (!keepsPlannedTurn(pendingNextTurn, message.turn)) pendingNextTurn = message.turn;
      } else {
        applyTurn(message.turn, turn);
      }
      return;
    }
    if (type === "vn_asset" && message.type === "vn_asset") {
      vnDebug("received vn_asset", `p${message.asset.paragraphIndex}`, message.asset.status, message.asset.imageUrl ?? "(no url)", (!turn || turn.chatId !== message.chatId || turn.messageId !== message.messageId) ? "(ignored: not the active turn)" : "");
      // A turn held back while the reader's own line shows gets the update too.
      if (pendingNextTurn && pendingNextTurn.chatId === message.chatId && pendingNextTurn.messageId === message.messageId) {
        pendingNextTurn = turnWithIllustrationAsset(replaceAsset(pendingNextTurn, message.asset), message.asset).turn;
      }
      if (!turn || turn.chatId !== message.chatId || turn.messageId !== message.messageId) return;
      turn = replaceAsset(turn, message.asset);
      stage.setAssetProgress(computeAssetProgress(turn));
      const cursor = stage.getState().currentParagraphIndex;
      if (stageOwnsBackground(configRef.current, turn)) {
        // Sprite mode: key-moment jobs update `sprites.illustrations` in place.
        const applied = turnWithIllustrationAsset(turn, message.asset);
        turn = applied.turn;
        if (applied.view) stage.updateIllustration(message.asset.paragraphIndex, applied.view);
        if (message.asset.paragraphIndex === cursor) syncIllustrationNotice(cursor);
        return;
      }
      if (message.asset.paragraphIndex <= cursor) void syncImageForParagraph(cursor);
      return;
    }
    if (type === "vn_waiting" && message.type === "vn_waiting") {
      if (message.chatId !== chatId()) return;
      turn = null;
      pendingNextTurn = null;
      panels.setTurn(null);
      stage.reset();
      reportStageError({
        message: "This opening message holds several scenes, and none is selected yet. Pick a starting scene in the chat view, then use Try again or reopen Cue.",
        source: "waiting",
        retryable: true,
        retryScope: "Checks the latest message again.",
      });
      return;
    }
    if (type === "vn_reference_fetch" && message.type === "vn_reference_fetch") {
      // Data relay for card-sourced reference anchoring. Served regardless of
      // the active chat: the backend keeps generating for its own chat and the
      // image id came from the backend, not from user input.
      void relayReferenceFetch(message, (input, init) => fetch(input, init), (reply) => ctx.sendToBackend(reply));
      return;
    }
    if (type === "vn_sprite_cut" && message.type === "vn_sprite_cut") {
      // Like vn_reference_fetch: served for any chat; the ids come from the backend.
      void spriteCuts.handle(message);
      return;
    }
    if (type === "vn_novelai_inset" && message.type === "vn_novelai_inset") {
      // Like vn_sprite_cut: served for any chat; the image id comes from the backend.
      void spriteInsets.handle(message);
      return;
    }
    if (type === "vn_sprite_update" && message.type === "vn_sprite_update") {
      if (turn) turn = turnWithSpriteImage(turn, message.setKey, message.image);
      if (pendingNextTurn) pendingNextTurn = turnWithSpriteImage(pendingNextTurn, message.setKey, message.image);
      stage.updateSpriteImage(message.setKey, message.image);
      settingsPanel?.applySpriteUpdate?.(message.setKey, message.image);
      if (turn?.sprites && Object.values(turn.sprites.sets).some((set) => set.setKey === message.setKey)) spriteFaces.want(message.setKey, message.image);
      return;
    }
    if (type === "vn_plate_update" && message.type === "vn_plate_update") {
      if (turn) turn = turnWithPlate(turn, message.plate);
      if (pendingNextTurn) pendingNextTurn = turnWithPlate(pendingNextTurn, message.plate);
      stage.updatePlate(message.plate);
      settingsPanel?.applyPlateUpdate?.(message.plate);
      return;
    }
    if (type === "vn_planning" && message.type === "vn_planning") {
      if (message.chatId === chatId() && active) stage.setPhase("planning");
      return;
    }
    if (type === "vn_generation" && message.type === "vn_generation") {
      if (message.chatId !== chatId()) return;
      if (message.active) {
        stage.setError(null);
        stage.setAssetProgress(null);
        if (!stage.isReadingUserParagraph()) {
          stage.setPhase("waiting-for-response");
        }
      } else if (message.error) {
        reportStageError({
          message: "The reply finished, but the scene could not be updated.",
          detail: message.error,
          source: "generation",
          retryable: false,
        });
      }
      return;
    }
    if (type === "vn_permission" && message.type === "vn_permission") {
      if (!message.granted) {
        deactivate();
        reportStageError({
          message: "Cue needs a permission that was turned off.",
          detail: `Permission revoked: ${message.permission}. Re-enable it before reopening Cue.`,
          source: "permission",
          retryable: false,
        });
      }
      return;
    }
    if (type === "vn_error" && message.type === "vn_error") {
      if (message.operation === "vn_set_config") {
        settingsPanel?.setSaveStatus?.({ kind: "error", error: message.error });
        return;
      }
      if (message.operation === "vn_get_decision_status" || message.operation === "vn_open_decision_connections") {
        settingsPanel?.setDecisionStatus(message.operation === "vn_open_decision_connections"
          ? `Could not open Lumiverse's Connections: ${message.error}. Open Connections → Decision models yourself.`
          : decisionStatusMessage({ state: "unavailable", error: message.error }));
        return;
      }
      if (message.operation === "vn_get_connection_catalog") {
        settingsPanel?.setConnectionCatalog("planner", { status: "error", options: [], error: message.error });
        settingsPanel?.setConnectionCatalog("image", { status: "error", options: [], error: message.error });
        return;
      }
      if (!message.chatId || message.chatId === chatId()) {
        reportStageError(describeOperationError(message.operation, message.error, turn));
      }
    }
  }

  const unsubBackend = ctx.onBackendMessage(routeBackend);
  const unsubAction = action.onClick(toggleVisualNovel);
  const unsubChat = ctx.events.on("CHAT_SWITCHED", () => {
    panelCapture = null;
    panels.setTurn(null);
    turn = null;
    pendingNextTurn = null;
    packSound.reset();
    turnOpeningBgm = null;
    speech.onChatChanged();
    stage.reset();
    // Leaving for the home screen closes the stage instead of covering it.
    if (active && !chatId()) deactivate();
    requestState();
  });
  const unsubFork = ctx.events.on("CHAT_FORKED", () => {
    panelCapture = null;
    panels.setTurn(null);
    turn = null;
    pendingNextTurn = null;
    packSound.reset();
    turnOpeningBgm = null;
    speech.onChatChanged();
    stage.reset();
    requestState();
  });
  const unsubPermission = ctx.events.on("PERMISSION_CHANGED", (payload) => {
    if (!payload || typeof payload !== "object") return;
    const detail = payload as { permission?: unknown; granted?: unknown };
    if (detail.granted === false) deactivate();
  });

  requestConnectionCatalog();
  ctx.sendToBackend({ type: "vn_get_decision_status" });
  requestState({ boot: true });
  ctx.ready();

  const cleanup = (): void => {
    if (destroyed) return;
    deactivate();
    destroyed = true;
    unsubBackend();
    unsubAction();
    unsubChat();
    unsubFork();
    unsubPermission();
    headerLauncher.destroy();
    action.destroy();
    document.removeEventListener("visibilitychange", onVisibilityChanged);
    choirBridge.destroy();
    speech.dispose();
    speechDock.destroy();
    speechSettings?.destroy();
    unsubCutoutModel();
    unsubStageCutout();
    unsubCutoutArrival();
    unsubFaceModel();
    settingsPanel?.destroy();
    settingsHandle?.destroy();
    audioEngine.destroy();
    panels.destroy();
    gameBridge?.destroy();
    imageBridge.destroy();
    spriteCuts.dispose();
    spriteInsets.dispose();
    spriteFaces.dispose();
    for (const pending of panelRequests.values()) { clearTimeout(pending.timer); pending.reject(new Error("Panel layer closed.")); }
    panelRequests.clear();
    stage.destroy();
    app.destroy();
    if ((globalThis as Record<PropertyKey, unknown>)[CLEANUP_KEY] === cleanup) {
      delete (globalThis as Record<PropertyKey, unknown>)[CLEANUP_KEY];
    }
  };
  (globalThis as Record<PropertyKey, unknown>)[CLEANUP_KEY] = cleanup;
  return cleanup;
}
