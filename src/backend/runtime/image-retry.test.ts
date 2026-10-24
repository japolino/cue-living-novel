import { describe, expect, test } from "bun:test";
import { abortableDelay, isTransientImageError, withOneTransientRetry } from "./image-retry";

describe("isTransientImageError", () => {
  test("busy, timed-out and dropped requests are transient", () => {
    for (const message of [
      "NovelAI image generate failed (429): Concurrent generation is locked",
      "ComfyUI image generate failed (502): Bad Gateway",
      "failed (503): Service Unavailable",
      "Request timed out after 120000 ms",
      "fetch failed",
      "read ECONNRESET",
      "socket hang up",
    ]) {
      expect(isTransientImageError(new Error(message))).toBe(true);
    }
    expect(isTransientImageError(Object.assign(new Error("Gateway"), { status: 504 }))).toBe(true);
  });

  test("refusals, bad requests, credits and auth errors are not retried", () => {
    for (const message of [
      "NovelAI image generate failed (402): Not enough Anlas",
      "failed (400): invalid parameters",
      "failed (401): Unauthorized",
      "failed (403): content policy violation",
      "failed (422): Unprocessable Entity",
      "The image provider completed without a persisted image ID.",
      "Your prompt was flagged by the safety system",
    ]) {
      expect(isTransientImageError(new Error(message))).toBe(false);
    }
    // A status wins over words in the message.
    expect(isTransientImageError(new Error("failed (400): request timed out in validation"))).toBe(false);
  });

  test("a cancellation is never transient", () => {
    const aborted = Object.assign(new Error("timed out"), { name: "AbortError" });
    expect(isTransientImageError(aborted)).toBe(false);
  });
});

describe("withOneTransientRetry", () => {
  test("a transient failure is asked for once more and the second result is used", async () => {
    let calls = 0;
    const retried: unknown[] = [];
    const result = await withOneTransientRetry(async () => {
      calls += 1;
      if (calls === 1) throw new Error("failed (503): busy");
      return "image";
    }, { signals: [], delayMs: 1, onRetry: (error) => retried.push(error) });
    expect(result).toBe("image");
    expect(calls).toBe(2);
    expect(retried).toHaveLength(1);
  });

  test("only one retry: a second transient failure is reported", async () => {
    let calls = 0;
    await expect(withOneTransientRetry(async () => {
      calls += 1;
      throw new Error("failed (503): still busy");
    }, { signals: [], delayMs: 1 })).rejects.toThrow("still busy");
    expect(calls).toBe(2);
  });

  test("a lasting failure is reported at once, with no retry", async () => {
    let calls = 0;
    await expect(withOneTransientRetry(async () => {
      calls += 1;
      throw new Error("failed (402): Not enough Anlas");
    }, { signals: [], delayMs: 1 })).rejects.toThrow("Anlas");
    expect(calls).toBe(1);
  });

  test("cancelling during the wait stops the retry", async () => {
    const controller = new AbortController();
    let calls = 0;
    const run = withOneTransientRetry(async () => {
      calls += 1;
      throw new Error("timed out");
    }, { signals: [controller.signal], delayMs: 5000 });
    setTimeout(() => controller.abort("view closed"), 5);
    const error = await run.catch((caught: unknown) => caught);
    expect((error as Error).name).toBe("AbortError");
    expect(calls).toBe(1);
  });

  test("an already cancelled batch never retries", async () => {
    const controller = new AbortController();
    controller.abort("gone");
    let calls = 0;
    await expect(withOneTransientRetry(async () => {
      calls += 1;
      throw new Error("timed out");
    }, { signals: [controller.signal], delayMs: 1 })).rejects.toThrow("timed out");
    expect(calls).toBe(1);
  });

  test("abortableDelay resolves after its time", async () => {
    await abortableDelay(1, [new AbortController().signal]);
  });
});
