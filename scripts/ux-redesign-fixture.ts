import { VisualNovelSettingsPanel } from "../src/frontend/settings/panel.js";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../src/config.js";
import { VnStage } from "../src/frontend/stage/vn-stage.js";
import type { ConnectionCatalogOption, TurnView } from "../src/protocol.js";

const mount = document.createElement("div");
Object.assign(mount.style, { position: "fixed", inset: "0", background: "#08090d", overflow: "auto" });
document.body.append(mount);

const searchParams = new URL(location.href).searchParams;

if (searchParams.has("setup")) {
  // First setup / empty connections scenario
  Object.assign(mount.style, { position: "relative", minHeight: "100vh" });
  const fixture = {
    saved: [] as Array<Partial<VisualNovelConfig>>,
    refreshCalls: 0,
    previewOpened: false,
    audioScanned: 0,
    audioImported: 0,
  };
  const settings = new VisualNovelSettingsPanel({
    mount,
    onSave: (patch) => { fixture.saved.push(patch); },
    onOpenPreview: () => { fixture.previewOpened = true; },
    onRefreshConnections: () => { fixture.refreshCalls++; },
    onScanAudio: async () => {
      fixture.audioScanned++;
      return { bgmCount: 4, sfxCount: 8 };
    },
    onImportAudio: async (files) => {
      fixture.audioImported += files.length;
    },
    setupStorage: {
      get: () => null, // Never completed setup
      set: () => {},
    },
  });
  // Empty connection catalogs
  settings.setConnectionCatalog("planner", { status: "ready", options: [] });
  settings.setConnectionCatalog("image", { status: "ready", options: [] });
  settings.setConfig({ ...DEFAULT_CONFIG });

  Object.assign(window, { setupFixture: { settings, fixture } });

} else if (searchParams.has("missing-connection")) {
  // Missing selected connection scenario
  Object.assign(mount.style, { position: "relative", minHeight: "100vh" });
  const fixture = { saved: [] as Array<Partial<VisualNovelConfig>> };
  const settings = new VisualNovelSettingsPanel({
    mount,
    onSave: (patch) => { fixture.saved.push(patch); },
    onOpenPreview: () => {},
    onRefreshConnections: () => {},
  });
  const validOption: ConnectionOption = {
    id: "existing-conn-1",
    name: "Valid Profile",
    provider: "openai",
    model: "gpt-4o",
    isDefault: true,
  };
  settings.setConnectionCatalog("planner", { status: "ready", options: [validOption] });
  settings.setConnectionCatalog("image", { status: "ready", options: [validOption] });
  settings.setConfig({
    ...DEFAULT_CONFIG,
    imageConnectionId: "missing-deleted-conn-999",
  });

  Object.assign(window, { missingFixture: { settings, fixture } });

} else if (searchParams.has("settings")) {
  // Full settings panel scenario with mock connections and save simulation
  Object.assign(mount.style, { position: "relative", minHeight: "100vh" });
  const fixture = {
    saved: [] as Array<Partial<VisualNovelConfig>>,
    currentConfig: { ...DEFAULT_CONFIG, maxImagesPerTurn: 4, imageParameters: { steps: 28 }, customCss: "[data-vn-dialogue] { opacity: .9; }" },
    simulateError: false,
    refreshCalls: 0,
  };
  const settings = new VisualNovelSettingsPanel({
    mount,
    onSave: (patch) => {
      fixture.saved.push(patch);
      queueMicrotask(() => {
        if (fixture.simulateError) {
          settings.setSaveStatus({ kind: "error", error: "Simulated transport rejection" });
        } else {
          fixture.currentConfig = { ...fixture.currentConfig, ...patch };
          settings.setSaveStatus({ kind: "saved" });
        }
      });
    },
    onOpenPreview: () => {},
    onRefreshConnections: () => { fixture.refreshCalls++; },
    onScanAudio: async () => ({ bgmCount: 6, sfxCount: 11 }),
  });
  const mockPlannerOptions: ConnectionOption[] = [
    { id: "planner-default", name: "Default Planner", provider: "openai", model: "gpt-4o", isDefault: true },
    { id: "planner-claude", name: "Claude Sonnet", provider: "anthropic", model: "claude-3-7-sonnet", isDefault: false },
  ];
  const mockImageOptions: ConnectionOption[] = [
    { id: "image-flux", name: "Flux Local", provider: "comfyui", model: "flux-schnell", isDefault: true },
  ];
  settings.setConnectionCatalog("planner", { status: "ready", options: mockPlannerOptions });
  settings.setConnectionCatalog("image", { status: "ready", options: mockImageOptions });
  settings.setConfig(fixture.currentConfig);

  Object.assign(window, { settingsFixture: { settings, fixture } });

} else if (searchParams.has("reading")) {
  // Reading navigation, auto play pause, draft preservation, caret movement
  const previousIndices: number[] = [];
  let retryCalls = 0;
  let submittedText = "";

  const stage = new VnStage({
    mount,
    textSpeed: 0,
    autoPlayDelay: 1000,
    onPrevious: (index) => previousIndices.push(index),
    onRetry: () => { retryCalls++; },
    onSubmit: (text) => { submittedText = text; },
  });

  const turn = {
    mode: "standard" as const,
    chatId: "test-chat-nav",
    messageId: "msg-nav-1",
    swipeId: 0,
    sourceFingerprint: "fp-1",
    revision: 1,
    status: "ready",
    speaker: "Mira",
    paragraphs: [
      { id: "p0", speaker: "Mira", text: "The night was unusually quiet as they approached the gate." },
      { id: "p1", speaker: "Mira", text: "A sudden rustle broke the stillness of the courtyard." },
      { id: "p2", speaker: "Mira", text: "What do you want to do next?" },
    ],
    assets: [],
    choices: [
      { id: "c1", label: "Investigate the courtyard" },
      { id: "c2", label: "Retreat to the safety of the hall" },
    ],
  };

  stage.loadTurn(turn);
  Object.assign(window, {
    readingFixture: {
      stage,
      turn,
      previousIndices,
      getRetryCalls: () => retryCalls,
      getSubmittedText: () => submittedText,
    }
  });

} else if (searchParams.has("error")) {
  // Truthful error and explicit retry scenario
  let retryTriggered = false;
  const stage = new VnStage({
    mount,
    textSpeed: 0,
    onReroll: () => { retryTriggered = true; },
  });

  const turn: TurnView = {
    chatId: "test-chat-err",
    messageId: "msg-err-1",
    swipeId: 0,
    sourceFingerprint: "fp-err",
    revision: 1,
    status: "ready",
    speaker: "Mira",
    paragraphs: [
      "An eerie silence fills the chamber.",
      "The connection to the image generator was interrupted.",
    ],
    assets: [
      {
        id: "asset-1",
        paragraphIndex: 1,
        status: "failed",
        error: "Rate limit exceeded on GPU worker (429)",
        imageUrl: null,
      },
    ],
    choices: [],
  };

  stage.loadTurn(turn);
  stage.setError({
    message: "Image generation failed for this scene.",
    detail: "HTTP 429: Worker node GPU capacity exceeded",
    retryScope: "Try again keeps 1 finished image and remakes 1 unfinished image.",
    retryable: true,
  });

  Object.assign(window, {
    errorFixture: {
      stage,
      isRetryTriggered: () => retryTriggered,
    }
  });
}
