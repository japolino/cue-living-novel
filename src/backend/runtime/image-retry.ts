/**
 * One silent retry for a scene picture that failed for a passing reason.
 *
 * A timeout, a dropped connection, a busy provider (HTTP 408, 425, 429, 5xx,
 * including NovelAI's 429 concurrent-generation lock) usually works a few
 * seconds later, so the picture is asked for once more before the stage shows
 * a failure. A refusal, a bad request, missing credits or an auth error
 * (400, 401, 402, 403, 404, 422, content policy) would fail the same way and
 * costs nothing to report at once: it is never retried. A cancelled batch
 * never retries.
 */

/** Wait before the one retry (long enough for a provider's busy lock to clear). */
export const IMAGE_RETRY_DELAY_MS = 3000;

/** Lumiverse's provider errors: `NovelAI image generate failed (429): ...`. */
const PROVIDER_STATUS = /\bfailed \((\d{3})\)/;
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);
const TRANSIENT_TEXT = /\b(?:timed? ?out|timeout|etimedout|econnreset|econnrefused|econnaborted|eai_again|socket hang up|network ?error|fetch failed|failed to fetch|temporarily unavailable|service unavailable|bad gateway|gateway time-?out|overloaded|too many requests)\b/i;

function errorStatus(error: unknown): number | null {
  const raw = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = PROVIDER_STATUS.exec(message);
  return match ? Number(match[1]) : null;
}

/** Whether an image generation error is worth one more try (see the module comment). */
export function isTransientImageError(error: unknown): boolean {
  if (error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError") return false;
  const status = errorStatus(error);
  if (status !== null) return TRANSIENT_STATUSES.has(status);
  const message = error instanceof Error ? error.message : String(error ?? "");
  return TRANSIENT_TEXT.test(message);
}

function abortReason(signal: AbortSignal): Error {
  const error = new Error(typeof signal.reason === "string" ? signal.reason : "Image generation cancelled.");
  error.name = "AbortError";
  return error;
}

/** Resolves after `ms`, or rejects with an AbortError as soon as any signal aborts. */
export function abortableDelay(ms: number, signals: readonly AbortSignal[]): Promise<void> {
  const aborted = signals.find((signal) => signal.aborted);
  if (aborted) return Promise.reject(abortReason(aborted));
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (event: Event): void => {
      cleanup();
      reject(abortReason(event.target as AbortSignal));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    for (const signal of signals) signal.addEventListener("abort", onAbort, { once: true });
  });
}

export type TransientRetryOptions = {
  /** The batch's and the job's signals: either one cancels the wait and the retry. */
  signals: readonly AbortSignal[];
  delayMs?: number;
  onRetry?: (error: unknown) => void;
};

/** Run `attempt`; after a transient failure wait, then run it once more. */
export async function withOneTransientRetry<T>(attempt: () => Promise<T>, options: TransientRetryOptions): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!isTransientImageError(error) || options.signals.some((signal) => signal.aborted)) throw error;
    options.onRetry?.(error);
    await abortableDelay(options.delayMs ?? IMAGE_RETRY_DELAY_MS, options.signals);
    return attempt();
  }
}
