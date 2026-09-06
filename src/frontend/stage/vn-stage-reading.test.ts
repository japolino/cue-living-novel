import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeDocument, FakeEvent, FakeNode, installFakeDocument } from "./stage-test-dom";
import { VnStage, type VnStageOptions } from "./vn-stage";
import type { VnTurnInput } from "../store";

/**
 * Reading UX regression tests: labels, playback state, stable controls,
 * the "Your turn" hand-off, the status/error surface and the host hooks.
 * They run against the real THEME_MARKUP parsed into a small fake DOM.
 */

const paragraphs = (count: number): VnTurnInput["paragraphs"] =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i}`, text: `Paragraph ${i}.`, speaker: "Mira" }));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("reading UX", () => {
  let restore: () => void;
  let mount: FakeNode;
  let stage: VnStage | null;

  const create = (options: Partial<VnStageOptions> = {}): VnStage => {
    stage = new VnStage({ mount: mount as unknown as HTMLElement, textSpeed: 0, ...options });
    return stage;
  };
  const root = (s: VnStage): FakeNode => (s as unknown as { root: FakeNode }).root;
  const shell = (s: VnStage): FakeNode => s.panelMount as unknown as FakeNode;
  const q = (s: VnStage, selector: string): FakeNode => {
    const node = root(s).querySelector(selector);
    if (!node) throw new Error(`missing ${selector}`);
    return node;
  };
  const advance = (s: VnStage) => (s as unknown as { advance(): void }).advance();
  const badgeTexts = (s: VnStage) => root(s).querySelectorAll("[data-vn-badge]").map((b) => b.textContent.trim());

  beforeEach(() => {
    restore = installFakeDocument();
    mount = new FakeNode("div");
    stage = null;
  });

  afterEach(() => {
    stage?.destroy();
    restore();
  });

  test("controls use plain labels: Back to chat, History, Auto, Skip", () => {
    const s = create();
    const exit = shell(s).querySelector("[data-vn-exit]")!;
    expect(exit.textContent).toBe("Back to chat");
    expect(exit.getAttribute("aria-label")).toBe("Back to chat");
    expect(q(s, "[data-vn-control='log']").textContent.trim()).toBe("History");
    expect(q(s, "[data-vn-backlog-title]").textContent).toBe("History");
    expect(q(s, "[data-vn-backlog-close]").getAttribute("aria-label")).toBe("Close history");
    expect(q(s, "[data-vn-control='auto'] [data-vn-control-label]").textContent).toBe("Auto");
    expect(q(s, "[data-vn-control='auto']").getAttribute("aria-pressed")).toBe("false");
    expect(q(s, "[data-vn-control='skip']").getAttribute("aria-pressed")).toBe("false");
    expect(q(s, "[data-vn-empty-state]").textContent).toContain("Go back to chat");
    expect(q(s, "[data-vn-empty-state]").textContent).not.toContain("Exit");
  });

  test("exitLabel option still overrides the Back to chat accessible name", () => {
    const s = create({ exitLabel: "Leave the story" });
    expect(shell(s).querySelector("[data-vn-exit]")!.getAttribute("aria-label")).toBe("Leave the story");
  });

  test("Skip explains its mode through aria-describedby", () => {
    const s = create();
    const skip = q(s, "[data-vn-control='skip']");
    const description = q(s, `#${skip.getAttribute("aria-describedby")}`);
    expect(description.textContent).toBe("Skips text you have already read and stops at new text.");
    s.setSkipMode("all");
    expect(description.textContent).toBe("Skips all text until your next reply.");
    s.setSkipMode("read");
    expect(description.textContent).toContain("stops at new text");
  });

  test("Previous never leaves the reading toolbar, even at Your turn", () => {
    const s = create();
    s.loadTurn({ mode: "cyoa", paragraphs: paragraphs(2), choices: [{ id: "a", label: "A", value: "a" }] });
    const controls = q(s, "[data-vn-controls]");
    const previous = q(s, "[data-vn-control='previous']");
    expect(previous.parentNode).toBe(controls);
    advance(s);
    advance(s);
    expect(s.getState().phase).toBe("awaiting-input");
    expect(previous.parentNode).toBe(controls);
    expect(q(s, "[data-vn-interaction]").querySelector("[data-vn-control='previous']")).toBeNull();
    expect(previous.disabled).toBe(false);
  });

  test("Continue keeps its place: disabled while it cannot advance, removed only without a paragraph", () => {
    const s = create();
    const next = q(s, "[data-vn-continue]");
    expect(next.hidden).toBe(true);
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(2) });
    expect(next.hidden).toBe(false);
    expect(next.disabled).toBe(false);
    expect(next.dataset.vnReady).toBe("true");
    advance(s);
    advance(s);
    expect(s.getState().phase).toBe("awaiting-input");
    expect(next.hidden).toBe(false);
    expect(next.disabled).toBe(true);
    expect(next.getAttribute("aria-disabled")).toBe("true");
    s.setPhase("waiting-for-response");
    expect(next.hidden).toBe(false);
    expect(next.disabled).toBe(true);
  });

  test("Your turn heading and hint name the hand-off for choices and free text", () => {
    const s = create();
    const interaction = q(s, "[data-vn-interaction]");
    expect(interaction.getAttribute("aria-labelledby")).toBe(q(s, "[data-vn-interaction-title]").id);
    expect(q(s, "[data-vn-interaction-title]").textContent).toBe("Your turn");
    s.loadTurn({ mode: "cyoa", paragraphs: paragraphs(1), choices: [{ id: "a", label: "A", value: "a" }] });
    advance(s);
    expect(interaction.hidden).toBe(false);
    expect(q(s, "[data-vn-interaction-hint]").textContent).toBe("Choose a reply.");
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(1) });
    expect(interaction.hidden).toBe(true);
    advance(s);
    expect(q(s, "[data-vn-interaction-hint]").textContent).toContain("Write your reply");
    expect(q(s, "[data-vn-input]").getAttribute("aria-label")).toBe("Your reply");
  });

  test("Auto shows Pause while on and the footer names the playback state", () => {
    const s = create({ autoPlayDelay: 5000 });
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(3) });
    const auto = q(s, "[data-vn-control='auto']");
    const state = q(s, "[data-vn-reading-state]");
    expect(state.hidden).toBe(true);
    s.toggleAutoPlay();
    expect(auto.dataset.vnActive).toBe("true");
    expect(auto.getAttribute("aria-pressed")).toBe("true");
    expect(auto.querySelector("[data-vn-control-label]")!.textContent).toBe("Pause");
    expect(state.hidden).toBe(false);
    expect(state.textContent).toBe("Auto play on");
    s.toggleAutoPlay();
    expect(auto.getAttribute("aria-pressed")).toBe("false");
    expect(auto.querySelector("[data-vn-control-label]")!.textContent).toBe("Auto");
    expect(state.textContent).toBe("");
  });

  test("read-only Skip stops at new text and says so", async () => {
    const s = create();
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(4) });
    advance(s);
    advance(s); // p0..p2 are now read
    s.previous();
    s.previous();
    expect(s.getState().currentParagraphIndex).toBe(0);
    s.toggleSkip();
    expect(q(s, "[data-vn-reading-state]").textContent).toBe("Skipping text you have read");
    await wait(250);
    expect(s.getState().currentParagraphIndex).toBe(2);
    expect(s.getState().phase).toBe("revealing");
    const skip = q(s, "[data-vn-control='skip']");
    expect(skip.dataset.vnActive).toBe("false");
    expect(skip.getAttribute("aria-pressed")).toBe("false");
    expect(q(s, "[data-vn-reading-state]").textContent).toBe("Skip stopped: new text ahead");
    advance(s);
    expect(q(s, "[data-vn-reading-state]").textContent).toBe("");
  });

  test("Skip all mode runs to Your turn and pauses there without submitting", async () => {
    const s = create({ skipMode: "all" });
    let submitted = 0;
    s.loadTurn({ mode: "cyoa", paragraphs: paragraphs(3), choices: [{ id: "a", label: "A", value: "a" }] });
    (s as unknown as { callbacks: { onChoice: () => void } }).callbacks.onChoice = () => { submitted++; };
    s.toggleSkip();
    expect(q(s, "[data-vn-reading-state]").textContent).toBe("Skipping all text");
    await wait(300);
    expect(s.getState().phase).toBe("awaiting-input");
    expect(q(s, "[data-vn-control='skip']").dataset.vnActive).toBe("false");
    expect(submitted).toBe(0);
  });

  test("Previous pauses Auto and Skip", () => {
    const s = create({ autoPlayDelay: 5000 });
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(3) });
    advance(s);
    s.toggleAutoPlay();
    s.previous();
    expect(q(s, "[data-vn-control='auto']").dataset.vnActive).toBe("false");
    expect(q(s, "[data-vn-control='skip']").dataset.vnActive).toBe("false");
    expect(q(s, "[data-vn-reading-state]").textContent).toBe("");
    expect(s.getState().currentParagraphIndex).toBe(0);
  });

  test("a draft survives Previous and Left Arrow inside the reply field only moves the caret", () => {
    const s = create();
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(2) });
    advance(s);
    advance(s);
    const input = q(s, "[data-vn-input]");
    input.value = "Keep my draft";
    input.dispatchEvent(new FakeEvent("input"));
    expect(s.getState().draft).toBe("Keep my draft");
    input.dispatchEvent(new FakeEvent("keydown", { key: "ArrowLeft" }));
    expect(s.getState().currentParagraphIndex).toBe(1);
    expect(s.getState().phase).toBe("awaiting-input");
    s.previous();
    expect(s.getState().draft).toBe("Keep my draft");
    advance(s);
    advance(s);
    expect(s.getState().phase).toBe("awaiting-input");
    expect(input.value).toBe("Keep my draft");
  });

  test("waiting states use plain words and real counts, never percentages", () => {
    const s = create();
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(1) });
    s.setPhase("waiting-for-response");
    expect(badgeTexts(s)).toEqual(["Waiting for the reply\u2026"]);
    s.setPhase("planning");
    s.setAssetProgress({ current: 1, total: 3 });
    expect(badgeTexts(s)).toEqual(["Preparing the scene\u2026", "Creating image 1 of 3"]);
    expect(badgeTexts(s).join(" ")).not.toContain("%");
    // The paragraph stays on stage while the next reply prepares.
    expect(q(s, "[data-vn-narrative]").hidden).toBe(false);
    expect(q(s, "[data-vn-dialogue-text]").textContent).toBe("Paragraph 0.");
    expect(q(s, "[data-vn-control='log']").disabled).toBe(false);
  });

  test("plain-string errors render as a card without a retry action", () => {
    const s = create({ onReroll: () => {} });
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(1) });
    s.setError("Visual planning failed.");
    const card = q(s, "[data-vn-badge-kind='error']");
    expect(card.getAttribute("role")).toBe("alert");
    expect(card.querySelector("[data-vn-badge-title]")!.textContent).toBe("Something went wrong");
    expect(card.querySelector("[data-vn-badge-text]")!.textContent).toBe("Visual planning failed. You can reread what has already been shown.");
    expect(card.querySelector("[data-vn-badge-action]")).toBeNull();
    expect(card.querySelector("[data-vn-badge-details]")).toBeNull();
    s.setError(null);
    expect(root(s).querySelector("[data-vn-badge-kind='error']")).toBeNull();
  });

  test("structured errors show a title, technical details, and a user-initiated Try again", () => {
    let rerolls = 0;
    const s = create({ onReroll: () => { rerolls++; } });
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(1) });
    s.setError({
      source: "image",
      message: "This scene image could not be made.",
      detail: "HTTP 502 upstream timeout",
      retryable: true,
      retryScope: "Try again keeps 2 finished images and remakes 1.",
    });
    const card = q(s, "[data-vn-badge-kind='error']");
    expect(card.querySelector("[data-vn-badge-title]")!.textContent).toBe("Scene image could not be made");
    expect(card.querySelector("[data-vn-badge-text]")!.textContent).toBe("You can keep reading.");
    const details = card.querySelector("[data-vn-badge-details]")!;
    expect(details.querySelector("summary")!.textContent).toBe("Technical details");
    expect(details.querySelector("pre")!.textContent).toBe("HTTP 502 upstream timeout");
    const retry = card.querySelector("[data-vn-badge-action]")!;
    expect(retry.textContent).toBe("Try again");
    expect(card.querySelector("[data-vn-badge-note]")!.textContent).toBe("Try again keeps 2 finished images and remakes 1.");
    // Re-rendering never retries on its own.
    s.setAssetProgress({ current: 1, total: 2 });
    s.setAssetProgress(null);
    expect(rerolls).toBe(0);
    expect(root(s).querySelectorAll("[data-vn-badge-kind='error']").length).toBe(1);
    retry.click();
    expect(rerolls).toBe(1);
    // Image failures never block reading.
    expect(s.getState().phase).toBe("revealing");
    expect(s.getState().error).toBeNull();
    expect(q(s, "[data-vn-continue]").disabled).toBe(false);
    s.setError(null);
    expect(root(s).querySelector("[data-vn-badge-kind='error']")).toBeNull();
  });

  test("image error body explains what the reader can do instead of restating the title", () => {
    const s = create({ onReroll: () => {} });
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(1) });
    s.setError({ source: "image", message: "This scene image could not be made.", retryable: true });
    expect(q(s, "[data-vn-badge-kind='error'] [data-vn-badge-text]").textContent).toBe("You can keep reading. Try again remakes only the unfinished image.");
    s.setError({ source: "image", message: "The image provider rejected the prompt.", retryable: false });
    expect(q(s, "[data-vn-badge-kind='error'] [data-vn-badge-text]").textContent).toBe("The image provider rejected the prompt. You can keep reading.");
  });

  test("turn-level errors mention rereading only when text was shown", () => {
    const s = create();
    s.setError("The request failed.");
    expect(q(s, "[data-vn-badge-kind='error'] [data-vn-badge-text]").textContent).toBe("The request failed.");
    s.setError(null);
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(2) });
    s.setError({ source: "generation", message: "The reply stopped early.", retryable: false });
    expect(q(s, "[data-vn-badge-kind='error'] [data-vn-badge-text]").textContent).toBe("The reply stopped early. You can reread what has already been shown.");
    expect(q(s, "[data-vn-narrative]").hidden).toBe(false);
  });

  test("planner errors still enter the error phase and keep their details", () => {
    const s = create({ onReroll: () => {} });
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(1) });
    s.setError({ source: "planner", message: "The scene could not be planned.", detail: "planner: 429 rate limited", retryable: true, retryScope: "Try again plans this reply again." });
    expect(s.getState().phase).toBe("error");
    expect(s.getState().error).toBe("The scene could not be planned.");
    const card = q(s, "[data-vn-badge-kind='error']");
    expect(card.querySelector("[data-vn-badge-title]")!.textContent).toBe("Scene planning failed");
    expect(card.querySelector("pre")!.textContent).toBe("planner: 429 rate limited");
    expect(card.querySelector("[data-vn-badge-action]")!.textContent).toBe("Try again");
  });

  test("Try again is hidden when the host says the error is not retryable or no retry exists", () => {
    const s = create({ onReroll: () => {} });
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(1) });
    s.setError({ source: "permission", message: "Image generation permission is off.", retryable: false });
    let card = q(s, "[data-vn-badge-kind='error']");
    expect(card.querySelector("[data-vn-badge-title]")!.textContent).toBe("Permission needed");
    expect(card.querySelector("[data-vn-badge-action]")).toBeNull();
    s.destroy();
    const s2 = create();
    s2.loadTurn({ mode: "standard", paragraphs: paragraphs(1) });
    s2.setError({ source: "planner", message: "The scene could not be planned.", retryable: true });
    card = q(s2, "[data-vn-badge-kind='error']");
    expect(card.querySelector("[data-vn-badge-title]")!.textContent).toBe("Scene planning failed");
    expect(card.querySelector("[data-vn-badge-action]")).toBeNull();
  });

  test("a failed submission keeps the reply field usable and names the problem", async () => {
    const s = create({ onSubmit: async () => { throw new Error("Network unreachable"); } });
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(1) });
    advance(s);
    const input = q(s, "[data-vn-input]");
    input.value = "Hello";
    input.dispatchEvent(new FakeEvent("input"));
    q(s, "[data-vn-input-form]").dispatchEvent(new FakeEvent("submit"));
    await wait(0);
    expect(s.getState().phase).toBe("awaiting-input");
    expect(s.getState().draft).toBe("Hello");
    expect(q(s, "[data-vn-badge-kind='error'] [data-vn-badge-text]").textContent).toBe("Network unreachable Check your reply and send it again.");
    expect(q(s, "[data-vn-input]").disabled).toBe(false);
  });

  test("end of turn offers Regenerate reply only when a reroll exists", () => {
    const s = create();
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(1) });
    advance(s);
    expect(badgeTexts(s)).toEqual([]);
    s.destroy();
    let rerolls = 0;
    const s2 = create({ onSwipe: () => { rerolls++; } });
    s2.loadTurn({ mode: "standard", paragraphs: paragraphs(1) });
    advance(s2);
    const badge = q(s2, "[data-vn-badge-kind='reroll']");
    expect(badge.tagName).toBe("BUTTON");
    expect(badge.textContent).toBe("Regenerate reply");
    badge.click();
    expect(rerolls).toBe(1);
    s2.setNoValidOutput(true);
    expect(badgeTexts(s2)).toContain("This reply had no story text to show.");
  });

  test("History opens on its Close control and returns focus to the History button", () => {
    const s = create();
    s.loadTurn({ mode: "standard", paragraphs: paragraphs(2) });
    const history = q(s, "[data-vn-control='log']");
    history.click();
    expect(q(s, "[data-vn-backlog]").hidden).toBe(false);
    expect(history.getAttribute("aria-expanded")).toBe("true");
    expect(FakeDocument.activeElement).toBe(q(s, "[data-vn-backlog-close]"));
    expect(q(s, "[data-vn-backlog-content]").querySelectorAll("[data-vn-backlog-item]").length).toBe(1);
    root(s).dispatchEvent(new FakeEvent("keydown", { key: "Escape" }));
    expect(q(s, "[data-vn-backlog]").hidden).toBe(true);
    expect(history.getAttribute("aria-expanded")).toBe("false");
    expect(FakeDocument.activeElement).toBe(history);
  });

  test("setTextScale clamps to the config range and exposes a CSS variable", () => {
    const s = create();
    s.setTextScale(1.25);
    expect(s.getTextScale()).toBe(1.25);
    expect(root(s).style["--vn-text-scale"]).toBe("1.25");
    s.setTextScale(9);
    expect(s.getTextScale()).toBe(1.6);
    s.setTextScale(0.1);
    expect(s.getTextScale()).toBe(0.8);
    s.setTextScale(Number.NaN);
    expect(s.getTextScale()).toBe(1);
  });

  test("setEffectIntensity('off') silences the text shake heuristic and one-shot effects", () => {
    const s = create();
    s.setEffectIntensity("off");
    expect(root(s).dataset.vnEffectIntensity).toBe("off");
    s.loadTurn({ mode: "standard", paragraphs: [{ id: "p0", text: "A violent *CRASH* rings out.", effect: "flash_white" }], ambient: "rain" });
    expect(root(s).classList.contains("vn-shake")).toBe(false);
    expect((s.getFlashOverlay() as unknown as FakeNode).dataset.vnFlash).toBeFalsy();
    expect(s.getCurrentAmbient()).toBe("rain");
    s.triggerEffect("shake");
    expect(root(s).classList.contains("vn-shake")).toBe(false);
    s.setEffectIntensity("full");
    s.triggerEffect("shake");
    expect(root(s).classList.contains("vn-shake")).toBe(true);
  });
});
