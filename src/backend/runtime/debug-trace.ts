/**
 * Debug-only planner tracing.
 *
 * Every helper here is pure and only formats text. Emission is done by
 * `plannerDebugLogger`, which is a no-op unless `config.debugLogging` is on.
 * Messages travel over the normal `spindle.log.info` channel (host
 * `{type: "log"}` bridge message), so they land in the Lumiverse extension log
 * next to the existing `[VN]` trace lines from the controller.
 *
 * Privacy: the raw planner response and the resolved scene state are story
 * content and are logged verbatim when the toggle is on. Anything that looks
 * like an inline image payload or a credential is redacted before emission,
 * and the request side is never logged (only its size).
 */
import type { SpindleAPI } from "lumiverse-spindle-types";

/** Correlation ids that appear on every planner debug line. */
export type PlannerDebugScope = {
  chatId: string;
  messageId: string;
  swipeId: number;
  /** Source fingerprint (same value the controller logs as `fingerprint=`). */
  fingerprint?: string;
};

export type PlannerDebugLogger = {
  readonly enabled: boolean;
  /** One short line. */
  line(message: string): void;
  /** A long text (raw planner output) split into ordered, labelled chunks. */
  block(label: string, text: string): void;
};

/**
 * Maximum characters per emitted log line. The host log bridge carries one
 * string per message; long planner responses are split so a viewer that
 * truncates or rejects oversized lines still shows the whole payload in order.
 */
export const DEBUG_LOG_CHUNK_CHARS = 6000;

/** Hard cap on the total characters emitted for one block (raw response). */
export const DEBUG_LOG_BLOCK_MAX_CHARS = 120_000;

const DATA_URL = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;
const LONG_BASE64_RUN = /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{400,}={0,2}(?![A-Za-z0-9+/=])/g;
const BEARER = /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEY_ASSIGNMENT = /\b((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|secret|password|authorization)\s*["']?\s*[:=]\s*["']?)[^\s"',}]{4,}/gi;
const KNOWN_KEY_PREFIX = /\b(?:sk|rk|pk|xoxb|xoxp|ghp|gho|glpat)-[A-Za-z0-9_-]{12,}/g;

/**
 * Remove inline image payloads and anything that looks like a credential from
 * text before it is logged. Story text is left untouched.
 */
export function redactDebugText(text: string): string {
  return text
    .replace(DATA_URL, "[data-url redacted]")
    .replace(LONG_BASE64_RUN, (run) => (/[a-z]/.test(run) && /[A-Z]/.test(run) && /\d/.test(run) ? "[base64 redacted]" : run))
    .replace(BEARER, "$1 [redacted]")
    .replace(KEY_ASSIGNMENT, "$1[redacted]")
    .replace(KNOWN_KEY_PREFIX, "[key redacted]");
}

/** Split text into ordered chunks of at most `size` characters. */
export function chunkDebugText(text: string, size: number = DEBUG_LOG_CHUNK_CHARS): string[] {
  if (!text) return [""];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
  return chunks;
}

/** Stable prefix for one planner run: `[VN] planner chat=… msg=… swipe=… fp=…`. */
export function plannerDebugPrefix(scope: PlannerDebugScope): string {
  return `[VN] planner chat=${scope.chatId} msg=${scope.messageId} swipe=${scope.swipeId}${scope.fingerprint ? ` fp=${scope.fingerprint}` : ""}`;
}

/** Render an unknown value as compact, redacted, single-line JSON for a log line. */
export function debugJson(value: unknown, maxChars: number = 2000): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  text = redactDebugText(text);
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/** Quote a free-text value for a key=value log line (newlines collapsed). */
export function debugQuote(value: unknown, maxChars: number = 400): string {
  if (value === null || value === undefined) return "null";
  const text = redactDebugText(String(value)).replace(/\s*\n\s*/g, " ⏎ ");
  return JSON.stringify(text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text);
}

/** Summarize a zod error (or any error) in one line without the full stack. */
export function debugErrorSummary(error: unknown, maxChars: number = 600): string {
  if (error && typeof error === "object" && Array.isArray((error as { issues?: unknown }).issues)) {
    const issues = (error as { issues: Array<{ path?: unknown[]; message?: string }> }).issues;
    const text = issues.slice(0, 8).map((issue) => `${(issue.path ?? []).join(".") || "<root>"}: ${issue.message ?? "invalid"}`).join("; ");
    const more = issues.length > 8 ? ` (+${issues.length - 8} more)` : "";
    return debugQuote(`${text}${more}`, maxChars);
  }
  return debugQuote(error instanceof Error ? error.message : String(error), maxChars);
}

/** A logger that emits nothing. */
export const SILENT_PLANNER_DEBUG: PlannerDebugLogger = {
  enabled: false,
  line() {},
  block() {}
};

/**
 * Build the planner debug logger for one planning run. Returns the silent
 * logger unless `debugLogging` is enabled, so call sites can trace freely.
 */
export function plannerDebugLogger(
  spindle: Pick<SpindleAPI, "log">,
  config: { debugLogging: boolean },
  scope: PlannerDebugScope
): PlannerDebugLogger {
  if (!config.debugLogging) return SILENT_PLANNER_DEBUG;
  const prefix = plannerDebugPrefix(scope);
  const emit = (message: string): void => {
    try {
      spindle.log.info(message);
    } catch {
      // Logging must never break planning.
    }
  };
  return {
    enabled: true,
    line(message) {
      emit(`${prefix} ${message}`);
    },
    block(label, text) {
      let body = redactDebugText(text);
      let truncated = false;
      if (body.length > DEBUG_LOG_BLOCK_MAX_CHARS) {
        body = body.slice(0, DEBUG_LOG_BLOCK_MAX_CHARS);
        truncated = true;
      }
      const chunks = chunkDebugText(body);
      emit(`${prefix} ${label} chars=${text.length} parts=${chunks.length}${truncated ? " truncated=yes" : ""}`);
      chunks.forEach((chunk, index) => {
        emit(`${prefix} ${label} [${index + 1}/${chunks.length}]\n${chunk}`);
      });
    }
  };
}
