import { describe, expect, test } from "bun:test";

import type { VisualNovelConfig } from "../../config.js";
import {
  applyVisualConfigToStage,
  decideTurnApplication,
  sameTurnIdentity,
  selectCurrentImage,
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
  promptPrefix: "",
  promptSuffix: "",
  negativePrompt: "",
  customPlannerInstructions: "",
  customCss: "",
};

describe("applyVisualConfigToStage (live controller config application)", () => {
  test("applies the theme preset, scene-image fit, and custom CSS from the config", () => {
    const stage = spyStage();
    const config: VisualNovelConfig = {
      ...baseConfig,
      themePreset: "golden-hour",
      sceneImageFit: "contain",
      customCss: "[data-vn-dialogue] { border-color: red; }",
    };

    applyVisualConfigToStage(stage, config);

    expect(stage.calls).toEqual([
      "theme:golden-hour",
      "fit:contain",
      "css:[data-vn-dialogue] { border-color: red; }",
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
    };
    const merged: VisualNovelConfig = { ...previous, ...patch };

    applyVisualConfigToStage(stage, merged);

    expect(stage.calls[0]).toBe("theme:midnight-noir");
    expect(stage.calls[1]).toBe("fit:none");
    expect(stage.calls[2]).toBe("css:body {}");
  });

  test("always re-applies all three controls even when only one value changed", () => {
    const stage = spyStage();
    const config: VisualNovelConfig = { ...baseConfig, customCss: "p { margin: 0; }" };
    applyVisualConfigToStage(stage, config);
    expect(stage.calls).toEqual([
      "theme:lumiverse",
      "fit:cover",
      "css:p { margin: 0; }",
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

describe("decideTurnApplication (same-turn guard + preserveImage path)", () => {
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

  test("a genuinely different turn becomes a load-turn (clears the prior image)", () => {
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
