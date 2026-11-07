import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import { PLATE_LOAD_RETRY_MS, VnStage } from "./vn-stage";
import type { SpriteActorStage, SpriteTurnView } from "../../shared/sprites";

/** Sprite mode: a plate that failed to load on the stage is not given up for good. */
const actor = (patch: Partial<SpriteActorStage> = {}): SpriteActorStage => ({
  characterKey: "mira", expression: "idle", slot: "center", facing: "viewer", focus: true, motion: "none", emote: "none", intensity: 3, ...patch,
});
const plate = (plateKey: string, url: string) => ({ plateKey, location: plateKey, timeOfDay: "day", weather: null, status: "ready" as const, url });
const sprites = (plateKeys: readonly string[]): SpriteTurnView => ({
  staging: {
    version: 1,
    source: "planner",
    cast: [{ characterKey: "mira", name: "Mira", identity: "", attire: null }],
    plates: [...new Set(plateKeys)].map((plateKey) => ({ plateKey, location: plateKey, timeOfDay: "day", weather: null, description: "" })),
    paragraphs: plateKeys.map((plateKey) => ({ actors: [actor()], plateKey, light: "day" as const })),
  },
  sets: { mira: { setKey: "set_mira", name: "Mira", attire: null, expressions: { idle: { expression: "idle", status: "ready", url: "/mira/idle.png", bbox: [0.1, 0, 0.8, 1], width: 832, height: 1216 } }, readyCount: 1, updatedAt: "" } },
  plates: { a: plate("a", "/plates/a.png"), b: plate("b", "/plates/b.png") },
});
const paragraphs = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `t:${i}`, text: `Line ${i}.`, speaker: "Mira" }));

describe("sprite plates that failed to load", () => {
  let restore: () => void;
  let stage: VnStage;
  /** URLs whose load fails, and URLs whose load waits for a release. */
  const failing = new Set<string>();
  const held = new Map<string, Promise<void>>();
  const attempts: string[] = [];
  const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); };
  const advance = () => (stage as unknown as { advance(): void }).advance();
  const shown = () => stage.getState().displayedImage?.url ?? null;

  beforeEach(() => {
    restore = installFakeDocument();
    failing.clear();
    held.clear();
    attempts.length = 0;
    stage = new VnStage({
      mount: new FakeNode("div") as unknown as HTMLElement,
      textSpeed: 0,
      createImage: () => {
        const image = {
          complete: true, naturalWidth: 100, src: "", addEventListener() {}, removeEventListener() {},
          decode: async () => {
            await held.get(image.src);
            if (failing.has(image.src)) throw new Error("The scene image could not be loaded.");
          },
        };
        return image;
      },
    });
    stage.setPresentationMode("sprites");
    // The stage's own plate requests (the plate light reads the same picture too).
    const inner = stage as unknown as { loadSceneImage(request: { url: string; requestId?: string }): Promise<unknown> };
    const load = inner.loadSceneImage.bind(stage);
    inner.loadSceneImage = (request) => {
      if (request.url.startsWith("/plates/")) attempts.push(request.url);
      return load(request);
    };
  });
  afterEach(() => { stage.destroy(); restore(); setSystemTime(); });

  test("is asked for again once the retry window has passed", async () => {
    failing.add("/plates/a.png");
    stage.loadTurn({ paragraphs: paragraphs(3), sprites: sprites(["a", "a", "a"]) });
    await flush();
    expect(shown()).toBeNull();
    const afterLoad = attempts.length;
    expect(afterLoad).toBe(1);
    // Within the window the next paragraph does not ask again.
    advance();
    await flush();
    expect(attempts.length).toBe(afterLoad);
    expect(shown()).toBeNull();
    // The provider (or the network) is back; the window has passed.
    failing.clear();
    setSystemTime(new Date(Date.now() + PLATE_LOAD_RETRY_MS + 1));
    advance();
    await flush();
    expect(attempts.length).toBeGreaterThan(afterLoad);
    expect(shown()).toBe("/plates/a.png");
  });

  test("a load that a newer request replaced is not counted as failed", async () => {
    let releaseA!: () => void;
    held.set("/plates/a.png", new Promise<void>((resolve) => { releaseA = resolve; }));
    failing.add("/plates/b.png");
    stage.loadTurn({ paragraphs: paragraphs(2), sprites: sprites(["a", "b"]) });
    await flush();
    // The reader moves on before plate a arrives; plate b fails at once.
    advance();
    await flush();
    expect(stage.getState().imageError).not.toBeNull();
    releaseA();
    await flush();
    // Back on paragraph 0, plate a is healthy and shows.
    stage.previous();
    await flush();
    expect(shown()).toBe("/plates/a.png");
  });
});
