/**
 * Deterministic single-character identity + closed pose/expression catalogue.
 *
 * Pure module: no I/O, no clock, no side effects. Everything here is a pure
 * function of its arguments, so a given input always yields the same output.
 *
 * The catalogue is a CLOSED finite set (<= POSE_EXPRESSION_CATALOGUE_MAX_SIZE
 * entries) sourced from canonical visual novel emotion and pose templates.
 * Pose selection checks the planner's explicitly selected expression tag first,
 * then falls back to deterministic keyword matching from the paragraph text,
 * and finally stable index cycling.
 */

export type PoseExpressionDefinition = {
  /** Stable id, matching a closed catalogue key (e.g. "idle", "smirk", "sad"). */
  id: string;
  /** Deterministic English suffix appended to the compiled image prompt. */
  suffix: string;
};

/**
 * Closed pose/expression catalogue. The finite set of every pose the
 * single-character pipeline may emit.
 */
export const POSE_EXPRESSION_CATALOGUE: readonly PoseExpressionDefinition[] = [
  {
    "id": "idle",
    "suffix": "standing, relaxed posture, neutral expression"
  },
  {
    "id": "speak",
    "suffix": "talking, mouth slightly open, looking at viewer"
  },
  {
    "id": "smile",
    "suffix": "gentle smile, eyes relaxed"
  },
  {
    "id": "laugh",
    "suffix": "laughing, eyes closed, cheerful"
  },
  {
    "id": "think",
    "suffix": "hand on chin, looking off to the side, thoughtful"
  },
  {
    "id": "sad",
    "suffix": "sad expression, downcast eyes"
  },
  {
    "id": "angry",
    "suffix": "furrowed brow, angry expression"
  },
  {
    "id": "surprise",
    "suffix": "wide eyes, surprised expression"
  },
  {
    "id": "wave",
    "suffix": "one hand raised in a small wave, smiling"
  },
  {
    "id": "shy",
    "suffix": "blushing, glancing away, shy"
  },
  {
    "id": "listen",
    "suffix": "attentive listening expression, softly focused eyes"
  },
  {
    "id": "contempl",
    "suffix": "subtle contemplative gaze, slight tilt of the head"
  },
  {
    "id": "default",
    "suffix": "looking at viewer"
  },
  {
    "id": "standing",
    "suffix": "looking at viewer, arms at sides"
  },
  {
    "id": "acting_coy",
    "suffix": "looking at viewer, [[turning head, facing to the side]], {{blush}}, {{happy}}, shy, open mouth, raised eyebrows, half-closed eyes, {{hands on own cheeks, hands on own face, hands up}}"
  },
  {
    "id": "acting_cute",
    "suffix": "looking at viewer, fingers to cheeks, pointing at self, {{{happy}}}, tareme, puckered lips, puffy cheeks"
  },
  {
    "id": "admiring",
    "suffix": "looking at viewer, happy, smile, open mouth, head tilt, {{{{{{{{own hands together, own hands clasped}}}}}}}}, {{{hand on own face, hand on own cheek}}}"
  },
  {
    "id": "angry_smiling",
    "suffix": "{{{{closed eyes, ^ ^, >:)}}}}, {{angry}}, {{{{{{{shaded face}}}}}}}, furrowed brow, raised eyebrows, anger vein"
  },
  {
    "id": "annoyed",
    "suffix": "looking at viewer, {{half-closed eyes, {{annoyed}}, frown, {{parted lips}}}}, v-shaped eyebrows"
  },
  {
    "id": "aroused",
    "suffix": "looking at viewer, {{{{aroused}}}}, heavy breathing, {{{{blush}}}}, half-closed eyes, parted lips, {{furrowed brow}}"
  },
  {
    "id": "blushing_shyly",
    "suffix": "looking at viewer, embarrassed, full-face blush, half-closed eyes, {{raised eyebrows}}, {{{{{covering mouth, hand over own mouth, own hands together}}, clenched hands}}}"
  },
  {
    "id": "bored",
    "suffix": "looking at viewer, bored, hand on own cheek, {{annoyed}}, frown, {{{{disappointed, raised eyebrows, one eye closed}}}}, open mouth, jitome"
  },
  {
    "id": "bridling",
    "suffix": "looking at viewer, {{angry}}, shaded face, {{{{half-closed eyes}}}}, parted lips, clenched teeth, {{frown, sulking, v-shaped eyebrows, veins, arms at sides}}"
  },
  {
    "id": "childlike_whining",
    "suffix": "{{{{{{{{closed eyes}}}}}, {{{> <}}}}}}, :<, clenched hands, flying sweatdrops, blush, furrowed brow, [[own hands together]]"
  },
  {
    "id": "chuunibyou",
    "suffix": "looking at viewer, {{{{chuunibyou}}}}, {{{double \\m/, crossed wrists, hands up}}}, v-shaped eyebrows, :d, open mouth"
  },
  {
    "id": "confused",
    "suffix": "looking at viewer, confused, !?, {{parted lips, :o, furrowed brow, frown, {{raised eyebrows}}, hand on own chest}}, sweat"
  },
  {
    "id": "contemptuous",
    "suffix": "looking at viewer, {{{{disgust, expressionless, frown, {{shaded face}}, half-closed eyes, parted lips}}}}, {{arms at sides}}"
  },
  {
    "id": "coughing",
    "suffix": "{{{{{{{{closed eyes}}}}}}}}, frown, coughing, sick, {{{{{hand to own mouth}}}}}, open mouth, {{furrowed brow, raised eyebrows}}, {{wavy mouth}}"
  },
  {
    "id": "cozy",
    "suffix": "{{{{{{closed eyes}}}}}}, {{{{{{{= =}}}}}}}, happy, {{open mouth, :d}} {{{blush stickers}}}, flower symbol"
  },
  {
    "id": "crazy_smiling",
    "suffix": "looking at viewer, {{{{{{shaded face}}}}, crazy smile, constricted pupils, happy, crazy eyes, {{ringed eyes}}}}, open mouth, {{leaning forward}}"
  },
  {
    "id": "crying_with_eyes_closed",
    "suffix": "looking down, {{{{{{{{closed eyes}}}}, sad}}}}, frown, crying, tears, {{{{rubbing eyes, wiping tears, open mouth, wavy mouth}}}}, clenched hand"
  },
  {
    "id": "crying_with_eyes_open",
    "suffix": "looking at viewer, {{crying, crying with eyes open, tears}}, wavy mouth, {{parted lips, hand on own chest, {{raised eyebrows}}}}"
  },
  {
    "id": "curious",
    "suffix": "looking at viewer, curious, ?, :o, {{finger to mouth}}"
  },
  {
    "id": "depressed",
    "suffix": "{{looking down}}, half-closed eyes, depressed, frown, {{{{parted lips}}}}, {{shaded face}}, triangle mouth, wavy mouth, raised eyebrows, sad, {{hand to own arm, arm under breasts}}, arm at side, {{{{spoken squiggle}}}}"
  },
  {
    "id": "determined",
    "suffix": "looking at viewer, v-shaped eyebrows, smile, {{open mouth}}, clenched hand, arm at side"
  },
  {
    "id": "disappointed",
    "suffix": "looking at viewer, disappointed, {{raised eyebrows}}, sigh, {{half-closed eyes}}, annoyed, parted lips, wavy mouth, {{{hand on own arm, holding own arm, hand in own hair}}}, {{squiggle}}"
  },
  {
    "id": "disgusted",
    "suffix": "looking at viewer, {{{{{{{shaded face}}}, disgust}}}}, frown, {{{{half-closed eye, uneven eyes}}}}, {{{{{{{hand over own mouth, covering mouth}}}}}}}, {{furrowed brow, raised eyebrows}}, sweat"
  },
  {
    "id": "dozing_off",
    "suffix": "{{{{{{{{closed eyes}}}}}}}}, parted lips, drooling, mouth drool"
  },
  {
    "id": "embarrassed",
    "suffix": "looking at viewer, {{{embarrassed, @_@, raised eyebrows}}}, furrowed brow, blush, half-closed eyes, wavy mouth, open mouth, {{{{hand to own mouth}}}}"
  },
  {
    "id": "enraged",
    "suffix": "looking at viewer, shaded face, {{{{{tsurime}}, furious, constricted pupils, veins, narrowed eyes}}}, {{v-shaped eyebrows, {{furrowed brow}}}}, parted lips, wavy mouth, {{{{scowl}}}}, teeth"
  },
  {
    "id": "eureka",
    "suffix": "looking at viewer, {{{{spoken light bulb, sparkle}}}}, open mouth, happy, index finger raised, hand up"
  },
  {
    "id": "evil_smiling",
    "suffix": "looking at viewer, {{head down, {{shaded face}}, evil smile, half-closed eyes}}, parted lips, hand on own chin, clenched hand, head tilt"
  },
  {
    "id": "excited",
    "suffix": "looking at viewer, {{{{+_+, sparkling eyes}}}}, happy, smile, {{open mouth, :D}}, {{{{{{clenched hands, own hands together}}}}}}, [[hands on own chest]], excited, wide-eyed"
  },
  {
    "id": "exhausted",
    "suffix": "looking at viewer, {{exhausted}}, {{{{{bags under eyes}}}}}, [[shded face]], parted lips, wavy mouth, mouth drool, {{{{{sanpaku}}, half-closed eyes}}}, frown, raised eyebrows, messy hair"
  },
  {
    "id": "fidgeting_shyly",
    "suffix": "looking down, half-closed eyes, blush, embarrassed, closed mouth, {{{{{index fingers together, fidgeting}}}}}"
  },
  {
    "id": "flustered",
    "suffix": "looking at viewer, surprised, {{flustered, embarrassed, shy, blush, raised eyebrows, chestnut mouth}}, {{{{hand in own hair, playing with own hair, twirling hair}}}}, sweat, [[[from side]]]"
  },
  {
    "id": "forced_smiling",
    "suffix": "looking at viewer, half-closed eyes, {{closed mouth}}, {{frown, {{furrowed brow}}}}, raised eyebrows, {{{{{{{{smile, :>}}}}}}}}, sweat, nervous, nervous smile"
  },
  {
    "id": "full_face_blush",
    "suffix": "looking down, {{full-face blush}}, parted lips, wavy mouth, embarrassed, sweat, @_@, flying sweatdrops, {{{{{{hands on own face, covering face, head steam, steam}}}}}}"
  },
  {
    "id": "giggling",
    "suffix": "{{{happy, smile}}}, {{{closed eyes, {{^ ^, hand over own mouth, covering mouth}}}}}, {{+++}}"
  },
  {
    "id": "grudging",
    "suffix": "{{{looking to the side}}}, averting eyes, shaded face, sigh, raised eyebrows, jitome, frown, parted lips, {{false smile}}"
  },
  {
    "id": "guilty",
    "suffix": "{{looking down}}, half-closed eyes, {{{{{{sad}}, v arms}}}}"
  },
  {
    "id": "happy_smiling",
    "suffix": "looking at viewer, {{happy, open mouth, smile, closed eyes}}, {{{hand on own stomach}}}, happy aura"
  },
  {
    "id": "happy_tears",
    "suffix": "{{{{{closed eyes}}}}}, happy tears, tears, {{{{rubbing eyes, wiping tears, open mouth, happy, smile}}}}"
  },
  {
    "id": "head_bump",
    "suffix": "closed eyes, teardrop, open mouth, wavy mouth, furrowed brow, raised eyebrows, hands on own head, {{{{head bump}}}}, crossed bandaids, injury, head steam"
  },
  {
    "id": "indifferent",
    "suffix": "looking at viewer, expressionless, :/, {{{jitome}}}, arms at sides"
  },
  {
    "id": "jealous",
    "suffix": "looking at viewer, {{jealous}}, shaded face, anger vein, {{angry}}, expressionless, :<, crossed arms, {{{half-closed eyes}}}, from side, uneven eyes"
  },
  {
    "id": "joyful",
    "suffix": "{{{happy}}, closed eyes, smile}, open mouth, {{own hands together, {{palms together, praying}}}}, {{{{{{^ ^}}}}}}"
  },
  {
    "id": "laughing",
    "suffix": "{{happy, smile, laughing, closed eyes}}, open mouth, hand over own mouth, {{+++}}"
  },
  {
    "id": "looking_away_shyly",
    "suffix": "{{averting eyes}}, looking to the side, embarrassed, blush, closed mouth, shy, {{{finger to cheek, half-closed eyes}}}, averting eyes, raised eyebrows, arm at side"
  },
  {
    "id": "lovestruck",
    "suffix": "looking at viewer, blush, happy, smile, tareme, {{{{{{heart-shaped pupils}}}}}}, seductive smile, hand on own chest, {{spoken heart}}, open mouth, loving aura"
  },
  {
    "id": "lustful",
    "suffix": "looking at viewer, {{{{shaded face}}, half-closed eyes, glowing eyes}}, {{{{heart-shaped pupils}}}}, naughty face, closed mouth, licking lips, :p, seductive smile, finger to mouth, heavy breathing, arm at side, blush"
  },
  {
    "id": "melancholic",
    "suffix": "looking down, head rest, hand on own chin, {{{:<, sad}}}, narrowed eyes"
  },
  {
    "id": "middle_finger",
    "suffix": "looking at viewer, {{{{{middle finger}}}}}, furrowed brow, clenched teeth, parted lips, frown, angry, anger vein"
  },
  {
    "id": "nervous",
    "suffix": "looking at viewer, half-closed eyes, nervous, sweat, :<, raised eyebrows"
  },
  {
    "id": "nervous_pouting",
    "suffix": "looking at viewer, nervous, {{{clenched hands}}}, open mouth, wavy mouth, [[[[v-shaped eyebrows]]]], {{{{@ @}}}}, {{{{sweat}}}}, [[own hands together]]"
  },
  {
    "id": "overwhelmed",
    "suffix": "[[looking up]], {{{{@_@}}}}, :o, furrowed brow, {{half-closed eyes, raised eyebrows, drooling, aroused}}"
  },
  {
    "id": "play_dumb",
    "suffix": "{{{{looking to the side}}}}, {{wide-eyed}}, {{{{{puckered lips}}}}}, nervous, {{{{sweat}}}}"
  },
  {
    "id": "playful_winking",
    "suffix": "looking at viewer, one eye closed, open mouth, happy, smile, raised eyebrows, {{{{{{v over eye, peace sign, > o}}}}}}"
  },
  {
    "id": "pleading",
    "suffix": "{{{{palms together, own hands together, praying, {{closed eyes}}}}}}, furrowed brow, {{{{raised eyebrows}}}}, wavy mouth, head down, flying sweatdrops"
  },
  {
    "id": "pouting",
    "suffix": "looking at viewer, {{pout, crossed arms}}"
  },
  {
    "id": "proud",
    "suffix": "{{{{{{closed eyes}}}}}}, {{smug}}, v-shaped eyebrows, closed mouth, {{{{{hands on own hips}}}}}"
  },
  {
    "id": "relieved",
    "suffix": "{{{{{{closed eyes}}}}}}, {{{{{{u u}}}}}}, hands on own chest, own hands together, open mouth"
  },
  {
    "id": "scared",
    "suffix": "looking at viewer, {{{{turn pale, scared}}}}, shaded face, {{wavy mouth, open mouth}}, {{{own hands together, hands on own face}}}"
  },
  {
    "id": "scared_screaming",
    "suffix": "looking at viewer, {{{{{scared, turn pale, wide-eyed, constricted pupils, tears, teardrop, open mouth, rectangular mouth, jaw drop}}}}}, shaded face, wavy mouth, hands on own face"
  },
  {
    "id": "seductive_smiling",
    "suffix": "looking at viewer, seductive smile, {{blush, naughty face}}, {{{finger to mouth, half-closed eyes}}}"
  },
  {
    "id": "serious",
    "suffix": "looking at viewer, {{{serious}}}, closed mouth, v-shaped eyebrows, furrowed brow, expressionless"
  },
  {
    "id": "shocked",
    "suffix": "looking at viewer, furrowed brow, {{surprised, wide-eyed, confused, {{constricted pupils, hands up}}, open mouth, rectangular mouth, wavy mouth, shaded face, constricted pupils, ^^^, !?}}"
  },
  {
    "id": "sleepy",
    "suffix": "looking at viewer, {{{sleepy, rubbing eyes, :o, one eye closed, half-closed eyes}}}, arm at side"
  },
  {
    "id": "smiling",
    "suffix": "looking at viewer, smile, closed mouth, tareme"
  },
  {
    "id": "smirk",
    "suffix": "looking at viewer, {{smirk}}, furrowed brow, closed mouth, {{jitome}}"
  },
  {
    "id": "smug",
    "suffix": "looking at viewer, {{smug}}, smirk, :3, closed mouth, {{{crossed arms}}}, [[from side]]"
  },
  {
    "id": "sniggering",
    "suffix": "looking at viewer, smirk, {{{smile, {{wavy mouth}}}}}, half-closed eyes, tareme, closed mouth, hand over own mouth, covering mouth, raised eyebrows"
  },
  {
    "id": "spacey",
    "suffix": "looking at viewer, expressionless, {{{{o_o, white eyes, no pupils, blank eyes}}}}, :o, jitome, {{arms at sides}}"
  },
  {
    "id": "stretching",
    "suffix": "closed eyes, {{{{stretching, arms up}}, arm behind head}}, furrowed brow"
  },
  {
    "id": "stupefied",
    "suffix": "looking at viewer, {{open mouth, rectangular mouth, {{{mouth drool, jaw drop}}}, {{no pupils, white eyes, wide-eyed}}, {{furrowed brow}}}}, frown, confused, !?"
  },
  {
    "id": "surprised",
    "suffix": "looking at viewer, surprised, open mouth, {{wide-eyed, hand to own mouth, hand on own face, ^^^}}"
  },
  {
    "id": "suspicious",
    "suffix": "{{looking at viewer}}, {{{{jitome}}}}, :<, closed mouth, raised eyebrow, uneven eyes, frown, v-shaped eyebrows, furrowed brow, {{{stroking own chin}}}, hand on own chin"
  },
  {
    "id": "taunting",
    "suffix": "looking at viewer, doyagao, {{akanbe, eyelid pull, {{:p}}, tongue out}}, raised eyebrows"
  },
  {
    "id": "teary_pouting",
    "suffix": "looking at viewer, , tearing up, pout, :i, furrowed brow, raised eyebrows, {{{clenched hands, own hands together}}}"
  },
  {
    "id": "thinking",
    "suffix": "{{{looking up}}}, frown, {{{{hand on own chin}}, stroking own chin, thinking, furrowed brow}}, ..."
  },
  {
    "id": "tormented",
    "suffix": "{{black eyes, wavy eyes, {{squiggle eyes}}}}, constricted pupils, looking down, furrowed brow, {{{{shaded face, scared, trembling}}}}, {{hands on own face}}, parted lips, despair, {{tears, streaming tears, sweat}}, gloom (expression)"
  },
  {
    "id": "worried",
    "suffix": "looking at viewer, worried, confused, sweat, parted lips, wavy mouth, furrowed brow, {{{raised eyebrows, own hands together, {{{clenched hands}}}}}}"
  }
];

/** Hard upper bound on the catalogue size. */
export const POSE_EXPRESSION_CATALOGUE_MAX_SIZE = 128 as const;

const FALLBACK_POSE: PoseExpressionDefinition = POSE_EXPRESSION_CATALOGUE[0]!;

/**
 * Ordered keyword -> pose-id map used for deterministic keyword-driven
 * selection. First match wins; the map is read top-to-bottom and is stable.
 */
const KEYWORD_TO_POSE: ReadonlyArray<readonly [string, string]> = [
  ["laugh", "laugh"], ["smil", "smile"], ["smirk", "smirk"], ["cry", "sad"], ["sad", "sad"],
  ["angry", "angry"], ["shout", "angry"], ["surpris", "surprise"],
  ["shock", "surprise"], ["think", "think"], ["wonder", "think"],
  ["wave", "wave"], ["greet", "wave"], ["shy", "shy"], ["blush", "shy"],
  ["talk", "speak"], ["say", "speak"], ["listen", "listen"],
  ["arous", "aroused"], ["pout", "pouting"], ["excite", "excited"],
  ["giggle", "giggling"], ["sleep", "sleepy"], ["proud", "proud"],
  ["curious", "curious"], ["bored", "bored"], ["confus", "confused"],
  ["disappoint", "disappointed"], ["disgust", "disgusted"], ["embarrass", "embarrassed"],
  ["fluster", "flustered"], ["jealous", "jealous"], ["joy", "joyful"],
  ["love", "lovestruck"], ["lust", "lustful"], ["nervous", "nervous"],
  ["relie", "relieved"], ["scare", "scared"], ["smug", "smug"],
  ["worr", "worried"], ["cozy", "cozy"], ["exhaust", "exhausted"]
];

function firstEntry(catalogue: readonly PoseExpressionDefinition[]): PoseExpressionDefinition {
  return catalogue[0] ?? FALLBACK_POSE;
}

/**
 * Select a catalogue pose for a paragraph.
 * 1. Checks explicitly requested expression from the planner model (e.g. "sad", "smirk", "lovestruck").
 * 2. Falls back to keyword matching against the paragraph text.
 * 3. Falls back to catalogue[paragraphIndex % catalogue.length].
 */
export function selectPoseExpression(
  catalogue: readonly PoseExpressionDefinition[],
  paragraphIndex: number,
  text: string,
  preferredExpression?: string | null
): PoseExpressionDefinition {
  if (preferredExpression) {
    const norm = preferredExpression.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const direct = catalogue.find((entry) => entry.id === norm || entry.id === preferredExpression.trim().toLowerCase());
    if (direct) return direct;
    const partial = catalogue.find((entry) => norm.includes(entry.id) || entry.id.includes(norm));
    if (partial) return partial;
  }

  const lower = text.toLowerCase();
  for (const [keyword, id] of KEYWORD_TO_POSE) {
    if (lower.includes(keyword)) {
      const found = catalogue.find((entry) => entry.id === id);
      if (found) return found;
    }
  }
  if (catalogue.length === 0) return FALLBACK_POSE;
  return catalogue[paragraphIndex % catalogue.length] ?? firstEntry(catalogue);
}

/**
 * Resolve an arbitrary id (e.g. a stored `poseExpressionId`) to a catalogue
 * entry. Unknown / absent ids fall back to the first entry so old stored cues
 * and corrupt ids still resolve deterministically.
 */
export function poseById(
  catalogue: readonly PoseExpressionDefinition[],
  id: string | undefined
): PoseExpressionDefinition {
  if (!id) return firstEntry(catalogue);
  const norm = id.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const found = catalogue.find((entry) => entry.id === norm || entry.id === id);
  return found ?? firstEntry(catalogue);
}

export type SingleCharacterIdentity = {
  /** Protagonist display name. */
  name: string;
  /** Stable physical/appearance tag list used for the identity block. */
  tags: string[];
};

/** Current persisted format version for the single-character visual state. */
export const SINGLE_CHARACTER_SCHEMA_VERSION = 2 as const;

export type SingleCharacterState = {
  schemaVersion: typeof SINGLE_CHARACTER_SCHEMA_VERSION;
  protagonist: SingleCharacterIdentity;
  environment: string;
  updatedAt: string;
};

/**
 * Render the stable identity block (comma-separated physical tags). This is
 * the string the prompt compiler embeds as `identity: <tags>, solo`, and it is
 * frozen once seeded so it never drifts turn-to-turn.
 */
export function tagBlockFor(identity: SingleCharacterIdentity): string {
  return identity.tags.join(", ");
}
