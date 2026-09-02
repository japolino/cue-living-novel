import type { VisualNovelThemePreset } from "../../config.js";

/**
 * Shared, framework-owned decorative ornament layer.
 *
 * Every preset contributes exactly one inline SVG <g> keyed by
 * `data-vn-preset="<id>"`. The stage mounts a single `[data-vn-ornaments]`
 * layer (aria-hidden, pointer-events: none, z-index 1, below the
 * narrative/interaction content) and the active preset's CSS reveals only its
 * own group. Ornaments are pure local SVG: no <img>, no background url(), no
 * @import, no network fetch, no external fonts, no <foreignObject>.
 *
 * Colour is inherited: the layer sets `color: var(--vn-accent)` and each shape
 * uses `stroke="currentColor"` / `fill="currentColor"`, so ornament colour
 * follows the preset token automatically. Geometry lives in a 1600x900
 * viewBox that maps to the stage with `xMidYMid slice`; positions are
 * approximate ("intent, not pixel-contract"), aligned to a 16:9 stage and the
 * dialogue plate's approximate bounds.
 *
 * Every group opening tag is a single well-formed element: attributes are
 * closed, then comment lines and child shapes follow, and the group is closed
 * with a matching `</g>`.
 */

/** Four-point "sparkle" (✦) mark, centred on the origin. */
const SPARKLE_PATH = "M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z";
/** Small solid diamond (rotated square), centred on the origin. */
const DIAMOND_PATH = "M 0 -8 L 8 0 L 0 8 L -8 0 Z";

/**
 * The five ornament groups, keyed by the canonical preset id. The map is the
 * single source of truth for the ornament payload so a test can assert that
 * every preset id has exactly one non-empty, well-formed group.
 *
 * Sparkles wrap a static placement + transform on an OUTER <g> and animate an
 * INNER <g> (which carries no transform attribute), so CSS transform animation
 * (transform-box: fill-box) never overrides the placement translate/scale.
 * `data-vn-anim-delay` lets CSS stagger the twinkle.
 */
export const VN_ORNAMENT_GROUPS: Record<VisualNovelThemePreset, string> = {
  /* ------------------------------------------------------------------ */
  /* golden-hour — ambient sparkles, plate-corner diamonds, filigree     */
  /* ------------------------------------------------------------------ */
  "golden-hour": `<g data-vn-ornament-group="" data-vn-preset="golden-hour" aria-hidden="true" focusable="false" vector-effect="non-scaling-stroke" fill="none" stroke="currentColor">
    <!-- ambient twinkle sparkles drifting in the warm haze above the plate -->
    <g transform="translate(430 168) scale(1.1)" fill="currentColor" stroke="none" opacity="0.85"><g data-vn-anim="sparkle" data-vn-anim-delay="0s"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
    <g transform="translate(1190 128) scale(0.85)" fill="currentColor" stroke="none" opacity="0.55"><g data-vn-anim="sparkle" data-vn-anim-delay="0.6s"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
    <g transform="translate(660 306) scale(0.6)" fill="currentColor" stroke="none" opacity="0.42"><g data-vn-anim="sparkle" data-vn-anim-delay="1.2s"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
    <g transform="translate(1010 236) scale(0.5)" fill="currentColor" stroke="none" opacity="0.34"><g data-vn-anim="sparkle" data-vn-anim-delay="1.8s"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
    <!-- plate-corner diamonds planted at the lower margin, just below the plate -->
    <g transform="translate(70 884) scale(1.05)" fill="currentColor" stroke="none" opacity="0.92"><path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/></g>
    <g transform="translate(1530 884) scale(1.05)" fill="currentColor" stroke="none" opacity="0.92"><path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/></g>
    <!-- top-right sparkle near the plate's top-right shoulder -->
    <g transform="translate(1506 556) scale(1.0)" fill="currentColor" stroke="none" opacity="0.92"><g data-vn-anim="sparkle" data-vn-anim-delay="0.3s"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
    <!-- filigree rule with a centre diamond beneath the capsule (right-aligned accent) -->
    <g stroke="currentColor" opacity="0.8">
      <line x1="1130" y1="612" x2="1490" y2="612" stroke-width="1.5"/>
      <path transform="translate(1310 612)" fill="currentColor" stroke="none" d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/>
      <circle cx="1160" cy="612" r="2.4" fill="currentColor" stroke="none"/>
      <circle cx="1460" cy="612" r="2.4" fill="currentColor" stroke="none"/>
    </g>
  </g>`,

  /* ------------------------------------------------------------------ */
  /* boxed-console — HUD brackets, reticle, LEDs, grid, ready status     */
  /* ------------------------------------------------------------------ */
  "boxed-console": `<g data-vn-ornament-group="" data-vn-preset="boxed-console" aria-hidden="true" focusable="false" vector-effect="non-scaling-stroke" fill="none" stroke="currentColor">
    <!-- full-frame HUD corner brackets -->
    <g stroke-width="3" opacity="0.92">
      <path d="M 28 96 L 28 28 L 96 28"/>
      <path d="M 1504 28 L 1572 28 L 1572 96"/>
      <path d="M 1572 804 L 1572 872 L 1504 872"/>
      <path d="M 96 872 L 28 872 L 28 804"/>
    </g>
    <!-- thin inner HUD ticks just inside the brackets -->
    <g stroke-width="1.4" opacity="0.7">
      <path d="M 44 64 L 64 64 M 64 44 L 64 64"/>
      <path d="M 1536 64 L 1556 64 M 1536 44 L 1536 64"/>
      <path d="M 1536 836 L 1556 836 M 1536 836 L 1536 856"/>
      <path d="M 44 836 L 64 836 M 64 836 L 64 856"/>
    </g>
    <!-- targeting reticle near the speaker (top-left of plate) -->
    <g stroke-width="1.6" opacity="0.9">
      <circle cx="118" cy="640" r="16"/>
      <path d="M 118 612 L 118 628 M 118 652 L 118 668 M 90 640 L 106 640 M 130 640 L 146 640"/>
    </g>
    <!-- status LEDs row (top edge of plate) -->
    <g fill="currentColor" stroke="none" opacity="0.95">
      <circle cx="94" cy="568" r="4.5" data-vn-anim="led"/>
      <circle cx="114" cy="568" r="4.5" opacity="0.35"/>
      <circle cx="134" cy="568" r="4.5" opacity="0.18"/>
    </g>
    <!-- READY status mark (geometric bar + blinking block; never text) -->
    <g opacity="0.9">
      <rect x="90" y="544" width="42" height="4" fill="currentColor" stroke="none"/>
      <rect x="136" y="542" width="6" height="8" fill="currentColor" stroke="none" data-vn-anim="led" opacity="0.85"/>
    </g>
    <!-- faint grid reticle lines over the plate -->
    <g stroke-width="1" opacity="0.28">
      <path d="M 120 696 L 1480 696"/>
      <path d="M 120 816 L 1480 816"/>
      <path d="M 420 580 L 420 872"/>
    </g>
  </g>`,

  /* ------------------------------------------------------------------ */
  /* paper-novel — running-head rules, ink flourish, wax seal            */
  /* ------------------------------------------------------------------ */
  "paper-novel": `<g data-vn-ornament-group="" data-vn-preset="paper-novel" aria-hidden="true" focusable="false" vector-effect="non-scaling-stroke" fill="none" stroke="currentColor">
    <!-- running-head double rule under the top of the page -->
    <g stroke-width="1.1" opacity="0.72">
      <line x1="96" y1="596" x2="1504" y2="596"/>
      <line x1="140" y1="604" x2="1460" y2="604"/>
    </g>
    <!-- ink flourish / fleuron under the speaker -->
    <g stroke-width="1.4" opacity="0.8">
      <path d="M 96 660 C 136 636 176 684 232 660"/>
      <path d="M 232 660 C 288 636 328 684 368 660"/>
      <circle cx="232" cy="660" r="6" fill="currentColor" stroke="none"/>
      <circle cx="368" cy="660" r="3.4" fill="currentColor" stroke="none"/>
      <circle cx="96" cy="660" r="3.4" fill="currentColor" stroke="none"/>
    </g>
    <!-- oxblood wax-seal motif near the lower-right of the page -->
    <g opacity="0.92">
      <circle cx="1474" cy="840" r="26" fill="#8a2f23" stroke="none"/>
      <circle cx="1474" cy="840" r="19" fill="none" stroke="#5e1f16" stroke-width="1.4"/>
      <path d="M 1462 832 L 1474 826 L 1486 832" fill="none" stroke="#f8f1e3" stroke-width="1.6" opacity="0.7"/>
      <path d="M 1462 848 L 1474 854 L 1486 848" fill="none" stroke="#f8f1e3" stroke-width="1.6" opacity="0.7"/>
      <path d="M 1500 818 L 1496 828 L 1506 832" fill="none" stroke="#5e1f16" stroke-width="1.4"/>
    </g>
    <!-- corner fleurons -->
    <g transform="translate(96 596) scale(1.0)" fill="currentColor" stroke="none" opacity="0.55"><path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/></g>
    <g transform="translate(1504 596) scale(1.0)" fill="currentColor" stroke="none" opacity="0.55"><path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/></g>
    <!-- old-style double-rule footer marker (page counter lives on the real progress span) -->
    <g stroke-width="1.1" opacity="0.6">
      <line x1="700" y1="866" x2="900" y2="866"/>
    </g>
  </g>`,

  /* ------------------------------------------------------------------ */
  /* midnight-noir — letterbox bars, art-deco corners, sunburst          */
  /* ------------------------------------------------------------------ */
  "midnight-noir": `<g data-vn-ornament-group="" data-vn-preset="midnight-noir" aria-hidden="true" focusable="false" vector-effect="non-scaling-stroke" fill="none" stroke="currentColor">
    <!-- letterbox bars -->
    <g fill="#02040a" stroke="none">
      <rect x="0" y="0" width="1600" height="58"/>
      <rect x="0" y="842" width="1600" height="58"/>
    </g>
    <g stroke="currentColor" stroke-width="1.2" opacity="0.7">
      <line x1="0" y1="58" x2="1600" y2="58"/>
      <line x1="0" y1="842" x2="1600" y2="842"/>
    </g>
    <!-- art-deco stepped corners (ziggurat) -->
    <g stroke="currentColor" stroke-width="1.5" opacity="0.85">
      <path d="M 58 128 L 58 58 L 128 58"/>
      <path d="M 76 110 L 76 76 L 110 76"/>
      <path d="M 1542 58 L 1572 58 L 1572 88"/>
      <path d="M 1524 76 L 1554 76 L 1554 106"/>
      <path d="M 1506 94 L 1536 94 L 1536 124"/>
      <path d="M 1542 842 L 1572 842 L 1572 812"/>
      <path d="M 1524 824 L 1554 824 L 1554 794"/>
      <path d="M 1506 806 L 1536 806 L 1536 776"/>
      <path d="M 58 842 L 58 812 L 88 812"/>
      <path d="M 76 824 L 76 794 L 106 794"/>
      <path d="M 94 806 L 94 776 L 124 776"/>
    </g>
    <!-- sunburst fan, top-left and bottom-right -->
    <g stroke="currentColor" stroke-width="1.2" opacity="0.7">
      <path d="M 58 58 L 176 120 M 58 58 L 196 84 M 58 58 L 188 40"/>
      <path d="M 1542 842 L 1424 780 M 1542 842 L 1404 816 M 1542 842 L 1412 860"/>
    </g>
    <!-- corner glint diamonds -->
    <g transform="translate(88 88) scale(1.0)" fill="currentColor" stroke="none" opacity="0.85"><path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/></g>
    <g transform="translate(1512 812) scale(1.0)" fill="currentColor" stroke="none" opacity="0.85"><path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/></g>
  </g>`,

  /* ------------------------------------------------------------------ */
  /* lumiverse — restrained host-toned corner ticks + one sparkle        */
  /* ------------------------------------------------------------------ */
  lumiverse: `<g data-vn-ornament-group="" data-vn-preset="lumiverse" aria-hidden="true" focusable="false" vector-effect="non-scaling-stroke" fill="none" stroke="currentColor">
    <!-- fine-line corner ticks -->
    <g stroke-width="1.5" opacity="0.6">
      <path d="M 52 96 L 52 52 L 96 52"/>
      <path d="M 1504 52 L 1548 52 L 1548 96"/>
      <path d="M 1548 804 L 1548 848 L 1504 848"/>
      <path d="M 96 848 L 52 848 L 52 804"/>
    </g>
    <!-- one small 4-point sparkle, subtle -->
    <g transform="translate(1504 552) scale(0.9)" fill="currentColor" stroke="none" opacity="0.5"><g data-vn-anim="sparkle"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
  </g>`,
};

const INDENT = "\n        ";

/**
 * The single framework-owned decorative layer injected into THEME_MARKUP.
 * It is a direct child of `[data-vn-root]`, sits between the scene and the
 * narrative/interaction content (z-index 1), is invisible to assistive tech,
 * and never intercepts pointer events.
 */
export const VN_ORNAMENT_LAYER_MARKUP = `
  <div data-vn-ornaments aria-hidden="true" role="presentation">
    <svg width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
` + INDENT + Object.values(VN_ORNAMENT_GROUPS).join(INDENT) + `
    </svg>
  </div>`;
