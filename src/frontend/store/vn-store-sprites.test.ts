import { expect, test } from "bun:test";
import { createInitialVnStageState, reduceVnStage } from "./vn-store";

test("clear-image drops the displayed and pending scene image and keeps the reading state", () => {
  const image = { url: "/p.png", alt: "", requestId: "plate:a" };
  const state = createInitialVnStageState({ phase: "revealing", currentParagraphIndex: 2, displayedImage: image, pendingImage: { ...image, requestId: "plate:b" }, imageError: "x" });
  const next = reduceVnStage(state, { type: "clear-image" });
  expect(next.displayedImage).toBeNull();
  expect(next.pendingImage).toBeNull();
  expect(next.imageError).toBeNull();
  expect(next.phase).toBe("revealing");
  expect(next.currentParagraphIndex).toBe(2);
});
