import type { VisualNovelConfig } from "../../config.js";
import type { BackendResponse, FrontendRequest } from "../../protocol.js";
import { DEFAULT_SPRITE_FACE_MODEL_URL, DEFAULT_SPRITE_MODEL_URL, SPRITE_CUT_CHUNK_CHARS, SPRITE_CUT_MAX_BYTES } from "../../shared/sprites.js";
import { cutSprite, type CutoutOptions, type CutoutResult } from "./cutout/index.js";

export type SpriteCutRequest = Extract<BackendResponse, { type: "vn_sprite_cut" }>;

export type SpriteCutServiceDeps = {
  sendToBackend: (message: FrontendRequest) => void;
  /** Fetch image bytes the same way reference images are fetched (same origin, credentials). */
  fetchImage: (imageId: string) => Promise<Blob>;
  getConfig: () => VisualNovelConfig | null;
  /** The cut-out to use (tests); defaults to `cutSprite`. */
  cut?: (image: Blob, options: CutoutOptions) => Promise<CutoutResult>;
};

export type SpriteCutService = {
  /** Handle one `vn_sprite_cut`: fetch, cut, and reply with `vn_sprite_cut_result` chunks. */
  handle: (request: SpriteCutRequest) => Promise<void>;
  /** Abort in-flight cuts. */
  dispose: () => void;
};

/** Base64 (no data URL prefix) of a blob, in slices so large PNGs do not blow the call stack. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts: string[] = [];
  const slice = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += slice) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(offset, offset + slice) as unknown as number[]));
  }
  return btoa(parts.join(""));
}

/** Split base64 into ordered chunks of at most `size` characters (at least one chunk). */
export function chunkBase64(data: string, size = SPRITE_CUT_CHUNK_CHARS): string[] {
  if (!data) return [""];
  const chunks: string[] = [];
  for (let offset = 0; offset < data.length; offset += size) chunks.push(data.slice(offset, offset + size));
  return chunks;
}

/**
 * Host-side glue between the backend's cut requests and the browser cut-out.
 * Requests run one at a time (the model is memory-heavy); duplicates of an
 * in-flight requestId are ignored. After `dispose` nothing more is sent: the
 * backend re-sends pending cuts when a Cue view opens again.
 */
export function createSpriteCutService(deps: SpriteCutServiceDeps): SpriteCutService {
  const cut = deps.cut ?? cutSprite;
  const controller = new AbortController();
  const inFlight = new Set<string>();
  let queue: Promise<void> = Promise.resolve();

  const process = async (request: SpriteCutRequest): Promise<void> => {
    if (controller.signal.aborted) return;
    try {
      const config = deps.getConfig();
      const image = await deps.fetchImage(request.imageId);
      if (controller.signal.aborted) return;
      const result = await cut(image, {
        quality: config?.spriteCutout ?? "best",
        modelUrl: config?.spriteModelUrl || DEFAULT_SPRITE_MODEL_URL,
        faceModelUrl: DEFAULT_SPRITE_FACE_MODEL_URL,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (result.png.size > SPRITE_CUT_MAX_BYTES) throw new Error(`The cut-out PNG is too large (${result.png.size} bytes).`);
      const chunks = chunkBase64(await blobToBase64(result.png));
      if (controller.signal.aborted) return;
      chunks.forEach((dataBase64, chunkIndex) => {
        deps.sendToBackend({
          type: "vn_sprite_cut_result",
          requestId: request.requestId,
          chunkIndex,
          chunkCount: chunks.length,
          dataBase64,
          ...(chunkIndex === 0
            ? { meta: { width: result.width, height: result.height, bbox: result.bbox, quality: result.quality, twoFigures: result.twoFigures === true, ...(result.face !== undefined ? { face: result.face } : {}), durationMs: Math.round(result.durationMs) } }
            : {}),
        });
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      deps.sendToBackend({
        type: "vn_sprite_cut_result",
        requestId: request.requestId,
        chunkIndex: 0,
        chunkCount: 1,
        error: (error instanceof Error ? error.message : String(error)) || "Sprite cut-out failed.",
      });
    }
  };

  return {
    handle: (request) => {
      if (controller.signal.aborted || inFlight.has(request.requestId)) return Promise.resolve();
      inFlight.add(request.requestId);
      const run = queue.then(() => process(request)).finally(() => { inFlight.delete(request.requestId); });
      queue = run.catch(() => {});
      return run;
    },
    dispose: () => controller.abort(),
  };
}
