/**
 * Key-moment illustrations (sprite mode, `keyIllustrations` "few"): the
 * picture of one paragraph with up to two characters DOING something (a
 * kiss, a hug, sitting, a fight …), in the paragraph's place and light.
 *
 * This is not the single-subject scene compiler (describeCue): a key moment
 * needs both people, their interaction and a framing that fits it. Identity
 * and outfit tags are the sprite set's (the same text the sprites use), the
 * place is the paragraph's plate, the light its staged light.
 *
 * Pure: `keyMomentScene` builds the data from a staged plan, and
 * `compileKeyMomentRequest` turns it into the provider's prompt syntax.
 */
import type { VisualNovelConfig } from "../../../config.js";
import { POSE_EXPRESSION_CATALOGUE, poseById } from "../../../shared/character.js";
import type { AssetJob, TurnPlan, VisualCue } from "../../../shared/contracts.js";
import {
  SPRITE_INTERACTION_TAGS,
  type SpriteInteraction,
  type SpriteKeyMoment,
  type SpriteLight,
  type SpritePlateRef,
  type SpriteStaging,
} from "../../../shared/sprites.js";
import { splitTopLevelCsv } from "../../inlay-prompt/index.js";
import { applyAttireOverride, classifySubject, isClothingTag } from "../images.js";
import { novelAiCapabilities, renderNovelAiEmphasis } from "../novelai-prompt.js";
import { keyMomentCues, keyMomentFor } from "./key-moments.js";
import {
  comfyNegative,
  dedupeSections,
  novelAiNegative,
  novelAiQuality,
  PLATE_NEGATIVE_TAGS,
  PLATE_SIZE,
  renderComfy,
  sizeParameters,
  spriteIdentityTags,
  stylePrefix,
  tagKey,
  type SpriteImageRequest,
  type SpritePromptMember,
} from "./prompts.js";

/**
 * Key moments are landscape, like plates: 912×624 ("standard") or 1216×832
 * ("upscaled") on ComfyUI / SwarmUI, always 1216×832 on NovelAI.
 */
export const KEY_MOMENT_SIZE = PLATE_SIZE;

/** Extra negative tags for every key moment: a real scene, one picture. */
export const KEY_MOMENT_NEGATIVE_TAGS = "simple background, white background, multiple views, text";
/** Two characters: keep the model from drawing only one. */
export const KEY_MOMENT_PAIR_NEGATIVE_TAGS = "solo";
/** No character: the place itself. */
export const KEY_MOMENT_EMPTY_TAGS = "scenery, no humans, detailed background, wide shot";

/** Prompt tags for the staged light (the plate's time of day is added separately). */
export const KEY_MOMENT_LIGHT_TAGS: Readonly<Record<SpriteLight, string>> = {
  neutral: "",
  day: "daylight",
  sunset: "sunset, warm lighting",
  night: "night, moonlight",
  indoor_warm: "indoors, warm lighting",
  indoor_cool: "indoors, cool lighting",
  candle: "candlelight, warm lighting",
  dark: "dark, low light",
};

export type KeyMomentCharacter = SpritePromptMember & {
  /** Catalogue expression id from the paragraph's staging (face only is used). */
  expression?: string | null;
};

export type KeyMomentScene = {
  interaction: SpriteInteraction;
  /** 0–2 characters, most important first. */
  characters: KeyMomentCharacter[];
  /** One character interacts with someone who is not in the cast (first-person view). */
  partner: boolean;
  plate: Pick<SpritePlateRef, "location" | "timeOfDay" | "weather" | "description"> | null;
  light: SpriteLight;
};

/* ------------------------------------------------------------------------ */
/* Scene data from a staged plan                                             */
/* ------------------------------------------------------------------------ */

/** The plate in effect at a paragraph: its own, else the latest earlier one. */
function plateAt(staging: Pick<SpriteStaging, "paragraphs" | "plates">, index: number): SpritePlateRef | null {
  for (let i = Math.min(index, staging.paragraphs.length - 1); i >= 0; i -= 1) {
    const key = staging.paragraphs[i]?.plateKey;
    if (key) return staging.plates.find((plate) => plate.plateKey === key) ?? null;
  }
  return null;
}

function cueMember(cue: VisualCue | undefined): KeyMomentCharacter | null {
  const identity = cue?.resolvedIdentity?.trim() ?? "";
  const name = cue?.character?.trim() ?? "";
  if (!cue || !identity || !name) return null;
  return {
    name,
    identity,
    attire: cue.resolvedAttire ?? cue.attire ?? null,
    ...(cue.subjectCategory ? { subjectCategory: cue.subjectCategory } : {}),
    expression: cue.poseExpressionId ?? null,
  };
}

/**
 * What the key-moment picture of a paragraph shows. The staged `moment`
 * decides (older records without one get the text rule). When the moment
 * names no cast member, the paragraph's cue character is used (its resolved
 * identity), so a picture never invents a person.
 */
export function keyMomentScene(
  plan: Pick<TurnPlan, "paragraphs" | "visualCues" | "cacheCues">,
  staging: Pick<SpriteStaging, "cast" | "plates" | "paragraphs">,
  paragraphIndex: number,
): KeyMomentScene {
  const stage = staging.paragraphs[paragraphIndex] ?? { actors: [], plateKey: null, light: "neutral" as const };
  const names = new Map(staging.cast.map((member) => [member.characterKey, member.name] as const));
  const moment: SpriteKeyMoment = stage.moment ?? keyMomentFor(stage, plan.paragraphs[paragraphIndex]?.text ?? "", names);
  const characters: KeyMomentCharacter[] = [];
  for (const key of moment.characters) {
    const member = staging.cast.find((candidate) => candidate.characterKey === key);
    if (!member || characters.length >= 2) continue;
    const actor = stage.actors.find((candidate) => candidate.characterKey === key);
    characters.push({
      name: member.name,
      identity: member.identity,
      attire: member.attire,
      ...(member.subjectCategory ? { subjectCategory: member.subjectCategory } : {}),
      expression: actor?.expression ?? null,
    });
  }
  let partner = moment.partner && characters.length === 1;
  if (characters.length === 0) {
    const fallback = cueMember(keyMomentCues(plan as Pick<TurnPlan, "visualCues" | "cacheCues" | "paragraphs">).get(paragraphIndex));
    if (fallback) {
      characters.push(fallback);
      partner = SPRITE_INTERACTION_TAGS[moment.interaction].solo === null;
    }
  }
  return { interaction: moment.interaction, characters, partner, plate: plateAt(staging, paragraphIndex), light: stage.light ?? "neutral" };
}

/**
 * The picture of each key-illustration job of a sprite-planned turn, by job
 * id (jobs at a paragraph without `illustrate` are skipped).
 */
export function keyMomentScenes(
  plan: Pick<TurnPlan, "paragraphs" | "visualCues" | "cacheCues" | "spriteStaging">,
  jobs: readonly Pick<AssetJob, "jobId" | "paragraphIndex">[],
): Map<string, KeyMomentScene> {
  const scenes = new Map<string, KeyMomentScene>();
  const staging = plan.spriteStaging;
  if (!staging) return scenes;
  for (const job of jobs) {
    if (!staging.paragraphs[job.paragraphIndex]?.illustrate) continue;
    scenes.set(job.jobId, keyMomentScene(plan, staging, job.paragraphIndex));
  }
  return scenes;
}

/* ------------------------------------------------------------------------ */
/* Prompt                                                                    */
/* ------------------------------------------------------------------------ */

/** Counting and solo tags: the moment's own count tags replace them. */
const COUNT_TAG = /^(?:\d+\+?(?:girl|boy|other)s?|solo|solo focus|multiple (?:girls|boys|others))$/i;
/** Expression suffix words about the body: the interaction decides the pose. */
const BODY_WORDS = /\b(?:standing|posture|pose|looking at viewer|looking (?:off|away|down|up)|glancing|hands?|arms?|wav(?:e|ing)|leaning|sitting|fists?|fingers?|chin|hips|stretch\w*|crossed|pointing|middle finger|holding)\b/i;

function stripCounts(tags: string): string {
  return splitTopLevelCsv(tags).map((tag) => tag.trim()).filter((tag) => tag && !COUNT_TAG.test(tag)).join(", ");
}

/** At most this many face tags per character: the interaction leads, the face colours it. */
const MAX_FACE_TAGS = 3;

/**
 * Face-only tags of a catalogue expression ("idle" adds nothing). With
 * `eyesSet` (the interaction already says "closed eyes") eye and mouth tags
 * are dropped so they cannot contradict it.
 */
export function keyMomentFaceTags(expression: string | null | undefined, eyesSet = false): string {
  if (!expression || expression === "idle") return "";
  const pose = poseById(POSE_EXPRESSION_CATALOGUE, expression);
  if (pose.id === "idle") return "";
  // Emphasis groups ("{{{embarrassed, @_@, raised eyebrows}}}") are opened up: each tag is judged alone.
  const plain = pose.suffix.replace(/[{}[\]]/g, "").replace(/\(([^()]*?)(?::\d+(?:\.\d+)?)?\)/g, "$1");
  return splitTopLevelCsv(plain)
    .map((tag) => tag.trim())
    .filter((tag) => !/@_@|\bspiral\b/i.test(tag))
    .filter((tag) => tag && !BODY_WORDS.test(tag) && !(eyesSet && /\b(?:eyes?|mouth|@_@)\b|@_@/i.test(tag)))
    .slice(0, MAX_FACE_TAGS)
    .join(", ");
}

type Subject = { label: "girl" | "boy" | "other"; character: KeyMomentCharacter };

function subjectOf(character: KeyMomentCharacter): Subject {
  const [label] = classifySubject(spriteIdentityTags(character), character.subjectCategory ?? "unknown");
  return { label: label === "boy" ? "boy" : label === "other" ? "other" : "girl", character };
}

/** "1girl" / "2girls" / "1boy, 1girl" … (Danbooru counting). */
export function keyMomentCountTags(labels: readonly Subject["label"][]): string {
  const out: string[] = [];
  for (const label of ["girl", "boy", "other"] as const) {
    const count = labels.filter((candidate) => candidate === label).length;
    if (count === 1) out.push(`1${label}`);
    else if (count > 1) out.push(`${count}${label}s`);
  }
  return out.join(", ");
}

function placeTags(plate: KeyMomentScene["plate"]): { place: string; description: string } {
  if (!plate) return { place: "", description: "" };
  const description = plate.description.trim();
  const location = plate.location.trim().toLowerCase();
  const redundant = !description || description.toLowerCase() === location || description.toLowerCase() === `a quiet ${location}.`;
  const place = [plate.location, plate.timeOfDay ?? "", plate.weather ?? ""].map((part) => part.trim()).filter(Boolean).join(", ");
  return { place, description: redundant ? "" : description };
}

/** The interaction's tags for this cast size (pair, solo, or first-person with an unknown partner). */
export function keyMomentInteractionTags(scene: Pick<KeyMomentScene, "interaction" | "characters" | "partner">): string {
  const spec = SPRITE_INTERACTION_TAGS[scene.interaction];
  if (scene.characters.length >= 2) return spec.pair;
  if (scene.characters.length === 0) return "";
  if (scene.partner || spec.solo === null) return spec.pov ?? spec.solo ?? "";
  return spec.solo;
}

/**
 * Sections in order: head, character blocks, tail. Head and tail are
 * deduplicated together; each character block only within itself (two
 * characters may both have "long hair") and against head and tail.
 */
function assemble(head: string[], blocks: string[], tail: string[]): string[] {
  const headKept = dedupeSections(head);
  const tailKept = dedupeSections([...head, ...tail]).slice(headKept.length);
  const shared = new Set([...headKept, ...tailKept].flatMap((section) => splitTopLevelCsv(section)).map(tagKey));
  const blockKept = blocks
    .map((block) => dedupeSections([block])[0] ?? "")
    .map((block) => splitTopLevelCsv(block).map((tag) => tag.trim()).filter((tag) => tag && !shared.has(tagKey(tag))).join(", "))
    .filter(Boolean);
  return [...headKept, ...blockKept, ...tailKept];
}

/**
 * A character as one short phrase for tag providers with two characters:
 * "a girl with silver hair, long hair, wearing white blouse, navy skirt,
 * embarrassed". In the owner's ComfyUI tests (Anima) this kept each outfit
 * on its own character, where two bare tag blocks swapped them.
 */
export function keyMomentCharacterPhrase(label: Subject["label"], character: KeyMomentCharacter, face: string): string {
  const identity = stripCounts(character.identity);
  const attire = character.attire?.trim() ?? "";
  const tags = splitTopLevelCsv(identity).map((tag) => tag.trim()).filter(Boolean);
  const body = attire ? stripCounts(applyAttireOverride(identity, "")) : tags.filter((tag) => !isClothingTag(tag)).join(", ");
  const clothes = attire || tags.filter((tag) => isClothingTag(tag)).join(", ");
  const noun = label === "other" ? "a person" : `a ${label}`;
  return [
    body ? `${noun} with ${body}` : noun,
    clothes ? `wearing ${clothes}` : "",
    face,
  ].filter(Boolean).join(", ");
}

/** NovelAI V4+ action tag per character caption (`mutual#…`, `source#…` / `target#…`). */
function novelAiActions(scene: KeyMomentScene, subjects: Subject[]): string[] {
  const action = SPRITE_INTERACTION_TAGS[scene.interaction].action;
  if (!action || subjects.length < 2) return subjects.map(() => "");
  if (action.kind === "mutual") return subjects.map(() => `mutual#${action.tag}`);
  // Directed: the first character acts, except that in a mixed pair being
  // carried the boy carries.
  let source = 0;
  if (scene.interaction === "carrying") {
    const boy = subjects.findIndex((subject) => subject.label === "boy");
    if (boy >= 0 && subjects.some((subject) => subject.label !== "boy")) source = boy;
  }
  return subjects.map((_, index) => `${index === source ? "source" : "target"}#${action.tag}`);
}

/**
 * Key-moment request in the provider's syntax. NovelAI V4+: count tags,
 * interaction, framing, place and light in the base prompt and one
 * character caption per character (identity + outfit + face + action tag),
 * as scene prompts do for one character. ComfyUI and others: count tags,
 * interaction, then both characters' tag blocks, framing, place, light.
 * Landscape size (plate size, see spriteImageSizeFor); no fixed seed (Retry gives a new picture).
 */
export function compileKeyMomentRequest(input: {
  config: VisualNovelConfig;
  provider: string | null;
  scene: KeyMomentScene;
}): SpriteImageRequest {
  const { config, provider, scene } = input;
  const subjects = scene.characters.slice(0, 2).map(subjectOf);
  const pair = subjects.length >= 2;
  const firstPerson = subjects.length === 1 && (scene.partner || SPRITE_INTERACTION_TAGS[scene.interaction].solo === null);
  const count = subjects.length === 0
    ? ""
    : `${keyMomentCountTags(subjects.map((subject) => subject.label))}${pair ? "" : firstPerson ? ", solo focus" : ", solo"}`;
  const interaction = keyMomentInteractionTags({ ...scene, characters: subjects.map((subject) => subject.character) });
  const framing = subjects.length === 0 ? KEY_MOMENT_EMPTY_TAGS : SPRITE_INTERACTION_TAGS[scene.interaction].framing;
  const { place, description } = placeTags(scene.plate);
  const light = KEY_MOMENT_LIGHT_TAGS[scene.light] ?? "";
  const eyesSet = /\bclosed eyes\b/i.test(interaction);
  const blocks = subjects.map((subject) => dedupeSections([
    stripCounts(spriteIdentityTags(subject.character)),
    keyMomentFaceTags(subject.character.expression, eyesSet),
  ]).join(", "));
  const negativeExtra = subjects.length === 0
    ? PLATE_NEGATIVE_TAGS
    : [KEY_MOMENT_NEGATIVE_TAGS, pair ? KEY_MOMENT_PAIR_NEGATIVE_TAGS : ""].filter(Boolean).join(", ");
  const extra = sizeParameters(provider, "moment", config);
  if (provider === "novelai") {
    const model = config.imageModel || "nai-diffusion-4-5-full";
    const caps = novelAiCapabilities(model);
    const actions = novelAiActions(scene, subjects);
    const captions = caps.structured
      ? subjects.map((subject, index) => dedupeSections([subject.label, blocks[index] ?? "", actions[index] ?? ""]).join(", ")).filter(Boolean)
      : [];
    const base = caps.structured
      ? dedupeSections([stylePrefix(config, true), count, interaction, framing, place, description, light, config.promptSuffix])
      : assemble([stylePrefix(config, true), count, interaction], blocks, [framing, place, description, light, config.promptSuffix]);
    const quality = novelAiQuality(config, model, [...base, ...captions], false);
    const prompt = renderNovelAiEmphasis([...base, ...quality].join(", "), model);
    const negativePrompt = novelAiNegative(config, negativeExtra, model);
    return {
      prompt,
      negativePrompt,
      parameters: {
        qualityToggle: false,
        negativePrompt,
        characterTags: captions.map((tags) => ({ tags: renderNovelAiEmphasis(tags, model) })),
        ...extra,
      },
    };
  }
  // Two characters: one phrase each keeps outfits apart (see keyMomentCharacterPhrase).
  const tagBlocks = pair
    ? subjects.map((subject) => keyMomentCharacterPhrase(subject.label, subject.character, keyMomentFaceTags(subject.character.expression, eyesSet)))
    : blocks;
  const sections = assemble([stylePrefix(config, false), count, interaction], tagBlocks, [framing, place, description, light, config.promptSuffix]);
  return { prompt: renderComfy(sections), negativePrompt: comfyNegative(config, negativeExtra), parameters: extra };
}

/** Normalized tag list of a prompt (tests and diagnostics). */
export function promptTagKeys(prompt: string): string[] {
  return splitTopLevelCsv(prompt.replace(/\n+/g, " ")).map(tagKey).filter(Boolean);
}
