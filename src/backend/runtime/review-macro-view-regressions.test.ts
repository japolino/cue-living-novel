import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend } from "./controller.js";
import { fingerprintForMessage } from "./planner.js";
import { cleanResolvedText, maskVolatileMacros, resolveMessageIntake } from "./message-text.js";
import { characterRegistryPath, chatStatePath, singleCharacterStatePath, type StoredChatState, type StoredTurnRecord } from "./storage.js";
import { RAW_GREETING, RESOLVED_GREETING_S1, S1_SCENE_TEXT } from "./__fixtures__/greeting-macro.js";
import { storyCheckReply } from "./__fixtures__/story-check";

/**
 * Regressions found by the release review of view gating (817e60d) and macro
 * intake (15afca9). Each test reproduced the defect on cd79d61 before the fix.
 */

type Msg = { id: string; content: string; is_user: boolean; name: string; swipe_id?: number };

function plannerPayload() {
  return {
    scenes: [{
      startParagraph: 0,
      boundary: { claimedNewScene: true, reason: "initial", location: "Sol Eterna", timeOfDay: "day", majorTimeJump: false, environmentReplacement: false, forced: false },
      environment: { location: "Sol Eterna", timeOfDay: "day", weather: null, lighting: "sunlight", description: "The Grand Audience Chamber", persistentElements: [] },
      cast: ["Aurelia"], basePrompt: "grand audience chamber", compositionLock: "Aurelia centered"
    }],
    cues: [{ paragraphIndex: 0 }], choices: [],
    characters: [{ name: "Aurelia", description: "platinum-blonde hair, golden eyes" }]
  };
}

type Resolver = (template: string) => string | Promise<string>;

function runtime(messages: Msg[], opts: { resolveText?: Resolver; generateImages?: boolean; gated?: boolean; noMacrosApi?: boolean } = {}) {
  const data = new Map<string, unknown>();
  const writes: Array<[string, unknown]> = [];
  data.set("config.json", {
    generateImages: opts.generateImages ?? false, maxImagesPerTurn: 2, imageConcurrency: 1,
    includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false, includeRecentMessages: 4
  });
  const sent: Array<Record<string, unknown>> = [];
  let plannerCalls = 0;
  let macroCalls = 0;
  let imageCalls = 0;
  const gates: Array<(value: { imageId: string; imageUrl?: string | null }) => void> = [];
  let resolveImpl: Resolver | null = opts.resolveText ?? null;
  let frontendHandler: (payload: unknown, userId: string) => void = () => {};
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  // Optional one-shot gate on a storage read (to park a cleanup mid-flight).
  let readGate: { match: (path: string) => boolean; promise: Promise<void> } | null = null;
  const spindle = {
    on: (event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
    onFrontendMessage: (fn: (payload: unknown, userId: string) => void) => { frontendHandler = fn; },
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown }) => {
        if (readGate?.match(path)) { const gate = readGate; readGate = null; await gate.promise; }
        return data.get(path) ?? readOptions.fallback;
      },
      setJson: async (path: string, value: unknown) => { writes.push([path, value]); data.set(path, value); }
    },
    chat: {
      getMessages: async () => messages.map((message) => ({
        ...message, chat_id: "c1", index_in_chat: 1, send_date: 1, swipe_id: message.swipe_id ?? 0, swipes: [message.content],
        swipe_dates: [1], extra: {}, parent_message_id: null, branch_id: null, created_at: 1, role: message.is_user ? "user" : "assistant"
      }))
    },
    ...(opts.noMacrosApi ? {} : {
      macros: {
        resolve: async (template: string) => {
          macroCalls += 1;
          return { text: resolveImpl ? await resolveImpl(template) : template, diagnostics: [] };
        }
      }
    }),
    generate: { raw: async (request: unknown) => { const check = storyCheckReply(request); if (check) return check; plannerCalls += 1; return { content: JSON.stringify(plannerPayload()) }; } },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async () => {
        imageCalls += 1;
        if (opts.gated) return new Promise<{ imageId: string; imageUrl?: string | null }>((resolve) => { gates.push(resolve); });
        return { imageId: `img-${imageCalls}`, imageUrl: `/api/v1/images/img-${imageCalls}` };
      }
    },
    sendToFrontend: (payload: Record<string, unknown>) => { sent.push(payload); },
    log: { warn() {}, error() {}, info() {} }
  } as unknown as SpindleAPI;
  registerVisualNovelBackend(spindle);
  return {
    spindle, data, sent, writes, gates,
    plannerCalls: () => plannerCalls, macroCalls: () => macroCalls, imageCalls: () => imageCalls,
    frontend: (payload: unknown) => frontendHandler(payload, "u1"),
    fire: (event: string, payload: unknown) => { for (const handler of handlers.get(event) ?? []) handler(payload, "u1"); },
    setResolve: (impl: Resolver | null) => { resolveImpl = impl; },
    gateNextRead: (match: (path: string) => boolean): (() => void) => {
      let release!: () => void;
      readGate = { match, promise: new Promise<void>((resolve) => { release = resolve; }) };
      return release;
    },
    record: (): StoredTurnRecord | null => {
      const state = data.get(chatStatePath("c1")) as StoredChatState | undefined;
      return state?.activeTurnPath ? (data.get(state.activeTurnPath) as StoredTurnRecord) : null;
    }
  };
}

const settle = (ms = 60) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Runtime = ReturnType<typeof runtime>;
const openView = (rt: Runtime) => {
  rt.frontend({ type: "vn_view", chatId: "c1", open: true });
  rt.frontend({ type: "vn_get_state", chatId: "c1", viewOpen: true });
};
const identityResets = (rt: Runtime) => rt.writes.filter(([path, value]) =>
  (path === singleCharacterStatePath("c1") && value === null) || (path === characterRegistryPath("c1") && JSON.stringify(value) === "{}"));

const PLAIN = "Aurelia lowers the report.\n\nShe studies the visitor.\n\nThe hall is silent.";
const VOLATILE = "{{random::Dawn::Dusk}} light fills the chamber.\n\nAurelia lowers the report.";
let flip = 0;
const alternating: Resolver = (template) => template.replace(/\{\{random::[^}]*\}\}/g, () => (flip++ % 2 ? "Dusk" : "Dawn"));

/** Tiny CBS emulator standing in for the LumiRealm interceptor: random, equal, getvar, #when. */
function cbs(vars: Record<string, string>, random: () => number): Resolver {
  return (template) => {
    // One draw per host call (the host seeds an evaluation): every {{random}}
    // in the same call agrees, separate calls may differ.
    const draw = random();
    let text = template;
    for (let pass = 0; pass < 32; pass += 1) {
      const next = text
        .replace(/\{\{random::([^{}]*)\}\}/g, (_m, list: string) => { const items = list.split("::"); return items[Math.floor(draw * items.length)]!; })
        .replace(/\{\{getvar::([^{}]*)\}\}/g, (_m, name: string) => vars[name] ?? "")
        .replace(/\{\{equal::([^{}:]*)::([^{}:]*)\}\}/g, (_m, a: string, b: string) => (a === b ? "1" : "0"))
        .replace(/\{\{#when::([01])\}\}([\s\S]*?)\{\{\/when\}\}/g, (_m, flag: string, body: string) => (flag === "1" ? body : ""))
        .replace(/\{\{char\}\}/g, "Aurelia");
      if (next === text) break;
      text = next;
    }
    return text;
  };
}

describe("maskVolatileMacros / resolveMessageIntake (dual resolution contract)", () => {
  test("masks depth-0 volatile tokens only; selection headers and other macros are untouched", () => {
    const masked = maskVolatileMacros("{{#when::{{equal::{{random::1::2}}::1}}}}\nA {{roll::1d6}} {{char}} {{TIME}}\n{{/when}}");
    expect(masked.template).toContain("{{#when::{{equal::{{random::1::2}}::1}}}}");
    expect(masked.template).toContain("{{char}}");
    expect(masked.template).not.toContain("{{roll");
    expect(masked.template).not.toContain("{{TIME}}");
    expect(masked.tokens).toEqual(["{{roll::1d6}}", "{{TIME}}"]);
    expect(maskVolatileMacros("plain {{char}} text")).toEqual({ template: "plain {{char}} text", tokens: [], stableSelection: true });
  });

  test("planning text carries the real values, selection text is stable, no mask char is ever visible", async () => {
    const rt = runtime([], { resolveText: alternating });
    const first = await resolveMessageIntake(rt.spindle, "c1", VOLATILE, "u1");
    const second = await resolveMessageIntake(rt.spindle, "c1", VOLATILE, "u1");
    expect(first.text).toMatch(/^(Dawn|Dusk) light fills/);
    expect(first.text).not.toBe(second.text);
    expect(first.selectionText).toBe(second.selectionText);
    expect(first.selectionText).not.toContain("{{");
    expect(first.text).not.toContain("\u2062");
    expect(first.resolved).toBe(true);
  });

  test("every host call is a dry resolve (commit:false) scoped to the chat and user", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const spindle = {
      macros: { resolve: async (template: string, options: Record<string, unknown>) => { calls.push({ template, ...options }); return { text: template, diagnostics: [] }; } }
    } as unknown as SpindleAPI;
    await resolveMessageIntake(spindle, "c1", "{{char}} rolls {{roll::1d6}} and {{roll::2d6}}", "u1");
    expect(calls.length).toBe(3);
    for (const call of calls) expect(call).toMatchObject({ commit: false, chatId: "c1", userId: "u1" });
    expect(calls.map((call) => call.template)).toEqual(["{{char}} rolls \u20620\u2062 and \u20621\u2062", "{{roll::1d6}}", "{{roll::2d6}}"]);
  });

  test("a volatile token inside a #when header picks the branch in ONE call: text and selection never disagree", async () => {
    const card = "{{#when::{{equal::{{random::1::2}}::1}}}}\nScene one at {{random::dawn::dusk}}.\n{{/when}}\n{{#when::{{equal::{{random::1::2}}::2}}}}\nScene two at {{random::dawn::dusk}}.\n{{/when}}";
    // Each host call advances the sequence, so a second branch-choosing call
    // would land on a different scene than the first.
    const sequence = [0.1, 0.9];
    let index = 0;
    const rt = runtime([], { resolveText: cbs({}, () => sequence[index++ % sequence.length]!) });
    for (let round = 0; round < 4; round += 1) {
      const intake = await resolveMessageIntake(rt.spindle, "c1", card, "u1");
      const scene = /Scene (one|two)/.exec(intake.text)?.[1];
      expect(scene).toBeDefined();
      expect(intake.selectionText).toContain(`Scene ${scene} at`);
      expect(intake.text).toMatch(/Scene (one|two) at (dawn|dusk)\./);
      expect(intake.selectionText).not.toMatch(/dawn|dusk/);
    }
  });

  test("a card-variable selection resolves the chosen scene only, with an inline volatile token filled in", async () => {
    const card = "$messageSelector\n\n{{#when::{{equal::{{getvar::firstMessage}}::s1}}}}\nThe {{random::gold::silver}} hall.\n\n<pimg=\"aurelia\">\n{{/when}}\n\n{{#when::{{equal::{{getvar::firstMessage}}::s2}}}}\nThe frozen ramparts.\n{{/when}}";
    const rt = runtime([], { resolveText: cbs({ firstMessage: "s1" }, () => 0.99) });
    const intake = await resolveMessageIntake(rt.spindle, "c1", card, "u1");
    expect(intake.text).toBe("The silver hall.\n\n<pimg=\"aurelia\">");
    expect(intake.selectionText).toBe("The \u20620\u2062 hall.\n\n<pimg=\"aurelia\">");
    expect(intake.text).not.toContain("frozen");
    expect(intake.resolved).toBe(true);
  });

  test("a literal mask character in the stored text cannot collide with a placeholder", async () => {
    const rt = runtime([], { resolveText: (template) => template.replace(/\{\{roll::1d6\}\}/g, "4") });
    const intake = await resolveMessageIntake(rt.spindle, "c1", "Rolled \u20620\u2062 then {{roll::1d6}} {{char}}", "u1");
    expect(intake.text).toBe("Rolled 0 then 4 {{char}}");
    expect(intake.selectionText).toBe("Rolled 0 then \u20620\u2062 {{char}}");
  });

  test("without a macros API the volatile token is dropped, display macros are kept, resolved is false", async () => {
    const rt = runtime([], { noMacrosApi: true });
    const intake = await resolveMessageIntake(rt.spindle, "c1", "{{char}} arrives at {{time}}.", "u1");
    expect(intake.text).toBe("{{char}} arrives at .");
    expect(intake.selectionText).toBe("{{char}} arrives at \u20620\u2062.");
    expect(intake.resolved).toBe(false);
    expect(rt.macroCalls()).toBe(0);
  });
});

describe("volatile macro resolution never looks like a new scene (review F1)", () => {
  test("repeated state requests reuse the stored turn: one plan, no identity reset, turn always sent", async () => {
    const rt = runtime([{ id: "g1", content: VOLATILE, is_user: false, name: "Aurelia" }], { resolveText: alternating });
    openView(rt); await settle();
    expect(rt.plannerCalls()).toBe(1);
    const stored = rt.record()!;
    expect(stored.source).toEqual({ version: 2, rawFingerprint: fingerprintForMessage({ id: "g1", swipe_id: 0, content: VOLATILE }) });
    expect(stored.resolvedSourceText).toMatch(/^(Dawn|Dusk) light fills/);
    rt.sent.length = 0; rt.writes.length = 0;
    openView(rt); await settle();
    openView(rt); await settle();
    expect(rt.plannerCalls()).toBe(1);
    const states = rt.sent.filter((message) => message.type === "vn_state") as Array<{ turn: unknown }>;
    expect(states.length).toBe(2);
    expect(states.every((state) => state.turn !== null)).toBe(true);
    expect(rt.sent.some((message) => message.type === "vn_planning")).toBe(false);
    expect(identityResets(rt).length).toBe(0);
  });

  test("a real selection change on the same stored text still replans and resets the sole-turn identity", async () => {
    const rt = runtime([{ id: "g1", content: RAW_GREETING, is_user: false, name: "Scenario" }], { resolveText: () => RESOLVED_GREETING_S1 });
    openView(rt); await settle();
    expect(rt.plannerCalls()).toBe(1);
    rt.writes.length = 0; rt.sent.length = 0;
    rt.setResolve(() => "A different opening.\n\nThe northern watchtower bell hangs silent over the frozen ramparts.");
    openView(rt); await settle();
    expect(rt.plannerCalls()).toBe(2);
    expect(identityResets(rt).length).toBe(2);
    const state = rt.sent.find((message) => message.type === "vn_state") as { turn: unknown };
    expect(state.turn).toBeNull();
    expect(rt.record()!.plan.paragraphs[0]!.text).toBe("A different opening.");
  });
});

describe("stored fingerprint upgrade (records from before intake v2)", () => {
  test("a legacy record fingerprinted on raw text is current for a plain message", async () => {
    const rt = runtime([{ id: "m1", content: PLAIN, is_user: false, name: "Aurelia" }]);
    openView(rt); await settle();
    const record = rt.record()!;
    delete (record as Partial<StoredTurnRecord>).source;
    delete (record as Partial<StoredTurnRecord>).resolvedSourceText;
    rt.sent.length = 0;
    openView(rt); await settle();
    expect(rt.plannerCalls()).toBe(1);
    expect((rt.sent.find((message) => message.type === "vn_state") as { turn: unknown }).turn).not.toBeNull();
  });

  test("a legacy record fingerprinted on volatile resolved text replans once, without an identity reset, and is upgraded", async () => {
    const rt = runtime([{ id: "g1", content: VOLATILE, is_user: false, name: "Aurelia" }], { resolveText: alternating });
    openView(rt); await settle();
    const record = rt.record()!;
    // What 15afca9 stored: a fingerprint of the fully resolved (volatile) text and no `source` marker.
    record.plan.key.sourceFingerprint = fingerprintForMessage({ id: "g1", swipe_id: 0, content: "Dusk light fills the chamber.\n\nAurelia lowers the report." });
    delete (record as Partial<StoredTurnRecord>).source;
    rt.writes.length = 0;
    openView(rt); await settle();
    expect(rt.plannerCalls()).toBe(2);
    expect(identityResets(rt).length).toBe(0);
    expect(rt.record()!.source?.version).toBe(2);
    openView(rt); await settle();
    expect(rt.plannerCalls()).toBe(2);
  });
});

describe("host resolution failure keeps a valid stored turn (review F3)", () => {
  test("state request: a throwing resolver sends the stored turn and no vn_waiting", async () => {
    const rt = runtime([{ id: "g1", content: RAW_GREETING, is_user: false, name: "Scenario" }], { resolveText: () => RESOLVED_GREETING_S1 });
    openView(rt); await settle();
    expect(rt.record()).not.toBeNull();
    rt.setResolve(() => { throw new Error("interceptor not loaded"); });
    rt.sent.length = 0;
    openView(rt); await settle();
    const state = rt.sent.find((message) => message.type === "vn_state") as { turn: { paragraphs: string[] } | null };
    expect(state.turn).not.toBeNull();
    expect(state.turn!.paragraphs.join(" ")).toContain("The cradle of humanity");
    expect(rt.sent.some((message) => message.type === "vn_waiting")).toBe(false);
    expect(rt.plannerCalls()).toBe(1);
  });

  test("intake and retry: unresolved blocks (no interceptor) keep the stored plan instead of waiting or replanning", async () => {
    const rt = runtime([{ id: "g1", content: RAW_GREETING, is_user: false, name: "Scenario" }], { resolveText: () => RESOLVED_GREETING_S1 });
    openView(rt); await settle();
    rt.setResolve(null); // host echoes the template: {{#when}} blocks survive
    rt.sent.length = 0;
    rt.fire("MESSAGE_EDITED", { chatId: "c1", message: { id: "g1", content: RAW_GREETING, is_user: false, name: "Scenario", swipe_id: 0 } });
    await settle();
    expect(rt.sent.some((message) => message.type === "vn_waiting")).toBe(false);
    expect(rt.sent.some((message) => message.type === "vn_turn")).toBe(true);
    expect(rt.plannerCalls()).toBe(1);
    rt.sent.length = 0;
    rt.frontend({ type: "vn_retry_turn", chatId: "c1", messageId: "g1" });
    await settle();
    expect(rt.plannerCalls()).toBe(1);
    expect(rt.sent.some((message) => message.type === "vn_turn")).toBe(true);
    expect(rt.record()!.plan.paragraphs.map((paragraph) => paragraph.text).join(" ")).toContain("The cradle of humanity");
  });

  test("no stored turn and no interceptor still yields the truthful waiting state", async () => {
    const rt = runtime([{ id: "g1", content: RAW_GREETING, is_user: false, name: "Scenario" }]);
    openView(rt); await settle();
    expect(rt.plannerCalls()).toBe(0);
    expect(rt.sent.some((message) => message.type === "vn_waiting")).toBe(true);
  });
});

describe("identity reset scope (review F4)", () => {
  test("editing a plain greeting replans with continuity and never resets identity state", async () => {
    const messages: Msg[] = [{ id: "g1", content: PLAIN, is_user: false, name: "Aurelia" }];
    const rt = runtime(messages);
    openView(rt); await settle();
    expect(rt.plannerCalls()).toBe(1);
    rt.writes.length = 0;
    messages[0]!.content = PLAIN.replace("silent", "very silent");
    rt.fire("MESSAGE_EDITED", { chatId: "c1", message: { id: "g1", content: messages[0]!.content, is_user: false, name: "Aurelia", swipe_id: 0 } });
    await settle();
    expect(rt.plannerCalls()).toBe(2);
    expect(identityResets(rt).length).toBe(0);
    expect(rt.record()!.resolvedSourceText).toBe(messages[0]!.content);
  });
});

describe("view close ownership (review F2, F5)", () => {
  const THREE = "Aurelia lowers the report.\n\nShe studies the visitor.\n\nThe hall is silent.";

  test("a boot request that says nothing about the view leaves the batch alive; an explicit close still cancels", async () => {
    const rt = runtime([{ id: "m1", content: THREE, is_user: false, name: "Aurelia" }], { generateImages: true, gated: true });
    openView(rt); await settle();
    expect(rt.imageCalls()).toBe(1);
    // What the frontend sends at boot after a page reload.
    rt.frontend({ type: "vn_get_state", chatId: "c1" });
    await settle();
    rt.gates[0]!({ imageId: "img-a", imageUrl: "/img-a" });
    await settle();
    expect(rt.record()!.jobs[0]!.status).toBe("generated");
    // A deliberate close (no autoEnter) does abort what is still running.
    rt.frontend({ type: "vn_view", chatId: "c1", open: false });
    await settle();
    expect(rt.record()!.jobs.every((job) => job.status === "generated" || job.status === "cancelled")).toBe(true);
  });

  test("fast close then reopen leaves no orphan generating job and informs the reopened view", async () => {
    const rt = runtime([{ id: "m1", content: THREE, is_user: false, name: "Aurelia" }], { generateImages: true, gated: true });
    openView(rt); await settle();
    expect(rt.imageCalls()).toBe(1);
    rt.sent.length = 0;
    rt.frontend({ type: "vn_view", chatId: "c1", open: false });
    rt.frontend({ type: "vn_view", chatId: "c1", open: true });
    await settle(120);
    rt.gates[0]!({ imageId: "late", imageUrl: "/late" });
    await settle();
    const record = rt.record()!;
    expect(record.jobs.every((job) => job.status === "cancelled")).toBe(true);
    const assets = rt.sent.filter((message) => message.type === "vn_asset") as Array<{ asset: { status: string } }>;
    expect(assets.some((message) => message.asset.status === "cancelled")).toBe(true);
    expect(rt.imageCalls()).toBe(1);
  });

  test("reopen + retry while the old cleanup is still awaiting storage: the retried batch is never stamped cancelled", async () => {
    const rt = runtime([{ id: "m1", content: THREE, is_user: false, name: "Aurelia" }], { generateImages: true, gated: true });
    openView(rt); await settle();
    expect(rt.imageCalls()).toBe(1);
    // Park the close cleanup on its turn-record read, then reopen and retry.
    const release = rt.gateNextRead((path) => path.includes("turns/") || path.includes("turn"));
    rt.frontend({ type: "vn_view", chatId: "c1", open: false });
    await settle(20);
    rt.frontend({ type: "vn_view", chatId: "c1", open: true });
    rt.frontend({ type: "vn_retry_turn", chatId: "c1", messageId: "m1" });
    await settle(120);
    expect(rt.imageCalls()).toBe(2);
    release();
    await settle(120);
    const record = rt.record()!;
    expect(record.jobs.some((job) => job.status === "queued" || job.status === "generating")).toBe(true);
    expect(record.jobs.some((job) => job.status === "cancelled")).toBe(false);
    rt.gates[1]!({ imageId: "img-retry", imageUrl: "/img-retry" });
    await settle();
    expect(rt.record()!.jobs[0]!.status).toBe("generated");
  });

  test("a late cleanup never stamps a different (newer) turn's record", async () => {
    const messages: Msg[] = [{ id: "m1", content: THREE, is_user: false, name: "Aurelia" }];
    const rt = runtime(messages, { generateImages: true, gated: true });
    openView(rt); await settle();
    const release = rt.gateNextRead((path) => path.includes("turn"));
    rt.frontend({ type: "vn_view", chatId: "c1", open: false });
    await settle(20);
    // A new reply arrives and is planned for the reopened view while the old
    // cleanup is parked; its ownership is then dropped again by a new
    // generation, so nothing claims the chat when the cleanup resumes.
    rt.frontend({ type: "vn_view", chatId: "c1", open: true });
    messages.push({ id: "m2", content: "A second reply.\n\nShe finally speaks.\n\nSilence.", is_user: false, name: "Aurelia" });
    rt.fire("GENERATION_ENDED", { chatId: "c1", messageId: "m2", content: messages[1]!.content });
    await settle(120);
    expect(rt.record()!.plan.key.assistantMessageId).toBe("m2");
    rt.fire("GENERATION_STARTED", { chatId: "c1" });
    release();
    await settle(120);
    // m2's record was aborted by GENERATION_STARTED, not by the old close;
    // the old cleanup (aborted turn m1) must leave it exactly as it is.
    const stamped = rt.writes.filter(([path, value]) => path.includes("m2") && (value as StoredTurnRecord).jobs?.some((job) => job.status === "cancelled"));
    expect(stamped.length).toBe(0);
  });
});

describe("vn_refresh (review F6)", () => {
  test("a chat without an assistant message answers vn_state so the stage leaves planning", async () => {
    const rt = runtime([{ id: "u1", content: "hello", is_user: true, name: "You" }]);
    openView(rt); await settle();
    rt.sent.length = 0;
    rt.frontend({ type: "vn_refresh", chatId: "c1" }); await settle();
    expect(rt.sent.map((message) => message.type)).toContain("vn_state");
  });

  test("relearns the open view on a restarted backend so the refreshed plan can generate images", async () => {
    const rt = runtime([{ id: "m1", content: PLAIN, is_user: false, name: "Aurelia" }], { generateImages: true });
    // A restarted backend knows no open view (the registry is module-global in tests: close explicitly).
    rt.frontend({ type: "vn_view", chatId: "c1", open: false });
    rt.frontend({ type: "vn_refresh", chatId: "c1" }); await settle(120);
    expect(rt.plannerCalls()).toBe(1);
    expect(rt.imageCalls()).toBe(1);
    expect(rt.record()!.jobs.every((job) => job.status !== "cancelled")).toBe(true);
  });

  test("rejects a missing chat id without touching the host", async () => {
    const rt = runtime([{ id: "m1", content: PLAIN, is_user: false, name: "Aurelia" }]);
    rt.frontend({ type: "vn_refresh" }); await settle();
    expect(rt.sent.length).toBe(0);
    expect(rt.plannerCalls()).toBe(0);
  });
});

describe("stale stored turn on reopen (review F7)", () => {
  test("a newer plain reply is never rendered from the stale stored turn first", async () => {
    const messages: Msg[] = [{ id: "m1", content: PLAIN, is_user: false, name: "Aurelia" }];
    const rt = runtime(messages);
    openView(rt); await settle();
    rt.frontend({ type: "vn_view", chatId: "c1", open: false });
    messages.push({ id: "m2", content: "A second reply.\n\nShe finally speaks.", is_user: false, name: "Aurelia" });
    rt.fire("GENERATION_ENDED", { chatId: "c1", messageId: "m2", content: messages[1]!.content });
    await settle();
    expect(rt.plannerCalls()).toBe(1);
    rt.sent.length = 0;
    openView(rt); await settle();
    const state = rt.sent.find((message) => message.type === "vn_state") as { turn: unknown };
    expect(state.turn).toBeNull();
    expect(rt.plannerCalls()).toBe(2);
    expect(rt.record()!.plan.key.assistantMessageId).toBe("m2");
  });
});

describe("resolvedSourceText handoff", () => {
  test("fresh plans store the exact planning text and retries keep it", async () => {
    const rt = runtime([{ id: "g1", content: RAW_GREETING, is_user: false, name: "Scenario" }], { resolveText: () => RESOLVED_GREETING_S1, generateImages: true });
    openView(rt); await settle(120);
    expect(rt.record()!.resolvedSourceText).toBe(cleanResolvedText(S1_SCENE_TEXT));
    rt.frontend({ type: "vn_retry_turn", chatId: "c1", messageId: "g1" }); await settle(120);
    expect(rt.record()!.resolvedSourceText).toBe(cleanResolvedText(S1_SCENE_TEXT));
  });
});

describe("stateful macros and pure-subtree boundaries (cross-review blockers)", () => {
  test("blocker 1: ordered counters retain one evaluation context (no separate RPCs)", async () => {
    const spindle = {
      macros: {
        resolve: async (template: string) => {
          const vars = new Map<string, number>();
          return {
            text: template.replace(/\{\{counter::(\w+)\}\}/g, (_m, key) => {
              const next = (vars.get(key) ?? 0) + 1;
              vars.set(key, next);
              return String(next);
            }),
            diagnostics: []
          };
        }
      }
    } as unknown as SpindleAPI;
    const raw = "{{counter::n}} and {{counter::n}}";
    expect((await spindle.macros.resolve(raw)).text).toBe("1 and 2");
    const intake = await resolveMessageIntake(spindle, "c1", raw);
    expect(intake.text).toBe("1 and 2");
    expect(intake.stableSelection).toBe(false);
  });

  test("blocker 1 extension: stateful ordering across setvar and counter in one message", async () => {
    const spindle = {
      macros: {
        resolve: async (template: string) => {
          const vars = new Map<string, string>();
          const counters = new Map<string, number>();
          let text = template.replace(/\{\{setvar::(\w+)::([^}]+)\}\}/g, (_m, k, v) => {
            vars.set(k, v);
            return "";
          });
          text = text.replace(/\{\{counter::(\w+)\}\}/g, (_m, k) => {
            const next = (counters.get(k) ?? 0) + 1;
            counters.set(k, next);
            return String(next);
          });
          text = text.replace(/\{\{getvar::(\w+)\}\}/g, (_m, k) => vars.get(k) ?? "");
          return { text, diagnostics: [] };
        }
      }
    } as unknown as SpindleAPI;
    const raw = "{{setvar::seed::10}}{{counter::n}} seed={{getvar::seed}} {{counter::n}}";
    const intake = await resolveMessageIntake(spindle, "c1", raw);
    expect(intake.text).toBe("1 seed=10 2");
    expect(intake.stableSelection).toBe(false);
  });

  test("blocker 2: editing volatile choices changes the accepted source (raw edit classifies as changed)", async () => {
    const messages: Msg[] = [{ id: "m1", content: "{{random::Dawn::Dusk}} light fills the chamber.", is_user: false, name: "Aurelia" }];
    const r = runtime(messages, { resolveText: (t) => t.replace(/\{\{random::([^}:]+)::[^}]+\}\}/g, "$1") });
    openView(r); await settle();
    expect(r.record()?.resolvedSourceText).toContain("Dawn");
    messages[0]!.content = "{{random::Snow::Rain}} light fills the chamber.";
    r.frontend({ type: "vn_get_state", chatId: "c1", viewOpen: true }); await settle();
    expect(r.record()?.resolvedSourceText).toContain("Snow");
    expect(r.plannerCalls()).toBe(2);
    expect(identityResets(r).length).toBe(0);
  });

  test("blocker 3: selector change between volatile-only variants is not collapsed (indexed placeholders)", async () => {
    const vars = { scene: "1" };
    const raw = "{{#when::{{equal::{{getvar::scene}}::1}}}}{{random::Dawn::Sunrise}} light fills the chamber.{{/when}}{{#when::{{equal::{{getvar::scene}}::2}}}}{{random::Snow::Rain}} light fills the chamber.{{/when}}";
    const r = runtime([{ id: "m1", content: raw, is_user: false, name: "Aurelia" }], { resolveText: cbs(vars, () => 0) });
    openView(r); await settle();
    expect(r.record()?.resolvedSourceText).toContain("Dawn");
    vars.scene = "2";
    r.frontend({ type: "vn_get_state", chatId: "c1", viewOpen: true }); await settle();
    expect(r.record()?.resolvedSourceText).toContain("Snow");
    expect(r.plannerCalls()).toBe(2);
  });

  test("blocker 4: nested volatile inside pure transform does not replan on each reopen", async () => {
    let flip = 0;
    const r = runtime([{ id: "m1", content: "{{upper::{{random::Dawn::Dusk}}}} light fills the chamber.", is_user: false, name: "Aurelia" }], {
      resolveText: (t) => t.replace(/\{\{upper::\{\{random::[^}]*\}\}\}\}/g, () => (flip++ % 2 ? "DUSK" : "DAWN"))
    });
    openView(r); await settle();
    expect(r.record()?.resolvedSourceText).toMatch(/^(DAWN|DUSK) light/);
    r.frontend({ type: "vn_get_state", chatId: "c1", viewOpen: true }); await settle();
    expect(r.plannerCalls()).toBe(1);
  });

  test("volatile macro in condition/setvar remains unmasked and re-evaluates without identity reset", async () => {
    const sequence = [0.1, 0.9];
    let seqIdx = 0;
    const card = "{{#when::{{equal::{{random::1::2}}::1}}}}\nScene one.\n{{/when}}\n{{#when::{{equal::{{random::1::2}}::2}}}}\nScene two.\n{{/when}}";
    const r = runtime([{ id: "g1", content: card, is_user: false, name: "Aurelia" }], {
      resolveText: cbs({}, () => sequence[seqIdx++ % sequence.length]!)
    });
    openView(r); await settle();
    expect(r.plannerCalls()).toBe(1);
    expect(r.record()?.plan.paragraphs[0]!.text).toBe("Scene one.");
    r.writes.length = 0;
    // Reopen when the volatile condition rolls a different branch:
    openView(r); await settle();
    expect(r.plannerCalls()).toBe(2);
    expect(r.record()?.plan.paragraphs[0]!.text).toBe("Scene two.");
    // Stable selection was false, so identity state is NOT reset despite being a single-turn greeting!
    expect(identityResets(r).length).toBe(0);
  });
});
