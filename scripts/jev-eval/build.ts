/**
 * Turn a labeled EvalReply into the exact inputs Cue builds at runtime:
 * TurnPlan (planner shape) -> sprite staging context -> deterministic staging
 * -> SpriteClassifierInput -> buildSpriteRequests (the real request bodies).
 */
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../src/config.js";
import { makePlan, stagingInput, type CueSpec, type SceneSpec } from "../../src/backend/runtime/__fixtures__/sprite-staging-plans.js";
import {
  spriteClassifierInput,
  spriteStagingContext,
  stageParagraphs,
  type SpriteStagingContext,
  type SpriteStagingInput,
} from "../../src/backend/runtime/sprite-staging.js";
import { buildSpriteRequests, type SpriteClassifierInput, type SpriteRequestBatch } from "../../src/backend/runtime/system-one-sprites.js";
import { plateKeyFor, type SpritePlateRef, type SpriteStaging } from "../../src/shared/sprites.js";
import type { TurnPlan } from "../../src/shared/contracts.js";
import { PLATES } from "./dataset/plates.js";
import type { CharLabel, EvalReply, KeyMomentLabel } from "./types.js";

export const STYLE_KEY = "style-1";
export const MODEL = "jev-latest";

export const EVAL_CONFIG: VisualNovelConfig = {
  ...DEFAULT_CONFIG,
  presentationMode: "sprites",
  systemOneMode: "on",
  keyIllustrations: "few",
  generateImages: true,
  useNativeCardImages: false,
};

export const KNOWN_PLATES: SpritePlateRef[] = PLATES.map((plate) => ({
  plateKey: plateKeyFor({ location: plate.location, timeOfDay: plate.timeOfDay, weather: plate.weather }, STYLE_KEY),
  location: plate.location,
  timeOfDay: plate.timeOfDay,
  weather: plate.weather,
  description: plate.description,
}));
export const PLATE_ID_BY_KEY = new Map(KNOWN_PLATES.map((plate, index) => [plate.plateKey, PLATES[index]!.id] as const));

export type ResolvedChar = Required<Pick<CharLabel, "e" | "m" | "em" | "i">> & { eSet: Set<string>; mSet: Set<string>; emSet: Set<string>; iSet: Set<number> };
export type ResolvedParagraph = {
  index: number;
  sceneIndex: number;
  present: Set<string>;
  chars: Map<string, ResolvedChar>;
  /** Best expression in the previous paragraph of the same scene (oracle "current"), by name. */
  previous: Map<string, string>;
  km: KeyMomentLabel;
  qualifies: boolean;
  levelSet: Set<number>;
  interactionSet: Set<string>;
};

export type EvalCase = {
  reply: EvalReply;
  plan: TurnPlan;
  input: SpriteStagingInput;
  context: SpriteStagingContext;
  deterministic: SpriteStaging;
  classifierInput: Omit<SpriteClassifierInput, "config">;
  batches: SpriteRequestBatch[];
  labels: ResolvedParagraph[];
  /** Cast key -> name. */
  names: Map<string, string>;
};

const DEFAULT_KM: KeyMomentLabel = { level: 0, standing: true, interaction: "none" };

export function resolveLabels(reply: EvalReply): ResolvedParagraph[] {
  const out: ResolvedParagraph[] = [];
  let sceneIndex = 0;
  let last = new Map<string, ResolvedChar>();
  for (const [index, paragraph] of reply.paragraphs.entries()) {
    while (sceneIndex + 1 < reply.scenes.length && reply.scenes[sceneIndex + 1]!.start <= index) {
      sceneIndex += 1;
      last = new Map();
    }
    const previous = new Map([...last].map(([name, label]) => [name, label.e] as const));
    const chars = new Map<string, ResolvedChar>();
    for (const name of paragraph.present) {
      const own = paragraph.chars?.[name];
      const carried = last.get(name);
      let resolved: ResolvedChar;
      if (own) {
        const i = own.i ?? 3;
        resolved = {
          e: own.e,
          m: own.m ?? "none",
          em: own.em ?? "none",
          i,
          eSet: new Set([own.e, ...(own.eo ?? [])]),
          mSet: new Set([own.m ?? "none", ...(own.mo ?? [])]),
          emSet: new Set([own.em ?? "none", ...(own.emo ?? [])]),
          iSet: new Set(own.io ?? [i - 1, i, i + 1].filter((value) => value >= 1 && value <= 5)),
        };
      } else if (carried) {
        resolved = { ...carried, m: "none", em: "none", mSet: new Set(["none"]), emSet: new Set(["none"]) };
      } else {
        throw new Error(`${reply.id} p${index}: ${name} has no labels`);
      }
      chars.set(name, resolved);
    }
    for (const [name, label] of chars) last.set(name, label);
    for (const name of [...last.keys()]) if (!paragraph.present.includes(name)) last.delete(name);
    const km = paragraph.km ?? DEFAULT_KM;
    const levelSet = new Set(km.levelOk ?? [km.level - 1, km.level, km.level + 1].filter((level) => level >= 0 && level <= 4 && (level >= 3) === (km.level >= 3)));
    out.push({
      index,
      sceneIndex,
      present: new Set(paragraph.present),
      chars,
      previous,
      km,
      qualifies: km.level >= 3 && !km.standing,
      levelSet,
      interactionSet: new Set([km.interaction, ...(km.interactionOk ?? [])]),
    });
  }
  return out;
}

export function buildCase(reply: EvalReply, options: { keyMomentsEverywhere?: boolean } = {}): EvalCase {
  const identity = new Map(reply.cast.map((member) => [member.name, member] as const));
  const scenes: SceneSpec[] = reply.scenes.map((scene) => ({
    start: scene.start,
    location: scene.location,
    timeOfDay: scene.timeOfDay,
    weather: scene.weather,
    lighting: scene.lighting,
    description: scene.description,
    character: scene.character,
    cast: scene.cast,
    identity: scene.character ? identity.get(scene.character)?.identity ?? null : null,
    attire: scene.character ? identity.get(scene.character)?.attire ?? null : null,
  }));
  const cues: CueSpec[] = [];
  const absentAt: Array<{ p: number; name: string }> = [];
  for (const [index, paragraph] of reply.paragraphs.entries()) {
    if (paragraph.cue) {
      const member = identity.get(paragraph.cue.character);
      cues.push({ p: index, character: paragraph.cue.character, pose: paragraph.cue.pose, identity: member?.identity ?? "", attire: member?.attire ?? null });
    }
    for (const name of paragraph.leaves ?? []) absentAt.push({ p: index, name });
  }
  const plan = makePlan({
    paragraphs: reply.paragraphs.map((paragraph) => paragraph.text),
    speakers: reply.paragraphs.map((paragraph) => paragraph.speaker),
    scenes,
    cues,
    absentAt,
  });
  const input = stagingInput(plan, { config: EVAL_CONFIG, personaName: reply.persona, knownPlates: KNOWN_PLATES });
  const context = spriteStagingContext(input);
  const deterministic = stageParagraphs(context, null, "planner");
  const base = spriteClassifierInput(context, deterministic);
  const classifierInput = options.keyMomentsEverywhere === false
    ? base
    : { ...base, keyMomentParagraphs: reply.paragraphs.map((_, index) => index) };
  const batches = buildSpriteRequests(classifierInput, MODEL);
  const names = new Map([...context.pool.members.values()].map((member) => [member.characterKey, member.name] as const));
  return { reply, plan, input, context, deterministic, classifierInput, batches, labels: resolveLabels(reply), names };
}
