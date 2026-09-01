import type { TurnPlan } from "../../shared/contracts.js";
import { TurnPlanSchema } from "../../shared/contracts.js";
import { continuityEquals, reduceContinuity } from "./continuity.js";

export function validateTurnPlan(input: unknown): TurnPlan {
  const plan = TurnPlanSchema.parse(input);
  const reduced = reduceContinuity(plan.initialContinuity, plan.continuityDeltas);
  if (!continuityEquals(reduced, plan.terminalContinuity)) {
    throw new Error("Terminal continuity does not equal the deterministic reduction of the turn deltas.");
  }
  return plan;
}

