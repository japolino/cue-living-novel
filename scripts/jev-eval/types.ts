/**
 * Labeled evaluation set for the sprite-mode System One classifier (Jev).
 * See scripts/jev-eval/README.md. Labels are human judgement only.
 *
 * Semantics (read before labelling):
 * - A reply is what Cue receives: one assistant roleplay message, split into
 *   paragraphs, with the planner's metadata (speaker per paragraph, scenes,
 *   a few visual cues). The harness turns it into a real TurnPlan
 *   (makePlan fixture) and runs the real staging + request builder.
 * - `present`: the cast members that are physically present AND in view
 *   during the paragraph (in person; not on the phone, remembered, imagined,
 *   only talked about, or gone). The user persona is never a cast member.
 * - `chars[name]`: labels for a present character. If a present character
 *   has no entry, the labels carry over from that character's previous
 *   paragraph in the same scene (same expression/intensity, motion none,
 *   emote none). The first paragraph a character is present in a scene
 *   MUST have an entry.
 * - Expression ids come from EXPRESSIONS below (what the sprite should show
 *   during this paragraph, absolute, not "keep"). `eo` = other acceptable ids.
 * - Motion / emote: "none" unless the text clearly shows it for that
 *   character in this paragraph. `mo` / `emo` = other acceptable values
 *   ("none" is acceptable when the cue is weak: put it in mo/emo).
 * - Intensity 1..5: 1 barely visible, 2 mild, 3 moderate/ordinary, 4 strong,
 *   5 extreme. Harness tolerance is +-1 unless `io` lists the accepted set.
 * - `km` (key moment), default { level: 0, standing: true, interaction: "none" }:
 *   level 0 ordinary talk, 1 minor action/reaction, 2 notable event, 3 major
 *   dramatic/emotional/physical turning point, 4 the one defining picture of
 *   the reply (at most one per reply). `standing`: can ONE standing cut-out
 *   sprite (facing the viewer, with an expression) over an empty background
 *   show this paragraph well? false when it needs a body pose (sitting,
 *   lying, kneeling, running, falling), contact (kiss, hug, fight), an action
 *   with an object, or a view of the scene itself. `interaction`: the pose or
 *   contact a single picture of the paragraph would show (narration, now;
 *   not speech, wishes or negations).
 * - Scenes: `light` = best sprite light preset, `lightOk` other acceptable;
 *   `plate` = id of a known plate (PLATES in dataset/plates.ts) that is the
 *   SAME place at the same time of day and weather (so the same empty
 *   background fits), else null.
 */

export const EXPRESSIONS = [
  // hot set (pre-generated)
  "idle", "smile", "laughing", "sad", "crying_with_eyes_open", "angry", "surprised", "embarrassed", "worried", "thinking", "smug", "scared",
  // rare (generated on demand)
  "annoyed", "enraged", "pouting", "disgusted", "jealous", "suspicious", "serious", "determined", "proud", "smirk", "playful_winking",
  "evil_smiling", "excited", "joyful", "happy_smiling", "giggling", "relieved", "admiring", "lovestruck", "happy_tears",
  "crying_with_eyes_closed", "teary_pouting", "depressed", "melancholic", "disappointed", "guilty", "tormented", "shocked",
  "scared_screaming", "nervous", "pleading", "forced_smiling", "confused", "curious", "blushing_shyly", "looking_away_shyly",
  "flustered", "full_face_blush", "bored", "indifferent", "exhausted", "sleepy",
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export const MOTIONS = ["none", "nod", "shake", "hop", "bounce", "tremble", "step_back", "lean_in", "turn_away", "sink"] as const;
export type Motion = (typeof MOTIONS)[number];
export const EMOTES = ["none", "sweat", "anger", "heart", "sparkle", "exclaim", "question", "ellipsis", "music", "gloom", "blush"] as const;
export type Emote = (typeof EMOTES)[number];
export const LIGHTS = ["neutral", "day", "sunset", "night", "indoor_warm", "indoor_cool", "candle", "dark"] as const;
export type Light = (typeof LIGHTS)[number];
export const INTERACTIONS = [
  "none", "kiss", "hug", "crying_on_shoulder", "carrying", "holding_hands", "dancing", "fighting", "lying", "kneeling",
  "sitting_together", "sitting", "running", "walking_together", "looking_at_each_other",
] as const;
export type Interaction = (typeof INTERACTIONS)[number];

export type CharLabel = {
  /** Best expression. */
  e: Expression;
  /** Other acceptable expressions. */
  eo?: Expression[];
  /** Motion (default "none"). */
  m?: Motion;
  mo?: Motion[];
  /** Emote (default "none"). */
  em?: Emote;
  emo?: Emote[];
  /** Intensity 1..5 (default 3). */
  i?: 1 | 2 | 3 | 4 | 5;
  /** Accepted intensities (default i-1..i+1). */
  io?: number[];
};

export type KeyMomentLabel = {
  level: 0 | 1 | 2 | 3 | 4;
  /** Accepted levels (default level-1..level+1, but a 3/4 vs 0-2 split is never tolerated). */
  levelOk?: number[];
  standing: boolean;
  interaction: Interaction;
  interactionOk?: Interaction[];
};

export type EvalParagraph = {
  text: string;
  /** Planner speaker label: a cast name, the persona name, "" for narration, null unknown. */
  speaker: string | null;
  /** Planner visual cue on this paragraph (character + catalogue pose id), as the planner would emit it. */
  cue?: { character: string; pose: string };
  /** Planner continuity: these characters leave (present: false) at this paragraph. */
  leaves?: string[];
  present: string[];
  chars?: Record<string, CharLabel>;
  km?: KeyMomentLabel;
};

export type EvalScene = {
  start: number;
  location: string;
  timeOfDay: string | null;
  weather: string | null;
  lighting: string | null;
  description: string;
  /** Planner subject of the scene (cast name) and scene cast. */
  character: string | null;
  cast: string[];
  light: Light;
  lightOk?: Light[];
  /** Known plate id this scene revisits (same place, time of day, weather), else null. */
  plate: string | null;
};

export type EvalReply = {
  id: string;
  genre: "slice of life" | "romance" | "comedy" | "action" | "horror" | "drama" | "fantasy" | "mystery" | "sci-fi";
  person: "first" | "third" | "second";
  persona: string;
  cast: Array<{ name: string; identity: string; attire: string | null }>;
  scenes: EvalScene[];
  paragraphs: EvalParagraph[];
  /** Free-form notes on what this reply tests (negations, idioms, sarcasm...). */
  notes?: string;
};

export type EvalPlate = {
  id: string;
  location: string;
  timeOfDay: string | null;
  weather: string | null;
  description: string;
};
