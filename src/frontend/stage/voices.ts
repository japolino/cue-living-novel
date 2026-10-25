/**
 * Who a nameplate belongs to, for colour and staging.
 *
 * `speakerColor` gives every speaker a stable colour of their own (nameplates,
 * name tags on the waiting screen). `innerVoiceFor` recognises the voices in a
 * character's head that some stories give a nameplate, in the style of Disco
 * Elysium's skills ("Perception", "Logic", "지각", "논리"): such a paragraph has
 * no speaker on stage, so everyone dims and the screen edges glow in the
 * voice's colour.
 */

/** Colours for speakers, picked by name. Readable on the dark stage. */
export const SPEAKER_COLORS = [
  "#e8b04a", // gold
  "#6aa8f0", // blue
  "#e87a8e", // rose
  "#7cc98a", // green
  "#b48cf0", // violet
  "#4fc4c0", // teal
  "#f08a5a", // orange
  "#d8a0d8", // orchid
] as const;

/** Colours of the four skill families, as the game shows them. */
export const INNER_VOICE_COLORS = {
  intellect: "#5cb8e6",
  psyche: "#8f74e8",
  physique: "#e05a6e",
  motorics: "#e8c24f",
} as const;
export type InnerVoiceFamily = keyof typeof INNER_VOICE_COLORS;

/** Skill names (English and Korean) by family. */
const INNER_VOICE_NAMES: Readonly<Record<InnerVoiceFamily, readonly string[]>> = {
  intellect: [
    "logic", "encyclopedia", "rhetoric", "drama", "conceptualization", "visual calculus",
    "논리", "백과사전", "수사학", "개념화",
  ],
  psyche: [
    "volition", "inland empire", "empathy", "authority", "esprit de corps", "suggestion",
    "의지", "내면 제국", "공감", "권위", "단결심", "암시",
  ],
  physique: [
    "endurance", "pain threshold", "physical instrument", "electrochemistry", "electro-chemistry", "shivers", "half light",
    "지구력", "전기화학", "전율",
  ],
  motorics: [
    "hand/eye coordination", "hand-eye coordination", "perception", "reaction speed", "savoir faire", "interfacing", "composure",
    "지각", "반응 속도", "평정",
  ],
};

const VOICE_FAMILY = new Map<string, InnerVoiceFamily>();
for (const [family, names] of Object.entries(INNER_VOICE_NAMES) as Array<[InnerVoiceFamily, readonly string[]]>) {
  for (const name of names) VOICE_FAMILY.set(name, family);
}

/**
 * A nameplate reduced to the bare name: no brackets, no trailing check result
 * ("PERCEPTION [Medium: Success]", "[Logic]", "Composure (Easy)").
 */
export function bareSpeakerName(name: string): string {
  return name
    .trim()
    // A name in brackets is the name: "[Logic]".
    .replace(/^[[(（【［]([^\])）】］]*)[\])）】］]$/, "$1")
    .replace(/[[(（【［].*?[\])）】］]/g, " ")
    .replace(/[:：\-–—]\s*(success|failure|failed|passed|easy|medium|challenging|formidable|legendary|heroic|godly|impossible|trivial).*$/i, "")
    .replace(/[\s_]+/g, " ")
    .trim()
    .toLowerCase();
}

export type InnerVoice = {
  /** The bare name that matched. */
  name: string;
  /** The skill family, or "custom" for a name from the reader's own list. */
  family: InnerVoiceFamily | "custom";
  color: string;
};

/**
 * The inner voice a nameplate names, or null for an ordinary speaker.
 * `extra`: names the reader added (any case; brackets are ignored), shown in gold.
 */
export function innerVoiceFor(speaker: string | null | undefined, extra: readonly string[] = []): InnerVoice | null {
  if (!speaker) return null;
  const bare = bareSpeakerName(speaker);
  if (!bare) return null;
  const family = VOICE_FAMILY.get(bare);
  if (family) return { name: bare, family, color: INNER_VOICE_COLORS[family] };
  if (extra.some((name) => bareSpeakerName(name) === bare)) {
    return { name: bare, family: "custom", color: INNER_VOICE_COLORS.motorics };
  }
  return null;
}

/** A small stable hash (FNV-1a), for picking a colour. */
function nameHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The colour of a speaker: an inner voice has its family's colour, anyone else
 * a colour from SPEAKER_COLORS picked by name (the same name, the same colour).
 */
export function speakerColor(speaker: string | null | undefined, extraVoices: readonly string[] = []): string {
  const voice = innerVoiceFor(speaker, extraVoices);
  if (voice) return voice.color;
  const bare = bareSpeakerName(speaker ?? "");
  if (!bare) return SPEAKER_COLORS[0];
  return SPEAKER_COLORS[nameHash(bare) % SPEAKER_COLORS.length]!;
}
