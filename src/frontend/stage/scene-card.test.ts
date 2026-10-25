import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import { LocationLabel, OpeningCard, cssUrl, sceneCardWords, type OpeningCardContent } from "./scene-card";

/** The opening card's words and timing, and the location label. */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const scene = { startParagraph: 0, location: "Kitchen, Hale house", timeOfDay: "morning", weather: "rain" };
const content = (patch: Partial<OpeningCardContent> = {}): OpeningCardContent => ({
  scene, fallbackTitle: "Mira", paragraphCount: 6, backgroundUrl: "/bg.png", ...patch,
});

describe("opening card", () => {
  let restore: () => void;
  let closed: number;
  let card: OpeningCard;
  const el = () => card.element as unknown as FakeNode;
  const text = (selector: string) => el().querySelector(selector)!.textContent;

  beforeEach(() => {
    restore = installFakeDocument();
    closed = 0;
    card = new OpeningCard(() => { closed += 1; });
  });
  afterEach(() => {
    card.dismiss();
    restore();
  });

  test("words: the broad place in the kicker, the location as the title, weather, time and length below", () => {
    expect(sceneCardWords(scene, "Mira", 6)).toEqual({ kicker: "Scene · Hale house", title: "Kitchen, Hale house", meta: "rain · morning · 6 paragraphs" });
    expect(sceneCardWords(null, "Mira", 0)).toEqual({ kicker: "Scene", title: "Mira", meta: "" });
    expect(sceneCardWords(null, "  ", 0).title).toBe("The next scene");
  });

  test("a picture URL is quoted safely for CSS", () => {
    expect(cssUrl("/a.png")).toBe('url("/a.png")');
    expect(cssUrl('/a"b\\c.png')).toBe('url("/a\\22 b\\5c c.png")');
  });

  test("shows the scene over the card's picture and waits while not ready", async () => {
    card.show(content(), { minMs: 0, autoStart: true, motion: false });
    expect(card.isOpen()).toBe(true);
    expect(el().hidden).toBe(false);
    expect(text("[data-vn-scene-kicker]")).toBe("Scene · Hale house");
    expect(text("[data-vn-scene-title]")).toBe("Kitchen, Hale house");
    expect(text("[data-vn-scene-meta]")).toBe("rain · morning · 6 paragraphs");
    expect(text("[data-vn-opening-status]")).toBe("Preparing the scene…");
    expect((el().querySelector("[data-vn-opening-bg]")!.style as Record<string, string>).backgroundImage).toBe('url("/bg.png")');
    expect(el().dataset.vnOpeningPicture).toBe("");
    await wait(30);
    expect(card.isOpen()).toBe(true);
    expect(closed).toBe(0);
  });

  test("once ready it closes by itself after the minimum time", async () => {
    card.show(content(), { minMs: 60, autoStart: true, motion: false });
    card.markReady(true);
    expect(text("[data-vn-opening-status]")).toBe("Ready");
    await wait(20);
    expect(card.isOpen()).toBe(true);
    await wait(80);
    expect(card.isOpen()).toBe(false);
    expect(el().hidden).toBe(true);
    expect(closed).toBe(1);
  });

  test("not ready again before it closed: it waits once more", async () => {
    card.show(content(), { minMs: 40, autoStart: true, motion: false });
    card.markReady(true);
    card.markReady(false);
    await wait(90);
    expect(card.isOpen()).toBe(true);
    expect(text("[data-vn-opening-status]")).toBe("Preparing the scene…");
    card.markReady(true);
    await wait(10);
    expect(card.isOpen()).toBe(false);
    expect(closed).toBe(1);
  });

  test("without auto start it says so and waits for a tap", async () => {
    card.show(content(), { minMs: 0, autoStart: false, motion: false });
    card.markReady(true);
    expect(text("[data-vn-opening-status]")).toBe("Ready · tap to start");
    await wait(20);
    expect(card.isOpen()).toBe(true);
    card.close();
    expect(closed).toBe(1);
    card.close();
    expect(closed).toBe(1);
  });

  test("new words for an open card; no picture, no picture flag", () => {
    card.show(content({ scene: null, backgroundUrl: null, paragraphCount: 0 }), { minMs: 0, autoStart: true, motion: false });
    expect(text("[data-vn-scene-title]")).toBe("Mira");
    expect(el().querySelector("[data-vn-scene-meta]")!.hidden).toBe(true);
    expect(el().dataset.vnOpeningPicture).toBeUndefined();
    card.update(content());
    expect(text("[data-vn-scene-title]")).toBe("Kitchen, Hale house");
    expect(el().querySelector("[data-vn-scene-meta]")!.hidden).toBe(false);
  });

  test("with motion it fades before hiding; dismiss starts nothing", async () => {
    card.show(content(), { minMs: 0, autoStart: true, motion: true });
    card.close();
    expect(el().dataset.vnOpeningClosing).toBe("");
    expect(el().hidden).toBe(false);
    await wait(360);
    expect(el().hidden).toBe(true);
    card.show(content(), { minMs: 0, autoStart: true, motion: true });
    card.dismiss();
    expect(el().hidden).toBe(true);
    expect(closed).toBe(1);
  });
});

describe("location label", () => {
  let restore: () => void;
  beforeEach(() => { restore = installFakeDocument(); });
  afterEach(() => restore());

  test("the place, then its time and weather; hidden without a place", () => {
    const label = new LocationLabel();
    const el = label.element as unknown as FakeNode;
    expect(el.hidden).toBe(true);
    label.render(scene);
    expect(el.hidden).toBe(false);
    expect(el.querySelector("[data-vn-location-place]")!.textContent).toBe("Kitchen, Hale house");
    expect(el.querySelector("[data-vn-location-meta]")!.textContent).toBe("morning · rain");
    label.render({ ...scene, timeOfDay: null, weather: null });
    expect(el.querySelector("[data-vn-location-meta]")!.hidden).toBe(true);
    label.render({ ...scene, location: " " });
    expect(el.hidden).toBe(true);
    label.render(null);
    expect(el.hidden).toBe(true);
  });
});
