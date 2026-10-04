import type { BackendResponse, FrontendRequest } from "../../../protocol.js";
import { SPRITE_CUT_CHUNK_CHARS, SPRITE_CUT_MAX_BYTES, type SpriteCutMeta } from "../../../shared/sprites.js";

/**
 * Cut bridge: the backend cannot read image bytes, so a generated sprite is
 * cut out by the logged-in frontend (`vn_sprite_cut`) and comes back as
 * ordered base64 PNG chunks (`vn_sprite_cut_result`). This module owns the
 * request bookkeeping and the reassembly; it never uploads or touches the
 * library (the service does, in `onSettled`).
 */

export type SpriteCutTarget = { setKey: string; expression: string; imageId: string };

export type SpriteCutOutcome =
  | { ok: true; png: Uint8Array; meta: SpriteCutMeta }
  | { ok: false; error: string; timedOut?: true };

export type SpriteCutResultMessage = Extract<FrontendRequest, { type: "vn_sprite_cut_result" }>;

/** Default wait for a cut (the first one may include the one-time model download). */
export const SPRITE_CUT_TIMEOUT_MS = 5 * 60 * 1000;
/** Largest base64 payload a valid cut can have. */
export const SPRITE_CUT_MAX_BASE64_CHARS = Math.ceil(SPRITE_CUT_MAX_BYTES / 3) * 4;
/** Most chunks a valid cut can need. */
export const SPRITE_CUT_MAX_CHUNKS = Math.ceil(SPRITE_CUT_MAX_BASE64_CHARS / SPRITE_CUT_CHUNK_CHARS);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_CHUNK = /^[A-Za-z0-9+/=]*$/;

/** Width and height from a PNG header, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 33) return null;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) if (bytes[index] !== PNG_SIGNATURE[index]) return null;
  // First chunk must be IHDR (length 13).
  const type = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (type !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width > 16384 || height > 16384) return null;
  return { width, height };
}

export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Sanitize the frontend's meta against the decoded PNG. Returns null when the bbox is unusable. */
export function normalizeCutMeta(meta: unknown, size: { width: number; height: number }): SpriteCutMeta | null {
  const record = meta && typeof meta === "object" ? meta as Partial<Record<keyof SpriteCutMeta, unknown>> : {};
  let bbox: [number, number, number, number] = [0, 0, 1, 1];
  if (record.bbox !== undefined) {
    if (!Array.isArray(record.bbox) || record.bbox.length !== 4 || !record.bbox.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
    const [x, y, w, h] = (record.bbox as number[]).map(clamp01) as [number, number, number, number];
    if (w <= 0 || h <= 0) return null;
    bbox = [x, y, Math.min(w, 1 - x), Math.min(h, 1 - y)];
  }
  const duration = typeof record.durationMs === "number" && Number.isFinite(record.durationMs) && record.durationMs >= 0 ? record.durationMs : 0;
  return {
    width: size.width,
    height: size.height,
    bbox,
    quality: record.quality === "best" ? "best" : "basic",
    ...(typeof record.twoFigures === "boolean" ? { twoFigures: record.twoFigures } : {}),
    durationMs: Math.round(duration),
  };
}

type PendingCut = {
  requestId: string;
  userId: string | undefined;
  target: SpriteCutTarget;
  sentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  chunkCount: number;
  chunks: Array<string | undefined>;
  received: number;
  chars: number;
  meta: unknown;
};

export type SpriteCutBridgeDeps = {
  send: (message: Extract<BackendResponse, { type: "vn_sprite_cut" }>, userId: string | undefined) => void;
  onSettled: (userId: string | undefined, target: SpriteCutTarget, outcome: SpriteCutOutcome, requestId: string) => void;
  timeoutMs?: number;
  now?: () => number;
};

function userKey(userId: string | undefined): string {
  return userId ?? "owner";
}

let requestCounter = 0;

export class SpriteCutBridge {
  private readonly pending = new Map<string, PendingCut>();
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: SpriteCutBridgeDeps) {
    this.timeoutMs = deps.timeoutMs ?? SPRITE_CUT_TIMEOUT_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Ask the frontend for a cut. Returns the request id. */
  request(userId: string | undefined, target: SpriteCutTarget): string {
    requestCounter += 1;
    const requestId = `cut-${Date.now().toString(36)}-${requestCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: PendingCut = {
      requestId, userId, target, sentAt: this.now(), timer: null, chunkCount: 0, chunks: [], received: 0, chars: 0, meta: undefined,
    };
    this.pending.set(requestId, entry);
    this.dispatch(entry);
    return requestId;
  }

  /** Outstanding cut requests of a user. */
  outstanding(userId: string | undefined): SpriteCutTarget[] {
    const key = userKey(userId);
    return [...this.pending.values()].filter((entry) => userKey(entry.userId) === key).map((entry) => entry.target);
  }

  isOutstanding(userId: string | undefined, setKey: string, expression: string): boolean {
    const key = userKey(userId);
    for (const entry of this.pending.values()) {
      if (userKey(entry.userId) === key && entry.target.setKey === setKey && entry.target.expression === expression) return true;
    }
    return false;
  }

  /**
   * Re-send outstanding requests older than `minAgeMs` with the same request
   * id (a reloaded frontend lost them; a frontend still working on one
   * ignores the duplicate). Partial chunk buffers restart. Returns the count.
   */
  resend(userId: string | undefined, minAgeMs = 0): number {
    const key = userKey(userId);
    let count = 0;
    for (const entry of this.pending.values()) {
      if (userKey(entry.userId) !== key || this.now() - entry.sentAt < minAgeMs) continue;
      entry.chunkCount = 0;
      entry.chunks = [];
      entry.received = 0;
      entry.chars = 0;
      entry.meta = undefined;
      entry.sentAt = this.now();
      this.dispatch(entry);
      count += 1;
    }
    return count;
  }

  /** Drop matching outstanding requests without settling them (their late results are ignored). */
  cancel(userId: string | undefined, match: (target: SpriteCutTarget) => boolean = () => true): number {
    const key = userKey(userId);
    let count = 0;
    for (const [requestId, entry] of [...this.pending.entries()]) {
      if (userKey(entry.userId) !== key || !match(entry.target)) continue;
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(requestId);
      count += 1;
    }
    return count;
  }

  dispose(): void {
    for (const entry of this.pending.values()) if (entry.timer) clearTimeout(entry.timer);
    this.pending.clear();
  }

  /**
   * Accept one `vn_sprite_cut_result` message. Unknown or stale request ids
   * (and replies from another user) are ignored. Returns what happened.
   */
  accept(userId: string | undefined, message: SpriteCutResultMessage): "ignored" | "buffered" | "settled" {
    if (!message || typeof message.requestId !== "string") return "ignored";
    const entry = this.pending.get(message.requestId);
    if (!entry || userKey(entry.userId) !== userKey(userId)) return "ignored";
    if (typeof message.error === "string" && message.error.trim()) {
      this.settle(entry, { ok: false, error: message.error.trim().slice(0, 500) });
      return "settled";
    }
    const count = message.chunkCount;
    const index = message.chunkIndex;
    if (!Number.isInteger(count) || count < 1 || count > SPRITE_CUT_MAX_CHUNKS) {
      this.settle(entry, { ok: false, error: count > SPRITE_CUT_MAX_CHUNKS ? "The cut-out is too large." : "The cut-out arrived in an invalid form." });
      return "settled";
    }
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      this.settle(entry, { ok: false, error: "The cut-out arrived in an invalid form." });
      return "settled";
    }
    if (entry.chunkCount === 0) {
      entry.chunkCount = count;
      entry.chunks = new Array<string | undefined>(count);
    } else if (entry.chunkCount !== count) {
      this.settle(entry, { ok: false, error: "The cut-out arrived in an invalid form." });
      return "settled";
    }
    const data = message.dataBase64;
    if (typeof data !== "string" || data.length > SPRITE_CUT_CHUNK_CHARS || !BASE64_CHUNK.test(data)) {
      this.settle(entry, { ok: false, error: typeof data === "string" && data.length > SPRITE_CUT_CHUNK_CHARS ? "The cut-out is too large." : "The cut-out arrived in an invalid form." });
      return "settled";
    }
    const previous = entry.chunks[index];
    if (previous === undefined) entry.received += 1;
    entry.chars += data.length - (previous?.length ?? 0);
    entry.chunks[index] = data;
    if (index === 0 && message.meta !== undefined) entry.meta = message.meta;
    if (entry.chars > SPRITE_CUT_MAX_BASE64_CHARS) {
      this.settle(entry, { ok: false, error: "The cut-out is too large." });
      return "settled";
    }
    if (entry.received < entry.chunkCount) {
      this.arm(entry);
      return "buffered";
    }
    this.settle(entry, this.assemble(entry));
    return "settled";
  }

  private assemble(entry: PendingCut): SpriteCutOutcome {
    const text = entry.chunks.join("");
    if (!text || text.length % 4 !== 0 || !BASE64.test(text)) return { ok: false, error: "The cut-out arrived in an invalid form." };
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(text);
    } catch {
      return { ok: false, error: "The cut-out arrived in an invalid form." };
    }
    if (bytes.length > SPRITE_CUT_MAX_BYTES) return { ok: false, error: "The cut-out is too large." };
    const size = pngSize(bytes);
    if (!size) return { ok: false, error: "The cut-out is not a PNG image." };
    const meta = normalizeCutMeta(entry.meta, size);
    if (!meta) return { ok: false, error: "The cut-out has an invalid bounding box." };
    return { ok: true, png: bytes, meta };
  }

  private dispatch(entry: PendingCut): void {
    this.arm(entry);
    try {
      this.deps.send({
        type: "vn_sprite_cut",
        requestId: entry.requestId,
        imageId: entry.target.imageId,
        setKey: entry.target.setKey,
        expression: entry.target.expression,
      }, entry.userId);
    } catch (error) {
      this.settle(entry, { ok: false, error: `Could not reach the browser: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  /** (Re)start the inactivity timer: any chunk counts as progress. */
  private arm(entry: PendingCut): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (this.pending.get(entry.requestId) !== entry) return;
      this.settle(entry, { ok: false, error: "The browser did not return the cut-out in time.", timedOut: true });
    }, this.timeoutMs);
    (entry.timer as { unref?: () => void }).unref?.();
  }

  private settle(entry: PendingCut, outcome: SpriteCutOutcome): void {
    if (this.pending.get(entry.requestId) !== entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(entry.requestId);
    entry.chunks = [];
    this.deps.onSettled(entry.userId, entry.target, outcome, entry.requestId);
  }
}
