/**
 * The ordered cascade of style layers inside the nested theme shadow root.
 *
 * The first layer wins the earliest spot in the cascade and the last layer
 * wins ties, so the order is significant:
 *
 *   1. `base`   — the platform theme (VN_BASE_CSS): stable data-vn-* selectors,
 *                 the user-selectable scene-image fit, and the default values
 *                 for every documented --vn-* custom property.
 *   2. `preset` — exactly one built-in preset (THEME_PRESET_CSS), scoped to
 *                 `[data-vn-root][data-vn-preset="<id>"]`.
 *   3. `user`   — the user's custom CSS, sanitized of remote fetches. This is
 *                 always the final layer, so a rule a user writes wins over a
 *                 preset rule of the same specificity.
 *
 * `VnStage` appends its three <style> elements in exactly this order, and the
 * order below is the single reference the stage and the tests share.
 */

export const THEME_STYLE_LAYER_ORDER = ["base", "preset", "user"] as const;

export type ThemeStyleLayer = (typeof THEME_STYLE_LAYER_ORDER)[number];

/**
 * The `data-vn-*` attribute written on each <style> element so the layer is
 * identifiable from the DOM and so tests can assert the layer composition.
 */
export const THEME_STYLE_LAYER_ATTRIBUTE: Record<ThemeStyleLayer, string> = {
  base: "data-vn-base-css",
  preset: "data-vn-preset-css",
  user: "data-vn-user-css",
};
