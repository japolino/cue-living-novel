import type { VisualNovelConfig } from "../../config.js";
import type { BackendResponse, FrontendRequest } from "../../protocol.js";

export type SpriteCutRequest = Extract<BackendResponse, { type: "vn_sprite_cut" }>;

export type SpriteCutServiceDeps = {
  sendToBackend: (message: FrontendRequest) => void;
  /** Fetch image bytes the same way reference images are fetched (same origin, credentials). */
  fetchImage: (imageId: string) => Promise<Blob>;
  getConfig: () => VisualNovelConfig | null;
};

export type SpriteCutService = {
  /** Handle one `vn_sprite_cut`: fetch, cut, and reply with `vn_sprite_cut_result` chunks. */
  handle: (request: SpriteCutRequest) => Promise<void>;
  /** Abort in-flight cuts. */
  dispose: () => void;
};

/**
 * Host-side glue between the backend's cut requests and the browser cut-out.
 * Requests run one at a time (the model is memory-heavy); duplicates of an
 * in-flight requestId are ignored.
 *
 * Contract stub: the cut-out implementation fills this in.
 */
export function createSpriteCutService(deps: SpriteCutServiceDeps): SpriteCutService {
  return {
    handle: async (request) => {
      deps.sendToBackend({ type: "vn_sprite_cut_result", requestId: request.requestId, chunkIndex: 0, chunkCount: 1, error: "Sprite cut-out is not implemented yet." });
    },
    dispose: () => {},
  };
}
