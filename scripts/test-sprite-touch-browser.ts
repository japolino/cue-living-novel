import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { spriteTouchAreaAt, spriteTouchZones, touchClientPoint, type TouchArea } from "../src/frontend/stage/sprite-touch.js";
import type { SpriteFaceSpot, SpriteGeometry } from "../src/frontend/stage/sprite-layer.js";
import { spriteFaceSpot, spriteGeometry } from "../src/frontend/stage/sprite-layer.js";
import { TOUCH_GENERIC_LINES, type TouchLinePack, type TouchZone } from "../src/shared/touch.js";

/**
 * Touch mode in a real browser (docs/SPRITE_MODE.md, "Touch"), on a desktop
 * (1280x720) and a phone (393x851, touch): the hand button and T turn it on
 * and off (Escape leaves); turning it on asks for the characters' saved bonds
 * and one line pack each; the hand follows the pointer (palm, two hands,
 * finger); a tap on the head pats, on the side of the head strokes hair (ears
 * for a character with animal ears), on the cheeks squishes and elsewhere
 * pokes, each with an expression, an emote, a motion and a line in the
 * bubble, and never reads on; a tap off the characters reads on; the third
 * pat is content, the fourth cheek squish is a pout and then a sulk; the
 * hearts follow the bond and it is saved; saved bonds unlock warmer lines;
 * Refresh asks for new lines; lines off makes no call; a failed call keeps
 * the simple lines; Gentle has no marks; Motion Still and reduced motion keep
 * everyone still; the waiting screen's line-up can be touched; no console errors.
 * Reuses the sprite stage fixture (scripts/sprite-stage-browser-fixture.ts),
 * whose stand-in backend answers the touch asks.
 * Screenshots: .cache/sprite-touch/
 * Run: bun run ./scripts/test-sprite-touch-browser.ts
 */
const OUT = ".cache/sprite-touch";
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
/** Mira (cat ears) on the left speaking, Aoi on the right; a second paragraph to read on to. */
const DUO: P[] = [
  { speaker: "Mira", text: "Go on, you can pat my head.", actors: [{ characterKey: "mira", slot: "left", focus: true }, { characterKey: "aoi", slot: "right", facing: "left" }], plateKey: "plate_park", light: "day" },
  { speaker: "Aoi", text: "Me too, if you must.", actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "aoi", slot: "right", facing: "left", focus: true }], plateKey: "plate_park", light: "day" },
];
const GAP = 460; // more than TOUCH_MIN_GAP_MS between taps

const errors: string[] = [];
function watch(page: Page): void {
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
}

async function open(page: Page, query: Record<string, string> = {}, before?: string): Promise<void> {
  await page.goto(url(query));
  await page.waitForFunction(() => Boolean((window as any).fx));
  await page.evaluate(() => (window as any).fx.identity("mira", "blonde twintails, cat ears, maid outfit"));
  if (before) await page.evaluate(before);
  await page.evaluate((p) => (window as any).fx.load(p), DUO);
  await page.waitForFunction(() => {
    const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
    const imgs = [...theme.querySelectorAll<HTMLImageElement>("[data-vn-sprite-image] img[src], [data-vn-scene-image][src]")];
    return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0);
  });
  await page.waitForTimeout(700);
}

type Snapshot = {
  active: boolean;
  characters: Array<{ characterKey: string; name: string; bond: number; tier: string; lines: string; ownLines: boolean }>;
  last: { characterKey: string; area: TouchArea; zone: TouchZone; mood: string; expression: string; emote: string; motion: string; line: string | null; bond: number } | null;
  bubble: string | null;
  cursor: { hand: string | null; visible: boolean; anim: string | null };
};
const snap = (page: Page): Promise<Snapshot> => page.evaluate(() => (window as any).fx.stage.getTouchSnapshot());
const backend = (page: Page) => page.evaluate(() => {
  const b = (window as any).fx.touchBackend;
  return { gets: b.gets as string[][], saves: b.saves as Array<[string, number]>, calls: b.calls as Array<[string, boolean]>, pack: b.pack as TouchLinePack };
});
const paragraph = (page: Page) => page.evaluate(() => (window as any).fx.stage.getState().currentParagraphIndex as number);
const button = (page: Page) => page.locator('[data-vn-control="touch"]');

/** Turn touch mode on with the hand button and wait for the characters' lines. */
async function touchOn(page: Page, lines: "ready" | "failed" | "none" = "ready"): Promise<void> {
  await button(page).click();
  await page.waitForFunction((want) => {
    const s = (window as any).fx.stage.getTouchSnapshot();
    return s.active && s.characters.length > 0 && s.characters.every((c: { lines: string }) => c.lines === want);
  }, lines, { timeout: 5000 });
}

type Figure = { key: string; rect: { left: number; top: number; width: number; height: number }; geometry: SpriteGeometry; spot: SpriteFaceSpot | null; mirrored: boolean };
async function figure(page: Page, key: string): Promise<Figure> {
  return page.evaluate((k) => {
    const hit = (window as any).fx.stage.spriteLayer.figureOf(k);
    const r = hit.rect as DOMRect;
    return { key: hit.key, geometry: hit.geometry, spot: hit.spot, mirrored: hit.mirrored, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
  }, key);
}

/** A client point in a touch area of a figure (checked against the zones the stage uses). */
function pointIn(fig: Figure, area: TouchArea): { x: number; y: number } {
  const zones = spriteTouchZones(fig.geometry, fig.spot);
  const centre = (box: { left: number; right: number; top: number; bottom: number }) => ({ u: (box.left + box.right) / 2, v: (box.top + box.bottom) / 2 });
  const face = zones.face;
  const at = area === "head" ? centre(zones.head)
    : area === "side" ? centre(zones.sides[0])
    : area === "cheeks" ? centre(zones.cheeks)
    : { u: (face.left + face.right) / 2, v: Math.min(zones.body.bottom - 0.05, face.bottom + 0.25) };
  assert.equal(spriteTouchAreaAt(zones, at.u, at.v), area, `${fig.key}: the test point is in the ${area}`);
  return touchClientPoint(fig.rect, at.u, at.v, fig.mirrored);
}

async function tap(page: Page, point: { x: number; y: number }, phone: boolean): Promise<void> {
  if (phone) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(140);
}

/** The stage's view of a touch: the sprite's motion attribute, emote, expression and the bubble. */
const stageOf = (page: Page, key: string) => page.evaluate((k) => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  const el = theme.querySelector<HTMLElement>(`[data-vn-sprite][data-vn-sprite-key="${k}"]`)!;
  const emote = el.querySelector<HTMLElement>("[data-vn-sprite-emote]:not([hidden])");
  const bubble = theme.querySelector<HTMLElement>("[data-vn-touch-bubble]")!;
  const cursor = theme.querySelector<HTMLElement>("[data-vn-touch-cursor]")!;
  const actor = (window as any).fx.stage.getSpriteSnapshot().actors.find((a: { characterKey: string }) => a.characterKey === k);
  const touchAnimations = el.getAnimations({ subtree: true }).filter((a) => a instanceof CSSAnimation && a.animationName.startsWith("vn-sprite-touch") && a.playState === "running").length;
  // Keyframe motion only: a fade (a transition) is not movement.
  const cursorAnimations = cursor.getAnimations().filter((a) => a instanceof CSSAnimation && a.playState === "running").map((a) => (a as CSSAnimation).animationName).join(",");
  const b = bubble.getBoundingClientRect();
  return {
    motion: el.dataset.vnSpriteTouch ?? null,
    amp: getComputedStyle(el).getPropertyValue("--vn-sprite-touch-amp").trim(),
    emote: emote && getComputedStyle(emote).display !== "none" ? emote.dataset.vnSpriteEmoteName ?? "" : null,
    touch: actor?.touch ?? null,
    bubble: bubble.hidden ? null : bubble.querySelector("[data-vn-touch-line]")?.textContent ?? null,
    spoken: bubble.hidden ? null : bubble.textContent,
    bubbleRect: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
    cursorHand: cursor.dataset.vnTouchHand ?? null,
    cursorAnim: cursor.dataset.vnTouchAnim ?? null,
    still: theme.querySelector<HTMLElement>("[data-vn-touch-layer]")!.hasAttribute("data-vn-touch-still"),
    touchAnimations,
    cursorAnimations,
  };
}, key);

/** Record the motions the figures and the hand play from now on (they only last half a second). */
const record = (page: Page) => page.evaluate(() => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  const w = window as any;
  w.touchRecord?.observer.disconnect();
  const seen: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const change of records) {
      const el = change.target as HTMLElement;
      const value = el.getAttribute(change.attributeName!);
      if (value !== null) seen.push(change.attributeName === "data-vn-sprite-touch" ? `${el.dataset.vnSpriteKey}:${value}` : `hand:${value}`);
    }
  });
  observer.observe(theme, { subtree: true, attributes: true, attributeFilter: ["data-vn-sprite-touch", "data-vn-touch-anim"] });
  w.touchRecord = { observer, seen };
});
const recorded = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).touchRecord.seen);

const hud = (page: Page) => page.evaluate(() => {
  const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
  const list = theme.querySelector<HTMLElement>("[data-vn-touch-hud]");
  const r = list?.getBoundingClientRect();
  return {
    visible: Boolean(list && !list.hidden && r && r.width > 0),
    rect: r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null,
    gauges: [...theme.querySelectorAll<HTMLElement>("[data-vn-touch-gauge]")].map((li) => {
      const heart = li.querySelector<HTMLElement>("[data-vn-touch-heart]")!;
      const refresh = li.querySelector<HTMLButtonElement>("[data-vn-touch-refresh]");
      return {
        key: li.dataset.vnTouchKey!, value: Number(heart.getAttribute("aria-valuenow")), role: heart.getAttribute("role"),
        tier: li.querySelector("[data-vn-touch-tier]")!.textContent, refresh: refresh ? { lines: refresh.dataset.vnTouchLines, disabled: refresh.disabled, title: refresh.title } : null,
      };
    }),
  };
});

const packLines = (pack: TouchLinePack, zone: TouchZone) => Object.values(pack.lines[zone] ?? {}).flat();
const genericLines = (zone: TouchZone) => Object.values(TOUCH_GENERIC_LINES.lines[zone] ?? {}).flat();

let browser: Browser | undefined;
const shots: string[] = [];
const shot = async (page: Page, name: string) => { await page.screenshot({ path: `${OUT}/${name}.png` }); shots.push(name); };

try {
  browser = await chromium.launch();

  // ---- Every zone, on a desktop and a phone ------------------------------------------
  for (const device of [
    { tag: "desktop", phone: false, options: { viewport: { width: 1280, height: 720 } }, query: {} },
    { tag: "phone", phone: true, options: { viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true }, query: { puppet: "css" } },
  ] as const) {
    const page = await browser.newPage(device.options);
    watch(page);
    await open(page, device.query);
    const tag = device.tag;

    // The hand button: in the controls, off, labelled with its key.
    const hand = button(page);
    assert.ok(await hand.isVisible(), `${tag}: the hand button shows in sprite mode`);
    assert.equal(await hand.getAttribute("aria-pressed"), "false", `${tag}: touch mode starts off`);
    assert.equal(await hand.getAttribute("aria-keyshortcuts"), "T", `${tag}: the hand button names its key`);
    assert.equal((await snap(page)).active, false, `${tag}: not active`);
    if (device.phone) {
      const box = (await hand.boundingBox())!;
      assert.ok(box.x >= 0 && box.x + box.width <= 393 && box.width >= 44 && box.height >= 44, `${tag}: the hand button fits the phone screen and a finger (${box.x.toFixed(0)}+${box.width.toFixed(0)}x${box.height.toFixed(0)})`);
      // Five controls on the narrowest phones: no label is cut and no two buttons overlap.
      for (const width of [393, 360]) {
        await page.setViewportSize({ width, height: 851 });
        await page.waitForTimeout(150);
        const strip = await page.evaluate(() => {
          const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
          const buttons = [...theme.querySelectorAll<HTMLElement>("[data-vn-controls] > [data-vn-control]:not([hidden])")];
          return buttons.map((b) => {
            const r = b.getBoundingClientRect();
            const label = b.querySelector<HTMLElement>("[data-vn-control-label]");
            const shown = label && getComputedStyle(label).display !== "none";
            return { name: b.dataset.vnControl!, left: r.left, right: r.right, clipped: Boolean(shown && label!.scrollWidth > label!.clientWidth + 1), labelled: Boolean(shown) };
          });
        });
        assert.equal(strip.length, 5, `${tag} ${width}px: five controls`);
        for (const [i, b] of strip.entries()) {
          assert.equal(b.clipped, false, `${tag} ${width}px: the ${b.name} label is whole`);
          if (i > 0) assert.ok(b.left >= strip[i - 1]!.right - 0.5, `${tag} ${width}px: ${b.name} does not overlap ${strip[i - 1]!.name}`);
        }
        assert.equal(strip.find((b) => b.name === "touch")!.labelled, false, `${tag} ${width}px: the hand is an icon`);
      }
      await page.setViewportSize({ width: 393, height: 851 });
      await page.waitForTimeout(400);
    }

    // On: the stage asks once for the bonds and once per character for lines.
    await touchOn(page);
    assert.equal(await hand.getAttribute("aria-pressed"), "true", `${tag}: the hand button is pressed`);
    const asked = await backend(page);
    assert.deepEqual(asked.gets.map((keys) => [...keys].sort()), [["aoi", "mira"]], `${tag}: one ask for the saved bonds of who is on stage`);
    assert.deepEqual(asked.calls.map(([key, refresh]) => `${key}:${refresh}`).sort(), ["aoi:false", "mira:false"], `${tag}: one line-pack call per character`);
    const gauges = await hud(page);
    assert.ok(gauges.visible, `${tag}: the hearts show`);
    assert.deepEqual(gauges.gauges.map((g) => [g.key, g.value, g.role, g.tier]).sort(), [["aoi", 0, "meter", "Shy"], ["mira", 0, "meter", "Shy"]], `${tag}: a heart per character, empty`);
    assert.ok(gauges.rect!.left >= 0 && gauges.rect!.right <= (device.phone ? 393 : 1280), `${tag}: the hearts fit the screen`);
    await shot(page, `${tag}-touch-on`);

    // The hand follows a mouse: palm on the head, two hands on the cheeks, a finger elsewhere.
    const mira = await figure(page, "mira");
    if (!device.phone) {
      for (const [area, want] of [["head", "palm"], ["side", "palm"], ["cheeks", "hands"], ["body", "finger"]] as const) {
        const point = pointIn(mira, area);
        await page.mouse.move(point.x, point.y);
        await page.waitForTimeout(80);
        const s = await snap(page);
        assert.deepEqual([s.cursor.hand, s.cursor.visible], [want, true], `${tag}: the ${want} over the ${area}`);
      }
      const cursorStyle = await page.evaluate(() => getComputedStyle(document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!.querySelector("[data-vn-root]")!).cursor);
      assert.equal(cursorStyle, "none", `${tag}: the drawn hand replaces the pointer over a character`);
    }

    // Each zone of Mira (cat ears), then Aoi's hair.
    const pack = asked.pack;
    const zonesToTap: Array<[string, TouchArea, TouchZone, string]> = [
      ["mira", "head", "pat", "pat"], ["mira", "side", "ears", "stroke"], ["mira", "cheeks", "cheeks", "squish"], ["mira", "body", "poke", "poke"], ["aoi", "side", "hair", "stroke"],
    ];
    for (const [key, area, zone, motion] of zonesToTap) {
      const before = await paragraph(page);
      await record(page);
      await tap(page, pointIn(await figure(page, key), area), device.phone);
      const s = await snap(page);
      const label = `${tag} ${key} ${area}`;
      assert.ok(s.last, `${label}: a reaction`);
      assert.deepEqual([s.last!.characterKey, s.last!.area, s.last!.zone, s.last!.motion], [key, area, zone, motion], `${label}: the right zone and motion`);
      assert.ok(s.last!.line && packLines(pack, zone).includes(s.last!.line), `${label}: a line of the character's own pack (${s.last!.line})`);
      const view = await stageOf(page, key);
      const played = await recorded(page);
      assert.ok(played.includes(`${key}:${motion}`), `${label}: the figure moves (${played.join(", ")})`);
      assert.ok(played.includes(`hand:${motion}`), `${label}: the hand acts at the touch (${played.join(", ")})`);
      // The same emote again restarts on the next frame, which software WebGL can hold up.
      const emoteShown = await page.waitForFunction(([k, name]) => {
        const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
        const emote = theme.querySelector<HTMLElement>(`[data-vn-sprite][data-vn-sprite-key="${k}"] [data-vn-sprite-emote]:not([hidden])`);
        return Boolean(emote && getComputedStyle(emote).display !== "none" && emote.dataset.vnSpriteEmoteName === name);
      }, [key, s.last!.emote], { timeout: 1500 }).then(() => true, () => false);
      assert.ok(emoteShown, `${label}: the ${s.last!.emote} emote shows`);
      assert.equal(view.touch?.expression, s.last!.expression, `${label}: the expression changes for a moment`);
      assert.equal(view.bubble, s.last!.line, `${label}: the line is in the bubble`);
      assert.equal(view.spoken, `${key === "mira" ? "Mira" : "Aoi"}: ${s.last!.line}`, `${label}: a screen reader hears who says it`);
      assert.ok(view.bubbleRect.left >= -1 && view.bubbleRect.right <= (device.phone ? 394 : 1281) && view.bubbleRect.top >= 0, `${label}: the bubble stays on screen`);
      assert.equal(await paragraph(page), before, `${label}: touching never reads on`);
      await shot(page, `${tag}-${key}-${zone}`);
      await page.waitForTimeout(GAP);
    }

    // Escalation: the third pat in a row is content.
    const pats: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await tap(page, pointIn(await figure(page, "aoi"), "head"), device.phone);
      const last = (await snap(page)).last!;
      assert.deepEqual([last.characterKey, last.zone], ["aoi", "pat"], `${tag}: pat ${i + 1} lands on Aoi's head`);
      pats.push(last.mood);
      if (i < 2) await page.waitForTimeout(GAP);
    }
    assert.deepEqual(pats, ["shy", "shy", "content"], `${tag}: the third pat is content`);
    assert.equal((await snap(page)).last!.expression, "relieved", `${tag}: content looks relieved`);
    await shot(page, `${tag}-aoi-pat-content`);
    await page.waitForTimeout(GAP);

    // Too many cheek squishes: a pouty "hey!", then a sulk without a line.
    const squishes: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      // Aim at the cheeks as they are now (a reaction can show a picture of another size).
      await tap(page, pointIn(await figure(page, "mira"), "cheeks"), device.phone);
      const last = (await snap(page)).last!;
      assert.equal(last.zone, "cheeks", `${tag}: squish ${i + 1} lands on the cheeks`);
      squishes.push(last.mood);
      await page.waitForTimeout(GAP);
    }
    assert.deepEqual(squishes, ["shy", "shy", "content", "annoyed"], `${tag}: the fourth squish is too many`);
    // The annoyed reaction was the last one; check it before the sulk replaces it.
    await tap(page, pointIn(await figure(page, "mira"), "cheeks"), device.phone);
    const sulk = await snap(page);
    assert.deepEqual([sulk.last!.mood, sulk.last!.motion, sulk.last!.line], ["annoyed", "huff", null], `${tag}: a sulk huffs without a line`);
    await shot(page, `${tag}-mira-sulk`);

    // The hearts follow the bond; it is saved a moment later.
    const bonds = await snap(page);
    const aoiBond = bonds.characters.find((c) => c.characterKey === "aoi")!.bond;
    assert.ok(aoiBond > 0, `${tag}: Aoi's bond grew (${aoiBond})`);
    const shown = await hud(page);
    for (const character of bonds.characters) assert.equal(shown.gauges.find((g) => g.key === character.characterKey)!.value, character.bond, `${tag}: ${character.name}'s heart shows the bond`);
    await page.waitForTimeout(1400);
    const saved = (await backend(page)).saves;
    assert.ok(saved.some(([key, bond]) => key === "aoi" && bond === aoiBond), `${tag}: the bond is saved (${JSON.stringify(saved)})`);

    // Refresh asks for new lines (one call) and is disabled while it runs.
    await page.waitForTimeout(4200); // out of the sulk
    await page.evaluate(() => { (window as any).fx.touchBackend.delay = 700; });
    const refresh = page.locator('[data-vn-touch-refresh][data-vn-touch-key="mira"]');
    if (device.phone) await refresh.tap();
    else await refresh.click();
    const pending = await hud(page);
    assert.deepEqual(pending.gauges.find((g) => g.key === "mira")!.refresh, { lines: "pending", disabled: true, title: "Writing touch lines for Mira" }, `${tag}: Refresh waits for its call`);
    await page.waitForFunction(() => (window as any).fx.stage.getTouchSnapshot().characters.every((c: { lines: string }) => c.lines === "ready"));
    assert.deepEqual((await backend(page)).calls.filter(([, refresh]) => refresh), [["mira", true]], `${tag}: Refresh is one new call`);

    // A tap off the characters (and off the chrome) reads on.
    const before = await paragraph(page);
    const empty = await page.evaluate(() => {
      const fx = (window as any).fx;
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      for (const [fx_, fy] of [[0.5, 0.3], [0.04, 0.45], [0.96, 0.45], [0.5, 0.2], [0.04, 0.3], [0.96, 0.3]]) {
        const x = innerWidth * fx_, y = innerHeight * fy;
        if (fx.stage.spriteLayer.figuresAt(x, y).length > 0) continue;
        const under = theme.elementFromPoint(x, y);
        if (under?.closest("[data-vn-touch-hud], [data-vn-controls], [data-vn-narrative], [data-vn-interaction], [data-vn-status-stack]")) continue;
        return { x, y };
      }
      return null;
    });
    assert.ok(empty, `${tag}: there is somewhere off the characters to tap`);
    await tap(page, empty!, device.phone);
    await page.waitForTimeout(200);
    assert.equal(await paragraph(page), before + 1, `${tag}: a tap off the characters reads on`);

    // Escape leaves touch mode (saving), T comes back.
    await page.keyboard.press("Escape");
    assert.equal((await snap(page)).active, false, `${tag}: Escape leaves touch mode`);
    assert.equal(await hand.getAttribute("aria-pressed"), "false", `${tag}: the hand button is up`);
    await page.keyboard.press("t");
    assert.equal((await snap(page)).active, true, `${tag}: T turns touch mode on`);
    await page.keyboard.press("t");
    assert.equal((await snap(page)).active, false, `${tag}: T turns it off`);
    // The hand button by keyboard.
    await hand.focus();
    await page.keyboard.press("Enter");
    assert.equal((await snap(page)).active, true, `${tag}: Enter on the hand button`);
    await page.close();
  }

  // ---- Saved bonds unlock warmer lines -------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { puppet: "css" }, "Object.assign(window.fx.touchBackend.bonds, { mira: 75, aoi: 35 })");
    await touchOn(page);
    const shown = await hud(page);
    assert.deepEqual(shown.gauges.map((g) => [g.key, g.value, g.tier]).sort(), [["aoi", 35, "Warm"], ["mira", 75, "Fond"]], "saved bonds: the hearts start where they were");
    await tap(page, pointIn(await figure(page, "mira"), "head"), false);
    const s = await snap(page);
    assert.deepEqual([s.last!.mood, s.last!.line], ["fond", "Mm… don't stop."], "saved bonds: a fond character answers a first pat fondly");
    await page.waitForTimeout(GAP);
    await tap(page, pointIn(await figure(page, "aoi"), "body"), false);
    assert.equal((await snap(page)).last!.mood, "warm", "saved bonds: a warm character pokes back warmly");
    await shot(page, "desktop-bond-fond");
    await page.close();
  }

  // ---- Lines off: no call, the simple lines ---------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { puppet: "css" }, "window.fx.touch({ spriteTouchLines: false })");
    await touchOn(page, "none");
    await page.waitForTimeout(500);
    assert.deepEqual((await backend(page)).calls, [], "lines off: no line-pack call");
    assert.ok((await hud(page)).gauges.every((g) => g.refresh === null), "lines off: no Refresh");
    await tap(page, pointIn(await figure(page, "mira"), "head"), false);
    const line = (await snap(page)).last!.line;
    assert.ok(line && genericLines("pat").includes(line), `lines off: a simple line (${line})`);
    await page.close();
  }

  // ---- A failed line call keeps the simple lines ----------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { puppet: "css" }, "window.fx.touchBackend.failWith = 'The connection refused the call.'");
    await touchOn(page, "failed");
    const refresh = (await hud(page)).gauges.find((g) => g.key === "mira")!.refresh!;
    assert.equal(refresh.title, "The connection refused the call. Try again.", "failed lines: Refresh says why");
    await tap(page, pointIn(await figure(page, "mira"), "cheeks"), false);
    const line = (await snap(page)).last!.line;
    assert.ok(line && genericLines("cheeks").includes(line), `failed lines: a simple line (${line})`);
    await page.close();
  }

  // ---- Touch off in Settings, scene mode ------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { puppet: "css" });
    await page.evaluate(() => (window as any).fx.touch({ spriteTouch: false }));
    assert.equal(await button(page).isVisible(), false, "touch off: no hand button");
    await page.locator("[data-vn-root]").focus();
    await page.keyboard.press("t");
    assert.equal((await snap(page)).active, false, "touch off: T does nothing");
    const before = await paragraph(page);
    await page.evaluate(() => (window as any).fx.touch({ spriteTouch: true }));
    await touchOn(page);
    await page.evaluate(() => (window as any).fx.touch({ spriteTouch: false }));
    assert.equal((await snap(page)).active, false, "touch off: turning it off in Settings leaves touch mode");
    assert.equal(await paragraph(page), before, "touch off: nothing read on");
    await page.evaluate(() => { const fx = (window as any).fx; fx.touch({ spriteTouch: true }); fx.stage.setPresentationMode("scene"); });
    assert.equal(await button(page).isVisible(), false, "scene mode: no hand button");
    await page.close();
  }

  // ---- Gentle: smaller and without marks ------------------------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    watch(page);
    await open(page, { puppet: "css" }, "window.fx.touch({ spriteTouchIntensity: 'gentle' })");
    await touchOn(page);
    await record(page);
    await tap(page, pointIn(await figure(page, "mira"), "body"), false);
    const view = await stageOf(page, "mira");
    assert.ok((await recorded(page)).includes("mira:poke"), "gentle: the poke still moves");
    assert.equal(view.amp, "0.55", "gentle: a smaller motion");
    assert.equal(view.emote, null, "gentle: no mark over the head");
    assert.ok(view.bubble, "gentle: the line still shows");
    await page.waitForTimeout(GAP);
    await tap(page, pointIn(await figure(page, "mira"), "head"), false);
    assert.equal((await stageOf(page, "mira")).emote, "blush", "gentle: a shy pat still blushes");
    await page.close();
  }

  // ---- Motion Still and reduced motion keep everyone still -------------------------------
  for (const [name, query, reducedMotion] of [["motion-still", { puppet: "css", intensity: "off" }, "no-preference"], ["reduced-motion", { puppet: "css" }, "reduce"]] as const) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion });
    watch(page);
    await open(page, query);
    await touchOn(page);
    for (const area of ["head", "cheeks"] as const) {
      await tap(page, pointIn(await figure(page, "mira"), area), false);
      const view = await stageOf(page, "mira");
      assert.equal(view.still, true, `${name} ${area}: the hand is drawn still`);
      assert.equal(view.touchAnimations, 0, `${name} ${area}: the figure does not move`);
      assert.equal(view.cursorAnimations, "", `${name} ${area}: the hand does not move`);
      assert.ok(view.bubble, `${name} ${area}: the line still shows`);
      await page.waitForTimeout(GAP);
    }
    await shot(page, `desktop-${name}`);
    await page.close();
  }

  // ---- The waiting screen's line-up ------------------------------------------------------
  for (const device of [
    { tag: "desktop", phone: false, options: { viewport: { width: 1280, height: 720 } } },
    { tag: "phone", phone: true, options: { viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true } },
  ] as const) {
    const page = await browser.newPage(device.options);
    watch(page);
    await open(page, { puppet: "css" });
    await page.evaluate(() => (window as any).fx.stage.previewWaitingScreen());
    await page.waitForTimeout(900);
    await page.keyboard.press("t");
    await page.waitForFunction(() => {
      const s = (window as any).fx.stage.getTouchSnapshot();
      return s.active && s.characters.length > 0 && s.characters.every((c: { lines: string }) => c.lines === "ready");
    }, undefined, { timeout: 5000 });
    const lineup = await page.evaluate(() => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      const fx = (window as any).fx;
      const sets = fx.view().sets;
      return [...theme.querySelectorAll<HTMLElement>("[data-vn-waiting-figure]")].flatMap((button) => {
        const img = button.querySelector<HTMLImageElement>("[data-vn-figure-img][data-vn-front]");
        if (!img) return [];
        const src = new URL(img.src).pathname;
        for (const [key, set] of Object.entries(sets as Record<string, { expressions: Record<string, { url?: string }> }>)) {
          const image = Object.values(set.expressions).find((e) => e.url === src);
          if (image) {
            const r = img.getBoundingClientRect();
            return [{ key, image, rect: { left: r.left, top: r.top, width: r.width, height: r.height } }];
          }
        }
        return [];
      });
    });
    const keys = (await snap(page)).characters.map((c) => c.characterKey).sort();
    assert.deepEqual(keys, lineup.map((f) => f.key).sort(), `${device.tag} line-up: touch mode knows who stands there`);
    const miraFigure = lineup.find((f) => f.key === "mira");
    assert.ok(miraFigure, `${device.tag} line-up: Mira stands in it`);
    const geometry = spriteGeometry(miraFigure!.image as never);
    const fig: Figure = { key: "mira", rect: miraFigure!.rect, geometry, spot: spriteFaceSpot(miraFigure!.image as never, geometry), mirrored: false };
    await tap(page, pointIn(fig, "head"), device.phone);
    const s = await snap(page);
    assert.deepEqual([s.last?.characterKey, s.last?.zone], ["mira", "pat"], `${device.tag} line-up: a pat on Mira's head`);
    const state = await page.evaluate(() => {
      const theme = document.querySelector("[data-vn-stage-host]")!.shadowRoot!.querySelector("[data-vn-theme-host]")!.shadowRoot!;
      const waiting = theme.querySelector<HTMLElement>("[data-vn-waiting]");
      return { open: Boolean(waiting && !waiting.hidden && getComputedStyle(waiting).display !== "none"), touched: theme.querySelectorAll("[data-vn-figure-touch]").length };
    });
    assert.deepEqual(state, { open: true, touched: 1 }, `${device.tag} line-up: the figure reacts and the waiting screen stays`);
    await shot(page, `${device.tag}-waiting-lineup`);
    await page.close();
  }

  assert.deepEqual(errors, [], "no console errors");
  console.log(`sprite touch browser checks passed; ${shots.length} screenshots in ${OUT}/`);
} finally {
  await browser?.close();
  server.stop(true);
}
