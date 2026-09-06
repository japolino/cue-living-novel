import {
  AmbientEffectSchema,
  StageEffectSchema,
  type AmbientEffect,
  type StageEffect
} from "../../shared/contracts.js";

/** Read one requested effect. Lists intentionally use the first item, not a later fallback. */
function effectToken(value: unknown, depth = 0): string | null {
  if (depth > 8) return null;
  if (Array.isArray(value)) return effectToken(value[0], depth + 1);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["effect", "ambient", "type", "name", "id", "value"]) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        return effectToken(record[key], depth + 1);
      }
    }
    return null;
  }
  if (typeof value !== "string") return null;
  const token = value.trim()
    .replace(/^[\s'"`“”‘’\[\(]+|[\s'"`“”‘’\]\).!?]+$/g, "")
    .split(/[,;/|]/, 1)[0]?.trim()
    .replace(/^[\s'"`“”‘’]+|[\s'"`“”‘’.!?]+$/g, "")
    .toLowerCase().replace(/[\s-]+/g, "_");
  return token || null;
}

const STAGE_SYNONYMS: Readonly<Record<string, StageEffect>> = {
  flash: "flash_white",
  white_flash: "flash_white",
  flash_white_screen: "flash_white",
  shock: "flash_white",
  red_flash: "flash_red",
  hard_shake: "shake_hard",
  heavy_shake: "shake_hard",
  screen_shake: "shake_hard",
  explosion: "shake_hard",
  impact: "shake_hard",
  earthquake: "shake_hard",
  quake: "shake_hard",
  tremor: "rumble",
  shaking: "rumble",
  blackout: "fade_to_black",
  black_out: "fade_to_black",
  fade_out: "fade_to_black",
  fadeout: "fade_to_black",
  fade: "fade_to_black",
  cut_to_black: "fade_to_black",
  scene_cut: "fade_to_black",
  fade_in: "fade_from_black",
  fadein: "fade_from_black",
  whiteout: "fade_to_white",
  white_out: "fade_to_white",
  thunder: "lightning",
  thunderclap: "lightning",
  lightning_strike: "lightning",
  storm: "lightning",
  zoom: "zoom_in",
  zoomin: "zoom_in",
  close_up: "zoom_in",
  zoomout: "zoom_out",
  punch: "zoom_punch",
  punch_in: "zoom_punch",
  snap_zoom: "zoom_punch",
  sudden_reveal: "zoom_punch",
  sparkle: "sparkle_burst",
  sparkles: "sparkle_burst",
  glitter: "sparkle_burst",
  heart: "hearts_burst",
  hearts: "hearts_burst",
  heart_burst: "hearts_burst",
  love: "hearts_burst",
  kiss: "hearts_burst",
  confession: "hearts_burst",
  pulse: "heartbeat",
  heart_beat: "heartbeat",
  pounding: "heartbeat",
  fear: "heartbeat",
  tension: "heartbeat",
  blur: "blur_pulse",
  focus_pulse: "blur_pulse",
  speedlines: "speed_lines",
  motion_lines: "speed_lines",
  celebration: "confetti",
  party: "confetti",
  cheer: "confetti",
  dutch_angle: "tilt",
};

const AMBIENT_SYNONYMS: Readonly<Record<string, AmbientEffect>> = {
  raining: "rain",
  rainy: "rain",
  light_rain: "rain",
  drizzle: "rain",
  showers: "rain",
  rainfall: "rain",
  downpour: "heavy_rain",
  storm: "heavy_rain",
  thunderstorm: "heavy_rain",
  rainstorm: "heavy_rain",
  heavy_rainfall: "heavy_rain",
  snowfall: "snow",
  snowing: "snow",
  snowy: "snow",
  blizzard: "snow",
  flurries: "snow",
  cherry_blossoms: "sakura",
  petals: "sakura",
  falling_petals: "sakura",
  blossoms: "sakura",
  mist: "fog",
  misty: "fog",
  foggy: "fog",
  haze: "fog",
  firefly: "fireflies",
  glowing_bugs: "fireflies",
  ember: "embers",
  sparks: "embers",
  cinders: "embers",
  vignette: "vignette_dark",
  dark_vignette: "vignette_dark",
  darkness: "vignette_dark",
  shadowy: "vignette_dark",
  sepia: "sepia_flashback",
  flashback: "sepia_flashback",
  memory: "sepia_flashback",
  old_photo: "sepia_flashback",
  desaturated: "desaturate",
  grayscale: "desaturate",
  greyscale: "desaturate",
  monochrome: "desaturate",
  black_and_white: "desaturate",
  bw: "desaturate",
  colorless: "desaturate",
  dream: "dream_haze",
  dreamy: "dream_haze",
  hazy: "dream_haze",
  dreamlike: "dream_haze",
  soft_focus: "dream_haze",
  danger: "danger_pulse",
  dread: "danger_pulse",
  tension: "danger_pulse",
  alarm: "danger_pulse",
  threat: "danger_pulse",
  red_pulse: "danger_pulse",
};

export function normalizeStageEffect(value: unknown): StageEffect | null {
  const token = effectToken(value);
  if (!token) return null;
  const exact = StageEffectSchema.safeParse(token);
  return exact.success ? exact.data : Object.prototype.hasOwnProperty.call(STAGE_SYNONYMS, token)
    ? STAGE_SYNONYMS[token] ?? null : null;
}

export function normalizeAmbientEffect(value: unknown): AmbientEffect | null {
  const token = effectToken(value);
  if (!token) return null;
  const exact = AmbientEffectSchema.safeParse(token);
  return exact.success ? exact.data : Object.prototype.hasOwnProperty.call(AMBIENT_SYNONYMS, token)
    ? AMBIENT_SYNONYMS[token] ?? null : null;
}

/** Weather fallback only: never infer mood overlays or one-shot accents. */
export function deriveWeatherAmbient(weather: unknown): AmbientEffect | null {
  if (typeof weather !== "string") return null;
  const text = weather.trim().toLowerCase().replace(/[_-]+/g, " ");
  // Negated, hypothetical, and ended weather must not start an overlay.
  if (/\b(no|not|without|chance|possible|forecast|stopped|ended|cleared)\b/.test(text)) return null;
  if (/\b(heavy rain(?:fall)?|downpour|rainstorm|thunderstorm|storm|stormy)\b/.test(text)) return "heavy_rain";
  if (/\b(snow|snowfall|snowing|snowy|blizzard|flurries)\b/.test(text)) return "snow";
  if (/\b(rain|rainfall|raining|rainy|drizzle|drizzling|showers)\b/.test(text)) return "rain";
  if (/\b(fog|foggy|mist|misty)\b/.test(text)) return "fog";
  return null;
}
