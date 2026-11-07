import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import { SpriteTouch } from "./sprite-touch-ui";
import type { TouchCharacterRef } from "../../shared/touch";

/** The saved bond of a character and touches made before it arrived. */
const mira: TouchCharacterRef = { characterKey: "mira", name: "Mira" };

describe("touch bond while the saved bond is on its way", () => {
  let restore: () => void;
  let touch: SpriteTouch;
  let clock = 0;
  const saved: number[] = [];

  beforeEach(() => {
    const restoreDocument = installFakeDocument();
    // The gauges check focus with `instanceof HTMLElement`.
    const globals = globalThis as { HTMLElement?: unknown };
    const hadElement = "HTMLElement" in globals;
    globals.HTMLElement ??= FakeNode;
    restore = () => { if (!hadElement) delete globals.HTMLElement; restoreDocument(); };
    saved.length = 0;
    clock = 0;
    touch = new SpriteTouch({
      root: new FakeNode("div") as unknown as HTMLElement,
      sounds: { touch: () => true },
      callbacks: { onCharacters: () => {}, onBond: (_character, bond) => { saved.push(bond); } },
      motion: () => false,
      now: () => clock,
      random: () => 0,
    });
    touch.setSettings({ ...touch.getSettings(), spriteTouch: true, spriteTouchLines: false });
    touch.setActive(true);
  });
  afterEach(() => { touch.destroy(); restore(); });

  const pat = () => {
    clock += 1000;
    return touch.touch({ ref: mira, area: "head", point: { x: 0, y: 0 }, head: { x: 0, y: 0 }, animalEars: false, react: () => true });
  };

  test("a touch before the saved bond arrives counts on top of it and never saves over it", async () => {
    touch.setCharacters([mira]);
    expect(pat()).not.toBeNull();
    const early = touch.bondOf("mira");
    expect(early).toBeGreaterThan(0);
    // The saved 85 arrives after the touch (its save may already be due).
    await new Promise((resolve) => setTimeout(resolve, 0));
    touch.applyStates([{ characterKey: "mira", bond: 85, pack: null }]);
    expect(touch.bondOf("mira")).toBeGreaterThan(85);
    touch.setActive(false);
    expect(saved).toEqual([touch.bondOf("mira")]);
  });

  test("nothing is saved for a character whose bond never arrived", () => {
    touch.setCharacters([mira]);
    pat();
    touch.setActive(false);
    expect(saved).toEqual([]);
  });
});
