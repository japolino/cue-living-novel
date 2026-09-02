import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  categorizeAudioFile,
  clearAudioCatalogCache,
  extractAudioTags,
  findAudioEntry,
  getAudioCatalog,
  resolveAudioUrl,
  scanAudioCatalog,
  tokenizeText,
} from "./audio-catalog.js";

describe("audio-catalog categorization & tags", () => {
  test("tokenizes text with spaces, underscores, and camelCase", () => {
    expect(tokenizeText("rainyNight_piano-OST")).toEqual(["rainy", "night", "piano", "ost"]);
    expect(tokenizeText("explosion01_SFX")).toEqual(["explosion01", "sfx"]);
  });

  test("categorizes files into bgm and sfx based on path and name keywords", () => {
    expect(categorizeAudioFile("/audio/bgm/peaceful.mp3", "bgm/peaceful.mp3")).toBe("bgm");
    expect(categorizeAudioFile("/audio/music/battle.ogg", "music/battle.ogg")).toBe("bgm");
    expect(categorizeAudioFile("/audio/ost/theme_main.flac", "ost/theme_main.flac")).toBe("bgm");
    expect(categorizeAudioFile("/audio/sfx/sword_slash.wav", "sfx/sword_slash.wav")).toBe("sfx");
    expect(categorizeAudioFile("/audio/effects/door_creak.m4a", "effects/door_creak.m4a")).toBe("sfx");
    expect(categorizeAudioFile("/audio/se/gunshot.wav", "se/gunshot.wav")).toBe("sfx");
    expect(categorizeAudioFile("/audio/generic/footstep.mp3", "generic/footstep.mp3")).toBe("sfx");
    expect(categorizeAudioFile("/audio/ambient_rain.ogg", "ambient_rain.ogg")).toBe("bgm");
  });

  test("extracts tags from folders and file names", () => {
    const bgmTags = extractAudioTags("bgm/romantic/slow_piano_theme.mp3", "bgm");
    expect(bgmTags).toContain("bgm");
    expect(bgmTags).toContain("romantic");
    expect(bgmTags).toContain("slow");
    expect(bgmTags).toContain("piano");
    expect(bgmTags).toContain("theme");

    const sfxTags = extractAudioTags("sfx/combat/heavy_punch.wav", "sfx");
    expect(sfxTags).toContain("sfx");
    expect(sfxTags).toContain("combat");
    expect(sfxTags).toContain("heavy");
    expect(sfxTags).toContain("punch");
  });
});

describe("audio-catalog disk scanner & cache", () => {
  let tempDir: string;

  beforeEach(async () => {
    clearAudioCatalogCache();
    tempDir = path.join(os.tmpdir(), `vn-audio-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(path.join(tempDir, "bgm", "melancholy"), { recursive: true });
    await mkdir(path.join(tempDir, "sfx", "action"), { recursive: true });

    // Populate mock audio files and an ignored file
    await writeFile(path.join(tempDir, "bgm", "melancholy", "rainy_day.mp3"), "dummy-audio");
    await writeFile(path.join(tempDir, "bgm", "main_theme.ogg"), "dummy-audio");
    await writeFile(path.join(tempDir, "sfx", "action", "sword_hit.wav"), "dummy-audio");
    await writeFile(path.join(tempDir, "sfx", "door_open.flac"), "dummy-audio");
    await writeFile(path.join(tempDir, "readme.txt"), "not-audio");
  });

  afterEach(async () => {
    clearAudioCatalogCache();
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("scans directory recursively and ignores non-audio files", async () => {
    const catalog = await scanAudioCatalog(tempDir);
    expect(catalog.all.length).toBe(4);
    expect(catalog.bgm.length).toBe(2);
    expect(catalog.sfx.length).toBe(2);

    const names = catalog.all.map((e) => e.name);
    expect(names).toContain("rainy_day");
    expect(names).toContain("main_theme");
    expect(names).toContain("sword_hit");
    expect(names).toContain("door_open");
  });

  test("caches scanned results in memory and getAudioCatalog returns them", async () => {
    await scanAudioCatalog(tempDir);
    const cached = getAudioCatalog();
    expect(cached.all.length).toBe(4);
    expect(cached.bgm.length).toBe(2);
    expect(cached.sfx.length).toBe(2);

    clearAudioCatalogCache();
    expect(getAudioCatalog().all.length).toBe(0);
  });

  test("findAudioEntry and resolveAudioUrl locate catalog items", async () => {
    await scanAudioCatalog(tempDir);

    const entry = findAudioEntry("rainy_day");
    expect(entry).not.toBeNull();
    expect(entry?.name).toBe("rainy_day");
    expect(entry?.category).toBe("bgm");

    const sfxEntry = findAudioEntry("sfx/action/sword_hit");
    expect(sfxEntry).not.toBeNull();
    expect(sfxEntry?.category).toBe("sfx");

    const url = resolveAudioUrl("main_theme");
    expect(url).toBe(path.join(tempDir, "bgm", "main_theme.ogg"));

    // Absolute URLs pass through
    expect(resolveAudioUrl("https://example.com/audio.mp3")).toBe("https://example.com/audio.mp3");
    // Unknown item returns null
    expect(resolveAudioUrl("nonexistent_sound")).toBeNull();
  });

  test("handles empty or non-existent directories gracefully", async () => {
    const emptyResult = await scanAudioCatalog("");
    expect(emptyResult.all).toEqual([]);

    const nonExistentResult = await scanAudioCatalog(path.join(tempDir, "does-not-exist"));
    expect(nonExistentResult.all).toEqual([]);
  });
});
