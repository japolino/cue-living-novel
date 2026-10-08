import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../config.js";
import type { FrontendRequest } from "../../protocol.js";
import { DEFAULT_SPRITE_FACE_MODEL_URL, type SpriteImageView, type SpriteTurnView } from "../../shared/sprites.js";
import type { FaceDetection } from "./cutout/index.js";
import { createSpriteFaceService } from "./face-service.js";

const ready = (expression: string, url: string, extra: Partial<SpriteImageView> = {}): SpriteImageView => ({ expression, status: "ready", url, bbox: [0, 0, 1, 1], width: 624, height: 912, ...extra });

function view(): SpriteTurnView {
  return {
    staging: {
      version: 1, source: "planner",
      cast: [{ characterKey: "rin", name: "Rin", identity: "", attire: null }],
      plates: [],
      paragraphs: [{ actors: [{ characterKey: "rin", expression: "smile", slot: "center", facing: "viewer", focus: true, motion: "none", emote: "blush", intensity: 3 }], plateKey: null, light: "neutral" }],
    },
    sets: {
      rin: {
        setKey: "set_rin", name: "Rin", attire: null, readyCount: 3, updatedAt: "",
        expressions: {
          idle: ready("idle", "/img/idle"),
          smile: ready("smile", "/img/smile"),
          sad: ready("sad", "/img/sad", { face: [0.4, 0.1, 0.2, 0.1] }),
          angry: { expression: "angry", status: "generating" },
        },
      },
    },
    plates: {},
  };
}

function setup(options: { config?: Partial<VisualNovelConfig> | null; fail?: (url: string) => boolean } = {}) {
  const sent: FrontendRequest[] = [];
  const fetched: string[] = [];
  const detected: string[] = [];
  let clock = 1000;
  const config = options.config === null ? null : { ...DEFAULT_CONFIG, spriteCutout: "best" as const, ...options.config };
  const service = createSpriteFaceService({
    sendToBackend: (message) => sent.push(message),
    fetchImage: async (url) => { fetched.push(url); return new Blob([url]); },
    getConfig: () => config,
    detect: async (image, opts): Promise<FaceDetection> => {
      const url = await image.text();
      expect(opts.modelUrl).toBe(DEFAULT_SPRITE_FACE_MODEL_URL);
      detected.push(url);
      if (options.fail?.(url)) throw new Error("model blocked");
      return url.endsWith("idle") ? { face: null, score: null, count: 0, durationMs: 1 } : { face: [0.4, 0.2, 0.2, 0.12], score: 0.9, count: 1, durationMs: 1 };
    },
    delayMs: 0,
    now: () => clock,
  });
  return { service, sent, fetched, detected, advance: (ms: number) => { clock += ms; } };
}

describe("sprite face backfill", () => {
  test("detects ready images without a face, the staged one first, and saves through the backend", async () => {
    const { service, sent, detected } = setup();
    service.wantView(view());
    await service.idle();
    expect(detected).toEqual(["/img/smile", "/img/idle"]);
    expect(sent).toEqual([
      { type: "vn_sprite_face", setKey: "set_rin", expression: "smile", url: "/img/smile", face: [0.4, 0.2, 0.2, 0.12] },
      { type: "vn_sprite_face", setKey: "set_rin", expression: "idle", url: "/img/idle", face: null },
    ]);
  });

  test("each URL once per page; images with a face (or null) are skipped", async () => {
    const { service, detected } = setup();
    service.wantView(view());
    service.wantView(view());
    service.want("set_rin", ready("smile", "/img/smile"));
    service.want("set_rin", ready("laughing", "/img/laughing", { face: null }));
    await service.idle();
    expect(detected).toEqual(["/img/smile", "/img/idle"]);
  });

  test("basic quality and a missing config download nothing", async () => {
    for (const config of [{ spriteCutout: "basic" as const }, null]) {
      const { service, fetched } = setup({ config });
      service.wantView(view());
      await service.idle();
      expect(fetched).toEqual([]);
    }
  });

  test("a failure pauses the backfill, then the same images are tried again", async () => {
    let failing = true;
    const { service, sent, detected, advance } = setup({ fail: () => failing });
    service.wantView(view());
    await service.idle();
    expect(detected).toEqual(["/img/smile"]);
    expect(sent).toEqual([]);
    service.wantView(view());
    await service.idle();
    expect(detected).toHaveLength(1);
    failing = false;
    advance(61_000);
    service.wantView(view());
    await service.idle();
    expect(sent.map((message) => (message as { url: string }).url)).toEqual(["/img/smile", "/img/idle"]);
  });

  test("dispose stops the queue", async () => {
    const { service, sent } = setup();
    service.dispose();
    service.wantView(view());
    await service.idle();
    expect(sent).toEqual([]);
  });
});
