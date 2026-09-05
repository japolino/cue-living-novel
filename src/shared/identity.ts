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

/** Compact visual words accepted from planner output and card fallbacks. */
const VISUAL_TAG_WORDS = /\b(?:age|year[- ]old|girl|woman|female|boy|man|male|petite|slender|slim|lean|athletic|muscular|stocky|curvy|tall|short|build|body|figure|frame|physique|hair|haired|bangs|fringe|ponytail|pigtails?|braids?|bob|bun|curls?|wavy|straight|bald|blonde?|brunette|auburn|eyes?|eyed|iris(?:es)?|pupils?|eyebrows?|eyelashes?|face|facial|cheeks?|jaw|chin|nose|lips?|mouth|ears?|freckles?|moles?|scar|tattoo|complexion|skin|pale|tan(?:ned)?|fair|flushed|clothes?|clothing|attire|outfit|uniform|dress|skirt|shirt|blouse|sweater|cardigan|jacket|coat|hoodie|vest|suit|robe|kimono|yukata|hanfu|gi|pants|trousers|jeans|shorts|leggings|tights|pantyhose|socks?|stockings?|shoes?|boots?|sneakers?|heels?|sandals?|gloves?|hat|cap|hood|scarf|tie|ribbon|bow|collar|sleeves?|belt|apron|swimsuit|accessor(?:y|ies)|glasses|goggles|earrings?|necklace|bracelet|choker|ring|hairpin|headband|clip|jewelry|jewellery|horns?|wings?|tail|fur|furry|anthro|scales?|fangs?|claws?|paws?|snout|muzzle|kemonomimi|catgirl|kitsune|shark|fins?|dorsal|teeth|demon|devil|succubus|elf|elven|pointy|pointed|fairy|harpy|mermaid|lamia|slime|centaur|dragon|reptilian|feline|canine|vulpine|wolf|fox|cat|bunny|rabbit|beastkin|black|white|gray|grey|silver|gold|golden|brown|red|crimson|scarlet|orange|yellow|green|emerald|blue|navy|cyan|teal|turquoise|purple|violet|pink|magenta|beige|ivory|cream|platinum|round|soft|youthful|small)\b/i;

const NON_VISUAL_DOCUMENT_FIELD = /\b(?:full name|name|nationality|occupation|personality|demeanou?r|strengths?|weaknesses?|fears?|loves?|likes?|dislikes?|habits?|values?|behaviou?r|emotional stance|physical intimacy|communication style|psychology|motivations?|inner conflicts?|defense mechanisms?|psychological quirks?|worldview|speech patterns?|tone|vocabulary|catchphrases?|scenario|backstory|creator notes?)\b/i;
const VISUAL_DOCUMENT_FIELD = /^(?:age|gender|species|race|hair|eyes?|facial features?|face|skin|complexion|build|body|height|figure|physique|clothing style|clothing|clothes|attire|outfit|accessories|distinguishing marks?|ears?|tail|horns?|wings?|fur|scales?|fangs?|claws?|paws?|traits?|features?|anatomy|physical features?)$/i;
const INTIMATE_CONTENT = /\b(?:nsfw|intimate|sexual|sex|nude|naked|shaved|breasts?|boobs?|bust|cleavage|nipples?|genitals?|crotch|pussy|vagina|penis|testicles?|butt(?:ocks)?|ass|anus|aroused|orgasm|masturbat|intercourse|lap|fetish)\b/i;
const PROSE_OR_META = /\b(?:she|he|her|his|hers|him|they|them|their|you|your|user|personality|psychology|speech|catchphrase|habit|likes?|loves?|fears?|behaviou?r|communication|motivation)\b/i;

/** Whether stored identity text is a card document rather than canonical tags. */
export function hasIdentityDocumentNoise(source: string): boolean {
  return /#{1,6}|\*{1,3}|\{\{|(?:^|[,;\n])\s*[A-Za-z][A-Za-z /_-]{1,40}:/.test(source);
}

function compactVisualFragment(raw: string): string[] {
  const clean = collapse(raw.replace(/^wearing\s+/i, ""));
  if (!clean || clean.length > 56 || clean.split(/\s+/).length > 7) return [];
  if (INTIMATE_CONTENT.test(clean) || PROSE_OR_META.test(clean)) return [];
  if (!VISUAL_TAG_WORDS.test(clean) && !/\b(?:species|anatomy|[a-z-]+(?:girl|boy|musume))\b/i.test(clean)) return [];
  return [clean];
}

/**
 * Convert a compact planner tag line or a markdown character card into visual
 * appearance tags only. Document fields are allow-listed before their labels
 * are removed, so a Habits line mentioning hair can never become appearance.
 */
export function distillVisualTags(source: string): string[] {
  if (typeof source !== "string" || !source.trim()) return [];
  const withoutMacros = source
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\{[^{}]*\}/g, " ")
    .replace(/\r\n?/g, "\n");
  const documentLike = hasIdentityDocumentNoise(withoutMacros);
  const candidates: string[] = [];

  if (documentLike) {
    // Stored legacy arrays can collapse document lines around commas. Restore
    // boundaries before parsing labels and headings.
    const expanded = withoutMacros
      .replace(/\s*(#{1,6}\s+)/g, "\n$1")
      .replace(/\s*(\*{1,3}[^*\n:]{1,48}\*{1,3}\s*:)/g, "\n$1");
    let visualSection = false;
    for (const rawLine of expanded.split(/\n+/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const heading = line.match(/^#{1,6}\s*(.+)$/);
      if (heading) {
        const title = collapse(heading[1]!.replace(/\*|_/g, ""));
        visualSection = /(?:physical )?appearance|visual|body|attire|clothing/i.test(title)
          && !NON_VISUAL_DOCUMENT_FIELD.test(title);
        continue;
      }
      const plain = line.replace(/^\s*[-*+]\s+/, "").replace(/\*{1,3}|_{1,3}|`+/g, "").trim();
      const labelled = plain.match(/^([^:]{1,48}):\s*(.*)$/);
      if (labelled) {
        const label = collapse(labelled[1]!).toLowerCase();
        if (!VISUAL_DOCUMENT_FIELD.test(label) || NON_VISUAL_DOCUMENT_FIELD.test(label)) continue;
        let value = collapse(labelled[2]!);
        if (!value) continue;
        if (label === "age" && /^\d{1,3}$/.test(value)) value = `${value}-year-old`;
        if (label === "gender") value = /male/i.test(value) && !/female/i.test(value) ? "male" : /female/i.test(value) ? "female" : value;
        let parts = value.split(/[,;]+/);
        if (/clothing|clothes|attire|outfit/.test(label)) {
          const unsafeAt = parts.findIndex((part) => INTIMATE_CONTENT.test(part));
          if (unsafeAt >= 0) parts = parts.slice(0, unsafeAt);
          parts = parts.flatMap((part) => part.split(/\s+with\s+(?=(?:black|white|red|blue|green|gold|golden|silver|navy|pink|purple|brown|gray|grey|a\b|an\b))/i));
        } else if (/face|facial/.test(label)) {
          parts = parts.flatMap((part) => part.split(/\s+with\s+/i));
          parts = parts.map((part) => /^round$/i.test(part.trim()) ? "round face" : part);
        }
        for (const part of parts) candidates.push(...compactVisualFragment(part));
        continue;
      }
      // Unlabelled prose in document cards is ignored. Only explicit visual
      // bullets inside a visual section may pass the compact tag filter.
      if (visualSection && /^[-*+]/.test(line)) {
        for (const part of plain.split(/[,;]+/)) candidates.push(...compactVisualFragment(part));
      }
    }
  } else {
    for (const part of withoutMacros.split(/[,;\n]+/)) candidates.push(...compactVisualFragment(part));
  }

  return dedupeSubsumed(splitTags(sanitizeMemoryTags(candidates.join(", ")))).slice(0, 16);
}

/**
 * The usable appearance tags for an identity: sanitized, de-duplicated, and with
 * any tag that equals (or repeats) the character's own name removed. A tag that
 * is just the name is never appearance.
 */
export function toUsableTags(name: string, tags: string[]): string[] {
  const nameKey = characterAppearanceKey(name);
  return dedupeSubsumed(distillVisualTags(tags.join(", "))
    .filter((tag) => characterAppearanceKey(tag) !== nameKey || /\b(?:species|anatomy|[a-z-]*girl|[a-z-]*boy|[a-z-]*musume|human|elf|demon|dragon|shark|furry|anthro)\b/i.test(tag)));
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
