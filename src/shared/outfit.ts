/**
 * Outfit comparison for wardrobe continuity (sprite sets, scene prompts).
 *
 * The planner describes a character's outfit again on most turns, often with
 * new words ("tight white collared shirt" for "white collared shirt"). These
 * helpers decide whether two descriptions name the same outfit:
 *   - each text is split into garments; each garment maps to a major
 *     category (top, knit, hoodie, outer, apron, dress, bottoms, skirt,
 *     swimwear, sleepwear, underwear, towel, uniform, nude);
 *   - legwear, footwear, accessories and collar state are minor and ignored;
 *   - fit, size, fabric and state words (tight, oversized, cotton,
 *     unbuttoned, off one shoulder...) are ignored;
 *   - the same outfit = the same set of major categories and no colour
 *     conflict per category (a missing colour is no conflict).
 * When neither text names a known garment, normalised text equality decides.
 */

export type GarmentCategory =
  | "top" | "knit" | "hoodie" | "outer" | "apron" | "dress" | "bottoms" | "skirt"
  | "swimwear" | "sleepwear" | "underwear" | "towel" | "uniform" | "nude";

/** Garment words (longest first inside each group is not needed: the regex prefers longer alternatives). */
const MAJOR_TERMS: ReadonlyArray<readonly [GarmentCategory, readonly string[]]> = [
  ["top", ["t-shirt", "t shirt", "tshirt", "tee", "shirt", "blouse", "button-down", "button down", "button-up", "button up", "polo", "tank top", "tanktop", "crop top", "halter top", "halter", "camisole", "cami", "tube top", "top", "tunic", "henley"]],
  ["knit", ["sweater", "jumper", "cardigan", "pullover", "turtleneck", "knit"]],
  ["hoodie", ["hoodie", "hooded sweatshirt", "sweatshirt"]],
  ["outer", ["jacket", "coat", "blazer", "parka", "windbreaker", "trench", "overcoat", "raincoat", "vest", "waistcoat", "cape", "cloak", "poncho", "shawl"]],
  ["apron", ["apron", "pinafore"]],
  ["dress", ["dress", "gown", "sundress", "kimono", "yukata", "qipao", "cheongsam", "hanbok", "jumpsuit", "romper", "bodysuit", "leotard", "sari"]],
  ["bottoms", ["shorts", "slacks", "pants", "trousers", "jeans", "sweatpants", "joggers", "chinos", "culottes", "overalls", "bottoms", "hakama"]],
  ["skirt", ["skirt", "miniskirt", "kilt"]],
  ["swimwear", ["bikini", "swimsuit", "swimwear", "swim trunks", "one-piece", "bathing suit", "rash guard"]],
  ["sleepwear", ["pajamas", "pyjamas", "pajama", "pyjama", "pjs", "nightgown", "nightdress", "nightie", "negligee", "sleepwear", "bathrobe", "robe", "onesie", "chemise"]],
  ["underwear", ["bra", "panties", "underwear", "lingerie", "boxers", "briefs", "thong", "undershirt", "corset", "bustier"]],
  ["towel", ["towel", "bath towel"]],
  ["uniform", ["uniform"]],
  ["nude", ["naked", "nude", "unclothed", "undressed"]],
];

/** Minor items: recognised (so the text is not "unknown") but never compared. */
const MINOR_TERMS: readonly string[] = [
  "socks", "sock", "stockings", "stocking", "tights", "leggings", "thigh-highs", "thigh highs", "knee-highs", "knee highs", "pantyhose", "legwarmers", "garter", "bare legs", "bare feet", "barefoot",
  "shoes", "shoe", "sneakers", "trainers", "boots", "boot", "heels", "loafers", "sandals", "slippers", "flats", "geta", "clogs",
  "hat", "cap", "beret", "beanie", "ribbon", "bow", "tie", "necktie", "bowtie", "scarf", "glasses", "sunglasses", "choker", "necklace", "pendant", "gloves", "glove", "belt", "hairpin", "hairclip", "headband", "earrings", "bracelet", "watch", "collar", "bag", "backpack", "satchel", "name tag", "nametag", "badge", "brooch", "mask", "veil", "hood",
];

const COLOUR_GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["black", ["black", "ebony", "jet"]],
  ["white", ["white", "ivory", "cream", "off-white", "snow"]],
  ["gray", ["gray", "grey", "charcoal", "silver", "ash", "slate", "heather"]],
  ["red", ["red", "crimson", "scarlet", "maroon", "burgundy", "wine", "cherry"]],
  ["blue", ["blue", "navy", "indigo", "azure", "cobalt", "cyan", "teal", "turquoise", "sky-blue"]],
  ["green", ["green", "olive", "emerald", "mint", "forest", "sage", "jade"]],
  ["yellow", ["yellow", "gold", "golden", "mustard", "lemon"]],
  ["orange", ["orange", "amber", "rust"]],
  ["pink", ["pink", "rose", "peach", "coral", "salmon", "fuchsia", "magenta"]],
  ["purple", ["purple", "violet", "lavender", "lilac", "plum", "mauve"]],
  ["brown", ["brown", "tan", "beige", "khaki", "camel", "chocolate", "coffee", "caramel", "taupe"]],
];

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[- ]/g, "[- ]?");
}

type Term = { term: string; category: GarmentCategory | null };
const TERMS: Term[] = [
  ...MAJOR_TERMS.flatMap(([category, words]) => words.map((term) => ({ term, category }))),
  ...MINOR_TERMS.map((term) => ({ term, category: null })),
].sort((left, right) => right.term.length - left.term.length);
const TERM_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(${TERMS.map((entry) => escape(entry.term)).join("|")})(?:e?s)?(?![\\p{L}\\p{N}])`, "giu");
const TERM_BY_KEY = new Map(TERMS.map((entry) => [entry.term.replace(/[- ]/g, ""), entry.category] as const));
const COLOUR_BY_WORD = new Map(COLOUR_GROUPS.flatMap(([group, words]) => words.map((word) => [word.replace(/-/g, ""), group] as const)));

function normalise(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
}

function categoryFor(match: string): GarmentCategory | null | undefined {
  const key = match.replace(/[- ]/g, "");
  if (TERM_BY_KEY.has(key)) return TERM_BY_KEY.get(key);
  // Plural forms ("shirts", "dresses").
  for (const stem of [key.replace(/es$/, ""), key.replace(/s$/, "")]) {
    if (TERM_BY_KEY.has(stem)) return TERM_BY_KEY.get(stem);
  }
  return undefined;
}

/** One garment: its category and colours (empty when the text names none). */
export type Garment = { category: GarmentCategory; colours: Set<string> };

/**
 * Split an outfit into garments. Pieces are separated by commas, ";", "/",
 * "+", parentheses and the words and/with/under/over/plus; the category of a
 * piece is its last major garment word ("pajama shorts" is bottoms, "sweater
 * dress" is a dress). `known` is false when no garment word (major or minor)
 * was found at all.
 */
export function parseOutfit(text: string | null | undefined): { garments: Garment[]; known: boolean } {
  const garments: Garment[] = [];
  let known = false;
  const pieces = normalise(text ?? "").split(/[,;/+()[\]]|\b(?:and|with|under|over|plus|beneath|underneath|atop|on top of)\b/u);
  for (const piece of pieces) {
    let category: GarmentCategory | null = null;
    const swim = /\b(?:bikini|swim)/u.test(piece);
    for (const match of piece.matchAll(TERM_PATTERN)) {
      const found = categoryFor(match[0]);
      if (found === undefined) continue;
      known = true;
      if (found !== null) category = found;
    }
    if (!category) continue;
    if (swim && (category === "top" || category === "bottoms")) category = "swimwear";
    const colours = new Set<string>();
    for (const word of piece.split(/[^\p{L}-]+/u)) {
      for (const part of [word.replace(/-/g, ""), ...word.split("-")]) {
        const colour = COLOUR_BY_WORD.get(part);
        if (colour) colours.add(colour);
      }
    }
    garments.push({ category, colours });
  }
  // A uniform described by its parts is those parts.
  if (garments.some((garment) => garment.category !== "uniform")) {
    return { garments: garments.filter((garment) => garment.category !== "uniform"), known };
  }
  return { garments, known };
}

function byCategory(garments: Garment[]): Map<GarmentCategory, Set<string>> {
  const map = new Map<GarmentCategory, Set<string>>();
  for (const garment of garments) {
    const colours = map.get(garment.category) ?? new Set<string>();
    for (const colour of garment.colours) colours.add(colour);
    map.set(garment.category, colours);
  }
  return map;
}

/** Normalised text for the no-garment fallback. */
export function normaliseOutfitText(text: string | null | undefined): string {
  return normalise(text ?? "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Whether two outfit descriptions name the same outfit (see the module
 * header). Two empty values are the same; one empty value is not.
 */
export function sameOutfit(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normaliseOutfitText(a);
  const right = normaliseOutfitText(b);
  if (!left || !right) return left === right;
  if (left === right) return true;
  const first = parseOutfit(a);
  const second = parseOutfit(b);
  if (!first.known && !second.known) return false;
  const one = byCategory(first.garments);
  const two = byCategory(second.garments);
  if (one.size !== two.size) return false;
  for (const [category, colours] of one) {
    const other = two.get(category);
    if (!other) return false;
    if (colours.size && other.size && ![...colours].some((colour) => other.has(colour))) return false;
  }
  return true;
}
