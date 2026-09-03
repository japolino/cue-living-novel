import { beforeEach, describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  categorizeAudioFile,
  clearAudioCatalogCache,
  extractAudioTags,
  findAudioEntry,
  getAudioCatalog,
  normalizeAudioStoragePrefix,
  resolveAudioUrl,
  scanAudioCatalog,
  tokenizeText,
} from "./audio-catalog.js";

function storageSpindle(files: Record<string, string>): SpindleAPI {
  const encoder = new TextEncoder();
  return {
    storage: {
      list: async (prefix = "") => Object.keys(files)
        .filter((path) => path.startsWith(`${prefix.replace(/\/$/, "")}/`))
        .map((path) => path.slice(prefix.replace(/\/$/, "").length + 1)),
      readBinary: async (path: string) => {
        const value = files[path];
        if (value === undefined) throw new Error("missing");
        return encoder.encode(value);
      },
    },
  } as unknown as SpindleAPI;
}

const spindle = storageSpindle({
  "audio/bgm/melancholy/rainy_day.mp3": "dummy-audio",
  "audio/bgm/main_theme.ogg": "dummy-audio",
  "audio/sfx/action/sword_hit.wav": "dummy-audio",
  "audio/sfx/door_open.flac": "dummy-audio",
  "audio/readme.txt": "not-audio",
});

describe("audio-catalog categorization & tags", () => {
  test("tokenizes text with spaces, underscores, and camelCase", () => {
    expect(tokenizeText("rainyNight_piano-OST")).toEqual(["rainy", "night", "piano", "ost"]);
    expect(tokenizeText("explosion01_SFX")).toEqual(["explosion01", "sfx"]);
  });

  test("categorizes files into bgm and sfx based on path and name keywords", () => {
    expect(categorizeAudioFile("audio/bgm/peaceful.mp3", "bgm/peaceful.mp3")).toBe("bgm");
    expect(categorizeAudioFile("audio/music/battle.ogg", "music/battle.ogg")).toBe("bgm");
    expect(categorizeAudioFile("audio/sfx/sword_slash.wav", "sfx/sword_slash.wav")).toBe("sfx");
    expect(categorizeAudioFile("audio/effects/door_creak.m4a", "effects/door_creak.m4a")).toBe("sfx");
  });

  test("extracts tags from folders and file names", () => {
    expect(extractAudioTags("bgm/romantic/slow_piano_theme.mp3", "bgm")).toEqual(
      expect.arrayContaining(["bgm", "romantic", "slow", "piano", "theme"]),
    );
    expect(extractAudioTags("sfx/combat/heavy_punch.wav", "sfx")).toEqual(
      expect.arrayContaining(["sfx", "combat", "heavy", "punch"]),
    );
  });

  test("maps absolute legacy directories to the scoped audio prefix", () => {
    expect(normalizeAudioStoragePrefix("C:\\audio\\pack")).toBe("audio");
    expect(normalizeAudioStoragePrefix("/audio/pack")).toBe("audio");
    expect(normalizeAudioStoragePrefix("packs/vn-audio")).toBe("packs/vn-audio");
  });
});

describe("audio-catalog scoped storage scanner & cache", () => {
  beforeEach(() => clearAudioCatalogCache());

  test("scans scoped storage recursively and ignores non-audio files", async () => {
    const catalog = await scanAudioCatalog(spindle, "audio");
    expect(catalog.all).toHaveLength(4);
    expect(catalog.bgm).toHaveLength(2);
    expect(catalog.sfx).toHaveLength(2);
    expect(catalog.all.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["rainy_day", "main_theme", "sword_hit", "door_open"]),
    );
  });

  test("caches entries and exposes browser-safe data URLs", async () => {
    await scanAudioCatalog(spindle, "audio");
    expect(getAudioCatalog().all).toHaveLength(4);
    expect(resolveAudioUrl("main_theme")).toStartWith("data:audio/ogg;base64,");
    expect(resolveAudioUrl("https://example.com/audio.mp3")).toBe("https://example.com/audio.mp3");
    expect(resolveAudioUrl("C:\\unsafe\\track.mp3")).toBeNull();
    clearAudioCatalogCache();
    expect(getAudioCatalog().all).toHaveLength(0);
  });

  test("finds entries by id, name, and relative path", async () => {
    await scanAudioCatalog(spindle, "audio");
    expect(findAudioEntry("rainy_day")?.category).toBe("bgm");
    expect(findAudioEntry("sfx/action/sword_hit")?.category).toBe("sfx");
  });

  test("handles empty or unavailable storage gracefully", async () => {
    expect((await scanAudioCatalog(storageSpindle({}), "audio")).all).toEqual([]);
    clearAudioCatalogCache();
    const failing = { storage: { list: async () => { throw new Error("denied"); } } } as unknown as SpindleAPI;
    expect((await scanAudioCatalog(failing, "audio")).all).toEqual([]);
  });

  test("finds entries via normalized titles and semantic mood/action tags", async () => {
    const spindleWithMoods = storageSpindle({
      "audio/bgm/1_At_home（希望）.ogg": "dummy",
      "audio/bgm/2_Tango_Romantic.ogg": "dummy",
      "audio/sfx/1_door_close.wav": "dummy",
    });
    await scanAudioCatalog(spindleWithMoods, "audio");
    // Normalized title match ignoring numeric prefix and Japanese parens
    expect(findAudioEntry("At home")?.name).toBe("1_At_home（希望）");
    // Semantic tag matches
    expect(findAudioEntry("romantic", "bgm")?.name).toBe("2_Tango_Romantic");
    expect(findAudioEntry("door", "sfx")?.name).toBe("1_door_close");
    clearAudioCatalogCache();
  });

  test("integrates pack.json metadata when present", async () => {
    const packJson = JSON.stringify({
      tracks: {
        bgm: [{ id: "bgm_home", name: "Cozy Home", file: "bgm/track1.ogg", tags: ["peaceful", "daily"] }]
      }
    });
    const spindleWithPack = storageSpindle({
      "audio/pack.json": packJson,
      "audio/bgm/track1.ogg": "dummy",
    });
    await scanAudioCatalog(spindleWithPack, "audio");
    const entry = findAudioEntry("peaceful", "bgm");
    expect(entry?.name).toBe("Cozy Home");
    expect(entry?.tags).toContain("peaceful");
    clearAudioCatalogCache();
  });
});
