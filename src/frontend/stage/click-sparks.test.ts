import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import {
  CLICK_POP_MS,
  CLICK_SPARK_COUNT,
  CLICK_SPARK_MAX_BURSTS,
  CLICK_SPARK_MS,
  clickEffectFor,
  containerPoint,
  sparkVectors,
  spawnClickSparks,
} from "./click-sparks";

describe("clickEffectFor", () => {
  test("the reader's choice stands while motion is allowed", () => {
    expect(clickEffectFor("sparks", "full", false)).toBe("sparks");
    expect(clickEffectFor("sparks-pop", "gentle", false)).toBe("sparks-pop");
    expect(clickEffectFor("off", "full", false)).toBe("off");
  });

  test("Motion Still and reduced motion turn it off", () => {
    expect(clickEffectFor("sparks", "off", false)).toBe("off");
    expect(clickEffectFor("sparks-pop", "off", false)).toBe("off");
    expect(clickEffectFor("sparks", "full", true)).toBe("off");
    expect(clickEffectFor("sparks-pop", "gentle", true)).toBe("off");
  });

  test("an unknown setting falls back to sparks", () => {
    expect(clickEffectFor(undefined, "full", false)).toBe("sparks");
    expect(clickEffectFor("fireworks", "full", false)).toBe("sparks");
  });
});

describe("sparkVectors", () => {
  test("sparks spread around the pointer, 16-30 px out, small, with a short delay", () => {
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const sparks = sparkVectors(CLICK_SPARK_COUNT, random);
    expect(sparks).toHaveLength(CLICK_SPARK_COUNT);
    for (const spark of sparks) {
      const distance = Math.hypot(spark.dx, spark.dy);
      expect(distance).toBeGreaterThanOrEqual(15.9);
      expect(distance).toBeLessThanOrEqual(30.1);
      expect(spark.size).toBeGreaterThanOrEqual(8);
      expect(spark.size).toBeLessThanOrEqual(12);
      expect(spark.delay).toBeGreaterThanOrEqual(0);
      expect(spark.delay).toBeLessThanOrEqual(40);
    }
    // All the way round: sparks land on both sides of the pointer.
    expect(sparks.some((s) => s.dx > 0) && sparks.some((s) => s.dx < 0)).toBe(true);
    expect(sparks.some((s) => s.dy > 0) && sparks.some((s) => s.dy < 0)).toBe(true);
  });
});

describe("containerPoint", () => {
  test("client px become container px, scaled when the host is zoomed", () => {
    const rect = { left: 100, top: 50, width: 400, height: 300 };
    const plain = { offsetWidth: 400, offsetHeight: 300, getBoundingClientRect: () => rect as DOMRect };
    expect(containerPoint(plain, 150, 80)).toEqual({ x: 50, y: 30 });
    // Drawn at half size (CSS zoom / transform): one screen px is two container px.
    const zoomed = { offsetWidth: 800, offsetHeight: 600, getBoundingClientRect: () => rect as DOMRect };
    expect(containerPoint(zoomed, 150, 80)).toEqual({ x: 100, y: 60 });
    // No layout box: the point as given.
    expect(containerPoint({ offsetWidth: 0, offsetHeight: 0 }, 12, 34)).toEqual({ x: 12, y: 34 });
  });
});

describe("spawnClickSparks", () => {
  let restore: () => void;
  let container: FakeNode;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    restore = installFakeDocument();
    container = new FakeNode("div");
  });
  afterEach(() => restore());

  test("a burst lands at the point: decorative, no pointer events, seven sparks and no '!'", () => {
    const burst = spawnClickSparks(container as unknown as HTMLElement, 40, 25, "sparks") as unknown as FakeNode;
    expect(burst).not.toBeNull();
    expect(container.children).toContain(burst);
    expect(burst.getAttribute("data-vn-click-sparks")).toBe("sparks");
    expect(burst.getAttribute("aria-hidden")).toBe("true");
    expect(burst.style.left).toBe("40px");
    expect(burst.style.top).toBe("25px");
    expect(burst.style.pointerEvents).toBe("none");
    expect(burst.querySelectorAll("[data-vn-click-spark]")).toHaveLength(CLICK_SPARK_COUNT);
    expect(burst.querySelector("[data-vn-click-pop]")).toBeNull();
  });

  test("sparks-pop adds the '!' and the burst removes itself when done", async () => {
    const burst = spawnClickSparks(container as unknown as HTMLElement, 0, 0, "sparks-pop") as unknown as FakeNode;
    expect(burst.querySelector("[data-vn-click-pop]")!.textContent).toBe("!");
    await wait(CLICK_POP_MS + 100);
    expect(container.children).not.toContain(burst);
  });

  test("a plain burst is gone shortly after its 0.3 s", async () => {
    spawnClickSparks(container as unknown as HTMLElement, 0, 0, "sparks");
    await wait(CLICK_SPARK_MS + 140);
    expect(container.children).toHaveLength(0);
  });

  test("off spawns nothing; a fast clicker keeps only the newest bursts", () => {
    expect(spawnClickSparks(container as unknown as HTMLElement, 1, 1, "off")).toBeNull();
    expect(spawnClickSparks(container as unknown as HTMLElement, Number.NaN, 1, "sparks")).toBeNull();
    expect(container.children).toHaveLength(0);
    for (let i = 0; i < CLICK_SPARK_MAX_BURSTS + 3; i += 1) spawnClickSparks(container as unknown as HTMLElement, i, i, "sparks");
    expect(container.children).toHaveLength(CLICK_SPARK_MAX_BURSTS);
    expect(container.children[0]!.style.left).toBe("3px");
  });
});
