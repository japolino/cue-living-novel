import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG as CUE_DEFAULT_CONFIG } from "../config.js";
import { buildInlayConfig, mapInlaySlotsToCue } from "./inlay-adapter.js";

describe("inlay adapter", () => {
  test("buildInlayConfig maps Cue config into a valid Inlay Config with defaults", () => {
    const inlay = buildInlayConfig({
      ...CUE_DEFAULT_CONFIG,
      parserConnectionId: "parser-1",
      imageConnectionId: "image-1",
      imageModel: "sdxl",
      maxImagesPerTurn: 1,
      includeCharacterContext: true,
      includePersonaContext: false,
      includeLorebookContext: false,
      promptPrefix: "masterpiece",
      promptSuffix: "wide composition",
      negativePrompt: "low quality"
    });
    expect(inlay.parserConnectionId).toBe("parser-1");
    expect(inlay.imageConnectionId).toBe("image-1");
    expect(inlay.imageModel).toBe("sdxl");
    expect(inlay.minImages).toBe(1);
    expect(inlay.maxImages).toBe(1);
    expect(inlay.perspectiveMode).toBe("dynamic");
    expect(inlay.promptStyle).toBe("default");
    expect(inlay.previousVisualStateEnabled).toBe(true);
    expect(inlay.autoGenerate).toBe(true);
    expect(inlay.enabled).toBe(CUE_DEFAULT_CONFIG.enabled);
  });

  test("mapInlaySlotsToCue projects an Inlay GeneratedRecord into Cue backgrounds", () => {
    const mapped = mapInlaySlotsToCue({
      schemaVersion: 3,
      chatId: "c",
      messageId: "m",
      swipeId: 0,
      createdAt: "2024-01-01T00:00:00.000Z",
      rawJson: {},
      slots: [
        { paragraph: 0, imageId: "img-0", imageUrl: "/img-0.png", prompt: "p0", negativePrompt: "n0", status: "completed", placement: "paragraph", perspectiveMode: "dynamic", perspectiveSource: "manual" },
        { paragraph: 2, imageId: "img-1", imageUrl: "/img-1.png", prompt: "p1", negativePrompt: "n1", status: "generating", placement: "paragraph", perspectiveMode: "dynamic", perspectiveSource: "adaptive" },
        { paragraph: 0, imageId: "cov", imageUrl: "/cov.png", prompt: "pc", negativePrompt: "nc", status: "completed", placement: "cover", perspectiveMode: "dynamic", perspectiveSource: "manual" }
      ]
    });
    expect(mapped).toHaveLength(3);
    expect(mapped[0]).toMatchObject({ paragraph: 0, imageId: "img-0", placement: "paragraph" });
    expect(mapped[1]?.status).toBe("generating");
    expect(mapped[2]?.placement).toBe("cover");
  });
});
