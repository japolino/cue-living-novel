import { describe, expect, test } from "bun:test";

import { THEME_PRESET_IDS } from "../../config.js";
import { VN_ORNAMENT_GROUPS, VN_ORNAMENT_LAYER_MARKUP } from "./ornaments";

describe("framework ornament markup", () => {
  test("has exactly one group for each canonical preset", () => {
    expect(Object.keys(VN_ORNAMENT_GROUPS).sort()).toEqual([...THEME_PRESET_IDS].sort());
    expect(Object.keys(VN_ORNAMENT_GROUPS)).toHaveLength(7);
    for (const id of THEME_PRESET_IDS) {
      expect(VN_ORNAMENT_GROUPS[id].trim()).toStartWith("<g ");
      expect(VN_ORNAMENT_GROUPS[id]).toContain(`data-vn-preset="${id}"`);
    }
  });

  test("marks every group as hidden and unfocusable on its opening tag", () => {
    for (const markup of Object.values(VN_ORNAMENT_GROUPS)) {
      const openingTag = markup.match(/^<g\b[^>]*>/)?.[0];
      expect(openingTag).toBeDefined();
      expect(openingTag).toContain('aria-hidden="true"');
      expect(openingTag).toContain('focusable="false"');
    }
  });

  test("contains only local, inert ornament markup", () => {
    const markup = Object.values(VN_ORNAMENT_GROUPS).join("\n") + VN_ORNAMENT_LAYER_MARKUP;
    for (const forbidden of ["<img", "url(", "@import", "http", "<script", "foreignobject"]) {
      expect(markup.toLowerCase()).not.toContain(forbidden);
    }
  });

  test("uses one correctly sized SVG layer", () => {
    expect(VN_ORNAMENT_LAYER_MARKUP.match(/<svg\b/g)).toHaveLength(1);
    expect(VN_ORNAMENT_LAYER_MARKUP).toContain('viewBox="0 0 1600 900"');
  });

  test("ornaments anchor to the frame, never to the moving dialogue plate", () => {
    // The plate sits roughly in x 100..1500, y 540..840 of the 1600x900 box and
    // moves with text length, so no placed shape may land inside that band.
    for (const [id, markup] of Object.entries(VN_ORNAMENT_GROUPS)) {
      for (const match of markup.matchAll(/translate\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)\)/g)) {
        const x = Number(match[1]);
        const y = Number(match[2]);
        const inPlate = x > 100 && x < 1500 && y > 540 && y < 840;
        expect(inPlate, `${id} places a shape at ${x},${y}`).toBe(false);
      }
    }
  });
});
