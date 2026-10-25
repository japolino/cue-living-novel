/**
 * CFG rescale. `cfgRescale` in Image parameters is Cue's own key (Settings,
 * Inlay art styles): Lumiverse's NovelAI provider always sends
 * `cfg_rescale: 0` and only a raw request override can change it. For
 * NovelAI it goes into that override, merged over Cue's own override or, when
 * Cue has none, the connection's (Lumiverse uses one or the other). Other
 * providers never see the key.
 */
import { deepMergeRawOverride, parseRawOverride } from "./sprites/novelai-inset.js";

export function cfgRescaleOf(parameters: Record<string, unknown>): number | null {
  const value = parameters.cfgRescale;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

/** The raw override part that sets it. */
export function cfgRescaleOverride(value: number): { parameters: { cfg_rescale: number } } {
  return { parameters: { cfg_rescale: value } };
}

/**
 * Parameters as Lumiverse takes them. `connectionOverride` is asked only when
 * needed. An override that is not valid JSON is left for Lumiverse to report.
 */
export async function withNovelAiCfgRescale(
  parameters: Record<string, unknown>,
  provider: string | null,
  connectionOverride: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  if (!("cfgRescale" in parameters)) return parameters;
  const { cfgRescale: _dropped, ...rest } = parameters;
  const value = cfgRescaleOf(parameters);
  if (provider !== "novelai" || value === null) return rest;
  const own = rest.rawRequestOverride;
  try {
    const base = parseRawOverride(own !== undefined ? own : await connectionOverride()) ?? {};
    return { ...rest, rawRequestOverride: JSON.stringify(deepMergeRawOverride(base, cfgRescaleOverride(value))) };
  } catch {
    return rest;
  }
}
