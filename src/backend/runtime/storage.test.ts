import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import {
  appearanceMigrationMarkerPath,
  characterAppearancePath,
  loadCharacterAppearance,
  loadSingleCharacterState,
  mergeCharacterAppearanceFromState,
  migrateCharacterAppearanceStates,
  migrateVisualProfilesToSingleCharacter,
  saveCharacterAppearance,
  saveSingleCharacterState,
  singleCharacterStatePath
} from "./storage.js";
import {
  DEFAULT_ENVIRONMENT_DESCRIPTOR,
  emptySingleCharacter,
  seedSingleCharacter
} from "../core/visual-state.js";
import { SINGLE_CHARACTER_SCHEMA_VERSION } from "../../shared/character.js";
import type { CharacterAppearanceMap } from "../../shared/identity.js";

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

// ---------------------------------------------------------------------------
// Durable global character-appearance map (Inlay state.characterAppearance)
// ---------------------------------------------------------------------------

function appearanceRuntime(initial: ReadonlyMap<string, unknown> = new Map()): {
  spindle: SpindleAPI;
  data: Map<string, unknown>;
} {
  const data = new Map(initial);
  const spindle = {
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); },
      list: async (prefix?: string) => [...data.keys()].filter((path) => !prefix || path.startsWith(prefix))
    }
  } as unknown as SpindleAPI;
  return { spindle, data };
}

describe("saveSingleCharacterState repair semantics", () => {
  test("repairs a poisoned name-only chat identity when a usable one arrives", async () => {
    const { spindle, data } = appearanceRuntime(new Map<string, unknown>([
      [singleCharacterStatePath("chat-1"), {
        schemaVersion: SINGLE_CHARACTER_SCHEMA_VERSION,
        protagonist: { name: "Hina", tags: ["Hina"] },
        environment: DEFAULT_ENVIRONMENT_DESCRIPTOR,
        updatedAt: new Date(0).toISOString()
      }]
    ]));
    await saveSingleCharacterState(spindle, "chat-1", seedSingleCharacter("Hina", "golden blonde short hair, brilliant red eyes"));
    const stored = data.get(singleCharacterStatePath("chat-1")) as Record<string, unknown>;
    expect((stored.protagonist as Record<string, unknown>).tags).toEqual(["golden blonde short hair", "brilliant red eyes"]);
  });

  test("does not freeze or reject a name-only fallback identity", async () => {
    const { spindle, data } = appearanceRuntime();
    await saveSingleCharacterState(spindle, "chat-1", { ...seedSingleCharacter("Mira", ""), protagonist: { name: "Mira", tags: [] } });
    // Later, the card becomes available; the name-only state must be repairable.
    await saveSingleCharacterState(spindle, "chat-1", seedSingleCharacter("Mira", "silver hair, green eyes"));
    const stored = data.get(singleCharacterStatePath("chat-1")) as Record<string, unknown>;
    expect((stored.protagonist as Record<string, unknown>).tags).toEqual(["silver hair", "green eyes"]);
  });

  test("keeps a poisoned identity's name but never injects it as an appearance tag", async () => {
    const { spindle, data } = appearanceRuntime();
    await saveSingleCharacterState(spindle, "chat-1", seedSingleCharacter("Hina", ""));
    const stored = data.get(singleCharacterStatePath("chat-1")) as Record<string, unknown>;
    expect((stored.protagonist as Record<string, unknown>).name).toBe("Hina");
    expect((stored.protagonist as Record<string, unknown>).tags).toEqual([]);
  });
});

describe("durable character appearance map", () => {
  test("characterAppearancePath is a stable global path", () => {
    expect(characterAppearancePath()).toBe("character-appearance.json");
  });

  test("loadCharacterAppearance normalizes name-only/degraded entries out", async () => {
    const { spindle } = appearanceRuntime(new Map<string, unknown>([
      [characterAppearancePath(), { Hina: "Hina", Mira: "silver hair, green eyes" }]
    ]));
    const map = await loadCharacterAppearance(spindle);
    expect(map).toEqual({ Mira: "silver hair, green eyes" });
  });

  test("mergeCharacterAppearanceFromState preserves a good baseline exactly", async () => {
    const { spindle, data } = appearanceRuntime(new Map<string, unknown>([
      [characterAppearancePath(), { Hina: "golden blonde short hair, brilliant red eyes" }]
    ]));
    // A degraded/inferred and a different usable baseline must NOT overwrite the good one.
    await mergeCharacterAppearanceFromState(spindle, seedSingleCharacter("Hina", "Hina"));
    await mergeCharacterAppearanceFromState(spindle, seedSingleCharacter("Hina", "black hair, blue eyes"));
    const map = data.get(characterAppearancePath()) as CharacterAppearanceMap;
    expect(map).toEqual({ Hina: "golden blonde short hair, brilliant red eyes" });
  });

  test("mergeCharacterAppearanceFromState fills a missing baseline and repairs a degraded one", async () => {
    const emptyRuntime = appearanceRuntime();
    await mergeCharacterAppearanceFromState(emptyRuntime.spindle, seedSingleCharacter("Hina", "golden blonde short hair, brilliant red eyes"));
    expect((emptyRuntime.data.get(characterAppearancePath()) as CharacterAppearanceMap)).toEqual({
      Hina: "golden blonde short hair, brilliant red eyes"
    });

    const degraded = appearanceRuntime(new Map<string, unknown>([
      [characterAppearancePath(), { Hina: "Hina" }]
    ]));
    await mergeCharacterAppearanceFromState(degraded.spindle, seedSingleCharacter("Hina", "golden blonde short hair, brilliant red eyes"));
    expect((degraded.data.get(characterAppearancePath()) as CharacterAppearanceMap)).toEqual({
      Hina: "golden blonde short hair, brilliant red eyes"
    });
  });
});

describe("migrateCharacterAppearanceStates (one-time scan + repair)", () => {
  test("scans chats and selects the richest usable baseline by name", async () => {
    const chatA = singleCharacterStatePath("chat-a");
    const chatB = singleCharacterStatePath("chat-b");
    const { spindle, data } = appearanceRuntime(new Map<string, unknown>([
      [chatA, seedSingleCharacter("Hina", "golden blonde short hair, brilliant red eyes, black uniform")],
      [chatB, seedSingleCharacter("Hina", "golden blonde short hair")]
    ]));
    const map = await migrateCharacterAppearanceStates(spindle, {});
    expect(map).toEqual({ Hina: "golden blonde short hair, brilliant red eyes, black uniform" });
  });

  test("repairs a poisoned name-only chat state with the richer baseline", async () => {
    const chatA = singleCharacterStatePath("chat-a");
    const chatB = singleCharacterStatePath("chat-b");
    const { spindle, data } = appearanceRuntime(new Map<string, unknown>([
      [chatA, seedSingleCharacter("Hina", "golden blonde short hair, brilliant red eyes")],
      [chatB, {
        schemaVersion: SINGLE_CHARACTER_SCHEMA_VERSION,
        protagonist: { name: "Hina", tags: ["Hina"] },
        environment: DEFAULT_ENVIRONMENT_DESCRIPTOR,
        updatedAt: new Date(0).toISOString()
      }]
    ]));
    await migrateCharacterAppearanceStates(spindle, {});
    const repaired = data.get(chatB) as Record<string, unknown>;
    expect((repaired.protagonist as Record<string, unknown>).tags).toEqual(["golden blonde short hair", "brilliant red eyes"]);
  });

  test("is idempotent and guarded by the migration marker", async () => {
    const chatA = singleCharacterStatePath("chat-a");
    const { spindle, data } = appearanceRuntime(new Map<string, unknown>([
      [chatA, seedSingleCharacter("Hina", "golden blonde short hair, brilliant red eyes")]
    ]));
    await migrateCharacterAppearanceStates(spindle, {});
    expect(data.get(appearanceMigrationMarkerPath())).toBe(true);
    // Marker set: a subsequent load reads the persisted map and returns promptly.
    const second = await loadCharacterAppearance(spindle);
    expect(second).toEqual({ Hina: "golden blonde short hair, brilliant red eyes" });
  });

  test("saveCharacterAppearance persisted the canonical map without degraded entries", async () => {
    const { spindle, data } = appearanceRuntime();
    await saveCharacterAppearance(spindle, { Hina: "Hina", Mira: "silver hair, green eyes" });
    expect(data.get(characterAppearancePath())).toEqual({ Mira: "silver hair, green eyes" });
  });
});
