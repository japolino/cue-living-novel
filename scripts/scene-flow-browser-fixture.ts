import { DEFAULT_READING_FLOW, VnStage, type VnReadingFlow } from "../src/frontend/stage/vn-stage.js";
import type { VnTurnInput } from "../src/frontend/store/vn-store.js";
import {
  SPRITE_HOT_SET,
  type PlateView,
  type SpriteActorStage,
  type SpriteImageView,
  type SpriteParagraphStage,
  type SpriteSetView,
  type SpriteTurnView,
} from "../src/shared/sprites.js";

/**
 * Browser fixture for how a reply opens, waits and ends
 * (scripts/test-scene-flow-browser.ts): the opening card, the location label,
 * the waiting screen's backdrops and recaps, and the reply box's extras. The
 * sprites and plates are the fixture cut-outs in scripts/fixtures/sprites/.
 *
 * Query: ?card (title|off), ?preset, ?intensity (full|gentle|off), ?cast (3|4).
 * window.fx: { stage, flow(patch), load(), toEnd(), waiting(), state() }.
 */
const q = new URL(location.href).searchParams;

/** Opaque bbox and detected face of each fixture cut-out (as in sprite-stage-browser-fixture.ts). */
const BBOX: Record<string, [number, number, number, number]> = {
  mira_idle: [0.0865, 0.0214, 0.7716, 0.9786],
  mira_surprised: [0.0072, 0.0214, 0.9639, 0.9786],
  aoi_idle: [0.1298, 0.0181, 0.7548, 0.9819],
  aoi_sad: [0.0048, 0.0016, 0.9231, 0.9984],
  ren_idle: [0.0577, 0, 0.8702, 1],
  kaede_idle: [0.0361, 0, 0.9255, 1],
};
const FACE: Record<string, [number, number, number, number]> = {
  mira_idle: [0.3669, 0.16, 0.2343, 0.1497],
  mira_surprised: [0.3379, 0.1397, 0.2968, 0.2147],
  aoi_idle: [0.3346, 0.1215, 0.2358, 0.15],
  aoi_sad: [0.3516, 0.1097, 0.2926, 0.1943],
  ren_idle: [0.3726, 0.0816, 0.2149, 0.1531],
  kaede_idle: [0.4023, 0.1373, 0.2394, 0.1564],
};

const image = (file: string, expression: string): SpriteImageView => ({
  expression, status: "ready", url: `/sprites/${file}.webp`, bbox: BBOX[file] ?? [0, 0, 1, 1], width: 416, height: 608, ...(FACE[file] ? { face: FACE[file] } : {}),
});
function makeSet(key: string, name: string, ready: Record<string, string>): SpriteSetView {
  const expressions: Record<string, SpriteImageView> = {};
  for (const id of SPRITE_HOT_SET) expressions[id] = { expression: id, status: "queued" };
  for (const [expression, file] of Object.entries(ready)) expressions[expression] = image(file, expression);
  return { setKey: `set_${key}`, name, attire: null, expressions, readyCount: Object.keys(ready).length, updatedAt: "2026-10-01T00:00:00Z" };
}
const plate = (key: string, location: string, timeOfDay: string): PlateView => ({
  plateKey: key, location, timeOfDay, weather: null, status: "ready", url: `/sprites/${key}.webp`,
});

const withKaede = q.get("cast") === "4";
const CAST = [
  { characterKey: "mira", name: "Mira", identity: "", attire: null },
  { characterKey: "aoi", name: "Aoi", identity: "", attire: null },
  { characterKey: "ren", name: "Ren", identity: "", attire: null },
  { characterKey: "kaede", name: "Kaede", identity: "", attire: null },
];

type Line = { text: string; speaker: string; actors: Array<Partial<SpriteActorStage> & { characterKey: string }>; plateKey?: string };
const LINES: Line[] = [
  { speaker: "Mira", text: "“You're late again!” Mira slams both hands on the desk.", plateKey: "plate_classroom",
    actors: [{ characterKey: "mira", focus: true, motion: "hop" }] },
  { speaker: "Aoi", text: "“Sorry… the train stopped twice,” Aoi says, eyes on the floor.",
    actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "aoi", slot: "right", focus: true, expression: "sad" }] },
  { speaker: "", text: "The bell rings. Chairs scrape, and the room empties around them.",
    actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "aoi", slot: "right" }] },
  { speaker: "LOGIC", text: "Statistically, an invitation at this hour ends in karaoke.",
    actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "aoi", slot: "right" }] },
  { speaker: "Ren", text: "“Are you two coming or not?” Ren calls from the gate.", plateKey: "plate_park",
    actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "ren", slot: "center", focus: true, emote: "anger" }, { characterKey: "aoi", slot: "right" }] },
  { speaker: "Mira", text: "“Wait — Ren is actually inviting us?” Mira gasps.",
    actors: [{ characterKey: "mira", slot: "left", focus: true, expression: "surprised", motion: "step_back" }, { characterKey: "ren", slot: "center" }, { characterKey: "aoi", slot: "right" }] },
  ...(withKaede ? [{ speaker: "Kaede", text: "“Make room, I'm coming too,” Kaede laughs, jogging up.",
    actors: [{ characterKey: "ren", slot: "left" }, { characterKey: "kaede", slot: "center", focus: true, motion: "bounce" }, { characterKey: "aoi", slot: "right" }] } as Line] : []),
  { speaker: "Aoi", text: "“Then… just this once,” Aoi says, and almost smiles.",
    actors: withKaede
      ? [{ characterKey: "mira", slot: "left", expression: "surprised" }, { characterKey: "aoi", slot: "center", focus: true }, { characterKey: "kaede", slot: "right" }]
      : [{ characterKey: "mira", slot: "left", expression: "surprised" }, { characterKey: "ren", slot: "center" }, { characterKey: "aoi", slot: "right", focus: true }] },
];

const mount = document.createElement("div");
Object.assign(mount.style, { position: "fixed", inset: "0", background: "#08090d" });
document.body.append(mount);

const counters = { submits: 0 };
const stage = new VnStage({
  mount,
  textSpeed: 0,
  themePreset: (q.get("preset") as never) ?? "lumiverse",
  onReroll: () => {}, onSubmit: async () => { counters.submits += 1; }, onChoice: async () => {}, onExit: () => {},
});
stage.setEffectIntensity((q.get("intensity") as never) ?? "full");
stage.setPresentationMode("sprites");
let flowNow: VnReadingFlow = { ...DEFAULT_READING_FLOW, openingCard: (q.get("card") as never) ?? "off", playOnArrival: false };
stage.setReadingFlow(flowNow);

function flow(patch: Partial<VnReadingFlow>): void {
  flowNow = { ...flowNow, ...patch };
  stage.setReadingFlow(flowNow);
}

let turnCounter = 0;
function load(): void {
  turnCounter += 1;
  const view: SpriteTurnView = {
    staging: {
      version: 1,
      source: "planner",
      cast: withKaede ? CAST : CAST.slice(0, 3),
      plates: [
        { plateKey: "plate_classroom", location: "classroom", timeOfDay: "after school", weather: null, description: "" },
        { plateKey: "plate_park", location: "park", timeOfDay: "dusk", weather: null, description: "" },
      ],
      paragraphs: LINES.map((line) => ({
        actors: line.actors.map((actor) => ({ expression: "idle", slot: "center", facing: "viewer", focus: false, motion: "none", emote: "none", intensity: 3, ...actor })),
        plateKey: line.plateKey ?? null,
        light: "neutral",
      })) as SpriteParagraphStage[],
    },
    sets: {
      mira: makeSet("mira", "Mira", { idle: "mira_idle", surprised: "mira_surprised" }),
      aoi: makeSet("aoi", "Aoi", { idle: "aoi_idle", sad: "aoi_sad" }),
      ren: makeSet("ren", "Ren", { idle: "ren_idle" }),
      kaede: makeSet("kaede", "Kaede", { idle: "kaede_idle" }),
    },
    plates: {
      plate_classroom: plate("plate_classroom", "classroom", "after school"),
      plate_park: plate("plate_park", "park", "dusk"),
    },
  };
  const turn: VnTurnInput = {
    preserveImage: true,
    paragraphs: LINES.map((line, index) => ({ id: `scene-${turnCounter}:${index}`, text: line.text, speaker: line.speaker })),
    sprites: view,
    scenes: [
      { startParagraph: 0, location: "Classroom 2-B, Seiran Academy", timeOfDay: "after school", weather: "clear" },
      { startParagraph: 4, location: "School gate, Seiran Academy", timeOfDay: "dusk", weather: "light breeze" },
    ],
    cardBackgroundUrl: "/sprites/plate_park.webp",
    writer: "Mira",
  };
  stage.loadTurn(turn);
}

const internals = stage as unknown as { advance(fromReader?: boolean): void };
function toEnd(): void {
  for (let guard = 0; guard < 40 && stage.getState().phase === "revealing"; guard += 1) internals.advance();
}
/** The reader sent a line and the next reply is being written. */
function waiting(): void {
  toEnd();
  stage.presentUserParagraph("Let's all walk to the station together.", "Alex");
  toEnd();
  stage.setPhase("waiting-for-response");
}

load();
Object.assign(window, { fx: { stage, flow, load, toEnd, waiting, counters, state: () => stage.getState() } });
