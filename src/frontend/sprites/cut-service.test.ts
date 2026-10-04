import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../config.js";
import type { FrontendRequest } from "../../protocol.js";
import { SPRITE_CUT_CHUNK_CHARS } from "../../shared/sprites.js";
import { blobToBase64, chunkBase64, createSpriteCutService, type SpriteCutRequest } from "./cut-service.js";
import type { CutoutOptions, CutoutResult } from "./cutout/index.js";

type Sent = Extract<FrontendRequest, { type: "vn_sprite_cut_result" }>;

const request = (requestId: string, imageId = `img-${requestId}`): SpriteCutRequest => ({ type: "vn_sprite_cut", requestId, imageId, setKey: "set", expression: "idle" });

function result(png: Blob, extra: Partial<CutoutResult> = {}): CutoutResult {
  return { png, width: 832, height: 1216, bbox: [0.1, 0.05, 0.8, 0.95], quality: "best", twoFigures: false, splitShare: 0, durationMs: 1234.4, ...extra };
}

function setup(options: {
  config?: Partial<VisualNovelConfig> | null;
  cut?: (image: Blob, options: CutoutOptions) => Promise<CutoutResult>;
  fetchImage?: (imageId: string) => Promise<Blob>;
} = {}) {
  const sent: Sent[] = [];
  const cuts: Array<{ image: Blob; options: CutoutOptions }> = [];
  const service = createSpriteCutService({
    sendToBackend: (message) => sent.push(message as Sent),
    fetchImage: options.fetchImage ?? (async (id) => new Blob([id])),
    getConfig: () => (options.config === null ? null : { ...DEFAULT_CONFIG, ...(options.config ?? {}) }),
    cut: async (image, cutOptions) => {
      cuts.push({ image, options: cutOptions });
      return (options.cut ?? (async () => result(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }))))(image, cutOptions);
    },
  });
  return { service, sent, cuts };
}

describe("sprite cut service", () => {
  test("cuts with the configured quality and model URL and replies with one chunk + meta", async () => {
    const { service, sent, cuts } = setup({ config: { spriteCutout: "basic", spriteModelUrl: "https://example.test/m.onnx" } });
    await service.handle(request("a"));
    expect(cuts).toHaveLength(1);
    expect(await cuts[0]!.image.text()).toBe("img-a");
    expect(cuts[0]!.options.quality).toBe("basic");
    expect(cuts[0]!.options.modelUrl).toBe("https://example.test/m.onnx");
    expect(cuts[0]!.options.signal).toBeInstanceOf(AbortSignal);
    expect(sent).toEqual([{
      type: "vn_sprite_cut_result", requestId: "a", chunkIndex: 0, chunkCount: 1, dataBase64: "iVBORw==",
      meta: { width: 832, height: 1216, bbox: [0.1, 0.05, 0.8, 0.95], quality: "best", twoFigures: false, durationMs: 1234 },
    }]);
  });

  test("the duplicate check travels in the meta", async () => {
    const { service, sent } = setup({ cut: async () => result(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), { twoFigures: true, splitShare: 0.7 }) });
    await service.handle(request("two"));
    expect(sent[0]!.meta?.twoFigures).toBe(true);
  });

  test("without config: best quality and the default model", async () => {
    const { service, cuts } = setup({ config: null });
    await service.handle(request("a"));
    expect(cuts[0]!.options.quality).toBe("best");
    expect(cuts[0]!.options.modelUrl).toBe(DEFAULT_CONFIG.spriteModelUrl);
  });

  test("large PNGs go out in ordered chunks of at most SPRITE_CUT_CHUNK_CHARS with meta on chunk 0", async () => {
    const bytes = new Uint8Array(2_400_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7919) & 255;
    const png = new Blob([bytes], { type: "image/png" });
    const { service, sent } = setup({ cut: async () => result(png) });
    await service.handle(request("big"));
    expect(sent.length).toBe(Math.ceil((4 * Math.ceil(bytes.length / 3)) / SPRITE_CUT_CHUNK_CHARS));
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.map((m) => m.chunkIndex)).toEqual([...Array(sent.length).keys()]);
    expect(sent.every((m) => m.chunkCount === sent.length && (m.dataBase64?.length ?? 0) <= SPRITE_CUT_CHUNK_CHARS)).toBe(true);
    expect(sent[0]!.meta).toBeDefined();
    expect(sent.slice(1).every((m) => m.meta === undefined)).toBe(true);
    const joined = Buffer.from(sent.map((m) => m.dataBase64).join(""), "base64");
    expect(joined.equals(Buffer.from(bytes))).toBe(true);
  });

  test("one cut at a time, in order; duplicate in-flight requestIds are ignored", async () => {
    let active = 0, peak = 0;
    const order: string[] = [];
    const { service, sent } = setup({
      cut: async (image) => {
        active++; peak = Math.max(peak, active);
        order.push(await image.text());
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return result(new Blob([new Uint8Array([1, 2, 3])]));
      },
    });
    await Promise.all([service.handle(request("a")), service.handle(request("a")), service.handle(request("b")), service.handle(request("c"))]);
    expect(peak).toBe(1);
    expect(order).toEqual(["img-a", "img-b", "img-c"]);
    expect(sent.map((m) => m.requestId)).toEqual(["a", "b", "c"]);
    // Once finished, the same requestId can be cut again (a re-sent pending cut).
    await service.handle(request("a"));
    expect(sent.map((m) => m.requestId)).toEqual(["a", "b", "c", "a"]);
  });

  test("a failure sends one result with error, and the queue keeps going", async () => {
    const { service, sent } = setup({
      fetchImage: async (id) => { if (id === "img-bad") throw new Error("HTTP 404"); return new Blob([id]); },
    });
    await Promise.all([service.handle(request("bad")), service.handle(request("ok"))]);
    expect(sent[0]).toEqual({ type: "vn_sprite_cut_result", requestId: "bad", chunkIndex: 0, chunkCount: 1, error: "HTTP 404" });
    expect(sent[1]!.requestId).toBe("ok");
    expect(sent[1]!.dataBase64).toBeDefined();
  });

  test("cut errors and oversized PNGs reply with an error", async () => {
    const failing = setup({ cut: async () => { throw new Error("decode failed"); } });
    await failing.service.handle(request("x"));
    expect(failing.sent).toEqual([{ type: "vn_sprite_cut_result", requestId: "x", chunkIndex: 0, chunkCount: 1, error: "decode failed" }]);
    const huge = { size: 25 * 1024 * 1024 } as Blob;
    const big = setup({ cut: async () => result(huge) });
    await big.service.handle(request("y"));
    expect(big.sent[0]!.error).toMatch(/too large/);
  });

  test("dispose aborts: the running cut sees the abort, nothing more is sent, new requests are ignored", async () => {
    let seen: AbortSignal | undefined;
    let release!: () => void;
    const { service, sent, cuts } = setup({
      cut: async (_image, options) => {
        seen = options.signal;
        await new Promise<void>((resolve) => { release = resolve; });
        return result(new Blob([new Uint8Array([1])]));
      },
    });
    const running = service.handle(request("a"));
    const queued = service.handle(request("b"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    service.dispose();
    expect(seen?.aborted).toBe(true);
    release();
    await Promise.all([running, queued, service.handle(request("c"))]);
    expect(sent).toEqual([]);
    expect(cuts).toHaveLength(1);
  });

  test("base64 helpers", async () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i * 31);
    expect(await blobToBase64(new Blob([bytes]))).toBe(Buffer.from(bytes).toString("base64"));
    expect(chunkBase64("abcdefg", 3)).toEqual(["abc", "def", "g"]);
    expect(chunkBase64("", 3)).toEqual([""]);
  });
});
