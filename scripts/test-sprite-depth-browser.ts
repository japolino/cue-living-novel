import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";

/**
 * Sprite mode depth in a real browser (docs/SPRITE_MODE.md, "Stage"):
 * the front ambient layer for every particle ambient, grades over the
 * sprites, lightning behind the characters (rim-lit silhouettes), parallax
 * for camera effects (mid-frame scale / offset ratios), the idle plate
 * drift, grounding and rim light, "gentle", reduced motion, mobile, scene
 * mode untouched, layer safety (pointer-events, stacking under the dialogue)
 * and a rough rAF frame-cost probe for rain + 3 sprites.
 * Screenshots: .cache/sprite-depth/. Run: bun run ./scripts/test-sprite-depth-browser.ts
 */
const OUT = ".cache/sprite-depth";
const build = await Bun.build({ entrypoints: ["scripts/sprite-stage-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
    if (path.startsWith("/sprites/")) {
      const file = path.slice("/sprites/".length).replace(/[^\w.-]/g, "");
      try { return new Response(await readFile(`scripts/fixtures/sprites/${file}`), { headers: { "Content-Type": "image/webp" } }); }
      catch { return new Response("missing", { status: 404 }); }
    }
    return new Response('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
  },
});
const url = (query: Record<string, string> = {}) => `http://127.0.0.1:${server.port}/?${new URLSearchParams(query)}`;
await mkdir(OUT, { recursive: true });

type P = { text?: string; speaker?: string; actors: Array<Record<string, unknown> & { characterKey: string }>; plateKey?: string | null; light?: string; ambient?: string | null; effect?: string };

const PARTICLES = ["rain", "heavy_rain", "snow", "sakura", "fireflies", "embers", "fog"] as const;
const GRADES = ["vignette_dark", "sepia_flashback", "desaturate", "dream_haze", "danger_pulse"] as const;
const PLATE_FOR: Record<string, string> = { rain: "plate_street", heavy_rain: "plate_street", snow: "plate_park", sakura: "plate_park", fireflies: "plate_park", embers: "plate_bedroom", fog: "plate_street" };
const LIGHT_FOR: Record<string, string> = { rain: "night", heavy_rain: "dark", snow: "day", sakura: "day", fireflies: "night", embers: "candle", fog: "indoor_cool" };

const errors: string[] = [];
function watch(page: Page): void {
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
}

async function open(page: Page, query: Record<string, string> = {}): Promise<void> {
  await page.goto(url(query));
  await page.waitForFunction(() => Boolean((window as unknown as { fx?: unknown }).fx));
}

async function load(page: Page, paragraphs: P[], settle = 700): Promise<void> {
  await page.evaluate((p) => (window as any).fx.load(p), paragraphs);
  const expectImages = paragraphs.some((p) => p.actors.length > 0);
  await page.waitForFunction((expect) => {
    const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
    const imgs = [...theme.querySelectorAll<HTMLImageElement>("[data-vn-sprite-image] img[src], [data-vn-scene-image][src]")];
    return (!expect || imgs.length > 0) && imgs.every((img) => img.complete && img.naturalWidth > 0);
  }, expectImages);
  if (settle) await page.waitForTimeout(settle);
}

const TRIO = (extra: Partial<P> = {}): P[] => [{
  speaker: "Aoi", text: "So all three of us are on duty today?",
  actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "aoi", slot: "center", focus: true }, { characterKey: "kaede", slot: "right", facing: "left" }],
  ...extra,
}];
const DUO = (extra: Partial<P> = {}): P[] => [{
  speaker: "Mira", text: "This is Ren, from the class next door.",
  actors: [{ characterKey: "mira", slot: "left", focus: true, facing: "right" }, { characterKey: "ren", slot: "right", facing: "left" }],
  ...extra,
}];

/** Layer facts: front/back particle counts, stacking, pointer events. */
const layers = (page: Page) => page.evaluate(() => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  const scene = theme.querySelector<HTMLElement>("[data-vn-scene]")!;
  const back = theme.querySelector<HTMLElement>("[data-vn-ambient]:not([data-vn-ambient-front])")!;
  const front = theme.querySelector<HTMLElement>("[data-vn-ambient-front]");
  const plateLight = theme.querySelector<HTMLElement>("[data-vn-plate-light]");
  const sprites = theme.querySelector<HTMLElement>("[data-vn-sprites]")!;
  const order = [...scene.children].map((c) => [...c.attributes].map((a) => a.name).find((n) => n.startsWith("data-vn-")) ?? c.tagName);
  const visible = (el: Element) => getComputedStyle(el).display !== "none";
  const pointer = [front, plateLight, sprites].filter(Boolean).flatMap((el) => [el!, ...el!.querySelectorAll("*")]).map((el) => getComputedStyle(el).pointerEvents);
  return {
    order,
    sceneIsolation: getComputedStyle(scene).isolation,
    sceneInNarrativeOrder: scene.compareDocumentPosition(theme.querySelector("[data-vn-narrative]")!) & Node.DOCUMENT_POSITION_FOLLOWING,
    narrativeZ: getComputedStyle(theme.querySelector("[data-vn-narrative]")!).zIndex,
    backZ: getComputedStyle(back).zIndex,
    spritesZ: getComputedStyle(sprites).zIndex,
    front: front ? {
      z: getComputedStyle(front).zIndex,
      display: getComputedStyle(front).display,
      cls: front.className,
      pts: front.querySelectorAll(".vn-pt").length,
      ptsVisible: [...front.querySelectorAll(".vn-pt")].filter(visible).length,
      layers: front.children.length,
      inScene: front.parentElement === scene,
    } : null,
    backPts: back.querySelectorAll(".vn-pt").length,
    backPtsVisible: [...back.querySelectorAll(".vn-pt")].filter(visible).length,
    backFogLayers: back.querySelectorAll(".vn-fog-layer").length,
    plateLight: plateLight ? { display: getComputedStyle(plateLight).display, children: plateLight.childElementCount, z: getComputedStyle(plateLight).zIndex } : null,
    pointer: [...new Set(pointer)],
  };
});

const css = (page: Page, selector: string, props: string[], pseudo?: string) => page.evaluate(({ selector, props, pseudo }) => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  const el = theme.querySelector(selector);
  if (!el) return null;
  const cs = getComputedStyle(el, pseudo);
  return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p).trim()]));
}, { selector, props, pseudo });

/** Uniform scale of a computed transform / scale value. */
const scaleOf = (value: string | undefined): number => {
  if (!value || value === "none") return 1;
  const m = value.match(/^matrix\(([^)]+)\)$/);
  if (m) { const [a, b] = m[1]!.split(",").map(Number); return Math.hypot(a!, b!); }
  return Number.parseFloat(value.split(/\s+/)[0]!) || 1;
};
const translateOf = (value: string | undefined): [number, number] => {
  if (!value || value === "none") return [0, 0];
  const m = value.match(/^matrix\(([^)]+)\)$/);
  if (m) { const v = m[1]!.split(",").map(Number); return [v[4]!, v[5]!]; }
  const [x, y] = value.split(/\s+/).map((s) => Number.parseFloat(s));
  return [x || 0, y || 0];
};

let browser: Browser | undefined;
const shots: string[] = [];
const shot = async (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) => {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, ...(clip ? { clip } : {}) });
  shots.push(path);
};
const report: string[] = [];

try {
  browser = await chromium.launch({ headless: true });

  // ---- Front ambient layer for every particle ambient (desktop, 3 sprites) ----
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    for (const ambient of PARTICLES) {
      await load(page, TRIO({ ambient, plateKey: PLATE_FOR[ambient]!, light: LIGHT_FOR[ambient]! }), 1200);
      const l = await layers(page);
      assert.ok(l.front, `${ambient}: front layer mounted`);
      assert.deepEqual(l.order.slice(-2), ["data-vn-sprites", "data-vn-ambient"], `${ambient}: front layer right after the sprites (${l.order})`);
      assert.equal(l.front!.inScene, true, `${ambient}: front layer inside the scene (under the dialogue)`);
      assert.equal(l.front!.z, "5");
      assert.equal(l.spritesZ, "4");
      assert.equal(l.backZ, "2", `${ambient}: back overlay stays behind the sprites`);
      assert.equal(l.front!.cls, `vn-ambient-front-${ambient}`);
      assert.ok(l.front!.layers > 0, `${ambient}: front has content`);
      if (ambient === "fog") assert.ok(l.front!.layers <= Math.floor(l.backFogLayers * 0.4) + 1, "fog: one front bank for three back banks");
      else if (ambient.includes("rain")) assert.ok(l.front!.pts >= 5 && l.front!.pts <= 15, `${ambient}: a few front streaks (${l.front!.pts})`);
      else assert.ok(l.front!.pts > 0 && l.front!.pts <= l.backPts * 0.4, `${ambient}: front density ${l.front!.pts} <= 40% of ${l.backPts}`);
      assert.deepEqual(l.pointer, ["none"], `${ambient}: depth layers never take pointer events`);
      assert.equal(l.sceneIsolation, "isolate");
      assert.ok(l.sceneInNarrativeOrder, "the dialogue comes after the scene");
      assert.equal(l.narrativeZ, "2");
      await shot(page, `ambient-${ambient}`);
    }
    // Clicks on the dialogue still advance with the heaviest front layer on.
    await load(page, [...TRIO({ ambient: "heavy_rain", plateKey: "plate_street", light: "dark" }), { actors: [{ characterKey: "mira", focus: true }], text: "Second." }], 400);
    const box = await page.evaluate(() => {
      const r = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector("[data-vn-dialogue-text]")!.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => (window as any).fx.stage.getState().currentParagraphIndex), 1, "dialogue click advances through the front layer");

    // Grades cover plate and sprites (overlay above the sprites), never the dialogue.
    for (const ambient of GRADES) {
      await load(page, DUO({ ambient, plateKey: "plate_classroom", light: "day" }), 900);
      const l = await layers(page);
      assert.equal(l.backZ, "5", `${ambient}: grade overlay above the sprites`);
      assert.equal(l.front?.display ?? "none", "none", `${ambient}: no front particles for a grade`);
      const filter = (await css(page, "[data-vn-sprite-image][data-vn-sprite-layer='active']", ["filter"]))!.filter;
      if (ambient !== "vignette_dark") assert.notEqual(filter, "none", `${ambient}: sprites graded (${filter})`);
      await shot(page, `grade-${ambient}`);
    }

    // Scene mode switch: the front layer empties and hides.
    await load(page, TRIO({ ambient: "snow", plateKey: "plate_park", light: "day" }), 300);
    await page.evaluate(() => (window as any).fx.stage.setPresentationMode("scene"));
    await page.waitForTimeout(100);
    let l = await layers(page);
    assert.equal(l.front!.display, "none", "scene mode hides the front layer");
    assert.equal(l.front!.layers, 0, "scene mode empties the front layer");
    assert.equal(l.backZ, "2");
    await page.evaluate(() => (window as any).fx.stage.setPresentationMode("sprites"));
    await page.waitForTimeout(100);
    l = await layers(page);
    assert.ok(l.front!.layers > 0 && l.front!.display !== "none", "sprite mode restores the front layer");
    await page.close();
  }

  // ---- Lightning, grounding, rim light ------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    await load(page, TRIO({ ambient: "heavy_rain", plateKey: "plate_street", light: "night" }), 900);
    const side = await page.evaluate(() => document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector<HTMLElement>("[data-vn-scene]")!.dataset.vnLightSide);
    assert.ok(side === "left" || side === "right" || side === "top", `plate light side measured (${side})`);
    report.push(`plate_street light side: ${side}`);
    const rim = (await css(page, "[data-vn-sprite-image][data-vn-sprite-layer='active']", ["mask-image", "opacity", "mix-blend-mode", "background-color"], "::before"))!;
    assert.match(rim["mask-image"]!, /url\(.*url\(/s, `rim uses the cut-out twice (${rim["mask-image"]!.slice(0, 80)})`);
    assert.equal(rim["opacity"], "0.5", "night rim strength");
    const ground = (await css(page, "[data-vn-sprite]", ["background-image", "z-index", "height"], "::before"))!;
    assert.match(ground["background-image"]!, /radial-gradient/, "contact shadow band");
    await shot(page, "lightning-before");

    await page.evaluate(() => (window as any).fx.effect("lightning"));
    await page.waitForTimeout(8);
    const during = await page.evaluate(() => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      const img = theme.querySelector("[data-vn-sprite-image][data-vn-sprite-layer='active'] img")!;
      return {
        attr: theme.querySelector<HTMLElement>("[data-vn-scene]")!.dataset.vnLightning,
        bolt: Boolean(theme.querySelector("[data-vn-plate-light] .vn-bolt")),
        fxBolt: Boolean(theme.querySelector("[data-vn-fx] .vn-bolt")),
        names: img.getAnimations().map((a) => (a as CSSAnimation).animationName),
        flash: getComputedStyle(theme.querySelector("[data-vn-flash]")!).animationName,
      };
    });
    assert.equal(during.attr, "true");
    assert.ok(during.bolt && !during.fxBolt, "the bolt is drawn behind the characters");
    assert.ok(during.names.includes("vn-sprite-lightning-shade"), `sprites drop to silhouettes (${during.names})`);
    assert.equal(during.flash, "vn-lightning-soft", "softer full-screen flash in sprite mode");
    await page.waitForTimeout(4);
    await shot(page, "lightning-strike-1");
    await page.waitForTimeout(95);
    await shot(page, "lightning-strike-2");
    await page.waitForTimeout(600);
    const after = await layers(page);
    assert.equal(after.plateLight!.children, 0, "lightning self-clears");
    assert.equal(await page.evaluate(() => document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector<HTMLElement>("[data-vn-scene]")!.dataset.vnLightning ?? null), null);

    // Rim light and grounding close-ups for every light preset.
    for (const light of ["sunset", "night", "day", "candle"]) {
      await load(page, [{ actors: [{ characterKey: "aoi", slot: "left", focus: true }, { characterKey: "mira", slot: "right", focus: true, facing: "right" }], plateKey: light === "night" ? "plate_street" : light === "candle" ? "plate_bedroom" : "plate_classroom", light }], 800);
      await shot(page, `rim-${light}`, { x: 120, y: 60, width: 520, height: 660 });
    }
    await page.close();
  }

  // ---- Parallax: camera effects move layers by depth ---------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    await load(page, TRIO({ ambient: "snow", plateKey: "plate_park", light: "day" }), 900);
    const probe = () => page.evaluate(() => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      const img = theme.querySelector("[data-vn-scene-image][data-vn-layer='active']")!;
      const scene = theme.querySelector("[data-vn-scene]")!;
      const sprites = theme.querySelector("[data-vn-sprites]")!;
      const front = theme.querySelector("[data-vn-ambient-front]")!;
      const g = (el: Element) => { const cs = getComputedStyle(el); return { transform: cs.transform, scale: cs.scale, translate: cs.translate, rotate: cs.rotate }; };
      return { img: g(img), scene: g(scene), sprites: g(sprites), front: g(front) };
    });
    const near = (actual: number, expected: number, tolerance: number, label: string) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual.toFixed(3)} vs ${expected.toFixed(3)}`);

    // Zoom punch peak (16% of 450 ms).
    /** Freeze every running camera animation at `ms` (deterministic mid-frame). */
    const freezeAt = (ms: number) => page.evaluate((at) => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      for (const a of theme.getAnimations()) {
        const name = (a as CSSAnimation).animationName ?? "";
        if (/zoom|shake|depth|tilt|rumble|heartbeat/.test(name)) { a.pause(); a.currentTime = at; }
      }
    }, ms);
    const release = () => page.evaluate(() => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      for (const a of theme.getAnimations()) if (a.playState === "paused") a.play();
    });
    await page.evaluate(() => (window as any).fx.effect("zoom_punch"));
    await freezeAt(72);
    let p = await probe();
    let plate = scaleOf(p.img.transform) - 1;
    assert.ok(plate > 0.05, `punch mid-frame (${plate})`);
    near((scaleOf(p.sprites.scale) - 1) / plate, 1.15, 0.06, "punch: sprites 1.15x the plate");
    near((scaleOf(p.front.scale) - 1) / plate, 1.4, 0.06, "punch: front 1.4x the plate");
    report.push(`zoom_punch mid-frame: plate +${(plate * 100).toFixed(1)}%, sprites +${((scaleOf(p.sprites.scale) - 1) * 100).toFixed(1)}%, front +${((scaleOf(p.front.scale) - 1) * 100).toFixed(1)}%`);
    await shot(page, "parallax-zoom-punch-midframe");
    await release();
    await page.waitForTimeout(600);

    // Shake hard (8-18% of 500 ms): scene carries 1x, sprites add 0.15x, front 0.4x.
    await page.evaluate(() => (window as any).fx.effect("shake_hard"));
    await freezeAt(90);
    p = await probe();
    const [sx] = translateOf(p.scene.transform);
    const [spx] = translateOf(p.sprites.translate);
    const [fx] = translateOf(p.front.translate);
    assert.ok(Math.abs(sx) > 4, `shake mid-frame (${sx})`);
    near(spx / sx, 0.15, 0.03, "shake: sprites add 0.15x");
    near(fx / sx, 0.4, 0.05, "shake: front adds 0.4x");
    report.push(`shake_hard mid-frame: scene ${sx.toFixed(1)}px, sprites +${spx.toFixed(1)}px, front +${fx.toFixed(1)}px`);
    await shot(page, "parallax-shake-hard-midframe");
    await release();
    await page.waitForTimeout(600);

    // Tilt, rumble and heartbeat drive the containers too.
    for (const [effect, wait] of [["tilt", 300], ["rumble", 200], ["heartbeat", 300]] as const) {
      await page.evaluate((e) => (window as any).fx.effect(e), effect);
      await page.waitForTimeout(wait);
      const names = await page.evaluate(() => document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector("[data-vn-sprites]")!.getAnimations().map((a) => (a as CSSAnimation).animationName));
      assert.ok(names.includes(`vn-depth-${effect}`), `${effect}: sprites follow with depth (${names})`);
      if (effect === "tilt") {
        p = await probe();
        near(Number.parseFloat(p.sprites.rotate) / Number.parseFloat(p.front.rotate), 1.15 / 1.4, 0.03, "tilt: sprites vs front rotation");
        await shot(page, "parallax-tilt-midframe");
      }
      await page.waitForTimeout(900);
    }

    // Zoom in (persistent): plate 1.12, sprites 1.138, front 1.168 once settled.
    await page.evaluate(() => (window as any).fx.effect("zoom_in"));
    await page.waitForTimeout(700);
    await shot(page, "parallax-zoom-in-midframe");
    await page.waitForTimeout(1800);
    p = await probe();
    near(scaleOf(p.img.transform), 1.12, 0.005, "zoom in: plate");
    near(scaleOf(p.sprites.scale), 1.138, 0.005, "zoom in: sprites");
    near(scaleOf(p.front.scale), 1.168, 0.005, "zoom in: front");
    await shot(page, "parallax-zoom-in-settled");

    // Zoom out pulls the layers back from depth-scaled closeups.
    await page.evaluate(() => (window as any).fx.effect("zoom_out"));
    await page.waitForTimeout(120);
    p = await probe();
    plate = scaleOf(p.img.transform) - 1;
    near((scaleOf(p.sprites.scale) - 1) / plate, 1.15, 0.08, "zoom out: sprites");
    await page.waitForTimeout(1700);
    await page.close();
  }

  // ---- Idle plate drift ------------------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    await load(page, DUO({ plateKey: "plate_classroom" }), 300);
    const drift = () => page.evaluate(() => {
      const img = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector("[data-vn-scene-image][data-vn-layer='active']")!;
      const animation = img.getAnimations().find((a) => (a as CSSAnimation).animationName === "vn-plate-drift");
      const w = window as any;
      w.__drift ??= animation;
      return { translate: getComputedStyle(img).translate, same: w.__drift === animation, running: animation?.playState === "running" };
    });
    const a = await drift();
    await page.waitForTimeout(1500);
    const b = await drift();
    assert.ok(a.running && b.running, "plate drifts");
    const [ax, ay] = translateOf(a.translate), [bx, by] = translateOf(b.translate);
    assert.ok(Math.abs(ax) <= 7 && Math.abs(ay) <= 3, `drift stays within a few px (${a.translate})`);
    assert.ok(Math.hypot(bx - ax, by - ay) > 0.02 && Math.hypot(bx - ax, by - ay) < 2, `drift is slow (${a.translate} -> ${b.translate})`);
    // The drift keeps running through plate camera moves (same animation object).
    await page.evaluate(() => (window as any).fx.effect("zoom_punch"));
    await page.waitForTimeout(100);
    const c = await drift();
    assert.ok(c.same && c.running, "drift continues through a zoom punch");
    await page.waitForTimeout(450);
    await page.evaluate(() => (window as any).fx.stage.setEffectIntensity("off"));
    await page.waitForTimeout(50);
    const d = await page.evaluate(() => getComputedStyle(document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector("[data-vn-scene-image][data-vn-layer='active']")!).animationName);
    assert.equal(d, "none", "intensity off stops the drift");
    await page.close();
  }

  // ---- Gentle halves the front layer -------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { intensity: "gentle" });
    await load(page, TRIO({ ambient: "snow", plateKey: "plate_park", light: "day" }), 900);
    const l = await layers(page);
    assert.equal(l.front!.ptsVisible, Math.ceil(l.front!.pts / 2), `gentle halves the front flakes (${l.front!.ptsVisible}/${l.front!.pts})`);
    await shot(page, "gentle-snow");
    await load(page, TRIO({ ambient: "rain", plateKey: "plate_street", light: "night" }), 900);
    const rain = await layers(page);
    assert.equal(rain.front!.ptsVisible, Math.ceil(rain.front!.pts / 2), `gentle halves the front streaks (${rain.front!.ptsVisible}/${rain.front!.pts})`);
    await shot(page, "gentle-rain");
    await page.close();
  }

  // ---- Reduced motion: only static grades ------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    watch(page);
    await open(page);
    await load(page, TRIO({ ambient: "rain", plateKey: "plate_street", light: "night" }), 600);
    let l = await layers(page);
    assert.equal(l.front!.display, "none", "reduced motion: no front particles");
    const drift = (await css(page, "[data-vn-scene-image][data-vn-layer='active']", ["animation-name"]))!["animation-name"];
    assert.equal(drift, "none", "reduced motion: no plate drift");
    await page.evaluate(() => (window as any).fx.effect("shake_hard"));
    await page.waitForTimeout(80);
    const spr = (await css(page, "[data-vn-sprites]", ["animation-name", "translate"]))!;
    assert.equal(spr["animation-name"], "none", "reduced motion: no parallax");
    await page.evaluate(() => (window as any).fx.effect("lightning"));
    await page.waitForTimeout(20);
    l = await layers(page);
    assert.equal(l.plateLight!.display, "none", "reduced motion: no lightning light");
    await shot(page, "reduced-motion-rain");
    await load(page, DUO({ ambient: "vignette_dark", plateKey: "plate_classroom", light: "day" }), 400);
    l = await layers(page);
    assert.equal(l.backZ, "5", "reduced motion keeps the static grade over the sprites");
    await shot(page, "reduced-motion-grade");
    await context.close();
  }

  // ---- Mobile 390x844 -----------------------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    watch(page);
    await open(page);
    for (const ambient of ["rain", "sakura", "heavy_rain", "fog"]) {
      await load(page, DUO({ ambient, plateKey: PLATE_FOR[ambient]!, light: LIGHT_FOR[ambient]! }), 1000);
      const l = await layers(page);
      assert.ok(l.front && l.front.display !== "none", `mobile ${ambient}: front layer`);
      await shot(page, `mobile-${ambient}`);
    }
    await page.evaluate(() => (window as any).fx.effect("shake_hard"));
    await page.waitForTimeout(70);
    await shot(page, "mobile-shake-hard-midframe");
    await page.close();
  }

  // ---- Scene mode is untouched ---------------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { mode: "scene" });
    await load(page, [{ text: "Scene mode.", actors: [], ambient: "rain" }], 0);
    await page.evaluate(() => (window as any).fx.ambient("rain"));
    await page.evaluate(() => (window as any).fx.effect("lightning"));
    await page.waitForTimeout(20);
    const state = await page.evaluate(() => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      const root = theme.querySelector<HTMLElement>("[data-vn-root]")!;
      const img = theme.querySelector("[data-vn-scene-image]")!;
      return {
        presentation: root.dataset.vnPresentation ?? null,
        front: theme.querySelectorAll("[data-vn-ambient-front]").length,
        plateLight: theme.querySelectorAll("[data-vn-plate-light]").length,
        fxBolt: Boolean(theme.querySelector("[data-vn-fx] .vn-bolt")),
        flash: getComputedStyle(theme.querySelector("[data-vn-flash]")!).animationName,
        imgScale: getComputedStyle(img).scale,
        imgAnimation: getComputedStyle(img).animationName,
        lightning: theme.querySelector<HTMLElement>("[data-vn-scene]")!.dataset.vnLightning ?? null,
      };
    });
    assert.deepEqual(state, { presentation: null, front: 0, plateLight: 0, fxBolt: true, flash: "vn-lightning", imgScale: "none", imgAnimation: "none", lightning: null }, "scene mode: no depth layers, classic lightning, no drift");
    await page.close();
  }

  // ---- Frame cost: rain + 3 sprites (rough rAF probe) -------------------------------
  // Measured twice: with GPU compositing when the machine has it (the normal
  // case for readers; asserted), and in the default headless software
  // renderer (pessimistic; reported, loosely bounded against scene rain).
  {
    type Frames = { mean: number; p95: number; long: number; frames: number };
    const probe = async (b: Browser, query: Record<string, string>, paragraphs: P[], ambient: string): Promise<Frames> => {
      const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
      watch(page);
      await open(page, query);
      await load(page, paragraphs, 800);
      await page.evaluate((a) => (window as any).fx.ambient(a), ambient);
      await page.waitForTimeout(400);
      const result = await page.evaluate(() => new Promise<Frames>((resolve) => {
        const times: number[] = [];
        let last = performance.now();
        const start = last;
        const tick = (now: number) => {
          times.push(now - last);
          last = now;
          if (now - start < 2500) requestAnimationFrame(tick);
          else {
            const sorted = [...times].sort((a, b) => a - b);
            resolve({ mean: times.reduce((s, t) => s + t, 0) / times.length, p95: sorted[Math.floor(sorted.length * 0.95)]!, long: times.filter((t) => t > 34).length, frames: times.length });
          }
        };
        requestAnimationFrame(tick);
      }));
      await page.close();
      return result;
    };
    const fmt = (r: Frames) => `mean ${r.mean.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, ${r.long} long of ${r.frames}`;
    const rainTrio = TRIO({ ambient: "rain", plateKey: "plate_street", light: "night" });
    const heavyTrio = TRIO({ ambient: "heavy_rain", plateKey: "plate_street", light: "dark" });
    const sceneRain: P[] = [{ text: "Scene rain.", actors: [] }];

    const gpu = await chromium.launch({ headless: true, args: ["--enable-gpu", "--ignore-gpu-blocklist", ...(process.platform === "win32" ? ["--use-angle=d3d11"] : [])] });
    try {
      const page = await gpu.newPage();
      const renderer = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "none";
      });
      await page.close();
      const hardware = !/swiftshader|llvmpipe|software|none/i.test(renderer);
      report.push(`GPU renderer: ${renderer}${hardware ? "" : " (software: GPU frame check skipped)"}`);
      if (hardware) {
        const s = await probe(gpu, {}, rainTrio, "rain");
        const h = await probe(gpu, {}, heavyTrio, "heavy_rain");
        report.push(`GPU frames, rain + 3 sprites + front: ${fmt(s)}`);
        report.push(`GPU frames, heavy_rain + 3 sprites + front: ${fmt(h)}`);
        assert.ok(s.mean < 20, `GPU: rain + 3 sprites holds ~60 fps (${fmt(s)})`);
        assert.ok(h.mean < 20, `GPU: heavy rain + 3 sprites holds ~60 fps (${fmt(h)})`);
      }
    } finally {
      await gpu.close();
    }

    const s = await probe(browser, {}, rainTrio, "rain");
    const ref = await probe(browser, { mode: "scene" }, sceneRain, "rain");
    report.push(`software frames, rain + 3 sprites + front: ${fmt(s)}`);
    report.push(`software frames, scene-mode rain (reference): ${fmt(ref)}`);
    assert.ok(s.mean < ref.mean * 3, `software: sprite rain stays within 3x scene rain (${fmt(s)} vs ${fmt(ref)})`);
  }

  assert.deepEqual(errors, [], "no console errors");
  console.log(report.join("\n"));
  console.log(`sprite depth browser checks passed; ${shots.length} screenshots in ${OUT}/`);
} finally {
  await browser?.close();
  server.stop(true);
}
