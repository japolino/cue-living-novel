import type { BackendResponse, FrontendRequest } from "../../../protocol.js";
import { novelAiInsetLayout, type NovelAiInsetLayoutId } from "../../../shared/novelai-inset.js";
import { SPRITE_CUT_CHUNK_CHARS } from "../../../shared/sprites.js";
import { decodeBase64, pngSize } from "./cut-bridge.js";

/**
 * Inset bridge: the backend runs without a canvas, so the logged-in browser
 * composes the NovelAI V5 reference inset (`vn_novelai_inset`): it fetches
 * the reference, fits it into the layout's reference box on a white canvas
 * and draws the mask. Both PNGs come back as ordered base64 chunks
 * (`vn_novelai_inset_result`, one series per part). The result is checked
 * (PNG, canvas size) and handed back as base64, ready for the request.
 * Never logs the image data.
 */

export type NovelAiInsetComposeTarget = { layout: NovelAiInsetLayoutId; imageId: string };

export type NovelAiInsetCanvas = { image: string; mask: string };

export type NovelAiInsetOutcome =
  | { ok: true; canvas: NovelAiInsetCanvas }
  | { ok: false; error: string; timedOut?: true };

export type NovelAiInsetResultMessage = Extract<FrontendRequest, { type: "vn_novelai_inset_result" }>;

/** Default wait for a composition (a few hundred ms in practice; the browser may be busy). */
export const NOVELAI_INSET_TIMEOUT_MS = 15_000;
/** Largest decoded PNG per part. */
export const NOVELAI_INSET_MAX_BYTES = 16 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(NOVELAI_INSET_MAX_BYTES / 3) * 4;
const MAX_CHUNKS = Math.ceil(MAX_BASE64_CHARS / SPRITE_CUT_CHUNK_CHARS);
const PARTS = ["image", "mask"] as const;
type Part = (typeof PARTS)[number];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_CHUNK = /^[A-Za-z0-9+/=]*$/;

type PartBuffer = { count: number; chunks: Array<string | undefined>; received: number; chars: number };

type Pending = {
  requestId: string;
  userId: string | undefined;
  target: NovelAiInsetComposeTarget;
  parts: Record<Part, PartBuffer | null>;
  timer: ReturnType<typeof setTimeout> | null;
  /** When it was last sent or a chunk last arrived. */
  activeAt: number;
  resolve: (outcome: NovelAiInsetOutcome) => void;
  cleanup: () => void;
};

export type NovelAiInsetBridgeDeps = {
  send: (message: Extract<BackendResponse, { type: "vn_novelai_inset" }>, userId: string | undefined) => void;
  timeoutMs?: number;
};

function userKey(userId: string | undefined): string {
  return userId ?? "owner";
}

let requestCounter = 0;

export class NovelAiInsetBridge {
  private readonly pending = new Map<string, Pending>();
  private readonly timeoutMs: number;

  constructor(private readonly deps: NovelAiInsetBridgeDeps) {
    this.timeoutMs = deps.timeoutMs ?? NOVELAI_INSET_TIMEOUT_MS;
  }

  /**
   * Ask the browser for a canvas and mask. Never rejects: a timeout, an
   * error reply, an abort or an invalid result resolve `{ ok: false }`.
   */
  compose(userId: string | undefined, target: NovelAiInsetComposeTarget, options: { signal?: AbortSignal } = {}): Promise<NovelAiInsetOutcome> {
    if (options.signal?.aborted) return Promise.resolve({ ok: false, error: "Cancelled." });
    if (!novelAiInsetLayout(target.layout)) return Promise.resolve({ ok: false, error: `Unknown inset layout "${target.layout}".` });
    requestCounter += 1;
    const requestId = `inset-${Date.now().toString(36)}-${requestCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<NovelAiInsetOutcome>((resolve) => {
      const onAbort = (): void => this.settle(entry, { ok: false, error: "Cancelled." });
      const entry: Pending = {
        requestId,
        userId,
        target,
        parts: { image: null, mask: null },
        timer: null,
        activeAt: Date.now(),
        resolve,
        cleanup: () => options.signal?.removeEventListener("abort", onAbort),
      };
      this.pending.set(requestId, entry);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.arm(entry);
      this.dispatch(entry);
    });
  }

  /**
   * A (re)loaded page lost the requests sent to the page before it: send
   * the user's pending ones again under the same id, dropping the parts
   * received so far. Requests active within `minIdleMs` (a page still
   * answering) are left alone. Returns how many were sent again.
   */
  resend(userId: string | undefined, minIdleMs = 0): number {
    const key = userKey(userId);
    let count = 0;
    for (const entry of [...this.pending.values()]) {
      if (userKey(entry.userId) !== key || Date.now() - entry.activeAt < minIdleMs) continue;
      entry.parts = { image: null, mask: null };
      this.arm(entry);
      this.dispatch(entry);
      count += 1;
    }
    return count;
  }

  private dispatch(entry: Pending): void {
    try {
      this.deps.send({ type: "vn_novelai_inset", requestId: entry.requestId, layout: entry.target.layout, imageId: entry.target.imageId }, entry.userId);
    } catch (error) {
      this.settle(entry, { ok: false, error: `Could not reach the browser: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  /** Outstanding compositions (tests and diagnostics). */
  outstanding(userId: string | undefined): NovelAiInsetComposeTarget[] {
    const key = userKey(userId);
    return [...this.pending.values()].filter((entry) => userKey(entry.userId) === key).map((entry) => entry.target);
  }

  dispose(): void {
    for (const entry of [...this.pending.values()]) this.settle(entry, { ok: false, error: "Cancelled." });
  }

  /** Accept one `vn_novelai_inset_result` message; unknown ids and other users' replies are ignored. */
  accept(userId: string | undefined, message: NovelAiInsetResultMessage): "ignored" | "buffered" | "settled" {
    if (!message || typeof message.requestId !== "string") return "ignored";
    const entry = this.pending.get(message.requestId);
    if (!entry || userKey(entry.userId) !== userKey(userId)) return "ignored";
    const invalid = (error = "The inset canvas arrived in an invalid form."): "settled" => {
      this.settle(entry, { ok: false, error });
      return "settled";
    };
    if (typeof message.error === "string" && message.error.trim()) return invalid(message.error.trim().slice(0, 500));
    const part = message.part;
    if (part !== "image" && part !== "mask") return invalid();
    const count = message.chunkCount;
    const index = message.chunkIndex;
    if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) return invalid(count > MAX_CHUNKS ? "The inset canvas is too large." : undefined);
    if (!Number.isInteger(index) || index < 0 || index >= count) return invalid();
    let buffer = entry.parts[part];
    if (!buffer) {
      buffer = { count, chunks: new Array<string | undefined>(count), received: 0, chars: 0 };
      entry.parts[part] = buffer;
    } else if (buffer.count !== count) {
      return invalid();
    }
    const data = message.dataBase64;
    if (typeof data !== "string" || data.length > SPRITE_CUT_CHUNK_CHARS || !BASE64_CHUNK.test(data)) return invalid();
    const previous = buffer.chunks[index];
    if (previous === undefined) buffer.received += 1;
    buffer.chars += data.length - (previous?.length ?? 0);
    buffer.chunks[index] = data;
    if (buffer.chars > MAX_BASE64_CHARS) return invalid("The inset canvas is too large.");
    const done = PARTS.every((name) => {
      const parts = entry.parts[name];
      return parts !== null && parts.received === parts.count;
    });
    if (!done) {
      this.arm(entry);
      return "buffered";
    }
    this.settle(entry, this.assemble(entry));
    return "settled";
  }

  private assemble(entry: Pending): NovelAiInsetOutcome {
    const layout = novelAiInsetLayout(entry.target.layout)!;
    const texts: Record<Part, string> = { image: "", mask: "" };
    for (const part of PARTS) {
      const text = entry.parts[part]!.chunks.join("");
      if (!text || text.length % 4 !== 0 || !BASE64.test(text)) return { ok: false, error: "The inset canvas arrived in an invalid form." };
      let size: { width: number; height: number } | null = null;
      try {
        // The PNG header is in the first 33 bytes (44 base64 characters).
        size = pngSize(decodeBase64(text.slice(0, 44)));
      } catch {
        size = null;
      }
      if (!size) return { ok: false, error: `The inset ${part} is not a PNG image.` };
      if (size.width !== layout.canvas.width || size.height !== layout.canvas.height) {
        return { ok: false, error: `The inset ${part} is ${size.width}×${size.height}, expected ${layout.canvas.width}×${layout.canvas.height}.` };
      }
      texts[part] = text;
    }
    return { ok: true, canvas: { image: texts.image, mask: texts.mask } };
  }

  /** (Re)start the inactivity timer: any chunk counts as progress. */
  private arm(entry: Pending): void {
    entry.activeAt = Date.now();
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (this.pending.get(entry.requestId) !== entry) return;
      this.settle(entry, { ok: false, error: "The browser did not compose the inset in time.", timedOut: true });
    }, this.timeoutMs);
    (entry.timer as { unref?: () => void }).unref?.();
  }

  private settle(entry: Pending, outcome: NovelAiInsetOutcome): void {
    if (this.pending.get(entry.requestId) !== entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(entry.requestId);
    entry.parts = { image: null, mask: null };
    entry.cleanup();
    entry.resolve(outcome);
  }
}
