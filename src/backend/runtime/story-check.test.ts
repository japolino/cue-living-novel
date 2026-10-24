import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { STORY_CHECK_SYSTEM } from "../core/non-story.js";
import { checkStoryLines } from "./story-check.js";

type Request = { messages: Array<{ role: string; content: string }>; connection_id?: string; parameters: Record<string, unknown>; reasoning?: unknown };

function harness(answer: (request: Request, call: number) => unknown) {
  const requests: Request[] = [];
  const store = new Map<string, unknown>();
  const spindle = {
    generate: { raw: async (request: Request) => { requests.push(request); return answer(request, requests.length); } },
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown }) => structuredClone(store.get(path) ?? options.fallback),
      setJson: async (path: string, value: unknown) => { store.set(path, structuredClone(value)); },
    },
  } as unknown as SpindleAPI;
  return { spindle, requests, store };
}

const lines = ["Mira ran. " + "a".repeat(100), "Active Pressures:", "The door held."];
const google = { id: "llm-a", provider: "google", model: "gemini-3-flash" };

describe("story check", () => {
  test("labels lines through the planner connection and caches the answer for the same lines", async () => {
    const h = harness(() => ({ content: "0 K\n1 S\n2 K" }));
    const first = await checkStoryLines(h.spindle, { lines, chatId: "chat/1", connection: google, parameters: { response_format: { type: "json_object" }, max_tokens: 16000, top_p: 0.9 } });
    expect(first).toMatchObject({ labels: "KSK", source: "llm", calls: 1 });
    const request = h.requests[0]!;
    expect(request.messages[0]!.content).toBe(STORY_CHECK_SYSTEM);
    expect(request.messages[1]!.content).toContain("a".repeat(100));
    expect(request.connection_id).toBe("llm-a");
    expect(request.parameters).toEqual({ top_p: 0.9, thinkingConfig: { thinkingLevel: "minimal" }, max_tokens: 4096, temperature: 0 });
    expect(request.reasoning).toEqual({ source: "off" });
    expect([...h.store.keys()]).toEqual(["chats/chat_2F1/story-check.json"]);

    const again = await checkStoryLines(h.spindle, { lines, chatId: "chat/1", connection: google });
    expect(again).toMatchObject({ labels: "KSK", source: "cache", calls: 0 });
    expect(h.requests).toHaveLength(1);
    // Other lines (an edited reply) are a new check.
    await checkStoryLines(h.spindle, { lines: [...lines, "More."], chatId: "chat/1", connection: google });
    expect(h.requests).toHaveLength(2);
  });

  test("a refusal is retried once with 60-character line heads", async () => {
    const h = harness((_request, call) => call === 1 ? { content: "" } : { content: "0 K\n1 S\n2 K" });
    expect(await checkStoryLines(h.spindle, { lines, chatId: "c", connection: google })).toMatchObject({ labels: "KSK", source: "retry", calls: 2 });
    expect(h.requests[1]!.messages[1]!.content).toContain(`0: Mira ran. ${"a".repeat(50)}\n`);
    expect(h.requests[1]!.messages[1]!.content).not.toContain("a".repeat(51));
  });

  test("two refusals show the whole reply and are not asked again with the same model", async () => {
    const h = harness(() => ({ content: "" }));
    expect(await checkStoryLines(h.spindle, { lines, chatId: "c", connection: google })).toMatchObject({ labels: null, source: "blocked", calls: 2 });
    expect(await checkStoryLines(h.spindle, { lines, chatId: "c", connection: google })).toMatchObject({ labels: null, source: "cache", calls: 0 });
    expect(await checkStoryLines(h.spindle, { lines, chatId: "c", connection: { ...google, model: "other-model" } })).toMatchObject({ source: "blocked", calls: 2 });
  });

  test("errors and answers without rows fall back to every line and are not cached", async () => {
    const failing = harness(() => { throw new Error("Connection refused"); });
    expect(await checkStoryLines(failing.spindle, { lines, chatId: "c", connection: null })).toMatchObject({ labels: null, source: "failed", calls: 2 });
    expect(failing.store.size).toBe(0);
    const prose = harness(() => ({ content: "I cannot label this reply." }));
    expect(await checkStoryLines(prose.spindle, { lines, chatId: "c", connection: null })).toMatchObject({ labels: null, source: "failed", calls: 2 });
    expect(prose.store.size).toBe(0);
  });

  test("storage failures never break the check", async () => {
    const h = harness(() => ({ choices: [{ message: { content: "0 S\n1 S\n2 K" } }] }));
    (h.spindle as unknown as { userStorage: unknown }).userStorage = { getJson: async () => { throw new Error("down"); }, setJson: async () => { throw new Error("down"); } };
    expect(await checkStoryLines(h.spindle, { lines, chatId: "c", connection: null })).toMatchObject({ labels: "SSK", source: "llm" });
  });
});
