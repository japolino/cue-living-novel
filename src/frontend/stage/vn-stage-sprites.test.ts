import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import { VnStage } from "./vn-stage";
import { SPRITE_HOT_SET, type SpriteActorStage, type SpriteImageView, type SpriteSetView, type SpriteTurnView } from "../../shared/sprites";

/** VnStage sprite mode: presentation switch, paragraph staging, plates, badges. */
const actor = (characterKey: string, patch: Partial<SpriteActorStage> = {}): SpriteActorStage => ({
  characterKey, expression: "idle", slot: "center", facing: "viewer", focus: false, motion: "none", emote: "none", intensity: 3, ...patch,
});
const ready = (expression: string, url: string): SpriteImageView => ({ expression, status: "ready", url, bbox: [0.1, 0, 0.8, 1], width: 832, height: 1216 });
function set(setKey: string, name: string, images: SpriteImageView[]): SpriteSetView {
  const expressions: Record<string, SpriteImageView> = {};
  for (const id of SPRITE_HOT_SET) expressions[id] = { expression: id, status: "queued" };
  for (const image of images) expressions[image.expression] = image;
  return { setKey, name, attire: null, expressions, readyCount: images.length, updatedAt: "" };
}
const sprites: SpriteTurnView = {
  staging: {
    version: 1,
    source: "planner",
    cast: [
      { characterKey: "mira", name: "Mira", identity: "", attire: null },
      { characterKey: "ren", name: "Ren", identity: "", attire: null },
      { characterKey: "aoi", name: "Aoi", identity: "", attire: null },
    ],
    plates: [
      { plateKey: "plate_a", location: "classroom", timeOfDay: "day", weather: null, description: "" },
      { plateKey: "plate_b", location: "street", timeOfDay: "night", weather: null, description: "" },
    ],
    paragraphs: [
      { actors: [actor("mira", { focus: true, motion: "hop" })], plateKey: "plate_a", light: "day" },
      { actors: [actor("mira", { slot: "left", expression: "smile" }), actor("ren", { slot: "right", focus: true })], plateKey: null, light: "day" },
      { actors: [actor("aoi", { focus: true })], plateKey: "plate_b", light: "night" },
    ],
  },
  sets: {
    mira: set("set_mira", "Mira", [ready("idle", "/mira/idle.png"), ready("smile", "/mira/smile.png")]),
    ren: set("set_ren", "Ren", [ready("idle", "/ren/idle.png")]),
    aoi: set("set_aoi", "Aoi", []),
  },
  plates: {
    plate_a: { plateKey: "plate_a", location: "classroom", timeOfDay: "day", weather: null, status: "ready", url: "/plates/a.png" },
    plate_b: { plateKey: "plate_b", location: "street", timeOfDay: "night", weather: null, status: "generating" },
  },
};
const paragraphs = [
  { id: "t:0", text: "Mira waves.", speaker: "Mira" },
  { id: "t:1", text: "Ren answers.", speaker: "Ren" },
  { id: "t:2", text: "Night falls.", speaker: "Aoi" },
];

describe("VnStage sprite mode", () => {
  let restore: () => void;
  let mount: FakeNode;
  let stage: VnStage;
  const root = () => (stage as unknown as { root: FakeNode }).root;
  const layerEl = () => root().querySelector("[data-vn-sprites]")!;
  const badges = () => root().querySelectorAll("[data-vn-badge]").map((b) => b.textContent.trim());
  const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); };
  const advance = () => (stage as unknown as { advance(): void }).advance();

  beforeEach(() => {
    restore = installFakeDocument();
    mount = new FakeNode("div");
    stage = new VnStage({
      mount: mount as unknown as HTMLElement,
      textSpeed: 0,
      createImage: () => ({ complete: true, naturalWidth: 100, decode: async () => {}, src: "", addEventListener() {}, removeEventListener() {} }),
    });
  });
  afterEach(() => { stage.destroy(); restore(); });

  test("scene mode (default) ignores sprite staging: no sprites, no plate, no badges", async () => {
    stage.loadTurn({ mode: "standard", paragraphs, sprites });
    await flush();
    expect(stage.getPresentationMode()).toBe("scene");
    expect(layerEl().hidden).toBe(true);
    expect(layerEl().children).toHaveLength(0);
    expect(stage.getState().displayedImage).toBeNull();
    expect(badges().some((b) => b.startsWith("Preparing"))).toBe(false);
  });

  test("sprite mode stages each paragraph and paints the plate through the scene layers", async () => {
    stage.setPresentationMode("sprites");
    stage.loadTurn({ mode: "standard", paragraphs, sprites });
    await flush();
    let snap = stage.getSpriteSnapshot();
    expect(snap.mode).toBe("sprites");
    expect(snap.index).toBe(0);
    expect(snap.actors.map((a) => [a.characterKey, a.shownExpression, a.motion])).toEqual([["mira", "idle", "hop"]]);
    expect(layerEl().hidden).toBe(false);
    expect(stage.getState().displayedImage?.url).toBe("/plates/a.png");
    expect(stage.getState().displayedImage?.requestId.startsWith("plate:")).toBe(true);

    advance();
    await flush();
    snap = stage.getSpriteSnapshot();
    expect(snap.actors.map((a) => [a.characterKey, a.x, a.shownExpression, a.focus])).toEqual([["mira", 30, "smile", false], ["ren", 70, "idle", true]]);
    // The plate carries over from paragraph 0.
    expect(stage.getState().displayedImage?.url).toBe("/plates/a.png");

    advance();
    await flush();
    snap = stage.getSpriteSnapshot();
    expect(snap.light).toBe("night");
    // Aoi has nothing ready: no sprite painted, a badge instead; plate_b is not ready so plate_a stays.
    expect(snap.actors[0]!.shownExpression).toBeNull();
    expect(badges()).toContain("Preparing Aoi 0/12");
    expect(stage.getState().displayedImage?.url).toBe("/plates/a.png");

    stage.updatePlate({ plateKey: "plate_b", location: "street", timeOfDay: "night", weather: null, status: "ready", url: "/plates/b.png" });
    await flush();
    expect(stage.getState().displayedImage?.url).toBe("/plates/b.png");

    stage.updateSpriteImage("set_aoi", ready("idle", "/aoi/idle.png"));
    await flush();
    expect(stage.getSpriteSnapshot().actors[0]!.url).toBe("/aoi/idle.png");
    expect(badges().some((b) => b.startsWith("Preparing"))).toBe(false);
  });

  test("Previous re-applies the earlier paragraph's stage and plate without replaying motion", async () => {
    stage.setPresentationMode("sprites");
    stage.loadTurn({ mode: "standard", paragraphs, sprites: { ...sprites, plates: { ...sprites.plates, plate_b: { ...sprites.plates.plate_b!, status: "ready", url: "/plates/b.png" } } } });
    await flush();
    advance();
    advance();
    await flush();
    expect(stage.getState().displayedImage?.url).toBe("/plates/b.png");
    stage.previous();
    await flush();
    const snap = stage.getSpriteSnapshot();
    expect(snap.index).toBe(1);
    expect(snap.actors.map((a) => a.characterKey)).toEqual(["mira", "ren"]);
    expect(stage.getState().displayedImage?.url).toBe("/plates/a.png");
    stage.previous();
    await flush();
    const body = layerEl().querySelector("[data-vn-sprite-key='mira'] [data-vn-sprite-body]")!;
    expect(body.dataset.vnSpriteMotion).toBeUndefined();
  });

  test("effect intensity off stages without motion", async () => {
    stage.setEffectIntensity("off");
    stage.setPresentationMode("sprites");
    stage.loadTurn({ mode: "standard", paragraphs, sprites });
    await flush();
    const body = layerEl().querySelector("[data-vn-sprite-key='mira'] [data-vn-sprite-body]")!;
    expect(body.dataset.vnSpriteMotion).toBeUndefined();
  });

  test("the reader's own line keeps the last stage", async () => {
    stage.setPresentationMode("sprites");
    stage.loadTurn({ mode: "standard", paragraphs: paragraphs.slice(0, 2), sprites });
    await flush();
    advance();
    advance(); // awaiting input
    stage.presentUserParagraph("Hello!");
    await flush();
    expect(stage.getSpriteSnapshot().actors.map((a) => a.characterKey)).toEqual(["mira", "ren"]);
  });

  test("switching back to scene mode removes sprites and the plate; switching again restores them", async () => {
    stage.setPresentationMode("sprites");
    stage.loadTurn({ mode: "standard", paragraphs, sprites });
    await flush();
    expect(layerEl().querySelectorAll("[data-vn-sprite]")).toHaveLength(1);
    stage.setPresentationMode("scene");
    await flush();
    expect(layerEl().querySelectorAll("[data-vn-sprite]")).toHaveLength(0);
    expect(layerEl().hidden).toBe(true);
    expect(stage.getState().displayedImage).toBeNull();
    expect(root().dataset.vnPresentation).toBe("scene");
    stage.setPresentationMode("sprites");
    await flush();
    expect(layerEl().querySelectorAll("[data-vn-sprite]")).toHaveLength(1);
    expect(stage.getState().displayedImage?.url).toBe("/plates/a.png");
  });

  test("scene images in scene mode are not cleared by a switch (only plates are)", async () => {
    stage.loadTurn({ mode: "standard", paragraphs });
    await stage.setSceneImage({ url: "/scene.png", requestId: "scene-1" });
    stage.setPresentationMode("sprites");
    stage.setPresentationMode("scene");
    expect(stage.getState().displayedImage?.url).toBe("/scene.png");
  });

  test("a new turn without sprites clears the previous staging; reset clears everything", async () => {
    stage.setPresentationMode("sprites");
    stage.loadTurn({ mode: "standard", paragraphs, sprites });
    await flush();
    stage.loadTurn({ mode: "standard", paragraphs: [{ id: "n:0", text: "Plain turn." }], preserveImage: true });
    await flush();
    expect(layerEl().querySelectorAll("[data-vn-sprite]")).toHaveLength(0);
    stage.setSpriteTurn(sprites);
    await flush();
    expect(layerEl().querySelectorAll("[data-vn-sprite]")).toHaveLength(1);
    stage.reset();
    expect(layerEl().querySelectorAll("[data-vn-sprite]")).toHaveLength(0);
    expect(stage.getSpriteSnapshot().index).toBe(-1);
  });

  test("the talking bob follows the typewriter state", async () => {
    stage.setPresentationMode("sprites");
    stage.loadTurn({ mode: "standard", paragraphs, sprites });
    await flush();
    const mira = () => layerEl().querySelector("[data-vn-sprite-key='mira']")!;
    // The fake DOM has no TreeWalker, so drive the typing flag directly.
    const internals = stage as unknown as { isTyping: boolean; updateContinueButton(): void; completeTypewriter(): void };
    internals.isTyping = true;
    internals.updateContinueButton();
    expect(mira().dataset.vnSpriteTalking).toBe("true");
    internals.completeTypewriter();
    expect(mira().dataset.vnSpriteTalking).toBe("false");
  });
});

describe("VnStage sprite mode: key illustrations", () => {
  let restore: () => void;
  let mount: FakeNode;
  let stage: VnStage;
  const root = () => (stage as unknown as { root: FakeNode }).root;
  const layerEl = () => root().querySelector("[data-vn-sprites]")!;
  const badges = () => root().querySelectorAll("[data-vn-badge]").map((b) => b.textContent.trim());
  const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); };
  const advance = () => (stage as unknown as { advance(): void }).advance();
  const illustrated: SpriteTurnView = {
    ...sprites,
    staging: { ...sprites.staging, paragraphs: sprites.staging.paragraphs.map((p, i) => (i === 1 ? { ...p, illustrate: true } : p)) },
    illustrations: [{ paragraphIndex: 1, jobId: "job-1", status: "ready", url: "/scene/kiss.png" }],
  };

  beforeEach(() => {
    restore = installFakeDocument();
    mount = new FakeNode("div");
    stage = new VnStage({
      mount: mount as unknown as HTMLElement,
      textSpeed: 0,
      createImage: () => ({ complete: true, naturalWidth: 100, decode: async () => {}, src: "", addEventListener() {}, removeEventListener() {} }),
    });
    stage.setPresentationMode("sprites");
  });
  afterEach(() => { stage.destroy(); restore(); });

  test("a ready illustration replaces the sprites for its paragraph and the plate comes back after it", async () => {
    stage.loadTurn({ mode: "standard", paragraphs, sprites: illustrated });
    await flush();
    expect(stage.getState().displayedImage?.url).toBe("/plates/a.png");
    expect(stage.getSpriteSnapshot().illustration).toBeNull();
    advance();
    await flush();
    expect(stage.getState().displayedImage?.url).toBe("/scene/kiss.png");
    expect(stage.getState().displayedImage?.requestId.startsWith("illustration:")).toBe(true);
    expect(stage.getState().displayedImage?.alt).toBe("Illustration for paragraph 2");
    expect(stage.getSpriteSnapshot().illustration).toBe("/scene/kiss.png");
    expect(layerEl().dataset.vnSpriteIllustrated).toBe("true");
    // The staging still applies underneath (Previous/next stay consistent).
    expect(stage.getSpriteSnapshot().actors.map((a) => a.characterKey)).toEqual(["mira", "ren"]);
    // Previous: back to the plate and the sprites.
    stage.previous();
    await flush();
    expect(stage.getState().displayedImage?.url).toBe("/plates/a.png");
    expect(stage.getSpriteSnapshot().illustration).toBeNull();
    expect(layerEl().dataset.vnSpriteIllustrated).toBeUndefined();
    advance();
    await flush();
    expect(stage.getSpriteSnapshot().illustration).toBe("/scene/kiss.png");
    // Next paragraph without the flag: sprites again; plate_b is not ready, so the illustration is cleared.
    advance();
    await flush();
    expect(stage.getSpriteSnapshot().illustration).toBeNull();
    expect(stage.getState().displayedImage).toBeNull();
    expect(badges()).toContain("Preparing Aoi 0/12");
  });

  test("not ready yet: the sprite stage stays; it switches once the picture arrives", async () => {
    const pending: SpriteTurnView = { ...illustrated, illustrations: [{ paragraphIndex: 1, jobId: "job-1", status: "pending" }] };
    stage.loadTurn({ mode: "standard", paragraphs, sprites: pending });
    await flush();
    advance();
    await flush();
    expect(stage.getSpriteSnapshot().illustration).toBeNull();
    expect(stage.getState().displayedImage?.url).toBe("/plates/a.png");
    stage.setSpriteTurn(illustrated);
    await flush();
    expect(stage.getSpriteSnapshot().illustration).toBe("/scene/kiss.png");
    expect(stage.getState().displayedImage?.url).toBe("/scene/kiss.png");
  });

  test("a flag without a picture, or a picture without the flag, changes nothing", async () => {
    const noFlag: SpriteTurnView = { ...sprites, illustrations: illustrated.illustrations! };
    stage.loadTurn({ mode: "standard", paragraphs, sprites: noFlag });
    await flush();
    advance();
    await flush();
    expect(stage.getSpriteSnapshot().illustration).toBeNull();
    expect(stage.getState().displayedImage?.url).toBe("/plates/a.png");
  });

  test("switching to scene mode clears an illustration like a plate", async () => {
    stage.loadTurn({ mode: "standard", paragraphs, sprites: illustrated });
    await flush();
    advance();
    await flush();
    expect(stage.getState().displayedImage?.url).toBe("/scene/kiss.png");
    stage.setPresentationMode("scene");
    await flush();
    expect(stage.getState().displayedImage).toBeNull();
  });
});
