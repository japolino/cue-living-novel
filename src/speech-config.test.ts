import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG, normalizeConfig } from "./config.js";
import { DEFAULT_SPEECH_SETTINGS, normalizeSpeechSettings } from "./speech-config.js";

describe("read-aloud settings normalization", () => {
  test("read aloud is OFF by default; Sound from Choir is on", () => {
    expect(DEFAULT_SPEECH_SETTINGS).toEqual({ enabled: false, muteNarrator: false, choirSound: true });
  });

  test("a config without a speech block normalizes to the defaults (existing users stay off)", () => {
    expect(normalizeConfig({}).speech).toEqual(DEFAULT_SPEECH_SETTINGS);
    expect(normalizeConfig({ speech: "garbage" }).speech).toEqual(DEFAULT_SPEECH_SETTINGS);
    expect(DEFAULT_CONFIG.speech.enabled).toBe(false);
  });

  test("enabled requires a literal true, not truthiness", () => {
    expect(normalizeSpeechSettings({ enabled: 1 }).enabled).toBe(false);
    expect(normalizeSpeechSettings({ enabled: "true" }).enabled).toBe(false);
    expect(normalizeSpeechSettings({ enabled: true }).enabled).toBe(true);
  });

  test("muteNarrator preserves boolean true and rejects non-boolean", () => {
    expect(normalizeSpeechSettings({ muteNarrator: true }).muteNarrator).toBe(true);
    expect(normalizeSpeechSettings({ muteNarrator: "true" }).muteNarrator).toBe(false);
    expect(normalizeSpeechSettings({ muteNarrator: 1 }).muteNarrator).toBe(false);
  });

  test("Sound from Choir stays on unless it was turned off", () => {
    expect(normalizeSpeechSettings({}).choirSound).toBe(true);
    expect(normalizeSpeechSettings({ choirSound: true }).choirSound).toBe(true);
    expect(normalizeSpeechSettings({ choirSound: false }).choirSound).toBe(false);
  });

  test("the retired TTS-profile, delivery, autoplay and volume fields are dropped", () => {
    const speech = normalizeSpeechSettings({
      enabled: true,
      autoplay: false,
      volume: 0.4,
      narrator: { connectionId: "conn-1", voice: "Zephyr" },
      characterDefault: { connectionId: "conn-2", voice: "" },
      characters: { "chat::c1::mira": { connectionId: "conn-1", voice: "Kore" } },
      deliveryMode: "gemini-audio-tags",
      deliveryTag: "whispers",
      deliveryAllProviders: true,
      choirSound: false,
    });
    expect(speech).toEqual({ enabled: true, muteNarrator: false, choirSound: false });
  });
});
