import type { ContinuityState, IndexedContinuityDelta } from "../../shared/contracts.js";
import {
  appearanceMapKeyFor,
  canonicalCharacterName,
  characterAppearanceKey,
  characterIdFor,
  distillVisualTags,
  resolveCharacterReference,
  subjectCategoryFromTags,
  type CharacterAppearanceMap,
  type CharacterRegistry,
  type SubjectCategory
} from "../../shared/identity.js";

type Reference = { character?: string | null | undefined; characterId?: string | null | undefined };
type Proposal = Reference & { startParagraph: number; cast: string[]; attire?: string | null | undefined };
type Cue = Reference & { paragraphIndex: number; attire?: string | null | undefined };
export type CueSnapshot = {
  character: string;
  /** Stable registry id of `character` (derived from the canonical name when unregistered). */
  characterId: string;
  /** Durable subject class, persisted separately from anatomy. */
  subjectCategory: SubjectCategory;
  identity: string;
  attire: string | null;
};

/**
 * Resolve subjects and wardrobe in reading order, independently of image limits and scene boundaries.
 *
 * Every planner reference (scene character, cast member, cue character) is
 * resolved to its canonical registry name BEFORE the timeline is walked:
 * an explicit `characterId` wins, then the canonical name, then an explicit
 * alias. "Fox girl" therefore continues Kitsune's body and wardrobe only when
 * the registry declares that alias; an unknown name stays a new subject.
 */
export function resolveCueTimeline(input: {
  paragraphs: number; proposals: Proposal[]; cues: Cue[];
  roster: Array<{ name: string; description: string }>;
  appearances: CharacterAppearanceMap;
  registry?: CharacterRegistry;
  baseline: { name: string; identity: string };
  previousCharacter: string; previousAttire: string | null;
  continuity: ContinuityState;
  isPersona: (name: string | null | undefined) => boolean;
  isReset: (value: string) => boolean;
}): { snapshots: CueSnapshot[]; deltas: IndexedContinuityDelta[] } {
  const registry = input.registry ?? {};
  const canon = (reference: Reference | string | null | undefined): string => {
    if (reference === null || reference === undefined) return "";
    const ref = typeof reference === "string" ? { character: reference } : reference;
    const name = ref.character ?? "";
    if (!name && !ref.characterId) return "";
    return canonicalCharacterName(registry, { name, characterId: ref.characterId }) || name.trim();
  };
  const wardrobe = new Map<string, string | null>();
  const names = new Map<string, string>();
  for (const [name, state] of Object.entries(input.continuity.characters)) {
    // Fold wardrobe recorded under an alias into the canonical entry so a
    // renamed reference keeps its outfit; the first recorded outfit wins.
    const canonical = canon(name) || name;
    const key = characterAppearanceKey(canonical);
    if (!names.has(key)) names.set(key, canonical);
    const attire = state.wardrobe.attire ?? null;
    if (!wardrobe.has(key) || (wardrobe.get(key) === null && attire !== null)) wardrobe.set(key, attire);
  }
  const previousCharacter = canon(input.previousCharacter);
  const previousKey = characterAppearanceKey(previousCharacter);
  if (previousKey && !wardrobe.has(previousKey)) wardrobe.set(previousKey, input.previousAttire);
  const baselineName = canon(input.baseline.name);
  let character = previousCharacter || baselineName;
  const snapshots: CueSnapshot[] = [];
  const deltas: IndexedContinuityDelta[] = [];
  const available = input.roster
    .map((c) => ({ ...c, name: canon(c.name) || c.name }))
    .filter((c) => !input.isPersona(c.name));
  const identityFor = (name: string): string => {
    // The chat registry's stable baseline outranks any appearance-map entry,
    // so a global or relearned description cannot redefine a known body.
    const entry = resolveCharacterReference(registry, { name });
    if (entry?.tags.trim()) return entry.tags;
    const key = appearanceMapKeyFor(input.appearances, name);
    if (key) return input.appearances[key] ?? "";
    const extracted = available.find((c) => characterAppearanceKey(c.name) === characterAppearanceKey(name));
    if (extracted) {
      const tags = distillVisualTags(extracted.description);
      if (tags.length) return tags.join(", ");
    }
    // The fallback belongs to exactly one entity, never to the whole scene.
    return characterAppearanceKey(name) === characterAppearanceKey(baselineName) ? input.baseline.identity : "";
  };
  const describe = (name: string, identity: string): Pick<CueSnapshot, "characterId" | "subjectCategory"> => {
    const entry = resolveCharacterReference(registry, { name });
    const characterId = entry?.id ?? characterIdFor(name);
    const subjectCategory: SubjectCategory = entry && entry.subjectCategory !== "unknown"
      ? entry.subjectCategory
      : subjectCategoryFromTags(identity);
    return { characterId, subjectCategory };
  };
  const valid = (reference: Reference | string | null | undefined) => {
    const name = canon(reference);
    return name && !input.isPersona(name) ? name : "";
  };
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
      const openingCue = input.cues.find((c) => c.paragraphIndex === p && valid(c));
      character = valid(proposal) || proposal.cast.map((n) => valid(n)).find(Boolean) || valid(openingCue)
        || (p === 0 && available.length === 1 ? available[0]!.name : "") || character;
      if (!input.isPersona(canon(proposal))) dress(character, proposal.attire);
    }
    // Match the planner's first-cue-wins deduplication policy.
    const cue = input.cues.find((c) => c.paragraphIndex === p);
    if (cue) {
      character = valid(cue) || character;
      if (!input.isPersona(canon(cue))) dress(character, cue.attire);
    }
    const identity = identityFor(character);
    snapshots.push({ character, ...describe(character, identity), identity, attire: wardrobe.get(characterAppearanceKey(character)) ?? null });
    if (Object.keys(updates).length) deltas.push({ paragraphIndex: p, delta: { characterUpdates: updates, forgetCharacters: [], factUpdates: {} } });
  }
  return { snapshots, deltas };
}
