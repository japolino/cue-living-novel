import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";

/**
 * Stage feel in a real browser (docs/SPRITE_MODE.md, "Stage feel"): click
 * sparks land at the pointer and go away; pressing a character bounces it
 * without reading on, while a click elsewhere reads on; an inner voice dims
 * everyone and lights the screen edges (sprite and scene mode); a speaker
 * not on stage (narration, an off-stage voice) leaves everyone bright;
 * entering characters fade and rise, moves and cross-fades keep their new
 * timings; a double-click never selects the picture and images cannot be
 * dragged; Motion Still and reduced motion turn sparks and the bounce off.
 * Reuses the sprite stage fixture (scripts/sprite-stage-browser-fixture.ts).
 * Screenshots: .cache/feel/
 * Run: bun run ./scripts/test-stage-feel-browser.ts
 */
const OUT = ".cache/feel";
const bundleOf = async (entry: string) => {
  const build = await Bun.build({ entrypoints: [entry], target: "browser" });
  if (!build.success) throw new Error(String(build.logs));
  return build.outputs[0]!.text();
};
const bundle = await bundleOf("scripts/sprite-stage-browser-fixture.ts");
// The settings panel fixture (scripts/test-settings-browser.ts), for Look → Stage feel.
const settingsBundle = await bundleOf("scripts/settings-browser-fixture.ts");
const htmlPage = (script: string) => new Response(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><script type="module" src="${script}"></script></body></html>`, { headers: { "Content-Type": "text/html" } });
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
    if (path === "/settings.js") return new Response(settingsBundle, { headers: { "Content-Type": "application/javascript" } });
    if (path.startsWith("/sprites/")) {
      const file = path.slice("/sprites/".length).replace(/[^\w.-]/g, "");
      for (const dir of ["sprites", "sprite-library"]) {
        try { return new Response(await readFile(`scripts/fixtures/${dir}/${file}`), { headers: { "Content-Type": "image/webp" } }); }
        catch { /* try the next folder */ }
      }
      return new Response("missing", { status: 404 });
    }
    if (path === "/settings") return htmlPage("/settings.js");
    return htmlPage("/fixture.js");
  },
});
const url = (query: Record<string, string> = {}) => `http://127.0.0.1:${server.port}/?${new URLSearchParams(query)}`;
await mkdir(OUT, { recursive: true });

type P = { text?: string; speaker?: string; actors: Array<Record<string, unknown> & { characterKey: string }>; plateKey?: string | null; light?: string };

const errors: string[] = [];
function watch(page: Page): void {
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
}

async function open(page: Page, query: Record<string, string> = {}): Promise<void> {
  // The CSS puppet path keeps frames cheap in headless Chromium; the feel does not depend on it.
  await page.goto(url({ puppet: "css", ...query }));
  await page.waitForFunction(() => Boolean((window as unknown as { fx?: unknown }).fx));
}

async function load(page: Page, paragraphs: P[], settle = 600): Promise<void> {
  await page.evaluate((p) => (window as any).fx.load(p), paragraphs);
  await page.waitForFunction(() => {
    const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
    const imgs = [...theme.querySelectorAll<HTMLImageElement>("[data-vn-sprite-image] img[src], [data-vn-scene-image][src]")];
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  });
  if (settle) await page.waitForTimeout(settle);
}

const index = (page: Page) => page.evaluate(() => (window as any).fx.stage.getState().currentParagraphIndex as number);
const feel = (page: Page, settings: Record<string, unknown>) => page.evaluate((s) => (window as any).fx.feel(s), settings);

/** Opaque figure boxes of the sprites on stage (active image layer box x cut-out bbox). */
const figures = (page: Page) => page.evaluate(() => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  return [...theme.querySelectorAll<HTMLElement>("[data-vn-sprite]")].map((el) => {
    const layer = el.querySelector<HTMLElement>("[data-vn-sprite-image][data-vn-sprite-layer='active']")!;
    const r = layer.getBoundingClientRect();
    const cs = getComputedStyle(layer);
    const n = (name: string, fallback: number) => Number.parseFloat(cs.getPropertyValue(name)) || fallback;
    const cx = n("--vn-sprite-cx", 0.5), by = n("--vn-sprite-by", 1), bw = n("--vn-sprite-bw", 1), bh = n("--vn-sprite-bh", 1);
    const mirrored = el.dataset.vnSpriteMirrored === "true";
    const centre = r.left + r.width * (mirrored ? 1 - cx : cx), bottom = r.top + r.height * by;
    return {
      key: el.dataset.vnSpriteKey!, left: centre - (r.width * bw) / 2, right: centre + (r.width * bw) / 2, top: bottom - r.height * bh, bottom,
      dim: el.dataset.vnSpriteDim ?? "", filter: getComputedStyle(el).filter,
    };
  });
});

/** A point on a character's chest, well above the dialogue box. */
const chest = async (page: Page, key: string) => {
  const f = (await figures(page)).find((figure) => figure.key === key)!;
  return { x: Math.round((f.left + f.right) / 2), y: Math.round(f.top + (f.bottom - f.top) * 0.3) };
};

/** Click-spark bursts on stage: centre (client px) and parts. */
const bursts = (page: Page) => page.evaluate(() => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  return [...theme.querySelectorAll<HTMLElement>("[data-vn-click-sparks]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { mode: el.dataset.vnClickSparks!, x: r.left, y: r.top, sparks: el.querySelectorAll("[data-vn-click-spark]").length, pop: Boolean(el.querySelector("[data-vn-click-pop]")), pointer: getComputedStyle(el).pointerEvents };
  });
});

const glow = (page: Page) => page.evaluate(() => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  const el = theme.querySelector<HTMLElement>("[data-vn-voice-glow]");
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const root = theme.querySelector<HTMLElement>("[data-vn-root]")!.getBoundingClientRect();
  return { on: el.dataset.vnVoiceOn === "true", opacity: Number(cs.opacity), shadow: cs.boxShadow, color: el.style.getPropertyValue("--vn-voice-color"), covers: Math.abs(r.width - root.width) < 2 && Math.abs(r.height - root.height) < 2, pointer: cs.pointerEvents };
});

/** The browser's selection, in the document and inside the stage's shadow roots. */
const selection = (page: Page) => page.evaluate(() => {
  const outer = document.querySelector("[data-vn-stage-host]")!.shadowRoot! as ShadowRoot & { getSelection?: () => Selection | null };
  const theme = outer.querySelector("[data-vn-theme-host]")!.shadowRoot! as ShadowRoot & { getSelection?: () => Selection | null };
  return [document.getSelection()?.toString() ?? "", outer.getSelection?.()?.toString() ?? "", theme.getSelection?.()?.toString() ?? ""].join("");
});

const DUO: P[] = [
  { speaker: "Mira", text: "Ren, say hello to everyone.", actors: [{ characterKey: "mira", slot: "left", focus: true, facing: "right" }, { characterKey: "ren", slot: "right", facing: "left" }] },
  { speaker: "Ren", text: "Hello, everyone.", actors: [{ characterKey: "mira", slot: "left", facing: "right" }, { characterKey: "ren", slot: "right", focus: true, facing: "left" }] },
  { speaker: "Mira", text: "See? He can be nice.", actors: [{ characterKey: "mira", slot: "left", focus: true, facing: "right" }, { characterKey: "ren", slot: "right", facing: "left" }] },
];

let browser: Browser | undefined;
const shots: string[] = [];
const shot = async (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) => {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, ...(clip ? { clip } : {}) });
  shots.push(path);
};

try {
  browser = await chromium.launch({ headless: true });

  // ---- Click sparks at the pointer -------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    watch(page);
    await open(page);
    await load(page, DUO);
    // Empty plate between the two characters, above the dialogue.
    await page.mouse.move(640, 160);
    await page.mouse.down();
    await page.waitForTimeout(60);
    let live = await bursts(page);
    assert.equal(live.length, 1, "one burst per press");
    assert.equal(live[0]!.mode, "sparks", "default: sparks without the !");
    assert.ok(Math.abs(live[0]!.x - 640) <= 1.5 && Math.abs(live[0]!.y - 160) <= 1.5, `the burst sits at the pointer (${live[0]!.x}, ${live[0]!.y})`);
    assert.equal(live[0]!.sparks, 7);
    assert.equal(live[0]!.pop, false);
    assert.equal(live[0]!.pointer, "none", "sparks never catch the pointer");
    await page.mouse.up();
    await page.waitForTimeout(450);
    assert.equal((await bursts(page)).length, 0, "the burst is gone after ~0.3 s");

    await feel(page, { clickEffect: "sparks-pop" });
    // Over the dark chalkboard, so the gold reads in the close-up.
    await page.mouse.move(640, 290);
    await page.mouse.down();
    await page.waitForTimeout(60);
    live = await bursts(page);
    assert.equal(live[0]!.mode, "sparks-pop");
    assert.equal(live[0]!.pop, true, "Sparks + ! adds the !");
    // Hold the burst at 0.12 s for the pictures (a screenshot takes longer than the sparks fly).
    const held = await page.evaluate(() => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      const burst = theme.querySelector("[data-vn-click-sparks]")!;
      const animations = [...burst.querySelectorAll("*")].flatMap((el) => el.getAnimations());
      for (const animation of animations) { animation.pause(); animation.currentTime = 120; }
      return animations.length;
    });
    assert.equal(held, 9, "glint, seven sparks and the ! animate");
    await shot(page, "sparks-pop-closeup", { x: 580, y: 230, width: 120, height: 110 });
    await shot(page, "sparks-pop-midframe");
    await page.mouse.up();
    await page.waitForTimeout(700);
    assert.equal((await bursts(page)).length, 0);

    await feel(page, { clickEffect: "off" });
    await page.mouse.click(640, 160);
    await page.waitForTimeout(40);
    assert.equal((await bursts(page)).length, 0, "Off: no sparks");
    await page.close();
  }

  // ---- Press a character: it bounces, the page does not turn ----------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    await load(page, DUO);
    assert.equal(await index(page), 0);
    const ren = await chest(page, "ren");
    await page.mouse.click(ren.x, ren.y);
    await page.waitForTimeout(80);
    const pressed = await page.evaluate(() => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      const el = theme.querySelector<HTMLElement>("[data-vn-sprite-key='ren']")!;
      const animation = el.getAnimations().find((a) => a instanceof CSSAnimation && a.animationName === "vn-sprite-press") as CSSAnimation | undefined;
      return { flag: el.dataset.vnSpritePress ?? null, running: animation?.playState ?? null, duration: animation ? Number(animation.effect!.getComputedTiming().duration) : 0, transform: getComputedStyle(el).transform };
    });
    assert.equal(await index(page), 0, "a press on a character does not read on");
    assert.equal(pressed.flag, "true");
    assert.equal(pressed.running, "running", "the squish plays");
    assert.equal(pressed.duration, 350, "squish and bounce back in 0.35 s");
    assert.notEqual(pressed.transform, "none", `mid-squish the figure is scaled (${pressed.transform})`);
    await shot(page, "press-ren-midframe");
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector<HTMLElement>("[data-vn-sprite-key='ren']")!.dataset.vnSpritePress ?? null), null, "the bounce ends");
    // The plate between the figures reads on as before.
    await page.mouse.click(640, 120);
    await page.waitForTimeout(120);
    assert.equal(await index(page), 1, "a click elsewhere reads on");
    // The dialogue over a character reads on too.
    const mira = await chest(page, "mira");
    const dialogue = await page.evaluate(() => {
      const r = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector("[data-vn-dialogue]")!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(Math.max(mira.x, dialogue.x - 200), dialogue.y);
    await page.waitForTimeout(120);
    assert.equal(await index(page), 2, "a click on the dialogue reads on");
    // Keyboard reading is unchanged.
    await page.evaluate(() => (window as any).fx.go(0));
    await page.keyboard.press("Space");
    await page.waitForTimeout(120);
    assert.equal(await index(page), 1, "Space reads on");
    // The setting off: a press on a character reads on.
    await feel(page, { spritePressBounce: false });
    await page.mouse.click(mira.x, mira.y);
    await page.waitForTimeout(120);
    assert.equal(await index(page), 2, "with the bounce off, the press reads on");
    await page.close();
  }

  // ---- Spotlight: inner voices, off-stage speakers, narration ---------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    await load(page, [
      { speaker: "Mira", text: "Did you hear that?", actors: [{ characterKey: "mira", slot: "left", focus: true, facing: "right" }, { characterKey: "ren", slot: "right", facing: "left" }] },
      { speaker: "Logic", text: "She heard it. You heard it. The question is what it was.", actors: [{ characterKey: "mira", slot: "left", focus: true, facing: "right" }, { characterKey: "ren", slot: "right", facing: "left" }] },
      { speaker: "Kai", text: "It came from the corridor.", actors: [{ characterKey: "mira", slot: "left", facing: "right" }, { characterKey: "ren", slot: "right", facing: "left" }] },
      { text: "Mira glances toward the door.", actors: [{ characterKey: "mira", slot: "left", focus: true, facing: "right" }, { characterKey: "ren", slot: "right", facing: "left" }] },
      { speaker: "Conscience", text: "You should go and look.", actors: [{ characterKey: "mira", slot: "left", facing: "right" }, { characterKey: "ren", slot: "right", facing: "left" }] },
    ]);
    let f = await figures(page);
    assert.deepEqual(f.map((x) => [x.key, x.dim]), [["mira", "false"], ["ren", "true"]], "the speaker on stage dims the other");
    assert.match(f[1]!.filter, /brightness\(0\.5\)/, `others at half brightness (${f[1]!.filter})`);
    await shot(page, "spotlight-speaker");

    await page.evaluate(() => (window as any).fx.go(1));
    await page.waitForTimeout(450);
    f = await figures(page);
    assert.deepEqual(f.map((x) => [x.key, x.dim]), [["mira", "true"], ["ren", "true"]], "an inner voice dims everyone");
    let g = await glow(page);
    assert.ok(g?.on && g.opacity > 0.95, `the edges glow (${JSON.stringify(g)})`);
    assert.equal(g!.color, "#5cb8e6", "in the voice's colour (Logic: intellect)");
    assert.ok(g!.covers && g!.pointer === "none", "the glow covers the stage and lets clicks through");
    assert.match(g!.shadow, /inset/);
    await shot(page, "spotlight-inner-voice");

    // The next line: the glow fades out over ~0.3 s (sampled every frame).
    const fade = await page.evaluate(() => new Promise<Array<{ t: number; opacity: number }>>((resolve) => {
      const el = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector<HTMLElement>("[data-vn-voice-glow]")!;
      (window as any).fx.go(2);
      const samples: Array<{ t: number; opacity: number }> = [];
      const start = performance.now();
      const step = () => {
        samples.push({ t: performance.now() - start, opacity: Number(getComputedStyle(el).opacity) });
        if (performance.now() - start < 600) requestAnimationFrame(step); else resolve(samples);
      };
      requestAnimationFrame(step);
    }));
    const between = fade.filter((s) => s.opacity > 0.02 && s.opacity < 0.98);
    const gone = fade.find((s) => s.opacity === 0);
    assert.ok(between.length >= 2, `the glow fades rather than cuts (${fade.map((s) => s.opacity.toFixed(2)).join(" ")})`);
    assert.ok(gone && gone.t >= 200 && gone.t <= 520, `faded out in ~0.3 s (${gone?.t.toFixed(0)} ms)`);
    g = await glow(page);
    assert.equal(g!.opacity, 0, "the glow is gone");
    f = await figures(page);
    assert.deepEqual(f.map((x) => x.dim), ["false", "false"], "an off-stage voice leaves everyone bright");
    assert.ok(f.every((x) => !/brightness/.test(x.filter)), `nobody is darkened (${f.map((x) => x.filter)})`);
    await shot(page, "spotlight-offstage");

    await page.evaluate(() => (window as any).fx.go(3));
    await page.waitForTimeout(400);
    f = await figures(page);
    assert.deepEqual(f.map((x) => x.dim), ["false", "false"], "narration leaves everyone bright, whoever it focuses");

    await page.evaluate(() => (window as any).fx.go(4));
    await page.waitForTimeout(400);
    assert.equal((await glow(page))!.on, false, "Conscience is no inner voice until named");
    await feel(page, { innerVoices: "Conscience" });
    await page.waitForTimeout(400);
    f = await figures(page);
    assert.deepEqual(f.map((x) => x.dim), ["true", "true"], "a named inner voice dims everyone");
    assert.equal((await glow(page))!.on, true);
    await page.close();
  }

  // ---- Scene mode: the glow alone -------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { mode: "scene" });
    await load(page, [{ speaker: "Inland Empire", text: "The door is listening to you.", actors: [] }], 450);
    const g = await glow(page);
    assert.ok(g?.on && g.opacity > 0.95, "scene mode glows for an inner voice too");
    assert.equal(g!.color, "#8f74e8", "psyche colour");
    await shot(page, "scene-inner-voice");
    await page.close();
  }

  // ---- Entrances, moves and cross-fades -------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    await load(page, [{ speaker: "Mira", text: "Morning.", actors: [{ characterKey: "mira", focus: true }] }]);
    await page.evaluate((p) => (window as any).fx.load(p), [
      { speaker: "Mira", text: "Morning.", actors: [{ characterKey: "mira", focus: true }] },
      { speaker: "Aoi", text: "Good morning!", actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "aoi", slot: "right", focus: true }] },
    ]);
    await page.waitForTimeout(300);
    // Aoi walks on: sample her entrance from its first frame.
    const enter = await page.evaluate(() => new Promise<{ name: string; duration: number; samples: Array<{ t: number; opacity: number; y: number }>; moveMs: string; fade: string }>((resolve) => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      (window as any).fx.go(1);
      const el = theme.querySelector<HTMLElement>("[data-vn-sprite-key='aoi']")!;
      const animation = el.getAnimations().find((a) => a instanceof CSSAnimation && a.animationName === "vn-sprite-enter") as CSSAnimation | undefined;
      const samples: Array<{ t: number; opacity: number; y: number }> = [];
      const start = performance.now();
      const step = () => {
        const cs = getComputedStyle(el);
        samples.push({ t: performance.now() - start, opacity: Number(cs.opacity), y: Number.parseFloat(cs.translate.split(" ")[1] ?? "0") || 0 });
        if (performance.now() - start < 260) requestAnimationFrame(step);
        else resolve({
          name: animation?.animationName ?? "",
          duration: animation ? Number(animation.effect!.getComputedTiming().duration) : 0,
          samples,
          moveMs: getComputedStyle(theme.querySelector<HTMLElement>("[data-vn-sprites]")!).getPropertyValue("--vn-sprite-move-ms").trim(),
          fade: getComputedStyle(el.querySelector<HTMLElement>("[data-vn-sprite-image][data-vn-sprite-layer='active']")!).transitionDuration,
        });
      };
      requestAnimationFrame(step);
    }));
    assert.equal(enter.name, "vn-sprite-enter", "the entering character animates in");
    assert.equal(enter.duration, 150, "the entrance takes 0.15 s");
    const first = enter.samples[0]!;
    const last = enter.samples.at(-1)!;
    assert.ok(first.opacity < 0.9 && first.y > 0.5, `it starts faded and a few px low (${JSON.stringify(first)})`);
    assert.ok(first.y <= 6.01, `a few px only (${first.y})`);
    assert.ok(last.opacity === 1 && Math.abs(last.y) < 0.01, `then stands in place (${JSON.stringify(last)})`);
    assert.equal(enter.moveMs, "400ms", "a re-layout slides over 0.4 s");
    assert.equal(enter.fade, "0.2s", "poses and expressions cross-fade over 0.2 s");
    await shot(page, "enter-settled");
    await page.close();
  }

  // ---- No selection, no dragging --------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    await load(page, [...DUO, ...DUO, ...DUO]);
    const ren = await chest(page, "ren");
    await page.mouse.dblclick(ren.x, ren.y);
    await page.waitForTimeout(100);
    assert.equal(await selection(page), "", "a double-click on a character selects nothing");
    await page.mouse.dblclick(640, 140);
    await page.waitForTimeout(100);
    assert.equal(await selection(page), "", "a double-click on the plate selects nothing");
    // A triple-click on the plate, and a drag across the whole stage.
    await page.mouse.click(640, 140, { clickCount: 3 });
    await page.mouse.move(40, 60);
    await page.mouse.down();
    await page.mouse.move(1240, 680, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await selection(page), "", "dragging across the stage selects nothing");
    const drag = await page.evaluate(() => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      const fire = (el: Element) => { const event = new DragEvent("dragstart", { bubbles: true, cancelable: true, composed: true }); el.dispatchEvent(event); return event.defaultPrevented; };
      const sprite = theme.querySelector<HTMLImageElement>("[data-vn-sprite-image] img")!;
      const scene = theme.querySelector<HTMLImageElement>("[data-vn-scene-image]")!;
      const text = theme.querySelector<HTMLElement>("[data-vn-dialogue-text]")!;
      return {
        sprite: fire(sprite), scene: fire(scene),
        spriteSelect: getComputedStyle(sprite).userSelect, sceneSelect: getComputedStyle(scene).userSelect, textSelect: getComputedStyle(text).userSelect,
      };
    });
    assert.equal(drag.sprite, true, "a sprite image cannot be dragged");
    assert.equal(drag.scene, true, "the scene image cannot be dragged");
    assert.equal(drag.spriteSelect, "none");
    assert.equal(drag.sceneSelect, "none");
    assert.notEqual(drag.textSelect, "none", "the dialogue stays selectable");
    await shot(page, "no-selection");
    await page.close();
  }

  // ---- Motion Still and reduced motion: no sparks, no bounce ------------------------
  for (const [label, query, reduced] of [["motion-off", { intensity: "off" }, false], ["reduced-motion", {}, true]] as const) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, query);
    await load(page, DUO);
    await page.mouse.move(640, 160);
    await page.mouse.down();
    await page.waitForTimeout(40);
    assert.equal((await bursts(page)).length, 0, `${label}: no sparks`);
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await index(page), 1, `${label}: the click reads on`);
    const mira = await chest(page, "mira");
    await page.mouse.click(mira.x, mira.y);
    await page.waitForTimeout(100);
    assert.equal(await index(page), 2, `${label}: a press on a character reads on (no bounce)`);
    await page.close();
  }

  // ---- Settings: Look → Character motion and Stage feel ------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    watch(page);
    await page.goto(`http://127.0.0.1:${server.port}/settings?setupDone&sprites&noCatalog`);
    const settings = page.locator("[data-vn-settings]");
    await settings.waitFor();
    await settings.getByRole("tab", { name: "Look", exact: true }).click();
    const lastPatch = () => page.evaluate(() => (window as any).settingsFixture.patches.at(-1));
    const look = settings.locator('[data-pane="look"]');
    // Order: Character motion, Character look, Character size, Touch, Stage feel, Text effect tags.
    const order = await look.evaluate((pane) => [...pane.querySelectorAll<HTMLElement>("[data-group-id]")].map((group) => group.dataset.groupId));
    const at = (id: string) => order.indexOf(id);
    assert.ok(at("sprite-motion") >= 0 && at("sprite-look") > at("sprite-motion") && at("character-size") === at("sprite-look") + 1 && at("sprite-touch") === at("character-size") + 1 && at("stage-feel") === at("sprite-touch") + 1 && at("text-fx") === at("stage-feel") + 1, `Stage feel sits right after the character groups (${order})`);
    assert.equal(await settings.locator('[data-pane="reading"] [name="clickEffect"]').count(), 0, "nothing in Reading");

    const press = look.locator('input[name="spritePressBounce"]');
    assert.equal(await press.isChecked(), true, "press-to-bounce on by default");
    await press.uncheck();
    assert.deepEqual(await lastPatch(), { spritePressBounce: false });

    const feelGroup = look.locator('[data-group-id="stage-feel"]');
    await feelGroup.scrollIntoViewIfNeeded();
    assert.equal(await feelGroup.locator('input[name="clickEffect"][value="sparks"]').isChecked(), true, "Sparks by default");
    await feelGroup.getByText("Sparks + !", { exact: true }).click();
    assert.deepEqual(await lastPatch(), { clickEffect: "sparks-pop" });
    const volume = feelGroup.locator('input[name="interfaceSoundVolume"]');
    const volumeLabel = feelGroup.locator("[data-interface-volume-val]");
    assert.equal(await volume.isDisabled(), true, "the volume waits for the switch");
    assert.equal(await volumeLabel.textContent(), "Off");
    await feelGroup.locator('input[name="interfaceSounds"]').check();
    assert.deepEqual(await lastPatch(), { interfaceSounds: true });
    assert.equal(await volume.isDisabled(), false);
    assert.equal(await volumeLabel.textContent(), "40%");
    await volume.fill("0.7");
    assert.deepEqual(await lastPatch(), { interfaceSoundVolume: 0.7 });
    assert.equal(await volumeLabel.textContent(), "70%");
    const voices = feelGroup.locator('input[name="innerVoices"]');
    await voices.fill("Conscience, The Ancient Reptilian Brain");
    await voices.press("Tab");
    assert.deepEqual(await lastPatch(), { innerVoices: "Conscience, The Ancient Reptilian Brain" });
    await shot(page, "settings-stage-feel");

    // Scene mode: no press-to-bounce (sprites only), Stage feel stays.
    await page.goto(`http://127.0.0.1:${server.port}/settings?setupDone&noCatalog`);
    await settings.waitFor();
    await settings.getByRole("tab", { name: "Look", exact: true }).click();
    assert.equal(await look.locator('input[name="spritePressBounce"]').isVisible(), false, "press-to-bounce is a sprite-mode setting");
    assert.equal(await look.locator('[data-group-id="stage-feel"]').isVisible(), true, "Stage feel shows in scene mode");
    await page.close();
  }

  assert.deepEqual(errors, [], "no console errors");
  console.log(`stage feel browser checks passed; ${shots.length} screenshots in ${OUT}/`);
} finally {
  await browser?.close();
  server.stop(true);
}
