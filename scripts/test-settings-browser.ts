import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { TEXT_EFFECT_CATALOGUE } from "../src/shared/text-effects.js";

const build = await Bun.build({ entrypoints: ["scripts/settings-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => new URL(request.url).pathname === "/fixture.js"
  ? new Response(bundle, { headers: { "Content-Type": "application/javascript" } })
  : new Response('<html><body style="margin:0"><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } }) });

type Fixture = { patches: Array<Record<string, unknown>>; config: Record<string, unknown>; previews: number; refreshes: number; scans: string[]; savedSystemOneKeys: string[]; clearedSystemOneKeys: number };
const fixture = (page: Page) => page.evaluate(() => {
  const { patches, config, previews, refreshes, scans, savedSystemOneKeys, clearedSystemOneKeys } = (window as any).settingsFixture;
  return { patches, config, previews, refreshes, scans, savedSystemOneKeys, clearedSystemOneKeys } as Fixture;
});
const lastPatch = async (page: Page) => (await fixture(page)).patches.at(-1);

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
