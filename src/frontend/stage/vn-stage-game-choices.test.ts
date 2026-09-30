import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import { VnStage, type VnGameChoice } from "./vn-stage";

const moves: VnGameChoice[] = [
  { id: "talk", label: "Ask about the letter", group: "Talk", detail: "Persuade · 62%", odds: 0.62 },
  { id: "go:docks", label: "Go to the docks", group: "Travel", detail: null, odds: null },
];

describe("game-engine moves on the stage", () => {
  let restore: () => void;
  let stage: VnStage | null = null;
  const root = (s: VnStage): FakeNode => (s as unknown as { root: FakeNode }).root;
  const q = (s: VnStage, selector: string): FakeNode => root(s).querySelector(selector)!;
  const advance = (s: VnStage) => (s as unknown as { advance(): void }).advance();

  beforeEach(() => { restore = installFakeDocument(); });
  afterEach(() => { stage?.destroy(); stage = null; restore(); });

  test("moves show at Your turn in standard mode, grouped, with odds badges", () => {
    stage = new VnStage({ mount: new FakeNode("div") as unknown as HTMLElement, textSpeed: 0 });
    stage.setGameChoices(moves);
    const list = q(stage, "[data-vn-game-choices]");
    expect(list.hidden).toBe(true); // still reading
    stage.loadTurn({ mode: "standard", paragraphs: [{ id: "p0", text: "Hello.", speaker: "Mira" }] });
    advance(stage);
    expect(list.hidden).toBe(false);
    const buttons = root(stage).querySelectorAll("[data-vn-game-choice]");
    expect(buttons.map((b) => b.dataset.vnGameChoiceId)).toEqual(["talk", "go:docks"]);
    expect(root(stage).querySelectorAll("[data-vn-game-group-label]").map((l) => l.textContent)).toEqual(["Talk", "Travel"]);
    expect(q(stage, "[data-vn-game-odds]").textContent).toBe("62%");
    expect(q(stage, "[data-vn-interaction-hint]").textContent).toContain("Pick a move");
  });

  test("picking a move calls the host once; busy providers disable the buttons", async () => {
    const picked: string[] = [];
    stage = new VnStage({ mount: new FakeNode("div") as unknown as HTMLElement, textSpeed: 0, onGameChoice: (c) => { picked.push(c.id); } });
    stage.loadTurn({ mode: "cyoa", paragraphs: [{ id: "p0", text: "Hello.", speaker: "Mira" }], choices: [{ id: "a", label: "A", value: "a" }] });
    advance(stage);
    stage.setGameChoices(moves);
    root(stage).querySelectorAll("[data-vn-game-choice]")[0]!.click();
    await Promise.resolve();
    expect(picked).toEqual(["talk"]);
    stage.setGameChoices(moves, true);
    expect(root(stage).querySelectorAll("[data-vn-game-choice]").every((b) => b.disabled)).toBe(true);
    stage.setGameChoices([]);
    expect(q(stage, "[data-vn-game-choices]").hidden).toBe(true);
  });
});
