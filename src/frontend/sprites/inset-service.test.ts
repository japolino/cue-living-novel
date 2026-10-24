import { describe, expect, test } from "bun:test";
import type { FrontendRequest } from "../../protocol.js";
import { NOVELAI_INSET_LAYOUTS, type NovelAiInsetLayout } from "../../shared/novelai-inset.js";
import { SPRITE_CUT_CHUNK_CHARS } from "../../shared/sprites.js";
import { createNovelAiInsetService, type NovelAiInsetRequest } from "./inset-service.js";

type Sent = Extract<FrontendRequest, { type: "vn_novelai_inset_result" }>;

const request = (requestId: string, extra: Partial<NovelAiInsetRequest> = {}): NovelAiInsetRequest => ({ type: "vn_novelai_inset", requestId, layout: "sprite", imageId: `img-${requestId}`, ...extra });

function setup(options: { compose?: (reference: Blob, layout: NovelAiInsetLayout) => Promise<{ image: Blob; mask: Blob }>; fetchImage?: (imageId: string) => Promise<Blob> } = {}) {
  const sent: Sent[] = [];
  const composed: Array<{ reference: string; layout: NovelAiInsetLayout }> = [];
  const service = createNovelAiInsetService({
    sendToBackend: (message) => sent.push(message as Sent),
    fetchImage: options.fetchImage ?? (async (id) => new Blob([id], { type: "image/png" })),
    compose: async (reference, layout) => {
      composed.push({ reference: await reference.text(), layout });
      return (options.compose ?? (async () => ({ image: new Blob([new Uint8Array([1, 2, 3])]), mask: new Blob([new Uint8Array([4, 5])]) })))(reference, layout);
    },
  });
  return { service, sent, composed };
}

describe("NovelAI V5 inset service (browser)", () => {
  test("fetches the reference by id, composes the layout and replies with the image and mask parts", async () => {
    const { service, sent, composed } = setup();
    await service.handle(request("a"));
    expect(composed).toEqual([{ reference: "img-a", layout: NOVELAI_INSET_LAYOUTS.sprite }]);
    expect(sent).toEqual([
      { type: "vn_novelai_inset_result", requestId: "a", part: "image", chunkIndex: 0, chunkCount: 1, dataBase64: "AQID" },
      { type: "vn_novelai_inset_result", requestId: "a", part: "mask", chunkIndex: 0, chunkCount: 1, dataBase64: "BAU=" },
    ]);
  });

  test("a reference can also come as base64", async () => {
    const { service, composed } = setup();
    await service.handle({ type: "vn_novelai_inset", requestId: "b", layout: "sprite", dataBase64: btoa("inline"), mimeType: "image/png" });
    expect(composed[0]!.reference).toBe("inline");
  });

  test("large canvases go out in ordered chunks", async () => {
    const bytes = new Uint8Array(2_400_000).map((_, index) => index * 13);
    const { service, sent } = setup({ compose: async () => ({ image: new Blob([bytes]), mask: new Blob([new Uint8Array([9])]) }) });
    await service.handle(request("big"));
    const image = sent.filter((message) => message.part === "image");
    expect(image.length).toBeGreaterThan(1);
    expect(image.every((message) => message.chunkCount === image.length && (message.dataBase64?.length ?? 0) <= SPRITE_CUT_CHUNK_CHARS)).toBe(true);
    expect(Buffer.from(image.map((message) => message.dataBase64).join(""), "base64").equals(Buffer.from(bytes))).toBe(true);
    expect(sent.filter((message) => message.part === "mask")).toHaveLength(1);
  });

  test("failures reply once with an error (fetch, unknown layout, no reference)", async () => {
    const failing = setup({ fetchImage: async () => { throw new Error("Image fetch failed (404)."); } });
    await failing.service.handle(request("x"));
    expect(failing.sent).toEqual([{ type: "vn_novelai_inset_result", requestId: "x", chunkIndex: 0, chunkCount: 1, error: "Image fetch failed (404)." }]);
    const unknown = setup();
    await unknown.service.handle(request("y", { layout: "scene" as "sprite" }));
    expect(unknown.sent[0]!.error).toContain("Unknown inset layout");
    expect(unknown.composed).toHaveLength(0);
    const none = setup();
    await none.service.handle({ type: "vn_novelai_inset", requestId: "z", layout: "sprite" });
    expect(none.sent[0]!.error).toContain("no usable reference");
  });

  test("duplicates in flight are ignored; nothing is sent after dispose", async () => {
    let release!: () => void;
    const { service, sent } = setup({ compose: async () => { await new Promise<void>((resolve) => { release = resolve; }); return { image: new Blob([new Uint8Array([1])]), mask: new Blob([new Uint8Array([2])]) }; } });
    const first = service.handle(request("a"));
    const duplicate = service.handle(request("a"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    service.dispose();
    release();
    await Promise.all([first, duplicate, service.handle(request("b"))]);
    expect(sent).toEqual([]);
  });
});
