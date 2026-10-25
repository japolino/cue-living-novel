/**
 * Styles of the scene chrome (stage/scene-card.ts: the opening card and the
 * location label), the waiting screen (stage/waiting-screen.ts) and the
 * collapsible reply box. Part of the base layer, so presets and custom CSS
 * can restyle any of it.
 */
export const VN_WAITING_CSS = `
[data-vn-root] {
  --vn-scene-gold: #e2b866;
  --vn-scene-serif: "Iowan Old Style", "Palatino Linotype", Georgia, "Noto Serif KR", "Noto Serif JP", serif;
  --vn-scene-left: max(2rem, calc(env(safe-area-inset-left) + 1rem));
  --vn-scene-right: max(2rem, calc(env(safe-area-inset-right) + 1rem));
  --vn-scene-top: max(3.8rem, calc(env(safe-area-inset-top) + 3.4rem));
  --vn-scene-bottom: max(2.4rem, calc(env(safe-area-inset-bottom) + 1.4rem));
}

/* Scene words shared by the opening card and the waiting screen. */
[data-vn-scene-kicker] {
  margin: 0 0 0.5rem;
  color: var(--vn-scene-gold);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.32em;
  text-transform: uppercase;
}

[data-vn-scene-title] {
  margin: 0;
  color: #fff;
  font-family: var(--vn-scene-serif);
  font-size: clamp(1.7rem, 2.6 * var(--vn-vw, 1vw) + 0.9rem, 3.1rem);
  font-weight: 600;
  line-height: 1.12;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.6);
  overflow-wrap: anywhere;
}

[data-vn-scene-meta] {
  margin: 0.55rem 0 0;
  color: rgba(255, 255, 255, 0.74);
  font-size: 0.95rem;
  letter-spacing: 0.02em;
}

/* ---------------------------------------------------------------- *
 * Opening card
 * ---------------------------------------------------------------- */
[data-vn-opening] {
  position: absolute;
  inset: 0;
  z-index: 12;
  overflow: hidden;
  background: rgba(6, 7, 12, 0.74);
  cursor: pointer;
  animation: vn-scene-fade-in 300ms ease-out both;
  user-select: none;
}

[data-vn-opening][data-vn-opening-picture] {
  background: #07080d;
}

[data-vn-opening-bg] {
  position: absolute;
  inset: -2%;
  background-position: center;
  background-size: cover;
  filter: blur(2px) brightness(0.55) saturate(0.92);
}

[data-vn-opening]::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(20deg, rgba(4, 5, 9, 0.82) 0%, rgba(4, 5, 9, 0.35) 45%, rgba(4, 5, 9, 0) 70%);
  pointer-events: none;
}

[data-vn-opening-card] {
  position: absolute;
  z-index: 1;
  left: var(--vn-scene-left);
  bottom: calc(var(--vn-scene-bottom) + 1.2rem);
  width: min(40rem, calc(100% - 4rem));
  animation: vn-scene-rise 420ms 180ms ease-out both;
}

[data-vn-scene-rule] {
  display: block;
  width: min(22rem, 70%);
  height: 1px;
  margin: 0.95rem 0 0.7rem;
  background: linear-gradient(90deg, var(--vn-scene-gold), rgba(226, 184, 102, 0));
  transform-origin: left center;
  animation: vn-scene-rule 640ms 360ms ease-out both;
}

[data-vn-opening-status] {
  margin: 0;
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.8rem;
  letter-spacing: 0.05em;
}

[data-vn-opening][data-vn-opening-ready="true"] [data-vn-opening-status] {
  color: rgba(255, 255, 255, 0.86);
}

[data-vn-opening-hint] {
  position: absolute;
  z-index: 1;
  right: var(--vn-scene-right);
  bottom: var(--vn-scene-bottom);
  margin: 0;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.75rem;
  letter-spacing: 0.03em;
}

[data-vn-opening][data-vn-opening-closing] {
  animation: vn-scene-fade-out 320ms ease-in both;
  pointer-events: none;
}

/* ---------------------------------------------------------------- *
 * Location label
 * ---------------------------------------------------------------- */
[data-vn-root] {
  /* The location label's height; the status badges start below it. */
  --vn-location-h: 3.9rem;
}

[data-vn-location] {
  position: absolute;
  z-index: 3;
  /* Below the Panels launcher at the top-left corner, where the status badges start. */
  top: calc(max(0.85rem, env(safe-area-inset-top)) + 3.6rem);
  left: max(0.85rem, env(safe-area-inset-left));
  display: grid;
  align-content: center;
  box-sizing: border-box;
  height: var(--vn-location-h);
  max-width: min(24rem, calc(100 * var(--vn-vw, 1vw) - 2rem));
  padding: 0.3rem 1.2rem 0.35rem 0.7rem;
  border-left: 2px solid var(--vn-scene-gold);
  background: linear-gradient(90deg, rgba(8, 9, 15, 0.66), rgba(8, 9, 15, 0));
  pointer-events: none;
  animation: vn-scene-fade-in 320ms ease-out both;
}

/* The status badges move down while the label shows. */
[data-vn-root]:has([data-vn-location]:not([hidden])) [data-vn-status-stack] {
  --vn-status-top-clearance: calc(3.6rem + var(--vn-location-h) + 0.45rem);
}

/*
 * NVL's page reaches up to 7rem from the top: while the label shows, the page
 * starts just below it instead (its top is 100dvh - height - 1.5rem).
 */
[data-vn-root][data-vn-preset="nvl"]:has([data-vn-location]:not([hidden])) [data-vn-dialogue][data-vn-nvl-paged] {
  --vn-dialogue-text-max: calc(100 * var(--vn-dvh, 1dvh) - 16.85rem - var(--vn-location-h));
  height: calc(100 * var(--vn-dvh, 1dvh) - 6.35rem - var(--vn-location-h));
}

[data-vn-location-kicker] {
  color: var(--vn-scene-gold);
  font-size: 0.6rem;
  line-height: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.28em;
  text-transform: uppercase;
}

[data-vn-location-place] {
  overflow: hidden;
  color: #fff;
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.25rem;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}

[data-vn-location-meta] {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.72rem;
  line-height: 1rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------------------------------------------------------- *
 * Waiting screen
 * ---------------------------------------------------------------- */
[data-vn-waiting] {
  position: absolute;
  inset: 0;
  z-index: 11;
  overflow: hidden;
  background: #07080d;
  color: #fff;
  cursor: default;
  user-select: none;
  animation: vn-scene-fade-in 360ms ease-out both;
}

[data-vn-waiting][data-vn-waiting-closing] {
  animation: vn-scene-fade-out 320ms ease-in both;
  pointer-events: none;
}

[data-vn-waiting-bg] {
  position: absolute;
  inset: -3%;
  background-position: center;
  background-size: cover;
  filter: blur(5px) brightness(0.42) saturate(0.85);
}

[data-vn-waiting-veil] {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(20deg, rgba(4, 5, 9, 0.85) 0%, rgba(4, 5, 9, 0.3) 48%, rgba(4, 5, 9, 0.1) 100%);
}

[data-vn-waiting-stage] {
  position: absolute;
  inset: 0;
}

[data-vn-waiting-info] {
  position: absolute;
  z-index: 2;
  left: var(--vn-scene-left);
  bottom: var(--vn-scene-bottom);
  width: min(26rem, calc(100% - 4rem));
}

[data-vn-waiting-info] [data-vn-scene-title] {
  font-size: clamp(1.5rem, 1.8 * var(--vn-vw, 1vw) + 0.9rem, 2.4rem);
}

[data-vn-waiting-progress] {
  position: relative;
  width: min(18rem, 80%);
  height: 2px;
  margin: 0.95rem 0 0.55rem;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.14);
}

[data-vn-waiting-progress] > span,
[data-vn-cast-bar] > span {
  position: absolute;
  inset: 0 auto 0 0;
  width: 38%;
  background: linear-gradient(90deg, rgba(226, 184, 102, 0), var(--vn-scene-gold), rgba(226, 184, 102, 0));
  animation: vn-waiting-progress 1.7s ease-in-out infinite;
}

[data-vn-waiting-status] {
  margin: 0;
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.86rem;
  letter-spacing: 0.02em;
}

[data-vn-waiting-sent] {
  margin-top: 0.85rem;
  padding: 0.55rem 0.8rem 0.6rem;
  border-left: 3px solid #6aa8f0;
  border-radius: 0 0.4rem 0.4rem 0;
  background: rgba(10, 14, 24, 0.74);
}

[data-vn-waiting-sent-label] {
  display: block;
  color: #9cc3f5;
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

[data-vn-waiting-sent-text] {
  display: -webkit-box;
  margin: 0.2rem 0 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.9rem;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}

[data-vn-waiting-preview-note] {
  position: absolute;
  z-index: 3;
  top: max(0.9rem, env(safe-area-inset-top));
  left: 50%;
  margin: 0;
  padding: 0.35rem 0.9rem;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 999px;
  background: rgba(8, 9, 15, 0.8);
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.78rem;
  transform: translateX(-50%);
  white-space: nowrap;
}

/* Avatars: a round face (or an initial) in the speaker's colour. */
[data-vn-avatar] {
  display: inline-block;
  flex: none;
  width: var(--vn-avatar-size, 40px);
  height: var(--vn-avatar-size, 40px);
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.08);
  background-repeat: no-repeat;
  box-shadow: 0 0 0 2px var(--vn-figure-color, var(--vn-scene-gold));
}

[data-vn-avatar-initial] {
  display: inline-grid;
  place-items: center;
  background: rgba(8, 9, 15, 0.72);
  color: var(--vn-figure-color, var(--vn-scene-gold));
  font-size: calc(var(--vn-avatar-size, 40px) * 0.4);
  font-weight: 700;
  line-height: 1;
}

/* Line-up: everyone side by side, bright, a bubble over each head. */
[data-vn-lineup] {
  position: absolute;
  top: 12%;
  right: var(--vn-scene-right);
  bottom: 0;
  left: calc(min(26rem, 38%) + 3rem);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  --vn-lineup-gap: clamp(0.5rem, 2.2 * var(--vn-vw, 1vw), 2.5rem);
  gap: var(--vn-lineup-gap);
  /* The figures size themselves from this box (container units). */
  container-type: size;
}

/*
 * Each figure gets an equal slot of the line-up's width and as much height as
 * leaves room for its bubble: the tallest figure that fits both. A cut-out
 * wider than a slot allows (arms out) keeps the slot and overlaps a little.
 */
[data-vn-waiting-figure] {
  --vn-figure-slot-ratio: 0.6;
  --vn-figure-slot: calc((100cqw - (var(--vn-lineup-count, 1) - 1) * var(--vn-lineup-gap)) / var(--vn-lineup-count, 1));
  --vn-figure-h: min(100cqh - var(--vn-bubble-room, 7rem), var(--vn-figure-max, 38rem), var(--vn-figure-slot) / var(--vn-figure-slot-ratio));
}

[data-vn-waiting-figure] {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  -webkit-tap-highlight-color: transparent;
  animation: vn-figure-in 460ms calc(var(--vn-figure-order, 0) * 90ms + 120ms) ease-out both;
}

[data-vn-waiting-figure]:focus-visible {
  outline: none;
}

[data-vn-waiting-figure]:focus-visible [data-vn-name-tag] {
  outline: 2px solid var(--vn-scene-gold);
  outline-offset: 2px;
}

[data-vn-figure-body] {
  position: relative;
  width: calc(var(--vn-figure-h) * min(var(--vn-fig-ratio, 0.42), var(--vn-figure-slot-ratio)));
  height: var(--vn-figure-h);
  transform-origin: 50% 100%;
  transition: width 260ms ease;
}

[data-vn-figure-body][data-vn-figure-plain] {
  display: grid;
  width: auto;
  height: auto;
  margin-bottom: 3.2rem;
  place-items: center;
}

[data-vn-figure-img] {
  position: absolute;
  top: calc(var(--vn-figure-h) * var(--vn-img-top, 0));
  /* Centred on its slot when the cut-out is wider than the slot. */
  left: calc(var(--vn-figure-h) * (var(--vn-img-left, 0) - max(var(--vn-fig-ratio, 0.42) - var(--vn-figure-slot-ratio), 0) / 2));
  width: auto;
  max-width: none;
  height: calc(var(--vn-figure-h) * var(--vn-img-h, 1));
  opacity: 0;
  filter: drop-shadow(0 0 1.2px #fff) drop-shadow(0 0 1.2px #fff) drop-shadow(0 10px 18px rgba(0, 0, 0, 0.45));
  pointer-events: none;
  transition: opacity 220ms ease;
  -webkit-user-drag: none;
}

[data-vn-figure-img][data-vn-front] {
  opacity: 1;
}

[data-vn-waiting-figure][data-vn-figure-bounce] [data-vn-figure-body] {
  animation: vn-figure-bounce 420ms cubic-bezier(0.3, 1.6, 0.5, 1);
}

[data-vn-name-tag] {
  position: absolute;
  bottom: 1.1rem;
  left: 50%;
  padding: 0.22rem 0.7rem 0.26rem;
  border: 1.5px solid var(--vn-figure-color, var(--vn-scene-gold));
  border-radius: 0.3rem;
  background: rgba(8, 9, 15, 0.84);
  color: #fff;
  font-size: 0.82rem;
  font-weight: 600;
  transform: translateX(-50%);
  white-space: nowrap;
}

[data-vn-bubble] {
  position: absolute;
  z-index: 1;
  bottom: calc(100% + 0.9rem);
  left: 50%;
  /* Its slot and most of the gap: neighbouring bubbles never overlap. */
  width: min(var(--vn-bubble-max, 17rem), max(var(--vn-figure-slot) + 0.6 * var(--vn-lineup-gap), 7rem));
  padding: 0.55rem 0.8rem 0.65rem;
  border-radius: 1rem;
  background: #fbf3df;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
  color: #2a2218;
  text-align: left;
  transform: translateX(-50%);
  transition: opacity 200ms ease, transform 200ms ease;
}

[data-vn-bubble]::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 50%;
  border: 0.55rem solid transparent;
  border-top-color: #fbf3df;
  transform: translateX(-50%);
}

[data-vn-bubble][data-vn-bubble-state="in"] {
  animation: vn-bubble-pop 300ms cubic-bezier(0.2, 1.4, 0.4, 1) both;
}

[data-vn-bubble][data-vn-bubble-state="out"] {
  opacity: 0;
  transform: translateX(-50%) translateY(4px) scale(0.95);
}

[data-vn-bubble-chip] {
  display: inline-block;
  margin-bottom: 0.3rem;
  padding: 0.08rem 0.5rem 0.12rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vn-figure-color, var(--vn-scene-gold)) 26%, #fff);
  color: #3b2f1e;
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}

[data-vn-bubble-text] {
  display: -webkit-box;
  overflow: hidden;
  font-size: 0.88rem;
  line-height: 1.42;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}

/* Flashback cards: one character at a time, their last line. */
[data-vn-recap-cards] {
  position: absolute;
  inset: 0;
  cursor: pointer;
}

[data-vn-card-figure] {
  position: absolute;
  right: 4%;
  bottom: 0;
  width: 46%;
  height: 88%;
  margin: 0;
}

[data-vn-card-img] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom right;
  opacity: 0;
  filter: drop-shadow(0 0 1.2px #fff) drop-shadow(0 0 1.2px #fff) drop-shadow(0 12px 24px rgba(0, 0, 0, 0.5));
  transition: opacity 520ms ease;
  -webkit-user-drag: none;
}

[data-vn-card-img][data-vn-front] {
  opacity: 1;
}

/* A voice in the head has no picture: a warm lamp glow instead. */
[data-vn-card-figure][data-vn-card-empty="true"]::after {
  content: "";
  position: absolute;
  right: 10%;
  bottom: -20%;
  width: 70%;
  height: 50%;
  background: radial-gradient(closest-side, rgba(255, 186, 92, 0.42), rgba(255, 186, 92, 0));
}

[data-vn-recap-card] {
  position: absolute;
  z-index: 2;
  top: var(--vn-scene-top);
  left: var(--vn-scene-left);
  width: min(27rem, calc(100% - 4rem));
  padding: 1rem 1.15rem 1.05rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-top: 2px solid var(--vn-figure-color, var(--vn-scene-gold));
  border-radius: 0.5rem;
  background: rgba(9, 10, 16, 0.84);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.4);
}

[data-vn-recap-card][data-vn-card-enter] {
  animation: vn-scene-rise 380ms ease-out both;
}

[data-vn-recap-kicker] {
  margin: 0;
  color: var(--vn-scene-gold);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.26em;
  text-transform: uppercase;
}

[data-vn-recap-name] {
  margin: 0.3rem 0 0.35rem;
  color: var(--vn-figure-color, #fff);
  font-family: var(--vn-scene-serif);
  font-size: 1.3rem;
  font-weight: 600;
}

[data-vn-recap-chip],
[data-vn-film-chip] {
  display: inline-block;
  align-self: flex-start;
  padding: 0.06rem 0.5rem 0.1rem;
  border: 1px solid var(--vn-figure-color, var(--vn-scene-gold));
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.82);
  font-size: 0.66rem;
  letter-spacing: 0.04em;
}

[data-vn-recap-line] {
  display: -webkit-box;
  margin: 0.55rem 0 0.7rem;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.92);
  font-size: 1rem;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
  line-clamp: 6;
}

[data-vn-recap-card][data-vn-recap-kind="voice"] [data-vn-recap-line] {
  font-style: italic;
}

[data-vn-recap-dots] {
  display: flex;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

[data-vn-recap-dots] > li {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.26);
}

[data-vn-recap-dots] > li[data-vn-active] {
  background: var(--vn-scene-gold);
}

/* Scene film: the reply as cards on a film strip, scrolling by. */
[data-vn-film] {
  position: absolute;
  top: var(--vn-scene-top);
  right: 0;
  left: 0;
  height: 11.5rem;
  overflow: hidden;
  background: #0c0d12;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  mask-image: linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent);
}

[data-vn-film]::before,
[data-vn-film]::after {
  content: "";
  position: absolute;
  z-index: 1;
  right: 0;
  left: 0;
  height: 0.95rem;
  background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.22) 0 0.55rem, transparent 0.55rem 1.3rem) center / auto 0.42rem no-repeat, #050508;
  pointer-events: none;
}

[data-vn-film]::before { top: 0; }
[data-vn-film]::after { bottom: 0; }

[data-vn-film-track] {
  position: absolute;
  top: 1.25rem;
  bottom: 1.25rem;
  left: 0;
  display: flex;
  gap: 0.7rem;
  width: max-content;
  padding-left: 0.7rem;
  animation: vn-film-scroll var(--vn-film-duration, 40s) linear infinite;
}

[data-vn-film-copy] {
  display: contents;
}

[data-vn-film]:hover [data-vn-film-track],
[data-vn-film]:focus-within [data-vn-film-track] {
  animation-play-state: paused;
}

[data-vn-film-card] {
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
  width: 15rem;
  height: 100%;
  padding: 0.55rem 0.7rem;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 0.4rem;
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 160ms ease, background-color 160ms ease;
}

[data-vn-film-card]:hover,
[data-vn-film-card]:focus-visible,
[data-vn-film-card][data-vn-film-selected] {
  border-color: var(--vn-scene-gold);
  background: rgba(255, 255, 255, 0.1);
  outline: none;
}

[data-vn-film-head] {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
}

[data-vn-film-head] [data-vn-avatar-initial] {
  font-size: 0.72rem;
}

[data-vn-film-name] {
  overflow: hidden;
  color: var(--vn-figure-color, #fff);
  font-size: 0.86rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-vn-film-count] {
  margin-left: auto;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}

[data-vn-film-text] {
  display: -webkit-box;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.82rem;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}

[data-vn-film-card][data-vn-film-kind="voice"] [data-vn-film-text] {
  font-style: italic;
}

[data-vn-film-recap] {
  position: absolute;
  top: calc(var(--vn-scene-top) + 12.3rem);
  right: 1rem;
  left: 1rem;
  margin: 0;
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.85rem;
  text-align: center;
}

[data-vn-film-detail] {
  position: absolute;
  z-index: 3;
  right: var(--vn-scene-right);
  bottom: var(--vn-scene-bottom);
  width: min(24rem, calc(100% - 4rem));
  max-height: 38%;
  padding: 0.85rem 1rem;
  overflow: auto;
  border: 1px solid var(--vn-scene-gold);
  border-radius: 0.5rem;
  background: rgba(9, 10, 16, 0.9);
  user-select: text;
}

[data-vn-film-detail-head] {
  margin: 0 0 0.35rem;
  color: var(--vn-figure-color, var(--vn-scene-gold));
  font-size: 0.8rem;
  font-weight: 600;
}

[data-vn-film-detail-text] {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.55;
  white-space: pre-wrap;
}

/* Tidy: a dark veil, the scene centred. */
[data-vn-waiting][data-vn-backdrop="tidy"] [data-vn-waiting-veil] {
  background: rgba(5, 6, 10, 0.72);
}

[data-vn-waiting][data-vn-backdrop="tidy"] [data-vn-waiting-info] {
  top: var(--vn-scene-top);
  bottom: auto;
  left: 50%;
  width: min(34rem, calc(100% - 3rem));
  text-align: center;
  transform: translateX(-50%);
}

[data-vn-waiting][data-vn-backdrop="tidy"][data-vn-recap="off"] [data-vn-waiting-info] {
  top: 50%;
  transform: translate(-50%, -50%);
}

[data-vn-waiting][data-vn-backdrop="tidy"] [data-vn-waiting-progress] {
  margin-inline: auto;
}

[data-vn-waiting][data-vn-backdrop="tidy"] [data-vn-waiting-sent] {
  max-width: 26rem;
  margin-inline: auto;
  text-align: left;
}

/* The scene is centred at the top: the card goes to the bottom left. */
[data-vn-waiting][data-vn-backdrop="tidy"] [data-vn-recap-card] {
  top: auto;
  bottom: var(--vn-scene-bottom);
}

/* "— Scene —" already says it: the title follows straight after. */
[data-vn-waiting][data-vn-backdrop="tidy"] [data-vn-waiting-info] [data-vn-scene-kicker] {
  display: none;
}

[data-vn-waiting][data-vn-backdrop="tidy"] [data-vn-lineup] {
  top: 34%;
  left: var(--vn-scene-left);
  --vn-figure-max: 30rem;
}

[data-vn-waiting][data-vn-backdrop="tidy"][data-vn-recap="off"] [data-vn-lineup] {
  display: none;
}

[data-vn-waiting][data-vn-backdrop="tidy"] [data-vn-film] {
  top: auto;
  bottom: calc(var(--vn-scene-bottom) + 1rem);
}

[data-vn-waiting][data-vn-backdrop="tidy"] [data-vn-film-recap] {
  top: auto;
  bottom: calc(var(--vn-scene-bottom) + 13rem);
}

[data-vn-tidy-mark] {
  margin: 0 0 0.7rem;
  color: var(--vn-scene-gold);
  font-size: 0.74rem;
  letter-spacing: 0.42em;
  text-transform: uppercase;
}

[data-vn-tidy-faces] {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 1.2rem;
  margin: 1.3rem 0 0.4rem;
  padding: 0;
  list-style: none;
}

[data-vn-tidy-faces] > li {
  display: grid;
  justify-items: center;
  gap: 0.45rem;
  font-size: 0.8rem;
}

[data-vn-tidy-faces] [data-vn-avatar] {
  box-shadow: 0 0 0 2px var(--vn-scene-gold), 0 0 0 5px rgba(226, 184, 102, 0.22);
}

/* Daylight: a light loading screen. */
[data-vn-waiting][data-vn-backdrop="daylight"] {
  background: #dcecff;
  color: #14203a;
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-waiting-bg] {
  filter: blur(8px) brightness(1.3) saturate(0.6);
  opacity: 0.3;
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-waiting-veil] {
  background: repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.55) 0 22px, rgba(186, 216, 255, 0.5) 22px 44px);
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-waiting-info] {
  right: var(--vn-scene-right);
  bottom: calc(var(--vn-scene-bottom) + 2rem);
  left: auto;
  width: min(22rem, calc(100% - 4rem));
  text-align: right;
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-waiting-info] > :is([data-vn-scene-kicker], [data-vn-scene-title], [data-vn-scene-meta], [data-vn-waiting-progress]) {
  display: none;
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-waiting-status] {
  color: #1d3360;
  font-weight: 600;
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-waiting-sent] {
  border-left-color: #1e7bff;
  background: rgba(255, 255, 255, 0.86);
  text-align: left;
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-waiting-sent-label] { color: #1e64c8; }
[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-waiting-sent-text] { color: #14203a; }

[data-vn-daylight-banner] {
  position: absolute;
  z-index: 2;
  top: 16%;
  left: -2rem;
  padding: 0.7rem 3.4rem 0.75rem 4rem;
  background: #1e7bff;
  box-shadow: 0 10px 28px rgba(30, 123, 255, 0.35);
  color: #fff;
  font-size: clamp(1.1rem, 1.4 * var(--vn-vw, 1vw) + 0.6rem, 1.8rem);
  font-style: italic;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  transform: skewX(-14deg);
  animation: vn-daylight-banner 560ms 120ms cubic-bezier(0.2, 1, 0.3, 1) both;
}

[data-vn-daylight-banner] > span {
  display: inline-block;
  transform: skewX(14deg);
}

[data-vn-daylight-banner] > span::after {
  content: "...";
  display: inline-block;
  width: 1.6em;
  overflow: hidden;
  vertical-align: bottom;
  animation: vn-daylight-dots 1.4s steps(4, end) infinite;
}

[data-vn-daylight-tip] {
  position: absolute;
  z-index: 2;
  top: var(--vn-scene-top);
  right: var(--vn-scene-right);
  width: min(19rem, calc(100% - 4rem));
  padding: 0.7rem 0.9rem 0.75rem;
  border-left: 4px solid #1e7bff;
  border-radius: 0.6rem;
  background: #fff;
  box-shadow: 0 10px 26px rgba(20, 38, 77, 0.18);
}

[data-vn-daylight-tip] > b {
  color: #1e7bff;
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

[data-vn-daylight-tip] > p {
  margin: 0.25rem 0 0;
  color: #14203a;
  font-size: 0.86rem;
  line-height: 1.4;
}

[data-vn-daylight-pill] {
  position: absolute;
  z-index: 2;
  bottom: calc(var(--vn-scene-bottom) + 1.6rem);
  left: var(--vn-scene-left);
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  max-width: min(28rem, calc(100% - 4rem));
  margin: 0;
  padding: 0.42rem 0.95rem;
  border-radius: 999px;
  background: #14264d;
  color: #fff;
  font-size: 0.86rem;
  font-weight: 600;
}

[data-vn-daylight-pill] > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-vn-daylight-meta] {
  position: absolute;
  z-index: 2;
  bottom: var(--vn-scene-bottom);
  left: calc(var(--vn-scene-left) + 0.4rem);
  max-width: calc(100% - 4rem);
  margin: 0;
  color: #2a3d63;
  font-size: 0.8rem;
}

[data-vn-daylight-bar] {
  position: absolute;
  z-index: 2;
  right: var(--vn-scene-right);
  bottom: var(--vn-scene-bottom);
  width: min(16rem, 40%);
  height: 0.6rem;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(20, 38, 77, 0.14);
}

[data-vn-daylight-bar] > span {
  position: absolute;
  inset: 0 auto 0 0;
  width: 40%;
  border-radius: 999px;
  background: repeating-linear-gradient(-45deg, #1e7bff 0 8px, #6fb0ff 8px 16px);
  animation: vn-daylight-bar 1.8s ease-in-out infinite alternate;
}

[data-vn-daylight-hero] {
  position: absolute;
  bottom: 0;
  left: 2%;
  height: 86%;
  margin: 0;
}

[data-vn-daylight-hero] > img {
  height: 100%;
  filter: drop-shadow(0 0 2px #fff) drop-shadow(0 0 2px #fff) drop-shadow(0 0 2px #fff) drop-shadow(0 14px 26px rgba(20, 38, 77, 0.3));
  -webkit-user-drag: none;
  animation: vn-figure-in 520ms 200ms ease-out both;
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-lineup] {
  top: 26%;
  /* Short of the status column at the bottom right. */
  right: calc(var(--vn-scene-right) + min(22rem, 100% - 4rem) + 1.5rem);
  left: var(--vn-scene-left);
  bottom: calc(var(--vn-scene-bottom) + 3rem);
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-name-tag] {
  background: #fff;
  color: #14203a;
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-bubble] {
  background: #fff;
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-bubble]::after {
  border-top-color: #fff;
}

[data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-recap-card] {
  top: calc(var(--vn-scene-top) + 9rem);
}

/* Cast introduction: violet dark, everyone filling in from a silhouette. */
[data-vn-waiting][data-vn-backdrop="cast"] {
  background: #120c1f;
}

[data-vn-waiting][data-vn-backdrop="cast"] [data-vn-waiting-bg] {
  filter: blur(6px) brightness(0.3) saturate(0.6);
}

[data-vn-waiting][data-vn-backdrop="cast"] [data-vn-waiting-veil] {
  background: linear-gradient(180deg, rgba(64, 32, 118, 0.55), rgba(14, 8, 26, 0.88));
}

[data-vn-cast-header] {
  position: absolute;
  z-index: 2;
  top: var(--vn-scene-top);
  right: 1rem;
  left: 1rem;
  text-align: center;
}

[data-vn-cast-header] > h2 {
  margin: 0;
  font-family: var(--vn-scene-serif);
  font-size: clamp(1.4rem, 1.6 * var(--vn-vw, 1vw) + 0.9rem, 2.2rem);
  font-weight: 600;
}

[data-vn-cast-header] > p {
  margin: 0.4rem 0 0;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.86rem;
}

[data-vn-cast-bar] {
  position: absolute;
  z-index: 2;
  bottom: calc(var(--vn-scene-bottom) * 0.6);
  left: 50%;
  width: min(20rem, 60%);
  height: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.14);
  transform: translateX(-50%);
}

[data-vn-waiting][data-vn-backdrop="cast"] [data-vn-waiting-info] > :is([data-vn-scene-kicker], [data-vn-scene-title], [data-vn-scene-meta], [data-vn-waiting-progress]) {
  display: none;
}

[data-vn-waiting][data-vn-backdrop="cast"] [data-vn-lineup] {
  top: 22%;
  /* Clear of the status column at the bottom left. */
  left: calc(var(--vn-scene-left) + min(20rem, 100% - 4rem) + 1.5rem);
  bottom: calc(var(--vn-scene-bottom) + 1.2rem);
}

[data-vn-waiting][data-vn-backdrop="cast"] [data-vn-waiting-info] {
  width: min(20rem, calc(100% - 4rem));
}

[data-vn-waiting][data-vn-backdrop="cast"] [data-vn-figure-img] {
  animation: vn-silhouette-fill 900ms calc(var(--vn-figure-order, 0) * 240ms + 260ms) ease-out both;
}

[data-vn-waiting][data-vn-backdrop="cast"] [data-vn-recap-card],
[data-vn-waiting][data-vn-backdrop="cast"] [data-vn-film] {
  top: calc(var(--vn-scene-top) + 5.5rem);
}

[data-vn-waiting][data-vn-backdrop="cast"] [data-vn-film-recap] {
  top: calc(var(--vn-scene-top) + 17.8rem);
}

/* ---------------------------------------------------------------- *
 * Reply box: its own actions, and the Reply button when it is closed
 * ---------------------------------------------------------------- */
[data-vn-interaction-actions] {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.35rem;
  /* The heading around it lets taps through to the stage; these are buttons. */
  pointer-events: auto;
  width: fit-content;
}

[data-vn-interaction-action] {
  min-height: 1.9rem;
  padding: 0.22rem 0.75rem;
  border: 1px solid var(--vn-chrome-border);
  border-radius: 999px;
  background: var(--vn-chrome-bg);
  color: var(--vn-chrome-text);
  cursor: pointer;
  font-size: 0.8rem;
  backdrop-filter: blur(0.6rem);
}

[data-vn-interaction-action]:hover:not(:disabled) {
  background: var(--vn-chrome-hover);
  color: var(--vn-text);
}

[data-vn-interaction-action]:focus-visible,
[data-vn-reply-open]:focus-visible {
  outline: 3px solid var(--vn-focus-ring);
  outline-offset: 2px;
}

[data-vn-interaction-action]:disabled {
  opacity: 0.45;
  cursor: default;
}

[data-vn-reply-open] {
  position: absolute;
  z-index: 4;
  right: max(1rem, env(safe-area-inset-right));
  bottom: calc(var(--vn-dialogue-reach, 11rem) + 0.7rem);
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.6rem;
  padding: 0.5rem 1.1rem;
  border: 1px solid color-mix(in srgb, var(--vn-accent) 55%, transparent);
  border-radius: 999px;
  background: var(--vn-chrome-bg);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
  color: var(--vn-text);
  cursor: pointer;
  font-weight: 600;
}

@media (hover: none) and (pointer: coarse) {
  [data-vn-opening-hint] { display: none; }
  [data-vn-interaction-action] { min-height: 2.75rem; }
}

/* ---------------------------------------------------------------- *
 * Phones and short screens
 * ---------------------------------------------------------------- */
@media (max-width: 640px) {
  [data-vn-root] {
    --vn-scene-left: max(1rem, calc(env(safe-area-inset-left) + 0.6rem));
    --vn-scene-right: max(1rem, calc(env(safe-area-inset-right) + 0.6rem));
    --vn-scene-top: max(3.6rem, calc(env(safe-area-inset-top) + 3.2rem));
    --vn-scene-bottom: max(1.2rem, calc(env(safe-area-inset-bottom) + 0.8rem));
  }

  [data-vn-opening-card] {
    width: calc(100% - 2rem);
  }

  [data-vn-root] { --vn-location-h: 2.9rem; }

  [data-vn-location-meta] { display: none; }

  [data-vn-lineup] {
    --vn-figure-max: 24rem;
    --vn-bubble-room: 6rem;
    --vn-bubble-max: 12rem;
  }

  [data-vn-waiting] [data-vn-waiting-info] {
    top: var(--vn-scene-top);
    right: var(--vn-scene-right);
    bottom: auto;
    width: auto;
  }

  [data-vn-waiting] [data-vn-waiting-info] [data-vn-scene-meta] { display: none; }
  [data-vn-waiting-sent-text] { -webkit-line-clamp: 2; line-clamp: 2; }

  [data-vn-lineup] {
    top: 40%;
    right: 0.5rem;
    left: 0.5rem;
  }

  [data-vn-bubble] {
    padding: 0.45rem 0.65rem 0.55rem;
  }

  [data-vn-bubble-text] { font-size: 0.78rem; }

  [data-vn-recap-card] {
    top: auto;
    right: var(--vn-scene-right);
    bottom: var(--vn-scene-bottom);
    width: auto;
  }

  [data-vn-card-figure] {
    right: 0;
    width: 78%;
    height: 72%;
    opacity: 0.9;
  }

  /* The scene words take the top here: the film runs along the bottom. */
  [data-vn-film] {
    top: auto;
    bottom: calc(var(--vn-scene-bottom) + 3.6rem);
    height: 10rem;
  }

  [data-vn-film-card] { width: 12rem; }

  [data-vn-film-recap] {
    top: auto;
    bottom: var(--vn-scene-bottom);
  }

  /* Between the Now loading banner and the status at the bottom. */
  [data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-film] { bottom: calc(var(--vn-scene-bottom) + 12.6rem); }
  [data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-film-recap] { bottom: calc(var(--vn-scene-bottom) + 9.3rem); }

  /* Under the cast's header, as on larger screens: the status is at the bottom. */
  [data-vn-waiting][data-vn-backdrop="cast"] :is([data-vn-film], [data-vn-film-recap]) { bottom: auto; }

  [data-vn-film-detail] {
    right: var(--vn-scene-right);
    left: var(--vn-scene-left);
    width: auto;
  }

  [data-vn-waiting][data-vn-backdrop="tidy"] [data-vn-waiting-info],
  [data-vn-waiting][data-vn-backdrop="tidy"][data-vn-recap="off"] [data-vn-waiting-info] {
    left: var(--vn-scene-left);
    transform: none;
  }

  [data-vn-waiting][data-vn-backdrop="tidy"][data-vn-recap="off"] [data-vn-waiting-info] {
    top: 30%;
  }

  [data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-waiting-info] {
    top: auto;
    bottom: calc(var(--vn-scene-bottom) + 2rem);
    left: var(--vn-scene-left);
  }

  [data-vn-daylight-tip] {
    left: var(--vn-scene-left);
    width: auto;
  }

  [data-vn-daylight-banner] { top: 30%; }
  [data-vn-daylight-pill], [data-vn-daylight-meta] { display: none; }

  /* Above the status line and what you sent (two lines at most here). */
  [data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-lineup],
  [data-vn-waiting][data-vn-backdrop="cast"] [data-vn-lineup] {
    top: 42%;
    right: 0.5rem;
    left: 0.5rem;
    bottom: calc(var(--vn-scene-bottom) + 9.5rem);
  }

  [data-vn-waiting][data-vn-backdrop="cast"] [data-vn-waiting-info] {
    top: auto;
    bottom: calc(var(--vn-scene-bottom) + 1.2rem);
  }

  /* The status and what you sent are at the bottom here: the card sits above them. */
  [data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-recap-card],
  [data-vn-waiting][data-vn-backdrop="cast"] [data-vn-recap-card] {
    top: auto;
    bottom: calc(var(--vn-scene-bottom) + 9.5rem);
  }

  /* Their picture stands on the card, clear of the status text below. */
  [data-vn-waiting][data-vn-backdrop="daylight"] [data-vn-card-figure],
  [data-vn-waiting][data-vn-backdrop="cast"] [data-vn-card-figure] {
    bottom: calc(var(--vn-scene-bottom) + 9.5rem);
    height: 52%;
  }
}

@media (max-height: 560px) and (min-width: 641px) {
  [data-vn-waiting] [data-vn-waiting-info] [data-vn-scene-meta],
  [data-vn-waiting-sent] {
    display: none;
  }

  [data-vn-film] { height: 9.5rem; }
  [data-vn-film-recap] { display: none; }
}

/* ---------------------------------------------------------------- *
 * Motion
 * ---------------------------------------------------------------- */
@keyframes vn-scene-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes vn-scene-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes vn-scene-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes vn-scene-rule { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes vn-waiting-progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(270%); } }
@keyframes vn-figure-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes vn-figure-bounce {
  0% { transform: scale(1, 1); }
  30% { transform: scale(1.06, 0.92); }
  60% { transform: scale(0.97, 1.04); }
  100% { transform: scale(1, 1); }
}
@keyframes vn-bubble-pop {
  from { opacity: 0; transform: translateX(-50%) translateY(6px) scale(0.86); }
  to { opacity: 1; transform: translateX(-50%) scale(1); }
}
@keyframes vn-film-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes vn-daylight-banner { from { opacity: 0; transform: skewX(-14deg) translateX(-110%); } to { opacity: 1; transform: skewX(-14deg); } }
@keyframes vn-daylight-dots { from { width: 0; } to { width: 1.6em; } }
@keyframes vn-daylight-bar { from { transform: translateX(-10%); } to { transform: translateX(160%); } }
@keyframes vn-silhouette-fill {
  from { filter: brightness(0) drop-shadow(0 0 1.2px rgba(255, 255, 255, 0.5)); }
  to { filter: drop-shadow(0 0 1.2px #fff) drop-shadow(0 0 1.2px #fff) drop-shadow(0 10px 18px rgba(0, 0, 0, 0.45)); }
}

[data-vn-opening][data-vn-opening-motion="false"],
[data-vn-opening][data-vn-opening-motion="false"] *,
[data-vn-waiting][data-vn-waiting-motion="false"],
[data-vn-waiting][data-vn-waiting-motion="false"] * {
  animation: none !important;
  transition: none !important;
}

[data-vn-waiting][data-vn-waiting-motion="false"] [data-vn-film] {
  overflow-x: auto;
  mask-image: none;
}

@media (prefers-reduced-motion: reduce) {
  [data-vn-opening],
  [data-vn-opening] *,
  [data-vn-location],
  [data-vn-waiting],
  [data-vn-waiting] * {
    animation: none !important;
    transition: none !important;
  }

  [data-vn-film] {
    overflow-x: auto;
    mask-image: none;
  }
}
`;
