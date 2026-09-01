import {
  SINGLE_CHARACTER_SCHEMA_VERSION,
  tagBlockFor,
  type SingleCharacterIdentity,
  type SingleCharacterState
} from "../../shared/character.js";

/** Fallback environment descriptor used when a stored record carries none. */
export const DEFAULT_ENVIRONMENT_DESCRIPTOR = "A coherent visual-novel environment in a visual novel scene.";

const EPOCH = new Date(0).toISOString();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function environmentString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_ENVIRONMENT_DESCRIPTOR;
}

function updatedAtString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : EPOCH;
}

/**
 * Normalize a single raw tag: trim and collapse internal whitespace. A tag is
 * considered non-empty after this normalization.
 */
function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Split a comma-separated description into normalized, de-duplicated tags.
 * Robust handling: trims each tag, collapses internal whitespace, drops empty
 * entries, and de-duplicates case-insensitively while preserving first-seen
 * order and original casing. This is what makes a seeded identity stable.
 */
export function splitDescriptionTags(description: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of description.split(/\s*,\s*/)) {
    const tag = normalizeTag(raw);
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }
  return tags;
}

/** Normalize a raw tag array to the same guarantees as `splitDescriptionTags`. */
function normalizeTagsFromArray(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = normalizeTag(raw);
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      normalized.push(tag);
    }
  }
  return normalized;
}

/**
 * The empty single-character state. `environment` may be supplied for the
 * initial scene; otherwise a default descriptor is used. Nothing is mutated
 * afterwards — this is a fresh, unseeded identity.
 */
export function emptySingleCharacter(environment: string = DEFAULT_ENVIRONMENT_DESCRIPTOR): SingleCharacterState {
  return {
    schemaVersion: SINGLE_CHARACTER_SCHEMA_VERSION,
    protagonist: { name: "", tags: [] },
    environment,
    updatedAt: EPOCH
  };
}

/**
 * Seed the protagonist identity from a display `name` and a comma-separated
 * `description`. The description is split into normalized, de-duplicated tags.
 * After this initial seed the identity is frozen: later turns must not re-seed
 * it (the registry never mutates protagonist.tags).
 */
export function seedSingleCharacter(name: string, description: string): SingleCharacterState {
  return {
    schemaVersion: SINGLE_CHARACTER_SCHEMA_VERSION,
    protagonist: {
      name: name.trim(),
      tags: splitDescriptionTags(description)
    },
    environment: DEFAULT_ENVIRONMENT_DESCRIPTOR,
    updatedAt: new Date().toISOString()
  };
}

/** Render the frozen identity block (comma-separated tags) for a state. */
export function singleCharacterTagBlock(state: SingleCharacterState): string {
  return tagBlockFor(state.protagonist);
}

/* ------------------------------------------------------------------ *
 * Legacy visual-profile helpers.
 *
 * These are PRIVATE migration helpers used only to read old
 * `{ schemaVersion: 1, profiles }` records on disk and promote a single
 * protagonist. They are intentionally non-destructive and pure; they are no
 * longer part of the public visual-state contract.
 * ------------------------------------------------------------------ */

type LegacyProfile = {
  name: string;
  description: string;
};

type LegacyProfileState = Record<string /*lowercased name*/, LegacyProfile>;

function profileFor(existing: LegacyProfileState, name: string): LegacyProfile | undefined {
  return existing[name.trim().toLowerCase()];
}

/** Parse a legacy flat profile map (or the `.profiles` sub-object) into a state. */
function parseProfiles(value: unknown): LegacyProfileState {
  if (!value || typeof value !== "object") return {};
  const next: LegacyProfileState = {};
  for (const [, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    if (!name || !description) continue;
    next[name.toLowerCase()] = { name, description };
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * Schema-v1 -> single-character migration / normalization.
 * ------------------------------------------------------------------ */

/**
 * Locate the legacy profile record within a raw stored value. A stored v1
 * record is `{ schemaVersion: 1, profiles: { ... } }`; the profile map may
 * also be stored ungated (`{ mira: {...} }`), which this handles too.
 */
function profileRecordOf(record: Record<string, unknown>): unknown {
  const nested = record.profiles;
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested : record;
}

/** Convert a legacy profile map to a single-character identity. */
function identityFromProfiles(profiles: LegacyProfileState, preferredName: string | undefined): SingleCharacterIdentity | null {
  const values = Object.values(profiles);
  let selected: LegacyProfile | undefined;
  if (preferredName) {
    selected = profileFor(profiles, preferredName);
  }
  if (!selected) selected = values[0];
  if (!selected || !selected.name) return null;
  return {
    name: selected.name,
    tags: splitDescriptionTags(selected.description)
  };
}

/**
 * Normalize / migrate any stored visual-state value into a valid
 * `SingleCharacterState`:
 *  - a new-style record (has `protagonist`) is cleaned in place;
 *  - a legacy v1 profile record (`{ schemaVersion: 1, profiles }`) has its
 *    first profile (or an optional preferred name) promoted to the frozen
 *    protagonist and its description split into tags;
 *  - anything else falls back to the empty state.
 *
 * Pure: never mutates its input.
 */
export function normalizeSingleCharacter(value: unknown, preferredName?: string): SingleCharacterState {
  if (!isRecord(value)) return emptySingleCharacter();

  // Already a new-style single-character record.
  if (value.protagonist && isRecord(value.protagonist)) {
    const p = value.protagonist;
    const name = typeof p.name === "string" ? p.name.trim() : "";
    const tags = normalizeTagsFromArray(p.tags);
    return {
      schemaVersion: SINGLE_CHARACTER_SCHEMA_VERSION,
      protagonist: { name, tags },
      environment: environmentString(value.environment),
      updatedAt: updatedAtString(value.updatedAt)
    };
  }

  // Legacy v1 profile record.
  const profiles = parseProfiles(profileRecordOf(value));
  const identity = identityFromProfiles(profiles, preferredName);
  if (identity) {
    return {
      schemaVersion: SINGLE_CHARACTER_SCHEMA_VERSION,
      protagonist: identity,
      environment: environmentString(value.environment),
      updatedAt: updatedAtString(value.updatedAt)
    };
  }

  return emptySingleCharacter(environmentString(value.environment));
}
