import { describe, expect, test } from "bun:test";
import { installFakeDocument } from "./stage-test-dom.js";
import { VnStage } from "./vn-stage.js";

describe("VnStage auto-advance hold coordination", () => {
  test("holds auto-play countdown when speech is loading or playing, and advances after speech finishes", () => {
    const restore = installFakeDocument();
    try {
      let isHeld = true;
      let advanceCount = 0;

      const stage = new VnStage({
        mount: document.createElement("div"),
        textSpeed: 0,
        isAutoAdvanceHeld: () => isHeld,
        onAdvance: () => { advanceCount += 1; },
      });

      stage.loadTurn({
        paragraphs: [
          { id: "p-0", text: "Paragraph 0" },
          { id: "p-1", text: "Paragraph 1" },
        ],
        choices: [],
      });

      // Enable auto-play
      stage.toggleAutoPlay(true);
      expect((stage as any).isAutoPlay).toBe(true);
      // Because isHeld is true, countdown timer must NOT be running
      expect((stage as any).autoPlayTimer).toBeNull();
      expect(advanceCount).toBe(0);

      // Now release the hold (e.g. speech ended)
      isHeld = false;
      stage.checkAutoPlay();
      expect((stage as any).autoPlayTimer).not.toBeNull();
    } finally {
      restore();
    }
  });

  test("holdAutoPlay immediately cancels an active auto-play countdown (e.g. speech paused)", () => {
    const restore = installFakeDocument();
    try {
      let isHeld = false;
      let advanceCount = 0;

      const stage = new VnStage({
        mount: document.createElement("div"),
        textSpeed: 0,
        isAutoAdvanceHeld: () => isHeld,
        onAdvance: () => { advanceCount += 1; },
      });

      stage.loadTurn({
        paragraphs: [
          { id: "p-0", text: "Paragraph 0" },
          { id: "p-1", text: "Paragraph 1" },
        ],
        choices: [],
      });

      stage.toggleAutoPlay(true);
      expect((stage as any).autoPlayTimer).not.toBeNull();

      // Speech pauses or loads: hold auto-play
      isHeld = true;
      stage.holdAutoPlay();
      expect((stage as any).autoPlayTimer).toBeNull();
      expect(advanceCount).toBe(0);
    } finally {
      restore();
    }
  });

  test("error or stopped speech unholds countdown and allows advance without deadlock", () => {
    const restore = installFakeDocument();
    try {
      let isHeld = true;
      let advanceCount = 0;

      const stage = new VnStage({
        mount: document.createElement("div"),
        textSpeed: 0,
        isAutoAdvanceHeld: () => isHeld,
        onAdvance: () => { advanceCount += 1; },
      });

      stage.loadTurn({
        paragraphs: [
          { id: "p-0", text: "Paragraph 0" },
          { id: "p-1", text: "Paragraph 1" },
        ],
        choices: [],
      });

      stage.toggleAutoPlay(true);
      expect((stage as any).autoPlayTimer).toBeNull();

      // Speech errors out or user stops it: status transitions to error/idle (isHeld -> false)
      isHeld = false;
      stage.checkAutoPlay();
      expect((stage as any).autoPlayTimer).not.toBeNull();
    } finally {
      restore();
    }
  });
});
