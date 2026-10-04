/**
 * Key-moment illustrations inside sprite mode (config `keyIllustrations`).
 *
 * Sprites cannot show everything: sitting, running, kissing, fighting, a
 * dramatic reveal. With `keyIllustrations: "few"` at most
 * KEY_ILLUSTRATION_CAP.few paragraphs per reply get `illustrate: true` and a
 * `moment` (interaction + who takes part) in their SpriteParagraphStage. The
 * backend paints that moment with its own two-character prompt
 * (moment-prompts.ts) on the sprite scheduler (SpriteService.runKeyMoments),
 * and the stage shows the finished picture instead of the sprites for that
 * paragraph.
 *
 * This module is pure: selection rules, the interaction rule, the cue
 * lookup, and the views. The controller does the I/O.
 */
import { KEY_ILLUSTRATION_CAP, type VisualNovelConfig } from "../../../config.js";
import type { AssetJob, TurnPlan, VisualCue } from "../../../shared/contracts.js";
import {
  interactionNeedsPartner,
  spriteIllustrationViewFor,
  type SpriteIllustrationView,
  type SpriteInteraction,
  type SpriteKeyMoment,
  type SpriteParagraphStage,
  type SpriteStaging,
} from "../../../shared/sprites.js";

/** Key illustrations allowed per reply for this config (0 = feature off). */
export function keyIllustrationCap(config: Pick<VisualNovelConfig, "keyIllustrations" | "generateImages" | "useNativeCardImages"> | null | undefined): number {
  if (!config || !config.generateImages || config.useNativeCardImages) return 0;
  return KEY_ILLUSTRATION_CAP[config.keyIllustrations] ?? 0;
}

/* ------------------------------------------------------------------------ */
/* Cues                                                                      */
/* ------------------------------------------------------------------------ */

/** A cue the scene pipeline can paint (an unresolved identity would only fail). */
function paintable(cue: VisualCue): boolean {
  return !(cue.resolvedIdentity !== undefined && !cue.resolvedIdentity.trim());
}

/**
 * The visual cue of each paragraph that could become a key illustration:
 * budgeted cues first, then reuse-only cues beyond the scene-image cap (the
 * planner keeps both in sprite mode). One cue per paragraph, first wins.
 */
export function keyMomentCues(plan: Pick<TurnPlan, "visualCues" | "cacheCues" | "paragraphs">): Map<number, VisualCue> {
  const cues = new Map<number, VisualCue>();
  const count = plan.paragraphs?.length ?? 0;
  for (const cue of [...(plan.visualCues ?? []), ...(plan.cacheCues ?? [])]) {
    if (cue.paragraphIndex < 0 || cue.paragraphIndex >= count) continue;
    if (cues.has(cue.paragraphIndex) || !paintable(cue)) continue;
    cues.set(cue.paragraphIndex, cue);
  }
  return cues;
}

/* ------------------------------------------------------------------------ */
/* Deterministic rule (conservative)                                         */
/* ------------------------------------------------------------------------ */

const QUOTED = /"[^"]*"|“[^”]*”|„[^“”]*[“”]|«[^»]*»|「[^」]*」|『[^』]*』/g;
const NEGATION = /\b(?:not|n't|never|hardly|scarcely|barely|without|no|doesn't|didn't|don't|won't|can't|cannot|almost|nearly|about to|wants? to|wanted to|would|could|might)\b/i;

// Object pronoun followed by a preposition or the end of the clause, so the
// possessive "her" ("lifts her chin") does not count.
const WHOM = String.raw`(?:her|him|them|me|you)(?=\s*(?:[.,!?;:…]|$|\s(?:up|down|to|into|onto|away|off|across|through|over|in|out|back|inside|against|close|closer|tight|tightly)\b))`;

/** Two people in contact, or a fight: never a standing sprite. */
const CONTACT_PATTERNS: readonly RegExp[] = [
  /\bkiss(?:es|ed|ing)?\b/i,
  /\b(?:hugs?|hugged|hugging|cuddl(?:e|es|ed|ing)|snuggl(?:e|es|ed|ing))\b/i,
  /\bembrac(?:e|es|ed|ing) (?:her|him|them|me|you|each other|one another)\b|\b(?:an|the|their|his|her|my|your) embrace\b/i,
  /\b(?:fights?|fought|fighting)\b(?! (?:back|the urge|off|for|against|to|tears|a (?:smile|laugh|yawn)))/i,
  /\b(?:brawl(?:s|ed|ing)?|duel(?:s|ed|ing|led|ling)?|parr(?:y|ies|ied|ying)|lung(?:e|es|ed|ing))\b/i,
  /\bwrestl(?:e|es|ed|ing)\b(?! with)/i,
  /(?<!\ba )\b(?:punch(?:es|ed|ing)?|slash(?:es|ed|ing)?|stab(?:s|bed|bing)?)\b(?! (?:line|of)\b)/i,
  /\bkick(?:s|ed|ing)?\b(?! (?:off|in|back|out)\b)/i,
  /\b(?:swings?|swung|swinging) (?:her|his|their|its|my|a|the) (?:sword|blade|axe|fist|staff|club|hammer)\b/i,
  new RegExp(String.raw`\b(?:carr(?:y|ies|ied|ying)|lift(?:s|ed|ing)?|tackl(?:e|es|ed|ing)|pin(?:s|ned|ning)?) ${WHOM}`, "i"),
];

/** A body pose or movement a standing cut-out cannot show. */
const POSE_PATTERNS: readonly RegExp[] = [
  /\b(?:sits?|sat|sitting|seated|kneel(?:s|ed|ing)?|knelt|reclin(?:e|es|ed|ing)|crouch(?:es|ed|ing)?|squat(?:s|ted|ting)?)\b/i,
  /\b(?:lies|lay|lying|laid) (?:down|back|on|across|beside|in bed|in (?:her|his|their|my) arms)\b/i,
  /\b(?:runs?|ran|running) (?:to|toward|towards|into|across|through|after|away|off|down|up|out|from|along)\b/i,
  /\b(?:sprint(?:s|ed|ing)?|dash(?:es|ed|ing)? (?:to|toward|towards|into|across|through|after|away|off|out)|climb(?:s|ed|ing)?|swim(?:s|ming)?|swam)\b/i,
  /\b(?:leaps?|leapt|leaped|leaping|jump(?:s|ed|ing)?) (?:over|across|into|onto|from|off|down|at|toward|towards)\b/i,
  /\b(?:rides?|rode|riding|danc(?:e|es|ed|ing)|twirl(?:s|ed|ing)?)\b/i,
  /\b(?:falls?|fell|falling|tumbl(?:e|es|ed|ing)|collaps(?:e|es|ed|ing)) (?:down|backward|backwards|off|from|to (?:her|his|their|my|the) (?:knees|floor|ground))\b/i,
];

/** A cue action that needs the whole figure (a raised weapon). */
const STRONG_ACTIONS: ReadonlySet<string> = new Set(["wielding"]);

function narration(text: string): string {
  return text.replace(QUOTED, " . ");
}

function matchesUnnegated(text: string, patterns: readonly RegExp[]): boolean {
  for (const sentence of text.split(/(?<=[.!?…])\s+|\n+/)) {
    for (const pattern of patterns) {
      const match = pattern.exec(sentence);
      if (!match) continue;
      const before = sentence.slice(Math.max(0, match.index - 40), match.index);
      if (!NEGATION.test(before)) return true;
    }
  }
  return false;
}

/**
 * How strongly the deterministic rule wants a paragraph illustrated:
 * 3 contact or fight, 2 a pose a standing sprite cannot show (or a raised
 * weapon), 1 the first paragraph of a scene with nobody on stage, 0 never.
 * Only narration counts (quoted speech is ignored), negated verbs do not.
 */
export function keyMomentStrength(
  text: string,
  cue: Pick<VisualCue, "action"> | null | undefined,
  options: { sceneOpenerWithoutCast?: boolean } = {},
): number {
  if (!cue) return 0;
  const told = narration(text ?? "");
  if (matchesUnnegated(told, CONTACT_PATTERNS)) return 3;
  if (matchesUnnegated(told, POSE_PATTERNS)) return 2;
  const action = cue.action && typeof cue.action === "object" ? cue.action.action : null;
  if (action && STRONG_ACTIONS.has(action)) return 2;
  if (options.sceneOpenerWithoutCast) return 1;
  return 0;
}

/* ------------------------------------------------------------------------ */
/* Interaction (what the picture shows)                                      */
/* ------------------------------------------------------------------------ */

const POSSESSIVE = String.raw`(?:her|his|their|my|your)`;
const OBJECT = String.raw`(?:her|him|them|me|you|each other|one another)`;

/**
 * Narration patterns per interaction, most specific first: the first
 * interaction with an unnegated match wins. Quoted speech never counts.
 */
const INTERACTION_PATTERNS: ReadonlyArray<readonly [SpriteInteraction, readonly RegExp[]]> = [
  ["kiss", [
    /\bkiss(?:es|ed|ing)?\b/i,
    new RegExp(String.raw`\b(?:lips|mouths) (?:meet|met|touch|touched|brush|brushed|press(?:es|ed)? (?:against|to))\b`, "i"),
  ]],
  ["crying_on_shoulder", [
    new RegExp(String.raw`\b(?:cr(?:y|ies|ied|ying)|sob(?:s|bed|bing)?|weep(?:s|ing)?|wept)\b[^.!?]{0,40}\b(?:into|against|on) ${POSSESSIVE} (?:shoulder|chest)\b`, "i"),
    new RegExp(String.raw`\b(?:bur(?:y|ies|ied|ying)|press(?:es|ed|ing)?) ${POSSESSIVE} (?:face|head) (?:in|into|against) ${POSSESSIVE} (?:shoulder|chest)\b`, "i"),
  ]],
  ["carrying", [
    new RegExp(String.raw`\b(?:carr(?:y|ies|ied|ying)) ${OBJECT}\b`, "i"),
    new RegExp(String.raw`\b(?:scoop(?:s|ed|ing)?|sweep(?:s|ing)?|swept|lift(?:s|ed|ing)?|pick(?:s|ed|ing)?) ${OBJECT} up\b`, "i"),
    new RegExp(String.raw`\b(?:lift(?:s|ed|ing)?|cradl(?:e|es|ed|ing)) ${OBJECT} (?:into|in) ${POSSESSIVE} arms\b`, "i"),
    /\bprincess carry\b/i,
  ]],
  ["hug", [
    /\b(?:hugs?|hugged|hugging|cuddl(?:e|es|ed|ing)|snuggl(?:e|es|ed|ing))\b/i,
    new RegExp(String.raw`\bembrac(?:e|es|ed|ing) ${OBJECT}\b|\b(?:an|the|their|his|her|my|your) embrace\b`, "i"),
    new RegExp(String.raw`\b(?:throws?|threw|throwing|wraps?|wrapped|wrapping|puts?|putting|flings?|flung) ${POSSESSIVE} arms (?:around|round)\b`, "i"),
    new RegExp(String.raw`\b(?:holds?|held|holding|pulls?|pulled|pulling|draws?|drew) ${OBJECT} (?:close|closer|tight|tightly)\b`, "i"),
  ]],
  ["holding_hands", [
    new RegExp(String.raw`\b(?:holds?|held|holding|takes?|took|taking|grabs?|grabbed|grabbing|squeez(?:e|es|ed|ing)|clasps?|clasped|clasping|reach(?:es|ed)? for) ${POSSESSIVE} hand\b(?! (?:up|out|over|to (?:her|his|their|my) (?:face|mouth|chest|lips)))`, "i"),
    /\b(?:holding hands|hand in hand|hands? (?:intertwined|entwined|laced)|lac(?:e|es|ed|ing) (?:her|his|their|my) fingers)\b/i,
  ]],
  ["dancing", [/\b(?:danc(?:e|es|ed|ing)|waltz(?:es|ed|ing)?|twirl(?:s|ed|ing)?)\b/i]],
  ["fighting", [
    /\b(?:fights?|fought|fighting)\b(?! (?:back|the urge|off|for|tears|a (?:smile|laugh|yawn)))/i,
    /\b(?:brawl(?:s|ed|ing)?|duel(?:s|ed|ing|led|ling)?|parr(?:y|ies|ied|ying)|lung(?:e|es|ed|ing))\b/i,
    /(?<!\ba )\b(?:punch(?:es|ed|ing)?|slash(?:es|ed|ing)?|stab(?:s|bed|bing)?)\b(?! (?:line|of)\b)/i,
    /\bkick(?:s|ed|ing)?\b(?! (?:off|in|back|out)\b)/i,
    /\b(?:swings?|swung|swinging) (?:her|his|their|its|my|a|the) (?:sword|blade|axe|fist|staff|club|hammer)\b/i,
    /\b(?:blades?|swords?) (?:clash|clashed|clashing|meet|met)\b/i,
  ]],
  ["lying", [
    /\b(?:lies|lay|lying|laid|lays) (?:down|back|on|across|beside|in bed|in (?:her|his|their|my) arms|together|side by side)\b/i,
    /\b(?:collaps(?:e|es|ed|ing)|flops?|flopped|sprawl(?:s|ed|ing)?) (?:onto|on|across) (?:the|a|her|his|their|my) (?:bed|floor|ground|grass|couch|sofa)\b/i,
  ]],
  ["kneeling", [
    /\b(?:kneel(?:s|ed|ing)?|knelt)\b/i,
    /\b(?:falls?|fell|falling|drops?|dropped|dropping|sinks?|sank|sinking) (?:to|onto) (?:her|his|their|my|one|both) knees?\b/i,
  ]],
  ["sitting_together", [
    new RegExp(String.raw`\b(?:sits?|sat|sitting|seated)(?: down)? (?:together|side by side|next to (?:her|him|them|each other|me|you)|beside (?:her|him|them|each other|me|you)|with (?:her|him|them|me|you))\b`, "i"),
  ]],
  ["sitting", [/\b(?:sits?|sat|sitting|seated|perch(?:es|ed|ing)?|reclin(?:e|es|ed|ing))\b/i]],
  ["running", [
    /\b(?:runs?|ran|running) (?:to|toward|towards|into|across|through|after|away|off|down|up|out|from|along)\b/i,
    /\b(?:sprint(?:s|ed|ing)?|dash(?:es|ed|ing)? (?:to|toward|towards|into|across|through|after|away|off|out)|rush(?:es|ed|ing)? (?:to|toward|towards|into|across|through|after|out))\b/i,
  ]],
  ["walking_together", [
    new RegExp(String.raw`\b(?:walk(?:s|ed|ing)?|strolls?|strolled|strolling|wander(?:s|ed|ing)?) (?:together|side by side|beside (?:her|him|them|each other)|alongside (?:her|him|them|each other)|with (?:her|him|them))\b`, "i"),
  ]],
  ["looking_at_each_other", [
    /\b(?:eyes|gazes) (?:meet|met|lock|locked)\b/i,
    new RegExp(String.raw`\b(?:looks?|looked|looking|gaz(?:e|es|ed|ing)|star(?:e|es|ed|ing)) (?:deep )?into (?:${POSSESSIVE}|each other's|one another's) eyes\b`, "i"),
    /\b(?:look|looked|looking|stare|stared|staring|gaze|gazed|gazing) at each other\b/i,
  ]],
];

/**
 * The interaction a key-moment picture should show, from the paragraph's
 * narration (quoted speech and negated verbs are ignored). "none" when no
 * rule matches.
 */
export function keyMomentInteraction(text: string): SpriteInteraction {
  const told = narration(text ?? "");
  for (const [interaction, patterns] of INTERACTION_PATTERNS) {
    if (matchesUnnegated(told, patterns)) return interaction;
  }
  return "none";
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where a character's name (or first name) first appears in a text, or -1. */
function mentionIndex(text: string, name: string): number {
  const full = name.trim();
  if (!full) return -1;
  const forms = [full];
  const first = full.split(/\s+/)[0] ?? "";
  if (first.length >= 3 && first !== full) forms.push(first);
  let best = -1;
  for (const form of forms) {
    const match = new RegExp(String.raw`(?<![\p{L}\p{N}])${escapeRegExp(form)}(?![\p{L}\p{N}])`, "iu").exec(text);
    if (match && (best === -1 || match.index < best)) best = match.index;
  }
  return best;
}

/**
 * Who is in the picture (at most 2 cast keys) for a paragraph's actors:
 * characters the narration names come first (in order of mention), then
 * the focused actor, then the rest. Two-person interactions take two
 * actors when two are on stage; with one, the other person is not a cast
 * member (`partner`: first-person view). Other interactions show the
 * named actors (at most 2), else the focused or first actor.
 */
export function keyMomentCast(
  stage: Pick<SpriteParagraphStage, "actors">,
  text: string,
  names: ReadonlyMap<string, string>,
  interaction: SpriteInteraction,
): Pick<SpriteKeyMoment, "characters" | "partner"> {
  const told = narration(text ?? "");
  const actors = stage.actors ?? [];
  const mentioned = actors
    .map((actor) => ({ key: actor.characterKey, at: mentionIndex(told, names.get(actor.characterKey) ?? "") }))
    .filter((entry) => entry.at >= 0)
    .sort((left, right) => left.at - right.at)
    .map((entry) => entry.key);
  const focus = actors.find((actor) => actor.focus)?.characterKey;
  const ranked: string[] = [];
  for (const key of [...mentioned, focus, ...actors.map((actor) => actor.characterKey)]) {
    if (key && !ranked.includes(key)) ranked.push(key);
  }
  if (interactionNeedsPartner(interaction)) {
    const characters = ranked.slice(0, 2);
    return { characters, partner: characters.length === 1 };
  }
  const characters = mentioned.length ? mentioned.slice(0, 2) : ranked.slice(0, 1);
  return { characters, partner: false };
}

/** The full moment for a paragraph (deterministic interaction unless `interaction` is given). */
export function keyMomentFor(
  stage: Pick<SpriteParagraphStage, "actors">,
  text: string,
  names: ReadonlyMap<string, string>,
  interaction: SpriteInteraction = keyMomentInteraction(text),
): SpriteKeyMoment {
  return { interaction, ...keyMomentCast(stage, text, names, interaction) };
}

/* ------------------------------------------------------------------------ */
/* Classifier answers                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Classifier signal for one paragraph: `moment` is the 0-based level of the
 * "how important and visual" score (0 ordinary .. 4 the defining scene),
 * `standing` the probability that a standing sprite can show it.
 */
export type KeyMomentAnswer = {
  moment?: number;
  standing?: number;
  /** A confident interaction answer (never "none"); else the text rule decides. */
  interaction?: SpriteInteraction;
};

/** Selection thresholds for classifier answers (not yet calibrated against live Jev). */
export const KEY_MOMENT_THRESHOLDS = {
  /** Score confidence needed to trust a moment level. */
  momentConfidence: 0.5,
  /** A major moment (level >= 3) qualifies when a sprite clearly cannot show it. */
  majorLevel: 3,
  majorStandingMax: 0.4,
  /** The defining moment (level 4) qualifies unless a sprite clearly can show it. */
  climaxLevel: 4,
  climaxStandingMax: 0.6,
  /** Choice confidence needed to take the classifier's interaction over the text rule. */
  interactionConfidence: 0.6,
} as const;

/* ------------------------------------------------------------------------ */
/* Selection                                                                 */
/* ------------------------------------------------------------------------ */

type Candidate = { index: number; rank: number; tiebreak: number };

function pick(candidates: Candidate[], cap: number): Set<number> {
  return new Set(
    candidates
      .sort((left, right) => right.rank - left.rank || right.tiebreak - left.tiebreak || left.index - right.index)
      .slice(0, Math.max(0, cap))
      .map((candidate) => candidate.index),
  );
}

/** Deterministic choice: the strongest paragraphs (earliest first on ties), within the cap. */
export function selectDeterministicKeyMoments(
  plan: Pick<TurnPlan, "visualCues" | "cacheCues" | "paragraphs" | "scenes">,
  paragraphs: readonly Pick<SpriteParagraphStage, "actors">[],
  cap: number,
): Set<number> {
  if (cap <= 0) return new Set();
  const cues = keyMomentCues(plan);
  const sceneStarts = new Set((plan.scenes ?? []).map((scene, index) => (index === 0 ? 0 : scene.startParagraph)));
  const candidates: Candidate[] = [];
  for (const [index, cue] of cues) {
    const opener = sceneStarts.has(index) && (paragraphs[index]?.actors.length ?? 0) === 0;
    const strength = keyMomentStrength(plan.paragraphs[index]?.text ?? "", cue, { sceneOpenerWithoutCast: opener });
    if (strength > 0) candidates.push({ index, rank: strength, tiebreak: 0 });
  }
  return pick(candidates, cap);
}

/** Classifier choice: the most important paragraphs a sprite cannot show, within the cap. */
export function selectClassifiedKeyMoments(
  answers: ReadonlyMap<number, KeyMomentAnswer>,
  eligible: ReadonlySet<number>,
  cap: number,
): Set<number> {
  if (cap <= 0) return new Set();
  const t = KEY_MOMENT_THRESHOLDS;
  const candidates: Candidate[] = [];
  for (const [index, answer] of answers) {
    if (!eligible.has(index) || answer.moment === undefined) continue;
    const standing = answer.standing ?? 0.5;
    const qualifies = (answer.moment >= t.climaxLevel && standing <= t.climaxStandingMax)
      || (answer.moment >= t.majorLevel && standing <= t.majorStandingMax);
    if (qualifies) candidates.push({ index, rank: answer.moment, tiebreak: 1 - standing });
  }
  return pick(candidates, cap);
}

/**
 * Mark the chosen paragraphs `illustrate: true` (and clear the flag
 * everywhere else). Classifier answers decide when there are any; otherwise
 * the deterministic rule does. Cap 0 returns the paragraphs without flags.
 */
export function applyKeyMoments<T extends SpriteParagraphStage>(
  paragraphs: T[],
  plan: Pick<TurnPlan, "visualCues" | "cacheCues" | "paragraphs" | "scenes">,
  cap: number,
  answers?: ReadonlyMap<number, KeyMomentAnswer> | null,
  names: ReadonlyMap<string, string> = new Map(),
): T[] {
  let chosen = new Set<number>();
  if (cap > 0) {
    const classified = answers && [...answers.values()].some((answer) => answer.moment !== undefined);
    chosen = classified
      ? selectClassifiedKeyMoments(answers!, new Set(keyMomentCues(plan).keys()), cap)
      : selectDeterministicKeyMoments(plan, paragraphs, cap);
  }
  return paragraphs.map((paragraph, index) => {
    const { illustrate: _drop, moment: _moment, ...rest } = paragraph;
    if (!chosen.has(index)) return rest as T;
    const text = plan.paragraphs[index]?.text ?? "";
    const moment = keyMomentFor(paragraph, text, names, answers?.get(index)?.interaction ?? keyMomentInteraction(text));
    return { ...rest, illustrate: true, moment } as T;
  });
}

/* ------------------------------------------------------------------------ */
/* Jobs and views                                                            */
/* ------------------------------------------------------------------------ */

/** Paragraph indexes flagged `illustrate`, in order, at most `cap`. */
export function illustratedParagraphs(staging: Pick<SpriteStaging, "paragraphs"> | null | undefined, cap = Number.POSITIVE_INFINITY): number[] {
  const out: number[] = [];
  for (const [index, paragraph] of (staging?.paragraphs ?? []).entries()) {
    if (out.length >= cap) break;
    if (paragraph.illustrate) out.push(index);
  }
  return out;
}

/** The cues to paint for a staged plan: one per flagged paragraph, within the cap. */
export function keyIllustrationCues(plan: Pick<TurnPlan, "visualCues" | "cacheCues" | "paragraphs" | "spriteStaging">, cap: number): VisualCue[] {
  if (cap <= 0) return [];
  const cues = keyMomentCues(plan);
  return illustratedParagraphs(plan.spriteStaging)
    .map((index) => cues.get(index))
    .filter((cue): cue is VisualCue => Boolean(cue))
    .slice(0, cap);
}

/**
 * The plan the scene pipeline runs on for key illustrations: only the cues
 * that own a job, no reuse-only candidates (so no extra cache swaps appear
 * in sprite mode) and no classifier budget allocation.
 */
export function keyIllustrationPlan(plan: TurnPlan, jobs: readonly Pick<AssetJob, "jobId">[]): TurnPlan {
  const ids = new Set(jobs.map((job) => job.jobId));
  const visualCues = [...plan.visualCues, ...(plan.cacheCues ?? [])].filter((cue) => ids.has(cue.assetJobId));
  const { cacheCues: _cacheCues, classifierVisuals: _classifierVisuals, ...rest } = plan;
  return { ...rest, visualCues };
}

/** Whether a stored turn was planned in sprite mode (its jobs are key illustrations only). */
export function isSpritePlannedRecord(record: { plan: Pick<TurnPlan, "spriteStaging">; settingsSnapshot?: Record<string, unknown> }): boolean {
  return record.plan.spriteStaging !== undefined && record.settingsSnapshot?.presentationMode === "sprites";
}

/** The stage's view of the key illustrations: jobs at flagged paragraphs, in paragraph order. */
export function keyIllustrationViews(
  staging: Pick<SpriteStaging, "paragraphs"> | null | undefined,
  jobs: readonly AssetJob[],
): SpriteIllustrationView[] {
  const flagged = new Set(illustratedParagraphs(staging));
  const views: SpriteIllustrationView[] = [];
  for (const job of jobs) {
    if (!flagged.has(job.paragraphIndex) || views.some((view) => view.paragraphIndex === job.paragraphIndex)) continue;
    views.push(spriteIllustrationViewFor(job));
  }
  return views.sort((left, right) => left.paragraphIndex - right.paragraphIndex);
}
