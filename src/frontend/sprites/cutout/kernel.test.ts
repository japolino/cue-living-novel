import { describe, expect, test } from "bun:test";
import { createCutoutKernel } from "./kernel.js";

const k = createCutoutKernel();

type Img = { rgba: Uint8ClampedArray; w: number; h: number };

function image(w: number, h: number, bg: [number, number, number] = [255, 255, 255]): Img {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([...bg, 255], i * 4);
  return { rgba, w, h };
}
function fill(img: Img, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.rgba.set([...c, 255], (y * img.w + x) * 4);
}
/** Dark outline (2 px) around a rectangle filled with `inside`. */
function figure(img: Img, x0: number, y0: number, x1: number, y1: number, inside: [number, number, number]): void {
  fill(img, x0, y0, x1, y1, [20, 20, 30]);
  fill(img, x0 + 2, y0 + 2, x1 - 2, y1 - 2, inside);
}
function mask(img: Img, rects: Array<[number, number, number, number, number]>): Float32Array {
  const m = new Float32Array(img.w * img.h);
  for (const [x0, y0, x1, y1, v] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * img.w + x] = v;
  return m;
}
const alphaAt = (rgba: Uint8ClampedArray, w: number, x: number, y: number) => rgba[(y * w + x) * 4 + 3]!;
const rgbAt = (rgba: Uint8ClampedArray, w: number, x: number, y: number) => [...rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)];

describe("sprite cut-out kernel", () => {
  test("white background, dark-outlined figure: outside clear, inside opaque, bbox", () => {
    const img = image(100, 160);
    figure(img, 30, 20, 70, 150, [230, 180, 160]);
    const r = k.cutoutPixels(img.rgba, img.w, img.h, mask(img, [[30, 20, 70, 150, 1]]));
    expect(alphaAt(r.rgba, 100, 5, 5)).toBe(0);
    expect(alphaAt(r.rgba, 100, 50, 80)).toBe(255);
    expect(alphaAt(r.rgba, 100, 30, 80)).toBe(255); // the outline itself
    expect(r.background).toEqual([255, 255, 255]);
    expect(r.bbox[0]).toBeCloseTo(30 / 100, 5);
    expect(r.bbox[1]).toBeCloseTo(20 / 160, 5);
    expect(r.bbox[2]).toBeCloseTo(40 / 100, 5);
    expect(r.bbox[3]).toBeCloseTo(130 / 160, 5);
  });

  test("white clothing inside the outline stays opaque", () => {
    const img = image(100, 160);
    figure(img, 30, 20, 70, 150, [255, 255, 255]);
    for (const m of [mask(img, [[30, 20, 70, 150, 1]]), null]) {
      const r = k.cutoutPixels(img.rgba, img.w, img.h, m);
      expect(alphaAt(r.rgba, 100, 50, 80)).toBe(255);
      expect(rgbAt(r.rgba, 100, 50, 80)).toEqual([255, 255, 255]);
    }
  });

  test("mask guard: white clothing open to the border does not leak", () => {
    const img = image(100, 160);
    figure(img, 30, 20, 70, 150, [252, 252, 252]);
    fill(img, 30, 140, 70, 160, [252, 252, 252]); // dress runs off the bottom edge, outline open
    fill(img, 30, 140, 32, 160, [20, 20, 30]);
    fill(img, 68, 140, 70, 160, [20, 20, 30]);
    const guarded = k.cutoutPixels(img.rgba, img.w, img.h, mask(img, [[30, 20, 70, 160, 1]]));
    expect(alphaAt(guarded.rgba, 100, 50, 80)).toBe(255);
    expect(alphaAt(guarded.rgba, 100, 50, 155)).toBe(255);
    const basic = k.cutoutPixels(img.rgba, img.w, img.h, null);
    expect(alphaAt(basic.rgba, 100, 50, 80)).toBe(0); // without the model the flood fill leaks
  });

  test("enclosed background gap becomes transparent when the mask says background", () => {
    const img = image(100, 160);
    figure(img, 20, 20, 80, 150, [230, 180, 160]);
    fill(img, 40, 60, 60, 90, [255, 255, 255]); // gap between arm and body: 20x30 = 600 px
    fill(img, 45, 110, 49, 114, [255, 255, 255]); // tiny gap: 16 px (<= 30) stays
    const m = mask(img, [[20, 20, 80, 150, 1], [40, 60, 60, 90, 0], [45, 110, 49, 114, 0]]);
    const r = k.cutoutPixels(img.rgba, img.w, img.h, m);
    expect(alphaAt(r.rgba, 100, 50, 75)).toBe(0);
    expect(alphaAt(r.rgba, 100, 47, 112)).toBe(255);
    const basic = k.cutoutPixels(img.rgba, img.w, img.h, null);
    expect(alphaAt(basic.rgba, 100, 50, 75)).toBe(255); // basic cannot tell a gap from white cloth
  });

  test("separate speck the mask calls background is dropped", () => {
    const img = image(100, 160);
    figure(img, 30, 20, 70, 150, [230, 180, 160]);
    fill(img, 5, 5, 11, 11, [60, 50, 40]);
    const r = k.cutoutPixels(img.rgba, img.w, img.h, mask(img, [[30, 20, 70, 150, 1]]));
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) expect(alphaAt(r.rgba, 100, x, y)).toBe(0);
    expect(r.bbox[0]).toBeCloseTo(0.3, 5);
    const basic = k.cutoutPixels(img.rgba, img.w, img.h, null);
    expect(alphaAt(basic.rgba, 100, 8, 8)).toBe(255);
    expect(basic.bbox[0]).toBeCloseTo(0.05, 5);
  });

  test("off-white tinted background is found and removed", () => {
    const bg: [number, number, number] = [238, 233, 222];
    const img = image(100, 160, bg);
    figure(img, 30, 20, 70, 150, [200, 90, 90]);
    expect(k.backgroundColor(img.rgba, img.w, img.h)).toEqual(bg);
    for (const m of [mask(img, [[30, 20, 70, 150, 1]]), null]) {
      const r = k.cutoutPixels(img.rgba, img.w, img.h, m);
      expect(alphaAt(r.rgba, 100, 3, 3)).toBe(0);
      expect(alphaAt(r.rgba, 100, 99, 159)).toBe(0);
      expect(alphaAt(r.rgba, 100, 50, 80)).toBe(255);
    }
  });

  test("background colour is the median of the border (noise and a touching figure do not move it)", () => {
    const img = image(64, 64);
    fill(img, 0, 50, 10, 64, [0, 0, 0]);
    img.rgba.set([250, 251, 249, 255], 0);
    expect(k.backgroundColor(img.rgba, 64, 64)).toEqual([255, 255, 255]);
  });

  test("edge defringe: soft edge pixels lose the background colour", () => {
    const img = image(60, 60);
    fill(img, 20, 20, 40, 40, [200, 0, 0]);
    // A one-pixel anti-aliased edge: 50 % red over white.
    fill(img, 19, 20, 20, 40, [228, 128, 128]);
    const r = k.cutoutPixels(img.rgba, img.w, img.h, null);
    const a = alphaAt(r.rgba, 60, 19, 30);
    expect(a).toBe(Math.floor((127 / 70 > 1 ? 1 : 127 / 70) * 255)); // d = 127 -> fully opaque by colour distance
    // A fainter edge: 20 % red over white -> d = 51, alpha 51/70.
    const img2 = image(60, 60);
    fill(img2, 20, 20, 40, 40, [200, 0, 0]);
    fill(img2, 19, 20, 20, 40, [244, 204, 204]);
    const r2 = k.cutoutPixels(img2.rgba, img2.w, img2.h, null);
    const alpha = 51 / 70;
    expect(alphaAt(r2.rgba, 60, 19, 30)).toBe(Math.floor(alpha * 255));
    const [red, green, blue] = rgbAt(r2.rgba, 60, 19, 30);
    expect(green).toBe(Math.floor((204 - (1 - alpha) * 255) / alpha));
    expect(blue).toBe(green!);
    expect(red).toBe(Math.floor((244 - (1 - alpha) * 255) / alpha));
    expect(green!).toBeLessThan(204); // white spill removed
    // Pure background inside the band is fully transparent.
    expect(alphaAt(r2.rgba, 60, 17, 30)).toBe(0);
  });

  test("basic path: flood fill only, no mask needed", () => {
    const img = image(80, 80);
    figure(img, 20, 20, 60, 60, [100, 140, 220]);
    const r = k.cutoutPixels(img.rgba, img.w, img.h, null);
    let opaque = 0;
    for (let i = 3; i < r.rgba.length; i += 4) if (r.rgba[i] === 255) opaque++;
    expect(opaque).toBe(40 * 40);
    expect(r.bbox).toEqual([0.25, 0.25, 0.5, 0.5]);
  });

  test("empty and all-background images give an empty bbox", () => {
    const img = image(32, 32);
    const r = k.cutoutPixels(img.rgba, 32, 32, null);
    expect(r.bbox).toEqual([0, 0, 0, 0]);
    expect(r.rgba.every((v, i) => i % 4 !== 3 || v === 0)).toBe(true);
  });

  test("model input: longest side to S, centred zero padding, CHW / 255; mask maps back", () => {
    const img = image(40, 80, [10, 20, 30]);
    const input = k.modelInput(img.rgba, 40, 80, 64);
    expect(input.box).toEqual({ x: 16, y: 0, width: 32, height: 64 });
    expect(input.tensor.length).toBe(3 * 64 * 64);
    expect(input.tensor[0]).toBe(0); // padding
    expect(input.tensor[20]).toBeCloseTo(10 / 255, 6);
    expect(input.tensor[64 * 64 + 20]).toBeCloseTo(20 / 255, 6);
    expect(input.tensor[2 * 64 * 64 + 20]).toBeCloseTo(30 / 255, 6);
    const output = new Float32Array(64 * 64);
    for (let y = 0; y < 64; y++) for (let x = 16; x < 48; x++) output[y * 64 + x] = x < 32 ? 1 : 0;
    const m = k.modelMask(output, input, 40, 80);
    expect(m.length).toBe(40 * 80);
    expect(m[40 * 40 + 2]).toBe(1);
    expect(m[40 * 40 + 37]).toBe(0);
  });

  test("bilinear resize keeps flat colour and averages when shrinking", () => {
    const src = new Float32Array(8 * 8).fill(100);
    expect([...k.resizeBilinear(src, 8, 8, 1, 3, 5)].every((v) => Math.abs(v - 100) < 1e-4)).toBe(true);
    const stripes = new Float32Array(8).map((_, i) => (i % 2 ? 200 : 0));
    const half = k.resizeBilinear(stripes, 8, 1, 1, 4, 1);
    // PIL's triangle filter widened 2x: taps 1/8, 3/8, 3/8, 1/8 -> 0/200 stripes average to 100 inside.
    expect(half[1]).toBeCloseTo(100, 3);
    expect(half[2]).toBeCloseTo(100, 3);
  });

  test("832x1216 sprite stays fast", () => {
    const img = image(832, 1216);
    figure(img, 200, 100, 640, 1216, [230, 200, 190]);
    const m = mask(img, [[200, 100, 640, 1216, 0.95]]);
    k.cutoutPixels(img.rgba, img.w, img.h, m); // warm up
    const t = performance.now();
    k.cutoutPixels(img.rgba, img.w, img.h, m);
    expect(performance.now() - t).toBeLessThan(1500); // generous for CI; Chromium measures ~120 ms
  });

  test("factory source is self-contained (it is shipped to a Worker as text)", () => {
    const rebuilt = new Function(`return (${String(createCutoutKernel)})`)() as typeof createCutoutKernel;
    const img = image(60, 90);
    figure(img, 10, 10, 50, 80, [255, 255, 255]);
    fill(img, 20, 30, 40, 50, [255, 255, 255]);
    const m = mask(img, [[10, 10, 50, 80, 1], [20, 30, 40, 50, 0]]);
    const a = k.cutoutPixels(img.rgba, 60, 90, m);
    const b = rebuilt().cutoutPixels(img.rgba, 60, 90, m);
    expect([...b.rgba]).toEqual([...a.rgba]);
    expect(b.bbox).toEqual(a.bbox);
  });
});
