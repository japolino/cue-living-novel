import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeNode, installFakeDocument } from "./stage-test-dom";
import { VnStage } from "./vn-stage";

/**
 * Stage chrome markup: decorative icons stay hidden from assistive tech, the
 * visible words and accessible names do not change, and the outer shell
 * mirrors the preset so chrome outside the theme root can match it.
 */
describe("stage chrome markup", () => {
  let restore: () => void;
  let mount: FakeNode;
  let stage: VnStage | null;

  const create = (preset?: "lumiverse" | "golden-hour" | "paper-novel"): VnStage => {
    stage = new VnStage({ mount: mount as unknown as HTMLElement, textSpeed: 0, ...(preset ? { themePreset: preset } : {}) });
    return stage;
  };
  const root = (s: VnStage): FakeNode => (s as unknown as { root: FakeNode }).root;
  const q = (s: VnStage, selector: string): FakeNode => {
    const node = root(s).querySelector(selector);
    if (!node) throw new Error(`missing ${selector}`);
    return node;
  };

  beforeEach(() => {
    restore = installFakeDocument();
    mount = new FakeNode("div");
    stage = null;
  });

  afterEach(() => {
    stage?.destroy();
    restore();
  });

  test("every reading control has one decorative inline-SVG icon and keeps its plain label", () => {
    const s = create();
    const labels: Record<string, string> = { previous: "Previous", log: "History", auto: "Auto", skip: "Skip" };
    for (const [name, label] of Object.entries(labels)) {
      const control = q(s, `[data-vn-control='${name}']`);
      const icons = control.querySelectorAll("[data-vn-control-icon]");
      expect(icons).toHaveLength(1);
      expect(icons[0]!.getAttribute("aria-hidden")).toBe("true");
      expect(icons[0]!.querySelector("svg")).not.toBeNull();
      expect(icons[0]!.textContent.trim()).toBe("");
      expect(control.textContent.trim()).toBe(label);
    }
  });

  test("Auto keeps its countdown ring next to the play icon", () => {
    const s = create();
    const auto = q(s, "[data-vn-control='auto']");
    expect(auto.querySelector("[data-vn-auto-ring]")).not.toBeNull();
    expect(auto.querySelector(".vn-auto-bar")).not.toBeNull();
    s.toggleAutoPlay(true);
    expect(auto.getAttribute("aria-pressed")).toBe("true");
    expect(auto.textContent.trim()).toBe("Pause");
  });

  test("Send and Close keep their names; their icons are decorative", () => {
    const s = create();
    const submit = q(s, "[data-vn-submit]");
    expect(submit.textContent.trim()).toBe("Send");
    expect(submit.querySelector("[data-vn-submit-label]")!.textContent).toBe("Send");
    expect(submit.querySelector("[data-vn-submit-icon]")!.getAttribute("aria-hidden")).toBe("true");
    const close = q(s, "[data-vn-backlog-close]");
    expect(close.getAttribute("aria-label")).toBe("Close history");
    expect(close.querySelector("svg")).not.toBeNull();
    expect(close.textContent.trim()).toBe("");
  });

  test("the empty state is a card with a decorative icon and the same words", () => {
    const s = create();
    const empty = q(s, "[data-vn-empty-state]");
    expect(empty.querySelector("[data-vn-empty-card]")).not.toBeNull();
    expect(empty.querySelector("[data-vn-empty-icon]")!.getAttribute("aria-hidden")).toBe("true");
    expect(empty.querySelector("[data-vn-empty-text]")!.textContent).toBe(
      "There is no reply to show yet. Go back to chat, send the first message, then open Visual novel again.",
    );
  });

  test("the outer shell mirrors the active preset for Back to chat, Panels and the speech dock", () => {
    const s = create("golden-hour");
    const shell = s.panelMount as unknown as FakeNode;
    expect(shell.getAttribute("data-vn-preset")).toBe("golden-hour");
    expect(root(s).getAttribute("data-vn-preset")).toBe("golden-hour");
    s.setThemePreset("paper-novel");
    expect(shell.getAttribute("data-vn-preset")).toBe("paper-novel");
    expect(root(s).getAttribute("data-vn-preset")).toBe("paper-novel");
  });

  test("the default preset is mirrored too", () => {
    const s = create();
    expect((s.panelMount as unknown as FakeNode).getAttribute("data-vn-preset")).toBe("lumiverse");
  });
});
