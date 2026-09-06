// Adopted from cache-review probe `.cache/scene-cache/probes/controller-lifecycle.probe.test.ts` (import paths adjusted).
/**
 * Independent probe (cache-review): the REAL controller lifecycle through
 * registerVisualNovelBackend — host events, frontend requests, planner (mock
 * sidecar), asset pipeline and the process-wide scene cache. No manual
 * bumpEpoch/invalidateScope calls: every cache transition must come from the
 * controller's own wiring.
 */
import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend, sceneImageCache } from "./controller.js";
import { sceneImageScope } from "../core/scene-image-cache.js";
import { turnPath, type StoredTurnRecord } from "./storage.js";

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
const settle = (ms = 40) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Script = { speaker: string; location: string; claimNew: boolean; reason: string; cues: Array<number | [number, string]>; expression?: string };
const CONTENT = "One.\n\nTwo.\n\nThree.\n\nFour.";

function fixture() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let frontend: ((payload: unknown, userId: string) => void) | null = null;
  const data = new Map<string, unknown>();
  const sent: Array<Record<string, unknown>> = [];
  const providerCalls: string[] = [];
  const images = new Set<string>();
  const deletes: string[] = [];
  let seq = 0;
  let script: Script = { speaker: "Mira", location: "Observatory", claimNew: true, reason: "initial", cues: [0] };
  const messages: Array<Record<string, unknown>> = [];
  let gate: { pending: boolean; release: () => void } | null = null;
  data.set("config.json", {
    generateImages: true, maxImagesPerTurn: 2, imageConcurrency: 2, referenceAnchoring: false, debugLogging: false,
    includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false
  });
  const spindle = {
    on: (event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    onFrontendMessage: (fn: (payload: unknown, userId: string) => void) => { frontend = fn; },
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    },
    chat: { getMessages: async (chatId: string) => messages.filter((m) => m.chat_id === chatId) },
    generate: {
      raw: async () => ({ content: JSON.stringify({
        scenes: [{
          startParagraph: 0,
          boundary: { claimedNewScene: script.claimNew, reason: script.reason, location: script.location, timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
          environment: { location: script.location, timeOfDay: "night", weather: null, lighting: "lantern light", description: `An old ${script.location.toLowerCase()}`, persistentElements: ["brass telescope"] },
          cast: [script.speaker], character: script.speaker,
          basePrompt: "base", compositionLock: `${script.speaker} centered ${Math.random()}`
        }],
        cues: script.cues.map((entry) => Array.isArray(entry) ? { paragraphIndex: entry[0], character: script.speaker, expression: entry[1] } : { paragraphIndex: entry, character: script.speaker, expression: script.expression ?? "smile" }),
        choices: [], effects: [], speakers: [],
        characters: [{ name: "Mira", description: "silver hair, green eyes, red coat" }, { name: "Alex", description: "black hair, brown eyes, grey hoodie" }]
      }) })
    },
    imageGen: {
      generate: async (input: { prompt: string }) => {
        providerCalls.push(input.prompt);
        if (gate?.pending) await new Promise<void>((resolve) => { gate!.release = resolve; });
        const imageId = `img-${++seq}`; images.add(imageId);
        return { imageId, imageUrl: `/api/v1/images/${imageId}`, imageDataUrl: "", model: "m", provider: "comfyui" };
      },
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }]
    },
    images: { get: async (id: string) => images.has(id) ? { id } : null, delete: async (id: string) => { deletes.push(id); return true; } },
    sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); },
    log: { warn() {}, error() {}, info() {} }
  } as unknown as SpindleAPI;
  const fire = (event: string, ...args: unknown[]) => { for (const handler of handlers.get(event) ?? []) handler(...args); };
  const request = (payload: unknown) => frontend!(payload, "user-1");
  const say = async (chatId: string, id: string, s: Script) => {
    script = s;
    messages.push({ id, chat_id: chatId, content: CONTENT, is_user: false, name: s.speaker, swipe_id: 0, swipes: [CONTENT], swipe_dates: [1], extra: {}, parent_message_id: null, branch_id: null, created_at: 1, index_in_chat: messages.length, send_date: 1 });
    const before = sent.length;
    fire("GENERATION_ENDED", { chatId, messageId: id, content: CONTENT }, "user-1");
    await waitFor(() => sent.slice(before).some((m) => m.type === "vn_turn" && (m.turn as { messageId: string }).messageId === id));
    await settle();
    return sent.slice(before);
  };
  const record = (chatId: string, id: string) => data.get(turnPath(chatId, id, 0)) as StoredTurnRecord;
  const openGate = () => { gate = { pending: true, release: () => {} }; };
  const closeGate = () => { gate!.pending = false; gate!.release(); };
  return { spindle, fire, request, say, record, sent, providerCalls, images, deletes, data, openGate, closeGate };
}

describe("probe: real controller lifecycle with the scene cache", () => {
  test("end-to-end: reuse, extra swaps before first vn_turn, retry, chat switch, delete, stale late result", async () => {
    const f = fixture();
    registerVisualNovelBackend(f.spindle);
    const cache = sceneImageCache();
    const scopeA = sceneImageScope("user-1", "chat-A");

    // T1: Mira, cap 2, cues at p0..p3 (same expression -> identical prompts). 2 provider calls; p2/p3 are cache cues.
    const t1 = await f.say("chat-A", "m1", { speaker: "Mira", location: "Observatory", claimNew: true, reason: "initial", cues: [[0, "smile"], [1, "angry"], [2, "smile"], [3, "angry"]] });
    expect(f.providerCalls.length).toBe(2);
    const r1 = f.record("chat-A", "m1");
    expect(r1.plan.visualCues.length).toBe(2);
    expect(r1.plan.cacheCues?.length).toBe(2);
    await waitFor(() => f.record("chat-A", "m1").jobs.filter((j) => j.provider === "cache").length === 2);
    const cacheViews = t1.concat(f.sent).filter((m) => m.type === "vn_asset" && (m.asset as { source?: string }).source === "cache");
    expect(cacheViews.length).toBeGreaterThanOrEqual(2);         // late-population extra swaps broadcast as vn_asset
    expect(f.providerCalls.length).toBe(2);                     // ...without any request
    expect(cache.snapshot(scopeA).length).toBe(2);              // two keys: smile and angry

    // T2: Alex in the same observatory (speaker-induced new scene id): different identity -> 2 calls.
    await f.say("chat-A", "m2", { speaker: "Alex", location: "Observatory", claimNew: false, reason: "none", cues: [[0, "smile"], [1, "angry"]] });
    expect(f.providerCalls.length).toBe(4);
    const r2 = f.record("chat-A", "m2");
    expect(r2.plan.scenes[0]!.sceneId).not.toBe(r1.plan.scenes[0]!.sceneId);
    expect(r2.plan.scenes[0]!.priorSceneId).toBe(r1.plan.scenes[0]!.priorSceneId);

    // T3: Mira again, cues p0..p2: zero calls; the FIRST vn_turn already carries the cache swap for p2.
    const t3 = await f.say("chat-A", "m3", { speaker: "Mira", location: "Observatory", claimNew: false, reason: "none", cues: [[0, "smile"], [1, "angry"], [2, "smile"]] });
    expect(f.providerCalls.length).toBe(4);
    const firstTurnView = t3.find((m) => m.type === "vn_turn") as { turn: { assets: Array<{ paragraphIndex: number; status: string; source?: string; imageId?: string }> } };
    const assets3 = firstTurnView.turn.assets;
    expect(assets3.filter((a) => a.source === "cache").map((a) => a.paragraphIndex)).toEqual([2]);
    expect(assets3.find((a) => a.source === "cache")!.status).toBe("generated");
    await waitFor(() => f.record("chat-A", "m3").jobs.every((j) => j.status === "generated"));
    const r3 = f.record("chat-A", "m3");
    expect(new Set(r3.jobs.map((j) => j.imageId)).size).toBe(2);
    expect(r3.jobs[0]!.imageId).toBe(r1.jobs[0]!.imageId);      // reused turn-1 image
    expect(r3.jobs.every((j) => j.ownerTurnKey.assistantMessageId === "m3")).toBe(true); // owned by T3

    // Retry T3: everything is generated -> kept, no provider call, cache job untouched.
    const beforeRetry = f.sent.length;
    f.request({ type: "vn_retry_turn", chatId: "chat-A", messageId: "m3" });
    await waitFor(() => f.sent.slice(beforeRetry).some((m) => m.type === "vn_turn"));
    await settle();
    expect(f.providerCalls.length).toBe(4);
    expect(f.record("chat-A", "m3").jobs.filter((j) => j.provider === "cache").length).toBe(1);

    // Browser ack on the cache job works from the record alone.
    const cacheJob = r3.jobs.find((j) => j.provider === "cache")!;
    f.request({ type: "vn_asset_ready", chatId: "chat-A", messageId: "m3", jobId: cacheJob.jobId, sourceFingerprint: r3.plan.key.sourceFingerprint });
    await waitFor(() => f.record("chat-A", "m3").jobs.find((j) => j.jobId === cacheJob.jobId)!.status === "browser_ready");

    // Stale late result: T4 starts generating, GENERATION_STARTED interrupts, late completion is not cached.
    f.openGate();
    const messagesBefore = f.providerCalls.length;
    const t4 = f.say("chat-A", "m4", { speaker: "Mira", location: "Observatory", claimNew: false, reason: "none", cues: [0], expression: "laugh" });
    await waitFor(() => f.providerCalls.length === messagesBefore + 1);
    f.fire("GENERATION_STARTED", { chatId: "chat-A" }, "user-1");
    f.closeGate();
    await t4;
    expect(cache.snapshot(scopeA).length).toBe(4);              // 2 Mira + 2 Alex keys; the late "laugh" render was NOT admitted
    expect(f.record("chat-A", "m4").jobs[0]!.status).not.toBe("generated");

    // Chat switch: viewing chat B releases chat A's scope.
    // REVIEW NOTE: the controller only learns the "active" chat from vn_get_state; a chat that
    // only ever received host events is never released by a later switch (P3, see verdict).
    f.request({ type: "vn_get_state", chatId: "chat-A" });
    await settle();
    expect(cache.snapshot(scopeA).length).toBe(4);              // asking for the same chat releases nothing
    f.request({ type: "vn_get_state", chatId: "chat-B" });
    await waitFor(() => cache.snapshot(scopeA).length === 0);
    expect(cache.stats().invalidations.chat_switch).toBeGreaterThanOrEqual(1);
    f.request({ type: "vn_get_state", chatId: "chat-A" });
    await settle();
    // Back in chat A the same Mira cue must generate again (no resurrection).
    const calls = f.providerCalls.length;
    await f.say("chat-A", "m5", { speaker: "Mira", location: "Observatory", claimNew: false, reason: "none", cues: [0] });
    expect(f.providerCalls.length).toBe(calls + 1);
    expect(cache.snapshot(scopeA).length).toBe(1);

    // Delete: scope cleared and generation advanced; nothing was ever deleted from the host.
    f.fire("MESSAGE_DELETED", { chatId: "chat-A", messageId: "m5" }, "user-1");
    await waitFor(() => cache.snapshot(scopeA).length === 0);
    expect(cache.generation(scopeA)).toBeGreaterThanOrEqual(2);  // chat switch + delete
    expect(f.deletes).toEqual([]);
    // Every persisted record still holds its image ids after all cache churn.
    for (const id of ["m1", "m2", "m3"]) expect(f.record("chat-A", id).jobs.every((j) => j.imageId)).toBe(true);
  });
});
