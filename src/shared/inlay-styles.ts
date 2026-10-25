/**
 * Art styles from Inlay Illustrator, read over Lumiverse's shared RPC pool.
 * Inlay publishes each user's NovelAI artists at
 * `inlay_illustrator.artists.<user>` (`artists.owner` for a user-scoped
 * install); readers need `image_gen`. Choosing one in Settings copies its
 * prompt and negative into Cue's prompt fields and, on NovelAI, its
 * steps / guidance / CFG rescale into the image parameters.
 */

export const INLAY_EXTENSION_ID = "inlay_illustrator";
const INLAY_CHANNEL = "artists";
const OWNER_CHANNEL = "owner";
const CHANNEL_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

/** Prefix of an Inlay style in the preset dropdown (Cue's own presets are `preset-…`). */
export const INLAY_STYLE_OPTION_PREFIX = "inlay:";

export type InlayStyle = {
  id: string;
  title: string;
  /** Whitespace collapsed: Cue's prompt fields are single-line. */
  prompt: string;
  negativePrompt: string;
  steps?: number;
  guidance?: number;
  cfgRescale?: number;
  /** One of Inlay's own presets rather than one the user wrote. */
  builtIn: boolean;
};

export type InlayStylesStatus =
  | { state: "ready"; styles: InlayStyle[]; defaultId: string }
  | { state: "unavailable"; reason: string };

/** Endpoints to try, the user's own first. */
export function inlayStyleEndpoints(userId: string | undefined): string[] {
  const key = (userId ?? "").trim().toLowerCase();
  const own = key && CHANNEL_SEGMENT.test(key) ? key : OWNER_CHANNEL;
  const endpoints = [`${INLAY_EXTENSION_ID}.${INLAY_CHANNEL}.${own}`];
  if (own !== OWNER_CHANNEL) endpoints.push(`${INLAY_EXTENSION_ID}.${INLAY_CHANNEL}.${OWNER_CHANNEL}`);
  return endpoints;
}

export function flattenStylePrompt(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

/** What Inlay published, or null when it is not an artist list Cue knows. */
export function normalizeInlayStyles(value: unknown): { styles: InlayStyle[]; defaultId: string } | null {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.novelai)) return null;
  const styles: InlayStyle[] = [];
  const seen = new Set<string>();
  for (const raw of value.novelai) {
    if (!isObject(raw)) continue;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const prompt = typeof raw.prompt === "string" ? flattenStylePrompt(raw.prompt) : "";
    if (!id || seen.has(id) || !prompt) continue;
    seen.add(id);
    const overrides = isObject(raw.novelAIOverrides) ? raw.novelAIOverrides : {};
    const steps = finite(overrides.steps, 1, 50);
    const guidance = finite(overrides.scale, 0, 20);
    const cfgRescale = finite(overrides.cfgRescale, 0, 1);
    styles.push({
      id,
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : id,
      prompt,
      negativePrompt: typeof raw.negativePrompt === "string" ? flattenStylePrompt(raw.negativePrompt) : "",
      ...(steps !== undefined ? { steps: Math.round(steps) } : {}),
      ...(guidance !== undefined ? { guidance } : {}),
      ...(cfgRescale !== undefined ? { cfgRescale } : {}),
      builtIn: raw.builtIn === true,
    });
  }
  const defaultId = typeof value.defaultArtistId === "string" && seen.has(value.defaultArtistId) ? value.defaultArtistId : "";
  return { styles, defaultId };
}

/** The style whose prompt and negative the prompt fields hold, if any. */
export function matchingInlayStyle(styles: readonly InlayStyle[], prefix: string, negative: string): InlayStyle | undefined {
  const p = flattenStylePrompt(prefix);
  const n = flattenStylePrompt(negative);
  return styles.find((style) => style.prompt === p && style.negativePrompt === n);
}
