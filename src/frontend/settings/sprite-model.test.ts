import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { DEFAULT_CONFIG, KEY_ILLUSTRATION_MODES, PRESENTATION_MODES, SPRITE_CUTOUT_QUALITIES, SPRITE_IMAGE_SIZES } from "../../config.js";
import { DEFAULT_SPRITE_MODEL_URL, SPRITE_HOT_SET, SPRITE_SET_8, type PlateView, type SpriteSetView } from "../../shared/sprites.js";
import {
  KEY_ILLUSTRATION_OPTIONS,
  normalizeKeyIllustrations,
  PRESENTATION_MODE_OPTIONS,
  SPRITE_CUTOUT_OPTIONS,
  SPRITE_EXPRESSION_COUNT_HELP,
  SPRITE_EXPRESSION_COUNT_OPTIONS,
  SPRITE_IMAGE_SIZE_HELP,
  SPRITE_IMAGE_SIZE_OPTIONS,
  SPRITE_STATUS_LABELS,
  normalizeSpriteExpressionCount,
  countReady,
  describeCutoutModel,
  describeSpriteLibrary,
  expressionLabel,
  formatBytes,
  mergePlate,
  mergeSpriteImage,
  normalizePresentationMode,
  normalizeSpriteCutout,
  normalizeSpriteImageSize,
  orderedExpressions,
  parseSpriteModelUrl,
  plateDetails,
  setCoverImage,
  sortSpriteSets,
  spriteStatusBusy,
  summarizeSpriteLibrary,
} from "./model";
import { SPRITE_LIBRARY_CSS, faceCrop, missingHint } from "./sprite-library";

const MB = 1024 * 1024;

function set(key: string, updatedAt: string, statuses: Record<string, "ready" | "failed" | "generating" | "missing"> = {}): SpriteSetView {
  const expressions = Object.fromEntries(Object.entries(statuses).map(([expression, status]) => [expression, status === "ready"
    ? { expression, status, url: `/x/${expression}.png` }
    : { expression, status }]));
  return { setKey: key, name: key, attire: null, expressions, readyCount: 0, updatedAt };
}

describe("sprite mode options", () => {
  test("presentation mode: scene first (the default), then sprites, one short sentence each", () => {
    expect(PRESENTATION_MODE_OPTIONS.map((option) => option.value)).toEqual([...PRESENTATION_MODES]);
    expect(PRESENTATION_MODE_OPTIONS.map((option) => option.label)).toEqual(["Scene pictures", "Character sprites"]);
    for (const option of PRESENTATION_MODE_OPTIONS) expect(option.help.split(". ").length).toBeLessThanOrEqual(2);
    expect(normalizePresentationMode("sprites")).toBe("sprites");
    expect(normalizePresentationMode("nonsense")).toBe(DEFAULT_CONFIG.presentationMode);
  });

  test("cut-out quality names the download cost", () => {
    expect(SPRITE_CUTOUT_OPTIONS.map((option) => option.value)).toEqual([...SPRITE_CUTOUT_QUALITIES]);
    expect(SPRITE_CUTOUT_OPTIONS[0]!.label).toBe("Best (downloads a 176 MB model once)");
    expect(SPRITE_CUTOUT_OPTIONS[1]!.label).toBe("Basic (no download)");
    expect(normalizeSpriteCutout("basic")).toBe("basic");
    expect(normalizeSpriteCutout("")).toBe("best");
  });
});

describe("image size option", () => {
  test("Standard first (the default), then Upscaled; short help; NovelAI named in the hint", () => {
    expect(SPRITE_IMAGE_SIZE_OPTIONS.map((option) => option.value)).toEqual([...SPRITE_IMAGE_SIZES]);
    expect(SPRITE_IMAGE_SIZE_OPTIONS.map((option) => option.label)).toEqual(["Standard", "Upscaled"]);
    expect(SPRITE_IMAGE_SIZE_OPTIONS[0]!.value).toBe(DEFAULT_CONFIG.spriteImageSize);
    for (const option of SPRITE_IMAGE_SIZE_OPTIONS) expect(option.help.split(". ").length).toBeLessThanOrEqual(2);
    expect(SPRITE_IMAGE_SIZE_OPTIONS[0]!.help).toContain("624×912");
    expect(SPRITE_IMAGE_SIZE_OPTIONS[1]!.help).toContain("832×1216");
    expect(SPRITE_IMAGE_SIZE_OPTIONS[1]!.help).toContain("VRAM");
    expect(SPRITE_IMAGE_SIZE_HELP).toContain("NovelAI always uses its largest free size");
    expect(normalizeSpriteImageSize("upscaled")).toBe("upscaled");
    expect(normalizeSpriteImageSize("huge")).toBe("standard");
    expect(normalizeSpriteImageSize("")).toBe("standard");
  });

  test("expressions per character: 4 (fastest, the default), 8, 12 (all), plain labels", () => {
    expect(SPRITE_EXPRESSION_COUNT_OPTIONS.map((option) => option.value)).toEqual(["4", "8", "12"]);
    expect(SPRITE_EXPRESSION_COUNT_OPTIONS.map((option) => option.label)).toEqual(["4 (fastest)", "8", "12 (all)"]);
    expect(SPRITE_EXPRESSION_COUNT_OPTIONS[0]!.value).toBe(`${DEFAULT_CONFIG.spriteExpressionCount}`);
    for (const option of SPRITE_EXPRESSION_COUNT_OPTIONS) expect(option.help.split(". ").length).toBeLessThanOrEqual(2);
    expect(SPRITE_EXPRESSION_COUNT_HELP).toContain("kept");
    expect(normalizeSpriteExpressionCount("8")).toBe(8);
    expect(normalizeSpriteExpressionCount("12")).toBe(12);
    expect(normalizeSpriteExpressionCount("nonsense")).toBe(DEFAULT_CONFIG.spriteExpressionCount);
  });
});

describe("key moments option", () => {
  test("sprites only first (the default), then one picture per reply; short help", () => {
    expect(KEY_ILLUSTRATION_OPTIONS.map((option) => option.value)).toEqual([...KEY_ILLUSTRATION_MODES]);
    expect(KEY_ILLUSTRATION_OPTIONS[0]!.value).toBe(DEFAULT_CONFIG.keyIllustrations);
    for (const option of KEY_ILLUSTRATION_OPTIONS) expect(option.help.split(". ").length).toBeLessThanOrEqual(2);
    expect(normalizeKeyIllustrations("few")).toBe("few");
    expect(normalizeKeyIllustrations("many")).toBe("off");
  });
});

describe("cut-out model status", () => {
  test("absent offers a download for Best, nothing for Basic", () => {
    const best = describeCutoutModel({ state: "absent" }, "best", DEFAULT_SPRITE_MODEL_URL);
    expect(best.action).toBe("download");
    expect(best.detail).toContain("huggingface.co");
    expect(best.level).toBe("attention");
    const basic = describeCutoutModel({ state: "absent" }, "basic");
    expect(basic.action).toBeNull();
    expect(basic.level).toBe("ready");
  });

  test("a model cached by an earlier visit reads as downloaded, not absent", () => {
    const cached = describeCutoutModel({ state: "absent" }, "best", DEFAULT_SPRITE_MODEL_URL, 176_069_933);
    expect(cached.title).toBe("Model downloaded");
    expect(cached.action).toBe("remove");
    expect(cached.level).toBe("ready");
    expect(cached.detail).toContain("MB");
    // Other states ignore the cached size.
    expect(describeCutoutModel({ state: "loading" }, "best", DEFAULT_SPRITE_MODEL_URL, 1).title).toBe("Loading the model…");
  });

  test("downloading shows progress when the size is known", () => {
    const known = describeCutoutModel({ state: "downloading", receivedBytes: 44 * MB, totalBytes: 176 * MB }, "best");
    expect(known.progress).toBeCloseTo(0.25);
    expect(known.title).toContain("25%");
    expect(known.detail).toContain("44 MB of 176 MB");
    expect(known.action).toBeNull();
    const unknown = describeCutoutModel({ state: "downloading", receivedBytes: 3 * MB, totalBytes: null }, "best");
    expect(unknown.progress).toBeNull();
    expect(unknown.detail).toContain("3 MB so far");
  });

  test("ready offers Remove and names the backend; error offers a retry; unsupported offers nothing", () => {
    const ready = describeCutoutModel({ state: "ready", backend: "wasm", bytes: 176 * MB }, "basic");
    expect(ready.action).toBe("remove");
    expect(ready.detail).toContain("WebAssembly");
    expect(ready.detail).toContain("Not used while cut-out quality is Basic");
    expect(describeCutoutModel({ state: "error", error: "HTTP 404." }, "best").action).toBe("retry");
    const unsupported = describeCutoutModel({ state: "unsupported", reason: "No WebAssembly." }, "best");
    expect(unsupported.action).toBeNull();
    expect(unsupported.level).toBe("blocked");
    expect(describeCutoutModel({ state: "loading" }, "best").level).toBe("loading");
  });

  test("bytes read as KB or MB", () => {
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(1.5 * MB)).toBe("1.5 MB");
    expect(formatBytes(176 * MB)).toBe("176 MB");
  });
});

describe("sprite model URL (Advanced)", () => {
  test("https and local http pass; empty restores the default", () => {
    expect(parseSpriteModelUrl("  https://example.com/m.onnx ")).toBe("https://example.com/m.onnx");
    expect(parseSpriteModelUrl("http://localhost:8080/m.onnx")).toBe("http://localhost:8080/m.onnx");
    expect(parseSpriteModelUrl("")).toBe(DEFAULT_SPRITE_MODEL_URL);
  });

  test("plain http elsewhere and junk are rejected with a plain message", () => {
    expect(() => parseSpriteModelUrl("http://example.com/m.onnx")).toThrow(/https/);
    expect(() => parseSpriteModelUrl("not a url")).toThrow(/not a valid web address/);
  });
});

describe("sprite library helpers", () => {
  test("expressions: the hot set in order (missing ones filled in), then rare ones alphabetically", () => {
    const ordered = orderedExpressions(set("a", "", { zz_rare: "ready", smile: "ready", acting_coy: "failed" }));
    expect(ordered.slice(0, SPRITE_HOT_SET.length).map((image) => image.expression)).toEqual([...SPRITE_HOT_SET]);
    expect(ordered[0]!.status).toBe("missing");
    expect(ordered.slice(SPRITE_HOT_SET.length).map((image) => image.expression)).toEqual(["acting_coy", "zz_rare"]);
  });

  test("expressions and counts follow the set size: the active set, then images that exist", () => {
    const sample = set("a", "", { idle: "ready", surprised: "ready", worried: "missing", happy_tears: "failed" });
    expect(orderedExpressions(sample, 4).map((image) => image.expression)).toEqual(["idle", "smile", "sad", "angry", "surprised", "happy_tears"]);
    expect(orderedExpressions(sample, 8).map((image) => image.expression)).toEqual([...SPRITE_SET_8, "happy_tears"]);
    expect(orderedExpressions(sample, 12)).toHaveLength(SPRITE_HOT_SET.length + 1);
    expect(countReady(sample, 4)).toBe(1);
    expect(countReady(sample, 12)).toBe(2);
    expect(mergeSpriteImage(sample, { expression: "smile", status: "ready", url: "/s.png" }, 4).readyCount).toBe(2);
    const empty = summarizeSpriteLibrary([set("b", "")], [], 4);
    expect(describeSpriteLibrary(empty)).toBe("1 character (0/4 sprites ready) · 0 backgrounds");
    expect(summarizeSpriteLibrary([set("b", "")], [], 8).totalSprites).toBe(8);
  });

  test("the not-made-yet hint says whether the set size makes the expression", () => {
    expect(missingHint("smile", 4)).toBe("Cue makes it soon after the set is first used");
    expect(missingHint("worried", 4)).toBe("It is not in the 4 set, so the nearest expression in the set stands in");
    expect(missingHint("worried", 12)).toBe("Cue makes it soon after the set is first used");
    expect(missingHint("happy_tears", 12)).toBe("Until it exists, the nearest expression stands in");
  });

  test("labels, statuses and plate details read as plain words", () => {
    expect(expressionLabel("crying_with_eyes_open")).toBe("Crying with eyes open");
    expect(expressionLabel("")).toBe("Expression");
    expect(SPRITE_STATUS_LABELS.generating).toBe("Drawing");
    expect(spriteStatusBusy("cutting")).toBe(true);
    expect(spriteStatusBusy("failed")).toBe(false);
    expect(plateDetails({ timeOfDay: "night", weather: " rain " })).toBe("night · rain");
    expect(plateDetails({ timeOfDay: null, weather: null })).toBe("");
  });

  test("the cover is idle when ready, else the best available expression", () => {
    expect(setCoverImage(set("a", "", { idle: "ready", smile: "ready" }))?.expression).toBe("idle");
    expect(setCoverImage(set("a", "", { idle: "failed", sad: "ready", smile: "ready" }))?.expression).toBe("smile");
    expect(setCoverImage(set("a", "", { idle: "generating" }))).toBeNull();
  });

  test("a live update replaces one expression and recounts", () => {
    const before = set("a", "2026-01-01T00:00:00.000Z", { idle: "ready", smile: "generating" });
    const after = mergeSpriteImage(before, { expression: "smile", status: "ready", url: "/s.png" });
    expect(after.readyCount).toBe(2);
    expect(countReady(after)).toBe(2);
    expect(before.expressions.smile!.status).toBe("generating");
    expect(after.updatedAt > before.updatedAt).toBe(true);
  });

  test("plates merge by key; sets sort newest first", () => {
    const plates: PlateView[] = [{ plateKey: "p1", location: "A", timeOfDay: null, weather: null, status: "queued" }];
    const replaced = mergePlate(plates, { ...plates[0]!, status: "ready" });
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.status).toBe("ready");
    expect(mergePlate(replaced, { plateKey: "p2", location: "B", timeOfDay: null, weather: null, status: "missing" })).toHaveLength(2);
    expect(sortSpriteSets([set("old", "2026-01-01"), set("new", "2026-02-01")]).map((item) => item.setKey)).toEqual(["new", "old"]);
  });

  test("the library summary counts sprites, plates, work in progress and failures", () => {
    const summary = summarizeSpriteLibrary([set("a", "", { idle: "ready", smile: "failed", sad: "generating" })],
      [{ plateKey: "p", location: "A", timeOfDay: null, weather: null, status: "cutting" }]);
    expect(summary).toEqual({ sets: 1, readySprites: 1, totalSprites: 12, plates: 1, readyPlates: 0, busy: 2, failed: 1 });
    expect(describeSpriteLibrary(summary)).toBe("1 character (1/12 sprites ready) · 1 background · 2 in progress · 1 failed");
    expect(describeSpriteLibrary(summarizeSpriteLibrary([], []))).toBe("No sprites yet.");
  });
});

describe("expression thumbnails", () => {
  test("frame the face: the window starts at the top of the opaque box and stays inside the image", () => {
    const crop = faceCrop({ bbox: [0.2, 0.05, 0.6, 0.95], width: 832, height: 1216 }, 4 / 5)!;
    // A window 60% of the image wide shows the image at 1/0.6 of the tile width.
    expect(parseFloat(crop.width)).toBeCloseTo(166.67, 1);
    expect(parseFloat(crop.left)).toBeCloseTo(-33.33, 1);
    expect(parseFloat(crop.top)).toBeLessThan(0);
    const edge = faceCrop({ bbox: [0.9, 0, 0.1, 1] }, 1)!;
    expect(parseFloat(edge.left)).toBeGreaterThanOrEqual(-(100 / 0.3) * (1 - 0.3) - 0.01);
    expect(faceCrop({}, 1)).toBeNull();
  });

  test("the gallery styles use no network assets and respect reduced motion", () => {
    expect(SPRITE_LIBRARY_CSS).not.toMatch(/url\(/i);
    expect(SPRITE_LIBRARY_CSS).toContain("prefers-reduced-motion: reduce");
    const source = readFileSync(new URL("./sprite-library.ts", import.meta.url), "utf8");
    expect(source).toContain('loading: "lazy"');
  });
});
