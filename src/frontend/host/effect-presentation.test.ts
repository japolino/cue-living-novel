import { describe, expect, test } from "bun:test";

import { STRONG_STAGE_EFFECTS, presentAmbient, presentEffect } from "./effect-presentation";
import type { StageEffect } from "../store/index.js";

const ALL_EFFECTS: StageEffect[] = [
  "shake", "flash_white", "flash_red", "zoom_in", "fade_to_black", "shake_hard", "rumble",
  "zoom_punch", "speed_lines", "fade_from_black", "fade_to_white", "lightning", "zoom_out",
  "tilt", "heartbeat", "blur_pulse", "sparkle_burst", "hearts_burst", "confetti",
];

describe("presentEffect (beginner effect presentation)", () => {
  test("full passes every effect through unchanged (default playback)", () => {
    for (const effect of ALL_EFFECTS) expect(presentEffect(effect, "full")).toBe(effect);
  });

  test("off suppresses every one-shot effect", () => {
    for (const effect of ALL_EFFECTS) expect(presentEffect(effect, "off")).toBeNull();
  });

  test("gentle drops strong shakes and screen flashes but keeps mild motion", () => {
    expect(presentEffect("flash_white", "gentle")).toBeNull();
    expect(presentEffect("flash_red", "gentle")).toBeNull();
    expect(presentEffect("lightning", "gentle")).toBeNull();
    expect(presentEffect("zoom_punch", "gentle")).toBeNull();
    expect(presentEffect("blur_pulse", "gentle")).toBeNull();
    expect(presentEffect("heartbeat", "gentle")).toBeNull();
    expect(presentEffect("shake", "gentle")).toBe("shake");
    expect(presentEffect("zoom_in", "gentle")).toBe("zoom_in");
    expect(presentEffect("fade_to_black", "gentle")).toBe("fade_to_black");
    expect(presentEffect("sparkle_burst", "gentle")).toBe("sparkle_burst");
    expect(presentEffect("confetti", "gentle")).toBe("confetti");
  });

  test("gentle downgrades hard shakes to the mild shake", () => {
    expect(presentEffect("shake_hard", "gentle")).toBe("shake");
    expect(presentEffect("rumble", "gentle")).toBe("shake");
  });

  test("every strong effect is either dropped or downgraded at gentle, never kept as is", () => {
    for (const effect of STRONG_STAGE_EFFECTS) expect(presentEffect(effect, "gentle")).not.toBe(effect);
  });
});

describe("presentAmbient", () => {
  test("keeps atmospheric ambients at every level and softens only the flashing danger pulse", () => {
    expect(presentAmbient("rain", "off")).toBe("rain");
    expect(presentAmbient("snow", "gentle")).toBe("snow");
    expect(presentAmbient(null, "off")).toBeNull();
    expect(presentAmbient("danger_pulse", "full")).toBe("danger_pulse");
    expect(presentAmbient("danger_pulse", "gentle")).toBe("vignette_dark");
    expect(presentAmbient("danger_pulse", "off")).toBe("vignette_dark");
  });
});
