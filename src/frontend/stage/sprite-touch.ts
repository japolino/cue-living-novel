/**
 * Touch mode on the stage (docs/SPRITE_MODE.md, "Touch"), the pure part:
 * where a tap on a figure lands, how a streak of touches escalates, which
 * reaction plays, which line is said, and the hand cursor drawn in code.
 * VnStage wires it to the sprite layer and the waiting screen
 * (sprite-touch-ui.ts draws the cursor, the line bubble and the heart gauge).
 *
 * Zones come from the face box (the face detector's, else the framing
 * estimate from the opaque bbox, as for emotes): above the face is the head
 * top (a pat), beside it the sides of the head (an ear or hair stroke), its
 * lower half the cheeks (a squish), and the rest of the figure a poke. No
 * zone covers clothing, and no reaction changes any.
 */
import type { SpriteEmote } from "../../shared/sprites.js";
import {
  TOUCH_GENERIC_LINES,
  addTouchBond,
  touchBondTier,
  type TouchLinePack,
  type TouchMood,
  type TouchZone,
} from "../../shared/touch.js";
import { estimateSpriteFace, type SpriteFaceSpot, type SpriteGeometry } from "./sprite-layer.js";

/* ------------------------------------------------------------------------ */
/* Zones                                                                     */
/* ------------------------------------------------------------------------ */

/** Where on the figure a tap lands. */
export type TouchArea = "head" | "side" | "cheeks" | "body";

/** A box in image-normalized coordinates (0..1 of the whole image, y down). */
export type TouchBox = { left: number; right: number; top: number; bottom: number };

export type TouchZones = {
  /** The face box the zones are built around (image-normalized). */
  face: TouchBox;
  head: TouchBox;
  sides: [TouchBox, TouchBox];
  cheeks: TouchBox;
  /** The opaque figure (bbox): a tap anywhere else on it is a poke. */
  body: TouchBox;
  /** "detected": from the face detector; "estimate": from the bbox proportions. */
  source: "detected" | "estimate";
};

/**
 * The face box of an image in image-normalized coordinates: from its face
 * spot (sprite-layer.ts `spriteFaceSpot`, which already falls back to the
 * framing estimate), or, without one, from the bbox proportions.
 */
export function touchFaceBox(geometry: SpriteGeometry, spot: SpriteFaceSpot | null): { box: TouchBox; source: "detected" | "estimate" } {
  if (spot && spot.w > 0 && spot.top > spot.bottom) {
    const cx = geometry.cx + spot.dx;
    return {
      box: { left: cx - spot.w / 2, right: cx + spot.w / 2, top: geometry.by - spot.top, bottom: geometry.by - spot.bottom },
      source: spot.source,
    };
  }
  // Figure units (bbox heights) -> image heights and widths, as spriteFaceSpot does.
  const estimate = estimateSpriteFace(geometry);
  const cheek = geometry.by - estimate.cheek * geometry.bh;
  const faceH = estimate.faceH * geometry.bh;
  const faceW = (estimate.faceW * geometry.bh) / geometry.aspect;
  return {
    box: { left: geometry.cx - faceW / 2, right: geometry.cx + faceW / 2, top: cheek - 0.62 * faceH, bottom: cheek + 0.38 * faceH },
    source: "estimate",
  };
}

/**
 * The touch zones of an image. Face box units: w = face width, h = face
 * height. Head top: the face's width plus a little, from 0.55 h above the
 * face down to a third into it. Sides: from the face's edge out to 0.45 w,
 * from the head top to the cheek line. Cheeks: the face's lower part.
 * Every zone stays inside the opaque bbox.
 */
export function spriteTouchZones(geometry: SpriteGeometry, spot: SpriteFaceSpot | null): TouchZones {
  const { box: face, source } = touchFaceBox(geometry, spot);
  const w = face.right - face.left;
  const h = face.bottom - face.top;
  const body: TouchBox = {
    left: geometry.cx - geometry.bw / 2,
    right: geometry.cx + geometry.bw / 2,
    top: geometry.by - geometry.bh,
    bottom: geometry.by,
  };
  const clip = (box: TouchBox): TouchBox => ({
    left: Math.max(body.left, box.left),
    right: Math.min(body.right, box.right),
    top: Math.max(body.top, box.top),
    bottom: Math.min(body.bottom, box.bottom),
  });
  const cheekLine = face.top + h * 0.62;
  return {
    face,
    head: clip({ left: face.left - w * 0.15, right: face.right + w * 0.15, top: face.top - h * 0.55, bottom: face.top + h * 0.34 }),
    sides: [
      clip({ left: face.left - w * 0.45, right: face.left + w * 0.08, top: face.top - h * 0.35, bottom: cheekLine }),
      clip({ left: face.right - w * 0.08, right: face.right + w * 0.45, top: face.top - h * 0.35, bottom: cheekLine }),
    ],
    cheeks: clip({ left: face.left + w * 0.08, right: face.right - w * 0.08, top: face.top + h * 0.34, bottom: face.bottom + h * 0.06 }),
    body,
    source,
  };
}

const inside = (box: TouchBox, u: number, v: number): boolean =>
  box.right > box.left && box.bottom > box.top && u >= box.left && u <= box.right && v >= box.top && v <= box.bottom;

/** The zone at an image-normalized point (u, v), or null off the figure. The cheeks win over the sides, the sides over the head top. */
export function spriteTouchAreaAt(zones: TouchZones, u: number, v: number): TouchArea | null {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  if (inside(zones.cheeks, u, v)) return "cheeks";
  if (inside(zones.sides[0], u, v) || inside(zones.sides[1], u, v)) return "side";
  if (inside(zones.head, u, v)) return "head";
  if (inside(zones.body, u, v)) return "body";
  return null;
}

/** A client point on an image layer's box as image-normalized coordinates (a mirrored figure is read from the other edge). */
export function touchImagePoint(rect: Pick<DOMRect, "left" | "top" | "width" | "height">, x: number, y: number, mirrored: boolean): { u: number; v: number } | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const u = (x - rect.left) / rect.width;
  return { u: mirrored ? 1 - u : u, v: (y - rect.top) / rect.height };
}

/** An image-normalized point back to client px on the layer's box. */
export function touchClientPoint(rect: Pick<DOMRect, "left" | "top" | "width" | "height">, u: number, v: number, mirrored: boolean): { x: number; y: number } {
  return { x: rect.left + rect.width * (mirrored ? 1 - u : u), y: rect.top + rect.height * v };
}

/** The line-pack zone of an area: the sides are ears for a character with animal ears, hair otherwise. */
export function touchZoneOf(area: TouchArea, animalEars: boolean): TouchZone {
  switch (area) {
    case "head": return "pat";
    case "side": return animalEars ? "ears" : "hair";
    case "cheeks": return "cheeks";
    default: return "poke";
  }
}

/* ------------------------------------------------------------------------ */
/* Escalation                                                                */
/* ------------------------------------------------------------------------ */

/** Touches closer than this to the last reaction only move the hand. */
export const TOUCH_MIN_GAP_MS = 380;
/** A streak on one zone ends after this long without a touch there. */
export const TOUCH_STREAK_MS = 4500;
/** After an "annoyed" reaction the character sulks this long: touches get a small huff, no line. */
export const TOUCH_SULK_MS = 4000;

/**
 * Streak lengths per zone: from `content` touches in a row the character
 * is content, from `annoyed` it has had enough. Null: never.
 */
export const TOUCH_ESCALATION: Readonly<Record<TouchZone, { content: number | null; annoyed: number }>> = {
  pat: { content: 3, annoyed: 8 },
  ears: { content: 3, annoyed: 6 },
  hair: { content: 3, annoyed: 7 },
  cheeks: { content: 3, annoyed: 4 },
  poke: { content: null, annoyed: 3 },
};

/** One character's touch state (per stage session; the bond is saved separately). */
export type TouchMemory = {
  streaks: Partial<Record<TouchZone, { count: number; at: number }>>;
  lastAt: number;
  sulkUntil: number;
};

export const touchMemory = (): TouchMemory => ({ streaks: {}, lastAt: Number.NEGATIVE_INFINITY, sulkUntil: Number.NEGATIVE_INFINITY });

export type TouchStep = {
  /** The mood the touch lands in; "annoyed" with `sulking` is the quiet huff. */
  mood: TouchMood;
  /** Touches in a row on this zone, this one included. */
  count: number;
  /** A touch during the sulk after "annoyed": a huff with no line. */
  sulking: boolean;
};

/**
 * One touch on `zone` at `now` with the character's bond: the mood it lands
 * in, or null when it came too soon after the last one (the hand still
 * moves). Updates `memory`.
 */
export function touchStep(memory: TouchMemory, zone: TouchZone, bond: number, now: number): TouchStep | null {
  if (now - memory.lastAt < TOUCH_MIN_GAP_MS) return null;
  memory.lastAt = now;
  if (now < memory.sulkUntil) {
    // Each touch keeps the sulk going a little longer.
    memory.sulkUntil = Math.max(memory.sulkUntil, now + TOUCH_SULK_MS / 2);
    return { mood: "annoyed", count: memory.streaks[zone]?.count ?? 0, sulking: true };
  }
  // Touching somewhere else starts over; a pause ends a streak too.
  for (const key of Object.keys(memory.streaks) as TouchZone[]) {
    if (key !== zone) delete memory.streaks[key];
  }
  const previous = memory.streaks[zone];
  const count = previous && now - previous.at <= TOUCH_STREAK_MS ? previous.count + 1 : 1;
  memory.streaks[zone] = { count, at: now };
  const rule = TOUCH_ESCALATION[zone];
  if (count >= rule.annoyed) {
    memory.sulkUntil = now + TOUCH_SULK_MS;
    delete memory.streaks[zone];
    return { mood: "annoyed", count, sulking: false };
  }
  if (rule.content !== null && count >= rule.content) return { mood: "content", count, sulking: false };
  return { mood: touchBondTier(bond), count, sulking: false };
}

/* ------------------------------------------------------------------------ */
/* Reactions                                                                 */
/* ------------------------------------------------------------------------ */

/** How the body answers a touch (sprite-css.ts `data-vn-sprite-touch`, sprite-puppet.ts `touch`). */
export type TouchMotion = "pat" | "stroke" | "squish" | "poke" | "huff";
/** The soft sound of a touch (interface-sounds.ts `touch`). */
export type TouchSound = "pat" | "stroke" | "squish" | "poke" | "huff";

export type TouchReaction = {
  zone: TouchZone;
  mood: TouchMood;
  /** Catalogue expression to show for a moment (the stage shows the best one the set has). */
  expression: string;
  emote: SpriteEmote;
  motion: TouchMotion;
  sound: TouchSound;
  /** Bond change. */
  bond: number;
  /** Whether a line is said (not during a sulk). */
  speaks: boolean;
};

type ReactionLook = { expression: string; emote: SpriteEmote };

/** Expression and emote per zone and mood; every expression is one the sets already have (or its stand-in). */
export const TOUCH_LOOKS: Readonly<Record<TouchZone, Readonly<Record<TouchMood, ReactionLook>>>> = {
  pat: {
    shy: { expression: "blushing_shyly", emote: "blush" },
    warm: { expression: "happy_smiling", emote: "sparkle" },
    fond: { expression: "cozy", emote: "heart" },
    content: { expression: "relieved", emote: "music" },
    annoyed: { expression: "pouting", emote: "anger" },
  },
  ears: {
    shy: { expression: "surprised", emote: "exclaim" },
    warm: { expression: "flustered", emote: "blush" },
    fond: { expression: "cozy", emote: "heart" },
    content: { expression: "relieved", emote: "heart" },
    annoyed: { expression: "pouting", emote: "anger" },
  },
  hair: {
    shy: { expression: "embarrassed", emote: "sweat" },
    warm: { expression: "smiling", emote: "sparkle" },
    fond: { expression: "happy_smiling", emote: "heart" },
    content: { expression: "cozy", emote: "music" },
    annoyed: { expression: "annoyed", emote: "anger" },
  },
  cheeks: {
    shy: { expression: "surprised", emote: "exclaim" },
    warm: { expression: "embarrassed", emote: "blush" },
    fond: { expression: "giggling", emote: "heart" },
    content: { expression: "giggling", emote: "music" },
    annoyed: { expression: "pouting", emote: "anger" },
  },
  poke: {
    shy: { expression: "surprised", emote: "question" },
    warm: { expression: "curious", emote: "question" },
    fond: { expression: "playful_winking", emote: "sparkle" },
    content: { expression: "playful_winking", emote: "sparkle" },
    annoyed: { expression: "annoyed", emote: "anger" },
  },
};

const ZONE_MOTION: Readonly<Record<TouchZone, TouchMotion>> = { pat: "pat", ears: "stroke", hair: "stroke", cheeks: "squish", poke: "poke" };

/** Bond change per mood: gentle touches add, a streak that ends in "hey!" takes away. */
export const TOUCH_BOND_DELTA: Readonly<Record<TouchMood, number>> = { shy: 2, warm: 2, fond: 2, content: 3, annoyed: -4 };

/** The reaction to a touch step. */
export function touchReaction(zone: TouchZone, step: TouchStep): TouchReaction {
  const look = TOUCH_LOOKS[zone][step.mood];
  if (step.sulking) {
    return { zone, mood: "annoyed", expression: look.expression, emote: "anger", motion: "huff", sound: "huff", bond: -1, speaks: false };
  }
  // Pokes and squishes are cheekier than pats: they count for a little less.
  const delta = TOUCH_BOND_DELTA[step.mood];
  const bond = delta > 0 && (zone === "poke" || zone === "cheeks") ? delta - 1 : delta;
  const motion = step.mood === "annoyed" ? "huff" : ZONE_MOTION[zone];
  return { zone, mood: step.mood, expression: look.expression, emote: look.emote, motion, sound: motion, bond, speaks: true };
}

/** The bond after a reaction. */
export function bondAfter(bond: number, reaction: Pick<TouchReaction, "bond">): number {
  return addTouchBond(bond, reaction.bond);
}

/* ------------------------------------------------------------------------ */
/* Lines                                                                     */
/* ------------------------------------------------------------------------ */

/** Moods to look in, in order, when a pack has no line for the one asked. */
const MOOD_FALLBACK: Readonly<Record<TouchMood, readonly TouchMood[]>> = {
  shy: ["shy", "warm"],
  warm: ["warm", "shy", "fond"],
  fond: ["fond", "warm", "shy"],
  content: ["content", "fond", "warm"],
  annoyed: ["annoyed"],
};

/** Lines for a zone and mood: the character's pack first (with the mood fallbacks), then the generic lines. */
export function touchLinesFor(pack: TouchLinePack | null, zone: TouchZone, mood: TouchMood): string[] {
  for (const source of [pack, TOUCH_GENERIC_LINES]) {
    if (!source) continue;
    const zoneLines = source.lines[zone] ?? (zone === "ears" ? source.lines.hair : undefined);
    if (!zoneLines) continue;
    for (const candidate of MOOD_FALLBACK[mood]) {
      const lines = zoneLines[candidate];
      if (lines?.length) return lines;
    }
  }
  return [];
}

/** How many recent lines a character does not repeat. */
export const TOUCH_RECENT_LINES = 3;

/** A line for the reaction, avoiding the character's recent ones (updated); null when there is none. */
export function pickTouchLine(pack: TouchLinePack | null, zone: TouchZone, mood: TouchMood, recent: string[], random: () => number = Math.random): string | null {
  const lines = touchLinesFor(pack, zone, mood);
  if (!lines.length) return null;
  const fresh = lines.filter((line) => !recent.includes(line));
  const pool = fresh.length ? fresh : lines;
  const line = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
  recent.push(line);
  while (recent.length > TOUCH_RECENT_LINES) recent.shift();
  return line;
}

/* ------------------------------------------------------------------------ */
/* Settings                                                                  */
/* ------------------------------------------------------------------------ */

export type TouchIntensity = "gentle" | "normal" | "lively";

/** Motion scale, emote use and bubble time per intensity. */
export const TOUCH_INTENSITY: Readonly<Record<TouchIntensity, { amp: number; emotes: boolean; holdMs: number }>> = {
  gentle: { amp: 0.55, emotes: false, holdMs: 1900 },
  normal: { amp: 1, emotes: true, holdMs: 2300 },
  lively: { amp: 1.45, emotes: true, holdMs: 2700 },
};

/* ------------------------------------------------------------------------ */
/* The hand cursor (inline SVG, drawn in code)                               */
/* ------------------------------------------------------------------------ */

/** Which hand: an open palm (pats and strokes), two hands (cheeks), a finger (pokes). */
export type TouchHand = "palm" | "hands" | "finger";

export function touchHandFor(area: TouchArea | null): TouchHand {
  if (area === "cheeks") return "hands";
  if (area === "head" || area === "side") return "palm";
  return "finger";
}

const HAND_STROKE = `stroke="#5b3a2e" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"`;
const SKIN = "#ffe3cf";

/** An open palm seen from the back, fingers up (pats). */
const PALM = `<g ${HAND_STROKE} fill="${SKIN}">
  <path d="M15 33c-3-4-6-9-7.5-12.5-1-2.5 2-4.5 4-2.5l4.5 5V9.5c0-2.4 3.6-2.4 3.6 0V22V7c0-2.4 3.7-2.4 3.7 0v15V8.2c0-2.4 3.6-2.4 3.6 0V22v-10c0-2.3 3.5-2.3 3.5 0v16c0 6.5-4 11-10.5 11h-1.6C21 39.2 17.8 37 15 33z"/>
</g><path d="M23 30c1.5 1.2 4 1.2 5.5 0" fill="none" stroke="#e3a48b" stroke-width="1.6" stroke-linecap="round"/>`;

/** Two hands from the sides, palms in (cheek squishes). */
const HANDS = `<g ${HAND_STROKE} fill="${SKIN}">
  <path d="M3 30c0-6 1.5-10 4-13l4.5-5.3c1.5-1.7 4-.2 3.1 1.9L12.6 18l3.3-3.4c1.6-1.6 4 .2 2.8 2.2l-3 4.4 3.1-2.3c1.8-1.3 3.8.9 2.4 2.6l-5 5.8c-2.5 3-5.3 5.6-8 6.6"/>
  <path d="M45 30c0-6-1.5-10-4-13l-4.5-5.3c-1.5-1.7-4-.2-3.1 1.9L35.4 18l-3.3-3.4c-1.6-1.6-4 .2-2.8 2.2l3 4.4-3.1-2.3c-1.8-1.3-3.8.9-2.4 2.6l5 5.8c2.5 3 5.3 5.6 8 6.6"/>
</g>`;

/** A pointing finger (pokes). */
const FINGER = `<g ${HAND_STROKE} fill="${SKIN}">
  <path d="M20 44c-4-2-7.5-6-9-10.5-.8-2.4 2-4 3.6-2l3.4 4V8.5c0-2.6 4-2.6 4 0V24v-3.5c0-2.4 3.7-2.4 3.7 0V25v-2.5c0-2.3 3.6-2.3 3.6 0V26v-1.5c0-2.2 3.4-2.2 3.4 0V33c0 6-4 11-10 11z"/>
</g>`;

const HAND_SVG: Readonly<Record<TouchHand, string>> = { palm: PALM, hands: HANDS, finger: FINGER };

/** Inline SVG for a hand (decorative, aria-hidden). */
export function touchHandMarkup(hand: TouchHand): string {
  return `<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false" data-vn-touch-hand-mark="${hand}">${HAND_SVG[hand]}</svg>`;
}

/** The hand button's icon in the reading controls (stroke follows the control colour). */
export const TOUCH_BUTTON_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.2 9.6V3.4a1 1 0 0 1 2 0v4.2V2.6a1 1 0 0 1 2 0v5V3.4a1 1 0 0 1 2 0v4.8V5.4a1 1 0 0 1 2 0v4.4c0 2.8-1.9 4.7-4.6 4.7h-.7c-1.5 0-2.6-.7-3.5-1.9L2.5 9.4a1 1 0 0 1 1.5-1.3z" /></svg>`;
