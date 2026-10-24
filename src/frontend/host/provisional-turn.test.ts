import { describe, expect, test } from "bun:test";
import type { TurnView } from "../../protocol.js";
import { PROVISIONAL_PLAN_HOLD, decideTurnApplication, keepsPlannedTurn, speechCursorFor, stageTurnInput } from "./controller";

/** How the host applies a provisional turn (text before the plan) and the planned turn that upgrades it. */

function turn(overrides: Partial<TurnView> = {}): TurnView {
  return {
    chatId: "chat",
    messageId: "message",
    swipeId: 0,
    sourceFingerprint: "feedface12345678",
    revision: 1,
    speaker: "Mira",
    paragraphs: ["The door opens.", "\"Hello,\" Mira says."],
    choices: [],
    assets: [],
    status: "ready",
    ...overrides
  };
}
const provisional = (overrides: Partial<TurnView> = {}) => turn({ status: "planning", provisional: true, paragraphSpeakers: ["", "Mira"], ...overrides });

describe("decideTurnApplication with provisional turns", () => {
  test("the text before the plan loads like a turn although its status is planning", () => {
    expect(decideTurnApplication(null, provisional(), 0, true, false)).toEqual({ kind: "load-turn" });
    expect(decideTurnApplication(turn({ messageId: "older" }), provisional(), 2, true, true)).toEqual({ kind: "load-turn" });
  });

  test("the planned turn for the provisional one on screen upgrades it at the cursor", () => {
    expect(decideTurnApplication(provisional(), turn(), 1, true, true)).toEqual({ kind: "upgrade", paragraphIndex: 1 });
    // Not on screen yet (activation): an ordinary load.
    expect(decideTurnApplication(provisional(), turn(), 0, true, false)).toEqual({ kind: "load-turn" });
  });

  test("the same provisional turn again (a reopen, a repeated event) is a cursor sync", () => {
    expect(decideTurnApplication(provisional(), provisional(), 1, true, true)).toEqual({ kind: "same-turn", paragraphIndex: 1 });
  });

  test("another swipe's provisional turn replaces the provisional one on screen", () => {
    const swipe = provisional({ swipeId: 1, sourceFingerprint: "0123456789abcdef" });
    expect(decideTurnApplication(provisional(), swipe, 1, true, true)).toEqual({ kind: "load-turn" });
  });

  test("a failed plan after its text shows the error", () => {
    expect(decideTurnApplication(provisional(), turn({ status: "failed", error: "boom" }), 1, true, true)).toEqual({ kind: "error", error: "boom" });
  });
});

describe("keepsPlannedTurn", () => {
  test("a late or repeated provisional turn never replaces its planned turn", () => {
    expect(keepsPlannedTurn(turn(), provisional())).toBe(true);
    expect(keepsPlannedTurn(provisional(), provisional())).toBe(false);
    expect(keepsPlannedTurn(turn({ sourceFingerprint: "other" }), provisional())).toBe(false);
    expect(keepsPlannedTurn(null, provisional())).toBe(false);
    expect(keepsPlannedTurn(provisional(), turn())).toBe(false);
  });
});

describe("stageTurnInput for provisional turns", () => {
  test("a provisional turn carries the hold; a planned one does not", () => {
    expect(stageTurnInput(provisional(), "standard", true).planHold).toBe(PROVISIONAL_PLAN_HOLD);
    expect(stageTurnInput(provisional(), "standard", true, "full", 0).planHold).toBe(0);
    expect(Object.hasOwn(stageTurnInput(turn(), "standard", true), "planHold")).toBe(false);
  });

  test("settled speakers become nameplates, narration hides the plate, ids match the planned turn's", () => {
    const early = stageTurnInput(provisional(), "standard", true);
    const late = stageTurnInput(turn({ paragraphSpeakers: ["", "Mira"] }), "standard", true);
    expect(early.paragraphs.map((paragraph) => paragraph.speaker)).toEqual(["", "Mira"]);
    expect(early.paragraphs.map((paragraph) => paragraph.id)).toEqual(late.paragraphs.map((paragraph) => paragraph.id));
  });

  test("the speech cursor of a provisional paragraph mirrors its settled speaker (narrator otherwise)", () => {
    expect(speechCursorFor(provisional(), 0)?.paragraphSpeaker).toBe("");
    expect(speechCursorFor(provisional(), 1)?.paragraphSpeaker).toBe("Mira");
  });
});
