import { describe, expect, test } from "bun:test";
import { GAME_PICK_EVENT, GAME_REQUEST_EVENT, GAME_STATE_EVENT, GameBridge, parseGameState } from "./game-bridge";

class Bus {
  listeners = new Map<string, ((e: Event) => void)[]>();
  sent: { type: string; detail: unknown }[] = [];
  addEventListener(type: string, fn: (e: Event) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: (e: Event) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn)); }
  dispatchEvent(e: Event) {
    this.sent.push({ type: e.type, detail: (e as CustomEvent).detail });
    for (const fn of this.listeners.get(e.type) ?? []) fn(e);
    return true;
  }
  emit(detail: unknown) { this.dispatchEvent(new CustomEvent(GAME_STATE_EVENT, { detail })); }
}

const state = (choices: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, provider: "warp", chatId: "c1", choices, ...extra });

describe("game bridge", () => {
  test("validates and caps payloads", () => {
    expect(parseGameState(null)).toBeNull();
    expect(parseGameState({ version: 2, provider: "warp", chatId: "c1", choices: [] })).toBeNull();
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, label: `A${i}` }));
    const parsed = parseGameState(state([...many, { id: "a1", label: "dup" }, { id: "", label: "x" }, { id: "odds", label: "O", odds: 7 }]))!;
    expect(parsed.choices.length).toBe(12);
    expect(new Set(parsed.choices.map((c) => c.id)).size).toBe(12);
    expect(parseGameState(state([{ id: "o", label: "O", odds: 7 }]))!.choices[0]!.odds).toBe(1);
  });

  test("keeps the latest state per provider and filters by chat", () => {
    const bus = new Bus();
    let changes = 0;
    const bridge = new GameBridge(bus as unknown as Window, () => { changes++; });
    bus.emit(state([{ id: "a", label: "A" }]));
    bus.emit(state([{ id: "b", label: "B" }]));
    bus.emit({ ...state([{ id: "z", label: "Z" }]), provider: "other", chatId: "c2" });
    expect(changes).toBe(3);
    expect(bridge.choicesFor("c1").map((c) => c.id)).toEqual(["b"]);
    expect(bridge.choicesFor("c2").map((c) => c.id)).toEqual(["z"]);
    bridge.destroy();
    bus.emit(state([{ id: "c", label: "C" }]));
    expect(bridge.choicesFor("c1")).toEqual([]);
  });

  test("a pick goes back to its provider and spends the set until a fresh one arrives", () => {
    const bus = new Bus();
    const bridge = new GameBridge(bus as unknown as Window, () => {});
    bus.emit(state([{ id: "talk@robin", label: "Talk to Robin" }]));
    bridge.pick("c1", bridge.choicesFor("c1")[0]!);
    expect(bus.sent.at(-1)).toEqual({ type: GAME_PICK_EVENT, detail: { version: 1, provider: "warp", chatId: "c1", id: "talk@robin" } });
    expect(bridge.choicesFor("c1")).toEqual([]);
    expect(bridge.busyFor("c1")).toBe(true);
    bridge.request("c1");
    expect(bus.sent.at(-1)).toEqual({ type: GAME_REQUEST_EVENT, detail: { version: 1, chatId: "c1" } });
  });
});
