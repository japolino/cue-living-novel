import { describe, expect, test } from "bun:test";
import type { ChatMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { chatStatePath } from "./storage.js";
import { sendState } from "./controller.js";

function message(input: { id: string; content: string; isUser?: boolean }): ChatMessageDTO & { role: "user" | "assistant" } {
  const isUser = input.isUser ?? false;
  return {
    id: input.id,
    chat_id: "chat-bootstrap",
    index_in_chat: isUser ? 0 : 1,
    is_user: isUser,
    name: isUser ? "User" : "Mira",
    content: input.content,
    send_date: 1,
    swipe_id: 0,
    swipes: [input.content],
    swipe_dates: [1],
    extra: {},
    parent_message_id: isUser ? null : "user-1",
    branch_id: null,
    created_at: 1,
    role: isUser ? "user" : "assistant"
  };
}

type BootstrapRuntime = {
  spindle: SpindleAPI;
  data: Map<string, unknown>;
  sent: Array<Record<string, unknown>>;
  generateCalls: () => number;
  messageReads: () => number;
  warnings: string[];
};

function bootstrapRuntime(
  messages: ChatMessageDTO[],
  options: {
    initial?: ReadonlyMap<string, unknown>;
    generateRaw?: () => Promise<unknown>;
  } = {}
): BootstrapRuntime {
  const data = new Map(options.initial ?? []);
  data.set("config.json", {
    generateImages: false,
    maxImagesPerTurn: 0,
    includeCharacterContext: false,
    includePersonaContext: false,
    includeLorebookContext: false
  });
  const sent: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  let generateCalls = 0;
  let messageReads = 0;
  const spindle = {
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown }) => data.get(path) ?? readOptions.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    },
    chat: {
      getMessages: async () => {
        messageReads += 1;
        return messages;
      }
    },
    generate: {
      raw: async () => {
        generateCalls += 1;
        if (options.generateRaw) return options.generateRaw();
        throw new Error("planner unavailable");
      }
    },
    sendToFrontend: (payload: Record<string, unknown>) => { sent.push(payload); },
    log: {
      warn: (value: string) => { warnings.push(value); },
      error() {},
      info() {}
    }
  } as unknown as SpindleAPI;
  return {
    spindle,
    data,
    sent,
    warnings,
    generateCalls: () => generateCalls,
    messageReads: () => messageReads
  };
}

function deferred() {
  let reject!: (error: unknown) => void;
  const promise = new Promise<never>((_resolve, rejectPromise) => { reject = rejectPromise; });
  return { promise, reject };
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe("existing-chat bootstrap", () => {
  test("sends idle state first, then plans the latest assistant message", async () => {
    const runtime = bootstrapRuntime([
      message({ id: "user-1", content: "Open the door.", isUser: true }),
      message({ id: "assistant-1", content: "The old door opens.\n\nMira raises her lantern." })
    ]);

    await sendState(runtime.spindle, "chat-bootstrap", "user-1");

    expect(runtime.sent[0]).toMatchObject({ type: "vn_state", chatId: "chat-bootstrap", turn: null });
    expect(runtime.sent[1]).toMatchObject({ type: "vn_planning", chatId: "chat-bootstrap" });
    expect(runtime.sent[2]).toMatchObject({
      type: "vn_turn",
      turn: { messageId: "assistant-1", paragraphs: ["The old door opens.", "Mira raises her lantern."] }
    });
    expect(runtime.generateCalls()).toBe(1);
    expect((runtime.data.get(chatStatePath("chat-bootstrap")) as { activeTurnPath?: unknown }).activeTurnPath).toBeString();
  });

  test("rebuilds when activeTurnPath contains an invalid turn record", async () => {
    const initial = new Map<string, unknown>([
      [chatStatePath("chat-bootstrap"), {
        schemaVersion: 1,
        activeTurnPath: "turns/broken.json",
        latestScene: null,
        terminalContinuity: null,
        updatedAt: new Date(0).toISOString()
      }],
      ["turns/broken.json", { schemaVersion: 1, speaker: "Mira", plan: { invalid: true } }]
    ]);
    const runtime = bootstrapRuntime([message({ id: "assistant-2", content: "A recoverable scene." })], { initial });

    await sendState(runtime.spindle, "chat-bootstrap", "user-1");

    expect(runtime.sent.map(({ type }) => type)).toEqual(["vn_state", "vn_planning", "vn_turn"]);
    expect(runtime.warnings).toHaveLength(1);
    expect(runtime.warnings[0]).toContain("rebuilding it from chat");
  });

  test("leaves an empty chat idle without invoking the planner", async () => {
    const runtime = bootstrapRuntime([]);
    await sendState(runtime.spindle, "chat-bootstrap", "user-1");
    expect(runtime.sent).toHaveLength(1);
    expect(runtime.sent[0]).toMatchObject({ type: "vn_state", turn: null });
    expect(runtime.generateCalls()).toBe(0);
    expect(runtime.messageReads()).toBe(1);
  });

  test("deduplicates simultaneous bootstrap requests for one chat", async () => {
    const gate = deferred();
    const runtime = bootstrapRuntime([message({ id: "assistant-dedupe", content: "Only one plan is needed." })], {
      generateRaw: () => gate.promise
    });

    const first = sendState(runtime.spindle, "chat-bootstrap", "user-1");
    const second = sendState(runtime.spindle, "chat-bootstrap", "user-1");
    await flushUntil(() => runtime.generateCalls() > 0);
    expect(runtime.generateCalls()).toBe(1);
    gate.reject(new Error("planner unavailable"));
    await Promise.all([first, second]);

    expect(runtime.sent.filter(({ type }) => type === "vn_state")).toHaveLength(2);
    expect(runtime.sent.filter(({ type }) => type === "vn_turn")).toHaveLength(1);
  });
});
