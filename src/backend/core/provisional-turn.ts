/*
 * The provisional turn: a reply's text on the stage before the visual plan
 * lands (ARCHITECTURE "Turn flow"). It names a paragraph's speaker only where
 * the text itself settles it; every other paragraph reads as narration until
 * the plan upgrades it in place.
 */
import type { TurnView } from "../../protocol.js";
import type { PanelArtifact } from "../../shared/panels.js";

export type ProvisionalSpeakerNames = {
  /** Characters the chat already knows, each with its explicit aliases. */
  characters: ReadonlyArray<{ name: string; aliases?: readonly string[] | undefined }>;
  /** The persona's display name ("" when there is none). */
  persona?: string | undefined;
};

/**
 * Verbs that tie a quote to the name next to it (`"Hi," Mira says.`, `Mira
 * asks, "Why?"`). Base forms too: `"Hi," I say` is a tag whose subject is no
 * known name, so the paragraph has a speaker the text does not settle.
 */
const SPEECH_VERBS = [
  "say", "says", "said", "ask", "asks", "asked", "reply", "replies", "replied", "answer", "answers", "answered",
  "whisper", "whispers", "whispered", "murmur", "murmurs", "murmured", "mutter", "mutters", "muttered",
  "shout", "shouts", "shouted", "yell", "yells", "yelled", "call", "calls", "called", "cry", "cries", "cried",
  "snap", "snaps", "snapped", "hiss", "hisses", "hissed", "sigh", "sighs", "sighed", "laugh", "laughs", "laughed",
  "add", "adds", "added", "continue", "continues", "continued", "purr", "purrs", "purred", "growl", "growls", "growled",
  "tease", "teases", "teased", "breathe", "breathes", "breathed", "insist", "insists", "insisted", "admit", "admits", "admitted",
  "explain", "explains", "explained", "declare", "declares", "declared", "demand", "demands", "demanded",
  "plead", "pleads", "pleaded", "respond", "responds", "responded", "protest", "protests", "protested",
  "exclaim", "exclaims", "exclaimed", "tell", "tells", "told", "mumble", "mumbles", "mumbled",
  "stammer", "stammers", "stammered", "stutter", "stutters", "stuttered", "warn", "warns", "warned",
  "repeat", "repeats", "repeated", "scoff", "scoffs", "scoffed", "groan", "groans", "groaned", "gasp", "gasps", "gasped",
  "coo", "coos", "cooed", "drawl", "drawls", "drawled", "quip", "quips", "quipped",
];
const VERB = `(?:${SPEECH_VERBS.join("|")})`;
const NOT_WORD_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_WORD_AFTER = "(?![\\p{L}\\p{N}])";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Markup the stage renders but the words do not need: tags and emphasis marks. */
function plainWords(text: string): string {
  return text.replace(/<[^>\n]*>/g, "").replace(/[*_~`]+/g, "");
}

/** Every label (name or alias) that may stand for a speaker, lowercased, with the name it resolves to. */
function speakerLabels(names: ProvisionalSpeakerNames): Map<string, string> {
  const labels = new Map<string, string>();
  const add = (label: string | null | undefined, canonical: string) => {
    const key = (label ?? "").trim().toLowerCase();
    if (key.length < 2 || labels.has(key)) return;
    labels.set(key, canonical);
  };
  const persona = names.persona?.trim() ?? "";
  if (persona) add(persona, persona);
  for (const character of names.characters) {
    const canonical = character.name.trim();
    if (!canonical) continue;
    add(canonical, canonical);
    for (const alias of character.aliases ?? []) add(alias, canonical);
  }
  // A first name stands for its character only when no other label shares it.
  const firstNames = new Map<string, Set<string>>();
  for (const canonical of new Set(labels.values())) {
    const words = canonical.split(/\s+/);
    if (words.length < 2 || words[0]!.length < 3) continue;
    const first = words[0]!.toLowerCase();
    firstNames.set(first, (firstNames.get(first) ?? new Set()).add(canonical));
  }
  for (const [first, owners] of firstNames) if (owners.size === 1) add(first, [...owners][0]!);
  return labels;
}

/**
 * A script line at the paragraph start (`Mira: ...`, `**Mira:** ...`), when
 * every other script line of the paragraph names the same character.
 */
function scriptLineSpeaker(paragraph: string, labels: ReadonlyMap<string, string>): string | null {
  const prefix = (line: string) => /^\s*([^:：\n"“「]{2,40}?)\s*[:：]/u.exec(line)?.[1]?.trim().toLowerCase();
  const [first = "", ...rest] = plainWords(paragraph).split("\n");
  const label = prefix(first);
  const speaker = label ? labels.get(label) : undefined;
  if (!speaker) return null;
  for (const line of rest) {
    const other = prefix(line);
    if (other && labels.get(other) !== speaker) return null;
  }
  return speaker;
}

/** Quote marks and the marks that close them. A straight quote may close a curly one and back. */
const QUOTE_CLOSERS: Record<string, string> = { "\"": "\"”", "“": "”\"", "「": "」", "『": "』" };
/** One quoted span (marks included) in `outsideQuotes`. */
const QUOTED = "\u0001";

/** The paragraph's words outside its quotes, each quoted span one QUOTED mark; null without quotes. */
function outsideQuotes(text: string): string | null {
  let outside = "";
  let closers = "";
  let quoted = false;
  for (const char of text) {
    if (closers) {
      if (closers.includes(char)) closers = "";
      continue;
    }
    const closing = QUOTE_CLOSERS[char];
    if (closing) {
      closers = closing;
      quoted = true;
      outside += QUOTED;
      continue;
    }
    outside += char;
  }
  return quoted ? outside : null;
}

const WORD = "[\\p{L}\\p{N}'’-]+";
const ADVERB = "(?:\\p{L}+ly\\s+)?";
/** `"…," Mira says` (the subject before the verb). */
const TAG_AFTER = new RegExp(`${QUOTED}\\s*[,.!?—–-]?\\s*((?:${WORD}\\s+){1,3}?)${ADVERB}${VERB}${NOT_WORD_AFTER}`, "gu");
/** `"…," says Mira` (the subject after the verb). */
const TAG_INVERTED = new RegExp(`${QUOTED}\\s*[,.!?—–-]?\\s*${VERB}\\s+(${WORD}(?:\\s+${WORD}){0,2})`, "gu");
/** `Mira asks, "…"`. */
const TAG_BEFORE = new RegExp(`((?:${WORD}\\s+){1,3}?)${ADVERB}${VERB}${NOT_WORD_AFTER}[^${QUOTED}\\n]{0,40}?[,:]\\s*${QUOTED}`, "gu");

/**
 * The known name a tag's subject words end (or, inverted, start) with; null
 * for a pronoun, "I", anyone unknown, or several people ("Kai and Mira").
 */
function subjectName(words: string, labels: ReadonlyMap<string, string>, at: "end" | "start"): string | null {
  const phrase = words.trim().toLowerCase();
  if (/(?:^|\s)(?:and|or|&)(?:\s|$)/u.test(phrase)) return null;
  // Longer labels first, so "Mira Kael" wins over "Mira".
  for (const [label, canonical] of [...labels].sort((a, b) => b[0].length - a[0].length)) {
    const fits = at === "end"
      ? phrase === label || phrase.endsWith(` ${label}`)
      : phrase === label || phrase.startsWith(`${label} `);
    if (fits) return canonical;
  }
  return null;
}

/** Known names outside the quotes, not written lowercase (an action beat may give a quote to any of them). */
function namesOutside(outside: string, labels: ReadonlyMap<string, string>): Set<string> {
  const found = new Set<string>();
  for (const [label, canonical] of labels) {
    for (const match of outside.matchAll(new RegExp(`${NOT_WORD_BEFORE}${escapeRegExp(label)}${NOT_WORD_AFTER}`, "giu"))) {
      const initial = match[0][0]!;
      if (initial === initial.toUpperCase()) found.add(canonical);
    }
  }
  return found;
}

/**
 * The known name the paragraph's speech tags give its quotes to: every tag
 * (outside the quotes) names that one character, and no other known name
 * stands outside the quotes. Null otherwise: a pronoun, "I" or an unknown
 * subject in any tag, two speakers, or a beat that may give a quote to
 * someone else.
 */
function taggedSpeaker(paragraph: string, labels: ReadonlyMap<string, string>): string | null {
  const outside = outsideQuotes(plainWords(paragraph));
  if (!outside) return null;
  const subjects = new Set<string | null>();
  for (const match of outside.matchAll(TAG_AFTER)) subjects.add(subjectName(match[1]!, labels, "end"));
  for (const match of outside.matchAll(TAG_BEFORE)) subjects.add(subjectName(match[1]!, labels, "end"));
  for (const match of outside.matchAll(TAG_INVERTED)) subjects.add(subjectName(match[1]!, labels, "start"));
  if (subjects.size !== 1) return null;
  const speaker = [...subjects][0];
  if (!speaker) return null;
  for (const name of namesOutside(outside, labels)) if (name !== speaker) return null;
  return speaker;
}

/**
 * Per paragraph: the speaker the text settles (a `Name:` script line, or speech
 * tags that tie the paragraph's quotes to one known name, such as the previous
 * protagonist), otherwise "" (narration). Only names the chat already knows, or
 * the persona, can settle a paragraph; the plan decides everything else.
 */
export function settledSpeakers(paragraphs: readonly string[], names: ProvisionalSpeakerNames): string[] {
  const labels = speakerLabels(names);
  if (labels.size === 0) return paragraphs.map(() => "");
  return paragraphs.map((paragraph) => scriptLineSpeaker(paragraph, labels) ?? taggedSpeaker(paragraph, labels) ?? "");
}

export type ProvisionalTurnInput = {
  chatId: string;
  messageId: string;
  swipeId: number;
  /** The planned turn's fingerprint: the plan upgrades the turn with the same one. */
  sourceFingerprint: string;
  revision: number;
  speaker: string;
  userSpeaker: string;
  /** The paragraphs the plan will hold (after the non-story check). */
  paragraphs: readonly string[];
  panels?: readonly PanelArtifact[] | undefined;
  panelSource?: string | undefined;
  names: ProvisionalSpeakerNames;
  /** The previous scene's ambient; undefined keeps whatever the stage shows. */
  previousAmbient?: string | null | undefined;
};

/**
 * The turn view sent before the plan: text, panels and settled speakers, the
 * previous scene's ambient, and nothing the plan decides (no cues, effects,
 * choices, assets or sprite staging). Status stays "planning"; it is never stored.
 */
export function provisionalTurnView(input: ProvisionalTurnInput): TurnView {
  // TurnPlan trims paragraph text; the upgrade compares the two texts.
  const paragraphs = input.paragraphs.map((text) => text.trim());
  const speakers = settledSpeakers(paragraphs, input.names);
  return {
    chatId: input.chatId,
    messageId: input.messageId,
    swipeId: input.swipeId,
    sourceFingerprint: input.sourceFingerprint,
    revision: input.revision,
    speaker: input.speaker,
    userSpeaker: input.userSpeaker,
    paragraphs,
    ...(input.panels?.length ? { panels: [...input.panels] } : {}),
    ...(input.panelSource ? { panelSource: input.panelSource } : {}),
    paragraphSpeakers: speakers,
    ...(input.previousAmbient !== undefined ? { ambients: paragraphs.map(() => input.previousAmbient ?? null) } : {}),
    choices: [],
    assets: [],
    status: "planning",
    provisional: true,
  };
}
