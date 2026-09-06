import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const build = await Bun.build({ entrypoints: ["scripts/settings-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => new URL(request.url).pathname === "/fixture.js"
  ? new Response(bundle, { headers: { "Content-Type": "application/javascript" } })
  : new Response('<html><body style="margin:0"><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } }) });

type Fixture = { patches: Array<Record<string, unknown>>; config: Record<string, unknown>; previews: number; refreshes: number; scans: string[] };
const fixture = (page: Page) => page.evaluate(() => {
  const { patches, config, previews, refreshes, scans } = (window as any).settingsFixture;
  return { patches, config, previews, refreshes, scans } as Fixture;
});
const lastPatch = async (page: Page) => (await fixture(page)).patches.at(-1);

let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const external: string[] = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith(`http://127.0.0.1:${server.port}`)) external.push(request.url()); });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  const settings = page.locator("[data-vn-settings]");
  await settings.waitFor();
  await mkdir(".cache/ux-redesign", { recursive: true });

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
  await settings.getByRole("heading", { name: "Appearance", exact: true }).click();
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
  assert.equal((await fixture(page)).patches.length, patchesBefore + 5, "one patch per everyday change");
  for (const patch of (await fixture(page)).patches) {
    assert.equal("customCss" in patch || "imageParameters" in patch, false, "everyday saves never carry advanced keys");
  }

  // Budget: presets map to numbers; unlimited is only reachable through Custom.
  await settings.getByRole("heading", { name: "Images", exact: true }).click();
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

  // Sound: empty state until the library reports files.
  await settings.getByRole("heading", { name: "Sound", exact: true }).click();
  assert.equal(await settings.locator("[data-sound-empty]").isVisible(), true, "empty state before any scan");
  await settings.locator("[data-sound-empty] [data-scan-audio]").click();
  assert.equal(await settings.locator("[data-sound-ready]").isVisible(), true);
  assert.match(await settings.locator("[data-sound-counts]").innerText(), /3 music tracks and 12 sound effects/);
  await page.evaluate(() => (window as any).settingsFixture.panel.setAudioStatus("Scanned 0 BGM, 0 SFX."));
  assert.equal(await settings.locator("[data-sound-empty]").isVisible(), true, "text-only host reports still drive the empty state");

  // Advanced: hidden by default, drafts survive host updates, Apply sends them, invalid JSON is revealed.
  for (const name of ["parserParameters", "imageParameters", "customCss", "ignoredTags", "debugLogging", "imageModel"]) {
    assert.equal(await settings.locator(`[name="${name}"]`).isVisible(), false, name + " should be advanced");
  }
  const advanced = settings.locator("[data-advanced-settings] > summary");
  await advanced.focus(); await advanced.press("Enter");
  await settings.getByRole("heading", { name: "Connections and models", exact: true }).click();
  await settings.locator('[name="imageParameters"]').fill('{"steps":32}');
  assert.match(await settings.locator("[data-status]").innerText(), /not applied/);
  await settings.locator('input[name="textSpeedStep"][value="10"]').check();
  assert.deepEqual(await lastPatch(page), { textSpeed: 10 });
  assert.equal(await settings.locator('[name="imageParameters"]').inputValue(), '{"steps":32}', "everyday save must not wipe an advanced draft");
  await page.evaluate(() => { const f = (window as any).settingsFixture; f.panel.setConfig({ ...f.config, customCss: "/* host */" }); });
  assert.equal(await settings.locator('[name="imageParameters"]').inputValue(), '{"steps":32}', "host echo keeps the draft");
  assert.equal(await settings.locator('[name="customCss"]').inputValue(), "/* host */", "host echo updates untouched advanced fields");
  await settings.locator("[data-apply]").click();
  const applied = await lastPatch(page);
  assert.deepEqual(applied?.imageParameters, { steps: 32 });
  assert.equal(applied?.customCss, "/* host */", "apply carries current values, not stale ones");
  assert.equal(applied?.ignoredTags, "status, inventory", "hidden untouched values are preserved");
  assert.equal("themePreset" in applied!, false, "apply never touches everyday keys");
  assert.equal(await settings.locator("[data-status]").innerText(), "Advanced settings applied.");
  await settings.locator('[name="imageParameters"]').fill("invalid JSON");
  await advanced.click();
  await settings.locator("[data-apply-bar]").click();
  assert.equal(await settings.locator('[name="imageParameters"]').isVisible(), true, "invalid hidden fields must be revealed");
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
  assert.equal(await settings.locator("[data-show-setup]").isVisible(), true);
  await settings.locator("[data-show-setup]").click();
  assert.equal(await setup.isVisible(), true, "the guide can be reopened");

  // Connection states: missing and error are actionable.
  await page.evaluate(() => { const f = (window as any).settingsFixture; f.config = { ...f.config, imageConnectionId: "gone" }; f.panel.setConfig(f.config); });
  assert.match(await settings.locator('[data-section="images"] [data-readiness="image"] [data-readiness-title]').innerText(), /missing/i);
  assert.match(await settings.locator('[data-section="images"] [data-readiness="image"] [data-readiness-action]').innerText(), /Pick another/);
  await page.evaluate(() => (window as any).settingsFixture.panel.setConnectionCatalog("planner", { status: "error", options: [], error: "Host offline." }));
  const plannerRow = settings.locator('[data-setup] [data-readiness="planner"]');
  assert.match(await plannerRow.locator("[data-readiness-title]").innerText(), /Could not load/);
  await plannerRow.getByRole("button", { name: "Refresh", exact: true }).click();
  assert.equal((await fixture(page)).refreshes, 1);
  assert.match(await plannerRow.locator("[data-readiness-title]").innerText(), /Checking/);

  // Open preview is wired everywhere.
  await settings.locator("[data-actionbar] [data-open-preview]").click();
  assert.equal((await fixture(page)).previews, 1);

  await page.screenshot({ path: ".cache/ux-redesign/settings-desktop.png" });
  assert.match(await settings.locator('select[name="imageConnectionId"] option[data-missing]').innerText(), /no longer exists \(gone\)/);

  // The guide mirrors the saved config instead of preselecting a default.
  await page.goto(`http://127.0.0.1:${server.port}/?card`);
  await setup.waitFor();
  assert.equal(await setup.locator('input[name="setupImageSource"][value="card"]').isChecked(), true, "guide reflects saved card choice");
  assert.equal(await setup.locator('input[name="setupThemePreset"][value="midnight-noir"]').isChecked(), true, "guide reflects saved theme");
  await setup.locator('input[name="setupThemePreset"][value="golden-hour"]').check();
  assert.deepEqual(await lastPatch(page), { themePreset: "golden-hour" });
  assert.equal(await settings.locator('input[name="themePreset"][value="golden-hour"]').isChecked(), true, "Appearance mirrors the guide");
  await page.goto(`http://127.0.0.1:${server.port}/?setupDone`);
  await settings.waitFor();
  await page.setViewportSize({ width: 360, height: 640 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "settings fit 360px");
  await settings.getByRole("heading", { name: "Appearance", exact: true }).click();
  const tile = settings.locator('input[name="themePreset"][value="paper-novel"]').locator("..");
  const box = await tile.boundingBox();
  assert.ok(box && box.height >= 44 && box.width >= 44, "theme tiles are large targets");
  const chevrons = await page.evaluate(() => {
    const root = document.querySelector("[data-vn-settings]")!.shadowRoot!;
    return Array.from(root.querySelectorAll<HTMLDetailsElement>("details[data-section]")).map((details) => ({ open: details.open, transform: getComputedStyle(details.querySelector("summary")!, "::before").transform }));
  });
  for (const { open, transform } of chevrons) {
    // rotate(45deg) => matrix(0.707, 0.707, -0.707, 0.707, 0, 0); rotate(-45deg) flips the second value.
    assert.equal(transform.startsWith(open ? "matrix(0.707107, 0.707107" : "matrix(0.707107, -0.707107"), true, `chevron reflects open=${open}: ${transform}`);
  }
  await page.screenshot({ path: ".cache/ux-redesign/settings-mobile.png" });
  await settings.getByRole("heading", { name: "Sound", exact: true }).click();
  const lastControl = await settings.locator('input[name="sfxVolume"]').evaluate((element) => { element.scrollIntoView({ block: "end" }); return element.getBoundingClientRect().bottom; });
  const footer = await settings.locator("[data-actionbar]").boundingBox();
  assert.ok(footer && lastControl <= footer.y + 1, `controls scrolled into view sit above the footer (${lastControl} vs ${footer?.y})`);

  // Reduced motion: sample shows the whole line at once.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await settings.locator("[data-sample-replay]").click();
  assert.equal(await settings.locator("[data-sample-stage]").getAttribute("data-typing"), null);

  assert.deepEqual(external, [], "settings page must not contact the network");
  console.log("settings browser checks passed");
} finally {
  await browser?.close();
  server.stop(true);
}
