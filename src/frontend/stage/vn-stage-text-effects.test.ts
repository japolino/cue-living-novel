import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import { VnStage, type VnStageOptions } from "./vn-stage";

/**
 * Inline text effects on the stage: formatter + DOM decoration in the
 * dialogue (instant and typewriter paths), the history (static), and the
 * mode attribute. Runs against the real THEME_MARKUP in the fake DOM.
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Text the reader can see: skips untyped typewriter text (hidden but laid out). */
function visibleText(node: FakeNode): string {
  if (node.isText) return node.textContent;
  if (node.hasAttribute("data-vn-typing-rest") || node.hasAttribute("data-vn-typing-pending")) return "";
  return node.children.map(visibleText).join("");
}

/** Minimal TreeWalker over fake text nodes, so the typewriter path runs. */
function installTreeWalker(): () => void {
  const doc = document as unknown as Record<string, unknown>;
  const previous = doc.createTreeWalker;
  doc.createTreeWalker = (root: FakeNode) => {
    const nodes: FakeNode[] = [];
    const walk = (node: FakeNode) => { for (const child of node.children) { if (child.isText) nodes.push(child); else walk(child); } };
    walk(root);
    let i = 0;
    return { nextNode: () => nodes[i++] ?? null };
  };
  return () => { doc.createTreeWalker = previous; };
}

describe("stage text effects", () => {
  let restore: () => void;
  let mount: FakeNode;
  let stage: VnStage | null;

  const create = (options: Partial<VnStageOptions> = {}): VnStage => {
    stage = new VnStage({ mount: mount as unknown as HTMLElement, textSpeed: 0, ...options });
    return stage;
  };
  const root = (s: VnStage): FakeNode => (s as unknown as { root: FakeNode }).root;
  const q = (s: VnStage, selector: string): FakeNode => {
    const node = root(s).querySelector(selector);
    if (!node) throw new Error(`missing ${selector}`);
    return node;
  };
  const dialogue = (s: VnStage) => q(s, "[data-vn-dialogue-text]");

  beforeEach(() => {
    restore = installFakeDocument();
    mount = new FakeNode("div");
    stage = null;
  });

  afterEach(() => {
    stage?.destroy();
    restore();
  });

  test("instant render turns tags into decorated effect spans", () => {
    const s = create();
    s.loadTurn({ mode: "standard", paragraphs: [{ id: "p0", speaker: "Mira", text: "Oh <rainbow>magic</rainbow> and <glow>light</glow>!" }] });
    const text = dialogue(s);
    expect(text.textContent).toBe("Oh magic and light!");
    const rainbow = text.querySelector('[data-vn-text-fx="rainbow"]')!;
    expect(rainbow.querySelectorAll("[data-vn-text-fx-ch]").map((l) => l.textContent).join("")).toBe("magic");
    expect(text.querySelector('[data-vn-text-fx="glow"]')!.textContent).toBe("light");
  });

  test("typewriter reveals effect letters progressively and completes them", async () => {
    const undoWalker = installTreeWalker();
    try {
      const s = create({ textSpeed: 5 });
      s.loadTurn({ mode: "standard", paragraphs: [{ id: "p0", speaker: "Mira", text: "Hi <wave>la la</wave> 👋" }] });
      const text = dialogue(s);
      const letters = () => text.querySelectorAll("[data-vn-text-fx-ch]");
      // Decorated before typing starts: letters exist, keep their text for
      // layout, and wait hidden until the typewriter reaches them.
      expect(letters().length).toBe(4);
      expect(letters().every((l) => l.hasAttribute("data-vn-typing-pending"))).toBe(true);
      // The full paragraph is laid out from the first tick.
      expect(text.textContent).toBe("Hi la la 👋");
      expect(visibleText(text)).toBe("");
      const seen: string[] = [];
      for (let i = 0; i < 40 && visibleText(text) !== "Hi la la 👋"; i += 1) {
        await wait(6);
        seen.push(visibleText(text));
        expect(text.textContent).toBe("Hi la la 👋");
      }
      expect(visibleText(text)).toBe("Hi la la 👋");
      // Progressive: some intermediate frame shows part of the wave.
      expect(seen.some((frame) => frame.startsWith("Hi l") && frame.length < "Hi la la 👋".length)).toBe(true);
      // The emoji never shows half a surrogate pair.
      expect(seen.every((frame) => !/[\uD800-\uDBFF]$/.test(frame))).toBe(true);
      expect(letters().map((l) => l.textContent)).toEqual(["l", "a", "l", "a"]);
      expect(text.querySelectorAll("[data-vn-typing-rest], [data-vn-typing-pending]").length).toBe(0);
    } finally {
      undoWalker();
    }
  });

  test("advancing mid-typing completes every effect letter", () => {
    const undoWalker = installTreeWalker();
    try {
      const s = create({ textSpeed: 1000 });
      s.loadTurn({ mode: "standard", paragraphs: [
        { id: "p0", speaker: "Mira", text: "<shout>STOP!</shout> now" },
        { id: "p1", speaker: "Mira", text: "next" },
      ] });
      const text = dialogue(s);
      expect(visibleText(text)).toBe("");
      expect(text.textContent).toBe("STOP! now");
      (s as unknown as { advance(): void }).advance();
      expect(visibleText(text)).toBe("STOP! now");
      expect(text.textContent).toBe("STOP! now");
      expect(text.querySelectorAll("[data-vn-text-fx-ch]").map((l) => l.textContent).join("")).toBe("STOP!");
      expect(text.querySelectorAll("[data-vn-typing-rest], [data-vn-typing-pending]").length).toBe(0);
    } finally {
      undoWalker();
    }
  });

  test("history shows effects static (or off) and decorated", () => {
    const s = create();
    s.loadTurn({ mode: "standard", paragraphs: [{ id: "p0", speaker: "Mira", text: "<wave>la la</wave>" }] });
    s.openBacklog();
    const content = q(s, "[data-vn-backlog-content]");
    expect(content.dataset.vnTextEffects).toBe("static");
    expect(content.querySelectorAll('[data-vn-text-fx="wave"] [data-vn-text-fx-ch]').length).toBe(4);
    s.setTextEffects("off");
    expect(root(s).dataset.vnTextEffects).toBe("off");
    expect(content.dataset.vnTextEffects).toBe("off");
    s.setTextEffects("animated");
    expect(root(s).dataset.vnTextEffects).toBe("animated");
    expect(content.dataset.vnTextEffects).toBe("static");
  });

  test("setTextEffects normalizes unknown modes to animated", () => {
    const s = create();
    s.setTextEffects("static");
    expect(s.getTextEffects()).toBe("static");
    s.setTextEffects("bogus" as never);
    expect(s.getTextEffects()).toBe("animated");
    expect(root(s).dataset.vnTextEffects).toBe("animated");
  });

  test("the *thud* screen-shake heuristic still fires next to effect tags", () => {
    const s = create();
    s.loadTurn({ mode: "standard", paragraphs: [{ id: "p0", speaker: "Mira", text: "*thud* <shake>Ow!</shake>" }] });
    expect(root(s).classList.contains("vn-shake")).toBe(true);
    expect(dialogue(s).querySelector('[data-vn-text-fx="shake"]')).toBeTruthy();
  });

  test("an effect tag alone does not shake the screen", () => {
    const s = create();
    s.loadTurn({ mode: "standard", paragraphs: [{ id: "p0", speaker: "Mira", text: "<shake>Ow!</shake>" }] });
    expect(root(s).classList.contains("vn-shake")).toBe(false);
  });
});
