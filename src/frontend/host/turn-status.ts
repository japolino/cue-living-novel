import type { TurnView } from "../../protocol.js";
import type { VnStageErrorDetails, VnStageErrorSource } from "../stage/index.js";

/**
 * Truthful, host-computed description of what "Try again" does for the
 * current turn. Derived from the real backend behavior of `vn_retry_turn`:
 * - when planning failed (or the turn has no image jobs) the whole reply is
 *   planned again and every image is remade;
 * - otherwise finished images (`generated` / `browser_ready`) are kept and
 *   only the unfinished ones (queued / generating / failed / cancelled) are
 *   remade.
 * The host never retries automatically; single-image retry does not exist.
 */
export type RetryScope = {
  scope: "replan-turn" | "unfinished-images";
  unfinished: number;
  kept: number;
  automatic: false;
};

export function retryScopeForTurn(turn: Pick<TurnView, "status" | "assets"> | null): RetryScope {
  if (!turn || turn.status === "failed" || turn.assets.length === 0) {
    return { scope: "replan-turn", unfinished: turn?.assets.length ?? 0, kept: 0, automatic: false };
  }
  let kept = 0;
  for (const asset of turn.assets) {
    if (asset.status === "generated" || asset.status === "browser_ready") kept += 1;
  }
  return { scope: "unfinished-images", unfinished: turn.assets.length - kept, kept, automatic: false };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** One plain sentence for the stage's retry control. */
export function describeRetryScope(retry: RetryScope): string {
  if (retry.scope === "replan-turn") {
    return "Try again plans this reply again and makes its images again.";
  }
  if (retry.kept === 0) return `Try again makes ${plural(retry.unfinished, "image")} again.`;
  if (retry.unfinished === 0) return `Try again keeps all ${plural(retry.kept, "finished image")}.`;
  return `Try again keeps ${plural(retry.kept, "finished image")} and makes ${plural(retry.unfinished, "unfinished image")} again.`;
}

export type StageErrorSource = VnStageErrorSource;

/** Structured error the host hands to `VnStage.setError` (a `VnStageErrorDetails` with source/retryable required). */
export type HostStageError = VnStageErrorDetails & {
  source: StageErrorSource;
  retryable: boolean;
};

/** Friendly wording per backend `vn_error.operation`, with the raw text kept as detail. */
export function describeOperationError(
  operation: string,
  error: string,
  turn: Pick<TurnView, "status" | "assets"> | null,
): HostStageError {
  const retry = turn ? describeRetryScope(retryScopeForTurn(turn)) : undefined;
  const retryable = turn !== null;
  const scoped = (message: string, source: StageErrorSource): HostStageError => ({
    message,
    detail: error,
    source,
    retryable,
    ...(retryable && retry ? { retryScope: retry } : {}),
  });
  switch (operation) {
    case "plan_turn":
      return scoped("The scene could not be planned.", "planner");
    case "generate_assets":
      return scoped("The scene images could not be made.", "image");
    case "retry_turn":
      return scoped("Trying again did not work.", "other");
    case "submit":
      return { message: "Your reply could not be sent.", detail: error, source: "submit", retryable: false };
    case "generation_ended":
      return { message: "The reply finished, but the scene could not be updated.", detail: error, source: "generation", retryable: false };
    default:
      return { message: "Something went wrong.", detail: error, source: "other", retryable: false };
  }
}

export function describePlanningFailure(turn: Pick<TurnView, "status" | "assets" | "error">): HostStageError {
  return {
    message: "The scene could not be planned.",
    ...(turn.error ? { detail: turn.error } : {}),
    source: "planner",
    retryable: true,
    retryScope: describeRetryScope(retryScopeForTurn(turn)),
  };
}

export function describeImageFailure(
  turn: Pick<TurnView, "status" | "assets">,
  assetError: string | undefined,
): HostStageError {
  return {
    message: "This scene image could not be made.",
    ...(assetError ? { detail: assetError } : {}),
    source: "image",
    retryable: true,
    retryScope: describeRetryScope(retryScopeForTurn(turn)),
  };
}

/** Plain-text form for a stage that only accepts strings. */
export function stageErrorText(error: HostStageError): string {
  const parts = [error.message];
  if (error.detail && error.detail !== error.message) parts.push(error.detail);
  if (error.retryScope) parts.push(error.retryScope);
  return parts.join(" ");
}
