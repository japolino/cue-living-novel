import { VnStage } from "../src/frontend/stage/vn-stage.js";
import type { VnTurnInput } from "../src/frontend/store/vn-store.js";
import { puppetGlOptions } from "../src/frontend/stage/sprite-puppet.js";
import { configureCutoutRuntime } from "../src/frontend/sprites/cutout/index.js";
import { writeCachedModel } from "../src/frontend/sprites/cutout/model-store.js";
import { configurePlateDepth, encodePlateDepth, plateDepthStoreKey } from "../src/frontend/stage/plate-depth-service.js";
import { DEFAULT_CONFIG, spritePuppetSettings, spriteSizeMatchSettings, spriteTouchSettings, stageFeelSettings, type VisualNovelSpritePuppet, type VisualNovelSpriteSizeMatch, type VisualNovelSpriteTouch, type VisualNovelStageFeel } from "../src/config.js";
import type { TouchCharacterRef, TouchLinePack } from "../src/shared/touch.js";
import {
  SPRITE_HOT_SET,
  type PlateView,
  type SpriteActorStage,
  type SpriteIllustrationView,
  type SpriteImageView,
  type SpriteParagraphStage,
  type SpriteSetView,
  type SpriteTurnView,
} from "../src/shared/sprites.js";

/**
 * Browser fixture for sprite mode on the VN stage
 * (scripts/test-sprite-stage-browser.ts). Sprites and plates are small
 * downscaled copies of the sprite bake-off assets in scripts/fixtures/sprites/.
 *
 * Query: ?preset, ?intensity (full|gentle|off), ?speed (typewriter ms), ?mode (sprites|scene),
 * ?puppet=css (no WebGL puppet: the CSS fallback), ?outline (px),
 * ?scale=auto (the puppet's adaptive render scale; pinned at 1 otherwise, so
 * canvas sizes don't change under the pixel checks), ?depth=1 (3D
 * backgrounds; off otherwise, so no suite downloads the depth model).
 * window.fx: { stage, load(paragraphs, options), plan(), go(index), illustrate(index, status), ready(...), view(), effect(name), ambient(name), puppet(settings), feel(settings), sizeMatch(settings), renderScale(scale | null), touch(settings), touchBackend, identity(key, tags), depth }.
 * `depth` (scripts/test-plate-parallax-browser.ts): configure(ortBaseUrl,
 * modelUrl) runs the real model; seed(url, width, height, depth) stores a
 * depth map for a plate so no model is needed; set(enabled) is the setting.
 * Touch mode (scripts/test-sprite-touch-browser.ts) talks to a stand-in
 * backend here: `touchBackend` keeps the bonds, answers line-pack asks with
 * TOUCH_PACK (or an error) after a moment and logs every ask.
 * `load(paragraphs, { provisional: true })` shows the text before its plan (no
 * nameplates, no staging); `plan()` lands the plan (VnStage.upgradeTurn).
 * Headless Chromium only has software WebGL (SwiftShader), which the puppet
 * refuses by default; the fixture allows it so the WebGL path runs here.
 * Key moments: a paragraph with `illustrate: true` gets the fixture
 * illustration (`/sprites/illustration_moment.webp`, a composited close-up
 * standing in for a generated scene picture) unless `illustration` says otherwise.
 */
const q = new URL(location.href).searchParams;
puppetGlOptions.allowSoftware = q.get("puppet") !== "css";
puppetGlOptions.renderScale = q.get("scale") === "auto" ? null : 1;

/** Opaque bbox of each fixture cut-out (alpha > 24), normalized [x, y, w, h]. */
const BBOX: Record<string, [number, number, number, number]> = {
  mira_idle: [0.0865, 0.0214, 0.7716, 0.9786],
  mira_surprised: [0.0072, 0.0214, 0.9639, 0.9786],
  aoi_idle: [0.1298, 0.0181, 0.7548, 0.9819],
  aoi_sad: [0.0048, 0.0016, 0.9231, 0.9984],
  ren_idle: [0.0577, 0, 0.8702, 1],
  kaede_idle: [0.0361, 0, 0.9255, 1],
  yuki_idle: [0.0577, 0.0296, 0.9183, 0.9704],
};

const CAST = [
  { characterKey: "mira", name: "Mira", identity: "blonde twintails, maid outfit", attire: "maid outfit" },
  { characterKey: "aoi", name: "Aoi", identity: "long black hair, sailor uniform", attire: "sailor uniform" },
  { characterKey: "ren", name: "Ren", identity: "short black hair", attire: "black jacket" },
  { characterKey: "kaede", name: "Kaede", identity: "red hair", attire: "denim jacket" },
  { characterKey: "yuki", name: "Yuki", identity: "silver hair", attire: "white dress" },
];

/** Detected face of each fixture cut-out (face_detect_v1.4_n), normalized [x, y, w, h]. */
const FACE: Record<string, [number, number, number, number]> = {
  mira_idle: [0.3669, 0.16, 0.2343, 0.1497],
  mira_surprised: [0.3379, 0.1397, 0.2968, 0.2147],
  aoi_idle: [0.3346, 0.1215, 0.2358, 0.15],
  aoi_sad: [0.3516, 0.1097, 0.2926, 0.1943],
  ren_idle: [0.3726, 0.0816, 0.2149, 0.1531],
  kaede_idle: [0.4023, 0.1373, 0.2394, 0.1564],
  yuki_idle: [0.3868, 0.1296, 0.2331, 0.1577],
};

export function spriteImage(file: string, expression: string): SpriteImageView {
  return { expression, status: "ready", url: `/sprites/${file}.webp`, bbox: BBOX[file] ?? [0, 0, 1, 1], width: 416, height: 608, ...(FACE[file] ? { face: FACE[file] } : {}) };
}

function makeSet(key: string, name: string, ready: Record<string, string>): SpriteSetView {
  const expressions: Record<string, SpriteImageView> = {};
  for (const id of SPRITE_HOT_SET) expressions[id] = { expression: id, status: id === "idle" ? "generating" : "queued" };
  for (const [expression, file] of Object.entries(ready)) expressions[expression] = spriteImage(file, expression);
  return { setKey: `set_${key}`, name, attire: null, expressions, readyCount: Object.keys(ready).length, updatedAt: "2026-10-01T00:00:00Z" };
}

const plate = (key: string, location: string, timeOfDay: string | null, ready = true): PlateView => ({
  plateKey: key, location, timeOfDay, weather: null, status: ready ? "ready" : "generating", ...(ready ? { url: `/sprites/${key}.webp` } : {}),
});

function baseView(): Omit<SpriteTurnView, "staging"> {
  return {
    sets: {
      mira: makeSet("mira", "Mira", { idle: "mira_idle", surprised: "mira_surprised" }),
      aoi: makeSet("aoi", "Aoi", { idle: "aoi_idle", sad: "aoi_sad" }),
      ren: makeSet("ren", "Ren", { idle: "ren_idle" }),
      kaede: makeSet("kaede", "Kaede", { idle: "kaede_idle" }),
      yuki: makeSet("yuki", "Yuki", {}),
    },
    plates: {
      plate_classroom: plate("plate_classroom", "classroom", "day"),
      plate_park: plate("plate_park", "park with cherry trees", "day"),
      plate_street: plate("plate_street", "city street", "night"),
      plate_bedroom: plate("plate_bedroom", "bedroom", "evening"),
    },
  };
}

export type FixtureParagraph = {
  text?: string;
  speaker?: string;
  actors: Array<Partial<SpriteActorStage> & { characterKey: string }>;
  plateKey?: string | null;
  light?: SpriteParagraphStage["light"];
  /** Persistent ambient from this paragraph on (weather or mood grade). */
  ambient?: string | null;
  /** One-shot stage effect played when the paragraph shows. */
  effect?: string;
  /** Key moment: show the full illustration instead of the sprites. */
  illustrate?: boolean;
  /** Status of that illustration (default "ready"). */
  illustration?: SpriteIllustrationView["status"];
};

const ILLUSTRATION_URL = "/sprites/illustration_moment.webp";
const illustrationView = (paragraphIndex: number, status: SpriteIllustrationView["status"]): SpriteIllustrationView => ({
  paragraphIndex, jobId: `job-${paragraphIndex}`, status, ...(status === "ready" ? { url: ILLUSTRATION_URL } : {}),
});

/** The stand-in line pack: the same lines for everyone, none of them generic. */
const TOUCH_PACK: TouchLinePack = {
  version: 1,
  lines: {
    pat: { shy: ["O-oh… a head pat?"], warm: ["Hehe, that's nice."], fond: ["Mm… don't stop."], content: ["Okay, you can keep going…"], annoyed: ["My hair! Enough!"] },
    ears: { shy: ["Eep! My ears!"], warm: ["Gently with the ears."], fond: ["Purr… right there."], content: ["Mmm, so soft…"], annoyed: ["Ears are off-limits now!"] },
    hair: { shy: ["You're touching my hair?"], warm: ["You like my hair?"], fond: ["Heh, it tickles."], content: ["That's… soothing."], annoyed: ["Stop tangling it!"] },
    cheeks: { shy: ["Mmf?! My cheeks!"], warm: ["Squishy, huh?"], fond: ["Hehe, mochi cheeks."], content: ["Fine, one more squish."], annoyed: ["Hey! Not my face!"] },
    poke: { shy: ["Y-yes?"], warm: ["Need something?"], fond: ["Poke back!"], content: ["Hm?"], annoyed: ["Stop poking me!"] },
  },
};
/** Touch mode's stand-in backend: saved bonds and packs, every ask logged, answers after a moment. */
const touchBackend = {
  bonds: {} as Record<string, number>,
  packs: {} as Record<string, TouchLinePack>,
  /** Character keys of each `vn_touch_get`. */
  gets: [] as string[][],
  saves: [] as Array<[string, number]>,
  /** [character key, refresh] of each line-pack call (one model call each). */
  calls: [] as Array<[string, boolean]>,
  /** The next line-pack calls fail with this. */
  failWith: null as string | null,
  /** How long a line-pack call takes (ms). */
  delay: 80,
  pack: TOUCH_PACK,
};
const touchStates = (refs: TouchCharacterRef[]) => refs.map((ref) => ({ characterKey: ref.characterKey, bond: touchBackend.bonds[ref.characterKey] ?? 0, pack: touchBackend.packs[ref.characterKey] ?? null }));

const mount = document.createElement("div");
Object.assign(mount.style, { position: "fixed", inset: "0", background: "#08090d" });
document.body.append(mount);

/** Sets the stage's Try again asked for (onSpriteRetry). */
const retried: string[] = [];
const stage = new VnStage({
  mount,
  textSpeed: Number(q.get("speed") ?? 0),
  themePreset: (q.get("preset") as never) ?? "lumiverse",
  onReroll: () => {}, onSubmit: async () => {}, onChoice: async () => {}, onExit: () => {},
  onSpriteRetry: (setKey) => { retried.push(setKey); },
  onTouchCharacters: (refs) => {
    touchBackend.gets.push(refs.map((ref) => ref.characterKey));
    setTimeout(() => stage.setTouchStates(touchStates(refs)), 30);
  },
  onTouchBond: (ref, bond) => {
    touchBackend.saves.push([ref.characterKey, bond]);
    touchBackend.bonds[ref.characterKey] = bond;
  },
  onTouchLines: (ref, refresh) => {
    touchBackend.calls.push([ref.characterKey, refresh]);
    setTimeout(() => {
      if (touchBackend.failWith) return stage.setTouchLines(ref.characterKey, null, touchBackend.failWith);
      touchBackend.packs[ref.characterKey] = touchBackend.pack;
      stage.setTouchLines(ref.characterKey, touchBackend.pack);
    }, touchBackend.delay);
  },
});
stage.setEffectIntensity((q.get("intensity") as never) ?? "full");
stage.setPresentationMode((q.get("mode") as never) ?? "sprites");
stage.setPlateDepth(q.get("depth") === "1");
const puppet = (settings: Partial<VisualNovelSpritePuppet>) => stage.setSpritePuppet({ ...spritePuppetSettings(DEFAULT_CONFIG), ...settings });
if (q.get("outline")) puppet({ spriteOutline: Number(q.get("outline")) });
/** Click sparks, press-to-bounce, interface sounds and inner voices (scripts/test-stage-feel-browser.ts). */
const feel = (settings: Partial<VisualNovelStageFeel>) => stage.setStageFeel({ ...stageFeelSettings(DEFAULT_CONFIG), ...settings });
/** Size matching (scripts/test-sprite-size-browser.ts); the defaults apply until it is called. */
const sizeMatch = (settings: Partial<VisualNovelSpriteSizeMatch>) => stage.setSpriteSizeMatch({ ...spriteSizeMatchSettings(DEFAULT_CONFIG), ...settings });
/** Touch mode settings (scripts/test-sprite-touch-browser.ts); the defaults apply until it is called. */
const touch = (settings: Partial<VisualNovelSpriteTouch>) => stage.setSpriteTouch({ ...spriteTouchSettings(DEFAULT_CONFIG), ...settings });

let current: SpriteTurnView | null = null;
let turnCounter = 0;
/** The planned turn behind the provisional one on stage (fx.plan). */
let planned: VnTurnInput | null = null;

function load(paragraphs: FixtureParagraph[], options: { sets?: Partial<SpriteTurnView["sets"]>; plates?: Partial<SpriteTurnView["plates"]>; provisional?: boolean } = {}): void {
  const base = baseView();
  const view: SpriteTurnView = {
    staging: {
      version: 1,
      source: "planner",
      cast: CAST,
      plates: Object.values({ ...base.plates, ...options.plates }).filter(Boolean).map((p) => ({ plateKey: p!.plateKey, location: p!.location, timeOfDay: p!.timeOfDay, weather: p!.weather, description: "" })),
      paragraphs: paragraphs.map((p, index) => ({
        actors: p.actors.map((a) => ({ expression: "idle", slot: "center", facing: "viewer", focus: false, motion: "none", emote: "none", intensity: 3, ...a })),
        plateKey: p.plateKey === undefined ? (index === 0 ? "plate_classroom" : null) : p.plateKey,
        light: p.light ?? "neutral",
        ...(p.illustrate ? { illustrate: true } : {}),
      })) as SpriteParagraphStage[],
    },
    illustrations: paragraphs.flatMap((p, index) => (p.illustrate ? [illustrationView(index, p.illustration ?? "ready")] : [])),
    sets: { ...base.sets, ...options.sets } as SpriteTurnView["sets"],
    plates: { ...base.plates, ...options.plates } as SpriteTurnView["plates"],
  };
  current = view;
  turnCounter += 1;
  const turn: VnTurnInput = {
    preserveImage: true,
    paragraphs: paragraphs.map((p, index) => ({
      id: `fixture-${turnCounter}:${index}`,
      text: p.text ?? `Paragraph ${index + 1}.`,
      ...(p.speaker !== undefined ? { speaker: p.speaker } : {}),
      ...(p.ambient !== undefined ? { ambient: p.ambient as never } : {}),
      ...(p.effect !== undefined ? { effect: p.effect as never } : {}),
    })),
    sprites: view,
  };
  planned = options.provisional ? turn : null;
  stage.loadTurn(options.provisional
    ? { preserveImage: true, paragraphs: turn.paragraphs.map(({ id, text }) => ({ id, text })), planHold: 0 }
    : turn);
}

/** The plan lands for the provisional turn on stage. */
function plan(): boolean {
  const turn = planned;
  planned = null;
  return turn ? stage.upgradeTurn(turn) : false;
}

/** A key illustration changes state (the backend re-sends the turn's sprite view). */
function illustrate(index: number, status: SpriteIllustrationView["status"]): void {
  if (!current) return;
  const others = (current.illustrations ?? []).filter((item) => item.paragraphIndex !== index);
  current = { ...current, illustrations: [...others, illustrationView(index, status)] };
  stage.setSpriteTurn(current);
}

function go(index: number): void {
  const internals = stage as unknown as { advance(): void };
  let guard = 50;
  while (stage.getState().currentParagraphIndex < index && guard-- > 0) internals.advance();
  while (stage.getState().currentParagraphIndex > index && guard-- > 0) stage.previous();
}

Object.assign(window, {
  fx: {
    stage,
    load,
    plan,
    go,
    illustrate,
    spriteImage,
    retried,
    /** Every image of a set failed (the stage offers Try again). */
    failedSet: (key: string, name: string): SpriteSetView => {
      const set = makeSet(key, name, {});
      for (const id of Object.keys(set.expressions)) set.expressions[id] = { expression: id, status: "failed", error: "boom" };
      return { ...set, readyCount: 0 };
    },
    view: () => current,
    effect: (name: string) => stage.triggerEffect(name as never),
    ambient: (name: string | null) => stage.applyAmbient(name as never),
    puppet,
    feel,
    sizeMatch,
    touch,
    touchBackend,
    /** Change a cast member's appearance tags (the next load uses them). */
    identity: (key: string, tags: string) => {
      const member = CAST.find((entry) => entry.characterKey === key);
      if (member) member.identity = tags;
    },
    /** Pin the puppet's render scale (null: adaptive). */
    renderScale: (scale: number | null) => { puppetGlOptions.renderScale = scale; },
    depth: {
      configure: (ortBaseUrl: string, modelUrl: string) => {
        configureCutoutRuntime({ ortBaseUrl, numThreads: 1 });
        configurePlateDepth({ modelUrl });
      },
      seed: (url: string, width: number, height: number, depth: number[]) =>
        writeCachedModel(plateDepthStoreKey(url), encodePlateDepth({ width, height, depth: Uint8Array.from(depth) })),
      set: (enabled: boolean) => stage.setPlateDepth(enabled),
    },
  },
});
