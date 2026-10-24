/**
 * Per-device bookkeeping for the Studio cut-out model (a 500 MB BiRefNet
 * export that takes about 3 GB of graphics memory, see docs/SPRITE_MODE.md):
 *
 * - a crash marker in localStorage, set before the model loads and cleared
 *   after its first good cut, so a tab or worker that dies loading or running
 *   it is not tried again on every reload (settings offer a manual retry);
 * - which Studio files this browser caches, so a new Studio URL replaces the
 *   old 500 MB file instead of adding to it;
 * - a device check before any download (memory, phones);
 * - one Studio session per device across Cue tabs (Web Locks).
 *
 * Everything degrades to "allowed" / "nothing remembered" where the browser
 * lacks the API (localStorage blocked, no navigator.locks).
 */

const ATTEMPT_KEY = "cue-sprite-cutout-studio-attempt";
const FILES_KEY = "cue-sprite-cutout-studio-files";
const LOCK_NAME = "cue-sprite-cutout-studio";
/**
 * Smallest `navigator.deviceMemory` (GB; Chromium reports at most 8) that may
 * try the Studio model. A judgement, not a measured limit: with the model
 * running, graphics memory grew by 3.1 GB and the machine's free RAM fell by
 * 2.3 GB (docs/SPRITE_MODE.md), and integrated graphics take theirs from RAM.
 */
export const STUDIO_MIN_DEVICE_MEMORY_GB = 8;

type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

function storage(): StorageLike | null {
  try {
    const store = (globalThis as { localStorage?: StorageLike }).localStorage;
    return store && typeof store.getItem === "function" ? store : null;
  } catch {
    return null;
  }
}

export type StudioAttempt = { url: string; at: number; reason?: string };

/**
 * The Studio model this device started and never finished a cut with, or
 * null. `reason`: why it failed, when the page lived to say so (no reason:
 * the tab died, or was closed before `clearStudioAttempt`).
 */
export function readStudioAttempt(): StudioAttempt | null {
  try {
    const raw = storage()?.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { url?: unknown; at?: unknown; reason?: unknown };
    if (typeof value.url !== "string" || !value.url) return null;
    return { url: value.url, at: typeof value.at === "number" ? value.at : 0, ...(typeof value.reason === "string" && value.reason ? { reason: value.reason } : {}) };
  } catch {
    return null;
  }
}

export function writeStudioAttempt(url: string, reason?: string): void {
  try { storage()?.setItem(ATTEMPT_KEY, JSON.stringify({ url, at: Date.now(), ...(reason ? { reason } : {}) })); } catch { /* not remembered */ }
}

export function clearStudioAttempt(): void {
  try { storage()?.removeItem(ATTEMPT_KEY); } catch { /* nothing to clear */ }
}

/**
 * `url` is now the Studio file this browser caches: returns the other Studio
 * URLs cached before (to delete) and remembers only `url`.
 */
export function replaceStudioFile(url: string): string[] {
  const store = storage();
  if (!store) return [];
  let known: string[] = [];
  try {
    const raw = store.getItem(FILES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    known = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    known = [];
  }
  try { store.setItem(FILES_KEY, JSON.stringify([url])); } catch { /* not remembered */ }
  return known.filter((item) => item !== url);
}

/** The cache was cleared: no Studio file is cached any more. */
export function forgetStudioFiles(): void {
  try { storage()?.removeItem(FILES_KEY); } catch { /* nothing to forget */ }
}

/** Why this device should not try the Studio model (checked before the download), or null. */
export function studioDeviceProblem(): string | null {
  const nav = (globalThis as { navigator?: { deviceMemory?: unknown; userAgentData?: { mobile?: unknown } } }).navigator;
  if (nav?.userAgentData?.mobile === true) return "The Studio cut-out is not offered on phones (a 500 MB download and about 3 GB of graphics memory).";
  const memory = typeof nav?.deviceMemory === "number" ? nav.deviceMemory : null;
  if (memory !== null && memory < STUDIO_MIN_DEVICE_MEMORY_GB) {
    return `The Studio cut-out needs a device with at least ${STUDIO_MIN_DEVICE_MEMORY_GB} GB of memory; this one reports ${memory} GB.`;
  }
  return null;
}

type LockManagerLike = { request(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<void> | undefined): Promise<unknown> };
let releaseLock: (() => void) | null = null;

/**
 * Hold the device-wide Studio lock (one Studio session across Cue tabs, each
 * takes about 3 GB of graphics memory). False when another tab holds it.
 */
export async function takeStudioLock(): Promise<boolean> {
  if (releaseLock) return true;
  const locks = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
  if (!locks || typeof locks.request !== "function") return true;
  try {
    return await new Promise<boolean>((resolve, reject) => {
      locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock) { resolve(false); return undefined; }
        return new Promise<void>((release) => { releaseLock = release; resolve(true); });
      }).catch(reject);
    });
  } catch {
    return true;
  }
}

export function releaseStudioLock(): void {
  const release = releaseLock;
  releaseLock = null;
  release?.();
}
