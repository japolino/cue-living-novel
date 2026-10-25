import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeEvent, FakeNode, installFakeDocument } from "./stage-test-dom";
import type { RecapCharacter, RecapImage, WaitingRecap } from "./recap";
import { WaitingScreen, quoteLine, resolveRecapMode, type WaitingScreenOptions } from "./waiting-screen";

/** The waiting screen: backdrops, recaps, taps and the preview. */
const image = (url: string): RecapImage => ({ url, bbox: [0.1, 0, 0.8, 1], width: 832, height: 1216 });
const character = (key: string, name: string, lines: Array<[string, string | null, string | null]>, patch: Partial<RecapCharacter> = {}): RecapCharacter => ({
  key,
  name,
  color: "#e8a0bf",
  kind: "character",
  onStage: true,
  image: lines.at(-1)?.[2] ? image(lines.at(-1)![2]!) : null,
  lines: lines.map(([excerpt, chip, url], index) => ({ index, excerpt, text: `${excerpt} (whole)`, chip, image: url ? image(url) : null })),
  ...patch,
});

const mira = character("mira", "Mira", [["Morning!", "Hops", "/mira/idle.png"], ["Come outside.", "Smile", "/mira/smile.png"]]);
const ren = character("ren", "Ren", [["Too loud.", "Angry", "/ren/idle.png"]]);

const recap = (patch: Partial<WaitingRecap> = {}): WaitingRecap => ({
  characters: [mira, ren],
  voices: [],
  entries: [
    { index: 0, speaker: "Mira", color: "#e8a0bf", kind: "character", excerpt: "Morning!", text: "“Morning!” Mira bounds in.", chip: "Hops", image: image("/mira/idle.png") },
    { index: 1, speaker: "", color: "#aaa", kind: "narration", excerpt: "The rain eases off.", text: "The rain eases off.", chip: null, image: null },
    { index: 2, speaker: "Ren", color: "#9ad0f5", kind: "character", excerpt: "Too loud.", text: "“Too loud,” Ren mutters.", chip: "Angry", image: image("/ren/idle.png") },
  ],
  paragraphCount: 3,
  scene: { startParagraph: 0, location: "Kitchen, Hale house", timeOfDay: "morning", weather: "rain" },
  sent: "Good morning <3",
  writer: "Mira",
  backgroundUrl: "/bg.png",
  ...patch,
});

const options = (patch: Partial<WaitingScreenOptions> = {}): WaitingScreenOptions => ({
  backdrop: "card", recap: "auto", preview: false, motion: false, ...patch,
});

describe("waiting screen", () => {
  let restore: () => void;
  let screen: WaitingScreen;
  let taps: number;
  let pops: number;
  let closes: number;
  const el = () => screen.element as unknown as FakeNode;
  const q = (selector: string) => el().querySelector(selector);
  const click = (node: FakeNode) => node.dispatchEvent(new FakeEvent("click"));

  beforeEach(() => {
    restore = installFakeDocument();
    taps = 0;
    pops = 0;
    closes = 0;
    screen = new WaitingScreen({ onTap: () => { taps += 1; }, onPop: () => { pops += 1; }, onClose: () => { closes += 1; } });
  });
  afterEach(() => {
    screen.dismiss();
    restore();
  });

  test("auto: a line-up up to three characters, cards from four, cards for inner voices alone", () => {
    const many = { characters: [mira, ren, mira, ren], voices: [], entries: [] };
    expect(resolveRecapMode("auto", { characters: [mira], voices: [], entries: [] })).toBe("lineup");
    expect(resolveRecapMode("auto", many)).toBe("cards");
    expect(resolveRecapMode("auto", { characters: [], voices: [mira], entries: [] })).toBe("cards");
    expect(resolveRecapMode("auto", { characters: [], voices: [], entries: [] })).toBe("off");
    expect(resolveRecapMode("film", many)).toBe("film");
  });

  test("auto: the film when nobody has a picture but there are lines to show", () => {
    const plain = character("aoi", "Aoi", [["Hello.", null, null]]);
    const said = recap().entries.map((entry) => ({ ...entry, image: null }));
    expect(resolveRecapMode("auto", { characters: [plain], voices: [], entries: said })).toBe("film");
    expect(resolveRecapMode("auto", { characters: [plain], voices: [], entries: [] })).toBe("lineup");
    expect(resolveRecapMode("auto", { characters: [mira, plain], voices: [], entries: said })).toBe("lineup");
  });

  test("lines are quoted for their script", () => {
    expect(quoteLine("Hello")).toBe("“Hello”");
    expect(quoteLine("おはよう")).toBe("「おはよう」");
    expect(quoteLine("안녕")).toBe("「안녕」");
  });

  test("the scene card backdrop: scene words, status, what you sent (escaped) and the picture", () => {
    screen.show(recap(), options(), "Mira is writing the next scene…");
    expect(screen.isOpen()).toBe(true);
    expect(screen.mode()).toBe("lineup");
    expect(el().dataset.vnBackdrop).toBe("card");
    expect(q("[data-vn-scene-kicker]")!.textContent).toBe("Scene · Hale house");
    expect(q("[data-vn-scene-title]")!.textContent).toBe("Kitchen, Hale house");
    expect(q("[data-vn-scene-meta]")!.textContent).toBe("rain · morning · 3 paragraphs");
    expect(q("[data-vn-waiting-status]")!.textContent).toBe("Mira is writing the next scene…");
    expect(q("[data-vn-waiting-sent-text]")!.textContent).toBe("Good morning <3");
    expect(q("[data-vn-waiting-bg]")!.getAttribute("style")).toBe('background-image: url("/bg.png")');
    screen.setStatus("Setting the next scene…");
    expect(q("[data-vn-waiting-status]")!.textContent).toBe("Setting the next scene…");
  });

  test("line-up: a tap bounces nothing without motion, pops the next line and swaps to that line's picture", () => {
    screen.show(recap(), options({ recap: "lineup" }), "");
    const figures = el().querySelectorAll("[data-vn-waiting-figure]");
    expect(figures.map((figure) => figure.querySelector("[data-vn-name-tag]")!.textContent)).toEqual(["Mira", "Ren"]);
    const first = figures[0]!;
    expect(first.getAttribute("aria-label")).toBe("Mira: next line");
    expect(first.querySelector("[data-vn-bubble-text]")!.textContent).toBe("“Morning!”");
    expect(first.querySelector("[data-vn-bubble-chip]")!.textContent).toBe("Hops");
    click(first.querySelector("[data-vn-name-tag]")!);
    expect([taps, pops]).toEqual([1, 1]);
    expect(first.querySelector("[data-vn-bubble-text]")!.textContent).toBe("“Come outside.”");
    expect(first.querySelector("[data-vn-bubble-chip]")!.textContent).toBe("Smile");
    const front = first.querySelector("[data-vn-figure-img][data-vn-front]")!;
    expect(front.getAttribute("src")).toBe("/mira/smile.png");
    expect(first.querySelectorAll("[data-vn-figure-img][data-vn-front]")).toHaveLength(1);
    // Round again: the first line and picture come back.
    click(first);
    expect(first.querySelector("[data-vn-bubble-text]")!.textContent).toBe("“Morning!”");
    expect(first.querySelector("[data-vn-figure-img][data-vn-front]")!.getAttribute("src")).toBe("/mira/idle.png");
  });

  test("a line-up too narrow for every bubble shows one at a time; a tap passes it on", () => {
    // 200 px for two figures: under WAITING_CROWDED_SLOT_PX each.
    const width = Object.getOwnPropertyDescriptor(FakeNode.prototype, "clientWidth");
    Object.defineProperty(FakeNode.prototype, "clientWidth", {
      configurable: true,
      get(this: FakeNode) { return this.hasAttribute("data-vn-lineup") ? 200 : 0; },
    });
    try {
      screen.show(recap(), options({ recap: "lineup" }), "");
      expect(q("[data-vn-lineup]")!.hasAttribute("data-vn-lineup-crowded")).toBe(true);
      const [first, second] = el().querySelectorAll("[data-vn-waiting-figure]");
      const speaking = () => el().querySelectorAll("[data-vn-figure-speaking]");
      expect(speaking()).toEqual([first!]);
      // Ren's first tap gives him the bubble with his first line, no new line yet.
      click(second!);
      expect(speaking()).toEqual([second!]);
      expect(second!.querySelector("[data-vn-bubble-text]")!.textContent).toBe("“Too loud.”");
      // Mira has spoken already: her tap brings her next line.
      click(first!);
      expect(speaking()).toEqual([first!]);
      expect(first!.querySelector("[data-vn-bubble-text]")!.textContent).toBe("“Come outside.”");
    } finally {
      if (width) Object.defineProperty(FakeNode.prototype, "clientWidth", width);
      else delete (FakeNode.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  test("a wide line-up shows every bubble at once", () => {
    screen.show(recap(), options({ recap: "lineup" }), "");
    expect(q("[data-vn-lineup]")!.hasAttribute("data-vn-lineup-crowded")).toBe(false);
    expect(el().querySelectorAll("[data-vn-figure-speaking]")).toHaveLength(0);
  });

  test("with motion a tap bounces the figure and the bubble swaps after its fade", async () => {
    screen.show(recap(), options({ recap: "lineup", motion: true }), "");
    const first = el().querySelectorAll("[data-vn-waiting-figure]")[0]!;
    click(first);
    expect(first.getAttribute("data-vn-figure-bounce")).toBe("");
    expect(first.querySelector("[data-vn-bubble]")!.dataset.vnBubbleState).toBe("out");
    await new Promise((resolve) => setTimeout(resolve, 240));
    expect(first.querySelector("[data-vn-bubble]")!.dataset.vnBubbleState).toBe("in");
    expect(first.querySelector("[data-vn-bubble-text]")!.textContent).toBe("“Come outside.”");
  });

  test("flashback cards: one character at a time with their last line; a tap moves on", () => {
    screen.show(recap(), options({ recap: "cards" }), "");
    expect(screen.mode()).toBe("cards");
    expect(q("[data-vn-recap-name]")!.textContent).toBe("Mira");
    expect(q("[data-vn-recap-line]")!.textContent).toBe("“Come outside.”");
    expect(q("[data-vn-recap-chip]")!.hidden).toBe(false);
    expect(q("[data-vn-card-img][data-vn-front]")!.getAttribute("src")).toBe("/mira/smile.png");
    expect(el().querySelectorAll("[data-vn-recap-dots] li")).toHaveLength(2);
    click(q("[data-vn-recap-card]")!);
    expect([taps, pops]).toEqual([1, 1]);
    expect(q("[data-vn-recap-name]")!.textContent).toBe("Ren");
    expect(q("[data-vn-card-img][data-vn-front]")!.getAttribute("src")).toBe("/ren/idle.png");
    expect(el().querySelectorAll("[data-vn-card-img][data-vn-front]")).toHaveLength(1);
  });

  test("flashback cards: no picture shows the initial in a ring, an inner voice a glow", () => {
    const plain = character("aoi", "Aoi", [["Hello.", null, null]]);
    const voice = character("logic", "Logic", [["Think.", null, null]], { kind: "voice" });
    screen.show(recap({ characters: [plain], voices: [voice] }), options({ recap: "cards" }), "");
    const figure = q("[data-vn-card-figure]")!;
    expect(q("[data-vn-recap-name]")!.textContent).toBe("Aoi");
    expect(figure.dataset.vnCardEmpty).toBe("true");
    expect(q("[data-vn-card-initial]")!.textContent).toBe("A");
    click(q("[data-vn-recap-card]")!);
    expect(q("[data-vn-recap-name]")!.textContent).toBe("Logic");
    expect(figure.dataset.vnCardEmpty).toBe("voice");
    expect(q("[data-vn-card-initial]")!.textContent).toBe("");
    click(q("[data-vn-recap-card]")!);
    expect(q("[data-vn-recap-name]")!.textContent).toBe("Aoi");
  });

  test("scene film: every paragraph as a card, twice for the loop; a tap reads one whole", () => {
    screen.show(recap(), options({ recap: "film" }), "");
    expect(screen.mode()).toBe("film");
    const cards = el().querySelectorAll("[data-vn-film-card]");
    expect(cards).toHaveLength(6);
    expect(cards.slice(0, 3).map((card) => card.querySelector("[data-vn-film-name]")!.textContent)).toEqual(["Mira", "Narration", "Ren"]);
    expect(cards[0]!.querySelector("[data-vn-film-count]")!.textContent).toBe("1/3");
    expect(q("[data-vn-film-recap]")!.textContent).toBe("Last scene: Kitchen, Hale house · 3 paragraphs · with Mira, Ren");
    expect(q("[data-vn-film-zoom]")!.hidden).toBe(true);
    click(cards[2]!.querySelector("[data-vn-film-text]")!);
    expect([taps, pops]).toEqual([1, 1]);
    // The card opens enlarged in the middle with the whole paragraph, and the film stops under it.
    expect(q("[data-vn-film-zoom]")!.hidden).toBe(false);
    expect(q("[data-vn-film-detail-head]")!.textContent).toBe("Ren · Angry");
    expect(q("[data-vn-film-detail-text]")!.textContent).toBe("“Too loud,” Ren mutters.");
    expect(q("[data-vn-film-detail-avatar] [data-vn-avatar]")).not.toBeNull();
    expect(cards[2]!.getAttribute("data-vn-film-selected")).toBe("");
    expect(q("[data-vn-film]")!.hasAttribute("data-vn-film-open")).toBe(true);
    // Any tap closes it and the film moves on; the screen stays.
    click(q("[data-vn-film-detail]")!);
    expect(q("[data-vn-film-zoom]")!.hidden).toBe(true);
    expect(q("[data-vn-film]")!.hasAttribute("data-vn-film-open")).toBe(false);
    expect(cards[2]!.hasAttribute("data-vn-film-selected")).toBe(false);
    expect(screen.isOpen()).toBe(true);
  });

  test("in a preview an enlarged film card closes first; the next tap away closes the preview", () => {
    screen.show(recap(), options({ recap: "film", preview: true }), "");
    click(el().querySelectorAll("[data-vn-film-card]")[0]!);
    expect(q("[data-vn-film-zoom]")!.hidden).toBe(false);
    click(q("[data-vn-film-zoom]")!);
    expect(q("[data-vn-film-zoom]")!.hidden).toBe(true);
    expect(screen.isOpen()).toBe(true);
    click(q("[data-vn-waiting-stage]")!);
    expect(screen.isOpen()).toBe(false);
  });

  test("a tap on empty space sends a ripple and a light sweep; none with motion off", () => {
    screen.show(recap(), options({ backdrop: "daylight", recap: "off", motion: true }), "");
    click(q("[data-vn-waiting-stage]")!);
    expect(el().querySelectorAll("[data-vn-waiting-ripple]")).toHaveLength(1);
    expect(el().hasAttribute("data-vn-waiting-rush")).toBe(true);
    expect(taps).toBe(1);
    expect(screen.isOpen()).toBe(true);
    screen.show(recap(), options({ backdrop: "daylight", recap: "off", motion: false }), "");
    click(q("[data-vn-waiting-stage]")!);
    expect(el().querySelectorAll("[data-vn-waiting-ripple]")).toHaveLength(0);
    expect(el().hasAttribute("data-vn-waiting-rush")).toBe(false);
  });

  test("the other backdrops: light loading screen, cast introduction, tidy faces", () => {
    screen.show(recap(), options({ backdrop: "daylight", recap: "off" }), "");
    expect(q("[data-vn-daylight-banner]")!.textContent).toBe("Now loading");
    expect(q("[data-vn-daylight-tip-text]")!.textContent).toContain("Tap a character");
    expect(q("[data-vn-daylight-meta]")!.textContent).toBe("With Mira, Ren · 3 paragraphs");
    expect(q("[data-vn-daylight-hero] img")!.getAttribute("src")).toBe("/mira/smile.png");
    expect(q("[data-vn-lineup]")).toBeNull();

    screen.show(recap(), options({ backdrop: "cast", recap: "off" }), "");
    expect(q("[data-vn-cast-header] h2")!.textContent).toBe("Kitchen, Hale house");
    expect(q("[data-vn-cast-header] p")!.textContent).toBe("3 paragraphs · 2 in the scene");
    // Everyone stands, without bubbles.
    expect(el().querySelectorAll("[data-vn-waiting-figure]")).toHaveLength(2);
    expect(q("[data-vn-bubble]")).toBeNull();

    screen.show(recap(), options({ backdrop: "tidy", recap: "off" }), "");
    expect(q("[data-vn-tidy-mark]")).not.toBeNull();
    expect(el().querySelectorAll("[data-vn-tidy-faces] li")).toHaveLength(2);
  });

  test("no characters, no picture: just the scene and the status", () => {
    screen.show(recap({ characters: [], entries: [], backgroundUrl: null, sent: null }), options(), "Mira is writing the next scene…");
    expect(screen.mode()).toBe("off");
    expect(q("[data-vn-waiting-figure]")).toBeNull();
    expect(q("[data-vn-waiting-sent]")).toBeNull();
    expect(q("[data-vn-waiting-bg]")!.getAttribute("style")).toBeNull();
  });

  test("a preview says so and closes on a tap away from the characters or Escape", () => {
    screen.show(recap(), options({ preview: true }), "");
    expect(screen.isPreview()).toBe(true);
    expect(q("[data-vn-waiting-preview-note]")).not.toBeNull();
    // A tap on a character does not close it.
    click(el().querySelectorAll("[data-vn-waiting-figure]")[0]!);
    expect(screen.isOpen()).toBe(true);
    click(q("[data-vn-scene-title]")!);
    expect(screen.isOpen()).toBe(false);
    expect(el().hidden).toBe(true);
    expect(closes).toBe(1);

    screen.show(recap(), options({ preview: true }), "");
    el().dispatchEvent(new FakeEvent("keydown", { key: "Escape" }));
    expect(screen.isOpen()).toBe(false);
    expect(closes).toBe(2);
  });

  test("outside a preview a tap elsewhere keeps it open and never reaches the stage", () => {
    const parent = new FakeNode("div");
    let reached = 0;
    parent.addEventListener("click", () => { reached += 1; });
    parent.appendChild(el());
    screen.show(recap(), options(), "");
    click(q("[data-vn-scene-title]")!);
    expect(screen.isOpen()).toBe(true);
    expect(reached).toBe(0);
    expect(closes).toBe(0);
  });

  test("hide fades with motion, and the screen empties afterwards", async () => {
    screen.show(recap(), options({ motion: true }), "");
    screen.hide();
    expect(screen.isOpen()).toBe(false);
    expect(el().dataset.vnWaitingClosing).toBe("");
    expect(el().hidden).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 360));
    expect(el().hidden).toBe(true);
    expect(el().children).toHaveLength(0);
  });
});
