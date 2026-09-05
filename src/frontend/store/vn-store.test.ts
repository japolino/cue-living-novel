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

test("previous restores reading state, preserves draft and invalidates future images", () => {
  let state = reduceVnStage(createInitialVnStageState(), { type: "load-turn", turn: { mode: "cyoa", paragraphs, choices: [{ id: "a", label: "Answer", value: "answer" }] } });
  assert.equal(selectVnStageView(state).canGoBack, false);
  assert.equal(reduceVnStage(state, { type: "previous" }), state);
  state = reduceVnStage(state, { type: "advance" });
  state = reduceVnStage(state, { type: "advance" });
  state = { ...state, draft: "Keep this draft", pendingImage: { url: "future.png", alt: "", requestId: "future" } };
  state = reduceVnStage(state, { type: "previous" });
  assert.equal(state.currentParagraphIndex, 0);
  assert.equal(state.phase, "revealing");
  assert.equal(state.draft, "Keep this draft");
  assert.equal(state.turnFinished, false);
  assert.equal(selectVnStageView(state).showChoices, false);
  assert.equal(state.pendingImage, null);
  assert.equal(reduceVnStage(state, { type: "image-ready", requestId: "future" }).displayedImage, null);
});

test("previous cannot rewind an in-flight submission or a user reply", () => {
  for (const phase of ["planning", "submitting", "waiting-for-response", "error"] as const) {
    const state = createInitialVnStageState({ phase, paragraphs, currentParagraphIndex: 1 });
    assert.equal(reduceVnStage(state, { type: "previous" }), state);
  }
  const user = createInitialVnStageState({ phase: "revealing", paragraphs, currentParagraphIndex: 1, isUserTurn: true });
  assert.equal(reduceVnStage(user, { type: "previous" }), user);
});

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

test("load-turn without preserveImage clears the previous scene image", () => {
  const previous = { url: "old.webp", alt: "Old scene", requestId: "old" };
  let state = createInitialVnStageState({ displayedImage: previous });

  state = reduceVnStage(state, {
    type: "load-turn",
    turn: { mode: "standard", paragraphs },
  });

  assert.equal(state.displayedImage, null);
  assert.equal(state.currentParagraphIndex, 0);
});

test("load-turn with preserveImage:true keeps the previous image and resets to paragraph 0", () => {
  const previous = { url: "old.webp", alt: "Old scene", requestId: "old" };
  let state = createInitialVnStageState({ displayedImage: previous });

  state = reduceVnStage(state, {
    type: "load-turn",
    turn: { mode: "standard", paragraphs, preserveImage: true },
  });

  assert.equal(state.displayedImage, previous);
  assert.equal(state.currentParagraphIndex, 0);
});

test("reset action clears stage state and displayed image", () => {
  const previous = { url: "old.webp", alt: "Old scene", requestId: "old" };
  let state = createInitialVnStageState({ displayedImage: previous, paragraphs });

  state = reduceVnStage(state, { type: "reset" });

  assert.equal(state.displayedImage, null);
  assert.equal(state.paragraphs.length, 0);
  assert.equal(state.phase, "idle");
});

test("advancing past the last paragraph marks turnFinished and enables reroll prompt", () => {
  let state = reduceVnStage(createInitialVnStageState(), {
    type: "load-turn",
    turn: { mode: "standard", paragraphs },
  });

  assert.equal(state.turnFinished, false);
  assert.equal(state.showRerollPrompt, false);

  // Advance to paragraph 1
  state = reduceVnStage(state, { type: "advance" });
  assert.equal(state.turnFinished, false);

  // Advance past paragraph 1 -> awaiting-input
  state = reduceVnStage(state, { type: "advance" });
  assert.equal(state.phase, "awaiting-input");
  assert.equal(state.turnFinished, true);
  assert.equal(state.showRerollPrompt, true);
});

test("loading a turn with 0 paragraphs flags noValidOutput and enables reroll prompt", () => {
  const state = reduceVnStage(createInitialVnStageState(), {
    type: "load-turn",
    turn: { mode: "standard", paragraphs: [] },
  });

  assert.equal(state.phase, "awaiting-input");
  assert.equal(state.noValidOutput, true);
  assert.equal(state.showRerollPrompt, true);
  assert.equal(state.turnFinished, false);
});

test("updating assetProgress updates state and clearing resets it", () => {
  let state = createInitialVnStageState();
  state = reduceVnStage(state, {
    type: "set-asset-progress",
    progress: { current: 1, total: 3 },
  });
  assert.deepEqual(state.assetProgress, { current: 1, total: 3 });

  state = reduceVnStage(state, {
    type: "set-asset-progress",
    progress: { current: 2, total: 3 },
  });
  assert.deepEqual(state.assetProgress, { current: 2, total: 3 });

  state = reduceVnStage(state, {
    type: "set-asset-progress",
    progress: null,
  });
  assert.equal(state.assetProgress, null);
});

test("entering waiting-for-response or planning clears prior turnFinished and assetProgress", () => {
  let state = createInitialVnStageState({
    turnFinished: true,
    showRerollPrompt: true,
    assetProgress: { current: 3, total: 3 },
  });

  state = reduceVnStage(state, {
    type: "set-phase",
    phase: "waiting-for-response",
  });
  assert.equal(state.turnFinished, false);
  assert.equal(state.showRerollPrompt, false);
  assert.equal(state.assetProgress, null);
});

test("present-user-paragraph action appends paragraph, sets phase revealing, and flags isUserTurn", () => {
  let state = createInitialVnStageState({
    phase: "awaiting-input",
    paragraphs: [{ id: "p1", text: "Assistant text", speaker: "Hina" }],
    currentParagraphIndex: 0,
    turnFinished: true,
  });

  state = reduceVnStage(state, {
    type: "present-user-paragraph",
    paragraph: { id: "user-1", text: "My response action.", speaker: "Jay" },
  });

  assert.equal(state.paragraphs.length, 2);
  assert.equal(state.currentParagraphIndex, 1);
  assert.equal(state.phase, "revealing");
  assert.equal(state.isUserTurn, true);
  assert.equal(state.paragraphs[1]?.speaker, "Jay");
  assert.equal(state.paragraphs[1]?.text, "My response action.");

  // Advancing past the user paragraph transitions to waiting-for-response
  state = reduceVnStage(state, { type: "advance" });
  assert.equal(state.phase, "waiting-for-response");
  assert.equal(state.isUserTurn, false);
});
