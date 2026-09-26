import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { VisualNovelConfig, VisualNovelEffectIntensity } from "../../config.js";
import { REFERENCE_IMAGE_MAX_BYTES, REFERENCE_IMAGE_MIMES } from "../../protocol.js";
import type { AssetView, BackendResponse, ConnectionCatalogOption, FrontendRequest, TurnView } from "../../protocol.js";
import { AudioEngine, VnStage, isAmbientEffect, isStageEffect } from "../stage/index.js";
import type { AmbientEffect, StageEffect } from "../store/index.js";
import { VisualNovelSettingsPanel } from "../settings/panel.js";
import type { VnChoice, VnTurnInput } from "../store/index.js";
import { createVnHeaderLauncher } from "./manual-launcher.js";
import { captureSimTrackerCards } from "./panel-capture.js";
import { PanelDock } from "../stage/panel-dock.js";
import { stagingContext, supportsVisualNovelOverlay, type ComponentOverrideHandle } from "./staging-context.js";
import { presentAmbient, presentEffect } from "./effect-presentation.js";
import {
  describeImageFailure,
  describeOperationError,
  describePlanningFailure,
  type HostStageError,
} from "./turn-status.js";
import { SpeechController, type SpeechCursor } from "../speech/controller.js";
import { createSpeechTransport } from "../speech/transport.js";
import { SpeechDock } from "../speech/ui.js";
import { SpeechSettingsSection } from "../speech/settings-ui.js";

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
    const response = await fetchImpl(`/api/v1/images/${encodeURIComponent(message.imageId)}`, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Image fetch failed (${response.status}).`);
    const blob = await response.blob();
    if (blob.size > REFERENCE_IMAGE_MAX_BYTES) throw new Error("Reference image exceeds the 8 MiB relay limit.");
    const mimeType = blob.type.toLowerCase();
    if (!REFERENCE_IMAGE_MIMES.has(mimeType)) throw new Error("Reference asset is not a supported image.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    send({ type: "vn_reference_image", requestId: message.requestId, dataUrl: `data:${mimeType};base64,${base64FromBytes(bytes)}` });
  } catch (error) {
    send({ type: "vn_reference_image", requestId: message.requestId, error: error instanceof Error ? error.message : String(error) });
  }
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
  | { kind: "load-turn" };

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
  return {
    chatId: view.chatId,
    messageId: view.messageId,
    sourceFingerprint: view.sourceFingerprint,
    paragraphIndex: index,
    text,
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
  mode: VnTurnInput["mode"],
  preserveImage: boolean,
  intensity: VisualNovelEffectIntensity = "full",
): VnTurnInput {
  return {
    mode,
    paragraphs: next.paragraphs.map((text, index) => ({
      id: `${next.sourceFingerprint}:${index}`,
      text,
      speaker: nameplateForParagraph(next, index),
      ...effectForParagraph(next, index, intensity),
      ...ambientForParagraph(next, index, intensity)
    })),
    choices: next.choices.map((choice) => ({ id: choice.id, label: choice.label, value: choice.value })),
    preserveImage,
    ...(next.ambients !== undefined ? { ambient: firstAmbient(next, intensity) } : {})
  };
}

export function decideTurnApplication(
  previous: TurnView | null,
  next: TurnView,
  cursor: number,
  active: boolean,
  hasLoadedTurn: boolean,
): TurnApplicationDecision {
  if (!active) return { kind: "none" };
  if (next.status === "planning") return { kind: "planning" };
  if (next.status === "failed") return { kind: "error", error: next.error ?? "Visual planning failed." };
  // Only treat a re-broadcast as the same turn when the stage is actually showing
  // it. A vn_state that arrives while inactive records the turn but never loads
  // the paragraphs, so the first active delivery still needs a real load-turn.
  if (previous && hasLoadedTurn && sameTurnIdentity(previous, next)) {
    return { kind: "same-turn", paragraphIndex: cursor };
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
  const done = budgeted.filter(
    (a) =>
      a.status === "generated" ||
      a.status === "browser_ready" ||
      a.status === "failed" ||
      a.status === "cancelled",
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
  setSkipMode?: (mode: "read" | "all") => void;
  /** Dialogue text size multiplier (stage sets `--vn-text-scale`). */
  setTextScale?: (scale: number) => void;
  /** Lets the stage also gate its own heuristic effects (text-triggered shake). */
  setEffectIntensity?: (level: VisualNovelEffectIntensity) => void;
};

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
  stage.setSkipMode?.(config.skipMode);
  stage.setTextScale?.(config.textScale);
  stage.setEffectIntensity?.(config.effectIntensity);
}

/**
 * The subset of the settings panel the host reports back into. Every member
 * beyond the original three is optional so the host works with a panel that
 * has not adopted the redesign feedback yet.
 */
export type SettingsFeedbackTarget = {
  setConfig(config: VisualNovelConfig): void;
  setConnectionCatalog(kind: "planner" | "image", state: ConnectionCatalogFeedback): void;
  setSystemOneKeyStatus(saved: boolean, message?: string): void;
  setAudioStatus(message: string): void;
  /** Acknowledged save result: "saved" only after the backend echoes `vn_config`. */
  setSaveStatus?(status: { kind: "saved" } | { kind: "error"; error: string }): void;
  /** Exact library counts from the last scan/import. */
  setAudioLibrary?(library: { bgmCount: number; sfxCount: number }): void;
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
  let overrideHandles: ComponentOverrideHandle[] = [];
  const acknowledgedAssets = new Set<string>();
  let destroyed = false;
  const audioEngine = new AudioEngine({
    bgmVolume: configRef.current?.bgmVolume ?? 0.7,
    sfxVolume: configRef.current?.sfxVolume ?? 0.8,
  });

  let speech: SpeechController;
  let speechDock: SpeechDock;

  const isSpeechHoldingAuto = (): boolean => {
    if (!speech) return false;
    const s = speech.getStatus();
    return s.kind === "loading" || s.kind === "playing" || s.kind === "paused";
  };

  const syncSpeechCursor = (view: TurnView | null, paragraphIndex: number): void => {
    speech?.setCursor(view && view.status === "ready" ? speechCursorFor(view, paragraphIndex) : null);
  };
  const onVisibilityChanged = (): void => {
    if (speech) speech.setVisible(!document.hidden);
  };
  document.addEventListener("visibilitychange", onVisibilityChanged);

  let currentBgm: string | null = null;
  let turnOpeningBgm: string | null = null;
  function syncAudioForParagraph(activeTurn: TurnView, paragraphIndex: number): void {
    if (!activeTurn.audioCues || activeTurn.audioCues.length === 0) return;
    const cue = activeTurn.audioCues.find((c) => c.paragraphIndex === paragraphIndex);
    if (!cue) return;
    const bgmSrc = cue.bgmUrl || cue.bgm;
    if (bgmSrc) {
      currentBgm = bgmSrc;
      vnDebug("audio", `p${paragraphIndex}`, "bgm ->", bgmSrc);
      audioEngine.playBgm(bgmSrc);
    }
    const sfxSrc = cue.sfxUrl || cue.sfx;
    if (sfxSrc) {
      vnDebug("audio", `p${paragraphIndex}`, "sfx ->", sfxSrc);
      audioEngine.playSfx(sfxSrc);
    }
  }

  const stage = new VnStage({
    mount: app.root,
    themePreset: configRef.current?.themePreset ?? "lumiverse",
    isAutoAdvanceHeld: () => isSpeechHoldingAuto(),
    onExit: () => deactivate(),
    onPrevious: (paragraphIndex) => {
      panels.setCursor(paragraphIndex);
      syncSpeechCursor(turn, paragraphIndex);
      audioEngine.stopAll();
      const earlierMusic = turn?.audioCues?.filter((cue) => cue.paragraphIndex <= paragraphIndex && (cue.bgmUrl || cue.bgm))
        .sort((a, b) => b.paragraphIndex - a.paragraphIndex)[0];
      currentBgm = earlierMusic?.bgmUrl || earlierMusic?.bgm || turnOpeningBgm;
      if (currentBgm) audioEngine.playBgm(currentBgm);
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
    onReroll: () => {
      const activeChatId = chatId();
      if (!activeChatId) return;
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
      stage.setPhase("planning");
      ctx.sendToBackend({
        type: "vn_retry_turn",
        chatId: activeChatId,
        messageId: turn.messageId,
      });
    },
  });

  let panelCapture: { chatId: string; messageId: string; fingerprint: string | null; cards: Array<{ title: string; html: string }> } | null = null;
  // Speech (default-off TTS). Own player and lifecycle; never the SFX channel.
  // Mounted into stage.panelMount so it renders in front of the stage scene and background.
  speechDock = new SpeechDock({
    mount: stage.panelMount,
    onPlay: () => { void speech.playCurrent(); },
    onPause: () => speech.pause(),
    onStop: () => speech.stop("user-stop"),
  });
  speech = new SpeechController({
    transport: createSpeechTransport(),
    onStatus: (status) => {
      speechDock.setStatus(status);
      if (status.kind === "loading" || status.kind === "playing" || status.kind === "paused") {
        stage.holdAutoPlay();
      } else if (active) {
        stage.checkAutoPlay();
      }
    },
  });

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
    label: "Open visual novel",
    subtitle: "Open this chat in the full-screen visual novel view",
    enabled: true
  });
  const headerLauncher = createVnHeaderLauncher(
    ctx.ui.mount("chat_header_right"),
    () => toggleVisualNovel(),
  );
  const settingsHandle = ctx.ui.registerSettingsTab?.({
    id: "visual-novel-preview",
    title: "Visual novel",
    shortName: "VN",
    description: "Visual-novel presentation, generation, and custom CSS settings",
    keywords: ["visual novel", "cyoa", "images", "custom css"],
    position: "after-display"
  });
  const settingsPanel: (VisualNovelSettingsPanel & SettingsFeedbackTarget) | null = settingsHandle ? new VisualNovelSettingsPanel({
    mount: settingsHandle.root,
    onOpenPreview: () => activate(),
    onRefreshConnections: () => requestConnectionCatalog(),
    onSaveSystemOneKey: (key) => ctx.sendToBackend({ type: "vn_set_system_one_key", key }),
    onClearSystemOneKey: () => ctx.sendToBackend({ type: "vn_clear_system_one_key" }),
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
        applyVisualConfigToStage(stage, next);
        audioEngine.setBgmVolume(next.bgmVolume);
        audioEngine.setSfxVolume(next.sfxVolume);
        settingsPanel?.setConfig(next);
      }
      ctx.sendToBackend({ type: "vn_set_config", patch, chatId: chatId() });
    }
  }) : null;
  // Speech settings live in their own card appended after the main panel, so
  // the panel file itself stays untouched. Profile/voice listing happens only
  // on explicit button presses inside the card (metadata calls, no synthesis).
  const speechTransport = createSpeechTransport();
  const speechSettings = settingsHandle ? new SpeechSettingsSection({
    mount: settingsHandle.root,
    onSave: (speechPatch) => {
      ctx.sendToBackend({ type: "vn_set_config", patch: { speech: speechPatch }, chatId: chatId() });
    },
    listProfiles: () => speechTransport.listProfiles(new AbortController().signal),
    listVoices: (connectionId) => speechTransport.listVoices(connectionId, new AbortController().signal),
    getChatId: () => chatId(),
  }) : null;

  function chatId(): string {
    return ctx.getActiveChat().chatId ?? "";
  }

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
  function reportStageError(error: HostStageError | null): void {
    stage.setError(error);
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
    action.setLabel("Exit visual novel");
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
    action.setLabel("Open visual novel");
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
    if (panelCapture) {
      if (panelCapture.chatId !== next.chatId || panelCapture.messageId !== next.messageId || (panelCapture.fingerprint !== null && panelCapture.fingerprint !== next.sourceFingerprint)) panelCapture = null;
      else panelCapture.fingerprint = next.sourceFingerprint;
    }
    turn = next;
    stage.setAssetProgress(computeAssetProgress(next));
    const decision = decideTurnApplication(previous, next, stage.getState().currentParagraphIndex, active, stage.getState().paragraphs.length > 0);
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
      // Identical cursor identity: SpeechController treats this as a no-op, so
      // a same-turn rebroadcast (e.g. an image/asset update) never replays speech.
      syncSpeechCursor(next, decision.paragraphIndex);
      panels.setTurn(next, decision.paragraphIndex);
      void syncImageForParagraph(decision.paragraphIndex);
      return;
    }
    const requestedMode = configRef.current?.mode ?? "standard";
    panels.setTurn(next, 0);
    const mode = requestedMode === "cyoa" && next.choices.length > 0 ? "cyoa" : "standard";
    const preserveImage = shouldPreserveImage(previous, next);
    turnOpeningBgm = preserveImage ? currentBgm : null;
    stage.loadTurn(stageTurnInput(next, mode, preserveImage, configRef.current?.effectIntensity ?? "full"));
    syncSpeechCursor(next, 0);
    void syncImageForParagraph(0);
    syncAudioForParagraph(next, 0);
  }

  function routeBackend(payload: unknown): void {
    const type = messageType(payload);
    const message = payload as BackendResponse;
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
    if (type === "vn_system_one_key_status" && message.type === "vn_system_one_key_status") {
      settingsPanel?.setSystemOneKeyStatus(message.saved);
      return;
    }
    if (type === "vn_audio_scanned" && message.type === "vn_audio_scanned") {
      settingsPanel?.setAudioStatus(`Scanned ${message.bgmCount} BGM, ${message.sfxCount} SFX.`);
      settingsPanel?.setAudioLibrary?.({ bgmCount: message.bgmCount, sfxCount: message.sfxCount });
      return;
    }
    if (type === "vn_state" && message.type === "vn_state") {
      configRef.current = message.config;
      applyVisualConfigToStage(stage, configRef.current);
      audioEngine.setBgmVolume(configRef.current.bgmVolume);
      audioEngine.setSfxVolume(configRef.current.sfxVolume);
      speech.setSettings(configRef.current.speech);
      speechDock.setEnabled(configRef.current.speech.enabled);
      speechSettings?.setConfig(configRef.current.speech);
      settingsPanel?.setConfig(configRef.current);
      if (configRef.current?.autoEnter && !active) activate();
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
        if (active) stage.setPhase("idle");
      }
      return;
    }
    if (type === "vn_config" && message.type === "vn_config") {
      // The echo of a persisted config is the only save acknowledgment the
      // transport offers; "saved" is claimed here and nowhere earlier.
      configRef.current = message.config;
      applyVisualConfigToStage(stage, configRef.current);
      audioEngine.setBgmVolume(configRef.current.bgmVolume);
      audioEngine.setSfxVolume(configRef.current.sfxVolume);
      speech.setSettings(configRef.current.speech);
      speechDock.setEnabled(configRef.current.speech.enabled);
      speechSettings?.setConfig(configRef.current.speech);
      settingsPanel?.setConfig(configRef.current);
      settingsPanel?.setSaveStatus?.({ kind: "saved" });
      return;
    }
    if (type === "vn_turn" && message.type === "vn_turn") {
      if (message.turn.chatId !== chatId()) return;
      if (stage.isReadingUserParagraph()) {
        pendingNextTurn = message.turn;
      } else {
        applyTurn(message.turn, turn);
      }
      return;
    }
    if (type === "vn_asset" && message.type === "vn_asset") {
      vnDebug("received vn_asset", `p${message.asset.paragraphIndex}`, message.asset.status, message.asset.imageUrl ?? "(no url)", (!turn || turn.chatId !== message.chatId || turn.messageId !== message.messageId) ? "(ignored: not the active turn)" : "");
      if (!turn || turn.chatId !== message.chatId || turn.messageId !== message.messageId) return;
      turn = replaceAsset(turn, message.asset);
      stage.setAssetProgress(computeAssetProgress(turn));
      const cursor = stage.getState().currentParagraphIndex;
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
          message: "Visual novel mode needs a permission that was turned off.",
          detail: `Permission revoked: ${message.permission}. Re-enable it before reopening visual novel mode.`,
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
      if (message.operation === "vn_set_system_one_key" || message.operation === "vn_clear_system_one_key" || message.operation === "vn_get_system_one_key_status") {
        settingsPanel?.setSystemOneKeyStatus(false, message.error);
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
    speech.onChatChanged();
    stage.reset();
    requestState();
  });
  const unsubFork = ctx.events.on("CHAT_FORKED", () => {
    panelCapture = null;
    panels.setTurn(null);
    turn = null;
    pendingNextTurn = null;
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
  ctx.sendToBackend({ type: "vn_get_system_one_key_status" });
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
    speech.dispose();
    speechDock.destroy();
    speechSettings?.destroy();
    settingsPanel?.destroy();
    settingsHandle?.destroy();
    audioEngine.destroy();
    panels.destroy();
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
