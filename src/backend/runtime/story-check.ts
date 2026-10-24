import type { SpindleAPI } from "lumiverse-spindle-types";
import { parseStoryLabels, storyCheckKey, storyCheckMessages } from "../core/non-story.js";
import { lightGoogleThinking, type ResolvedPlannerConnection } from "./connections.js";

/*
 * "Skip non-story blocks": one K/S check per reply through the planner
 * connection. Results are cached per chat by the exact lines checked, so a
 * retry, a replan or a swipe back to the same text never pays again.
 */

export type StoryCheckSource = "cache" | "llm" | "retry" | "blocked" | "failed";
export type StoryCheckResult = {
  /** One K/S per line, or null: show every line (the behaviour without the check). */
  labels: string | null;
  source: StoryCheckSource;
  calls: number;
  durationMs: number;
};

type CacheEntry = { key: string; labels: string | null; model?: string };
type CacheFile = { version: 1; entries: CacheEntry[] };
const CACHE_LIMIT = 64;

function cachePath(chatId: string): string {
  return `chats/${encodeURIComponent(chatId).replaceAll("%", "_")}/story-check.json`;
}

async function readCache(spindle: SpindleAPI, chatId: string, userId?: string): Promise<CacheEntry[]> {
  try {
    const raw = await spindle.userStorage.getJson<CacheFile>(cachePath(chatId), { fallback: { version: 1, entries: [] }, ...(userId ? { userId } : {}) });
    return Array.isArray(raw?.entries) ? raw.entries.filter((entry) => typeof entry?.key === "string") : [];
  } catch {
    return [];
  }
}

async function writeCache(spindle: SpindleAPI, chatId: string, entry: CacheEntry, userId?: string): Promise<void> {
  try {
    const entries = (await readCache(spindle, chatId, userId)).filter((item) => item.key !== entry.key);
    entries.push(entry);
    await spindle.userStorage.setJson(cachePath(chatId), { version: 1, entries: entries.slice(-CACHE_LIMIT) }, userId ? { userId } : undefined);
  } catch {
    // A lost cache entry only costs one more check later.
  }
}

/** Labels this chat already has for some lines (no LLM call): earlier replies in the planner's recent context. */
export async function cachedStoryLabels(spindle: SpindleAPI, chatId: string, userId?: string): Promise<(lines: readonly string[]) => string | null> {
  const labels = new Map((await readCache(spindle, chatId, userId)).map((entry) => [entry.key, entry.labels]));
  return (lines) => {
    const found = lines.length ? labels.get(storyCheckKey(lines)) : null;
    return found && found.length === lines.length ? found : null;
  };
}

/** Row answers, no JSON mode; the planner's light thinking keeps Gemini fast. */
function checkParameters(connection: ResolvedPlannerConnection | null, overrides: Record<string, unknown>): Record<string, unknown> {
  const parameters: Record<string, unknown> = { ...overrides };
  for (const key of ["response_format", "responseMimeType", "responseSchema", "max_tokens", "maxOutputTokens"]) delete parameters[key];
  if (connection?.provider?.toLowerCase() === "google" && !parameters.thinkingConfig) {
    const thinking = lightGoogleThinking(connection.model ?? "");
    if (thinking) parameters.thinkingConfig = thinking;
  }
  return { ...parameters, max_tokens: 4096, temperature: 0 };
}

function responseText(response: unknown): string {
  if (typeof response === "string") return response;
  const record = response && typeof response === "object" ? response as Record<string, unknown> : {};
  if (typeof record.content === "string") return record.content;
  const choice = Array.isArray(record.choices) ? record.choices[0] as Record<string, unknown> | undefined : undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  return typeof message?.content === "string" ? message.content : "";
}

/**
 * Label the reply's lines (storyLines order). Some providers refuse or return
 * nothing for adult replies: one retry sends 60-character line heads, then the
 * reply is shown whole. A refusal is cached for the same model; an error is not.
 */
export async function checkStoryLines(spindle: SpindleAPI, input: {
  lines: readonly string[];
  chatId: string;
  connection: ResolvedPlannerConnection | null;
  parameters?: Record<string, unknown>;
  userId?: string;
}): Promise<StoryCheckResult> {
  const started = Date.now();
  const done = (labels: string | null, source: StoryCheckSource, calls: number): StoryCheckResult => ({ labels, source, calls, durationMs: Date.now() - started });
  if (!input.lines.length) return done(null, "failed", 0);
  const key = storyCheckKey(input.lines);
  const model = input.connection?.model ?? "";
  const cached = (await readCache(spindle, input.chatId, input.userId)).find((entry) => entry.key === key);
  if (cached && (cached.labels?.length === input.lines.length || (cached.labels === null && cached.model === model))) {
    return done(cached.labels, "cache", 0);
  }
  let calls = 0;
  let refused = 0;
  for (const width of [160, 60]) {
    calls += 1;
    let text = "";
    try {
      text = responseText(await spindle.generate.raw({
        type: "raw",
        messages: storyCheckMessages(input.lines, width),
        ...(input.connection ? { provider: input.connection.provider, model: input.connection.model, connection_id: input.connection.id } : {}),
        parameters: checkParameters(input.connection, input.parameters ?? {}),
        reasoning: { source: "off" },
        ...(input.userId ? { userId: input.userId } : {}),
      } as Parameters<SpindleAPI["generate"]["raw"]>[0]));
    } catch {
      continue;
    }
    const labels = parseStoryLabels(text, input.lines.length);
    if (labels) {
      await writeCache(spindle, input.chatId, { key, labels }, input.userId);
      return done(labels, width === 160 ? "llm" : "retry", calls);
    }
    if (!text.trim()) refused += 1;
  }
  if (refused === calls) {
    await writeCache(spindle, input.chatId, { key, labels: null, model }, input.userId);
    return done(null, "blocked", calls);
  }
  return done(null, "failed", calls);
}
