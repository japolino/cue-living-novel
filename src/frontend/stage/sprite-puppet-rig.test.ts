import { describe, expect, test } from "bun:test";

import { spriteFaceSpot, spriteGeometry } from "./sprite-layer";
import {
  PUPPET_AMPLITUDE,
  PUPPET_REACTION_MS,
  PUPPET_REST,
  cssFilterMatrix,
  parseCssColor,
  puppetBlendIndex,
  puppetDisplace,
  puppetFaceOffset,
  puppetGrid,
  puppetMeshPositions,
  puppetPhase,
  puppetPose,
  puppetReactionFor,
  puppetRig,
  type PuppetPose,
  type PuppetPoseInput,
} from "./sprite-puppet-rig";
import { OUTLINE_ALPHA_HIGH, OUTLINE_ALPHA_LOW, outlineOffsets, silhouetteInPlace } from "./sprite-outline";

// The fixture's Mira: full body, detected face (scripts/sprite-stage-browser-fixture.ts).
const image = { bbox: [0.0865, 0.0214, 0.7716, 0.9786] as [number, number, number, number], width: 416, height: 608, face: [0.3669, 0.16, 0.2343, 0.1497] as [number, number, number, number] };
const geometry = spriteGeometry(image);
const rig = puppetRig(geometry, spriteFaceSpot(image, geometry));
const pose = (patch: Partial<PuppetPose>): PuppetPose => ({ ...PUPPET_REST, ...patch });
const length = ([x, y]: [number, number]) => Math.hypot(x, y);

describe("puppet rig", () => {
  test("the neck sits under the face and the chest below the neck, inside the figure", () => {
    expect(rig.neckY).toBeLessThan(rig.faceY - rig.faceH / 2);
    expect(rig.neckX).toBeCloseTo(rig.faceX, 6);
    expect(rig.chestY).toBeLessThan(rig.neckY);
    expect(rig.chestY).toBeGreaterThan(0);
    expect(rig.faceY).toBeLessThan(rig.figH);
  });

  test("a framing estimate (no face box) still gives a head near the top", () => {
    const estimated = puppetRig(geometry, spriteFaceSpot({ ...image, face: undefined as never }, geometry));
    expect(estimated.faceY / estimated.figH).toBeGreaterThan(0.75);
    expect(estimated.faceX).toBe(0);
  });
});

describe("puppet displacement", () => {
  const feet: [number, number] = [0, 0.01];
  const face: [number, number] = [rig.faceX, rig.faceY];
  const knee: [number, number] = [0, rig.figH * 0.3];

  test("the rest pose moves nothing", () => {
    for (const [x, y] of [feet, face, knee]) expect(puppetDisplace(rig, PUPPET_REST, x, y)).toEqual([0, 0]);
  });

  test("the sway bends from the feet: the top moves most, the feet stay", () => {
    const p = pose({ sway: 0.01 });
    const top = puppetDisplace(rig, p, 0, rig.figH);
    const mid = puppetDisplace(rig, p, 0, rig.figH / 2);
    expect(top[0]).toBeCloseTo(0.01, 6);
    expect(mid[0]).toBeCloseTo(0.0025, 6);
    expect(length(puppetDisplace(rig, p, ...feet))).toBeLessThan(1e-5);
    // Off the spine the bend turns the body, so a shoulder to the right dips.
    expect(puppetDisplace(rig, p, 0.1, rig.figH * 0.8)[1]).toBeLessThan(0);
  });

  test("the head turns around the neck; the legs and far-away points stay", () => {
    const p = pose({ tilt: 0.05 });
    expect(length(puppetDisplace(rig, p, ...face))).toBeGreaterThan(0.0005);
    expect(length(puppetDisplace(rig, p, ...knee))).toBe(0);
    expect(length(puppetDisplace(rig, p, rig.faceX + rig.faceW * 2.5, rig.faceY))).toBe(0);
    // Counterclockwise: the top of the head moves left.
    expect(puppetDisplace(rig, p, rig.faceX, rig.faceY + rig.faceH)[0]).toBeLessThan(0);
  });

  test("breathing lifts the shoulders and head, not the legs, and widens the chest", () => {
    const p = pose({ lift: 0.004, widen: 0.02 });
    expect(puppetDisplace(rig, p, ...face)[1]).toBeCloseTo(0.004, 6);
    expect(puppetDisplace(rig, p, ...knee)[1]).toBe(0);
    const side = puppetDisplace(rig, p, rig.chestX + rig.chestRx * 0.7, rig.chestY);
    expect(side[0]).toBeGreaterThan(0);
  });

  test("a nod dips the head; a bounce stretches from the feet", () => {
    expect(puppetDisplace(rig, pose({ nod: 0.01 }), ...face)[1]).toBeLessThan(-0.005);
    const bounce = pose({ stretch: 0.02 });
    expect(puppetDisplace(rig, bounce, 0, rig.figH)[1]).toBeCloseTo(0.02 * rig.figH, 6);
    expect(puppetDisplace(rig, bounce, 0, 0)[1]).toBe(0);
  });

  test("the marks follow the face displacement", () => {
    const p = pose({ tilt: 0.03, lift: 0.003, sway: 0.006 });
    expect(puppetFaceOffset(rig, p)).toEqual(puppetDisplace(rig, p, rig.faceX, rig.faceY));
  });
});

describe("puppet pose over time", () => {
  const base: PuppetPoseInput = { time: 12.3, phase: 0.4, figH: rig.figH, breathing: 1, sway: 1, head: 1, talk: 0, reaction: null, strength: 1 };

  test("strength 0 is the rest pose; strength scales everything", () => {
    expect(puppetPose({ ...base, strength: 0 })).toEqual({ ...PUPPET_REST });
    const full = puppetPose(base);
    const half = puppetPose({ ...base, strength: 0.5 });
    expect(half.sway).toBeCloseTo(full.sway / 2, 9);
    expect(half.tilt).toBeCloseTo(full.tilt / 2, 9);
  });

  test("each toggle silences its part", () => {
    const still = puppetPose({ ...base, breathing: 0, sway: 0, head: 0 });
    expect([still.lift, still.widen, still.sway, still.tilt, still.bob].map(Math.abs)).toEqual([0, 0, 0, 0, 0]);
    expect(puppetPose({ ...base, sway: 0 }).sway).toBe(0);
    expect(puppetPose({ ...base, breathing: 0 }).lift).toBe(0);
  });

  test("motion stays small and keeps moving", () => {
    let maxSway = 0;
    let maxTilt = 0;
    const samples = new Set<string>();
    for (let t = 0; t < 20; t += 0.25) {
      const p = puppetPose({ ...base, time: t });
      maxSway = Math.max(maxSway, Math.abs(p.sway));
      maxTilt = Math.max(maxTilt, Math.abs(p.tilt));
      samples.add(p.sway.toFixed(6));
    }
    expect(maxSway).toBeLessThanOrEqual(PUPPET_AMPLITUDE.sway * rig.figH + 1e-9);
    expect(maxTilt).toBeLessThan(PUPPET_AMPLITUDE.tilt * 1.2);
    expect(samples.size).toBeGreaterThan(60);
  });

  test("talking bobs the head down in syllables", () => {
    let lowest = 0;
    for (let t = 0; t < 2; t += 0.02) lowest = Math.min(lowest, puppetPose({ ...base, head: 0, talk: 1, time: t }).bob);
    expect(lowest).toBeLessThan(-PUPPET_AMPLITUDE.talkBob * rig.figH * 0.3);
  });

  test("a nod peaks halfway and ends; a bounce stretches then settles", () => {
    const nodAt = (age: number) => puppetPose({ ...base, breathing: 0, sway: 0, head: 0, reaction: { kind: "nod", age } }).nod;
    const half = PUPPET_REACTION_MS.nod / 2000;
    expect(nodAt(half)).toBeCloseTo(PUPPET_AMPLITUDE.nod * rig.figH, 9);
    expect(nodAt(half)).toBeGreaterThan(nodAt(half / 3));
    expect(nodAt(PUPPET_REACTION_MS.nod / 1000 + 0.01)).toBe(0);
    const bounce = (age: number) => puppetPose({ ...base, breathing: 0, sway: 0, head: 0, reaction: { kind: "bounce", age } }).stretch;
    expect(bounce(0.09)).toBeGreaterThan(0);
    expect(bounce(0.28)).toBeLessThan(0);
    expect(bounce(1)).toBe(0);
  });

  test("bright expressions bounce, the rest nod; phases are stable", () => {
    expect(puppetReactionFor("laughing")).toBe("bounce");
    expect(puppetReactionFor("sad")).toBe("nod");
    expect(puppetReactionFor(null)).toBe("nod");
    expect(puppetPhase("mira")).toBe(puppetPhase("mira"));
    expect(puppetPhase("mira")).not.toBe(puppetPhase("ren"));
    for (const key of ["a", "mira", "ren", "kaede"]) {
      expect(puppetPhase(key)).toBeGreaterThanOrEqual(0);
      expect(puppetPhase(key)).toBeLessThan(1);
    }
  });
});

describe("puppet mesh", () => {
  test("the grid covers the image; at rest it maps onto the whole canvas", () => {
    const grid = puppetGrid(4, 6);
    expect(grid.uv.length).toBe(5 * 7 * 2);
    expect(grid.indices.length).toBe(4 * 6 * 6);
    expect(Math.max(...grid.indices)).toBe(5 * 7 - 1);
    const positions = puppetMeshPositions(rig, PUPPET_REST, grid);
    expect([positions[0], positions[1]]).toEqual([-1, 1]);
    expect([positions.at(-2), positions.at(-1)]).toEqual([1, -1]);
  });

  test("a pose moves the head vertices and leaves the bottom row", () => {
    const grid = puppetGrid(18, 28);
    const rest = puppetMeshPositions(rig, PUPPET_REST, grid);
    const moved = puppetMeshPositions(rig, pose({ tilt: 0.04, sway: 0.008 }), grid);
    let headShift = 0;
    let bottomShift = 0;
    for (let i = 0; i < rest.length; i += 2) {
      const v = grid.uv[i + 1]!;
      const shift = Math.hypot(moved[i]! - rest[i]!, moved[i + 1]! - rest[i + 1]!);
      if (Math.abs(v - (rig.by - rig.faceY)) < 0.05) headShift = Math.max(headShift, shift);
      if (v === 1) bottomShift = Math.max(bottomShift, shift);
    }
    expect(headShift).toBeGreaterThan(0.004);
    expect(bottomShift).toBeLessThan(0.0005);
  });
});

describe("CSS look read back for the shader", () => {
  test("filters become one colour matrix, left to right", () => {
    expect(cssFilterMatrix("none")).toEqual({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0] });
    expect(cssFilterMatrix("brightness(50%)").m[0]).toBeCloseTo(0.5, 9);
    // brightness then contrast: 2 * (0.5 c) + (0.5 - 1) = c - 0.5
    const both = cssFilterMatrix("brightness(0.5) contrast(2)");
    expect(both.m[0]).toBeCloseTo(1, 9);
    expect(both.o[0]).toBeCloseTo(-0.5, 9);
    // saturate(0): every row is the luminance weights.
    const gray = cssFilterMatrix("saturate(0)");
    expect(gray.m.slice(0, 3).map((n) => Number(n.toFixed(3)))).toEqual([0.213, 0.715, 0.072]);
    expect(gray.m.slice(6, 9).map((n) => Number(n.toFixed(3)))).toEqual([0.213, 0.715, 0.072]);
    // Non-colour functions are skipped.
    expect(cssFilterMatrix("blur(2px) brightness(1.1)").m[4]).toBeCloseTo(1.1, 9);
  });

  test("the light presets' filters keep white white-ish and grey grey", () => {
    const night = cssFilterMatrix("brightness(0.8) saturate(0.78) contrast(1.04)");
    const grey = night.m[0]! * 0.5 + night.m[1]! * 0.5 + night.m[2]! * 0.5 + night.o[0];
    expect(grey).toBeCloseTo(0.5 + (0.4 - 0.5) * 1.04, 6);
  });

  test("computed colours parse", () => {
    expect(parseCssColor("rgb(255, 0, 51)")).toEqual([1, 0, 0.2, 1]);
    expect(parseCssColor("rgba(0, 0, 0, 0)")).toEqual([0, 0, 0, 0]);
    expect(parseCssColor("rgb(255 255 255 / 50%)")).toEqual([1, 1, 1, 0.5]);
    expect(parseCssColor("transparent")).toEqual([0, 0, 0, 0]);
    expect(parseCssColor("#fff")).toEqual([1, 1, 1, 1]);
    expect(parseCssColor("color(display-p3 1 0 0)")).toBeNull();
  });

  test("blend modes map to shader indices, unknown ones to normal", () => {
    expect(puppetBlendIndex("soft-light")).toBe(4);
    expect(puppetBlendIndex("multiply")).toBe(1);
    expect(puppetBlendIndex("luminosity")).toBe(0);
  });
});

describe("sticker outline", () => {
  test("offsets fill a disc up to the radius", () => {
    expect(outlineOffsets(0)).toEqual([]);
    const offsets = outlineOffsets(4);
    const radii = offsets.map(([x, y]) => Math.hypot(x, y));
    expect(Math.max(...radii)).toBeCloseTo(4, 6);
    expect(Math.min(...radii)).toBeLessThan(1.5);
    expect(offsets.length).toBeLessThanOrEqual(48 * 3);
  });

  test("the silhouette is white and drops faint alpha", () => {
    const pixels = new Uint8ClampedArray([10, 20, 30, OUTLINE_ALPHA_LOW, 10, 20, 30, OUTLINE_ALPHA_HIGH, 10, 20, 30, 255, 0, 0, 0, 111]);
    silhouetteInPlace(pixels);
    expect([...pixels.slice(0, 4)]).toEqual([255, 255, 255, 0]);
    expect([...pixels.slice(4, 8)]).toEqual([255, 255, 255, 255]);
    expect(pixels[11]).toBe(255);
    expect(pixels[15]).toBeGreaterThan(0);
    expect(pixels[15]).toBeLessThan(255);
  });
});
