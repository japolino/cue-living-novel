/**
 * Browser fixture for scripts/test-sprite-cutout-browser.ts: exposes the real
 * cut-out module and cut service on `window.cutout`, plus small helpers that
 * compare alpha channels and draw composites in the page.
 */
import {
  clearCutoutModel,
  configureCutoutRuntime,
  cutSprite,
  getCachedCutoutModelBytes,
  getCutoutModelState,
  getCutoutRunnerMode,
  getCutoutRuntimeInfo,
  onCutoutModelState,
  prepareCutoutModel,
  resetCutoutRuntime,
  type CutoutModelState,
} from "../src/frontend/sprites/cutout/index.js";
import { createSpriteCutService } from "../src/frontend/sprites/cut-service.js";
import { createCutoutKernel } from "../src/frontend/sprites/cutout/kernel.js";
import type { FrontendRequest } from "../src/protocol.js";
import { DEFAULT_CONFIG } from "../src/config.js";

async function pixels(blob: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const out = { data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return out;
}

async function fetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.blob();
}

/** IoU of alpha >= 128 plus mean absolute alpha difference (0..1). */
async function compareAlpha(result: Blob, referenceUrl: string): Promise<{ iou: number; mad: number }> {
  const [a, b] = await Promise.all([pixels(result), fetchBlob(referenceUrl).then(pixels)]);
  if (a.width !== b.width || a.height !== b.height) throw new Error("size mismatch");
  let inter = 0, union = 0, diff = 0;
  for (let o = 3; o < a.data.length; o += 4) {
    const x = a.data[o]! >= 128, y = b.data[o]! >= 128;
    if (x && y) inter++;
    if (x || y) union++;
    diff += Math.abs(a.data[o]! - b.data[o]!);
  }
  return { iou: union ? inter / union : 1, mad: diff / (a.data.length / 4) / 255 };
}

/** JPEG data URL of the cut-out over a dark gradient (what the stage shows). */
async function composite(result: Blob, scale = 0.5): Promise<string> {
  const bitmap = await createImageBitmap(result);
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, "rgb(12,16,36)");
  gradient.addColorStop(1, "rgb(42,50,86)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.9);
}

/** `blob` drawn at another pixel size (canvas, high-quality smoothing), as PNG. */
async function rescale(blob: Blob, width: number, height: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/png" });
}

/**
 * Size check for "standard" (624x912) sprites: cut the image as it is, and
 * cut it again upscaled to 832x1216 (the size the kernel parameters were
 * tuned on), then compare the two alphas at the native size.
 */
async function scaleCompare(url: string, options: { quality: "best" | "basic"; modelUrl: string }) {
  const blob = await fetchBlob(url);
  const native = await cutSprite(blob, options);
  const up = await cutSprite(await rescale(blob, Math.round(native.width * 4 / 3), Math.round(native.height * 4 / 3)), options);
  const [a, b] = await Promise.all([pixels(native.png), rescale(up.png, native.width, native.height).then(pixels)]);
  let inter = 0, union = 0, diff = 0;
  for (let o = 3; o < a.data.length; o += 4) {
    const x = a.data[o]! >= 128, y = b.data[o]! >= 128;
    if (x && y) inter++;
    if (x || y) union++;
    diff += Math.abs(a.data[o]! - b.data[o]!);
  }
  return {
    size: [native.width, native.height], upSize: [up.width, up.height], quality: native.quality, upQuality: up.quality,
    bbox: native.bbox, upBbox: up.bbox, iou: union ? inter / union : 1, mad: diff / (a.data.length / 4) / 255,
  };
}

const kernel = createCutoutKernel();

/** The kernel's two-figure check on an existing cut-out (its alpha channel). */
async function figureCheckUrl(url: string) {
  const px = await pixels(await fetchBlob(url));
  return { ...kernel.figureCheck(px.data, px.width, px.height), size: [px.width, px.height] };
}

/** Cut a raw sprite with the real pipeline and return its duplicate check. */
async function cutFigures(url: string, options: { quality: "best" | "basic"; modelUrl: string }) {
  const r = await cutSprite(await fetchBlob(url), options);
  return { twoFigures: r.twoFigures, splitShare: r.splitShare, quality: r.quality, ms: r.durationMs };
}

/**
 * Pre-cut round trip: cut a raw sprite, feed the transparent PNG back in.
 * The second cut must keep the first one's pixels (straight alpha) and bbox.
 */
async function preCutRoundTrip(url: string) {
  const first = await cutSprite(await fetchBlob(url), { quality: "basic", modelUrl: "" });
  const second = await cutSprite(first.png, { quality: "basic", modelUrl: "" });
  const [a, b] = await Promise.all([pixels(first.png), pixels(second.png)]);
  let alphaDiff = 0, rgbDiff = 0;
  for (let o = 0; o < a.data.length; o += 4) {
    alphaDiff = Math.max(alphaDiff, Math.abs(a.data[o + 3]! - b.data[o + 3]!));
    if (a.data[o + 3]! > 0) rgbDiff = Math.max(rgbDiff, Math.abs(a.data[o]! - b.data[o]!), Math.abs(a.data[o + 1]! - b.data[o + 1]!), Math.abs(a.data[o + 2]! - b.data[o + 2]!));
  }
  return { firstPreCut: first.preCut === true, preCut: second.preCut === true, quality: second.quality, modelMs: second.timings?.modelMs ?? null, alphaDiff, rgbDiff, sameBbox: first.bbox.every((v, i) => Math.abs(v - second.bbox[i]!) < 1e-9) };
}

/**
 * A NovelAI V5 inset render through the real cut service: the left half is the
 * raw sprite on white (the opaque reference), the right half that sprite's
 * cut-out (transparent, as a workflow that removes the background saves it).
 * The request's crop picks the right half, and the pre-cut check must judge
 * that half: the cut keeps its alpha. Judged on the whole canvas instead, the
 * check would keep the opaque reference half too.
 */
async function insetPreCutTrip(url: string) {
  const raw = await fetchBlob(url);
  const first = await cutSprite(raw, { quality: "basic", modelUrl: "" });
  const [left, right] = await Promise.all([createImageBitmap(raw), createImageBitmap(first.png, { premultiplyAlpha: "none", colorSpaceConversion: "none" })]);
  const width = left.width, height = left.height;
  const canvas = new OffscreenCanvas(width * 2, height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(left, 0, 0);
  ctx.drawImage(right, width, 0);
  left.close();
  right.close();
  const inset = await canvas.convertToBlob({ type: "image/png" });
  const whole = await pixels(inset);
  const wholePreCut = createCutoutKernel().isPreCut(whole.data, whole.width, whole.height);
  const seen: Array<{ preCut: boolean; modelMs: number | null; width: number; height: number; modelUrlF16: string | null }> = [];
  const sent: FrontendRequest[] = [];
  const service = createSpriteCutService({
    sendToBackend: (message) => sent.push(message),
    fetchImage: async () => inset,
    // The default model URL, so the half-precision copy travels with the crop ("basic" loads no model).
    getConfig: () => ({ ...DEFAULT_CONFIG, spriteCutout: "basic" }),
    cut: async (image, options) => {
      const result = await cutSprite(image, options);
      seen.push({ preCut: result.preCut === true, modelMs: result.timings?.modelMs ?? null, width: result.width, height: result.height, modelUrlF16: options.modelUrlF16 ?? null });
      return result;
    },
  });
  const crop = { x: width, y: 0, width, height };
  await service.handle({ type: "vn_sprite_cut", requestId: "inset", imageId: "inset", setKey: "s", expression: "smile", crop });
  const replies = sent.filter((m): m is Extract<FrontendRequest, { type: "vn_sprite_cut_result" }> => m.type === "vn_sprite_cut_result");
  const error = replies.find((m) => m.error)?.error ?? null;
  let alphaDiff = 255;
  if (!error) {
    const bytes = Uint8Array.from(atob(replies.map((m) => m.dataBase64 ?? "").join("")), (ch) => ch.charCodeAt(0));
    const [a, b] = await Promise.all([pixels(first.png), pixels(new Blob([bytes], { type: "image/png" }))]);
    if (a.width === b.width && a.height === b.height) {
      alphaDiff = 0;
      for (let o = 3; o < a.data.length; o += 4) alphaDiff = Math.max(alphaDiff, Math.abs(a.data[o]! - b.data[o]!));
    }
  }
  return { error, seen, crop, half: [width, height], meta: replies[0]?.meta ?? null, alphaDiff, wholePreCut };
}

const states: CutoutModelState[] = [];
onCutoutModelState((state) => states.push(state));

function startService() {
  const sent: FrontendRequest[] = [];
  const service = createSpriteCutService({
    sendToBackend: (message) => sent.push(message),
    fetchImage: (imageId) => fetchBlob(`/raw/${imageId}.png`),
    getConfig: () => ({ ...DEFAULT_CONFIG, spriteCutout: "basic" }),
  });
  return { service, sent };
}

(window as unknown as { cutout: unknown }).cutout = {
  cutSprite, configureCutoutRuntime, prepareCutoutModel, clearCutoutModel, getCutoutModelState, getCachedCutoutModelBytes,
  getCutoutRunnerMode, getCutoutRuntimeInfo, resetCutoutRuntime, states, fetchBlob, pixels, compareAlpha, composite, startService, scaleCompare,
  figureCheckUrl, cutFigures, preCutRoundTrip, insetPreCutTrip,
};
document.title = "sprite-cutout-ready";
