/**
 * Sprite mode stage layer (docs/SPRITE_MODE.md, "Stage").
 *
 * Draws the characters of one paragraph's SpriteParagraphStage into the
 * `[data-vn-sprites]` layer of the VN stage: one `[data-vn-sprite]` per actor,
 * bottom-anchored in a slot, sized from the stage height and the cut-out bbox.
 * Expression changes crossfade between two image layers per actor; motions,
 * emotes, light, focus, idle breathing and the talking bob are CSS driven
 * (src/frontend/theme/sprite-css.ts) through data attributes set here.
 *
 * The layer owns no plate: the stage paints plates through its scene image
 * layers and asks `plateFor(index)` which one to show.
 *
 * Facing rule: generated sprites are prompted "looking at viewer", so a
 * cut-out has no known side. We treat its natural orientation as
 * SPRITE_NATURAL_FACING ("left": front-facing or turned toward screen left)
 * and mirror it horizontally only when the staging asks for the other side
 * ("right"). "viewer" and "left" show the image as generated. Front-facing
 * sprites read the same either way; a sprite drawn turned to screen right
 * will face away when asked to face right (a per-image orientation field in
 * the library would fix that).
 */
import {
  bestAvailableExpression,
  SPRITE_HOT_SET,
  type PlateView,
  type SpriteActorStage,
  type SpriteEmote,
  type SpriteFacing,
  type SpriteImageView,
  type SpriteLight,
  type SpriteMotion,
  type SpriteParagraphStage,
  type SpriteSetView,
  type SpriteSlot,
  type SpriteTurnView,
} from "../../shared/sprites.js";

/** Natural orientation assumed for every cut-out (see the file comment). */
export const SPRITE_NATURAL_FACING: Exclude<SpriteFacing, "viewer"> = "left";

/** Fallback pixel size of a cut-out when the view does not say (NovelAI portrait). */
export const SPRITE_DEFAULT_SIZE = { width: 832, height: 1216 } as const;

/** How long one-shot motions run before their attribute is removed (ms). */
export const SPRITE_MOTION_DURATION_MS: Readonly<Record<SpriteMotion, number>> = {
  none: 0,
  hop: 560,
  bounce: 820,
  shake: 520,
  tremble: 1100,
  step_back: 760,
  lean_in: 820,
  nod: 720,
  turn_away: 900,
  sink: 1100,
};

export const SPRITE_ENTER_MS = 460;
export const SPRITE_EXIT_MS = 420;
export const SPRITE_CROSSFADE_MS = 260;
export const SPRITE_EMOTE_POP_MS = 420;

/** Paragraphs ahead whose sprites and plate are preloaded. */
export const SPRITE_PRELOAD_AHEAD = 2;

/* ------------------------------------------------------------------------ */
/* Pure helpers (unit tested)                                                */
/* ------------------------------------------------------------------------ */

const SLOT_ORDER: Readonly<Record<SpriteSlot, number>> = { left: 0, center: 1, right: 2 };

/** Horizontal anchor (percent of the stage width) for one actor alone, by slot. */
const SOLO_X: Readonly<Record<SpriteSlot, number>> = { left: 32, center: 50, right: 68 };
/** Anchors for 2 and 3 actors, left to right in slot order. */
const GROUP_X: Readonly<Record<number, readonly number[]>> = { 2: [30, 70], 3: [19, 50, 81] };

export type SpriteActorPlacement = {
  actor: SpriteActorStage;
  /** Anchor x in percent of the stage width (bbox bottom-centre of the figure). */
  x: number;
  /** 0-based position left to right. */
  order: number;
};

/**
 * Slot layout: one actor stands at its slot (centre, or a little off centre
 * for left/right); two stand at 30% / 70%; three at 19% / 50% / 81%, in slot
 * order. Duplicate keys and actors beyond the third are dropped.
 */
export function layoutSpriteActors(actors: readonly SpriteActorStage[]): SpriteActorPlacement[] {
  const seen = new Set<string>();
  const unique = actors.filter((actor) => {
    if (seen.has(actor.characterKey)) return false;
    seen.add(actor.characterKey);
    return true;
  }).slice(0, 3);
  const sorted = unique
    .map((actor, index) => ({ actor, index }))
    .sort((a, b) => (SLOT_ORDER[a.actor.slot] ?? 1) - (SLOT_ORDER[b.actor.slot] ?? 1) || a.index - b.index)
    .map(({ actor }) => actor);
  if (sorted.length === 1) {
    const actor = sorted[0]!;
    return [{ actor, x: SOLO_X[actor.slot] ?? 50, order: 0 }];
  }
  const xs = GROUP_X[sorted.length] ?? [];
  return sorted.map((actor, order) => ({ actor, x: xs[order] ?? 50, order }));
}

/** Expressions of a set that can be shown now (ready and with a URL). */
export function readySpriteExpressions(set: SpriteSetView | undefined | null): Set<string> {
  const ready = new Set<string>();
  if (!set) return ready;
  for (const [id, image] of Object.entries(set.expressions)) {
    if (image && image.status === "ready" && typeof image.url === "string" && image.url) ready.add(id);
  }
  return ready;
}

/**
 * The image to show for a requested expression: the requested sprite when it
 * is ready, else `bestAvailableExpression` (hot-set fallback, idle, any
 * ready). Null when nothing of the set is ready.
 */
export function resolveSpriteImage(
  set: SpriteSetView | undefined | null,
  requested: string,
): (SpriteImageView & { url: string }) | null {
  if (!set) return null;
  const chosen = bestAvailableExpression(requested, readySpriteExpressions(set));
  if (!chosen) return null;
  const image = set.expressions[chosen];
  if (!image || !image.url) return null;
  return { ...image, expression: image.expression || chosen, url: image.url };
}

/** The plate in effect at a paragraph: its own plateKey, else the latest earlier one. */
export function effectivePlateKey(view: SpriteTurnView | null, index: number): string | null {
  if (!view) return null;
  const paragraphs = view.staging.paragraphs;
  for (let i = Math.min(index, paragraphs.length - 1); i >= 0; i -= 1) {
    const key = paragraphs[i]?.plateKey;
    if (key) return key;
  }
  return null;
}

/** The staged paragraph in effect at an index (the last one for indexes past the end). */
export function stagedParagraph(view: SpriteTurnView | null, index: number): SpriteParagraphStage | null {
  if (!view || view.staging.paragraphs.length === 0) return null;
  const paragraphs = view.staging.paragraphs;
  return paragraphs[Math.max(0, Math.min(index, paragraphs.length - 1))] ?? null;
}

export type SpriteGeometry = {
  /** Image aspect (width / height). */
  aspect: number;
  /** Image height per figure height: 1 / bbox height. */
  scale: number;
  /** Image height per figure width: 1 / (bbox width * aspect). */
  fit: number;
  /** Bbox centre x and bottom y, normalized. */
  cx: number;
  by: number;
  /** Bbox width and height, normalized. */
  bw: number;
  bh: number;
};

const finite = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Geometry the CSS needs to bottom-anchor and size one cut-out (see sprite-css.ts). */
export function spriteGeometry(image: Pick<SpriteImageView, "bbox" | "width" | "height">): SpriteGeometry {
  const width = finite(image.width, 0) > 0 ? image.width! : SPRITE_DEFAULT_SIZE.width;
  const height = finite(image.height, 0) > 0 ? image.height! : SPRITE_DEFAULT_SIZE.height;
  const aspect = width / height;
  let [x, y, w, h] = Array.isArray(image.bbox) && image.bbox.length === 4
    ? image.bbox.map((v, i) => finite(v, i < 2 ? 0 : 1))
    : [0, 0, 1, 1];
  x = clamp01(x ?? 0);
  y = clamp01(y ?? 0);
  w = Math.max(0.05, Math.min(1 - x, w ?? 1));
  h = Math.max(0.05, Math.min(1 - y, h ?? 1));
  return { aspect, scale: 1 / h, fit: 1 / (w * aspect), cx: x + w / 2, by: y + h, bw: w, bh: h };
}

const round = (value: number): string => String(Math.round(value * 10000) / 10000);

/** CSS custom properties for a geometry. */
export function spriteGeometryVars(geometry: SpriteGeometry): Record<string, string> {
  return {
    "--vn-sprite-a": round(geometry.aspect),
    "--vn-sprite-s": round(geometry.scale),
    "--vn-sprite-k": round(geometry.fit),
    "--vn-sprite-cx": round(geometry.cx),
    "--vn-sprite-by": round(geometry.by),
    "--vn-sprite-bw": round(geometry.bw),
    "--vn-sprite-bh": round(geometry.bh),
  };
}

/** Whether the requested facing mirrors the cut-out (see SPRITE_NATURAL_FACING). */
export function spriteMirrored(facing: SpriteFacing | undefined): boolean {
  return facing !== undefined && facing !== "viewer" && facing !== SPRITE_NATURAL_FACING;
}

export type SpriteStatusBadge = {
  kind: "image" | "warning";
  label: string;
  characterKey: string;
};

const castName = (view: SpriteTurnView, key: string): string =>
  view.staging.cast.find((member) => member.characterKey === key)?.name ?? view.sets[key]?.name ?? key;

/**
 * Badges for actors of a paragraph that cannot be shown yet: "Preparing Mira
 * 3/12" while the set has nothing ready, or a warning when every image of
 * the set failed. Sets with at least one ready sprite need no badge.
 */
export function spriteStatusBadges(view: SpriteTurnView | null, index: number): SpriteStatusBadge[] {
  const stage = stagedParagraph(view, index);
  if (!view || !stage) return [];
  const badges: SpriteStatusBadge[] = [];
  for (const { actor } of layoutSpriteActors(stage.actors)) {
    const set = view.sets[actor.characterKey];
    if (readySpriteExpressions(set).size > 0) continue;
    const name = castName(view, actor.characterKey);
    const images = Object.values(set?.expressions ?? {});
    const total = Math.max(SPRITE_HOT_SET.length, images.length);
    const ready = set ? Math.max(0, Math.min(total, set.readyCount)) : 0;
    const allFailed = images.length > 0 && images.every((image) => image.status === "failed");
    badges.push(allFailed
      ? { kind: "warning", label: `Could not prepare ${name}`, characterKey: actor.characterKey }
      : { kind: "image", label: `Preparing ${name} ${ready}/${total}`, characterKey: actor.characterKey });
  }
  return badges;
}

/** URLs to preload for the paragraphs after `index` (sprites, then plates). */
export function spritePreloadUrls(view: SpriteTurnView | null, index: number, ahead = SPRITE_PRELOAD_AHEAD): string[] {
  if (!view) return [];
  const urls: string[] = [];
  const add = (url: string | undefined) => { if (url && !urls.includes(url)) urls.push(url); };
  for (let i = index + 1; i <= index + ahead && i < view.staging.paragraphs.length; i += 1) {
    const stage = view.staging.paragraphs[i]!;
    for (const actor of stage.actors) add(resolveSpriteImage(view.sets[actor.characterKey], actor.expression)?.url);
    const plateKey = effectivePlateKey(view, i);
    const plate = plateKey ? view.plates[plateKey] : undefined;
    if (plate?.status === "ready") add(plate.url);
  }
  return urls;
}

/** Copy of a turn view with one sprite image replaced in every set with `setKey`. */
export function withSpriteImage(view: SpriteTurnView, setKey: string, image: SpriteImageView): { view: SpriteTurnView; changed: string[] } {
  const changed: string[] = [];
  const sets: Record<string, SpriteSetView> = {};
  for (const [characterKey, set] of Object.entries(view.sets)) {
    if (set.setKey !== setKey || !image.expression) {
      sets[characterKey] = set;
      continue;
    }
    const expressions = { ...set.expressions, [image.expression]: image };
    const readyCount = SPRITE_HOT_SET.filter((id) => expressions[id]?.status === "ready" && expressions[id]?.url).length;
    sets[characterKey] = { ...set, expressions, readyCount };
    changed.push(characterKey);
  }
  return { view: changed.length ? { ...view, sets } : view, changed };
}

/** Copy of a turn view with one plate replaced (only plates the turn knows). */
export function withPlate(view: SpriteTurnView, plate: PlateView): { view: SpriteTurnView; changed: boolean } {
  if (!view.plates[plate.plateKey] && !view.staging.plates.some((ref) => ref.plateKey === plate.plateKey)) {
    return { view, changed: false };
  }
  return { view: { ...view, plates: { ...view.plates, [plate.plateKey]: plate } }, changed: true };
}

/* ------------------------------------------------------------------------ */
/* Emote marks (inline SVG, decorative)                                      */
/* ------------------------------------------------------------------------ */

/** Where an emote sits relative to the head: beside it, above it, or on the face. */
export const SPRITE_EMOTE_PLACE: Readonly<Record<Exclude<SpriteEmote, "none">, "side" | "top" | "face">> = {
  sweat: "side",
  anger: "side",
  heart: "side",
  sparkle: "side",
  exclaim: "side",
  question: "side",
  ellipsis: "side",
  music: "side",
  gloom: "top",
  blush: "face",
};

const EMOTE_SVG: Readonly<Record<Exclude<SpriteEmote, "none">, string>> = {
  sweat: `<path d="M24 4C24 4 11 20 11 29.5a13 13 0 0 0 26 0C37 20 24 4 24 4z" fill="#9ad6ff" stroke="#2d6fae" stroke-width="2.6" stroke-linejoin="round"/><path d="M17.5 29a7 7 0 0 0 4.5 7.5" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/>`,
  anger: `<g fill="none" stroke="#e5323a" stroke-width="5.5" stroke-linecap="round"><path d="M20 6c0 9-4 14-14 14"/><path d="M28 6c0 9 4 14 14 14"/><path d="M20 42c0-9-4-14-14-14"/><path d="M28 42c0-9 4-14 14-14"/></g>`,
  heart: `<path d="M24 42S5 30.5 5 17.5a9.5 9.5 0 0 1 19-3.2 9.5 9.5 0 0 1 19 3.2C43 30.5 24 42 24 42z" fill="#ff6c9d" stroke="#b8164f" stroke-width="2.6" stroke-linejoin="round"/><path d="M12 15.5a4.5 4.5 0 0 1 5-3.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>`,
  sparkle: `<path d="M19 3l3.4 12.6L35 19l-12.6 3.4L19 35l-3.4-12.6L3 19l12.6-3.4z" fill="#ffe06b" stroke="#c98a00" stroke-width="1.8" stroke-linejoin="round"/><path d="M37 27l1.8 6.2L45 35l-6.2 1.8L37 43l-1.8-6.2L29 35l6.2-1.8z" fill="#fff4bd" stroke="#c98a00" stroke-width="1.4" stroke-linejoin="round"/>`,
  exclaim: `<path d="M19.5 4h10l-2.6 25.5h-4.8z" fill="#ffd23f" stroke="#6e3500" stroke-width="2.6" stroke-linejoin="round"/><circle cx="24.5" cy="39" r="4.8" fill="#ffd23f" stroke="#6e3500" stroke-width="2.6"/>`,
  question: `<path d="M14.5 16.5a9.8 9.8 0 1 1 14.6 8.6c-3.2 1.7-4.1 3.4-4.1 7" fill="none" stroke="#1f4f86" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 16.5a9.8 9.8 0 1 1 14.6 8.6c-3.2 1.7-4.1 3.4-4.1 7" fill="none" stroke="#7cc2ff" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="25" cy="41" r="4.4" fill="#7cc2ff" stroke="#1f4f86" stroke-width="2.2"/>`,
  ellipsis: `<path d="M8 8h32a5 5 0 0 1 5 5v15a5 5 0 0 1-5 5H23l-9 8v-8H8a5 5 0 0 1-5-5V13a5 5 0 0 1 5-5z" fill="#fff" stroke="#2c2c34" stroke-width="2.6" stroke-linejoin="round"/><g fill="#2c2c34"><circle cx="14.5" cy="20.5" r="3"/><circle cx="24" cy="20.5" r="3"/><circle cx="33.5" cy="20.5" r="3"/></g>`,
  music: `<path d="M18 35V11l21-6v24" fill="none" stroke="#6d43e8" stroke-width="3.6" stroke-linejoin="round"/><path d="M18 17l21-6" stroke="#6d43e8" stroke-width="3.6"/><ellipse cx="13" cy="35.5" rx="6" ry="4.6" fill="#6d43e8"/><ellipse cx="34" cy="29.5" rx="6" ry="4.6" fill="#6d43e8"/>`,
  gloom: `<g fill="none" stroke="#3d335f" stroke-linecap="round"><path d="M6 4v18" stroke-width="2.6" opacity=".55"/><path d="M13 4v28" stroke-width="3" opacity=".8"/><path d="M20 4v22" stroke-width="2.6" opacity=".6"/><path d="M28 4v30" stroke-width="3" opacity=".85"/><path d="M35 4v20" stroke-width="2.6" opacity=".6"/><path d="M42 4v26" stroke-width="3" opacity=".75"/></g>`,
  blush: `<ellipse cx="11" cy="26" rx="9" ry="5.5" fill="#ff7aa8" opacity=".5"/><ellipse cx="37" cy="26" rx="9" ry="5.5" fill="#ff7aa8" opacity=".5"/><g stroke="#e0447a" stroke-width="2.2" stroke-linecap="round"><path d="M6 30l3.5-7"/><path d="M11 30l3.5-7"/><path d="M33 30l3.5-7"/><path d="M38 30l3.5-7"/></g>`,
};

/** Inline SVG markup for an emote ("" for "none"). Decorative: aria-hidden, not focusable. */
export function spriteEmoteMarkup(emote: SpriteEmote): string {
  if (emote === "none") return "";
  const body = EMOTE_SVG[emote];
  if (!body) return "";
  return `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false" data-vn-sprite-emote-mark="${emote}">${body}</svg>`;
}

/* ------------------------------------------------------------------------ */
/* DOM layer                                                                 */
/* ------------------------------------------------------------------------ */

export type SpriteLayerOptions = {
  /** The `[data-vn-sprites]` element. Resolved lazily so scene mode never touches it. */
  container: () => HTMLElement;
  /** Load (and decode) an image before it is shown. Resolves when it can be painted. */
  loadImage?: (url: string) => Promise<void>;
  /** Called when badge-relevant state changes (sprite readiness, staged actors). */
  onStatusChange?: () => void;
};

export type SpriteShowOptions = {
  /** Play one-shot motions and emote pop-ins (false on rewind, skip, effects off). */
  animate: boolean;
  /** Nameplate of the paragraph; the focused actor with this name gets the talking bob. */
  speaker?: string | undefined;
};

export type SpriteActorSnapshot = {
  characterKey: string;
  name: string;
  slot: SpriteSlot;
  x: number;
  requestedExpression: string;
  /** Expression actually shown (after fallback), or null while nothing of the set is ready. */
  shownExpression: string | null;
  url: string | null;
  focus: boolean;
  facing: SpriteFacing;
  mirrored: boolean;
  motion: SpriteMotion;
  emote: SpriteEmote;
  intensity: number;
  talking: boolean;
};

export type SpriteLayerSnapshot = {
  enabled: boolean;
  index: number;
  light: SpriteLight | null;
  plateKey: string | null;
  actors: SpriteActorSnapshot[];
  badges: SpriteStatusBadge[];
};

type ActorEntry = {
  key: string;
  el: HTMLElement;
  body: HTMLElement;
  figure: HTMLElement;
  emote: HTMLElement;
  layers: [HTMLElement, HTMLElement];
  active: 0 | 1;
  url: string | null;
  shownExpression: string | null;
  stage: SpriteActorStage;
  x: number;
  emoteName: SpriteEmote;
  talking: boolean;
  token: number;
  exiting: boolean;
  exitTimer: ReturnType<typeof setTimeout> | null;
  motionTimer: ReturnType<typeof setTimeout> | null;
  emoteTimer: ReturnType<typeof setTimeout> | null;
  enterTimer: ReturnType<typeof setTimeout> | null;
  fadeTimer: ReturnType<typeof setTimeout> | null;
};

const reflow = (element: HTMLElement): void => {
  if (typeof element.offsetWidth === "number") void element.offsetWidth;
};

const setVars = (element: HTMLElement, vars: Record<string, string>): void => {
  const style = element.style as CSSStyleDeclaration | undefined;
  if (!style) return;
  for (const [name, value] of Object.entries(vars)) {
    if (typeof style.setProperty === "function") style.setProperty(name, value);
    else (style as unknown as Record<string, string>)[name] = value;
  }
};

const cssUrl = (url: string): string => `url("${url.replace(/[\\"]/g, "\\$&").replace(/[\n\r\f]/g, "")}")`;

export class SpriteLayer {
  private view: SpriteTurnView | null = null;
  private enabled = false;
  private index = -1;
  private appliedView: SpriteTurnView | null = null;
  private stage: SpriteParagraphStage | null = null;
  private speaker = "";
  private talking = false;
  private readonly actors = new Map<string, ActorEntry>();
  private readonly loaded = new Set<string>();
  private readonly preloaded = new Set<string>();
  private destroyed = false;
  /** Resolved on first use, so scene mode never creates or touches the layer. */
  private containerEl: HTMLElement | null = null;

  constructor(private readonly options: SpriteLayerOptions) {}

  /* ---- data ---------------------------------------------------------- */

  getView(): SpriteTurnView | null {
    return this.view;
  }

  /**
   * Replace the turn's sprite view. Applied the next time `show` runs (the
   * stage calls it on every render), so a new turn and its first paragraph
   * land together.
   */
  setTurn(view: SpriteTurnView | null): void {
    this.view = view;
  }

  /** One sprite image changed. Returns true when an actor on stage uses that set. */
  updateImage(setKey: string, image: SpriteImageView): boolean {
    if (!this.view) return false;
    const { view, changed } = withSpriteImage(this.view, setKey, image);
    if (changed.length === 0) return false;
    this.view = view;
    this.appliedView = view;
    let onStage = false;
    for (const key of changed) {
      const entry = this.actors.get(key);
      if (!entry || entry.exiting) continue;
      onStage = true;
      if (this.enabled) this.refreshActorImage(entry);
    }
    this.options.onStatusChange?.();
    return onStage;
  }

  /** One plate changed. Returns true when the turn knows that plate. */
  updatePlate(plate: PlateView): boolean {
    if (!this.view) return false;
    const { view, changed } = withPlate(this.view, plate);
    if (!changed) return false;
    this.view = view;
    if (this.appliedView) this.appliedView = view;
    return true;
  }

  /** The plate in effect at a paragraph (any status), or null. */
  plateFor(index: number): PlateView | null {
    const key = effectivePlateKey(this.view, index);
    return key ? this.view?.plates[key] ?? null : null;
  }

  badges(index = this.index): SpriteStatusBadge[] {
    if (!this.enabled || index < 0) return [];
    return spriteStatusBadges(this.view, index);
  }

  /* ---- presentation -------------------------------------------------- */

  /** Paragraph index last applied, or -1. */
  currentIndex(): number {
    return this.index;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Show or hide the layer. Disabling removes every actor (no stale layers). */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.clear();
    else this.container().hidden = false;
  }

  /** Remove every actor immediately and forget what was applied. */
  clear(): void {
    for (const entry of this.actors.values()) this.disposeActor(entry);
    this.actors.clear();
    this.index = -1;
    this.appliedView = null;
    this.stage = null;
    this.talking = false;
    if (this.enabled || this.containerEl) {
      const container = this.container();
      container.replaceChildren();
      delete container.dataset.vnSpriteLight;
      container.dataset.vnSpriteCount = "0";
      container.hidden = !this.enabled;
    }
    this.options.onStatusChange?.();
  }

  /**
   * Apply paragraph `index` of the staging. Idempotent: the same paragraph of
   * the same view is applied once, so the stage may call this on every render.
   */
  show(index: number, options: SpriteShowOptions): void {
    if (this.destroyed || !this.enabled) return;
    const view = this.view;
    if (!view) {
      if (this.actors.size > 0 || this.index !== -1) this.clear();
      return;
    }
    if (index === this.index && view === this.appliedView) {
      this.speaker = (options.speaker ?? "").trim();
      return;
    }
    const staged = stagedParagraph(view, index);
    // Past the staged range (e.g. the reader's own line) keep the last stage.
    const keepCurrent = index >= view.staging.paragraphs.length && this.appliedView === view && this.stage !== null;
    this.index = index;
    this.appliedView = view;
    this.speaker = (options.speaker ?? "").trim();
    if (keepCurrent) return;
    this.stage = staged;
    this.applyStage(staged, options.animate);
    this.preload(view, index);
    this.options.onStatusChange?.();
  }

  /** Talking bob on the focused speaker while the line types out. */
  setTalking(talking: boolean): void {
    this.talking = talking;
    for (const entry of this.actors.values()) this.syncTalking(entry);
  }

  snapshot(): SpriteLayerSnapshot {
    const view = this.view;
    const actors: SpriteActorSnapshot[] = [];
    for (const entry of this.actors.values()) {
      if (entry.exiting) continue;
      actors.push({
        characterKey: entry.key,
        name: view ? castName(view, entry.key) : entry.key,
        slot: entry.stage.slot,
        x: entry.x,
        requestedExpression: entry.stage.expression,
        shownExpression: entry.shownExpression,
        url: entry.url,
        focus: entry.stage.focus,
        facing: entry.stage.facing,
        mirrored: spriteMirrored(entry.stage.facing),
        motion: entry.stage.motion,
        emote: entry.emoteName,
        intensity: entry.stage.intensity,
        talking: entry.talking,
      });
    }
    actors.sort((a, b) => a.x - b.x);
    return {
      enabled: this.enabled,
      index: this.index,
      light: this.stage?.light ?? null,
      plateKey: this.index >= 0 ? effectivePlateKey(view, this.index) : null,
      actors,
      badges: this.badges(),
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    for (const entry of this.actors.values()) this.disposeActor(entry);
    this.actors.clear();
    this.destroyed = true;
  }

  /* ---- internals ----------------------------------------------------- */

  private container(): HTMLElement {
    this.containerEl ??= this.options.container();
    return this.containerEl;
  }

  private applyStage(stage: SpriteParagraphStage | null, animate: boolean): void {
    const container = this.container();
    container.hidden = false;
    const placements = stage ? layoutSpriteActors(stage.actors) : [];
    if (stage) container.dataset.vnSpriteLight = stage.light;
    else delete container.dataset.vnSpriteLight;
    container.dataset.vnSpriteCount = String(placements.length);
    const anyFocus = placements.some(({ actor }) => actor.focus);
    const keep = new Set(placements.map(({ actor }) => actor.characterKey));

    for (const entry of [...this.actors.values()]) {
      if (!keep.has(entry.key)) this.exitActor(entry, animate);
    }

    placements.forEach(({ actor, x, order }) => {
      let entry = this.actors.get(actor.characterKey);
      const isNew = !entry || entry.exiting;
      if (entry && entry.exiting) this.cancelExit(entry);
      if (!entry) {
        entry = this.createActor(actor.characterKey);
        this.actors.set(actor.characterKey, entry);
        container.append(entry.el);
      }
      entry.stage = actor;
      entry.x = x;
      const el = entry.el;
      el.dataset.vnSpriteSlot = actor.slot;
      el.dataset.vnSpriteOrder = String(order);
      el.dataset.vnSpriteFacing = actor.facing;
      el.dataset.vnSpriteMirrored = String(spriteMirrored(actor.facing));
      el.dataset.vnSpriteFocus = actor.focus ? "true" : "false";
      el.dataset.vnSpriteDim = anyFocus && !actor.focus ? "true" : "false";
      setVars(el, {
        "--vn-sprite-x": `${x}%`,
        "--vn-sprite-amp": String(Math.round((actor.intensity / 3) * 100) / 100),
      });
      if (isNew) {
        el.dataset.vnSpriteState = "waiting";
      }
      this.refreshActorImage(entry, isNew && animate);
      this.applyEmote(entry, actor.emote, animate);
      if (animate) this.playMotion(entry, actor.motion);
      this.syncTalking(entry);
    });
  }

  private createActor(key: string): ActorEntry {
    const el = document.createElement("div");
    el.setAttribute("data-vn-sprite", "");
    el.dataset.vnSpriteKey = key;
    el.setAttribute("aria-hidden", "true");
    const body = document.createElement("div");
    body.setAttribute("data-vn-sprite-body", "");
    const figure = document.createElement("div");
    figure.setAttribute("data-vn-sprite-figure", "");
    const makeLayer = (role: "active" | "idle"): HTMLElement => {
      const layer = document.createElement("div");
      layer.setAttribute("data-vn-sprite-image", "");
      layer.dataset.vnSpriteLayer = role;
      layer.dataset.vnEmpty = "true";
      const img = document.createElement("img");
      img.setAttribute("alt", "");
      img.setAttribute("draggable", "false");
      img.setAttribute("decoding", "async");
      layer.append(img);
      return layer;
    };
    const layers: [HTMLElement, HTMLElement] = [makeLayer("active"), makeLayer("idle")];
    figure.append(layers[0], layers[1]);
    const emote = document.createElement("span");
    emote.setAttribute("data-vn-sprite-emote", "");
    emote.hidden = true;
    body.append(figure, emote);
    el.append(body);
    return {
      key, el, body, figure, emote, layers, active: 0, url: null, shownExpression: null,
      stage: { characterKey: key, expression: "idle", slot: "center", facing: "viewer", focus: false, motion: "none", emote: "none", intensity: 3 },
      x: 50, emoteName: "none", talking: false, token: 0, exiting: false,
      exitTimer: null, motionTimer: null, emoteTimer: null, enterTimer: null, fadeTimer: null,
    };
  }

  /** Show the best available image for the actor's requested expression. */
  private refreshActorImage(entry: ActorEntry, enter = false): void {
    const set = this.view?.sets[entry.key];
    const image = resolveSpriteImage(set, entry.stage.expression);
    if (!image) {
      // Nothing of the set is ready: no sprite (the stage shows a badge).
      entry.token += 1;
      entry.url = null;
      entry.shownExpression = null;
      entry.el.dataset.vnSpriteState = "waiting";
      for (const layer of entry.layers) this.emptyLayer(layer);
      return;
    }
    const vars = spriteGeometryVars(spriteGeometry(image));
    if (entry.url === image.url) {
      entry.shownExpression = image.expression;
      setVars(entry.layers[entry.active], vars);
      setVars(entry.el, vars);
      return;
    }
    const token = ++entry.token;
    const firstImage = entry.url === null;
    entry.url = image.url;
    entry.shownExpression = image.expression;
    const apply = () => {
      if (this.destroyed || token !== entry.token) return;
      if (firstImage) this.paintFirst(entry, image.url, image.expression, vars, enter);
      else this.crossfade(entry, image.url, image.expression, vars);
    };
    if (this.loaded.has(image.url) || !this.options.loadImage) {
      this.loaded.add(image.url);
      apply();
      return;
    }
    this.options.loadImage(image.url).then(
      () => { this.loaded.add(image.url); apply(); },
      () => {
        // A broken sprite URL: keep what is shown; a later update may fix it.
        if (token !== entry.token) return;
        entry.url = firstImage ? null : entry.url;
      },
    );
  }

  private fillLayer(layer: HTMLElement, url: string, expression: string, vars: Record<string, string>): void {
    const img = layer.querySelector("img") as HTMLImageElement | null;
    if (img && img.getAttribute("src") !== url) img.setAttribute("src", url);
    layer.dataset.vnEmpty = "false";
    layer.dataset.vnSpriteExpression = expression;
    setVars(layer, { ...vars, "--vn-sprite-mask": cssUrl(url) });
  }

  private emptyLayer(layer: HTMLElement): void {
    const img = layer.querySelector("img") as HTMLImageElement | null;
    img?.removeAttribute("src");
    layer.dataset.vnEmpty = "true";
    delete layer.dataset.vnSpriteExpression;
  }

  private paintFirst(entry: ActorEntry, url: string, expression: string, vars: Record<string, string>, enter: boolean): void {
    const layer = entry.layers[entry.active];
    this.fillLayer(layer, url, expression, vars);
    layer.dataset.vnSpriteLayer = "active";
    entry.layers[entry.active === 0 ? 1 : 0].dataset.vnSpriteLayer = "idle";
    setVars(entry.el, vars);
    if (entry.enterTimer) clearTimeout(entry.enterTimer);
    entry.enterTimer = null;
    if (enter) {
      entry.el.dataset.vnSpriteState = "entering";
      reflow(entry.el);
      entry.enterTimer = setTimeout(() => {
        entry.enterTimer = null;
        if (entry.el.dataset.vnSpriteState === "entering") entry.el.dataset.vnSpriteState = "shown";
      }, SPRITE_ENTER_MS);
    } else {
      entry.el.dataset.vnSpriteState = "shown";
    }
  }

  private crossfade(entry: ActorEntry, url: string, expression: string, vars: Record<string, string>): void {
    const next: 0 | 1 = entry.active === 0 ? 1 : 0;
    const incoming = entry.layers[next];
    const outgoing = entry.layers[entry.active];
    this.fillLayer(incoming, url, expression, vars);
    incoming.dataset.vnSpriteLayer = "active";
    outgoing.dataset.vnSpriteLayer = "leaving";
    entry.active = next;
    setVars(entry.el, vars);
    if (entry.el.dataset.vnSpriteState === "waiting") entry.el.dataset.vnSpriteState = "shown";
    if (entry.fadeTimer) clearTimeout(entry.fadeTimer);
    entry.fadeTimer = setTimeout(() => {
      entry.fadeTimer = null;
      if (outgoing.dataset.vnSpriteLayer === "leaving") outgoing.dataset.vnSpriteLayer = "idle";
    }, SPRITE_CROSSFADE_MS + 40);
  }

  private applyEmote(entry: ActorEntry, emote: SpriteEmote, animate: boolean): void {
    if (entry.emoteName === emote) return;
    entry.emoteName = emote;
    if (entry.emoteTimer) clearTimeout(entry.emoteTimer);
    entry.emoteTimer = null;
    const markup = spriteEmoteMarkup(emote);
    entry.emote.innerHTML = markup;
    if (!markup) {
      entry.emote.hidden = true;
      delete entry.emote.dataset.vnSpriteEmoteName;
      delete entry.emote.dataset.vnSpriteEmotePlace;
      delete entry.emote.dataset.vnSpriteEmotePop;
      return;
    }
    entry.emote.hidden = false;
    entry.emote.dataset.vnSpriteEmoteName = emote;
    entry.emote.dataset.vnSpriteEmotePlace = SPRITE_EMOTE_PLACE[emote as Exclude<SpriteEmote, "none">];
    delete entry.emote.dataset.vnSpriteEmotePop;
    if (animate) {
      reflow(entry.emote);
      entry.emote.dataset.vnSpriteEmotePop = "true";
      entry.emoteTimer = setTimeout(() => {
        entry.emoteTimer = null;
        delete entry.emote.dataset.vnSpriteEmotePop;
      }, SPRITE_EMOTE_POP_MS);
    }
  }

  private playMotion(entry: ActorEntry, motion: SpriteMotion): void {
    if (entry.motionTimer) clearTimeout(entry.motionTimer);
    entry.motionTimer = null;
    delete entry.body.dataset.vnSpriteMotion;
    if (motion === "none") return;
    reflow(entry.body);
    entry.body.dataset.vnSpriteMotion = motion;
    entry.motionTimer = setTimeout(() => {
      entry.motionTimer = null;
      delete entry.body.dataset.vnSpriteMotion;
    }, SPRITE_MOTION_DURATION_MS[motion] + 60);
  }

  private syncTalking(entry: ActorEntry): void {
    const name = this.view ? castName(this.view, entry.key).trim().toLowerCase() : "";
    const speaking = this.talking && !entry.exiting && entry.stage.focus
      && this.speaker.length > 0 && name === this.speaker.toLowerCase();
    if (entry.talking === speaking) return;
    entry.talking = speaking;
    entry.el.dataset.vnSpriteTalking = speaking ? "true" : "false";
  }

  private exitActor(entry: ActorEntry, animate: boolean): void {
    if (entry.exiting) return;
    entry.exiting = true;
    entry.token += 1;
    entry.talking = false;
    if (!animate || entry.url === null) {
      this.disposeActor(entry);
      this.actors.delete(entry.key);
      return;
    }
    entry.el.dataset.vnSpriteState = "exiting";
    entry.el.dataset.vnSpriteTalking = "false";
    entry.exitTimer = setTimeout(() => {
      entry.exitTimer = null;
      if (!entry.exiting) return;
      this.disposeActor(entry);
      if (this.actors.get(entry.key) === entry) this.actors.delete(entry.key);
    }, SPRITE_EXIT_MS);
  }

  private cancelExit(entry: ActorEntry): void {
    entry.exiting = false;
    if (entry.exitTimer) clearTimeout(entry.exitTimer);
    entry.exitTimer = null;
    entry.el.dataset.vnSpriteState = entry.url ? "shown" : "waiting";
    // The image token moved on when the exit began; show the image again.
    entry.url = null;
    for (const layer of entry.layers) this.emptyLayer(layer);
  }

  private disposeActor(entry: ActorEntry): void {
    for (const timer of [entry.exitTimer, entry.motionTimer, entry.emoteTimer, entry.enterTimer, entry.fadeTimer]) {
      if (timer) clearTimeout(timer);
    }
    entry.exitTimer = entry.motionTimer = entry.emoteTimer = entry.enterTimer = entry.fadeTimer = null;
    entry.token += 1;
    entry.el.remove();
  }

  private preload(view: SpriteTurnView, index: number): void {
    const load = this.options.loadImage;
    if (!load) return;
    for (const url of spritePreloadUrls(view, index)) {
      if (this.loaded.has(url) || this.preloaded.has(url)) continue;
      this.preloaded.add(url);
      load(url).then(() => { this.loaded.add(url); }, () => { this.preloaded.delete(url); });
    }
  }
}

