import assert from "node:assert/strict";
import test from "node:test";

import {
  createInitialVnStageState,
  reduceVnStage,
  selectVnStageView,
} from "./vn-store";

const paragraphs = [
  { id: "p1", text: "First" },
  { id: "p2", text: "Second" },
];

test("the final paragraph must be acknowledged before input unlocks", () => {
  let state = reduceVnStage(createInitialVnStageState(), {
    type: "load-turn",
    turn: { mode: "standard", paragraphs },
  });

  state = reduceVnStage(state, { type: "advance" });
  assert.equal(state.currentParagraphIndex, 1);
  assert.equal(selectVnStageView(state).acceptsInput, false);

  state = reduceVnStage(state, { type: "advance" });
  assert.equal(selectVnStageView(state).acceptsInput, true);
});

test("a pending image keeps the previous image visible", () => {
  const previous = { url: "old.webp", alt: "Old scene", requestId: "old" };
  let state = createInitialVnStageState({ displayedImage: previous });

  state = reduceVnStage(state, {
    type: "image-requested",
    image: { url: "new.webp", alt: "New scene", requestId: "new" },
  });
  assert.equal(state.displayedImage, previous);

  state = reduceVnStage(state, { type: "image-ready", requestId: "new" });
  assert.equal(state.displayedImage?.url, "new.webp");
});

test("an obsolete image completion cannot replace the active request", () => {
  let state = createInitialVnStageState();
  state = reduceVnStage(state, {
    type: "image-requested",
    image: { url: "new.webp", alt: "", requestId: "new" },
  });

  state = reduceVnStage(state, { type: "image-ready", requestId: "old" });
  assert.equal(state.displayedImage, null);
  assert.equal(state.pendingImage?.requestId, "new");
});

test("CYOA choices remain hidden while paragraphs are revealing", () => {
  let state = reduceVnStage(createInitialVnStageState(), {
    type: "load-turn",
    turn: {
      mode: "cyoa",
      paragraphs: [paragraphs[0]!],
      choices: [{ id: "a", label: "Go", value: "go" }],
    },
  });

  assert.equal(selectVnStageView(state).showChoices, false);
  state = reduceVnStage(state, { type: "advance" });
  assert.equal(selectVnStageView(state).showChoices, true);
});


test("load-turn with preserveImage:false clears the previous scene image", () => {
  const previous = { url: "old.webp", alt: "Old scene", requestId: "old" };
  let state = createInitialVnStageState({ displayedImage: previous, currentParagraphIndex: 2 });

  state = reduceVnStage(state, {
    type: "load-turn",
    turn: { mode: "standard", paragraphs, preserveImage: false },
  });

  assert.equal(state.displayedImage, null);
  assert.equal(state.currentParagraphIndex, 0);
});

test("load-turn without preserveImage keeps the previous image and resets to paragraph 0", () => {
  const previous = { url: "old.webp", alt: "Old scene", requestId: "old" };
  let state = createInitialVnStageState({ displayedImage: previous });

  state = reduceVnStage(state, {
    type: "load-turn",
    turn: { mode: "standard", paragraphs },
  });

  assert.equal(state.displayedImage, previous);
  assert.equal(state.currentParagraphIndex, 0);
});
