/**
 * Browser fixture for scripts/test-plate-depth-browser.ts: the real plate
 * depth service (worker, onnxruntime-web WASM, model and depth store) on
 * `window.depth`.
 */
import { configureCutoutRuntime } from "../src/frontend/sprites/cutout/index.js";
import { configurePlateDepth, plateDepthFor, resetPlateDepth } from "../src/frontend/stage/plate-depth-service.js";

async function measure(url: string): Promise<{ width: number; height: number; depth: number[]; ms: number }> {
  const started = performance.now();
  const map = await plateDepthFor(url);
  return { width: map.width, height: map.height, depth: Array.from(map.depth), ms: performance.now() - started };
}

Object.assign(window, { depth: { configureCutoutRuntime, configurePlateDepth, measure, resetPlateDepth } });
document.body.dataset.ready = "true";
