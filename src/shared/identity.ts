/**
 * Pure character identity / durable appearance helpers.
 *
 * These are a minimal Cue-port of Inlay's durable character memory semantics
 * (`state.characterAppearance` + `normalizeReferenceTags` / `sanitizeMemoryTags`).
 * They are deterministic and I/O-free: names are memory keys only and are never
 * appearance tags, and transient pose/expression/action/camera/environment terms
 * are stripped from the canonical identity. The closed pose catalogue supplies
 * transient expression at render time.
 */

/** Durable canonical appearance map, keyed case-insensitively by character name. */
export type CharacterAppearanceMap = Record<string /* name */, string /* tags */>;

const PLACEHOLDER_TERM = /\b(?:unknown|unspecified|not specified|not stated|unmentioned|undetermined|n\/?a)\b/i;

/** Transient attire terms that must never become canonical identity. */
const TRANSIENT_ATTIRE_TERMS = [
  "torn clothes", "open shirt", "shirt lift", "panty pull", "clothes pull", "undressing"
];

/**
 * Transient pose / expression / action / camera / environment terms. Anything a
 * tag matches here is removed from canonical identity; the pose catalogue emits
 * expression at render time. Inlay uses substring matching, and we keep that
 * so a long description fragment carrying a transient term is not frozen.
 */
const VOLATILE_TERMS = [
  "sitting", "standing", "leaning", "guided", "guiding", "holding", "pulling", "looking", "gaze",
  "smug", "flustered", "blush", "smile", "angry", "crying", "grin", "embarrassed", "annoyed",
  "posture", "pose", "expression", "action", "gesture", "walk", "run", "turn", "glanc", "reach",
  "chair", "bed", "sofa", "couch", "desk", "table", "window", "room", "light",
  "from above", "from below", "from behind", "close-up", "wide shot", "portrait", "upper body",
  "full body", "cowboy shot", "pov", "eye level", "straight-on", "medium shot", "medium-wide",
  "third-person", "cinematic", "camera", "framing", "angle", "perspective", "lens", "solo"
];

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

/** Normalize a character display name (strip parentheticals, collapse whitespace). */
export function normalizeCharacterName(value: unknown): string {
  return typeof value === "string" ? collapse(value) : "";
}

/** Case-insensitive key used for the durable appearance map. */
export function characterAppearanceKey(name: string): string {
  return normalizeCharacterName(name).toLowerCase();
}

/**
 * Find the map key (preserving original casing) that matches `name`
 * case-insensitively. Returns the key, or `undefined`.
 */
export function appearanceMapKeyFor(map: CharacterAppearanceMap | undefined, name: string): string | undefined {
  if (!map) return undefined;
  const target = characterAppearanceKey(name);
  if (!target) return undefined;
  const direct = Object.keys(map).find((candidate) => characterAppearanceKey(candidate) === target);
  return direct;
}

/** Split a comma-separated string into normalized, de-duplicated tags. */
export function splitTags(value: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value.split(/\s*,\s*/)) {
    const tag = collapse(raw);
    if (!tag) continue;
    const lower = characterAppearanceKey(tag);
    if (seen.has(lower)) continue;
    seen.add(lower);
    tags.push(tag);
  }
  return tags;
}

/**
 * Remove tags that are case-insensitive duplicates OR substring-redundant with a
 * longer present tag (so "red coat" does not repeat "red wool coat").
 */
function tokenSet(tag: string): string[] {
  return characterAppearanceKey(tag).split(/\s+/).filter(Boolean);
}

function dedupeSubsumed(tags: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const keys = tags.map((tag) => characterAppearanceKey(tag));
  const tokens = tags.map((tag) => tokenSet(tag));
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]!;
    const key = keys[index]!;
    if (seen.has(key)) continue;
    const subsumed = tokens.some((otherTokens, otherIndex) => {
      if (otherIndex === index || keys[otherIndex] === key) return false;
      const source = tokens[index]!;
      if (source.length === 0 || source.length > otherTokens.length) return false;
      // A tag is redundant when all of its tokens already appear in a longer
      // (or equal-length, differently-ordered) sibling tag.
      return source.every((token) => otherTokens.includes(token));
    });
    if (subsumed) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/**
 * Inlay `normalizeReferenceTags`: split, drop "null"/"none", dedupe. Returns a
 * comma-joined string.
 */
export function normalizeReferenceTags(tagString: unknown): string {
  const value = typeof tagString === "string" ? tagString : "";
  return dedupeSubsumed(splitTags(value).filter((tag) => {
    const lower = tag.toLowerCase();
    return lower !== "null" && lower !== "none";
  })).join(", ");
}

/**
 * Inlay `sanitizeMemoryTags`: drop transient pose/expression/action/camera and
 * environment terms, and placeholder terms, while keeping physical appearance,
 * body, and explicit attire.
 */
export function sanitizeMemoryTags(tags: string): string {
  return normalizeReferenceTags(splitTags(tags).filter((tag) => {
    const normalized = tag.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!normalized) return false;
    if (PLACEHOLDER_TERM.test(normalized)) return false;
    const volatileMatch = (term: string): boolean => {
      const termNorm = term.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
      return normalized === termNorm || normalized.includes(termNorm);
    };
    const transientAttireMatch = (term: string): boolean => {
      const termNorm = term.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
      return normalized === termNorm || normalized.includes(termNorm);
    };
    if (TRANSIENT_ATTIRE_TERMS.some(transientAttireMatch)) return false;
    return !VOLATILE_TERMS.some(volatileMatch);
  }).join(", "));
}

/**
 * The usable appearance tags for an identity: sanitized, de-duplicated, and with
 * any tag that equals (or repeats) the character's own name removed. A tag that
 * is just the name is never appearance.
 */
export function toUsableTags(name: string, tags: string[]): string[] {
  const nameKey = characterAppearanceKey(name);
  return dedupeSubsumed(splitTags(sanitizeMemoryTags(tags.join(", ")))
    .filter((tag) => characterAppearanceKey(tag) !== nameKey));
}

/**
 * Whether an identity carries a real, durable appearance. A name-only or empty
 * identity is never usable / never frozen.
 */
export function isUsableIdentity(name: string, tags: string[]): boolean {
  return characterAppearanceKey(name).length > 0 && toUsableTags(name, tags).length > 0;
}

/** Build a canonical identity using Inlay merge semantics: name + usable tags. */
export function buildCanonicalIdentity(name: string, tags: string[]): { name: string; tags: string[] } {
  const cleanName = normalizeCharacterName(name);
  return { name: cleanName, tags: toUsableTags(cleanName, tags) };
}

/** The appearance-only tag string for an identity block. */
export function appearanceBlock(name: string, tags: string[]): string {
  return toUsableTags(name, tags).join(", ");
}
