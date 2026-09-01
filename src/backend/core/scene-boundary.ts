import type { SceneBoundaryProposal, SceneState } from "../../shared/contracts.js";

export type SceneBoundaryDecision = {
  startsNewScene: boolean;
  acceptedClaim: boolean;
  reason: "initial" | "location_change" | "major_time_jump" | "environment_replacement" | "forced" | "none";
  evidence: string[];
};

function normalizePlace(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/^(?:the|a|an)\s+/, "")
    .trim();
}

export function decideSceneBoundary(previous: SceneState | null, proposal: SceneBoundaryProposal): SceneBoundaryDecision {
  if (!previous) {
    return {
      startsNewScene: true,
      acceptedClaim: proposal.claimedNewScene,
      reason: "initial",
      evidence: ["No prior scene exists."]
    };
  }

  const evidence: string[] = [];
  const locationChanged = normalizePlace(previous.environment.location) !== normalizePlace(proposal.location);
  if (locationChanged) evidence.push("The normalized location changed.");
  if (proposal.majorTimeJump) evidence.push("The proposal reports a major time jump.");
  if (proposal.environmentReplacement) evidence.push("The proposal replaces the environment.");
  if (proposal.forced) evidence.push("The caller forced a boundary.");

  let reason: SceneBoundaryDecision["reason"] = "none";
  if (proposal.forced) reason = "forced";
  else if (locationChanged) reason = "location_change";
  else if (proposal.majorTimeJump) reason = "major_time_jump";
  else if (proposal.environmentReplacement) reason = "environment_replacement";
  const startsNewScene = reason !== "none";

  return {
    startsNewScene,
    acceptedClaim: proposal.claimedNewScene === startsNewScene && (startsNewScene ? proposal.reason === reason : proposal.reason === "none"),
    reason,
    evidence
  };
}
