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

function currentImage(turn: TurnView, paragraphIndex: number): AssetView | null {
  let match: AssetView | null = null;
  for (const asset of turn.assets) {
    if (asset.status !== "generated" && asset.status !== "browser_ready") continue;
    if (!asset.imageUrl || asset.paragraphIndex > paragraphIndex) continue;
    if (!match || asset.paragraphIndex >= match.paragraphIndex) match = asset;
  }
  return match;
}

function replaceAsset(turn: TurnView, asset: AssetView): TurnView {
  const assets = turn.assets.some((entry) => entry.cueId === asset.cueId)
    ? turn.assets.map((entry) => entry.cueId === asset.cueId ? asset : entry)
    : [...turn.assets, asset];
  return { ...turn, assets };
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
  let config: VisualNovelConfig | null = null;
  let turn: TurnView | null = null;
  let overrideHandles: ComponentOverrideHandle[] = [];
  const acknowledgedAssets = new Set<string>();
  let destroyed = false;

  const stage = new VnStage({
    mount: app.root,
    onExit: () => deactivate(),
    onAdvance: (paragraphIndex) => { void syncImageForParagraph(paragraphIndex); },
    onChoice: async (choice: VnChoice) => submit(choice.value),
    onSubmit: async (content: string) => submit(content)
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
      if (config) {
        config = { ...config, ...patch };
        stage.setUserCss(config.customCss);
        settingsPanel?.setConfig(config);
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

  async function syncImageForParagraph(paragraphIndex: number): Promise<void> {
    if (!turn) return;
    const asset = currentImage(turn, paragraphIndex);
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

  function loadTurn(next: TurnView): void {
    turn = next;
    if (!active) return;
    if (next.status === "planning") {
      stage.setPhase("planning");
      return;
    }
    if (next.status === "failed") {
      stage.setError(next.error ?? "Visual planning failed.");
      return;
    }
    const requestedMode = config?.mode ?? "standard";
    const mode = requestedMode === "cyoa" && next.choices.length > 0 ? "cyoa" : "standard";
    stage.loadTurn({
      mode,
      paragraphs: next.paragraphs.map((text, index) => ({
        id: `${next.sourceFingerprint}:${index}`,
        text,
        speaker: next.speaker
      })),
      choices: next.choices.map((choice) => ({ id: choice.id, label: choice.label, value: choice.value })),
      preserveImage: true
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
      config = message.config;
      stage.setUserCss(config.customCss);
      settingsPanel?.setConfig(config);
      if (config.autoEnter && !active) activate();
      if (message.turn) loadTurn(message.turn);
      else if (active) stage.setPhase("idle");
      return;
    }
    if (type === "vn_config" && message.type === "vn_config") {
      config = message.config;
      stage.setUserCss(config.customCss);
      settingsPanel?.setConfig(config);
      return;
    }
    if (type === "vn_turn" && message.type === "vn_turn") {
      if (message.turn.chatId === chatId()) loadTurn(message.turn);
      return;
    }
    if (type === "vn_asset" && message.type === "vn_asset") {
      if (!turn || turn.chatId !== message.chatId || turn.messageId !== message.messageId) return;
      turn = replaceAsset(turn, message.asset);
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
        stage.setPhase("waiting-for-response");
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
