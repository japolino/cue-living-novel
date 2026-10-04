import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

/**
 * Inline text effects in a real browser: real CSS (modes, reduced motion,
 * composition), the typewriter, line wrapping, history, light-theme
 * contrast, and the standalone reference card.
 * Run: bun run ./scripts/test-text-effects-browser.ts
 */
const build = await Bun.build({ entrypoints: ["scripts/text-effects-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => new URL(request.url).pathname === "/fixture.js" ? new Response(bundle, { headers: { "Content-Type": "application/javascript" } }) : new Response('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } }) });
const url = (query: Record<string, string>) => `http://127.0.0.1:${server.port}/?${new URLSearchParams(query)}`;
await mkdir(".cache/text-effects", { recursive: true });

/** Runs in the page: find the dialogue element through the shadow roots. */
const FIND = `(() => { const find = (root) => { for (const el of root.querySelectorAll("*")) { if (el.shadowRoot) { const hit = el.shadowRoot.querySelector("[data-vn-dialogue-text]"); if (hit) return hit; const deep = find(el.shadowRoot); if (deep) return deep; } } return null; }; return find(document); })()`;

type LetterInfo = { text: string; fx: string; anims: string[]; running: number; color: string; display: string };

async function letters(page: Page, scope = "[data-vn-dialogue-text]"): Promise<LetterInfo[]> {
  return page.evaluate(([find, sel]) => {
    const dialogue = eval(find) as HTMLElement;
    const root = sel === "[data-vn-dialogue-text]" ? dialogue : (dialogue.getRootNode() as ShadowRoot).querySelector(sel)!;
    return [...root.querySelectorAll<HTMLElement>("[data-vn-text-fx-ch]")].map((el) => {
      const anims = el.getAnimations() as CSSAnimation[];
      const style = getComputedStyle(el);
      return {
        text: el.textContent ?? "",
        fx: el.closest("[data-vn-text-fx]")!.getAttribute("data-vn-text-fx")!,
        anims: anims.map((a) => a.animationName),
        running: anims.filter((a) => a.playState === "running").length,
        color: style.color,
        display: style.display,
      };
    });
  }, [FIND, scope] as const);
}

/** Resolve any CSS colour to sRGB through a canvas. */
async function rgb(page: Page, colors: string[]): Promise<Array<[number, number, number]>> {
  return page.evaluate((list) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    return list.map((color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!] as [number, number, number];
    });
  }, colors);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const lum = ([r, g, b]: [number, number, number]) => {
    const f = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // ---- Animated: composition of nested effects ----------------------------
  await page.goto(url({}));
  await page.locator("[data-vn-dialogue-text] [data-vn-text-fx-ch]").first().waitFor();
  let info = await letters(page);
  assert.equal(info.map((l) => l.text).join(""), "STOP!lalalalightquiet".replace("lightquiet", ""), "only split effects get letters");
  const waveLetter = info.find((l) => l.fx === "wave")!;
  assert.ok(waveLetter.anims.includes("vn-tfx-wave") && waveLetter.anims.includes("vn-tfx-rainbow"), `nested rainbow + wave both run on one letter (${waveLetter.anims})`);
  assert.ok(waveLetter.running >= 2, "nested animations are running");
  assert.equal(waveLetter.display, "inline-block");
  const waveColors = new Set(info.filter((l) => l.fx === "wave").map((l) => l.color));
  assert.ok(waveColors.size >= 3, "rainbow letters differ in colour");
  await page.waitForTimeout(400);
  await page.screenshot({ path: ".cache/text-effects/animated.png" });

  // ---- Static: colour stays, nothing moves --------------------------------
  await page.evaluate(() => (window as any).fx.stage.setTextEffects("static"));
  await page.waitForTimeout(50);
  info = await letters(page);
  assert.ok(info.every((l) => l.running === 0), "static mode runs no letter animation");
  assert.ok(new Set(info.filter((l) => l.fx === "wave").map((l) => l.color)).size >= 3, "static rainbow keeps a frozen gradient");
  const glowStatic = await page.evaluate((find) => { const d = eval(find) as HTMLElement; const g = d.querySelector("[data-vn-text-fx=glow]")!; return { filter: getComputedStyle(g).filter, running: g.getAnimations().filter((a) => a.playState === "running").length }; }, FIND);
  assert.notEqual(glowStatic.filter, "none", "static glow keeps its light");
  assert.equal(glowStatic.running, 0, "static glow does not breathe");

  // ---- Off: plain text look ------------------------------------------------
  await page.evaluate(() => (window as any).fx.stage.setTextEffects("off"));
  await page.waitForTimeout(50);
  const off = await page.evaluate((find) => {
    const d = eval(find) as HTMLElement;
    const base = getComputedStyle(d);
    const spans = [...d.querySelectorAll<HTMLElement>("[data-vn-text-fx], [data-vn-text-fx-ch]")];
    return {
      sameColor: spans.every((s) => getComputedStyle(s).color === base.color),
      sameSize: spans.every((s) => getComputedStyle(s).fontSize === base.fontSize),
      inline: [...d.querySelectorAll<HTMLElement>("[data-vn-text-fx-ch]")].every((s) => getComputedStyle(s).display === "inline"),
      noFilter: spans.every((s) => getComputedStyle(s).filter === "none"),
      animations: spans.reduce((n, s) => n + s.getAnimations().length, 0),
    };
  }, FIND);
  assert.deepEqual(off, { sameColor: true, sameSize: true, inline: true, noFilter: true, animations: 0 }, "off mode looks like plain text");
  await page.screenshot({ path: ".cache/text-effects/off.png" });

  // ---- History: static, decorated ------------------------------------------
  await page.evaluate(() => { const s = (window as any).fx.stage; s.setTextEffects("animated"); s.openBacklog(); });
  await page.waitForTimeout(50);
  const history = await letters(page, "[data-vn-backlog-content]");
  assert.ok(history.length > 0, "history entries are decorated");
  assert.ok(history.every((l) => l.running === 0), "history never animates");
  assert.ok(new Set(history.filter((l) => l.fx === "wave").map((l) => l.color)).size >= 3, "history keeps rainbow colours");
  await page.evaluate(() => (window as any).fx.stage.closeBacklog());

  // ---- Reduced motion behaves as static ------------------------------------
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url({}));
  await page.locator("[data-vn-dialogue-text] [data-vn-text-fx-ch]").first().waitFor();
  info = await letters(page);
  assert.ok(info.every((l) => l.running === 0), "reduced motion runs no letter animation");
  assert.ok(new Set(info.filter((l) => l.fx === "wave").map((l) => l.color)).size >= 3, "reduced motion keeps rainbow colours");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // ---- Gentle effect intensity shrinks motion -----------------------------
  const amp = await page.evaluate((find) => { (window as any).fx.stage.setEffectIntensity("gentle"); const d = eval(find) as HTMLElement; return getComputedStyle(d.querySelector("[data-vn-text-fx=wave]")!).getPropertyValue("--vn-tfx-amp").trim(); }, FIND);
  assert.equal(amp, "0.55", "gentle intensity scales text motion");

  // ---- Typewriter: progressive letters, entrance on appearance --------------
  await page.goto(url({ speed: "40", text: "Hey <shout>STOP!</shout> <fade>ghost</fade> 👋 done" }));
  await page.locator("[data-vn-dialogue-text] [data-vn-text-fx-ch]").first().waitFor({ state: "attached" });
  await page.waitForTimeout(260);
  info = await letters(page);
  const filled = info.filter((l) => l.text).length;
  assert.ok(filled > 0 && filled < info.length, `letters appear progressively (${filled}/${info.length})`);
  const shoutIn = info.filter((l) => l.fx === "shout" && l.text);
  assert.ok(shoutIn.length > 0 && shoutIn.some((l) => l.anims.includes("vn-tfx-shout-in")), "a typed shout letter punches in");
  assert.ok(info.filter((l) => !l.text).every((l) => !l.anims.includes("vn-tfx-fade-in")), "an untyped letter holds its entrance");
  await page.waitForTimeout(1600);
  const typed = await page.evaluate((find) => (eval(find) as HTMLElement).textContent, FIND);
  assert.equal(typed, "Hey STOP! ghost 👋 done", "typing completes every character");

  // ---- Wrapping: words stay whole, quotes stay with the effect -------------
  await page.goto(url({ text: 'One two three "<shout>STOP!</shout>" and <wave>la-la lovely words</wave>, <rainbow>ever</rainbow>more.' }));
  await page.locator("[data-vn-dialogue-text] [data-vn-text-fx-ch]").first().waitFor();
  await page.waitForTimeout(500); // let the shout punch-in settle
  const wraps = await page.evaluate((find) => {
    const d = eval(find) as HTMLElement;
    const problems: string[] = [];
    for (let width = 70; width <= 420; width += 3) {
      d.style.width = `${width}px`;
      for (const word of d.querySelectorAll("[data-vn-text-fx-word]")) {
        // offsetTop is layout position, unaffected by the running transforms.
        const tops = [...word.querySelectorAll<HTMLElement>("[data-vn-text-fx-ch]")].map((l) => l.offsetTop);
        if (Math.max(...tops) - Math.min(...tops) > 6) problems.push(`w${width}: word "${word.textContent}" split`);
      }
      for (const glue of d.querySelectorAll("[data-vn-text-fx-glue]")) {
        const first = glue.firstChild!;
        if (first.nodeType === 3) {
          const q = document.createRange(); q.setStart(first, 0); q.setEnd(first, 1);
          const letter = glue.querySelector<HTMLElement>("[data-vn-text-fx-ch]")!.getBoundingClientRect();
          if (q.getBoundingClientRect().bottom <= letter.top + 4) problems.push(`w${width}: "${first.textContent}" left behind`);
        }
      }
    }
    d.style.width = "";
    return problems;
  }, FIND);
  assert.deepEqual(wraps, [], "no word or quote is split from its effect letters");

  // ---- Light preset contrast (static frame) ---------------------------------
  await page.goto(url({ preset: "paper-novel", tfx: "static", text: "<rainbow>Rainbow letters across a whole phrase</rainbow> <glow>glow</glow> <whisper>whisper</whisper>" }));
  await page.locator("[data-vn-dialogue-text] [data-vn-text-fx-ch]").first().waitFor();
  const paper = await page.evaluate((find) => {
    const d = eval(find) as HTMLElement;
    let bg = "";
    for (let el: Element | null = d; el && !bg; el = el.parentElement) { const c = getComputedStyle(el).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") bg = c; }
    return {
      bg,
      colors: [...d.querySelectorAll<HTMLElement>("[data-vn-text-fx=rainbow] [data-vn-text-fx-ch]")].map((l) => getComputedStyle(l).color),
      glow: getComputedStyle(d.querySelector("[data-vn-text-fx=glow]")!).color,
    };
  }, FIND);
  const [paperBg] = await rgb(page, [paper.bg || "#efe6d4"]);
  const sampled = await rgb(page, [...paper.colors, paper.glow]);
  const worst = Math.min(...sampled.map((c) => contrast(c, paperBg!)));
  assert.ok(worst >= 4.5, `paper-novel effect text meets AA contrast (worst ${worst.toFixed(2)} on ${paper.bg})`);

  // ---- Standalone reference card --------------------------------------------
  await page.goto(url({ view: "card" }));
  const card = await page.evaluate(() => {
    const root = document.getElementById("card")!.shadowRoot!;
    const wave = root.querySelector<HTMLElement>("[data-id=wave] [data-vn-text-fx-ch]")!;
    return {
      ids: [...root.querySelectorAll("p")].map((p) => p.querySelector("[data-vn-text-fx]")?.getAttribute("data-vn-text-fx")),
      waveAnims: (wave.getAnimations() as CSSAnimation[]).map((a) => a.animationName),
    };
  });
  assert.equal(card.ids.length, 11, "card shows every catalogue effect");
  assert.ok(card.ids.every(Boolean), "every card example renders an effect span");
  assert.ok(card.waveAnims.includes("vn-tfx-wave"), "the CSS works outside the stage root");
  await page.screenshot({ path: ".cache/text-effects/card.png" });

  assert.deepEqual(errors, [], "no page errors");
  console.log("text effects browser checks passed");
} finally {
  await browser?.close();
  server.stop(true);
}
