import { describe, expect, test } from "bun:test";
import { InterfaceSounds, POP_MIN_GAP_MS, TYPING_TICK_GAP_MS, shouldTick, type InterfaceAudioContext } from "./interface-sounds";

/** A fake AudioContext that counts the oscillators started. */
function fakeContext(state: AudioContextState = "running") {
  const started: Array<{ type: string }> = [];
  let resumed = 0;
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const context = {
    currentTime: 0,
    state,
    destination: {},
    resume: async () => { resumed += 1; },
    createGain: () => ({ gain: param(), connect: (next: unknown) => next }),
    createOscillator: () => {
      const oscillator = {
        type: "sine",
        frequency: param(),
        connect: (next: unknown) => next,
        start: () => { started.push({ type: oscillator.type }); },
        stop() {},
      };
      return oscillator;
    },
  };
  return { context: context as unknown as InterfaceAudioContext, started, resumed: () => resumed };
}

function sounds(options: { state?: AudioContextState } = {}) {
  let now = 1000;
  const fake = fakeContext(options.state);
  let made = 0;
  const player = new InterfaceSounds({ createContext: () => { made += 1; return fake.context; }, now: () => now, random: () => 0.5 });
  return { player, fake, tick: (ms: number) => { now += ms; }, made: () => made };
}

describe("shouldTick", () => {
  test("visible text ticks once the gap has passed; spaces never tick", () => {
    expect(shouldTick("a", 1000, 900)).toBe(true);
    expect(shouldTick("a", 1000, 1000 - TYPING_TICK_GAP_MS)).toBe(true);
    expect(shouldTick("a", 1000, 1000 - TYPING_TICK_GAP_MS + 1)).toBe(false);
    expect(shouldTick(" ", 1000, 0)).toBe(false);
    expect(shouldTick("\n\t", 1000, 0)).toBe(false);
    expect(shouldTick("가", 1000, Number.NEGATIVE_INFINITY)).toBe(true);
  });
});

describe("InterfaceSounds", () => {
  test("off by default: nothing plays and no audio context is made", () => {
    const { player, fake, made } = sounds();
    expect(player.typed("a")).toBe(false);
    expect(player.pop()).toBe(false);
    expect(fake.started).toHaveLength(0);
    expect(made()).toBe(0);
  });

  test("typing ticks at most every 60 ms however fast the letters come", () => {
    const { player, fake, tick } = sounds();
    player.configure({ enabled: true, volume: 0.4 });
    let played = 0;
    // 30 letters, one every 10 ms: 300 ms of typing.
    for (let i = 0; i < 30; i += 1) {
      if (player.typed("a")) played += 1;
      tick(10);
    }
    expect(played).toBe(5);
    expect(fake.started.every((s) => s.type === "triangle")).toBe(true);
    // Whitespace does not tick and does not use up the gap.
    tick(TYPING_TICK_GAP_MS);
    expect(player.typed(" ")).toBe(false);
    expect(player.typed("b")).toBe(true);
  });

  test("the pop plays once per press even when sparks and a sprite both ask", () => {
    const { player, fake, tick } = sounds();
    player.configure({ enabled: true, volume: 1 });
    expect(player.pop()).toBe(true);
    expect(player.pop()).toBe(false);
    tick(POP_MIN_GAP_MS);
    expect(player.pop()).toBe(true);
    expect(fake.started.map((s) => s.type)).toEqual(["sine", "sine"]);
  });

  test("a voice reading aloud holds every sound; releasing the hold lets them play", () => {
    const { player, tick } = sounds();
    player.configure({ enabled: true, volume: 0.4 });
    let reading = true;
    const hold = () => reading;
    player.setHold(hold);
    expect(player.canPlay()).toBe(false);
    expect(player.typed("a")).toBe(false);
    expect(player.pop()).toBe(false);
    reading = false;
    expect(player.pop()).toBe(true);
    reading = true;
    tick(200);
    // Another stage's hold is not dropped by a stage that never set it.
    player.releaseHold(() => true);
    expect(player.canPlay()).toBe(false);
    player.releaseHold(hold);
    expect(player.canPlay()).toBe(true);
    // A hold that cannot answer keeps the sounds quiet.
    player.setHold(() => { throw new Error("not ready"); });
    expect(player.canPlay()).toBe(false);
  });

  test("volume 0 is silent; volume is clamped; a suspended context is resumed", () => {
    const { player, fake } = sounds({ state: "suspended" });
    player.configure({ enabled: true, volume: 0 });
    expect(player.pop()).toBe(false);
    player.configure({ enabled: true, volume: 7 });
    expect(player.canPlay()).toBe(true);
    player.pop();
    expect(fake.resumed()).toBe(1);
  });

  test("no audio here (no AudioContext): calls are quiet no-ops", () => {
    const player = new InterfaceSounds({ createContext: () => null });
    player.configure({ enabled: true, volume: 0.5 });
    expect(player.pop()).toBe(false);
    expect(player.typed("a")).toBe(false);
  });
});
