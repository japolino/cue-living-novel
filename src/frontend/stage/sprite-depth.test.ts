import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import { VnStage } from "./vn-stage";
import { plateLightSide, PLATE_LIGHT_BIAS, SPRITE_DEPTH, measurePlateLight } from "./sprite-depth";
import {
  FRONT_AMBIENT_EFFECTS,
  FRONT_AMBIENT_MAX_DENSITY,
  FRONT_RAIN_STREAKS,
  generateAmbientMarkup,
  generateFrontAmbientMarkup,
  isFrontAmbientEffect,
} from "./procedural-particles";
import type { AmbientEffect } from "../store";
import { SPRITE_HOT_SET, type SpriteTurnView } from "../../shared/sprites";

const GRADES: AmbientEffect[] = ["vignette_dark", "sepia_flashback", "desaturate", "dream_haze", "danger_pulse"];
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const pts = (html: string) => count(html, /class="vn-pt[ "]/g);

/** Rain streaks a back markup draws on a 1280x720 stage (tile rects scaled to the area). */
function backRainStreaks(html: string): number {
  let total = 0;
  for (const m of html.matchAll(/--tile:url\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\);--tw:(\d+)px;--th:(\d+)px/g)) {
    const svg = atob(m[1]!);
    total += count(svg, /<rect /g) * ((1280 * 720) / (Number(m[2]) * Number(m[3])));
  }
  return total;
}

describe("front ambient layer markup", () => {
  test("every particle ambient has a front copy; grades have none", () => {
    for (const effect of FRONT_AMBIENT_EFFECTS) {
      expect(isFrontAmbientEffect(effect)).toBe(true);
      expect(generateFrontAmbientMarkup(effect).length).toBeGreaterThan(20);
    }
    for (const grade of GRADES) {
      expect(isFrontAmbientEffect(grade)).toBe(false);
      expect(generateFrontAmbientMarkup(grade)).toBe("");
    }
    expect(isFrontAmbientEffect(null)).toBe(false);
  });

  test("is deterministic and uses only inline data", () => {
    for (const effect of FRONT_AMBIENT_EFFECTS) {
      const html = generateFrontAmbientMarkup(effect);
      expect(generateFrontAmbientMarkup(effect)).toBe(html);
      expect(html).not.toMatch(/https?:/);
    }
  });

  test(`density stays within ${FRONT_AMBIENT_MAX_DENSITY * 100}% of the back layer`, () => {
    for (const effect of ["snow", "sakura", "fireflies", "embers"] as const) {
      const front = pts(generateFrontAmbientMarkup(effect));
      const back = pts(generateAmbientMarkup(effect));
      expect(front).toBeGreaterThan(0);
      expect(front).toBeLessThanOrEqual(back * FRONT_AMBIENT_MAX_DENSITY);
    }
    for (const effect of ["rain", "heavy_rain"] as const) {
      const front = count(generateFrontAmbientMarkup(effect), /vn-streak/g);
      expect(front).toBe(FRONT_RAIN_STREAKS[effect]);
      expect(front).toBeLessThanOrEqual(backRainStreaks(generateAmbientMarkup(effect)) * FRONT_AMBIENT_MAX_DENSITY);
    }
    // Fog: one near bank in front of three back banks.
    expect(count(generateFrontAmbientMarkup("fog"), /vn-fog-layer /g)).toBe(1);
    expect(count(generateAmbientMarkup("fog"), /vn-fog-layer /g)).toBe(3);
    // Heavy rain moves a smaller wet lens to the front.
    const lens = (html: string) => count(html, /vn-drop/g) - count(html, /vn-drop--run/g);
    expect(lens(generateFrontAmbientMarkup("heavy_rain"))).toBeGreaterThan(0);
    expect(lens(generateFrontAmbientMarkup("heavy_rain"))).toBeLessThanOrEqual(lens(generateAmbientMarkup("heavy_rain")) * FRONT_AMBIENT_MAX_DENSITY + 1);
  });

  test("front particles are larger and faster than the back ones", () => {
    const sizes = (html: string, cls: string) => [...html.matchAll(new RegExp(`class="vn-pt [^"]*${cls}[^"]*" style="[^"]*--sz:([\\d.]+)px`, "g"))].map((m) => Number(m[1]));
    const falls = (html: string) => [...html.matchAll(/--fd:([\d.]+)s/g)].map((m) => Number(m[1]));
    const max = (xs: number[]) => Math.max(...xs);
    const min = (xs: number[]) => Math.min(...xs);
    const snowFront = generateFrontAmbientMarkup("snow");
    const snowBack = generateAmbientMarkup("snow");
    expect(min(sizes(snowFront, "vn-flake"))).toBeGreaterThan(max(sizes(snowBack, "vn-flake--mid")));
    expect(max(falls(snowFront))).toBeLessThan(min(falls(snowBack)));
    const sakuraFront = generateFrontAmbientMarkup("sakura");
    expect(min(sizes(sakuraFront, "vn-petal"))).toBeGreaterThan(max(sizes(generateAmbientMarkup("sakura"), "vn-petal--mid")));
  });
});

describe("plate light side", () => {
  const image = (w: number, h: number, lum: (x: number, y: number) => number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      const v = Math.round(lum(x, y) * 255);
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
    return data;
  };
  test("finds the brighter side of the upper plate", () => {
    expect(plateLightSide(image(24, 14, (x) => (x < 8 ? 0.9 : 0.3)), 24, 14)).toBe("left");
    expect(plateLightSide(image(24, 14, (x) => (x > 16 ? 0.9 : 0.3)), 24, 14)).toBe("right");
    expect(plateLightSide(image(24, 14, () => 0.5), 24, 14)).toBe("top");
  });
  test("ignores the floor band and small differences", () => {
    // A bright floor on the right (bottom quarter) does not count.
    expect(plateLightSide(image(24, 14, (x, y) => (y >= 11 && x > 16 ? 1 : 0.4)), 24, 14)).toBe("top");
    const slight = 1 + PLATE_LIGHT_BIAS / 4;
    expect(plateLightSide(image(24, 14, (x) => (x > 16 ? 0.5 * Math.sqrt(slight) : 0.5)), 24, 14)).toBe("top");
  });
  test("degenerate input falls back to top", () => {
    expect(plateLightSide(new Uint8ClampedArray(0), 24, 14)).toBe("top");
    expect(plateLightSide(image(24, 14, () => 0), 24, 14)).toBe("top");
    expect(plateLightSide(image(2, 2, () => 1), 2, 2)).toBe("top");
  });
  test("without a browser canvas the measurement is unavailable", async () => {
    expect(await measurePlateLight("/plates/x.png")).toBeNull();
  });
  test("depth table: plate 1x, sprites 1.15x, front 1.4x", () => {
    expect(SPRITE_DEPTH).toEqual({ plate: 1, sprites: 1.15, front: 1.4 });
  });
});

describe("VnStage sprite-mode depth layers", () => {
  let restore: () => void;
  let stage: VnStage;
  const root = () => (stage as unknown as { root: FakeNode }).root;
  const scene = () => root().querySelector("[data-vn-scene]")!;
  const front = () => root().querySelector("[data-vn-ambient-front]");
  const plateLight = () => root().querySelector("[data-vn-plate-light]");
  const sceneChildren = () => scene().children.filter((c) => !c.isText).map((c) => [...c.attributes.keys()].find((k) => k.startsWith("data-vn-")));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeEach(() => {
    restore = installFakeDocument();
    stage = new VnStage({
      mount: new FakeNode("div") as unknown as HTMLElement,
      textSpeed: 0,
      createImage: () => ({ complete: true, naturalWidth: 100, decode: async () => {}, src: "", addEventListener() {}, removeEventListener() {} }),
    });
  });
  afterEach(() => { stage.destroy(); restore(); });

  test("scene mode never creates the depth layers", () => {
    stage.applyAmbient("rain");
    stage.triggerEffect("lightning");
    expect(front()).toBeNull();
    expect(plateLight()).toBeNull();
    expect(stage.getAmbientFrontOverlay()).toBeNull();
    expect(stage.getFxOverlay().innerHTML).toContain("vn-bolt");
    expect(scene().dataset.vnLightning).toBeUndefined();
  });

  test("sprite mode mounts the front copy right after the sprites, and follows the ambient", () => {
    stage.setPresentationMode("sprites");
    stage.applyAmbient("snow");
    const el = front()!;
    expect(el).not.toBeNull();
    expect(el.hasAttribute("data-vn-ambient")).toBe(true);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.className).toBe("vn-ambient-front-snow");
    expect(el.innerHTML).toContain("vn-flake--front");
    expect(el.hidden).toBe(false);
    const order = sceneChildren();
    expect(scene().children.filter((c) => !c.isText).indexOf(el)).toBe(order.indexOf("data-vn-sprites") + 1);
    // The back overlay is still the stage's own ambient overlay.
    expect(stage.getAmbientOverlay()).not.toBe(stage.getAmbientFrontOverlay());
    expect(stage.getAmbientOverlay().className).toBe("vn-ambient-snow");

    stage.applyAmbient("vignette_dark");
    expect(el.innerHTML).toBe("");
    expect(el.hidden).toBe(true);
    stage.applyAmbient("embers");
    expect(el.className).toBe("vn-ambient-front-embers");
    stage.applyAmbient(null);
    expect(el.innerHTML).toBe("");
  });

  test("switching to scene mode empties the front layer; back to sprites restores it", () => {
    stage.setPresentationMode("sprites");
    stage.applyAmbient("rain");
    const el = front()!;
    expect(el.innerHTML).toContain("vn-streak");
    stage.setPresentationMode("scene");
    expect(el.innerHTML).toBe("");
    expect(el.hidden).toBe(true);
    stage.setPresentationMode("sprites");
    stage.applyAmbient("rain");
    expect(el.innerHTML).toContain("vn-streak");
    expect(el.hidden).toBe(false);
  });

  test("lightning in sprite mode lights the plate behind the sprites and self-clears", async () => {
    stage.setPresentationMode("sprites");
    stage.triggerEffect("lightning");
    const light = plateLight()!;
    expect(light).not.toBeNull();
    const order = sceneChildren();
    expect(order.indexOf("data-vn-plate-light")).toBe(order.indexOf("data-vn-ambient") + 1);
    expect(order.indexOf("data-vn-plate-light")).toBeLessThan(order.indexOf("data-vn-sprites"));
    expect(light.innerHTML).toContain("vn-bolt");
    expect(stage.getFxOverlay().innerHTML).toBe("");
    expect(scene().dataset.vnLightning).toBe("true");
    expect(root().querySelector("[data-vn-flash]")!.dataset.vnFlash).toBe("lightning");
    await wait(600);
    expect(scene().dataset.vnLightning).toBeUndefined();
    expect(light.innerHTML).toBe("");
  });

  test("resetEffects and effects off clear or skip the sprite lightning", () => {
    stage.setPresentationMode("sprites");
    stage.triggerEffect("lightning");
    stage.resetEffects();
    expect(scene().dataset.vnLightning).toBeUndefined();
    expect(plateLight()!.innerHTML).toBe("");
    stage.setEffectIntensity("off");
    stage.triggerEffect("lightning");
    expect(scene().dataset.vnLightning).toBeUndefined();
  });

  test("a sprite turn without a browser canvas leaves the light side unset", async () => {
    const view: SpriteTurnView = {
      staging: { version: 1, source: "planner", cast: [{ characterKey: "mira", name: "Mira", identity: "", attire: null }], plates: [], paragraphs: [{ actors: [{ characterKey: "mira", expression: "idle", slot: "center", facing: "viewer", focus: true, motion: "none", emote: "none", intensity: 3 }], plateKey: "p", light: "day" }] },
      sets: { mira: { setKey: "s", name: "Mira", attire: null, expressions: Object.fromEntries(SPRITE_HOT_SET.map((id) => [id, { expression: id, status: "queued" as const }])), readyCount: 0, updatedAt: "" } },
      plates: { p: { plateKey: "p", location: "x", timeOfDay: null, weather: null, status: "ready", url: "/plates/p.png" } },
    };
    stage.setPresentationMode("sprites");
    stage.loadTurn({ mode: "standard", paragraphs: [{ id: "a", text: "Hi." }], sprites: view });
    await wait(10);
    expect(scene().dataset.vnLightSide).toBeUndefined();
  });
});
