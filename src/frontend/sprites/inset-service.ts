import type { BackendResponse, FrontendRequest } from "../../protocol.js";
import { REFERENCE_IMAGE_MAX_BYTES, REFERENCE_IMAGE_MIMES } from "../../protocol.js";
import { novelAiInsetLayout, type NovelAiInsetLayout } from "../../shared/novelai-inset.js";
import { composeNovelAiInset } from "./canvas-tools.js";
import { blobToBase64, chunkBase64 } from "./cut-service.js";

export type NovelAiInsetRequest = Extract<BackendResponse, { type: "vn_novelai_inset" }>;

export type NovelAiInsetServiceDeps = {
  sendToBackend: (message: FrontendRequest) => void;
  /** Fetch image bytes the same way reference images are fetched (same origin, credentials). */
  fetchImage: (imageId: string) => Promise<Blob>;
  /** The composition to use (tests); defaults to `composeNovelAiInset`. */
  compose?: (reference: Blob, layout: NovelAiInsetLayout) => Promise<{ image: Blob; mask: Blob }>;
};

export type NovelAiInsetService = {
  /** Handle one `vn_novelai_inset`: fetch the reference, compose, reply with `vn_novelai_inset_result` chunks. */
  handle: (request: NovelAiInsetRequest) => Promise<void>;
  dispose: () => void;
};

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Host-side glue for the NovelAI V5 reference inset: the backend has no
 * canvas, so the browser draws the inset canvas and mask. Runs beside the
 * cut-out queue (no model involved, a few hundred ms); duplicates of an
 * in-flight requestId are ignored. Never logs image data.
 */
export function createNovelAiInsetService(deps: NovelAiInsetServiceDeps): NovelAiInsetService {
  const compose = deps.compose ?? composeNovelAiInset;
  const controller = new AbortController();
  const inFlight = new Set<string>();

  const reference = async (request: NovelAiInsetRequest): Promise<Blob> => {
    if (request.imageId) return deps.fetchImage(request.imageId);
    const mimeType = (request.mimeType ?? "").toLowerCase();
    if (!request.dataBase64 || !REFERENCE_IMAGE_MIMES.has(mimeType)) throw new Error("The inset request has no usable reference image.");
    const bytes = decodeBase64(request.dataBase64);
    return new Blob([bytes as BlobPart], { type: mimeType });
  };

  const process = async (request: NovelAiInsetRequest): Promise<void> => {
    try {
      const layout = novelAiInsetLayout(request.layout);
      if (!layout) throw new Error(`Unknown inset layout "${String(request.layout)}".`);
      const image = await reference(request);
      if (image.size > REFERENCE_IMAGE_MAX_BYTES) throw new Error("The inset reference is too large.");
      if (controller.signal.aborted) return;
      const canvas = await compose(image, layout);
      if (controller.signal.aborted) return;
      for (const part of ["image", "mask"] as const) {
        const chunks = chunkBase64(await blobToBase64(canvas[part]));
        if (controller.signal.aborted) return;
        chunks.forEach((dataBase64, chunkIndex) => {
          deps.sendToBackend({ type: "vn_novelai_inset_result", requestId: request.requestId, part, chunkIndex, chunkCount: chunks.length, dataBase64 });
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      deps.sendToBackend({
        type: "vn_novelai_inset_result",
        requestId: request.requestId,
        chunkIndex: 0,
        chunkCount: 1,
        error: (error instanceof Error ? error.message : String(error)) || "The inset canvas could not be drawn.",
      });
    }
  };

  return {
    handle: (request) => {
      if (controller.signal.aborted || inFlight.has(request.requestId)) return Promise.resolve();
      inFlight.add(request.requestId);
      return process(request).finally(() => { inFlight.delete(request.requestId); });
    },
    dispose: () => controller.abort(),
  };
}
