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

/* ------------------------------------------------------------------ *
 * Durable subject category (separate from anatomy).
 * ------------------------------------------------------------------ */

/**
 * The prompt subject class of a character. This is persisted with the
 * character and is NEVER inferred from species or anatomy tags: "fox ears",
 * "kitsune", "cat tail" or "wolf" say nothing about whether the subject is a
 * girl, a boy, a nonbinary person, or a non-humanoid creature. Only explicit
 * statements set it; `unknown` lets the prompt compiler fall back to text.
 */
export type SubjectCategory = "female" | "male" | "nonbinary" | "nonhuman" | "unknown";

export const SUBJECT_CATEGORIES: readonly SubjectCategory[] = ["female", "male", "nonbinary", "nonhuman", "unknown"];

/** Coerce a free-form planner/card value into a subject category. Unknown words map to `unknown`. */
export function normalizeSubjectCategory(value: unknown): SubjectCategory {
  if (typeof value !== "string") return "unknown";
  const text = value.trim().toLowerCase().replace(/[_\s-]+/g, " ");
  if (!text) return "unknown";
  if (/^(?:female|girl|woman|f|1girl|feminine|she|her)$/.test(text)) return "female";
  if (/^(?:male|boy|man|m|1boy|masculine|he|him)$/.test(text)) return "male";
  if (/^(?:nonbinary|non binary|nb|enby|agender|genderless|androgynous|genderfluid|they|them|other|1other)$/.test(text)) return "nonbinary";
  if (/^(?:nonhuman|non human|creature|animal|monster|robot|machine|object|inanimate|beast)$/.test(text)) return "nonhuman";
  if (/\bfemale\b/.test(text) && !/\bmale\b/.test(text.replace(/\bfemale\b/g, ""))) return "female";
  if (/\bmale\b/.test(text) && !/\bfemale\b/.test(text)) return "male";
  if (/\b(?:nonbinary|non binary|agender|genderless)\b/.test(text)) return "nonbinary";
  if (/\b(?:nonhuman|non human)\b/.test(text)) return "nonhuman";
  return "unknown";
}

/**
 * Species/anatomy compounds that must never drive subject classification.
 * "cat ears" is anatomy, not an animal; "fox girl" is explicit female though.
 */
const SPECIES_WORD = "(?:cat|dog|fox|wolf|bunny|rabbit|horse|cow|sheep|goat|deer|mouse|rat|bear|tiger|lion|leopard|panther|dragon|shark|snake|lizard|bird|raven|crow|owl|bat|spider|slime|kitsune|tanuki|neko|inu|usagi|okami|monster|demon|devil|angel|elf|orc|goblin|fairy|beast|animal|anthro|furry)";
const ANATOMY_WORD = "(?:ears?|tails?|paws?|claws?|fangs?|whiskers|fur|scales?|horns?|wings?|fins?|snout|muzzle|teeth|eyes?|hair|markings?|pattern|print|hood|hoodie|mask|plush|plushie|motif|pin|charm|accessory|hairpin|hairclip|ribbon|bow|collar|costume|onesie|pajamas?|slippers?|kigurumi)";
const SPECIES_ANATOMY_COMPOUND = new RegExp(`\\b${SPECIES_WORD}(?:\\s*-?\\s*(?:girl|boy|woman|man|female|male|person|folk|kin))?\\s+${ANATOMY_WORD}\\b`, "gi");
const GENERIC_ANATOMY = /\b(?:animal|beast|kemonomimi|monster)\s+(?:ears?|tails?|paws?|claws?|features?|traits?|anatomy)\b/gi;

/**
 * Remove species+anatomy compounds ("cat ears", "fox tail", "wolf fur") from
 * identity text so animal words attached to body parts cannot classify a
 * character as a creature. Species-gender compounds ("fox girl") are kept.
 */
export function stripAnatomyCompounds(text: string): string {
  return text.replace(GENERIC_ANATOMY, " ").replace(SPECIES_ANATOMY_COMPOUND, " ").replace(/\s+/g, " ").trim();
}

/**
 * Derive a subject category ONLY from explicit gender / presentation words in
 * tags. Species compounds like "fox girl" count as explicit ("girl"); bare
 * species words ("kitsune", "fox ears", "wolf") never do. Returns `unknown`
 * when nothing explicit is present or the evidence conflicts.
 */
export function subjectCategoryFromTags(tags: string | readonly string[]): SubjectCategory {
  const text = (Array.isArray(tags) ? tags.join(", ") : String(tags ?? "")).toLowerCase().replace(/[_-]+/g, " ");
  let cleaned = stripAnatomyCompounds(text);
  // Possessives and clothing carrying gender words are not the subject.
  cleaned = cleaned.replace(/\b\w+'s\b/g, " ").replace(/\bmaid\s+uniform\b/g, "uniform").replace(/\bfake\s+(?:mustache|beard)\b/g, " ");
  cleaned = cleaned.replace(/\b(?:boyfriend|girlfriend|boyish|girlish|mannequin|manga|mankind|human|humanoid|woman's|man's)\b/g, " ");
  const nonbinary = /\b(?:nonbinary|non binary|agender|genderless|enby|androgynous|genderfluid)\b/.test(cleaned);
  const nonhuman = /\b(?:nonhuman|non human|quadruped|four legs|feral)\b/.test(cleaned)
    || /\b(?:creature|monster|animal|beast|robot|android|cyborg|machine|golem|inanimate|object)\s+species\b/.test(cleaned)
    || /^(?:creature|monster|animal|beast|robot|machine|golem)$/.test(cleaned.trim());
  const female = /\b(?:girl|woman|female|lady|gal|tomboy|1girl|[a-z]+girl|[a-z]*woman)\b/.test(cleaned);
  // "woman"/"policewoman" must not satisfy the "*man" alternation.
  const male = /\b(?:boy|man|male|guy|gentleman|father|son|brother|husband|1boy|[a-z]+boy|[a-z]*(?<!wo)man)\b/.test(cleaned);
  if (nonbinary && !female && !male) return "nonbinary";
  if (female && !male) return "female";
  if (male && !female) return "male";
  if (nonbinary) return "nonbinary";
  if (nonhuman && !female && !male) return "nonhuman";
  return "unknown";
}

/** The Danbooru subject label and situation tags for a category (`unknown` yields no opinion). */
export function subjectPromptFor(category: SubjectCategory): [label: string, situation: string] | null {
  switch (category) {
    case "female": return ["girl", "1girl, solo"];
    case "male": return ["boy", "1boy, solo"];
    case "nonbinary":
    case "nonhuman": return ["other", "1other, solo"];
    default: return null;
  }
}

/* ------------------------------------------------------------------ *
 * Stable character IDs and explicit alias resolution.
 * ------------------------------------------------------------------ */

/**
 * One durable character entry. `id` is stable for the life of the chat and is
 * what cues, scenes and portraits should key on. `name` is the canonical
 * display name; `aliases` are EXPLICIT alternative names the planner or a
 * card declared ("Fox girl" for Kitsune). Aliases are never inferred from
 * species or appearance. `tags` is the canonical appearance baseline and
 * `subjectCategory` the durable prompt subject class, independent of anatomy.
 */
export type CharacterRegistryEntry = {
  id: string;
  name: string;
  aliases: string[];
  tags: string;
  subjectCategory: SubjectCategory;
};

export type CharacterRegistry = Record<string /* id */, CharacterRegistryEntry>;

/** A planner or card declaration that can create or extend a registry entry. */
export type CharacterDeclaration = {
  name: string;
  characterId?: string | null | undefined;
  aliases?: readonly string[] | null | undefined;
  tags?: string | readonly string[] | null | undefined;
  subjectCategory?: SubjectCategory | null | undefined;
};

/** Stable, readable id derived from a canonical name: "Fox Girl (Yuki)" -> "fox-girl". */
export function characterIdFor(name: string): string {
  const normalized = characterAppearanceKey(name);
  if (!normalized) return "";
  const key = normalized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (key) return key;
  // Names without Latin letters (e.g. CJK) still need a stable, non-empty id.
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) hash = Math.imul(hash ^ normalized.charCodeAt(index), 0x01000193) >>> 0;
  return `char-${hash.toString(16).padStart(8, "0")}`;
}

/** Normalize an explicit planner-supplied id into registry id form (or ""). */
export function normalizeCharacterId(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return characterIdFor(trimmed.replace(/^(?:char(?:acter)?[:_-])/i, ""));
}

function aliasKeys(entry: CharacterRegistryEntry): string[] {
  return entry.aliases.map((alias) => characterAppearanceKey(alias)).filter(Boolean);
}

/** Find the entry that owns `name` as canonical name or explicit alias. */
export function findRegistryEntryByName(registry: CharacterRegistry, name: string): CharacterRegistryEntry | undefined {
  const key = characterAppearanceKey(name);
  if (!key) return undefined;
  const entries = Object.values(registry);
  return entries.find((entry) => characterAppearanceKey(entry.name) === key)
    ?? entries.find((entry) => aliasKeys(entry).includes(key));
}

/**
 * Resolve a reference (explicit id first, then canonical name, then explicit
 * alias) to its registry entry. Unknown ids fall back to the name; an unknown
 * name resolves to nothing and the caller must treat it as a new subject.
 */
export function resolveCharacterReference(
  registry: CharacterRegistry,
  reference: { name?: string | null | undefined; characterId?: string | null | undefined }
): CharacterRegistryEntry | undefined {
  const id = normalizeCharacterId(reference.characterId);
  const name = normalizeCharacterName(reference.name);
  const byId = id ? registry[id] : undefined;
  const byName = name ? findRegistryEntryByName(registry, name) : undefined;
  // A label that already names a known entity is never re-pointed at another
  // entity by an id: the id may be hallucinated, the name is what the text
  // said. The explicit id only wins for labels nobody owns yet.
  if (byId && byName && byId.id !== byName.id) return byName;
  return byId ?? byName;
}

/**
 * Whether a reference pairs a known id with a label that belongs to a
 * different known entity. Callers report this instead of merging.
 */
export function referenceConflict(
  registry: CharacterRegistry,
  reference: { name?: string | null | undefined; characterId?: string | null | undefined }
): { requested: CharacterRegistryEntry; owner: CharacterRegistryEntry } | undefined {
  const id = normalizeCharacterId(reference.characterId);
  const name = normalizeCharacterName(reference.name);
  const byId = id ? registry[id] : undefined;
  const byName = name ? findRegistryEntryByName(registry, name) : undefined;
  return byId && byName && byId.id !== byName.id ? { requested: byId, owner: byName } : undefined;
}

/** Canonical display name for a reference, or the normalized raw name when unknown. */
export function canonicalCharacterName(
  registry: CharacterRegistry,
  reference: { name?: string | null | undefined; characterId?: string | null | undefined }
): string {
  return resolveCharacterReference(registry, reference)?.name ?? normalizeCharacterName(reference.name);
}

export type RegistryMergeReport = {
  registry: CharacterRegistry;
  changed: boolean;
  /** Aliases refused because another entry already owns that name. */
  rejectedAliases: Array<{ alias: string; requestedFor: string; ownedBy: string }>;
  /** Explicit subject categories refused because the entry already has a durable one. */
  rejectedSubjects: Array<{ name: string; requested: SubjectCategory; durable: SubjectCategory }>;
};

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const clean = normalizeCharacterName(raw);
    const key = characterAppearanceKey(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function tagString(tags: CharacterDeclaration["tags"]): string {
  if (!tags) return "";
  return Array.isArray(tags) ? tags.join(", ") : String(tags);
}

/**
 * Merge explicit declarations into a registry (pure; returns a new registry).
 *
 * Rules:
 * - A declaration resolves by explicit id, then canonical name, then alias.
 *   An unknown id with a known name attaches to that name's entry.
 * - A new name creates a new entry whose id is derived from the name (or the
 *   explicit id when it is free). Two distinct names of the same species stay
 *   two entries; nothing is merged by appearance.
 * - An alias is added only when no other entry owns it (as name or alias).
 *   Conflicts are reported and ignored.
 * - A usable existing appearance baseline is never overwritten. An incomplete
 *   later description only fills an empty baseline; wardrobe is not identity.
 * - `subjectCategory` is durable: an explicit non-unknown declaration or
 *   explicit gender words in the tags fill an `unknown` category once. A later
 *   per-turn declaration that disagrees is reported and ignored, so one
 *   planner slip can never flip a character to `1other`. The one correction
 *   path is a request that matches explicit gender words in the entity's own
 *   frozen baseline tags (never the per-turn description).
 */
export function mergeCharacterDeclarations(
  registry: CharacterRegistry,
  declarations: readonly CharacterDeclaration[]
): RegistryMergeReport {
  const next: CharacterRegistry = {};
  for (const [id, entry] of Object.entries(registry)) next[id] = { ...entry, aliases: [...entry.aliases] };
  let changed = false;
  const rejectedAliases: RegistryMergeReport["rejectedAliases"] = [];
  const rejectedSubjects: RegistryMergeReport["rejectedSubjects"] = [];

  for (const declaration of declarations) {
    const name = normalizeCharacterName(declaration.name);
    const explicitId = normalizeCharacterId(declaration.characterId);
    if (!name && !explicitId) continue;
    const conflict = referenceConflict(next, { name, characterId: explicitId });
    if (conflict) {
      // The label already names another entity; the id is not allowed to steal it.
      rejectedAliases.push({ alias: name, requestedFor: conflict.requested.name, ownedBy: conflict.owner.name });
    }
    let entry = resolveCharacterReference(next, { name, characterId: explicitId });
    if (!entry) {
      if (!name) continue;
      let id = explicitId && !next[explicitId] ? explicitId : characterIdFor(name);
      if (!id) continue;
      let suffix = 2;
      const base = id;
      while (next[id]) { id = `${base}-${suffix}`; suffix += 1; }
      entry = { id, name, aliases: [], tags: "", subjectCategory: "unknown" };
      next[id] = entry;
      changed = true;
    }
    const canonicalKey = characterAppearanceKey(entry.name);
    // Explicit aliases only. The declared name itself is an alias when it
    // reached the entry through an explicit id but differs from the name.
    const wanted = uniqueNames([...(declaration.aliases ?? []), ...(name && characterAppearanceKey(name) !== canonicalKey ? [name] : [])]);
    for (const alias of wanted) {
      const aliasKey = characterAppearanceKey(alias);
      if (aliasKey === canonicalKey || aliasKeys(entry).includes(aliasKey)) continue;
      const owner = findRegistryEntryByName(next, alias);
      if (owner && owner.id !== entry.id) {
        rejectedAliases.push({ alias, requestedFor: entry.name, ownedBy: owner.name });
        continue;
      }
      entry.aliases.push(alias);
      changed = true;
    }
    const incomingTags = toUsableTags(entry.name, splitTags(tagString(declaration.tags)));
    if (incomingTags.length > 0 && !isUsableIdentity(entry.name, splitTags(entry.tags))) {
      entry.tags = incomingTags.join(", ");
      changed = true;
    }
    const explicit = normalizeSubjectCategory(declaration.subjectCategory ?? "unknown");
    if (entry.subjectCategory === "unknown") {
      const derived = explicit !== "unknown"
        ? explicit
        : subjectCategoryFromTags([tagString(declaration.tags), entry.tags].filter(Boolean).join(", "));
      if (derived !== "unknown") { entry.subjectCategory = derived; changed = true; }
    } else if (explicit !== "unknown" && explicit !== entry.subjectCategory) {
      // The only correction path: the entity's own frozen baseline tags carry
      // explicit gender words that agree with the request. The per-turn
      // description is never consulted, so partial descriptions cannot drift it.
      const baselineSays = subjectCategoryFromTags(entry.tags);
      if (baselineSays !== "unknown" && baselineSays === explicit) {
        entry.subjectCategory = explicit;
        changed = true;
      } else {
        rejectedSubjects.push({ name: entry.name, requested: explicit, durable: entry.subjectCategory });
      }
    }
  }
  const seenRejections = new Set<string>();
  const uniqueRejections = rejectedAliases.filter((item) => {
    const key = `${characterAppearanceKey(item.alias)}\0${item.requestedFor}\0${item.ownedBy}`;
    if (seenRejections.has(key)) return false;
    seenRejections.add(key);
    return true;
  });
  return { registry: next, changed, rejectedAliases: uniqueRejections, rejectedSubjects };
}

/** Coerce an arbitrary stored value into a clean registry (drops corrupt entries). */
export function normalizeCharacterRegistry(raw: unknown): CharacterRegistry {
  const registry: CharacterRegistry = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return registry;
  const source = (raw as { characters?: unknown }).characters ?? raw;
  if (!source || typeof source !== "object" || Array.isArray(source)) return registry;
  for (const [rawId, value] of Object.entries(source as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const name = normalizeCharacterName(record.name);
    if (!name) continue;
    const id = normalizeCharacterId(typeof record.id === "string" ? record.id : rawId) || characterIdFor(name);
    if (!id || registry[id]) continue;
    // Two entries cannot share a canonical name; the first stored one is authoritative.
    if (Object.values(registry).some((entry) => characterAppearanceKey(entry.name) === characterAppearanceKey(name))) continue;
    const rawTags = typeof record.tags === "string" ? record.tags : Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string").join(", ") : "";
    const tags = hasIdentityDocumentNoise(rawTags) ? "" : toUsableTags(name, splitTags(rawTags)).join(", ");
    const aliases = uniqueNames(Array.isArray(record.aliases) ? record.aliases.filter((alias): alias is string => typeof alias === "string") : [])
      .filter((alias) => characterAppearanceKey(alias) !== characterAppearanceKey(name));
    registry[id] = { id, name, aliases, tags, subjectCategory: normalizeSubjectCategory(record.subjectCategory) };
  }
  // Drop aliases that collide with another entry's canonical name or an earlier alias.
  const taken = new Map<string, string>();
  for (const entry of Object.values(registry)) taken.set(characterAppearanceKey(entry.name), entry.id);
  for (const entry of Object.values(registry)) {
    entry.aliases = entry.aliases.filter((alias) => {
      const key = characterAppearanceKey(alias);
      const owner = taken.get(key);
      if (owner && owner !== entry.id) return false;
      taken.set(key, entry.id);
      return true;
    });
  }
  return registry;
}

/** Project the registry onto the legacy name -> tags appearance map (canonical names only). */
export function registryToAppearanceMap(registry: CharacterRegistry): CharacterAppearanceMap {
  const map: CharacterAppearanceMap = {};
  for (const entry of Object.values(registry)) {
    if (entry.tags && isUsableIdentity(entry.name, splitTags(entry.tags))) map[entry.name] = entry.tags;
  }
  return map;
}
