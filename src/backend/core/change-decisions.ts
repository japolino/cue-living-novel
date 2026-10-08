/**
 * Change decisions for wardrobe and scene continuity: ONE place that says
 * whether a character's outfit or the turn's opening place changed.
 *
 * Inputs are what the turn knows (character, previous value, planner value,
 * reply paragraphs, System One/Jev answers); the output is a verdict
 * same / changed / unsure with a short reason for the debug log. Callers
 * keep the previous value on "same" and take the planner's otherwise.
 * Swap `decideOutfit` / `decideScene` to try another method. The Jev
 * questions these scores read are in runtime/system-one.ts
 * (`wardrobeQuestions`, `SCENE_QUESTION`).
 *
 * Methods (October 2026 bench, 75 outfit / 56 scene cases):
 * - outfit "h2-jev-whole": the whole reply, per character a choice
 *   (same_outfit / changed_outfit) and a yes/no; score = mean of
 *   P(changed_outfit) and the yes/no; changed when > 0.4 (test 94%).
 * - scene "h6-bg-jev": the start of the reply, one 6-option choice;
 *   score = 1 - P(same_place) - P(same_place_reworded) - P(flashback_or_call);
 *   changed when > 0.5 (test 97%).
 */
import { sameOutfit } from "../../shared/outfit.js";

export type ChangeDecision = "same" | "changed" | "unsure";
export type ChangeVerdict = { decision: ChangeDecision; source: "jev" | "text" | "none"; reason: string };

/** Outfit: changed when the Jev score is above this. */
export const OUTFIT_CHANGED_ABOVE = 0.4;
/** Scene: changed when the Jev score is above this. */
export const SCENE_CHANGED_ABOVE = 0.5;

/**
 * Jev's wardrobe answers for one character: one entry per request chunk
 * (one chunk unless the reply is over the 64 KiB request limit).
 * `changedOutfit` = P(changed_outfit) of the choice; `noul` = the yes/no.
 */
export type JevWardrobeAnswers = {
  chunks: ReadonlyArray<{ changedOutfit: number | null; noul: number | null }>;
};

/** Mean of the two answers per chunk, max over chunks; null when Jev answered nothing. */
export function wardrobeScore(jev: JevWardrobeAnswers): number | null {
  let best: number | null = null;
  for (const chunk of jev.chunks) {
    const values = [chunk.changedOutfit, chunk.noul].filter((value): value is number => typeof value === "number");
    if (!values.length) continue;
    const score = values.reduce((sum, value) => sum + value, 0) / values.length;
    best = best === null ? score : Math.max(best, score);
  }
  return best;
}

export function jevWardrobeSummary(jev: JevWardrobeAnswers): { decision: ChangeDecision | null; score: number | null; text: string } {
  const score = wardrobeScore(jev);
  if (score === null) return { decision: null, score, text: "jev none" };
  const decision: ChangeDecision = score > OUTFIT_CHANGED_ABOVE ? "changed" : "same";
  return { decision, score, text: `jev ${decision} (${score.toFixed(2)})` };
}

export type OutfitDecisionInput = {
  character: string;
  /** The outfit the character has now (the turn's start outfit unless changed earlier in the turn). */
  previousOutfit: string | null;
  /** The planner's outfit text (null = back to the usual outfit). */
  plannerOutfit: string | null;
  /** Reply paragraphs (plain text). */
  paragraphs: ReadonlyArray<string>;
  /** Jev's answers when it was asked about this character; else null. */
  jev: JevWardrobeAnswers | null;
  /** Planner outfits already overruled ("same") for this character earlier in the turn. */
  overruled?: ReadonlyArray<string>;
};

/**
 * Jev answered: its score decides (same keeps the outfit even when the
 * planner reworded it; changed takes the planner's). Jev off, failed or
 * not asked: the sameOutfit text check (the same garments = "same"); a
 * planner outfit that repeats one overruled earlier in the turn stays
 * overruled; else "changed" (the planner's outfit, the old behaviour).
 */
export function decideOutfit(input: OutfitDecisionInput): ChangeVerdict {
  const jev = input.jev ? jevWardrobeSummary(input.jev) : null;
  if (jev?.decision) return { decision: jev.decision, source: "jev", reason: jev.text };
  const planned = input.plannerOutfit;
  if (input.previousOutfit !== null && planned !== null && sameOutfit(input.previousOutfit, planned)) {
    return { decision: "same", source: "text", reason: "text same" };
  }
  if (planned !== null && (input.overruled ?? []).some((text) => text === planned || sameOutfit(text, planned))) {
    return { decision: "same", source: "text", reason: "repeats an overruled outfit" };
  }
  return { decision: "changed", source: "text", reason: "text different" };
}

export const SCENE_SAME_OPTIONS = ["same_place", "same_place_reworded", "flashback_or_call"] as const;

/** Jev's scene answer: the chosen option and its probabilities. */
export type JevSceneAnswer = { choice: string; probabilities: Readonly<Record<string, number>> };

/** 1 - P(same_place) - P(same_place_reworded) - P(flashback_or_call), clamped to 0..1. */
export function sceneScore(answer: JevSceneAnswer): number {
  const same = SCENE_SAME_OPTIONS.reduce((sum, option) => sum + (answer.probabilities[option] ?? 0), 0);
  return Math.min(1, Math.max(0, 1 - same));
}

export type Place = { location: string; timeOfDay?: string | null; weather?: string | null };
export type SceneDecisionInput = {
  previousEnvironment: Place | null;
  plannerEnvironment: Place;
  paragraphs: ReadonlyArray<string>;
  /** Jev's answer about the start of the reply; null when Jev was off, failed or not asked. */
  jev: JevSceneAnswer | null;
};

/** Jev only: "same" keeps the previous place for the turn's first scene; anything else is the planner's. */
export function decideScene(input: SceneDecisionInput): ChangeVerdict {
  if (!input.previousEnvironment || !input.jev) return { decision: "unsure", source: "none", reason: "no jev decision" };
  const score = sceneScore(input.jev);
  const decision: ChangeDecision = score > SCENE_CHANGED_ABOVE ? "changed" : "same";
  return { decision, source: "jev", reason: `jev ${input.jev.choice} (score ${score.toFixed(2)})` };
}
