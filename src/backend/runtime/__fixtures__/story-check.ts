import { STORY_CHECK_SYSTEM } from "../../core/non-story.js";

/**
 * Mocks that count or capture planner requests answer Cue's non-story line
 * check ("Skip non-story blocks", on by default) here: every line is story.
 * Returns null for any other request.
 */
export function storyCheckReply(request: unknown): { content: string } | null {
  const messages = (request as { messages?: Array<{ content?: unknown }> } | null)?.messages;
  if (messages?.[0]?.content !== STORY_CHECK_SYSTEM) return null;
  const count = Number(/\((\d+) lines\)/.exec(String(messages[1]?.content ?? ""))?.[1] ?? 0);
  return { content: Array.from({ length: count }, (_, index) => `${index} K`).join("\n") };
}
