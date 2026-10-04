import type { SpindleAPI } from "lumiverse-spindle-types";
import { z } from "zod";
import type { VisualNovelConfig } from "../../config.js";
import {
  SPRITE_EMOTES,
  SPRITE_EXPRESSION_FALLBACK,
  SPRITE_HOT_SET,
  SPRITE_LIGHTS,
  SPRITE_MOTIONS,
  type SpriteEmote,
  type SpriteLight,
  type SpriteMotion,
  type SpritePlateRef,
} from "../../shared/sprites.js";
import { SYSTEM_ONE_KEY, systemOneEndpoint } from "./system-one.js";

/**
 * System One (Jev) questions for sprite staging. Jev answers typed questions
 * only: `choice` (2-255 options), `score` (2-10 levels) and `noul` (yes/no).
 * All questions of one request run in parallel, so the questions here are
 * independent and speculative ("fan-out"); code decides afterwards which
 * answers matter. Jev leans to the FIRST option, so the safe default
 * (`keep_current`, `none`, `new_place`, the deterministic light) always comes
 * first, and every answer below its confidence threshold is ignored: the
 * staging engine then keeps the previous/deterministic value (no flicker).
 */

/** Paragraphs per request (same as the presentation classifier). */
export const SPRITE_BATCH_PARAGRAPHS = 7;
/**
 * Request body budget in bytes. The presentation classifier enforces the
 * API's 64 KiB body limit; we stay below it with headroom. 60 KB of JSON is
 * far below the 64k-token request limit, so bytes are the binding limit.
 */
export const SPRITE_REQUEST_BYTE_LIMIT = 60_000;
/**
 * Paragraphs classified per turn. Not a silent drop: later paragraphs keep
 * their deterministic staging. 105 paragraphs = 15 parallel requests, which
 * keeps one turn far from the account's rate limit (429) while covering any
 * realistic reply (a long reply is 20-40 paragraphs).
 */
export const MAX_CLASSIFIED_PARAGRAPHS = 105;
/** Per-request deadline; Jev answers in 70-500 ms, the rest is network. */
export const SPRITE_CLASSIFIER_TIMEOUT_MS = 8_000;
/** Base delay before the single retry of a 429/529 answer. */
export const SPRITE_RETRY_DELAY_MS = 250;
/** Paragraph text sent per paragraph. */
export const SPRITE_PARAGRAPH_TEXT_LIMIT = 2_000;
/** Known places offered for reuse per scene. */
export const MAX_PLACE_OPTIONS = 96;

/** Confidence thresholds (Jev confidence 0..1; for a large choice it is close to the top probability). */
export const SPRITE_THRESHOLDS = {
  /** present = yes adds a character at or above this probability. */
  presentYes: 0.75,
  /** present = yes at or below this probability removes a character. */
  presentNo: 0.2,
  /** keep_current is honoured at or above this confidence. */
  keep: 0.4,
  /** A hot-set expression is used at or above this confidence. */
  hotExpression: 0.5,
  /** A rare expression costs a generation: it needs more confidence, else its hot-set fallback is used. */
  rareExpression: 0.65,
  motion: 0.6,
  emote: 0.6,
  intensity: 0.5,
  light: 0.6,
  place: 0.7,
} as const;

/** Hot set first (cheap: pre-generated), then curated rare expressions (generated on demand). */
export const SPRITE_EXPRESSION_GUIDE: Readonly<Record<string, string>> = {
  idle: "calm, neutral, composed; no particular emotion",
  smile: "pleased, friendly, warm, gently happy",
  laughing: "laughing out loud, amused, delighted",
  sad: "sad, hurt, downcast, but not crying",
  crying_with_eyes_open: "crying, tears running, grief or overwhelming emotion",
  angry: "angry, irritated, glaring",
  surprised: "surprised, startled, caught off guard",
  embarrassed: "embarrassed, flustered, blushing, awkward",
  worried: "worried, anxious, uneasy, concerned",
  thinking: "thinking, pondering, considering, unsure",
  smug: "smug, confident, teasing, self-satisfied",
  scared: "scared, frightened, afraid, pale",
  annoyed: "annoyed, exasperated, fed up (milder than angry)",
  enraged: "enraged, livid, seething with fury (stronger than angry)",
  pouting: "pouting, sulking, childishly displeased",
  disgusted: "disgusted, repulsed, grossed out",
  jealous: "jealous, envious, possessive",
  suspicious: "suspicious, doubtful, distrustful squint",
  serious: "serious, stern, focused, no-nonsense",
  determined: "determined, resolute, fired up",
  proud: "proud, pleased with oneself, chin up",
  smirk: "sly smirk, knowing, mischievous",
  playful_winking: "playful wink, cheeky",
  evil_smiling: "sinister smile, scheming, menacing",
  excited: "excited, eager, thrilled, sparkling eyes",
  joyful: "overjoyed, elated, grateful",
  happy_smiling: "beaming, big happy smile, cheerful",
  giggling: "giggling, stifled laugh behind a hand",
  relieved: "relieved, at ease again",
  admiring: "admiring, impressed, adoring",
  lovestruck: "lovestruck, infatuated, heart eyes",
  happy_tears: "tears of joy, moved, touched",
  crying_with_eyes_closed: "sobbing with eyes shut, wiping tears",
  teary_pouting: "on the verge of tears, trembling pout",
  depressed: "depressed, hopeless, gloomy",
  melancholic: "melancholic, wistful, quietly sad",
  disappointed: "disappointed, let down, sighing",
  guilty: "guilty, ashamed, remorseful",
  tormented: "tormented, despairing, in anguish",
  shocked: "shocked, stunned, horrified (stronger than surprised)",
  scared_screaming: "terrified, screaming in fear (stronger than scared)",
  nervous: "nervous, tense, sweating, on edge",
  pleading: "pleading, begging, imploring",
  forced_smiling: "forced smile, hiding discomfort",
  confused: "confused, bewildered, does not understand",
  curious: "curious, intrigued, interested",
  blushing_shyly: "shy and bashful, deeply blushing, covering the mouth",
  looking_away_shyly: "shyly averting the eyes, timid",
  flustered: "flustered, frazzled, romantically caught off guard",
  full_face_blush: "mortified, face burning red",
  bored: "bored, uninterested, unimpressed",
  indifferent: "indifferent, expressionless, cold, aloof",
  exhausted: "exhausted, worn out, drained",
  sleepy: "sleepy, drowsy, yawning",
};

const MOTION_GUIDE: Readonly<Record<SpriteMotion, string>> = {
  none: "no noticeable body movement",
  nod: "nods: agreement, acknowledgement",
  shake: "shakes the head or body: refusal, denial, frustration",
  hop: "a small hop: joy, excitement",
  bounce: "bouncy, springy movement: cheerful energy",
  tremble: "trembles or shivers: fear, cold, held-back emotion",
  step_back: "steps back or recoils: shock, fear, retreat",
  lean_in: "leans in or steps closer: interest, intimacy, pressing a point",
  turn_away: "turns away: refusal, shyness, sulking",
  sink: "slumps or sinks down: defeat, exhaustion, despair",
};

const EMOTE_GUIDE: Readonly<Record<SpriteEmote, string>> = {
  none: "no mark",
  sweat: "sweat drop: awkward, nervous, exasperated",
  anger: "anger vein: irritation, anger",
  heart: "heart: love, affection, delight",
  sparkle: "sparkles: excitement, admiration, pride",
  exclaim: "exclamation mark: alarm, sudden realization, startle",
  question: "question mark: confusion, puzzlement",
  ellipsis: "ellipsis: speechless, awkward silence",
  music: "music note: humming, singing, carefree",
  gloom: "gloom lines: dread, depression, deep disappointment",
  blush: "blush lines: embarrassed, flattered, romantic",
};

const LIGHT_GUIDE: Readonly<Record<SpriteLight, string>> = {
  neutral: "plain, even light; no strong time-of-day cue",
  day: "outdoor daylight",
  sunset: "warm orange evening or dawn light outdoors",
  night: "outdoors at night, moonlight",
  indoor_warm: "indoors under warm lamps or a cozy glow",
  indoor_cool: "indoors under cool white or blue light: fluorescent, screens, clinical",
  candle: "candlelight, torches or a fireplace as the main light",
  dark: "very dark, barely lit",
};

const INTENSITY_LEVELS = [
  "barely visible, subtle",
  "mild",
  "moderate, ordinary",
  "strong",
  "extreme, explosive",
];

const HOT: ReadonlySet<string> = new Set(SPRITE_HOT_SET);
const EXPRESSION_IDS: ReadonlySet<string> = new Set(Object.keys(SPRITE_EXPRESSION_GUIDE));
const MOTION_IDS: ReadonlySet<string> = new Set(SPRITE_MOTIONS);
const EMOTE_IDS: ReadonlySet<string> = new Set(SPRITE_EMOTES);
const LIGHT_IDS: ReadonlySet<string> = new Set(SPRITE_LIGHTS);

/* ------------------------------------------------------------------------ */
/* Types                                                                     */
/* ------------------------------------------------------------------------ */

export type SpriteClassifierCandidate = { key: string; name: string; onStage: boolean; speaking: boolean };

export type SpriteClassifierInput = {
  paragraphs: Array<{ index: number; text: string; speaker: string | null; sceneIndex: number; candidates: SpriteClassifierCandidate[] }>;
  scenes: Array<{
    index: number; startParagraph: number; location: string; timeOfDay: string | null; weather: string | null;
    lighting: string | null; description: string; light: SpriteLight; plateKey: string; plateKnown: boolean;
  }>;
  knownPlates: SpritePlateRef[];
  previousPlateKey: string | null;
  cast: Array<{ key: string; name: string; attire: string | null }>;
  config: VisualNovelConfig;
  userId?: string;
  signal?: AbortSignal;
};

export type SpriteParagraphOverride = {
  presence: Map<string, boolean>;
  /** Catalogue id, or "keep" for a confident keep_current. */
  expression: Map<string, string>;
  motion: Map<string, SpriteMotion>;
  emote: Map<string, SpriteEmote>;
  intensity: Map<string, number>;
};

export type SpriteStagingOverrides = {
  paragraphs: Map<number, SpriteParagraphOverride>;
  /** By scene index. */
  sceneLight: Map<number, SpriteLight>;
  /** By scene index: a known plate the scene revisits. */
  scenePlate: Map<number, SpritePlateRef>;
};

export type SpriteClassifierStats = {
  requests: number;
  failedRequests: number;
  questions: number;
  classifiedParagraphs: number;
  durationMs: number;
  inputTokens: number;
};

type Question =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };

/** What a question key means, for parsing. */
type QuestionMeta =
  | { kind: "present" | "expression" | "motion" | "emote" | "intensity"; paragraph: number; key: string }
  | { kind: "light"; scene: number }
  | { kind: "place"; scene: number; options: Map<string, SpritePlateRef> };

export type SpriteRequestBatch = {
  paragraphs: number[];
  body: Record<string, unknown>;
  questions: Record<string, Question>;
  meta: Map<string, QuestionMeta>;
  bytes: number;
};

/* ------------------------------------------------------------------------ */
/* Request building                                                          */
/* ------------------------------------------------------------------------ */

function clip(value: string | null | undefined, limit: number): string {
  const text = (value ?? "").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2));
}

/** Known plates for a scene: the previous plate first, then by word overlap. */
export function placeOptions(
  scene: SpriteClassifierInput["scenes"][number],
  knownPlates: readonly SpritePlateRef[],
  previousPlateKey: string | null,
): SpritePlateRef[] {
  const target = words(`${scene.location} ${scene.description} ${scene.timeOfDay ?? ""} ${scene.weather ?? ""}`);
  const seen = new Set<string>();
  const scored = knownPlates
    .filter((plate) => {
      if (seen.has(plate.plateKey)) return false;
      seen.add(plate.plateKey);
      return true;
    })
    .map((plate, order) => {
      const own = words(`${plate.location} ${plate.description} ${plate.timeOfDay ?? ""} ${plate.weather ?? ""}`);
      let overlap = 0;
      for (const word of own) if (target.has(word)) overlap += 1;
      return { plate, score: plate.plateKey === previousPlateKey ? Number.POSITIVE_INFINITY : overlap, order };
    })
    .sort((left, right) => right.score - left.score || left.order - right.order);
  return scored.slice(0, MAX_PLACE_OPTIONS).map(({ plate }) => plate);
}

function paragraphQuestions(
  paragraph: SpriteClassifierInput["paragraphs"][number],
  castIndex: Map<string, number>,
): Array<[string, Question, QuestionMeta]> {
  const out: Array<[string, Question, QuestionMeta]> = [];
  const ref = `\`paragraphs.p${paragraph.index}\``;
  for (const candidate of paragraph.candidates) {
    const id = `p${paragraph.index}_c${castIndex.get(candidate.key) ?? 0}`;
    const name = candidate.name;
    const meta = (kind: "present" | "expression" | "motion" | "emote" | "intensity"): QuestionMeta => ({ kind, paragraph: paragraph.index, key: candidate.key });
    if (!candidate.speaking) {
      out.push([`${id}_present`, {
        type: "noul",
        instructions: `During paragraph ${ref}, is ${name} physically present in the scene, in person and in view? A character who was present earlier stays present until the text says they leave. Answer no if ${name} is only mentioned, remembered, imagined, on the phone, or has left.`,
        criteria: { true: `${name} is physically there`, false: `${name} is absent or only mentioned` },
      }, meta("present")]);
    }
    out.push([`${id}_expression`, {
      type: "choice",
      instructions: `Which facial expression from \`expressions\` should ${name}'s sprite show during paragraph ${ref}? Choose keep_current unless the paragraph shows or clearly implies a new feeling for ${name}.`,
      criteria: { keep_current: `No clear new feeling for ${name}; keep the current expression`, ...Object.fromEntries([...EXPRESSION_IDS].map((expression) => [expression, null])) },
    }, meta("expression")]);
    out.push([`${id}_motion`, {
      type: "choice",
      instructions: `Does the text of paragraph ${ref} describe ${name} making one of the body movements in \`motions\`? Choose none unless ${name} clearly does it.`,
      criteria: { none: `${name} makes no such movement`, ...Object.fromEntries(SPRITE_MOTIONS.filter((motion) => motion !== "none").map((motion) => [motion, null])) },
    }, meta("motion")]);
    out.push([`${id}_emote`, {
      type: "choice",
      instructions: `Which manga-style mark from \`emotes\` fits ${name} during paragraph ${ref}? Choose none unless ${name}'s feeling is clear and strong.`,
      criteria: { none: "No mark", ...Object.fromEntries(SPRITE_EMOTES.filter((emote) => emote !== "none").map((emote) => [emote, null])) },
    }, meta("emote")]);
    out.push([`${id}_intensity`, {
      type: "score",
      instructions: `How strong is ${name}'s visible reaction during paragraph ${ref}?`,
      criteria: INTENSITY_LEVELS,
    }, meta("intensity")]);
  }
  return out;
}

function sceneQuestions(
  scene: SpriteClassifierInput["scenes"][number],
  input: Pick<SpriteClassifierInput, "knownPlates" | "previousPlateKey">,
): Array<[string, Question, QuestionMeta]> {
  const out: Array<[string, Question, QuestionMeta]> = [];
  const ref = `\`scenes.s${scene.index}\``;
  const lights = [scene.light, ...SPRITE_LIGHTS.filter((light) => light !== scene.light)];
  out.push([`s${scene.index}_light`, {
    type: "choice",
    instructions: `Which lighting should the character sprites get so they match the place and time of scene ${ref}?`,
    criteria: Object.fromEntries(lights.map((light) => [light, LIGHT_GUIDE[light]])),
  }, { kind: "light", scene: scene.index }]);
  if (!scene.plateKnown && input.knownPlates.length) {
    const plates = placeOptions(scene, input.knownPlates, input.previousPlateKey);
    const options = new Map<string, SpritePlateRef>();
    const criteria: Record<string, string> = { new_place: "None of these places fits exactly (another place, or the same place at another time of day or weather)" };
    for (const [index, plate] of plates.entries()) {
      const option = `place_${index + 1}`;
      options.set(option, plate);
      const when = [plate.timeOfDay, plate.weather].filter(Boolean).join(", ");
      criteria[option] = clip(`${plate.location}${when ? ` (${when})` : ""}: ${plate.description}`, 160);
    }
    out.push([`s${scene.index}_place`, {
      type: "choice",
      instructions: `Is scene ${ref} the same place, at the same time of day and weather, as one of these known places, so the same empty background picture fits? Choose new_place unless one fits exactly, even if it is worded differently.`,
      criteria,
    }, { kind: "place", scene: scene.index, options }]);
  }
  return out;
}

/** Split the turn into requests: at most 7 paragraphs and SPRITE_REQUEST_BYTE_LIMIT bytes each. */
export function buildSpriteRequests(input: Omit<SpriteClassifierInput, "config" | "signal" | "userId">, model: string): SpriteRequestBatch[] {
  const castIndex = new Map(input.cast.map((member, index) => [member.key, index] as const));
  const castByKey = new Map(input.cast.map((member) => [member.key, member] as const));
  const scenesByIndex = new Map(input.scenes.map((scene) => [scene.index, scene] as const));
  const sceneStartsAt = new Map(input.scenes.map((scene) => [scene.startParagraph, scene] as const));
  const paragraphs = input.paragraphs.slice(0, MAX_CLASSIFIED_PARAGRAPHS);
  const encoder = new TextEncoder();

  const assemble = (indexes: number[]): SpriteRequestBatch => {
    const questions: Record<string, Question> = {};
    const meta = new Map<string, QuestionMeta>();
    const statePlaces: Record<string, unknown> = {};
    const stateParagraphs: Record<string, unknown> = {};
    const castKeys = new Set<string>();
    const sceneIndexes = new Set<number>();
    for (const index of indexes) {
      const paragraph = paragraphs.find((candidate) => candidate.index === index)!;
      sceneIndexes.add(paragraph.sceneIndex);
      for (const candidate of paragraph.candidates) castKeys.add(candidate.key);
      stateParagraphs[`p${index}`] = { scene: `s${paragraph.sceneIndex}`, speaker: paragraph.speaker ?? "unknown", text: clip(paragraph.text, SPRITE_PARAGRAPH_TEXT_LIMIT) };
      for (const [key, question, info] of paragraphQuestions(paragraph, castIndex)) {
        questions[key] = question;
        meta.set(key, info);
      }
      const startingScene = sceneStartsAt.get(index);
      if (startingScene) {
        for (const [key, question, info] of sceneQuestions(startingScene, input)) {
          questions[key] = question;
          meta.set(key, info);
        }
      }
    }
    for (const sceneIndex of sceneIndexes) {
      const scene = scenesByIndex.get(sceneIndex);
      if (!scene) continue;
      statePlaces[`s${sceneIndex}`] = {
        location: clip(scene.location, 300),
        time_of_day: scene.timeOfDay,
        weather: scene.weather,
        lighting: scene.lighting,
        description: clip(scene.description, 600),
      };
    }
    const first = indexes[0] ?? 0;
    const before = input.paragraphs.find((paragraph) => paragraph.index === first - 1);
    const onStageBefore = (input.paragraphs.find((paragraph) => paragraph.index === first)?.candidates ?? [])
      .filter((candidate) => candidate.onStage && !candidate.speaking)
      .map((candidate) => candidate.name);
    const body = {
      model,
      state: {
        task: "Visual novel staging. Characters are shown as cut-out sprites over an empty background picture. Decide, per paragraph, who is visible and how each visible character looks.",
        cast: [...castKeys].map((key) => {
          const member = castByKey.get(key);
          return { name: member?.name ?? key, ...(member?.attire ? { outfit: clip(member.attire, 200) } : {}) };
        }),
        scenes: statePlaces,
        ...(before ? { previous_paragraph: clip(before.text, 600) } : {}),
        ...(onStageBefore.length ? { also_on_stage: onStageBefore } : {}),
        paragraphs: stateParagraphs,
        expressions: SPRITE_EXPRESSION_GUIDE,
        motions: MOTION_GUIDE,
        emotes: EMOTE_GUIDE,
      },
      questions,
    };
    return { paragraphs: indexes, body, questions, meta, bytes: encoder.encode(JSON.stringify(body)).length };
  };

  const batches: SpriteRequestBatch[] = [];
  let current: number[] = [];
  let currentBatch: SpriteRequestBatch | null = null;
  for (const paragraph of paragraphs) {
    const hasQuestions = paragraph.candidates.length > 0 || sceneStartsAt.has(paragraph.index);
    if (!hasQuestions) continue;
    const tryIndexes = [...current, paragraph.index];
    const attempt = assemble(tryIndexes);
    if (tryIndexes.length <= SPRITE_BATCH_PARAGRAPHS && attempt.bytes <= SPRITE_REQUEST_BYTE_LIMIT) {
      current = tryIndexes;
      currentBatch = attempt;
      continue;
    }
    if (currentBatch) batches.push(currentBatch);
    const alone = assemble([paragraph.index]);
    if (alone.bytes <= SPRITE_REQUEST_BYTE_LIMIT) {
      current = [paragraph.index];
      currentBatch = alone;
    } else {
      // Cannot fit even alone (should not happen with the caps above): keep it deterministic.
      current = [];
      currentBatch = null;
    }
  }
  if (currentBatch) batches.push(currentBatch);
  return batches;
}

/* ------------------------------------------------------------------------ */
/* Response parsing                                                          */
/* ------------------------------------------------------------------------ */

const ChoiceAnswer = z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number().min(0).max(1) }).passthrough();
const NoulAnswer = z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }).passthrough();
const ScoreAnswer = z.object({ type: z.literal("score"), score: z.number(), confidence: z.number().min(0).max(1) }).passthrough();
const AnyAnswer = z.discriminatedUnion("type", [ChoiceAnswer, NoulAnswer, ScoreAnswer]);
const ResponseSchema = z.object({
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({ input_tokens: z.number().nullable().optional() }).passthrough().optional(),
}).passthrough();
type Answer = z.infer<typeof AnyAnswer>;

function emptyParagraphOverride(): SpriteParagraphOverride {
  return { presence: new Map(), expression: new Map(), motion: new Map(), emote: new Map(), intensity: new Map() };
}

/** Apply one batch's answers to the overrides, honouring the confidence thresholds. */
export function applySpriteAnswers(
  overrides: SpriteStagingOverrides,
  meta: ReadonlyMap<string, QuestionMeta>,
  answers: Record<string, unknown>,
): void {
  const t = SPRITE_THRESHOLDS;
  for (const [questionKey, info] of meta) {
    const parsed = AnyAnswer.safeParse(answers[questionKey]);
    if (!parsed.success) continue;
    const answer: Answer = parsed.data;
    if (info.kind === "light") {
      if (answer.type === "choice" && answer.confidence >= t.light && LIGHT_IDS.has(answer.choice)) overrides.sceneLight.set(info.scene, answer.choice as SpriteLight);
      continue;
    }
    if (info.kind === "place") {
      if (answer.type === "choice" && answer.confidence >= t.place && answer.choice !== "new_place") {
        const plate = info.options.get(answer.choice);
        if (plate) overrides.scenePlate.set(info.scene, plate);
      }
      continue;
    }
    let paragraph = overrides.paragraphs.get(info.paragraph);
    if (!paragraph) {
      paragraph = emptyParagraphOverride();
      overrides.paragraphs.set(info.paragraph, paragraph);
    }
    switch (info.kind) {
      case "present":
        if (answer.type !== "noul") break;
        if (answer.noul >= t.presentYes) paragraph.presence.set(info.key, true);
        else if (answer.noul <= t.presentNo) paragraph.presence.set(info.key, false);
        break;
      case "expression": {
        if (answer.type !== "choice") break;
        if (answer.choice === "keep_current") {
          if (answer.confidence >= t.keep) paragraph.expression.set(info.key, "keep");
          break;
        }
        if (!EXPRESSION_IDS.has(answer.choice) || answer.confidence < t.hotExpression) break;
        if (HOT.has(answer.choice) || answer.confidence >= t.rareExpression) paragraph.expression.set(info.key, answer.choice);
        else paragraph.expression.set(info.key, SPRITE_EXPRESSION_FALLBACK[answer.choice] ?? "idle");
        break;
      }
      case "motion":
        if (answer.type === "choice" && answer.choice !== "none" && answer.confidence >= t.motion && MOTION_IDS.has(answer.choice)) {
          paragraph.motion.set(info.key, answer.choice as SpriteMotion);
        }
        break;
      case "emote":
        if (answer.type === "choice" && answer.choice !== "none" && answer.confidence >= t.emote && EMOTE_IDS.has(answer.choice)) {
          paragraph.emote.set(info.key, answer.choice as SpriteEmote);
        }
        break;
      case "intensity":
        if (answer.type === "score" && answer.confidence >= t.intensity && Number.isFinite(answer.score)) {
          paragraph.intensity.set(info.key, Math.max(1, Math.min(5, Math.round(answer.score) + 1)));
        }
        break;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* Transport                                                                 */
/* ------------------------------------------------------------------------ */

function abortError(): Error {
  const error = new Error("Sprite staging classifier aborted");
  error.name = "AbortError";
  return error;
}

function withDeadline<T>(promise: Promise<T>, ms: number, signal: AbortSignal | undefined): Promise<T> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Sprite staging classifier timed out after ${ms} ms`));
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => {
      cleanup();
      resolve(value);
    }, (error: unknown) => {
      cleanup();
      reject(error);
    });
  });
}

/**
 * Ask Jev. Returns null when System One is off or no key is saved, or when
 * every request failed. Throws on abort and on configuration errors (the
 * caller falls back to deterministic staging).
 */
export async function classifySpriteStaging(
  spindle: SpindleAPI,
  input: SpriteClassifierInput,
  options: { timeoutMs?: number } = {},
): Promise<{ overrides: SpriteStagingOverrides; stats: SpriteClassifierStats } | null> {
  if (input.config.systemOneMode === "off") return null;
  if (input.signal?.aborted) throw abortError();
  const key = await spindle.enclave.get(SYSTEM_ONE_KEY, input.userId);
  if (!key) return null;
  const model = input.config.systemOneModel.trim();
  if (!model) throw new Error("System One model is missing");
  const endpoint = systemOneEndpoint(input.config.systemOneApiUrl);
  const batches = buildSpriteRequests(input, model);
  if (!batches.length) return null;
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? SPRITE_CLASSIFIER_TIMEOUT_MS;
  const send = async (body: string) => withDeadline(Promise.resolve(spindle.cors(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body,
  })), timeoutMs, input.signal) as Promise<{ status: number; body: string } | null | undefined>;
  const results = await Promise.allSettled(batches.map(async (batch) => {
    const body = JSON.stringify(batch.body);
    let response = await send(body);
    // Rate limited or overloaded: one short, jittered retry (the API asks for backoff).
    if (response && (response.status === 429 || response.status === 529)) {
      await withDeadline(new Promise((resolve) => setTimeout(resolve, SPRITE_RETRY_DELAY_MS + Math.floor(Math.random() * SPRITE_RETRY_DELAY_MS))), timeoutMs, input.signal);
      response = await send(body);
    }
    if (!response || response.status < 200 || response.status >= 300) throw new Error(`System One request failed (${response?.status ?? "no response"})`);
    return ResponseSchema.parse(JSON.parse(response.body));
  }));
  if (input.signal?.aborted) throw abortError();
  const overrides: SpriteStagingOverrides = { paragraphs: new Map(), sceneLight: new Map(), scenePlate: new Map() };
  let failedRequests = 0;
  let inputTokens = 0;
  let classifiedParagraphs = 0;
  let lastError: unknown = null;
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      failedRequests += 1;
      lastError = result.reason;
      continue;
    }
    applySpriteAnswers(overrides, batches[index]!.meta, result.value.answers);
    inputTokens += result.value.usage?.input_tokens ?? 0;
    classifiedParagraphs += batches[index]!.paragraphs.length;
  }
  const stats: SpriteClassifierStats = {
    requests: batches.length,
    failedRequests,
    questions: batches.reduce((total, batch) => total + Object.keys(batch.questions).length, 0),
    classifiedParagraphs,
    durationMs: Date.now() - started,
    inputTokens,
  };
  try {
    const failure = failedRequests ? ` failed=${failedRequests} (${lastError instanceof Error ? lastError.message : String(lastError)})` : "";
    spindle.log?.info?.(`[VN] Sprite staging classifier requests=${stats.requests} questions=${stats.questions} paragraphs=${stats.classifiedParagraphs}/${input.paragraphs.length} durationMs=${stats.durationMs} inputTokens=${stats.inputTokens}${failure}`);
  } catch {
    // logging must never break staging
  }
  if (failedRequests === batches.length) return null;
  return { overrides, stats };
}
