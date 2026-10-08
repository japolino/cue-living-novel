import type { SpindleAPI } from "lumiverse-spindle-types";
import { z } from "zod";
import type { VisualNovelConfig } from "../../config.js";
import type { SceneState } from "../../shared/contracts.js";
import { POSE_EXPRESSION_CATALOGUE } from "../../shared/character.js";
import { getAudioCatalog } from "./audio-catalog.js";
import { SCENE_CHANGED_ABOVE, sceneScore, type JevSceneAnswer, type JevWardrobeAnswers } from "../core/change-decisions.js";

export const SYSTEM_ONE_KEY = "system_one_api_key";

export function systemOneEndpoint(apiUrl: string): string {
  const base = new URL(apiUrl.trim());
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) {
    throw new Error("System One URL must use HTTPS or local HTTP");
  }
  if (base.username || base.password) throw new Error("System One URL cannot contain credentials");
  const path = base.pathname.replace(/\/+$/, "");
  base.pathname = path.endsWith("/v1/systemone") ? path : `${path.endsWith("/v1") ? path : `${path}/v1`}/systemone`;
  base.search = "";
  base.hash = "";
  return base.toString();
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
const REQUEST_BYTE_LIMIT = 65_536;
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
  const key = await spindle.enclave.get(SYSTEM_ONE_KEY, input.userId);
  if (!key) return null;
  const model = input.config.systemOneModel.trim();
  if (!model) throw new Error("System One model is missing");
  const endpoint = systemOneEndpoint(input.config.systemOneApiUrl);

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
  const send = async (payload: unknown) => {
    const body = JSON.stringify(payload);
    if (encoder.encode(body).length > REQUEST_BYTE_LIMIT) throw new Error("System One request exceeds the API's 64 KiB limit");
    const response = await spindle.cors(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
    }) as { status: number; body: string };
    if (response.status < 200 || response.status >= 300) throw new Error(`System One request failed (${response.status})`);
    return Response.parse(JSON.parse(response.body));
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
      model,
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
    const fits = (chunk: typeof cleaned) => encoder.encode(JSON.stringify({ model, state: { paragraphs: chunk }, questions: wardrobeAsked })).length <= REQUEST_BYTE_LIMIT;
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
  const wardrobeRequests = wardrobeChunks.map((chunk) => send({ model, state: { paragraphs: chunk }, questions: wardrobeAsked }));

  // Scene: the start of the reply only; the planner's scene is never sent.
  const sceneChunks = input.previousScene ? sceneStartChunks(input.paragraphs) : [];
  const sceneRequest = input.previousScene && sceneChunks.length
    ? send({
        model,
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
