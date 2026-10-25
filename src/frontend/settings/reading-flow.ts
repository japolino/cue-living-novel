/**
 * Settings → Reading: how a reply opens (the opening card), what shows while
 * the next one is written (the waiting screen) and how it ends.
 */
import {
  DEFAULT_CONFIG,
  OPENING_CARD_MIN_MS_MAX,
  OPENING_CARD_MODES,
  WAITING_BACKDROPS,
  WAITING_RECAPS,
  type VisualNovelOpeningCard,
  type VisualNovelWaitingBackdrop,
  type VisualNovelWaitingRecap,
} from "../../config.js";

export const OPENING_CARD_OPTIONS: ReadonlyArray<{ value: VisualNovelOpeningCard; label: string; help: string }> = [
  { value: "title", label: "Scene title", help: "The place, its time and weather over the card's background picture, while the reply's pictures are prepared." },
  { value: "off", label: "Off", help: "The reply starts at once." },
];

export const WAITING_BACKDROP_OPTIONS: ReadonlyArray<{ value: VisualNovelWaitingBackdrop; label: string; help: string }> = [
  { value: "card", label: "Scene card", help: "Like the opening card: the scene on the card's background picture." },
  { value: "tidy", label: "Tidy", help: "A dark veil with the scene in the middle and everyone's faces." },
  { value: "daylight", label: "Light loading screen", help: "Pale stripes, a Now loading banner and a tip." },
  { value: "cast", label: "Cast introduction", help: "Everyone fills in from a silhouette, with their names." },
  { value: "off", label: "Off", help: "Only a status line, as before." },
];

export const WAITING_RECAP_OPTIONS: ReadonlyArray<{ value: VisualNovelWaitingRecap; label: string; help: string }> = [
  { value: "auto", label: "Automatic", help: "A line-up for up to three characters, flashback cards from four." },
  { value: "lineup", label: "Cast line-up", help: "Everyone side by side with a speech bubble of one of their lines." },
  { value: "cards", label: "Flashback cards", help: "One character at a time with their last line." },
  { value: "film", label: "Scene film", help: "The reply as a strip of cards scrolling by; tap one to read it whole." },
  { value: "off", label: "Off", help: "Just the backdrop." },
];

export const WAITING_SCREEN_HELP = "While the next reply is written, the last scene's characters, lines and moves over a backdrop. Tap a character: it bounces and says its next line.";

export function normalizeOpeningCard(value: string): VisualNovelOpeningCard {
  return (OPENING_CARD_MODES as readonly string[]).includes(value) ? value as VisualNovelOpeningCard : DEFAULT_CONFIG.openingCard;
}

export function normalizeWaitingBackdrop(value: string): VisualNovelWaitingBackdrop {
  return (WAITING_BACKDROPS as readonly string[]).includes(value) ? value as VisualNovelWaitingBackdrop : DEFAULT_CONFIG.waitingBackdrop;
}

export function normalizeWaitingRecap(value: string): VisualNovelWaitingRecap {
  return (WAITING_RECAPS as readonly string[]).includes(value) ? value as VisualNovelWaitingRecap : DEFAULT_CONFIG.waitingRecap;
}

/** The opening card's shortest time from the slider (ms), clamped. */
export function openingCardMinFrom(value: string): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(OPENING_CARD_MIN_MS_MAX, Math.max(0, number)) : DEFAULT_CONFIG.openingCardMinMs;
}

/** "1.5 s", or "Only until ready" for 0. */
export function describeOpeningCardMin(ms: number): string {
  if (ms <= 0) return "until ready";
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : ms % 500 === 0 ? 1 : 2)} s`;
}
