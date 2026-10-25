import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import {
  effectivePlateKey,
  illustrationFor,
  layoutSpriteActors,
  narrowSpriteX,
  SPRITE_NARROW_X,
  resolveSpriteImage,
  estimateSpriteFace,
  spriteEmoteMarkup,
  spriteFaceSpot,
  spriteFaceVars,
  spriteGeometry,
  spriteGeometryVars,
  spriteFaceShift,
  spriteFaceTop,
  spriteHeadLift,
  spriteSizeMatchZoom,
  spriteDimmedKeys,
  spriteFigureBox,
  spriteMirrored,
  spritePreloadUrls,
  spritePressTarget,
  SPRITE_PRESS_MS,
  spriteStatusBadges,
  SpriteLayer,
  withPlate,
  withSpriteImage,
} from "./sprite-layer";
import {
  SPRITE_EMOTES,
  SPRITE_HOT_SET,
  type SpriteActorStage,
  type SpriteImageView,
  type SpriteSetView,
  type SpriteTurnView,
} from "../../shared/sprites";
import { DEFAULT_CONFIG, spriteSizeMatchSettings, type VisualNovelSpriteSizeMatch } from "../../config";

const actor = (characterKey: string, patch: Partial<SpriteActorStage> = {}): SpriteActorStage => ({
  characterKey, expression: "idle", slot: "center", facing: "viewer", focus: false, motion: "none", emote: "none", intensity: 3, ...patch,
});

const ready = (expression: string, url = `/img/${expression}.png`, extra: Partial<SpriteImageView> = {}): SpriteImageView => ({
  expression, status: "ready", url, bbox: [0.1, 0.02, 0.8, 0.98], width: 832, height: 1216, ...extra,
});

function set(setKey: string, name: string, images: SpriteImageView[]): SpriteSetView {
  const expressions: Record<string, SpriteImageView> = {};
  for (const id of SPRITE_HOT_SET) expressions[id] = { expression: id, status: "queued" };
  for (const image of images) expressions[image.expression] = image;
  return { setKey, name, attire: null, expressions, readyCount: images.filter((i) => i.status === "ready").length, updatedAt: "2026-10-01T00:00:00Z" };
}

function turnView(paragraphs: SpriteTurnView["staging"]["paragraphs"], sets: Record<string, SpriteSetView> = {
  mira: set("set_mira", "Mira", [ready("idle", "/mira/idle.png"), ready("smile", "/mira/smile.png")]),
  ren: set("set_ren", "Ren", [ready("idle", "/ren/idle.png")]),
}): SpriteTurnView {
  return {
    staging: {
      version: 1,
      source: "planner",
      cast: [
        { characterKey: "mira", name: "Mira", identity: "blonde", attire: null },
        { characterKey: "ren", name: "Ren", identity: "black hair", attire: null },
        { characterKey: "aoi", name: "Aoi", identity: "long black hair", attire: null },
      ],
      plates: [{ plateKey: "plate_a", location: "classroom", timeOfDay: "day", weather: null, description: "" }],
      paragraphs,
    },
    sets,
    plates: { plate_a: { plateKey: "plate_a", location: "classroom", timeOfDay: "day", weather: null, status: "ready", url: "/plates/a.png" } },
  };
}

describe("sprite layout and choice helpers", () => {
  test("one actor stands at its slot; two and three spread left to right in slot order", () => {
    expect(layoutSpriteActors([actor("a", { slot: "center" })]).map((p) => p.x)).toEqual([50]);
    expect(layoutSpriteActors([actor("a", { slot: "left" })]).map((p) => p.x)).toEqual([32]);
    expect(layoutSpriteActors([actor("a", { slot: "right" })]).map((p) => p.x)).toEqual([68]);
    const two = layoutSpriteActors([actor("b", { slot: "right" }), actor("a", { slot: "left" })]);
    expect(two.map((p) => [p.actor.characterKey, p.x, p.order])).toEqual([["a", 30, 0], ["b", 70, 1]]);
    const three = layoutSpriteActors([actor("c", { slot: "right" }), actor("a", { slot: "left" }), actor("b", { slot: "center" })]);
    expect(three.map((p) => [p.actor.characterKey, p.x])).toEqual([["a", 19], ["b", 50], ["c", 81]]);
  });

  test("duplicate keys and actors beyond the third are dropped", () => {
    const placed = layoutSpriteActors([actor("a"), actor("a", { slot: "left" }), actor("b", { slot: "left" }), actor("c", { slot: "right" }), actor("d")]);
    expect(placed.map((p) => p.actor.characterKey)).toEqual(["b", "a", "c"]);
  });

  test("an unready expression falls back with bestAvailableExpression; nothing ready gives null", () => {
    const mira = set("set_mira", "Mira", [ready("idle"), ready("laughing")]);
    expect(resolveSpriteImage(mira, "laughing")?.expression).toBe("laughing");
    expect(resolveSpriteImage(mira, "giggling")?.expression).toBe("laughing");
    expect(resolveSpriteImage(mira, "sad")?.expression).toBe("idle");
    expect(resolveSpriteImage(set("s", "X", [ready("smug")]), "sad")?.expression).toBe("smug");
    expect(resolveSpriteImage(set("s", "X", []), "idle")).toBeNull();
    expect(resolveSpriteImage(undefined, "idle")).toBeNull();
    // A "ready" image without a URL cannot be shown.
    expect(resolveSpriteImage(set("s", "X", [{ expression: "idle", status: "ready" }]), "idle")).toBeNull();
  });

  test("the plate in effect is the paragraph's own or the latest earlier one", () => {
    const view = turnView([
      { actors: [], plateKey: null, light: "neutral" },
      { actors: [], plateKey: "plate_a", light: "neutral" },
      { actors: [], plateKey: null, light: "neutral" },
      { actors: [], plateKey: "plate_b", light: "neutral" },
    ]);
    expect([0, 1, 2, 3, 9].map((i) => effectivePlateKey(view, i))).toEqual([null, "plate_a", "plate_a", "plate_b", "plate_b"]);
    expect(effectivePlateKey(null, 0)).toBeNull();
  });

  test("geometry bottom-anchors the bbox and caps by width", () => {
    const g = spriteGeometry({ bbox: [0.1, 0.05, 0.6, 0.95], width: 832, height: 1216 });
    expect(g.aspect).toBeCloseTo(832 / 1216);
    expect(g.scale).toBeCloseTo(1 / 0.95);
    expect(g.fit).toBeCloseTo(1 / (0.6 * (832 / 1216)));
    expect(g.cx).toBeCloseTo(0.4);
    expect(g.by).toBeCloseTo(1);
    const vars = spriteGeometryVars(g);
    expect(Object.keys(vars).sort()).toEqual(["--vn-sprite-a", "--vn-sprite-bh", "--vn-sprite-bw", "--vn-sprite-by", "--vn-sprite-cx", "--vn-sprite-k", "--vn-sprite-s"]);
    // Missing or broken metadata falls back to the full portrait frame.
    const d = spriteGeometry({});
    expect([d.cx, d.by, d.bw, d.bh]).toEqual([0.5, 1, 1, 1]);
    expect(spriteGeometry({ bbox: [Number.NaN, 0, 5, -1] as never }).bh).toBeGreaterThan(0);
  });

  test("geometry does not depend on the pixel size: 624x912 and 832x1216 cut-outs give the same figure", () => {
    const bbox: [number, number, number, number] = [0.1, 0.05, 0.6, 0.95];
    const standard = spriteGeometryVars(spriteGeometry({ bbox, width: 624, height: 912 }));
    const upscaled = spriteGeometryVars(spriteGeometry({ bbox, width: 832, height: 1216 }));
    expect(standard).toEqual(upscaled);
  });

  test("facing mirrors only toward the side opposite the natural orientation", () => {
    expect(spriteMirrored("viewer")).toBe(false);
    expect(spriteMirrored("left")).toBe(false);
    expect(spriteMirrored("right")).toBe(true);
  });

  test("badges: a set with nothing ready says Preparing <name> n/12; all failed is a warning", () => {
    const view = turnView([{ actors: [actor("mira"), actor("aoi", { slot: "left" })], plateKey: null, light: "neutral" }], {
      mira: set("set_mira", "Mira", [ready("idle")]),
      aoi: { ...set("set_aoi", "Aoi", []), readyCount: 0 },
    });
    expect(spriteStatusBadges(view, 0)).toEqual([{ kind: "image", label: "Preparing Aoi 0/12", characterKey: "aoi" }]);
    const failed = set("set_aoi", "Aoi", []);
    for (const id of Object.keys(failed.expressions)) failed.expressions[id] = { expression: id, status: "failed", error: "x" };
    expect(spriteStatusBadges({ ...view, sets: { ...view.sets, aoi: failed } }, 0)[0]).toEqual({ kind: "warning", label: "Could not prepare Aoi", characterKey: "aoi", setKey: "set_aoi" });
    // A cast member without any set yet is preparing too.
    expect(spriteStatusBadges({ ...view, sets: { mira: view.sets.mira! } }, 0)[0]!.label).toBe("Preparing Aoi 0/12");
  });

  test("badges follow the set size (expressionCount): 0/4, 0/8, 0/12", () => {
    // As the backend sends it: the active set, nothing made yet.
    const view = turnView([{ actors: [actor("aoi")], plateKey: null, light: "neutral" }], { aoi: { ...set("set_aoi", "Aoi", []), expressions: {}, readyCount: 0 } });
    expect(spriteStatusBadges({ ...view, expressionCount: 4 }, 0)[0]!.label).toBe("Preparing Aoi 0/4");
    expect(spriteStatusBadges({ ...view, expressionCount: 8 }, 0)[0]!.label).toBe("Preparing Aoi 0/8");
    expect(spriteStatusBadges({ ...view, expressionCount: 12 }, 0)[0]!.label).toBe("Preparing Aoi 0/12");
    // No set yet, 4 mode.
    expect(spriteStatusBadges({ ...view, sets: {}, expressionCount: 4 }, 0)[0]!.label).toBe("Preparing Aoi 0/4");
    // A ready image outside the 4 set: shown, and counted.
    const shocked = { ...view, expressionCount: 4 as const, sets: { aoi: set("set_aoi", "Aoi", [ready("surprised")]) } };
    expect(spriteStatusBadges(shocked, 0)).toEqual([]);
    expect(resolveSpriteImage(shocked.sets.aoi, "shocked")?.expression).toBe("surprised");
    const { view: next } = withSpriteImage({ ...view, expressionCount: 4 }, "set_aoi", { expression: "idle", status: "ready", url: "/idle.png" });
    expect(next.sets.aoi!.readyCount).toBe(1);
  });

  test("updates: a sprite update recounts ready hot-set sprites; plates only for known keys", () => {
    const view = turnView([{ actors: [actor("mira")], plateKey: "plate_a", light: "neutral" }]);
    const { view: next, changed } = withSpriteImage(view, "set_mira", ready("sad", "/mira/sad.png"));
    expect(changed).toEqual(["mira"]);
    expect(next.sets.mira!.readyCount).toBe(3);
    expect(next.sets.ren).toBe(view.sets.ren!);
    expect(withSpriteImage(view, "set_other", ready("sad")).changed).toEqual([]);
    expect(withPlate(view, { plateKey: "plate_zzz", location: "", timeOfDay: null, weather: null, status: "ready", url: "/z.png" }).changed).toBe(false);
    expect(withPlate(view, { plateKey: "plate_a", location: "", timeOfDay: null, weather: null, status: "ready", url: "/b.png" }).view.plates.plate_a!.url).toBe("/b.png");
  });

  test("preload lists the next paragraphs' sprites and plates", () => {
    const view = turnView([
      { actors: [actor("mira")], plateKey: "plate_a", light: "neutral" },
      { actors: [actor("mira", { expression: "smile" }), actor("ren", { slot: "left" })], plateKey: null, light: "neutral" },
      { actors: [actor("ren", { expression: "giggling" })], plateKey: null, light: "neutral" },
      { actors: [actor("mira", { expression: "sad" })], plateKey: null, light: "neutral" },
    ]);
    expect(spritePreloadUrls(view, 0)).toEqual(["/mira/smile.png", "/ren/idle.png", "/plates/a.png"]);
  });

  test("every emote has an inline decorative SVG", () => {
    for (const emote of SPRITE_EMOTES) {
      const markup = spriteEmoteMarkup(emote);
      if (emote === "none") expect(markup).toBe("");
      else {
        expect(markup).toContain(`data-vn-sprite-emote-mark="${emote}"`);
        expect(markup).toContain('aria-hidden="true"');
        expect(markup).not.toMatch(/https?:/);
      }
    }
  });
});

describe("face spot (emote placement)", () => {
  // Rin full body (set_44cb544e): bbox and detected face of the idle sprite.
  const fullBody = { bbox: [0.234, 0.046, 0.529, 0.931] as [number, number, number, number], width: 624, height: 912 };
  const face: [number, number, number, number] = [0.444, 0.118, 0.13, 0.118];

  test("a detected face: centre offset from the anchor, edges above the bottom of the figure", () => {
    const spot = spriteFaceSpot({ ...fullBody, face });
    const g = spriteGeometry(fullBody);
    expect(spot.source).toBe("detected");
    expect(spot.dx).toBeCloseTo(0.444 + 0.065 - g.cx, 6);
    expect(spot.top).toBeCloseTo(g.by - 0.118, 6);
    expect(spot.bottom).toBeCloseTo(g.by - 0.236, 6);
    expect(spot.w).toBeCloseTo(0.13, 6);
    expect(spriteFaceVars(spot)).toEqual({
      "--vn-sprite-face-dx": String(Math.round(spot.dx * 10000) / 10000),
      "--vn-sprite-face-top": "0.859",
      "--vn-sprite-face-bottom": "0.741",
      "--vn-sprite-face-w": "0.13",
    });
  });

  test("no face (absent or null): the framing estimate; full body puts the cheeks much higher than a crop", () => {
    const crop = { bbox: [0, 0, 1, 1] as [number, number, number, number], width: 624, height: 912 };
    for (const image of [crop, { ...crop, face: null }]) {
      const spot = spriteFaceSpot(image);
      expect(spot.source).toBe("estimate");
      expect(spot.dx).toBe(0);
      // Thighs-up crop: cheek line about 71% up the figure, as before.
      expect(spot.top - (spot.top - spot.bottom) * 0.62).toBeCloseTo(0.71, 2);
    }
    const full = spriteFaceSpot(fullBody);
    const cheek = (full.top - (full.top - full.bottom) * 0.62) / fullBody.bbox[3];
    expect(cheek).toBeCloseTo(0.845, 3);
    // The detected cheek line of the real sprite is within a few percent.
    const real = spriteFaceSpot({ ...fullBody, face });
    expect(Math.abs((real.top - (real.top - real.bottom) * 0.62) / fullBody.bbox[3] - cheek)).toBeLessThan(0.02);
  });

  test("estimate by framing: narrow crops get a lower cheek line than wide ones, within bounds", () => {
    const narrow = estimateSpriteFace(spriteGeometry({ bbox: [0.3, 0.01, 0.4, 0.99], width: 624, height: 912 }));
    const wide = estimateSpriteFace(spriteGeometry({ bbox: [0, 0, 1, 1], width: 624, height: 912 }));
    expect(narrow.cheek).toBeGreaterThan(wide.cheek);
    expect(narrow.cheek).toBeLessThanOrEqual(0.78);
    expect(wide.cheek).toBeGreaterThanOrEqual(0.7);
    expect(estimateSpriteFace(spriteGeometry({ bbox: [0.2, 0.05, 0.5, 0.9], width: 624, height: 912 })).cheek).toBe(0.845);
  });

  test("a broken face box counts as unknown", () => {
    expect(spriteFaceSpot({ bbox: [0, 0, 1, 1], face: [0.1, 0.1, 0, 0.2] }).source).toBe("estimate");
    expect(spriteFaceSpot({ bbox: [0, 0, 1, 1], face: [Number.NaN, 0.1, 0.2, 0.2] }).source).toBe("estimate");
  });
});

describe("SpriteLayer DOM", () => {
  let restore: () => void;
  let container: FakeNode;
  let layer: SpriteLayer;
  let statusChanges = 0;

  const sprites = () => container.querySelectorAll("[data-vn-sprite]");
  const byKey = (key: string) => container.querySelector(`[data-vn-sprite][data-vn-sprite-key="${key}"]`)!;
  const activeLayer = (key: string) => byKey(key).querySelector("[data-vn-sprite-image][data-vn-sprite-layer='active']")!;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    restore = installFakeDocument();
    container = new FakeNode("div");
    statusChanges = 0;
    layer = new SpriteLayer({ container: () => container as unknown as HTMLElement, onStatusChange: () => { statusChanges += 1; } });
    layer.setEnabled(true);
  });
  afterEach(() => { layer.destroy(); restore(); });

  const view = turnView([
    { actors: [actor("mira", { focus: true, motion: "hop", emote: "heart" })], plateKey: "plate_a", light: "day" },
    { actors: [actor("mira", { slot: "left", expression: "smile", focus: true }), actor("ren", { slot: "right", facing: "left" })], plateKey: null, light: "sunset" },
    { actors: [actor("ren", { slot: "center", focus: true, facing: "right", emote: "sweat" })], plateKey: null, light: "night" },
  ]);

  test("applies a paragraph: slot, focus, light, emote and a one-shot motion", () => {
    layer.setTurn(view);
    layer.show(0, { animate: true, speaker: "Mira" });
    expect(sprites()).toHaveLength(1);
    const mira = byKey("mira");
    expect(mira.dataset.vnSpriteSlot).toBe("center");
    expect(mira.style["--vn-sprite-x"]).toBe("50%");
    expect(mira.dataset.vnSpriteFocus).toBe("true");
    expect(mira.dataset.vnSpriteDim).toBe("false");
    expect(mira.dataset.vnSpriteState).toBe("entering");
    expect(container.dataset.vnSpriteLight).toBe("day");
    expect(container.dataset.vnSpriteCount).toBe("1");
    expect(mira.querySelector("[data-vn-sprite-body]")!.dataset.vnSpriteMotion).toBe("hop");
    const emote = mira.querySelector("[data-vn-sprite-emote]")!;
    expect(emote.hidden).toBe(false);
    expect(emote.dataset.vnSpriteEmoteName).toBe("heart");
    expect(emote.dataset.vnSpriteEmotePop).toBe("true");
    expect(activeLayer("mira").querySelector("img")!.getAttribute("src")).toBe("/mira/idle.png");
    expect(activeLayer("mira").style["--vn-sprite-by"]).toBe("1");
    expect(activeLayer("mira").style["--vn-sprite-mask"]).toBe('url("/mira/idle.png")');
    expect(statusChanges).toBeGreaterThan(0);
  });

  test("the same paragraph is applied once (renders are idempotent)", () => {
    layer.setTurn(view);
    layer.show(0, { animate: true });
    const body = byKey("mira").querySelector("[data-vn-sprite-body]")!;
    delete body.dataset.vnSpriteMotion;
    layer.show(0, { animate: true });
    expect(body.dataset.vnSpriteMotion).toBeUndefined();
  });

  test("a second actor enters, the first moves and crossfades to the new expression; others dim", () => {
    layer.setTurn(view);
    layer.show(0, { animate: true });
    layer.show(1, { animate: true, speaker: "Mira" });
    expect(sprites()).toHaveLength(2);
    const mira = byKey("mira");
    expect(mira.style["--vn-sprite-x"]).toBe("30%");
    expect(byKey("ren").style["--vn-sprite-x"]).toBe("70%");
    expect(byKey("ren").dataset.vnSpriteDim).toBe("true");
    expect(byKey("ren").dataset.vnSpriteMirrored).toBe("false");
    const layers = mira.querySelectorAll("[data-vn-sprite-image]");
    expect(layers.map((l) => l.dataset.vnSpriteLayer).sort()).toEqual(["active", "leaving"]);
    expect(activeLayer("mira").dataset.vnSpriteExpression).toBe("smile");
    expect(activeLayer("mira").querySelector("img")!.getAttribute("src")).toBe("/mira/smile.png");
    expect(container.dataset.vnSpriteLight).toBe("sunset");
    // Emote cleared, no motion this paragraph.
    expect(mira.querySelector("[data-vn-sprite-emote]")!.hidden).toBe(true);
    expect(mira.querySelector("[data-vn-sprite-body]")!.dataset.vnSpriteMotion).toBeUndefined();
  });

  test("an actor who leaves fades out and is removed; without animation at once", async () => {
    layer.setTurn(view);
    layer.show(1, { animate: true });
    layer.show(2, { animate: true });
    expect(byKey("mira").dataset.vnSpriteState).toBe("exiting");
    expect(layer.snapshot().actors.map((a) => a.characterKey)).toEqual(["ren"]);
    expect(byKey("ren").dataset.vnSpriteMirrored).toBe("true");
    await wait(480);
    expect(container.querySelector("[data-vn-sprite-key='mira']")).toBeNull();
    layer.show(1, { animate: false });
    layer.show(2, { animate: false });
    expect(container.querySelector("[data-vn-sprite-key='mira']")).toBeNull();
  });

  test("an actor who comes back while fading out is shown again", () => {
    layer.setTurn(view);
    layer.show(1, { animate: true });
    layer.show(2, { animate: true });
    layer.show(1, { animate: true });
    const mira = byKey("mira");
    expect(mira.dataset.vnSpriteState).not.toBe("exiting");
    expect(activeLayer("mira").querySelector("img")!.getAttribute("src")).toBe("/mira/smile.png");
    expect(sprites()).toHaveLength(2);
  });

  test("without WebGL the puppet falls back to CSS and the settings reach the CSS knobs", () => {
    layer.setTurn(view);
    layer.show(1, { animate: true, speaker: "Mira" });
    expect(byKey("mira").dataset.vnPuppet).toBe("css");
    expect(activeLayer("mira").dataset.vnSpriteCanvas).toBeUndefined();
    const snap = layer.snapshot();
    expect(snap.actors.map((a) => a.puppet)).toEqual(["css", "css"]);
    expect(snap.puppet).toEqual({ strength: 1, running: false, scale: 1 });
    expect(container.style["--vn-sprite-breath"]).toBe("1");
    expect(container.dataset.vnSpriteBlur).toBe("true");
    layer.setPuppet({ spriteMotion: 50, spriteBreathing: false, spriteSway: true, spriteHeadMotion: true, spriteActing: true, spritePhysics: false, spriteOutline: 3, spriteFocusBlur: false, spriteTransitions: "soft", spriteAtmosphere: false, spriteOutlineColor: "#2b1d3a" });
    expect(container.style["--vn-sprite-breath"]).toBe("0");
    expect(container.style["--vn-sprite-talk-amp"]).toBe("0.5");
    expect(container.dataset.vnSpriteBlur).toBe("false");
    expect(layer.snapshot().puppet.strength).toBe(0.5);
    expect(layer.getPuppet().spriteOutline).toBe(3);
    // Talking still works on the CSS path; typed text and acting are ignored there.
    layer.setTalking(true);
    expect(byKey("mira").dataset.vnSpriteTalking).toBe("true");
    layer.typed("Hello there?");
    expect(layer.snapshot().actors.map((a) => [a.pose, a.voice])).toEqual([[null, 0], [null, 0]]);
  });

  test("rewinding applies the final pose without motion or emote pop", () => {
    layer.setTurn(view);
    layer.show(1, { animate: true });
    layer.show(0, { animate: false });
    const mira = byKey("mira");
    expect(mira.querySelector("[data-vn-sprite-body]")!.dataset.vnSpriteMotion).toBeUndefined();
    const emote = mira.querySelector("[data-vn-sprite-emote]")!;
    expect(emote.dataset.vnSpriteEmoteName).toBe("heart");
    expect(emote.dataset.vnSpriteEmotePop).toBeUndefined();
  });

  test("a set with nothing ready shows no sprite, a badge, and appears when a sprite becomes ready", () => {
    const pending = turnView([{ actors: [actor("aoi", { expression: "smile", focus: true })], plateKey: null, light: "neutral" }], {
      aoi: set("set_aoi", "Aoi", []),
    });
    layer.setTurn(pending);
    layer.show(0, { animate: true });
    expect(byKey("aoi").dataset.vnSpriteState).toBe("waiting");
    expect(activeLayer("aoi").dataset.vnEmpty).toBe("true");
    expect(layer.badges().map((b) => b.label)).toEqual(["Preparing Aoi 0/12"]);
    expect(layer.updateImage("set_aoi", ready("idle", "/aoi/idle.png"))).toBe(true);
    expect(activeLayer("aoi").querySelector("img")!.getAttribute("src")).toBe("/aoi/idle.png");
    expect(layer.snapshot().actors[0]!.shownExpression).toBe("idle");
    expect(layer.badges()).toEqual([]);
    // The requested expression arrives later: crossfade to it.
    layer.updateImage("set_aoi", ready("smile", "/aoi/smile.png"));
    expect(activeLayer("aoi").querySelector("img")!.getAttribute("src")).toBe("/aoi/smile.png");
    expect(layer.snapshot().actors[0]!.shownExpression).toBe("smile");
    // Updates for sets not on stage change nothing visible.
    expect(layer.updateImage("set_unknown", ready("idle"))).toBe(false);
  });

  test("images wait for loading before they are painted", async () => {
    const loads: Array<() => void> = [];
    const delayed = new SpriteLayer({ container: () => container as unknown as HTMLElement, loadImage: () => new Promise<void>((resolve) => loads.push(resolve)) });
    delayed.setEnabled(true);
    delayed.setTurn(view);
    delayed.show(0, { animate: true });
    expect(byKey("mira").dataset.vnSpriteState).toBe("waiting");
    loads.shift()!();
    await wait(0);
    expect(byKey("mira").dataset.vnSpriteState).toBe("entering");
    delayed.destroy();
  });

  test("talking bob only on the focused actor whose name is the speaker, only while typing", () => {
    layer.setTurn(view);
    layer.show(1, { animate: true, speaker: "Mira" });
    layer.setTalking(true);
    expect(byKey("mira").dataset.vnSpriteTalking).toBe("true");
    expect(byKey("ren").dataset.vnSpriteTalking).not.toBe("true");
    layer.setTalking(false);
    expect(byKey("mira").dataset.vnSpriteTalking).toBe("false");
    layer.setTalking(true);
    layer.show(2, { animate: true, speaker: "" });
    expect(byKey("ren").dataset.vnSpriteTalking).not.toBe("true");
  });

  test("in a line with quotes the speaker talks inside them and keeps quiet through the narration", () => {
    layer.setTurn(view);
    layer.show(1, { animate: true, speaker: "Mira" });
    const line = "She looked away. \"Fine,\" she said.";
    layer.speak(line);
    layer.setTalking(true);
    const talking: string[] = [];
    for (const ch of line) {
      layer.typed(ch);
      talking.push(byKey("mira").dataset.vnSpriteTalking ?? "");
    }
    expect(talking[0]).not.toBe("true");
    expect(talking[line.indexOf("Fine")]).toBe("true");
    expect(talking[line.indexOf("she said")]).toBe("false");
    // Without quotes the whole line is speech.
    layer.speak("Fine, I will go.");
    expect(byKey("mira").dataset.vnSpriteTalking).toBe("true");
    layer.setTalking(false);
  });

  test("paragraphs past the staged range keep the last stage; disabling clears every layer", () => {
    layer.setTurn(view);
    layer.show(1, { animate: false });
    layer.show(7, { animate: false });
    expect(layer.snapshot().actors.map((a) => a.characterKey)).toEqual(["mira", "ren"]);
    layer.setEnabled(false);
    expect(sprites()).toHaveLength(0);
    expect(container.hidden).toBe(true);
    expect(layer.snapshot().actors).toEqual([]);
    layer.show(0, { animate: false });
    expect(sprites()).toHaveLength(0);
  });

  test("a new turn view replaces the staging at the next show; null clears", () => {
    layer.setTurn(view);
    layer.show(0, { animate: false });
    const next = turnView([{ actors: [actor("ren", { slot: "left" })], plateKey: null, light: "candle" }]);
    layer.setTurn(next);
    layer.show(0, { animate: false });
    expect(layer.snapshot().actors.map((a) => [a.characterKey, a.x])).toEqual([["ren", 32]]);
    expect(container.dataset.vnSpriteLight).toBe("candle");
    layer.setTurn(null);
    layer.show(0, { animate: false });
    expect(sprites()).toHaveLength(0);
  });
});

describe("key illustrations", () => {
  const view = (illustrate: boolean, status: "pending" | "ready" | "failed", url?: string): SpriteTurnView => ({
    staging: {
      version: 1, source: "planner",
      cast: [{ characterKey: "mira", name: "Mira", identity: "", attire: null }],
      plates: [],
      paragraphs: [
        { actors: [actor("mira")], plateKey: null, light: "neutral" },
        { actors: [actor("mira")], plateKey: null, light: "neutral", ...(illustrate ? { illustrate: true } : {}) },
      ],
    },
    sets: { mira: set("set_mira", "Mira", [ready("idle")]) },
    plates: {},
    illustrations: [{ paragraphIndex: 1, jobId: "job-1", status, ...(url ? { url } : {}) }],
  });

  test("illustrationFor needs the flag and a ready picture; indexes outside the staging have none", () => {
    expect(illustrationFor(view(true, "ready", "/scene/1.png"), 1)?.url).toBe("/scene/1.png");
    expect(illustrationFor(view(true, "ready", "/scene/1.png"), 0)).toBeNull();
    expect(illustrationFor(view(true, "ready", "/scene/1.png"), 2)).toBeNull();
    expect(illustrationFor(view(false, "ready", "/scene/1.png"), 1)).toBeNull();
    expect(illustrationFor(view(true, "pending"), 1)).toBeNull();
    expect(illustrationFor(view(true, "failed"), 1)).toBeNull();
    expect(illustrationFor(null, 1)).toBeNull();
  });

  test("a ready illustration ahead is preloaded", () => {
    expect(spritePreloadUrls(view(true, "ready", "/scene/1.png"), 0)).toContain("/scene/1.png");
  });

  test("setIllustrated hides the layer, drops badges and is reported in the snapshot; clear resets it", () => {
    const restore = installFakeDocument();
    try {
      const container = new FakeNode("div");
      const layer = new SpriteLayer({ container: () => container as unknown as HTMLElement });
      layer.setEnabled(true);
      layer.setTurn({ ...view(true, "ready", "/scene/1.png"), sets: {} });
      layer.show(1, { animate: false });
      expect(layer.badges().length).toBe(1);
      layer.setIllustrated("/scene/1.png", false);
      expect(layer.snapshot().illustration).toBe("/scene/1.png");
      expect(container.dataset.vnSpriteIllustrated).toBe("true");
      expect(layer.badges()).toEqual([]);
      layer.setIllustrated(null, false);
      expect(container.dataset.vnSpriteIllustrated).toBeUndefined();
      layer.setIllustrated("/scene/1.png", false);
      layer.clear();
      expect(layer.snapshot().illustration).toBeNull();
      expect(container.dataset.vnSpriteIllustrated).toBeUndefined();
    } finally {
      restore();
    }
  });
});

describe("narrow portrait layout (3 actors)", () => {
  const trio = (focus: "left" | "center" | "right" | null) => layoutSpriteActors([
    actor("mira", { slot: "left", focus: focus === "left" }),
    actor("ren", { slot: "center", focus: focus === "center" }),
    actor("aoi", { slot: "right", focus: focus === "right" }),
  ]);
  test("the row shifts toward the speaker and keeps its order", () => {
    expect(narrowSpriteX(trio(null))).toEqual([...SPRITE_NARROW_X[-1]]);
    expect(narrowSpriteX(trio("left"))).toEqual([...SPRITE_NARROW_X[0]]);
    expect(narrowSpriteX(trio("center"))).toEqual([...SPRITE_NARROW_X[1]]);
    expect(narrowSpriteX(trio("right"))).toEqual([...SPRITE_NARROW_X[2]]);
    for (const xs of Object.values(SPRITE_NARROW_X)) expect([...xs].sort((a, b) => a - b)).toEqual([...xs]);
    // The speaker stands nearer the centre than in a fixed spread.
    expect(Math.abs(narrowSpriteX(trio("left"))[0]! - 50)).toBeLessThan(Math.abs(SPRITE_NARROW_X[-1][0] - 50));
    expect(Math.abs(narrowSpriteX(trio("right"))[2]! - 50)).toBeLessThan(Math.abs(SPRITE_NARROW_X[-1][2] - 50));
  });
  test("one or two actors keep their anchors", () => {
    const duo = layoutSpriteActors([actor("mira", { slot: "left", focus: true }), actor("ren", { slot: "right" })]);
    expect(narrowSpriteX(duo)).toEqual(duo.map((p) => p.x));
    const solo = layoutSpriteActors([actor("mira")]);
    expect(narrowSpriteX(solo)).toEqual([50]);
  });
  test("the layer writes the narrow anchor next to the normal one", () => {
    const restore = installFakeDocument();
    try {
      const container = new FakeNode("div");
      const layer = new SpriteLayer({ container: () => container as unknown as HTMLElement });
      layer.setEnabled(true);
      layer.setTurn(turnView([{ actors: [actor("mira", { slot: "left", focus: true }), actor("ren", { slot: "center" }), actor("aoi", { slot: "right" })], plateKey: "plate_a", light: "day" }]));
      layer.show(0, { animate: false });
      const vars = container.querySelectorAll("[data-vn-sprite]").map((el) => [el.dataset.vnSpriteKey, el.style["--vn-sprite-x"], el.style["--vn-sprite-xn"]]);
      expect(vars).toEqual([["mira", "19%", `${SPRITE_NARROW_X[0][0]}%`], ["ren", "50%", `${SPRITE_NARROW_X[0][1]}%`], ["aoi", "81%", `${SPRITE_NARROW_X[0][2]}%`]]);
    } finally {
      restore();
    }
  });
});

describe("SpriteLayer face vars", () => {
  let restore: () => void;
  let container: FakeNode;
  let layer: SpriteLayer;
  beforeEach(() => {
    restore = installFakeDocument();
    container = new FakeNode("div");
    layer = new SpriteLayer({ container: () => container as unknown as HTMLElement });
    layer.setEnabled(true);
  });
  afterEach(() => { layer.destroy(); restore(); });

  test("face vars on the actor; the emote sits in the marks box (not the mirrored figure); a later face moves it", () => {
    const sets = { mira: set("set_mira", "Mira", [ready("idle", "/mira/idle.png")]) };
    layer.setTurn(turnView([{ actors: [actor("mira", { emote: "blush", facing: "right" })], plateKey: null, light: "day" }], sets));
    layer.show(0, { animate: false });
    const mira = container.querySelector('[data-vn-sprite][data-vn-sprite-key="mira"]')!;
    expect(mira.dataset.vnSpriteMirrored).toBe("true");
    expect(mira.dataset.vnSpriteFace).toBe("estimate");
    expect(mira.style["--vn-sprite-face-dx"]).toBe("0");
    const emote = mira.querySelector("[data-vn-sprite-emote]")!;
    expect(emote.dataset.vnSpriteEmotePlace).toBe("face");
    expect(mira.querySelector("[data-vn-sprite-marks] [data-vn-sprite-emote]")).toBe(emote);
    expect(mira.querySelector("[data-vn-sprite-figure] [data-vn-sprite-emote]")).toBeNull();
    expect(layer.snapshot().actors[0]!.face).toBe("estimate");

    layer.updateImage("set_mira", ready("idle", "/mira/idle.png", { face: [0.3, 0.1, 0.2, 0.15] }));
    expect(mira.dataset.vnSpriteFace).toBe("detected");
    expect(mira.style["--vn-sprite-face-dx"]).toBe(String(Math.round((0.4 - 0.5) * 10000) / 10000));
    expect(mira.style["--vn-sprite-face-top"]).toBe("0.9");
    expect(mira.style["--vn-sprite-face-bottom"]).toBe("0.75");
    expect(mira.style["--vn-sprite-face-w"]).toBe("0.2");
    expect(layer.snapshot().actors[0]!.face).toBe("detected");
  });
});

describe("spotlight: who dims", () => {
  const names: Record<string, string> = { mira: "Mira", ren: "Ren", aoi: "Aoi" };
  const nameOf = (key: string) => names[key] ?? key;
  const two = [actor("mira", { focus: true }), actor("ren")];

  test("a staged line whose speaker stands on stage dims the others", () => {
    expect([...spriteDimmedKeys(two, { speaker: "Mira", innerVoice: false, staged: true }, nameOf)]).toEqual(["ren"]);
  });

  test("an inner voice dims everyone, focus or not", () => {
    expect([...spriteDimmedKeys(two, { speaker: "Logic", innerVoice: true, staged: true }, nameOf)].sort()).toEqual(["mira", "ren"]);
    expect([...spriteDimmedKeys([actor("mira"), actor("ren")], { speaker: "Logic", innerVoice: true, staged: true }, nameOf)].sort()).toEqual(["mira", "ren"]);
  });

  test("nobody dims when the speaker is not on stage: narration, no focus, the reader's line on a kept stage", () => {
    // Narration (no nameplate) focusing a mentioned character.
    expect(spriteDimmedKeys(two, { speaker: "", innerVoice: false, staged: true }, nameOf).size).toBe(0);
    // A labelled off-stage voice: staging focuses nobody.
    expect(spriteDimmedKeys([actor("mira"), actor("ren")], { speaker: "Stranger", innerVoice: false, staged: true }, nameOf).size).toBe(0);
    // The reader's own character speaks over the last stage, whose focus is Mira.
    expect(spriteDimmedKeys(two, { speaker: "Kai", innerVoice: false, staged: false }, nameOf).size).toBe(0);
  });

  test("on a kept stage the focus counts only when the nameplate names it", () => {
    expect([...spriteDimmedKeys(two, { speaker: "[Mira]", innerVoice: false, staged: false }, nameOf)]).toEqual(["ren"]);
  });

  test("figure box: the layer box times the cut-out bbox, mirrored around the anchor", () => {
    const layerBox = { left: 100, top: 0, width: 200, height: 400 };
    const g = { cx: 0.4, by: 1, bw: 0.5, bh: 0.9 };
    expect(spriteFigureBox(layerBox, g, false)).toEqual({ left: 130, right: 230, top: 40, bottom: 400 });
    expect(spriteFigureBox(layerBox, g, true)).toEqual({ left: 170, right: 270, top: 40, bottom: 400 });
  });

  test("press target: a hit bounces in sprite mode with motion allowed, otherwise the click reads on", () => {
    const base = { enabled: true, sprites: true, intensity: "full" as const, reducedMotion: false, hit: "mira" };
    expect(spritePressTarget(base)).toBe("mira");
    expect(spritePressTarget({ ...base, hit: null })).toBeNull();
    expect(spritePressTarget({ ...base, enabled: false })).toBeNull();
    expect(spritePressTarget({ ...base, sprites: false })).toBeNull();
    expect(spritePressTarget({ ...base, intensity: "off" })).toBeNull();
    expect(spritePressTarget({ ...base, reducedMotion: true })).toBeNull();
    expect(spritePressTarget({ ...base, intensity: "gentle" })).toBe("mira");
  });
});

describe("SpriteLayer spotlight and press", () => {
  let restore: () => void;
  let container: FakeNode;
  let layer: SpriteLayer;
  const byKey = (key: string) => container.querySelector(`[data-vn-sprite][data-vn-sprite-key="${key}"]`)!;
  const dims = () => layer.snapshot().actors.map((a) => [a.characterKey, a.dim]);
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const view = turnView([
    { actors: [actor("mira", { slot: "left", focus: true }), actor("ren", { slot: "right" })], plateKey: null, light: "day" },
    { actors: [actor("mira", { slot: "left", focus: true }), actor("ren", { slot: "right" })], plateKey: null, light: "day" },
  ]);

  beforeEach(() => {
    restore = installFakeDocument();
    container = new FakeNode("div");
    layer = new SpriteLayer({ container: () => container as unknown as HTMLElement });
    layer.setEnabled(true);
    layer.setTurn(view);
  });
  afterEach(() => { layer.destroy(); restore(); });

  test("the speaker on stage dims the others; narration on the same stage leaves everyone bright", () => {
    layer.show(0, { animate: false, speaker: "Mira" });
    expect(dims()).toEqual([["mira", false], ["ren", true]]);
    layer.show(1, { animate: false, speaker: "" });
    expect(dims()).toEqual([["mira", false], ["ren", false]]);
  });

  test("an inner voice dims everyone and marks the layer; re-shown as an ordinary line it lifts", () => {
    layer.show(0, { animate: false, speaker: "Logic", innerVoice: true });
    expect(dims()).toEqual([["mira", true], ["ren", true]]);
    expect(layer.snapshot().innerVoice).toBe(true);
    expect(container.dataset.vnSpriteVoice).toBe("true");
    // The same paragraph shown again (the reader changed the names): applied in place.
    layer.show(0, { animate: false, speaker: "Mira" });
    expect(dims()).toEqual([["mira", false], ["ren", true]]);
    expect(container.dataset.vnSpriteVoice).toBeUndefined();
  });

  test("the reader's own line keeps the stage with nobody dimmed; a line past the staging needs the name", () => {
    layer.show(0, { animate: false, speaker: "Mira" });
    layer.showReaderLine();
    expect(dims()).toEqual([["mira", false], ["ren", false]]);
    // Past the staged paragraphs the last stage stays up (carried).
    layer.show(1, { animate: false, speaker: "Mira" });
    layer.show(5, { animate: false, speaker: "Kai" });
    expect(dims()).toEqual([["mira", false], ["ren", false]]);
    layer.show(6, { animate: false, speaker: "Mira" });
    expect(dims()).toEqual([["mira", false], ["ren", true]]);
  });

  test("actorAt finds the figure under a point, front-most first; press bounces it once", async () => {
    layer.show(0, { animate: false, speaker: "Mira" });
    // The fake DOM has no layout: give each active image layer a box.
    const boxes: Record<string, { left: number; top: number; width: number; height: number }> = {
      mira: { left: 0, top: 0, width: 200, height: 400 },
      ren: { left: 120, top: 0, width: 200, height: 400 },
    };
    for (const key of ["mira", "ren"]) {
      const active = byKey(key).querySelector("[data-vn-sprite-image][data-vn-sprite-layer='active']")! as FakeNode & { getBoundingClientRect?: () => unknown };
      active.getBoundingClientRect = () => boxes[key];
    }
    // bbox [0.1, 0.02, 0.8, 0.98]: Mira's figure spans x 20-180, Ren's 140-300.
    expect(layer.actorAt(60, 200)).toBe("mira");
    expect(layer.actorAt(260, 200)).toBe("ren");
    // Where they overlap the focused speaker is in front.
    expect(layer.actorAt(160, 200)).toBe("mira");
    expect(layer.actorAt(10, 200)).toBeNull();
    expect(layer.actorAt(60, 2)).toBeNull();

    expect(layer.press("ren")).toBe(true);
    expect(byKey("ren").dataset.vnSpritePress).toBe("true");
    expect(byKey("mira").dataset.vnSpritePress).toBeUndefined();
    expect(layer.press("aoi")).toBe(false);
    await wait(SPRITE_PRESS_MS + 80);
    expect(byKey("ren").dataset.vnSpritePress).toBeUndefined();
  });
});

describe("size matching (every face at one size)", () => {
  const match = (patch: Partial<VisualNovelSpriteSizeMatch> = {}): VisualNovelSpriteSizeMatch => ({ ...spriteSizeMatchSettings(DEFAULT_CONFIG), ...patch });
  // A full figure (feet in the picture) and a waist-up one cut by the bottom edge.
  const full = spriteGeometry({ bbox: [0.25, 0.04, 0.5, 0.94], width: 832, height: 1216 });
  const bust = spriteGeometry({ bbox: [0.1, 0.1, 0.8, 0.9], width: 832, height: 1216 });

  test("the zoom puts the face at the chosen share of a standing figure, within the limits", () => {
    // Face 0.1 of the image tall in a figure 0.94 tall: 0.1064 of the figure, so 15% needs 1.41x.
    const spot = { dx: 0, top: 0.8, bottom: 0.7, w: 0.1, source: "detected" as const };
    expect(spriteSizeMatchZoom(match(), full, spot)).toBeCloseTo(0.15 / (0.1 / 0.94), 5);
    expect(spriteSizeMatchZoom(match({ spriteSizeMatchMax: 110 }), full, spot)).toBe(1.1);
    // A big face is shrunk, but not below the smallest zoom.
    const big = { dx: 0, top: 0.8, bottom: 0.4, w: 0.3, source: "detected" as const };
    expect(spriteSizeMatchZoom(match(), bust, big)).toBe(0.6);
    expect(spriteSizeMatchZoom(match({ spriteSizeMatch: "off" }), full, spot)).toBe(1);
    // The framing estimate of a figure cut at the thighs (Cue's own framing, face 20% of it) shrinks a little.
    const thighs = spriteGeometry({ bbox: [0.1, 0.02, 0.8, 0.98], width: 832, height: 1216 });
    const estimate = spriteFaceSpot({ bbox: [0.1, 0.02, 0.8, 0.98], width: 832, height: 1216 }, thighs);
    expect(spriteSizeMatchZoom(match(), thighs, estimate)).toBeCloseTo(0.75, 2);
  });

  test("the face moves toward the slot centre by the chosen share", () => {
    const spot = { dx: 0.08, top: 0.8, bottom: 0.7, w: 0.1, source: "detected" as const };
    expect(spriteFaceShift(match(), spot)).toBeCloseTo(-0.08, 6);
    expect(spriteFaceShift(match({ spriteSizeMatchCenter: 50 }), spot)).toBeCloseTo(-0.04, 6);
    expect(spriteFaceShift(match({ spriteSizeMatch: "off" }), spot)).toBe(0);
  });

  test("heads: the taller figures sink to the lowest face top; nobody rises; other modes stay put", () => {
    const tops = new Map([["mira", 0.92], ["ren", 0.8], ["aoi", 0.85]]);
    const heads = spriteHeadLift("heads", tops);
    expect(heads.get("mira")).toBeCloseTo(-0.12, 6);
    expect(heads.get("ren")).toBe(0);
    expect(heads.get("aoi")).toBeCloseTo(-0.05, 6);
    expect([...spriteHeadLift("heights", tops).values()]).toEqual([0, 0, 0]);
    expect(spriteHeadLift("heads", new Map([["mira", 0.9]])).get("mira")).toBe(0);
    expect(spriteFaceTop(full, { dx: 0, top: 0.8, bottom: 0.7, w: 0.1, source: "detected" }, 1.2)).toBeCloseTo((0.8 / 0.94) * 1.2, 6);
  });

  describe("on the stage", () => {
    let restore: () => void;
    let container: FakeNode;
    let layer: SpriteLayer;
    const byKey = (key: string) => container.querySelector(`[data-vn-sprite][data-vn-sprite-key="${key}"]`)!;
    beforeEach(() => {
      restore = installFakeDocument();
      container = new FakeNode("div");
      layer = new SpriteLayer({ container: () => container as unknown as HTMLElement });
      layer.setEnabled(true);
    });
    afterEach(() => { layer.destroy(); restore(); });

    test("each image gets its zoom and face shift; heads mode sinks the taller one; off undoes it at once", () => {
      const sets = {
        // Mira's face is small (zoomed up); Ren's is big (zoomed down).
        mira: set("set_mira", "Mira", [ready("idle", "/mira/idle.png", { bbox: [0.25, 0.04, 0.5, 0.94], face: [0.42, 0.08, 0.12, 0.08] })]),
        ren: set("set_ren", "Ren", [ready("idle", "/ren/idle.png", { bbox: [0.1, 0.1, 0.8, 0.9], face: [0.3, 0.15, 0.3, 0.2] })]),
      };
      layer.setTurn(turnView([{ actors: [actor("mira", { slot: "left" }), actor("ren", { slot: "right" })], plateKey: null, light: "day" }], sets));
      layer.show(0, { animate: false });
      const zoom = (key: string) => Number(byKey(key).style["--vn-sprite-match"]);
      expect(zoom("mira")).toBeGreaterThan(1);
      expect(zoom("ren")).toBeLessThan(1);
      // The active image layer carries the same vars (its size comes from them).
      expect(byKey("mira").querySelector("[data-vn-sprite-image][data-vn-sprite-layer='active']")!.style["--vn-sprite-match"]).toBe(byKey("mira").style["--vn-sprite-match"]);
      // Mira's face centre is 0.48 - 0.5 = -0.02 image widths off: moved back by that.
      expect(byKey("mira").style["--vn-sprite-face-shift"]).toBe("0.02");
      expect(byKey("mira").style["--vn-sprite-lift"]).toBe("0");
      // The widest figure on stage limits everyone's shared height (each set here has one ready expression).
      const widths = ["mira", "ren"].map((key) => Number(byKey(key).style["--vn-sprite-match"]) * Number(byKey(key).style["--vn-sprite-s"]) * Number(byKey(key).style["--vn-sprite-bw"]) * Number(byKey(key).style["--vn-sprite-a"]));
      expect(Number(container.style["--vn-sprite-widest"])).toBeCloseTo(Math.max(...widths), 3);
      const snapshot = () => Object.fromEntries(layer.snapshot().actors.map((a) => [a.characterKey, [a.match, a.lift]]));
      expect(snapshot().mira![1]).toBe(0);

      layer.setSizeMatch(match({ spriteSizeMatch: "heads" }));
      const lifts = layer.snapshot().actors.map((a) => a.lift);
      expect(lifts.filter((lift) => lift < 0)).toHaveLength(1);
      expect(lifts.filter((lift) => lift === 0)).toHaveLength(1);
      expect(Math.min(...lifts)).toBeLessThan(0);

      layer.setSizeMatch(match({ spriteSizeMatch: "off" }));
      expect(byKey("mira").style["--vn-sprite-match"]).toBe("1");
      expect(byKey("ren").style["--vn-sprite-match"]).toBe("1");
      expect(byKey("mira").style["--vn-sprite-face-shift"]).toBe("0");
      expect(layer.snapshot().actors.map((a) => a.lift)).toEqual([0, 0]);
      expect(layer.getSizeMatch().spriteSizeMatch).toBe("off");
    });
  });
});
