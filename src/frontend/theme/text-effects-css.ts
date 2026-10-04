/**
 * Styles for inline dialogue text effects (`[data-vn-text-fx="<id>"]`), see
 * src/shared/text-effects.ts. Included in VN_BASE_CSS so every preset and the
 * user CSS layer can restyle it. The mode comes from the nearest ancestor
 * with `data-vn-text-effects` ("animated" | "static" | "off"; no ancestor
 * means "animated") and prefers-reduced-motion freezes motion. The rules must
 * not depend on `[data-vn-root]`, so other shadow roots (the settings panel
 * preview) can reuse this string as-is.
 *
 * Contract stub: the text-effects implementation fills this in.
 */
export const VN_TEXT_EFFECTS_CSS = ``;
