import { describe, expect, test } from "bun:test";

import type { AssetView, TurnView } from "../../protocol.js";
import {
  describeImageFailure,
  describeOperationError,
  describePlanningFailure,
  describeRetryScope,
  retryScopeForTurn,
  stageErrorText,
} from "./turn-status";

function asset(status: AssetView["status"], index = 0): AssetView {
  return { jobId: `job-${index}`, cueId: `cue-${index}`, paragraphIndex: index, status };
}

function turn(status: TurnView["status"], assets: AssetView[]): Pick<TurnView, "status" | "assets" | "error"> {
  return { status, assets };
}

describe("retryScopeForTurn (mirrors backend vn_retry_turn behavior)", () => {
  test("a failed plan or a turn without jobs is re-planned as a whole", () => {
    expect(retryScopeForTurn(null)).toEqual({ scope: "replan-turn", unfinished: 0, kept: 0, automatic: false });
    expect(retryScopeForTurn(turn("failed", [asset("failed")]))).toEqual({ scope: "replan-turn", unfinished: 1, kept: 0, automatic: false });
    expect(retryScopeForTurn(turn("ready", []))).toEqual({ scope: "replan-turn", unfinished: 0, kept: 0, automatic: false });
  });

  test("a ready turn keeps finished images and remakes only unfinished ones", () => {
    const scope = retryScopeForTurn(turn("ready", [
      asset("generated", 0), asset("browser_ready", 1), asset("failed", 2), asset("cancelled", 3), asset("queued", 4),
    ]));
    expect(scope).toEqual({ scope: "unfinished-images", unfinished: 3, kept: 2, automatic: false });
  });

  test("retry is never automatic", () => {
    expect(retryScopeForTurn(turn("ready", [asset("failed")])).automatic).toBe(false);
  });
});

describe("describeRetryScope (truthful wording, no single-image claim)", () => {
  test("wording matches the scope", () => {
    expect(describeRetryScope({ scope: "replan-turn", unfinished: 2, kept: 0, automatic: false }))
      .toBe("Try again plans this reply again and makes its images again.");
    expect(describeRetryScope({ scope: "unfinished-images", unfinished: 1, kept: 2, automatic: false }))
      .toBe("Try again keeps 2 finished images and makes 1 unfinished image again.");
    expect(describeRetryScope({ scope: "unfinished-images", unfinished: 3, kept: 0, automatic: false }))
      .toBe("Try again makes 3 images again.");
    expect(describeRetryScope({ scope: "unfinished-images", unfinished: 0, kept: 1, automatic: false }))
      .toBe("Try again keeps all 1 finished image.");
  });

  test("never claims a single-image retry", () => {
    const scope = describeRetryScope(retryScopeForTurn(turn("ready", [asset("generated", 0), asset("failed", 1)])));
    expect(scope).not.toMatch(/only this image|this image again/i);
  });
});

describe("host stage errors", () => {
  test("planning failure is retryable with the raw error as detail", () => {
    const error = describePlanningFailure({ status: "failed", assets: [], error: "planner 500" });
    expect(error).toEqual({
      message: "The scene could not be planned.",
      detail: "planner 500",
      source: "planner",
      retryable: true,
      retryScope: "Try again plans this reply again and makes its images again.",
    });
  });

  test("image failure keeps the technical detail and states what retry keeps", () => {
    const error = describeImageFailure(turn("ready", [asset("generated", 0), asset("failed", 1)]), "No usable appearance");
    expect(error.source).toBe("image");
    expect(error.detail).toBe("No usable appearance");
    expect(error.retryable).toBe(true);
    expect(error.retryScope).toBe("Try again keeps 1 finished image and makes 1 unfinished image again.");
  });

  test("operation errors map to friendly messages and retryability depends on a loaded turn", () => {
    expect(describeOperationError("plan_turn", "boom", null)).toEqual({ message: "The scene could not be planned.", detail: "boom", source: "planner", retryable: false });
    const withTurn = describeOperationError("generate_assets", "boom", turn("ready", [asset("failed")]));
    expect(withTurn.retryable).toBe(true);
    expect(withTurn.source).toBe("image");
    expect(withTurn.retryScope).toBe("Try again makes 1 image again.");
    expect(describeOperationError("submit", "offline", turn("ready", [])).retryable).toBe(false);
    expect(describeOperationError("vn_get_state", "x", null)).toEqual({ message: "Something went wrong.", detail: "x", source: "other", retryable: false });
  });

  test("plain-text fallback joins message, detail, and retry scope without duplicates", () => {
    expect(stageErrorText({ message: "A.", detail: "A.", source: "other", retryable: false })).toBe("A.");
    expect(stageErrorText({ message: "A.", detail: "b", source: "other", retryable: true, retryScope: "C." })).toBe("A. b C.");
  });
});
