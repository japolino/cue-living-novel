/**
 * Browser cache for the cut-out model, keyed by URL: Cache Storage where the
 * page is a secure context, IndexedDB otherwise (Lumiverse is often served
 * over plain http on a LAN, where `caches` does not exist).
 */
const CACHE_NAME = "cue-sprite-cutout-v1";
const DB_NAME = "cue-sprite-cutout";
const DB_STORE = "models";

export type ModelStoreKind = "cache" | "indexeddb" | "none";

export function modelStoreKind(): ModelStoreKind {
  if (typeof caches !== "undefined" && typeof caches.open === "function") return "cache";
  if (typeof indexedDB !== "undefined") return "indexeddb";
  return "none";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is not available."));
    request.onblocked = () => reject(new Error("IndexedDB is blocked."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const request = run(tx.objectStore(DB_STORE));
      let value: T;
      request.onsuccess = () => { value = request.result as T; };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error("IndexedDB request failed."));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."));
    });
  } finally {
    db.close();
  }
}

/** Cached model bytes for `url`, or null. */
export async function readCachedModel(url: string): Promise<ArrayBuffer | null> {
  const kind = modelStoreKind();
  try {
    if (kind === "cache") {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url);
      return hit ? await hit.arrayBuffer() : null;
    }
    if (kind === "indexeddb") {
      const blob = await withStore<Blob | undefined>("readonly", (store) => store.get(url));
      return blob instanceof Blob ? await blob.arrayBuffer() : null;
    }
  } catch {
    /* unreadable cache counts as a miss */
  }
  return null;
}

/** Size of the cached model for `url`, or null when it is not cached. */
export async function cachedModelBytes(url: string): Promise<number | null> {
  const kind = modelStoreKind();
  try {
    if (kind === "cache") {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url);
      if (!hit) return null;
      const length = Number(hit.headers.get("Content-Length"));
      return Number.isFinite(length) && length > 0 ? length : (await hit.blob()).size;
    }
    if (kind === "indexeddb") {
      const blob = await withStore<Blob | undefined>("readonly", (store) => store.get(url));
      return blob instanceof Blob ? blob.size : null;
    }
  } catch {
    /* unreadable cache counts as a miss */
  }
  return null;
}

/** Store the model; failures (quota, private mode) are reported, not thrown. */
export async function writeCachedModel(url: string, bytes: ArrayBuffer): Promise<boolean> {
  const kind = modelStoreKind();
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  try {
    if (kind === "cache") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(url, new Response(blob, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(blob.size) } }));
      return true;
    }
    if (kind === "indexeddb") {
      await withStore("readwrite", (store) => store.put(blob, url));
      return true;
    }
  } catch {
    /* not cached; the model still runs for this page */
  }
  return false;
}

/** Remove every cached model. */
export async function deleteCachedModels(): Promise<void> {
  const kind = modelStoreKind();
  try {
    if (kind === "cache") await caches.delete(CACHE_NAME);
    else if (kind === "indexeddb") await withStore("readwrite", (store) => store.clear());
  } catch {
    /* nothing to remove */
  }
}

/**
 * Download the model with progress. `onProgress` gets the bytes received so
 * far and the total when the server sent a Content-Length.
 */
export async function downloadModel(
  url: string,
  onProgress: (receivedBytes: number, totalBytes: number | null) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store", ...(signal ? { signal } : {}) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`The model download was blocked or failed (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (!response.ok) throw new Error(`The model download failed: HTTP ${response.status}.`);
  const header = Number(response.headers.get("Content-Length"));
  const encoded = response.headers.get("Content-Encoding");
  const total = Number.isFinite(header) && header > 0 && (!encoded || encoded === "identity") ? header : null;
  onProgress(0, total);
  if (!response.body) {
    const whole = await response.arrayBuffer();
    onProgress(whole.byteLength, total);
    return whole;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    const now = Date.now();
    if (now - lastReport > 100) { lastReport = now; onProgress(received, total); }
  }
  onProgress(received, total);
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out.buffer;
}
