/**
 * Browser sprite cut-out: removes the plain (white) background from a
 * generated sprite and returns a transparent PNG.
 *
 * Pipeline (validated in the sprite bake-off, see docs/SPRITE_MODE.md):
 *   1. segmentation mask from ISNet-anime (onnxruntime-web, WebGPU -> WASM),
 *   2. border flood fill over background-coloured pixels for sharp edges,
 *      guarded by the mask (no leaks into white clothes or hair),
 *   3. enclosed background holes the mask calls background are removed,
 *   4. separate specks the mask calls background are removed,
 *   5. defringe: the background colour is un-mixed from soft edge pixels.
 * "basic" quality skips the model (steps 2 and 5 only).
 *
 * Contract stub: the cut-out implementation fills this in.
 */
export type CutoutQuality = "best" | "basic";

export type CutoutModelState =
  | { state: "absent" }
  | { state: "downloading"; receivedBytes: number; totalBytes: number | null }
  | { state: "loading" }
  | { state: "ready"; backend: "webgpu" | "wasm"; bytes: number }
  | { state: "unsupported"; reason: string }
  | { state: "error"; error: string };

export type CutoutResult = {
  png: Blob;
  width: number;
  height: number;
  /** Opaque bounding box, normalized 0..1: [x, y, width, height]. */
  bbox: [number, number, number, number];
  quality: CutoutQuality;
  durationMs: number;
};

export type CutoutOptions = {
  quality: CutoutQuality;
  modelUrl: string;
  signal?: AbortSignal;
};

export async function cutSprite(_image: Blob, _options: CutoutOptions): Promise<CutoutResult> {
  throw new Error("Sprite cut-out is not implemented yet.");
}

export function getCutoutModelState(): CutoutModelState {
  return { state: "absent" };
}

/** Subscribe to model state changes; returns an unsubscribe function. */
export function onCutoutModelState(_listener: (state: CutoutModelState) => void): () => void {
  return () => {};
}

/** Download (once, cached in the browser) and load the model ahead of time. */
export async function prepareCutoutModel(_modelUrl: string): Promise<void> {
  throw new Error("Sprite cut-out is not implemented yet.");
}

/** Forget the cached model (settings "Remove downloaded model"). */
export async function clearCutoutModel(): Promise<void> {}
