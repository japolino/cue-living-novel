import { VnStage } from "./frontend/stage/index.js";
import { isThemePresetId } from "./frontend/theme/presets.js";
import {
  SPRITE_HOT_SET,
  type PlateView,
  type SpriteActorStage,
  type SpriteCastMember,
  type SpriteImageView,
  type SpriteParagraphStage,
  type SpriteSetView,
  type SpriteTurnView,
} from "./shared/sprites.js";

/**
 * Sprite-mode preview: `?sprites` on the standalone demo. A short scripted
 * scene with the fixture sprites and plates from scripts/fixtures/sprites/
 * (copied to demo/fixtures/sprites/ by `bun run build:demo`).
 * Also takes `&preset=<theme preset id>` and `&mode=standard|cyoa`.
 */
const mount = document.querySelector<HTMLElement>("#preview");
if (!mount) throw new Error("Preview mount is missing.");

const query = new URLSearchParams(location.search);
const mode = query.get("mode") === "standard" ? "standard" : "cyoa";
const requestedPreset = query.get("preset");
const themePreset = isThemePresetId(requestedPreset) ? requestedPreset : "lumiverse";

const asset = (file: string) => new URL(`./fixtures/sprites/${file}.webp`, location.href).href;

/** Opaque bbox of each fixture cut-out (alpha > 24), normalized [x, y, w, h]. */
const BBOX: Record<string, [number, number, number, number]> = {
  mira_idle: [0.0865, 0.0214, 0.7716, 0.9786],
  aoi_idle: [0.1298, 0.0181, 0.7548, 0.9819],
  ren_idle: [0.0577, 0, 0.8702, 1],
};

function spriteImage(file: string, expression: string): SpriteImageView {
  return { expression, status: "ready", url: asset(file), bbox: BBOX[file] ?? [0, 0, 1, 1], width: 416, height: 608 };
}

/** A set with only the given expressions ready; the rest of the hot set is "missing". */
function makeSet(key: string, name: string, ready: Record<string, string>): SpriteSetView {
  const expressions: Record<string, SpriteImageView> = {};
  for (const id of SPRITE_HOT_SET) expressions[id] = { expression: id, status: "missing" };
  for (const [expression, file] of Object.entries(ready)) expressions[expression] = spriteImage(file, expression);
  return { setKey: `demo_${key}`, name, attire: null, expressions, readyCount: Object.keys(ready).length, updatedAt: "2026-10-01T00:00:00Z" };
}

const plate = (plateKey: string, location: string, timeOfDay: string): PlateView => ({
  plateKey, location, timeOfDay, weather: null, status: "ready", url: asset(plateKey),
});

const CAST: SpriteCastMember[] = [
  { characterKey: "mira", name: "Mira", identity: "blonde twintails", attire: "maid outfit" },
  { characterKey: "aoi", name: "Aoi", identity: "long black hair", attire: "sailor uniform" },
  { characterKey: "ren", name: "Ren", identity: "short black hair", attire: "black jacket" },
];

const PLATES: Record<string, PlateView> = {
  plate_classroom: plate("plate_classroom", "classroom", "day"),
  plate_street: plate("plate_street", "city street", "night"),
};

type Actor = Partial<SpriteActorStage> & Pick<SpriteActorStage, "characterKey" | "slot">;
type Beat = { speaker?: string; text: string; actors: Actor[]; plateKey?: string; light: SpriteParagraphStage["light"] };

/**
 * The script. Expressions name what the line wants. The fixtures have one
 * matching image per character (the other fixture expressions are a different
 * art style), so every expression is a stand-in: the stage shows the nearest
 * ready one (bestAvailableExpression), which is "idle".
 */
const BEATS: Beat[] = [
  {
    plateKey: "plate_classroom", light: "day",
    text: "The last bell has long since rung. Dust drifts through the afternoon light, and only one desk by the window is still occupied.",
    actors: [{ characterKey: "mira", slot: "center", expression: "idle" }],
  },
  {
    speaker: "Mira", light: "day",
    text: "\"<shout>Wait</shout> — you're still here?\" Mira nearly drops her notebook. \"I thought I was the last one!\"",
    actors: [{ characterKey: "mira", slot: "center", expression: "surprised", focus: true, motion: "hop", emote: "exclaim", intensity: 4 }],
  },
  {
    speaker: "Aoi", light: "day",
    text: "Aoi slips in through the door, eyes on the floor. \"<whisper>I missed the train again…</whisper>\"",
    actors: [
      { characterKey: "aoi", slot: "left", expression: "sad", focus: true, motion: "sink", emote: "ellipsis", facing: "right" },
      { characterKey: "mira", slot: "right", expression: "idle" },
    ],
  },
  {
    speaker: "Mira", light: "day",
    text: "\"Then walk with me. The next one isn't for an hour, and the station is <wave>right on my way</wave>.\"",
    actors: [
      { characterKey: "aoi", slot: "left", expression: "sad", facing: "right" },
      { characterKey: "mira", slot: "right", expression: "smile", focus: true, motion: "lean_in", emote: "music" },
    ],
  },
  {
    speaker: "Ren", light: "day",
    text: "\"Count me in.\" Ren leans on the doorframe, jacket over one shoulder. \"Somebody has to make sure you two don't get lost.\"",
    actors: [
      { characterKey: "aoi", slot: "left", expression: "surprised", emote: "question" },
      { characterKey: "ren", slot: "center", expression: "smug", focus: true, motion: "nod", emote: "sparkle" },
      { characterKey: "mira", slot: "right", expression: "annoyed", emote: "anger" },
    ],
  },
  {
    plateKey: "plate_street", light: "night",
    text: "By the time they reach the main street, the sky has gone dark, a soft rain has started, and the shop signs have flickered on, one by one.",
    actors: [
      { characterKey: "aoi", slot: "left", expression: "idle" },
      { characterKey: "ren", slot: "center", expression: "idle" },
      { characterKey: "mira", slot: "right", expression: "idle" },
    ],
  },
  {
    speaker: "Aoi", light: "night",
    text: "\"<glow>It's so pretty.</glow>\" For the first time all day, Aoi almost smiles. \"I never stay late enough to see it.\"",
    actors: [
      { characterKey: "aoi", slot: "left", expression: "relieved", focus: true, motion: "bounce", emote: "heart", intensity: 2 },
      { characterKey: "ren", slot: "center", expression: "idle" },
      { characterKey: "mira", slot: "right", expression: "smile" },
    ],
  },
  {
    speaker: "Ren", light: "night",
    text: "\"This is my turn-off.\" Ren raises a hand without looking back. \"Don't miss the train <tremble>this</tremble> time, Aoi.\"",
    actors: [
      { characterKey: "aoi", slot: "left", expression: "embarrassed", emote: "sweat" },
      { characterKey: "ren", slot: "center", expression: "idle", focus: true, motion: "turn_away", facing: "left" },
      { characterKey: "mira", slot: "right", expression: "idle" },
    ],
  },
  {
    light: "night",
    text: "His footsteps fade into the traffic noise. The two girls stand under the station lights a little longer than they need to.",
    actors: [
      { characterKey: "aoi", slot: "left", expression: "idle", facing: "right" },
      { characterKey: "mira", slot: "right", expression: "idle", facing: "left" },
    ],
  },
  {
    speaker: "Mira", light: "night",
    text: "\"Hey, Aoi.\" Mira hops to face her. \"<rainbow>Same time tomorrow?</rainbow>\"",
    actors: [
      { characterKey: "aoi", slot: "left", expression: "surprised", emote: "blush" },
      { characterKey: "mira", slot: "right", expression: "laughing", focus: true, motion: "hop", emote: "sparkle", intensity: 4 },
    ],
  },
];

function spriteView(): SpriteTurnView {
  return {
    staging: {
      version: 1,
      source: "planner",
      cast: CAST,
      plates: Object.values(PLATES).map((p) => ({ plateKey: p.plateKey, location: p.location, timeOfDay: p.timeOfDay, weather: p.weather, description: "" })),
      paragraphs: BEATS.map((beat) => ({
        actors: beat.actors.map((actor) => ({ expression: "idle", facing: "viewer", focus: false, motion: "none", emote: "none", intensity: 3, ...actor })),
        plateKey: beat.plateKey ?? null,
        light: beat.light,
      })),
    },
    sets: {
      mira: makeSet("mira", "Mira", { idle: "mira_idle" }),
      aoi: makeSet("aoi", "Aoi", { idle: "aoi_idle" }),
      ren: makeSet("ren", "Ren", { idle: "ren_idle" }),
    },
    plates: PLATES,
  };
}

let turnCounter = 0;

function loadScene(): void {
  turnCounter += 1;
  stage.loadTurn({
    mode,
    paragraphs: BEATS.map((beat, index) => ({
      id: `sprites-${turnCounter}-${index}`,
      text: beat.text,
      ...(beat.speaker ? { speaker: beat.speaker } : {}),
    })),
    choices: [
      { id: "tomorrow", label: "\"Same time tomorrow.\"", value: "Same time tomorrow." },
      { id: "walk", label: "Walk Aoi to the platform", value: "Let me walk you to the platform." },
      { id: "ren", label: "Run after Ren", value: "Wait up, Ren!" },
    ],
    sprites: spriteView(),
  });
}

const stage = new VnStage({
  mount,
  themePreset,
  onChoice: async (choice) => {
    stage.setActivity(`Selected: ${choice.label}`, "success");
  },
  onSubmit: async (text) => {
    stage.setActivity(`Submitted: ${text}`, "loading");
  },
  onReroll: () => loadScene(),
  onSwipe: () => loadScene(),
  onExit: () => stage.setActivity("Exit would restore Lumiverse chat.", "warning"),
});
stage.setPresentationMode("sprites");
loadScene();

/** Say on screen that most expressions are stand-ins. */
const note = document.createElement("div");
note.setAttribute("data-demo-sprite-note", "");
note.textContent = "Sprite mode demo · fixture art, one image per character: expression changes are stand-ins (shown as idle).";
Object.assign(note.style, {
  position: "fixed", left: "12px", top: "12px", zIndex: "2147483000",
  maxWidth: "min(calc(100vw - 180px), 560px)", padding: "4px 10px", borderRadius: "10px",
  font: "11px/1.35 system-ui, sans-serif", color: "rgba(255,255,255,.72)", background: "rgba(8,10,18,.6)",
  textAlign: "left", pointerEvents: "none",
});
document.body.append(note);

Object.assign(globalThis, {
  __visualNovelPreview: stage,
  __spriteDemo: { stage, loadScene, beats: BEATS.length },
});
