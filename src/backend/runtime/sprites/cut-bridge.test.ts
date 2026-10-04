import { describe, expect, test } from "bun:test";
import { SPRITE_CUT_CHUNK_CHARS } from "../../../shared/sprites.js";
import { fakePng, toBase64 } from "./__fixtures__/sprite-fixtures.js";
import { SPRITE_CUT_MAX_CHUNKS, SpriteCutBridge, decodeBase64, normalizeCutMeta, pngSize, type SpriteCutOutcome, type SpriteCutTarget } from "./cut-bridge.js";

const META = { width: 832, height: 1216, bbox: [0.1, 0.02, 0.8, 0.98] as [number, number, number, number], quality: "best" as const, durationMs: 1234 };
const TARGET: SpriteCutTarget = { setKey: "set_a", expression: "smile", imageId: "raw-1" };

function harness(timeoutMs = 1000) {
  const sent: Array<Record<string, unknown>> = [];
  const settled: Array<{ userId: string | undefined; target: SpriteCutTarget; outcome: SpriteCutOutcome }> = [];
  const bridge = new SpriteCutBridge({
    send: (message, userId) => sent.push({ ...message, userId }),
    onSettled: (userId, target, outcome) => settled.push({ userId, target, outcome }),
    timeoutMs,
  });
  return { bridge, sent, settled };
}

describe("PNG checks", () => {
  test("reads the IHDR size; rejects non-PNG bytes", () => {
    expect(pngSize(fakePng(10, 20))).toEqual({ width: 10, height: 20 });
    const jpeg = new Uint8Array(64);
    jpeg.set([0xff, 0xd8, 0xff]);
    expect(pngSize(jpeg)).toBeNull();
    expect(pngSize(new Uint8Array(4))).toBeNull();
    expect(pngSize(fakePng(0, 20))).toBeNull();
  });

  test("meta: bbox clamped, size from the PNG, bad bbox rejected", () => {
    expect(normalizeCutMeta({ ...META, width: 1, height: 1 }, { width: 832, height: 1216 })).toEqual({ ...META });
    expect(normalizeCutMeta({ bbox: [-1, 0.5, 5, 0.9], quality: "best" }, { width: 4, height: 4 })?.bbox).toEqual([0, 0.5, 1, 0.5]);
    expect(normalizeCutMeta({ bbox: [0, 0, 0, 0] }, { width: 4, height: 4 })).toBeNull();
    expect(normalizeCutMeta({ bbox: "x" }, { width: 4, height: 4 })).toBeNull();
    expect(normalizeCutMeta(undefined, { width: 4, height: 4 })).toEqual({ width: 4, height: 4, bbox: [0, 0, 1, 1], quality: "basic", durationMs: 0 });
  });
});

describe("cut bridge", () => {
  test("sends vn_sprite_cut and settles a single-chunk PNG", () => {
    const { bridge, sent, settled } = harness();
    const requestId = bridge.request("u1", TARGET);
    expect(sent).toEqual([{ type: "vn_sprite_cut", requestId, imageId: "raw-1", setKey: "set_a", expression: "smile", userId: "u1" }]);
    expect(bridge.isOutstanding("u1", "set_a", "smile")).toBe(true);
    const png = fakePng();
    expect(bridge.accept("u1", { type: "vn_sprite_cut_result", requestId, chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(png), meta: META })).toBe("settled");
    expect(settled).toHaveLength(1);
    const outcome = settled[0]!.outcome;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect([...outcome.png]).toEqual([...png]);
      expect(outcome.meta).toEqual(META);
    }
    expect(bridge.outstanding("u1")).toEqual([]);
  });

  test("reassembles chunks that arrive out of order; meta rides on chunk 0", () => {
    const { bridge, settled } = harness();
    const requestId = bridge.request("u1", TARGET);
    const text = toBase64(fakePng(832, 1216, 3000));
    const parts = [text.slice(0, 1000), text.slice(1000, 2000), text.slice(2000)];
    expect(bridge.accept("u1", { type: "vn_sprite_cut_result", requestId, chunkIndex: 2, chunkCount: 3, dataBase64: parts[2]! })).toBe("buffered");
    expect(bridge.accept("u1", { type: "vn_sprite_cut_result", requestId, chunkIndex: 0, chunkCount: 3, dataBase64: parts[0]!, meta: META })).toBe("buffered");
    // A duplicate chunk does not count twice.
    expect(bridge.accept("u1", { type: "vn_sprite_cut_result", requestId, chunkIndex: 0, chunkCount: 3, dataBase64: parts[0]!, meta: META })).toBe("buffered");
    expect(settled).toHaveLength(0);
    expect(bridge.accept("u1", { type: "vn_sprite_cut_result", requestId, chunkIndex: 1, chunkCount: 3, dataBase64: parts[1]! })).toBe("settled");
    expect(settled[0]!.outcome.ok).toBe(true);
    if (settled[0]!.outcome.ok) expect(toBase64(settled[0]!.outcome.png)).toBe(text);
  });

  test("unknown, stale and foreign request ids are ignored", () => {
    const { bridge, settled } = harness();
    const requestId = bridge.request("u1", TARGET);
    const png = toBase64(fakePng());
    expect(bridge.accept("u1", { type: "vn_sprite_cut_result", requestId: "nope", chunkIndex: 0, chunkCount: 1, dataBase64: png })).toBe("ignored");
    expect(bridge.accept("u2", { type: "vn_sprite_cut_result", requestId, chunkIndex: 0, chunkCount: 1, dataBase64: png })).toBe("ignored");
    expect(bridge.accept("u1", { type: "vn_sprite_cut_result", requestId, chunkIndex: 0, chunkCount: 1, dataBase64: png })).toBe("settled");
    // Settled: a late duplicate is stale.
    expect(bridge.accept("u1", { type: "vn_sprite_cut_result", requestId, chunkIndex: 0, chunkCount: 1, dataBase64: png })).toBe("ignored");
    expect(settled).toHaveLength(1);
    // Cancelled: its late result is ignored and nothing settles.
    const cancelled = bridge.request("u1", TARGET);
    expect(bridge.cancel("u1")).toBe(1);
    expect(bridge.accept("u1", { type: "vn_sprite_cut_result", requestId: cancelled, chunkIndex: 0, chunkCount: 1, dataBase64: png })).toBe("ignored");
    expect(settled).toHaveLength(1);
  });

  test("an error reply settles as a failure", () => {
    const { bridge, settled } = harness();
    const requestId = bridge.request("u1", TARGET);
    bridge.accept("u1", { type: "vn_sprite_cut_result", requestId, chunkIndex: 0, chunkCount: 1, error: "Model download failed" });
    expect(settled[0]!.outcome).toEqual({ ok: false, error: "Model download failed" });
  });

  test("oversize: too many chunks, an oversized chunk, or too much data", () => {
    const { bridge, settled } = harness();
    const first = bridge.request("u1", TARGET);
    bridge.accept("u1", { type: "vn_sprite_cut_result", requestId: first, chunkIndex: 0, chunkCount: SPRITE_CUT_MAX_CHUNKS + 1, dataBase64: "AAAA" });
    const second = bridge.request("u1", TARGET);
    bridge.accept("u1", { type: "vn_sprite_cut_result", requestId: second, chunkIndex: 0, chunkCount: 2, dataBase64: "A".repeat(SPRITE_CUT_CHUNK_CHARS + 4) });
    const third = bridge.request("u1", TARGET);
    const big = "A".repeat(SPRITE_CUT_CHUNK_CHARS);
    let result = "buffered";
    for (let index = 0; index < SPRITE_CUT_MAX_CHUNKS && result === "buffered"; index += 1) {
      result = bridge.accept("u1", { type: "vn_sprite_cut_result", requestId: third, chunkIndex: index, chunkCount: SPRITE_CUT_MAX_CHUNKS, dataBase64: big });
    }
    expect(settled.map((entry) => entry.outcome)).toEqual([
      { ok: false, error: "The cut-out is too large." },
      { ok: false, error: "The cut-out is too large." },
      { ok: false, error: "The cut-out is too large." },
    ]);
  });

  test("not a PNG, broken base64, or inconsistent chunk counts fail with a readable error", () => {
    const { bridge, settled } = harness();
    const jpeg = new Uint8Array(64);
    jpeg.set([0xff, 0xd8, 0xff]);
    const first = bridge.request("u1", TARGET);
    bridge.accept("u1", { type: "vn_sprite_cut_result", requestId: first, chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(jpeg) });
    const second = bridge.request("u1", TARGET);
    bridge.accept("u1", { type: "vn_sprite_cut_result", requestId: second, chunkIndex: 0, chunkCount: 1, dataBase64: "abc!" });
    const third = bridge.request("u1", TARGET);
    bridge.accept("u1", { type: "vn_sprite_cut_result", requestId: third, chunkIndex: 0, chunkCount: 2, dataBase64: "AAAA" });
    bridge.accept("u1", { type: "vn_sprite_cut_result", requestId: third, chunkIndex: 1, chunkCount: 3, dataBase64: "AAAA" });
    const fourth = bridge.request("u1", TARGET);
    bridge.accept("u1", { type: "vn_sprite_cut_result", requestId: fourth, chunkIndex: 5, chunkCount: 2, dataBase64: "AAAA" });
    expect(settled.map((entry) => entry.outcome)).toEqual([
      { ok: false, error: "The cut-out is not a PNG image." },
      { ok: false, error: "The cut-out arrived in an invalid form." },
      { ok: false, error: "The cut-out arrived in an invalid form." },
      { ok: false, error: "The cut-out arrived in an invalid form." },
    ]);
  });

  test("times out without progress; chunks reset the timer", async () => {
    const { bridge, settled } = harness(60);
    const requestId = bridge.request("u1", TARGET);
    await new Promise((resolve) => setTimeout(resolve, 40));
    bridge.accept("u1", { type: "vn_sprite_cut_result", requestId, chunkIndex: 0, chunkCount: 2, dataBase64: "AAAA" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(settled[0]!.outcome).toEqual({ ok: false, error: "The browser did not return the cut-out in time.", timedOut: true });
  });

  test("resend repeats stale requests with the same id and restarts their buffers", () => {
    const { bridge, sent, settled } = harness();
    const requestId = bridge.request("u1", TARGET);
    bridge.request("u2", { ...TARGET, setKey: "set_b" });
    bridge.accept("u1", { type: "vn_sprite_cut_result", requestId, chunkIndex: 0, chunkCount: 2, dataBase64: "AAAA" });
    expect(bridge.resend("u1")).toBe(1);
    expect(sent.at(-1)).toMatchObject({ type: "vn_sprite_cut", requestId, userId: "u1" });
    const png = toBase64(fakePng());
    expect(bridge.accept("u1", { type: "vn_sprite_cut_result", requestId, chunkIndex: 0, chunkCount: 1, dataBase64: png, meta: META })).toBe("settled");
    expect(settled[0]!.outcome.ok).toBe(true);
    expect(bridge.resend("u1", 60_000)).toBe(0);
  });

  test("decodeBase64 round-trips", () => {
    const bytes = fakePng(3, 4, 10);
    expect([...decodeBase64(toBase64(bytes))]).toEqual([...bytes]);
  });
});
