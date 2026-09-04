import { describe, expect, test } from "bun:test";
import {
  acceptAudioImportChunk,
  clearAudioImportBuffers,
  MAX_AUDIO_IMPORT_BASE64,
  sanitizeAudioImportPath
} from "./controller.js";

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

describe("acceptAudioImportChunk", () => {
  test("returns single-chunk payloads immediately", () => {
    expect(acceptAudioImportChunk("u:one", { dataBase64: "QUJD" })).toBe("QUJD");
    expect(acceptAudioImportChunk("u:one", { dataBase64: "QUJD", chunkCount: 1 })).toBe("QUJD");
  });

  test("assembles ordered chunks and only completes on the last one", () => {
    expect(acceptAudioImportChunk("u:two", { dataBase64: "AAA", chunkIndex: 0, chunkCount: 3 })).toBeNull();
    expect(acceptAudioImportChunk("u:two", { dataBase64: "BBB", chunkIndex: 1, chunkCount: 3 })).toBeNull();
    expect(acceptAudioImportChunk("u:two", { dataBase64: "CCC", chunkIndex: 2, chunkCount: 3 })).toBe("AAABBBCCC");
    // Buffer is cleared after completion.
    expect(acceptAudioImportChunk("u:two", { dataBase64: "ZZZ", chunkIndex: 0, chunkCount: 3 })).toBeNull();
    clearAudioImportBuffers("u");
  });

  test("tolerates out-of-order and duplicate chunks", () => {
    expect(acceptAudioImportChunk("u:three", { dataBase64: "22", chunkIndex: 1, chunkCount: 2 })).toBeNull();
    expect(acceptAudioImportChunk("u:three", { dataBase64: "22", chunkIndex: 1, chunkCount: 2 })).toBeNull();
    expect(acceptAudioImportChunk("u:three", { dataBase64: "11", chunkIndex: 0, chunkCount: 2 })).toBe("1122");
  });

  test("rejects oversized transfers", () => {
    const big = "A".repeat(MAX_AUDIO_IMPORT_BASE64 + 1);
    expect(() => acceptAudioImportChunk("u:big", { dataBase64: big })).toThrow(/too large/);
  });

  test("clearAudioImportBuffers drops a user's partial transfers", () => {
    expect(acceptAudioImportChunk("owner:x", { dataBase64: "AA", chunkIndex: 0, chunkCount: 2 })).toBeNull();
    clearAudioImportBuffers("owner");
    // After clearing, the remaining chunk alone can no longer complete.
    expect(acceptAudioImportChunk("owner:x", { dataBase64: "BB", chunkIndex: 1, chunkCount: 2 })).toBeNull();
  });
});
