import { describe, expect, test } from "bun:test";
import {
  DEBUG_LOG_BLOCK_MAX_CHARS,
  DEBUG_LOG_CHUNK_CHARS,
  SILENT_PLANNER_DEBUG,
  chunkDebugText,
  debugErrorSummary,
  debugJson,
  debugQuote,
  plannerDebugLogger,
  plannerDebugPrefix,
  redactDebugText
} from "./debug-trace.js";

const scope = { chatId: "chat-1", messageId: "msg-9", swipeId: 2, fingerprint: "abcdef0123456789" };

function sink() {
  const lines: string[] = [];
  const spindle = { log: { info: (message: string) => { lines.push(message); }, warn() {}, error() {} } };
  return { lines, spindle };
}

describe("redactDebugText", () => {
  test("removes inline image payloads and long base64 runs but keeps story text", () => {
    const base64 = "aB3".repeat(170);
    const text = `She smiled. data:image/png;base64,${base64} and then ${base64} the end.`;
    const redacted = redactDebugText(text);
    expect(redacted).toContain("She smiled.");
    expect(redacted).toContain("the end.");
    expect(redacted).toContain("[data-url redacted]");
    expect(redacted).toContain("[base64 redacted]");
    expect(redacted).not.toContain(base64);
  });

  test("masks credential-looking values", () => {
    const text = 'Authorization: Bearer abcdefgh12345678 api_key="sk-abcdefghijklmnop1234" token sk-0123456789abcdefghij password=hunter2secret';
    const redacted = redactDebugText(text);
    expect(redacted).not.toContain("abcdefgh12345678");
    expect(redacted).not.toContain("sk-abcdefghijklmnop1234");
    expect(redacted).not.toContain("sk-0123456789abcdefghij");
    expect(redacted).not.toContain("hunter2secret");
    expect(redacted).toContain("[redacted]");
  });

  test("leaves ordinary prose with short tokens untouched", () => {
    const text = "Kitsune species, fox ears anatomy, oversized cream knit sweater, bare underneath";
    expect(redactDebugText(text)).toBe(text);
  });

  test("does not treat a long single-case run (no digits) as base64", () => {
    const text = "r".repeat(700);
    expect(redactDebugText(text)).toBe(text);
  });
});

describe("chunkDebugText", () => {
  test("splits in order at the chunk size and keeps every character", () => {
    const text = "x".repeat(DEBUG_LOG_CHUNK_CHARS * 2 + 5);
    const chunks = chunkDebugText(text);
    expect(chunks).toHaveLength(3);
    expect(chunks.join("")).toBe(text);
    expect(chunks[2]).toHaveLength(5);
  });

  test("empty text yields one empty chunk", () => {
    expect(chunkDebugText("")).toEqual([""]);
  });
});

describe("formatting helpers", () => {
  test("prefix carries chat, message, swipe and fingerprint", () => {
    expect(plannerDebugPrefix(scope)).toBe("[VN] planner chat=chat-1 msg=msg-9 swipe=2 fp=abcdef0123456789");
    expect(plannerDebugPrefix({ chatId: "c", messageId: "m", swipeId: 0 })).toBe("[VN] planner chat=c msg=m swipe=0");
  });

  test("debugQuote collapses newlines, truncates, and redacts", () => {
    expect(debugQuote("a\n  b")).toBe(JSON.stringify("a ⏎ b"));
    expect(debugQuote(null)).toBe("null");
    expect(debugQuote("y".repeat(20), 10).length).toBeLessThanOrEqual(13);
    expect(debugQuote("Bearer abcdefgh12345678")).not.toContain("abcdefgh12345678");
  });

  test("debugJson serializes compactly and survives cyclic values", () => {
    expect(debugJson({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(typeof debugJson(cyclic)).toBe("string");
    expect(debugJson("z".repeat(50), 10).length).toBeLessThanOrEqual(10);
  });

  test("debugErrorSummary flattens zod-style issues and plain errors", () => {
    const zodLike = { issues: [{ path: ["scenes", 0, "environment"], message: "Required" }, { path: [], message: "bad" }] };
    expect(debugErrorSummary(zodLike)).toBe(JSON.stringify("scenes.0.environment: Required; <root>: bad"));
    expect(debugErrorSummary(new Error("boom"))).toBe(JSON.stringify("boom"));
    expect(debugErrorSummary("plain")).toBe(JSON.stringify("plain"));
  });
});

describe("plannerDebugLogger", () => {
  test("is silent and never touches the sink when debugLogging is off", () => {
    const { lines, spindle } = sink();
    const logger = plannerDebugLogger(spindle, { debugLogging: false }, scope);
    expect(logger).toBe(SILENT_PLANNER_DEBUG);
    expect(logger.enabled).toBe(false);
    logger.line("hello");
    logger.block("raw", "x".repeat(100));
    expect(lines).toEqual([]);
  });

  test("emits prefixed lines and ordered labelled chunks when enabled", () => {
    const { lines, spindle } = sink();
    const logger = plannerDebugLogger(spindle, { debugLogging: true }, scope);
    expect(logger.enabled).toBe(true);
    logger.line("outcome=planner");
    const text = "r".repeat(DEBUG_LOG_CHUNK_CHARS + 10);
    logger.block("raw response", text);
    expect(lines[0]).toBe("[VN] planner chat=chat-1 msg=msg-9 swipe=2 fp=abcdef0123456789 outcome=planner");
    expect(lines[1]).toBe(`[VN] planner chat=chat-1 msg=msg-9 swipe=2 fp=abcdef0123456789 raw response chars=${text.length} parts=2`);
    expect(lines[2]).toStartWith("[VN] planner chat=chat-1 msg=msg-9 swipe=2 fp=abcdef0123456789 raw response [1/2]\n");
    expect(lines[3]).toStartWith("[VN] planner chat=chat-1 msg=msg-9 swipe=2 fp=abcdef0123456789 raw response [2/2]\n");
    const body = lines.slice(2).map((line) => line.slice(line.indexOf("\n") + 1)).join("");
    expect(body).toBe(text);
  });

  test("caps one block and marks it truncated", () => {
    const { lines, spindle } = sink();
    const logger = plannerDebugLogger(spindle, { debugLogging: true }, scope);
    logger.block("raw response", "q".repeat(DEBUG_LOG_BLOCK_MAX_CHARS + 1));
    expect(lines[0]).toContain("truncated=yes");
    const body = lines.slice(1).map((line) => line.slice(line.indexOf("\n") + 1)).join("");
    expect(body).toHaveLength(DEBUG_LOG_BLOCK_MAX_CHARS);
  });

  test("redacts image payloads inside a block", () => {
    const { lines, spindle } = sink();
    const logger = plannerDebugLogger(spindle, { debugLogging: true }, scope);
    logger.block("raw response", `{"scenes":[]} data:image/jpeg;base64,${"Zy9".repeat(200)}`);
    expect(lines.join("\n")).not.toContain("Zy9".repeat(200));
    expect(lines.join("\n")).toContain("[data-url redacted]");
  });

  test("a throwing sink never breaks the caller", () => {
    const logger = plannerDebugLogger({ log: { info() { throw new Error("sink down"); }, warn() {}, error() {} } }, { debugLogging: true }, scope);
    expect(() => logger.line("x")).not.toThrow();
    expect(() => logger.block("raw", "y")).not.toThrow();
  });
});
