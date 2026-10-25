/**
 * Inlay Illustrator's art styles for Settings (src/shared/inlay-styles.ts):
 * the user's endpoint first, then the owner's. Never throws; the status says
 * why there is no list.
 */
import type { SpindleAPI } from "lumiverse-spindle-types";
import { inlayStyleEndpoints, normalizeInlayStyles, type InlayStylesStatus } from "../../shared/inlay-styles.js";

const NOT_REGISTERED = /not registered/i;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadInlayStyles(spindle: Pick<SpindleAPI, "rpcPool">, userId: string | undefined): Promise<InlayStylesStatus> {
  const pool = spindle.rpcPool as SpindleAPI["rpcPool"] | undefined;
  if (typeof pool?.read !== "function") {
    return { state: "unavailable", reason: "This Lumiverse can't share art styles between extensions. Update Lumiverse to use Inlay's styles." };
  }
  let failure = "";
  for (const endpoint of inlayStyleEndpoints(userId)) {
    let value: unknown;
    try {
      value = await pool.read(endpoint);
    } catch (error) {
      const text = errorText(error);
      if (!NOT_REGISTERED.test(text) && !failure) failure = text;
      continue;
    }
    const list = normalizeInlayStyles(value);
    if (!list) return { state: "unavailable", reason: "Inlay shares its styles in a form this Cue doesn't read. Update Cue." };
    return { state: "ready", ...list };
  }
  return {
    state: "unavailable",
    reason: failure
      ? `Could not read Inlay's styles: ${failure}`
      : "Inlay isn't sharing art styles. Turn on an Inlay Illustrator build that shares them (testing branch), then reload Lumiverse.",
  };
}
