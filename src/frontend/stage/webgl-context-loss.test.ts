import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { FakeEvent, FakeNode, installFakeDocument } from "./stage-test-dom";
import { PlateParallax } from "./plate-parallax";
import { SpritePuppet } from "./sprite-puppet";

/**
 * A lost WebGL context (GPU reset, a backgrounded tab on a phone) comes back:
 * the 3D plate and the puppet must not stay flat or on CSS until a reload.
 */

/** Enough of WebGL for both renderers: every call works, and fails like the real one while lost. */
function fakeGl(context: { lost: boolean }): WebGLRenderingContext {
  return new Proxy({}, {
    get(_target, name) {
      if (name === "then") return undefined;
      if (name === "isContextLost") return () => context.lost;
      if (name === "getShaderParameter" || name === "getProgramParameter") return () => !context.lost;
      if (name === "getParameter") return () => 4096;
      if (name === "getExtension") return () => null;
      if (name === "getShaderInfoLog" || name === "getProgramInfoLog") return () => "context lost";
      if (typeof name === "string" && /^[A-Z][A-Z0-9_]*$/.test(name)) return 1;
      return () => (context.lost ? null : {});
    },
  }) as WebGLRenderingContext;
}

const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); };

describe("WebGL context loss", () => {
  let restore: () => void;
  const context = { lost: false };

  beforeEach(() => {
    restore = installFakeDocument();
    context.lost = false;
    // Canvases the code creates get the fake WebGL.
    const doc = globalThis.document as unknown as { createElement(tag: string): FakeNode; addEventListener?: unknown; removeEventListener?: unknown };
    // The plate follows the pointer on the document.
    doc.addEventListener ??= () => {};
    doc.removeEventListener ??= () => {};
    const create = doc.createElement.bind(doc);
    doc.createElement = (tag: string) => {
      const node = create(tag);
      if (tag === "canvas") Object.assign(node, { getContext: () => fakeGl(context), width: 0, height: 0 });
      return node;
    };
  });
  afterEach(() => restore());

  test("the 3D plate asked for during a loss comes back when the context is restored", async () => {
    const map = { width: 2, height: 2, depth: new Uint8Array(4) };
    const parallax = new PlateParallax({
      scene: new FakeNode("div") as unknown as HTMLElement,
      sprites: () => null,
      depthFor: async () => map,
      loadImage: async () => ({ naturalWidth: 8, naturalHeight: 8 }) as HTMLImageElement,
    });
    parallax.show("/plates/a.png");
    await flush();
    expect(parallax.isActive()).toBe(true);

    context.lost = true;
    parallax.canvas.dispatchEvent(new FakeEvent("webglcontextlost") as unknown as Event);
    expect(parallax.isActive()).toBe(false);
    // The reader moves to another place while the context is gone.
    parallax.show("/plates/b.png");
    await flush();
    expect(parallax.isActive()).toBe(false);

    context.lost = false;
    parallax.canvas.dispatchEvent(new FakeEvent("webglcontextrestored") as unknown as Event);
    await flush();
    expect(parallax.isActive()).toBe(true);
    parallax.destroy();
  });

  test("the puppet builds its WebGL again when the context is restored", () => {
    const puppet = new SpritePuppet({ container: () => new FakeNode("div") as unknown as HTMLElement });
    const gl = () => (puppet as unknown as { gl(): { canvas: FakeNode } | null }).gl();
    const first = gl();
    expect(first).not.toBeNull();

    context.lost = true;
    first!.canvas.dispatchEvent(new FakeEvent("webglcontextlost"));
    expect(gl()).toBeNull();

    context.lost = false;
    first!.canvas.dispatchEvent(new FakeEvent("webglcontextrestored"));
    expect(gl()).not.toBeNull();
    puppet.destroy();
  });
});
