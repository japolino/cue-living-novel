import { afterEach, describe, expect, test } from "bun:test";
import type { TurnView } from "../../protocol.js";
import { DEFAULT_SPEECH_SETTINGS } from "../../speech-config.js";
import { FakeEvent } from "../stage/stage-test-dom.js";
import { bootHost, flush, type HostHarness } from "./__fixtures__/host.js";

/** The opening card in the running host: the first paragraph's voice, sound and effect wait for it. */

const texts = ["Thunder rolls over the house.", "\"Over here,\" Mira says.", "Wind howls."];
const base = (overrides: Partial<TurnView> = {}): TurnView => ({
  chatId: "chat", messageId: "m1", swipeId: 0, sourceFingerprint: "fp", revision: 1,
  speaker: "Mira", userSpeaker: "You", paragraphs: texts, choices: [], assets: [], status: "ready",
  paragraphSpeakers: ["", "Mira", ""],
  scenes: [{ startParagraph: 0, location: "Hale house", timeOfDay: "night", weather: "storm" }],
  effects: ["lightning", null, null],
  audioCues: [{ paragraphIndex: 0, sfxUrl: "/sfx/thunder.mp3" }],
  ...overrides,
});
/** The text before its plan: no speakers, effects, sounds or places yet. */
const text = (): TurnView => {
  const { effects: _effects, audioCues: _audioCues, scenes: _scenes, ...plain } = base({ status: "planning", provisional: true, paragraphSpeakers: ["", "", ""] });
  return plain;
};

let host: HostHarness | null = null;
afterEach(() => { host?.destroy(); host = null; });

async function open(): Promise<HostHarness> {
  host = bootHost({
    config: { openingCard: "title", playOnArrival: false, speech: { ...DEFAULT_SPEECH_SETTINGS, enabled: true } },
    choir: {},
  });
  host.state(null);
  host.toggle();
  host.state(null);
  await flush();
  return host;
}

const card = (h: HostHarness) => h.root.querySelector("[data-vn-opening]");
const tapCard = (h: HostHarness) => card(h)!.dispatchEvent(new FakeEvent("click"));
const thunder = (h: HostHarness) => h.audio.some((src) => src.includes("thunder.mp3"));

describe("opening card in the host", () => {
  test("a new reply opens on its card; voice, sound and effect start when it closes", async () => {
    const h = await open();
    h.receive({ type: "vn_turn", turn: base() });
    await flush();
    expect(card(h)?.hidden).toBe(false);
    expect(h.root.querySelector("[data-vn-opening] [data-vn-scene-title]")!.textContent).toBe("Hale house");
    expect(h.text()).not.toContain("Thunder");
    expect(h.flash()).toBeNull();
    expect(thunder(h)).toBe(false);
    expect(h.choirRequests).toHaveLength(0);

    tapCard(h);
    await flush();
    // It fades out; reading starts at once.
    expect(card(h)!.dataset.vnOpeningClosing).toBe("");
    expect(h.text()).toBe(texts[0]!);
    expect(h.flash()).toBe("lightning");
    expect(thunder(h)).toBe(true);
    expect(h.choirRequests.map((request) => request.text)).toEqual([texts[0]!]);
  });

  test("the plan lands under the card: the opening paragraph plays whole once it closes", async () => {
    const h = await open();
    h.receive({ type: "vn_turn_text", turn: text() });
    await flush();
    expect(card(h)?.hidden).toBe(false);
    expect(h.root.querySelector("[data-vn-opening] [data-vn-opening-status]")!.textContent).toBe("Preparing the scene…");
    h.receive({ type: "vn_turn", turn: base() });
    await flush();
    // The plan brought the place, and the card is ready.
    expect(h.root.querySelector("[data-vn-opening] [data-vn-scene-title]")!.textContent).toBe("Hale house");
    expect(h.root.querySelector("[data-vn-opening] [data-vn-opening-status]")!.textContent).toBe("Ready · tap to start");
    expect(thunder(h)).toBe(false);
    expect(h.choirRequests).toHaveLength(0);

    h.next();
    await flush();
    expect(h.text()).toBe(texts[0]!);
    expect(h.flash()).toBe("lightning");
    expect(thunder(h)).toBe(true);
    expect(h.choirRequests.map((request) => request.text)).toEqual([texts[0]!]);
  });

  test("going back to the first paragraph after the card closed plays it as usual", async () => {
    const h = await open();
    h.receive({ type: "vn_turn", turn: base() });
    tapCard(h);
    await flush();
    h.next();
    await flush();
    expect(h.text()).toBe(texts[1]!);
    h.previous();
    await flush(400);
    expect(h.text()).toBe(texts[0]!);
    expect(card(h)!.hidden).toBe(true);
    expect(h.choirRequests.map((request) => request.text)).toEqual([texts[0]!, texts[1]!, texts[0]!]);
  });
});
