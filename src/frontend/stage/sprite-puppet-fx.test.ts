import { describe, expect, test } from "bun:test";

import { SPRITE_HOT_SET } from "../../shared/sprites";
import { puppetGestureDelta } from "./sprite-puppet-acting";
import {
  PUPPET_ARRIVAL_BLUR_PX,
  PUPPET_CALM_AIR,
  PUPPET_PUFF_S,
  PUPPET_SHIFT,
  PUPPET_SHIFT_KINDS,
  puppetArrivalBlur,
  puppetAtmosphere,
  puppetColdPlace,
  puppetDangerBeat,
  puppetExhaleStarted,
  puppetFireFlicker,
  puppetFireflies,
  puppetMouth,
  puppetPuff,
  puppetPuffAt,
  puppetShiftFor,
  puppetShiftGain,
  puppetShiftGesture,
  puppetShiftReveal,
  puppetSnowStep,
} from "./sprite-puppet-fx";
import { puppetBreathCycle } from "./sprite-puppet-rig";

describe("puppet expression changes", () => {
  test("each emotion picks its shift; rare ids use their fallback; soft and classic override", () => {
    expect(puppetShiftFor("surprised", "expressive")).toBe("pop");
    expect(puppetShiftFor("sad", "expressive")).toBe("melt");
    expect(puppetShiftFor("angry", "expressive")).toBe("flare");
    expect(puppetShiftFor("embarrassed", "expressive")).toBe("blush");
    expect(puppetShiftFor("smile", "expressive")).toBe("soft");
    expect(puppetShiftFor("shocked", "expressive")).toBe(puppetShiftFor("surprised", "expressive"));
    expect(puppetShiftFor(null, "expressive")).toBe("soft");
    for (const expression of SPRITE_HOT_SET) {
      expect(PUPPET_SHIFT_KINDS).toContain(puppetShiftFor(expression, "expressive")!);
      expect(puppetShiftFor(expression, "soft")).toBe("soft");
      expect(puppetShiftFor(expression, "classic")).toBeNull();
    }
  });

  test("staging intensity scales the gain, clamped to 1..5", () => {
    expect(puppetShiftGain(3)).toBe(1);
    expect(puppetShiftGain(1)).toBeLessThan(puppetShiftGain(5));
    expect(puppetShiftGain(0)).toBe(puppetShiftGain(1));
    expect(puppetShiftGain(9)).toBe(puppetShiftGain(5));
    expect(puppetShiftGain(Number.NaN)).toBe(1);
  });

  test("every reveal runs 0 to 1 without going back; a pop cuts", () => {
    for (const kind of PUPPET_SHIFT_KINDS) {
      const { duration } = PUPPET_SHIFT[kind];
      expect(puppetShiftReveal(kind, 0)).toBeCloseTo(0, 6);
      expect(puppetShiftReveal(kind, duration)).toBeCloseTo(1, 6);
      let last = 0;
      for (let i = 0; i <= 40; i += 1) {
        const value = puppetShiftReveal(kind, (duration * i) / 40);
        expect(value).toBeGreaterThanOrEqual(last - 1e-9);
        last = value;
      }
    }
    const cutAt = PUPPET_SHIFT.pop.duration * PUPPET_SHIFT.pop.cut!;
    expect(puppetShiftReveal("pop", cutAt - 0.03)).toBeLessThan(0.05);
    expect(puppetShiftReveal("pop", cutAt + 0.03)).toBeGreaterThan(0.95);
  });

  test("the body's part starts and ends at rest; a pop squashes then springs, a melt sinks", () => {
    const moved = (d: ReturnType<typeof puppetGestureDelta>) => Math.abs(d.nod) + Math.abs(d.stretch) + Math.abs(d.shoulders) + Math.abs(d.posture) + Math.abs(d.tilt);
    for (const kind of PUPPET_SHIFT_KINDS) {
      const { duration } = PUPPET_SHIFT[kind];
      expect(moved(puppetShiftGesture(kind, 0, 1, puppetGestureDelta()))).toBeLessThan(1e-3);
      expect(moved(puppetShiftGesture(kind, duration + 0.5, 1, puppetGestureDelta()))).toBe(0);
      expect(moved(puppetShiftGesture(kind, duration * 0.5, 0, puppetGestureDelta()))).toBe(0);
    }
    const cutAt = PUPPET_SHIFT.pop.duration * PUPPET_SHIFT.pop.cut!;
    expect(puppetShiftGesture("pop", cutAt * 0.95, 1, puppetGestureDelta()).stretch).toBeLessThan(0);
    let stretched = 0;
    for (let age = cutAt; age < cutAt + 0.3; age += 0.01) stretched = Math.max(stretched, puppetShiftGesture("pop", age, 1, puppetGestureDelta()).stretch);
    expect(stretched).toBeGreaterThan(0);
    expect(puppetShiftGesture("melt", 0.45, 1, puppetGestureDelta()).posture).toBeLessThan(0);
  });
});

describe("puppet arrivals", () => {
  test("an entrance sharpens from the full blur; an exit softens into it", () => {
    expect(puppetArrivalBlur("entering", 0)).toBe(PUPPET_ARRIVAL_BLUR_PX);
    expect(puppetArrivalBlur("entering", 1)).toBe(0);
    expect(puppetArrivalBlur("exiting", 0)).toBe(0);
    expect(puppetArrivalBlur("exiting", 1)).toBe(PUPPET_ARRIVAL_BLUR_PX);
    expect(puppetArrivalBlur("entering", 0.5)).toBeLessThan(PUPPET_ARRIVAL_BLUR_PX / 2);
    expect(puppetArrivalBlur("entering", -1)).toBe(PUPPET_ARRIVAL_BLUR_PX);
  });
});

describe("puppet atmosphere", () => {
  test("each ambient effect brings its own weather; none is calm; the cold adds breath", () => {
    expect(puppetAtmosphere(null, false)).toEqual(PUPPET_CALM_AIR);
    expect(puppetAtmosphere("snow", false)).toMatchObject({ snow: 0.6, breath: 1 });
    expect(puppetAtmosphere("heavy_rain", false).wet).toBeGreaterThan(puppetAtmosphere("rain", false).wet);
    expect(puppetAtmosphere("fog", false).fog).toBe(1);
    expect(puppetAtmosphere("embers", false).fire).toBe(1);
    expect(puppetAtmosphere("fireflies", false).fireflies).toBe(1);
    expect(puppetAtmosphere("dream_haze", false).haze).toBe(1);
    expect(puppetAtmosphere("danger_pulse", false).pulse).toBe(1);
    expect(puppetAtmosphere("sepia_flashback", false).grain).toBe(1);
    expect(puppetAtmosphere("nonsense", true)).toEqual({ ...PUPPET_CALM_AIR, breath: 1 });
  });

  test("a snowy, wintry or freezing plate is cold; warm ones and none are not", () => {
    expect(puppetColdPlace({ location: "Snowy mountain pass" })).toBe(true);
    expect(puppetColdPlace({ timeOfDay: "winter night" })).toBe(true);
    expect(puppetColdPlace({ weather: "freezing fog" })).toBe(true);
    expect(puppetColdPlace({ location: "icy harbour" })).toBe(true);
    expect(puppetColdPlace({ location: "Sunny beach", weather: "hot" })).toBe(false);
    expect(puppetColdPlace({ location: "Office" , weather: "nice" })).toBe(false);
    expect(puppetColdPlace(null)).toBe(false);
  });

  test("firelight flickers within its range; the danger beat follows the overlay", () => {
    for (let t = 0; t < 5; t += 0.07) {
      const flicker = puppetFireFlicker(t, 0.3);
      expect(flicker).toBeGreaterThanOrEqual(0.55);
      expect(flicker).toBeLessThanOrEqual(1);
    }
    expect(puppetDangerBeat(0.3)).toBe(0);
    expect(puppetDangerBeat(1)).toBe(1);
    expect(puppetDangerBeat(Number.NaN)).toBe(0);
  });

  test("two fireflies drift around the upper body and blink", () => {
    const glows = new Set<number>();
    for (let t = 0; t < 20; t += 0.5) {
      const flies = puppetFireflies(t, 0.4, 0, 0.8, 0.9);
      expect(flies).toHaveLength(2);
      for (const fly of flies) {
        expect(Math.abs(fly.x)).toBeLessThan(0.5);
        expect(fly.y).toBeGreaterThan(0.3);
        expect(fly.y).toBeLessThan(1.1);
        glows.add(Math.round(fly.glow * 10));
      }
    }
    expect(glows.has(0)).toBe(true);
    expect(glows.has(10)).toBe(true);
  });

  test("snow settles slowly and melts faster", () => {
    let coverage = 0;
    for (let i = 0; i < 10 * 60; i += 1) coverage = puppetSnowStep(coverage, 1, 1 / 60);
    expect(coverage).toBeGreaterThan(0.15);
    expect(coverage).toBeLessThan(0.35);
    const melted = puppetSnowStep(coverage, 0, 8);
    expect(melted).toBeLessThan(coverage * 0.4);
  });
});

describe("puppet breath clouds", () => {
  test("the mouth sits below the face centre, toward the side faced", () => {
    const [x, y] = puppetMouth(0, 0.8, 0.1, 0.12, -1);
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0.8);
    expect(puppetMouth(0, 0.8, 0.1, 0.12, 0)[0]).toBe(0);
  });

  test("a cloud drifts forward and up, grows, thins out and is gone after its life", () => {
    const puff = puppetPuff(0, 0.7, 1, 0.1, 10, 1, 0.3);
    const early = puppetPuffAt(puff, 10.2)!;
    const late = puppetPuffAt(puff, 11.2)!;
    expect(late.x).toBeGreaterThan(early.x);
    expect(late.y).toBeGreaterThan(early.y);
    expect(late.r).toBeGreaterThan(early.r);
    expect(late.alpha).toBeLessThan(early.alpha);
    expect(puppetPuffAt(puff, 10 + PUPPET_PUFF_S + 0.01)).toBeNull();
    expect(puppetPuffAt(puff, 9.9)).toBeNull();
  });

  test("an exhale starts when the breath cycle passes its middle, across the wrap too", () => {
    expect(puppetExhaleStarted(0.45, 0.52)).toBe(true);
    expect(puppetExhaleStarted(0.52, 0.6)).toBe(false);
    expect(puppetExhaleStarted(0.95, 0.55)).toBe(true);
    expect(puppetExhaleStarted(0.95, 0.05)).toBe(false);
    expect(puppetExhaleStarted(0.3, 0.3)).toBe(false);
    let exhales = 0;
    let before = puppetBreathCycle(0, 0.4);
    for (let t = 1 / 60; t < 40; t += 1 / 60) {
      const after = puppetBreathCycle(t, 0.4);
      if (puppetExhaleStarted(before, after)) exhales += 1;
      before = after;
    }
    // One exhale per breath, about every four seconds.
    expect(exhales).toBeGreaterThanOrEqual(8);
    expect(exhales).toBeLessThanOrEqual(11);
  });
});
