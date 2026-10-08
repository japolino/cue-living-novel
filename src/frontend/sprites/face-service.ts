import type { VisualNovelConfig } from "../../config.js";
import type { FrontendRequest } from "../../protocol.js";
import { DEFAULT_SPRITE_FACE_MODEL_URL, type SpriteImageView, type SpriteTurnView } from "../../shared/sprites.js";
import { resolveSpriteImage } from "../stage/sprite-layer.js";
import { detectSpriteFace, type FaceDetection } from "./cutout/index.js";

/** Wait this long after a sprite is wanted before detecting, so showing it goes first. */
export const SPRITE_FACE_DELAY_MS = 1500;
/** After a failure (model download or run), wait this long before trying again. */
export const SPRITE_FACE_RETRY_MS = 60_000;

export type SpriteFaceServiceDeps = {
  sendToBackend: (message: FrontendRequest) => void;
  /** Fetch a cut-out by its URL (same origin). */
  fetchImage: (url: string) => Promise<Blob>;
  getConfig: () => VisualNovelConfig | null;
  /** The detector (tests); defaults to `detectSpriteFace`. */
  detect?: (image: Blob, options: { modelUrl: string; signal?: AbortSignal }) => Promise<FaceDetection>;
  delayMs?: number;
  now?: () => number;
};

export type SpriteFaceService = {
  /** Detect the face of one ready image that has none stored (once per URL). */
  want: (setKey: string, image: SpriteImageView) => void;
  /** Every ready image of a turn's sets, the staged ones first. */
  wantView: (view: SpriteTurnView | null | undefined) => void;
  /** Resolves when the queue is empty (tests). */
  idle: () => Promise<void>;
  dispose: () => void;
};

type Wanted = { setKey: string; expression: string; url: string };

/**
 * Face backfill: sprites cut before the face detector existed have no face
 * box, so their emotes use the estimate. When such a sprite is on stage (or
 * in a staged set), the browser detects its face once, in the background,
 * and saves it through the backend (`vn_sprite_face`); the backend answers
 * with `vn_sprite_update`, which moves the emotes. Showing a sprite never
 * waits for this. "basic" cut-out quality downloads no model, so no faces.
 */
export function createSpriteFaceService(deps: SpriteFaceServiceDeps): SpriteFaceService {
  const detect = deps.detect ?? detectSpriteFace;
  const delayMs = deps.delayMs ?? SPRITE_FACE_DELAY_MS;
  const now = deps.now ?? (() => Date.now());
  const controller = new AbortController();
  const seen = new Set<string>();
  const queue: Wanted[] = [];
  let pausedUntil = 0;
  let running: Promise<void> | null = null;

  const enabled = (): boolean => {
    const config = deps.getConfig();
    return Boolean(config) && config!.spriteCutout !== "basic" && !controller.signal.aborted && now() >= pausedUntil;
  };

  const run = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    while (queue.length > 0 && enabled()) {
      const item = queue.shift()!;
      try {
        const image = await deps.fetchImage(item.url);
        if (controller.signal.aborted) return;
        const result = await detect(image, { modelUrl: DEFAULT_SPRITE_FACE_MODEL_URL, signal: controller.signal });
        if (controller.signal.aborted) return;
        deps.sendToBackend({ type: "vn_sprite_face", setKey: item.setKey, expression: item.expression, url: item.url, face: result.face });
      } catch {
        if (controller.signal.aborted) return;
        // Model or fetch failure: try these again later, not now.
        pausedUntil = now() + SPRITE_FACE_RETRY_MS;
        seen.delete(item.url);
        for (const rest of queue.splice(0)) seen.delete(rest.url);
        return;
      }
    }
  };

  const start = (): void => {
    if (running || queue.length === 0) return;
    running = run().finally(() => {
      running = null;
      if (queue.length > 0 && enabled()) start();
    });
  };

  const want = (setKey: string, image: SpriteImageView): void => {
    if (!enabled() || image.status !== "ready" || typeof image.url !== "string" || !image.url || image.face !== undefined) return;
    if (!image.expression || seen.has(image.url)) return;
    seen.add(image.url);
    queue.push({ setKey, expression: image.expression, url: image.url });
    start();
  };

  return {
    want,
    wantView: (view) => {
      if (!view || !enabled()) return;
      for (const paragraph of view.staging.paragraphs) {
        for (const actor of paragraph.actors) {
          const set = view.sets[actor.characterKey];
          const image = resolveSpriteImage(set, actor.expression);
          if (set && image) want(set.setKey, image);
        }
      }
      for (const set of Object.values(view.sets)) {
        for (const image of Object.values(set.expressions)) want(set.setKey, image);
      }
    },
    idle: async () => { while (running) await running; },
    dispose: () => {
      controller.abort();
      queue.splice(0);
    },
  };
}
