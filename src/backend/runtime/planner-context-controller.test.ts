import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { contextBeforeReply, registerVisualNovelBackend } from "./controller.js";

const REPLY = "The lantern flickers.\n\nMira laughs softly.";

describe("planner recent chat", () => {
  test("holds the messages before the reply, never the reply or what follows it", () => {
    const messages = ["u1", "a1", "u2", "a2", "u3", "reply", "u4", "a4"].map((id) => ({ id }));
    expect(contextBeforeReply(messages, "reply", 4).map((m) => m.id)).toEqual(["u2", "a2", "u3"]);
    expect(contextBeforeReply(messages, "reply", 1)).toEqual([]);
    expect(contextBeforeReply(messages, "reply", 30).map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2", "u3"]);
    expect(contextBeforeReply(messages, "missing", 2).map((m) => m.id)).toEqual(["u4", "a4"]);
  });

  test("the planner request carries the reply once, as the target", async () => {
    const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    let frontend!: (payload: unknown, userId: string) => void;
    const data = new Map<string, unknown>([["config.json", { generateImages: false, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false }]]);
    const prompts: string[] = [];
    const message = (id: string, content: string, isUser: boolean) => ({
      id, chat_id: "ctx-chat", content, is_user: isUser, name: isUser ? "Ren" : "Mira", swipe_id: 0, swipes: [content], swipe_dates: [1],
      extra: {}, parent_message_id: null, branch_id: null, created_at: 1, index_in_chat: 1, send_date: 1
    });
    const messages = [message("u1", "I hold up the lantern.", true), message("m1", REPLY, false)];
    const spindle = {
      on: (event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]); },
      onFrontendMessage: (fn: (payload: unknown, userId: string) => void) => { frontend = fn; },
      userStorage: {
        getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
        setJson: async (path: string, value: unknown) => { data.set(path, value); }
      },
      chat: { getMessages: async () => messages },
      generate: {
        raw: async (request: { messages: Array<{ content: string }> }) => {
          prompts.push(request.messages.at(-1)!.content);
          return { content: "not json" };
        }
      },
      sendToFrontend: () => undefined,
      log: { warn() {}, error() {}, info() {} }
    } as unknown as SpindleAPI;
    registerVisualNovelBackend(spindle);
    frontend({ type: "vn_view", chatId: "ctx-chat", open: true }, "ctx-user");
    for (const handler of handlers.get("GENERATION_ENDED") ?? []) handler({ chatId: "ctx-chat", messageId: "m1", content: REPLY }, "ctx-user");
    const start = Date.now();
    while (prompts.length === 0 && Date.now() - start < 2000) await new Promise((resolve) => setTimeout(resolve, 5));
    const prompt = prompts[0] ?? "";
    expect(prompt).toContain("I hold up the lantern.");
    expect(prompt.split("Mira laughs softly.").length - 1).toBe(1);
  });
});
