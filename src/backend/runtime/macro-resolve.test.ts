import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend, sendState, viewRegistry } from "./controller.js";
import { fingerprintForMessage } from "./planner.js";
import { cleanResolvedText } from "./message-text.js";
import { characterRegistryPath, chatStatePath, singleCharacterStatePath, type StoredChatState, type StoredTurnRecord } from "./storage.js";
import {
  RAW_GREETING,
  RESOLVED_GREETING_S0,
  RESOLVED_GREETING_S1,
  S1_SCENE_TEXT
} from "./__fixtures__/greeting-macro.js";
import { storyCheckReply } from "./__fixtures__/story-check";

type Msg = { id: string; content: string; is_user: boolean; name: string };

function plannerPayload() {
  return {
    scenes: [{
      startParagraph: 0,
      boundary: { claimedNewScene: true, reason: "initial", location: "Sol Eterna", timeOfDay: "day", majorTimeJump: false, environmentReplacement: false, forced: false },
      environment: { location: "Sol Eterna", timeOfDay: "day", weather: null, lighting: "sunlight", description: "The Grand Audience Chamber", persistentElements: [] },
      cast: ["Aurelia"],
      basePrompt: "grand audience chamber",
      compositionLock: "Aurelia centered"
    }],
    cues: [{ paragraphIndex: 0 }],
    choices: [],
    characters: [{ name: "Aurelia", description: "platinum-blonde hair, golden eyes" }]
  };
}

function macroRuntime(messages: Msg[], options: { resolveText?: () => string | Promise<string> } = {}): {
  spindle: SpindleAPI;
  data: Map<string, unknown>;
  sent: Array<Record<string, unknown>>;
  plannerCalls: () => number;
  macroCalls: () => number;
  frontend: (payload: unknown) => void;
  fire: (event: string, payload: unknown) => void;
  setResolve: (impl: (() => string | Promise<string>) | null) => void;
} {
  const data = new Map<string, unknown>();
  data.set("config.json", {
    generateImages: false,
    maxImagesPerTurn: 4,
    includeCharacterContext: false,
    includePersonaContext: false,
    includeLorebookContext: false,
    includeRecentMessages: 4
  });
  const sent: Array<Record<string, unknown>> = [];
  let plannerCalls = 0;
  let macroCalls = 0;
  let resolveImpl: (() => string | Promise<string>) | null = options.resolveText ?? null;
  let frontendHandler: (payload: unknown, userId: string) => void = () => {};
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const spindle = {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    onFrontendMessage: (fn: (payload: unknown, userId: string) => void) => { frontendHandler = fn; },
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown }) => data.get(path) ?? readOptions.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    },
    chat: {
      getMessages: async () => messages.map((message) => ({
        ...message,
        chat_id: "chat-macro",
        index_in_chat: 1,
        send_date: 1,
        swipe_id: 0,
        swipes: [message.content],
        swipe_dates: [1],
        extra: {},
        parent_message_id: message.is_user ? null : "user-1",
        branch_id: null,
        created_at: 1,
        role: message.is_user ? "user" : "assistant"
      }))
    },
    macros: {
      resolve: async (template: string) => {
        macroCalls += 1;
        return { text: resolveImpl ? await resolveImpl() : template, diagnostics: [] };
      }
    },
    generate: {
      raw: async (request: unknown) => {
        const check = storyCheckReply(request); if (check) return check;
        plannerCalls += 1;
        return { content: JSON.stringify(plannerPayload()) };
      }
    },
    imageGen: {
      generate: async () => { throw new Error("imageGen.generate must not be called"); }
    },
    sendToFrontend: (payload: Record<string, unknown>) => { sent.push(payload); },
    log: { warn() {}, error() {}, info() {} }
  } as unknown as SpindleAPI;
  // Intake paths are gated on the open view in production (view-gating); these
  // tests exercise resolution, so the fixture opens the view like the real
  // frontend's vn_view announcement does. Closed-view skipping is covered in
  // view-gating.test.ts.
  viewRegistry().open("user-1", "chat-macro");
  return {
    spindle, data, sent,
    plannerCalls: () => plannerCalls,
    macroCalls: () => macroCalls,
    frontend: (payload: unknown) => frontendHandler(payload, "user-1"),
    fire: (event: string, payload: unknown) => { for (const handler of handlers.get(event) ?? []) handler(payload, "user-1"); },
    setResolve: (impl) => { resolveImpl = impl; }
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

function storedRecord(runtime: { data: Map<string, unknown> }): StoredTurnRecord | null {
  const state = runtime.data.get(chatStatePath("chat-macro")) as StoredChatState | undefined;
  if (!state?.activeTurnPath) return null;
  return (runtime.data.get(state.activeTurnPath) as StoredTurnRecord | undefined) ?? null;
}

const greetingMessage: Msg = { id: "greeting-1", content: RAW_GREETING, is_user: false, name: "Scenario" };

describe("macro-resolved message intake", () => {
  test("H2: plans the selected scene only; stored paragraphs never carry macro syntax", async () => {
    const runtime = macroRuntime([greetingMessage], { resolveText: () => RESOLVED_GREETING_S1 });
    await sendState(runtime.spindle, "chat-macro", "user-1");
    const record = storedRecord(runtime);
    expect(record).not.toBeNull();
    const text = record!.plan.paragraphs.map((paragraph) => paragraph.text).join("\n\n");
    expect(text).toContain("The cradle of humanity");
    expect(text).not.toContain("{{");
    expect(text).not.toContain("$messageSelector");
    expect(text).not.toContain("Please enjoy and wander freely");
    expect(record!.plan.key.sourceFingerprint).toBe(fingerprintForMessage({
      id: "greeting-1", swipe_id: 0, content: cleanResolvedText(S1_SCENE_TEXT)
    }));
  });

  test("H4: a different selection on the same raw message yields a new fingerprint and a replan", async () => {
    const runtime = macroRuntime([greetingMessage], { resolveText: () => RESOLVED_GREETING_S1 });
    await sendState(runtime.spindle, "chat-macro", "user-1");
    const first = storedRecord(runtime)!;
    expect(runtime.plannerCalls()).toBe(1);
    // The user picks another scene: same raw content, new resolution.
    const otherScene = "A different opening.\n\nThe northern front is quiet tonight, and the watchtower bell hangs silent over the frozen ramparts.";
    runtime.setResolve(() => otherScene);
    await sendState(runtime.spindle, "chat-macro", "user-1");
    const second = storedRecord(runtime)!;
    expect(second.plan.key.sourceFingerprint).not.toBe(first.plan.key.sourceFingerprint);
    expect(runtime.plannerCalls()).toBe(2);
    expect(second.plan.paragraphs[0]!.text).toContain("A different opening.");
  });

  test("H7: an unchanged resolution is reused from storage without replanning", async () => {
    const runtime = macroRuntime([greetingMessage], { resolveText: () => RESOLVED_GREETING_S1 });
    await sendState(runtime.spindle, "chat-macro", "user-1");
    expect(runtime.plannerCalls()).toBe(1);
    runtime.sent.length = 0;
    await sendState(runtime.spindle, "chat-macro", "user-1");
    expect(runtime.plannerCalls()).toBe(1);
    // The unchanged stored turn rides inside vn_state itself; no extra churn.
    const state = runtime.sent.find((message) => message.type === "vn_state") as { turn: { sourceFingerprint: string } | null };
    expect(state.turn).not.toBeNull();
    expect(runtime.sent.some((message) => message.type === "vn_planning")).toBe(false);
  });

  test("unselected greeting: no plan, no images, a truthful vn_waiting instead", async () => {
    const runtime = macroRuntime([greetingMessage], { resolveText: () => RESOLVED_GREETING_S0 });
    await sendState(runtime.spindle, "chat-macro", "user-1");
    expect(runtime.plannerCalls()).toBe(0);
    expect(storedRecord(runtime)).toBeNull();
    expect(runtime.sent.some((message) => message.type === "vn_turn")).toBe(false);
    const waiting = runtime.sent.find((message) => message.type === "vn_waiting");
    expect(waiting).toMatchObject({ chatId: "chat-macro", messageId: "greeting-1", reason: "greeting_unselected" });
  });

  test("host without interceptor: blocks survive resolve, cleaner empties them, waiting state", async () => {
    const runtime = macroRuntime([greetingMessage]);
    await sendState(runtime.spindle, "chat-macro", "user-1");
    expect(runtime.macroCalls()).toBeGreaterThanOrEqual(1);
    expect(runtime.plannerCalls()).toBe(0);
    expect(runtime.sent.some((message) => message.type === "vn_waiting")).toBe(true);
  });

  test("H1 regression: an ordinary message never calls macros.resolve", async () => {
    const runtime = macroRuntime([
      { id: "assistant-plain", content: "Aurelia lowers the report.\n\nShe studies the visitor.", is_user: false, name: "Aurelia" }
    ]);
    await sendState(runtime.spindle, "chat-macro", "user-1");
    expect(runtime.macroCalls()).toBe(0);
    expect(runtime.plannerCalls()).toBe(1);
    const record = storedRecord(runtime)!;
    expect(record.plan.paragraphs[0]!.text).toBe("Aurelia lowers the report.");
  });

  test("H5: a throwing macros.resolve still plans on the cleaned raw text", async () => {
    const runtime = macroRuntime([
      { id: "assistant-throw", content: "{{getvar::x}}Aurelia waves.\n\nThe hall falls silent as the court turns toward the gate.", is_user: false, name: "Aurelia" }
    ], { resolveText: () => { throw new Error("host down"); } });
    await sendState(runtime.spindle, "chat-macro", "user-1");
    expect(runtime.plannerCalls()).toBe(1);
    const record = storedRecord(runtime)!;
    expect(record.plan.paragraphs[0]!.text).toBe("Aurelia waves.");
  });

  test("H6: history macros resolve once per message per planning run", async () => {
    const runtime = macroRuntime([
      { id: "old-greeting", content: "Hello {{user}}, says {{getvar::speaker}}.", is_user: false, name: "Scenario" },
      { id: "user-turn", content: "I bow.", is_user: true, name: "User" },
      { id: "assistant-latest", content: "Aurelia nods once.\n\nThe audience continues in the great hall.", is_user: false, name: "Aurelia" }
    ]);
    await sendState(runtime.spindle, "chat-macro", "user-1");
    // Only the one macro-bearing history message reaches the host, once.
    expect(runtime.macroCalls()).toBe(1);
    expect(runtime.plannerCalls()).toBe(1);
  });

  test("vn_refresh re-checks the latest message and replans a changed selection", async () => {
    const runtime = macroRuntime([greetingMessage], { resolveText: () => RESOLVED_GREETING_S0 });
    registerVisualNovelBackend(runtime.spindle);
    await sendState(runtime.spindle, "chat-macro", "user-1");
    expect(runtime.sent.some((message) => message.type === "vn_waiting")).toBe(true);
    // The user picks s1 in the chat, then presses Try again (vn_refresh).
    runtime.setResolve(() => RESOLVED_GREETING_S1);
    runtime.frontend({ type: "vn_refresh", chatId: "chat-macro" });
    const start = Date.now();
    while (!runtime.sent.some((message) => message.type === "vn_turn")) {
      if (Date.now() - start > 2000) throw new Error("vn_refresh never produced a turn");
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    const record = storedRecord(runtime)!;
    expect(record.plan.paragraphs.map((paragraph) => paragraph.text).join(" ")).toContain("The cradle of humanity");
  });
});

describe("audit regressions", () => {
  test("audit F1: switching the selected scene resets the chat's identity to the new cast", async () => {
    // Planner output follows the currently resolved scene's character.
    let character = "Aurelia";
    let tags = "blonde hair, golden eyes";
    const otherScene = "Celeste alley scene.\n\nShe lurks in the shadows near the gate.";
    const runtime = macroRuntime([greetingMessage], { resolveText: () => RESOLVED_GREETING_S1 });
    (runtime.spindle as unknown as { generate: { raw: (request: unknown) => Promise<unknown> } }).generate.raw = async (request: unknown) => {
      const check = storyCheckReply(request); if (check) return check;
      const payload = plannerPayload();
      payload.scenes[0]!.cast = [character];
      payload.cues = [{ paragraphIndex: 0, character } as never];
      payload.characters = [{ name: character, description: tags }];
      return { content: JSON.stringify(payload) };
    };
    await sendState(runtime.spindle, "chat-macro", "user-1");
    const first = runtime.data.get(singleCharacterStatePath("chat-macro")) as { protagonist: { name: string } };
    expect(first.protagonist.name).toBe("Aurelia");
    // The user picks the other scene: same raw message, different cast.
    runtime.setResolve(() => otherScene);
    character = "Celeste";
    tags = "raven hair, dark cloak";
    await sendState(runtime.spindle, "chat-macro", "user-1");
    const second = runtime.data.get(singleCharacterStatePath("chat-macro")) as { protagonist: { name: string } };
    expect(second.protagonist.name).toBe("Celeste");
    const record = storedRecord(runtime)!;
    expect(record.plan.terminalVisualState?.character).toBe("Celeste");
    expect(runtime.data.get(characterRegistryPath("chat-macro")) ?? {}).not.toHaveProperty("aurelia");
  });

  test("audit F1 guard: a mid-chat turn never resets durable identity state", async () => {
    const runtime = macroRuntime([
      { id: "greeting-1", content: "Aurelia opens the hall.\n\nThe court assembles below the dais.", is_user: false, name: "Aurelia" },
      { id: "user-1b", content: "I bow.", is_user: true, name: "User" },
      { id: "assistant-2", content: "Hello {{user}}.\n\nAurelia beckons the visitor closer to the throne.", is_user: false, name: "Aurelia" }
    ]);
    await sendState(runtime.spindle, "chat-macro", "user-1");
    const seeded = runtime.data.get(singleCharacterStatePath("chat-macro")) as { protagonist: unknown };
    expect(seeded).toBeDefined();
    // Re-resolve the latest mid-chat message to different text (edited macro):
    runtime.setResolve(() => "Aurelia laughs aloud.\n\nThe hall echoes with the sound of her amusement.");
    await sendState(runtime.spindle, "chat-macro", "user-1");
    // Durable identity state survives: mid-chat replans never reset it.
    const after = runtime.data.get(singleCharacterStatePath("chat-macro")) as { protagonist: unknown };
    expect(after.protagonist).toEqual(seeded.protagonist);
  });

  test("audit F6: a changed selection is never rendered from the stale stored turn", async () => {
    const runtime = macroRuntime([greetingMessage], { resolveText: () => RESOLVED_GREETING_S1 });
    await sendState(runtime.spindle, "chat-macro", "user-1");
    runtime.sent.length = 0;
    const otherScene = "A different opening.\n\nThe northern watchtower bell hangs silent over the frozen ramparts.";
    runtime.setResolve(() => otherScene);
    await sendState(runtime.spindle, "chat-macro", "user-1");
    const types = runtime.sent.map((message) => message.type);
    // vn_state must not carry the stale turn; planning is signalled instead.
    const state = runtime.sent.find((message) => message.type === "vn_state") as { turn: unknown };
    expect(state.turn).toBeNull();
    expect(types.indexOf("vn_planning")).toBeGreaterThan(types.indexOf("vn_state"));
    const turns = runtime.sent.filter((message) => message.type === "vn_turn") as Array<{ turn: { paragraphs: string[] } }>;
    expect(turns.length).toBe(1);
    expect(turns[0]!.turn.paragraphs[0]).toBe("A different opening.");
    expect(turns[0]!.turn.paragraphs.join(" ")).not.toContain("The cradle of humanity");
  });

  test("audit F8: Try again (vn_retry_turn) picks up a changed scene selection", async () => {
    const runtime = macroRuntime([greetingMessage], { resolveText: () => RESOLVED_GREETING_S1 });
    registerVisualNovelBackend(runtime.spindle);
    await sendState(runtime.spindle, "chat-macro", "user-1");
    expect(runtime.plannerCalls()).toBe(1);
    const otherScene = "A different opening.\n\nThe northern watchtower bell hangs silent over the frozen ramparts.";
    runtime.setResolve(() => otherScene);
    runtime.sent.length = 0;
    runtime.frontend({ type: "vn_retry_turn", chatId: "chat-macro", messageId: "greeting-1" });
    await waitFor(() => runtime.sent.some((message) => message.type === "vn_turn"));
    expect(runtime.plannerCalls()).toBe(2);
    const record = storedRecord(runtime)!;
    expect(record.plan.paragraphs[0]!.text).toBe("A different opening.");
  });

  test("audit: an intake superseded during a slow macro resolve never plans", async () => {
    let releaseResolve!: (value: string) => void;
    const gate = new Promise<string>((resolve) => { releaseResolve = resolve; });
    const runtime = macroRuntime([greetingMessage], { resolveText: () => gate });
    registerVisualNovelBackend(runtime.spindle);
    // GENERATION_ENDED intake starts and parks on the deferred macro resolve.
    runtime.fire("GENERATION_ENDED", { chatId: "chat-macro", messageId: "greeting-1", content: RAW_GREETING });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(runtime.plannerCalls()).toBe(0);
    // A new generation starts (user submitted) while the resolve is in flight.
    runtime.fire("GENERATION_STARTED", { chatId: "chat-macro" });
    // The stale resolve finishes afterwards with a full scene.
    releaseResolve(RESOLVED_GREETING_S1);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    // The superseded intake never planned, stored, or delivered a turn.
    expect(runtime.plannerCalls()).toBe(0);
    expect(runtime.sent.some((message) => message.type === "vn_turn")).toBe(false);
    expect(storedRecord(runtime)).toBeNull();
  });
});
