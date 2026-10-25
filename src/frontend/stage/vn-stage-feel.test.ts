import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeEvent, FakeNode, installFakeDocument } from "./stage-test-dom";
import { VnStage } from "./vn-stage";
import { DEFAULT_CONFIG, stageFeelSettings, type VisualNovelStageFeel } from "../../config";
import type { InterfaceSounds } from "./interface-sounds";
import { SPRITE_HOT_SET, type SpriteActorStage, type SpriteImageView, type SpriteSetView, type SpriteTurnView } from "../../shared/sprites";

/** VnStage "feel": click sparks, pressing a character, interface sounds, inner voices. */
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
    ],
    plates: [],
    paragraphs: [
      { actors: [actor("mira", { slot: "left", focus: true }), actor("ren", { slot: "right" })], plateKey: null, light: "day" },
      { actors: [actor("mira", { slot: "left" }), actor("ren", { slot: "right" })], plateKey: null, light: "day" },
      { actors: [actor("mira", { slot: "left", focus: true }), actor("ren", { slot: "right" })], plateKey: null, light: "day" },
      { actors: [actor("mira", { slot: "left", focus: true }), actor("ren", { slot: "right" })], plateKey: null, light: "day" },
    ],
  },
  sets: {
    mira: set("set_mira", "Mira", [ready("idle", "/mira/idle.png")]),
    ren: set("set_ren", "Ren", [ready("idle", "/ren/idle.png")]),
  },
  plates: {},
};
const paragraphs = [
  { id: "t:0", text: "Hello there.", speaker: "Mira" },
  { id: "t:1", text: "That is not what she means.", speaker: "Logic" },
  { id: "t:2", text: "The wind picks up.", speaker: "" },
  { id: "t:3", text: "Say it.", speaker: "Conscience" },
];

/** Interface sounds that only count what they were asked to do. */
function countingSounds() {
  const calls = { pop: 0, typed: 0, configure: [] as Array<{ enabled: boolean; volume: number }>, hold: null as (() => boolean) | null };
  const sounds = {
    configure: (settings: { enabled: boolean; volume: number }) => { calls.configure.push(settings); },
    setHold: (hold: (() => boolean) | null) => { calls.hold = hold; },
    releaseHold: (hold: () => boolean) => { if (calls.hold === hold) calls.hold = null; },
    canPlay: () => true,
    typed: () => { calls.typed += 1; return true; },
    pop: () => { calls.pop += 1; return true; },
  };
  return { sounds: sounds as unknown as InterfaceSounds, calls };
}

describe("VnStage stage feel", () => {
  let restore: () => void;
  let mount: FakeNode;
  let stage: VnStage;
  let sounds: ReturnType<typeof countingSounds>;
  let speaking = false;
  const root = () => (stage as unknown as { root: FakeNode }).root;
  const glow = () => root().querySelector("[data-vn-voice-glow]");
  const sprite = (key: string) => root().querySelector(`[data-vn-sprite][data-vn-sprite-key="${key}"]`)!;
  const index = () => stage.getState().currentParagraphIndex;
  const flush = async () => { for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0)); };
  const advance = () => (stage as unknown as { advance(): void }).advance();
  const feel = (patch: Partial<VisualNovelStageFeel>) => stage.setStageFeel({ ...stageFeelSettings(DEFAULT_CONFIG), ...patch });
  const dims = () => stage.getSpriteSnapshot().actors.map((a) => [a.characterKey, a.dim]);
  /** The fake DOM has no layout: put each sprite's image layer at a box. */
  const layoutSprites = () => {
    const boxes: Record<string, { left: number; top: number; width: number; height: number }> = {
      mira: { left: 0, top: 0, width: 200, height: 400 },
      ren: { left: 400, top: 0, width: 200, height: 400 },
    };
    for (const key of Object.keys(boxes)) {
      const active = sprite(key).querySelector("[data-vn-sprite-image][data-vn-sprite-layer='active']")! as FakeNode & { getBoundingClientRect?: () => unknown };
      active.getBoundingClientRect = () => boxes[key];
    }
  };
  const click = (target: FakeNode, x: number, y: number) => target.dispatchEvent(new FakeEvent("click", { clientX: x, clientY: y } as Partial<FakeEvent>));

  beforeEach(() => {
    restore = installFakeDocument();
    mount = new FakeNode("div");
    sounds = countingSounds();
    speaking = false;
    stage = new VnStage({
      mount: mount as unknown as HTMLElement,
      textSpeed: 0,
      interfaceSounds: sounds.sounds,
      isSpeechActive: () => speaking,
      createImage: () => ({ complete: true, naturalWidth: 100, decode: async () => {}, src: "", addEventListener() {}, removeEventListener() {} }),
    });
  });
  afterEach(() => { stage.destroy(); restore(); });

  test("defaults: sparks on, press-to-bounce on, interface sounds off", () => {
    expect(stage.getStageFeel()).toEqual({ clickEffect: "sparks", spritePressBounce: true, interfaceSounds: false, interfaceSoundVolume: 0.4, innerVoices: "" });
    feel({ interfaceSounds: true, interfaceSoundVolume: 0.7 });
    expect(sounds.calls.configure.at(-1)).toEqual({ enabled: true, volume: 0.7 });
  });

  test("the stage holds interface sounds while a voice reads aloud, and lets go when destroyed", () => {
    expect(sounds.calls.hold).not.toBeNull();
    expect(sounds.calls.hold!()).toBe(false);
    speaking = true;
    expect(sounds.calls.hold!()).toBe(true);
    stage.destroy();
    expect(sounds.calls.hold).toBeNull();
  });

  test("scene mode: an inner voice lights the screen edges for its paragraph only", async () => {
    stage.loadTurn({ paragraphs });
    await flush();
    expect(glow()).toBeNull();
    expect(stage.getInnerVoice()).toBeNull();
    advance();
    await flush();
    expect(stage.getInnerVoice()?.family).toBe("intellect");
    expect(root().dataset.vnInnerVoice).toBe("intellect");
    expect(glow()!.dataset.vnVoiceOn).toBe("true");
    expect(glow()!.style["--vn-voice-color"]).toBe("#5cb8e6");
    advance();
    await flush();
    expect(stage.getInnerVoice()).toBeNull();
    expect(root().dataset.vnInnerVoice).toBeUndefined();
    expect(glow()!.dataset.vnVoiceOn).toBeUndefined();
    // "Conscience" is not a skill until the reader names it; then at once.
    advance();
    await flush();
    expect(stage.getInnerVoice()).toBeNull();
    feel({ innerVoices: "Conscience, Shivers" });
    expect(stage.getInnerVoice()?.family).toBe("custom");
    expect(glow()!.dataset.vnVoiceOn).toBe("true");
  });

  test("sprite mode: the speaker dims the others, an inner voice dims everyone, narration nobody", async () => {
    stage.setPresentationMode("sprites");
    stage.loadTurn({ paragraphs, sprites });
    await flush();
    expect(dims()).toEqual([["mira", false], ["ren", true]]);
    advance();
    await flush();
    expect(dims()).toEqual([["mira", true], ["ren", true]]);
    expect(glow()!.dataset.vnVoiceOn).toBe("true");
    advance();
    await flush();
    expect(dims()).toEqual([["mira", false], ["ren", false]]);
    advance();
    await flush();
    // An off-stage voice the reader has not named: the staged focus is Mira, but Conscience speaks.
    // Staging focuses a labelled speaker only when on stage; this fixture's focus stands in for a stale one.
    feel({ innerVoices: "Conscience" });
    expect(dims()).toEqual([["mira", true], ["ren", true]]);
  });

  test("pressing a character bounces it and does not read on; elsewhere reads on", async () => {
    stage.setPresentationMode("sprites");
    stage.loadTurn({ paragraphs, sprites });
    await flush();
    layoutSprites();
    click(sprite("ren"), 500, 200);
    expect(index()).toBe(0);
    expect(sprite("ren").dataset.vnSpritePress).toBe("true");
    expect(sounds.calls.pop).toBe(1);
    // Off a character (between the two figures): reads on.
    click(root().querySelector("[data-vn-scene]")!, 300, 200);
    expect(index()).toBe(1);
  });

  test("with the setting off, in scene mode, or with Motion Still, a press on a character reads on", async () => {
    stage.setPresentationMode("sprites");
    stage.loadTurn({ paragraphs, sprites });
    await flush();
    layoutSprites();
    feel({ spritePressBounce: false });
    click(sprite("mira"), 100, 200);
    expect(index()).toBe(1);
    feel({ spritePressBounce: true });
    stage.setEffectIntensity("off");
    click(sprite("mira"), 100, 200);
    expect(index()).toBe(2);
    expect(sprite("mira").dataset.vnSpritePress).toBeUndefined();
  });

  test("a press on the dialogue over a character reads on", async () => {
    stage.setPresentationMode("sprites");
    stage.loadTurn({ paragraphs, sprites });
    await flush();
    layoutSprites();
    click(root().querySelector("[data-vn-narrative]")!, 100, 300);
    expect(index()).toBe(1);
  });

  test("every press sparks at the pointer; off, Motion Still and the right button do not", () => {
    const down = (patch: Record<string, unknown> = {}) => root().dispatchEvent(new FakeEvent("pointerdown", { button: 0, isPrimary: true, clientX: 30, clientY: 40, ...patch } as Partial<FakeEvent>));
    const bursts = () => root().querySelectorAll("[data-vn-click-sparks]");
    down();
    expect(bursts()).toHaveLength(1);
    expect(bursts()[0]!.getAttribute("data-vn-click-sparks")).toBe("sparks");
    expect(bursts()[0]!.querySelector("[data-vn-click-pop]")).toBeNull();
    expect(sounds.calls.pop).toBe(0);
    feel({ clickEffect: "sparks-pop" });
    down();
    expect(bursts()).toHaveLength(2);
    expect(bursts()[1]!.querySelector("[data-vn-click-pop]")).not.toBeNull();
    expect(sounds.calls.pop).toBe(1);
    down({ button: 2 });
    expect(bursts()).toHaveLength(2);
    feel({ clickEffect: "off" });
    down();
    expect(bursts()).toHaveLength(2);
    feel({ clickEffect: "sparks" });
    stage.setEffectIntensity("off");
    down();
    expect(bursts()).toHaveLength(2);
  });

  test("a double-click on the picture never starts a selection; one on the dialogue still may", () => {
    const mousedown = (target: FakeNode, detail: number) => {
      const event = new FakeEvent("mousedown", { detail } as Partial<FakeEvent>);
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(mousedown(root().querySelector("[data-vn-scene]")!, 2)).toBe(true);
    expect(mousedown(root().querySelector("[data-vn-scene]")!, 1)).toBe(false);
    expect(mousedown(root().querySelector("[data-vn-dialogue-text]")!, 2)).toBe(false);
    const drag = new FakeEvent("dragstart");
    root().querySelector("[data-vn-scene]")!.dispatchEvent(drag);
    expect(drag.defaultPrevented).toBe(true);
  });

  test("typing ticks go through the interface sounds, one ask per letter", async () => {
    // Minimal TreeWalker over fake text nodes, so the typewriter path runs.
    const doc = document as unknown as Record<string, unknown>;
    doc.createTreeWalker = (start: FakeNode) => {
      const nodes: FakeNode[] = [];
      const walk = (node: FakeNode) => { for (const child of node.children) { if (child.isText) nodes.push(child); else walk(child); } };
      walk(start);
      let i = 0;
      return { nextNode: () => nodes[i++] ?? null };
    };
    try {
      stage.destroy();
      stage = new VnStage({ mount: mount as unknown as HTMLElement, textSpeed: 2, interfaceSounds: sounds.sounds });
      stage.loadTurn({ paragraphs: [{ id: "p0", text: "Hi you", speaker: "Mira" }] });
      await new Promise((r) => setTimeout(r, 80));
      // The sounds throttle themselves (interface-sounds.ts); the stage asks per letter.
      expect(sounds.calls.typed).toBe("Hi you".length);
    } finally {
      delete doc.createTreeWalker;
    }
  });
});
