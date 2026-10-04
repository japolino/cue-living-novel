import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { TEXT_EFFECT_CATALOGUE } from "../src/shared/text-effects.js";

const build = await Bun.build({ entrypoints: ["scripts/settings-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
// Sprite thumbnails (small copies of the bake-off cut-outs and plates) are served same-origin.
const spriteFile = (pathname: string) => /^\/sprites\/[a-z_]+\.webp$/.test(pathname) ? Bun.file(`scripts/fixtures/sprite-library/${pathname.slice("/sprites/".length)}`) : null;
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => {
  const { pathname } = new URL(request.url);
  if (pathname === "/fixture.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
  const sprite = spriteFile(pathname);
  if (sprite) return new Response(sprite, { headers: { "Content-Type": "image/webp" } });
  return new Response('<html><body style="margin:0"><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
} });

type Fixture = { patches: Array<Record<string, unknown>>; config: Record<string, unknown>; previews: number; refreshes: number; scans: string[]; savedSystemOneKeys: string[]; clearedSystemOneKeys: number };
const fixture = (page: Page) => page.evaluate(() => {
  const { patches, config, previews, refreshes, scans, savedSystemOneKeys, clearedSystemOneKeys } = (window as any).settingsFixture;
  return { patches, config, previews, refreshes, scans, savedSystemOneKeys, clearedSystemOneKeys } as Fixture;
});
const lastPatch = async (page: Page) => (await fixture(page)).patches.at(-1);
type SpriteFixture = { spriteActions: Array<Record<string, unknown>>; libraryRequests: number; modelPrepares: number; modelClears: number };
const spriteFixture = (page: Page) => page.evaluate(() => {
  const { spriteActions, libraryRequests, modelPrepares, modelClears } = (window as any).settingsFixture;
  return { spriteActions, libraryRequests, modelPrepares, modelClears } as SpriteFixture;
});
const lastAction = async (page: Page) => (await spriteFixture(page)).spriteActions.at(-1);

let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: `http://127.0.0.1:${server.port}` });
  const page = await context.newPage();
  const external: string[] = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith(`http://127.0.0.1:${server.port}`)) external.push(request.url()); });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  const settings = page.locator("[data-vn-settings]");
  await settings.waitFor();
  await mkdir(".cache/ux-redesign", { recursive: true });
  const tab = (name: string) => settings.getByRole("tab", { name, exact: true });
  const openTab = (name: string) => tab(name).click();

  // Navigation: one tablist, seven sections, one visible pane, Reading first.
  const tabs = settings.getByRole("tab");
  assert.equal(await tabs.count(), 7, "seven sections");
  assert.deepEqual(await tabs.evaluateAll((items) => items.map((item) => item.querySelector("[data-tab-label]")!.textContent)), ["Reading", "Look", "Pictures", "Sound", "Voice", "Connections", "Advanced"]);
  assert.equal(await tab("Reading").getAttribute("aria-selected"), "true");
  assert.equal(await settings.getByRole("tabpanel").count(), 1, "exactly one section is shown");
  assert.equal(await settings.locator('[data-pane="reading"]').isVisible(), true);
  assert.equal(await settings.locator('[name="mode"]').isVisible(), true, "everyday reading controls show first");

  // First use: the guide is visible, uses listed connections, and saves choices immediately.
  const setup = settings.locator("[data-setup]");
  assert.equal(await setup.isVisible(), true, "setup guide shows on first use");
  assert.match(await setup.locator('[data-readiness="planner"] [data-readiness-title]').innerText(), /Studio text/);
  assert.match(await setup.locator('[data-readiness="planner"] [data-readiness-title]').innerText(), /not tested/);
  await setup.locator('input[name="setupImageSource"][value="card"]').check();
  assert.deepEqual(await lastPatch(page), { useNativeCardImages: true });
  assert.equal(await settings.locator('input[name="imageSource"][value="card"]').isChecked(), true, "section mirrors the setup choice");
  await setup.locator('input[name="setupImageSource"][value="generated"]').check();
  assert.deepEqual(await lastPatch(page), { useNativeCardImages: false, generateImages: true });
  assert.equal(await setup.locator("[data-setup-image-connection]").isVisible(), true, "image connection shows when generating");
  await setup.locator('select[name="setupParserConnectionId"]').selectOption("text-2");
  assert.deepEqual(await lastPatch(page), { parserConnectionId: "text-2" });
  assert.equal(await settings.locator('select[name="parserConnectionId"]').inputValue(), "text-2");
  assert.match(await setup.locator('[data-readiness="planner"] [data-readiness-title]').innerText(), /Local text/);
  await page.screenshot({ path: ".cache/ux-redesign/settings-setup-desktop.png" });
  await setup.getByRole("button", { name: "Done", exact: true }).click();
  assert.equal(await setup.isVisible(), false, "Done hides the guide");
  assert.equal((await fixture(page)).refreshes, 0, "nothing was called on the host during setup");

  // Everyday controls: each change is one partial patch, applied at once, status acknowledged.
  const patchesBefore = (await fixture(page)).patches.length;
  await settings.locator('input[name="textSpeedStep"][value="0"]').check();
  assert.deepEqual(await lastPatch(page), { textSpeed: 0 });
  assert.equal(await settings.locator("[data-status]").innerText(), "Saved");
  await openTab("Look");
  assert.equal(await settings.locator('[data-pane="look"] [data-sample]').isVisible(), true, "the live sample moves to Look");
  await settings.locator('input[name="themePreset"][value="paper-novel"]').check();
  assert.deepEqual(await lastPatch(page), { themePreset: "paper-novel" });
  const accent = await settings.locator("[data-sample-stage]").evaluate((element) => getComputedStyle(element).getPropertyValue("--sample-accent").trim());
  assert.equal(accent, "#8a2f23", "sample follows the chosen theme");
  await settings.locator('input[name="sceneImageFit"][value="contain"]').check();
  assert.deepEqual(await lastPatch(page), { sceneImageFit: "contain" });
  assert.equal(await settings.locator("[data-sample-picture]").evaluate((element) => getComputedStyle(element).objectFit), "contain");
  await settings.locator('input[name="textScaleStep"][value="1.2"]').check();
  assert.deepEqual(await lastPatch(page), { textScale: 1.2 });
  await settings.locator('input[name="effectIntensity"][value="gentle"]').check();
  assert.deepEqual(await lastPatch(page), { effectIntensity: "gentle" });
  await settings.locator('input[name="textEffects"][value="static"]').check();
  assert.deepEqual(await lastPatch(page), { textEffects: "static" }, "text effects mode is an everyday patch");
  assert.equal(await settings.locator("[data-text-fx-list]").getAttribute("data-vn-text-effects"), "static", "previews follow the text effects mode");
  assert.equal((await fixture(page)).patches.length, patchesBefore + 6, "one patch per everyday change");

  // Text effects reference: every catalogue entry, a copy button each, and the chat-model guide.
  const items = settings.locator("[data-text-fx-item]");
  assert.deepEqual(await items.evaluateAll((list) => list.map((item) => (item as HTMLElement).dataset.textFxItem)), TEXT_EFFECT_CATALOGUE.map((effect) => effect.id), "every catalogue entry has a reference card, in order");
  assert.equal(await settings.locator("[data-copy-example]").count(), TEXT_EFFECT_CATALOGUE.length);
  await items.filter({ hasText: "Rainbow" }).getByRole("button", { name: "Copy Rainbow example" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "<rainbow>Magic!</rainbow>", "copy puts the example markup on the clipboard");
  await settings.locator("[data-copy-guide]").click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /<shake> .*<fade>/s, "copy guide puts the author guide on the clipboard");
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }); });
  await settings.locator("[data-copy-guide]").click();
  const copyFallback = settings.locator("[data-copy-fallback] textarea");
  assert.equal(await copyFallback.isVisible(), true, "without clipboard access the text is shown for a manual copy");
  assert.match(await copyFallback.inputValue(), /Use them rarely/);
  for (const patch of (await fixture(page)).patches) {
    assert.equal("customCss" in patch || "imageParameters" in patch, false, "everyday saves never carry advanced keys");
  }

  // Budget: presets map to numbers; unlimited is only reachable through Custom.
  await openTab("Pictures");
  assert.equal(await settings.locator('input[name="budgetPreset"][value="balanced"]').isChecked(), true);
  await settings.locator('input[name="budgetPreset"][value="light"]').check();
  assert.deepEqual(await lastPatch(page), { maxImagesPerTurn: 1 });
  await settings.locator('input[name="budgetPreset"][value="custom"]').check();
  assert.equal(await settings.locator('[name="maxImagesPerTurn"]').isVisible(), true);
  await settings.locator('[name="maxImagesPerTurn"]').fill("0");
  await settings.locator('[name="maxImagesPerTurn"]').press("Tab");
  assert.deepEqual(await lastPatch(page), { maxImagesPerTurn: 0 });
  assert.match(await settings.locator("[data-budget-help]").innerText(), /No limit/);
  await settings.locator('input[name="imageSource"][value="text"]').check();
  assert.deepEqual(await lastPatch(page), { useNativeCardImages: false, generateImages: false });
  assert.equal(await settings.locator("[data-generated-only]").isVisible(), false, "budget hides when no pictures are generated");
  assert.equal(await settings.locator("[data-sample-picture]").isVisible(), false, "sample drops the picture for text only");
  await settings.locator('input[name="imageSource"][value="generated"]').check();

  // Reference source: the radio shows only while the reference toggle is on,
  // saves a single-field patch, and remembers its choice across the toggle.
  const referenceSource = settings.locator("[data-reference-source]");
  assert.equal(await referenceSource.isVisible(), true, "reference source shows while the toggle is on");
  assert.equal(await settings.locator('input[name="referenceSource"][value="captured"]').isChecked(), true, "captured is the default");
  await settings.locator('input[name="referenceSource"][value="card"]').check();
  assert.deepEqual(await lastPatch(page), { referenceSource: "card" });
  await settings.locator('input[name="referenceAnchoring"]').uncheck();
  assert.deepEqual(await lastPatch(page), { referenceAnchoring: false });
  assert.equal(await referenceSource.isVisible(), false, "reference source hides when the toggle is off");
  await settings.locator('input[name="referenceAnchoring"]').check();
  assert.equal(await referenceSource.isVisible(), true, "reference source returns with the toggle");
  assert.equal(await settings.locator('input[name="referenceSource"][value="card"]').isChecked(), true, "the saved choice survives the toggle");
  await settings.locator('input[name="referenceSource"][value="captured"]').check();
  assert.deepEqual(await lastPatch(page), { referenceSource: "captured" });


  // Sprite mode: the presentation choice sits in Pictures, with the image source it depends on.
  await mkdir(".cache/sprite-settings", { recursive: true });
  const presentation = settings.locator('[data-group-id="presentation"]');
  assert.equal(await presentation.isVisible(), true, "presentation mode shows while pictures are generated");
  assert.equal(await settings.locator('input[name="presentationMode"][value="scene"]').isChecked(), true, "scene pictures is the default");
  assert.equal(await settings.locator("[data-sprites-only]").isVisible(), false, "sprite controls hide in scene mode");
  // Image size also sets the scene picture size, so it shows in scene mode too.
  const sizeGroup = settings.locator('[data-group-id="sprite-size"]');
  assert.equal(await sizeGroup.isVisible(), true, "image size shows in scene mode");
  assert.match(await sizeGroup.innerText(), /Scenes and backgrounds 912×624/);
  await settings.locator('input[name="spriteImageSize"][value="upscaled"]').check();
  assert.deepEqual(await lastPatch(page), { spriteImageSize: "upscaled" }, "image size saves at once in scene mode");
  await settings.locator('input[name="spriteImageSize"][value="standard"]').check();
  assert.deepEqual(await lastPatch(page), { spriteImageSize: "standard" });
  const budgetGroup = settings.locator('[data-group][data-scene-only]').first();
  assert.equal(await budgetGroup.getAttribute("data-inactive"), null);
  const requestsBefore = (await spriteFixture(page)).libraryRequests;
  await settings.locator('input[name="presentationMode"][value="sprites"]').check();
  assert.deepEqual(await lastPatch(page), { presentationMode: "sprites" }, "presentation mode is an everyday patch");
  assert.equal(await settings.locator("[data-sprites-only]").isVisible(), true, "sprite controls appear with sprites");
  assert.equal(await sizeGroup.isVisible(), true, "image size stays in sprite mode");
  assert.equal(await budgetGroup.getAttribute("data-inactive"), "", "pictures per reply reads as not applying");
  assert.equal(await budgetGroup.locator("[data-scene-note]").isVisible(), true);
  assert.equal(await settings.locator('input[name="budgetPreset"][value="custom"]').isChecked(), true, "the budget keeps its value in sprite mode");
  assert.equal(await settings.locator('[name="maxImagesPerTurn"]').inputValue(), "0");
  assert.equal(await tab("Pictures").locator("[data-tab-summary]").innerText(), "Character sprites");
  assert.equal((await spriteFixture(page)).libraryRequests, requestsBefore + 1, "the library is requested when it is shown");
  const library = settings.locator("[data-sprite-library]");
  assert.equal(await library.locator("[data-library-summary]").innerText(), "Loading the library…");

  // Gallery from a fixture library: newest set first, collapsed, thumbnails lazy.
  await page.evaluate(() => { const f = (window as any).settingsFixture; f.panel.setSpriteLibrary(f.spriteLibrary.sets, f.spriteLibrary.plates); });
  assert.match(await library.locator("[data-library-summary]").innerText(), /^5 characters \(\d+\/\d+ sprites ready\) · 6 backgrounds · \d+ in progress · 2 failed$/);
  const sets = library.locator("details[data-sprite-set]");
  assert.deepEqual(await sets.evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.spriteSet)), ["set_mira", "set_sora", "set_ren", "set_elise", "set_yuki"], "newest set first");
  assert.equal(await library.locator("details[data-sprite-set][open]").count(), 0, "many sets start collapsed");
  assert.equal(await library.locator("[data-expression]").count(), 0, "expression tiles are built only when a set opens");
  assert.equal(await library.locator("img:not([loading=lazy])").count(), 0, "every thumbnail loads lazily");
  // Expressions per character: 4 by default, next to Image size; lists and counts follow the size.
  const countGroup = settings.locator('[data-group-id="sprite-expressions"]');
  assert.equal(await countGroup.isVisible(), true, "the set size shows in sprite mode");
  assert.match(await countGroup.innerText(), /Expressions per character[\s\S]*4 \(fastest\)[\s\S]*8[\s\S]*12 \(all\)/);
  assert.equal(await settings.locator('input[name="spriteExpressionCount"][value="4"]').isChecked(), true, "4 is the default");
  assert.match(await library.locator("[data-sets-note]").innerText(), /^4 expressions each/);
  assert.match(await library.locator('details[data-sprite-set="set_ren"] summary').innerText(), /2\/4 ready/, "progress of the 4 set");
  assert.match(await library.locator('details[data-sprite-set="set_elise"] summary').innerText(), /0\/4 ready/);
  await settings.locator('input[name="spriteExpressionCount"][value="12"]').check();
  assert.deepEqual(await lastPatch(page), { spriteExpressionCount: 12 }, "the set size is an everyday patch");
  assert.match(await library.locator("[data-sets-note]").innerText(), /^12 expressions each/);
  const mira = library.locator('details[data-sprite-set="set_mira"]');
  assert.match(await mira.locator("summary").innerText(), /Mira[\s\S]*navy sailor uniform[\s\S]*8\/12 ready[\s\S]*3 in progress[\s\S]*1 failed/);
  assert.match(await library.locator('details[data-sprite-set="set_ren"] summary').innerText(), /Usual outfit[\s\S]*2\/12 ready/);
  await mira.locator("summary").click();
  const tiles = mira.locator("[data-expression]");
  await tiles.first().waitFor();
  assert.equal(await tiles.count(), 13, "the hot set plus a requested rare expression");
  assert.deepEqual((await tiles.evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.expression))).slice(0, 3), ["idle", "smile", "laughing"], "hot set order first");
  assert.equal(await tiles.last().getAttribute("data-expression"), "playful_winking");
  assert.equal(await mira.locator('[data-expression="worried"]').getAttribute("data-sprite-status"), "generating");
  assert.equal(await mira.locator('[data-expression="scared"]').getAttribute("aria-pressed"), "true", "a failed expression is selected first");
  assert.match(await mira.locator("[data-inspector-error]").innerText(), /timed out/);
  assert.equal(await mira.locator("[data-sprite-recut]").isVisible(), true);
  await mira.locator("[data-sprite-regenerate]").click();
  assert.deepEqual(await lastAction(page), { action: "regenerate", setKey: "set_mira", expression: "scared" });
  assert.match(await library.locator("[data-library-note]").innerText(), /Regenerating Mira · Scared/);
  await mira.locator('[data-expression="worried"]').click();
  assert.equal(await mira.locator("[data-sprite-regenerate]").isDisabled(), true, "no regenerate while Cue is drawing it");
  assert.equal(await mira.locator("[data-sprite-recut]").isVisible(), false);
  // Keyboard: one tab stop per grid, arrows move the selection.
  await mira.locator('[data-expression="worried"]').focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await mira.locator('[data-expression="thinking"]').getAttribute("aria-pressed"), "true");
  assert.equal(await mira.locator('[data-expression="thinking"]').evaluate((element) => element === (element.getRootNode() as ShadowRoot).activeElement), true, "focus follows the selection");
  await page.keyboard.press("Home");
  assert.equal(await mira.locator('[data-expression="idle"]').getAttribute("aria-pressed"), "true");
  assert.deepEqual(await tiles.evaluateAll((items) => items.filter((item) => (item as HTMLElement).tabIndex === 0).length), 1, "roving tab stop");
  await mira.locator("[data-sprite-recut]").click();
  assert.deepEqual(await lastAction(page), { action: "recut", setKey: "set_mira", expression: "idle" });
  await page.screenshot({ path: ".cache/sprite-settings/library-desktop-dark.png", fullPage: false });

  // Live updates change tiles in place: focus stays, counts follow.
  await mira.locator('[data-expression="idle"]').focus();
  await page.evaluate(() => (window as any).settingsFixture.panel.applySpriteUpdate("set_mira", { expression: "worried", status: "ready", url: "/sprites/mira.webp", bbox: [0.13, 0.02, 0.75, 0.98], width: 832, height: 1216 }));
  assert.equal(await mira.locator('[data-expression="worried"]').getAttribute("data-sprite-status"), "ready");
  assert.equal(await mira.locator('[data-expression="worried"] img').getAttribute("loading"), "lazy");
  assert.match(await mira.locator("[data-set-count]").innerText(), /9\/12 ready/);
  assert.equal(await mira.locator('[data-expression="idle"]').evaluate((element) => element === (element.getRootNode() as ShadowRoot).activeElement), true, "a live update keeps focus");
  await page.evaluate(() => (window as any).settingsFixture.panel.applySpriteUpdate("set_mira", { expression: "idle", status: "failed", error: "Cut-out failed: model unavailable." }));
  assert.match(await mira.locator("[data-inspector-error]").innerText(), /model unavailable/, "the inspector follows updates to the selected expression");
  const unknownBefore = (await spriteFixture(page)).libraryRequests;
  await page.evaluate(() => (window as any).settingsFixture.panel.applySpriteUpdate("set_new", { expression: "idle", status: "queued" }));
  await page.waitForTimeout(750);
  assert.equal((await spriteFixture(page)).libraryRequests, unknownBefore + 1, "an update for an unknown set refreshes the library once");

  // Destructive actions need a confirming second click.
  const deleteSet = mira.locator("[data-sprite-delete-set]");
  const actionsBefore = (await spriteFixture(page)).spriteActions.length;
  await deleteSet.click();
  assert.equal(await deleteSet.innerText(), "Confirm delete Mira?");
  assert.equal((await spriteFixture(page)).spriteActions.length, actionsBefore, "the first click only asks");
  await deleteSet.click();
  assert.deepEqual(await lastAction(page), { action: "delete_set", setKey: "set_mira" });
  assert.equal(await deleteSet.innerText(), "Delete set");

  // Plates: status, errors, actions and live updates.
  const plates = library.locator("[data-plate]");
  assert.equal(await plates.count(), 6);
  const rooftop = library.locator('[data-plate="plate_rooftop"]');
  assert.match(await rooftop.innerText(), /School rooftop[\s\S]*sunset · windy[\s\S]*content filter/);
  await rooftop.locator("[data-plate-regenerate]").click();
  assert.deepEqual(await lastAction(page), { action: "regenerate_plate", plateKey: "plate_rooftop" });
  await rooftop.locator("[data-plate-delete]").click();
  assert.equal(await rooftop.locator("[data-plate-delete]").getAttribute("aria-label"), "Confirm delete?");
  await rooftop.locator("[data-plate-delete]").click();
  assert.deepEqual(await lastAction(page), { action: "delete_plate", plateKey: "plate_rooftop" });
  const bedroom = library.locator('[data-plate="plate_bedroom"]');
  assert.equal(await bedroom.locator("[data-plate-regenerate]").isDisabled(), true, "no regenerate while a plate is being made");
  assert.equal(await bedroom.locator("img").count(), 0);
  await page.evaluate(() => (window as any).settingsFixture.panel.applyPlateUpdate({ plateKey: "plate_bedroom", location: "Mira's bedroom", timeOfDay: "evening", weather: null, status: "ready", url: "/sprites/bedroom_evening.webp" }));
  assert.equal(await bedroom.getAttribute("data-sprite-status"), "ready");
  assert.equal(await bedroom.locator("img").getAttribute("loading"), "lazy");
  await page.evaluate(() => (window as any).settingsFixture.panel.applyPlateUpdate({ plateKey: "plate_beach", location: "Beach", timeOfDay: "noon", weather: null, status: "queued" }));
  assert.equal(await plates.count(), 7, "a new plate is added live");
  await library.locator("[data-sprite-prepare]").click();
  assert.deepEqual(await lastAction(page), { action: "prepare_chat" }, "the host adds the chat id");

  // Cut-out quality and the model state.
  const modelRow = settings.locator('[data-readiness="cutout"]');
  assert.equal(await settings.locator('input[name="spriteCutout"][value="best"]').isChecked(), true);
  assert.match(await modelRow.locator("[data-readiness-title]").innerText(), /not downloaded/);
  assert.match(await modelRow.locator("[data-readiness-action]").innerText(), /huggingface\.co/);
  await settings.locator('input[name="spriteCutout"][value="basic"]').check();
  assert.deepEqual(await lastPatch(page), { spriteCutout: "basic" }, "cut-out quality is an everyday patch");
  assert.equal(await modelRow.locator("[data-cutout-download]").isVisible(), false, "no download offered for Basic");
  await settings.locator('input[name="spriteCutout"][value="best"]').check();
  assert.deepEqual(await lastPatch(page), { spriteCutout: "best" });
  await modelRow.locator("[data-cutout-download]").click();
  assert.equal((await spriteFixture(page)).modelPrepares, 1);
  assert.match(await modelRow.locator("[data-readiness-title]").innerText(), /Downloading/);
  await page.evaluate(() => (window as any).settingsFixture.panel.setCutoutModelState({ state: "downloading", receivedBytes: 50 * 1024 * 1024, totalBytes: 176 * 1024 * 1024 }));
  assert.match(await modelRow.locator("[data-readiness-title]").innerText(), /28%/);
  assert.match(await modelRow.locator("[data-readiness-action]").innerText(), /50 MB of 176 MB/);
  assert.equal(Number(await modelRow.locator("[data-cutout-progress]").evaluate((element) => (element as HTMLProgressElement).value)).toFixed(2), "0.28");
  await page.evaluate(() => (window as any).settingsFixture.panel.setCutoutModelState({ state: "ready", backend: "webgpu", bytes: 176 * 1024 * 1024 }));
  assert.equal(await modelRow.locator("[data-readiness-title]").innerText(), "Model ready");
  assert.match(await modelRow.locator("[data-readiness-action]").innerText(), /176 MB stored in this browser.*WebGPU/);
  assert.equal(await modelRow.getAttribute("data-level"), "ready");
  const removeModel = modelRow.locator("[data-cutout-remove]");
  await removeModel.click();
  assert.equal(await removeModel.innerText(), "Confirm remove?");
  assert.equal((await spriteFixture(page)).modelClears, 0);
  await removeModel.click();
  assert.equal((await spriteFixture(page)).modelClears, 1);
  assert.match(await modelRow.locator("[data-readiness-title]").innerText(), /not downloaded/);
  await page.evaluate(() => (window as any).settingsFixture.panel.setCutoutModelState({ state: "error", error: "Download failed (HTTP 404)." }));
  assert.equal(await modelRow.locator("[data-cutout-download]").innerText(), "Try again");
  assert.match(await modelRow.locator("[data-readiness-action]").innerText(), /HTTP 404.*Basic cut-out/);
  await page.evaluate(() => (window as any).settingsFixture.panel.setCutoutModelState({ state: "unsupported", reason: "WebAssembly is turned off." }));
  assert.equal(await modelRow.locator("[data-actions]").isVisible(), false, "nothing to press when the browser cannot run the model");
  assert.equal(await modelRow.getAttribute("data-level"), "blocked");

  // Search finds the sprite settings.
  const spriteSearch = settings.locator("[data-settings-search]");
  await spriteSearch.fill("sprites");
  assert.equal((await settings.locator("[data-search-result]").first().innerText()).split("\n")[0], "Scene pictures or character sprites");
  await spriteSearch.fill("background removal");
  assert.match(await settings.locator("[data-search-results]").innerText(), /Cut-out quality/);
  await spriteSearch.fill("plates");
  assert.match(await settings.locator("[data-search-results]").innerText(), /Sprite library/);
  await spriteSearch.fill("expressions");
  assert.match(await settings.locator("[data-search-results]").innerText(), /Sprite library/);
  await spriteSearch.press("Escape");

  // Advanced: the model URL is a draft until Apply, and must be https.
  await openTab("Advanced");
  const modelUrl = settings.locator('[name="spriteModelUrl"]');
  assert.equal(await modelUrl.inputValue(), "https://huggingface.co/skytnt/anime-seg/resolve/main/isnetis.onnx");
  const urlPatches = (await fixture(page)).patches.length;
  await modelUrl.fill("http://example.com/isnetis.onnx");
  assert.equal(await settings.locator("[data-draft-bar]").isVisible(), true, "the model URL waits for Apply");
  assert.equal((await fixture(page)).patches.length, urlPatches);
  await openTab("Pictures");
  await settings.locator("[data-apply-bar]").click();
  assert.match(await settings.locator("[data-status]").innerText(), /https/);
  assert.equal(await tab("Advanced").getAttribute("aria-selected"), "true", "an invalid URL is revealed in Advanced");
  assert.equal((await fixture(page)).patches.length, urlPatches, "nothing is sent for an invalid URL");
  await modelUrl.fill("https://models.example.com/isnetis_int8.onnx");
  await settings.locator("[data-apply-bar]").click();
  assert.equal((await lastPatch(page))?.spriteModelUrl, "https://models.example.com/isnetis_int8.onnx");
  assert.equal("presentationMode" in (await lastPatch(page))!, false, "Apply never carries everyday sprite keys");
  assert.equal(await settings.locator("[data-draft-bar]").isVisible(), false);
  await modelUrl.fill("");
  await settings.locator("[data-apply-bar]").click();
  assert.equal((await lastPatch(page))?.spriteModelUrl, "https://huggingface.co/skytnt/anime-seg/resolve/main/isnetis.onnx", "empty restores the default");

  // Back to scene pictures: everything scene-only applies again, unchanged.
  await openTab("Pictures");
  await settings.locator('input[name="presentationMode"][value="scene"]').check();
  assert.deepEqual(await lastPatch(page), { presentationMode: "scene" });
  assert.equal(await settings.locator("[data-sprites-only]").isVisible(), false);
  assert.equal(await budgetGroup.getAttribute("data-inactive"), null);
  assert.equal(await budgetGroup.locator("[data-scene-note]").isVisible(), false);
  assert.equal(await settings.locator('[name="maxImagesPerTurn"]').inputValue(), "0", "the budget value survived the round trip");

  // Sound: empty state until the library reports files.
  await openTab("Sound");
  assert.equal(await settings.locator("[data-sound-empty]").isVisible(), true, "empty state before any scan");
  await settings.locator("[data-sound-empty] [data-scan-audio]").click();
  assert.equal(await settings.locator("[data-sound-ready]").isVisible(), true);
  assert.match(await settings.locator("[data-sound-counts]").innerText(), /3 music tracks and 12 sound effects/);
  await page.evaluate(() => (window as any).settingsFixture.panel.setAudioStatus("Scanned 0 BGM, 0 SFX."));
  assert.equal(await settings.locator("[data-sound-empty]").isVisible(), true, "text-only host reports still drive the empty state");

  // Advanced: hidden by default, drafts survive host updates and tab switches, Apply sends them, invalid JSON is revealed.
  for (const name of ["parserParameters", "imageParameters", "customCss", "ignoredTags", "debugLogging", "imageModel"]) {
    assert.equal(await settings.locator(`[name="${name}"]`).isVisible(), false, name + " should be advanced");
  }
  assert.equal(await settings.locator("[data-draft-bar]").isVisible(), false, "no unapplied-changes bar without drafts");
  await openTab("Connections");
  assert.equal(await settings.locator('[data-pane="connections"] [data-readiness]').count(), 1, "one readiness widget in Connections");
  await settings.locator('[name="systemOneMode"]').selectOption("compare");
  await settings.locator('[name="systemOneModel"]').fill("jev-latest");
  await settings.locator('[name="systemOneApiKey"]').fill("test-key-123");
  await settings.locator('[data-save-system-one-key]').click();
  assert.deepEqual((await fixture(page)).savedSystemOneKeys, ["test-key-123"]);
  assert.equal(await settings.locator('[name="systemOneApiKey"]').inputValue(), "");
  assert.equal(await tab("Connections").locator("[data-tab-badge]").innerText(), "1", "the nav counts unapplied changes per section");
  await tab("Advanced").focus(); await page.keyboard.press("Enter");
  await settings.locator('[name="imageParameters"]').fill('{"steps":32}');
  assert.match(await settings.locator("[data-status]").innerText(), /not applied/);
  assert.equal(await settings.locator("[data-draft-bar]").isVisible(), true, "the bar appears with unapplied changes");
  assert.match(await settings.locator("[data-draft-count]").innerText(), /^2 changes not applied/);
  assert.equal(await settings.locator('[name="imageParameters"]').locator("xpath=..").getAttribute("data-dirty"), "", "changed fields are marked");
  await openTab("Reading");
  await settings.locator('input[name="textSpeedStep"][value="10"]').check();
  assert.deepEqual(await lastPatch(page), { textSpeed: 10 });
  assert.equal(await settings.locator("[data-draft-bar]").isVisible(), true, "the bar follows the user to other sections");
  await openTab("Advanced");
  assert.equal(await settings.locator('[name="imageParameters"]').inputValue(), '{"steps":32}', "everyday save and a tab switch must not wipe an advanced draft");
  await page.evaluate(() => { const f = (window as any).settingsFixture; f.panel.setConfig({ ...f.config, customCss: "/* host */" }); });
  assert.equal(await settings.locator('[name="imageParameters"]').inputValue(), '{"steps":32}', "host echo keeps the draft");
  assert.equal(await settings.locator('[name="customCss"]').inputValue(), "/* host */", "host echo updates untouched advanced fields");
  await settings.locator("[data-apply]").click();
  const applied = await lastPatch(page);
  assert.deepEqual(applied?.imageParameters, { steps: 32 });
  assert.equal(applied?.systemOneMode, "compare");
  assert.equal(applied?.systemOneModel, "jev-latest");
  assert.equal("systemOneApiKey" in applied!, false);
  assert.equal(applied?.customCss, "/* host */", "apply carries current values, not stale ones");
  assert.equal(applied?.ignoredTags, "status, inventory", "hidden untouched values are preserved");
  assert.equal("themePreset" in applied!, false, "apply never touches everyday keys");
  assert.equal(await settings.locator("[data-status]").innerText(), "Advanced settings applied.");
  assert.equal(await settings.locator("[data-draft-bar]").isVisible(), false, "the bar leaves once applied");
  // Discard restores the last host values and sends nothing.
  const beforeDiscard = (await fixture(page)).patches.length;
  await settings.locator('[name="customCss"]').fill("/* draft */");
  await settings.locator('[name="debugLogging"]').check();
  assert.match(await settings.locator("[data-draft-count]").innerText(), /^2 changes/);
  await settings.locator("[data-discard]").click();
  assert.equal(await settings.locator('[name="customCss"]').inputValue(), "/* host */", "Discard restores text fields");
  assert.equal(await settings.locator('[name="debugLogging"]').isChecked(), false, "Discard restores checkboxes");
  assert.equal(await settings.locator("[data-draft-bar]").isVisible(), false);
  assert.equal((await fixture(page)).patches.length, beforeDiscard, "Discard sends nothing");
  // Invalid JSON: Apply from another section opens the field that failed.
  await settings.locator('[name="imageParameters"]').fill("invalid JSON");
  await openTab("Look");
  await settings.locator("[data-apply-bar]").click();
  assert.equal(await settings.locator('[name="imageParameters"]').isVisible(), true, "invalid hidden fields must be revealed");
  assert.equal(await tab("Advanced").getAttribute("aria-selected"), "true");
  assert.match(await settings.locator("[data-status]").innerText(), /Image parameters/);
  await settings.locator('[name="imageParameters"]').fill('{"steps":32}');
  await page.keyboard.press("Control+s");
  assert.equal(await settings.locator("[data-status]").innerText(), "Advanced settings applied.");

  // Reset keeps presets and the music folder, and needs confirmation.
  await page.evaluate(() => { const f = (window as any).settingsFixture; f.config = { ...f.config, promptPresets: [{ id: "p1", name: "Soft", positive: "soft", negative: "" }], audioDirectory: "packs" }; f.panel.setConfig(f.config); });
  await settings.locator("[data-reset]").click();
  assert.equal(await settings.locator("[data-reset]").innerText(), "Confirm reset?");
  await settings.locator("[data-reset]").click();
  const reset = await lastPatch(page);
  assert.equal(reset?.themePreset, "lumiverse");
  assert.deepEqual(reset?.promptPresets, [{ id: "p1", name: "Soft", positive: "soft", negative: "" }]);
  assert.equal(reset?.audioDirectory, "packs");
  assert.equal(await settings.locator("[data-show-setup]").isVisible(), true, "Show setup guide lives in Advanced");
  await settings.locator("[data-show-setup]").click();
  assert.equal(await setup.isVisible(), true, "the guide can be reopened");

  // Connection states: missing and error are actionable.
  await page.evaluate(() => { const f = (window as any).settingsFixture; f.config = { ...f.config, imageConnectionId: "gone" }; f.panel.setConfig(f.config); });
  await openTab("Pictures");
  assert.match(await settings.locator('[data-pane="pictures"] [data-readiness="image"] [data-readiness-title]').innerText(), /missing/i);
  assert.match(await settings.locator('[data-pane="pictures"] [data-readiness="image"] [data-readiness-action]').innerText(), /Pick another/);
  await openTab("Connections");
  await settings.locator('[data-goto="pictures"]').click();
  assert.equal(await tab("Pictures").getAttribute("aria-selected"), "true", "Connections links to the image connection in Pictures");
  assert.equal(await settings.locator('select[name="imageConnectionId"]').evaluate((element) => element === (element.getRootNode() as ShadowRoot).activeElement), true);
  await page.evaluate(() => (window as any).settingsFixture.panel.setConnectionCatalog("planner", { status: "error", options: [], error: "Host offline." }));
  const plannerRow = settings.locator('[data-setup] [data-readiness="planner"]');
  assert.match(await plannerRow.locator("[data-readiness-title]").innerText(), /Could not load/);
  await plannerRow.getByRole("button", { name: "Refresh", exact: true }).click();
  assert.equal((await fixture(page)).refreshes, 1);
  assert.match(await plannerRow.locator("[data-readiness-title]").innerText(), /Checking/);

  // Open preview is wired everywhere.
  await settings.locator("[data-topbar] [data-open-preview]").click();
  assert.equal((await fixture(page)).previews, 1);

  await page.screenshot({ path: ".cache/ux-redesign/settings-desktop.png" });
  assert.match(await settings.locator('select[name="imageConnectionId"] option[data-missing]').innerText(), /no longer exists \(gone\)/);

  // Keyboard: arrow keys move between tabs (roving tabindex), Home/End jump.
  await tab("Reading").click();
  await tab("Reading").focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await tab("Look").getAttribute("aria-selected"), "true", "ArrowDown selects the next section");
  assert.equal(await tab("Look").evaluate((element) => element === (element.getRootNode() as ShadowRoot).activeElement), true, "focus follows the selection");
  await page.keyboard.press("ArrowRight");
  assert.equal(await tab("Pictures").getAttribute("aria-selected"), "true");
  await page.keyboard.press("End");
  assert.equal(await tab("Advanced").getAttribute("aria-selected"), "true");
  await page.keyboard.press("ArrowDown");
  assert.equal(await tab("Reading").getAttribute("aria-selected"), "true", "arrows wrap around");
  await page.keyboard.press("ArrowUp");
  assert.equal(await tab("Advanced").getAttribute("aria-selected"), "true");
  await page.keyboard.press("Home");
  assert.equal(await tab("Reading").getAttribute("aria-selected"), "true");
  assert.deepEqual(await tabs.evaluateAll((items) => items.map((item) => (item as HTMLElement).tabIndex)), [0, -1, -1, -1, -1, -1, -1], "only the selected tab is in the tab order");
  assert.equal(await settings.getByRole("tabpanel").getAttribute("aria-labelledby"), "pane-reading-title");

  // Search: typing lists matching settings; Enter jumps to the first and focuses it.
  const search = settings.locator("[data-settings-search]");
  await search.fill("music vol");
  const results = settings.locator("[data-search-result]");
  assert.equal(await results.first().innerText().then((text) => text.split("\n")[0]), "Music volume");
  await search.press("Enter");
  assert.equal(await tab("Sound").getAttribute("aria-selected"), "true", "search opens the section of the result");
  assert.equal(await settings.locator('[name="bgmVolume"]').evaluate((element) => element === (element.getRootNode() as ShadowRoot).activeElement), true, "search focuses the setting");
  assert.equal(await settings.locator("[data-search-results]").isVisible(), false, "results close after a jump");
  await search.fill("css");
  await results.filter({ hasText: "Theme CSS" }).click();
  assert.equal(await settings.locator('[name="customCss"]').isVisible(), true, "results open Advanced settings too");
  await search.fill("narrator");
  assert.match(await results.first().innerText(), /Narrator voice/);
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await tab("Voice").getAttribute("aria-selected"), "true", "voice settings are searchable");
  await search.fill("zzzz-nothing");
  assert.match(await settings.locator("[data-search-empty]").innerText(), /No setting matches/);
  await search.press("Escape");
  assert.equal(await search.inputValue(), "", "Escape clears the search");

  // Voice: the speech section renders inside the Voice section.
  await openTab("Voice");
  assert.equal(await settings.locator('[data-pane="voice"] .vn-speech-settings').count(), 1, "speech settings mount inside Voice");
  assert.equal(await settings.locator("[data-voice-empty]").isVisible(), false);
  assert.equal(await page.locator(".vn-speech-settings").getByRole("button", { name: "Load profiles" }).isVisible(), true);

  // The last open section is remembered across a remount (same storage).
  await openTab("Connections");
  await page.evaluate(() => (window as any).settingsFixture.remount());
  assert.equal(await tab("Connections").getAttribute("aria-selected"), "true", "the panel reopens on the last section");
  assert.equal(await page.evaluate(() => (window as any).settingsFixture.storage.get("cue.visual-novel.settings-section")), "connections");
  await page.evaluate(() => { const f = (window as any).settingsFixture; f.storage.set("cue.visual-novel.settings-section", "nonsense"); f.remount(); });
  assert.equal(await tab("Reading").getAttribute("aria-selected"), "true", "an unknown remembered section falls back to Reading");
  await page.evaluate(() => (window as any).settingsFixture.panel.openSection("look"));
  assert.equal(await tab("Look").getAttribute("aria-selected"), "true", "openSection deep-links a section");

  // The guide mirrors the saved config instead of preselecting a default.
  await page.goto(`http://127.0.0.1:${server.port}/?card`);
  await setup.waitFor();
  assert.equal(await setup.locator('input[name="setupImageSource"][value="card"]').isChecked(), true, "guide reflects saved card choice");
  assert.equal(await setup.locator('input[name="setupThemePreset"][value="midnight-noir"]').isChecked(), true, "guide reflects saved theme");
  await setup.locator('input[name="setupThemePreset"][value="golden-hour"]').check();
  assert.deepEqual(await lastPatch(page), { themePreset: "golden-hour" });
  assert.equal(await settings.locator('input[name="themePreset"][value="golden-hour"]').isChecked(), true, "Look mirrors the guide");
  await page.goto(`http://127.0.0.1:${server.port}/?setupDone`);
  await settings.waitFor();
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 760 });
    for (const name of ["Reading", "Look", "Pictures", "Sound", "Voice", "Connections", "Advanced"]) {
      await openTab(name);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${name} fits ${width}px without horizontal scrolling`);
    }
  }
  assert.equal(await settings.locator("[data-tablist]").getAttribute("aria-orientation"), "horizontal", "narrow containers use a horizontal tab strip");
  const advancedBox = await tab("Advanced").boundingBox();
  assert.ok(advancedBox && advancedBox.x >= 0 && advancedBox.x + advancedBox.width <= 361, "the active tab is scrolled into view on the strip");
  await openTab("Look");
  const tile = settings.locator('input[name="themePreset"][value="paper-novel"]').locator("..");
  const box = await tile.boundingBox();
  assert.ok(box && box.height >= 44 && box.width >= 44, "theme tiles are large targets");
  const tabBox = await tab("Look").boundingBox();
  assert.ok(tabBox && tabBox.height >= 44, "tabs are large targets");
  await page.screenshot({ path: ".cache/ux-redesign/settings-mobile.png" });
  await openTab("Advanced");
  await settings.locator('[name="customCss"]').fill("/* mobile draft */");
  await openTab("Sound");
  const lastControl = await settings.locator('input[name="sfxVolume"]').evaluate((element) => { element.scrollIntoView({ block: "end" }); return element.getBoundingClientRect().bottom; });
  const draftBar = await settings.locator("[data-draft-bar]").boundingBox();
  assert.ok(draftBar && lastControl <= draftBar.y + 1, `controls scrolled into view sit above the unapplied-changes bar (${lastControl} vs ${draftBar?.y})`);
  await settings.locator("[data-discard]").click();
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(100);
  assert.equal(await settings.locator("[data-tablist]").getAttribute("aria-orientation"), "vertical", "wide containers use a vertical rail");


  // Sprite mode on narrow and wide screens, dark and light hosts: no horizontal overflow, readable gallery.
  for (const theme of ["dark", "light"] as const) {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto(`http://127.0.0.1:${server.port}/?setupDone&sprites${theme === "light" ? "&light" : ""}`);
    await settings.waitFor();
    await openTab("Pictures");
    await settings.locator("details[data-sprite-set]").first().waitFor();
    await settings.locator('details[data-sprite-set="set_mira"] summary').click();
    await settings.locator('[data-group-id="presentation"]').evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `.cache/sprite-settings/presentation-wide-${theme}.png` });
    await settings.locator('[data-group-id="cutout"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.cache/sprite-settings/pictures-wide-${theme}.png` });
    await settings.locator('details[data-sprite-set="set_mira"] [data-inspector]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.cache/sprite-settings/library-wide-${theme}.png` });
    await settings.locator("[data-plates]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.cache/sprite-settings/plates-wide-${theme}.png` });
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `sprite library fits ${width}px (${theme})`);
      const overflowing = await settings.locator("[data-sprite-library] *").evaluateAll((items, limit) => items.filter((item) => item.getBoundingClientRect().right > (limit as number) + 0.5 && item.getBoundingClientRect().width > 0).map((item) => item.tagName + "." + Array.from(item.attributes).map((a) => a.name).join(".")), width);
      assert.deepEqual(overflowing.filter((name) => !name.startsWith("IMG")), [], `nothing in the library sticks out at ${width}px`);
    }
    await settings.locator('[data-group-id="cutout"]').evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `.cache/sprite-settings/cutout-narrow-${theme}.png` });
    await settings.locator('details[data-sprite-set="set_mira"] [data-expressions]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.cache/sprite-settings/library-narrow-${theme}.png` });
    await settings.locator('details[data-sprite-set="set_mira"] [data-inspector]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.cache/sprite-settings/inspector-narrow-${theme}.png` });
    await settings.locator("[data-plates]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.cache/sprite-settings/plates-narrow-${theme}.png` });
    const tileBox = await settings.locator('details[data-sprite-set="set_mira"] [data-expression]').first().boundingBox();
    assert.ok(tileBox && tileBox.width >= 44 && tileBox.height >= 44, "expression tiles are large targets");
  }
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto(`http://127.0.0.1:${server.port}/?setupDone`);
  await settings.waitFor();

  // Reduced motion: sample shows the whole line at once.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTab("Reading");
  await settings.locator("[data-sample-replay]").click();
  assert.equal(await settings.locator("[data-sample-stage]").getAttribute("data-typing"), null);

  // NovelAI-only prompt controls live under Advanced and preserve saved opt-outs.
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.panel.setConnectionCatalog("image", { status: "ready", options: [{ id: "nai", name: "NovelAI", provider: "novelai", model: "nai-diffusion-4-5-full", isDefault: true }] });
    f.config = { ...f.config, imageConnectionId: "nai", generateImages: true, useNativeCardImages: false };
    f.panel.setConfig(f.config);
  });
  await openTab("Advanced");
  const quality = settings.locator('[name="novelAiQualityTags"]');
  assert.equal(await quality.isVisible(), true);
  await quality.uncheck();
  await settings.locator('[name="novelAiUseDefaultNegative"]').uncheck();
  await page.keyboard.press("Control+s");
  assert.equal((await lastPatch(page))?.novelAiQualityTags, false);
  assert.equal((await lastPatch(page))?.novelAiUseDefaultNegative, false);
  await page.screenshot({ path: ".cache/ux-redesign/settings-nai-controls.png" });
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.panel.setConnectionCatalog("image", { status: "ready", options: [{ id: "nai", name: "Other", provider: "comfyui", model: "m", isDefault: true }] });
  });
  assert.equal(await quality.isVisible(), false);
  assert.deepEqual(external, [], "settings page must not contact the network");
  console.log("settings browser checks passed");
} finally {
  await browser?.close();
  server.stop(true);
}
