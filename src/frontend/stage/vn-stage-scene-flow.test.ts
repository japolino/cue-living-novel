import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeEvent, FakeNode, installFakeDocument } from "./stage-test-dom";
import { DEFAULT_READING_FLOW, VnStage, type VnReadingFlow, type VnStageOptions } from "./vn-stage";
import type { VnTurnInput } from "../store";

/**
 * How a reply opens, waits and ends on the stage: the opening card, the
 * location label, the waiting screen, the reply box's extras and the whole
 * reply in History.
 */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const scenes = [
  { startParagraph: 0, location: "Kitchen, Hale house", timeOfDay: "morning", weather: "rain" },
  { startParagraph: 1, location: "Porch", timeOfDay: "noon", weather: null },
];
const turn = (patch: Partial<VnTurnInput> = {}): VnTurnInput => ({
  paragraphs: [
    { id: "t:0", text: "“Morning!” Mira bounds in.", speaker: "Mira" },
    { id: "t:1", text: "They step outside.", speaker: "" },
    { id: "t:2", text: "“Nice day,” says Ren.", speaker: "Ren" },
  ],
  scenes,
  cardBackgroundUrl: "/bg.png",
  writer: "Mira",
  ...patch,
});

describe("scene flow on the stage", () => {
  let restore: () => void;
  let mount: FakeNode;
  let stage: VnStage | null;
  let readingStarts: number;
  let previous: number[];

  const create = (flow: Partial<VnReadingFlow> = {}, options: Partial<VnStageOptions> = {}): VnStage => {
    stage = new VnStage({
      mount: mount as unknown as HTMLElement,
      textSpeed: 0,
      onReadingStart: () => { readingStarts += 1; },
      onPrevious: (index) => { previous.push(index); },
      ...options,
    });
    // No motion: cards and screens show and hide at once.
    stage.setEffectIntensity("off");
    stage.setReadingFlow({ ...DEFAULT_READING_FLOW, ...flow });
    return stage;
  };
  const root = (s: VnStage): FakeNode => (s as unknown as { root: FakeNode }).root;
  const q = (s: VnStage, selector: string): FakeNode | null => root(s).querySelector(selector);
  const must = (s: VnStage, selector: string): FakeNode => {
    const node = q(s, selector);
    if (!node) throw new Error(`missing ${selector}`);
    return node;
  };
  const text = (s: VnStage) => must(s, "[data-vn-dialogue-text]").textContent;
  const advance = (s: VnStage) => (s as unknown as { advance(fromReader?: boolean): void }).advance(true);
  const key = (s: VnStage, value: string) => root(s).dispatchEvent(new FakeEvent("keydown", { key: value }));
  const toEnd = (s: VnStage) => { while (s.getState().phase === "revealing") advance(s); };

  beforeEach(() => {
    restore = installFakeDocument();
    mount = new FakeNode("div");
    stage = null;
    readingStarts = 0;
    previous = [];
  });
  afterEach(() => {
    stage?.destroy();
    restore();
  });

  test("the opening card holds the first paragraph until a tap, then reading starts", () => {
    const s = create({ openingCard: "title", playOnArrival: false });
    s.loadTurn(turn());
    expect(s.isOpeningCardOpen()).toBe(true);
    const card = must(s, "[data-vn-opening]");
    expect(card.hidden).toBe(false);
    expect(must(s, "[data-vn-opening] [data-vn-scene-title]").textContent).toBe("Kitchen, Hale house");
    expect(must(s, "[data-vn-opening] [data-vn-scene-meta]").textContent).toBe("rain · morning · 3 paragraphs");
    expect(must(s, "[data-vn-opening] [data-vn-opening-status]").textContent).toBe("Ready · tap to start");
    expect(text(s)).not.toContain("Morning!");
    expect(readingStarts).toBe(0);
    // A tap on the stage behind it does not read on.
    advance(s);
    expect(s.isOpeningCardOpen()).toBe(false);
    expect(readingStarts).toBe(1);
    expect(s.getState().currentParagraphIndex).toBe(0);
    expect(text(s)).toContain("Morning!");
    expect(card.hidden).toBe(true);
  });

  test("with play on arrival the card closes by itself once the reply is ready", async () => {
    const s = create({ openingCard: "title", openingCardMinMs: 30 });
    s.loadTurn(turn());
    expect(s.isOpeningCardOpen()).toBe(true);
    expect(must(s, "[data-vn-opening] [data-vn-opening-status]").textContent).toBe("Ready");
    await wait(80);
    expect(s.isOpeningCardOpen()).toBe(false);
    expect(readingStarts).toBe(1);
    expect(text(s)).toContain("Morning!");
  });

  test("Space starts reading from the card; S starts and skips to Your turn", async () => {
    const s = create({ openingCard: "title", playOnArrival: false });
    s.loadTurn(turn());
    key(s, " ");
    expect(s.isOpeningCardOpen()).toBe(false);
    expect(s.getState().currentParagraphIndex).toBe(0);

    s.loadTurn(turn({ paragraphs: turn().paragraphs.map((paragraph) => ({ ...paragraph, id: `n${paragraph.id}` })) }));
    expect(s.isOpeningCardOpen()).toBe(true);
    key(s, "s");
    expect(s.isOpeningCardOpen()).toBe(false);
    await wait(400);
    expect(s.getState().phase).toBe("awaiting-input");
  });

  test("the card's background picture only when that setting is on", () => {
    const s = create({ openingCard: "title", playOnArrival: false, cardBackground: false });
    s.loadTurn(turn());
    expect(must(s, "[data-vn-opening]").dataset.vnOpeningPicture).toBeUndefined();
    s.setReadingFlow({ ...DEFAULT_READING_FLOW, openingCard: "title", playOnArrival: false });
    s.replayOpeningCard();
    expect(must(s, "[data-vn-opening]").dataset.vnOpeningPicture).toBe("");
  });

  test("replaying the opening card starts the reply again from its first paragraph", () => {
    const s = create({ openingCard: "off" });
    s.loadTurn(turn());
    toEnd(s);
    expect(s.getState().phase).toBe("awaiting-input");
    s.replayOpeningCard();
    expect(s.isOpeningCardOpen()).toBe(true);
    expect(s.getState().currentParagraphIndex).toBe(0);
    expect(s.getState().phase).toBe("revealing");
    advance(s);
    expect(text(s)).toContain("Morning!");
  });

  test("the location label follows the scene of the paragraph being read", () => {
    const s = create();
    s.loadTurn(turn());
    const label = must(s, "[data-vn-location]");
    expect(label.hidden).toBe(false);
    expect(must(s, "[data-vn-location-place]").textContent).toBe("Kitchen, Hale house");
    expect(must(s, "[data-vn-location-meta]").textContent).toBe("morning · rain");
    advance(s);
    expect(must(s, "[data-vn-location-place]").textContent).toBe("Porch");
    s.setReadingFlow({ ...DEFAULT_READING_FLOW, locationLabel: false });
    expect(label.hidden).toBe(true);
  });

  test("no label while the opening card covers the stage", () => {
    const s = create({ openingCard: "title", playOnArrival: false });
    s.loadTurn(turn());
    expect(q(s, "[data-vn-location]")?.hidden ?? true).toBe(true);
    advance(s);
    expect(must(s, "[data-vn-location]").hidden).toBe(false);
  });

  test("the waiting screen recalls the reply while the next is written, and goes when it arrives", () => {
    const s = create({ waitingBackdrop: "tidy", waitingRecap: "film" });
    s.loadTurn(turn());
    toEnd(s);
    s.presentUserParagraph("Let's go for a walk.", "Alex");
    toEnd(s);
    s.setPhase("waiting-for-response");
    const screen = must(s, "[data-vn-waiting]");
    expect(screen.hidden).toBe(false);
    expect(screen.dataset.vnBackdrop).toBe("tidy");
    expect(screen.dataset.vnRecap).toBe("film");
    expect(must(s, "[data-vn-waiting-sent-text]").textContent).toBe("Let's go for a walk.");
    expect(must(s, "[data-vn-waiting-status]").textContent).toBe("Mira is writing the next scene…");
    // The film has the reply and the reader's line.
    expect(root(s).querySelectorAll("[data-vn-film-track] > [data-vn-film-card]").map((card) => card.dataset.vnFilmKind)).toEqual([
      "character", "narration", "character", "reader",
    ]);
    s.setPhase("planning");
    expect(must(s, "[data-vn-waiting-status]").textContent).toBe("Setting the next scene…");
    s.loadTurn(turn({ paragraphs: [{ id: "u:0", text: "Outside.", speaker: "" }] }));
    expect(screen.hidden).toBe(true);
  });

  test("waiting backdrop off: only the status line, as before", () => {
    const s = create({ waitingBackdrop: "off" });
    s.loadTurn(turn());
    toEnd(s);
    s.setPhase("waiting-for-response");
    expect(q(s, "[data-vn-waiting]")?.hidden ?? true).toBe(true);
  });

  test("a preview from Settings closes on a tap away and leaves the reply where it was", () => {
    const s = create();
    s.loadTurn(turn());
    s.previewWaitingScreen();
    const screen = must(s, "[data-vn-waiting]");
    expect(screen.hidden).toBe(false);
    expect(screen.dataset.vnWaitingPreview).toBe("");
    // Reading keys do nothing under the preview.
    key(s, "ArrowRight");
    expect(s.getState().currentParagraphIndex).toBe(0);
    must(s, "[data-vn-waiting] [data-vn-scene-title]").dispatchEvent(new FakeEvent("click"));
    expect(screen.hidden).toBe(true);
    expect(s.getState().currentParagraphIndex).toBe(0);
  });

  test("the reply box's extras: Previous, From the start and Close", () => {
    const s = create();
    s.loadTurn(turn());
    toEnd(s);
    const action = (name: string) => must(s, `[data-vn-interaction-action='${name}']`);
    expect(must(s, "[data-vn-interaction-actions]").hidden).toBe(false);
    expect(action("previous").disabled).toBe(false);
    expect(action("restart").disabled).toBe(false);
    action("close").dispatchEvent(new FakeEvent("click"));
    expect(must(s, "[data-vn-interaction]").hidden).toBe(true);
    const reply = must(s, "[data-vn-reply-open]");
    expect(reply.hidden).toBe(false);
    reply.dispatchEvent(new FakeEvent("click"));
    expect(must(s, "[data-vn-interaction]").hidden).toBe(false);
    expect(reply.hidden).toBe(true);
    action("restart").dispatchEvent(new FakeEvent("click"));
    expect(s.getState().currentParagraphIndex).toBe(0);
    expect(s.getState().phase).toBe("revealing");
    expect(previous).toEqual([0]);
  });

  test("reply box at the end off: the last scene stays in view and a tap opens the box", () => {
    const s = create({ replyBoxAtEnd: false });
    s.loadTurn(turn());
    toEnd(s);
    expect(s.getState().phase).toBe("awaiting-input");
    expect(must(s, "[data-vn-interaction]").hidden).toBe(true);
    expect(must(s, "[data-vn-reply-open]").hidden).toBe(false);
    advance(s);
    expect(must(s, "[data-vn-interaction]").hidden).toBe(false);
    expect(must(s, "[data-vn-reply-open]").hidden).toBe(true);
  });

  test("while sending, the reply box stays and says so", () => {
    const s = create();
    s.loadTurn(turn());
    toEnd(s);
    s.setPhase("submitting");
    expect(must(s, "[data-vn-interaction]").hidden).toBe(false);
    expect(must(s, "[data-vn-submit-label]").textContent).toBe("Sending…");
    for (const button of root(s).querySelectorAll("[data-vn-interaction-action]")) expect(button.disabled).toBe(true);
  });

  test("History's whole reply lists every paragraph, the unread ones marked", () => {
    const s = create();
    s.loadTurn(turn());
    s.openBacklog();
    expect(root(s).querySelectorAll("[data-vn-backlog-item]")).toHaveLength(1);
    const toggle = must(s, "[data-vn-backlog-script]");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    toggle.dispatchEvent(new FakeEvent("click"));
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const items = root(s).querySelectorAll("[data-vn-backlog-item]");
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.getAttribute("data-vn-backlog-unread") !== null)).toEqual([false, true, true]);
  });
});
