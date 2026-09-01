/**
 * Installs user CSS after the base stylesheet. The caller must place this style
 * in the nested theme shadow root, where it cannot select the safety controls.
 */
export const applyVnUserCss = (
  styleElement: HTMLStyleElement,
  css: string | null | undefined,
): void => {
  styleElement.textContent = sanitizeVnUserCss(css ?? "");
};

/** Blocks CSS network fetches while leaving the extension-owned theme flexible. */
export function sanitizeVnUserCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\/g, "")
    .replace(/@import\b[^;{}]*(?:;|$)/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/(?:https?:|\/\/)[^\s);"']*/gi, "");
}
