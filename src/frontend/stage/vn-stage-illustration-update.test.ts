import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import { VnStage } from "./vn-stage";
import type { SpriteActorStage, SpriteTurnView } from "../../shared/sprites";

/** VnStage.updateIllustration: the host forwards a key-moment `vn_asset` without re-sending the turn. */
const actor = (characterKey: string, patch: Partial<SpriteActorStage> = {}): SpriteActorStage => ({
  characterKey, expression: "idle", slot: "center", facing: "viewer", focus: false, motion: "none", emote: "none", intensity: 3, ...patch,
});
const sprites: SpriteTurnView = {
  staging: {
    version: 1,
    source: "planner",
    cast: [{ characterKey: "mira", name: "Mira", identity: "", attire: null }],
    plates: [{ plateKey: "plate_a", location: "classroom", timeOfDay: "day", weather: null, description: "" }],
    paragraphs: [
      { actors: [actor("mira", { focus: true })], plateKey: "plate_a", light: "day" },
      { actors: [actor("mira", { focus: true })], plateKey: null, light: "day", illustrate: true, moment: { interaction: "kiss", characters: ["mira"], partner: true } },
    ],
  },
  sets: { mira: { setKey: "set_mira", name: "Mira", attire: null, expressions: { idle: { expression: "idle", status: "ready", url: "/mira/idle.png", bbox: [0.1, 0, 0.8, 1], width: 832, height: 1216 } }, readyCount: 1, updatedAt: "" } },
  plates: { plate_a: { plateKey: "plate_a", location: "classroom", timeOfDay: "day", weather: null, status: "ready", url: "/plates/a.png" } },
  illustrations: [{ paragraphIndex: 1, jobId: "job-1", status: "pending" }],
};
const paragraphs = [
  { id: "t:0", text: "Mira waits.", speaker: "Mira" },
  { id: "t:1", text: "She kisses him.", speaker: "" },
];

describe("VnStage.updateIllustration (sprite mode)", () => {
  let restore: () => void;
  let stage: VnStage;
  const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); };
  const advance = () => (stage as unknown as { advance(): void }).advance();

  beforeEach(() => {
    restore = installFakeDocument();
    stage = new VnStage({
      mount: new FakeNode("div") as unknown as HTMLElement,
      textSpeed: 0,
      createImage: () => ({ complete: true, naturalWidth: 100, decode: async () => {}, src: "", addEventListener() {}, removeEventListener() {} }),
    });
    stage.setPresentationMode("sprites");
  });
  afterEach(() => { stage.destroy(); restore(); });

  test("a ready picture for the current key paragraph replaces the sprites without a turn reload", async () => {
    stage.loadTurn({ mode: "standard", paragraphs, sprites });
    await flush();
    advance();
    await flush();
    expect(stage.getSpriteSnapshot().illustration).toBeNull();
    stage.updateIllustration(1, { paragraphIndex: 1, jobId: "job-1", status: "ready", url: "/scene/kiss.png" });
    await flush();
    expect(stage.getState().displayedImage?.url).toBe("/scene/kiss.png");
    expect(stage.getSpriteSnapshot().illustration).toBe("/scene/kiss.png");
    // The cursor did not move and the paragraph did not reload.
    expect(stage.getState().currentParagraphIndex).toBe(1);
  });

  test("a failed picture keeps the sprites; a paragraph without the flag or an unchanged view is a no-op", async () => {
    stage.loadTurn({ mode: "standard", paragraphs, sprites });
    await flush();
    advance();
    await flush();
    stage.updateIllustration(1, { paragraphIndex: 1, jobId: "job-1", status: "failed" });
    await flush();
    expect(stage.getSpriteSnapshot().illustration).toBeNull();
    expect(stage.getState().displayedImage?.url).toBe("/plates/a.png");
    stage.updateIllustration(0, { paragraphIndex: 0, jobId: "job-x", status: "ready", url: "/scene/other.png" });
    await flush();
    expect(stage.getState().displayedImage?.url).toBe("/plates/a.png");
    // Without a sprite view there is nothing to update.
    stage.setSpriteTurn(null);
    expect(() => stage.updateIllustration(1, { paragraphIndex: 1, jobId: "job-1", status: "ready", url: "/x.png" })).not.toThrow();
  });
});
