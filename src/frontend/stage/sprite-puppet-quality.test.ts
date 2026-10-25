import { describe, expect, test } from "bun:test";

import { PUPPET_RENDER_SCALES, puppetQuality, puppetQualityFrame, puppetRenderScale, type PuppetQuality } from "./sprite-puppet-quality";

const clock = () => ({ t: 1000 });

/** Frames for `seconds`, each `interval(scale)` ms after the last; the scale in effect after each frame. */
function run(q: PuppetQuality, at: { t: number }, seconds: number, interval: (scale: number) => number): number[] {
  const scales: number[] = [];
  const end = at.t + seconds * 1000;
  let frame = 0;
  while (at.t < end) {
    at.t += interval(puppetRenderScale(q)) + (frame++ % 2 ? 0.6 : -0.6);
    puppetQualityFrame(q, at.t);
    scales.push(puppetRenderScale(q));
  }
  return scales;
}

/** Frame time that grows with the canvases' pixels (the scale squared), never under a 60 Hz vsync. */
const pixelBound = (fullMs: number) => (scale: number) => Math.max(16.7, fullMs * scale * scale);
const share = (scales: number[], keep: (scale: number) => boolean) => scales.filter(keep).length / scales.length;

describe("puppet render scale", () => {
  test("a machine that keeps up stays at full scale", () => {
    for (const ms of [16.7, 6.9, 19]) {
      const q = puppetQuality();
      expect(run(q, clock(), 60, () => ms).every((scale) => scale === 1)).toBe(true);
    }
  });

  test("frames the canvases slow down drop the scale until they keep up, and it stays there", () => {
    for (const [fullMs, settled] of [[30, 0.8], [50, 0.65], [80, 0.5], [120, 0.5]] as const) {
      const q = puppetQuality();
      const at = clock();
      run(q, at, 15, pixelBound(fullMs));
      expect(puppetRenderScale(q)).toBe(settled);
      expect(run(q, at, 60, pixelBound(fullMs)).every((scale) => scale === settled)).toBe(true);
    }
  });

  test("a slowdown that isn't the canvases' (a busy page, a 30 fps cap) leaves the scale alone", () => {
    const q = puppetQuality();
    const at = clock();
    const scales = run(q, at, 300, () => 33.3);
    // Each try at fewer pixels lasts one window, and the waits between tries double.
    expect(share(scales, (scale) => scale < 1)).toBeLessThan(0.04);
    expect(scales.slice(-60 * 30).filter((scale) => scale < 1).length).toBeLessThan(80);
    expect(puppetRenderScale(q)).toBe(1);
  });

  test("climbs back once the load goes away", () => {
    const q = puppetQuality();
    const at = clock();
    run(q, at, 10, pixelBound(50));
    expect(puppetRenderScale(q)).toBe(0.65);
    const scales = run(q, at, 12, () => 16.7);
    expect(scales.at(-1)).toBe(1);
    expect(scales.findIndex((scale) => scale === 1)).toBeLessThan(10 * 60);
  });

  test("a step up that doesn't hold goes straight back, and waits longer each time", () => {
    const q = puppetQuality();
    const at = clock();
    const scales = run(q, at, 300, (scale) => (scale === 1 ? 25 : 16.7));
    const ups = scales.filter((scale, i) => scale === 1 && (scales[i - 1] ?? 1) < 1).length;
    expect(ups).toBeGreaterThan(2);
    expect(ups).toBeLessThanOrEqual(7);
    expect(share(scales, (scale) => scale === 1)).toBeLessThan(0.05);
  });

  test("single long frames and pauses don't count", () => {
    const q = puppetQuality();
    const at = clock();
    let frame = 0;
    expect(run(q, at, 30, () => (++frame % 10 === 0 ? 60 : 16.7)).every((scale) => scale === 1)).toBe(true);
    // A hidden tab: one 5 s interval, then slow frames start a fresh window.
    const scales = run(q, at, 5.5, (scale) => (frame++ === 0 ? 5000 : 16.7));
    expect(scales.every((scale) => scale === 1)).toBe(true);
    expect(q.samples.length).toBeLessThan(30);
  });

  test("scales run from full down to half", () => {
    expect(PUPPET_RENDER_SCALES[0]).toBe(1);
    expect(PUPPET_RENDER_SCALES.at(-1)).toBe(0.5);
    expect([...PUPPET_RENDER_SCALES].every((scale, i, all) => i === 0 || scale < all[i - 1]!)).toBe(true);
  });
});
