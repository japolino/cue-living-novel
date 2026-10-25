import type { DecisionQuestion, DecisionState, SpindleAPI } from "lumiverse-spindle-types";
import { z } from "zod";
import type { VisualNovelConfig } from "../../config.js";
import type { DecisionStatus } from "../../protocol.js";
import type { SceneState } from "../../shared/contracts.js";
import { POSE_EXPRESSION_CATALOGUE } from "../../shared/character.js";
import { getAudioCatalog } from "./audio-catalog.js";
import { SCENE_CHANGED_ABOVE, sceneScore, type JevSceneAnswer, type JevWardrobeAnswers } from "../core/change-decisions.js";

/** The enclave entry where Cue kept its own System One key; deleted on the first status check. */
export const LEGACY_SYSTEM_ONE_KEY = "system_one_api_key";

/** Where the reader sets up System One: Lumiverse's own setting, not Cue's. */
const DECISION_SETTING_HINT = "In Lumiverse, open Connections → Decision models, add a connection and set it as default.";
const NO_DECISIONS_API = "This Lumiverse has no Decision models. Update Lumiverse to use System One.";
const NO_DEFAULT_CONNECTION = `No default Decision connection. ${DECISION_SETTING_HINT}`;
const NO_PERMISSION = "Cue needs the Decision models permission. Grant it to Cue in Lumiverse's Extensions panel.";

/** A host error as one sentence that names the Lumiverse setting to fix, where there is one. */
export function decisionErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/no default decision connection/i.test(message)) return NO_DEFAULT_CONNECTION;
  if (/PERMISSION_DENIED:?\s*decisions/i.test(message)) return NO_PERMISSION;
  if (/no readable api key for decision connection/i.test(message)) return `${message}. Add its key in Lumiverse: Connections → Decision models.`;
  return message;
}

/**
 * Which Decision connection System One would use: Lumiverse's default one.
 * Never throws; a failed lookup is "unavailable" with the reason.
 */
export async function decisionConnectionStatus(spindle: SpindleAPI, userId?: string): Promise<DecisionStatus> {
  const decisions = (spindle as Partial<SpindleAPI>).decisions;
  if (typeof decisions?.listConnections !== "function") return { state: "unavailable", error: NO_DECISIONS_API };
  try {
    const connections = await decisions.listConnections(userId ? { userId } : undefined);
    const chosen = connections.find((connection) => connection.is_default);
    if (!chosen) return { state: "missing", error: NO_DEFAULT_CONNECTION };
    if (!chosen.has_api_key) {
      return { state: "unavailable", name: chosen.name, model: chosen.model, error: `The default Decision connection "${chosen.name}" has no API key. Add it in Lumiverse: Connections → Decision models.` };
    }
    return { state: "ready", name: chosen.name, model: chosen.model };
  } catch (error) {
    return { state: "unavailable", error: decisionErrorText(error) };
  }
}

/** Users told this backend run that System One cannot reach a Decision connection. */
const warnedSetup = new Set<string>();

/**
 * A turn's System One requests failed. When the reason is Lumiverse's setup
 * (no Decision models, no default connection or key, no permission), say so
 * once per user in a toast instead of falling back quietly; a request that
 * works again clears it.
 */
export function warnDecisionSetup(spindle: SpindleAPI, error: unknown, userId?: string): void {
  const reason = error instanceof Error ? error.message : String(error ?? "");
  const setup = reason === NO_DECISIONS_API || reason === NO_PERMISSION || reason.includes("Connections → Decision models");
  const key = userId ?? "";
  if (!setup || warnedSetup.has(key)) return;
  warnedSetup.add(key);
  try {
    spindle.toast?.warning?.(`${reason} Until then, Cue uses the story reader.`, { title: "Cue: System One is on", ...(userId ? { userId } : {}) });
  } catch {
    // a toast must never break the turn
  }
}

export type DecisionRequest = { state: unknown; questions: Record<string, unknown> };

/**
 * One System One request through Lumiverse's default Decision connection
 * (Lumiverse holds the key, URL and model). Returns the raw result for the
 * caller's own schema. Throws with a reason that names Lumiverse's setting
 * when it is missing.
 */
export async function sendDecision(
  spindle: SpindleAPI,
  request: DecisionRequest,
  options: { userId?: string; signal?: AbortSignal } = {},
): Promise<unknown> {
  const decisions = (spindle as Partial<SpindleAPI>).decisions;
  if (typeof decisions?.evaluate !== "function") throw new Error(NO_DECISIONS_API);
  let result: unknown;
  try {
    result = await decisions.evaluate(
      { state: request.state as DecisionState, questions: request.questions as Record<string, DecisionQuestion>, ...(options.userId ? { userId: options.userId } : {}) },
      options.signal ? { signal: options.signal } : undefined,
    );
  } catch (error) {
    throw new Error(decisionErrorText(error));
  }
  warnedSetup.delete(options.userId ?? "");
  return result;
}

const Answer = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), choice: z.string(), confidence: z.number().min(0).max(1), probabilities: z.record(z.string(), z.number()) }),
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
]);
const Response = z.object({
  model: z.string(),
  answers: z.record(z.string(), Answer),
  usage: z.object({ input_tokens: z.number().nullable().optional(), output_tokens: z.number().nullable().optional() }).optional(),
});
type AnswerValue = z.infer<typeof Answer>;

/** A known character's outfit at the start of the turn. */
export type WardrobeQuestion = { name: string; attire: string };
/** Raw Jev answers for one character (decided in core/change-decisions.ts). */
export type WardrobeAnswers = WardrobeQuestion & JevWardrobeAnswers;
export const MAX_WARDROBE_QUESTIONS = 3;
/** Paragraphs the per-paragraph questions (speaker, expression, audio) cover. */
export const SYSTEM_ONE_MAX_PARAGRAPHS = 24;
/** The API's 64 KiB request limit, less room for the model id Lumiverse adds to each request. */
const REQUEST_BYTE_LIMIT = 65_536 - 1024;
const PARAGRAPH_TEXT_LIMIT = 3000;

/*
 * The change questions (the whole set lives here; core/change-decisions.ts
 * scores the answers). Texts from the October 2026 bench, copied as tested.
 */

/** Scene: one choice about the START of the reply (h6-bg-jev). */
export const SCENE_QUESTION = {
  type: "choice",
  instructions: "Compared with previousScene, what happens at the start of the reply?",
  criteria: {
    same_place: "Same place and about the same time as previousScene",
    same_place_reworded: "Same place as previousScene, only named differently, or only a short time passes",
    moved_within_building: "The characters are in another room or area of the same building or site",
    different_place: "The characters are in a clearly different place",
    big_time_jump: "Same place but a big time jump (hours later, night to morning, next day)",
    flashback_or_call: "A flashback, memory, dream, phone call or plan; the characters' real place does not change",
  },
} as const;

const MAJOR_GARMENTS = "top, bottoms, dress, outerwear such as apron/jacket/hoodie, swimwear, sleepwear, underwear-only, nudity";

/** Outfit: a choice and a yes/no per character, the outfit in the question text (h2-jev-whole). */
export function wardrobeQuestions(entry: WardrobeQuestion): { choice: unknown; noul: unknown } {
  const name = entry.name;
  const outfit = entry.attire.trim().slice(0, 300);
  return {
    choice: {
      type: "choice",
      instructions: `Compare what ${name} is wearing at the END of these paragraphs with her outfit before them: "${outfit}". Did ${name} put on, take off or swap a major garment (${MAJOR_GARMENTS}), or end up in a clearly different outfit? Rewording, small details (socks, a button, accessories), other people's clothes, memories and plans do not count.`,
      criteria: {
        same_outfit: "still wears the same clothes; only rewording or minor details differ, or her clothes are not mentioned.",
        changed_outfit: "changed, removed or added a major garment, or ends in a different outfit.",
      },
    },
    noul: {
      type: "noul",
      instructions: `Is ${name} wearing different clothes at the end of these paragraphs than at the start? Her outfit at the start: ${outfit}. Only count putting on, taking off or swapping a major garment (${MAJOR_GARMENTS}). Rewording, minor details like socks or accessories, other people's clothes, memories and plans do not count.`,
    },
  };
}

/** Reply text for the change questions: no HTML tags, no 80+ character blobs (base64). */
export function cleanReplyText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .split(/(\s+)/)
    .filter((token) => !/^\S{80,}$/.test(token))
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** The start of the reply for the scene question: the first 2 chunks of <= 3000 chars (paragraphs merged in order). */
export function sceneStartChunks(paragraphs: ReadonlyArray<{ text: string }>): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const text = cleanReplyText(paragraph.text);
    if (!text) continue;
    if (current && current.length + 2 + text.length <= PARAGRAPH_TEXT_LIMIT) {
      current = `${current}\n\n${text}`;
      continue;
    }
    if (current) chunks.push(current);
    if (chunks.length >= 2) return chunks;
    current = text.slice(0, PARAGRAPH_TEXT_LIMIT);
  }
  if (current && chunks.length < 2) chunks.push(current);
  return chunks;
}

export type SystemOneDecisions = {
  speakers: Map<number, string>;
  expressions: Map<number, string>;
  bgm: Map<number, string>;
  sfx: Map<number, string>;
  sceneChange: boolean;
  needsDescription: boolean;
  /** Per known character with an outfit (input order); empty when none was asked. */
  wardrobe: WardrobeAnswers[];
  /** The scene question's answer; null without a previous scene or a usable answer. */
  scene: JevSceneAnswer | null;
  /** Last paragraph index the wardrobe answers cover (the whole reply). */
  coveredThrough: number;
  durationMs: number;
  inputTokens: number;
};

function chosen(answer: AnswerValue | undefined, allowed: Set<string>, threshold: number): string | null {
  if (answer?.type !== "choice" || answer.confidence < threshold || !allowed.has(answer.choice)) return null;
  return answer.choice;
}

export async function decidePresentation(
  spindle: SpindleAPI,
  input: { paragraphs: Array<{ index: number; text: string }>; previousScene: SceneState | null; names: string[]; personaName?: string; wardrobe?: WardrobeQuestion[]; config: VisualNovelConfig; userId?: string },
): Promise<SystemOneDecisions | null> {
  if (input.config.systemOneMode === "off") return null;

  const names = [...new Set(["Narrator", ...(input.personaName ? [input.personaName] : []), ...input.names].filter(Boolean))].slice(0, 32);
  const poses = POSE_EXPRESSION_CATALOGUE.slice(0, 16);
  const poseIds = poses.map((pose) => pose.id);
  const audio = getAudioCatalog();
  const music = audio.bgm.slice(0, 24);
  const sounds = audio.sfx.slice(0, 24);
  const questions: Record<string, unknown> = {};
  // Reuse is safe only when the scene questions can see every paragraph in full.
  const completeSceneView = input.paragraphs.length <= 7 && input.paragraphs.every((paragraph) => paragraph.text.length <= 3000);
  if (input.previousScene && completeSceneView) {
    questions.needs_description = { type: "noul", instructions: "Does the target response add a visible location, wardrobe, appearance, prop, or action not represented in the previous scene?" };
  }
  for (const paragraph of input.paragraphs.slice(0, SYSTEM_ONE_MAX_PARAGRAPHS)) {
    const index = paragraph.index;
    questions[`speaker_${index}`] = { type: "choice", instructions: `Who speaks or owns paragraph ${index}? Choose Narrator for omniscient narration; choose unknown when the text does not identify a speaker.`, criteria: Object.fromEntries([...names, "unknown"].map((name) => [name, name === "unknown" ? "The speaker cannot be determined" : null])) };
    questions[`expression_${index}`] = { type: "choice", instructions: `Which expression should the on-screen companion show as a reaction to paragraph ${index}?`, criteria: Object.fromEntries(poses.map((pose) => [pose.id, pose.suffix])) };
    if (music.length) questions[`bgm_${index}`] = { type: "choice", instructions: `Should background music change at paragraph ${index}?`, criteria: { keep_current: "No music change", ...Object.fromEntries(music.map((entry) => [entry.id, `${entry.name}; ${entry.tags.join(", ")}`])) } };
    if (sounds.length) questions[`sfx_${index}`] = { type: "choice", instructions: `Is a sound effect clearly called for at paragraph ${index}?`, criteria: { none: "No sound effect", ...Object.fromEntries(sounds.map((entry) => [entry.id, `${entry.name}; ${entry.tags.join(", ")}`])) } };
  }
  const encoder = new TextEncoder();
  const send = async (payload: DecisionRequest) => {
    if (encoder.encode(JSON.stringify(payload)).length > REQUEST_BYTE_LIMIT) throw new Error("System One request exceeds the API's 64 KiB limit");
    const parsed = Response.safeParse(await sendDecision(spindle, payload, input.userId ? { userId: input.userId } : {}));
    if (!parsed.success) throw new Error("System One answered in a form Cue does not understand. Check the model of Lumiverse's default Decision connection.");
    return parsed.data;
  };
  const started = Date.now();
  const paragraphs = input.paragraphs.slice(0, SYSTEM_ONE_MAX_PARAGRAPHS);
  const batches = Array.from({ length: Math.ceil(paragraphs.length / 7) }, (_, i) => paragraphs.slice(i * 7, (i + 1) * 7));
  const batchRequests = batches.map((batch, batchIndex) => {
    const batchQuestions: Record<string, unknown> = batchIndex === 0 && questions.needs_description ? { needs_description: questions.needs_description } : {};
    for (const paragraph of batch) {
      for (const prefix of ["speaker", "expression", "bgm", "sfx"]) {
        const name = `${prefix}_${paragraph.index}`;
        if (questions[name]) batchQuestions[name] = questions[name];
      }
    }
    return send({
      state: {
        previousScene: input.previousScene ? { environment: input.previousScene.environment, character: input.previousScene.character, attire: input.previousScene.attire } : null,
        paragraphs: batch.map((paragraph) => ({ index: paragraph.index, text: paragraph.text.slice(0, 3000) })),
      },
      questions: batchQuestions,
    });
  });

  // Outfit: the whole cleaned reply in one request (the fewest chunks under 64 KiB), 2 questions per character.
  const wardrobe = (input.wardrobe ?? []).filter((entry) => entry.name.trim() && entry.attire.trim()).slice(0, MAX_WARDROBE_QUESTIONS);
  const wardrobeAsked: Record<string, unknown> = {};
  wardrobe.forEach((entry, index) => {
    const asked = wardrobeQuestions(entry);
    wardrobeAsked[`outfit_choice_${index}`] = asked.choice;
    wardrobeAsked[`outfit_change_${index}`] = asked.noul;
  });
  const cleaned = input.paragraphs
    .map((paragraph) => ({ index: paragraph.index, text: cleanReplyText(paragraph.text).slice(0, PARAGRAPH_TEXT_LIMIT) }))
    .filter((paragraph) => paragraph.text);
  const wardrobeChunks: Array<typeof cleaned> = [];
  if (wardrobe.length) {
    const fits = (chunk: typeof cleaned) => encoder.encode(JSON.stringify({ state: { paragraphs: chunk }, questions: wardrobeAsked })).length <= REQUEST_BYTE_LIMIT;
    let current: typeof cleaned = [];
    for (const paragraph of cleaned) {
      if (current.length && !fits([...current, paragraph])) {
        wardrobeChunks.push(current);
        current = [];
      }
      current.push(paragraph);
    }
    if (current.length) wardrobeChunks.push(current);
  }
  const wardrobeRequests = wardrobeChunks.map((chunk) => send({ state: { paragraphs: chunk }, questions: wardrobeAsked }));

  // Scene: the start of the reply only; the planner's scene is never sent.
  const sceneChunks = input.previousScene ? sceneStartChunks(input.paragraphs) : [];
  const sceneRequest = input.previousScene && sceneChunks.length
    ? send({
        state: {
          previousScene: { location: input.previousScene.environment.location, timeOfDay: input.previousScene.environment.timeOfDay, weather: input.previousScene.environment.weather },
          paragraphs: sceneChunks.map((text, index) => ({ index, text })),
        },
        questions: { scene_start: SCENE_QUESTION },
      })
    : Promise.resolve(null);

  const [parsedBatches, parsedWardrobe, parsedScene] = await Promise.all([
    Promise.all(batchRequests), Promise.all(wardrobeRequests), sceneRequest,
  ]);
  const answers = Object.assign({}, ...parsedBatches.map((batch) => batch.answers)) as Record<string, AnswerValue>;
  const speakers = new Map<number, string>();
  const expressions = new Map<number, string>();
  const bgm = new Map<number, string>();
  const sfx = new Map<number, string>();
  for (const paragraph of input.paragraphs.slice(0, SYSTEM_ONE_MAX_PARAGRAPHS)) {
    const speaker = chosen(answers[`speaker_${paragraph.index}`], new Set(names), 0.65);
    if (speaker) speakers.set(paragraph.index, speaker);
    const expression = chosen(answers[`expression_${paragraph.index}`], new Set(poseIds), 0.6);
    if (expression) expressions.set(paragraph.index, expression);
    const track = chosen(answers[`bgm_${paragraph.index}`], new Set(["keep_current", ...music.map((entry) => entry.id)]), 0.7);
    if (track && track !== "keep_current") bgm.set(paragraph.index, track);
    const effect = chosen(answers[`sfx_${paragraph.index}`], new Set(["none", ...sounds.map((entry) => entry.id)]), 0.7);
    if (effect && effect !== "none") sfx.set(paragraph.index, effect);
  }
  const description = answers.needs_description;
  const wardrobeAnswers: WardrobeAnswers[] = wardrobe.map((entry, index) => ({
    ...entry,
    chunks: parsedWardrobe.map((chunk) => {
      const choice = chunk.answers[`outfit_choice_${index}`];
      const change = chunk.answers[`outfit_change_${index}`];
      return {
        changedOutfit: choice?.type === "choice" ? choice.probabilities.changed_outfit ?? (choice.choice === "changed_outfit" ? choice.confidence : 1 - choice.confidence) : null,
        noul: change?.type === "noul" ? change.noul : null,
      };
    }),
  }));
  const sceneAnswer = parsedScene?.answers.scene_start;
  const scene: JevSceneAnswer | null = sceneAnswer?.type === "choice" ? { choice: sceneAnswer.choice, probabilities: sceneAnswer.probabilities } : null;
  const usage = [...parsedBatches, ...parsedWardrobe, ...(parsedScene ? [parsedScene] : [])];
  return {
    speakers, expressions, bgm, sfx,
    // The continuation rule: no confident "same place" answer = a scene change.
    sceneChange: scene ? sceneScore(scene) > SCENE_CHANGED_ABOVE : true,
    needsDescription: description?.type !== "noul" || description.noul > 0.2,
    wardrobe: wardrobeAnswers,
    scene,
    coveredThrough: input.paragraphs.at(-1)?.index ?? -1,
    durationMs: Date.now() - started,
    inputTokens: usage.reduce((total, batch) => total + (batch.usage?.input_tokens ?? 0), 0),
  };
}
