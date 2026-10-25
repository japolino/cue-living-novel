import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import { VnStage, type VnStageOptions } from "./vn-stage";
import type { StageEffect, VnTurnInput } from "../store";

/**
 * The stage side of the provisional turn: the reply's text shows before its
 * plan, and the planned turn upgrades it where the reader is.
 */

const texts = ["The door creaks open.", "Mira lifts the lantern.", "Wind howls through the hall.", "A shape moves."];
const provisional = (planHold = Number.POSITIVE_INFINITY): VnTurnInput => ({
  mode: "standard",
  paragraphs: texts.map((text, index) => ({ id: `fp:${index}`, text, speaker: "" })),
  preserveImage: true,
  planHold,
});
const planned = (effects: Partial<Record<number, StageEffect>> = {}): VnTurnInput => ({
  mode: "standard",
  paragraphs: texts.map((text, index) => ({
    id: `fp:${index}`,
    text,
    speaker: index === 0 ? "" : "Mira",
    ...(effects[index] ? { effect: effects[index] } : {}),
    ...(index === 1 ? { ambient: "rain" as const } : {}),
  })),
  preserveImage: true,
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("upgradeTurn", () => {
  let restore: () => void;
  let mount: FakeNode;
  let stage: VnStage | null;

  const create = (options: Partial<VnStageOptions> = {}): VnStage => {
    stage = new VnStage({ mount: mount as unknown as HTMLElement, textSpeed: 0, ...options });
    return stage;
  };
  const root = (s: VnStage): FakeNode => (s as unknown as { root: FakeNode }).root;
  const q = (s: VnStage, selector: string): FakeNode => {
    const node = root(s).querySelector(selector);
    if (!node) throw new Error(`missing ${selector}`);
    return node;
  };
  const advance = (s: VnStage) => (s as unknown as { advance(): void }).advance();
  const badgeTexts = (s: VnStage) => root(s).querySelectorAll("[data-vn-badge]").map((b) => b.textContent.trim());
  const effectsOf = (s: VnStage): StageEffect[] => {
    const fired: StageEffect[] = [];
    const original = s.triggerEffect.bind(s);
    s.triggerEffect = (effect: StageEffect) => { fired.push(effect); original(effect); };
    return fired;
  };
  const history = (s: VnStage) => {
    s.openBacklog();
    const items = root(s).querySelectorAll("[data-vn-backlog-item]").map((item) => ({
      speaker: item.querySelector("[data-vn-backlog-speaker]")?.textContent ?? "",
      text: item.querySelector("[data-vn-backlog-text]")?.textContent ?? "",
    }));
    s.closeBacklog();
    return items;
  };

  beforeEach(() => {
    restore = installFakeDocument();
    mount = new FakeNode("div");
    stage = null;
  });

  afterEach(() => {
    stage?.destroy();
    restore();
  });

  test("the paragraph on screen gets its nameplate and ambient without its effect or a second History entry", () => {
    const s = create();
    s.loadTurn(provisional());
    advance(s);
    expect(q(s, "[data-vn-speaker]").hidden).toBe(true);
    const fired = effectsOf(s);
    const textBefore = q(s, "[data-vn-dialogue-text]").textContent;

    s.upgradeTurn(planned({ 1: "flash_white", 2: "shake" }));

    expect(s.getState().currentParagraphIndex).toBe(1);
    expect(q(s, "[data-vn-speaker]").textContent).toBe("Mira");
    expect(q(s, "[data-vn-speaker]").hidden).toBe(false);
    expect(fired).toEqual([]);
    expect(q(s, "[data-vn-dialogue-text]").textContent).toBe(textBefore);
    expect(s.getCurrentAmbient()).toBe("rain");
    // Read paragraphs carry the plan's speakers in History; nothing was added twice.
    expect(history(s)).toEqual([
      { speaker: "", text: texts[0]! },
      { speaker: "Mira", text: texts[1]! },
    ]);

    // Paragraphs the reader has not reached yet play everything from the plan.
    advance(s);
    expect(fired).toEqual(["shake"]);
    expect(q(s, "[data-vn-speaker]").textContent).toBe("Mira");
  });

  test("the opening paragraph the plan reaches right after it appeared plays its effect", () => {
    const s = create();
    s.loadTurn(provisional());
    const fired = effectsOf(s);
    expect(s.upgradeTurn(planned({ 0: "flash_white" }))).toBe(true);
    expect(fired).toEqual(["flash_white"]);
  });

  test("an opening paragraph read for a while keeps the moment it had", () => {
    const s = create();
    s.loadTurn(provisional());
    // The reader has been on it for seconds (a slow plan).
    (s as unknown as { openingShownAt: number }).openingShownAt = Date.now() - 5000;
    const fired = effectsOf(s);
    expect(s.upgradeTurn(planned({ 0: "flash_white" }))).toBe(false);
    expect(fired).toEqual([]);
  });

  test("a preset that quotes spoken lines re-renders the paragraph on screen whole, without its effect", () => {
    const s = create();
    s.setThemePreset("literature-club");
    s.loadTurn(provisional());
    advance(s);
    const fired = effectsOf(s);
    s.upgradeTurn(planned({ 1: "shake" }));
    expect(q(s, "[data-vn-dialogue-text]").textContent).toBe(`"${texts[1]}"`);
    expect(fired).toEqual([]);
    expect(history(s).at(-1)).toEqual({ speaker: "Mira", text: `"${texts[1]}"` });
  });

  test("a typewriter mid-paragraph keeps typing through the upgrade", async () => {
    const s = create({ textSpeed: 5 });
    s.loadTurn(provisional());
    await wait(20);
    const partial = q(s, "[data-vn-dialogue-text]").textContent;
    s.upgradeTurn(planned());
    await wait(400);
    expect(q(s, "[data-vn-dialogue-text]").textContent).toBe(texts[0]!);
    expect(partial.length).toBeGreaterThan(0);
  });

  test("the reader waits at the hold with Preparing the scene until the plan lands", () => {
    const s = create();
    s.loadTurn(provisional(1));
    advance(s);
    advance(s);
    expect(s.getState().currentParagraphIndex).toBe(1);
    expect(badgeTexts(s)).toContain("Preparing the scene…");
    expect(root(s).getAttribute("data-vn-plan-pending")).toBe("");
    expect(q(s, "[data-vn-continue]").disabled).toBe(true);

    s.upgradeTurn(planned());
    expect(badgeTexts(s)).not.toContain("Preparing the scene…");
    expect(root(s).getAttribute("data-vn-plan-pending")).toBeNull();
    advance(s);
    expect(s.getState().currentParagraphIndex).toBe(2);
  });

  test("auto play held at the plan carries on once it lands", () => {
    const s = create();
    const countdown = () => (s as unknown as { autoPlayTimer: unknown }).autoPlayTimer;
    s.loadTurn(provisional(0));
    s.toggleAutoPlay(true);
    expect(countdown()).toBeNull();
    s.upgradeTurn(planned());
    expect(countdown()).not.toBeNull();
  });

  test("skip held by the plan stays on and carries on once it lands", async () => {
    const s = create();
    s.setSkipMode("all");
    s.loadTurn(provisional(1));
    s.toggleSkip(true);
    await wait(250);
    expect(s.getState().currentParagraphIndex).toBe(1);
    expect(q(s, "[data-vn-control='skip']").getAttribute("aria-pressed")).toBe("true");
    s.upgradeTurn(planned());
    await wait(400);
    // Skip all reaches the end of the turn: Your turn.
    expect(s.getState().currentParagraphIndex).toBe(3);
    expect(s.getState().phase).toBe("awaiting-input");
  });

  test("a fallback load forgets what was read from the first changed paragraph on", () => {
    const s = create();
    s.loadTurn(provisional());
    advance(s);
    advance(s);
    const turn = planned();
    s.upgradeTurn({ ...turn, paragraphs: turn.paragraphs.map((paragraph, index) => index === 1 ? { ...paragraph, text: "Changed." } : paragraph) });
    expect(s.getState().currentParagraphIndex).toBe(0);
    // The unchanged opening stays; the old second and third paragraphs are gone.
    expect(history(s).map((entry) => entry.text)).toEqual([texts[0]!]);
    advance(s);
    expect(history(s).map((entry) => entry.text)).toEqual([texts[0]!, "Changed."]);
    // Skip "read" stops at the changed paragraph's successor: it was never read.
    expect((s as unknown as { readParagraphIds: Set<string> }).readParagraphIds.has("fp:2")).toBe(false);
  });

  test("a plan whose read text changed is loaded from the start", () => {
    const s = create();
    s.loadTurn(provisional());
    advance(s);
    const turn = planned();
    s.upgradeTurn({ ...turn, paragraphs: turn.paragraphs.map((paragraph, index) => index === 0 ? { ...paragraph, text: "Different." } : paragraph) });
    expect(s.getState().currentParagraphIndex).toBe(0);
    expect(q(s, "[data-vn-dialogue-text]").textContent).toBe("Different.");
  });
});
