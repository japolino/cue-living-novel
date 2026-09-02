import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../config.js";
import type { AssetView, BackendResponse, TurnView } from "../../protocol.js";
import { VnStage } from "../stage/index.js";
import { VisualNovelSettingsPanel } from "../settings/panel.js";
import type { VnChoice } from "../store/index.js";
import { createVnHeaderLauncher } from "./manual-launcher.js";
import { stagingContext, supportsVisualNovelOverlay, type ComponentOverrideHandle } from "./staging-context.js";

const CLEANUP_KEY = Symbol.for("visual-novel-preview.frontend-cleanup");

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
  const total = turn.assets.length;
  const done = turn.assets.filter(
    (a) =>
      a.status === "generated" ||
      a.status === "browser_ready" ||
      a.status === "failed" ||
      a.status === "cancelled",
  ).length;
  const inFlight = turn.assets.filter((a) => a.status === "generating" || a.status === "queued").length;
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
    height: "100dvh",
    zIndex: "9990"
  });
  app.setVisible(false);

  let active = false;
  const configRef: { current: VisualNovelConfig | null } = { current: null };
  let turn: TurnView | null = null;
  let pendingNextTurn: TurnView | null = null;
  let overrideHandles: ComponentOverrideHandle[] = [];
  const acknowledgedAssets = new Set<string>();
  let destroyed = false;

  const stage = new VnStage({
    mount: app.root,
    themePreset: configRef.current?.themePreset ?? "lumiverse",
    onExit: () => deactivate(),
    onAdvance: (paragraphIndex) => {
      if (pendingNextTurn) {
        const next = pendingNextTurn;
        pendingNextTurn = null;
        applyTurn(next, turn);
        return;
      }
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
      if (!activeChatId || !turn) return;
      stage.setPhase("planning");
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
  const settingsPanel = settingsHandle ? new VisualNovelSettingsPanel({
    mount: settingsHandle.root,
    onOpenPreview: () => activate(),
    onRefreshConnections: () => requestConnectionCatalog(),
    onSave: (patch) => {
      const current = configRef.current;
      if (current) {
        const next = { ...current, ...patch };
        configRef.current = next;
        applyVisualConfigToStage(stage, next);
        settingsPanel?.setConfig(next);
      }
      ctx.sendToBackend({ type: "vn_set_config", patch, chatId: chatId() });
    }
  }) : null;

  function chatId(): string {
    return ctx.getActiveChat().chatId ?? "";
  }

  function requestState(): void {
    ctx.sendToBackend({ type: "vn_get_state", chatId: chatId() });
  }

  function requestConnectionCatalog(): void {
    ctx.sendToBackend({ type: "vn_get_connection_catalog" });
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
    registerOverrides();
    app.setVisible(true);
    action.setLabel("Exit visual novel");
    headerLauncher.setActive(true);
    const activeChatId = chatId();
    if (!turn || turn.chatId !== activeChatId) {
      turn = null;
      stage.reset();
    }
    requestState();
    stage.focus();
  }

  function deactivate(): void {
    if (destroyed) return;
    active = false;
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
    stage.presentUserParagraph(trimmed, userSpeaker);
    await submit(trimmed);
  }

  async function syncImageForParagraph(paragraphIndex: number): Promise<void> {
    if (!turn) return;
    const asset = selectCurrentImage(turn, paragraphIndex);
    if (!asset?.imageUrl) return;
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
    turn = next;
    stage.setAssetProgress(computeAssetProgress(next));
    const decision = decideTurnApplication(previous, next, stage.getState().currentParagraphIndex, active, stage.getState().paragraphs.length > 0);
    if (decision.kind === "none") return;
    if (decision.kind === "planning") {
      stage.setPhase("planning");
      return;
    }
    if (decision.kind === "error") {
      stage.setError(decision.error);
      return;
    }
    if (decision.kind === "same-turn") {
      void syncImageForParagraph(decision.paragraphIndex);
      return;
    }
    const requestedMode = configRef.current?.mode ?? "standard";
    const mode = requestedMode === "cyoa" && next.choices.length > 0 ? "cyoa" : "standard";
    const preserveImage = shouldPreserveImage(previous, next);
    stage.loadTurn({
      mode,
      paragraphs: next.paragraphs.map((text, index) => ({
        id: `${next.sourceFingerprint}:${index}`,
        text,
        speaker: next.speaker
      })),
      choices: next.choices.map((choice) => ({ id: choice.id, label: choice.label, value: choice.value })),
      preserveImage
    });
    void syncImageForParagraph(0);
  }

  function routeBackend(payload: unknown): void {
    const type = messageType(payload);
    const message = payload as BackendResponse;
    if (type === "vn_connection_catalog" && message.type === "vn_connection_catalog") {
      settingsPanel?.setConnectionCatalog("planner", { status: "ready", options: message.planner ?? [] });
      settingsPanel?.setConnectionCatalog("image", { status: "ready", options: message.image ?? [] });
      return;
    }
    if (type === "vn_state" && message.type === "vn_state") {
      configRef.current = message.config;
      applyVisualConfigToStage(stage, configRef.current);
      settingsPanel?.setConfig(configRef.current);
      if (configRef.current?.autoEnter && !active) activate();
      if (message.turn && message.turn.chatId === chatId()) {
        applyTurn(message.turn, turn);
      } else {
        turn = null;
        stage.reset();
        if (active) stage.setPhase("idle");
      }
      return;
    }
    if (type === "vn_config" && message.type === "vn_config") {
      configRef.current = message.config;
      applyVisualConfigToStage(stage, configRef.current);
      settingsPanel?.setConfig(configRef.current);
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
      if (!turn || turn.chatId !== message.chatId || turn.messageId !== message.messageId) return;
      turn = replaceAsset(turn, message.asset);
      stage.setAssetProgress(computeAssetProgress(turn));
      const cursor = stage.getState().currentParagraphIndex;
      if (message.asset.paragraphIndex <= cursor) void syncImageForParagraph(cursor);
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
        stage.setError(message.error);
      }
      return;
    }
    if (type === "vn_permission" && message.type === "vn_permission") {
      if (!message.granted) {
        deactivate();
        stage.setError(`Permission revoked: ${message.permission}. Re-enable it before reopening visual novel mode.`);
      }
      return;
    }
    if (type === "vn_error" && message.type === "vn_error") {
      if (!message.chatId || message.chatId === chatId()) stage.setError(message.error);
    }
  }

  const unsubBackend = ctx.onBackendMessage(routeBackend);
  const unsubAction = action.onClick(toggleVisualNovel);
  const unsubChat = ctx.events.on("CHAT_SWITCHED", () => {
    turn = null;
    pendingNextTurn = null;
    stage.reset();
    requestState();
  });
  const unsubFork = ctx.events.on("CHAT_FORKED", () => {
    turn = null;
    pendingNextTurn = null;
    stage.reset();
    requestState();
  });
  const unsubPermission = ctx.events.on("PERMISSION_CHANGED", (payload) => {
    if (!payload || typeof payload !== "object") return;
    const detail = payload as { permission?: unknown; granted?: unknown };
    if (detail.granted === false) deactivate();
  });

  requestConnectionCatalog();
  requestState();
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
    settingsPanel?.destroy();
    settingsHandle?.destroy();
    stage.destroy();
    app.destroy();
    if ((globalThis as Record<PropertyKey, unknown>)[CLEANUP_KEY] === cleanup) {
      delete (globalThis as Record<PropertyKey, unknown>)[CLEANUP_KEY];
    }
  };
  (globalThis as Record<PropertyKey, unknown>)[CLEANUP_KEY] = cleanup;
  return cleanup;
}
