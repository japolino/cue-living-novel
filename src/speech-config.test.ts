import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG, normalizeConfig } from "./config.js";
import { DEFAULT_SPEECH_SETTINGS, normalizeSpeechSettings } from "./speech-config.js";

describe("read-aloud settings normalization", () => {
  test("read aloud and reading before the plan are OFF by default", () => {
    expect(DEFAULT_SPEECH_SETTINGS).toEqual({ enabled: false, muteNarrator: false, speakBeforePlan: false });
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

  test("Read before the scene is ready requires a literal true", () => {
    expect(normalizeSpeechSettings({ speakBeforePlan: true }).speakBeforePlan).toBe(true);
    expect(normalizeSpeechSettings({ speakBeforePlan: "true" }).speakBeforePlan).toBe(false);
  });

  test("read aloud that was on with autoplay off comes back off: nothing is read (or paid for) until it is turned on again", () => {
    expect(normalizeSpeechSettings({ enabled: true, autoplay: false }).enabled).toBe(false);
    expect(normalizeSpeechSettings({ enabled: true, autoplay: "true" }).enabled).toBe(false);
    expect(normalizeSpeechSettings({ enabled: true, autoplay: true }).enabled).toBe(true);
    // Once saved again the legacy field is gone, so turning it on sticks.
    const saved = normalizeSpeechSettings({ ...normalizeSpeechSettings({ enabled: true, autoplay: false }), enabled: true });
    expect(normalizeSpeechSettings(saved).enabled).toBe(true);
    expect(normalizeConfig({ speech: { enabled: true, autoplay: false } }).speech.enabled).toBe(false);
  });

  test("the retired TTS-profile, delivery, autoplay, volume and Sound from Choir fields are dropped", () => {
    const speech = normalizeSpeechSettings({
      enabled: true,
      autoplay: true,
      volume: 0.4,
      narrator: { connectionId: "conn-1", voice: "Zephyr" },
      characterDefault: { connectionId: "conn-2", voice: "" },
      characters: { "chat::c1::mira": { connectionId: "conn-1", voice: "Kore" } },
      deliveryMode: "gemini-audio-tags",
      deliveryTag: "whispers",
      deliveryAllProviders: true,
      choirSound: false,
    });
    expect(speech).toEqual({ enabled: true, muteNarrator: false, speakBeforePlan: false });
  });
});
