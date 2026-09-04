import { describe, expect, test } from "bun:test";

import type { VisualNovelConfig } from "../../config.js";
import {
  applyVisualConfigToStage,
  computeAssetProgress,
  decideTurnApplication,
  sameTurnIdentity,
  selectCurrentImage,
  shouldPreserveImage,
  type VisualStageThemeTarget,
} from "./controller";
import type { AssetView, TurnView } from "../../protocol.js";

function spyStage(): VisualStageThemeTarget & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    setThemePreset(preset) { calls.push(`theme:${preset}`); },
    setSceneImageFit(fit) { calls.push(`fit:${fit}`); },
    setUserCss(css) { calls.push(`css:${css}`); },
    setDisplayRegexRules(rules) { calls.push(`regex:${rules}`); },
  };
}

const baseConfig: VisualNovelConfig = {
  themePreset: "lumiverse",
  enabled: true,
  autoEnter: false,
  mode: "standard",
  sceneImageFit: "cover",
  debugLogging: false,
  generateImages: true,
  referenceAnchoring: true,
  generateChoices: true,
  promptPresets: [],
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
  promptPrefix: "",
  promptSuffix: "",
  negativePrompt: "",
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

describe("applyVisualConfigToStage (live controller config application)", () => {
  test("applies the theme preset, scene-image fit, custom CSS, and display regex from the config", () => {
    const stage = spyStage();
    const config: VisualNovelConfig = {
      ...baseConfig,
      themePreset: "golden-hour",
      sceneImageFit: "contain",
      customCss: "[data-vn-dialogue] { border-color: red; }",
      displayRegexRules: "/§([^§]+)§/g => $1",
    };

    applyVisualConfigToStage(stage, config);

    expect(stage.calls).toEqual([
      "theme:golden-hour",
      "fit:contain",
      "css:[data-vn-dialogue] { border-color: red; }",
      "regex:/§([^§]+)§/g => $1",
    ]);
  });

  test("uses the merged config values rather than a stale prior value", () => {
    const stage = spyStage();
    const previous: VisualNovelConfig = { ...baseConfig, themePreset: "paper-novel" };
    // The controller merges a patch into the previous config before applying.
    const patch: Partial<VisualNovelConfig> = {
      themePreset: "midnight-noir",
      customCss: "body {}",
      sceneImageFit: "none",
      displayRegexRules: "foo => bar",
    };
    const merged: VisualNovelConfig = { ...previous, ...patch };

    applyVisualConfigToStage(stage, merged);

    expect(stage.calls[0]).toBe("theme:midnight-noir");
    expect(stage.calls[1]).toBe("fit:none");
    expect(stage.calls[2]).toBe("css:body {}");
    expect(stage.calls[3]).toBe("regex:foo => bar");
  });

  test("always re-applies all four controls even when only one value changed", () => {
    const stage = spyStage();
    const config: VisualNovelConfig = { ...baseConfig, customCss: "p { margin: 0; }" };
    applyVisualConfigToStage(stage, config);
    expect(stage.calls).toEqual([
      "theme:lumiverse",
      "fit:cover",
      "css:p { margin: 0; }",
      "regex:",
    ]);
  });
});


function turn(overrides: Partial<TurnView> = {}): TurnView {
  return {
    chatId: "chat",
    messageId: "message",
    swipeId: 0,
    sourceFingerprint: "feedface12345678",
    revision: 1,
    speaker: "Mira",
    paragraphs: ["The door opens."],
    choices: [],
    assets: [],
    status: "ready",
    ...overrides
  };
}

function asset(overrides: Partial<AssetView> = {}): AssetView {
  return {
    jobId: "job",
    cueId: "cue",
    paragraphIndex: 0,
    status: "generated",
    imageUrl: "/img/one.png",
    ...overrides
  };
}

describe("selectCurrentImage (pure frontend image selection)", () => {
  test("picks the highest ready paragraph at or before the cursor", () => {
    const source = turn({
      assets: [
        asset({ jobId: "j0", cueId: "c0", paragraphIndex: 0, imageUrl: "/img/0.png" }),
        asset({ jobId: "j1", cueId: "c1", paragraphIndex: 1, imageUrl: "/img/1.png" }),
        asset({ jobId: "j2", cueId: "c2", paragraphIndex: 2, imageUrl: "/img/2.png" })
      ]
    });
    expect(selectCurrentImage(source, 1)?.paragraphIndex).toBe(1);
    expect(selectCurrentImage(source, 1)?.imageUrl).toBe("/img/1.png");
  });

  test("uses the FIRST ready asset (stable tie) when several share the current paragraph", () => {
    const source = turn({
      assets: [
        asset({ jobId: "c0a", cueId: "c0a", paragraphIndex: 0, imageUrl: "/img/c0a.png" }),
        asset({ jobId: "c0b", cueId: "c0b", paragraphIndex: 0, imageUrl: "/img/c0b.png" })
      ]
    });
    // The first asset in the array wins, never the last (which used to flip).
    expect(selectCurrentImage(source, 0)?.imageUrl).toBe("/img/c0a.png");
  });

  test("ignores non-ready assets and assets above the cursor", () => {
    const source = turn({
      assets: [
        asset({ jobId: "queued", cueId: "cq", status: "queued", imageUrl: "/img/q.png" }),
        asset({ jobId: "future", cueId: "cf", paragraphIndex: 3, imageUrl: "/img/f.png" }),
        asset({ jobId: "ready", cueId: "cr", paragraphIndex: 1, imageUrl: "/img/r.png", status: "browser_ready" })
      ]
    });
    expect(selectCurrentImage(source, 0)).toBeNull();
    expect(selectCurrentImage(source, 1)?.imageUrl).toBe("/img/r.png");
  });
});

describe("sameTurnIdentity (re-broadcast guard)", () => {
  test("is true when chatId, messageId, and sourceFingerprint all match", () => {
    const source = turn({ chatId: "chat", messageId: "m1", sourceFingerprint: "abc" });
    expect(sameTurnIdentity(source, turn({ chatId: "chat", messageId: "m1", sourceFingerprint: "abc" }))).toBe(true);
  });

  test("is false when any identity field differs", () => {
    const source = turn({ chatId: "chat", messageId: "m1", sourceFingerprint: "abc" });
    expect(sameTurnIdentity(source, turn({ chatId: "chat", messageId: "m2", sourceFingerprint: "abc" }))).toBe(false);
    expect(sameTurnIdentity(source, turn({ chatId: "chat", messageId: "m1", sourceFingerprint: "def" }))).toBe(false);
    expect(sameTurnIdentity(source, turn({ chatId: "other", messageId: "m1", sourceFingerprint: "abc" }))).toBe(false);
  });
});

describe("decideTurnApplication (same-turn guard + load-turn path)", () => {
  test("re-broadcasting the SAME already-loaded turn becomes a cursor sync, not a load/reset", () => {
    const previous = turn({ status: "ready" });
    const next = turn({ status: "ready", assets: [asset({ imageUrl: "/img/new.png" })] });
    expect(decideTurnApplication(previous, next, 3, true, true)).toEqual({ kind: "same-turn", paragraphIndex: 3 });
  });

  test("a recorded-but-not-yet-loaded same turn still needs a real load-turn (activation)", () => {
    const previous = turn({ status: "ready" });
    const next = turn({ status: "ready" });
    expect(decideTurnApplication(previous, next, 0, true, false)).toEqual({ kind: "load-turn" });
  });

  test("a genuinely different turn becomes a load-turn", () => {
    const previous = turn({ messageId: "m1" });
    const next = turn({ messageId: "m2" });
    expect(decideTurnApplication(previous, next, 3, true, true)).toEqual({ kind: "load-turn" });
  });

  test("is inert when the stage is not active", () => {
    expect(decideTurnApplication(null, turn(), 0, false, false)).toEqual({ kind: "none" });
  });

  test("maps planning and failed statuses without touching the cursor", () => {
    expect(decideTurnApplication(null, turn({ status: "planning" }), 2, true, false)).toEqual({ kind: "planning" });
    expect(decideTurnApplication(null, turn({ status: "failed", error: "boom" }), 2, true, false)).toEqual({ kind: "error", error: "boom" });
  });
});
describe("computeAssetProgress (granular image generation progress)", () => {
  test("returns null when there are no assets in the turn", () => {
    expect(computeAssetProgress(null)).toBeNull();
    expect(computeAssetProgress(turn({ assets: [] }))).toBeNull();
  });

  test("calculates 1/3 when the first of three assets is queued or generating", () => {
    const source = turn({
      assets: [
        asset({ jobId: "j1", status: "generating" }),
        asset({ jobId: "j2", status: "queued" }),
        asset({ jobId: "j3", status: "queued" }),
      ],
    });
    expect(computeAssetProgress(source)).toEqual({ current: 1, total: 3 });
  });

  test("calculates 2/3 when the first asset completed and the second is generating", () => {
    const source = turn({
      assets: [
        asset({ jobId: "j1", status: "generated" }),
        asset({ jobId: "j2", status: "generating" }),
        asset({ jobId: "j3", status: "queued" }),
      ],
    });
    expect(computeAssetProgress(source)).toEqual({ current: 2, total: 3 });
  });

  test("calculates 3/3 when the first two assets completed and the third is generating", () => {
    const source = turn({
      assets: [
        asset({ jobId: "j1", status: "generated" }),
        asset({ jobId: "j2", status: "browser_ready" }),
        asset({ jobId: "j3", status: "generating" }),
      ],
    });
    expect(computeAssetProgress(source)).toEqual({ current: 3, total: 3 });
  });

  test("returns null once all three assets have finished", () => {
    const source = turn({
      assets: [
        asset({ jobId: "j1", status: "generated" }),
        asset({ jobId: "j2", status: "browser_ready" }),
        asset({ jobId: "j3", status: "generated" }),
      ],
    });
    expect(computeAssetProgress(source)).toBeNull();
  });
});

describe("shouldPreserveImage", () => {
  test("returns false when previous turn is null (initial load or fresh chat)", () => {
    expect(shouldPreserveImage(null, turn({ chatId: "chat-1" }))).toBe(false);
  });

  test("returns false when chat ids differ (swapped chat or card)", () => {
    const prev = turn({ chatId: "chat-1", speaker: "Alice" });
    const next = turn({ chatId: "chat-2", speaker: "Alice" });
    expect(shouldPreserveImage(prev, next)).toBe(false);
  });

  test("returns false when speakers differ (swapped character card)", () => {
    const prev = turn({ chatId: "chat-1", speaker: "Alice" });
    const next = turn({ chatId: "chat-1", speaker: "Bob" });
    expect(shouldPreserveImage(prev, next)).toBe(false);
  });

  test("returns true when advancing turns within the same chat and same speaker", () => {
    const prev = turn({ chatId: "chat-1", speaker: "Alice", messageId: "msg-1" });
    const next = turn({ chatId: "chat-1", speaker: "Alice", messageId: "msg-2" });
    expect(shouldPreserveImage(prev, next)).toBe(true);
  });

  test("returns true when advancing turns within the same chat with empty speaker", () => {
    const prev = turn({ chatId: "chat-1", speaker: "", messageId: "msg-1" });
    const next = turn({ chatId: "chat-1", speaker: "", messageId: "msg-2" });
    expect(shouldPreserveImage(prev, next)).toBe(true);
  });
});
