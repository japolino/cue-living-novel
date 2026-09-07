import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { VisualNovelSettingsPanel } from "../src/frontend/settings/panel.js";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../src/config.js";

// Bundle the test fixture
const build = await Bun.build({
  entrypoints: ["scripts/settings-browser-fixture.ts"],
  target: "browser",
});
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/fixture.js") {
      return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
    }
    return new Response(
      '<!DOCTYPE html><html><body style="margin:0"><script type="module" src="/fixture.js"></script></body></html>',
      { headers: { "Content-Type": "text/html" } }
    );
  },
});

type Fixture = {
  patches: Array<Partial<VisualNovelConfig>>;
  config: VisualNovelConfig;
  previews: number;
  refreshes: number;
  scans: string[];
  panel: VisualNovelSettingsPanel | null;
};

const fixture = (page: Page) =>
  page.evaluate(() => {
    const { patches, config, previews, refreshes, scans } = (window as any).settingsFixture;
    return { patches, config, previews, refreshes, scans } as Fixture;
  });

const lastPatch = async (page: Page) => (await fixture(page)).patches.at(-1);

let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
  const externalRequests: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (/^https?:/.test(url) && !url.startsWith(`http://127.0.0.1:${server.port}`)) {
      externalRequests.push(url);
    }
  });

  await page.goto(`http://127.0.0.1:${server.port}/?setupDone=1`);
  const settings = page.locator("[data-vn-settings]");
  await settings.waitFor();
  await mkdir(".cache/novelai-controls", { recursive: true });

  // Open the Images section
  await settings.getByRole("heading", { name: "Images", exact: true }).click();
  const naiControls = settings.locator("[data-novelai-controls]");

  // --- Test 1: Stability connection active, NovelAI not selected -> Hidden ---
  assert.equal(await naiControls.isVisible(), false, "NovelAI controls hidden for default Stability connection");

  // --- Test 2: First-list connection is NovelAI, but NO default connection -> Hidden ---
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.panel.setConnectionCatalog("image", {
      status: "ready",
      options: [
        { id: "nai-first", name: "NovelAI V4.5", provider: "novelai", model: "nai-diffusion-4-5-full", isDefault: false },
        { id: "stab-other", name: "Stability", provider: "stability", model: "sd3", isDefault: false },
      ],
    });
    f.config = { ...f.config, imageConnectionId: null };
    f.panel.setConfig(f.config);
  });
  assert.equal(
    await naiControls.isVisible(),
    false,
    "First-list NovelAI connection without isDefault MUST remain hidden when Lumiverse default is selected"
  );

  // --- Test 3: Catalog has NovelAI earlier, but Stability is isDefault -> Hidden ---
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.panel.setConnectionCatalog("image", {
      status: "ready",
      options: [
        { id: "nai-first", name: "NovelAI V4.5", provider: "novelai", model: "nai-diffusion-4-5-full", isDefault: false },
        { id: "stab-default", name: "Stability Default", provider: "stability", model: "sd3", isDefault: true },
      ],
    });
    f.config = { ...f.config, imageConnectionId: null };
    f.panel.setConfig(f.config);
  });
  assert.equal(
    await naiControls.isVisible(),
    false,
    "Default non-NovelAI with earlier NovelAI in list MUST remain hidden"
  );

  // --- Test 4: Explicit selection of NovelAI connection -> Shows ---
  await settings.locator('select[name="imageConnectionId"]').selectOption("nai-first");
  assert.equal(await naiControls.isVisible(), true, "Explicit NovelAI selection reveals controls");
  assert.equal(
    (await lastPatch(page))?.imageConnectionId,
    "nai-first",
    "Selecting connection patches imageConnectionId"
  );

  // --- Test 5: Default connection IS NovelAI -> Shows when Lumiverse default selected ---
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.panel.setConnectionCatalog("image", {
      status: "ready",
      options: [
        { id: "stab-other", name: "Stability", provider: "stability", model: "sd3", isDefault: false },
        { id: "nai-default", name: "NovelAI Default", provider: "novelai", model: "nai-diffusion-4-5-full", isDefault: true },
      ],
    });
    f.config = { ...f.config, imageConnectionId: null };
    f.panel.setConfig(f.config);
  });
  assert.equal(
    await naiControls.isVisible(),
    true,
    "NovelAI with isDefault: true reveals controls when Lumiverse default is active"
  );

  // --- Test 6: Cost notice and official documentation link ---
  const noticeText = await settings.locator("[data-novelai-cost-notice]").innerText();
  assert.match(noticeText, /These sizes fit the Opus size limit/);
  assert.match(noticeText, /Free generation also depends on your plan/);
  assert.match(noticeText, /28 steps or fewer/);
  assert.match(noticeText, /Reference images or custom settings may cost Anlas/);

  const docLink = settings.locator("[data-novelai-cost-notice] a");
  assert.equal(await docLink.getAttribute("href"), "https://docs.novelai.net/en/subscription/");
  assert.equal(await docLink.getAttribute("target"), "_blank");

  // --- Test 7: Everyday controls: Steps, Guidance, Sampler, Resolution Presets & Custom Dimensions ---
  // Steps
  const stepsInput = settings.locator('input[name="novelAiSteps"]');
  await stepsInput.fill("30");
  await stepsInput.press("Tab");
  let patch = await lastPatch(page);
  assert.equal(
    (patch?.imageParameters as any)?.steps,
    30,
    "Changing steps updates imageParameters.steps"
  );
  assert.equal(await settings.locator("[data-status]").innerText(), "Saved");

  // Guidance (CFG scale)
  const guidanceInput = settings.locator('input[name="novelAiGuidance"]');
  await guidanceInput.fill("6.5");
  await guidanceInput.press("Tab");
  patch = await lastPatch(page);
  assert.equal(
    (patch?.imageParameters as any)?.guidance,
    6.5,
    "Changing guidance updates imageParameters.guidance"
  );

  // Sampler
  const samplerSelect = settings.locator('select[name="novelAiSampler"]');
  await samplerSelect.selectOption("k_dpmpp_2m");
  patch = await lastPatch(page);
  assert.equal(
    (patch?.imageParameters as any)?.sampler,
    "k_dpmpp_2m",
    "Selecting sampler updates imageParameters.sampler"
  );

  // Resolution presets: Portrait (832x1216)
  await settings.locator('input[name="novelAiResolutionPreset"][value="portrait"]').check();
  patch = await lastPatch(page);
  assert.equal(
    (patch?.imageParameters as any)?.resolution,
    "832x1216",
    "Portrait preset sets 832x1216"
  );

  // Resolution presets: Square (1024x1024)
  await settings.locator('input[name="novelAiResolutionPreset"][value="square"]').check();
  patch = await lastPatch(page);
  assert.equal(
    (patch?.imageParameters as any)?.resolution,
    "1024x1024",
    "Square preset sets 1024x1024"
  );

  // Resolution presets: Landscape (1216x832)
  await settings.locator('input[name="novelAiResolutionPreset"][value="landscape"]').check();
  patch = await lastPatch(page);
  assert.equal(
    (patch?.imageParameters as any)?.resolution,
    "1216x832",
    "Landscape preset sets 1216x832"
  );

  // Resolution presets: Custom reveals width & height, snapping to 64 multiples
  await settings.locator('input[name="novelAiResolutionPreset"][value="custom"]').check();
  const customDimensions = settings.locator('[data-custom="novelAiDimensions"]');
  assert.equal(await customDimensions.isVisible(), true, "Custom preset reveals width and height");
  
  // Enter 1400 (not a multiple of 64) -> snaps to 1408 (22 * 64)
  await settings.locator('input[name="novelAiWidth"]').fill("1400");
  // Enter 900 (not a multiple of 64) -> snaps to 896 (14 * 64)
  await settings.locator('input[name="novelAiHeight"]').fill("900");
  await settings.locator('input[name="novelAiHeight"]').press("Tab");
  patch = await lastPatch(page);
  assert.equal(
    (patch?.imageParameters as any)?.resolution,
    "1408x896",
    "Custom dimensions respect multiple of 64"
  );
  assert.equal(await settings.locator('input[name="novelAiWidth"]').inputValue(), "1408");
  assert.equal(await settings.locator('input[name="novelAiHeight"]').inputValue(), "896");

  // --- Test 8: Preservation of unrelated custom imageParameters & No Silent Clamping ---
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.config = {
      ...f.config,
      imageParameters: {
        steps: 28,
        guidance: 5,
        sampler: "k_euler_ancestral",
        resolution: "1344x768", // Custom existing resolution
        seed: 424242,
        referenceStrength: 0.75,
        smea: true,
        extraCustomProperty: "keepMeSafe",
      },
    };
    f.panel.setConfig(f.config);
  });
  // Change steps to 25 (unrelated control change)
  await stepsInput.fill("25");
  await stepsInput.press("Tab");
  patch = await lastPatch(page);
  const updatedParams = patch?.imageParameters as any;
  assert.equal(updatedParams?.steps, 25);
  assert.equal(updatedParams?.resolution, "1344x768", "unrelated steps change does NOT silently clamp or alter custom resolution");
  assert.equal(updatedParams?.seed, 424242, "unrelated seed preserved");
  assert.equal(updatedParams?.referenceStrength, 0.75, "unrelated referenceStrength preserved");
  assert.equal(updatedParams?.smea, true, "unrelated smea preserved");
  assert.equal(updatedParams?.extraCustomProperty, "keepMeSafe", "arbitrary custom keys preserved");

  // --- Test 9: Preservation of unsupported / custom sampler ---
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.config = {
      ...f.config,
      imageParameters: {
        sampler: "experimental_euler_v3",
      },
    };
    f.panel.setConfig(f.config);
  });
  assert.equal(
    await samplerSelect.inputValue(),
    "experimental_euler_v3",
    "Custom sampler is selected"
  );
  // Changing steps must not overwrite the custom sampler
  await stepsInput.fill("26");
  await stepsInput.press("Tab");
  patch = await lastPatch(page);
  assert.equal(
    (patch?.imageParameters as any)?.sampler,
    "experimental_euler_v3",
    "Custom sampler not overwritten when changing other parameters"
  );

  // --- Test 10: Advanced JSON draft safety: valid draft seed remains unapplied; invalid draft retained ---
  const advanced = settings.locator("[data-advanced-settings] > summary");
  await advanced.click();
  await settings.getByRole("heading", { name: "Connections and models", exact: true }).click();
  const jsonTextarea = settings.locator('[name="imageParameters"]');

  // Subtest 10A: Valid draft with seed change must NOT be silently saved by everyday NovelAI controls
  await jsonTextarea.fill('{"steps": 28, "seed": 777888}');
  assert.match(await settings.locator("[data-status]").innerText(), /not applied/);
  assert.equal(await settings.locator("[data-apply-bar]").isVisible(), true);

  // User changes everyday control: novelAiSteps to 22
  await stepsInput.fill("22");
  await stepsInput.press("Tab");
  patch = await lastPatch(page);

  // Acknowledged patch submitted to host MUST NOT contain the unapplied seed draft!
  assert.equal((patch?.imageParameters as any)?.steps, 22, "everyday steps saved");
  assert.equal("seed" in (patch?.imageParameters as any), false, "unapplied seed draft MUST NOT be submitted by everyday controls");

  // In the Advanced editor, draft is rebased (steps: 22) and seed is retained, still marked dirty
  const rebasedEditorDraft = JSON.parse(await jsonTextarea.inputValue());
  assert.equal(rebasedEditorDraft.seed, 777888, "unapplied seed preserved in editor draft");
  assert.equal(rebasedEditorDraft.steps, 22, "steps rebased in editor draft");
  assert.equal(await settings.locator("[data-apply-bar]").isVisible(), true, "apply bar remains visible for dirty draft");

  // Subtest 10B: Invalid draft is retained completely untouched in editor
  await jsonTextarea.fill('{"seed": 777888, INVALID_JSON');
  await stepsInput.fill("20");
  await stepsInput.press("Tab");
  patch = await lastPatch(page);

  // Everyday save still went to host with acknowledged config + steps
  assert.equal((patch?.imageParameters as any)?.steps, 20);
  assert.equal("seed" in (patch?.imageParameters as any), false);

  // Invalid draft in editor is retained untouched
  assert.equal(
    await jsonTextarea.inputValue(),
    '{"seed": 777888, INVALID_JSON',
    "invalid draft is retained completely untouched in editor"
  );
  assert.equal(await settings.locator("[data-apply-bar]").isVisible(), true);

  // Clean up: restore valid json and apply
  await jsonTextarea.fill('{"steps": 20, "guidance": 5, "sampler": "k_euler_ancestral", "resolution": "1216x832"}');
  await settings.locator("[data-apply]").click();
  assert.equal(await settings.locator("[data-status]").innerText(), "Advanced settings applied.");

  // --- Test 11: Switch imageSource to "text" -> NovelAI controls hidden ---
  await settings.locator('input[name="imageSource"][value="text"]').check();
  assert.equal(
    await naiControls.isVisible(),
    false,
    "NovelAI controls hidden when imageSource is text"
  );
  await settings.locator('input[name="imageSource"][value="generated"]').check();
  assert.equal(
    await naiControls.isVisible(),
    true,
    "NovelAI controls re-appear when imageSource is generated"
  );

  // --- Test 11A: Rapid edits (steps then sampler) with delayed echo ordering & optimistic retention ---
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.delayedEchos = [];
    f.savedPatches = [];
    f.panel.options.onSave = (patch: any) => {
      f.patches.push(patch);
      f.savedPatches.push(patch);
      f.config = { ...f.config, ...patch };
      f.delayedEchos.push({ ...f.config });
    };
  });

  // Edit 1: change steps to 34
  await stepsInput.fill("34");
  await stepsInput.press("Tab");

  // Edit 2: immediately change sampler to "k_dpmpp_sde" BEFORE any echo arrives
  await samplerSelect.selectOption("k_dpmpp_sde");

  // Verify that the second patch contains both the new steps and new sampler
  patch = await lastPatch(page);
  assert.equal((patch?.imageParameters as any)?.steps, 34, "second patch carries rapid steps edit");
  assert.equal((patch?.imageParameters as any)?.sampler, "k_dpmpp_sde", "second patch carries rapid sampler edit");

  // Now simulate backend echoing the FIRST edit (which only had steps: 34, but old sampler)
  // and acknowledging the first save:
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    const echo1 = f.delayedEchos[0];
    f.panel.setConfig(echo1);
    f.panel.setSaveStatus({ kind: "saved" });
  });

  // Status must remain "Saving…" because the second edit is still pending acknowledgement!
  assert.equal(
    await settings.locator("[data-status]").innerText(),
    "Saving…",
    "first echo + saved must remain Saving/pending while second edit is in flight"
  );
  // Optimistic retention check: UI must NOT be reverted to the old sampler
  assert.equal(await samplerSelect.inputValue(), "k_dpmpp_sde", "stale first echo must NOT overwrite rapid second edit");
  assert.equal(await stepsInput.inputValue(), "34", "steps remains 34");

  // Now simulate backend echoing the SECOND edit (which caught up) and acknowledging it
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    const echo2 = f.delayedEchos[1];
    f.panel.setConfig(echo2);
    f.panel.setSaveStatus({ kind: "saved" });
    // restore normal fixture onSave behavior
    f.panel.options.onSave = (p: any) => {
      f.patches.push(p);
      f.config = { ...f.config, ...p };
      f.panel.setConfig(f.config);
      if (f.ackMode === "sync") queueMicrotask(() => f.panel.setSaveStatus({ kind: "saved" }));
    };
  });
  // Now that all in-flight edits are acknowledged, status transitions to "Saved"
  assert.equal(await settings.locator("[data-status]").innerText(), "Saved", "latest echo marks Saved");
  assert.equal(await samplerSelect.inputValue(), "k_dpmpp_sde");
  assert.equal(await stepsInput.inputValue(), "34");

  // --- Test 11B: Preserving unrelated/custom scale parameter ---
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.config = {
      ...f.config,
      imageParameters: {
        ...f.config.imageParameters,
        scale: 7.5,
      },
    };
    f.panel.setConfig(f.config);
  });
  // Change guidance to 8.0
  await guidanceInput.fill("8.0");
  await guidanceInput.press("Tab");
  patch = await lastPatch(page);
  assert.equal((patch?.imageParameters as any)?.guidance, 8.0);
  assert.equal((patch?.imageParameters as any)?.scale, 7.5, "unrelated custom scale must NOT be deleted");

  // --- Test 11C: Save error followed by authoritative config/reset does not resurrect rejected fields ---
  await stepsInput.fill("45");
  await stepsInput.press("Tab");
  // Simulate backend rejection error
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.panel.setSaveStatus({ kind: "error", error: "Simulated quota rejection" });
  });
  assert.match(await settings.locator("[data-status]").innerText(), /Simulated quota rejection/);

  // Host subsequently sends authoritative config restoring steps to 28
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.config = { ...f.config, imageParameters: { ...f.config.imageParameters, steps: 28 } };
    f.panel.setConfig(f.config);
  });
  assert.equal(await stepsInput.inputValue(), "28", "authoritative config honored without resurrecting rejected 45");

  // Reset defaults confirms no phantom resurrection
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.panel.setConfig(f.config);
  });
  assert.equal(await stepsInput.inputValue(), "28", "rejected 45 does not resurrect");

  // --- Test 11D: In-flight everyday edit does not overwrite unrelated incoming keys ---
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.config = { ...f.config, imageParameters: { steps: 28, seed: 12345 } };
    f.panel.setConfig(f.config);
    // Pause synchronous setConfig echo to simulate an in-flight save
    f.panel.options.onSave = (patch: any) => {
      f.patches.push(patch);
      f.config = { ...f.config, ...patch };
    };
  });
  // User changes steps to 30 while in-flight
  await stepsInput.fill("30");
  await stepsInput.press("Tab");

  // Host delivers an update containing an unrelated key e.g. characterTags before our edit was acknowledged
  await page.evaluate(() => {
    const f = (window as any).settingsFixture;
    f.panel.setConfig({
      ...f.config,
      imageParameters: { steps: 28, seed: 12345, characterTags: ["test_tag"] },
    });
    // Restore normal fixture onSave
    f.panel.options.onSave = (p: any) => {
      f.patches.push(p);
      f.config = { ...f.config, ...p };
      f.panel.setConfig(f.config);
      if (f.ackMode === "sync") queueMicrotask(() => f.panel.setSaveStatus({ kind: "saved" }));
    };
  });
  const currentParams = await page.evaluate(() => (window as any).settingsFixture.panel.config.imageParameters);
  assert.equal(currentParams.steps, 30, "in-flight steps retained");
  assert.deepEqual(currentParams.characterTags, ["test_tag"], "unrelated incoming keys preserved");
  assert.equal(currentParams.seed, 12345, "unrelated incoming seed preserved");

  // --- Test 12: Network assertion (no paid or external requests) ---
  assert.deepEqual(
    externalRequests,
    [],
    "No external or paid network requests made during settings interaction"
  );

  // Capture screenshot for visual inspection and reporting
  await page.screenshot({ path: ".cache/novelai-controls/novelai-settings-desktop.png", fullPage: true });
  console.log("NovelAI settings browser checks passed successfully!");
} finally {
  await browser?.close();
  server.stop(true);
}
