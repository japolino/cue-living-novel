import { describe, expect, test } from "bun:test";
import type { SpriteImageView } from "../../shared/sprites";
import { TOUCH_GENERIC_LINES, type TouchLinePack } from "../../shared/touch";
import { spriteFaceSpot, spriteGeometry } from "./sprite-layer";
import {
  TOUCH_ESCALATION,
  TOUCH_LOOKS,
  TOUCH_MIN_GAP_MS,
  TOUCH_STREAK_MS,
  TOUCH_SULK_MS,
  bondAfter,
  pickTouchLine,
  spriteTouchAreaAt,
  spriteTouchZones,
  touchClientPoint,
  touchFaceBox,
  touchHandFor,
  touchHandMarkup,
  touchImagePoint,
  touchLinesFor,
  touchMemory,
  touchReaction,
  touchStep,
  touchZoneOf,
  type TouchBox,
} from "./sprite-touch";

/** Touch mode on the stage: zones from the face box, escalation, reactions, lines, the hand. */

// A fixture cut-out (scripts/sprite-stage-browser-fixture.ts, mira_idle) with its detected face.
type Box = NonNullable<SpriteImageView["bbox"]>;
const MIRA = { bbox: [0.0865, 0.0214, 0.7716, 0.9786] as Box, width: 416, height: 608, face: [0.3669, 0.16, 0.2343, 0.1497] as Box };
const centre = (box: TouchBox) => ({ u: (box.left + box.right) / 2, v: (box.top + box.bottom) / 2 });

describe("touch zones", () => {
  const geometry = spriteGeometry(MIRA);
  const zones = spriteTouchZones(geometry, spriteFaceSpot(MIRA, geometry));

  test("are built around the detected face box", () => {
    expect(zones.source).toBe("detected");
    expect(zones.face.left).toBeCloseTo(0.3669, 4);
    expect(zones.face.top).toBeCloseTo(0.16, 4);
    expect(zones.face.right).toBeCloseTo(0.3669 + 0.2343, 4);
    expect(zones.face.bottom).toBeCloseTo(0.16 + 0.1497, 4);
  });

  test("head top above the face, sides beside it, cheeks in its lower part, the rest is a poke", () => {
    expect(zones.head.top).toBeLessThan(zones.face.top);
    expect(zones.head.bottom).toBeLessThan(zones.face.bottom);
    expect(zones.sides[0].right).toBeLessThan(zones.face.left + 0.05);
    expect(zones.sides[1].left).toBeGreaterThan(zones.face.right - 0.05);
    expect(zones.cheeks.top).toBeGreaterThan(zones.face.top);
    expect(spriteTouchAreaAt(zones, (zones.face.left + zones.face.right) / 2, zones.face.top - 0.02)).toBe("head");
    expect(spriteTouchAreaAt(zones, zones.face.left - 0.02, zones.face.top + 0.03)).toBe("side");
    expect(spriteTouchAreaAt(zones, zones.face.right + 0.02, zones.face.top + 0.03)).toBe("side");
    expect(spriteTouchAreaAt(zones, centre(zones.cheeks).u, centre(zones.cheeks).v)).toBe("cheeks");
    expect(spriteTouchAreaAt(zones, 0.5, 0.7)).toBe("body");
  });

  test("off the opaque figure there is no zone", () => {
    expect(spriteTouchAreaAt(zones, 0.02, 0.5)).toBeNull();
    expect(spriteTouchAreaAt(zones, 0.5, 0.005)).toBeNull();
    expect(spriteTouchAreaAt(zones, Number.NaN, 0.5)).toBeNull();
  });

  test("no zone leaves the figure, and no zone reaches below the chin", () => {
    for (const box of [zones.head, zones.sides[0], zones.sides[1], zones.cheeks]) {
      expect(box.left).toBeGreaterThanOrEqual(zones.body.left);
      expect(box.right).toBeLessThanOrEqual(zones.body.right);
      expect(box.top).toBeGreaterThanOrEqual(zones.body.top);
      expect(box.bottom).toBeLessThanOrEqual(zones.face.bottom + (zones.face.bottom - zones.face.top) * 0.1);
    }
  });

  test("without a face they fall back to the proportions of the opaque bbox", () => {
    const plain = { bbox: MIRA.bbox, width: 416, height: 608 } as const;
    const g = spriteGeometry(plain);
    const fallback = spriteTouchZones(g, null);
    expect(fallback.source).toBe("estimate");
    // A figure cut by the bottom edge: cheeks at 70-78% of its height, face 22% of it wide.
    const faceW = fallback.face.right - fallback.face.left;
    expect(faceW).toBeCloseTo((0.22 * g.bh) / g.aspect, 4);
    expect((fallback.face.left + fallback.face.right) / 2).toBeCloseTo(g.cx, 4);
    expect(fallback.face.top).toBeGreaterThan(g.by - g.bh);
    expect(fallback.face.bottom).toBeLessThan(0.45);
    // The spot's own estimate gives the same box.
    const viaSpot = touchFaceBox(g, spriteFaceSpot(plain, g)).box;
    expect(viaSpot.left).toBeCloseTo(fallback.face.left, 4);
    expect(viaSpot.top).toBeCloseTo(fallback.face.top, 4);
    expect(spriteTouchAreaAt(fallback, centre(fallback.cheeks).u, centre(fallback.cheeks).v)).toBe("cheeks");
  });

  test("a client point maps to the image and back, mirrored figures from the other edge", () => {
    const rect = { left: 100, top: 50, width: 200, height: 400 };
    expect(touchImagePoint(rect, 150, 150, false)).toEqual({ u: 0.25, v: 0.25 });
    expect(touchImagePoint(rect, 150, 150, true)).toEqual({ u: 0.75, v: 0.25 });
    expect(touchClientPoint(rect, 0.75, 0.25, true)).toEqual({ x: 150, y: 150 });
    expect(touchImagePoint({ ...rect, width: 0 }, 1, 1, false)).toBeNull();
  });

  test("the sides are ears only for a character with animal ears", () => {
    expect(touchZoneOf("side", true)).toBe("ears");
    expect(touchZoneOf("side", false)).toBe("hair");
    expect(touchZoneOf("head", true)).toBe("pat");
    expect(touchZoneOf("cheeks", false)).toBe("cheeks");
    expect(touchZoneOf("body", false)).toBe("poke");
  });
});

describe("escalation", () => {
  const run = (zone: Parameters<typeof touchStep>[1], times: number, bond = 0, gap = 600, start = 1000) => {
    const memory = touchMemory();
    const moods: string[] = [];
    for (let i = 0; i < times; i += 1) moods.push(touchStep(memory, zone, bond, start + i * gap)?.mood ?? "skip");
    return { memory, moods };
  };

  test("the third head pat in a row is content", () => {
    expect(run("pat", 3).moods).toEqual(["shy", "shy", "content"]);
  });

  test("first touches follow the bond tier", () => {
    expect(run("pat", 1, 45).moods).toEqual(["warm"]);
    expect(run("hair", 2, 90).moods).toEqual(["fond", "fond"]);
  });

  test("too many cheek squishes end in a pouty hey!, then a sulk", () => {
    const { memory, moods } = run("cheeks", TOUCH_ESCALATION.cheeks.annoyed);
    expect(moods).toEqual(["shy", "shy", "content", "annoyed"]);
    const at = 1000 + 3 * 600;
    expect(memory.sulkUntil).toBe(at + TOUCH_SULK_MS);
    const sulk = touchStep(memory, "cheeks", 0, at + 600);
    expect(sulk).toEqual({ mood: "annoyed", count: 0, sulking: true });
    // Even another zone only gets a huff while it sulks.
    expect(touchStep(memory, "pat", 0, at + 1200)?.sulking).toBe(true);
    // Once over, a pat is a first pat again.
    expect(touchStep(memory, "pat", 0, memory.sulkUntil + 1)).toEqual({ mood: "shy", count: 1, sulking: false });
  });

  test("pokes never get content: the third is annoyed", () => {
    expect(run("poke", 3).moods).toEqual(["shy", "shy", "annoyed"]);
  });

  test("touches too close together only move the hand (cooldown)", () => {
    const memory = touchMemory();
    expect(touchStep(memory, "pat", 0, 1000)).not.toBeNull();
    expect(touchStep(memory, "pat", 0, 1000 + TOUCH_MIN_GAP_MS - 1)).toBeNull();
    expect(touchStep(memory, "pat", 0, 1000 + TOUCH_MIN_GAP_MS)?.count).toBe(2);
  });

  test("a pause ends the streak, and so does touching somewhere else", () => {
    const memory = touchMemory();
    touchStep(memory, "pat", 0, 1000);
    touchStep(memory, "pat", 0, 2000);
    expect(touchStep(memory, "pat", 0, 2000 + TOUCH_STREAK_MS + 1)?.count).toBe(1);
    touchStep(memory, "pat", 0, 9000);
    touchStep(memory, "cheeks", 0, 9600);
    expect(touchStep(memory, "pat", 0, 10_200)?.count).toBe(1);
  });
});

describe("reactions", () => {
  test("each zone and mood shows an expression the sets know and an emote", () => {
    for (const [zone, moods] of Object.entries(TOUCH_LOOKS)) {
      for (const [mood, look] of Object.entries(moods)) {
        expect(look.expression.length, `${zone}/${mood}`).toBeGreaterThan(0);
        expect(look.emote).not.toBe("none");
      }
    }
  });

  test("a pat is a pat, cheeks squish, a poke pokes, annoyed huffs", () => {
    expect(touchReaction("pat", { mood: "shy", count: 1, sulking: false })).toMatchObject({ motion: "pat", sound: "pat", expression: "blushing_shyly", emote: "blush", bond: 2, speaks: true });
    expect(touchReaction("ears", { mood: "warm", count: 1, sulking: false }).motion).toBe("stroke");
    expect(touchReaction("cheeks", { mood: "shy", count: 1, sulking: false })).toMatchObject({ motion: "squish", bond: 1 });
    expect(touchReaction("poke", { mood: "shy", count: 1, sulking: false })).toMatchObject({ motion: "poke", bond: 1 });
    expect(touchReaction("cheeks", { mood: "annoyed", count: 4, sulking: false })).toMatchObject({ motion: "huff", expression: "pouting", emote: "anger", bond: -4, speaks: true });
    expect(touchReaction("pat", { mood: "content", count: 3, sulking: false })).toMatchObject({ mood: "content", bond: 3 });
  });

  test("a sulk huffs without a line and costs a point", () => {
    expect(touchReaction("cheeks", { mood: "annoyed", count: 0, sulking: true })).toMatchObject({ motion: "huff", speaks: false, bond: -1 });
  });

  test("the bond follows the reactions", () => {
    let bond = 10;
    bond = bondAfter(bond, touchReaction("pat", { mood: "content", count: 3, sulking: false }));
    expect(bond).toBe(13);
    bond = bondAfter(bond, touchReaction("cheeks", { mood: "annoyed", count: 4, sulking: false }));
    expect(bond).toBe(9);
  });
});

describe("lines", () => {
  const pack: TouchLinePack = { version: 1, lines: { pat: { shy: ["A", "B", "C"], warm: ["W"] }, hair: { content: ["H"] } } };

  test("the character's own lines first, with mood fallbacks, then the generic ones", () => {
    expect(touchLinesFor(pack, "pat", "shy")).toEqual(["A", "B", "C"]);
    // No fond lines: warm stands in.
    expect(touchLinesFor(pack, "pat", "fond")).toEqual(["W"]);
    // Ears without lines of their own use the hair lines.
    expect(touchLinesFor(pack, "ears", "content")).toEqual(["H"]);
    // No poke lines at all: the generic ones.
    expect(touchLinesFor(pack, "poke", "shy")).toEqual(TOUCH_GENERIC_LINES.lines.poke!.shy!);
    expect(touchLinesFor(null, "cheeks", "annoyed")).toEqual(TOUCH_GENERIC_LINES.lines.cheeks!.annoyed!);
  });

  test("annoyed never borrows a friendly line", () => {
    const friendly: TouchLinePack = { version: 1, lines: { cheeks: { shy: ["Hi"] } } };
    expect(touchLinesFor(friendly, "cheeks", "annoyed")).toEqual(TOUCH_GENERIC_LINES.lines.cheeks!.annoyed!);
  });

  test("the recent lines are not repeated while others remain", () => {
    const recent: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 3; i += 1) seen.add(pickTouchLine(pack, "pat", "shy", recent, () => 0)!);
    expect([...seen].sort()).toEqual(["A", "B", "C"]);
    expect(recent).toEqual(["A", "B", "C"]);
    // All recent: any of them again.
    expect(["A", "B", "C"]).toContain(pickTouchLine(pack, "pat", "shy", recent, () => 0.99)!);
    expect(recent.length).toBe(3);
  });
});

describe("the hand", () => {
  test("an open palm for pats and strokes, two hands for cheeks, a finger for pokes", () => {
    expect(touchHandFor("head")).toBe("palm");
    expect(touchHandFor("side")).toBe("palm");
    expect(touchHandFor("cheeks")).toBe("hands");
    expect(touchHandFor("body")).toBe("finger");
    expect(touchHandFor(null)).toBe("finger");
  });

  test("is inline SVG drawn in code: decorative, no images or links", () => {
    for (const hand of ["palm", "hands", "finger"] as const) {
      const markup = touchHandMarkup(hand);
      expect(markup.startsWith("<svg")).toBe(true);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).not.toMatch(/<image|href=|url\(/);
    }
  });
});
