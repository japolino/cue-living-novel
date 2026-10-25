/**
 * What a NovelAI model can do, from its name. Shared by the backend (prompt
 * syntax, sprite framing) and the settings panel (which groups to show).
 *
 * `alpha`: the model draws a real alpha channel when the prompt asks for a
 * `transparent background` (V5's custom VAE, per NovelAI's V5 release notes).
 */
export type NovelAiCapabilities = { structured: boolean; numeric: boolean; negativeNumeric: boolean; alpha: boolean };

/** Unknown models get the older, broadly supported bracket syntax. */
export function novelAiCapabilities(model: string | null | undefined): NovelAiCapabilities {
  const version = /^nai-diffusion-(\d+)(?:-(\d+))?(?:-|$)/.exec(model ?? "");
  const major = Number(version?.[1] ?? 0);
  const minor = Number(version?.[2] ?? 0);
  return { structured: major >= 4, numeric: major >= 4, negativeNumeric: major > 4 || (major === 4 && minor >= 5), alpha: major >= 5 };
}
