import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG, normalizeConfig } from "./config.js";
import { DEFAULT_SPEECH_SETTINGS, normalizeSpeechSettings } from "./speech-config.js";

describe("speech settings normalization", () => {
  test("speech is OFF by default with no voices configured", () => {
    expect(DEFAULT_SPEECH_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_SPEECH_SETTINGS.autoplay).toBe(false);
    expect(DEFAULT_SPEECH_SETTINGS.narrator).toBeNull();
    expect(DEFAULT_SPEECH_SETTINGS.characterDefault).toBeNull();
    expect(DEFAULT_SPEECH_SETTINGS.characters).toEqual({});
    expect(DEFAULT_SPEECH_SETTINGS.deliveryMode).toBe("none");
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

  test("custom / catalog-missing voice ids are preserved verbatim (case included)", () => {
    const speech = normalizeSpeechSettings({
      narrator: { connectionId: "conn-1", voice: "Zephyr" },
      characterDefault: { connectionId: "conn-2", voice: "my custom voice ID " },
    });
    expect(speech.narrator).toEqual({ connectionId: "conn-1", voice: "Zephyr" });
    // Voice strings are provider-defined: never trimmed or case-folded.
    expect(speech.characterDefault?.voice).toBe("my custom voice ID ");
  });

  test("a voice ref without a connection id is not a ref", () => {
    expect(normalizeSpeechSettings({ narrator: { connectionId: "", voice: "x" } }).narrator).toBeNull();
    expect(normalizeSpeechSettings({ narrator: { voice: "x" } }).narrator).toBeNull();
    expect(normalizeSpeechSettings({ narrator: [] }).narrator).toBeNull();
  });

  test("character override map keeps chat-scoped keys and drops malformed entries", () => {
    const speech = normalizeSpeechSettings({
      characters: {
        "chat::c1::mira": { connectionId: "conn-1", voice: "Kore" },
        "chat::c2::mira": { connectionId: "conn-2", voice: "Puck" },
        "": { connectionId: "conn-3", voice: "x" },
        "chat::c1::bad": { voice: "no-connection" },
      },
    });
    expect(Object.keys(speech.characters).sort()).toEqual(["chat::c1::mira", "chat::c2::mira"]);
    expect(speech.characters["chat::c1::mira"]?.voice).toBe("Kore");
    expect(speech.characters["chat::c2::mira"]?.voice).toBe("Puck");
  });

  test("volume clamps and speed bounds apply", () => {
    expect(normalizeSpeechSettings({ volume: 9 }).volume).toBe(1);
    expect(normalizeSpeechSettings({ volume: -1 }).volume).toBe(0);
    expect(normalizeSpeechSettings({ volume: "x" }).volume).toBe(DEFAULT_SPEECH_SETTINGS.volume);
    const speech = normalizeSpeechSettings({ narrator: { connectionId: "c", voice: "", parameters: { speed: 99 } } });
    expect(speech.narrator?.parameters?.speed).toBe(4);
  });

  test("muteNarrator preserves boolean true and rejects non-boolean", () => {
    expect(DEFAULT_SPEECH_SETTINGS.muteNarrator).toBe(false);
    expect(normalizeSpeechSettings({ muteNarrator: true }).muteNarrator).toBe(true);
    expect(normalizeSpeechSettings({ muteNarrator: "true" }).muteNarrator).toBe(false);
    expect(normalizeSpeechSettings({ muteNarrator: 1 }).muteNarrator).toBe(false);
  });

  test("unknown delivery modes fall back to none", () => {
    expect(normalizeSpeechSettings({ deliveryMode: "ssml" }).deliveryMode).toBe("none");
    expect(normalizeSpeechSettings({ deliveryMode: "gemini-audio-tags" }).deliveryMode).toBe("gemini-audio-tags");
  });
});

describe("delivery compatibility opt-in", () => {
  test("deliveryAllProviders defaults false and requires a literal true", () => {
    expect(normalizeSpeechSettings({}).deliveryAllProviders).toBe(false);
    expect(normalizeSpeechSettings({ deliveryAllProviders: "yes" }).deliveryAllProviders).toBe(false);
    expect(normalizeSpeechSettings({ deliveryAllProviders: true }).deliveryAllProviders).toBe(true);
  });
});
