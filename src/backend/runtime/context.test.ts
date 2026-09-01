import { describe, expect, test } from "bun:test";
import type {
  ActivatedWorldInfoEntryDTO,
  CharacterDTO,
  ChatDTO,
  PersonaDTO,
  SpindleAPI,
  WorldBookEntryDTO
} from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { loadVisualContext } from "./context.js";

const chat: ChatDTO = {
  id: "chat-1",
  character_id: "character-1",
  name: "Mira chat",
  metadata: {},
  created_at: 1,
  updated_at: 1
};

const character: CharacterDTO = {
  id: "character-1",
  name: "Mira",
  description: "A tall woman with silver hair, green eyes, and a red wool coat.",
  personality: "Careful and curious.",
  scenario: "She studies an abandoned observatory.",
  first_mes: "Hello.",
  mes_example: "",
  creator_notes: "Her coat and eye color should remain consistent.",
  system_prompt: "",
  post_history_instructions: "",
  tags: ["silver hair", "red coat"],
  alternate_greetings: [],
  creator: "author",
  image_id: "avatar-1",
  world_book_ids: [],
  extensions: {},
  created_at: 1,
  updated_at: 1
};

const persona: PersonaDTO = {
  id: "persona-1",
  name: "Theo",
  title: "Archivist",
  description: "A short man with round glasses and a navy vest.",
  image_id: null,
  attached_world_book_id: null,
  folder: "",
  is_default: true,
  metadata: {},
  created_at: 1,
  updated_at: 1
};

function worldEntry(id: string, content: string, comment: string): WorldBookEntryDTO {
  return {
    id,
    world_book_id: "book-1",
    uid: id,
    key: [],
    keysecondary: [],
    content,
    comment,
    position: 0,
    depth: 0,
    role: null,
    order_value: 0,
    selective: false,
    constant: false,
    disabled: false,
    group_name: "",
    group_override: false,
    group_weight: 100,
    probability: 100,
    scan_depth: null,
    exclude_greeting: false,
    case_sensitive: false,
    match_whole_words: false,
    automation_id: null,
    use_regex: false,
    prevent_recursion: false,
    exclude_recursion: false,
    delay_until_recursion: false,
    priority: 0,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    selective_logic: 0,
    use_probability: false,
    vectorized: false,
    extensions: {},
    created_at: 1,
    updated_at: 1
  };
}

describe("visual context assembly", () => {
  test("assembles bounded identity and activated visual lore through public APIs", async () => {
    const activated: ActivatedWorldInfoEntryDTO[] = [
      { id: "general", comment: "Town history", keys: ["town"], source: "keyword", bookSource: "global" },
      { id: "observatory", comment: "Silver observatory", keys: ["observatory"], source: "keyword", bookSource: "character" }
    ];
    const entries = new Map([
      ["general", worldEntry("general", "The town was founded centuries ago.", "Town history")],
      ["observatory", worldEntry("observatory", "{{char}} sees brass instruments. The observatory windows cast blue moonlight across the room.", "Silver observatory")]
    ]);
    const spindle = {
      chats: { get: async () => chat },
      characters: { get: async () => character },
      personas: { getActive: async () => persona },
      world_books: {
        getActivated: async () => activated,
        entries: { get: async (id: string) => entries.get(id) ?? null }
      },
      macros: {
        resolve: async (content: string) => ({ text: content.replaceAll("{{char}}", "Mira"), diagnostics: [] })
      }
    } as unknown as SpindleAPI;

    const snapshot = await loadVisualContext(spindle, {
      chatId: "chat-1",
      target: "Mira enters the silver observatory at night.",
      config: { ...DEFAULT_CONFIG, includeLorebookContext: true },
      userId: "user-1"
    });

    expect(snapshot.plannerContext).toContain("## Character card");
    expect(snapshot.plannerContext).toContain("silver hair, green eyes, and a red wool coat");
    expect(snapshot.plannerContext).toContain("## User persona");
    expect(snapshot.plannerContext).toContain("### Silver observatory");
    expect(snapshot.plannerContext).toContain("Mira sees brass instruments");
    expect(snapshot.plannerContext.indexOf("Silver observatory")).toBeLessThan(snapshot.plannerContext.indexOf("Town history"));
    expect(snapshot.identityPrompt).toContain("Character Mira");
    expect(snapshot.identityPrompt).toContain("User persona Theo");
    expect(snapshot.diagnostics).toMatchObject({
      chatLoaded: true,
      characterLoaded: true,
      personaLoaded: true,
      loreActivated: 2,
      loreIncluded: 2,
      errors: []
    });
  });

  test("returns an empty snapshot instead of breaking planning when lookups fail", async () => {
    const unavailable = async (): Promise<never> => { throw new Error("permission unavailable"); };
    const spindle = {
      chats: { get: unavailable },
      characters: { get: unavailable },
      personas: { getActive: unavailable },
      world_books: { getActivated: unavailable, entries: { get: unavailable } }
    } as unknown as SpindleAPI;
    const snapshot = await loadVisualContext(spindle, {
      chatId: "chat-1",
      target: "Anything",
      config: { ...DEFAULT_CONFIG, includeLorebookContext: true }
    });
    expect(snapshot.plannerContext).toBe("");
    expect(snapshot.identityPrompt).toBe("");
    expect(snapshot.diagnostics.errors).toHaveLength(3);
  });
});

