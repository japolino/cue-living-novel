import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { DEFAULT_CONFIG, KEY_ILLUSTRATION_MODES, PRESENTATION_MODES, SPRITE_CUTOUT_QUALITIES } from "../../config.js";
import { DEFAULT_SPRITE_MODEL_URL, SPRITE_HOT_SET, type PlateView, type SpriteSetView } from "../../shared/sprites.js";
import {
  KEY_ILLUSTRATION_OPTIONS,
  normalizeKeyIllustrations,
  PRESENTATION_MODE_OPTIONS,
  SPRITE_CUTOUT_OPTIONS,
  SPRITE_STATUS_LABELS,
  countReady,
  describeCutoutModel,
  describeSpriteLibrary,
  expressionLabel,
  formatBytes,
  mergePlate,
  mergeSpriteImage,
  normalizePresentationMode,
  normalizeSpriteCutout,
  orderedExpressions,
  parseSpriteModelUrl,
  plateDetails,
  setCoverImage,
  sortSpriteSets,
  spriteStatusBusy,
  summarizeSpriteLibrary,
} from "./model";
import { SPRITE_LIBRARY_CSS, faceCrop } from "./sprite-library";

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
