/**
 * Stage feel CSS (docs/SPRITE_MODE.md, "Stage feel"). Interpolated into
 * VN_BASE_CSS, in both presentation modes.
 *
 * - Inner voices: `[data-vn-voice-glow]` (made by the stage on the first
 *   inner-voice line, right above the scene) lights the screen edges in the
 *   voice's colour (`--vn-voice-color`, voices.ts) while
 *   `data-vn-voice-on` is set, fading in and out over 300 ms
 *   (INNER_VOICE_FADE_MS).
 * - Selection: the stage is a picture with text on it. The scene (plate,
 *   sprites, ambient), the ornament and effect layers and the controls are
 *   never selectable or draggable, so a double-click or a long press never
 *   paints the browser's selection highlight over them; the dialogue,
 *   History and the reply box stay selectable as before.
 * - Click sparks (click-sparks.ts) carry their own inline styles.
 */
export const VN_FEEL_CSS = `
[data-vn-voice-glow] {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 0;
  box-shadow:
    inset 0 0 clamp(2.5rem, 11vmin, 8rem) clamp(0.25rem, 1.4vmin, 1.1rem) color-mix(in srgb, var(--vn-voice-color, transparent) 78%, transparent),
    inset 0 0 clamp(0.6rem, 2.4vmin, 1.6rem) 0 color-mix(in srgb, var(--vn-voice-color, transparent) 55%, transparent);
  background: radial-gradient(ellipse 75% 70% at 50% 45%, transparent 62%, color-mix(in srgb, var(--vn-voice-color, transparent) 16%, transparent) 100%);
  transition: opacity 300ms ease;
}

[data-vn-voice-glow][data-vn-voice-on] {
  opacity: 1;
}

[data-vn-scene],
[data-vn-scene] *,
[data-vn-ornaments],
[data-vn-fx],
[data-vn-flash],
[data-vn-voice-glow],
[data-vn-controls],
[data-vn-continue],
[data-vn-progress],
[data-vn-reading-state] {
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
  -webkit-touch-callout: none;
}
`;
