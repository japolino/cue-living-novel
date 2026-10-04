import {
  SPRITE_HOT_SET,
  spriteSetKeyFor,
  type PlateView,
  type SpriteCastMember,
  type SpriteImageView,
  type SpritePlateRef,
  type SpriteSetView,
  type SpriteStaging,
  type SpriteTurnView,
} from "../../../shared/sprites.js";
import type { SpriteLibrary, StoredPlate, StoredSpriteImage, StoredSpriteSet } from "./library.js";

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
  };
}

function missingImageView(expression: string): SpriteImageView {
  return { expression, status: "missing" };
}

/** A stored set: the hot set is always listed (missing ones as "missing"), rare expressions once requested. */
export function spriteSetView(set: StoredSpriteSet): SpriteSetView {
  const expressions: Record<string, SpriteImageView> = {};
  for (const expression of SPRITE_HOT_SET) {
    const image = set.images[expression];
    expressions[expression] = image ? spriteImageView(image) : missingImageView(expression);
  }
  for (const [expression, image] of Object.entries(set.images)) {
    if (!expressions[expression]) expressions[expression] = spriteImageView(image);
  }
  const readyCount = Object.values(expressions).filter((view) => view.status === "ready").length;
  return { setKey: set.setKey, name: set.name, attire: set.attire, expressions, readyCount, updatedAt: set.updatedAt };
}

/** A set the library does not know (yet): every hot-set expression "missing". */
export function missingSetView(member: Pick<SpriteCastMember, "name" | "attire">, setKey: string): SpriteSetView {
  const expressions: Record<string, SpriteImageView> = {};
  for (const expression of SPRITE_HOT_SET) expressions[expression] = missingImageView(expression);
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
export function spriteTurnView(staging: SpriteStaging, library: SpriteLibrary, styleKey: string): SpriteTurnView {
  const sets: Record<string, SpriteSetView> = {};
  for (const member of staging.cast) {
    const setKey = spriteSetKeyFor(member, styleKey);
    const stored = library.sets[setKey];
    sets[member.characterKey] = stored ? spriteSetView(stored) : missingSetView(member, setKey);
  }
  const plates: Record<string, PlateView> = {};
  for (const plateKey of stagingPlateKeys(staging)) {
    const stored = library.plates[plateKey];
    const ref = staging.plates.find((plate) => plate.plateKey === plateKey);
    if (stored) plates[plateKey] = plateView(stored);
    else if (ref) plates[plateKey] = missingPlateView(ref);
    else plates[plateKey] = { plateKey, location: "", timeOfDay: null, weather: null, status: "missing" };
  }
  return { staging, sets, plates };
}

/** The whole library for settings: newest first. */
export function spriteLibraryView(library: SpriteLibrary): { sets: SpriteSetView[]; plates: PlateView[] } {
  const byUse = <T extends { usedAt: string }>(left: T, right: T): number => (Date.parse(right.usedAt) || 0) - (Date.parse(left.usedAt) || 0);
  return {
    sets: Object.values(library.sets).sort(byUse).map(spriteSetView),
    plates: Object.values(library.plates).sort(byUse).map(plateView),
  };
}
