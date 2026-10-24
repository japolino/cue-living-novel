import type { SpindleAPI } from "lumiverse-spindle-types";
import { parseStoryLabels, storyCheckKey, storyCheckMessages } from "../core/non-story.js";
import { lightGoogleThinking, type ResolvedPlannerConnection } from "./connections.js";
import { extractResponseContent } from "./planner.js";
import { scopedKey, serializedWrite } from "./storage.js";

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
/** After both attempts fail with errors, the connection is not asked again for a while. */
export const STORY_CHECK_BACKOFF_MS = 5 * 60_000;
const failedConnections = new Map<string, number>();

/** Forget connection failures (tests; a connection that changed). */
export function forgetStoryCheckFailures(): void {
  failedConnections.clear();
}

function cachePath(chatId: string): string {
  return `chats/${encodeURIComponent(chatId).replaceAll("%", "_")}/story-check.json`;
}

/** The cached entries, or null when storage could not be read (a missing file is an empty cache). */
async function readCache(spindle: SpindleAPI, chatId: string, userId?: string): Promise<CacheEntry[] | null> {
  try {
    const raw = await spindle.userStorage.getJson<CacheFile>(cachePath(chatId), { fallback: { version: 1, entries: [] }, ...(userId ? { userId } : {}) });
    return Array.isArray(raw?.entries) ? raw.entries.filter((entry) => typeof entry?.key === "string") : [];
  } catch {
    return null;
  }
}

async function writeCache(spindle: SpindleAPI, chatId: string, entry: CacheEntry, userId?: string): Promise<void> {
  const path = cachePath(chatId);
  try {
    await serializedWrite(scopedKey(userId, path), async () => {
      const existing = await readCache(spindle, chatId, userId);
      // A cache that could not be read is left alone rather than replaced by one entry.
      if (!existing) return;
      const entries = existing.filter((item) => item.key !== entry.key);
      entries.push(entry);
      await spindle.userStorage.setJson(path, { version: 1, entries: entries.slice(-CACHE_LIMIT) }, userId ? { userId } : undefined);
    });
  } catch {
    // A lost cache entry only costs one more check later.
  }
}

/** Labels this chat already has for some lines (no LLM call): earlier replies in the planner's recent context. */
export async function cachedStoryLabels(spindle: SpindleAPI, chatId: string, userId?: string): Promise<(lines: readonly string[]) => string | null> {
  const labels = new Map((await readCache(spindle, chatId, userId) ?? []).map((entry) => [entry.key, entry.labels]));
  return (lines) => {
    const found = lines.length ? labels.get(storyCheckKey(lines)) : null;
    return found && found.length === lines.length ? found : null;
  };
}

/**
 * Row answers, no JSON mode; the planner's light thinking keeps Gemini fast.
 * Temperature 0 unless the story reader's parameters set one; `defaultTemperature`
 * false leaves it to the provider (models that accept only their default).
 */
function checkParameters(connection: ResolvedPlannerConnection | null, overrides: Record<string, unknown>, defaultTemperature: boolean): Record<string, unknown> {
  const parameters: Record<string, unknown> = { ...overrides };
  for (const key of ["response_format", "responseMimeType", "responseSchema", "max_tokens", "maxOutputTokens"]) delete parameters[key];
  if (connection?.provider?.toLowerCase() === "google" && !parameters.thinkingConfig) {
    const thinking = lightGoogleThinking(connection.model ?? "");
    if (thinking) parameters.thinkingConfig = thinking;
  }
  return { ...(defaultTemperature ? { temperature: 0 } : {}), ...parameters, max_tokens: 4096 };
}

function responseText(response: unknown): string {
  const content = extractResponseContent(response);
  return typeof content === "string" ? content : "";
}

/**
 * Label the reply's lines (storyLines order). Some providers refuse or return
 * nothing for adult replies: one retry sends 60-character line heads (and no
 * temperature of Cue's own after an error), then the reply is shown whole. A
 * refusal is cached for the same model; errors are not cached, but a connection
 * that failed both attempts is skipped for STORY_CHECK_BACKOFF_MS.
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
  const cached = (await readCache(spindle, input.chatId, input.userId) ?? []).find((entry) => entry.key === key);
  if (cached && (cached.labels?.length === input.lines.length || (cached.labels === null && cached.model === model))) {
    return done(cached.labels, "cache", 0);
  }
  const connectionKey = `${input.userId ?? ""}\0${input.connection?.id ?? ""}\0${model}`;
  if (Date.now() - (failedConnections.get(connectionKey) ?? -Infinity) < STORY_CHECK_BACKOFF_MS) return done(null, "failed", 0);
  let calls = 0;
  let refused = 0;
  let errors = 0;
  for (const width of [160, 60]) {
    calls += 1;
    let text = "";
    try {
      text = responseText(await spindle.generate.raw({
        type: "raw",
        messages: storyCheckMessages(input.lines, width),
        ...(input.connection ? { provider: input.connection.provider, model: input.connection.model, connection_id: input.connection.id } : {}),
        parameters: checkParameters(input.connection, input.parameters ?? {}, errors === 0),
        reasoning: { source: "off" },
        ...(input.userId ? { userId: input.userId } : {}),
      } as Parameters<SpindleAPI["generate"]["raw"]>[0]));
    } catch {
      errors += 1;
      continue;
    }
    const labels = parseStoryLabels(text, input.lines.length);
    if (labels) {
      failedConnections.delete(connectionKey);
      await writeCache(spindle, input.chatId, { key, labels }, input.userId);
      return done(labels, width === 160 ? "llm" : "retry", calls);
    }
    if (!text.trim()) refused += 1;
  }
  if (refused === calls) {
    await writeCache(spindle, input.chatId, { key, labels: null, model }, input.userId);
    return done(null, "blocked", calls);
  }
  if (errors === calls) failedConnections.set(connectionKey, Date.now());
  return done(null, "failed", calls);
}
