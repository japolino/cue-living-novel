/**
 * Visual Novel Stage Visual Effects & Ambient Stylesheets
 * Procedural animations, particle physics, camera dynamics, and ambient mood grading.
 */

export const VN_EFFECTS_CSS = `
/* ==========================================================================
   CAMERA & SCREEN EFFECTS (ONE-SHOT)
   ========================================================================== */

/* Shake Hard: Violent impact / explosion / earthquake */
@keyframes vn-shake-hard {
  0%, 100% { transform: translate3d(0, 0, 0); }
  10% { transform: translate3d(-12px, 7px, 0); }
  20% { transform: translate3d(14px, -10px, 0); }
  30% { transform: translate3d(-14px, -8px, 0); }
  40% { transform: translate3d(12px, 9px, 0); }
  50% { transform: translate3d(-10px, 5px, 0); }
  60% { transform: translate3d(9px, -5px, 0); }
  70% { transform: translate3d(-7px, 4px, 0); }
  80% { transform: translate3d(5px, -3px, 0); }
  90% { transform: translate3d(-3px, 1px, 0); }
}

.vn-shake-hard,
[data-vn-shake="hard"],
[data-vn-root].vn-shake-hard,
[data-vn-root][data-vn-shake="hard"],
[data-vn-scene].vn-shake-hard,
[data-vn-scene][data-vn-shake="hard"] {
  animation: vn-shake-hard 500ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

/* Rumble: Continuous high-frequency low-amplitude camera vibration */
@keyframes vn-rumble {
  0%, 100% { transform: translate3d(0, 0, 0); }
  10% { transform: translate3d(-2px, 2px, 0); }
  20% { transform: translate3d(3px, -1px, 0); }
  30% { transform: translate3d(-2px, -2px, 0); }
  40% { transform: translate3d(2px, 2px, 0); }
  50% { transform: translate3d(-3px, 1px, 0); }
  60% { transform: translate3d(2px, -2px, 0); }
  70% { transform: translate3d(-2px, 1px, 0); }
  80% { transform: translate3d(3px, -1px, 0); }
  90% { transform: translate3d(-1px, 2px, 0); }
}

.vn-rumble,
[data-vn-shake="rumble"],
[data-vn-root].vn-rumble,
[data-vn-root][data-vn-shake="rumble"],
[data-vn-scene].vn-rumble,
[data-vn-scene][data-vn-shake="rumble"] {
  animation: vn-rumble 800ms cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}

/* Zoom Out: Pull back camera view */
[data-vn-scene-image].vn-zoom-out,
[data-vn-scene-image][data-vn-zoom="out"],
[data-vn-scene].vn-zoom-out [data-vn-scene-image],
[data-vn-scene][data-vn-zoom="out"] [data-vn-scene-image],
[data-vn-root].vn-zoom-out [data-vn-scene-image],
[data-vn-root][data-vn-zoom="out"] [data-vn-scene-image] {
  transform: scale(0.92);
}

/* Zoom Punch: Sudden aggressive punch-in and snapback */
@keyframes vn-zoom-punch {
  0% { transform: scale(1); }
  20% { transform: scale(1.22); }
  55% { transform: scale(0.97); }
  100% { transform: scale(1); }
}

[data-vn-scene-image].vn-zoom-punch,
[data-vn-scene-image][data-vn-zoom="punch"],
[data-vn-scene].vn-zoom-punch [data-vn-scene-image],
[data-vn-scene][data-vn-zoom="punch"] [data-vn-scene-image] {
  animation: vn-zoom-punch 450ms cubic-bezier(0.15, 0.9, 0.25, 1) both;
}

/* Tilt: Dutch angle camera cant */
@keyframes vn-tilt {
  0% { transform: rotate(0deg) scale(1); }
  25% { transform: rotate(2.5deg) scale(1.05); }
  75% { transform: rotate(2.5deg) scale(1.05); }
  100% { transform: rotate(0deg) scale(1); }
}

[data-vn-scene-image].vn-tilt,
[data-vn-scene-image][data-vn-tilt],
[data-vn-scene].vn-tilt [data-vn-scene-image],
[data-vn-scene][data-vn-tilt] [data-vn-scene-image] {
  animation: vn-tilt 700ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
}

/* Heartbeat: Dramatic pulse of scale and red tension */
@keyframes vn-heartbeat {
  0% { transform: scale(1); }
  14% { transform: scale(1.045); }
  26% { transform: scale(1); }
  40% { transform: scale(1.065); }
  65% { transform: scale(1); }
  100% { transform: scale(1); }
}

@keyframes vn-heartbeat-flash {
  0% { opacity: 0; background-color: rgba(220, 20, 40, 0); }
  14% { opacity: 0.35; background-color: rgba(220, 20, 40, 0.45); }
  26% { opacity: 0.1; background-color: rgba(220, 20, 40, 0.2); }
  40% { opacity: 0.45; background-color: rgba(220, 20, 40, 0.55); }
  70% { opacity: 0; background-color: rgba(220, 20, 40, 0); }
  100% { opacity: 0; }
}

.vn-heartbeat,
[data-vn-heartbeat],
[data-vn-root].vn-heartbeat,
[data-vn-root][data-vn-heartbeat],
[data-vn-scene].vn-heartbeat,
[data-vn-scene][data-vn-heartbeat] {
  animation: vn-heartbeat 850ms cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
}

[data-vn-flash].vn-heartbeat-flash {
  animation: vn-heartbeat-flash 850ms ease-out both;
}

/* Blur Pulse: Instant camera defocus shock */
@keyframes vn-blur-pulse {
  0% { filter: blur(0px); }
  35% { filter: blur(7px); }
  100% { filter: blur(0px); }
}

[data-vn-scene-image].vn-blur-pulse,
[data-vn-scene-image][data-vn-blur],
[data-vn-scene].vn-blur-pulse [data-vn-scene-image],
[data-vn-scene][data-vn-blur] [data-vn-scene-image] {
  animation: vn-blur-pulse 650ms ease-in-out both;
}

/* Fades & Flashes: Fade from Black, Fade to White, Lightning */
@keyframes vn-fade-from-black {
  0% { opacity: 1; background-color: #000000; }
  100% { opacity: 0; background-color: #000000; }
}

@keyframes vn-fade-to-white {
  0% { opacity: 0; background-color: #ffffff; }
  35% { opacity: 1; background-color: #ffffff; }
  70% { opacity: 1; background-color: #ffffff; }
  100% { opacity: 0; background-color: #ffffff; }
}

@keyframes vn-lightning {
  0% { opacity: 0; background-color: #ffffff; }
  10% { opacity: 0.95; background-color: #ffffff; }
  20% { opacity: 0.15; background-color: #ffffff; }
  32% { opacity: 0.92; background-color: #ffffff; }
  45% { opacity: 0.08; background-color: #ffffff; }
  58% { opacity: 0.85; background-color: #ffffff; }
  100% { opacity: 0; background-color: #ffffff; }
}

[data-vn-flash].vn-fade-from-black,
[data-vn-flash][data-vn-flash="fade_from_black"] {
  animation: vn-fade-from-black 800ms ease-out forwards;
}

[data-vn-flash].vn-fade-to-white,
[data-vn-flash][data-vn-flash="fade_to_white"] {
  animation: vn-fade-to-white 800ms ease-in-out forwards;
}

[data-vn-flash].vn-lightning,
[data-vn-flash][data-vn-flash="lightning"] {
  animation: vn-lightning 550ms cubic-bezier(0.1, 0.9, 0.2, 1) forwards;
}

/* Procedural One-Shot Particle Bursts: Speed Lines, Sparkles, Hearts, Confetti */
@keyframes vn-speed-lines-pop {
  0% { opacity: 0; transform: scale(1.18); }
  18% { opacity: 0.95; transform: scale(1.02); }
  70% { opacity: 0.85; transform: scale(0.98); }
  100% { opacity: 0; transform: scale(0.94); }
}

@keyframes vn-sparkle-burst {
  0% { opacity: 0; transform: scale(0.25) rotate(0deg); }
  25% { opacity: 1; transform: scale(1.15) rotate(50deg); }
  65% { opacity: 0.9; transform: scale(1) rotate(90deg); }
  100% { opacity: 0; transform: scale(0.4) rotate(150deg); }
}

@keyframes vn-hearts-burst {
  0% { opacity: 0; transform: translateY(20px) scale(0.3); }
  25% { opacity: 1; transform: translateY(-12px) scale(1.2); }
  65% { opacity: 0.9; transform: translateY(-40px) scale(1); }
  100% { opacity: 0; transform: translateY(-70px) scale(0.65); }
}

@keyframes vn-confetti-fall {
  0% { opacity: 1; transform: translateY(-40px); }
  75% { opacity: 0.95; }
  100% { opacity: 0; transform: translateY(480px); }
}

[data-vn-fx] {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  overflow: hidden;
}

[data-vn-fx] svg,
[data-vn-flash] svg {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

[data-vn-fx].vn-speed-lines,
[data-vn-fx][data-vn-effect="speed_lines"],
[data-vn-flash].vn-speed-lines,
[data-vn-flash][data-vn-effect="speed_lines"] {
  opacity: 1;
  animation: vn-speed-lines-pop 650ms cubic-bezier(0.12, 0.9, 0.22, 1) forwards;
}

[data-vn-fx].vn-sparkle-burst,
[data-vn-fx][data-vn-effect="sparkle_burst"],
[data-vn-flash].vn-sparkle-burst,
[data-vn-flash][data-vn-effect="sparkle_burst"] {
  opacity: 1;
  animation: vn-sparkle-burst 850ms cubic-bezier(0.16, 0.95, 0.3, 1) forwards;
}

[data-vn-fx].vn-hearts-burst,
[data-vn-fx][data-vn-effect="hearts_burst"],
[data-vn-flash].vn-hearts-burst,
[data-vn-flash][data-vn-effect="hearts_burst"] {
  opacity: 1;
  animation: vn-hearts-burst 950ms cubic-bezier(0.2, 0.8, 0.28, 1) forwards;
}

[data-vn-fx].vn-confetti,
[data-vn-fx][data-vn-effect="confetti"],
[data-vn-flash].vn-confetti,
[data-vn-flash][data-vn-effect="confetti"] {
  opacity: 1;
  animation: vn-confetti-fall 1200ms cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}

/* ==========================================================================
   AMBIENT OVERLAY & MOOD GRADES (PERSISTENT, SCENE-LEVEL)
   ========================================================================== */

[data-vn-ambient] {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  overflow: hidden;
}

[data-vn-ambient] svg {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* Mood Grade: Vignette Dark (tasteful radial darkening) */
[data-vn-ambient].vn-ambient-vignette_dark {
  background: radial-gradient(circle at 50% 50%, transparent 40%, rgba(0, 0, 0, 0.38) 72%, rgba(0, 0, 0, 0.72) 100%);
  opacity: 1;
}

/* Mood Grade: Sepia Flashback (warm tone + contrast lift + subtle amber wash) */
[data-vn-scene].vn-ambient-sepia_flashback [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="sepia_flashback"] [data-vn-scene-image] {
  filter: sepia(0.68) contrast(1.14) brightness(0.98) saturate(0.9);
}

[data-vn-ambient].vn-ambient-sepia_flashback {
  background: rgba(180, 110, 40, 0.08);
  mix-blend-mode: multiply;
  opacity: 1;
}

/* Mood Grade: Desaturate (bleak, cold, melancholic) */
[data-vn-scene].vn-ambient-desaturate [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="desaturate"] [data-vn-scene-image] {
  filter: grayscale(0.88) contrast(1.06) brightness(0.94);
}

/* Mood Grade: Dream Haze (soft bloom, pastel glow, dreamy nostalgia) */
[data-vn-scene].vn-ambient-dream_haze [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="dream_haze"] [data-vn-scene-image] {
  filter: brightness(1.1) contrast(0.94) saturate(1.12) blur(1px);
}

[data-vn-ambient].vn-ambient-dream_haze {
  background: radial-gradient(circle at 50% 40%, rgba(255, 235, 245, 0.3) 0%, rgba(230, 210, 255, 0.2) 60%, rgba(180, 160, 220, 0.32) 100%);
  mix-blend-mode: screen;
  opacity: 1;
}

/* Mood Grade: Danger Pulse (slow warning edge pulse, unobtrusive to dialogue) */
@keyframes vn-danger-pulse {
  0% { opacity: 0.35; }
  50% { opacity: 0.85; }
  100% { opacity: 0.35; }
}

[data-vn-ambient].vn-ambient-danger_pulse {
  background: radial-gradient(circle at 50% 50%, transparent 48%, rgba(200, 20, 20, 0.22) 78%, rgba(230, 20, 20, 0.58) 100%);
  animation: vn-danger-pulse 2.2s ease-in-out infinite;
  opacity: 1;
}

/* Rain: subtle cool desaturation on the scene */
[data-vn-scene].vn-ambient-rain [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="rain"] [data-vn-scene-image] {
  filter: brightness(0.95) saturate(0.9);
}

/* Heavy Rain: Wet-lens look with subtle scene blur */
[data-vn-scene].vn-ambient-heavy_rain [data-vn-scene-image],
[data-vn-scene][data-vn-scene-ambient="heavy_rain"] [data-vn-scene-image] {
  filter: blur(1.2px) brightness(0.92);
}

/* ==========================================================================
   AMBIENT WEATHER & PARTICLE ANIMATIONS
   ========================================================================== */

/* Rain: Multi-layered angled falling streaks */
@keyframes vn-rain-fall-bg {
  0% { transform: translateY(-80px); }
  100% { transform: translateY(680px); }
}

@keyframes vn-rain-fall-mg {
  0% { transform: translateY(-110px); }
  100% { transform: translateY(710px); }
}

@keyframes vn-rain-fall-fg {
  0% { transform: translateY(-140px); }
  100% { transform: translateY(740px); }
}

.vn-rain-bg line { animation: vn-rain-fall-bg 0.52s linear infinite; }
.vn-rain-mg line { animation: vn-rain-fall-mg 0.65s linear infinite; }
.vn-rain-fg line { animation: vn-rain-fall-fg 0.42s linear infinite; }

.vn-heavy-rain-bg line { animation: vn-rain-fall-bg 0.38s linear infinite; }
.vn-heavy-rain-mg line { animation: vn-rain-fall-mg 0.48s linear infinite; }
.vn-heavy-rain-fg line { animation: vn-rain-fall-fg 0.32s linear infinite; }

/* Snow: Drifting snowflakes with horizontal sway */
@keyframes vn-snow-fall-bg {
  0% { transform: translateY(-30px); }
  100% { transform: translateY(640px); }
}

@keyframes vn-snow-fall-mg {
  0% { transform: translateY(-40px); }
  100% { transform: translateY(650px); }
}

@keyframes vn-snow-fall-fg {
  0% { transform: translateY(-50px); }
  100% { transform: translateY(660px); }
}

@keyframes vn-snow-sway {
  0%, 100% { transform: translateX(-16px); }
  50% { transform: translateX(16px); }
}

.vn-snow-bg circle { animation: vn-snow-fall-bg 5.6s linear infinite; }
.vn-snow-mg circle { animation: vn-snow-fall-mg 4.2s linear infinite; }
.vn-snow-fg circle { animation: vn-snow-fall-fg 3.0s linear infinite; }
.vn-snow-sway-node { animation: vn-snow-sway 3.2s ease-in-out infinite alternate; }

/* Sakura: Petals fluttering, tumbling, and swaying */
@keyframes vn-sakura-fall-bg {
  0% { transform: translateY(-40px) rotate(0deg); }
  50% { transform: translateY(300px) rotate(180deg); }
  100% { transform: translateY(650px) rotate(360deg); }
}

@keyframes vn-sakura-fall-mg {
  0% { transform: translateY(-50px) rotate(0deg); }
  50% { transform: translateY(310px) rotate(190deg); }
  100% { transform: translateY(660px) rotate(380deg); }
}

@keyframes vn-sakura-fall-fg {
  0% { transform: translateY(-60px) rotate(0deg); }
  50% { transform: translateY(320px) rotate(200deg); }
  100% { transform: translateY(670px) rotate(400deg); }
}

@keyframes vn-sakura-sway {
  0%, 100% { transform: translateX(-24px); }
  50% { transform: translateX(24px); }
}

.vn-sakura-bg .vn-petal { animation: vn-sakura-fall-bg 6.2s linear infinite; transform-box: fill-box; transform-origin: center; }
.vn-sakura-mg .vn-petal { animation: vn-sakura-fall-mg 4.8s linear infinite; transform-box: fill-box; transform-origin: center; }
.vn-sakura-fg .vn-petal { animation: vn-sakura-fall-fg 3.6s linear infinite; transform-box: fill-box; transform-origin: center; }
.vn-sakura-sway-node { animation: vn-sakura-sway 2.6s ease-in-out infinite alternate; }

/* Fireflies: Slow drifting glow pulses */
@keyframes vn-firefly-glow {
  0%, 100% { opacity: 0.22; transform: translate(0, 0) scale(0.8); }
  50% { opacity: 0.95; transform: translate(14px, -18px) scale(1.25); }
}

@keyframes vn-firefly-drift {
  0% { transform: translate(0, 0); }
  25% { transform: translate(14px, -10px); }
  50% { transform: translate(-6px, -18px); }
  75% { transform: translate(-16px, 8px); }
  100% { transform: translate(0, 0); }
}

.vn-firefly-node {
  animation: vn-firefly-glow 3.8s ease-in-out infinite alternate;
}

.vn-firefly-node circle {
  animation: vn-firefly-drift 9s ease-in-out infinite;
}

/* Embers: Rising warm sparks with flicker */
@keyframes vn-embers-rise {
  0% { opacity: 0; transform: translateY(640px) translateX(0) scale(0.7); }
  15% { opacity: 0.95; }
  80% { opacity: 0.85; }
  100% { opacity: 0; transform: translateY(-30px) translateX(26px) scale(0.35); }
}

@keyframes vn-embers-flicker {
  0%, 100% { opacity: 0.65; }
  50% { opacity: 1; }
}

.vn-ember-node {
  animation: vn-embers-rise 3.2s linear infinite, vn-embers-flicker 0.4s ease-in-out infinite alternate;
}

/* Fog: Creeping layered atmospheric mist */
@keyframes vn-fog-drift-1 {
  0% { transform: translateX(-50px); opacity: 0.35; }
  50% { transform: translateX(50px); opacity: 0.55; }
  100% { transform: translateX(-50px); opacity: 0.35; }
}

@keyframes vn-fog-drift-2 {
  0% { transform: translateX(45px); opacity: 0.4; }
  50% { transform: translateX(-45px); opacity: 0.65; }
  100% { transform: translateX(45px); opacity: 0.4; }
}

.vn-fog-layer-1 { animation: vn-fog-drift-1 14s ease-in-out infinite; }
.vn-fog-layer-2 { animation: vn-fog-drift-2 18s ease-in-out infinite; }
.vn-fog-layer-3 { animation: vn-fog-drift-1 22s ease-in-out infinite reverse; }

/* ==========================================================================
   PREFERS-REDUCED-MOTION OVERRIDES
   ========================================================================== */

@media (prefers-reduced-motion: reduce) {
  /* Suppress camera motion, shakes, punches, tilts, and rapid particle motion */
  .vn-shake-hard,
  .vn-rumble,
  .vn-heartbeat,
  [data-vn-shake="hard"],
  [data-vn-shake="rumble"],
  [data-vn-heartbeat],
  .vn-zoom-punch,
  .vn-tilt,
  [data-vn-zoom="punch"],
  [data-vn-tilt],
  .vn-blur-pulse,
  [data-vn-blur] {
    animation: none !important;
    transform: none !important;
    filter: none !important;
  }

  [data-vn-ambient] svg *,
  [data-vn-fx] svg *,
  .vn-rain-bg, .vn-rain-mg, .vn-rain-fg,
  .vn-heavy-rain-bg, .vn-heavy-rain-mg, .vn-heavy-rain-fg,
  .vn-snow-bg, .vn-snow-mg, .vn-snow-fg, .vn-snow-sway-node,
  .vn-sakura-bg, .vn-sakura-mg, .vn-sakura-fg, .vn-sakura-sway-node, .vn-petal,
  .vn-firefly-node, .vn-ember-node,
  .vn-fog-layer-1, .vn-fog-layer-2 {
    animation: none !important;
  }

  [data-vn-ambient].vn-ambient-danger_pulse {
    animation: none !important;
    opacity: 0.6 !important;
  }
}
`;
