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

async function open(speech?: Partial<SpeechSettings>, choir?: { activated?: boolean }): Promise<HostHarness> {
  host = bootHost({
    ...(speech ? { config: { speech: { ...DEFAULT_SPEECH_SETTINGS, enabled: true, ...speech } } } : {}),
    ...(choir ? { choir } : {}),
  });
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
    // No page gesture yet: nothing is read before the plan lands.
    const h = await open({ speakBeforePlan: true }, { activated: false });
    h.receive({ type: "vn_turn_text", turn: text() });
    expect(h.speech()).toContain("Narrator");
    h.receive({ type: "vn_turn", turn: planned() });
    expect(h.speech()).toContain("Mira");
    expect(h.choirRequests.length).toBe(0);
  });

  test("Read before the scene is ready: a paragraph already being read is not started again", async () => {
    const h = await open({ speakBeforePlan: true }, {});
    h.receive({ type: "vn_turn_text", turn: text() });
    await flush();
    expect(h.choirRequests.map((request) => request.text)).toEqual([texts[0]!]);
    const reading = h.speech();
    expect(reading).toBe("Fetching audio…");
    h.receive({ type: "vn_turn", turn: planned() });
    await flush();
    expect(h.speech()).toBe(reading);
    expect(h.choirRequests.length).toBe(1);
  });

  test("without Read before the scene is ready, read aloud waits for the plan's speaker", async () => {
    const h = await open({}, {});
    h.receive({ type: "vn_turn_text", turn: text() });
    await flush();
    expect(h.choirRequests.length).toBe(0);
    h.receive({ type: "vn_turn", turn: planned() });
    await flush();
    expect(h.choirRequests.map((request) => [request.text, request.speaker])).toEqual([[texts[0]!, "Mira"]]);
  });

  test("going back during the text before the plan keeps the scene image", async () => {
    const h = await open();
    const asset = { jobId: "j1", cueId: "c1", paragraphIndex: 0, status: "generated" as const, imageUrl: "/api/v1/images/old-scene" };
    h.state(planned({ messageId: "m0", sourceFingerprint: "fp0", assets: [asset] }));
    await flush(30);
    expect(h.sceneImage()).toBe("/api/v1/images/old-scene");
    // The next reply's text keeps the previous scene until its plan brings one.
    h.receive({ type: "vn_turn_text", turn: text() });
    h.next();
    h.previous();
    await flush(30);
    expect(h.sceneImage()).toBe("/api/v1/images/old-scene");
  });

  test("the same reply's text again without a line (Try again after a failed line check) replaces the text on screen", async () => {
    const h = await open();
    h.receive({ type: "vn_turn_text", turn: text({ paragraphs: [texts[0]!, "Word count: 312.", texts[2]!] }) });
    h.receive({ type: "vn_turn_text", turn: text({ paragraphs: [texts[0]!, texts[2]!], paragraphSpeakers: ["", ""] }) });
    expect(h.text()).toBe(texts[0]!);
    h.next();
    expect(h.text()).toBe(texts[2]!);
  });

  test("the upgrade shows the scene image the plan brings for the reader's paragraph", async () => {
    const h = await open();
    h.receive({ type: "vn_turn_text", turn: text() });
    h.next();
    const asset = { jobId: "j1", cueId: "c1", paragraphIndex: 0, status: "generated" as const, imageUrl: "/api/v1/images/new-scene" };
    h.receive({ type: "vn_turn", turn: planned({ assets: [asset] }) });
    await flush(30);
    expect(h.sceneImage()).toBe("/api/v1/images/new-scene");
  });

  test("while the reader's own line shows, a late text never replaces the planned turn waiting behind it", async () => {
    const h = await open();
    h.state(planned({ messageId: "m0", sourceFingerprint: "fp0" }));
    h.next();
    h.next();
    h.next();
    h.reply("I nod.");
    expect(h.text()).toBe("I nod.");
    h.receive({ type: "vn_turn", turn: planned() });
    h.receive({ type: "vn_turn_text", turn: text() });
    // Past their own line, the reader gets the planned reply, not its text.
    h.next();
    expect(h.text()).toBe(texts[0]!);
    expect(h.speaker()).toBe("Mira");
    expect(h.badges()).not.toContain("Preparing the scene…");
    h.next();
    h.next();
    expect(h.continueDisabled()).toBe(false);
  });
});
