/**
 * Inner voices on the stage (voices.ts `innerVoiceFor`; config `innerVoices`
 * adds the reader's own names). A paragraph whose nameplate is an inner voice
 * has nobody on stage speaking: in sprite mode every character dims
 * (sprite-layer.ts `spriteDimmedKeys`), and in both modes the screen edges
 * glow in the voice's colour for the length of the paragraph
 * (`[data-vn-voice-glow]`, feel-css.ts).
 */
import { innerVoiceFor, type InnerVoice } from "./voices.js";

/** The glow fades in and out over this long (ms; feel-css.ts). */
export const INNER_VOICE_FADE_MS = 300;

/** The reader's extra inner-voice names: comma (or line, or 、) separated, trimmed, without duplicates. */
export function innerVoiceNames(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of text.split(/[,\n;、，]/u)) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name.slice(0, 80));
    if (names.length >= 64) break;
  }
  return names;
}

/** The inner voice speaking a paragraph, or null (an ordinary speaker, narration, the reader's own line). */
export function paragraphInnerVoice(speaker: string | null | undefined, extraNames: readonly string[], readerLine = false): InnerVoice | null {
  return readerLine ? null : innerVoiceFor(speaker, extraNames);
}

/**
 * Show (or fade out) the edge glow of an inner voice on `glow`. The colour
 * stays while it fades out, so it leaves in the colour it came in.
 */
export function applyInnerVoiceGlow(glow: HTMLElement, voice: InnerVoice | null): void {
  if (voice) {
    glow.style.setProperty("--vn-voice-color", voice.color);
    glow.dataset.vnVoiceFamily = voice.family;
    glow.dataset.vnVoiceOn = "true";
  } else {
    delete glow.dataset.vnVoiceOn;
  }
}
