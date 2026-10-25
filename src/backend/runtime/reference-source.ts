import type { CharacterDTO, SpindleAPI } from "lumiverse-spindle-types";
import type { TurnPlan } from "../../shared/contracts.js";
import { REFERENCE_IMAGE_MAX_BYTES } from "../../protocol.js";
import { extractInlineCardImagesWithParagraphs } from "../core/paragraphs.js";
import {
  characterAppearanceKey,
  findRegistryEntryByName,
  normalizeCharacterName,
  type CharacterRegistry
} from "../../shared/identity.js";
import { resolveCharacterAssetImageId } from "./native-assets.js";
import { loadCharacterRegistry } from "./storage.js";

/* ------------------------------------------------------------------ *
 * Card sprite resolution for reference anchoring (`referenceSource: "card"`).
 *
 * For each character the plan puts on screen, pick ONE fixed card asset as
 * that character's reference image. Resolution order, first match wins:
 *   1. an inline `<img="...">` / `<pimg="...">` tag in the paragraph where
 *      the character appears;
 *   2. a token-bounded name-prefix match over the card's asset names
 *      (canonical name, registry aliases, then single words of the name);
 *   3. the card avatar, but only on single-character cards;
 *   4. nothing — the caller falls back to the captured-render path.
 * ------------------------------------------------------------------ */

export type CardAssetResolution = {
  assetName: string;
  imageId: string;
  via: "inline" | "prefix" | "avatar";
};

/** Strip a trailing file extension from an asset name. */
function stripExtension(name: string): string {
  return name.replace(/\.[a-zA-Z0-9]{1,5}$/, "");
}

/**
 * Normalize a name for matching: lowercase, diacritics stripped, and every
 * separator run (`_`, `-`, `&`, `.`, `'`, whitespace, other punctuation)
 * collapsed to a single space. Digits are kept so numbered variants stay
 * distinguishable.
 */
export function normalizeAssetText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Token-bounded prefix match: the asset name must start with the candidate
 * name and continue with the end of the string, a separator, or trailing
 * digits followed by a separator or the end (`elizabeth2_smug`). "al" never
 * matches "alicia", because "icia" is neither a digit run nor a boundary.
 */
export function assetNameMatches(assetName: string, candidateName: string): boolean {
  const asset = normalizeAssetText(stripExtension(assetName));
  const name = normalizeAssetText(candidateName);
  if (!asset || !name || !asset.startsWith(name)) return false;
  const rest = asset.slice(name.length).replace(/^[0-9]+/, "");
  return rest === "" || rest.startsWith(" ");
}

const NEUTRAL_VARIANT = /(?:^| )(?:default|neutral|normal|idle|smile)(?: |$)/;

/**
 * Pick one asset among the names that matched a character. Preference order
 * (from the real cards, where most non-bare variants are explicit poses):
 *   1. the bare name (exact first, then a numbered bare variant),
 *   2. a neutral-ish variant (default/neutral/normal/idle/smile),
 *   3. the shortest matching name.
 * Ties break on the normalized name, never on index order (asset indexes of
 * real cards are not sorted).
 */
export function chooseCardAssetName(matches: readonly string[], candidateName: string): string | null {
  if (matches.length === 0) return null;
  const name = normalizeAssetText(candidateName);
  const scored = matches.map((original) => {
    const norm = normalizeAssetText(stripExtension(original));
    const bareExact = norm === name;
    const bareNumbered = !bareExact && norm.replace(/[0-9]+$/, "") === name && /[0-9]$/.test(norm);
    const rest = norm.slice(name.length);
    const neutral = NEUTRAL_VARIANT.test(rest);
    const rank = bareExact ? 0 : bareNumbered ? 1 : neutral ? 2 : 3;
    return { original, norm, rank };
  });
  scored.sort((left, right) =>
    left.rank - right.rank
    || left.norm.length - right.norm.length
    || (left.norm < right.norm ? -1 : left.norm > right.norm ? 1 : 0));
  return scored[0]!.original;
}

/**
 * Collect the card's asset names in index order: risu_asset_map, lumirealm
 * asset_index, lumirealm emotion_index, expressions mappings. Duplicate
 * normalized names keep their first spelling.
 */
export function collectCardAssetNames(character: CharacterDTO): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (key: string): void => {
    const norm = normalizeAssetText(stripExtension(key));
    if (!norm || seen.has(norm) || !resolveCharacterAssetImageId(character, key)) return;
    seen.add(norm);
    names.push(key);
  };
  const extensions = character.extensions ?? {};
  const risuMap = extensions["risu_asset_map"];
  if (risuMap && typeof risuMap === "object" && !Array.isArray(risuMap)) {
    for (const [key, id] of Object.entries(risuMap as Record<string, unknown>)) {
      if (typeof id === "string" && id) push(key);
    }
  }
  const lumirealm = extensions["lumirealm"];
  if (lumirealm && typeof lumirealm === "object") {
    for (const indexKey of ["asset_index", "emotion_index"] as const) {
      const index = (lumirealm as Record<string, unknown>)[indexKey];
      if (!index || typeof index !== "object" || Array.isArray(index)) continue;
      for (const key of Object.keys(index as Record<string, unknown>)) push(key);
    }
  }
  const expressions = extensions["expressions"];
  if (expressions && typeof expressions === "object") {
    const mappings = (expressions as Record<string, unknown>)["mappings"];
    if (mappings && typeof mappings === "object" && !Array.isArray(mappings)) {
      for (const [key, id] of Object.entries(mappings as Record<string, unknown>)) {
        if (typeof id === "string" && id) push(key);
      }
    }
  }
  return names;
}

/** All matches for one candidate name over the card's asset names. */
function matchesFor(assetNames: readonly string[], candidateName: string): string[] {
  return assetNames.filter((assetName) => assetNameMatches(assetName, candidateName));
}

/**
 * Resolve one character's card asset by name-prefix matching. Full names
 * (canonical name and registry aliases) are tried first; single words of
 * those names (last word, then first) only when no full name matched.
 */
export function matchCardAssetForNames(assetNames: readonly string[], names: readonly string[]): string | null {
  for (const name of names) {
    const chosen = chooseCardAssetName(matchesFor(assetNames, name), name);
    if (chosen) return chosen;
  }
  for (const name of names) {
    const words = normalizeAssetText(name).split(" ").filter((word) => word.length >= 2);
    if (words.length < 2) continue;
    const ordered = [words[words.length - 1]!, words[0]!, ...words.slice(1, -1)];
    for (const word of ordered) {
      const chosen = chooseCardAssetName(matchesFor(assetNames, word), word);
      if (chosen) return chosen;
    }
  }
  return null;
}

type PlanCharacter = { name: string; key: string };

/** Distinct on-screen characters in cue order. */
function planCharacters(plan: TurnPlan): PlanCharacter[] {
  const characters: PlanCharacter[] = [];
  const seen = new Set<string>();
  for (const cue of plan.visualCues) {
    const scene = plan.scenes.find((candidate) => candidate.sceneId === cue.sceneId && candidate.revision === cue.sceneRevision);
    const name = normalizeCharacterName(cue.character || scene?.character || scene?.cast[0] || "");
    const key = characterAppearanceKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    characters.push({ name, key });
  }
  return characters;
}

/** Candidate names for a character: canonical registry name, aliases, then the display name. */
function candidateNamesFor(registry: CharacterRegistry, name: string): string[] {
  const names: string[] = [];
  const push = (value: string): void => {
    const clean = normalizeCharacterName(value);
    if (clean && !names.some((existing) => characterAppearanceKey(existing) === characterAppearanceKey(clean))) names.push(clean);
  };
  const entry = findRegistryEntryByName(registry, name);
  if (entry) {
    push(entry.name);
    for (const alias of entry.aliases) push(alias);
  }
  push(name);
  return names;
}

/**
 * Whether an inline tag is character-like for a display name: it matches one
 * of the candidate names (canonical registry name, aliases, display name) by
 * token-bounded prefix, either as a full name or as a single word of it.
 */
function tagMatchesCandidate(tag: string, registry: CharacterRegistry, name: string): boolean {
  return candidateNamesFor(registry, name).some((candidate) =>
    assetNameMatches(tag, candidate)
    || normalizeAssetText(candidate).split(" ").some((word) => word.length >= 2 && assetNameMatches(tag, word)));
}

/** Whether a card asset matches any of the given names (full or single word). */
function assetMatchesAnyName(assetName: string, names: readonly string[]): boolean {
  return names.some((name) =>
    assetNameMatches(assetName, name)
    || normalizeAssetText(name).split(" ").some((word) => word.length >= 2 && assetNameMatches(assetName, word)));
}

export type ResolveCardAssetsInput = {
  plan: TurnPlan;
  character: CharacterDTO;
  /** Exact resolved source used to build this plan (tags intact); "" skips step 1. */
  content: string;
  registry: CharacterRegistry;
};

/**
 * Resolve a card asset for every on-screen character of a plan. Characters
 * without an entry in the returned map fall back to the captured path.
 */
export function resolveCardAssetsForPlan(input: ResolveCardAssetsInput): Map<string, CardAssetResolution> {
  const { plan, character, content, registry } = input;
  const resolutions = new Map<string, CardAssetResolution>();
  const characters = planCharacters(plan);
  if (characters.length === 0) return resolutions;
  const assetNames = collectCardAssetNames(character);

  /* Step 1: inline tags, paired through the paragraph -> character mapping. */
  if (content) {
    const tagsByParagraph = new Map<number, string[]>();
    for (const item of extractInlineCardImagesWithParagraphs(content, plan.paragraphs)) {
      if (!resolveCharacterAssetImageId(character, item.name)) continue;
      const list = tagsByParagraph.get(item.paragraphIndex) ?? [];
      list.push(item.name);
      tagsByParagraph.set(item.paragraphIndex, list);
    }
    const charactersByParagraph = new Map<number, PlanCharacter[]>();
    for (const cue of plan.visualCues) {
      const scene = plan.scenes.find((candidate) => candidate.sceneId === cue.sceneId && candidate.revision === cue.sceneRevision);
      const name = normalizeCharacterName(cue.character || scene?.character || scene?.cast[0] || "");
      const key = characterAppearanceKey(name);
      if (!key) continue;
      const list = charactersByParagraph.get(cue.paragraphIndex) ?? [];
      if (!list.some((existing) => existing.key === key)) list.push({ name, key });
      charactersByParagraph.set(cue.paragraphIndex, list);
    }
    const assign = (key: string, assetName: string): void => {
      if (resolutions.has(key)) return;
      const imageId = resolveCharacterAssetImageId(character, assetName);
      if (imageId) resolutions.set(key, { assetName, imageId, via: "inline" });
    };
    for (const [paragraphIndex, tags] of tagsByParagraph) {
      const present = charactersByParagraph.get(paragraphIndex) ?? [];
      if (present.length === 1 && tags.length === 1) {
        // The tag becomes a portrait only when it is character-like: it must
        // match the character's name or alias by token-bounded prefix (full
        // name or a single word of it). A lone background/item asset never
        // anchors a character, and a tag from an unrendered conditional branch
        // for another character never hijacks this one. Drifted spellings
        // without a registry alias do not assign; add the alias instead.
        if (tagMatchesCandidate(tags[0]!, registry, present[0]!.name)) {
          assign(present[0]!.key, tags[0]!);
        }
        continue;
      }
      // Several characters or several tags: pair by name similarity, skip
      // any tag that matches zero or more than one present character.
      for (const tag of tags) {
        const owners = present.filter((candidate) =>
          candidateNamesFor(registry, candidate.name).some((name) =>
            assetNameMatches(tag, name)
            || normalizeAssetText(name).split(" ").some((word) => word.length >= 2 && assetNameMatches(tag, word))));
        if (owners.length === 1) assign(owners[0]!.key, tag);
      }
    }
  }

  /* Step 2: token-bounded name-prefix matching. */
  const hasPrefixMatch = new Map<string, boolean>();
  const singleWordMatch = new Map<string, boolean>();
  const candidateNames = new Map<string, string[]>();
  for (const candidate of characters) {
    const names = candidateNamesFor(registry, candidate.name);
    candidateNames.set(candidate.key, names);
    const chosen = matchCardAssetForNames(assetNames, names);
    hasPrefixMatch.set(candidate.key, chosen !== null);
    // A match counts as single-word when no full candidate name produced it.
    let single = false;
    if (chosen) {
      single = !names.some((name) => chooseCardAssetName(matchesFor(assetNames, name), name) === chosen);
      singleWordMatch.set(candidate.key, single);
    }
    if (chosen && !resolutions.has(candidate.key)) {
      const imageId = resolveCharacterAssetImageId(character, chosen);
      if (imageId) resolutions.set(candidate.key, { assetName: chosen, imageId, via: "prefix" });
    }
  }

  /* Step 2b: uniqueness. Distinct characters never share one sprite. */
  // Same image claimed twice: a lone full-name owner keeps it and only
  // single-word claimants fall back; otherwise every claimant falls back.
  const claimantsByImage = new Map<string, string[]>();
  for (const [key, resolution] of resolutions) {
    const list = claimantsByImage.get(resolution.imageId) ?? [];
    list.push(key);
    claimantsByImage.set(resolution.imageId, list);
  }
  for (const keys of claimantsByImage.values()) {
    if (keys.length < 2) continue;
    const full = keys.filter((key) => !singleWordMatch.get(key));
    const drop = full.length === 1 ? keys.filter((key) => singleWordMatch.get(key)) : keys;
    for (const key of drop) {
      resolutions.delete(key);
      hasPrefixMatch.set(key, false);
      singleWordMatch.delete(key);
    }
  }
  // A single-word fallback that also matches another known character
  // (on-screen or in the registry) is ambiguous: drop it.
  for (const candidate of characters) {
    if (!singleWordMatch.get(candidate.key)) continue;
    const resolution = resolutions.get(candidate.key);
    if (!resolution) continue;
    const assetName = resolution.assetName;
    let ambiguous = false;
    for (const other of characters) {
      if (other.key === candidate.key) continue;
      if (assetMatchesAnyName(assetName, candidateNames.get(other.key) ?? [])) {
        ambiguous = true;
        break;
      }
    }
    if (!ambiguous) {
      const ownId = findRegistryEntryByName(registry, candidate.name)?.id;
      for (const entry of Object.values(registry)) {
        if (ownId && entry.id === ownId) continue;
        if (assetMatchesAnyName(assetName, [entry.name, ...entry.aliases])) {
          ambiguous = true;
          break;
        }
      }
    }
    if (ambiguous) {
      resolutions.delete(candidate.key);
      hasPrefixMatch.set(candidate.key, false);
    }
  }

  /* Step 3: card avatar, single-character cards only. */
  const cardNameKey = characterAppearanceKey(normalizeCharacterName(character.name ?? ""));
  for (const candidate of characters) {
    if (resolutions.has(candidate.key) || !character.image_id) continue;
    const namesOwnCard = candidateNamesFor(registry, candidate.name)
      .some((name) => characterAppearanceKey(name) === cardNameKey);
    if (!namesOwnCard) continue;
    const othersMatch = characters.some((other) => other.key !== candidate.key && hasPrefixMatch.get(other.key));
    if (othersMatch) continue;
    resolutions.set(candidate.key, { assetName: "", imageId: character.image_id, via: "avatar" });
  }

  return resolutions;
}

/* ------------------------------------------------------------------ *
 * Host lookups: the card and registry. Text must come from the accepted plan.
 * ------------------------------------------------------------------ */

export type CardReferenceContext = {
  resolutions: Map<string, CardAssetResolution>;
};

async function chatCharacter(spindle: SpindleAPI, chatId: string, userId?: string): Promise<CharacterDTO | null> {
  // A chat without a character_id (group chats, user-created chats) gets NO
  // card portrait: the caller falls back to the captured path. Never borrow
  // an unrelated character from the host list.
  try {
    const chat = await spindle.chats.get(chatId, userId);
    if (!chat?.character_id) return null;
    return await spindle.characters.get(chat.character_id, userId) ?? null;
  } catch {
    return null;
  }
}

/** Asset names a card uses for its own background picture, in order of preference. */
export const CARD_BACKGROUND_ASSET_NAMES = ["bg", "background", "배경", "backdrop"] as const;

/** The image id of the card's background picture (an asset named `bg`, `background` or `배경`), or null. */
export function cardBackgroundImageId(character: CharacterDTO): string | null {
  for (const name of CARD_BACKGROUND_ASSET_NAMES) {
    const id = resolveCharacterAssetImageId(character, name);
    if (id) return id;
  }
  return null;
}

/**
 * The URL of the chat card's background picture, for the stage's opening card
 * and waiting screen. Null when the chat has no card or the card has no such
 * asset; any host failure is null too.
 */
export async function loadCardBackgroundUrl(spindle: SpindleAPI, chatId: string, userId?: string): Promise<string | null> {
  const character = await chatCharacter(spindle, chatId, userId);
  const id = character ? cardBackgroundImageId(character) : null;
  return id ? `/api/v1/images/${encodeURIComponent(id)}` : null;
}

/**
 * Resolve card assets for a plan's characters. Called only when
 * `referenceSource` is "card"; any host failure yields null and the whole
 * batch falls back to the captured path.
 */
export async function loadCardReferenceContext(
  spindle: SpindleAPI,
  plan: TurnPlan,
  userId?: string,
  options: { resolvedSourceText?: string } = {}
): Promise<CardReferenceContext | null> {
  const character = await chatCharacter(spindle, plan.key.chatId, userId);
  if (!character) return null;
  // Only the exact source which produced this plan has compatible paragraph
  // indexes. Legacy records skip inline matching; never read a newer swipe or
  // independently re-resolve mutable macros here.
  const content = options.resolvedSourceText ?? "";
  const registry = await loadCharacterRegistry(spindle, plan.key.chatId, userId).catch(() => ({} as CharacterRegistry));
  try {
    return { resolutions: resolveCardAssetsForPlan({ plan, character, content, registry }) };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Frontend relay: the backend cannot read image bytes, so it asks the
 * logged-in frontend to fetch the asset and reply with a data URL.
 * ------------------------------------------------------------------ */

export const REFERENCE_FETCH_TIMEOUT_MS = 5000;

/** Base64 expands bytes by 4/3; allow the data-URL header on top. */
const MAX_RELAY_CHARS = Math.ceil(REFERENCE_IMAGE_MAX_BYTES * 4 / 3) + 64;

type RelayReply = { dataUrl?: string; error?: string };

const pendingReferenceFetches = new Map<string, (reply: RelayReply) => void>();

/**
 * Route a `vn_reference_image` frontend reply to its waiting fetch. Unknown
 * or already-settled request ids are ignored (e.g. a reply after the
 * timeout). Returns whether a fetch was waiting.
 */
export function handleReferenceImageResponse(reply: { requestId: string; dataUrl?: string; error?: string }): boolean {
  const resolve = pendingReferenceFetches.get(reply.requestId);
  if (!resolve) return false;
  pendingReferenceFetches.delete(reply.requestId);
  resolve({ ...(reply.dataUrl !== undefined ? { dataUrl: reply.dataUrl } : {}), ...(reply.error !== undefined ? { error: reply.error } : {}) });
  return true;
}

export type ReferenceFetchOptions = {
  chatId: string;
  imageId: string;
  characterKey: string;
  userId?: string | undefined;
  timeoutMs?: number | undefined;
  /** Abort the wait: resolves null at once. This function never persists data. */
  signal?: AbortSignal | undefined;
};

/**
 * Ask the frontend for the bytes of `imageId` and wait for the relayed data
 * URL. Resolves null on timeout, error reply, or an oversize payload; it
 * never rejects, so a broken relay can only cost the timeout, not the batch.
 * The data URL is returned unparsed; the caller validates MIME and size and
 * must never log the base64 body.
 */
export async function fetchReferenceImageViaFrontend(
  spindle: SpindleAPI,
  options: ReferenceFetchOptions
): Promise<string | null> {
  const timeoutMs = options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs)
    ? Math.min(30000, Math.max(250, options.timeoutMs))
    : REFERENCE_FETCH_TIMEOUT_MS;
  if (options.signal?.aborted) return null;
  const requestId = crypto.randomUUID();
  const reply = await new Promise<RelayReply | null>((resolve) => {
    let settled = false;
    const cleanup = (): void => {
      options.signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      pendingReferenceFetches.delete(requestId);
      cleanup();
      resolve(null);
    }, timeoutMs);
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingReferenceFetches.delete(requestId);
      cleanup();
      resolve(null);
    };
    pendingReferenceFetches.set(requestId, (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(value);
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      spindle.sendToFrontend({
        type: "vn_reference_fetch",
        chatId: options.chatId,
        requestId,
        imageId: options.imageId,
        characterKey: options.characterKey
      }, options.userId);
    } catch {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingReferenceFetches.delete(requestId);
      cleanup();
      resolve(null);
    }
  });
  // A reply that arrived after abort/timeout finds no pending fetch and was
  // already dropped; a late arrival here still never persists (the caller
  // checks the signal again before storing).
  if (options.signal?.aborted) return null;
  if (!reply || reply.error || typeof reply.dataUrl !== "string") return null;
  if (reply.dataUrl.length > MAX_RELAY_CHARS) return null;
  return reply.dataUrl;
}
