/**
 * Cue read-aloud settings: types, defaults, and normalization.
 *
 * Read aloud is DEFAULT-OFF and voiced by the Choir companion extension only:
 * Choir casts the voices and holds the provider keys, so Cue stores no voice,
 * provider or key here. Kept in its own module so the shared config surface
 * stays a narrow diff.
 *
 * Older saved configs may still carry the retired Lumiverse TTS-profile fields
 * (narrator, characterDefault, characters, deliveryMode, deliveryTag,
 * deliveryAllProviders) and the retired autoplay and volume; normalization
 * drops them.
 */

export type SpeechSettings = {
  /** Master switch. False by default: no Choir request at all. When on, each paragraph is read as it appears. */
  enabled: boolean;
  /** Mute narrator speech (dialogue only). */
  muteNarrator: boolean;
  /**
   * Use Choir's sound effects, ambience and music; Cue's own pack audio stays
   * quiet while Choir's sound is on. On by default; it only takes effect when
   * the installed Choir can switch its sound for Cue.
   */
  choirSound: boolean;
};

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  enabled: false,
  muteNarrator: false,
  choirSound: true,
};

export function normalizeSpeechSettings(value: unknown): SpeechSettings {
  const raw = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    enabled: raw.enabled === true,
    muteNarrator: raw.muteNarrator === true,
    choirSound: raw.choirSound !== false,
  };
}
