/**
 * Evaluate cached live Jev answers against the labels and calibrate the
 * sprite-classifier thresholds. Reads .cache/jev-eval/answers (run.ts first).
 * Not part of `bun run test`; needs no key (cached answers only).
 *
 *   bun run scripts/jev-eval/evaluate.ts [--label=name]
 *
 * Utility (per decision, per item): the final value is the classifier's
 * answer when it passes its gate, else the deterministic value.
 *   +1 final value is the best label (+0.5 another acceptable value)
 *   -1 final value is wrong but equals the deterministic value (no change made)
 *   -2 final value is wrong and the classifier changed it (visible: flicker,
 *      wrong sprite / expression / emote / background)
 *   -3 a wrong rare expression (visible and it costs a sprite generation)
 * Thresholds are chosen on a 0.05 grid to maximise total utility (1-D
 * decisions: 3-point smoothed); ties keep the value closest to the old one.
 * `--pool` adds the repeat pass as a second sample.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stageParagraphs } from "../../src/backend/runtime/sprite-staging.js";
import {
  applySpriteAnswers,
  KEY_MOMENT_LEVELS,
  SPRITE_THRESHOLDS,
  type SpriteStagingOverrides,
  type SpriteThresholds,
} from "../../src/backend/runtime/system-one-sprites.js";
import { KEY_MOMENT_THRESHOLDS, keyMomentInteraction, keyMomentStrength } from "../../src/backend/runtime/sprites/key-moments.js";
import { SPRITE_EXPRESSION_FALLBACK, SPRITE_HOT_SET } from "../../src/shared/sprites.js";
import { buildCase, PLATE_ID_BY_KEY, type EvalCase } from "./build.js";
import { ANSWERS_DIR, REPEAT_DIR, RESULTS_DIR, bodyHash, ensureDir, readCached, type CachedAnswer } from "./common.js";
import { REPLIES } from "./dataset/index.js";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [name, value] = arg.replace(/^--/, "").split("=");
  return [name!, value ?? "true"] as const;
}));
const label = args.get("label") ?? "current";

/** The thresholds before calibration (v1, never calibrated). */
export const OLD_THRESHOLDS: SpriteThresholds = {
  presentYes: 0.75, presentNo: 0.2, keep: 0.4, hotExpression: 0.5, rareExpression: 0.65,
  motion: 0.6, emote: 0.6, intensity: 0.5, light: 0.6, place: 0.7,
};
export const OLD_KEY_THRESHOLDS = {
  momentConfidence: 0.5, majorLevel: 3, majorStandingMax: 0.4, climaxLevel: 4, climaxStandingMax: 0.6, interactionConfidence: 0.6,
};
type KeyThresholds = typeof OLD_KEY_THRESHOLDS;

const HOT: ReadonlySet<string> = new Set(SPRITE_HOT_SET);
const family = (id: string) => SPRITE_EXPRESSION_FALLBACK[id] ?? "idle";

type Choice = { type: "choice"; choice: string; confidence: number; probabilities?: Record<string, number> };
type Score = { type: "score"; score: number; confidence: number; probabilities?: Record<string, number> };
type Noul = { type: "noul"; noul: number };

/* ------------------------------------------------------------------------ */
/* Load                                                                      */
/* ------------------------------------------------------------------------ */

type Loaded = { kase: EvalCase; run: number; batches: Array<{ meta: EvalCase["batches"][number]["meta"]; answers: Record<string, unknown>; cached: CachedAnswer }> };
/**
 * Runs: the first pass (answers/) and, with --pool, the repeat pass
 * (answers-repeat/) as a second sample of the same bodies.
 */
const runDirs = args.has("pool") ? [ANSWERS_DIR, REPEAT_DIR] : [ANSWERS_DIR];
const loaded: Loaded[] = [];
let missing = 0;
const cases = REPLIES.map((reply) => buildCase(reply));
for (const [run, dir] of runDirs.entries()) {
  for (const kase of cases) {
    const batches: Loaded["batches"] = [];
    for (const batch of kase.batches) {
      const cached = readCached(dir, bodyHash(batch.body));
      if (!cached?.response) {
        missing += 1;
        continue;
      }
      batches.push({ meta: batch.meta, answers: cached.response.answers, cached });
    }
    loaded.push({ kase, run, batches });
  }
}
const totalBatches = loaded.reduce((n, item) => n + item.kase.batches.length, 0);
if (missing === totalBatches) {
  console.log("skip: no cached answers (run scripts/jev-eval/run.ts first)");
  process.exit(0);
}

/* ------------------------------------------------------------------------ */
/* Records                                                                   */
/* ------------------------------------------------------------------------ */

type PresenceRec = { id: string; noul: number; truth: boolean; det: boolean };
type ExpressionRec = { id: string; answer: string; conf: number; probs: Record<string, number>; ok: Set<string>; best: string; det: string; prev: string; changed: boolean };
type PickRec = { id: string; answer: string; conf: number; ok: Set<string>; best: string; det: string; first: string };
type IntensityRec = { id: string; level: number; argmax: number; conf: number; ok: Set<number>; best: number; det: number; visible: boolean };
type PlaceRec = { id: string; answer: string; plate: string | null; conf: number; truth: string | null };
type MomentRec = { reply: string; p: number; level: number | null; argmax: number | null; conf: number; standing: number | null; truthLevel: number; levelOk: Set<number>; standingTruth: boolean; qualifies: boolean; cue: boolean; detStrength: number };
type InteractionRec = { id: string; answer: string; conf: number; ok: Set<string>; best: string; det: string; relevant: boolean };

const presence: PresenceRec[] = [];
const expression: ExpressionRec[] = [];
const motion: PickRec[] = [];
const emote: PickRec[] = [];
const intensity: IntensityRec[] = [];
const light: PickRec[] = [];
const place: PlaceRec[] = [];
const moments = new Map<string, MomentRec>();
const interaction: InteractionRec[] = [];

const argmaxLevel = (probs: Record<string, number> | undefined, fallback: number) => {
  if (!probs) return fallback;
  let best = fallback;
  let top = -1;
  for (const [level, p] of Object.entries(probs)) if (p > top) { top = p; best = Number(level); }
  return best;
};

for (const { kase, batches, run } of loaded) {
  const { reply, context, deterministic, labels, names } = kase;
  const cueAt = new Set(reply.paragraphs.flatMap((paragraph, index) => (paragraph.cue ? [index] : [])));
  const sceneStarts = new Set(context.scenes.map((scene) => scene.startParagraph));
  for (const { meta, answers } of batches) {
    for (const [question, info] of meta) {
      const answer = answers[question] as Choice | Score | Noul | undefined;
      if (!answer) continue;
      if (info.kind === "light") {
        if (answer.type !== "choice") continue;
        const scene = reply.scenes[info.scene]!;
        const det = context.scenes[info.scene]!.light;
        light.push({ id: `${reply.id}/s${info.scene}`, answer: answer.choice, conf: answer.confidence, ok: new Set([scene.light, ...(scene.lightOk ?? [])]), best: scene.light, det, first: det });
        continue;
      }
      if (info.kind === "place") {
        if (answer.type !== "choice") continue;
        const plate = answer.choice === "new_place" ? null : PLATE_ID_BY_KEY.get(info.options.get(answer.choice)?.plateKey ?? "") ?? null;
        place.push({ id: `${reply.id}/s${info.scene}`, answer: answer.choice, plate, conf: answer.confidence, truth: reply.scenes[info.scene]!.plate });
        continue;
      }
      const truth = labels[info.paragraph]!;
      if (info.kind === "moment" || info.kind === "standing") {
        const key = `${run}/${reply.id}/p${info.paragraph}`;
        const rec = moments.get(key) ?? {
          reply: `${run}/${reply.id}`, p: info.paragraph, level: null, argmax: null, conf: 0, standing: null,
          truthLevel: truth.km.level, levelOk: truth.levelSet, standingTruth: truth.km.standing, qualifies: truth.qualifies,
          cue: cueAt.has(info.paragraph),
          detStrength: keyMomentStrength(reply.paragraphs[info.paragraph]!.text, null, {
            sceneOpenerWithoutCast: sceneStarts.has(info.paragraph) && (deterministic.paragraphs[info.paragraph]?.actors.length ?? 0) === 0,
          }),
        };
        if (info.kind === "moment" && answer.type === "score") {
          rec.level = Math.max(0, Math.min(KEY_MOMENT_LEVELS.length - 1, Math.round(answer.score)));
          rec.argmax = argmaxLevel(answer.probabilities, rec.level);
          rec.conf = answer.confidence;
        }
        if (info.kind === "standing" && answer.type === "noul") rec.standing = answer.noul;
        moments.set(key, rec);
        continue;
      }
      if (info.kind === "interaction") {
        if (answer.type !== "choice") continue;
        const text = reply.paragraphs[info.paragraph]!.text;
        interaction.push({
          id: `${reply.id}/p${info.paragraph}`, answer: answer.choice, conf: answer.confidence, ok: truth.interactionSet, best: truth.km.interaction,
          det: keyMomentInteraction(text), relevant: truth.km.level >= 2 || truth.km.interaction !== "none" || !truth.km.standing,
        });
        continue;
      }
      if (!("key" in info)) continue;
      const name = names.get(info.key) ?? info.key;
      const id = `${reply.id}/p${info.paragraph}/${name}`;
      const staged = deterministic.paragraphs[info.paragraph]?.actors.find((actor) => actor.characterKey === info.key);
      const signal = context.signals[info.paragraph]!;
      if (info.kind === "present") {
        if (answer.type === "noul") presence.push({ id, noul: answer.noul, truth: truth.present.has(name), det: Boolean(staged) });
        continue;
      }
      const char = truth.chars.get(name);
      if (!char) continue; // not present: appearance questions do not matter
      if (info.kind === "expression" && answer.type === "choice") {
        const det = staged?.expression ?? signal.expressions.get(info.key)?.id ?? "idle";
        const prev = truth.previous.get(name) ?? "idle";
        expression.push({ id, answer: answer.choice, conf: answer.confidence, probs: answer.probabilities ?? {}, ok: char.eSet, best: char.e, det, prev, changed: !char.eSet.has(prev) });
      } else if (info.kind === "motion" && answer.type === "choice") {
        motion.push({ id, answer: answer.choice, conf: answer.confidence, ok: char.mSet, best: char.m, det: staged?.motion ?? signal.motions.get(info.key) ?? "none", first: "none" });
      } else if (info.kind === "emote" && answer.type === "choice") {
        emote.push({ id, answer: answer.choice, conf: answer.confidence, ok: char.emSet, best: char.em, det: staged?.emote ?? signal.emotes.get(info.key) ?? "none", first: "none" });
      } else if (info.kind === "intensity" && answer.type === "score") {
        const level = Math.max(1, Math.min(5, Math.round(answer.score) + 1));
        intensity.push({ id, level, argmax: argmaxLevel(answer.probabilities, level - 1) + 1, conf: answer.confidence, ok: char.iSet, best: char.i, det: staged?.intensity ?? signal.intensities.get(info.key) ?? 3, visible: char.m !== "none" || char.em !== "none" });
      }
    }
  }
}
const momentList = [...moments.values()];

/* ------------------------------------------------------------------------ */
/* Decision rules (mirror applySpriteAnswers) and utility                   */
/* ------------------------------------------------------------------------ */

type Outcome = { value: string; acted: boolean; correct: boolean; utility: number };

function score(correct: boolean, changed: boolean, rare = false, best = true): number {
  if (correct) return best ? 1 : 0.5;
  if (!changed) return -1;
  return rare ? -3 : -2;
}

function presenceOutcome(rec: PresenceRec, yes: number, no: number): Outcome {
  const value = rec.noul >= yes ? true : rec.noul <= no ? false : rec.det;
  const acted = value !== rec.det;
  const correct = value === rec.truth;
  return { value: String(value), acted, correct, utility: score(correct, acted) };
}

export type ExpressionRule = { keep: number; hot: number; rare: number; grouped?: boolean };
function expressionOutcome(rec: ExpressionRec, rule: ExpressionRule): Outcome {
  let value = rec.det;
  let rare = false;
  let answer = rec.answer;
  let conf = rec.conf;
  if (rule.grouped) {
    // Group the expression probabilities by hot-set family: a confident family
    // with no confident member shows the family's hot sprite.
    const groups = new Map<string, number>();
    for (const [id, p] of Object.entries(rec.probs)) if (id !== "keep_current") groups.set(family(id), (groups.get(family(id)) ?? 0) + p);
    const keep = rec.probs.keep_current ?? 0;
    const [topFamily, topP] = [...groups].sort((a, b) => b[1] - a[1])[0] ?? ["idle", 0];
    if (answer !== "keep_current" && !(conf >= rule.hot) && keep < topP && topP >= rule.hot) {
      answer = topFamily;
      conf = topP;
    }
  }
  if (answer === "keep_current") {
    if (conf >= rule.keep) value = rec.prev;
  } else if (conf >= rule.hot) {
    if (HOT.has(answer)) value = answer;
    else if (conf >= rule.rare) {
      value = answer;
      rare = true;
    } else value = family(answer);
  }
  const acted = value !== rec.det;
  const correct = rec.ok.has(value);
  return { value, acted, correct, utility: score(correct, acted, rare && acted, value === rec.best) };
}

function pickOutcome(rec: PickRec, threshold: number, defaultValue: string | null): Outcome {
  const use = rec.answer !== defaultValue && rec.conf >= threshold;
  const value = use ? rec.answer : rec.det;
  const acted = value !== rec.det;
  const correct = rec.ok.has(value);
  return { value, acted, correct, utility: score(correct, acted, false, value === rec.best) };
}

function intensityOutcome(rec: IntensityRec, threshold: number, useArgmax: boolean): Outcome {
  const level = useArgmax ? rec.argmax : rec.level;
  const value = rec.conf >= threshold ? level : rec.det;
  const acted = value !== rec.det;
  const correct = rec.ok.has(value);
  return { value: String(value), acted, correct, utility: score(correct, acted, false, value === rec.best) };
}

function placeOutcome(rec: PlaceRec, threshold: number): Outcome {
  const value = rec.plate !== null && rec.conf >= threshold ? rec.plate : null;
  const acted = value !== null;
  const correct = value === rec.truth;
  return { value: String(value), acted, correct, utility: score(correct, acted) };
}

function interactionOutcome(rec: InteractionRec, threshold: number): Outcome {
  const use = rec.answer !== "none" && rec.conf >= threshold;
  const value = use ? rec.answer : rec.det;
  const acted = value !== rec.det;
  const correct = rec.ok.has(value);
  return { value, acted, correct, utility: score(correct, acted, false, value === rec.best) };
}

/** Per-reply key-moment pick (cap 1), as selectClassifiedKeyMoments does. */
function momentPicks(t: KeyThresholds, options: { eligibleCueOnly: boolean; useArgmax?: boolean }): Map<string, MomentRec | null> {
  const picks = new Map<string, MomentRec | null>();
  for (const run of runDirs.keys()) for (const reply of REPLIES) picks.set(`${run}/${reply.id}`, null);
  const byReply = new Map<string, MomentRec[]>();
  for (const rec of momentList) {
    if (options.eligibleCueOnly && !rec.cue) continue;
    const level = options.useArgmax ? rec.argmax : rec.level;
    if (level === null || rec.conf < t.momentConfidence) continue;
    const standing = rec.standing ?? 0.5;
    const qualifies = (level >= t.climaxLevel && standing <= t.climaxStandingMax) || (level >= t.majorLevel && standing <= t.majorStandingMax);
    if (!qualifies) continue;
    const list = byReply.get(rec.reply) ?? [];
    list.push(rec);
    byReply.set(rec.reply, list);
  }
  for (const [reply, list] of byReply) {
    list.sort((a, b) => ((options.useArgmax ? b.argmax : b.level) ?? 0) - ((options.useArgmax ? a.argmax : a.level) ?? 0) || (a.standing ?? 0.5) - (b.standing ?? 0.5) || a.p - b.p);
    picks.set(reply, list[0] ?? null);
  }
  return picks;
}

function deterministicMomentPicks(options: { eligibleCueOnly: boolean }): Map<string, MomentRec | null> {
  const picks = new Map<string, MomentRec | null>();
  for (const run of runDirs.keys()) for (const reply of REPLIES) {
    const id = `${run}/${reply.id}`;
    const list = momentList.filter((rec) => rec.reply === id && rec.detStrength > 0 && (!options.eligibleCueOnly || rec.cue));
    list.sort((a, b) => b.detStrength - a.detStrength || a.p - b.p);
    picks.set(id, list[0] ?? null);
  }
  return picks;
}

function momentPickSummary(picks: Map<string, MomentRec | null>): { utility: number; correct: number; wrong: number; missed: number; replies: number; precision: number } {
  let utility = 0;
  let correct = 0;
  let wrong = 0;
  let missed = 0;
  for (const [reply, pick] of picks) {
    const anyQualifies = momentList.some((rec) => rec.reply === reply && rec.qualifies);
    if (pick && pick.qualifies) { utility += 1; correct += 1; }
    else if (pick) { utility -= 2; wrong += 1; }
    else if (anyQualifies) { utility -= 1; missed += 1; }
    else { utility += 1; correct += 1; }
  }
  const picked = [...picks.values()].filter(Boolean).length;
  return { utility, correct, wrong, missed, replies: picks.size, precision: picked ? [...picks.values()].filter((pick) => pick?.qualifies).length / picked : 0 };
}

/* ------------------------------------------------------------------------ */
/* Summaries                                                                 */
/* ------------------------------------------------------------------------ */

type Summary = { n: number; utility: number; accuracy: number; acted: number; coverage: number; precision: number; detAccuracy: number; detUtility: number };
function summarize<R>(records: R[], outcome: (rec: R) => Outcome, baseline: (rec: R) => Outcome): Summary {
  let utility = 0;
  let correct = 0;
  let acted = 0;
  let actedCorrect = 0;
  let detCorrect = 0;
  let detUtility = 0;
  for (const rec of records) {
    const o = outcome(rec);
    const b = baseline(rec);
    utility += o.utility;
    if (o.correct) correct += 1;
    if (o.acted) { acted += 1; if (o.correct) actedCorrect += 1; }
    if (b.correct) detCorrect += 1;
    detUtility += b.utility;
  }
  const n = records.length || 1;
  return { n: records.length, utility, accuracy: correct / n, acted, coverage: acted / n, precision: acted ? actedCorrect / acted : 0, detAccuracy: detCorrect / n, detUtility };
}

const grid = (from: number, to: number, step = 0.05) => {
  const out: number[] = [];
  for (let value = from; value <= to + 1e-9; value += step) out.push(Math.round(value * 100) / 100);
  return out;
};

/**
 * Best value on the grid by utility smoothed over the neighbouring grid
 * values (3-point mean, so one lucky item does not set a threshold). Ties keep
 * the value closest to the old threshold (no change without evidence), then
 * the conservative end.
 */
function best1D(values: number[], utility: (value: number) => number, old: number, higherIsSafer = true): { value: number; utility: number; sweep: string } {
  const raw = values.map((value) => ({ value, utility: utility(value) }));
  const scored = raw.map((item, index) => {
    const window = raw.slice(Math.max(0, index - 1), index + 2);
    return { value: item.value, utility: item.utility, smooth: window.reduce((sum, entry) => sum + entry.utility, 0) / window.length };
  });
  const top = Math.max(...scored.map((item) => item.smooth));
  const tied = scored.filter((item) => item.smooth >= top - 1e-9)
    .sort((a, b) => Math.abs(a.value - old) - Math.abs(b.value - old) || (higherIsSafer ? b.value - a.value : a.value - b.value));
  return { value: tied[0]!.value, utility: tied[0]!.utility, sweep: raw.map((item) => `${item.value.toFixed(2)}:${item.utility}`).join(" ") };
}

/** Multi-dimensional version of best1D (L1 distance to the old thresholds). */
function bestND<T extends Record<string, number>>(candidates: T[], utility: (candidate: T) => number, old: T): T & { utility: number } {
  let top = Number.NEGATIVE_INFINITY;
  let chosen: T = candidates[0]!;
  let chosenDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const u = utility(candidate);
    const distance = Object.keys(old).reduce((sum, key) => sum + Math.abs((candidate[key] ?? 0) - (old[key] ?? 0)), 0);
    if (u > top + 1e-9 || (Math.abs(u - top) <= 1e-9 && distance < chosenDistance - 1e-9)) {
      top = u;
      chosen = candidate;
      chosenDistance = distance;
    }
  }
  return { ...chosen, utility: top };
}

const never = 2; // a threshold above any confidence: the deterministic baseline
const sumU = <R,>(records: R[], outcome: (rec: R) => Outcome) => records.reduce((total, rec) => total + outcome(rec).utility, 0);

// Presence: 2-D search (yes, no).
const presenceBest = bestND(
  grid(0.5, 1.0).flatMap((yes) => grid(0.0, 0.5).map((no) => ({ yes, no }))),
  ({ yes, no }) => sumU(presence, (rec) => presenceOutcome(rec, yes, no)),
  { yes: OLD_THRESHOLDS.presentYes, no: OLD_THRESHOLDS.presentNo },
);

// Expression: 3-D search (keep, hot, rare >= hot), plus the grouped-family variant.
function searchExpression(grouped: boolean) {
  const candidates: Array<{ keep: number; hot: number; rare: number }> = [];
  for (const rare of grid(0.0, 1.05)) for (const hot of grid(0.0, 1.05)) {
    if (rare < hot) continue;
    for (const keep of grid(0.0, 1.05)) candidates.push({ keep, hot, rare });
  }
  return bestND(candidates, (rule) => sumU(expression, (rec) => expressionOutcome(rec, { ...rule, grouped })),
    { keep: OLD_THRESHOLDS.keep, hot: OLD_THRESHOLDS.hotExpression, rare: OLD_THRESHOLDS.rareExpression });
}
const expressionBest = searchExpression(false);
const expressionGroupedBest = searchExpression(true);
const expressionSweeps = {
  keep: grid(0.0, 1.05).map((keep) => `${keep.toFixed(2)}:${sumU(expression, (rec) => expressionOutcome(rec, { keep, hot: expressionBest.hot, rare: expressionBest.rare }))}`).join(" "),
  hot: grid(0.0, 1.05).map((hot) => `${hot.toFixed(2)}:${sumU(expression, (rec) => expressionOutcome(rec, { keep: expressionBest.keep, hot, rare: Math.max(hot, expressionBest.rare) }))}`).join(" "),
  rare: grid(0.0, 1.05).map((rare) => `${rare.toFixed(2)}:${sumU(expression, (rec) => expressionOutcome(rec, { keep: expressionBest.keep, hot: Math.min(rare, expressionBest.hot), rare }))}`).join(" "),
};

/** Intensity only shows through a motion or an emote: calibrate on those. */
const visibleIntensity = intensity.filter((rec) => rec.visible);
const motionBest = best1D(grid(0.0, 1.05), (t) => sumU(motion, (rec) => pickOutcome(rec, t, "none")), OLD_THRESHOLDS.motion);
const emoteBest = best1D(grid(0.0, 1.05), (t) => sumU(emote, (rec) => pickOutcome(rec, t, "none")), OLD_THRESHOLDS.emote);
const intensityBest = best1D(grid(0.0, 1.05), (t) => sumU(visibleIntensity, (rec) => intensityOutcome(rec, t, false)), OLD_THRESHOLDS.intensity);
const intensityArgmaxBest = best1D(grid(0.0, 1.05), (t) => sumU(visibleIntensity, (rec) => intensityOutcome(rec, t, true)), OLD_THRESHOLDS.intensity);
const lightBest = best1D(grid(0.0, 1.05), (t) => sumU(light, (rec) => pickOutcome(rec, t, null)), OLD_THRESHOLDS.light);
const placeBest = best1D(grid(0.0, 1.05), (t) => sumU(place, (rec) => placeOutcome(rec, t)), OLD_THRESHOLDS.place);
const relevantInteractions = interaction.filter((rec) => rec.relevant);
const interactionBest = best1D(grid(0.0, 1.05), (t) => sumU(relevantInteractions, (rec) => interactionOutcome(rec, t)), OLD_KEY_THRESHOLDS.interactionConfidence);

// Key moments: 3-D search on the per-reply pick (all paragraphs eligible).
const keyCandidates: Array<{ momentConfidence: number; majorStandingMax: number; climaxStandingMax: number }> = [];
for (const momentConfidence of grid(0.0, 0.9)) for (const majorStandingMax of grid(0.0, 1.0)) for (const climaxStandingMax of grid(0.0, 1.0)) {
  if (climaxStandingMax >= majorStandingMax) keyCandidates.push({ momentConfidence, majorStandingMax, climaxStandingMax });
}
const keyBest = bestND(keyCandidates,
  (candidate) => momentPickSummary(momentPicks({ ...OLD_KEY_THRESHOLDS, ...candidate }, { eligibleCueOnly: false })).utility,
  { momentConfidence: OLD_KEY_THRESHOLDS.momentConfidence, majorStandingMax: OLD_KEY_THRESHOLDS.majorStandingMax, climaxStandingMax: OLD_KEY_THRESHOLDS.climaxStandingMax });

const NEW_THRESHOLDS: SpriteThresholds = {
  presentYes: presenceBest.yes,
  presentNo: presenceBest.no,
  keep: expressionBest.keep,
  hotExpression: expressionBest.hot,
  rareExpression: expressionBest.rare,
  motion: motionBest.value,
  emote: emoteBest.value,
  intensity: intensityBest.value,
  light: lightBest.value,
  place: placeBest.value,
};
const NEW_KEY_THRESHOLDS: KeyThresholds = {
  momentConfidence: keyBest.momentConfidence, majorLevel: 3, majorStandingMax: keyBest.majorStandingMax,
  climaxLevel: 4, climaxStandingMax: keyBest.climaxStandingMax, interactionConfidence: interactionBest.value,
};
const CURRENT_THRESHOLDS: SpriteThresholds = { ...SPRITE_THRESHOLDS };
const CURRENT_KEY_THRESHOLDS: KeyThresholds = { ...KEY_MOMENT_THRESHOLDS };

function decisionTable(t: SpriteThresholds, kt: KeyThresholds) {
  return {
    presence: summarize(presence, (rec) => presenceOutcome(rec, t.presentYes, t.presentNo), (rec) => presenceOutcome(rec, never, -1)),
    expression: summarize(expression, (rec) => expressionOutcome(rec, { keep: t.keep, hot: t.hotExpression, rare: t.rareExpression }), (rec) => expressionOutcome(rec, { keep: never, hot: never, rare: never })),
    motion: summarize(motion, (rec) => pickOutcome(rec, t.motion, "none"), (rec) => pickOutcome(rec, never, "none")),
    emote: summarize(emote, (rec) => pickOutcome(rec, t.emote, "none"), (rec) => pickOutcome(rec, never, "none")),
    intensity: summarize(visibleIntensity, (rec) => intensityOutcome(rec, t.intensity, false), (rec) => intensityOutcome(rec, never, false)),
    intensityAll: summarize(intensity, (rec) => intensityOutcome(rec, t.intensity, false), (rec) => intensityOutcome(rec, never, false)),
    light: summarize(light, (rec) => pickOutcome(rec, t.light, null), (rec) => pickOutcome(rec, never, null)),
    place: summarize(place, (rec) => placeOutcome(rec, t.place), (rec) => placeOutcome(rec, never)),
    interaction: summarize(relevantInteractions, (rec) => interactionOutcome(rec, kt.interactionConfidence), (rec) => interactionOutcome(rec, never)),
  };
}

/* Sub-decisions with their own precision/coverage. */
function subDecisions(t: SpriteThresholds) {
  const presenceAdd = presence.filter((rec) => !rec.det);
  const presenceRemove = presence.filter((rec) => rec.det);
  const keepRecs = expression.filter((rec) => rec.answer === "keep_current");
  const hotRecs = expression.filter((rec) => rec.answer !== "keep_current" && HOT.has(rec.answer));
  const rareRecs = expression.filter((rec) => rec.answer !== "keep_current" && !HOT.has(rec.answer));
  const pc = (records: number, acted: number, correct: number) => ({ n: records, acted, coverage: records ? acted / records : 0, precision: acted ? correct / acted : 0 });
  const addActed = presenceAdd.filter((rec) => rec.noul >= t.presentYes);
  const removeActed = presenceRemove.filter((rec) => rec.noul <= t.presentNo);
  const keepActed = keepRecs.filter((rec) => rec.conf >= t.keep);
  const hotActed = hotRecs.filter((rec) => rec.conf >= t.hotExpression);
  const rareActed = rareRecs.filter((rec) => rec.conf >= t.rareExpression);
  const rareFallback = rareRecs.filter((rec) => rec.conf >= t.hotExpression && rec.conf < t.rareExpression);
  return {
    presenceAdd: pc(presenceAdd.length, addActed.length, addActed.filter((rec) => rec.truth).length),
    presenceRemove: pc(presenceRemove.length, removeActed.length, removeActed.filter((rec) => !rec.truth).length),
    keepCurrent: pc(keepRecs.length, keepActed.length, keepActed.filter((rec) => rec.ok.has(rec.prev)).length),
    hotExpression: pc(hotRecs.length, hotActed.length, hotActed.filter((rec) => rec.ok.has(rec.answer)).length),
    rareExpression: pc(rareRecs.length, rareActed.length, rareActed.filter((rec) => rec.ok.has(rec.answer)).length),
    rareAsHotFallback: pc(rareRecs.length, rareFallback.length, rareFallback.filter((rec) => rec.ok.has(family(rec.answer))).length),
  };
}

/* Calibration curves: raw answer accuracy by confidence bucket. */
const BUCKETS = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
function curve<R>(records: R[], conf: (rec: R) => number, correct: (rec: R) => boolean) {
  return BUCKETS.slice(0, -1).map((low, index) => {
    const high = BUCKETS[index + 1]!;
    const inBucket = records.filter((rec) => conf(rec) >= low && conf(rec) < high);
    return { bucket: `${low.toFixed(1)}-${Math.min(1, high).toFixed(1)}`, n: inBucket.length, accuracy: inBucket.length ? inBucket.filter(correct).length / inBucket.length : null };
  });
}
const curves = {
  presenceYes: curve(presence, (rec) => Math.abs(rec.noul - 0.5) * 2, (rec) => (rec.noul >= 0.5) === rec.truth),
  keepCurrent: curve(expression.filter((rec) => rec.answer === "keep_current"), (rec) => rec.conf, (rec) => rec.ok.has(rec.prev)),
  expressionNew: curve(expression.filter((rec) => rec.answer !== "keep_current"), (rec) => rec.conf, (rec) => rec.ok.has(rec.answer)),
  expressionNewFamily: curve(expression.filter((rec) => rec.answer !== "keep_current"), (rec) => rec.conf, (rec) => [...rec.ok].some((id) => family(id) === family(rec.answer))),
  motionNonNone: curve(motion.filter((rec) => rec.answer !== "none"), (rec) => rec.conf, (rec) => rec.ok.has(rec.answer)),
  emoteNonNone: curve(emote.filter((rec) => rec.answer !== "none"), (rec) => rec.conf, (rec) => rec.ok.has(rec.answer)),
  intensity: curve(intensity, (rec) => rec.conf, (rec) => rec.ok.has(rec.level)),
  light: curve(light, (rec) => rec.conf, (rec) => rec.ok.has(rec.answer)),
  placeReuse: curve(place.filter((rec) => rec.plate !== null), (rec) => rec.conf, (rec) => rec.plate === rec.truth),
  interactionNonNone: curve(interaction.filter((rec) => rec.answer !== "none"), (rec) => rec.conf, (rec) => rec.ok.has(rec.answer)),
};

/* First-option bias. */
const bias = {
  expressionKeepAnswered: expression.filter((rec) => rec.answer === "keep_current").length / (expression.length || 1),
  expressionNoChangeTruth: expression.filter((rec) => !rec.changed).length / (expression.length || 1),
  motionNoneAnswered: motion.filter((rec) => rec.answer === "none").length / (motion.length || 1),
  motionNoneTruth: motion.filter((rec) => rec.ok.has("none")).length / (motion.length || 1),
  emoteNoneAnswered: emote.filter((rec) => rec.answer === "none").length / (emote.length || 1),
  emoteNoneTruth: emote.filter((rec) => rec.ok.has("none")).length / (emote.length || 1),
  lightFirstAnswered: light.filter((rec) => rec.answer === rec.first).length / (light.length || 1),
  lightFirstTruth: light.filter((rec) => rec.ok.has(rec.first)).length / (light.length || 1),
  placeNewAnswered: place.filter((rec) => rec.answer === "new_place").length / (place.length || 1),
  placeNewTruth: place.filter((rec) => rec.truth === null).length / (place.length || 1),
  interactionNoneAnswered: interaction.filter((rec) => rec.answer === "none").length / (interaction.length || 1),
  interactionNoneTruth: interaction.filter((rec) => rec.ok.has("none")).length / (interaction.length || 1),
  presenceMeanNoulWhenAbsent: mean(presence.filter((rec) => !rec.truth).map((rec) => rec.noul)),
  presenceMeanNoulWhenPresent: mean(presence.filter((rec) => rec.truth).map((rec) => rec.noul)),
};
function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/* ------------------------------------------------------------------------ */
/* End to end: the real staging engine with the overrides                    */
/* ------------------------------------------------------------------------ */

type E2E = { presence: number; presenceN: number; ghost: number; missing: number; expression: number; expressionFamily: number; expressionN: number; motion: number; motionFalse: number; motionN: number; emote: number; emoteFalse: number; emoteN: number; intensity: number; light: number; lightN: number; plate: number; plateN: number; wrongPlate: number; illustrateOk: number; illustrateWrong: number; illustrateReplies: number };
function endToEnd(t: SpriteThresholds | null, kt: KeyThresholds): E2E {
  const out: E2E = { presence: 0, presenceN: 0, ghost: 0, missing: 0, expression: 0, expressionFamily: 0, expressionN: 0, motion: 0, motionFalse: 0, motionN: 0, emote: 0, emoteFalse: 0, emoteN: 0, intensity: 0, light: 0, lightN: 0, plate: 0, plateN: 0, wrongPlate: 0, illustrateOk: 0, illustrateWrong: 0, illustrateReplies: 0 };
  for (const { kase, batches } of loaded) {
    let staging = kase.deterministic;
    if (t) {
      const overrides: SpriteStagingOverrides = { paragraphs: new Map(), sceneLight: new Map(), scenePlate: new Map() };
      for (const batch of batches) applySpriteAnswers(overrides, batch.meta, batch.answers, t, kt);
      staging = stageParagraphs(kase.context, overrides, "classifier");
    }
    const castNames = kase.reply.cast.map((member) => member.name);
    const keyOf = new Map([...kase.names].map(([key, name]) => [name, key] as const));
    for (const [index, truth] of kase.labels.entries()) {
      const stage = staging.paragraphs[index]!;
      for (const name of castNames) {
        const key = keyOf.get(name);
        const actor = key ? stage.actors.find((candidate) => candidate.characterKey === key) : undefined;
        const present = truth.present.has(name);
        out.presenceN += 1;
        if (Boolean(actor) === present) out.presence += 1;
        else if (actor) out.ghost += 1;
        else out.missing += 1;
        const char = truth.chars.get(name);
        if (!actor || !char) continue;
        out.expressionN += 1;
        if (char.eSet.has(actor.expression)) out.expression += 1;
        if ([...char.eSet].some((id) => family(id) === family(actor.expression))) out.expressionFamily += 1;
        out.motionN += 1;
        if (char.mSet.has(actor.motion)) out.motion += 1;
        else if (actor.motion !== "none") out.motionFalse += 1;
        out.emoteN += 1;
        if (char.emSet.has(actor.emote)) out.emote += 1;
        else if (actor.emote !== "none") out.emoteFalse += 1;
        if (char.iSet.has(actor.intensity)) out.intensity += 1;
      }
      const scene = kase.reply.scenes[truth.sceneIndex]!;
      out.lightN += 1;
      if (new Set([scene.light, ...(scene.lightOk ?? [])]).has(stage.light)) out.light += 1;
    }
    for (const [sceneIndex, scene] of kase.reply.scenes.entries()) {
      const stage = staging.paragraphs[scene.start]!;
      const plateId = stage.plateKey ? PLATE_ID_BY_KEY.get(stage.plateKey) ?? null : null;
      out.plateN += 1;
      if (plateId === scene.plate) out.plate += 1;
      else if (plateId !== null) out.wrongPlate += 1;
      void sceneIndex;
    }
    out.illustrateReplies += 1;
    for (const [index, stage] of staging.paragraphs.entries()) {
      if (!stage.illustrate) continue;
      if (kase.labels[index]!.qualifies) out.illustrateOk += 1;
      else out.illustrateWrong += 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Latency, tokens, determinism                                              */
/* ------------------------------------------------------------------------ */

const cachedAll = loaded.flatMap((item) => item.batches.map((batch) => batch.cached));
const pct = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0;
};
const latencies = cachedAll.map((item) => item.latencyMs);
const tokens = cachedAll.map((item) => item.response?.usage?.input_tokens ?? 0);
const perReplyTokens = loaded.map((item) => item.batches.reduce((n, batch) => n + (batch.cached.response?.usage?.input_tokens ?? 0), 0));
const perf = {
  requests: cachedAll.length,
  missing,
  latencyMs: { p50: pct(latencies, 0.5), p90: pct(latencies, 0.9), max: Math.max(0, ...latencies) },
  bytes: { mean: Math.round(mean(cachedAll.map((item) => item.bytes))), max: Math.max(0, ...cachedAll.map((item) => item.bytes)) },
  inputTokens: { perRequest: Math.round(mean(tokens)), perReply: Math.round(mean(perReplyTokens)), total: tokens.reduce((a, b) => a + b, 0) },
  usdPerReply: mean(perReplyTokens) * 0.042 / 1e6,
  questions: loaded.reduce((n, item) => n + item.kase.batches.reduce((m, batch) => m + Object.keys(batch.questions).length, 0), 0),
};

function determinism() {
  let pairs = 0;
  let same = 0;
  let maxDelta = 0;
  let sumDelta = 0;
  let deltas = 0;
  let requests = 0;
  for (const kase of cases) {
    for (const batch of kase.batches) {
      const hash = bodyHash(batch.body);
      const first = readCached(ANSWERS_DIR, hash)?.response?.answers;
      const second = readCached(REPEAT_DIR, hash)?.response?.answers;
      if (!first || !second) continue;
      requests += 1;
      for (const [key, a] of Object.entries(first) as Array<[string, Choice | Score | Noul]>) {
        const b = second[key] as Choice | Score | Noul | undefined;
        if (!b) continue;
        pairs += 1;
        let delta = 0;
        if (a.type === "choice" && b.type === "choice") { if (a.choice === b.choice) same += 1; delta = Math.abs(a.confidence - b.confidence); }
        else if (a.type === "score" && b.type === "score") { if (Math.round(a.score) === Math.round(b.score)) same += 1; delta = Math.abs(a.score - b.score); }
        else if (a.type === "noul" && b.type === "noul") { if ((a.noul >= 0.5) === (b.noul >= 0.5)) same += 1; delta = Math.abs(a.noul - b.noul); }
        maxDelta = Math.max(maxDelta, delta);
        sumDelta += delta;
        deltas += 1;
      }
    }
  }
  return { requests, answers: pairs, sameAnswer: pairs ? same / pairs : null, meanDelta: deltas ? sumDelta / deltas : null, maxDelta };
}

/* ------------------------------------------------------------------------ */
/* Report                                                                    */
/* ------------------------------------------------------------------------ */

const tables = { old: decisionTable(OLD_THRESHOLDS, OLD_KEY_THRESHOLDS), current: decisionTable(CURRENT_THRESHOLDS, CURRENT_KEY_THRESHOLDS), best: decisionTable(NEW_THRESHOLDS, NEW_KEY_THRESHOLDS) };
const subs = { old: subDecisions(OLD_THRESHOLDS), current: subDecisions(CURRENT_THRESHOLDS), best: subDecisions(NEW_THRESHOLDS) };
const keyPicks = {
  deterministicAll: momentPickSummary(deterministicMomentPicks({ eligibleCueOnly: false })),
  deterministicCue: momentPickSummary(deterministicMomentPicks({ eligibleCueOnly: true })),
  oldAll: momentPickSummary(momentPicks(OLD_KEY_THRESHOLDS, { eligibleCueOnly: false })),
  oldCue: momentPickSummary(momentPicks(OLD_KEY_THRESHOLDS, { eligibleCueOnly: true })),
  currentAll: momentPickSummary(momentPicks(CURRENT_KEY_THRESHOLDS, { eligibleCueOnly: false })),
  currentCue: momentPickSummary(momentPicks(CURRENT_KEY_THRESHOLDS, { eligibleCueOnly: true })),
  bestAll: momentPickSummary(momentPicks(NEW_KEY_THRESHOLDS, { eligibleCueOnly: false })),
  bestCue: momentPickSummary(momentPicks(NEW_KEY_THRESHOLDS, { eligibleCueOnly: true })),
};
const momentLevelAccuracy = {
  n: momentList.filter((rec) => rec.level !== null).length,
  rounded: mean(momentList.filter((rec) => rec.level !== null).map((rec) => (rec.levelOk.has(rec.level!) ? 1 : 0))),
  argmax: mean(momentList.filter((rec) => rec.argmax !== null).map((rec) => (rec.levelOk.has(rec.argmax!) ? 1 : 0))),
  standingAccuracy: mean(momentList.filter((rec) => rec.standing !== null).map((rec) => ((rec.standing! >= 0.5) === rec.standingTruth ? 1 : 0))),
  standingAccuracyMajor: mean(momentList.filter((rec) => rec.standing !== null && rec.truthLevel >= 3).map((rec) => ((rec.standing! >= 0.5) === rec.standingTruth ? 1 : 0))),
  standingMeanYesWhenStanding: mean(momentList.filter((rec) => rec.standing !== null && rec.standingTruth).map((rec) => rec.standing!)),
  standingMeanYesWhenNot: mean(momentList.filter((rec) => rec.standing !== null && !rec.standingTruth).map((rec) => rec.standing!)),
  qualifyingParagraphs: momentList.filter((rec) => rec.qualifies).length,
};
const e2e = {
  deterministic: endToEnd(null, OLD_KEY_THRESHOLDS),
  old: endToEnd(OLD_THRESHOLDS, OLD_KEY_THRESHOLDS),
  current: endToEnd(CURRENT_THRESHOLDS, CURRENT_KEY_THRESHOLDS),
  best: endToEnd(NEW_THRESHOLDS, NEW_KEY_THRESHOLDS),
};
const result = {
  label,
  dataset: { replies: REPLIES.length, paragraphs: REPLIES.reduce((n, reply) => n + reply.paragraphs.length, 0), scenes: place.length + 0, records: { presence: presence.length, expression: expression.length, motion: motion.length, emote: emote.length, intensity: intensity.length, light: light.length, place: place.length, moments: momentList.length, interactionsRelevant: relevantInteractions.length } },
  thresholds: { old: OLD_THRESHOLDS, current: CURRENT_THRESHOLDS, best: NEW_THRESHOLDS, oldKey: OLD_KEY_THRESHOLDS, currentKey: CURRENT_KEY_THRESHOLDS, bestKey: NEW_KEY_THRESHOLDS },
  variants: { expressionGrouped: expressionGroupedBest, expressionPlain: expressionBest, intensityRounded: intensityBest, intensityArgmax: intensityArgmaxBest },
  sweeps: { motion: motionBest.sweep, emote: emoteBest.sweep, intensity: intensityBest.sweep, light: lightBest.sweep, place: placeBest.sweep, interaction: interactionBest.sweep },
  tables,
  subs,
  keyPicks,
  momentLevelAccuracy,
  e2e,
  curves,
  bias,
  perf,
  determinism: determinism(),
};
ensureDir(RESULTS_DIR);
writeFileSync(join(RESULTS_DIR, `${label}.json`), `${JSON.stringify(result, null, 1)}\n`);

const f = (value: number) => value.toFixed(2);
const p = (value: number) => `${(value * 100).toFixed(0)}%`;
const lines: string[] = [];
lines.push(`# Jev sprite classifier evaluation (${label})`, "");
lines.push(`dataset: ${result.dataset.replies} replies, ${result.dataset.paragraphs} paragraphs; records ${JSON.stringify(result.dataset.records)}`);
lines.push(`perf: ${JSON.stringify(perf)}`);
lines.push(`determinism: ${JSON.stringify(result.determinism)}`, "");
lines.push("## Decisions (utility; accuracy of the final value; acted = classifier changed the deterministic value)", "");
lines.push("| decision | n | det acc / U | old acc / U / prec / cov | best acc / U / prec / cov | best threshold |", "|---|---|---|---|---|---|");
const thresholdOf: Record<string, string> = {
  presence: `yes ${f(NEW_THRESHOLDS.presentYes)} / no ${f(NEW_THRESHOLDS.presentNo)}`,
  expression: `keep ${f(NEW_THRESHOLDS.keep)} hot ${f(NEW_THRESHOLDS.hotExpression)} rare ${f(NEW_THRESHOLDS.rareExpression)}`,
  motion: f(NEW_THRESHOLDS.motion), emote: f(NEW_THRESHOLDS.emote), intensity: f(NEW_THRESHOLDS.intensity), intensityAll: f(NEW_THRESHOLDS.intensity),
  light: f(NEW_THRESHOLDS.light), place: f(NEW_THRESHOLDS.place), interaction: f(NEW_KEY_THRESHOLDS.interactionConfidence),
};
for (const name of Object.keys(tables.old) as Array<keyof typeof tables.old>) {
  const o = tables.old[name];
  const b = tables.best[name];
  lines.push(`| ${name} | ${o.n} | ${p(o.detAccuracy)} / ${o.detUtility} | ${p(o.accuracy)} / ${o.utility} / ${p(o.precision)} / ${p(o.coverage)} | ${p(b.accuracy)} / ${b.utility} / ${p(b.precision)} / ${p(b.coverage)} | ${thresholdOf[name]} |`);
}
lines.push("", "## Sub-decisions (precision / coverage of acted answers)", "", "| decision | n | old prec / cov | best prec / cov |", "|---|---|---|---|");
for (const name of Object.keys(subs.old) as Array<keyof typeof subs.old>) {
  const o = subs.old[name];
  const b = subs.best[name];
  lines.push(`| ${name} | ${o.n} | ${p(o.precision)} / ${p(o.coverage)} (${o.acted}) | ${p(b.precision)} / ${p(b.coverage)} (${b.acted}) |`);
}
lines.push("", "## Key moments (per reply pick, cap 1)", "");
for (const [name, value] of Object.entries(keyPicks)) lines.push(`- ${name}: ${JSON.stringify(value)}`);
lines.push(`- best key thresholds: ${JSON.stringify(NEW_KEY_THRESHOLDS)} (utility ${keyBest.utility})`);
lines.push(`- level accuracy: ${JSON.stringify(momentLevelAccuracy)}`);
lines.push("", "## End to end (real staging engine)", "", "| metric | deterministic | old | current | best |", "|---|---|---|---|---|");
const ratio = (e: E2E, a: keyof E2E, b: keyof E2E) => p((e[a] as number) / ((e[b] as number) || 1));
for (const [name, a, b] of [["presence", "presence", "presenceN"], ["expression", "expression", "expressionN"], ["expression family", "expressionFamily", "expressionN"], ["motion", "motion", "motionN"], ["emote", "emote", "emoteN"], ["intensity", "intensity", "expressionN"], ["light", "light", "lightN"], ["plate", "plate", "plateN"]] as Array<[string, keyof E2E, keyof E2E]>) {
  lines.push(`| ${name} | ${ratio(e2e.deterministic, a, b)} | ${ratio(e2e.old, a, b)} | ${ratio(e2e.current, a, b)} | ${ratio(e2e.best, a, b)} |`);
}
for (const name of ["ghost", "missing", "motionFalse", "emoteFalse", "wrongPlate", "illustrateOk", "illustrateWrong", "expressionN"] as Array<keyof E2E>) {
  lines.push(`| ${name} (count) | ${e2e.deterministic[name]} | ${e2e.old[name]} | ${e2e.current[name]} | ${e2e.best[name]} |`);
}
lines.push("", "## Sweeps (threshold:utility)", "", ...Object.entries(expressionSweeps).map(([name, sweep]) => `- expression ${name}: ${sweep}`));
for (const [name, value] of Object.entries({ motion: motionBest, emote: emoteBest, intensity: intensityBest, light: lightBest, place: placeBest, interaction: interactionBest })) lines.push(`- ${name}: ${value.sweep}`);
lines.push("", "## Variants", "", `- expression plain: ${JSON.stringify(expressionBest)}; grouped by hot family: ${JSON.stringify(expressionGroupedBest)}`);
lines.push(`- intensity rounded score: ${JSON.stringify(intensityBest)}; argmax level: ${JSON.stringify(intensityArgmaxBest)}`);
lines.push("", "## First-option bias", "", ...Object.entries(bias).map(([name, value]) => `- ${name}: ${f(value)}`));
lines.push("", "## Calibration curves (raw answer accuracy by confidence)", "");
for (const [name, rows] of Object.entries(curves)) lines.push(`- ${name}: ${rows.map((row) => `${row.bucket}:${row.n ? `${p(row.accuracy!)}(${row.n})` : "-"}`).join("  ")}`);
const markdown = lines.join("\n");
writeFileSync(join(RESULTS_DIR, `${label}.md`), `${markdown}\n`);
console.log(markdown);
