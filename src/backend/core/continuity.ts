import type {
  CharacterContinuity,
  CharacterContinuityPatch,
  ContinuityDelta,
  ContinuityState,
  IndexedContinuityDelta
} from "../../shared/contracts.js";
import { ContinuityStateSchema } from "../../shared/contracts.js";

function sortedRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

function patchStringRecord(base: Record<string, string>, patch?: Record<string, string | null>): Record<string, string> {
  const next = new Map(Object.entries(base));
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  return sortedRecord(next);
}

function patchCharacter(current: CharacterContinuity | undefined, patch: CharacterContinuityPatch): CharacterContinuity {
  const base: CharacterContinuity = current ?? {
    present: true,
    appearance: {},
    wardrobe: {},
    pose: null,
    expression: null,
    props: []
  };
  return {
    present: patch.present ?? base.present,
    appearance: patchStringRecord(base.appearance, patch.appearance),
    wardrobe: patchStringRecord(base.wardrobe, patch.wardrobe),
    pose: patch.pose === undefined ? base.pose : patch.pose,
    expression: patch.expression === undefined ? base.expression : patch.expression,
    props: patch.props === undefined ? [...base.props] : [...new Set(patch.props)].sort()
  };
}

export function applyContinuityDelta(state: ContinuityState, delta: ContinuityDelta): ContinuityState {
  const characters = new Map(Object.entries(state.characters));
  for (const name of delta.forgetCharacters) characters.delete(name);
  for (const [name, patch] of Object.entries(delta.characterUpdates)) {
    characters.set(name, patchCharacter(characters.get(name), patch));
  }

  const facts = new Map(Object.entries(state.facts));
  for (const [key, value] of Object.entries(delta.factUpdates)) {
    if (value === null) facts.delete(key);
    else facts.set(key, value);
  }

  return ContinuityStateSchema.parse({
    revision: state.revision + 1,
    characters: sortedRecord(characters),
    facts: sortedRecord(facts)
  });
}

export function reduceContinuity(initial: ContinuityState, deltas: readonly IndexedContinuityDelta[]): ContinuityState {
  let lastParagraph = -1;
  let state = ContinuityStateSchema.parse(initial);
  for (const item of deltas) {
    if (item.paragraphIndex < lastParagraph) throw new Error("Continuity deltas must be ordered by paragraph.");
    lastParagraph = item.paragraphIndex;
    state = applyContinuityDelta(state, item.delta);
  }
  return state;
}

export function continuityEquals(left: ContinuityState, right: ContinuityState): boolean {
  const normalize = (state: ContinuityState): string => JSON.stringify(ContinuityStateSchema.parse({
    ...state,
    characters: sortedRecord(Object.entries(state.characters).map(([name, character]) => [name, {
      ...character,
      appearance: sortedRecord(Object.entries(character.appearance)),
      wardrobe: sortedRecord(Object.entries(character.wardrobe)),
      props: [...new Set(character.props)].sort()
    }] as const)),
    facts: sortedRecord(Object.entries(state.facts))
  }));
  return normalize(left) === normalize(right);
}

