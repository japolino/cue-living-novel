import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { normalizeConfig } from "../../config.js";
import {
  CHARACTER_CONFIG_PATH,
  changeCharacterConfig,
  changeConfig,
  loadCharacterConfigs,
  loadConfig,
  updateConfig,
} from "./storage.js";
import { characterOverrideWith, characterOverrideWithout } from "../../config.js";
import { chatCharacter, loadChatConfig, loadConfigScope } from "./config-scope.js";

/** Settings saved per character: the stored file, and the config a chat uses. */

type Chat = { character_id?: unknown } | null;

function runtime(options: { config?: unknown; characters?: unknown; chats?: Record<string, Chat>; cards?: Record<string, { name: string }>; slowWrites?: boolean } = {}) {
  const data = new Map<string, unknown>();
  if (options.config !== undefined) data.set("config.json", options.config);
  if (options.characters !== undefined) data.set(CHARACTER_CONFIG_PATH, options.characters);
  const lookups = { chats: 0, characters: 0 };
  const writes: string[] = [];
  const spindle = {
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown }) => {
        const value = data.get(path);
        if (value === "corrupt") throw new Error("Unexpected token in JSON");
        return value === undefined ? readOptions.fallback : JSON.parse(JSON.stringify(value));
      },
      setJson: async (path: string, value: unknown) => {
        if (options.slowWrites) await new Promise((resolve) => setTimeout(resolve, 5));
        writes.push(path);
        data.set(path, JSON.parse(JSON.stringify(value)));
      },
    },
    chats: {
      get: async (chatId: string) => {
        lookups.chats += 1;
        return options.chats?.[chatId] ?? null;
      },
    },
    characters: {
      get: async (id: string) => {
        lookups.characters += 1;
        return options.cards?.[id] ?? null;
      },
    },
  } as unknown as SpindleAPI;
  return { spindle, data, lookups, writes };
}

const MIRA = { id: "card-mira", name: "Mira" };

describe("stored per-character settings", () => {
  test("a first save writes one file with only the differing values; the shared config is untouched", async () => {
    const r = runtime({ config: { themePreset: "golden-hour", textSpeed: 30 } });
    const result = await changeCharacterConfig(r.spindle, MIRA, (shared, current) => characterOverrideWith(shared, current, { themePreset: "midnight-noir", textSpeed: 30 }));
    expect(result.changed).toBe(true);
    expect(result.overrides).toEqual({ themePreset: "midnight-noir" });
    const stored = r.data.get(CHARACTER_CONFIG_PATH) as { schemaVersion: number; characters: Record<string, { name: string; overrides: unknown; updatedAt: string }> };
    expect(stored.schemaVersion).toBe(1);
    expect(Object.keys(stored.characters)).toEqual(["card-mira"]);
    expect(stored.characters["card-mira"]!.name).toBe("Mira");
    expect(stored.characters["card-mira"]!.overrides).toEqual({ themePreset: "midnight-noir" });
    expect(Number.isNaN(Date.parse(stored.characters["card-mira"]!.updatedAt))).toBe(false);
    expect(r.writes).toEqual([CHARACTER_CONFIG_PATH]);
    expect((await loadConfig(r.spindle)).themePreset).toBe("golden-hour");
  });

  test("round trip: what is saved loads back; other characters are kept", async () => {
    const r = runtime({ characters: { schemaVersion: 1, characters: { "card-theo": { name: "Theo", overrides: { textScale: 1.3 }, updatedAt: "2026-10-01T00:00:00.000Z" } } } });
    await changeCharacterConfig(r.spindle, MIRA, (shared, current) => characterOverrideWith(shared, current, { presentationMode: "sprites" }));
    const loaded = await loadCharacterConfigs(r.spindle);
    expect(loaded["card-theo"]!.overrides).toEqual({ textScale: 1.3 });
    expect(loaded["card-mira"]!.overrides).toEqual({ presentationMode: "sprites" });
  });

  test("no change writes nothing; the last own value gone removes the character's entry", async () => {
    const r = runtime({ characters: { schemaVersion: 1, characters: { "card-mira": { name: "Mira", overrides: { textScale: 1.3 }, updatedAt: "x" } } } });
    const same = await changeCharacterConfig(r.spindle, MIRA, (shared, current) => characterOverrideWith(shared, current, { textScale: 1.3 }));
    expect(same.changed).toBe(false);
    expect(r.writes).toEqual([]);
    const declined = await changeCharacterConfig(r.spindle, MIRA, () => null);
    expect(declined.changed).toBe(false);
    const cleared = await changeCharacterConfig(r.spindle, MIRA, (_shared, current) => characterOverrideWithout(current));
    expect(cleared.changed).toBe(true);
    expect(cleared.overrides).toEqual({});
    expect((r.data.get(CHARACTER_CONFIG_PATH) as { characters: object }).characters).toEqual({});
  });

  test("a damaged or odd file loads as no own settings; bad entries are dropped", async () => {
    // Parsed, as a file would be: "__proto__" is then an own key.
    const odd = runtime({ characters: JSON.parse(JSON.stringify({ schemaVersion: 1, characters: {
      "": { overrides: { themePreset: "midnight-noir" } },
      "card-a": { overrides: { imageModel: "x" } },
      "card-b": "nope",
      "card-c": { overrides: { themePreset: "daylight", parserConnectionId: "secret" } },
    } }).replace('"characters":{', '"characters":{"__proto__":{"overrides":{"themePreset":"midnight-noir"}},')) });
    const loaded = await loadCharacterConfigs(odd.spindle);
    expect(Object.keys(loaded)).toEqual(["card-c"]);
    expect(loaded["card-c"]!.overrides).toEqual({ themePreset: "daylight" });
    expect(await loadCharacterConfigs(runtime({ characters: [1, 2] }).spindle)).toEqual({});
    expect(await loadCharacterConfigs(runtime({ characters: "corrupt" }).spindle)).toEqual({});
  });

  test("a save never overwrites a file it could not read", async () => {
    const r = runtime({ characters: "corrupt" });
    await expect(changeCharacterConfig(r.spindle, MIRA, (shared, current) => characterOverrideWith(shared, current, { themePreset: "daylight" }))).rejects.toThrow();
    expect(r.data.get(CHARACTER_CONFIG_PATH)).toBe("corrupt");
  });

  test("an unusable character id is refused", async () => {
    const r = runtime();
    await expect(changeCharacterConfig(r.spindle, { id: "__proto__", name: "x" }, () => ({ themePreset: "daylight" }))).rejects.toThrow();
    await expect(changeCharacterConfig(r.spindle, { id: "", name: "x" }, () => ({ themePreset: "daylight" }))).rejects.toThrow();
    expect(r.writes).toEqual([]);
  });

  test("character and shared saves share one write queue: none is lost", async () => {
    const r = runtime({ slowWrites: true });
    await Promise.all([
      changeCharacterConfig(r.spindle, MIRA, (shared, current) => characterOverrideWith(shared, current, { themePreset: "daylight" })),
      updateConfig(r.spindle, { textSpeed: 40 }),
      changeCharacterConfig(r.spindle, MIRA, (shared, current) => characterOverrideWith(shared, current, { textScale: 1.2 })),
      changeConfig(r.spindle, () => ({ bgmVolume: 0.3 })),
      changeCharacterConfig(r.spindle, { id: "card-theo", name: "Theo" }, (shared, current) => characterOverrideWith(shared, current, { presentationMode: "sprites" })),
    ]);
    const shared = await loadConfig(r.spindle);
    expect(shared.textSpeed).toBe(40);
    expect(shared.bgmVolume).toBe(0.3);
    const own = await loadCharacterConfigs(r.spindle);
    expect(own["card-mira"]!.overrides).toEqual({ themePreset: "daylight", textScale: 1.2 });
    expect(own["card-theo"]!.overrides).toEqual({ presentationMode: "sprites" });
  });
});

describe("the config a chat uses", () => {
  const characters = { schemaVersion: 1, characters: { "card-mira": { name: "Mira (saved)", overrides: { themePreset: "midnight-noir", presentationMode: "sprites" }, updatedAt: "x" } } };
  const chats = { "chat-mira": { character_id: "card-mira" }, "chat-theo": { character_id: "card-theo" }, "chat-group": {} };
  const cards = { "card-mira": { name: "Mira" }, "card-theo": { name: "Theo" } };

  test("an old save without per-character settings loads exactly as before, without any chat lookup", async () => {
    const stored = { themePreset: "golden-hour", textSpeed: 30 };
    const r = runtime({ config: stored, chats, cards });
    const config = await loadChatConfig(r.spindle, undefined, "chat-mira");
    expect(config).toEqual(normalizeConfig(stored));
    expect(config).toEqual(await loadConfig(r.spindle));
    expect(r.lookups.chats).toBe(0);
  });

  test("a chat whose character has own values uses them; other chats keep the shared settings", async () => {
    const r = runtime({ config: { themePreset: "golden-hour" }, characters, chats, cards });
    const mira = await loadChatConfig(r.spindle, undefined, "chat-mira");
    expect(mira.themePreset).toBe("midnight-noir");
    expect(mira.presentationMode).toBe("sprites");
    const theo = await loadChatConfig(r.spindle, undefined, "chat-theo");
    expect(theo.themePreset).toBe("golden-hour");
    expect(theo.presentationMode).toBe("scene");
    expect((await loadChatConfig(r.spindle, undefined, "chat-group")).themePreset).toBe("golden-hour");
    expect((await loadChatConfig(r.spindle, undefined, "")).themePreset).toBe("golden-hour");
    // A chat's card is looked up once.
    await loadChatConfig(r.spindle, undefined, "chat-mira");
    expect(r.lookups.chats).toBe(3);
  });

  test("the scope view carries both layers and the card's current name", async () => {
    const r = runtime({ config: { themePreset: "golden-hour" }, characters, chats, cards });
    const scope = await loadConfigScope(r.spindle, undefined, "chat-mira");
    expect(scope.config.themePreset).toBe("midnight-noir");
    expect(scope.characterScope).toMatchObject({ chatId: "chat-mira", characterId: "card-mira", name: "Mira", overrides: { themePreset: "midnight-noir", presentationMode: "sprites" } });
    expect(scope.characterScope!.shared.themePreset).toBe("golden-hour");
    const theo = await loadConfigScope(r.spindle, undefined, "chat-theo");
    expect(theo.characterScope).toMatchObject({ characterId: "card-theo", name: "Theo", overrides: {} });
    expect(theo.config).toEqual(theo.characterScope!.shared);
    expect((await loadConfigScope(r.spindle, undefined, "chat-group")).characterScope).toBeNull();
    expect((await loadConfigScope(r.spindle, undefined, "")).characterScope).toBeNull();
  });

  test("a card that cannot be read keeps the stored name, then a plain label", async () => {
    const r = runtime({ characters, chats });
    expect(await chatCharacter(r.spindle, "chat-mira")).toEqual({ id: "card-mira", name: "Mira (saved)" });
    expect(await chatCharacter(r.spindle, "chat-theo")).toEqual({ id: "card-theo", name: "This character" });
  });

  test("a host without chat lookups reads the shared settings", async () => {
    const r = runtime({ config: { themePreset: "golden-hour" }, characters });
    const broken = { ...r.spindle, chats: { get: async () => { throw new Error("no permission"); } } } as unknown as SpindleAPI;
    expect((await loadChatConfig(broken, undefined, "chat-mira")).themePreset).toBe("golden-hour");
    expect((await loadConfigScope(broken, undefined, "chat-mira")).characterScope).toBeNull();
  });
});
