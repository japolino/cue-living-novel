import type {
  ActivatedWorldInfoEntryDTO,
  CharacterDTO,
  PersonaDTO,
  SpindleAPI,
  WorldBookEntryDTO,
  WorldBookSourceDTO
} from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../config.js";

const MAX_ACTIVATED_ENTRIES = 16;
const MAX_LORE_LENGTH = 3600;
const MAX_LORE_ENTRY_LENGTH = 900;
const MAX_CHARACTER_CONTEXT = 5200;
const MAX_PERSONA_CONTEXT = 2600;
const MAX_IDENTITY_PROMPT = 2600;

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "before", "being", "from", "have", "into", "more", "other", "over",
  "that", "their", "them", "then", "there", "these", "they", "this", "through", "under", "when", "where",
  "which", "while", "with", "would", "your"
]);

const VISUAL_TERMS = /\b(?:appearance|attire|body|build|clothes?|coat|dress|eyes?|face|freckles|hair|horns?|jacket|pants|robe|scar|shirt|shoes?|skin|skirt|species|suit|tail|tattoo|uniform|wears?|wearing|wings?|architecture|background|castle|city|forest|interior|exterior|lighting|moonlight|rain|room|snow|street|sunlight|temple|weather|weapon|window)\b/i;

export type VisualContextDiagnostics = {
  chatLoaded: boolean;
  characterLoaded: boolean;
  personaLoaded: boolean;
  loreActivated: number;
  loreIncluded: number;
  errors: string[];
};

export type StructuredCharacterIdentity = {
  /** Character display name. */
  name: string;
  /** Full character-card description (never discarded). */
  description: string;
  /** Stable / curated card appearance tags. */
  tags: string[];
};

export type VisualContextSnapshot = {
  plannerContext: string;
  identityPrompt: string;
  /** Structured, non-lossy character identity (name + full description + stable tags). */
  characterIdentity: StructuredCharacterIdentity | null;
  /** Structured user persona identity (name + title + description). */
  personaIdentity?: { name: string; title: string; description: string } | null;
  diagnostics: VisualContextDiagnostics;
};

type ResolvedLore = {
  activation: ActivatedWorldInfoEntryDTO;
  entry: WorldBookEntryDTO;
  index: number;
  content: string;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
}

function compact(value: string, maximum: number): string {
  const normalized = value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= maximum) return normalized;
  const marker = "\n...[truncated]";
  return `${normalized.slice(0, Math.max(0, maximum - marker.length)).trimEnd()}${marker}`;
}

function line(label: string, value: unknown): string {
  const text = clean(value);
  return text ? `${label}: ${text}` : "";
}

function block(title: string, lines: readonly string[], maximum: number): string {
  const content = lines.map((item) => item.trim()).filter(Boolean);
  return content.length ? compact([`## ${title}`, ...content].join("\n"), maximum) : "";
}

function characterContext(character: CharacterDTO | null): string {
  if (!character) return "";
  return block("Character card", [
    line("Name", character.name),
    line("Description", character.description),
    line("Personality", character.personality),
    line("Scenario", character.scenario),
    line("Creator notes", character.creator_notes),
    character.tags.length ? `Tags: ${character.tags.join(", ")}` : ""
  ], MAX_CHARACTER_CONTEXT);
}

function personaContext(persona: PersonaDTO | null): string {
  if (!persona) return "";
  return block("User persona", [
    line("Name", persona.name),
    line("Title", persona.title),
    line("Description", persona.description)
  ], MAX_PERSONA_CONTEXT);
}

function visualIdentity(character: CharacterDTO | null, persona: PersonaDTO | null): string {
  const rows: string[] = [];
  if (character) {
    rows.push([
      `Character ${character.name}`,
      clean(character.description),
      character.tags.length ? `stable tags: ${character.tags.join(", ")}` : ""
    ].filter(Boolean).join("; "));
  }
  if (persona) {
    rows.push([
      `User persona ${persona.name}`,
      clean(persona.title),
      clean(persona.description)
    ].filter(Boolean).join("; "));
  }
  if (!rows.length) return "";
  return compact(`visual identity reference, apply only to identities visible in the scene: ${rows.join(" | ")}`, MAX_IDENTITY_PROMPT);
}

export type PromptIdentity = {
  name: string;
  tags: string[];
};

/**
 * Best-effort, safe normalization of the identity prompt into a structured
 * `{ name, tags }` identity. The prompt is written by `visualIdentity` as a
 * deterministic run of `Character <name>; <description>; stable tags: <tags>`
 * rows, so parsing it is deliberate: we accept it only when a character name is
 * present and we tolerate a missing tags section (the caller refills a tag).
 * Unknown or unmatchable prompts return null so the caller falls through to a
 * weaker source rather than seeding a bogus identity.
 */
export function identityFromVisualPrompt(prompt: string): PromptIdentity | null {
  const source = clean(prompt);
  if (!source) return null;
  const characterMatch = source.match(/Character\s+([^;:|]+)/);
  const name = characterMatch?.[1]?.trim();
  if (!name) return null;
  const tagsMatch = source.match(/stable tags:\s*([^|]+)/);
  const tagsCapture = tagsMatch?.[1];
  const tags = tagsCapture
    ? tagsCapture.split(",").map((tag) => clean(tag)).filter(Boolean)
    : [];
  return { name, tags };
}

function normalizedTerms(value: string): string[] {
  return [...new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? [])
    .map((term) => term.replace(/[_-]+/g, " "))
    .filter((term) => !STOP_WORDS.has(term)))];
}

function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase().replace(/[_-]+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function includesTerm(value: string, term: string): boolean {
  const source = normalizeSearch(value);
  const target = normalizeSearch(term);
  return target.length >= 2 && ` ${source} `.includes(` ${target} `);
}

function activationScore(entry: ActivatedWorldInfoEntryDTO, target: string, index: number): number {
  const keyMatches = entry.keys.filter((key) => includesTerm(target, key)).length;
  const titleMatch = entry.comment && includesTerm(target, entry.comment) ? 1 : 0;
  const sourceWeight = entry.source === "keyword" ? 15 : Math.max(0, 15 - Math.max(0, entry.score ?? 0) * 10);
  const scopeWeight: Record<WorldBookSourceDTO, number> = { character: 12, chat: 8, persona: 4, global: 0 };
  return keyMatches * 100 + titleMatch * 50 + sourceWeight + (entry.bookSource ? scopeWeight[entry.bookSource] : 0) - index / 1000;
}

function compactLoreContent(content: string, target: string): string {
  const terms = normalizedTerms(target);
  const segments = content.replace(/\r\n?/g, "\n").split(/\n{2,}|(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  if (!segments.length) return "";
  return segments.map((segment, index) => ({
    segment,
    index,
    score: terms.reduce((count, term) => count + (includesTerm(segment, term) ? 1 : 0), 0)
      + (VISUAL_TERMS.test(segment) ? 8 : 0)
      + (index === 0 ? 1 : 0)
  }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 4)
    .sort((left, right) => left.index - right.index)
    .map(({ segment }) => segment)
    .join(" ");
}

async function resolveLoreContent(spindle: SpindleAPI, content: string, chatId: string, userId?: string): Promise<string> {
  if (!content || typeof spindle.macros?.resolve !== "function") return content;
  try {
    const result = await spindle.macros.resolve(content, { chatId, ...(userId ? { userId } : {}), commit: false });
    return clean(result.text) || content;
  } catch {
    return content;
  }
}

async function loreContext(
  spindle: SpindleAPI,
  chatId: string,
  target: string,
  userId: string | undefined,
  diagnostics: VisualContextDiagnostics
): Promise<string> {
  let activated: ActivatedWorldInfoEntryDTO[];
  try {
    activated = await spindle.world_books.getActivated(chatId, userId);
  } catch (error) {
    diagnostics.errors.push(`lore activation: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
  diagnostics.loreActivated = activated.length;
  const selected = activated.map((entry, index) => ({ entry, index }))
    .sort((left, right) => activationScore(right.entry, target, right.index) - activationScore(left.entry, target, left.index))
    .slice(0, MAX_ACTIVATED_ENTRIES);
  const fetched = await Promise.all(selected.map(async ({ entry: activation, index }): Promise<ResolvedLore | null> => {
    try {
      const entry = await spindle.world_books.entries.get(activation.id, userId);
      if (!entry || entry.disabled) return null;
      const content = await resolveLoreContent(spindle, clean(entry.content), chatId, userId);
      return content ? { activation, entry, index, content } : null;
    } catch (error) {
      diagnostics.errors.push(`lore entry ${activation.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }));
  const rows: string[] = [];
  let length = 0;
  for (const resolved of fetched.filter((item): item is ResolvedLore => item !== null)) {
    const title = clean(resolved.activation.comment) || clean(resolved.entry.comment) || resolved.activation.keys.join(", ") || resolved.entry.id;
    const content = compact(compactLoreContent(resolved.content, target), MAX_LORE_ENTRY_LENGTH);
    const row = [`### ${title}`, resolved.activation.keys.length ? `Keys: ${resolved.activation.keys.join(", ")}` : "", content]
      .filter(Boolean).join("\n");
    if (length + row.length + 2 > MAX_LORE_LENGTH) continue;
    rows.push(row);
    length += row.length + 2;
  }
  diagnostics.loreIncluded = rows.length;
  return rows.length ? `## Activated lore\n\n${rows.join("\n\n")}` : "";
}

async function settled<T>(loader: () => Promise<T>, label: string, diagnostics: VisualContextDiagnostics): Promise<T | null> {
  try {
    return await loader();
  } catch (error) {
    diagnostics.errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function loadVisualContext(
  spindle: SpindleAPI,
  input: {
    chatId: string;
    target: string;
    config: Pick<VisualNovelConfig, "includeCharacterContext" | "includePersonaContext" | "includeLorebookContext">;
    userId?: string;
  }
): Promise<VisualContextSnapshot> {
  const diagnostics: VisualContextDiagnostics = {
    chatLoaded: false,
    characterLoaded: false,
    personaLoaded: false,
    loreActivated: 0,
    loreIncluded: 0,
    errors: []
  };
  const needsChat = input.config.includeCharacterContext;
  const [chat, persona, lore] = await Promise.all([
    needsChat ? settled(() => spindle.chats.get(input.chatId, input.userId), "chat", diagnostics) : Promise.resolve(null),
    input.config.includePersonaContext
      ? settled(() => spindle.personas.getActive(input.userId), "persona", diagnostics)
      : Promise.resolve(null),
    input.config.includeLorebookContext
      ? loreContext(spindle, input.chatId, input.target, input.userId, diagnostics)
      : Promise.resolve("")
  ]);
  diagnostics.chatLoaded = chat !== null;
  diagnostics.personaLoaded = persona !== null;
  const character = input.config.includeCharacterContext && chat?.character_id
    ? await settled(() => spindle.characters.get(chat.character_id, input.userId), "character", diagnostics)
    : null;
  diagnostics.characterLoaded = character !== null;

  const characterBlock = characterContext(character);
  const personaBlock = personaContext(persona);
  const characterIdentity = character ? {
    name: clean(character.name),
    description: clean(character.description),
    tags: Array.isArray(character.tags) ? character.tags.map((tag) => clean(tag)).filter(Boolean) : []
  } : null;
  const personaIdentity = persona ? {
    name: clean(persona.name),
    title: clean(persona.title),
    description: clean(persona.description)
  } : null;
  return {
    plannerContext: [characterBlock, personaBlock, lore].filter(Boolean).join("\n\n"),
    identityPrompt: visualIdentity(character, persona),
    characterIdentity,
    personaIdentity,
    diagnostics
  };
}
