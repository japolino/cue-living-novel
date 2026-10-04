import assert from "node:assert/strict";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../../config.js";
import { TurnPlanSchema, type TurnPlan } from "../../../shared/contracts.js";
import { POSE_EXPRESSION_CATALOGUE } from "../../../shared/character.js";
import { MAX_SPRITE_ACTORS, SpriteStagingSchema, type SpriteCastMember, type SpriteParagraphStage, type SpritePlateRef, type SpriteStaging } from "../../../shared/sprites.js";
import type { SpriteStagingInput } from "../sprite-staging.js";

/** Test fixtures for sprite staging (realistic TurnPlan shapes, as the planner fills them). */

export type SceneSpec = {
  start: number;
  sceneId?: string;
  location: string;
  timeOfDay?: string | null;
  weather?: string | null;
  lighting?: string | null;
  description?: string;
  character?: string | null;
  characterId?: string;
  cast?: string[];
  identity?: string | null;
  attire?: string | null;
};

export type CueSpec = {
  p: number;
  character: string;
  characterId?: string;
  pose: string;
  identity?: string;
  attire?: string | null;
  cache?: boolean;
};

export type PlanSpec = {
  paragraphs: string[];
  speakers?: Array<string | null>;
  scenes?: SceneSpec[];
  cues?: CueSpec[];
  absentAt?: Array<{ p: number; name: string }>;
};

const CAMERA = { framing: "medium-wide", angle: "eye level", perspective: "straight-on", lens: null, subjectAnchor: "center", horizon: "middle", safeDialogueRegion: "lower quarter", aspectRatio: "16:9" };

export function makePlan(spec: PlanSpec): TurnPlan {
  const continuity = { revision: 3, characters: {}, facts: {} };
  const sceneSpecs: SceneSpec[] = spec.scenes ?? [{ start: 0, location: "Library", timeOfDay: "evening", lighting: "lamplight", character: "Mira", cast: ["Mira"], identity: "1girl, brown hair, green eyes", attire: "school uniform" }];
  const scenes = sceneSpecs.map((scene, index) => ({
    sceneId: scene.sceneId ?? `scene-${index}`,
    revision: 1,
    startParagraph: scene.start,
    environment: {
      location: scene.location,
      timeOfDay: scene.timeOfDay ?? null,
      weather: scene.weather ?? null,
      lighting: scene.lighting ?? null,
      description: scene.description ?? `${scene.location}, quiet.`,
      persistentElements: [],
    },
    cast: scene.cast ?? (scene.character ? [scene.character] : []),
    continuity,
    basePrompt: scene.location,
    identityPrompt: scene.identity ?? null,
    cameraLock: CAMERA,
    compositionLock: "centered",
    activeAssetId: null,
    priorSceneId: index === 0 ? null : `${sceneSpecs[index - 1]!.sceneId ?? `scene-${index - 1}`}`,
    character: scene.character ?? null,
    ...(scene.characterId ? { characterId: scene.characterId } : {}),
    attire: scene.attire ?? null,
  }));
  const sceneAt = (p: number) => {
    let active = 0;
    for (const [index, scene] of sceneSpecs.entries()) if (scene.start <= p) active = index;
    return scenes[active]!;
  };
  const cue = (item: CueSpec, index: number) => ({
    cueId: `cue-${index}`,
    paragraphIndex: item.p,
    sceneId: sceneAt(item.p).sceneId,
    sceneRevision: 1,
    kind: "flattened_scene",
    action: null,
    expression: null,
    poseExpressionId: item.pose,
    character: item.character,
    ...(item.characterId ? { characterId: item.characterId } : {}),
    resolvedIdentity: item.identity ?? "",
    resolvedAttire: item.attire ?? null,
    promptDelta: "",
    assetJobId: `job-${index}`,
  });
  const cues = (spec.cues ?? []).map((item, index) => ({ item, index }));
  const deltas = (spec.absentAt ?? []).map(({ p, name }) => ({
    paragraphIndex: p,
    delta: { characterUpdates: { [name]: { present: false } }, forgetCharacters: [], factUpdates: {} },
  }));
  return TurnPlanSchema.parse({
    schemaVersion: 1,
    key: { chatId: "chat-1", assistantMessageId: "m-1", swipeId: 0, sourceFingerprint: "fingerprint-1", revision: 1 },
    paragraphs: spec.paragraphs.map((text, index) => ({ index, sourceIndex: index, text })),
    paragraphSpeakers: spec.speakers ?? [],
    scenes,
    visualCues: cues.filter(({ item }) => !item.cache).map(({ item, index }) => cue(item, index)),
    ...(cues.some(({ item }) => item.cache) ? { cacheCues: cues.filter(({ item }) => item.cache).map(({ item, index }) => cue(item, index)) } : {}),
    initialContinuity: continuity,
    continuityDeltas: deltas,
    terminalContinuity: { ...continuity, revision: continuity.revision + deltas.length },
    planningStatus: "planned",
    createdAt: "2026-10-01T00:00:00.000Z",
  });
}

export function stagingInput(plan: TurnPlan, extra: Omit<Partial<SpriteStagingInput>, "config"> & { config?: Partial<VisualNovelConfig> } = {}): SpriteStagingInput {
  const { config, ...rest } = extra;
  return {
    plan,
    config: { ...DEFAULT_CONFIG, ...config },
    styleKey: "style-1",
    knownPlates: [] as SpritePlateRef[],
    previousCast: [] as SpriteCastMember[],
    previousStage: null as SpriteParagraphStage | null,
    ...rest,
  };
}

const CATALOGUE = new Set(POSE_EXPRESSION_CATALOGUE.map((entry) => entry.id));

/** Every invariant from docs/SPRITE_MODE.md, checked on any staging. */
export function assertStagingInvariants(staging: SpriteStaging, paragraphs: number): void {
  assert.equal(SpriteStagingSchema.safeParse(staging).success, true, "schema-valid");
  assert.equal(staging.paragraphs.length, paragraphs, "one stage per paragraph");
  const castKeys = new Set(staging.cast.map((member) => member.characterKey));
  assert.equal(castKeys.size, staging.cast.length, "unique cast keys");
  const plateKeys = new Set(staging.plates.map((plate) => plate.plateKey));
  for (const [index, stage] of staging.paragraphs.entries()) {
    assert.ok(stage.actors.length <= MAX_SPRITE_ACTORS, `p${index}: at most ${MAX_SPRITE_ACTORS} actors`);
    assert.equal(new Set(stage.actors.map((actor) => actor.characterKey)).size, stage.actors.length, `p${index}: unique keys`);
    assert.equal(new Set(stage.actors.map((actor) => actor.slot)).size, stage.actors.length, `p${index}: unique slots`);
    assert.ok(stage.actors.filter((actor) => actor.focus).length <= 1, `p${index}: at most one focus`);
    for (const actor of stage.actors) {
      assert.ok(castKeys.has(actor.characterKey), `p${index}: ${actor.characterKey} is in the cast`);
      assert.ok(CATALOGUE.has(actor.expression), `p${index}: ${actor.expression} is a catalogue id`);
    }
    assert.ok(stage.plateKey === null || plateKeys.has(stage.plateKey), `p${index}: plate key exists`);
  }
}

