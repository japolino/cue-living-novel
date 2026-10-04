import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { THEME_PRESET_IDS } from "../src/config.js";
import { SPRITE_EMOTES, SPRITE_LIGHTS, SPRITE_MOTIONS } from "../src/shared/sprites.js";

/**
 * Sprite mode on the VN stage in a real browser: slot layout for 1/2/3
 * actors (desktop and 390x844), focus, every light preset, every emote,
 * motion mid-frames, expression crossfade, enter/exit, a set with nothing
 * ready (badge), every theme preset, effect intensity, reduced motion, the
 * talking bob, mode switching, and no console errors.
 * Screenshots: .cache/sprite-stage/. Run: bun run ./scripts/test-sprite-stage-browser.ts
 */
const OUT = ".cache/sprite-stage";
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

type P = { text?: string; speaker?: string; actors: Array<Record<string, unknown> & { characterKey: string }>; plateKey?: string | null; light?: string };

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
  await waitImages(page);
  if (settle) await page.waitForTimeout(settle);
}

async function go(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => (window as any).fx.go(i), index);
}

/** Wait until every painted sprite and the scene image have decoded. */
async function waitImages(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
    const imgs = [...theme.querySelectorAll<HTMLImageElement>("[data-vn-sprite-image] img[src], [data-vn-scene-image][src]")];
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  });
}

const snap = (page: Page) => page.evaluate(() => (window as any).fx.stage.getSpriteSnapshot());

type Geo = {
  stage: { w: number; h: number };
  exit: { left: number; right: number; top: number; bottom: number };
  controls: { top: number };
  figures: Array<{ key: string; left: number; right: number; top: number; bottom: number; state: string; dim: string; focus: string; mirrored: string; z: string }>;
  emotes: Array<{ key: string; name: string; cx: number; cy: number; w: number; visible: boolean }>;
};

/** Opaque figure rects (active image layer rect x cut-out bbox), emote rects, chrome rects. */
async function geometry(page: Page): Promise<Geo> {
  return page.evaluate(() => {
    const outer = document.querySelector("[data-vn-stage-host]")!.shadowRoot!;
    const theme = outer.querySelector("[data-vn-theme-host]")!.shadowRoot!;
    const root = theme.querySelector<HTMLElement>("[data-vn-root]")!.getBoundingClientRect();
    const exit = outer.querySelector("[data-vn-exit]")!.getBoundingClientRect();
    const controls = theme.querySelector("[data-vn-controls]")!.getBoundingClientRect();
    const figures = [...theme.querySelectorAll<HTMLElement>("[data-vn-sprite]")].map((el) => {
      const layer = el.querySelector<HTMLElement>("[data-vn-sprite-image][data-vn-sprite-layer='active']")!;
      const r = layer.getBoundingClientRect();
      const cs = getComputedStyle(layer);
      const n = (name: string, fallback: number) => Number.parseFloat(cs.getPropertyValue(name)) || fallback;
      const cx = n("--vn-sprite-cx", 0.5), by = n("--vn-sprite-by", 1), bw = n("--vn-sprite-bw", 1), bh = n("--vn-sprite-bh", 1);
      const width = r.width * bw, height = r.height * bh;
      // A mirrored figure flips around its bbox centre, so measure from the other edge.
      const mirroredFigure = el.dataset.vnSpriteMirrored === "true";
      const centre = r.left + r.width * (mirroredFigure ? 1 - cx : cx), bottom = r.top + r.height * by;
      return {
        key: el.dataset.vnSpriteKey!, left: centre - width / 2, right: centre + width / 2, top: bottom - height, bottom,
        state: el.dataset.vnSpriteState ?? "", dim: el.dataset.vnSpriteDim ?? "", focus: el.dataset.vnSpriteFocus ?? "",
        mirrored: el.dataset.vnSpriteMirrored ?? "", z: getComputedStyle(el).zIndex,
      };
    });
    const emotes = [...theme.querySelectorAll<HTMLElement>("[data-vn-sprite-emote]:not([hidden])")].map((el) => {
      const r = el.getBoundingClientRect();
      return { key: el.closest<HTMLElement>("[data-vn-sprite]")!.dataset.vnSpriteKey!, name: el.dataset.vnSpriteEmoteName ?? "", cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, visible: r.width > 0 && getComputedStyle(el).display !== "none" };
    });
    return { stage: { w: root.width, h: root.height }, exit: { left: exit.left, right: exit.right, top: exit.top, bottom: exit.bottom }, controls: { top: controls.top }, figures, emotes };
  });
}

function assertLayout(geo: Geo, label: string, count: number): void {
  const shown = geo.figures.filter((f) => f.state !== "exiting");
  assert.equal(shown.length, count, `${label}: ${count} sprites`);
  for (const f of shown) {
    assert.ok(f.left >= -1 && f.right <= geo.stage.w + 1, `${label}: ${f.key} inside the stage horizontally (${f.left.toFixed(0)}..${f.right.toFixed(0)} of ${geo.stage.w})`);
    assert.ok(Math.abs(f.bottom - geo.stage.h) <= 2, `${label}: ${f.key} stands on the stage bottom (${f.bottom.toFixed(1)} vs ${geo.stage.h})`);
    assert.ok(f.top >= geo.exit.bottom, `${label}: ${f.key} head stays below Back to chat (${f.top.toFixed(0)} >= ${geo.exit.bottom.toFixed(0)})`);
    assert.ok(f.top < geo.controls.top, `${label}: ${f.key} head is above the reading toolbar (${f.top.toFixed(0)} < ${geo.controls.top.toFixed(0)})`);
  }
  const lefts = [...shown].sort((a, b) => a.left - b.left).map((f) => (f.left + f.right) / 2);
  for (let i = 1; i < lefts.length; i += 1) assert.ok(lefts[i]! > lefts[i - 1]! + 20, `${label}: figures are spread left to right`);
}

/** CSS animations (not transitions) running inside the sprite layer. */
const runningAnimations = (page: Page) => page.evaluate(() => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  const layer = theme.querySelector("[data-vn-sprites]")!;
  return layer.getAnimations({ subtree: true }).filter((a) => a instanceof CSSAnimation && a.playState === "running").map((a) => (a as CSSAnimation).animationName);
});

const SOLO: P[] = [{ speaker: "Mira", text: "Good morning! Did you sleep well?", actors: [{ characterKey: "mira", focus: true }] }];
const DUO: P[] = [{ speaker: "Mira", text: "This is Ren, from the class next door.", actors: [{ characterKey: "mira", slot: "left", focus: true, facing: "right" }, { characterKey: "ren", slot: "right", facing: "left" }] }];
const TRIO: P[] = [{ speaker: "Aoi", text: "So all three of us are on duty today?", actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "aoi", slot: "center", focus: true }, { characterKey: "kaede", slot: "right", facing: "left" }] }];

let browser: Browser | undefined;
const shots: string[] = [];
const shot = async (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) => {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, ...(clip ? { clip } : {}) });
  shots.push(path);
};

try {
  browser = await chromium.launch({ headless: true });

  // ---- Desktop: 1, 2, 3 actors, focus, mode switch, API -------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    for (const [name, paragraphs, count] of [["desktop-1-actor", SOLO, 1], ["desktop-2-actors", DUO, 2], ["desktop-3-actors", TRIO, 3]] as const) {
      await load(page, [...paragraphs]);
      const geo = await geometry(page);
      assertLayout(geo, name, count);
      await shot(page, name);
    }
    // Plate through the scene image layers, with the fit setting.
    const scene = await page.evaluate(() => (window as any).fx.stage.getState().displayedImage);
    assert.equal(scene?.url, "/sprites/plate_classroom.webp", "plate shown through the scene layers");
    assert.ok(scene.requestId.startsWith("plate:"), "plate request id");

    // Focus: speaker bright and in front; the others dimmed.
    await load(page, [
      { speaker: "Mira", text: "Mira speaks.", actors: [{ characterKey: "mira", slot: "left", focus: true }, { characterKey: "ren", slot: "right" }] },
      { speaker: "Ren", text: "Now Ren answers.", actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "ren", slot: "right", focus: true }] },
    ]);
    let geo = await geometry(page);
    const byKey = (g: Geo, key: string) => g.figures.find((f) => f.key === key)!;
    assert.equal(byKey(geo, "mira").dim, "false");
    assert.equal(byKey(geo, "ren").dim, "true");
    assert.ok(Number(byKey(geo, "mira").z) > Number(byKey(geo, "ren").z), "the speaker stands in front");
    const dimFilter = await page.evaluate(() => getComputedStyle(document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector("[data-vn-sprite-key='ren']")!).filter);
    assert.match(dimFilter, /brightness\(0\.68\)/, `dimmed actor filter (${dimFilter})`);
    await shot(page, "focus-mira");
    await go(page, 1);
    await page.waitForTimeout(450);
    geo = await geometry(page);
    assert.equal(byKey(geo, "mira").dim, "true");
    assert.equal(byKey(geo, "ren").dim, "false");
    await shot(page, "focus-ren");

    // Slot move: Mira walks from centre to the left when Ren enters.
    await load(page, [
      { speaker: "Mira", actors: [{ characterKey: "mira", focus: true }] },
      { speaker: "Ren", actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "ren", slot: "right", focus: true }] },
    ]);
    const before = (await geometry(page)).figures[0]!;
    await go(page, 1);
    await page.waitForTimeout(150);
    await shot(page, "enter-and-move-midframe");
    const mid = (await geometry(page)).figures.find((f) => f.key === "mira")!;
    await page.waitForTimeout(700);
    const after = (await geometry(page)).figures.find((f) => f.key === "mira")!;
    assert.ok(after.left < mid.left && mid.left < before.left, `slot move animates (${before.left.toFixed(0)} -> ${mid.left.toFixed(0)} -> ${after.left.toFixed(0)})`);

    // Exit.
    await load(page, [
      { actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "ren", slot: "right", focus: true }] },
      { actors: [{ characterKey: "ren", focus: true }] },
    ]);
    await go(page, 1);
    await page.waitForTimeout(160);
    geo = await geometry(page);
    assert.equal(byKey(geo, "mira").state, "exiting", "leaving actor fades out");
    await shot(page, "exit-midframe");
    await page.waitForTimeout(500);
    geo = await geometry(page);
    assert.equal(geo.figures.length, 1, "the leaving actor is removed");

    // Expression crossfade.
    await load(page, [
      { speaker: "Mira", actors: [{ characterKey: "mira", focus: true }] },
      { speaker: "Mira", text: "What?!", actors: [{ characterKey: "mira", focus: true, expression: "shocked" }] },
    ]);
    await go(page, 1);
    await page.waitForTimeout(130);
    const fade = await page.evaluate(() => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      return [...theme.querySelectorAll<HTMLElement>("[data-vn-sprite-key='mira'] [data-vn-sprite-image]")].map((l) => ({ role: l.dataset.vnSpriteLayer, expression: l.dataset.vnSpriteExpression, opacity: Number(getComputedStyle(l).opacity) }));
    });
    await shot(page, "expression-crossfade-midframe");
    const incoming = fade.find((l) => l.role === "active")!;
    const leaving = fade.find((l) => l.role === "leaving")!;
    assert.equal(incoming.expression, "surprised", "shocked falls back to the hot-set surprised sprite");
    assert.ok(incoming.opacity > 0.05 && incoming.opacity < 0.98, `incoming layer mid-fade (${incoming.opacity})`);
    assert.ok(leaving.opacity > 0.5, `old layer still covers (${leaving.opacity})`);
    await page.waitForTimeout(500);
    await shot(page, "expression-after");
    assert.equal((await snap(page)).actors[0].shownExpression, "surprised");

    // A set with nothing ready: no sprite, a badge; it appears when a sprite is ready.
    await load(page, [{ speaker: "Yuki", text: "Hello?", actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "yuki", slot: "right", focus: true }] }]);
    const badgeTexts = () => page.evaluate(() => [...document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelectorAll("[data-vn-badge]")].map((b) => b.textContent!.trim()));
    assert.ok((await badgeTexts()).includes("Preparing Yuki 0/12"), `badge shown (${await badgeTexts()})`);
    geo = await geometry(page);
    assert.equal(byKey(geo, "yuki").state, "waiting", "no sprite for an unready set");
    const yukiOpacity = await page.evaluate(() => getComputedStyle(document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector("[data-vn-sprite-key='yuki']")!).opacity);
    assert.equal(yukiOpacity, "0");
    await shot(page, "missing-set-badge");
    await page.evaluate(() => { const fx = (window as any).fx; fx.stage.updateSpriteImage("set_yuki", fx.spriteImage("yuki_idle", "idle")); });
    await waitImages(page);
    await page.waitForTimeout(600);
    assert.ok(!(await badgeTexts()).some((t) => t.startsWith("Preparing")), "badge gone once a sprite is ready");
    assertLayout(await geometry(page), "yuki ready", 2);
    await shot(page, "missing-set-ready");

    // Plate update while shown; unknown plates are ignored.
    await load(page, [{ actors: [{ characterKey: "mira", focus: true }], plateKey: "plate_park" }]);
    assert.equal((await page.evaluate(() => (window as any).fx.stage.getState().displayedImage)).url, "/sprites/plate_park.webp");
    await page.evaluate(() => (window as any).fx.stage.updatePlate({ plateKey: "plate_park", location: "park", timeOfDay: "day", weather: null, status: "ready", url: "/sprites/plate_street.webp" }));
    await waitImages(page);
    await page.waitForTimeout(450);
    assert.equal((await page.evaluate(() => (window as any).fx.stage.getState().displayedImage)).url, "/sprites/plate_street.webp", "plate update repaints");

    // Previous re-applies the staging.
    await load(page, [{ actors: [{ characterKey: "mira" }] }, { actors: [{ characterKey: "ren" }, { characterKey: "aoi", slot: "left" }] }, { actors: [{ characterKey: "kaede" }] }]);
    await go(page, 2);
    await go(page, 0);
    await page.waitForTimeout(500);
    assert.deepEqual((await snap(page)).actors.map((a: { characterKey: string }) => a.characterKey), ["mira"], "Previous restores paragraph 0");

    // Mode switch: scene removes every sprite and the plate; sprites restore them.
    await page.evaluate(() => (window as any).fx.stage.setPresentationMode("scene"));
    await page.waitForTimeout(100);
    geo = await geometry(page);
    assert.equal(geo.figures.length, 0, "scene mode leaves no sprite layers");
    assert.equal(await page.evaluate(() => (window as any).fx.stage.getState().displayedImage), null, "scene mode drops the plate");
    await shot(page, "mode-scene-after-switch");
    await page.evaluate(() => (window as any).fx.stage.setPresentationMode("sprites"));
    await waitImages(page);
    await page.waitForTimeout(600);
    assert.equal((await geometry(page)).figures.length, 1, "sprite mode restores the stage");
    await page.close();
  }

  // ---- Lights ---------------------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    const plateFor: Record<string, string> = { neutral: "plate_classroom", day: "plate_park", sunset: "plate_classroom", night: "plate_street", indoor_warm: "plate_bedroom", indoor_cool: "plate_classroom", candle: "plate_bedroom", dark: "plate_street" };
    const filters = new Set<string>();
    for (const light of SPRITE_LIGHTS) {
      await load(page, [{ actors: [{ characterKey: "aoi", slot: "left", focus: true }, { characterKey: "mira", slot: "right", focus: true }], plateKey: plateFor[light]!, light }], 800);
      const style = await page.evaluate(() => {
        const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
        const layer = theme.querySelector("[data-vn-sprite-image][data-vn-sprite-layer='active']")!;
        return { filter: getComputedStyle(layer.querySelector("img")!).filter, tint: getComputedStyle(layer, "::after").opacity };
      });
      if (light === "neutral") assert.equal(style.filter, "none");
      else assert.ok(Number(style.tint) > 0, `${light}: tint`);
      filters.add(style.filter);
      await shot(page, `light-${light}`);
    }
    assert.equal(filters.size, SPRITE_LIGHTS.length, "every light preset has its own filter");
    await page.close();
  }

  // ---- Emotes ---------------------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    for (const emote of SPRITE_EMOTES.filter((e) => e !== "none")) {
      await load(page, [{ actors: [{ characterKey: "mira", slot: "left", focus: true, emote }, { characterKey: "ren", slot: "right", emote }] }], 500);
      const geo = await geometry(page);
      assert.equal(geo.emotes.length, 2, `${emote}: one mark per actor`);
      for (const mark of geo.emotes) {
        const fig = geo.figures.find((f) => f.key === mark.key)!;
        const figH = fig.bottom - fig.top;
        assert.equal(mark.name, emote);
        assert.ok(mark.visible && mark.w >= 24, `${emote}: visible (${mark.w})`);
        assert.ok(mark.cy > fig.top - 0.15 * figH && mark.cy < fig.top + 0.3 * figH, `${emote}: near the head (${mark.cy.toFixed(0)} vs top ${fig.top.toFixed(0)})`);
        assert.ok(mark.cx > 0 && mark.cx < geo.stage.w, `${emote}: on stage`);
      }
      const mira = geo.figures.find((f) => f.key === "mira")!;
      await shot(page, `emote-${emote}`, { x: Math.max(0, mira.left - 40), y: Math.max(0, mira.top - 70), width: 360, height: 260 });
    }
    // Pop-in plays on change.
    await load(page, [{ actors: [{ characterKey: "mira", focus: true }] }, { actors: [{ characterKey: "mira", focus: true, emote: "exclaim" }] }], 300);
    await go(page, 1);
    await page.waitForTimeout(80);
    assert.ok((await runningAnimations(page)).includes("vn-sprite-emote-pop"), "emote pops in");
    await page.close();
  }

  // ---- Motions (mid-frames) --------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page);
    const durations: Record<string, number> = { hop: 560, bounce: 820, shake: 520, tremble: 1100, step_back: 760, lean_in: 820, nod: 720, turn_away: 900, sink: 1100 };
    for (const motion of SPRITE_MOTIONS.filter((m) => m !== "none")) {
      await load(page, [
        { actors: [{ characterKey: "mira", focus: true, facing: "right" }] },
        { actors: [{ characterKey: "mira", focus: true, facing: "right", motion, intensity: 5 }] },
      ], 300);
      await go(page, 1);
      await page.waitForTimeout(Math.round(durations[motion]! * 0.38));
      const state = await page.evaluate(() => {
        const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
        const body = theme.querySelector<HTMLElement>("[data-vn-sprite-body]")!;
        return { motion: body.dataset.vnSpriteMotion, transform: getComputedStyle(body).transform, names: body.getAnimations().map((a) => (a as CSSAnimation).animationName) };
      });
      assert.equal(state.motion, motion);
      assert.ok(state.names.includes(`vn-sprite-${motion.replace("_", "-")}`), `${motion}: keyframes run (${state.names})`);
      assert.notEqual(state.transform, "none", `${motion}: mid-frame moves the body`);
      await shot(page, `motion-${motion}-midframe`, { x: 340, y: 40, width: 600, height: 520 });
      await page.waitForTimeout(durations[motion]! * 0.7 + 120);
      assert.equal(await page.evaluate(() => document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector<HTMLElement>("[data-vn-sprite-body]")!.dataset.vnSpriteMotion ?? null), null, `${motion}: one-shot`);
    }
    // Idle breathing runs while nothing else happens.
    assert.ok((await runningAnimations(page)).includes("vn-sprite-breathe"), "idle breathing");
    await page.close();
  }

  // ---- Talking bob while typing ----------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { speed: "30" });
    await load(page, [{ speaker: "Mira", text: "This line types out slowly so the speaker can bob while she talks, one letter at a time.", actors: [{ characterKey: "mira", slot: "left", focus: true }, { characterKey: "ren", slot: "right" }] }], 200);
    const talking = () => page.evaluate(() => [...document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelectorAll<HTMLElement>("[data-vn-sprite]")].map((el) => [el.dataset.vnSpriteKey, el.dataset.vnSpriteTalking]));
    const bob = Object.fromEntries(await talking());
    assert.ok(bob.mira === "true" && bob.ren !== "true", `only the speaker bobs (${JSON.stringify(bob)})`);
    assert.ok((await runningAnimations(page)).includes("vn-sprite-talk"));
    await page.waitForTimeout(3600);
    assert.equal(Object.fromEntries(await talking()).mira, "false", "bob stops when the line is typed");
    await page.close();
  }

  // ---- Effect intensity --------------------------------------------------------
  for (const intensity of ["off", "gentle"] as const) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { intensity });
    await load(page, [{ actors: [{ characterKey: "mira", focus: true }] }, { actors: [{ characterKey: "mira", focus: true, motion: "hop", emote: "heart" }] }], 300);
    await go(page, 1);
    await page.waitForTimeout(150);
    const names = await runningAnimations(page);
    if (intensity === "off") {
      assert.deepEqual(names, [], `effects off: no sprite animation (${names})`);
    } else {
      assert.ok(names.includes("vn-sprite-hop"), "gentle still moves");
      const fx = await page.evaluate(() => getComputedStyle(document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector("[data-vn-sprites]")!).getPropertyValue("--vn-sprite-fx").trim());
      assert.equal(fx, "0.55", "gentle scales motion");
    }
    await page.waitForTimeout(500);
    await shot(page, `intensity-${intensity}`);
    await page.close();
  }

  // ---- Reduced motion ------------------------------------------------------------
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    watch(page);
    await open(page);
    await load(page, [{ actors: [{ characterKey: "mira", focus: true }] }, { actors: [{ characterKey: "mira", slot: "left", focus: true, motion: "bounce", emote: "music" }, { characterKey: "ren", slot: "right" }] }], 300);
    await go(page, 1);
    await page.waitForTimeout(100);
    assert.deepEqual(await runningAnimations(page), [], "reduced motion: no sprite keyframes");
    await page.waitForTimeout(500);
    assertLayout(await geometry(page), "reduced motion", 2);
    await shot(page, "reduced-motion");
    await context.close();
  }

  // ---- Mobile 390x844 --------------------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    watch(page);
    await open(page);
    for (const [name, paragraphs, count] of [["mobile-1-actor", SOLO, 1], ["mobile-2-actors", DUO, 2], ["mobile-3-actors", TRIO, 3]] as const) {
      await load(page, [...paragraphs]);
      assertLayout(await geometry(page), name, count);
      await shot(page, name);
    }
    await load(page, [{ speaker: "Yuki", actors: [{ characterKey: "yuki", focus: true }] }]);
    await shot(page, "mobile-missing-set");
    await page.close();
  }

  // ---- Every theme preset -----------------------------------------------------------
  for (const preset of THEME_PRESET_IDS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { preset });
    await load(page, [{ speaker: "Mira", text: "Theme check with two characters on stage.", actors: [{ characterKey: "mira", slot: "left", focus: true, emote: "sparkle" }, { characterKey: "aoi", slot: "right", facing: "left" }], plateKey: "plate_park", light: "day" }]);
    assertLayout(await geometry(page), `preset ${preset}`, 2);
    await shot(page, `preset-${preset}`);
    await page.close();
  }

  // ---- Scene mode is untouched ---------------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { mode: "scene" });
    await load(page, [...DUO], 300);
    const state = await page.evaluate(() => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      const layer = theme.querySelector<HTMLElement>("[data-vn-sprites]")!;
      return { children: layer.childElementCount, display: getComputedStyle(layer).display, image: (window as any).fx.stage.getState().displayedImage };
    });
    assert.deepEqual(state, { children: 0, display: "none", image: null }, "scene mode shows no sprites and no plate");
    await page.close();
  }

  assert.deepEqual(errors, [], "no console errors");
  console.log(`sprite stage browser checks passed; ${shots.length} screenshots in ${OUT}/`);
} finally {
  await browser?.close();
  server.stop(true);
}
