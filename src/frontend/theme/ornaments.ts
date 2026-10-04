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
 * viewBox that maps to the stage with `xMidYMid slice`. Ornaments anchor to
 * the frame (corners, edges, open sky) only: the dialogue plate moves with
 * text length and viewport, so plate-hugging decoration lives in each
 * preset's CSS pseudo-elements on [data-vn-dialogue] instead.
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
 * The seven ornament groups, keyed by the canonical preset id. The map is the
 * single source of truth for the ornament payload so a test can assert that
 * every preset id has exactly one non-empty, well-formed group.
 *
 * Sparkles wrap a static placement + transform on an OUTER <g> and animate an
 * INNER <g> (which carries no transform attribute), so CSS transform animation
 * (transform-box: fill-box) never overrides the placement translate/scale.
 * `data-vn-anim-delay` lets CSS stagger the twinkle.
 */
export const VN_ORNAMENT_GROUPS: Record<VisualNovelThemePreset, string> = {
  "golden-hour": `<g data-vn-ornament-group="" data-vn-preset="golden-hour" aria-hidden="true" focusable="false" vector-effect="non-scaling-stroke" fill="none" stroke="currentColor">
    <!-- ambient twinkle sparkles drifting in the warm haze, upper scene only -->
    <g transform="translate(430 168) scale(1.1)" fill="currentColor" stroke="none" opacity="0.85"><g data-vn-anim="sparkle" data-vn-anim-delay="0s"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
    <g transform="translate(1190 128) scale(0.85)" fill="currentColor" stroke="none" opacity="0.55"><g data-vn-anim="sparkle" data-vn-anim-delay="0.6s"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
    <g transform="translate(660 306) scale(0.6)" fill="currentColor" stroke="none" opacity="0.42"><g data-vn-anim="sparkle" data-vn-anim-delay="1.2s"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
    <g transform="translate(1010 236) scale(0.5)" fill="currentColor" stroke="none" opacity="0.34"><g data-vn-anim="sparkle" data-vn-anim-delay="1.8s"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
    <g transform="translate(250 330) scale(0.55)" fill="currentColor" stroke="none" opacity="0.4"><g data-vn-anim="sparkle" data-vn-anim-delay="0.3s"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
    <!-- filigree frame corners (top): a scrolled gold line ending in a diamond -->
    <g stroke-width="1.4" opacity="0.7">
      <path d="M 40 170 L 40 70 Q 40 40 70 40 L 190 40"/>
      <path d="M 52 150 L 52 82 Q 52 52 82 52 L 150 52" opacity="0.6"/>
      <path d="M 1560 170 L 1560 70 Q 1560 40 1530 40 L 1410 40"/>
      <path d="M 1548 150 L 1548 82 Q 1548 52 1518 52 L 1450 52" opacity="0.6"/>
    </g>
    <g fill="currentColor" stroke="none" opacity="0.8">
      <path transform="translate(198 40) scale(0.6)" d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/>
      <path transform="translate(40 178) scale(0.6)" d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/>
      <path transform="translate(1402 40) scale(0.6)" d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/>
      <path transform="translate(1560 178) scale(0.6)" d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/>
    </g>
    <!-- lower frame-corner diamonds in the margin beside the plate -->
    <g transform="translate(26 884) scale(0.8)" fill="currentColor" stroke="none" opacity="0.7"><path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/></g>
    <g transform="translate(1574 884) scale(0.8)" fill="currentColor" stroke="none" opacity="0.7"><path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/></g>
  </g>`,
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
    <!-- edge rulers: tick scales down both sides of the frame -->
    <g stroke-width="1.2" opacity="0.45">
      <path d="M 28 180 L 28 480"/>
      <path d="M 28 200 L 40 200 M 28 240 L 36 240 M 28 280 L 40 280 M 28 320 L 36 320 M 28 360 L 40 360 M 28 400 L 36 400 M 28 440 L 40 440"/>
      <path d="M 1572 180 L 1572 480"/>
      <path d="M 1572 200 L 1560 200 M 1572 240 L 1564 240 M 1572 280 L 1560 280 M 1572 320 L 1564 320 M 1572 360 L 1560 360 M 1572 400 L 1564 400 M 1572 440 L 1560 440"/>
    </g>
    <!-- status LEDs stacked on the left ruler (geometric only; never text) -->
    <g fill="currentColor" stroke="none" opacity="0.95">
      <circle cx="52" cy="520" r="4.5" data-vn-anim="led"/>
      <circle cx="52" cy="540" r="4.5" opacity="0.35"/>
      <circle cx="52" cy="560" r="4.5" opacity="0.18"/>
      <rect x="46" y="150" width="4" height="22" opacity="0.8"/>
      <rect x="54" y="158" width="4" height="14" opacity="0.5"/>
      <rect x="62" y="164" width="4" height="8" opacity="0.3" data-vn-anim="led"/>
    </g>
  </g>`,
  "paper-novel": `<g data-vn-ornament-group="" data-vn-preset="paper-novel" aria-hidden="true" focusable="false" vector-effect="non-scaling-stroke" fill="none" stroke="currentColor">
    <!-- engraved frame corners: a double rule with a small fleuron diamond -->
    <g stroke-width="1.2" opacity="0.55">
      <path d="M 36 150 L 36 36 L 150 36"/>
      <path d="M 46 120 L 46 46 L 120 46"/>
      <path d="M 1564 150 L 1564 36 L 1450 36"/>
      <path d="M 1554 120 L 1554 46 L 1480 46"/>
    </g>
    <g stroke-width="1.2" opacity="0.45">
      <path d="M 60 60 C 80 64 92 76 96 96"/>
      <path d="M 1540 60 C 1520 64 1508 76 1504 96"/>
    </g>
    <g fill="currentColor" stroke="none" opacity="0.6">
      <path transform="translate(60 60) scale(0.55)" d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/>
      <path transform="translate(1540 60) scale(0.55)" d="M 0 -8 L 8 0 L 0 8 L -8 0 Z"/>
      <circle cx="158" cy="36" r="2.2"/>
      <circle cx="36" cy="158" r="2.2"/>
      <circle cx="1442" cy="36" r="2.2"/>
      <circle cx="1564" cy="158" r="2.2"/>
    </g>
  </g>`,
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
  "lumiverse": `<g data-vn-ornament-group="" data-vn-preset="lumiverse" aria-hidden="true" focusable="false" vector-effect="non-scaling-stroke" fill="none" stroke="currentColor">
    <!-- fine-line corner ticks -->
    <g stroke-width="1.5" opacity="0.6">
      <path d="M 52 96 L 52 52 L 96 52"/>
      <path d="M 1504 52 L 1548 52 L 1548 96"/>
      <path d="M 1548 804 L 1548 848 L 1504 848"/>
      <path d="M 96 848 L 52 848 L 52 804"/>
    </g>
    <!-- one small 4-point sparkle, subtle, in the open sky -->
    <g transform="translate(1500 170) scale(0.9)" fill="currentColor" stroke="none" opacity="0.5"><g data-vn-anim="sparkle"><path d="M 0 -12 L 2.6 -2.6 L 12 0 L 2.6 2.6 L 0 12 L -2.6 2.6 L -12 0 L -2.6 -2.6 Z"/></g></g>
  </g>`,
  "yamaku-classic": `<g data-vn-ornament-group="" data-vn-preset="yamaku-classic" aria-hidden="true" focusable="false" vector-effect="non-scaling-stroke" fill="none" stroke="currentColor">
    <!-- Warm classic corner framing brackets -->
    <g stroke="currentColor" stroke-width="1.8" opacity="0.45">
      <path d="M 64 104 L 64 64 L 104 64"/>
      <path d="M 1496 64 L 1536 64 L 1536 104"/>
      <path d="M 1536 796 L 1536 836 L 1496 836"/>
      <path d="M 104 836 L 64 836 L 64 796"/>
    </g>
  </g>`,
  "literature-club": `<g data-vn-ornament-group="" data-vn-preset="literature-club" aria-hidden="true" focusable="false" vector-effect="non-scaling-stroke" fill="currentColor" stroke="none">
    <!-- Sweet floating hearts along the open sides of the scene -->
    <g opacity="0.38" transform="translate(70 230) scale(1.1)"><path d="M 0 -4 C -4 -12 -14 -8 -14 0 C -14 7 0 14 0 16 C 0 14 14 7 14 0 C 14 -8 4 -12 0 -4 Z"/></g>
    <g opacity="0.3" transform="translate(1536 210) scale(0.85)"><path d="M 0 -4 C -4 -12 -14 -8 -14 0 C -14 7 0 14 0 16 C 0 14 14 7 14 0 C 14 -8 4 -12 0 -4 Z"/></g>
    <g opacity="0.24" transform="translate(1490 360) scale(0.6)"><path d="M 0 -4 C -4 -12 -14 -8 -14 0 C -14 7 0 14 0 16 C 0 14 14 7 14 0 C 14 -8 4 -12 0 -4 Z"/></g>
    <g opacity="0.22" transform="translate(120 380) scale(0.55)"><path d="M 0 -4 C -4 -12 -14 -8 -14 0 C -14 7 0 14 0 16 C 0 14 14 7 14 0 C 14 -8 4 -12 0 -4 Z"/></g>
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
