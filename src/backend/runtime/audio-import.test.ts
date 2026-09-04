import { describe, expect, test } from "bun:test";
import { sanitizeAudioImportPath } from "./controller.js";

describe("sanitizeAudioImportPath", () => {
  test("keeps clean relative paths with forward slashes", () => {
    expect(sanitizeAudioImportPath("MyAudio/bgm/theme.mp3")).toBe("MyAudio/bgm/theme.mp3");
    expect(sanitizeAudioImportPath("theme.ogg")).toBe("theme.ogg");
  });

  test("normalizes backslashes and strips drive letters and leading slashes", () => {
    expect(sanitizeAudioImportPath("C:\\Users\\me\\audio\\a.mp3")).toBe("Users/me/audio/a.mp3");
    expect(sanitizeAudioImportPath("/abs/path/b.wav")).toBe("abs/path/b.wav");
  });

  test("removes dot segments and rejects empty results", () => {
    expect(sanitizeAudioImportPath("../../escape.mp3")).toBe("escape.mp3");
    expect(sanitizeAudioImportPath("a/./b/../c.flac")).toBe("a/b/c.flac");
    expect(sanitizeAudioImportPath("..")).toBeNull();
    expect(sanitizeAudioImportPath("")).toBeNull();
  });
});
