/**
 * Cue speech (TTS) settings: types, defaults, and normalization.
 *
 * Speech is DEFAULT-OFF. It reuses the user's saved Lumiverse TTS connection
 * profiles by opaque profile id only; Cue never stores provider URLs or keys.
 * Kept in its own module so the shared config surface stays a narrow diff.
 */

/** A reference to a saved Lumiverse TTS connection profile plus an optional voice override. */
export type SpeechVoiceRef = {
  /** Opaque Lumiverse TTS connection profile id. Never a provider URL or key. */
  connectionId: string;
  /** Provider voice id. Empty string means "use the profile's own default voice". */
  voice: string;
  parameters?: { speed?: number };
};

/**
 * How outbound speech text is decorated before synthesis.
 * - "none": prose is sent byte-identical (default);
 * - "gemini-audio-tags": an explicit user-chosen inline delivery tag (for example
 *   `[whispers]`) is prepended, per the official Gemini speech-generation docs.
 *   This is probabilistic performance guidance for Gemini-family TTS models only;
 *   other providers may read the bracket text aloud, which is why it is opt-in.
 */
export const SPEECH_DELIVERY_MODES = ["none", "gemini-audio-tags"] as const;
export type SpeechDeliveryMode = (typeof SPEECH_DELIVERY_MODES)[number];

export type SpeechSettings = {
  /** Master switch. False by default: no speech UI activity and zero requests. */
  enabled: boolean;
  /**
   * Auto-play the current paragraph on advance. Even when true, playback starts
   * only after one successful user-gesture Play in the session (browser policy).
   */
  autoplay: boolean;
  /** Speech volume (own player, independent of BGM/SFX). */
  volume: number;
  /** Mute narrator speech (dialogue only). */
  muteNarrator: boolean;
  /** Choir plays sound effects, ambience and music; Cue's own pack audio stays quiet. */
  choirSound: boolean;
  /** Narration voice. Null means "not configured" (silence + settings hint). */
  narrator: SpeechVoiceRef | null;
  /** Fallback voice for any character without an override. Null = fall back to narrator. */
  characterDefault: SpeechVoiceRef | null;
  /**
   * Per-character overrides keyed by `chat::<chatId>::<lowercased name>` so the
   * same display name in different chats never collides.
   */
  characters: Record<string, SpeechVoiceRef>;
  deliveryMode: SpeechDeliveryMode;
  /** Inline delivery tag body (without brackets), e.g. "whispers". Empty = no tag. */
  deliveryTag: string;
  /**
   * Compatibility opt-in: apply the delivery tag even when the selected
   * profile's model is NOT Gemini-family. Off by default because non-Gemini
   * providers may read the bracket text aloud. Clearly labeled in settings.
   */
  deliveryAllProviders: boolean;
};

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  enabled: false,
  autoplay: false,
  volume: 0.8,
  muteNarrator: false,
  choirSound: false,
  narrator: null,
  characterDefault: null,
  characters: {},
  deliveryMode: "none",
  deliveryTag: "",
  deliveryAllProviders: false,
};

const MAX_CHARACTER_OVERRIDES = 200;

function normalizeVoiceRef(value: unknown): SpeechVoiceRef | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const connectionId = typeof raw.connectionId === "string" ? raw.connectionId.trim() : "";
  if (!connectionId) return null;
  // Voice ids are provider-defined and case-sensitive; preserve them verbatim
  // (including custom/free-text values absent from any current catalog).
  const voice = typeof raw.voice === "string" ? raw.voice : "";
  const ref: SpeechVoiceRef = { connectionId, voice };
  const parameters = raw.parameters;
  if (parameters !== null && typeof parameters === "object" && !Array.isArray(parameters)) {
    const speed = Number((parameters as Record<string, unknown>).speed);
    if (Number.isFinite(speed) && speed > 0) ref.parameters = { speed: Math.min(4, Math.max(0.25, speed)) };
  }
  return ref;
}

function normalizeCharacters(value: unknown): Record<string, SpeechVoiceRef> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, SpeechVoiceRef> = {};
  let count = 0;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_CHARACTER_OVERRIDES) break;
    const trimmed = key.trim();
    if (!trimmed) continue;
    const ref = normalizeVoiceRef(raw);
    if (!ref) continue;
    result[trimmed] = ref;
    count += 1;
  }
  return result;
}

export function normalizeSpeechSettings(value: unknown): SpeechSettings {
  const raw = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const volume = Number(raw.volume);
  return {
    enabled: raw.enabled === true,
    autoplay: raw.autoplay === true,
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_SPEECH_SETTINGS.volume,
    muteNarrator: raw.muteNarrator === true,
    choirSound: raw.choirSound === true,
    narrator: normalizeVoiceRef(raw.narrator),
    characterDefault: normalizeVoiceRef(raw.characterDefault),
    characters: normalizeCharacters(raw.characters),
    deliveryMode: (SPEECH_DELIVERY_MODES as readonly string[]).includes(raw.deliveryMode as string)
      ? raw.deliveryMode as SpeechDeliveryMode
      : "none",
    deliveryTag: typeof raw.deliveryTag === "string" ? raw.deliveryTag.trim() : "",
    deliveryAllProviders: raw.deliveryAllProviders === true,
  };
}
