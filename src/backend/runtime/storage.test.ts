import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  loadSingleCharacterState,
  migrateVisualProfilesToSingleCharacter,
  saveSingleCharacterState,
  singleCharacterStatePath
} from "./storage.js";
import {
  DEFAULT_ENVIRONMENT_DESCRIPTOR,
  seedSingleCharacter
} from "../core/visual-state.js";
import { SINGLE_CHARACTER_SCHEMA_VERSION } from "../../shared/character.js";

function storageRuntime(initial: ReadonlyMap<string, unknown> = new Map()): {
  spindle: SpindleAPI;
  data: Map<string, unknown>;
} {
  const data = new Map(initial);
  const spindle = {
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown }) => data.get(path) ?? readOptions.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    }
  } as unknown as SpindleAPI;
  return { spindle, data };
}

describe("single-character state path", () => {
  test("singleCharacterStatePath points at the existing visual-state.json path", () => {
    expect(singleCharacterStatePath("chat-1")).toBe("chats/chat-1/visual-state.json");
  });
});

describe("migrateVisualProfilesToSingleCharacter", () => {
  test("migrates a legacy v1 profile record, preferring the first profile", () => {
    const raw = {
      schemaVersion: 1,
      profiles: {
        mira: { name: "Mira", description: "silver hair, green eyes" },
        theo: { name: "Theo", description: "round glasses" }
      },
      updatedAt: "2024-01-01T00:00:00.000Z"
    };
    const state = migrateVisualProfilesToSingleCharacter(raw);
    expect(state.schemaVersion).toBe(SINGLE_CHARACTER_SCHEMA_VERSION);
    expect(state.protagonist.name).toBe("Mira");
    expect(state.protagonist.tags).toEqual(["silver hair", "green eyes"]);
    expect(state.updatedAt).toBe("2024-01-01T00:00:00.000Z");
  });

  test("honours an explicit protagonistName", () => {
    const raw = {
      schemaVersion: 1,
      profiles: {
        mira: { name: "Mira", description: "silver hair" },
        theo: { name: "Theo", description: "round glasses" }
      }
    };
    expect(migrateVisualProfilesToSingleCharacter(raw, { protagonistName: "theo" }).protagonist.name).toBe("Theo");
  });

  test("overrides the environment descriptor", () => {
    const state = migrateVisualProfilesToSingleCharacter(
      { schemaVersion: 1, profiles: { mira: { name: "Mira", description: "silver hair" } } },
      { environment: "A moonlit rooftop" }
    );
    expect(state.environment).toBe("A moonlit rooftop");
  });

  test("passes an already-migrated new-style record through unchanged", () => {
    const newState = seedSingleCharacter("Mira", "silver hair");
    const state = migrateVisualProfilesToSingleCharacter(JSON.parse(JSON.stringify(newState)));
    expect(state).toEqual(newState);
  });

  test("falls back to the empty state for absent / garbage input", () => {
    const empty = migrateVisualProfilesToSingleCharacter(null);
    expect(empty.schemaVersion).toBe(SINGLE_CHARACTER_SCHEMA_VERSION);
    expect(empty.protagonist.name).toBe("");
    expect(empty.protagonist.tags).toEqual([]);
    expect(empty.environment).toBe(DEFAULT_ENVIRONMENT_DESCRIPTOR);
  });
});

describe("loadSingleCharacterState", () => {
  test("returns the empty state when nothing is stored", async () => {
    const { spindle } = storageRuntime();
    const state = await loadSingleCharacterState(spindle, "chat-empty");
    expect(state.protagonist.name).toBe("");
    expect(state.protagonist.tags).toEqual([]);
  });

  test("loads an already-migrated new-style record", async () => {
    const seeded = seedSingleCharacter("Mira", "silver hair, green eyes");
    const { spindle } = storageRuntime(new Map([[singleCharacterStatePath("chat-1"), seeded]]));
    const state = await loadSingleCharacterState(spindle, "chat-1");
    expect(state.protagonist).toEqual(seeded.protagonist);
  });

  test("migrates a legacy v1 profile record on load", async () => {
    const initial = new Map<string, unknown>([
      [singleCharacterStatePath("chat-1"), {
        schemaVersion: 1,
        profiles: { mira: { name: "Mira", description: "silver hair, green eyes" } }
      }]
    ]);
    const { spindle } = storageRuntime(initial);
    const state = await loadSingleCharacterState(spindle, "chat-1");
    expect(state.schemaVersion).toBe(SINGLE_CHARACTER_SCHEMA_VERSION);
    expect(state.protagonist.name).toBe("Mira");
    expect(state.protagonist.tags).toEqual(["silver hair", "green eyes"]);
  });
});

describe("saveSingleCharacterState", () => {
  test("writes a schema-version-2 record on the initial seed", async () => {
    const { spindle, data } = storageRuntime();
    const seeded = seedSingleCharacter("Mira", "silver hair, green eyes");
    await saveSingleCharacterState(spindle, "chat-1", seeded);
    const stored = data.get(singleCharacterStatePath("chat-1")) as Record<string, unknown>;
    expect(stored.schemaVersion).toBe(SINGLE_CHARACTER_SCHEMA_VERSION);
    expect(stored.protagonist).toEqual({ name: "Mira", tags: ["silver hair", "green eyes"] });
    expect(typeof stored.updatedAt).toBe("string");
  });

  test("freezes the protagonist identity after the initial seed", async () => {
    const { spindle, data } = storageRuntime();
    const seeded = seedSingleCharacter("Mira", "silver hair, green eyes");
    await saveSingleCharacterState(spindle, "chat-1", seeded);

    // Later turn tries to change the identity AND the environment.
    const altered = seedSingleCharacter("Mira", "brown hair, blue eyes, purple coat");
    await saveSingleCharacterState(spindle, "chat-1", { ...altered, environment: "A moonlit rooftop" });

    const stored = data.get(singleCharacterStatePath("chat-1")) as Record<string, unknown>;
    // Identity is frozen: tags from the initial seed are preserved.
    expect(stored.protagonist).toEqual({ name: "Mira", tags: ["silver hair", "green eyes"] });
    // Environment does update.
    expect(stored.environment).toBe("A moonlit rooftop");
  });

  test("adopts the incoming protagonist exactly once on a fresh chat", async () => {
    const { spindle, data } = storageRuntime();
    const seeded = seedSingleCharacter("Theo", "round glasses");
    await saveSingleCharacterState(spindle, "chat-1", seeded);
    await saveSingleCharacterState(spindle, "chat-1", { ...seeded, environment: "A library" });
    const stored = data.get(singleCharacterStatePath("chat-1")) as Record<string, unknown>;
    expect(stored.protagonist).toEqual({ name: "Theo", tags: ["round glasses"] });
    expect(stored.environment).toBe("A library");
  });

  test("preserves a migrated legacy protagonist and freezes it on later saves", async () => {
    const initial = new Map<string, unknown>([
      [singleCharacterStatePath("chat-1"), {
        schemaVersion: 1,
        profiles: { mira: { name: "Mira", description: "silver hair, green eyes" } }
      }]
    ]);
    const { spindle, data } = storageRuntime(initial);
    const attempted = seedSingleCharacter("Mira", "completely different tags");
    await saveSingleCharacterState(spindle, "chat-1", attempted);
    const stored = data.get(singleCharacterStatePath("chat-1")) as Record<string, unknown>;
    // Migrated protagonist wins (freeze), not the attempted tags.
    expect(stored.protagonist).toEqual({ name: "Mira", tags: ["silver hair", "green eyes"] });
  });
});
