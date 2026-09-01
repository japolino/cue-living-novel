/**
 * Deterministic single-character identity + closed pose/expression catalogue.
 *
 * Pure module: no I/O, no clock, no side effects. Everything here is a pure
 * function of its arguments, so a given input always yields the same output.
 *
 * The catalogue is a CLOSED finite set (<= POSE_EXPRESSION_CATALOGUE_MAX_SIZE
 * entries). Pose selection is a pure function of (paragraphIndex, text), so
 * the same turn always produces the same image. There is no unbounded LLM
 * vocabulary and no free-text pose/expression. It intentionally exposes only
 * a small deterministic suffix that `compileImagePrompt` appends verbatim.
 */

export type PoseExpressionDefinition = {
  /** Stable id, matching a closed catalogue key (e.g. "idle", "speak"). */
  id: string;
  /** Deterministic English suffix appended to the compiled image prompt. */
  suffix: string;
};

/**
 * Closed pose/expression catalogue. The finite set of every pose the
 * single-character pipeline may emit. Keeping it small (<= 16) and bounded is
 * part of the product invariant: one centered character, deterministic suffix.
 */
export const POSE_EXPRESSION_CATALOGUE: readonly PoseExpressionDefinition[] = [
  { id: "idle",     suffix: "standing, relaxed posture, neutral expression" },
  { id: "speak",    suffix: "talking, mouth slightly open, looking at viewer" },
  { id: "smile",    suffix: "gentle smile, eyes relaxed" },
  { id: "laugh",    suffix: "laughing, eyes closed, cheerful" },
  { id: "think",    suffix: "hand on chin, looking off to the side, thoughtful" },
  { id: "sad",      suffix: "sad expression, downcast eyes" },
  { id: "angry",    suffix: "furrowed brow, angry expression" },
  { id: "surprise", suffix: "wide eyes, surprised expression" },
  { id: "wave",     suffix: "one hand raised in a small wave, smiling" },
  { id: "shy",      suffix: "blushing, glancing away, shy" },
  { id: "listen",   suffix: "attentive listening expression, softly focused eyes" },
  { id: "contempl", suffix: "subtle contemplative gaze, slight tilt of the head" }
];

/** Hard upper bound on the catalogue size. Product invariant: closed, <= 16. */
export const POSE_EXPRESSION_CATALOGUE_MAX_SIZE = 16 as const;

const FALLBACK_POSE: PoseExpressionDefinition = { id: "idle", suffix: "standing, relaxed posture, neutral expression" };

/**
 * Ordered keyword -> pose-id map used for deterministic keyword-driven
 * selection. First match wins; the map is read top-to-bottom and is stable.
 */
const KEYWORD_TO_POSE: ReadonlyArray<readonly [string, string]> = [
  ["laugh", "laugh"], ["smil", "smile"], ["cry", "sad"], ["sad", "sad"],
  ["angry", "angry"], ["shout", "angry"], ["surpris", "surprise"],
  ["shock", "surprise"], ["think", "think"], ["wonder", "think"],
  ["wave", "wave"], ["greet", "wave"], ["shy", "shy"], ["blush", "shy"],
  ["talk", "speak"], ["say", "speak"], ["listen", "listen"]
];

function firstEntry(catalogue: readonly PoseExpressionDefinition[]): PoseExpressionDefinition {
  return catalogue[0] ?? FALLBACK_POSE;
}

/**
 * Choose a pose for a paragraph. Pure and deterministic:
 *  - a keyword match in the (lower-cased) text wins;
 *  - otherwise the catalogue is indexed by `paragraphIndex` with a stable
 *    index fallback (the closed set is cycled).
 *
 * `catalogue` is injected for testability; callers pass POSE_EXPRESSION_CATALOGUE.
 */
export function selectPoseExpression(
  catalogue: readonly PoseExpressionDefinition[],
  paragraphIndex: number,
  text: string
): PoseExpressionDefinition {
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
 * (without `poseExpressionId`) and corrupt ids still resolve deterministically.
 */
export function poseById(
  catalogue: readonly PoseExpressionDefinition[],
  id: string | undefined
): PoseExpressionDefinition {
  const found = id ? catalogue.find((entry) => entry.id === id) : undefined;
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
