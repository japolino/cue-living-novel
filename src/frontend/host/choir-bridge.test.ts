import { describe, expect, test } from "bun:test";
import { ChoirBridge, type ChoirBridgeApi, type ChoirMusic, type ChoirParagraphRequest } from "./choir-bridge.js";
import { SpeechController, type SpeechCursor } from "../speech/controller.js";
import { DEFAULT_SPEECH_SETTINGS } from "../../speech-config.js";
import { choirPlaysSound } from "./controller.js";

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
      // No user gesture yet: nothing is read until Play.
      hasUserActivation: () => false,
    });

    controller.setSettings({ ...DEFAULT_SPEECH_SETTINGS, enabled: true, muteNarrator: true });

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
    expect(playCalled).toBe(false);

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
    controller.setSettings({ ...DEFAULT_SPEECH_SETTINGS, enabled: true });
    controller.setActive(true);
    controller.setVisible(true);
    // Read aloud reads each new paragraph as it appears.
    controller.setCursor(paragraph(0));
    stopCalls = 0;
    return { controller, bridge, requests, stopCalls: () => stopCalls };
  }

  test("moving to the next paragraph aborts the previous one without stopping Choir, then reads the next", () => {
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

  test("pause drops the paragraph in flight, so its late status cannot undo the pause", async () => {
    const statuses: string[] = [];
    let finish: (() => void) | undefined;
    const fakeApi: ChoirBridgeApi = {
      version: 1,
      isAvailable: () => true,
      isNarratorMuted: () => false,
      setNarratorMuted: () => {},
      openDrawer: () => {},
      stop: () => {},
      // Like a Choir that still reports and settles after stop().
      playParagraph: (request) => new Promise((resolve) => {
        finish = () => { request.onStatus?.({ kind: "playing" }); resolve({ played: 1 }); };
      }),
    };
    const bridge = new ChoirBridge({ __CHOIR_API__: fakeApi, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true } as any);
    const controller = new SpeechController({ choirBridge: bridge, onStatus: (status) => statuses.push(status.kind), hasUserActivation: () => false });
    controller.setSettings({ ...DEFAULT_SPEECH_SETTINGS, enabled: true });
    controller.setActive(true);
    controller.setCursor(paragraph(0));
    const playing = controller.playCurrent();

    controller.pause();
    finish!();
    await playing;

    expect(controller.getStatus().kind).toBe("paused");
    expect(statuses.at(-1)).toBe("paused");
    bridge.destroy();
    controller.dispose();
  });
});

describe("ChoirBridge sound control and music", () => {
  function fakeWindow(api: Partial<ChoirBridgeApi> | null) {
    const listeners = new Map<string, Set<(event: Event) => void>>();
    const win: any = {
      __CHOIR_API__: api ? { version: 1, isAvailable: () => true, isNarratorMuted: () => false, setNarratorMuted: () => {}, openDrawer: () => {}, stop: () => {}, playParagraph: async () => ({ played: 0 }), ...api } : undefined,
      addEventListener: (type: string, fn: (event: Event) => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn); },
      removeEventListener: (type: string, fn: (event: Event) => void) => { listeners.get(type)?.delete(fn); },
      dispatchEvent: (event: Event) => { listeners.get(event.type)?.forEach((fn) => fn(event)); return true; },
    };
    return win;
  }

  test("an older Choir without getConfig or getMusic reports no sound and no track", () => {
    const bridge = new ChoirBridge(fakeWindow({}));
    expect(bridge.isAvailable()).toBe(true);
    expect(bridge.soundEnabled()).toBe(false);
    expect(bridge.readsByItself()).toBe(false);
    expect(bridge.getMusic()).toBeNull();
    bridge.destroy();
  });

  test("readsByItself follows Choir's Auto switch", () => {
    const reads = (config: Record<string, unknown> | null) => {
      const bridge = new ChoirBridge(fakeWindow({ getConfig: () => config }));
      const result = bridge.readsByItself();
      bridge.destroy();
      return result;
    };
    expect(reads({ auto: true })).toBe(true);
    expect(reads({ auto: false })).toBe(false);
    expect(reads({})).toBe(false);
    expect(reads(null)).toBe(false);
  });

  test("onMusicChange reports the current track, each change, and null when Choir leaves", () => {
    const track: ChoirMusic = { title: "Gymnopedie", credit: '"Gymnopedie" Kevin MacLeod (incompetech.com) · CC BY 4.0' };
    const win = fakeWindow({ getMusic: () => track });
    const bridge = new ChoirBridge(win);
    const seen: Array<ChoirMusic | null> = [];
    bridge.onMusicChange((music) => seen.push(music));
    win.dispatchEvent(new CustomEvent("choir-music-v1", { detail: null }));
    delete win.__CHOIR_API__;
    win.dispatchEvent(new CustomEvent("choir-unavailable-v1"));
    expect(seen).toEqual([track, null, null]);

    bridge.destroy();
    win.dispatchEvent(new CustomEvent("choir-music-v1", { detail: track }));
    expect(seen.length).toBe(3);
  });

  test("a Choir that arrives later reports the track it is already playing", () => {
    const track: ChoirMusic = { title: "Gymnopedie", credit: '"Gymnopedie" Kevin MacLeod (incompetech.com) · CC BY 4.0' };
    const win = fakeWindow(null);
    const bridge = new ChoirBridge(win);
    const seen: Array<ChoirMusic | null> = [];
    bridge.onMusicChange((music) => seen.push(music));
    win.__CHOIR_API__ = fakeWindow({ getMusic: () => track }).__CHOIR_API__;
    win.dispatchEvent(new CustomEvent("choir-available-v1"));
    expect(seen).toEqual([null, track]);
    bridge.destroy();
  });

  test("soundEnabled follows Choir's switches: music, or effects and ambience with a Freesound key", () => {
    const enabled = (config: Record<string, unknown> | null) => {
      const bridge = new ChoirBridge(fakeWindow({ getConfig: () => config }));
      const result = bridge.soundEnabled();
      bridge.destroy();
      return result;
    };
    expect(enabled({ enableSfx: false, enableAmbience: false, enableMusic: true })).toBe(true);
    expect(enabled({ freesoundApiKey: "k" })).toBe(true);
    expect(enabled({ enableSfx: false, enableAmbience: true, freesoundApiKey: "k" })).toBe(true);
    expect(enabled({})).toBe(false);
    expect(enabled({ enableSfx: false, enableAmbience: false, enableMusic: false, freesoundApiKey: "k" })).toBe(false);
    expect(enabled(null)).toBe(false);
  });
});

describe("choirPlaysSound", () => {
  const choir = { isAvailable: () => true, soundEnabled: () => true, readsByItself: () => false };
  const on = { ...DEFAULT_SPEECH_SETTINGS, enabled: true };

  test("Choir's sound wins whenever it is on and Choir reads here: through read aloud or by itself", () => {
    expect(choirPlaysSound(on, choir)).toBe(true);
    // Choir's Auto reads the chat with Cue's read aloud off: its music would play over Cue's.
    expect(choirPlaysSound({ ...on, enabled: false }, { ...choir, readsByItself: () => true })).toBe(true);
    expect(choirPlaysSound(undefined, { ...choir, readsByItself: () => true })).toBe(true);
    // A saved config from before keeps no switch that could hold Choir's sound off.
    expect(choirPlaysSound({ ...on, choirSound: false } as typeof on, choir)).toBe(true);
  });

  test("otherwise Cue's own pack plays: Choir missing, its sound off, or nothing reading", () => {
    expect(choirPlaysSound(on, { ...choir, isAvailable: () => false })).toBe(false);
    // Choir's own switches are off (or no Freesound key): the pack keeps playing.
    expect(choirPlaysSound(on, { ...choir, soundEnabled: () => false })).toBe(false);
    // Neither Cue's read aloud nor Choir's Auto: Choir plays nothing here.
    expect(choirPlaysSound({ ...on, enabled: false }, choir)).toBe(false);
    expect(choirPlaysSound(undefined, choir)).toBe(false);
  });
});
