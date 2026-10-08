import {
  spriteExpressionSet,
  spriteSetListing,
  spriteSetReadyCount,
  spriteSetKeyFor,
  type SpriteExpressionCount,
  type PlateView,
  type SpriteCastMember,
  type SpriteImageView,
  type SpritePlateRef,
  type SpriteSetView,
  type SpriteStaging,
  type SpriteTurnView,
} from "../../../shared/sprites.js";
import { sameOutfit } from "../../../shared/outfit.js";
import type { SpriteLibrary, StoredPlate, StoredSpriteImage, StoredSpriteSet } from "./library.js";

function keyText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The library set a cast member uses (every set lookup goes through here).
 * The exact key (spriteSetKeyFor) wins when it exists. Otherwise a set with
 * the same style, name and identity whose outfit is the same (sameOutfit;
 * two empty outfits also match) stands in, so a reworded outfit, another
 * branch or another chat does not make a new set: the one with the most
 * ready images, then the latest used. No match: the exact key (a new set).
 */
export function resolveSpriteSet(
  library: SpriteLibrary,
  member: Pick<SpriteCastMember, "name" | "identity" | "attire">,
  styleKey: string,
): { setKey: string; set: StoredSpriteSet | undefined; reusedFrom: string | null } {
  const exact = spriteSetKeyFor(member, styleKey);
  const found = library.sets[exact];
  if (found) return { setKey: exact, set: found, reusedFrom: null };
  const name = keyText(member.name);
  const identity = keyText(member.identity);
  const attire = keyText(member.attire);
  let best: StoredSpriteSet | undefined;
  let bestReady = -1;
  for (const set of Object.values(library.sets)) {
    if (set.styleKey !== styleKey || keyText(set.name) !== name || keyText(set.identity) !== identity) continue;
    const other = keyText(set.attire);
    if (attire || other ? !sameOutfit(set.attire, member.attire) : false) continue;
    const ready = Object.values(set.images).filter((image) => image.status === "ready").length;
    if (!best || ready > bestReady || (ready === bestReady && (Date.parse(set.usedAt) || 0) > (Date.parse(best.usedAt) || 0))) {
      best = set;
      bestReady = ready;
    }
  }
  return best ? { setKey: best.setKey, set: best, reusedFrom: exact } : { setKey: exact, set: undefined, reusedFrom: null };
}

/** Frontend view of one stored sprite image. The URL is the cut-out and is only sent when ready. */
export function spriteImageView(image: StoredSpriteImage): SpriteImageView {
  const ready = image.status === "ready" && Boolean(image.cutUrl);
  return {
    expression: image.expression,
    status: image.status === "ready" && !ready ? "failed" : image.status,
    ...(ready ? { url: image.cutUrl! } : {}),
    ...(ready && image.bbox ? { bbox: [...image.bbox] as [number, number, number, number] } : {}),
    ...(ready && image.width ? { width: image.width } : {}),
    ...(ready && image.height ? { height: image.height } : {}),
    ...(image.status === "failed" && image.error ? { error: image.error } : {}),
    ...(image.status === "ready" && !ready ? { error: "The cut-out is missing." } : {}),
    ...(ready && image.twoFigures === true ? { twoFigures: true as const } : {}),
  };
}

function missingImageView(expression: string): SpriteImageView {
  return { expression, status: "missing" };
}

/**
 * A stored set at a set size (spriteSetListing): the active set is always
 * listed (missing ones as "missing"), other expressions once they exist.
 * `count` defaults to 12 (the whole hot set).
 */
export function spriteSetView(set: StoredSpriteSet, count: SpriteExpressionCount = 12): SpriteSetView {
  const expressions: Record<string, SpriteImageView> = {};
  for (const expression of spriteSetListing(set.images, count)) {
    const image = set.images[expression];
    expressions[expression] = image ? spriteImageView(image) : missingImageView(expression);
  }
  const readyCount = spriteSetReadyCount(expressions, count).ready;
  return { setKey: set.setKey, name: set.name, attire: set.attire, expressions, readyCount, updatedAt: set.updatedAt };
}

/** A set the library does not know (yet): every expression of the active set "missing". */
export function missingSetView(member: Pick<SpriteCastMember, "name" | "attire">, setKey: string, count: SpriteExpressionCount = 12): SpriteSetView {
  const expressions: Record<string, SpriteImageView> = {};
  for (const expression of spriteExpressionSet(count)) expressions[expression] = missingImageView(expression);
  return { setKey, name: member.name, attire: member.attire, expressions, readyCount: 0, updatedAt: new Date(0).toISOString() };
}

export function plateView(plate: StoredPlate): PlateView {
  const ready = plate.status === "ready" && Boolean(plate.url);
  return {
    plateKey: plate.plateKey,
    location: plate.location,
    timeOfDay: plate.timeOfDay,
    weather: plate.weather,
    status: plate.status === "ready" && !ready ? "failed" : plate.status,
    ...(ready ? { url: plate.url! } : {}),
    ...(plate.status === "failed" && plate.error ? { error: plate.error } : {}),
  };
}

export function missingPlateView(ref: Pick<SpritePlateRef, "plateKey" | "location" | "timeOfDay" | "weather">): PlateView {
  return { plateKey: ref.plateKey, location: ref.location, timeOfDay: ref.timeOfDay, weather: ref.weather, status: "missing" };
}

/**
 * Plates a staging uses: its declared plates, plus any plate key a paragraph
 * names that the plate list does not (a reused library plate).
 */
export function stagingPlateKeys(staging: SpriteStaging): string[] {
  const keys: string[] = [];
  const add = (key: string | null | undefined): void => { if (key && !keys.includes(key)) keys.push(key); };
  for (const paragraph of staging.paragraphs) add(paragraph.plateKey);
  for (const plate of staging.plates) add(plate.plateKey);
  return keys;
}

/** The sprite part of a `TurnView`: staging plus the sets (by cast characterKey) and plates (by plateKey) it uses. */
export function spriteTurnView(staging: SpriteStaging, library: SpriteLibrary, styleKey: string, count: SpriteExpressionCount = 12): SpriteTurnView {
  const sets: Record<string, SpriteSetView> = {};
  for (const member of staging.cast) {
    const { setKey, set: stored } = resolveSpriteSet(library, member, styleKey);
    sets[member.characterKey] = stored ? spriteSetView(stored, count) : missingSetView(member, setKey, count);
  }
  const plates: Record<string, PlateView> = {};
  for (const plateKey of stagingPlateKeys(staging)) {
    const stored = library.plates[plateKey];
    const ref = staging.plates.find((plate) => plate.plateKey === plateKey);
    if (stored) plates[plateKey] = plateView(stored);
    else if (ref) plates[plateKey] = missingPlateView(ref);
    else plates[plateKey] = { plateKey, location: "", timeOfDay: null, weather: null, status: "missing" };
  }
  return { staging, sets, plates, expressionCount: count };
}

/** The whole library for settings: newest first. */
export function spriteLibraryView(library: SpriteLibrary, count: SpriteExpressionCount = 12): { sets: SpriteSetView[]; plates: PlateView[] } {
  const byUse = <T extends { usedAt: string }>(left: T, right: T): number => (Date.parse(right.usedAt) || 0) - (Date.parse(left.usedAt) || 0);
  return {
    sets: Object.values(library.sets).sort(byUse).map((set) => spriteSetView(set, count)),
    plates: Object.values(library.plates).sort(byUse).map(plateView),
  };
}
