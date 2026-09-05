import { z } from "zod";

/**
 * Bounded action and prop catalogue / schema for Visual Novel cues.
 *
 * Provides a closed set of allowed physical actions, bounded visible prop objects,
 * and canonical hand/posture relationships.
 *
 * Deliberately rejects arbitrary prose, free-form text, and prompt injection attacks
 * while faithfully compiling narrative actions such as "holding brass key in right raised hand".
 */

export const ALLOWED_ACTIONS = [
  "holding",
  "carrying",
  "wielding",
  "raising",
  "lowering",
  "pointing",
  "reaching",
  "touching",
  "showing",
  "presenting",
  "inspecting",
  "examining",
  "grasping",
  "gripping",
  "waving",
  "resting_hand_on",
  "adjusting",
  "hiding",
  "clasping",
  "offering",
  "extending"
] as const;

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];
export const AllowedActionSchema = z.enum(ALLOWED_ACTIONS);

export const ALLOWED_HANDS = ["right", "left", "both"] as const;
export type AllowedHand = (typeof ALLOWED_HANDS)[number];
export const AllowedHandSchema = z.enum(ALLOWED_HANDS);

export const ALLOWED_POSTURES = ["raised", "lowered", "outstretched", "extended", "clasped", "neutral"] as const;
export type AllowedPosture = (typeof ALLOWED_POSTURES)[number];

export const ALLOWED_RELATIONSHIPS = [
  "in right raised hand",
  "in left raised hand",
  "in raised right hand",
  "in raised left hand",
  "in right hand",
  "in left hand",
  "in raised hand",
  "in outstretched right hand",
  "in outstretched left hand",
  "in outstretched hand",
  "with right hand",
  "with left hand",
  "with both hands",
  "in both hands",
  "in hand",
  "in hands",
  "held aloft",
  "at side",
  "close to chest",
  "behind back"
] as const;

export type AllowedRelationship = (typeof ALLOWED_RELATIONSHIPS)[number];
export const AllowedRelationshipSchema = z.enum(ALLOWED_RELATIONSHIPS);

export const ALLOWED_PROP_NOUNS = [
  "key",
  "lantern",
  "lamp",
  "torch",
  "book",
  "tome",
  "grimoire",
  "scroll",
  "letter",
  "envelope",
  "card",
  "map",
  "compass",
  "quill",
  "pen",
  "pencil",
  "coin",
  "sword",
  "blade",
  "dagger",
  "knife",
  "staff",
  "wand",
  "shield",
  "bow",
  "arrow",
  "cup",
  "chalice",
  "mug",
  "glass",
  "goblet",
  "bottle",
  "flask",
  "vial",
  "potion",
  "tea cup",
  "umbrella",
  "parasol",
  "flower",
  "rose",
  "fan",
  "mirror",
  "pocket watch",
  "watch",
  "hourglass",
  "locket",
  "amulet",
  "pendant",
  "ring",
  "crystal",
  "orb",
  "sphere",
  "stone",
  "gem",
  "bell",
  "flute",
  "instrument",
  "bag",
  "pouch",
  "box",
  "chest",
  "telescope",
  "magnifying glass",
  "mask",
  "candle",
  "feather",
  "ribbon",
  "token",
  "phone",
  "camera"
] as const;

export const ALLOWED_PROP_MODIFIERS = [
  // Materials
  "brass",
  "gold",
  "golden",
  "silver",
  "bronze",
  "iron",
  "steel",
  "metallic",
  "wooden",
  "wood",
  "glass",
  "crystal",
  "crystalline",
  "leather",
  "parchment",
  "paper",
  "stone",
  "ceramic",
  "porcelain",
  "obsidian",
  "jade",
  // Colors
  "red",
  "crimson",
  "scarlet",
  "blue",
  "azure",
  "cyan",
  "green",
  "emerald",
  "yellow",
  "amber",
  "purple",
  "violet",
  "black",
  "white",
  "gray",
  "grey",
  "dark",
  "light",
  "bright",
  // Qualities / styles
  "ancient",
  "antique",
  "ornate",
  "vintage",
  "old",
  "new",
  "small",
  "large",
  "heavy",
  "carved",
  "sealed",
  "folded",
  "closed",
  "open",
  "glowing",
  "shining",
  "sparkling",
  "magic",
  "magical",
  "mysterious",
  "enchanted",
  "rusted",
  "polished",
  "engraved"
] as const;

const FORBIDDEN_WORDS = new Set([
  // Camera directives
  "body", "shot", "view", "framing", "angle", "perspective", "lens", "close-up", "portrait", "wide", "cowboy", "cinematic",
  // Anatomy directives
  "hair", "eyes", "eye", "face", "head", "arm", "arms", "leg", "legs", "shoulder", "shoulders",
  "chest", "waist", "skin", "fist", "finger", "fingers", "ear", "ears", "tail", "wings", "horns",
  // Subject directives
  "girl", "boy", "woman", "man", "person", "someone", "another", "user", "player", "persona", "companion", "friend", "crowd", "people", "child", "solo",
  // Clothing directives
  "dress", "skirt", "shirt", "blouse", "coat", "jacket", "pants", "boots", "shoes", "hat", "uniform", "sweater", "swimsuit", "cloak", "robe", "kimono", "gloves", "socks",
  // Prompt injection tokens
  "masterpiece", "best quality", "high quality", "lora", "embedding", "prompt", "score_", "danbooru", "nsfw",
  "ignore previous", "system", "assistant", "break", "weight", "steps", "cfg", "sampler", "seed", "negative prompt",
  "tag:", "trigger:", "drop table", "<script", "javascript:"
]);

const INJECTION_KEYWORDS = [
  "masterpiece",
  "best quality",
  "high quality",
  "lora",
  "embedding",
  "prompt",
  "score_",
  "danbooru",
  "nsfw",
  "ignore previous",
  "system",
  "assistant",
  "user",
  "break",
  "weight",
  "steps",
  "cfg",
  "sampler",
  "seed",
  "negative prompt",
  "tag:",
  "trigger:",
  "drop table",
  "<script",
  "javascript:"
];

/**
 * Validates that an object string uses a bounded noun grammar:
 * [modifier] [modifier] <basePropNoun>
 * from closed sets, and rejects camera, anatomy, clothing, and injection directives.
 */
export function validateVisibleObject(val: string): { success: true; normalized: string } | { success: false; error: string } {
  const clean = val.trim().toLowerCase().replace(/\s+/g, " ");
  if (!clean) return { success: false, error: "Visible object must not be empty" };
  if (clean.length > 64) return { success: false, error: "Visible object exceeds maximum length of 64 characters" };
  if (/[;,{}()\[\]<>`|"\n\r]/.test(clean)) return { success: false, error: "Visible object contains invalid delimiters" };

  const words = clean.split(" ");
  for (const w of words) {
    if (FORBIDDEN_WORDS.has(w)) {
      return { success: false, error: `Forbidden token in visible object: '${w}'` };
    }
  }
  for (const kw of INJECTION_KEYWORDS) {
    if (clean.includes(kw)) {
      return { success: false, error: `Prompt injection token in visible object: '${kw}'` };
    }
  }

  // Match base prop noun longest-first
  const sortedNouns = [...ALLOWED_PROP_NOUNS].sort((a, b) => b.length - a.length);
  let matchedNoun: string | null = null;
  for (const noun of sortedNouns) {
    if (clean === noun || clean.endsWith(" " + noun)) {
      matchedNoun = noun;
      break;
    }
  }
  if (!matchedNoun) {
    return { success: false, error: `Visible object '${clean}' does not end with an allowed prop noun` };
  }

  const prefix = clean.slice(0, clean.length - matchedNoun.length).trim();
  if (!prefix) {
    return { success: true, normalized: matchedNoun };
  }

  const modifiers = prefix.split(" ");
  if (modifiers.length > 2) {
    return { success: false, error: "Visible object has more than 2 modifiers" };
  }

  const allowedMods = new Set<string>(ALLOWED_PROP_MODIFIERS);
  for (const mod of modifiers) {
    if (!allowedMods.has(mod)) {
      return { success: false, error: `Modifier '${mod}' is not in allowed prop modifiers` };
    }
  }

  return { success: true, normalized: `${modifiers.join(" ")} ${matchedNoun}` };
}

export const VisibleObjectSchema = z.string()
  .trim()
  .superRefine((val, ctx) => {
    const res = validateVisibleObject(val);
    if (!res.success) {
      ctx.addIssue({ code: "custom", message: res.error });
    }
  });

export const ActionPropSchema = z.object({
  action: AllowedActionSchema,
  object: VisibleObjectSchema,
  relationship: AllowedRelationshipSchema,
  hand: AllowedHandSchema.nullable().default(null)
}).strict().superRefine((data, ctx) => {
  // Check conflicting hand vs relationship
  const relLower = data.relationship.toLowerCase();
  const matchedHand = RELATIONSHIP_HAND_MAP[relLower];
  if (data.hand !== null && matchedHand !== undefined && matchedHand !== null && data.hand !== matchedHand) {
    ctx.addIssue({
      code: "custom",
      path: ["hand"],
      message: `Hand '${data.hand}' conflicts with relationship '${data.relationship}'`
    });
  }
});

export type ActionProp = z.infer<typeof ActionPropSchema>;

/**
 * Field schema used in VisualCue: normalizes any input (structured ActionProp,
 * bounded string, legacy invalid string, or null) into a canonical ActionProp or null.
 */
export const ActionPropFieldSchema = z.preprocess((val) => {
  if (val === null || val === undefined || val === "") return null;
  return normalizeActionProp(val);
}, z.union([ActionPropSchema, z.string().trim()]).nullable().default(null));

const ACTION_VERB_MAP: Record<string, AllowedAction> = {
  // Multiword verbs must be matched before single-word substrings
  "resting hand on": "resting_hand_on",
  "rests hand on": "resting_hand_on",
  resting_hand_on: "resting_hand_on",
  "reaching for": "reaching",
  "reaches for": "reaching",
  hold: "holding",
  holds: "holding",
  holding: "holding",
  carry: "carrying",
  carries: "carrying",
  carrying: "carrying",
  wield: "wielding",
  wields: "wielding",
  wielding: "wielding",
  raise: "raising",
  raises: "raising",
  raising: "raising",
  lower: "lowering",
  lowers: "lowering",
  lowering: "lowering",
  point: "pointing",
  points: "pointing",
  pointing: "pointing",
  reach: "reaching",
  reaches: "reaching",
  reaching: "reaching",
  touch: "touching",
  touches: "touching",
  touching: "touching",
  show: "showing",
  shows: "showing",
  showing: "showing",
  present: "presenting",
  presents: "presenting",
  presenting: "presenting",
  inspect: "inspecting",
  inspects: "inspecting",
  inspecting: "inspecting",
  examine: "examining",
  examines: "examining",
  examining: "examining",
  grasp: "grasping",
  grasps: "grasping",
  grasping: "grasping",
  grip: "gripping",
  grips: "gripping",
  gripping: "gripping",
  wave: "waving",
  waves: "waving",
  waving: "waving",
  adjust: "adjusting",
  adjusts: "adjusting",
  adjusting: "adjusting",
  hide: "hiding",
  hides: "hiding",
  hiding: "hiding",
  clasp: "clasping",
  clasps: "clasping",
  clasping: "clasping",
  offer: "offering",
  offers: "offering",
  offering: "offering",
  extend: "extending",
  extends: "extending",
  extending: "extending"
};

// Sorted longest-first to ensure multiword verbs (e.g. "reaching for", "resting hand on") match before shorter verbs
const SORTED_ACTION_KEYS = Object.keys(ACTION_VERB_MAP).sort((a, b) => b.length - a.length);

const RELATIONSHIP_MAP: Record<string, { relationship: AllowedRelationship; hand: AllowedHand | null }> = {
  "in right raised hand": { relationship: "in right raised hand", hand: "right" },
  "in raised right hand": { relationship: "in right raised hand", hand: "right" },
  "in her right raised hand": { relationship: "in right raised hand", hand: "right" },
  "in his right raised hand": { relationship: "in right raised hand", hand: "right" },
  "in their right raised hand": { relationship: "in right raised hand", hand: "right" },
  "in left raised hand": { relationship: "in left raised hand", hand: "left" },
  "in raised left hand": { relationship: "in left raised hand", hand: "left" },
  "in her left raised hand": { relationship: "in left raised hand", hand: "left" },
  "in his left raised hand": { relationship: "in left raised hand", hand: "left" },
  "in their left raised hand": { relationship: "in left raised hand", hand: "left" },
  "in right hand": { relationship: "in right hand", hand: "right" },
  "in her right hand": { relationship: "in right hand", hand: "right" },
  "in his right hand": { relationship: "in right hand", hand: "right" },
  "in their right hand": { relationship: "in right hand", hand: "right" },
  "in left hand": { relationship: "in left hand", hand: "left" },
  "in her left hand": { relationship: "in left hand", hand: "left" },
  "in his left hand": { relationship: "in left hand", hand: "left" },
  "in their left hand": { relationship: "in left hand", hand: "left" },
  "in raised hand": { relationship: "in raised hand", hand: null },
  "in outstretched right hand": { relationship: "in outstretched right hand", hand: "right" },
  "in outstretched left hand": { relationship: "in outstretched left hand", hand: "left" },
  "in outstretched hand": { relationship: "in outstretched hand", hand: null },
  "with right hand": { relationship: "with right hand", hand: "right" },
  "with left hand": { relationship: "with left hand", hand: "left" },
  "with both hands": { relationship: "with both hands", hand: "both" },
  "in both hands": { relationship: "in both hands", hand: "both" },
  "in hand": { relationship: "in hand", hand: null },
  "in hands": { relationship: "in hands", hand: "both" },
  "held aloft": { relationship: "held aloft", hand: null },
  aloft: { relationship: "held aloft", hand: null },
  "at side": { relationship: "at side", hand: null },
  "close to chest": { relationship: "close to chest", hand: null },
  "behind back": { relationship: "behind back", hand: null }
};

const RELATIONSHIP_HAND_MAP: Record<string, AllowedHand | null> = {
  "in right raised hand": "right",
  "in raised right hand": "right",
  "in left raised hand": "left",
  "in raised left hand": "left",
  "in right hand": "right",
  "in left hand": "left",
  "in raised hand": null,
  "in outstretched right hand": "right",
  "in outstretched left hand": "left",
  "in outstretched hand": null,
  "with right hand": "right",
  "with left hand": "left",
  "with both hands": "both",
  "in both hands": "both",
  "in hand": null,
  "in hands": "both",
  "held aloft": null,
  "at side": null,
  "close to chest": null,
  "behind back": null
};

const RELATIONSHIP_SUFFIX_REGEX = new RegExp(
  `\\s+(${Object.keys(RELATIONSHIP_MAP).map((k) => k.replace(/\s+/g, "\\s+")).join("|")})$`,
  "i"
);

function stripLeadingArticles(text: string): string {
  return text.replace(/^(?:a|an|the|her|his|their)\s+/i, "").trim();
}

/**
 * Parse an arbitrary input into a validated, bounded ActionProp object.
 * Returns null if input is null, undefined, invalid, unallowed, or contains injection.
 */
export function parseActionProp(input: unknown): ActionProp | null {
  if (input === null || input === undefined) return null;

  // If structured object
  if (typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    const rawAction = typeof record.action === "string" ? record.action.trim().toLowerCase() : "";
    const action = ACTION_VERB_MAP[rawAction] ?? (ALLOWED_ACTIONS.includes(rawAction as any) ? (rawAction as AllowedAction) : null);
    if (!action) return null;

    const rawObj = typeof record.object === "string"
      ? record.object
      : (typeof record.prop === "string" ? record.prop : "");
    const cleanedObj = stripLeadingArticles(rawObj.trim());
    const objValid = validateVisibleObject(cleanedObj);
    if (!objValid.success) return null;

    let relationship: AllowedRelationship | null = null;
    let hand: AllowedHand | null = null;

    if (typeof record.relationship === "string" && record.relationship.trim()) {
      const relLower = record.relationship.trim().toLowerCase();
      const matchedRel = RELATIONSHIP_MAP[relLower];
      if (matchedRel) {
        relationship = matchedRel.relationship;
        hand = matchedRel.hand;
      } else if (ALLOWED_RELATIONSHIPS.includes(relLower as any)) {
        relationship = relLower as AllowedRelationship;
        hand = RELATIONSHIP_HAND_MAP[relLower] ?? null;
      } else {
        return null;
      }
    }

    if (!relationship && typeof record.hand === "string") {
      const hLower = record.hand.trim().toLowerCase();
      const isRaised = record.raised === true || record.raised === "true";
      if (hLower === "right") {
        hand = "right";
        relationship = isRaised ? "in right raised hand" : "in right hand";
      } else if (hLower === "left") {
        hand = "left";
        relationship = isRaised ? "in left raised hand" : "in left hand";
      } else if (hLower === "both") {
        hand = "both";
        relationship = "with both hands";
      }
    }

    if (!relationship) return null;

    // Check hand consistency if explicitly passed
    if (typeof record.hand === "string") {
      const explicitHand = record.hand.trim().toLowerCase();
      if (ALLOWED_HANDS.includes(explicitHand as any)) {
        if (hand !== null && explicitHand !== hand) {
          // Conflicting hand vs relationship
          return null;
        }
        hand = explicitHand as AllowedHand;
      }
    }

    const result: ActionProp = {
      action,
      object: objValid.normalized,
      relationship,
      hand
    };
    return ActionPropSchema.safeParse(result).success ? result : null;
  }

  // If string
  if (typeof input === "string") {
    const raw = input.trim();
    if (!raw) return null;

    // Reject immediate injection patterns
    const lower = raw.toLowerCase();
    if (INJECTION_KEYWORDS.some((kw) => lower.includes(kw))) return null;
    if (/[;,{}()\[\]<>`|"\n\r]/.test(raw)) return null;

    // Check multi-word actions first (longest-first order in SORTED_ACTION_KEYS)
    let matchedAction: AllowedAction | null = null;
    let restOfStr = "";

    for (const verbPhrase of SORTED_ACTION_KEYS) {
      const prefixRegex = new RegExp(`^${verbPhrase.replace(/\s+/g, "\\s+")}\\b\\s*(.*)$`, "i");
      const match = raw.match(prefixRegex);
      if (match) {
        matchedAction = ACTION_VERB_MAP[verbPhrase]!;
        restOfStr = match[1]?.trim() ?? "";
        break;
      }
    }

    if (!matchedAction || !restOfStr) return null;

    // Relationship / hand suffix is required for bounded action-prop strings
    const relMatch = restOfStr.match(RELATIONSHIP_SUFFIX_REGEX);
    if (!relMatch || relMatch.index === undefined) return null;

    const matchedSuffix = relMatch[1]!.toLowerCase().replace(/\s+/g, " ");
    const relInfo = RELATIONSHIP_MAP[matchedSuffix];
    if (!relInfo) return null;

    const relationship = relInfo.relationship;
    const hand = relInfo.hand;
    const objectPart = restOfStr.slice(0, relMatch.index).trim();

    const cleanedObj = stripLeadingArticles(objectPart);
    const objValid = validateVisibleObject(cleanedObj);
    if (!objValid.success) return null;

    const result: ActionProp = {
      action: matchedAction,
      object: objValid.normalized,
      relationship,
      hand
    };

    return ActionPropSchema.safeParse(result).success ? result : null;
  }

  return null;
}

/**
 * Normalizes any action-prop representation to a valid ActionProp object, or null.
 */
export function normalizeActionProp(input: unknown): ActionProp | null {
  return parseActionProp(input);
}

/**
 * Deterministically compiles a normalized ActionProp into an English prompt tag,
 * formatted alongside the pose catalogue.
 *
 * e.g. { action: "holding", object: "brass key", relationship: "in right raised hand" }
 * -> "holding brass key in right raised hand"
 *
 * e.g. { action: "resting_hand_on", object: "wooden staff", relationship: "at side" }
 * -> "resting hand on wooden staff at side"
 *
 * Returns null if input is absent, invalid, or fails validation.
 */
export function compileActionProp(input: unknown): string | null {
  const normalized = normalizeActionProp(input);
  if (!normalized) return null;

  const { action, object, relationship, hand } = normalized;
  const actionDisplay = action.replace(/_/g, " ");

  let compiled = "";
  if (relationship) {
    compiled = `${actionDisplay} ${object} ${relationship}`;
  } else if (hand === "right") {
    compiled = `${actionDisplay} ${object} in right hand`;
  } else if (hand === "left") {
    compiled = `${actionDisplay} ${object} in left hand`;
  } else if (hand === "both") {
    compiled = `${actionDisplay} ${object} with both hands`;
  } else {
    compiled = `${actionDisplay} ${object}`;
  }

  // Safety check on compiled string
  if (/[;,{}()\[\]<>`|"\n\r]/.test(compiled)) return null;
  if (INJECTION_KEYWORDS.some((kw) => compiled.toLowerCase().includes(kw))) return null;

  return compiled.trim();
}

/**
 * Type guard for ActionProp.
 */
export function isActionProp(val: unknown): val is ActionProp {
  return ActionPropSchema.safeParse(val).success;
}
