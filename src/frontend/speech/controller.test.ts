import { describe, expect, test } from "bun:test";

import { CHOIR_MISSING_MESSAGE, SpeechController, type SpeechCursor, type SpeechStatus } from "./controller.js";
import type { ChoirParagraphRequest } from "../host/choir-bridge.js";
import { DEFAULT_SPEECH_SETTINGS, type SpeechSettings } from "../../speech-config.js";

/* ------------------------- deterministic test rig ------------------------- */

type Pending = { request: ChoirParagraphRequest; resolve: () => void; reject: (error: unknown) => void };

/** A Choir whose paragraphs stay in flight until the test settles them. */
class FakeChoir {
  available = true;
  requests: Pending[] = [];
  stopCalls = 0;
  isAvailable(): boolean { return this.available; }
  stop(): void { this.stopCalls += 1; }
  playParagraph(request: ChoirParagraphRequest): Promise<{ played: number }> {
    return new Promise((resolve, reject) => {
      this.requests.push({ request, resolve: () => resolve({ played: 1 }), reject });
      request.onStatus?.({ kind: "playing" });
    });
  }
  get last(): Pending { return this.requests.at(-1)!; }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const enabled = (overrides: Partial<SpeechSettings> = {}): SpeechSettings => ({ ...DEFAULT_SPEECH_SETTINGS, enabled: true, ...overrides });

const cursor = (overrides: Partial<SpeechCursor> = {}): SpeechCursor => ({
  chatId: "chat-1",
  messageId: "msg-1",
  sourceFingerprint: "fp-1",
  paragraphIndex: 0,
  text: "The wind picks up as the stars come out.",
  paragraphSpeaker: "",
  turnSpeaker: "Mira",
  ...overrides,
});

function rig(options: { settings?: SpeechSettings; activated?: boolean } = {}) {
  const choir = new FakeChoir();
  const statuses: SpeechStatus[] = [];
  let activated = options.activated ?? true;
  const controller = new SpeechController({
    choirBridge: choir,
    onStatus: (status) => statuses.push(status),
    hasUserActivation: () => activated,
  });
  controller.setSettings(options.settings ?? enabled());
  controller.setActive(true);
  return { choir, statuses, controller, activate: () => { activated = true; } };
}

/* --------------------------------- tests --------------------------------- */

describe("default-off / zero-call gates", () => {
  test("with default settings NOTHING reaches Choir — cursor storms and Play included", async () => {
    const { choir, controller } = rig({ settings: DEFAULT_SPEECH_SETTINGS });
    for (let index = 0; index < 5; index += 1) controller.setCursor(cursor({ paragraphIndex: index, text: `p${index}` }));
    await controller.playCurrent();
    expect(choir.requests.length).toBe(0);
    expect(controller.getStatus().kind).toBe("off");
  });

  test("inactive overlay, hidden page, and disposal each block reading entirely", async () => {
    const { choir, controller } = rig();
    controller.setActive(false);
    controller.setCursor(cursor());
    await controller.playCurrent();

    controller.setActive(true);
    controller.setVisible(false);
    controller.setCursor(cursor({ paragraphIndex: 1 }));
    await controller.playCurrent();

    controller.setVisible(true);
    controller.dispose();
    controller.setCursor(cursor({ paragraphIndex: 2 }));
    await controller.playCurrent();
    expect(choir.requests.length).toBe(0);
  });

  test("empty paragraph text and a paragraph of only empty effect tags are never read", async () => {
    const { choir, controller } = rig();
    controller.setCursor(cursor({ text: "   " }));
    controller.setCursor(cursor({ paragraphIndex: 1, text: "<wave> </wave>" }));
    await controller.playCurrent();
    expect(choir.requests.length).toBe(0);
  });
});

describe("reading each paragraph as it appears", () => {
  test("a new paragraph is read at once, with effect tags stripped and the speaker named", () => {
    const { choir, controller } = rig();
    controller.setCursor(cursor({ text: '"<shake>Get down!</shake>" she <WHISPER>says</whisper>.', paragraphSpeaker: "Mira", nextText: "<wave>Next</wave> one." }));
    expect(choir.requests.length).toBe(1);
    expect(choir.last.request.text).toBe('"Get down!" she says.');
    expect(choir.last.request.nextText).toBe("Next one.");
    expect(choir.last.request.speaker).toBe("Mira");
    expect(controller.getStatus()).toEqual({ kind: "playing", speaker: "Mira" });
  });

  test("narration is read as the Narrator", () => {
    const { choir, controller } = rig();
    controller.setCursor(cursor({ paragraphSpeaker: "" }));
    expect(choir.last.request.speaker).toBe("Narrator");
  });

  test("before any user gesture nothing is read; one Play unlocks reading for later paragraphs", async () => {
    const { choir, controller } = rig({ activated: false });
    controller.setCursor(cursor());
    expect(choir.requests.length).toBe(0);
    expect(controller.getStatus().kind).toBe("idle");

    void controller.playCurrent();
    expect(choir.requests.length).toBe(1);
    controller.setCursor(cursor({ paragraphIndex: 1, text: "Second." }));
    expect(choir.requests.length).toBe(2);
    expect(choir.last.request.paragraphIndex).toBe(1);
  });

  test("a page that has had a gesture reads without a Play", () => {
    const { choir, controller, activate } = rig({ activated: false });
    activate();
    controller.setCursor(cursor());
    expect(choir.requests.length).toBe(1);
  });

  test("a finished paragraph returns to idle", async () => {
    const { choir, controller } = rig();
    controller.setCursor(cursor());
    choir.last.resolve();
    await tick();
    expect(controller.getStatus()).toEqual({ kind: "idle", speaker: "Narrator" });
  });

  test("an identical cursor is a no-op: same-turn rebroadcasts never stop or replay", () => {
    const { choir, controller } = rig();
    controller.setCursor(cursor());
    controller.setCursor(cursor());
    expect(choir.requests.length).toBe(1);
    expect(choir.requests[0]!.request.signal?.aborted).toBe(false);
  });

  test("a speaker-attribution correction for identical text updates the cursor", () => {
    const { controller } = rig({ activated: false });
    controller.setCursor(cursor({ paragraphSpeaker: null, turnSpeaker: "Bob", text: "Dialogue text here." }));
    expect(controller.getStatus()).toEqual({ kind: "idle", speaker: "Bob" });
    controller.setCursor(cursor({ paragraphSpeaker: "Alice", turnSpeaker: "Bob", text: "Dialogue text here." }));
    expect(controller.getStatus()).toEqual({ kind: "idle", speaker: "Alice" });
  });
});

describe("without Choir", () => {
  test("nothing is read on its own, and Play says Choir is needed", async () => {
    const { choir, controller } = rig();
    choir.available = false;
    controller.setCursor(cursor());
    expect(choir.requests.length).toBe(0);
    await controller.playCurrent();
    expect(controller.getStatus()).toEqual({ kind: "unconfigured", message: CHOIR_MISSING_MESSAGE });
  });
});

describe("lifecycle boundaries and late statuses", () => {
  test("deactivate, chat change and turning read aloud off abort the paragraph and stop Choir", () => {
    const { choir, controller } = rig();
    controller.setCursor(cursor());
    controller.setActive(false);
    expect(choir.requests[0]!.request.signal?.aborted).toBe(true);
    expect(choir.stopCalls).toBe(1);

    controller.setActive(true);
    controller.setCursor(cursor({ paragraphIndex: 1 }));
    controller.onChatChanged();
    expect(choir.requests[1]!.request.signal?.aborted).toBe(true);
    expect(choir.stopCalls).toBe(2);

    controller.setCursor(cursor({ paragraphIndex: 2 }));
    controller.setSettings(enabled({ enabled: false }));
    expect(choir.requests[2]!.request.signal?.aborted).toBe(true);
    expect(choir.stopCalls).toBe(3);
    expect(controller.getStatus().kind).toBe("off");
  });

  test("turning Read before the scene is ready on or off does not stop the paragraph", () => {
    const { choir, controller } = rig();
    controller.setCursor(cursor());
    controller.setSettings(enabled({ speakBeforePlan: true }));
    expect(choir.requests[0]!.request.signal?.aborted).toBe(false);
    expect(choir.stopCalls).toBe(0);
  });

  test("a hidden page pauses the paragraph in flight", () => {
    const { choir, controller } = rig();
    controller.setCursor(cursor());
    controller.setVisible(false);
    expect(choir.stopCalls).toBe(1);
    expect(controller.getStatus().kind).toBe("paused");
  });

  test("pause, then Play starts the paragraph over", () => {
    const { choir, controller } = rig();
    controller.setCursor(cursor());
    controller.pause();
    expect(controller.getStatus().kind).toBe("paused");
    void controller.playCurrent();
    expect(choir.requests.length).toBe(2);
    expect(choir.last.request.paragraphIndex).toBe(0);
  });

  test("a status or completion landing after close never shows playing", async () => {
    const { choir, statuses, controller } = rig();
    controller.setCursor(cursor());
    const late = choir.last;
    controller.setActive(false);
    late.request.onStatus?.({ kind: "playing" });
    late.resolve();
    await tick();
    expect(statuses.at(-1)!.kind).toBe("off");
  });

  test("a Choir failure is shown as an error, with no automatic retry", async () => {
    const { choir, controller } = rig();
    controller.setCursor(cursor());
    choir.last.reject(new Error("Fish Audio key is missing"));
    await tick();
    expect(controller.getStatus()).toEqual({ kind: "error", message: "Fish Audio key is missing" });
    expect(choir.requests.length).toBe(1);
  });

  test("rapid Play keeps at most one un-aborted paragraph in flight", () => {
    const { choir, controller } = rig();
    controller.setCursor(cursor());
    void controller.playCurrent();
    void controller.playCurrent();
    expect(choir.requests.filter((pending) => !pending.request.signal?.aborted).length).toBe(1);
  });
});
