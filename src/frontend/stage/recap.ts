/**
 * What the waiting screen recalls of the reply just read: who was in it, what
 * each of them said (and how they looked saying it), and the reply paragraph
 * by paragraph. Pure data from the stage's paragraphs and sprite staging; the
 * waiting screen (waiting-screen.ts) draws it.
 */
import type { SpriteImageView, SpriteTurnView } from "../../shared/sprites.js";
import type { VnParagraph, VnScene } from "../store/vn-store.js";
import { resolveSpriteImage } from "./sprite-layer.js";
import { bareSpeakerName, innerVoiceFor, speakerColor } from "./voices.js";

/** Ids of the reader's own paragraphs (VnStage.presentUserParagraph) start with this. */
export const USER_PARAGRAPH_PREFIX = "user-";

export type RecapKind = "character" | "reader" | "voice" | "narration";

/** A sprite picture, with what the waiting screen needs to frame it. */
export type RecapImage = Pick<SpriteImageView, "bbox" | "width" | "height" | "face"> & { url: string };

export type RecapLine = {
  /** Paragraph index in the reply (0-based). */
  index: number;
  /** A short excerpt: the first quoted line, else the paragraph's start. */
  excerpt: string;
  text: string;
  /** How they said it: "Turns away", "Smile". */
  chip: string | null;
  /** Their picture for this line (sprite mode), or null. */
  image: RecapImage | null;
};

export type RecapCharacter = {
  /** Sprite cast key, or `name:` and the bare name for a speaker outside the cast. */
  key: string;
  name: string;
  color: string;
  kind: RecapKind;
  /** On stage when the reply ended (sprite mode). */
  onStage: boolean;
  /** Their picture when the reply ended, else their latest line's. */
  image: RecapImage | null;
  lines: RecapLine[];
};

export type RecapEntry = {
  index: number;
  speaker: string;
  color: string;
  kind: RecapKind;
  excerpt: string;
  text: string;
  chip: string | null;
  image: RecapImage | null;
};

export type WaitingRecap = {
  /** Characters: on stage at the end first, then the others who spoke. Inner voices and the reader are not here. */
  characters: RecapCharacter[];
  /** Inner voices that spoke, for cards without a picture. */
  voices: RecapCharacter[];
  /** Every paragraph of the reply, the reader's own lines included. */
  entries: RecapEntry[];
  /** Paragraphs in the reply (the reader's own lines not counted). */
  paragraphCount: number;
  scene: VnScene | null;
  /** What the reader sent, or null (a retry). */
  sent: string | null;
  writer: string;
  backgroundUrl: string | null;
};

/** Speakers that are the narration itself (the planner may name it): no picture, never a cast member. */
const NARRATOR_NAMES = new Set(["narrator", "narration", "the narrator"]);

export type WaitingRecapInput = {
  paragraphs: readonly VnParagraph[];
  sprites: SpriteTurnView | null;
  scenes: readonly VnScene[];
  /** The reader's name on their own lines. */
  readerName: string;
  /**
   * The reader's persona (the turn's `userSpeaker`). Lines the reply gives
   * them count as the reader's too, also when their own line is not on the
   * stage: the persona has no sprite, so it never takes a place in the cast.
   */
  personaName?: string;
  sent: string | null;
  writer: string;
  backgroundUrl: string | null;
  innerVoices?: readonly string[];
};

const MOTION_CHIPS: Readonly<Record<string, string>> = {
  hop: "Hops",
  bounce: "Bounces",
  shake: "Shakes",
  tremble: "Trembles",
  step_back: "Steps back",
  lean_in: "Leans in",
  nod: "Nods",
  turn_away: "Turns away",
  sink: "Sinks",
};

const EMOTE_CHIPS: Readonly<Record<string, string>> = {
  sweat: "Nervous",
  anger: "Angry",
  heart: "Smitten",
  sparkle: "Delighted",
  exclaim: "Startled",
  question: "Puzzled",
  ellipsis: "Speechless",
  music: "Cheerful",
  gloom: "Gloomy",
  blush: "Blushing",
};

/** "crying_with_eyes_open" → "Crying with eyes open". */
function expressionChip(expression: string): string | null {
  const words = expression.replace(/[_-]+/g, " ").trim();
  if (!words || words === "idle" || words === "neutral") return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const QUOTE_RUN = /「([^」]{2,})」|『([^』]{2,})』|“([^”]{2,})”|"([^"]{2,})"/;

/** The first quoted line of a paragraph, else its beginning (whitespace collapsed). */
export function recapExcerpt(text: string, limit = 160): string {
  const plain = text.replace(/<[^>]+>/g, "").replace(/[*_~`]+/g, "").replace(/\s+/g, " ").trim();
  const quoted = QUOTE_RUN.exec(plain);
  // A quote that runs into its tag ("Sorry," she says) ends without the comma.
  const line = quoted ? (quoted[1] ?? quoted[2] ?? quoted[3] ?? quoted[4] ?? "").trim().replace(/[,，、]+$/, "") : plain;
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
}

/** The scene in effect at a paragraph. */
export function sceneAt(scenes: readonly VnScene[], index: number): VnScene | null {
  let found: VnScene | null = null;
  for (const scene of scenes) {
    if (scene.startParagraph > index) break;
    found = scene;
  }
  return found ?? scenes[0] ?? null;
}

type CastRef = { key: string; name: string; bare: string; first: string };

/** The cast member a nameplate names: the whole name, else a unique first name. */
function castFor(cast: readonly CastRef[], speaker: string): CastRef | null {
  const bare = bareSpeakerName(speaker);
  if (!bare) return null;
  const exact = cast.find((member) => member.bare === bare);
  if (exact) return exact;
  const first = bare.split(" ")[0] ?? "";
  const byFirst = cast.filter((member) => member.first === first || member.bare.startsWith(`${bare} `));
  return byFirst.length === 1 ? byFirst[0]! : null;
}

function imageFor(sprites: SpriteTurnView, key: string, expression: string): RecapImage | null {
  const image = resolveSpriteImage(sprites.sets[key], expression);
  if (!image) return null;
  return {
    url: image.url,
    ...(image.bbox ? { bbox: image.bbox } : {}),
    ...(image.width ? { width: image.width } : {}),
    ...(image.height ? { height: image.height } : {}),
    ...(image.face !== undefined ? { face: image.face } : {}),
  };
}

/** The waiting screen's recap of the reply on the stage (see WaitingRecap). */
export function buildWaitingRecap(input: WaitingRecapInput): WaitingRecap {
  const { sprites } = input;
  const cast: CastRef[] = (sprites?.staging.cast ?? []).map((member) => {
    const bare = bareSpeakerName(member.name);
    return { key: member.characterKey, name: member.name, bare, first: bare.split(" ")[0] ?? "" };
  });
  const readerNames = new Set([input.readerName, input.personaName ?? ""].map(bareSpeakerName).filter(Boolean));
  const characters = new Map<string, RecapCharacter>();
  const voices = new Map<string, RecapCharacter>();
  const entries: RecapEntry[] = [];
  let replyIndex = -1;

  for (const paragraph of input.paragraphs) {
    const isReader = paragraph.id.startsWith(USER_PARAGRAPH_PREFIX);
    if (!isReader) replyIndex += 1;
    const index = Math.max(0, replyIndex);
    const speaker = paragraph.speaker?.trim() ?? "";
    const excerpt = recapExcerpt(paragraph.text);
    const voice = isReader ? null : innerVoiceFor(speaker, input.innerVoices);
    const member = isReader || voice || !speaker ? null : castFor(cast, speaker);
    const actor = member && sprites ? sprites.staging.paragraphs[index]?.actors.find((item) => item.characterKey === member.key) : undefined;
    const chip = actor
      ? MOTION_CHIPS[actor.motion] ?? EMOTE_CHIPS[actor.emote] ?? expressionChip(actor.expression)
      : null;
    const image = member && sprites && actor ? imageFor(sprites, member.key, actor.expression) : null;
    const bare = bareSpeakerName(speaker);
    const kind: RecapKind = isReader || readerNames.has(bare)
      ? "reader"
      : voice ? "voice" : speaker && !NARRATOR_NAMES.has(bare) ? "character" : "narration";
    const name = member?.name ?? speaker;
    entries.push({
      index,
      speaker: kind === "narration" ? "" : name,
      color: speakerColor(name, input.innerVoices),
      kind,
      excerpt,
      text: paragraph.text,
      chip: voice ? "Inner voice" : chip,
      image,
    });
    if (isReader || kind === "reader" || kind === "narration" || !excerpt) continue;

    // Speakers outside the cast get a key of their own kind, so "mira" the name never merges into "mira" the cast key.
    const key = member?.key ?? `name:${bareSpeakerName(speaker)}`;
    const bucket = voice ? voices : characters;
    let character = bucket.get(key);
    if (!character) {
      character = { key, name, color: speakerColor(name, input.innerVoices), kind, onStage: false, image: null, lines: [] };
      bucket.set(key, character);
    }
    character.lines.push({ index, excerpt, text: paragraph.text, chip: voice ? "Inner voice" : chip, image });
    if (image) character.image = image;
  }

  // Who stood on stage when the reply ended, in slot order, with the picture they ended on.
  const finalStage = sprites?.staging.paragraphs[Math.max(0, replyIndex)] ?? null;
  const onStage: RecapCharacter[] = [];
  for (const actor of finalStage?.actors ?? []) {
    const member = cast.find((item) => item.key === actor.characterKey);
    if (!member || !sprites) continue;
    let character = characters.get(member.key);
    if (!character) {
      character = { key: member.key, name: member.name, color: speakerColor(member.name, input.innerVoices), kind: "character", onStage: true, image: null, lines: [] };
      characters.set(member.key, character);
    }
    character.onStage = true;
    character.image = imageFor(sprites, member.key, actor.expression) ?? character.image;
    onStage.push(character);
  }
  const others = [...characters.values()].filter((character) => !character.onStage);

  return {
    characters: [...onStage, ...others],
    voices: [...voices.values()],
    entries,
    paragraphCount: Math.max(0, replyIndex + 1),
    scene: sceneAt(input.scenes, Math.max(0, replyIndex)),
    sent: input.sent,
    writer: input.writer,
    backgroundUrl: input.backgroundUrl,
  };
}

/** The meta line of a scene: "fog · late afternoon · 11 paragraphs". */
export function sceneMetaLine(scene: VnScene | null, paragraphCount: number): string {
  const parts = [scene?.weather, scene?.timeOfDay].map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  if (paragraphCount > 0) parts.push(paragraphCount === 1 ? "1 paragraph" : `${paragraphCount} paragraphs`);
  return parts.join(" · ");
}

/**
 * The broad place of a location, for the "SCENE · …" kicker: its last part
 * when the location names several ("Living room, 221B Baker Street" →
 * "221B Baker Street"), else null.
 */
export function sceneKickerPlace(location: string | null | undefined): string | null {
  const parts = (location ?? "").split(/\s*(?:,|—|–|\s-\s|\/|·)\s*/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1]! : null;
}
