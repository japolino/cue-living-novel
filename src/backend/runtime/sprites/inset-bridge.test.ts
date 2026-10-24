import { describe, expect, test } from "bun:test";
import { SPRITE_CUT_CHUNK_CHARS } from "../../../shared/sprites.js";
import { fakePng, toBase64 } from "./__fixtures__/sprite-fixtures.js";
import { NovelAiInsetBridge, type NovelAiInsetResultMessage } from "./inset-bridge.js";

type Sent = { type: string; requestId: string; layout: string; imageId?: string; userId?: string };

function setup(timeoutMs = 1000) {
  const sent: Sent[] = [];
  const bridge = new NovelAiInsetBridge({ send: (message, userId) => sent.push({ ...message, ...(userId ? { userId } : {}) } as Sent), timeoutMs });
  const reply = (requestId: string, part: "image" | "mask", data: string, chunkIndex = 0, chunkCount = 1, userId = "u1") =>
    bridge.accept(userId, { type: "vn_novelai_inset_result", requestId, part, chunkIndex, chunkCount, dataBase64: data } as NovelAiInsetResultMessage);
  return { bridge, sent, reply };
}

const canvasPng = () => toBase64(fakePng(1216, 832, 120));
const maskPng = () => toBase64(fakePng(1216, 832, 9));

describe("NovelAI V5 inset bridge", () => {
  test("asks the browser for the layout and the reference id, and returns both PNGs as base64", async () => {
    const f = setup();
    const pending = f.bridge.compose("u1", { layout: "sprite", imageId: "raw-idle" });
    expect(f.sent).toEqual([{ type: "vn_novelai_inset", requestId: f.sent[0]!.requestId, layout: "sprite", imageId: "raw-idle", userId: "u1" }]);
    const image = canvasPng();
    // The image in two chunks, out of order, and the mask in one.
    const split = 40;
    expect(f.reply(f.sent[0]!.requestId, "image", image.slice(split), 1, 2)).toBe("buffered");
    expect(f.reply(f.sent[0]!.requestId, "mask", maskPng())).toBe("buffered");
    expect(f.reply(f.sent[0]!.requestId, "image", image.slice(0, split), 0, 2)).toBe("settled");
    expect(await pending).toEqual({ ok: true, canvas: { image, mask: maskPng() } });
    expect(f.bridge.outstanding("u1")).toEqual([]);
  });

  test("a PNG of the wrong size, not a PNG, or an error reply fails the composition", async () => {
    const f = setup();
    const wrong = f.bridge.compose("u1", { layout: "sprite", imageId: "a" });
    f.reply(f.sent[0]!.requestId, "image", toBase64(fakePng(832, 1216)));
    f.reply(f.sent[0]!.requestId, "mask", maskPng());
    expect(await wrong).toEqual({ ok: false, error: "The inset image is 832×1216, expected 1216×832." });

    const garbage = f.bridge.compose("u1", { layout: "sprite", imageId: "b" });
    f.reply(f.sent[1]!.requestId, "image", btoa("this is not a png image at all, sorry...."));
    f.reply(f.sent[1]!.requestId, "mask", maskPng());
    expect(await garbage).toMatchObject({ ok: false, error: "The inset image is not a PNG image." });

    const failed = f.bridge.compose("u1", { layout: "sprite", imageId: "c" });
    f.bridge.accept("u1", { type: "vn_novelai_inset_result", requestId: f.sent[2]!.requestId, chunkIndex: 0, chunkCount: 1, error: "Image fetch failed (404)." });
    expect(await failed).toEqual({ ok: false, error: "Image fetch failed (404)." });
  });

  test("replies from another user and unknown ids are ignored; oversize chunks fail", async () => {
    const f = setup();
    const pending = f.bridge.compose("u1", { layout: "sprite", imageId: "a" });
    const id = f.sent[0]!.requestId;
    expect(f.reply(id, "image", canvasPng(), 0, 1, "u2")).toBe("ignored");
    expect(f.reply("nope", "image", canvasPng())).toBe("ignored");
    expect(f.reply(id, "image", "A".repeat(SPRITE_CUT_CHUNK_CHARS + 4))).toBe("settled");
    expect(await pending).toMatchObject({ ok: false });
  });

  test("times out, and an abort settles at once", async () => {
    const f = setup(30);
    expect(await f.bridge.compose("u1", { layout: "sprite", imageId: "a" })).toEqual({ ok: false, error: "The browser did not compose the inset in time.", timedOut: true });
    const controller = new AbortController();
    const pending = f.bridge.compose("u1", { layout: "sprite", imageId: "b" }, { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: "Cancelled." });
    expect(f.bridge.outstanding("u1")).toEqual([]);
    // An already aborted signal sends nothing.
    const before = f.sent.length;
    expect(await f.bridge.compose("u1", { layout: "sprite", imageId: "c" }, { signal: controller.signal })).toEqual({ ok: false, error: "Cancelled." });
    expect(f.sent).toHaveLength(before);
  });

  test("a reloaded page gets pending requests again under the same id (parts received so far are dropped)", async () => {
    const f = setup();
    const pending = f.bridge.compose("u1", { layout: "sprite", imageId: "raw-idle" });
    const other = f.bridge.compose("u2", { layout: "sprite", imageId: "raw-other" });
    const requestId = f.sent[0]!.requestId;
    // Half of the image arrived from the page that went away.
    const image = canvasPng();
    expect(f.reply(requestId, "image", image.slice(0, 40), 0, 2)).toBe("buffered");
    expect(f.bridge.resend("u1")).toBe(1);
    expect(f.sent).toHaveLength(3);
    expect(f.sent[2]).toEqual({ type: "vn_novelai_inset", requestId, layout: "sprite", imageId: "raw-idle", userId: "u1" });
    // The new page answers in one chunk (another chunk count than before).
    expect(f.reply(requestId, "image", image)).toBe("buffered");
    expect(f.reply(requestId, "mask", maskPng())).toBe("settled");
    expect(await pending).toEqual({ ok: true, canvas: { image, mask: maskPng() } });
    // Nothing settled for the other user; a request still busy is left alone.
    expect(f.bridge.outstanding("u2")).toHaveLength(1);
    expect(f.bridge.resend("u2", 60_000)).toBe(0);
    expect(f.sent).toHaveLength(3);
    f.bridge.dispose();
    await other;
  });

  test("an unknown layout is refused without asking the browser", async () => {
    const f = setup();
    expect(await f.bridge.compose("u1", { layout: "scene" as "sprite", imageId: "a" })).toMatchObject({ ok: false });
    expect(f.sent).toHaveLength(0);
  });
});
