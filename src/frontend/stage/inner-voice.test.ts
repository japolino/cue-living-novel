import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import { applyInnerVoiceGlow, innerVoiceNames, paragraphInnerVoice } from "./inner-voice";
import { INNER_VOICE_COLORS } from "./voices";

describe("innerVoiceNames", () => {
  test("comma, line and 、 separated; trimmed; duplicates (any case) dropped", () => {
    expect(innerVoiceNames("Conscience, The Ancient Reptilian Brain ,\nconscience;  양심、良心，")).toEqual([
      "Conscience", "The Ancient Reptilian Brain", "양심", "良心",
    ]);
    expect(innerVoiceNames("")).toEqual([]);
    expect(innerVoiceNames(undefined)).toEqual([]);
    expect(innerVoiceNames(" , ,, ")).toEqual([]);
  });
});

describe("paragraphInnerVoice", () => {
  test("skills and the reader's extra names are inner voices; the reader's own line never is", () => {
    expect(paragraphInnerVoice("LOGIC", [])?.family).toBe("intellect");
    expect(paragraphInnerVoice("Conscience", ["conscience"])?.family).toBe("custom");
    expect(paragraphInnerVoice("Conscience", [])).toBeNull();
    expect(paragraphInnerVoice("Mira", ["Conscience"])).toBeNull();
    expect(paragraphInnerVoice("", [])).toBeNull();
    expect(paragraphInnerVoice("Logic", [], true)).toBeNull();
  });
});

describe("applyInnerVoiceGlow", () => {
  let restore: () => void;
  beforeEach(() => { restore = installFakeDocument(); });
  afterEach(() => restore());

  test("lights in the voice's colour and fades out keeping that colour", () => {
    const glow = new FakeNode("div");
    applyInnerVoiceGlow(glow as unknown as HTMLElement, { name: "logic", family: "intellect", color: INNER_VOICE_COLORS.intellect });
    expect(glow.dataset.vnVoiceOn).toBe("true");
    expect(glow.dataset.vnVoiceFamily).toBe("intellect");
    expect(glow.style["--vn-voice-color"]).toBe(INNER_VOICE_COLORS.intellect);
    applyInnerVoiceGlow(glow as unknown as HTMLElement, null);
    expect(glow.dataset.vnVoiceOn).toBeUndefined();
    expect(glow.style["--vn-voice-color"]).toBe(INNER_VOICE_COLORS.intellect);
  });
});
