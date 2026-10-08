/**
 * Change decisions for wardrobe and scene continuity: ONE place that says
 * whether a character's outfit or the turn's opening place changed.
 *
 * Inputs are what the turn knows (character, previous value, planner value,
 * reply paragraphs, System One/Jev answers); the output is a verdict
 * same / changed / unsure with a short reason for the debug log. Callers
 * keep the previous value on "same" and take the planner's otherwise.
 * Swap `decideOutfit` / `decideScene` to try another method.
 */
import { sameOutfit } from "../../shared/outfit.js";

export type ChangeDecision = "same" | "changed" | "unsure";
export type ChangeVerdict = { decision: ChangeDecision; source: "jev" | "text" | "none"; reason: string };

/** Every answer at or below this is a confident "no change". */
export const CHANGE_SAME_MAX = 0.2;
/** Any answer at or above this is a confident "changed". */
export const CHANGE_CHANGED_MIN = 0.6;

/**
 * Jev answers summed up over every batch: "changed" when any answer is
 * >= 0.6, "same" when every answer is <= 0.2 (none missing), else "unsure".
 * No answers at all: null.
 */
export function changeDecision(values: ReadonlyArray<number | null | undefined>): ChangeDecision | null {
  if (values.length === 0) return null;
  if (values.some((value) => typeof value === "number" && value >= CHANGE_CHANGED_MIN)) return "changed";
  if (values.every((value) => typeof value === "number" && value <= CHANGE_SAME_MAX)) return "same";
  return "unsure";
}

/** Jev's wardrobe answers for one character, one value per batch (null = no answer). */
export type JevWardrobeAnswers = {
  top: ReadonlyArray<number | null>;
  bottom: ReadonlyArray<number | null>;
  other: ReadonlyArray<number | null>;
};

function highest(values: ReadonlyArray<number | null>): string {
  const numbers = values.filter((value): value is number => typeof value === "number");
  return numbers.length ? Math.max(...numbers).toFixed(2) : "?";
}

export function jevWardrobeSummary(jev: JevWardrobeAnswers): { decision: ChangeDecision | null; text: string } {
  const decision = changeDecision([...jev.top, ...jev.bottom, ...jev.other]);
  return { decision, text: `jev ${decision ?? "none"} (top ${highest(jev.top)}, bottom ${highest(jev.bottom)}, other ${highest(jev.other)})` };
}

export type OutfitDecisionInput = {
  character: string;
  /** The outfit the character has now (the turn's start outfit unless changed earlier in the turn). */
  previousOutfit: string | null;
  /** The planner's outfit text (null = back to the usual outfit). */
  plannerOutfit: string | null;
  /** Reply paragraphs (plain text). */
  paragraphs: ReadonlyArray<string>;
  /** Jev's answers when it was asked about this character and this paragraph is covered; else null. */
  jev: JevWardrobeAnswers | null;
  /** Planner outfits already overruled ("same") for this character earlier in the turn. */
  overruled?: ReadonlyArray<string>;
};

/**
 * Jev "same" or "changed" wins (it reads the story). A planner outfit that
 * repeats one overruled earlier in the turn stays overruled (a later cue
 * past Jev's paragraphs often repeats the opening text). Otherwise the
 * deterministic sameOutfit text check: the same garments = "same", else
 * "changed" (the planner's outfit, today's behaviour).
 */
export function decideOutfit(input: OutfitDecisionInput): ChangeVerdict {
  const jev = input.jev ? jevWardrobeSummary(input.jev) : null;
  if (jev?.decision === "same" || jev?.decision === "changed") return { decision: jev.decision, source: "jev", reason: jev.text };
  const prefix = jev ? `${jev.text}, ` : "";
  const planned = input.plannerOutfit;
  if (input.previousOutfit !== null && planned !== null && sameOutfit(input.previousOutfit, planned)) {
    return { decision: "same", source: "text", reason: `${prefix}text same` };
  }
  if (planned !== null && (input.overruled ?? []).some((text) => text === planned || sameOutfit(text, planned))) {
    return { decision: "same", source: "text", reason: `${prefix}repeats an overruled outfit` };
  }
  return { decision: "changed", source: "text", reason: `${prefix}text different` };
}

export type Place = { location: string; timeOfDay?: string | null; weather?: string | null };
export type SceneDecisionInput = {
  previousEnvironment: Place | null;
  plannerEnvironment: Place;
  paragraphs: ReadonlyArray<string>;
  /** Jev scene_change answers, one per batch; null when Jev was off, failed or not asked. */
  jev: ReadonlyArray<number | null> | null;
};

/** Jev only: "same" keeps the previous place for the turn's first scene; anything else is the planner's. */
export function decideScene(input: SceneDecisionInput): ChangeVerdict {
  if (!input.previousEnvironment || !input.jev) return { decision: "unsure", source: "none", reason: "no jev decision" };
  const decision = changeDecision(input.jev) ?? "unsure";
  return { decision, source: "jev", reason: `jev ${decision} (${highest(input.jev)})` };
}
