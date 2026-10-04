/**
 * Sprite mode: shared, host-neutral contract.
 *
 * In sprite mode Cue stops painting a full scene per paragraph. Instead it
 * keeps a reusable library of
 *   - character sprite SETS: one cut-out (transparent PNG) per expression for a
 *     character + outfit + image style, generated once on a plain white
 *     background and cut in the browser, and
 *   - background PLATES: one empty scene ("no humans") per place + time + weather,
 * and every paragraph only CHOOSES which sprites stand where, with which
 * expression, motion, emote and light. Choosing is cheap and fast (the story
 * reader, or the System One classifier), so every paragraph can be staged.
 *
 * See docs/SPRITE_MODE.md for the architecture and data flow.
 *
 * This module has no DOM or host APIs so backend, frontend, settings and
 * tests share one definition.
 */
import { z } from "zod";

/* ------------------------------------------------------------------------ */
/* Expressions                                                               */
/* ------------------------------------------------------------------------ */

/**
 * The "hot set": generated ahead of time for every new sprite set, in this
 * order (index 0 first, it is the universal fallback). Ids come from
 * POSE_EXPRESSION_CATALOGUE in src/shared/character.ts.
 */
export const SPRITE_HOT_SET = [
  "idle",
  "smile",
  "laughing",
  "sad",
  "crying_with_eyes_open",
  "angry",
  "surprised",
  "embarrassed",
  "worried",
  "thinking",
  "smug",
  "scared",
] as const;
export type SpriteHotExpression = (typeof SPRITE_HOT_SET)[number];

/**
 * Nearest hot-set expression for every catalogue expression id. A requested
 * rare expression is shown as its fallback until (and unless) the rare
 * sprite itself has been generated.
 */
export const SPRITE_EXPRESSION_FALLBACK: Readonly<Record<string, SpriteHotExpression>> = {
  idle: "idle",
  speak: "idle",
  smile: "smile",
  laugh: "laughing",
  think: "thinking",
  sad: "sad",
  angry: "angry",
  surprise: "surprised",
  wave: "smile",
  shy: "embarrassed",
  listen: "idle",
  contempl: "thinking",
  default: "idle",
  standing: "idle",
  acting_coy: "embarrassed",
  acting_cute: "smile",
  admiring: "smile",
  angry_smiling: "angry",
  annoyed: "angry",
  aroused: "embarrassed",
  blushing_shyly: "embarrassed",
  bored: "idle",
  bridling: "angry",
  childlike_whining: "sad",
  chuunibyou: "smug",
  confused: "thinking",
  contemptuous: "smug",
  coughing: "worried",
  cozy: "smile",
  crazy_smiling: "smug",
  crying_with_eyes_closed: "crying_with_eyes_open",
  crying_with_eyes_open: "crying_with_eyes_open",
  curious: "thinking",
  depressed: "sad",
  determined: "smug",
  disappointed: "sad",
  disgusted: "angry",
  dozing_off: "idle",
  embarrassed: "embarrassed",
  enraged: "angry",
  eureka: "surprised",
  evil_smiling: "smug",
  excited: "laughing",
  exhausted: "sad",
  fidgeting_shyly: "embarrassed",
  flustered: "embarrassed",
  forced_smiling: "worried",
  full_face_blush: "embarrassed",
  giggling: "laughing",
  grudging: "angry",
  guilty: "worried",
  happy_smiling: "smile",
  happy_tears: "crying_with_eyes_open",
  head_bump: "embarrassed",
  indifferent: "idle",
  jealous: "angry",
  joyful: "laughing",
  laughing: "laughing",
  looking_away_shyly: "embarrassed",
  lovestruck: "embarrassed",
  lustful: "embarrassed",
  melancholic: "sad",
  middle_finger: "angry",
  nervous: "worried",
  nervous_pouting: "worried",
  overwhelmed: "worried",
  play_dumb: "smile",
  playful_winking: "smug",
  pleading: "worried",
  pouting: "angry",
  proud: "smug",
  relieved: "smile",
  scared: "scared",
  scared_screaming: "scared",
  seductive_smiling: "smug",
  serious: "idle",
  shocked: "surprised",
  sleepy: "idle",
  smiling: "smile",
  smirk: "smug",
  smug: "smug",
  sniggering: "smug",
  spacey: "idle",
  stretching: "idle",
  stupefied: "surprised",
  surprised: "surprised",
  suspicious: "thinking",
  taunting: "smug",
  teary_pouting: "crying_with_eyes_open",
  thinking: "thinking",
  tormented: "crying_with_eyes_open",
  worried: "worried"
};

const HOT_SET: ReadonlySet<string> = new Set(SPRITE_HOT_SET);

export function isSpriteHotExpression(value: unknown): value is SpriteHotExpression {
  return typeof value === "string" && HOT_SET.has(value);
}

/** Nearest hot-set expression; unknown or empty ids map to "idle". */
export function spriteFallbackExpression(expression: string | null | undefined): SpriteHotExpression {
  if (!expression) return "idle";
  if (isSpriteHotExpression(expression)) return expression;
  return SPRITE_EXPRESSION_FALLBACK[expression] ?? "idle";
}

/**
 * The expression to SHOW now, given which sprites of a set are ready:
 * the requested one, else its hot-set fallback, else "idle", else the first
 * ready hot-set expression, else any ready expression, else null (nothing
 * of this set can be shown yet).
 */
export function bestAvailableExpression(
  requested: string | null | undefined,
  ready: ReadonlySet<string>,
): string | null {
  if (requested && ready.has(requested)) return requested;
  const fallback = spriteFallbackExpression(requested);
  if (ready.has(fallback)) return fallback;
  if (ready.has("idle")) return "idle";
  for (const id of SPRITE_HOT_SET) if (ready.has(id)) return id;
  for (const id of ready) return id;
  return null;
}

/* ------------------------------------------------------------------------ */
/* Staging vocabulary (closed catalogues)                                    */
/* ------------------------------------------------------------------------ */

/** At most this many characters stand on stage at once. */
export const MAX_SPRITE_ACTORS = 3;

export const SPRITE_SLOTS = ["left", "center", "right"] as const;
export type SpriteSlot = (typeof SPRITE_SLOTS)[number];

/** Which way a sprite faces. "viewer" keeps the generated image as is. */
export const SPRITE_FACINGS = ["viewer", "left", "right"] as const;
export type SpriteFacing = (typeof SPRITE_FACINGS)[number];

/** One-shot body motion played when the paragraph is shown. */
export const SPRITE_MOTIONS = [
  "none",
  "hop",
  "bounce",
  "shake",
  "tremble",
  "step_back",
  "lean_in",
  "nod",
  "turn_away",
  "sink",
] as const;
export type SpriteMotion = (typeof SPRITE_MOTIONS)[number];

/** Manga-style mark drawn near the head for the paragraph. */
export const SPRITE_EMOTES = [
  "none",
  "sweat",
  "anger",
  "heart",
  "sparkle",
  "exclaim",
  "question",
  "ellipsis",
  "music",
  "gloom",
  "blush",
] as const;
export type SpriteEmote = (typeof SPRITE_EMOTES)[number];

/** Light applied to sprites so they sit in the plate's lighting. */
export const SPRITE_LIGHTS = ["neutral", "day", "sunset", "night", "indoor_warm", "indoor_cool", "candle", "dark"] as const;
export type SpriteLight = (typeof SPRITE_LIGHTS)[number];

/* ------------------------------------------------------------------------ */
/* Key-moment interactions (closed catalogue)                                */
/* ------------------------------------------------------------------------ */

/**
 * What the characters of a key-moment illustration do. "none" (the safe
 * default, first for the classifier) shows them in the scene without a
 * special pose. Prompt tags are in SPRITE_INTERACTION_TAGS.
 */
export const SPRITE_INTERACTIONS = [
  "none",
  "kiss",
  "hug",
  "crying_on_shoulder",
  "carrying",
  "holding_hands",
  "dancing",
  "fighting",
  "lying",
  "kneeling",
  "sitting_together",
  "sitting",
  "running",
  "walking_together",
  "looking_at_each_other",
] as const;
export type SpriteInteraction = (typeof SPRITE_INTERACTIONS)[number];

/** Camera distance for a key moment: wide enough for the pose, close enough for faces. */
export type SpriteMomentFraming = "upper body" | "cowboy shot" | "full body";

export type SpriteInteractionSpec = {
  /** Tags when two known characters take part (Danbooru style). */
  pair: string;
  /** Tags for one character alone (null: the interaction needs a partner). */
  solo: string | null;
  /**
   * Tags for one known character with an unknown partner (the reader or an
   * unnamed person): a first-person view, so nobody has to be invented.
   */
  pov: string | null;
  framing: SpriteMomentFraming;
  /**
   * NovelAI V4+ action tag for the character captions (`mutual#`,
   * `source#` / `target#`), or null.
   */
  action: { kind: "mutual" | "directed"; tag: string } | null;
  /** Short description for the classifier. */
  guide: string;
};

export const SPRITE_INTERACTION_TAGS: Readonly<Record<SpriteInteraction, SpriteInteractionSpec>> = {
  none: { pair: "", solo: "", pov: null, framing: "cowboy shot", action: null, guide: "No special pose or contact; people just talk, stand or look" },
  kiss: { pair: "kiss, couple, face-to-face, closed eyes", solo: null, pov: "pov, incoming kiss, closed eyes, blush", framing: "upper body", action: { kind: "mutual", tag: "kiss" }, guide: "Two people kiss" },
  hug: { pair: "hug, couple, arms around another", solo: null, pov: "pov, incoming hug, outstretched arms, reaching towards viewer", framing: "upper body", action: { kind: "mutual", tag: "hug" }, guide: "Two people hug or embrace" },
  crying_on_shoulder: { pair: "hug, crying, tears, head on another's shoulder", solo: null, pov: "pov, crying, tears, hug, head on chest", framing: "upper body", action: { kind: "directed", tag: "hug" }, guide: "Someone cries against another person's shoulder or chest" },
  carrying: { pair: "princess carry, carrying", solo: null, pov: "pov, princess carry, being carried", framing: "full body", action: { kind: "directed", tag: "princess carry" }, guide: "Someone carries or lifts another person" },
  holding_hands: { pair: "holding hands, couple", solo: null, pov: "pov, holding hands, pov hands", framing: "cowboy shot", action: { kind: "mutual", tag: "holding hands" }, guide: "Two people hold hands" },
  dancing: { pair: "dancing, couple, holding hands, dynamic pose", solo: "dancing, dynamic pose", pov: "pov, dancing, holding hands", framing: "full body", action: { kind: "mutual", tag: "dancing" }, guide: "Someone dances" },
  fighting: { pair: "fighting, battle, facing another, dynamic pose, action", solo: "fighting stance, battle, dynamic pose, action", pov: "fighting stance, battle, dynamic pose, action", framing: "full body", action: { kind: "mutual", tag: "fighting" }, guide: "A fight: punches, kicks, weapons, a duel" },
  lying: { pair: "lying, on back, side-by-side", solo: "lying, on back", pov: "lying, on back, looking at viewer", framing: "full body", action: null, guide: "Someone lies down (on a bed, the floor, the grass)" },
  kneeling: { pair: "kneeling", solo: "kneeling", pov: "kneeling, looking at viewer", framing: "full body", action: null, guide: "Someone kneels or falls to their knees" },
  sitting_together: { pair: "sitting, side-by-side, couple", solo: "sitting", pov: "pov, sitting, side-by-side, looking at viewer", framing: "full body", action: { kind: "mutual", tag: "sitting" }, guide: "Two people sit together or next to each other" },
  sitting: { pair: "sitting", solo: "sitting", pov: "sitting, looking at viewer", framing: "full body", action: null, guide: "Someone sits (on a chair, a bench, the ground)" },
  running: { pair: "running, side-by-side, motion blur", solo: "running, motion blur", pov: "running, motion blur, looking back", framing: "full body", action: null, guide: "Someone runs or rushes" },
  walking_together: { pair: "walking, side-by-side, couple", solo: "walking", pov: "pov, walking, looking at viewer", framing: "full body", action: { kind: "mutual", tag: "walking" }, guide: "Two people walk together" },
  looking_at_each_other: { pair: "looking at another, eye contact, face-to-face", solo: null, pov: "pov, looking at viewer, eye contact, close-up", framing: "upper body", action: { kind: "mutual", tag: "eye contact" }, guide: "Two people look into each other's eyes" },
};

const INTERACTION_IDS: ReadonlySet<string> = new Set(SPRITE_INTERACTIONS);

export function isSpriteInteraction(value: unknown): value is SpriteInteraction {
  return typeof value === "string" && INTERACTION_IDS.has(value);
}

/** Interactions that are about two people (one known character gets the first-person variant). */
export function interactionNeedsPartner(interaction: SpriteInteraction): boolean {
  return SPRITE_INTERACTION_TAGS[interaction].solo === null;
}

/* ------------------------------------------------------------------------ */
/* Staging stored on the turn plan                                           */
/* ------------------------------------------------------------------------ */

/** A character who can appear in this turn. `characterKey` is stable within the chat. */
export const SpriteCastMemberSchema = z.object({
  characterKey: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  characterId: z.string().trim().min(1).optional(),
  /** Resolved appearance tags (frozen identity block) used for sprite prompts. */
  identity: z.string().max(4000),
  /** Resolved outfit; a different outfit is a different sprite set. */
  attire: z.string().max(2000).nullable(),
  subjectCategory: z.enum(["female", "male", "nonbinary", "nonhuman", "unknown"]).optional(),
}).strict();
export type SpriteCastMember = z.infer<typeof SpriteCastMemberSchema>;

/** A place the turn shows. `plateKey` comes from `plateKeyFor`. */
export const SpritePlateRefSchema = z.object({
  plateKey: z.string().trim().min(1).max(200),
  location: z.string().max(1000),
  timeOfDay: z.string().max(200).nullable(),
  weather: z.string().max(200).nullable(),
  description: z.string().max(4000),
}).strict();
export type SpritePlateRef = z.infer<typeof SpritePlateRefSchema>;

export const SpriteActorStageSchema = z.object({
  characterKey: z.string().trim().min(1).max(200),
  /** Catalogue expression id (any of the 92); shown via bestAvailableExpression. */
  expression: z.string().trim().min(1).max(80),
  slot: z.enum(SPRITE_SLOTS),
  facing: z.enum(SPRITE_FACINGS).default("viewer"),
  /** The speaker (or the one the paragraph is about) is in focus; others are dimmed. */
  focus: z.boolean().default(false),
  motion: z.enum(SPRITE_MOTIONS).default("none"),
  emote: z.enum(SPRITE_EMOTES).default("none"),
  /** 1 (subtle) .. 5 (strong); scales motion. */
  intensity: z.number().int().min(1).max(5).default(3),
}).strict();
export type SpriteActorStage = z.infer<typeof SpriteActorStageSchema>;

/** What a key-moment illustration shows: the interaction and who takes part (at most 2, cast keys). */
export const SpriteKeyMomentSchema = z.object({
  interaction: z.enum(SPRITE_INTERACTIONS).default("none"),
  /** Cast keys of the characters in the picture, most important first. */
  characters: z.array(z.string().trim().min(1).max(200)).max(2).default([]),
  /**
   * The interaction is with someone who is not a cast member (the reader or
   * an unnamed person): one known character, first-person view.
   */
  partner: z.boolean().default(false),
}).strict();
export type SpriteKeyMoment = z.infer<typeof SpriteKeyMomentSchema>;

export const SpriteParagraphStageSchema = z.object({
  /** Characters on stage for this paragraph, at most MAX_SPRITE_ACTORS, unique keys and slots. */
  actors: z.array(SpriteActorStageSchema).max(MAX_SPRITE_ACTORS),
  /** The background plate, or null to keep the previous one. */
  plateKey: z.string().trim().min(1).max(200).nullable(),
  light: z.enum(SPRITE_LIGHTS).default("neutral"),
  /**
   * Additive (optional): a key moment shown as a full scene illustration
   * (the scene-image job of this paragraph's cue) instead of the sprites,
   * once that picture is ready. Absent on older records and when the
   * `keyIllustrations` setting is "off".
   */
  illustrate: z.boolean().optional(),
  /**
   * Additive (optional): what the key-moment illustration shows, set
   * together with `illustrate`. Absent on older records (the backend then
   * derives it from the text).
   */
  moment: SpriteKeyMomentSchema.optional(),
}).strict();
export type SpriteParagraphStage = z.infer<typeof SpriteParagraphStageSchema>;

export const SpriteStagingSchema = z.object({
  version: z.literal(1),
  /** Who made the per-paragraph choices. */
  source: z.enum(["classifier", "planner"]),
  cast: z.array(SpriteCastMemberSchema).max(16),
  plates: z.array(SpritePlateRefSchema).max(16),
  /** Parallel to TurnPlan.paragraphs. */
  paragraphs: z.array(SpriteParagraphStageSchema),
}).strict();
export type SpriteStaging = z.infer<typeof SpriteStagingSchema>;

/* ------------------------------------------------------------------------ */
/* Keys                                                                      */
/* ------------------------------------------------------------------------ */

/** Small stable non-crypto hash (FNV-1a 32-bit, hex). Keys only, never security. */
export function spriteHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Plate identity: the same place, time of day and weather share one plate
 * across scenes, turns and chats with the same image style.
 */
export function plateKeyFor(
  place: { location: string; timeOfDay?: string | null; weather?: string | null },
  styleKey: string,
): string {
  return `plate_${spriteHash([norm(place.location), norm(place.timeOfDay), norm(place.weather), styleKey].join("|"))}`;
}

/**
 * Sprite-set identity: name + appearance + outfit + image style. Identical
 * characters in different chats share a set.
 */
export function spriteSetKeyFor(
  member: Pick<SpriteCastMember, "name" | "identity" | "attire">,
  styleKey: string,
): string {
  return `set_${spriteHash([norm(member.name), norm(member.identity), norm(member.attire), styleKey].join("|"))}`;
}

/* ------------------------------------------------------------------------ */
/* Views sent to the frontend                                                */
/* ------------------------------------------------------------------------ */

export type SpriteImageStatus = "missing" | "queued" | "generating" | "cutting" | "ready" | "failed";

export type SpriteImageView = {
  expression: string;
  status: SpriteImageStatus;
  /** Cut-out (transparent PNG) URL, present when status is "ready". */
  url?: string;
  /** Opaque bounding box of the cut-out, normalized 0..1: [x, y, width, height]. */
  bbox?: [number, number, number, number];
  /** Pixel size of the cut-out image. */
  width?: number;
  height?: number;
  error?: string;
  /** Ready, but the duplicate check found what looks like two figures (kept after one automatic retry). */
  twoFigures?: true;
};

export type SpriteSetView = {
  setKey: string;
  name: string;
  attire: string | null;
  /** Expressions known for this set (hot set always listed, rare ones once requested). */
  expressions: Record<string, SpriteImageView>;
  readyCount: number;
  updatedAt: string;
};

export type PlateView = {
  plateKey: string;
  location: string;
  timeOfDay: string | null;
  weather: string | null;
  status: SpriteImageStatus;
  url?: string;
  error?: string;
};

/**
 * A key-moment illustration (sprite mode, `keyIllustrations` "few"): the
 * scene-image job of an `illustrate` paragraph, mirrored from
 * `TurnView.assets` so the stage can switch without the scene-image sync.
 */
export type SpriteIllustrationView = {
  paragraphIndex: number;
  jobId: string;
  status: "pending" | "ready" | "failed";
  /** Present when status is "ready". */
  url?: string;
};

/**
 * The illustration view of one scene-image job (backend view building and
 * the host's `vn_asset` forwarding share this mapping).
 */
export function spriteIllustrationViewFor(job: {
  jobId: string;
  paragraphIndex: number;
  status: string;
  imageUrl?: string | null;
}): SpriteIllustrationView {
  const ready = (job.status === "generated" || job.status === "browser_ready") && Boolean(job.imageUrl);
  return {
    paragraphIndex: job.paragraphIndex,
    jobId: job.jobId,
    status: ready ? "ready" : job.status === "failed" ? "failed" : "pending",
    ...(ready ? { url: job.imageUrl! } : {}),
  };
}

export type SpriteTurnView = {
  staging: SpriteStaging;
  /** Keyed by SpriteCastMember.characterKey. */
  sets: Record<string, SpriteSetView>;
  /** Keyed by plateKey. */
  plates: Record<string, PlateView>;
  /** Additive (optional): key-moment illustrations of this turn, by paragraph. */
  illustrations?: SpriteIllustrationView[];
};

/* ------------------------------------------------------------------------ */
/* Cut-out transport                                                         */
/* ------------------------------------------------------------------------ */

/** Cut-out PNGs are relayed in base64 chunks under the host's 4 MB message limit. */
export const SPRITE_CUT_CHUNK_CHARS = 3_000_000;
/** Upper bound for one decoded cut-out PNG. */
export const SPRITE_CUT_MAX_BYTES = 24 * 1024 * 1024;

export type SpriteCutMeta = {
  width: number;
  height: number;
  bbox: [number, number, number, number];
  /** "best" used the segmentation model; "basic" is the model-free fallback. */
  quality: "best" | "basic";
  /**
   * Duplicate check of the browser cut-out: two figures side by side. Absent
   * from older frontends (unknown).
   */
  twoFigures?: boolean;
  durationMs: number;
};

/** Default cut-out model (ISNet-anime, Apache-2.0, SkyTNT/anime-segmentation). */
export const DEFAULT_SPRITE_MODEL_URL = "https://huggingface.co/skytnt/anime-seg/resolve/main/isnetis.onnx";
