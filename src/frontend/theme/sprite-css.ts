/**
 * Sprite mode stage CSS (docs/SPRITE_MODE.md, "Stage"). Interpolated into
 * VN_BASE_CSS. Every rule is scoped to `[data-vn-sprites]`, which only holds
 * children in sprite mode, so scene mode renders exactly as before.
 *
 * Geometry: each `[data-vn-sprite]` is a zero-size anchor at the bottom of the
 * stage, at `--vn-sprite-x`. Image layers are sized from the stage height
 * (`--vn-sprite-figure-h`, the opaque figure height) and capped by the slot
 * width (`--vn-sprite-slot-w`), using the cut-out bbox vars written by
 * sprite-layer.ts (`--vn-sprite-s` = 1/bbox h, `--vn-sprite-k` = 1/(bbox w *
 * aspect), `--vn-sprite-cx`/`--vn-sprite-by` = bbox bottom-centre). The bbox
 * bottom-centre sits on the anchor, so transparent margins never float a
 * character above the floor.
 *
 * Depth (sprite-depth.ts): a contact shadow and leg occlusion ground each
 * figure, a rim light coloured by the light preset sits on the edge that
 * faces the plate's light, weather and mood grades tint the characters, and
 * lightning turns them into rim-lit silhouettes. Parallax, the front ambient
 * layer and the plate drift live in effects-css.ts ("SPRITE MODE DEPTH").
 */
export const VN_SPRITE_CSS = `
[data-vn-sprites] {
  position: absolute;
  inset: 0;
  /* Above the readability scrim (3) so characters are not darkened; still
     inside the scene, so dialogue, ornaments and fx stay in front. */
  z-index: 4;
  overflow: hidden;
  pointer-events: none;
  container-type: size;
  --vn-sprite-figure-h: 88cqh;
  --vn-sprite-slot-w: 62cqw;
  /* Effect intensity scale for motion and emotes ("gentle" halves it). */
  --vn-sprite-fx: 1;
  --vn-sprite-move-ms: 620ms;
  /* Rim light: colour and strength per light preset; side from the plate
     (data-vn-light-side on the scene: left / right / top, default top). */
  --vn-sprite-rim: #fff6e6;
  --vn-sprite-rim-o: 0.2;
  --vn-sprite-rim-x: 0;
  --vn-sprite-rim-y: 1;
  /* Contact shadow strength. */
  --vn-sprite-ground-o: 0.42;
  transition: filter 600ms ease;
}

[data-vn-sprites]:empty {
  display: none;
}

[data-vn-sprites][data-vn-sprite-count="2"] {
  --vn-sprite-figure-h: 86cqh;
  --vn-sprite-slot-w: 44cqw;
}

[data-vn-sprites][data-vn-sprite-count="3"] {
  --vn-sprite-figure-h: 84cqh;
  --vn-sprite-slot-w: 32cqw;
}

/* Tall phone screens: slots are narrow, so let figures overlap a little more. */
@media (orientation: portrait) {
  [data-vn-sprites] { --vn-sprite-figure-h: 80cqh; --vn-sprite-slot-w: 100cqw; }
  [data-vn-sprites][data-vn-sprite-count="2"] { --vn-sprite-figure-h: 76cqh; --vn-sprite-slot-w: 72cqw; }
  [data-vn-sprites][data-vn-sprite-count="3"] { --vn-sprite-figure-h: 72cqh; --vn-sprite-slot-w: 58cqw; }
}

[data-vn-root][data-vn-effect-intensity="gentle"] [data-vn-sprites] {
  --vn-sprite-fx: 0.55;
}

[data-vn-sprite],
[data-vn-sprite-image] {
  --vn-sprite-img-h: min(
    calc(var(--vn-sprite-figure-h) * var(--vn-sprite-s, 1)),
    calc(var(--vn-sprite-slot-w) * var(--vn-sprite-k, 1.5))
  );
  --vn-sprite-img-w: calc(var(--vn-sprite-img-h) * var(--vn-sprite-a, 0.684));
  /* Opaque figure height (head to the bottom of the cut-out). */
  --vn-sprite-fig-h: calc(var(--vn-sprite-img-h) * var(--vn-sprite-bh, 1));
}

[data-vn-sprite] {
  position: absolute;
  /* The slot anchor, pulled in so the whole figure stays on stage. */
  --vn-sprite-half-w: calc(var(--vn-sprite-img-w) * var(--vn-sprite-bw, 1) / 2);
  left: clamp(var(--vn-sprite-half-w), var(--vn-sprite-x, 50%), calc(100% - var(--vn-sprite-half-w)));
  bottom: 0;
  width: 0;
  height: 0;
  z-index: 1;
  /* Motion amount: staging intensity (1..5 -> 0.33..1.67) x effect intensity. */
  --vn-sprite-m: calc(var(--vn-sprite-amp, 1) * var(--vn-sprite-fx, 1));
  --vn-sprite-dir: 0;
  transition:
    left var(--vn-sprite-move-ms) cubic-bezier(0.33, 1, 0.68, 1),
    filter 320ms ease,
    opacity 320ms ease;
}

[data-vn-sprite][data-vn-sprite-order="1"] { z-index: 2; }
[data-vn-sprite][data-vn-sprite-order="2"] { z-index: 1; }
/* The speaker stands in front and in full light; the others dim slightly. */
[data-vn-sprite][data-vn-sprite-focus="true"] { z-index: 4; }
[data-vn-sprite][data-vn-sprite-dim="true"] { filter: brightness(0.68) saturate(0.8); }
[data-vn-sprite][data-vn-sprite-facing="left"] { --vn-sprite-dir: -1; }
[data-vn-sprite][data-vn-sprite-facing="right"] { --vn-sprite-dir: 1; }

[data-vn-sprite][data-vn-sprite-state="waiting"] {
  opacity: 0;
}

[data-vn-sprite-body],
[data-vn-sprite-figure] {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 0;
  height: 0;
}

/* Mirror around the figure's bottom-centre (see SPRITE_NATURAL_FACING). */
[data-vn-sprite][data-vn-sprite-mirrored="true"] [data-vn-sprite-figure] {
  transform: scaleX(-1);
}

[data-vn-sprite-image] {
  position: absolute;
  left: calc(var(--vn-sprite-img-w) * var(--vn-sprite-cx, 0.5) * -1);
  bottom: calc(var(--vn-sprite-img-h) * (var(--vn-sprite-by, 1) - 1));
  width: var(--vn-sprite-img-w);
  height: var(--vn-sprite-img-h);
  isolation: isolate;
  opacity: 0;
  z-index: 0;
}

/* Expression crossfade: the new layer fades in on top, the old one leaves a
   moment later so the figure never turns see-through halfway. */
[data-vn-sprite-image][data-vn-sprite-layer="active"] {
  z-index: 1;
  opacity: 1;
  transition: opacity 260ms ease;
}

[data-vn-sprite-image][data-vn-sprite-layer="leaving"] {
  opacity: 0;
  transition: opacity 180ms ease 140ms;
}

[data-vn-sprite-image][data-vn-empty="true"] {
  opacity: 0;
  transition: none;
}

[data-vn-sprite-image] img {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
  -webkit-user-drag: none;
  filter: var(--vn-sprite-light-filter, none);
  transition: filter 600ms ease;
}

/* Coloured light: a tint masked by the cut-out itself, blended onto it. */
[data-vn-sprite-image]::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--vn-sprite-tint, transparent);
  mix-blend-mode: var(--vn-sprite-tint-blend, normal);
  opacity: var(--vn-sprite-tint-opacity, 0);
  -webkit-mask: var(--vn-sprite-mask, none) center / 100% 100% no-repeat;
  mask: var(--vn-sprite-mask, none) center / 100% 100% no-repeat;
  transition: opacity 600ms ease, background-color 600ms ease;
  pointer-events: none;
}

/* ---- Grounding ----------------------------------------------------------
   Sprites are usually cut at the thighs by the frame bottom, so no foot
   ellipse: a soft floor band behind the legs and a lighter occlusion band
   over them blend the figure into the plate's (scrim-darkened) floor. Both
   ride on the anchor, so slot moves carry them and hops leave them on the
   floor. */
[data-vn-sprite]::before,
[data-vn-sprite]::after {
  content: "";
  position: absolute;
  bottom: 0;
  pointer-events: none;
}
[data-vn-sprite]::before {
  --vn-sprite-ground-w: calc(var(--vn-sprite-half-w) * 3.4);
  left: calc(var(--vn-sprite-ground-w) / -2);
  width: var(--vn-sprite-ground-w);
  height: calc(var(--vn-sprite-fig-h) * 0.3);
  background: radial-gradient(ellipse 50% 100% at 50% 100%,
    rgba(5, 7, 13, var(--vn-sprite-ground-o)) 0%,
    rgba(5, 7, 13, calc(var(--vn-sprite-ground-o) * 0.5)) 42%,
    rgba(5, 7, 13, 0) 100%);
  z-index: -1;
}
[data-vn-sprite]::after {
  --vn-sprite-occl-w: calc(var(--vn-sprite-half-w) * 2.3);
  left: calc(var(--vn-sprite-occl-w) / -2);
  width: var(--vn-sprite-occl-w);
  height: calc(var(--vn-sprite-fig-h) * 0.2);
  background: linear-gradient(0deg, rgba(5, 7, 13, calc(var(--vn-sprite-ground-o) * 0.95)) 0%, rgba(5, 7, 13, calc(var(--vn-sprite-ground-o) * 0.35)) 45%, rgba(5, 7, 13, 0) 100%);
  -webkit-mask: radial-gradient(ellipse 50% 100% at 50% 100%, #000 55%, transparent 100%);
  mask: radial-gradient(ellipse 50% 100% at 50% 100%, #000 55%, transparent 100%);
  z-index: 1;
}

/* ---- Rim light ------------------------------------------------------------
   A thin sliver along the edge that faces the plate's light, coloured by the
   light preset: the cut-out minus the same cut-out shifted away from the
   light (two mask layers, subtract). Static, so it is painted once; mirrored
   figures flip the shift so the rim stays on the lit side. */
[data-vn-sprite][data-vn-sprite-mirrored="true"] { --vn-sprite-rim-flip: -1; }
[data-vn-scene][data-vn-light-side="left"] [data-vn-sprites] { --vn-sprite-rim-x: 1; --vn-sprite-rim-y: 0.45; }
[data-vn-scene][data-vn-light-side="right"] [data-vn-sprites] { --vn-sprite-rim-x: -1; --vn-sprite-rim-y: 0.45; }
[data-vn-scene][data-vn-light-side="top"] [data-vn-sprites] { --vn-sprite-rim-x: 0; --vn-sprite-rim-y: 1; }

[data-vn-sprite-image]::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 2;
  --vn-sprite-rim-w: calc(var(--vn-sprite-img-h) * 0.0055);
  --vn-sprite-rim-dx: calc(var(--vn-sprite-rim-w) * var(--vn-sprite-rim-x) * var(--vn-sprite-rim-flip, 1));
  --vn-sprite-rim-dy: calc(var(--vn-sprite-rim-w) * var(--vn-sprite-rim-y));
  background: var(--vn-sprite-rim);
  mix-blend-mode: screen;
  opacity: var(--vn-sprite-rim-o);
  -webkit-mask:
    var(--vn-sprite-mask, none) 0 0 / 100% 100% no-repeat,
    var(--vn-sprite-mask, none) var(--vn-sprite-rim-dx) var(--vn-sprite-rim-dy) / 100% 100% no-repeat;
  -webkit-mask-composite: source-out;
  mask:
    var(--vn-sprite-mask, none) 0 0 / 100% 100% no-repeat,
    var(--vn-sprite-mask, none) var(--vn-sprite-rim-dx) var(--vn-sprite-rim-dy) / 100% 100% no-repeat;
  mask-composite: subtract;
  transition: opacity 600ms ease;
  pointer-events: none;
}

/* ---- Light presets (SPRITE_LIGHTS) ------------------------------------- */
[data-vn-sprites][data-vn-sprite-light="day"] {
  --vn-sprite-light-filter: brightness(1.03) saturate(1.05);
  --vn-sprite-tint: #fff4d6;
  --vn-sprite-tint-blend: soft-light;
  --vn-sprite-tint-opacity: 0.25;
  --vn-sprite-rim: #fff1cf;
  --vn-sprite-rim-o: 0.34;
  --vn-sprite-ground-o: 0.46;
}
[data-vn-sprites][data-vn-sprite-light="sunset"] {
  --vn-sprite-light-filter: brightness(0.97) saturate(1.12) contrast(1.02);
  --vn-sprite-tint: #ff8a3d;
  --vn-sprite-tint-blend: soft-light;
  --vn-sprite-tint-opacity: 0.6;
  --vn-sprite-rim: #ff9a4d;
  --vn-sprite-rim-o: 0.62;
  --vn-sprite-ground-o: 0.4;
}
[data-vn-sprites][data-vn-sprite-light="night"] {
  --vn-sprite-light-filter: brightness(0.8) saturate(0.78) contrast(1.04);
  --vn-sprite-tint: #2f4fb8;
  --vn-sprite-tint-blend: multiply;
  --vn-sprite-tint-opacity: 0.5;
  --vn-sprite-rim: #9cbcff;
  --vn-sprite-rim-o: 0.5;
  --vn-sprite-ground-o: 0.34;
}
[data-vn-sprites][data-vn-sprite-light="indoor_warm"] {
  --vn-sprite-light-filter: brightness(0.98) saturate(1.04);
  --vn-sprite-tint: #ffb766;
  --vn-sprite-tint-blend: soft-light;
  --vn-sprite-tint-opacity: 0.38;
  --vn-sprite-rim: #ffc98a;
  --vn-sprite-rim-o: 0.36;
  --vn-sprite-ground-o: 0.42;
}
[data-vn-sprites][data-vn-sprite-light="indoor_cool"] {
  --vn-sprite-light-filter: brightness(0.98) saturate(0.9);
  --vn-sprite-tint: #a9c8ff;
  --vn-sprite-tint-blend: soft-light;
  --vn-sprite-tint-opacity: 0.42;
  --vn-sprite-rim: #d6e6ff;
  --vn-sprite-rim-o: 0.36;
  --vn-sprite-ground-o: 0.42;
}
[data-vn-sprites][data-vn-sprite-light="candle"] {
  --vn-sprite-light-filter: brightness(0.8) saturate(1.08) contrast(1.06);
  --vn-sprite-tint: #ff7a1f;
  --vn-sprite-tint-blend: multiply;
  --vn-sprite-tint-opacity: 0.32;
  --vn-sprite-rim: #ffa04a;
  --vn-sprite-rim-o: 0.56;
  --vn-sprite-ground-o: 0.4;
}
[data-vn-sprites][data-vn-sprite-light="dark"] {
  --vn-sprite-light-filter: brightness(0.5) saturate(0.55) contrast(1.1);
  --vn-sprite-tint: #1b2547;
  --vn-sprite-tint-blend: multiply;
  --vn-sprite-tint-opacity: 0.35;
  --vn-sprite-rim: #7f95d6;
  --vn-sprite-rim-o: 0.4;
  --vn-sprite-ground-o: 0.3;
}

/* Mood grades from the ambient overlay also grade the characters. The filter
   sits on each (static) image layer, not on the whole layer container, so
   breathing and talking never force the browser to re-filter every frame. */
[data-vn-sprite-image] { filter: var(--vn-sprite-air-filter, none); }
[data-vn-scene][data-vn-scene-ambient="sepia_flashback"] [data-vn-sprites] { --vn-sprite-air-filter: sepia(0.72) contrast(1.1) saturate(0.88); }
[data-vn-scene][data-vn-scene-ambient="desaturate"] [data-vn-sprites] { --vn-sprite-air-filter: grayscale(0.88) contrast(1.08) brightness(0.92); }
[data-vn-scene][data-vn-scene-ambient="vignette_dark"] [data-vn-sprites] { --vn-sprite-air-filter: contrast(1.06) brightness(0.94); }
[data-vn-scene][data-vn-scene-ambient="dream_haze"] [data-vn-sprites] { --vn-sprite-air-filter: brightness(1.06) contrast(0.92) saturate(1.1); }
[data-vn-scene][data-vn-scene-ambient="danger_pulse"] [data-vn-sprites] { --vn-sprite-air-filter: contrast(1.06) saturate(1.06) brightness(0.97); }
/* Weather grades the characters a little too, so they sit in the same air. */
[data-vn-scene][data-vn-scene-ambient="rain"] [data-vn-sprites] { --vn-sprite-air-filter: brightness(0.94) saturate(0.9); }
[data-vn-scene][data-vn-scene-ambient="heavy_rain"] [data-vn-sprites] { --vn-sprite-air-filter: brightness(0.86) saturate(0.82) contrast(1.03); }
[data-vn-scene][data-vn-scene-ambient="snow"] [data-vn-sprites] { --vn-sprite-air-filter: saturate(0.9) brightness(1.02); }
[data-vn-scene][data-vn-scene-ambient="fireflies"] [data-vn-sprites] { --vn-sprite-air-filter: brightness(0.9) saturate(0.95); }
[data-vn-scene][data-vn-scene-ambient="embers"] [data-vn-sprites] { --vn-sprite-air-filter: saturate(1.06) sepia(0.08); }
[data-vn-scene][data-vn-scene-ambient="fog"] [data-vn-sprites] { --vn-sprite-air-filter: contrast(0.9) saturate(0.86) brightness(1.02); }

/* ---- Emotes (SPRITE_EMOTES) -------------------------------------------- */
[data-vn-sprite-emote] {
  position: absolute;
  --vn-sprite-emote-size: clamp(26px, calc(var(--vn-sprite-fig-h) * 0.085), 76px);
  width: var(--vn-sprite-emote-size);
  height: var(--vn-sprite-emote-size);
  /* Beside the head, toward the stage centre. */
  left: calc(var(--vn-sprite-fig-h) * 0.075);
  bottom: calc(var(--vn-sprite-fig-h) * 0.9);
  z-index: 3;
  filter: drop-shadow(0 0 1.5px rgba(255, 255, 255, 0.95)) drop-shadow(0 2px 3px rgba(0, 0, 0, 0.35));
  transform-origin: 30% 90%;
}
[data-vn-sprite][data-vn-sprite-slot="right"] [data-vn-sprite-emote][data-vn-sprite-emote-place="side"] {
  left: calc(var(--vn-sprite-fig-h) * -0.075 - var(--vn-sprite-emote-size));
  transform-origin: 70% 90%;
}
[data-vn-sprite-emote][data-vn-sprite-emote-place="top"] {
  width: calc(var(--vn-sprite-emote-size) * 1.9);
  height: calc(var(--vn-sprite-emote-size) * 1.6);
  left: calc(var(--vn-sprite-emote-size) * -0.95);
  bottom: calc(var(--vn-sprite-fig-h) * 0.84);
  filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.6));
  transform-origin: 50% 0;
}
[data-vn-sprite-emote][data-vn-sprite-emote-place="face"] {
  width: calc(var(--vn-sprite-emote-size) * 1.15);
  height: calc(var(--vn-sprite-emote-size) * 1.15);
  left: calc(var(--vn-sprite-emote-size) * -0.575);
  /* Estimated cheek line: the head is not detected, so this is approximate. */
  bottom: calc(var(--vn-sprite-fig-h) * 0.715);
  filter: none;
  opacity: 0.85;
  transform-origin: 50% 50%;
}
[data-vn-sprite-emote] svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* ---- Enter / exit ------------------------------------------------------- */
[data-vn-sprite][data-vn-sprite-state="exiting"] {
  opacity: 0;
  transition: opacity 400ms ease, filter 320ms ease;
}

@media (prefers-reduced-motion: no-preference) {
  [data-vn-sprite][data-vn-sprite-state="entering"] {
    animation: vn-sprite-enter 460ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  [data-vn-sprite][data-vn-sprite-state="exiting"] {
    animation: vn-sprite-exit 420ms ease-in both;
  }

  /* Idle breathing: a slow rise of the chest line, around the feet. */
  [data-vn-sprite][data-vn-sprite-state="shown"] [data-vn-sprite-figure],
  [data-vn-sprite][data-vn-sprite-state="entering"] [data-vn-sprite-figure] {
    animation: vn-sprite-breathe 4.6s ease-in-out infinite;
  }
  [data-vn-sprite][data-vn-sprite-order="1"] [data-vn-sprite-figure] { animation-delay: -1.5s; }
  [data-vn-sprite][data-vn-sprite-order="2"] [data-vn-sprite-figure] { animation-delay: -3.1s; }

  /* Talking bob while the speaker's line types out. */
  [data-vn-sprite][data-vn-sprite-talking="true"] [data-vn-sprite-body] {
    animation: vn-sprite-talk 300ms ease-in-out infinite alternate;
  }

  /* One-shot motions (SPRITE_MOTIONS), scaled by --vn-sprite-m. */
  [data-vn-sprite-body][data-vn-sprite-motion="hop"] { animation: vn-sprite-hop 560ms cubic-bezier(0.3, 0.7, 0.4, 1) both; }
  [data-vn-sprite-body][data-vn-sprite-motion="bounce"] { animation: vn-sprite-bounce 820ms ease-out both; }
  [data-vn-sprite-body][data-vn-sprite-motion="shake"] { animation: vn-sprite-shake 520ms linear both; }
  [data-vn-sprite-body][data-vn-sprite-motion="tremble"] { animation: vn-sprite-tremble 1100ms linear both; }
  [data-vn-sprite-body][data-vn-sprite-motion="step_back"] { animation: vn-sprite-step-back 760ms cubic-bezier(0.25, 1, 0.5, 1) both; }
  [data-vn-sprite-body][data-vn-sprite-motion="lean_in"] { animation: vn-sprite-lean-in 820ms ease-in-out both; }
  [data-vn-sprite-body][data-vn-sprite-motion="nod"] { animation: vn-sprite-nod 720ms ease-in-out both; }
  [data-vn-sprite-body][data-vn-sprite-motion="turn_away"] { animation: vn-sprite-turn-away 900ms ease-in-out both; }
  [data-vn-sprite-body][data-vn-sprite-motion="sink"] { animation: vn-sprite-sink 1100ms cubic-bezier(0.4, 0, 0.2, 1) both; }

  /* Emote pop-in, then a small loop per mark. */
  [data-vn-sprite-emote][data-vn-sprite-emote-pop="true"] {
    animation: vn-sprite-emote-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  [data-vn-sprite-emote][data-vn-sprite-emote-name="sweat"] svg { animation: vn-sprite-emote-drip 1.8s ease-in-out infinite; }
  [data-vn-sprite-emote][data-vn-sprite-emote-name="anger"] svg { animation: vn-sprite-emote-throb 0.9s ease-in-out infinite; }
  [data-vn-sprite-emote][data-vn-sprite-emote-name="heart"] svg { animation: vn-sprite-emote-beat 1.1s ease-in-out infinite; }
  [data-vn-sprite-emote][data-vn-sprite-emote-name="sparkle"] svg { animation: vn-sprite-emote-twinkle 1.4s ease-in-out infinite; }
  [data-vn-sprite-emote][data-vn-sprite-emote-name="exclaim"] svg { animation: vn-sprite-emote-jolt 1.6s ease-out infinite; }
  [data-vn-sprite-emote][data-vn-sprite-emote-name="question"] svg { animation: vn-sprite-emote-sway 2s ease-in-out infinite; transform-origin: 50% 90%; }
  [data-vn-sprite-emote][data-vn-sprite-emote-name="music"] svg { animation: vn-sprite-emote-bob 1.2s ease-in-out infinite; }
  [data-vn-sprite-emote][data-vn-sprite-emote-name="gloom"] svg { animation: vn-sprite-emote-gloom 2.6s ease-in-out infinite; }
  [data-vn-sprite-emote][data-vn-sprite-emote-name="ellipsis"] circle { animation: vn-sprite-emote-dots 1.5s ease-in-out infinite; }
  [data-vn-sprite-emote][data-vn-sprite-emote-name="ellipsis"] circle:nth-child(2) { animation-delay: 0.2s; }
  [data-vn-sprite-emote][data-vn-sprite-emote-name="ellipsis"] circle:nth-child(3) { animation-delay: 0.4s; }

  /* Lightning (data-vn-lightning on the scene, sprite mode): the plate
     flashes behind the characters, so they drop to silhouettes with a cold
     rim on the side of the bolt (upper right). */
  [data-vn-scene][data-vn-lightning] [data-vn-sprite-image] img {
    animation: vn-sprite-lightning-shade 550ms linear both;
  }
  [data-vn-scene][data-vn-lightning] [data-vn-sprite-image]::before {
    --vn-sprite-rim: #eef4ff;
    --vn-sprite-rim-x: -1.8;
    --vn-sprite-rim-y: 1.1;
    animation: vn-sprite-lightning-rim 550ms linear both;
  }

  /* "Off": no motion or emote animation; positions still change. */
  [data-vn-root][data-vn-effect-intensity="off"] [data-vn-sprite] [data-vn-sprite-body],
  [data-vn-root][data-vn-effect-intensity="off"] [data-vn-sprite] [data-vn-sprite-figure],
  [data-vn-root][data-vn-effect-intensity="off"] [data-vn-sprite-emote],
  [data-vn-root][data-vn-effect-intensity="off"] [data-vn-sprite-emote] svg,
  [data-vn-root][data-vn-effect-intensity="off"] [data-vn-sprite-emote] circle {
    animation: none !important;
  }
}

/* Reduced motion: characters change places and expressions by fading only. */
@media (prefers-reduced-motion: reduce) {
  [data-vn-sprite] {
    transition: filter 200ms ease, opacity 200ms ease;
  }
  [data-vn-sprite] *,
  [data-vn-sprite-emote] {
    animation: none !important;
  }
}

@keyframes vn-sprite-enter {
  from { opacity: 0; translate: 0 calc(var(--vn-sprite-img-h) * 0.035); }
  to { opacity: 1; translate: 0 0; }
}
@keyframes vn-sprite-exit {
  from { opacity: 1; translate: 0 0; }
  to { opacity: 0; translate: 0 calc(var(--vn-sprite-img-h) * 0.03); }
}
@keyframes vn-sprite-breathe {
  0%, 100% { scale: 1 1; }
  50% { scale: 1.004 1.009; }
}
@keyframes vn-sprite-talk {
  from { translate: 0 0; }
  to { translate: 0 calc(var(--vn-sprite-img-h) * -0.0055 * var(--vn-sprite-fx, 1)); }
}
@keyframes vn-sprite-hop {
  0% { transform: none; }
  38% { transform: translateY(calc(var(--vn-sprite-img-h) * -0.05 * var(--vn-sprite-m))); }
  66% { transform: translateY(0) scale(1.01, 0.985); }
  82% { transform: translateY(calc(var(--vn-sprite-img-h) * -0.008 * var(--vn-sprite-m))); }
  100% { transform: none; }
}
@keyframes vn-sprite-bounce {
  0% { transform: none; }
  22% { transform: translateY(calc(var(--vn-sprite-img-h) * -0.032 * var(--vn-sprite-m))); }
  44% { transform: translateY(0) scale(1.008, 0.99); }
  64% { transform: translateY(calc(var(--vn-sprite-img-h) * -0.018 * var(--vn-sprite-m))); }
  82% { transform: translateY(0); }
  100% { transform: none; }
}
@keyframes vn-sprite-shake {
  0%, 100% { transform: none; }
  15% { transform: translateX(calc(var(--vn-sprite-img-h) * -0.014 * var(--vn-sprite-m))); }
  32% { transform: translateX(calc(var(--vn-sprite-img-h) * 0.013 * var(--vn-sprite-m))); }
  49% { transform: translateX(calc(var(--vn-sprite-img-h) * -0.01 * var(--vn-sprite-m))); }
  66% { transform: translateX(calc(var(--vn-sprite-img-h) * 0.008 * var(--vn-sprite-m))); }
  83% { transform: translateX(calc(var(--vn-sprite-img-h) * -0.004 * var(--vn-sprite-m))); }
}
@keyframes vn-sprite-tremble {
  0%, 100% { transform: none; }
  10%, 30%, 50%, 70%, 90% { transform: translateX(calc(var(--vn-sprite-img-h) * -0.0035 * var(--vn-sprite-m))); }
  20%, 40%, 60%, 80% { transform: translateX(calc(var(--vn-sprite-img-h) * 0.0035 * var(--vn-sprite-m))); }
}
@keyframes vn-sprite-step-back {
  0% { transform: none; }
  35% { transform: translateY(calc(var(--vn-sprite-img-h) * 0.012 * var(--vn-sprite-m))) scale(calc(1 - 0.045 * var(--vn-sprite-m))); }
  70% { transform: translateY(calc(var(--vn-sprite-img-h) * 0.01 * var(--vn-sprite-m))) scale(calc(1 - 0.04 * var(--vn-sprite-m))); }
  100% { transform: none; }
}
@keyframes vn-sprite-lean-in {
  0%, 100% { transform: none; }
  40%, 65% {
    transform:
      translateX(calc(var(--vn-sprite-img-h) * 0.012 * var(--vn-sprite-m) * var(--vn-sprite-dir)))
      scale(calc(1 + 0.04 * var(--vn-sprite-m)))
      rotate(calc(1.4deg * var(--vn-sprite-m) * var(--vn-sprite-dir)));
  }
}
@keyframes vn-sprite-nod {
  0%, 100% { transform: none; }
  25% { transform: translateY(calc(var(--vn-sprite-img-h) * 0.012 * var(--vn-sprite-m))) scaleY(0.994); }
  50% { transform: none; }
  72% { transform: translateY(calc(var(--vn-sprite-img-h) * 0.009 * var(--vn-sprite-m))) scaleY(0.996); }
}
@keyframes vn-sprite-turn-away {
  0%, 100% { transform: none; }
  35%, 70% {
    transform:
      perspective(900px)
      rotateY(calc(26deg * var(--vn-sprite-m) * (var(--vn-sprite-dir) * -1 + (1 - var(--vn-sprite-dir) * var(--vn-sprite-dir)))))
      translateX(calc(var(--vn-sprite-img-h) * -0.01 * var(--vn-sprite-m)));
  }
}
@keyframes vn-sprite-sink {
  0% { transform: none; }
  45%, 75% { transform: translateY(calc(var(--vn-sprite-img-h) * 0.035 * var(--vn-sprite-m))) scale(calc(1 - 0.02 * var(--vn-sprite-m))); }
  100% { transform: none; }
}
@keyframes vn-sprite-emote-pop {
  0% { opacity: 0; scale: 0.2; }
  60% { opacity: 1; scale: calc(1 + 0.18 * var(--vn-sprite-fx, 1)); }
  100% { opacity: 1; scale: 1; }
}
@keyframes vn-sprite-emote-drip {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(calc(10% * var(--vn-sprite-fx, 1))); }
}
@keyframes vn-sprite-emote-throb {
  0%, 100% { transform: scale(1); }
  45% { transform: scale(calc(1 + 0.14 * var(--vn-sprite-fx, 1))); }
}
@keyframes vn-sprite-emote-beat {
  0%, 60%, 100% { transform: scale(1); }
  15% { transform: scale(calc(1 + 0.16 * var(--vn-sprite-fx, 1))); }
  30% { transform: scale(0.98); }
  42% { transform: scale(calc(1 + 0.1 * var(--vn-sprite-fx, 1))); }
}
@keyframes vn-sprite-emote-twinkle {
  0%, 100% { transform: rotate(0deg) scale(1); opacity: 1; }
  50% { transform: rotate(calc(18deg * var(--vn-sprite-fx, 1))) scale(0.86); opacity: 0.75; }
}
@keyframes vn-sprite-emote-jolt {
  0%, 30%, 100% { transform: translateY(0); }
  10% { transform: translateY(calc(-12% * var(--vn-sprite-fx, 1))); }
}
@keyframes vn-sprite-emote-sway {
  0%, 100% { transform: rotate(calc(-8deg * var(--vn-sprite-fx, 1))); }
  50% { transform: rotate(calc(8deg * var(--vn-sprite-fx, 1))); }
}
@keyframes vn-sprite-emote-bob {
  0%, 100% { transform: translate(0, 0) rotate(-4deg); }
  50% { transform: translate(calc(6% * var(--vn-sprite-fx, 1)), calc(-10% * var(--vn-sprite-fx, 1))) rotate(5deg); }
}
@keyframes vn-sprite-emote-gloom {
  0%, 100% { opacity: 0.75; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(calc(5% * var(--vn-sprite-fx, 1))); }
}
@keyframes vn-sprite-lightning-shade {
  0%, 17%, 100% { filter: var(--vn-sprite-light-filter, brightness(1)) brightness(1) saturate(1); }
  3% { filter: var(--vn-sprite-light-filter, brightness(1)) brightness(0.3) saturate(0.5); }
  9% { filter: var(--vn-sprite-light-filter, brightness(1)) brightness(0.82) saturate(0.85); }
  21% { filter: var(--vn-sprite-light-filter, brightness(1)) brightness(0.36) saturate(0.55); }
  30% { filter: var(--vn-sprite-light-filter, brightness(1)) brightness(0.72) saturate(0.8); }
  52% { filter: var(--vn-sprite-light-filter, brightness(1)) brightness(0.94) saturate(0.95); }
}
@keyframes vn-sprite-lightning-rim {
  0%, 100% { opacity: var(--vn-sprite-rim-o); }
  3% { opacity: 1; }
  9% { opacity: 0.3; }
  17% { opacity: 0.1; }
  21% { opacity: 0.95; }
  30% { opacity: 0.4; }
  52% { opacity: 0.15; }
}
@keyframes vn-sprite-emote-dots {
  0%, 60%, 100% { opacity: 1; }
  30% { opacity: 0.25; }
}
`;
