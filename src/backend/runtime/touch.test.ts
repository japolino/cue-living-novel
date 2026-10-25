import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { touchStoreKey } from "../../shared/touch.js";
import {
  TOUCH_LINES_MAX_TOKENS,
  TOUCH_STORE_PATH,
  loadTouchStore,
  normalizeTouchStore,
  saveTouchBond,
  touchCardText,
  touchLinePack,
  touchLineParameters,
  touchStates,
  trimTouchStore,
} from "./touch.js";

/** Touch mode on the backend: the line pack is one cached call per character; the bond is saved per card. */

const PACK_ANSWER = JSON.stringify({ lines: { pat: { shy: ["Oh… hi."], content: ["Mmm, nice."] }, cheeks: { annoyed: ["Hey!"] } } });

type Fake = {
  spindle: SpindleAPI;
  files: Map<string, unknown>;
  calls: Array<Record<string, unknown>>;
  /** Hold the next model answers until released. */
  gate: { wait: Promise<void> | null };
};

function fakeSpindle(options: { answer?: string; config?: Record<string, unknown>; chatCard?: string | null } = {}): Fake {
  const files = new Map<string, unknown>();
  if (options.config) files.set("config.json", options.config);
  const calls: Array<Record<string, unknown>> = [];
  const gate: Fake["gate"] = { wait: null };
  const spindle = {
    userStorage: {
      getJson: async (path: string, opts?: { fallback?: unknown }) => (files.has(path) ? structuredClone(files.get(path)) : opts?.fallback ?? null),
      setJson: async (path: string, value: unknown) => {
        files.set(path, structuredClone(value));
      },
    },
    chats: { get: async () => ({ character_id: options.chatCard === undefined ? "card-chat" : options.chatCard }) },
    characters: {
      get: async (id: string) => ({ id, name: "Mira", description: "{{char}} is a cheerful maid who teases {{user}}.", personality: "playful" }),
    },
    connections: {
      get: async () => null,
      list: async () => [{ id: "conn-1", name: "Reader", provider: "openai", model: "gpt-test", is_default: true }],
    },
    generate: {
      raw: async (request: Record<string, unknown>) => {
        calls.push(request);
        if (gate.wait) await gate.wait;
        return { content: options.answer ?? PACK_ANSWER };
      },
    },
  } as unknown as SpindleAPI;
  return { spindle, files, calls, gate };
}

const MIRA = { characterKey: "mira", name: "Mira", characterId: "card-mira", identity: "blonde twintails, cat ears" };
const REN = { characterKey: "ren", name: "Ren" };

describe("line pack", () => {
  test("one call makes it; the next ask reads the saved pack", async () => {
    const fake = fakeSpindle();
    const first = await touchLinePack(fake.spindle, undefined, "chat-1", MIRA, false);
    expect(first.lines.pat?.shy).toEqual(["Oh… hi."]);
    expect(fake.calls.length).toBe(1);
    const again = await touchLinePack(fake.spindle, undefined, "chat-2", MIRA, false);
    expect(again).toEqual(first);
    expect(fake.calls.length).toBe(1);
    // Saved under the character's own card, with when it was made.
    const stored = (fake.files.get(TOUCH_STORE_PATH) as { characters: Record<string, { pack: unknown; packAt?: string; bond: number }> }).characters["card:card-mira"];
    expect(stored?.pack).toEqual(first);
    expect(typeof stored?.packAt).toBe("string");
    expect(stored?.bond).toBe(0);
  });

  test("the call goes to the story reader's connection in JSON mode, with no reasoning", async () => {
    const fake = fakeSpindle();
    await touchLinePack(fake.spindle, undefined, "chat-1", MIRA, false);
    const request = fake.calls[0]!;
    expect(request.connection_id).toBe("conn-1");
    expect(request.reasoning).toEqual({ source: "off" });
    expect((request.parameters as Record<string, unknown>).response_format).toEqual({ type: "json_object" });
    expect((request.parameters as Record<string, unknown>).max_tokens).toBe(TOUCH_LINES_MAX_TOKENS);
    const messages = request.messages as Array<{ role: string; content: string }>;
    expect(messages[1]!.content).toContain("Mira is a cheerful maid who teases the reader.");
    expect(messages[1]!.content).toContain("cat ears");
  });

  test("Refresh makes it again", async () => {
    const fake = fakeSpindle();
    await touchLinePack(fake.spindle, undefined, "chat-1", MIRA, false);
    await touchLinePack(fake.spindle, undefined, "chat-1", MIRA, true);
    expect(fake.calls.length).toBe(2);
  });

  test("asks while a call runs share it", async () => {
    const fake = fakeSpindle();
    let release!: () => void;
    fake.gate.wait = new Promise((resolve) => { release = resolve; });
    const asks = [
      touchLinePack(fake.spindle, undefined, "chat-1", MIRA, false),
      touchLinePack(fake.spindle, undefined, "chat-1", MIRA, false),
      touchLinePack(fake.spindle, undefined, "chat-1", MIRA, true),
    ];
    await Bun.sleep(5);
    release();
    const packs = await Promise.all(asks);
    expect(fake.calls.length).toBe(1);
    expect(packs[1]).toEqual(packs[0]);
    expect(packs[2]).toEqual(packs[0]);
  });

  test("with lines off in Settings there is no call", async () => {
    const fake = fakeSpindle({ config: { spriteTouchLines: false } });
    await expect(touchLinePack(fake.spindle, undefined, "chat-1", MIRA, false)).rejects.toThrow("off in Settings");
    expect(fake.calls.length).toBe(0);
  });

  test("an answer without usable lines throws and saves nothing", async () => {
    const fake = fakeSpindle({ answer: "Sorry, I can't help with that." });
    await expect(touchLinePack(fake.spindle, undefined, "chat-1", MIRA, false)).rejects.toThrow("no usable lines");
    expect(fake.files.has(TOUCH_STORE_PATH)).toBe(false);
  });

  test("a new pack keeps the bond", async () => {
    const fake = fakeSpindle();
    await saveTouchBond(fake.spindle, undefined, "chat-1", MIRA, 42);
    await touchLinePack(fake.spindle, undefined, "chat-1", MIRA, true);
    const [state] = await touchStates(fake.spindle, undefined, "chat-1", [MIRA]);
    expect(state).toMatchObject({ characterKey: "mira", bond: 42 });
    expect(state!.pack?.lines.cheeks?.annoyed).toEqual(["Hey!"]);
  });
});

describe("bond meter storage", () => {
  test("saved per card: the same character in another chat has the same bond", async () => {
    const fake = fakeSpindle();
    await saveTouchBond(fake.spindle, undefined, "chat-1", MIRA, 37);
    const [state] = await touchStates(fake.spindle, undefined, "chat-9", [MIRA]);
    expect(state).toEqual({ characterKey: "mira", bond: 37, pack: null });
  });

  test("a character without a card is saved under the chat's card by name", async () => {
    const fake = fakeSpindle();
    await saveTouchBond(fake.spindle, undefined, "chat-1", REN, 12);
    const key = touchStoreKey({ name: "Ren" }, "card-chat", "chat-1");
    expect(Object.keys((fake.files.get(TOUCH_STORE_PATH) as { characters: object }).characters)).toEqual([key]);
    expect((await touchStates(fake.spindle, undefined, "chat-2", [REN]))[0]!.bond).toBe(12);
  });

  test("without a chat card, under the chat", async () => {
    const fake = fakeSpindle({ chatCard: null });
    await saveTouchBond(fake.spindle, undefined, "chat-1", REN, 5);
    expect((await touchStates(fake.spindle, undefined, "chat-1", [REN]))[0]!.bond).toBe(5);
    expect((await touchStates(fake.spindle, undefined, "chat-2", [REN]))[0]!.bond).toBe(0);
  });

  test("bonds are clamped and an unchanged bond writes nothing", async () => {
    const fake = fakeSpindle();
    await saveTouchBond(fake.spindle, undefined, "chat-1", MIRA, 250);
    expect((await touchStates(fake.spindle, undefined, "chat-1", [MIRA]))[0]!.bond).toBe(100);
    let writes = 0;
    const setJson = fake.spindle.userStorage.setJson;
    fake.spindle.userStorage.setJson = (async (...args: Parameters<typeof setJson>) => {
      writes += 1;
      return setJson(...args);
    }) as typeof setJson;
    await saveTouchBond(fake.spindle, undefined, "chat-1", MIRA, 100);
    expect(writes).toBe(0);
  });

  test("each user has their own file", async () => {
    const files = new Map<string, unknown>();
    const fake = fakeSpindle();
    fake.spindle.userStorage.getJson = (async (path: string, opts?: { fallback?: unknown; userId?: string }) => {
      const key = `${opts?.userId ?? "owner"}/${path}`;
      return files.has(key) ? structuredClone(files.get(key)) : opts?.fallback ?? null;
    }) as SpindleAPI["userStorage"]["getJson"];
    fake.spindle.userStorage.setJson = (async (path: string, value: unknown, opts?: { userId?: string }) => {
      files.set(`${opts?.userId ?? "owner"}/${path}`, structuredClone(value));
    }) as SpindleAPI["userStorage"]["setJson"];
    await saveTouchBond(fake.spindle, "user-a", "chat-1", MIRA, 20);
    expect((await touchStates(fake.spindle, "user-a", "chat-1", [MIRA]))[0]!.bond).toBe(20);
    expect((await touchStates(fake.spindle, "user-b", "chat-1", [MIRA]))[0]!.bond).toBe(0);
  });

  test("the file is read defensively and trimmed to the most recently touched", async () => {
    expect(normalizeTouchStore(null)).toEqual({});
    expect(normalizeTouchStore({ characters: [] })).toEqual({});
    const store = normalizeTouchStore({ characters: { "card:a": { name: "A", bond: "x", pack: "nope" }, __proto__: { bond: 3 }, "": { bond: 1 } } });
    expect(Object.keys(store)).toEqual(["card:a"]);
    expect(store["card:a"]).toMatchObject({ name: "A", bond: 0, pack: null });
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, { name: `${i}`, bond: i, pack: null, updatedAt: new Date(2026, 0, i + 1).toISOString() }]));
    expect(Object.keys(trimTouchStore(many, 2)).sort()).toEqual(["k3", "k4"]);
    const fake = fakeSpindle();
    fake.spindle.userStorage.getJson = (async () => {
      throw new Error("unreadable");
    }) as SpindleAPI["userStorage"]["getJson"];
    expect(await loadTouchStore(fake.spindle)).toEqual({});
  });
});

describe("call parameters and card text", () => {
  test("JSON mode per provider, the budget always the touch one", () => {
    expect(touchLineParameters({ id: "c", provider: "google", model: "gemini-2.5-flash" }, { response_format: { type: "text" }, max_tokens: 9000 })).toMatchObject({ responseMimeType: "application/json", max_tokens: TOUCH_LINES_MAX_TOKENS, temperature: 0.9 });
    expect(touchLineParameters({ id: "c", provider: "anthropic", model: "claude" }, { temperature: 0.4 })).toEqual({ temperature: 0.4, max_tokens: TOUCH_LINES_MAX_TOKENS });
    expect(touchLineParameters(null, {})).toEqual({ temperature: 0.9, max_tokens: TOUCH_LINES_MAX_TOKENS });
  });

  test("the card's description and personality, with its macros named", () => {
    expect(touchCardText({ description: "{{char}} likes {{user}}.", personality: " shy " }, "Aoi")).toBe("Aoi likes the reader.\n\nshy");
    expect(touchCardText(null, "Aoi")).toBe("");
  });
});

describe("the story never sees touch", () => {
  test("no story, planner or prompt module imports the touch modules", () => {
    const root = join(import.meta.dir, "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          const source = readFileSync(path, "utf8");
          if (/from\s+["'][^"']*(?:runtime\/|\.\/)touch(?:\.js)?["']/.test(source) || /shared\/touch(?:\.js)?["']/.test(source)) offenders.push(path.slice(root.length + 1).replaceAll("\\", "/"));
        }
      }
    };
    walk(root);
    // Only the touch store itself and the controller's vn_touch_* cases.
    expect(offenders.sort()).toEqual(["runtime/controller.ts", "runtime/touch.ts"]);
  });
});
