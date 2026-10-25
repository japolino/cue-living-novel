import { afterEach, describe, expect, test } from "bun:test";
import type { TurnView } from "../../protocol.js";
import { DEFAULT_SPEECH_SETTINGS, type SpeechSettings } from "../../speech-config.js";
import { bootHost, flush, type HostHarness } from "./__fixtures__/host.js";

/** How the running host applies the text before the plan and the planned turn (applyTurn). */

const texts = ["The door creaks open.", "\"Over here,\" Mira says.", "Wind howls."];
const base = (overrides: Partial<TurnView> = {}): TurnView => ({
  chatId: "chat", messageId: "m1", swipeId: 0, sourceFingerprint: "fp", revision: 1,
  speaker: "Mira", userSpeaker: "You", paragraphs: texts, choices: [], assets: [], status: "ready", ...overrides,
});
const text = (overrides: Partial<TurnView> = {}) => base({ status: "planning", provisional: true, paragraphSpeakers: ["", "", ""], ...overrides });
const planned = (overrides: Partial<TurnView> = {}) => base({ paragraphSpeakers: ["Mira", "Mira", ""], ...overrides });

let host: HostHarness | null = null;
afterEach(() => { host?.destroy(); host = null; });

async function open(speech?: Partial<SpeechSettings>): Promise<HostHarness> {
  host = bootHost(speech ? { config: { speech: { ...DEFAULT_SPEECH_SETTINGS, enabled: true, ...speech } } } : {});
  host.state(null);
  host.toggle();
  host.state(null);
  await flush();
  return host;
}

describe("applyTurn", () => {
  test("smoke: the text shows, the plan upgrades it where the reader is", async () => {
    const h = await open();
    h.receive({ type: "vn_turn_text", turn: text() });
    expect(h.text()).toBe(texts[0]!);
    h.next();
    expect(h.text()).toBe(texts[1]!);
    h.receive({ type: "vn_turn", turn: planned() });
    expect(h.text()).toBe(texts[1]!);
    expect(h.speaker()).toBe("Mira");
  });

  test("a plan that lands while the view is closed upgrades the held text when it reopens", async () => {
    const h = await open();
    h.receive({ type: "vn_turn_text", turn: text() });
    h.next();
    h.next();
    // The final paragraph waits for the plan.
    expect(h.text()).toBe(texts[2]!);
    expect(h.badges()).toContain("Preparing the scene…");
    h.toggle();
    // The planned turn was already on its way when the view closed.
    h.receive({ type: "vn_turn", turn: planned() });
    h.toggle();
    h.state(planned());
    await flush();
    expect(h.text()).toBe(texts[2]!);
    expect(h.badges()).not.toContain("Preparing the scene…");
    expect(h.continueDisabled()).toBe(false);
    h.next();
    // Your turn: the composer.
    expect(h.root.querySelector("[data-vn-input-form]")!.hidden).toBe(false);
  });

  test("a plan right behind its text plays the opening paragraph's effect and sound effect", async () => {
    const h = await open();
    h.receive({ type: "vn_turn_text", turn: text() });
    expect(h.flash()).toBeNull();
    h.receive({ type: "vn_turn", turn: planned({ effects: ["lightning", null, null], audioCues: [{ paragraphIndex: 0, sfxUrl: "/sfx/thunder.mp3" }] }) });
    expect(h.flash()).toBe("lightning");
    expect(h.audio.some((src) => src.includes("thunder.mp3"))).toBe(true);
  });

  test("a plan that lands after the reader moved on plays no past moment", async () => {
    const h = await open();
    h.receive({ type: "vn_turn_text", turn: text() });
    h.next();
    h.receive({ type: "vn_turn", turn: planned({ effects: ["lightning", "lightning", null], audioCues: [{ paragraphIndex: 1, sfxUrl: "/sfx/thunder.mp3", bgmUrl: "/bgm/storm.mp3" }] }) });
    expect(h.flash()).toBeNull();
    expect(h.audio.some((src) => src.includes("thunder.mp3"))).toBe(false);
    // Its music still plays.
    expect(h.audio.some((src) => src.includes("storm.mp3"))).toBe(true);
  });

  test("Read before the scene is ready: a paragraph never read aloud takes the plan's speaker", async () => {
    const h = await open({ speakBeforePlan: true, narrator: { connectionId: "tts", voice: "narrator" } });
    h.receive({ type: "vn_turn_text", turn: text() });
    expect(h.speech()).toContain("Narrator");
    // Auto play is off: nobody pressed Play before the plan landed.
    h.receive({ type: "vn_turn", turn: planned() });
    expect(h.speech()).toContain("Mira");
  });

  test("Read before the scene is ready: a paragraph already being read is not started again", async () => {
    const h = await open({ speakBeforePlan: true, narrator: { connectionId: "tts", voice: "narrator" } });
    h.receive({ type: "vn_turn_text", turn: text() });
    h.play();
    const reading = h.speech();
    expect(reading).toBe("Fetching audio…");
    h.receive({ type: "vn_turn", turn: planned() });
    expect(h.speech()).toBe(reading);
  });
});
