import type { ContinuityState, IndexedContinuityDelta } from "../../shared/contracts.js";
import { appearanceMapKeyFor, characterAppearanceKey, distillVisualTags, type CharacterAppearanceMap } from "../../shared/identity.js";

type Proposal = { startParagraph: number; character?: string | null | undefined; cast: string[]; attire?: string | null | undefined };
type Cue = { paragraphIndex: number; character?: string | null | undefined; attire?: string | null | undefined };
export type CueSnapshot = { character: string; identity: string; attire: string | null };

/** Resolve subjects and wardrobe in reading order, independently of image limits and scene boundaries. */
export function resolveCueTimeline(input: {
  paragraphs: number; proposals: Proposal[]; cues: Cue[];
  roster: Array<{ name: string; description: string }>;
  appearances: CharacterAppearanceMap;
  baseline: { name: string; identity: string };
  previousCharacter: string; previousAttire: string | null;
  continuity: ContinuityState;
  isPersona: (name: string | null | undefined) => boolean;
  isReset: (value: string) => boolean;
}): { snapshots: CueSnapshot[]; deltas: IndexedContinuityDelta[] } {
  const wardrobe = new Map<string, string | null>();
  const names = new Map<string, string>();
  for (const [name, state] of Object.entries(input.continuity.characters)) {
    const key = characterAppearanceKey(name); names.set(key, name);
    wardrobe.set(key, state.wardrobe.attire ?? null);
  }
  const previousKey = characterAppearanceKey(input.previousCharacter);
  if (previousKey && !wardrobe.has(previousKey)) wardrobe.set(previousKey, input.previousAttire);
  let character = input.previousCharacter || input.baseline.name;
  const snapshots: CueSnapshot[] = [];
  const deltas: IndexedContinuityDelta[] = [];
  const available = input.roster.filter((c) => !input.isPersona(c.name));
  const identityFor = (name: string): string => {
    const key = appearanceMapKeyFor(input.appearances, name);
    if (key) return input.appearances[key] ?? "";
    const extracted = available.find((c) => characterAppearanceKey(c.name) === characterAppearanceKey(name));
    if (extracted) {
      const tags = distillVisualTags(extracted.description);
      if (tags.length) return tags.join(", ");
    }
    // The fallback belongs to exactly one entity, never to the whole scene.
    return characterAppearanceKey(name) === characterAppearanceKey(input.baseline.name) ? input.baseline.identity : "";
  };
  const valid = (name: string | null | undefined) => name && !input.isPersona(name) ? name : "";
  for (let p = 0; p < input.paragraphs; p++) {
    const updates: Record<string, { wardrobe: { attire: string | null } }> = {};
    const dress = (name: string, attire: string | null | undefined) => {
      if (!attire?.trim() || !name) return;
      const key = characterAppearanceKey(name);
      const next = input.isReset(attire) ? null : attire.trim();
      if ((wardrobe.get(key) ?? null) !== next) updates[names.get(key) ?? name] = { wardrobe: { attire: next } };
      wardrobe.set(key, next); names.set(key, names.get(key) ?? name);
    };
    for (const proposal of input.proposals.filter((s) => s.startParagraph === p)) {
      const openingCue = input.cues.find((c) => c.paragraphIndex === p && valid(c.character));
      character = valid(proposal.character) || proposal.cast.find((n) => valid(n)) || valid(openingCue?.character)
        || (p === 0 && available.length === 1 ? available[0]!.name : "") || character;
      if (!input.isPersona(proposal.character)) dress(character, proposal.attire);
    }
    // Match the planner's first-cue-wins deduplication policy.
    const cue = input.cues.find((c) => c.paragraphIndex === p);
    if (cue) {
      character = valid(cue.character) || character;
      if (!input.isPersona(cue.character)) dress(character, cue.attire);
    }
    snapshots.push({ character, identity: identityFor(character), attire: wardrobe.get(characterAppearanceKey(character)) ?? null });
    if (Object.keys(updates).length) deltas.push({ paragraphIndex: p, delta: { characterUpdates: updates, forgetCharacters: [], factUpdates: {} } });
  }
  return { snapshots, deltas };
}
