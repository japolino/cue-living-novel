import { describe, expect, test } from "bun:test";
import { canUpgradeTurn, createInitialVnStageState, reduceVnStage, selectVnStageView, type VnStageAction, type VnStageState, type VnTurnInput } from "./vn-store";

/**
 * A reply's text reaches the stage before its visual plan (a provisional turn,
 * held at `planHold`); the planned turn then upgrades it in place.
 */

const texts = ["The door creaks.", "\"Who's there?\" Mira asks.", "Silence.", "A lantern flickers."];
const provisional = (planHold = Number.POSITIVE_INFINITY): VnTurnInput => ({
  mode: "standard",
  paragraphs: texts.map((text, index) => ({ id: `fp:${index}`, text, speaker: index === 1 ? "Mira" : "" })),
  planHold,
});
const planned = (): VnTurnInput => ({
  mode: "cyoa",
  paragraphs: texts.map((text, index) => ({ id: `fp:${index}`, text, speaker: index === 0 ? "" : "Mira", ...(index === 2 ? { effect: "shake" as const } : {}) })),
  choices: [{ id: "c1", label: "Open it", value: "Open it" }],
  ambient: "rain",
});
const run = (state: VnStageState, ...actions: VnStageAction[]) => actions.reduce(reduceVnStage, state);
const loaded = (turn = provisional()) => run(createInitialVnStageState(), { type: "load-turn", turn });

describe("provisional turn hold", () => {
  test("reading on: every paragraph is readable, the final one waits for the plan", () => {
    const state = run(loaded(), { type: "advance" }, { type: "advance" }, { type: "advance" });
    expect(state.currentParagraphIndex).toBe(3);
    expect(selectVnStageView(state)).toMatchObject({ canAdvance: false, waitingForPlan: true });
    // Acknowledging the final paragraph cannot reach Your turn before the choices exist.
    const after = reduceVnStage(state, { type: "advance" });
    expect(after.phase).toBe("revealing");
    expect(after.turnFinished).toBe(false);
  });

  test("a hold at paragraph N stops the reader there with the indicator flag", () => {
    const state = run(loaded(provisional(1)), { type: "advance" }, { type: "advance" }, { type: "advance" });
    expect(state.currentParagraphIndex).toBe(1);
    expect(selectVnStageView(state).waitingForPlan).toBe(true);
    // Rereading stays possible.
    expect(reduceVnStage(state, { type: "previous" }).currentParagraphIndex).toBe(0);
  });

  test("rereading the text before its plan keeps the scene it shows", () => {
    const image = { url: "/api/v1/images/scene", alt: "", requestId: "scene" };
    const shown = { ...run(loaded(), { type: "advance" }), displayedImage: image };
    expect(reduceVnStage(shown, { type: "previous" }).displayedImage).toEqual(image);
    // A planned turn's earlier paragraph gets its own image from the host.
    const plannedShown = { ...run(loaded(planned()), { type: "advance" }), displayedImage: image };
    expect(reduceVnStage(plannedShown, { type: "previous" }).displayedImage).toBeNull();
  });

  test("a planned turn loads with no hold", () => {
    const state = loaded(planned());
    expect(state.planHold).toBeNull();
    expect(selectVnStageView(state).waitingForPlan).toBe(false);
  });
});

describe("upgrade-turn reducer", () => {
  test("keeps the reader's place and takes speakers, effects, ambient, choices and mode from the plan", () => {
    const before = run(loaded(), { type: "advance" }, { type: "advance" }, { type: "previous" });
    expect(before).toMatchObject({ currentParagraphIndex: 1, highestRevealedIndex: 2 });
    const after = reduceVnStage(before, { type: "upgrade-turn", turn: planned() });
    expect(after.currentParagraphIndex).toBe(1);
    expect(after.highestRevealedIndex).toBe(2);
    expect(after.phase).toBe("revealing");
    expect(after.mode).toBe("cyoa");
    expect(after.choices.map((choice) => choice.id)).toEqual(["c1"]);
    expect(after.ambient).toBe("rain");
    expect(after.paragraphs.map((paragraph) => paragraph.speaker)).toEqual(["", "Mira", "Mira", "Mira"]);
    expect(after.paragraphs[2]?.effect).toBe("shake");
    expect(after.planHold).toBeNull();
  });

  test("the held final paragraph can be acknowledged once the plan lands", () => {
    const held = run(loaded(), { type: "advance" }, { type: "advance" }, { type: "advance" }, { type: "advance" });
    expect(held.phase).toBe("revealing");
    const after = run(held, { type: "upgrade-turn", turn: planned() }, { type: "advance" });
    expect(after.phase).toBe("awaiting-input");
    expect(selectVnStageView(after).showChoices).toBe(true);
  });

  test("a retry pressed while the text waited ends with the plan", () => {
    const state = run(loaded(), { type: "set-phase", phase: "planning" }, { type: "upgrade-turn", turn: planned() });
    expect(state.phase).toBe("revealing");
    expect(state.currentParagraphIndex).toBe(0);
  });

  test("a plan whose read text differs loads from the start instead", () => {
    const before = run(loaded(), { type: "advance" }, { type: "advance" });
    const changed = planned();
    const turn: VnTurnInput = { ...changed, paragraphs: changed.paragraphs.map((paragraph, index) => index === 1 ? { ...paragraph, text: "Another line." } : paragraph) };
    expect(canUpgradeTurn(before, turn)).toBe(false);
    const after = reduceVnStage(before, { type: "upgrade-turn", turn });
    expect(after.currentParagraphIndex).toBe(0);
    expect(after.highestRevealedIndex).toBe(0);
  });

  test("unread paragraphs may differ; read ones may not; the reader's own line never upgrades", () => {
    const before = loaded();
    const turn = planned();
    expect(canUpgradeTurn(before, { ...turn, paragraphs: turn.paragraphs.slice(0, 2) })).toBe(true);
    expect(canUpgradeTurn(before, { ...turn, paragraphs: turn.paragraphs.map((paragraph) => ({ ...paragraph, id: `other:${paragraph.id}` })) })).toBe(false);
    expect(canUpgradeTurn(createInitialVnStageState(), turn)).toBe(false);
    const ownLine = reduceVnStage(before, { type: "present-user-paragraph", paragraph: { id: "user-1", text: "Hello." } });
    expect(canUpgradeTurn(ownLine, turn)).toBe(false);
  });
});
