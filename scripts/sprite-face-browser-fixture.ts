/**
 * Browser fixture for scripts/test-sprite-face-browser.ts: the real face
 * detector (worker, onnxruntime-web WASM, model cache) on `window.face`.
 */
import { configureCutoutRuntime, detectSpriteFace, getCutoutRunnerMode, getFaceModelState } from "../src/frontend/sprites/cutout/index.js";

async function fetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.blob();
}

Object.assign(window, { face: { configureCutoutRuntime, detectSpriteFace, getCutoutRunnerMode, getFaceModelState, fetchBlob } });
document.body.dataset.ready = "true";
