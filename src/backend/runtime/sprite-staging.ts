import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../config.js";
import type { SceneEnvironment, SceneState, TurnPlan, VisualCue } from "../../shared/contracts.js";
import { POSE_EXPRESSION_CATALOGUE, selectPoseExpression } from "../../shared/character.js";
import { characterAppearanceKey, characterIdFor, normalizeCharacterName } from "../../shared/identity.js";
import {
  MAX_SPRITE_ACTORS,
  SPRITE_EXPRESSION_FALLBACK,
  SPRITE_SLOTS,
  SpriteStagingSchema,
  plateKeyFor,
  type SpriteActorStage,
  type SpriteCastMember,
  type SpriteEmote,
  type SpriteLight,
  type SpriteMotion,
  type SpriteParagraphStage,
  type SpritePlateRef,
  type SpriteSlot,
  type SpriteStaging,
} from "../../shared/sprites.js";
import {
  classifySpriteStaging,
  type SpriteClassifierInput,
  type SpriteStagingOverrides,
} from "./system-one-sprites.js";
import { applyKeyMoments, keyIllustrationCap, keyMomentCues } from "./sprites/key-moments.js";

/**
 * Sprite staging: who stands where, with which expression, motion, emote and
 * light, for every paragraph of a planned turn. See docs/SPRITE_MODE.md.
 *
 * One staging engine (`stageParagraphs`) walks the paragraphs in order and
 * applies per-paragraph signals. The deterministic signals come from the plan
 * alone (speakers, scene subjects, cues, continuity, keyword heuristics). The
 * System One classifier (system-one-sprites.ts) only adds confident overrides
 * on top, so every field always has a sane value and an uncertain answer keeps
 * the previous/deterministic value.
 */
export type SpriteStagingInput = {
  plan: TurnPlan;
  config: VisualNovelConfig;
  /** From the sprite library (spriteStyleKey); used for plateKeyFor. */
  styleKey: string;
  /** Plates already in the user's library, so a revisit can reuse its plate. */
  knownPlates: readonly SpritePlateRef[];
  /** Cast and last paragraph stage of the previous turn in this chat, for continuity. */
  previousCast: readonly SpriteCastMember[];
  previousStage: SpriteParagraphStage | null;
  personaName?: string;
  /**
   * Additive (optional): the sceneId of the turn that produced `previousStage`.
   * When given, the previous actors carry over only if this turn's first scene
   * has the same id. When absent, carry-over needs the first scene's plate key
   * to equal `previousStage.plateKey`.
   */
  previousSceneId?: string | null;
  /**
   * Additive (optional): durable appearance tags by character name (the chat's
   * character registry / appearance map). Used for the identity of a cast
   * member when the plan carries no resolved identity for them.
   */
  characterAppearance?: Readonly<Record<string, string>>;
};

/* ------------------------------------------------------------------------ */
/* Expressions                                                               */
/* ------------------------------------------------------------------------ */

const CATALOGUE_IDS: ReadonlySet<string> = new Set(POSE_EXPRESSION_CATALOGUE.map((entry) => entry.id));

/**
 * Scene-mode pose ids that duplicate a hot-set sprite. Staging never requests
 * them, so they never cost an extra sprite generation.
 */
const SPRITE_DUPLICATE_EXPRESSIONS: Readonly<Record<string, string>> = {
  speak: "idle",
  listen: "idle",
  default: "idle",
  standing: "idle",
  wave: "smile",
  smiling: "smile",
  contempl: "thinking",
  think: "thinking",
  laugh: "laughing",
  surprise: "surprised",
};

/** "No new emotion" results: they never replace a current expression. */
const NEUTRAL_EXPRESSIONS: ReadonlySet<string> = new Set(["idle", "speak", "listen", "default", "standing"]);

/** Short-lived expressions: a speaker with no new cue relaxes back to idle. */
const TRANSIENT_EXPRESSIONS: ReadonlySet<string> = new Set([
  "laughing", "giggling", "surprised", "shocked", "eureka", "stupefied", "scared_screaming", "sniggering",
]);

/** A catalogue id usable as a sprite expression (duplicates folded), or null. */
export function spriteExpressionId(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!raw) return null;
  const folded = SPRITE_DUPLICATE_EXPRESSIONS[raw] ?? raw;
  return CATALOGUE_IDS.has(folded) ? folded : null;
}

/* ------------------------------------------------------------------------ */
/* Light                                                                     */
/* ------------------------------------------------------------------------ */

const INDOOR_WORDS = /\b(?:room|bedroom|office|hall|hallway|corridor|library|classroom|kitchen|cafe|café|coffee shop|shop|store|inside|indoors?|interior|house|home|apartment|flat|bar|tavern|inn|lab|laboratory|hospital|clinic|church|chapel|temple|shrine interior|castle|palace|study|lounge|lobby|restaurant|diner|club|gym|studio|attic|basement|cellar|dungeon|cabin|tent|train|carriage|car|elevator|bathroom|throne)\b/i;
const OUTDOOR_WORDS = /\b(?:outside|outdoors?|street|road|park|garden|forest|woods|beach|field|meadow|mountain|hill|river|lake|sea|ocean|shore|rooftop|plaza|square|courtyard|bridge|alley|market|village|town|city|desert|cliff|harbor|harbour|dock|sky|camp)\b/i;
const CANDLE_WORDS = /\b(?:candles?|candlelight|candlelit|torch(?:es|light|lit)?|lanterns?|fireplace|firelight|campfire|hearth|oil lamps?)\b/i;
const DARK_WORDS = /\b(?:pitch[- ]black|pitch[- ]dark|darkness|unlit|blackout|no light|lights? (?:are |is )?out|dimly lit|gloom|gloomy)\b/i;
const NIGHT_WORDS = /\b(?:night|nighttime|midnight|moonlight|moonlit|moon|starlight|starry|late evening)\b/i;
const SUNSET_WORDS = /\b(?:sunset|sundown|dusk|twilight|evening|golden hour|dawn|sunrise|daybreak)\b/i;
const DAY_WORDS = /\b(?:day|daytime|daylight|morning|noon|midday|afternoon|sunny|sunlight|sunlit|bright)\b/i;
const WARM_WORDS = /\b(?:warm|lamps?|lamplight|cozy|cosy|golden|amber|incandescent|soft yellow|glow)\b/i;
const COOL_WORDS = /\b(?:fluorescent|neon|cold|cool|sterile|blue|bluish|monitors?|screens?|led|clinical|harsh white)\b/i;

/** Light preset from the scene's time of day, lighting and weather words. */
export function lightForEnvironment(environment: Partial<SceneEnvironment> | null | undefined): SpriteLight {
  if (!environment) return "neutral";
  const lighting = `${environment.lighting ?? ""}`;
  const time = `${environment.timeOfDay ?? ""}`;
  const place = `${environment.location ?? ""} ${environment.description ?? ""}`;
  const all = `${lighting} ${time} ${environment.weather ?? ""}`;
  if (CANDLE_WORDS.test(lighting)) return "candle";
  if (DARK_WORDS.test(lighting)) return "dark";
  const indoor = INDOOR_WORDS.test(environment.location ?? "") || (!OUTDOOR_WORDS.test(environment.location ?? "") && INDOOR_WORDS.test(place));
  if (indoor) {
    if (COOL_WORDS.test(lighting)) return "indoor_cool";
    if (WARM_WORDS.test(lighting)) return "indoor_warm";
    if (NIGHT_WORDS.test(all) || SUNSET_WORDS.test(time)) return "indoor_warm";
    return "neutral";
  }
  if (NIGHT_WORDS.test(time) || (!time.trim() && NIGHT_WORDS.test(lighting))) return "night";
  if (SUNSET_WORDS.test(time) || (!time.trim() && SUNSET_WORDS.test(lighting))) return "sunset";
  if (DAY_WORDS.test(all)) return "day";
  if (CANDLE_WORDS.test(place)) return "candle";
  return "neutral";
}

/* ------------------------------------------------------------------------ */
/* Text heuristics (conservative)                                            */
/* ------------------------------------------------------------------------ */

const QUOTED = /"[^"]*"|“[^”]*”|„[^“”]*[“”]|«[^»]*»|「[^」]*」|『[^』]*』/g;

function isNegated(chunk: string, matchIndex: number): boolean {
  const prefix = chunk.slice(0, matchIndex);
  return /\b(?:not|n't|never|hardly|scarcely|barely|without|no|doesn't|didn't|don't|won't|can't|cannot)\b/i.test(prefix);
}

type Pattern = readonly [RegExp, string];

/** Explicit body-motion verbs. Ambiguous verbs ("jumps", "shakes") are left out on purpose. */
const MOTION_PATTERNS: ReadonlyArray<readonly [RegExp, SpriteMotion]> = [
  [/\b(?:nods?|nodded|nodding)\b/i, "nod"],
  [/\bshak(?:es|ing|e|en|ook) (?:her|his|their|its|my) head\b|\bshook (?:her|his|their|its|my) head\b/i, "shake"],
  [/\b(?:trembl(?:es|ed|ing|e)|shiver(?:s|ed|ing)?|quiver(?:s|ed|ing)?)\b/i, "tremble"],
  [/\b(?:steps?|stepped|stepping|backs?|backed|backing|stumbles?|stumbled) (?:back|backward|backwards|away)\b|\b(?:recoils?|recoiled|flinch(?:es|ed|ing)?)\b/i, "step_back"],
  [/\bleans? (?:in|closer|forward|towards?)\b|\bleaned (?:in|closer|forward|towards?)\b|\bleaning (?:in|closer|forward|towards?)\b/i, "lean_in"],
  [/\b(?:turns?|turned|turning) away\b/i, "turn_away"],
  [/\b(?:slumps?|slumped|slumping|sags?|sagged|collapses?|collapsed|sinks? (?:down|to|into|onto)|sank (?:down|to|into|onto))\b/i, "sink"],
  [/\b(?:hops?|hopped|hopping)\b|\bjump(?:s|ed|ing)? (?:up and down|for joy)\b/i, "hop"],
  [/\bbounc(?:es|ed|ing) on (?:her|his|their|its|my) (?:toes|heels|feet)\b/i, "bounce"],
];

/** Explicit manga-mark cues. */
const EMOTE_PATTERNS: ReadonlyArray<readonly [RegExp, SpriteEmote]> = [
  [/\b(?:sweat(?:s|ing|drops?)?|sweated)\b/i, "sweat"],
  [/\b(?:blush(?:es|ed|ing)?|flush(?:es|ed|ing)|turns? (?:bright )?red|went red|cheeks (?:redden|reddened|burn|burned|turn pink))\b/i, "blush"],
  [/\b(?:hums?|hummed|humming|whistles?|whistled|whistling|sings?|sang|singing)\b/i, "music"],
  [/\b(?:gasps?|gasped|gasping|startled|jolts?|jolted)\b/i, "exclaim"],
  [/\btilts? (?:her|his|their|its|my) head\b|\btilted (?:her|his|their|its|my) head\b|\bpuzzled\b/i, "question"],
  [/\b(?:fum(?:es|ed|ing)|seeth(?:es|ed|ing)|scowls?|scowled|scowling)\b/i, "anger"],
];

const SOFT_WORDS = /\b(?:slightly|a little|faintly|softly|barely|gently|a bit|small|subtle|subtly)\b/i;
const STRONG_WORDS = /\b(?:violently|wildly|furiously|hard|frantically|uncontrollably|desperately|vigorously)\b/i;

type ActorNames = ReadonlyArray<{ key: string; patterns: RegExp[] }>;

type Chunk = { text: string; subject: string | null };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namePatterns(name: string): RegExp[] {
  const full = normalizeCharacterName(name);
  if (!full) return [];
  const variants = new Set([full]);
  const first = full.split(" ")[0] ?? "";
  if (first.length >= 3 && first !== full) variants.add(first);
  return [...variants].map((variant) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(variant)}(?![\\p{L}\\p{N}])`, "iu"));
}

function mentions(text: string, actors: ActorNames): Array<{ key: string; index: number }> {
  const found: Array<{ key: string; index: number }> = [];
  for (const actor of actors) {
    let best = -1;
    for (const pattern of actor.patterns) {
      const match = pattern.exec(text);
      if (match && (best < 0 || match.index < best)) best = match.index;
    }
    if (best >= 0) found.push({ key: actor.key, index: best });
  }
  return found.sort((left, right) => left.index - right.index);
}

/**
 * Split narration (quoted speech removed) into clauses and give each clause
 * the character it is about: the first named character in the clause, else
 * the last character named before it in the paragraph, else `fallback`.
 */
const NOT_A_NAME: ReadonlySet<string> = new Set([
  "she", "he", "they", "it", "i", "you", "we", "her", "his", "their", "its", "my", "your", "our", "the", "a", "an",
  "this", "that", "these", "those", "there", "here", "then", "now", "but", "and", "or", "so", "yet", "still", "even",
  "everyone", "someone", "something", "nothing", "nobody", "somebody", "anyone", "everything", "one", "both", "each",
  "neither", "either", "all", "no", "yes", "oh", "ah", "well", "okay", "ok", "hey", "what", "who", "why", "how", "when",
  "where", "if", "once", "outside", "inside", "later", "soon", "again", "meanwhile", "finally", "instead", "perhaps", "maybe",
]);
// "Kai laughs", "Ren smiled": a capitalized word that is not a known actor,
// followed by a third-person verb, is another (unknown) person.
const UNKNOWN_SUBJECT = /^\*?([A-Z][\p{L}'’-]+)\s+(?:[a-z]+(?:s|ed))\b/u;

function unknownSubject(clause: string): boolean {
  const match = UNKNOWN_SUBJECT.exec(clause);
  if (!match) return false;
  const word = match[1]!.replace(/['’]s$/i, "").toLowerCase();
  return !NOT_A_NAME.has(word) && !word.endsWith("ly");
}

/**
 * Split narration (quoted speech removed) into clauses and give each clause
 * the character it is about: the first named character in the clause, else
 * the last character named before it in the paragraph, else `fallback`. A
 * clause led by an unknown name belongs to nobody.
 */
function attributedClauses(text: string, actors: ActorNames, fallback: string | null): Chunk[] {
  const narration = text.replace(QUOTED, " . ");
  const chunks: Chunk[] = [];
  let last: string | null = null;
  let lastUnknown = false;
  for (const sentence of narration.split(/(?<=[.!?…])\s+|\n+/)) {
    for (const clause of sentence.split(/[,;:—–]|\s-\s|\b(?:and|as|while|who|but|then|before|after|when|whereas)\b/i)) {
      const trimmed = clause.trim();
      if (!trimmed) continue;
      const named = mentions(trimmed, actors);
      let subject: string | null;
      if (unknownSubject(trimmed) && !(named.length && named[0]!.index <= 1)) {
        subject = null;
        lastUnknown = true;
      } else subject = named[0]?.key ?? (lastUnknown ? null : last ?? fallback);
      if (named.length) {
        last = named[named.length - 1]!.key;
        lastUnknown = false;
      }
      chunks.push({ text: trimmed, subject });
    }
  }
  return chunks;
}

function firstPattern<T extends string>(chunk: string, patterns: ReadonlyArray<readonly [RegExp, T]>): T | null {
  let best: { index: number; value: T } | null = null;
  for (const [pattern, value] of patterns) {
    const match = pattern.exec(chunk);
    if (!match || isNegated(chunk, match.index)) continue;
    if (!best || match.index < best.index) best = { index: match.index, value };
  }
  return best?.value ?? null;
}

type TextCues = {
  expressions: Map<string, string>;
  motions: Map<string, SpriteMotion>;
  emotes: Map<string, SpriteEmote>;
  intensities: Map<string, number>;
  mentioned: Set<string>;
  /** Expressions found in clauses about an unknown person. */
  unknownExpressions: Set<string>;
};

/** Expression, motion and emote cues per character from explicit words. */
export function textCues(text: string, actors: ActorNames, fallback: string | null): TextCues {
  const cues: TextCues = { expressions: new Map(), motions: new Map(), emotes: new Map(), intensities: new Map(), mentioned: new Set(), unknownExpressions: new Set() };
  for (const { key } of mentions(text, actors)) cues.mentioned.add(key);
  for (const chunk of attributedClauses(text, actors, fallback)) {
    if (!chunk.subject) {
      const expression = spriteExpressionId(selectPoseExpression(POSE_EXPRESSION_CATALOGUE, 0, chunk.text, null).id);
      if (expression && !NEUTRAL_EXPRESSIONS.has(expression)) cues.unknownExpressions.add(expression);
      continue;
    }
    const key = chunk.subject;
    if (!cues.expressions.has(key)) {
      const pose = selectPoseExpression(POSE_EXPRESSION_CATALOGUE, 0, chunk.text, null);
      const expression = spriteExpressionId(pose.id);
      if (expression && !NEUTRAL_EXPRESSIONS.has(expression)) cues.expressions.set(key, expression);
    }
    if (!cues.motions.has(key)) {
      const motion = firstPattern(chunk.text, MOTION_PATTERNS);
      if (motion) {
        cues.motions.set(key, motion);
        cues.intensities.set(key, STRONG_WORDS.test(chunk.text) ? 5 : SOFT_WORDS.test(chunk.text) ? 2 : 3);
      }
    }
    if (!cues.emotes.has(key)) {
      const emote = firstPattern(chunk.text, EMOTE_PATTERNS);
      if (emote) cues.emotes.set(key, emote);
    }
  }
  // A line that is only an ellipsis is a speechless beat.
  if (fallback && /^[\s"“”'「」『』*_~(]*(?:\.{3,}|…+)[\s"“”'「」『』*_~)!?.]*$/.test(text) && !cues.emotes.has(fallback)) {
    cues.emotes.set(fallback, "ellipsis");
  }
  return cues;
}

/* ------------------------------------------------------------------------ */
/* Cast                                                                      */
/* ------------------------------------------------------------------------ */

const NON_CHARACTER_NAMES: ReadonlySet<string> = new Set([
  "", "narrator", "narration", "unknown", "system", "none", "null", "nobody", "everyone", "all", "crowd",
]);
const PERSONA_NAMES: ReadonlySet<string> = new Set(["user", "{{user}}", "you", "player", "me", "persona"]);

type MemberDraft = SpriteCastMember & { known: boolean };

class CastPool {
  readonly members = new Map<string, MemberDraft>();
  private readonly byName = new Map<string, string>();
  private readonly persona: string;

  constructor(personaName: string | undefined, private readonly appearance: Readonly<Record<string, string>>) {
    this.persona = characterAppearanceKey(personaName ?? "");
  }

  excluded(name: string | null | undefined): boolean {
    const key = characterAppearanceKey(name ?? "");
    return NON_CHARACTER_NAMES.has(key) || PERSONA_NAMES.has(key) || (Boolean(this.persona) && key === this.persona);
  }

  /** The cast key for a name/id, creating a member on first sight. */
  resolve(name: string | null | undefined, characterId?: string | null): string | null {
    const display = normalizeCharacterName(name ?? "");
    if (display ? this.excluded(display) : !characterId) return null;
    const nameKey = characterAppearanceKey(display);
    const id = (characterId ?? "").trim();
    if (id && this.members.has(id)) {
      if (nameKey && !this.byName.has(nameKey)) this.byName.set(nameKey, id);
      return id;
    }
    const existing = nameKey ? this.byName.get(nameKey) : undefined;
    if (existing) {
      const member = this.members.get(existing)!;
      if (id && !member.characterId) member.characterId = id;
      return existing;
    }
    if (!display) return null;
    const key = (id || characterIdFor(display)).slice(0, 200);
    if (!key) return null;
    if (!this.members.has(key)) {
      this.members.set(key, { characterKey: key, name: display.slice(0, 200), ...(id ? { characterId: id } : {}), identity: "", attire: null, known: false });
    }
    if (nameKey) this.byName.set(nameKey, key);
    return key;
  }

  /** First evidence in the turn wins; previous-turn values only fill gaps. */
  describe(key: string | null, details: { identity?: string | null | undefined; attire?: string | null | undefined; subjectCategory?: SpriteCastMember["subjectCategory"] | undefined; known?: boolean }): void {
    if (!key) return;
    const member = this.members.get(key);
    if (!member) return;
    const identity = (details.identity ?? "").trim();
    const isTurnEvidence = details.known !== false;
    if (identity && (!member.identity || (isTurnEvidence && !member.known))) member.identity = identity.slice(0, 4000);
    if (details.attire !== undefined && details.attire !== null && details.attire.trim() && (member.attire === null || (isTurnEvidence && !member.known))) {
      member.attire = details.attire.trim().slice(0, 2000);
    }
    if (details.subjectCategory && !member.subjectCategory) member.subjectCategory = details.subjectCategory;
    if (isTurnEvidence && (identity || details.attire)) member.known = true;
  }

  addPrevious(member: SpriteCastMember): void {
    if (this.members.has(member.characterKey) || this.excluded(member.name)) return;
    this.members.set(member.characterKey, { ...member, known: false });
    const nameKey = characterAppearanceKey(member.name);
    if (nameKey && !this.byName.has(nameKey)) this.byName.set(nameKey, member.characterKey);
    if (member.characterId) this.byName.set(`#id:${member.characterId}`, member.characterKey);
  }

  /** Resolve a characterId that a previous-turn member carried under another key. */
  keyForId(id: string | null | undefined): string | undefined {
    return id ? this.byName.get(`#id:${id.trim()}`) : undefined;
  }

  fillFromAppearance(): void {
    for (const member of this.members.values()) {
      if (member.identity) continue;
      const target = characterAppearanceKey(member.name);
      const match = Object.entries(this.appearance).find(([name]) => characterAppearanceKey(name) === target);
      if (match && typeof match[1] === "string") member.identity = match[1].trim().slice(0, 4000);
    }
  }

  toCastMember(key: string): SpriteCastMember | null {
    const member = this.members.get(key);
    if (!member) return null;
    const { known: _known, ...rest } = member;
    return rest;
  }
}

/* ------------------------------------------------------------------------ */
/* Context: everything the engine and the classifier need                    */
/* ------------------------------------------------------------------------ */

export type SpriteSceneContext = {
  index: number;
  startParagraph: number;
  endParagraph: number;
  scene: SceneState;
  light: SpriteLight;
  plate: SpritePlateRef;
  /** The plate key is already in the user's library. */
  plateKnown: boolean;
  /** The subject the planner put on screen for this scene (cast key). */
  subject: string | null;
  /** Scene cast members (cast keys, planner order). */
  sceneCast: string[];
};

type ExpressionSignal = { id: string; source: "cue" | "text" };

type ParagraphSignals = {
  sceneIndex: number;
  speaker: string | null;
  /** "" narrator paragraph, null unknown, else display name. */
  speakerLabel: string | null;
  enter: string[];
  leave: Set<string>;
  expressions: Map<string, ExpressionSignal>;
  motions: Map<string, SpriteMotion>;
  emotes: Map<string, SpriteEmote>;
  intensities: Map<string, number>;
  mentioned: Set<string>;
};

export type SpriteStagingContext = {
  input: SpriteStagingInput;
  pool: CastPool;
  scenes: SpriteSceneContext[];
  signals: ParagraphSignals[];
  /** Previous actors carried into the first scene (slot order). */
  carried: SpriteActorStage[];
};

function sceneIndexAt(scenes: readonly { startParagraph: number }[], paragraphIndex: number): number {
  let active = 0;
  for (const [index, scene] of scenes.entries()) {
    if (scene.startParagraph > paragraphIndex) break;
    active = index;
  }
  return active;
}

function plateFor(environment: SceneEnvironment, styleKey: string): SpritePlateRef {
  return {
    plateKey: plateKeyFor(environment, styleKey),
    location: (environment.location ?? "").slice(0, 1000),
    timeOfDay: environment.timeOfDay ? environment.timeOfDay.slice(0, 200) : null,
    weather: environment.weather ? environment.weather.slice(0, 200) : null,
    description: (environment.description ?? "").slice(0, 4000),
  };
}

const SLOT_ORDER: Readonly<Record<SpriteSlot, number>> = { left: 0, center: 1, right: 2 };

/** Build the deterministic context. Throws only on a malformed plan. */
export function spriteStagingContext(input: SpriteStagingInput): SpriteStagingContext {
  const plan = input.plan;
  const paragraphs = plan.paragraphs ?? [];
  const pool = new CastPool(input.personaName, input.characterAppearance ?? {});
  for (const member of input.previousCast ?? []) pool.addPrevious(member);
  const resolve = (name: string | null | undefined, id?: string | null) => pool.resolve(name, pool.keyForId(id) ?? id ?? null);

  const rawScenes = [...(plan.scenes ?? [])].sort((left, right) => left.startParagraph - right.startParagraph);
  const knownKeys = new Set((input.knownPlates ?? []).map((plate) => plate.plateKey));
  const scenes: SpriteSceneContext[] = rawScenes.map((scene, index) => {
    const subject = scene.character ? resolve(scene.character, scene.characterId) : null;
    pool.describe(subject, { identity: scene.identityPrompt, attire: scene.attire ?? null, subjectCategory: scene.subjectCategory });
    const sceneCast = (scene.cast ?? []).map((name) => resolve(name)).filter((key): key is string => Boolean(key));
    const plate = plateFor(scene.environment, input.styleKey);
    return {
      index,
      startParagraph: index === 0 ? 0 : scene.startParagraph,
      endParagraph: (rawScenes[index + 1]?.startParagraph ?? paragraphs.length) - 1,
      scene,
      light: lightForEnvironment(scene.environment),
      plate,
      plateKnown: knownKeys.has(plate.plateKey),
      subject,
      sceneCast,
    };
  });

  // Cues: one per paragraph at most (first wins), visual cues before cache cues.
  const cueAt = new Map<number, { key: string; cue: VisualCue }>();
  for (const cue of [...(plan.visualCues ?? []), ...(plan.cacheCues ?? [])]) {
    if (cueAt.has(cue.paragraphIndex)) continue;
    const key = cue.character ? resolve(cue.character, cue.characterId) : null;
    if (!key) continue;
    pool.describe(key, { identity: cue.resolvedIdentity, attire: cue.resolvedAttire ?? cue.attire ?? null, subjectCategory: cue.subjectCategory });
    cueAt.set(cue.paragraphIndex, { key, cue });
  }
  const terminal = plan.terminalVisualState;
  if (terminal?.character) {
    pool.describe(resolve(terminal.character, terminal.characterId), { identity: terminal.identity, attire: terminal.attire, subjectCategory: terminal.subjectCategory });
  }
  const speakers = plan.paragraphSpeakers ?? [];
  const speakerKeys = paragraphs.map((_, index) => {
    const label = speakers[index];
    return typeof label === "string" && label.trim() ? resolve(label) : null;
  });
  // Previous-turn identity/attire fill gaps; the chat appearance map fills the rest.
  for (const member of input.previousCast ?? []) {
    pool.describe(member.characterKey, { identity: member.identity, attire: member.attire, subjectCategory: member.subjectCategory, known: false });
  }
  pool.fillFromAppearance();

  // Continuity: characters marked absent leave the stage at that paragraph.
  const leavesAt = new Map<number, Set<string>>();
  for (const item of plan.continuityDeltas ?? []) {
    for (const [name, patch] of Object.entries(item.delta?.characterUpdates ?? {})) {
      if (patch?.present !== false) continue;
      const key = pool.excluded(name) ? null : resolve(name);
      if (!key) continue;
      if (!leavesAt.has(item.paragraphIndex)) leavesAt.set(item.paragraphIndex, new Set());
      leavesAt.get(item.paragraphIndex)!.add(key);
    }
    for (const name of item.delta?.forgetCharacters ?? []) {
      const key = pool.excluded(name) ? null : resolve(name);
      if (!key) continue;
      if (!leavesAt.has(item.paragraphIndex)) leavesAt.set(item.paragraphIndex, new Set());
      leavesAt.get(item.paragraphIndex)!.add(key);
    }
  }

  const actorNames: ActorNames = [...pool.members.values()].map((member) => ({ key: member.characterKey, patterns: namePatterns(member.name) }));

  const signals: ParagraphSignals[] = paragraphs.map((paragraph, index) => {
    const sceneIndex = sceneIndexAt(scenes, index);
    const scene = scenes[sceneIndex];
    const speaker = speakerKeys[index] ?? null;
    const label = speakers[index];
    const cue = cueAt.get(index);
    const enter: string[] = [];
    if (scene && scene.startParagraph === index && scene.subject) enter.push(scene.subject);
    if (cue && !enter.includes(cue.key)) enter.push(cue.key);
    if (speaker && !enter.includes(speaker)) enter.push(speaker);
    const focusGuess = speaker ?? cue?.key ?? null;
    const text = paragraph.text ?? "";
    const cues = textCues(text, actorNames, focusGuess);
    const expressions = new Map<string, ExpressionSignal>();
    for (const [key, id] of cues.expressions) expressions.set(key, { id, source: "text" });
    if (cue) {
      const id = spriteExpressionId(cue.cue.poseExpressionId ?? cue.cue.expression ?? null);
      // A single-character cue may carry an emotion the text gives to someone
      // else ("Kai laughs" on Mira's cue): the text attribution wins then.
      const elsewhere = id !== null && !cues.expressions.has(cue.key)
        && ([...cues.expressions].some(([key, value]) => key !== cue.key && value === id) || cues.unknownExpressions.has(id));
      if (id && !NEUTRAL_EXPRESSIONS.has(id) && !elsewhere) expressions.set(cue.key, { id, source: "cue" });
    }
    return {
      sceneIndex,
      speaker,
      speakerLabel: typeof label === "string" ? label.trim() : null,
      enter,
      leave: leavesAt.get(index) ?? new Set(),
      expressions,
      motions: cues.motions,
      emotes: cues.emotes,
      intensities: cues.intensities,
      mentioned: cues.mentioned,
    };
  });

  // Carry the previous stage over when the first scene continues it.
  let carried: SpriteActorStage[] = [];
  const previous = input.previousStage;
  const first = scenes[0];
  if (previous && first && previous.actors?.length) {
    const continues = input.previousSceneId
      ? input.previousSceneId === first.scene.sceneId
      : Boolean(previous.plateKey) && previous.plateKey === first.plate.plateKey;
    if (continues) {
      carried = [...previous.actors]
        .filter((actor) => pool.members.has(actor.characterKey))
        .sort((left, right) => SLOT_ORDER[left.slot] - SLOT_ORDER[right.slot])
        .slice(0, MAX_SPRITE_ACTORS);
    }
  }
  return { input, pool, scenes, signals, carried };
}

/* ------------------------------------------------------------------------ */
/* Engine                                                                    */
/* ------------------------------------------------------------------------ */

const LAYOUTS: Readonly<Record<number, readonly SpriteSlot[]>> = {
  1: ["center"],
  2: ["left", "right"],
  3: ["left", "center", "right"],
};

function emptyOverrides(): SpriteStagingOverrides {
  return { paragraphs: new Map(), sceneLight: new Map(), scenePlate: new Map() };
}

/** Walk the paragraphs and apply deterministic signals plus confident overrides. */
export function stageParagraphs(
  context: SpriteStagingContext,
  overrides: SpriteStagingOverrides | null,
  source: SpriteStaging["source"],
): SpriteStaging {
  const extra = overrides ?? emptyOverrides();
  const { pool, scenes, signals } = context;
  const used = new Set<string>();
  const plates: SpritePlateRef[] = [];
  const scenePlateKey = new Map<number, string | null>();
  for (const scene of scenes) {
    const plate = extra.scenePlate.get(scene.index) ?? scene.plate;
    let existing = plates.find((candidate) => candidate.plateKey === plate.plateKey);
    if (!existing && plates.length < 16) {
      plates.push(plate);
      existing = plate;
    }
    scenePlateKey.set(scene.index, existing ? existing.plateKey : null);
  }

  let order: string[] = context.carried.map((actor) => actor.characterKey);
  const expression = new Map<string, string>(context.carried.map((actor) => [actor.characterKey, spriteExpressionId(actor.expression) ?? "idle"]));
  const lastActive = new Map<string, number>(order.map((key) => [key, -1]));
  let previousFocus: string | null = context.carried.find((actor) => actor.focus)?.characterKey ?? null;

  const paragraphs: SpriteParagraphStage[] = signals.map((signal, index) => {
    const scene = scenes[signal.sceneIndex];
    const decided = extra.paragraphs.get(index);
    if (scene && scene.startParagraph === index && index > 0) {
      order = [];
      expression.clear();
      previousFocus = null;
    }
    const speaker = signal.speaker;
    const remove = (key: string) => {
      if (key === speaker) return;
      order = order.filter((candidate) => candidate !== key);
    };
    for (const key of signal.leave) remove(key);
    for (const [key, present] of decided?.presence ?? []) if (!present) remove(key);
    const entrants: string[] = [];
    const add = (key: string) => {
      if (!pool.members.has(key) || order.includes(key)) return;
      if (decided?.presence.get(key) === false && key !== speaker) return;
      order.push(key);
      entrants.push(key);
    };
    for (const key of signal.enter) add(key);
    for (const [key, present] of decided?.presence ?? []) if (present) add(key);
    for (const key of [...signal.enter, ...entrants]) lastActive.set(key, index);
    if (speaker) lastActive.set(speaker, index);
    // Too many people: the least recently active non-speaker steps off.
    while (order.length > MAX_SPRITE_ACTORS) {
      const protectedKeys = new Set([speaker, ...signal.enter.slice(0, MAX_SPRITE_ACTORS)].filter(Boolean));
      const candidates = order.filter((key) => !protectedKeys.has(key));
      const pickFrom = candidates.length ? candidates : order.filter((key) => key !== speaker);
      const victim = pickFrom.reduce((oldest, key) => ((lastActive.get(key) ?? -1) < (lastActive.get(oldest) ?? -1) ? key : oldest), pickFrom[0]!);
      order = order.filter((key) => key !== victim);
    }

    // Focus: the speaker; in narration the one actor the paragraph is about.
    let focus: string | null = null;
    if (speaker && order.includes(speaker)) focus = speaker;
    else if (!signal.speakerLabel) {
      // Narration or an unattributed line. A persona line focuses nobody.
      const mentionedOnStage = order.filter((key) => signal.mentioned.has(key));
      if (mentionedOnStage.length === 1) focus = mentionedOnStage[0]!;
      else if (mentionedOnStage.length === 0 && order.length === 1) focus = order[0]!;
      else if (mentionedOnStage.length === 0 && previousFocus && order.includes(previousFocus) && signal.speakerLabel === null) focus = previousFocus;
    }
    previousFocus = focus;

    const layout = LAYOUTS[order.length] ?? [];
    const actors: SpriteActorStage[] = order.map((key, position) => {
      const det = signal.expressions.get(key);
      const answer = decided?.expression.get(key);
      const current = expression.get(key) ?? "idle";
      let next = current;
      if (answer && answer !== "keep") next = answer;
      else if (answer === "keep" && det?.source !== "cue") next = current;
      else if (det) next = det.id;
      else if (key === focus && TRANSIENT_EXPRESSIONS.has(current)) next = "idle";
      expression.set(key, next);
      const motion = decided?.motion.get(key) ?? signal.motions.get(key) ?? "none";
      const emote = decided?.emote.get(key) ?? signal.emotes.get(key) ?? "none";
      const intensity = decided?.intensity.get(key) ?? signal.intensities.get(key) ?? 3;
      used.add(key);
      return {
        characterKey: key,
        expression: next,
        slot: layout[position] ?? SPRITE_SLOTS[1],
        facing: "viewer",
        focus: key === focus,
        motion,
        emote,
        intensity: Math.max(1, Math.min(5, Math.round(intensity))),
      };
    });
    const light = (scene && extra.sceneLight.get(scene.index)) ?? scene?.light ?? "neutral";
    return { actors, plateKey: scene ? scenePlateKey.get(scene.index) ?? null : null, light };
  });
  // Key moments (config keyIllustrations): a few paragraphs become full illustrations.
  const staged = applyKeyMoments(paragraphs, context.input.plan, keyIllustrationCap(context.input.config), extra.keyMoments ?? null);

  const cast: SpriteCastMember[] = [];
  for (const key of pool.members.keys()) {
    if (!used.has(key)) continue;
    const member = pool.toCastMember(key);
    if (member) cast.push(member);
  }
  return enforceSpriteStagingInvariants({ version: 1, source, cast, plates, paragraphs: staged });
}

/**
 * Repair a staging so it satisfies every invariant: at most 16 cast members
 * and plates, at most MAX_SPRITE_ACTORS actors per paragraph, unique keys and
 * slots, at most one focused actor, actor keys in the cast, plate keys in the
 * plates (or null), catalogue expressions, slot layout by actor count.
 */
export function enforceSpriteStagingInvariants(staging: SpriteStaging): SpriteStaging {
  const cast = staging.cast.slice(0, 16);
  const castKeys = new Set(cast.map((member) => member.characterKey));
  const plates = staging.plates.slice(0, 16);
  const plateKeys = new Set(plates.map((plate) => plate.plateKey));
  const paragraphs = staging.paragraphs.map((paragraph) => {
    const seen = new Set<string>();
    const kept = paragraph.actors.filter((actor) => {
      if (!castKeys.has(actor.characterKey) || seen.has(actor.characterKey)) return false;
      seen.add(actor.characterKey);
      return true;
    }).slice(0, MAX_SPRITE_ACTORS);
    const ordered = [...kept].sort((left, right) => SLOT_ORDER[left.slot] - SLOT_ORDER[right.slot]);
    const layout = LAYOUTS[ordered.length] ?? [];
    let focused = false;
    const actors = ordered.map((actor, position) => {
      const focus = actor.focus && !focused;
      if (focus) focused = true;
      return {
        ...actor,
        expression: spriteExpressionId(actor.expression) ?? SPRITE_EXPRESSION_FALLBACK[actor.expression] ?? "idle",
        slot: layout[position] ?? actor.slot,
        focus,
      };
    });
    return { ...paragraph, actors, plateKey: paragraph.plateKey && plateKeys.has(paragraph.plateKey) ? paragraph.plateKey : null };
  });
  return { ...staging, cast, plates, paragraphs };
}

function minimalStaging(input: SpriteStagingInput): SpriteStaging {
  return {
    version: 1,
    source: "planner",
    cast: [],
    plates: [],
    paragraphs: (input.plan?.paragraphs ?? []).map(() => ({ actors: [], plateKey: null, light: "neutral" as const })),
  };
}

function finalize(staging: SpriteStaging, input: SpriteStagingInput): SpriteStaging {
  const parsed = SpriteStagingSchema.safeParse(staging);
  return parsed.success ? parsed.data : minimalStaging(input);
}

/** Pure, synchronous staging from the plan alone. Always succeeds. */
export function deterministicSpriteStaging(input: SpriteStagingInput): SpriteStaging {
  try {
    return finalize(stageParagraphs(spriteStagingContext(input), null, "planner"), input);
  } catch {
    return minimalStaging(input);
  }
}

/* ------------------------------------------------------------------------ */
/* Classifier                                                                */
/* ------------------------------------------------------------------------ */

/** Candidates asked about per paragraph (the present question decides who stays). */
export const MAX_SPRITE_CANDIDATES = MAX_SPRITE_ACTORS + 1;

/** Plain data for system-one-sprites.ts, built from the deterministic pass. */
export function spriteClassifierInput(context: SpriteStagingContext, deterministic: SpriteStaging): Omit<SpriteClassifierInput, "config"> {
  const { pool, scenes, signals, input } = context;
  const nameOf = (key: string) => pool.members.get(key)?.name ?? key;
  const paragraphs = (input.plan.paragraphs ?? []).map((paragraph, index) => {
    const signal = signals[index]!;
    const stage = deterministic.paragraphs[index];
    const previousStage = index > 0 ? deterministic.paragraphs[index - 1] : null;
    const scene = scenes[signal.sceneIndex];
    const ranked: string[] = [];
    const push = (key: string | null | undefined) => {
      if (key && pool.members.has(key) && !ranked.includes(key)) ranked.push(key);
    };
    push(signal.speaker);
    for (const actor of stage?.actors ?? []) push(actor.characterKey);
    for (const actor of previousStage?.actors ?? []) push(actor.characterKey);
    for (const key of signal.mentioned) push(key);
    for (const key of scene?.sceneCast ?? []) if (signal.mentioned.has(key)) push(key);
    const onStage = new Set((stage?.actors ?? []).map((actor) => actor.characterKey));
    return {
      index,
      text: paragraph.text ?? "",
      speaker: signal.speakerLabel === "" ? "Narrator" : signal.speaker ? nameOf(signal.speaker) : signal.speakerLabel,
      sceneIndex: signal.sceneIndex,
      candidates: ranked.slice(0, MAX_SPRITE_CANDIDATES).map((key) => ({
        key,
        name: nameOf(key),
        onStage: onStage.has(key),
        speaking: key === signal.speaker,
      })),
    };
  });
  // Key moments: only paragraphs whose cue could be painted are asked about.
  const keyMomentParagraphs = keyIllustrationCap(input.config) > 0 ? [...keyMomentCues(input.plan).keys()].sort((a, b) => a - b) : [];
  return {
    paragraphs,
    ...(keyMomentParagraphs.length ? { keyMomentParagraphs } : {}),
    scenes: scenes.map((scene) => ({
      index: scene.index,
      startParagraph: scene.startParagraph,
      location: scene.scene.environment.location,
      timeOfDay: scene.scene.environment.timeOfDay ?? null,
      weather: scene.scene.environment.weather ?? null,
      lighting: scene.scene.environment.lighting ?? null,
      description: scene.scene.environment.description ?? "",
      light: scene.light,
      plateKey: scene.plate.plateKey,
      plateKnown: scene.plateKnown,
    })),
    knownPlates: [...(input.knownPlates ?? [])],
    previousPlateKey: input.previousStage?.plateKey ?? null,
    cast: [...pool.members.values()].map((member) => ({ key: member.characterKey, name: member.name, attire: member.attire })),
  };
}

/**
 * Classifier staging when System One is configured (mode not "off" and a key
 * is saved), else deterministic. Never throws: any classifier failure falls
 * back to deterministicSpriteStaging (a failed request only loses its own
 * paragraphs; they keep their deterministic staging).
 */
export async function buildSpriteStaging(
  spindle: SpindleAPI,
  input: SpriteStagingInput & { userId?: string; signal?: AbortSignal; classifierTimeoutMs?: number },
): Promise<SpriteStaging> {
  let context: SpriteStagingContext;
  let deterministic: SpriteStaging;
  try {
    context = spriteStagingContext(input);
    deterministic = finalize(stageParagraphs(context, null, "planner"), input);
  } catch {
    return deterministicSpriteStaging(input);
  }
  if (input.config?.systemOneMode === "off" || !input.config) return deterministic;
  try {
    const result = await classifySpriteStaging(spindle, {
      ...spriteClassifierInput(context, deterministic),
      config: input.config,
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    }, input.classifierTimeoutMs !== undefined ? { timeoutMs: input.classifierTimeoutMs } : {});
    if (!result || input.signal?.aborted) return deterministic;
    const staged = SpriteStagingSchema.safeParse(stageParagraphs(context, result.overrides, "classifier"));
    return staged.success ? staged.data : deterministic;
  } catch (error) {
    try {
      spindle.log?.warn?.(`[VN] Sprite staging classifier failed; using deterministic staging: ${error instanceof Error ? error.message : String(error)}`);
    } catch {
      // logging must never break staging
    }
    return deterministic;
  }
}
