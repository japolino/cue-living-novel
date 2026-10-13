import { describe, expect, test } from "bun:test";
import { ChoirBridge, type ChoirBridgeApi, type ChoirParagraphRequest } from "./choir-bridge.js";
import { SpeechController, type SpeechCursor } from "../speech/controller.js";

describe("ChoirBridge companion", () => {
  test("detects Choir presence on target window", () => {
    const listeners = new Map<string, Set<(e: any) => void>>();
    const fakeWindow: any = {
      addEventListener: (type: string, fn: any) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener: (type: string, fn: any) => {
        listeners.get(type)?.delete(fn);
      },
      dispatchEvent: (e: any) => {
        listeners.get(e.type)?.forEach(fn => fn(e));
        return true;
      },
    };

    const bridge = new ChoirBridge(fakeWindow);
    expect(bridge.isAvailable()).toBe(false);

    let reportedState = false;
    bridge.onAvailabilityChange((available) => {
      reportedState = available;
    });
    expect(reportedState).toBe(false);

    let narratorMutedState = false;
    const fakeApi: ChoirBridgeApi = {
      version: 1,
      isAvailable: () => true,
      isNarratorMuted: () => narratorMutedState,
      setNarratorMuted: (val: boolean) => { narratorMutedState = val; },
      openDrawer: () => {},
      stop: () => {},
      playParagraph: async ({ onStatus }) => {
        onStatus?.({ kind: "playing", speaker: "Jack" });
        return { played: 1 };
      },
    };

    fakeWindow.__CHOIR_API__ = fakeApi;
    fakeWindow.dispatchEvent(new CustomEvent("choir-available-v1"));

    expect(bridge.isAvailable()).toBe(true);
    expect(reportedState).toBe(true);

    expect(bridge.isNarratorMuted()).toBe(false);
    bridge.setNarratorMuted(true);
    expect(bridge.isNarratorMuted()).toBe(true);

    bridge.destroy();
  });

  test("SpeechController plays via ChoirBridge when active", async () => {
    let playedText = "";
    let playCalled = false;
    const fakeApi: ChoirBridgeApi = {
      version: 1,
      isAvailable: () => true,
      isNarratorMuted: () => true,
      setNarratorMuted: () => {},
      openDrawer: () => {},
      stop: () => {},
      playParagraph: async (opts) => {
        playCalled = true;
        playedText = opts.text;
        opts.onStatus?.({ kind: "playing", speaker: "Mira" });
        return { played: 1 };
      },
    };

    const fakeWindow: any = {
      __CHOIR_API__: fakeApi,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };

    const bridge = new ChoirBridge(fakeWindow);
    const statuses: string[] = [];

    const controller = new SpeechController({
      choirBridge: bridge,
      onStatus: (st) => statuses.push(st.kind),
    });

    controller.setSettings({
      enabled: true,
      autoplay: false,
      volume: 0.8,
      muteNarrator: true,
      narrator: null,
      characterDefault: null,
      characters: {},
      deliveryMode: "none",
      deliveryTag: "",
      deliveryAllProviders: false,
    });

    controller.setActive(true);
    controller.setVisible(true);

    controller.setCursor({
      chatId: "c1",
      messageId: "m1",
      paragraphIndex: 0,
      sourceFingerprint: "fp1",
      text: 'She smiled. "Hello!" she said.',
      paragraphSpeaker: "Mira",
      turnSpeaker: "Mira",
    });

    await controller.playCurrent();

    expect(playCalled).toBe(true);
    expect(playedText).toBe('She smiled. "Hello!" she said.');
    expect(statuses).toContain("loading");
    expect(statuses).toContain("playing");
    expect(statuses).toContain("idle");

    bridge.destroy();
    controller.dispose();
  });
});

describe("SpeechController with Choir: stop paths", () => {
  const paragraph = (paragraphIndex: number, chatId = "c1"): SpeechCursor => ({
    chatId,
    messageId: "m1",
    paragraphIndex,
    sourceFingerprint: "fp1",
    text: `Paragraph ${paragraphIndex}.`,
    paragraphSpeaker: "Mira",
    turnSpeaker: "Mira",
  });

  /** A Choir whose paragraphs keep playing until their signal aborts. */
  function setup() {
    const requests: ChoirParagraphRequest[] = [];
    let stopCalls = 0;
    const fakeApi: ChoirBridgeApi = {
      version: 1,
      isAvailable: () => true,
      isNarratorMuted: () => false,
      setNarratorMuted: () => {},
      openDrawer: () => {},
      stop: () => { stopCalls += 1; },
      playParagraph: (request) => {
        requests.push(request);
        request.onStatus?.({ kind: "playing" });
        return new Promise((resolve) => request.signal?.addEventListener("abort", () => resolve({ played: 0 })));
      },
    };
    const bridge = new ChoirBridge({ __CHOIR_API__: fakeApi, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true } as any);
    const controller = new SpeechController({ choirBridge: bridge });
    controller.setSettings({
      enabled: true,
      autoplay: true,
      volume: 0.8,
      muteNarrator: false,
      narrator: null,
      characterDefault: null,
      characters: {},
      deliveryMode: "none",
      deliveryTag: "",
      deliveryAllProviders: false,
    });
    controller.setActive(true);
    controller.setVisible(true);
    controller.setCursor(paragraph(0));
    void controller.playCurrent();
    stopCalls = 0;
    return { controller, bridge, requests, stopCalls: () => stopCalls };
  }

  test("moving to the next paragraph aborts the previous one without stopping Choir, then autoplays", () => {
    const { controller, bridge, requests, stopCalls } = setup();
    expect(requests.map((request) => request.paragraphIndex)).toEqual([0]);

    controller.setCursor(paragraph(1));

    expect(stopCalls()).toBe(0);
    expect(requests[0]!.signal?.aborted).toBe(true);
    expect(requests.map((request) => request.paragraphIndex)).toEqual([0, 1]);
    expect(requests[1]!.signal?.aborted).toBe(false);
    bridge.destroy();
    controller.dispose();
  });

  test("user Stop and a chat change stop Choir", () => {
    const { controller, bridge, requests, stopCalls } = setup();
    controller.stop("user-stop");
    expect(stopCalls()).toBe(1);
    expect(requests[0]!.signal?.aborted).toBe(true);

    void controller.playCurrent();
    controller.onChatChanged();
    expect(stopCalls()).toBe(2);
    expect(requests[1]!.signal?.aborted).toBe(true);
    bridge.destroy();
    controller.dispose();
  });
});
