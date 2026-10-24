/**
 * NovelAI V5 reference inset probe (owner-run, not part of the build).
 *
 * Sends one inset request straight to NovelAI, the way Cue's sprite mode
 * sends it through Lumiverse, so the technique, the model name, the route
 * and the cost can be checked with a real key:
 *
 *   NOVELAI_API_KEY=... bun scripts/novelai-v5-inset-probe.ts \
 *     --reference idle.png --prompt "anime coloring, 1girl, solo, standing" \
 *     --character "1girl, silver hair, green eyes, school uniform, smile"
 *
 * The key is read only from the NOVELAI_API_KEY environment variable and is
 * never printed or written. Without it (or with --dry-run) nothing is sent:
 * the canvas, the mask and the redacted request are written so they can be
 * inspected. Results go to .cache/improve/v5inset/ (or --out):
 *   canvas.png, mask.png          what the request carries
 *   request.redacted.json         the body, image/mask/key redacted
 *   <route>-full.png              the generated canvas
 *   <route>-right.png             its right half (608x832), what Cue cuts out
 *
 * The extension composes the canvas in the browser (canvas drawImage, see
 * src/frontend/sprites/canvas-tools.ts); this script does the same geometry
 * (src/shared/novelai-inset.ts) with a tiny PNG codec, so resampling differs
 * slightly. The body mirrors Lumiverse's NovelAI provider
 * (src/image-gen/providers/novelai.ts, V5 branch) plus Cue's
 * rawRequestOverride (src/backend/runtime/sprites/novelai-inset.ts).
 *
 * Options:
 *   --reference <png>    reference image (the set's idle; a plain white background works best)
 *   --prompt <tags>      base (scene) prompt; "split screen, " is added like Cue does
 *   --character <tags>   character caption (coords off), optional
 *   --negative <tags>    base negative (default: Cue's V5 sprite negative); the inset edits apply
 *   --model <id>         V5 model (default nai-diffusion-5-full -> nai-diffusion-5-full-inpainting)
 *   --steps <n> --scale <n> --sampler <id> --seed <n>   as the Lumiverse connection would send them
 *                        (defaults 28, 5, k_euler_ancestral, random; the author used 14 and 6.7)
 *   --raw <json>         a user rawRequestOverride to merge (like a connection's)
 *   --route plain|stream|both   /ai/generate-image, /ai/generate-image-stream, or both (default plain)
 *   --out <dir>          output directory (default .cache/improve/v5inset)
 *   --dry-run            write the canvas, mask and request; send nothing
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync, inflateRawSync, inflateSync } from "node:zlib";
import { DEFAULT_CONFIG } from "../src/config.js";
import { fitContain, NOVELAI_INSET_LAYOUTS } from "../src/shared/novelai-inset.js";
import { compileNovelAiInsetRequest, novelAiInsetModelFor } from "../src/backend/runtime/sprites/novelai-inset.js";
import { novelAiNegative, SPRITE_NEGATIVE_TAGS } from "../src/backend/runtime/sprites/prompts.js";

type Image = { width: number; height: number; rgba: Uint8Array };

/* ---------------------------------------------------------------- args */

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) out[name] = true;
    else {
      out[name] = next;
      index += 1;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- PNG */

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function decodePng(bytes: Uint8Array): Image {
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) throw new Error("Not a PNG file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const data: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = view.getUint32(body.byteOffset - bytes.byteOffset);
      height = view.getUint32(body.byteOffset - bytes.byteOffset + 4);
      depth = body[8]!;
      colour = body[9]!;
      interlace = body[12]!;
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
  }
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported; save the reference without interlacing.");
  if (depth !== 8 && depth !== 16) throw new Error(`PNG bit depth ${depth} is not supported (8 or 16 only).`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colour];
  if (!channels) throw new Error(`PNG colour type ${colour} is not supported.`);
  const total = data.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of data) { joined.set(chunk, at); at += chunk.length; }
  const raw = new Uint8Array(inflateSync(joined));
  const bpp = channels * (depth / 8);
  const stride = width * bpp;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? pixels[y * stride + x - bpp]! : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const corner = y > 0 && x >= bpp ? pixels[(y - 1) * stride + x - bpp]! : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      pixels[y * stride + x] = (line[x]! + predictor) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const sample = (index: number) => (depth === 16 ? pixels[index * 2]! : pixels[index]!);
  for (let index = 0; index < width * height; index += 1) {
    const base = index * channels;
    let r: number, g: number, b: number, a = 255;
    if (colour === 0) { r = g = b = sample(base); }
    else if (colour === 2) { r = sample(base); g = sample(base + 1); b = sample(base + 2); }
    else if (colour === 3) {
      const entry = pixels[index]!;
      r = palette?.[entry * 3] ?? 0; g = palette?.[entry * 3 + 1] ?? 0; b = palette?.[entry * 3 + 2] ?? 0;
      a = transparency && entry < transparency.length ? transparency[entry]! : 255;
    } else if (colour === 4) { r = g = b = sample(base); a = sample(base + 1); }
    else { r = sample(base); g = sample(base + 1); b = sample(base + 2); a = sample(base + 3); }
    rgba.set([r, g, b, a], index * 4);
  }
  return { width, height, rgba };
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(Array.from(type, (char) => char.charCodeAt(0)), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** RGB (opaque) PNG. */
function encodePng(image: Image): Uint8Array {
  const { width, height, rgba } = image;
  const raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = y * (width * 3 + 1) + 1 + x * 3;
      raw[to] = rgba[from]!; raw[to + 1] = rgba[from + 1]!; raw[to + 2] = rgba[from + 2]!;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [PNG_SIGNATURE, chunk("IHDR", header), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/* ---------------------------------------------------------------- pixels */

function solid(width: number, height: number, value: number): Image {
  const rgba = new Uint8Array(width * height * 4).fill(value);
  for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255;
  return { width, height, rgba };
}

/** Draw `source` scaled into `box` over `target` (alpha over), area-average down, bilinear up. */
function drawScaled(target: Image, source: Image, box: { x: number; y: number; width: number; height: number }): void {
  const sx = source.width / box.width;
  const sy = source.height / box.height;
  for (let ty = 0; ty < box.height; ty += 1) {
    for (let tx = 0; tx < box.width; tx += 1) {
      let r = 0, g = 0, b = 0, a = 0, weight = 0;
      if (sx > 1 || sy > 1) {
        const x0 = tx * sx, x1 = (tx + 1) * sx, y0 = ty * sy, y1 = (ty + 1) * sy;
        for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
          const wy = Math.min(y + 1, y1) - Math.max(y, y0);
          for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
            const w = wy * (Math.min(x + 1, x1) - Math.max(x, x0));
            const at = (Math.min(y, source.height - 1) * source.width + Math.min(x, source.width - 1)) * 4;
            const alpha = source.rgba[at + 3]! / 255;
            r += source.rgba[at]! * alpha * w; g += source.rgba[at + 1]! * alpha * w; b += source.rgba[at + 2]! * alpha * w; a += alpha * w; weight += w;
          }
        }
      } else {
        const fx = Math.max(0, (tx + 0.5) * sx - 0.5), fy = Math.max(0, (ty + 0.5) * sy - 0.5);
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        for (const [x, y, w] of [[x0, y0, (1 - fx + x0) * (1 - fy + y0)], [x0 + 1, y0, (fx - x0) * (1 - fy + y0)], [x0, y0 + 1, (1 - fx + x0) * (fy - y0)], [x0 + 1, y0 + 1, (fx - x0) * (fy - y0)]] as const) {
          const at = (Math.min(y, source.height - 1) * source.width + Math.min(x, source.width - 1)) * 4;
          const alpha = source.rgba[at + 3]! / 255;
          r += source.rgba[at]! * alpha * w; g += source.rgba[at + 1]! * alpha * w; b += source.rgba[at + 2]! * alpha * w; a += alpha * w; weight += w;
        }
      }
      if (weight <= 0) continue;
      const alpha = a / weight;
      const at = ((box.y + ty) * target.width + box.x + tx) * 4;
      for (const [channel, value] of [[0, r], [1, g], [2, b]] as const) {
        const premultiplied = value / weight;
        target.rgba[at + channel] = Math.round(premultiplied + target.rgba[at + channel]! * (1 - alpha));
      }
    }
  }
}

function crop(image: Image, rect: { x: number; y: number; width: number; height: number }): Image {
  const out = solid(rect.width, rect.height, 0);
  for (let y = 0; y < rect.height; y += 1) {
    out.rgba.set(image.rgba.subarray(((rect.y + y) * image.width + rect.x) * 4, ((rect.y + y) * image.width + rect.x + rect.width) * 4), y * rect.width * 4);
  }
  return out;
}

/* ---------------------------------------------------------------- responses */

/** The first PNG of a ZIP (the non-streaming route answers with one). */
function pngFromZip(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) return null;
  const entries = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  for (let index = 0; index < entries && at + 46 <= bytes.length; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) return null;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!/\.png$/i.test(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const body = bytes.subarray(start, start + size);
    if (method === 0) return body;
    if (method === 8) return new Uint8Array(inflateRawSync(body));
    return null;
  }
  return null;
}

/** The largest complete PNG embedded in a byte stream (msgpack events carry raw bytes). */
function largestEmbeddedPng(bytes: Uint8Array): Uint8Array | null {
  let best: Uint8Array | null = null;
  for (let at = 0; at + 8 <= bytes.length; at += 1) {
    if (bytes[at] !== 0x89 || !PNG_SIGNATURE.every((value, index) => bytes[at + index] === value)) continue;
    // Walk the chunks to IEND.
    let offset = at + 8;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      offset += 12 + length;
      if (type === "IEND") {
        if (offset <= bytes.length && (!best || offset - at > best.length)) best = bytes.subarray(at, offset);
        break;
      }
      if (!/^[A-Za-z]{4}$/.test(type)) break;
    }
  }
  return best;
}

/* ---------------------------------------------------------------- body */

function deepMerge(target: unknown, source: unknown): unknown {
  if (source === null || source === undefined) return target;
  const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!isObject(source) || !isObject(target)) return source;
  const out: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) if (key !== "__proto__" && key !== "constructor" && key !== "prototype") out[key] = deepMerge(out[key], source[key]);
  return out;
}

/** Lumiverse's NovelAI body for a V5 model (novelai.ts), with the raw override applied the same way. */
function lumiverseBody(input: { prompt: string; model: string; parameters: Record<string, unknown> }, stream: boolean): Record<string, unknown> {
  const params = input.parameters;
  const [width, height] = String(params.resolution || "1216x832").split("x").map(Number);
  const negativePrompt = String(params.negativePrompt || "");
  const seed = typeof params.seed === "number" ? params.seed : Math.floor(Math.random() * 2147483647);
  const characters = (params.characterTags as Array<{ tags: string }> | undefined) ?? [];
  const parameters: Record<string, unknown> = {
    params_version: 4, width, height, scale: params.guidance ?? 5, sampler: params.sampler || "k_euler_ancestral", steps: params.steps ?? 28,
    n_samples: 1, seed, ucPreset: 0, qualityToggle: true, dynamic_thresholding: false, controlnet_strength: 1, legacy: false,
    add_original_image: true, cfg_rescale: 0, noise_schedule: "karras", legacy_v3_extend: false, skip_cfg_above_sigma: null,
    use_coords: false, legacy_uc: false, normalize_reference_strength_multiple: true, inpaintImg2ImgStrength: 1,
    negative_prompt: negativePrompt, deliberate_euler_ancestral_bug: false, prefer_brownian: true, image_format: "png",
    autoSmea: params.smea ?? false, prompt: input.prompt, extra_noise_seed: seed,
    characterPrompts: characters.map((character) => ({ prompt: character.tags, uc: negativePrompt, center: { x: 0, y: 0 }, enabled: true })),
    v4_prompt: { caption: { base_caption: input.prompt, char_captions: characters.map((character) => ({ char_caption: character.tags, centers: [{ x: 0, y: 0 }] })) }, use_coords: false, use_order: true },
    v4_negative_prompt: { caption: { base_caption: negativePrompt, char_captions: characters.map(() => ({ char_caption: negativePrompt, centers: [{ x: 0, y: 0 }] })) }, legacy_uc: false },
  };
  const override = typeof params.rawRequestOverride === "string" ? JSON.parse(params.rawRequestOverride) as Record<string, unknown> : {};
  delete override.model;
  const body = deepMerge({ input: input.prompt, model: input.model, action: "generate", parameters }, override) as Record<string, unknown> & { parameters: Record<string, unknown> };
  if (stream) body.parameters.stream = "msgpack";
  else delete body.parameters.stream;
  return body;
}

function redacted(body: Record<string, unknown> & { parameters: Record<string, unknown> }, layout: { width: number; height: number }): unknown {
  const describe = (value: unknown) => (typeof value === "string" ? `<base64 PNG ${layout.width}x${layout.height}, ${value.length} chars, redacted>` : value);
  return { ...body, parameters: { ...body.parameters, image: describe(body.parameters.image), mask: describe(body.parameters.mask) } };
}

/* ---------------------------------------------------------------- main */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args.reference !== "string" || typeof args.prompt !== "string") {
    console.log("Usage: NOVELAI_API_KEY=... bun scripts/novelai-v5-inset-probe.ts --reference idle.png --prompt \"<base tags>\" [--character \"<tags>\"] [--dry-run] (see the header of this file)");
    process.exit(2);
  }
  const outDir = resolve(typeof args.out === "string" ? args.out : join(".cache", "improve", "v5inset"));
  mkdirSync(outDir, { recursive: true });
  const model = typeof args.model === "string" ? args.model : "nai-diffusion-5-full";
  const inset = novelAiInsetModelFor("novelai", model);
  if (!inset) throw new Error(`${model} is not a NovelAI V5 model.`);
  const layout = NOVELAI_INSET_LAYOUTS.sprite;

  // The canvas and the mask (the extension draws these in the browser).
  const reference = decodePng(new Uint8Array(readFileSync(args.reference)));
  const canvas = solid(layout.canvas.width, layout.canvas.height, 255);
  const box = fitContain(reference, layout.reference);
  drawScaled(canvas, reference, box);
  const mask = solid(layout.canvas.width, layout.canvas.height, 0);
  for (let y = layout.repaint.y; y < layout.repaint.y + layout.repaint.height; y += 1) mask.rgba.fill(255, (y * mask.width + layout.repaint.x) * 4, (y * mask.width + layout.repaint.x + layout.repaint.width) * 4);
  const canvasPng = encodePng(canvas);
  const maskPng = encodePng(mask);
  writeFileSync(join(outDir, "canvas.png"), canvasPng);
  writeFileSync(join(outDir, "mask.png"), maskPng);
  console.log(`reference ${reference.width}x${reference.height} -> drawn at ${box.x},${box.y} ${box.width}x${box.height}; canvas ${layout.canvas.width}x${layout.canvas.height}, repaint ${layout.repaint.x},${layout.repaint.y} ${layout.repaint.width}x${layout.repaint.height}`);

  // The request Cue would make (sprite expression -> inset), then the body Lumiverse would send.
  const negative = typeof args.negative === "string" ? args.negative : novelAiNegative(DEFAULT_CONFIG, SPRITE_NEGATIVE_TAGS, model);
  const character = typeof args.character === "string" ? args.character : "";
  const number = (name: string) => (typeof args[name] === "string" && Number.isFinite(Number(args[name])) ? Number(args[name]) : undefined);
  const request = compileNovelAiInsetRequest({
    request: {
      prompt: args.prompt,
      negativePrompt: negative,
      parameters: {
        qualityToggle: false,
        negativePrompt: negative,
        characterTags: character ? [{ tags: character }] : [],
        resolution: "832x1216",
        ...(number("seed") !== undefined ? { seed: number("seed") } : {}),
      },
    },
    layout,
    canvas: { image: Buffer.from(canvasPng).toString("base64"), mask: Buffer.from(maskPng).toString("base64") },
    userOverrides: typeof args.raw === "string" ? [args.raw] : [],
  });
  const userParameters = {
    ...(number("steps") !== undefined ? { steps: number("steps") } : {}),
    ...(number("scale") !== undefined ? { guidance: number("scale") } : {}),
    ...(typeof args.sampler === "string" ? { sampler: args.sampler } : {}),
  };
  const parameters = { ...userParameters, ...request.parameters };
  const route = typeof args.route === "string" ? args.route : "plain";
  const routes = route === "both" ? ["plain", "stream"] : [route];
  if (!routes.every((name) => name === "plain" || name === "stream")) throw new Error("--route must be plain, stream or both.");
  const preview = lumiverseBody({ prompt: request.prompt, model: inset.model, parameters }, routes[0] === "stream") as Record<string, unknown> & { parameters: Record<string, unknown> };
  const shown = redacted(preview, layout.canvas);
  writeFileSync(join(outDir, "request.redacted.json"), `${JSON.stringify(shown, null, 2)}\n`);
  console.log(`model ${inset.model}${inset.verified ? "" : " (unverified model name)"}`);
  console.log(JSON.stringify(shown, null, 2));

  const key = process.env.NOVELAI_API_KEY?.trim();
  if (args["dry-run"] === true || !key) {
    console.log(key ? "--dry-run: nothing sent." : "NOVELAI_API_KEY is not set: nothing sent (dry run).");
    console.log(`wrote ${join(outDir, "canvas.png")}, mask.png and request.redacted.json`);
    return;
  }
  const base = "https://image.novelai.net";
  for (const name of routes) {
    const body = lumiverseBody({ prompt: request.prompt, model: inset.model, parameters: { ...parameters, seed: preview.parameters.seed } }, name === "stream");
    const path = name === "stream" ? "/ai/generate-image-stream" : "/ai/generate-image";
    const started = Date.now();
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    console.log(`${path}: HTTP ${response.status} ${response.headers.get("content-type") ?? ""}, ${bytes.length} bytes, ${Date.now() - started} ms`);
    if (!response.ok) {
      console.log(new TextDecoder().decode(bytes.subarray(0, 1500)));
      continue;
    }
    const png = (bytes[0] === 0x50 && bytes[1] === 0x4b ? pngFromZip(bytes) : null) ?? largestEmbeddedPng(bytes);
    if (!png) {
      console.log("No PNG found in the response; first bytes as text:");
      console.log(new TextDecoder().decode(bytes.subarray(0, 500)));
      continue;
    }
    writeFileSync(join(outDir, `${name}-full.png`), png);
    const result = decodePng(png);
    console.log(`result ${result.width}x${result.height}`);
    if (result.width === layout.canvas.width && result.height === layout.canvas.height) {
      writeFileSync(join(outDir, `${name}-right.png`), encodePng(crop(result, layout.repaint)));
      console.log(`wrote ${join(outDir, `${name}-full.png`)} and ${name}-right.png`);
    } else {
      console.log(`unexpected size; wrote ${join(outDir, `${name}-full.png`)} only`);
    }
  }
}

export { decodePng, encodePng, largestEmbeddedPng, lumiverseBody, pngFromZip };

if (import.meta.main) await main();
