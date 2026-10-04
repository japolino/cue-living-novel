import { describe, expect, test } from "bun:test";

import { SpeechController, type SpeechAudioElement, type SpeechCursor, type SpeechStatus } from "./controller.js";
import {
  SpeechTransportError,
  type SpeechSynthesisInput,
  type TtsProfileSnapshot,
  type TtsTransport,
} from "./transport.js";
import { DEFAULT_SPEECH_SETTINGS, type SpeechSettings } from "../../speech-config.js";
import { characterOverrideKey } from "./voice-resolution.js";

/* ------------------------- deterministic test rig ------------------------- */

type Deferred = { input: SpeechSynthesisInput; signal: AbortSignal; resolve: (blob: Blob) => void; reject: (error: unknown) => void };

const snapshot = (id: string, overrides: Partial<TtsProfileSnapshot> = {}): TtsProfileSnapshot => ({
  id,
  name: id,
  provider: "openrouter_tts",
  model: "google/gemini-2.5-flash-tts",
  voice: "ProfileDefaultVoice",
  isDefault: false,
  updatedAt: "rev-1",
  parametersFingerprint: "",
  ...overrides,
});

class FakeTransport implements TtsTransport {
  requests: Deferred[] = [];
  profileRequests: Array<{ connectionId: string; signal: AbortSignal }> = [];
  profiles = new Map<string, TtsProfileSnapshot>([
    ["conn-n", snapshot("conn-n")],
    ["conn-d", snapshot("conn-d")],
    ["conn-m", snapshot("conn-m")],
    ["other", snapshot("other")],
  ]);
  listProfiles(): Promise<never> { throw new Error("not used"); }
  listVoices(): Promise<never> { throw new Error("not used"); }
  getProfile(connectionId: string, signal: AbortSignal): Promise<TtsProfileSnapshot> {
    this.profileRequests.push({ connectionId, signal });
    const profile = this.profiles.get(connectionId);
    if (!profile) {
      return Promise.reject(new SpeechTransportError("This saved TTS profile no longer exists. Pick another in Settings.", "bad-request"));
    }
    return Promise.resolve(profile);
  }
  synthesize(input: SpeechSynthesisInput, signal: AbortSignal): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      this.requests.push({ input, signal, resolve, reject });
    });
  }
}

class FakeAudio implements SpeechAudioElement {
  src = "";
  volume = 1;
  currentTime = 0;
  playCalls = 0;
  pauseCalls = 0;
  rejectNextPlay: Error | null = null;
  private listeners = new Map<string, Array<() => void>>();
  async play(): Promise<void> {
    this.playCalls += 1;
    if (this.rejectNextPlay) {
      const error = this.rejectNextPlay;
      this.rejectNextPlay = null;
      throw error;
    }
  }
  pause(): void { this.pauseCalls += 1; }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }
  emit(type: string): void { for (const listener of this.listeners.get(type) ?? []) listener(); }
}

const audioBlob = (size = 3) => new Blob([new Uint8Array(size) as unknown as BlobPart], { type: "audio/mpeg" });

/** Deterministic microtask flush (no timers): lets awaited profile fetches settle. */
const tick = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

const enabledSettings = (overrides: Partial<SpeechSettings> = {}): SpeechSettings => ({
  ...DEFAULT_SPEECH_SETTINGS,
  enabled: true,
  narrator: { connectionId: "conn-n", voice: "Kore" },
  characterDefault: { connectionId: "conn-d", voice: "Puck" },
  ...overrides,
});

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

function rig(options: { settings?: SpeechSettings; maxCacheItems?: number; maxCacheBytes?: number } = {}) {
  const transport = new FakeTransport();
  const audio = new FakeAudio();
  const statuses: SpeechStatus[] = [];
  const created: string[] = [];
  const revoked: string[] = [];
  let counter = 0;
  const controller = new SpeechController({
    transport,
    onStatus: (status) => statuses.push(status),
    createAudio: () => audio,
    createObjectUrl: () => { const url = `blob:fake-${counter += 1}`; created.push(url); return url; },
    revokeObjectUrl: (url) => revoked.push(url),
    maxCacheItems: options.maxCacheItems ?? 16,
    ...(options.maxCacheBytes === undefined ? {} : { maxCacheBytes: options.maxCacheBytes }),
  });
  controller.setSettings(options.settings ?? enabledSettings());
  controller.setActive(true);
  return { transport, audio, statuses, created, revoked, controller };
}

/** Dispatch a play and settle up to the pending synthesize request. */
async function dispatchPlay(controller: SpeechController): Promise<{ done: Promise<void> }> {
  const done = controller.playCurrent();
  await tick();
  // Wrapped in an object so `await dispatchPlay(...)` cannot flatten into
  // awaiting the play itself (which only settles once the fake resolves).
  return { done };
}

/* --------------------------------- tests --------------------------------- */

describe("default-off / zero-call gates", () => {
  test("with default settings NOTHING triggers any request — cursor storms included", async () => {
    const { transport, controller } = rig({ settings: DEFAULT_SPEECH_SETTINGS });
    for (let index = 0; index < 5; index += 1) controller.setCursor(cursor({ paragraphIndex: index, text: `p${index}` }));
    await controller.playCurrent();
    await tick();
    expect(transport.requests.length).toBe(0);
    expect(transport.profileRequests.length).toBe(0);
  });

  test("inactive overlay, hidden page, and disposal each block dispatch entirely", async () => {
    const { transport, controller } = rig();
    controller.setCursor(cursor());
    controller.setActive(false);
    await controller.playCurrent();

    controller.setActive(true);
    controller.setCursor(cursor());
    controller.setVisible(false);
    await controller.playCurrent();

    controller.setVisible(true);
    controller.dispose();
    await controller.playCurrent();
    await tick();
    expect(transport.requests.length).toBe(0);
    expect(transport.profileRequests.length).toBe(0);
  });

  test("empty paragraph text never dispatches", async () => {
    const { transport, controller } = rig();
    controller.setCursor(cursor({ text: "   " }));
    await controller.playCurrent();
    await tick();
    expect(transport.requests.length).toBe(0);
    expect(transport.profileRequests.length).toBe(0);
  });
});

describe("text effect tags", () => {
  test("are stripped from the synthesized text; the words stay", async () => {
    const { transport, controller } = rig();
    controller.setCursor(cursor({ text: '"<shake>Get down!</shake>" she <WHISPER>says</whisper>.' }));
    await dispatchPlay(controller);
    expect(transport.requests[0]!.input.text).toBe('"Get down!" she says.');
  });

  test("a paragraph of only empty effect tags never dispatches", async () => {
    const { transport, controller } = rig();
    controller.setCursor(cursor({ text: "<wave> </wave>" }));
    await controller.playCurrent();
    await tick();
    expect(transport.requests.length).toBe(0);
  });
});

describe("voice selection & truthful unconfigured status", () => {
  test("narrator paragraphs use the narrator ref; named characters use overrides", async () => {
    const settings = enabledSettings({
      characters: { [characterOverrideKey("chat-1", "Mira")]: { connectionId: "conn-m", voice: "Aoede" } },
    });
    const { transport, controller } = rig({ settings });
    controller.setCursor(cursor({ paragraphSpeaker: "" }));
    await dispatchPlay(controller);
    expect(transport.requests[0]!.input.ref.connectionId).toBe("conn-n");
    controller.setCursor(cursor({ paragraphIndex: 1, text: "“Hi.”", paragraphSpeaker: "Mira" }));
    await dispatchPlay(controller);
    expect(transport.requests[1]!.input.ref.connectionId).toBe("conn-m");
    // unknown attribution -> turn speaker (Mira) -> override again
    controller.setCursor(cursor({ paragraphIndex: 2, text: "…", paragraphSpeaker: null }));
    await dispatchPlay(controller);
    expect(transport.requests[2]!.input.ref.connectionId).toBe("conn-m");
  });

  test("no configured voice => unconfigured status, zero requests, no fallback to any profile", async () => {
    const { transport, controller, statuses } = rig({ settings: { ...DEFAULT_SPEECH_SETTINGS, enabled: true } });
    controller.setCursor(cursor({ paragraphSpeaker: "Mira" }));
    await controller.playCurrent();
    await tick();
    expect(transport.requests.length).toBe(0);
    expect(transport.profileRequests.length).toBe(0);
    const last = statuses[statuses.length - 1]!;
    expect(last.kind).toBe("unconfigured");
    expect((last as { message: string }).message).toContain("Mira");
  });
});

describe("profile revision refresh (updated_at cache keying)", () => {
  test("every fresh Play refetches the profile revision before deciding cache hit or miss", async () => {
    const { transport, audio, controller } = rig();
    controller.setCursor(cursor());
    const { done: p1 } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await p1;
    audio.emit("ended");
    const { done: replay } = await dispatchPlay(controller);
    await replay;
    // Two metadata reads (one per Play), but only ONE paid synthesis (cache hit).
    expect(transport.profileRequests.length).toBe(2);
    expect(transport.requests.length).toBe(1);
    expect(controller.getStatus().kind).toBe("playing");
  });

  test("a host-side profile edit (updated_at bump) misses the cache and synthesizes anew", async () => {
    const { transport, audio, controller } = rig();
    controller.setCursor(cursor());
    const { done: p1 } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await p1;
    audio.emit("ended");
    transport.profiles.set("conn-n", snapshot("conn-n", { updatedAt: "rev-2" }));
    const { done: p2 } = await dispatchPlay(controller);
    expect(transport.requests.length).toBe(2);
    transport.requests[1]!.resolve(audioBlob());
    await p2;
  });

  test("with an empty voice override, the profile's own default voice keys the cache", async () => {
    const settings = enabledSettings({ narrator: { connectionId: "conn-n", voice: "" } });
    const { transport, audio, controller } = rig({ settings });
    controller.setCursor(cursor());
    const { done: p1 } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await p1;
    audio.emit("ended");
    // Same updated_at would be a lie after a real edit, but a changed default
    // voice with a bumped revision must miss; changed voice alone also misses.
    transport.profiles.set("conn-n", snapshot("conn-n", { voice: "OtherDefault" }));
    const { done: p2 } = await dispatchPlay(controller);
    expect(transport.requests.length).toBe(2);
    transport.requests[1]!.resolve(audioBlob());
    await p2;
  });

  test("a deleted profile reports a truthful error and never synthesizes", async () => {
    const settings = enabledSettings({ narrator: { connectionId: "gone", voice: "" } });
    const { transport, controller, statuses } = rig({ settings });
    controller.setCursor(cursor());
    await controller.playCurrent();
    await tick();
    expect(transport.requests.length).toBe(0);
    const last = statuses[statuses.length - 1]!;
    expect(last.kind).toBe("error");
    expect((last as { message: string }).message).toContain("no longer exists");
  });
});

describe("delivery tag gating by actual profile model", () => {
  test("Gemini-family model on the selected profile gets the tag", async () => {
    const { transport, controller } = rig({ settings: enabledSettings({ deliveryMode: "gemini-audio-tags", deliveryTag: "whispers" }) });
    controller.setCursor(cursor());
    await dispatchPlay(controller);
    expect(transport.requests[0]!.input.text).toBe(`[whispers] ${cursor().text}`);
  });

  test("a non-Gemini model NEVER gets the tag automatically", async () => {
    const { transport, controller } = rig({ settings: enabledSettings({ deliveryMode: "gemini-audio-tags", deliveryTag: "whispers" }) });
    transport.profiles.set("conn-n", snapshot("conn-n", { provider: "openai_tts", model: "gpt-4o-mini-tts" }));
    controller.setCursor(cursor());
    await dispatchPlay(controller);
    expect(transport.requests[0]!.input.text).toBe(cursor().text);
  });

  test("the clearly-labeled all-providers opt-in sends the tag to a non-Gemini model", async () => {
    const { transport, controller } = rig({
      settings: enabledSettings({ deliveryMode: "gemini-audio-tags", deliveryTag: "whispers", deliveryAllProviders: true }),
    });
    transport.profiles.set("conn-n", snapshot("conn-n", { provider: "openai_tts", model: "gpt-4o-mini-tts" }));
    controller.setCursor(cursor());
    await dispatchPlay(controller);
    expect(transport.requests[0]!.input.text).toBe(`[whispers] ${cursor().text}`);
  });

  test("tagged and untagged outbound text are distinct cache entries", async () => {
    const { transport, audio, controller } = rig();
    controller.setCursor(cursor());
    const { done: p1 } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await p1;
    audio.emit("ended");
    controller.setSettings(enabledSettings({ deliveryMode: "gemini-audio-tags", deliveryTag: "whispers" }));
    controller.setCursor(cursor());
    const { done: p2 } = await dispatchPlay(controller);
    expect(transport.requests.length).toBe(2);
    expect(transport.requests[1]!.input.text).toBe(`[whispers] ${cursor().text}`);
    transport.requests[1]!.resolve(audioBlob());
    await p2;
  });
});

describe("lifecycle boundaries and late completions", () => {
  test("cursor change aborts the in-flight request; its late resolution never plays or caches", async () => {
    const { transport, audio, controller, created } = rig();
    controller.setCursor(cursor());
    const { done: playPromise } = await dispatchPlay(controller);
    expect(transport.requests.length).toBe(1);
    const first = transport.requests[0]!;
    controller.setCursor(cursor({ paragraphIndex: 1, text: "Next paragraph." }));
    expect(first.signal.aborted).toBe(true);
    first.resolve(audioBlob());
    await playPromise;
    expect(audio.playCalls).toBe(0);
    expect(created.length).toBe(0);
  });

  test("deactivate, chat change, hidden page and settings change all abort in-flight work", async () => {
    for (const boundary of ["deactivate", "chat", "hidden", "settings"] as const) {
      const { transport, controller } = rig();
      controller.setCursor(cursor());
      await dispatchPlay(controller);
      const request = transport.requests[0]!;
      if (boundary === "deactivate") controller.setActive(false);
      if (boundary === "chat") controller.onChatChanged();
      if (boundary === "hidden") controller.setVisible(false);
      if (boundary === "settings") controller.setSettings(enabledSettings({ narrator: { connectionId: "other", voice: "" } }));
      expect(request.signal.aborted).toBe(true);
    }
  });

  test("an identical cursor is a no-op: same-turn rebroadcasts/image updates never stop or replay", async () => {
    const { transport, audio, controller } = rig();
    controller.setCursor(cursor());
    const { done: playPromise } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await playPromise;
    expect(audio.playCalls).toBe(1);
    controller.setCursor(cursor()); // rebroadcast of the same paragraph
    controller.setCursor(cursor());
    expect(controller.getStatus().kind).toBe("playing");
    expect(transport.requests.length).toBe(1);
    expect(audio.pauseCalls).toBe(0);
  });

  test("rapid play requests keep at most one un-aborted request in flight", async () => {
    const { transport, controller } = rig();
    controller.setCursor(cursor());
    void controller.playCurrent();
    void controller.playCurrent();
    void controller.playCurrent();
    await tick();
    const live = transport.requests.filter((request) => !request.signal.aborted);
    expect(live.length).toBe(1);
  });

  test("a stale profile fetch resolving after close never leads to synthesis", async () => {
    const transport = new FakeTransport();
    let releaseProfile: ((profile: TtsProfileSnapshot) => void) | null = null;
    transport.getProfile = (connectionId, signal) => {
      transport.profileRequests.push({ connectionId, signal });
      return new Promise((resolve) => { releaseProfile = resolve; });
    };
    const audio = new FakeAudio();
    const controller = new SpeechController({
      transport,
      createAudio: () => audio,
      createObjectUrl: () => "blob:x",
      revokeObjectUrl: () => undefined,
    });
    controller.setSettings(enabledSettings());
    controller.setActive(true);
    controller.setCursor(cursor());
    const playPromise = controller.playCurrent();
    await tick();
    expect(transport.profileRequests.length).toBe(1);
    controller.setActive(false); // view closed while metadata was in flight
    releaseProfile!(snapshot("conn-n"));
    await playPromise;
    expect(transport.requests.length).toBe(0);
    expect(audio.playCalls).toBe(0);
  });
});

describe("playback, pause/resume, errors", () => {
  test("successful play publishes playing; ended returns to idle; no extra requests", async () => {
    const { transport, audio, controller, statuses } = rig();
    controller.setCursor(cursor());
    const playPromise = controller.playCurrent();
    await tick();
    expect(statuses.some((status) => status.kind === "loading")).toBe(true);
    transport.requests[0]!.resolve(audioBlob());
    await playPromise;
    expect(statuses[statuses.length - 1]!.kind).toBe("playing");
    audio.emit("ended");
    expect(controller.getStatus().kind).toBe("idle");
    expect(transport.requests.length).toBe(1);
  });

  test("pause then playCurrent resumes the SAME audio without any new request", async () => {
    const { transport, audio, controller } = rig();
    controller.setCursor(cursor());
    const { done: playPromise } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await playPromise;
    controller.pause();
    expect(controller.getStatus().kind).toBe("paused");
    await controller.playCurrent();
    expect(transport.requests.length).toBe(1);
    expect(transport.profileRequests.length).toBe(1); // resume skips even the metadata read
    expect(audio.playCalls).toBe(2);
  });

  test("transport failure => error status, no automatic retry, loading cannot stick", async () => {
    const { transport, controller, statuses } = rig();
    controller.setCursor(cursor());
    const { done: playPromise } = await dispatchPlay(controller);
    transport.requests[0]!.reject(new SpeechTransportError("provider exploded", "provider"));
    await playPromise;
    const last = statuses[statuses.length - 1]!;
    expect(last.kind).toBe("error");
    expect((last as { message: string }).message).toContain("provider exploded");
    expect(transport.requests.length).toBe(1);
  });

  test("autoplay-policy rejection surfaces as blocked, recoverable by a manual Play", async () => {
    const { transport, audio, controller } = rig();
    controller.setCursor(cursor());
    audio.rejectNextPlay = new DOMException("play() failed because the user didn't interact", "NotAllowedError");
    const { done: playPromise } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await playPromise;
    expect(controller.getStatus().kind).toBe("blocked");
    await controller.playCurrent(); // gesture retry resumes the loaded audio
    expect(controller.getStatus().kind).toBe("playing");
    expect(transport.requests.length).toBe(1);
  });
});

describe("cache keys, invalidation, and object URLs", () => {
  test("a voice settings change stops playback, clears the cache, and forces a fresh request", async () => {
    const { transport, controller, revoked, created } = rig();
    controller.setCursor(cursor());
    const { done: playPromise } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await playPromise;
    controller.setSettings(enabledSettings({ narrator: { connectionId: "conn-n", voice: "Zephyr" } }));
    expect(revoked).toEqual(created);
    controller.setCursor(cursor()); // same paragraph again after boundary reset
    const { done: replay } = await dispatchPlay(controller);
    expect(transport.requests.length).toBe(2);
    transport.requests[1]!.resolve(audioBlob());
    await replay;
  });

  test("volume-only changes do NOT stop playback or clear the cache", async () => {
    const { transport, audio, controller, revoked } = rig();
    controller.setCursor(cursor());
    const { done: playPromise } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await playPromise;
    controller.setSettings(enabledSettings({ volume: 0.25 }));
    expect(controller.getStatus().kind).toBe("playing");
    expect(audio.volume).toBe(0.25);
    expect(revoked.length).toBe(0);
    expect(transport.requests.length).toBe(1);
  });

  test("chat change and dispose clear the cache; every URL is revoked exactly once", async () => {
    const { transport, audio, controller, created, revoked } = rig();
    controller.setCursor(cursor());
    const { done: p1 } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await p1;
    audio.emit("ended");
    controller.setCursor(cursor({ paragraphIndex: 1, text: "Second." }));
    const { done: p2 } = await dispatchPlay(controller);
    transport.requests[1]!.resolve(audioBlob());
    await p2;
    controller.onChatChanged();
    controller.dispose();
    expect(created.length).toBe(2);
    expect([...revoked].sort()).toEqual([...created].sort());
    expect(revoked.length).toBe(2); // exactly once each
  });

  test("LRU eviction revokes the oldest entry exactly once", async () => {
    const { transport, audio, controller, created, revoked } = rig({ maxCacheItems: 1 });
    controller.setCursor(cursor());
    const { done: p1 } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await p1;
    audio.emit("ended");
    controller.setCursor(cursor({ paragraphIndex: 1, text: "Second." }));
    const { done: p2 } = await dispatchPlay(controller);
    transport.requests[1]!.resolve(audioBlob());
    await p2;
    expect(created.length).toBe(2);
    expect(revoked.length).toBe(1);
    controller.dispose();
    expect([...revoked].sort()).toEqual([...created].sort());
  });
});

describe("autoplay opt-in", () => {
  test("autoplay never fires before a successful user-gesture play", async () => {
    const { transport, controller } = rig({ settings: enabledSettings({ autoplay: true }) });
    controller.setCursor(cursor());
    controller.setCursor(cursor({ paragraphIndex: 1, text: "Second." }));
    await tick();
    expect(transport.requests.length).toBe(0);
    expect(transport.profileRequests.length).toBe(0);
  });

  test("after one manual play, an advance auto-plays; a stale auto request still dies at boundaries", async () => {
    const { transport, controller } = rig({ settings: enabledSettings({ autoplay: true }) });
    controller.setCursor(cursor());
    const { done: manual } = await dispatchPlay(controller);
    transport.requests[0]!.resolve(audioBlob());
    await manual;
    controller.setCursor(cursor({ paragraphIndex: 1, text: "Second." }));
    await tick();
    expect(transport.requests.length).toBe(2); // auto-dispatched
    controller.setCursor(cursor({ paragraphIndex: 2, text: "Third." }));
    expect(transport.requests[1]!.signal.aborted).toBe(true);
  });
});

describe("audit remediation (must-fix 11-13, findings 5/14)", () => {
  /** A rig whose audio.play() stays pending until released, for lifecycle races. */
  function gatedRig(options: { maxCacheBytes?: number } = {}) {
    const transport = new FakeTransport();
    const audio = new FakeAudio();
    let playCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    audio.play = async () => {
      playCalls += 1;
      await gate;
    };
    const statuses: SpeechStatus[] = [];
    const created: string[] = [];
    const revoked: string[] = [];
    let counter = 0;
    const controller = new SpeechController({
      transport,
      onStatus: (status) => statuses.push(status),
      createAudio: () => audio,
      createObjectUrl: () => { const url = `blob:gated-${counter += 1}`; created.push(url); return url; },
      revokeObjectUrl: (url) => revoked.push(url),
      ...(options.maxCacheBytes === undefined ? {} : { maxCacheBytes: options.maxCacheBytes }),
    });
    controller.setSettings(enabledSettings());
    controller.setActive(true);
    return { transport, audio, statuses, created, revoked, controller, release, playCalls: () => playCalls };
  }

  /** Microtask spin until a flag holds (no timers, no sleeps). */
  async function waitFor(flag: () => boolean): Promise<void> {
    for (let index = 0; index < 60 && !flag(); index += 1) await tick();
    expect(flag()).toBe(true);
  }

  test("H15: audio.play() resolving after stop() never resurrects playing state", async () => {
    const rigged = gatedRig();
    rigged.controller.setCursor(cursor({ paragraphSpeaker: null, turnSpeaker: "Narrator" }));
    const done = rigged.controller.playCurrent();
    await tick();
    rigged.transport.requests[0]!.resolve(audioBlob());
    await waitFor(() => rigged.playCalls() === 1);
    rigged.controller.stop("user-stop");
    expect(rigged.controller.getStatus().kind).not.toBe("playing");
    rigged.release();
    await done;
    expect(rigged.controller.getStatus()).toEqual({ kind: "idle", speaker: "Narrator" });
    expect(rigged.audio.pauseCalls).toBe(1); // paused again when the late play settled
  });

  test("H16: audio.play() resolving after dispose() never mutates state", async () => {
    const rigged = gatedRig();
    rigged.controller.setCursor(cursor({ paragraphSpeaker: null, turnSpeaker: "Narrator" }));
    const done = rigged.controller.playCurrent();
    await tick();
    rigged.transport.requests[0]!.resolve(audioBlob());
    await waitFor(() => rigged.playCalls() === 1);
    rigged.controller.dispose();
    rigged.release();
    await done;
    expect(rigged.statuses.some((status) => status.kind === "playing")).toBe(false);
  });

  test("H17: pause() during pending audio.play() settles to paused, not playing", async () => {
    const rigged = gatedRig();
    rigged.controller.setCursor(cursor({ paragraphSpeaker: null, turnSpeaker: "Narrator" }));
    const done = rigged.controller.playCurrent();
    await tick();
    rigged.transport.requests[0]!.resolve(audioBlob());
    await waitFor(() => rigged.playCalls() === 1);
    rigged.controller.pause();
    expect(rigged.controller.getStatus()).toEqual({ kind: "paused", speaker: "Narrator" });
    rigged.release();
    await done;
    expect(rigged.controller.getStatus()).toEqual({ kind: "paused", speaker: "Narrator" });
    expect(rigged.audio.pauseCalls).toBeGreaterThanOrEqual(1);
  });

  test("H18: oversized-but-current audio still plays; its URL is never revoked early", async () => {
    const rigged = rig({ maxCacheBytes: 50 });
    rigged.controller.setCursor(cursor());
    const { done: first } = await dispatchPlay(rigged.controller);
    rigged.transport.requests[0]!.resolve(audioBlob(10));
    await first;
    rigged.audio.emit("ended");
    expect(rigged.controller.getStatus().kind).toBe("idle");
    rigged.controller.setCursor(cursor({ paragraphIndex: 1, text: "A much longer second paragraph." }));
    const { done: second } = await dispatchPlay(rigged.controller);
    rigged.transport.requests[1]!.resolve(audioBlob(100)); // over the 50-byte cap
    await second;
    expect(rigged.controller.getStatus().kind).toBe("playing");
    expect(rigged.revoked).toEqual([rigged.created[0]!]); // only the older entry went
    expect(rigged.revoked).not.toContain(rigged.created[1]!);
    expect(rigged.audio.src).toBe(rigged.created[1]!);
  });

  test("H19: a synthesis timeout publishes an error, never a silent idle", async () => {
    const transport = new FakeTransport();
    transport.synthesize = async () => {
      throw new SpeechTransportError("Speech synthesis timed out after 60 seconds.", "timeout");
    };
    const statuses: SpeechStatus[] = [];
    const controller = new SpeechController({
      transport,
      onStatus: (status) => statuses.push(status),
      createAudio: () => new FakeAudio(),
      createObjectUrl: () => "blob:h19",
      revokeObjectUrl: () => {},
    });
    controller.setSettings(enabledSettings());
    controller.setActive(true);
    controller.setCursor(cursor({ paragraphSpeaker: null, turnSpeaker: "Narrator" }));
    await controller.playCurrent();
    expect(controller.getStatus().kind).toBe("error");
    expect(statuses.some((status) => status.kind === "error")).toBe(true);
  });

  test("H21: a speaker-attribution correction for identical text updates the cursor", async () => {
    const { controller } = rig();
    controller.setCursor(cursor({
      paragraphSpeaker: null, turnSpeaker: "Bob", text: "Dialogue text here.",
    }));
    expect(controller.getStatus()).toEqual({ kind: "idle", speaker: "Bob" });
    controller.setCursor(cursor({
      paragraphSpeaker: "Alice", turnSpeaker: "Bob", text: "Dialogue text here.",
    }));
    expect(controller.getStatus()).toEqual({ kind: "idle", speaker: "Alice" });
  });

  test("H23: a play superseded before the element is touched never assigns audio.src", async () => {
    const { transport, audio, controller } = rig();
    controller.setCursor(cursor());
    const done = controller.playCurrent();
    await tick();
    // Resolve, then bump the epoch synchronously, before continuations run.
    transport.requests[0]!.resolve(audioBlob());
    controller.setCursor(cursor({ paragraphIndex: 1, text: "Second." }));
    await done;
    await tick();
    expect(audio.src).toBe("");
  });
});
