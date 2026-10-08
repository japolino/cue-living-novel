import { VnStage } from "../src/frontend/stage/vn-stage.js";
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
 * Query: ?preset, ?intensity (full|gentle|off), ?speed (typewriter ms), ?mode (sprites|scene).
 * window.fx: { stage, load(paragraphs, options), go(index), illustrate(index, status), ready(...), view(), effect(name), ambient(name) }.
 * Key moments: a paragraph with `illustrate: true` gets the fixture
 * illustration (`/sprites/illustration_moment.webp`, a composited close-up
 * standing in for a generated scene picture) unless `illustration` says otherwise.
 */
const q = new URL(location.href).searchParams;

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

const mount = document.createElement("div");
Object.assign(mount.style, { position: "fixed", inset: "0", background: "#08090d" });
document.body.append(mount);

const stage = new VnStage({
  mount,
  textSpeed: Number(q.get("speed") ?? 0),
  themePreset: (q.get("preset") as never) ?? "lumiverse",
  onReroll: () => {}, onSubmit: async () => {}, onChoice: async () => {}, onExit: () => {},
});
stage.setEffectIntensity((q.get("intensity") as never) ?? "full");
stage.setPresentationMode((q.get("mode") as never) ?? "sprites");

let current: SpriteTurnView | null = null;
let turnCounter = 0;

function load(paragraphs: FixtureParagraph[], options: { sets?: Partial<SpriteTurnView["sets"]>; plates?: Partial<SpriteTurnView["plates"]> } = {}): void {
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
  stage.loadTurn({
    mode: "standard",
    preserveImage: true,
    paragraphs: paragraphs.map((p, index) => ({
      id: `fixture-${turnCounter}:${index}`,
      text: p.text ?? `Paragraph ${index + 1}.`,
      ...(p.speaker !== undefined ? { speaker: p.speaker } : {}),
      ...(p.ambient !== undefined ? { ambient: p.ambient as never } : {}),
      ...(p.effect !== undefined ? { effect: p.effect as never } : {}),
    })),
    sprites: view,
  });
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
    go,
    illustrate,
    spriteImage,
    view: () => current,
    effect: (name: string) => stage.triggerEffect(name as never),
    ambient: (name: string | null) => stage.applyAmbient(name as never),
  },
});
