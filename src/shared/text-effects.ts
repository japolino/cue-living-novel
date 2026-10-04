/**
 * Inline dialogue text effects: the closed catalogue.
 *
 * Authors (or the chat model, or a display regex rule) wrap words in a tag,
 * e.g. `<shake>No!</shake>` or `<rainbow>magic</rainbow>`. The dialogue
 * formatter (src/frontend/stage/rich-text.ts) turns each recognised tag into
 * `<span data-vn-text-fx="<id>">`, and src/frontend/stage/text-effects.ts
 * decorates per-letter effects in the DOM. Styling lives in
 * src/frontend/theme/text-effects-css.ts.
 *
 * This module is host-neutral (no DOM, no browser APIs) so the settings
 * panel, the stage, tests, and docs can all read the same list.
 *
 * Owner: the text-effects implementation. The settings panel must render its
 * reference card generically from TEXT_EFFECT_CATALOGUE, never from a copy.
 */
export const TEXT_EFFECT_IDS = [
  "shake",
  "tremble",
  "wave",
  "bounce",
  "rainbow",
  "glow",
  "pulse",
  "glitch",
  "whisper",
  "shout",
  "fade",
] as const;

export type TextEffectId = (typeof TEXT_EFFECT_IDS)[number];

export type TextEffectInfo = {
  id: TextEffectId;
  /** Short human label, e.g. "Shake". */
  label: string;
  /** One sentence: what it looks like and when to use it. */
  description: string;
  /** Raw markup example an author can copy, e.g. `<shake>Get down!</shake>`. */
  example: string;
  /** True when the effect animates each letter separately. */
  perLetter: boolean;
  /** True when the effect moves (frozen in "static" mode and under reduced motion). */
  motion: boolean;
};

export const TEXT_EFFECT_CATALOGUE: readonly TextEffectInfo[] = [
  { id: "shake", label: "Shake", description: "Letters jolt hard. Shouts, impacts, fear.", example: "<shake>Get down!</shake>", perLetter: true, motion: true },
  { id: "tremble", label: "Tremble", description: "A small nervous quiver. Cold, nerves, crying.", example: "<tremble>I-I'm fine.</tremble>", perLetter: true, motion: true },
  { id: "wave", label: "Wave", description: "Letters ripple up and down. Sing-song, teasing, dreamy.", example: "<wave>La la la~</wave>", perLetter: true, motion: true },
  { id: "bounce", label: "Bounce", description: "Letters hop in turn. Excited, cheerful.", example: "<bounce>We won!</bounce>", perLetter: true, motion: true },
  { id: "rainbow", label: "Rainbow", description: "Cycling rainbow colours. Magic, wonder, silliness.", example: "<rainbow>Magic!</rainbow>", perLetter: true, motion: true },
  { id: "glow", label: "Glow", description: "A soft light around the words. Spells, revelations.", example: "<glow>The seal breaks.</glow>", perLetter: false, motion: true },
  { id: "pulse", label: "Pulse", description: "Words swell like a heartbeat. Emphasis, longing.", example: "<pulse>Ba-dump.</pulse>", perLetter: false, motion: true },
  { id: "glitch", label: "Glitch", description: "Digital tearing and colour split. Machines, corruption.", example: "<glitch>SYSTEM ERROR</glitch>", perLetter: false, motion: true },
  { id: "whisper", label: "Whisper", description: "Small, faint, slightly italic. Secrets, asides.", example: "<whisper>don't tell anyone</whisper>", perLetter: false, motion: false },
  { id: "shout", label: "Shout", description: "Large and bold with a quick punch-in. Yelling.", example: "<shout>STOP!</shout>", perLetter: false, motion: true },
  { id: "fade", label: "Fade", description: "Letters drift in slowly like a ghost. Memories, the uncanny.", example: "<fade>Remember me...</fade>", perLetter: true, motion: true },
];

/**
 * A short, ready-to-paste instruction that teaches a chat model (character
 * card, lorebook entry, or preset) to use the tags above sparingly. The
 * settings panel shows it with a Copy button. Owner: text-effects.
 */
export const TEXT_EFFECT_AUTHOR_GUIDE: string = [
  "You may wrap a few short words of dialogue in one of these tags for a visual-novel text effect:",
  TEXT_EFFECT_CATALOGUE.map((effect) => `<${effect.id}>`).join(" "),
  "Use them rarely, only for strong moments, and always close the tag.",
].join("\n");

const TEXT_EFFECT_ID_SET: ReadonlySet<string> = new Set(TEXT_EFFECT_IDS);

export function isTextEffectId(value: unknown): value is TextEffectId {
  return typeof value === "string" && TEXT_EFFECT_ID_SET.has(value);
}
