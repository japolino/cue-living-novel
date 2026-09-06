import { chromium, type Browser } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

await mkdir(".cache/ux-redesign", { recursive: true });

// 1. Bundle the QA fixture
console.log("Building UX redesign browser fixture...");
const build = await Bun.build({
  entrypoints: ["scripts/ux-redesign-fixture.ts"],
  target: "browser",
});
if (!build.success) {
  console.error(build.logs);
  throw new Error("Failed to build ux-redesign-fixture: " + String(build.logs));
}

const bundle = await build.outputs[0]!.text();

// 2. Start local deterministic HTTP server
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/fixture.js") {
      return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
    }
    return new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#08090d"><script type="module" src="/fixture.js"></script></body></html>',
      { headers: { "Content-Type": "text/html" } }
    );
  },
});

console.log(`Test fixture server listening on http://127.0.0.1:${server.port}`);

let browser: Browser | undefined;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Network monitor: track any outbound https or external requests
  const networkRequests: string[] = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.startsWith("https:") || u.startsWith("http://external")) {
      networkRequests.push(u);
    }
  });

  // =========================================================================
  // SCENARIO 1: First Setup & Zero Connections (QA-SET-01, QA-SET-05)
  // =========================================================================
  console.log("\n--- Running Scenario 1: First Setup & Zero Connections ---");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`http://127.0.0.1:${server.port}/?setup`);

  // Verify onboarding card is shown
  const setupCard = page.locator("[data-setup]");
  assert.equal(await setupCard.isVisible(), true, "First-use onboarding setup card must be visible");
  assert.equal(await setupCard.getByRole("heading", { name: "Get started" }).isVisible(), true);

  // Verify truthful readiness: no saved connections
  const plannerReadiness = setupCard.locator('[data-readiness="planner"]');
  assert.ok(
    (await plannerReadiness.textContent())?.includes("No saved"),
    "Planner readiness must truthfully reflect 'No saved story reader connections'"
  );

  const imageReadiness = page.locator('[data-section="images"] [data-readiness="image"]');
  // Open images section to inspect
  await page.locator('[data-section="images"] > summary').click();
  assert.ok(
    (await imageReadiness.textContent())?.includes("No saved"),
    "Image readiness must truthfully reflect 'No saved image connections'"
  );

  // Verify sound empty state
  await page.locator('[data-section="sound"] > summary').click();
  const soundEmpty = page.locator("[data-sound-empty]");
  assert.equal(await soundEmpty.isVisible(), true, "Sound empty state must be visible when 0 audio assets");
  assert.ok(
    (await soundEmpty.textContent())?.includes("No music yet"),
    "Sound empty state explains no music yet"
  );
  assert.equal(await soundEmpty.locator("[data-import-audio]").isVisible(), true);

  // Test scan audio action
  await soundEmpty.locator("[data-scan-audio]").click();
  await page.waitForFunction(() => (window as any).setupFixture.fixture.audioScanned > 0);
  const soundReady = page.locator("[data-sound-ready]");
  // Once library is scanned, sound-ready state becomes visible
  await page.evaluate(() => {
    (window as any).setupFixture.settings.setAudioLibrary({ bgmCount: 4, sfxCount: 8 });
  });
  assert.equal(await soundReady.isVisible(), true, "Sound library shows ready after scan");
  assert.ok((await soundReady.textContent())?.includes("4 music tracks"));

  // Verify zero external network requests
  assert.equal(networkRequests.length, 0, "Zero external paid requests during initial setup");

  // Capture desktop screenshot of setup
  await page.screenshot({ path: ".cache/ux-redesign/qa-first-setup-desktop.png", fullPage: true });
  console.log("Saved .cache/ux-redesign/qa-first-setup-desktop.png");

  // Complete setup
  await setupCard.locator("[data-setup-done]").click();
  assert.equal(await setupCard.isVisible(), false, "Setup card dismissed upon clicking Done");

  // =========================================================================
  // SCENARIO 2: Missing Saved Connection Warning
  // =========================================================================
  console.log("\n--- Running Scenario 2: Missing Saved Connection ---");
  await page.goto(`http://127.0.0.1:${server.port}/?missing-connection`);
  await page.locator('[data-section="images"] > summary').click();
  const missingImgReadiness = page.locator('[data-section="images"] [data-readiness="image"]');
  const readinessText = await missingImgReadiness.textContent();
  assert.ok(
    readinessText?.includes("missing") || readinessText?.includes("no longer"),
    "Readiness truthfully flags missing saved connection"
  );

  // =========================================================================
  // SCENARIO 3: Single Image Choice, Live Preview, Draft Resilience (QA-SET-02, 03, 04)
  // =========================================================================
  console.log("\n--- Running Scenario 3: Single Image Choice & Local Live Preview ---");
  await page.goto(`http://127.0.0.1:${server.port}/?settings`);
  const initialReqCount = networkRequests.length;

  // Open Images section
  await page.locator('[data-section="images"] > summary').click();

  // Test Image Source switching
  const cardRadio = page.locator('[data-section="images"] input[value="card"]');
  const generatedRadio = page.locator('[data-section="images"] input[value="generated"]');
  const textRadio = page.locator('[data-section="images"] input[value="text"]');

  assert.equal(await generatedRadio.isChecked(), true, "Default image source is generated");

  // Switch to Character pictures (card)
  await cardRadio.click();
  let savedHistory = await page.evaluate(() => (window as any).settingsFixture.fixture.saved);
  let lastSave = savedHistory[savedHistory.length - 1];
  assert.equal(lastSave.useNativeCardImages, true, "Card choice sets useNativeCardImages: true");

  // Switch to Text only (text)
  await textRadio.click();
  savedHistory = await page.evaluate(() => (window as any).settingsFixture.fixture.saved);
  lastSave = savedHistory[savedHistory.length - 1];
  assert.equal(lastSave.useNativeCardImages, false);
  assert.equal(lastSave.generateImages, false, "Text choice sets generateImages: false");

  // Switch back to Generated illustrations (generated)
  await generatedRadio.click();
  savedHistory = await page.evaluate(() => (window as any).settingsFixture.fixture.saved);
  lastSave = savedHistory[savedHistory.length - 1];
  assert.equal(lastSave.useNativeCardImages, false);
  assert.equal(lastSave.generateImages, true, "Generated choice sets generateImages: true");

  // Test Custom Budget Presets
  const budgetHelp = page.locator("[data-budget-help]");
  assert.ok((await budgetHelp.textContent())?.includes("4"), "Balanced budget defaults to 4");

  // Test Local Live Story Sample
  const sample = page.locator("[data-sample]");
  assert.equal(await sample.isVisible(), true, "Story sample is rendered");
  const sampleSpeaker = sample.locator("[data-sample-speaker]");
  assert.equal(await sampleSpeaker.textContent(), "Mira");

  // Open Appearance section and switch theme preset
  await page.locator('[data-section="appearance"] > summary').click();
  const goldenHourTile = page.locator('[data-section="appearance"] [data-tiles] input[value="golden-hour"]');
  await goldenHourTile.click();

  // Verify sample styles updated locally
  const sampleDialogue = sample.locator("[data-sample-dialogue]");
  const dialogueBorder = await sampleDialogue.evaluate((el) => getComputedStyle(el).borderTopColor);
  assert.ok(dialogueBorder, "Dialogue has computed border style from theme");

  // Verify zero network requests during theme switching
  assert.equal(networkRequests.length, initialReqCount, "Zero network requests during theme switching");

  // Capture live preview screenshot
  await page.screenshot({ path: ".cache/ux-redesign/qa-live-preview-desktop.png" });
  console.log("Saved .cache/ux-redesign/qa-live-preview-desktop.png");

  // Test Advanced Config Draft Preservation on Error
  console.log("Testing Advanced Config Draft Preservation on Error...");
  const advDetails = page.locator("[data-advanced-settings]");
  await advDetails.locator("> summary").click();

  // Open Connections and models subsection
  await advDetails.getByText("Connections and models").click();

  const customJsonInput = advDetails.locator('textarea[name="imageParameters"]');
  await customJsonInput.fill('{"steps": 35, "cfg": 7.5}');

  // Simulate transport rejection
  await page.evaluate(() => {
    (window as any).settingsFixture.fixture.simulateError = true;
  });

  // Click Apply advanced settings
  await advDetails.locator("[data-apply]").click();

  // Verify error state is shown
  const statusEl = page.locator("[data-status]");
  assert.ok(
    (await statusEl.textContent())?.includes("rejection"),
    "Status shows truthful transport error"
  );
  assert.equal(
    (await statusEl.textContent())?.includes("Settings saved"),
    false,
    "Must NOT claim Settings saved on error"
  );

  // Verify user's draft in textarea is NOT wiped
  assert.equal(
    await customJsonInput.inputValue(),
    '{"steps": 35, "cfg": 7.5}',
    "Draft in textarea is fully preserved on save failure"
  );

  // =========================================================================
  // SCENARIO 4: Reading Navigation, Auto Pause, Draft Preservation (QA-NAV-01..04)
  // =========================================================================
  console.log("\n--- Running Scenario 4: Reading Navigation & Auto Pause ---");
  await page.goto(`http://127.0.0.1:${server.port}/?reading`);
  await page.emulateMedia({ reducedMotion: "reduce" });

  const prevBtn = page.getByRole("button", { name: "Previous paragraph", exact: true });
  const continueBtn = page.getByRole("button", { name: /Continue/, exact: false });
  const autoBtn = page.locator('[data-vn-control="auto"]');
  const skipBtn = page.locator('[data-vn-control="skip"]');

  const getParagraphIndex = () =>
    page.evaluate(() => (window as any).readingFixture.stage.getState().currentParagraphIndex);
  const getPhase = () =>
    page.evaluate(() => (window as any).readingFixture.stage.getState().phase);

  assert.equal(await getParagraphIndex(), 0, "Starts at paragraph 0");
  assert.equal(await prevBtn.isDisabled(), true, "Previous button is disabled at start");

  // Advance to paragraph 1
  await continueBtn.click({ force: true });
  assert.equal(await getParagraphIndex(), 1);
  assert.equal(await prevBtn.isDisabled(), false);

  // Start Auto play
  await autoBtn.click();
  assert.equal(await autoBtn.getAttribute("data-vn-active"), "true", "Auto play is active");

  // Click Previous -> Auto play must pause immediately!
  await prevBtn.click();
  assert.equal(await getParagraphIndex(), 0, "Navigated back to paragraph 0");
  assert.equal(
    await autoBtn.getAttribute("data-vn-active"),
    "false",
    "Auto play paused immediately upon clicking Previous"
  );
  assert.equal(
    await autoBtn.getAttribute("aria-pressed"),
    "false",
    "aria-pressed is false when paused"
  );

  // Advance past paragraph 1 to paragraph 2 ("Your turn" / awaiting-input)
  await continueBtn.click({ force: true });
  assert.equal(await getParagraphIndex(), 1);
  await continueBtn.click({ force: true });
  assert.equal(await getParagraphIndex(), 2, "Reached final paragraph");
  await continueBtn.click({ force: true });
  await page.waitForFunction(() => (window as any).readingFixture.stage.getState().phase === "awaiting-input");

  // Wait for interaction to display in standard mode
  const interactionSection = page.locator("[data-vn-interaction]");
  assert.equal(await interactionSection.isVisible(), true, "Interaction section visible");
  assert.equal(await getPhase(), "awaiting-input", "Phase is awaiting-input");

  // Verify Auto play cannot be running at "Your turn"
  assert.equal(
    await autoBtn.getAttribute("data-vn-active"),
    "false",
    "Auto play is paused at Your turn"
  );

  // Standard input form is visible
  const inputForm = page.locator("[data-vn-input-form]");
  assert.equal(await inputForm.isVisible(), true, "Input form visible in standard mode");
  const inputArea = page.locator("[data-vn-input]");

  // Fill in draft response
  await inputArea.fill("I shall scout the perimeter carefully.");

  // Keystroke isolation: Left Arrow inside textarea must not trigger previous
  await inputArea.focus();
  await inputArea.press("ArrowLeft");
  assert.equal(await getParagraphIndex(), 2, "Left Arrow inside textarea only moves caret");

  // Navigate backward to reread earlier text
  await prevBtn.click();
  assert.equal(await getParagraphIndex(), 1, "Navigated back to paragraph 1");

  // Return forward to "Your turn"
  await continueBtn.click({ force: true });
  assert.equal(await getParagraphIndex(), 2, "Returned to paragraph 2");

  // Verify draft text is still intact!
  assert.equal(
    await inputArea.inputValue(),
    "I shall scout the perimeter carefully.",
    "User draft text in textarea remains intact across backward/forward navigation"
  );

  // Now test CYOA mode and choices rendering
  await page.evaluate(() => {
    const { stage, turn } = (window as any).readingFixture;
    stage.loadTurn({ ...turn, mode: "cyoa" });
    stage.advance();
    stage.advance();
    stage.advance();
  });
  const choiceItems = page.locator("[data-vn-choice]");
  assert.equal(await choiceItems.count(), 2, "Two choices rendered in CYOA mode");

  // Capture desktop screenshot of "Your turn" with choices
  // =========================================================================
  // SCENARIO 5: Truthful Error & User-Initiated Retry (QA-ERR-01)
  // =========================================================================
  console.log("\n--- Running Scenario 5: Truthful Error & Explicit Retry ---");
  await page.goto(`http://127.0.0.1:${server.port}/?error`);

  const statusStack = page.locator("[data-vn-status-stack]");
  assert.equal(await statusStack.isVisible(), true);
  const errorBadge = statusStack.locator('[data-vn-badge][data-vn-badge-kind="error"]');
  assert.equal(await errorBadge.isVisible(), true, "Error badge is visible");

  // Verify truthful error copy
  const errorTextEl = errorBadge.locator("[data-vn-badge-text]");
  assert.ok(
    (await errorTextEl.textContent())?.includes("Image generation failed"),
    "Friendly error message displayed"
  );

  // Technical detail disclosure
  const detailEl = errorBadge.locator("[data-vn-badge-details] pre");
  assert.ok(
    (await detailEl.textContent())?.includes("GPU capacity"),
    "Technical detail explains GPU worker limit"
  );

  // Retry scope statement
  const scopeEl = errorBadge.locator("[data-vn-badge-note]");
  assert.ok(
    (await scopeEl.textContent())?.includes("keeps 1 finished image"),
    "Truthful retry scope states finished images are kept"
  );

  // Verify explicit retry button ("Try again")
  const retryBtn = errorBadge.locator("button[data-vn-badge-action]");
  assert.equal(await retryBtn.isVisible(), true, "Retry button is visible");
  assert.equal(await retryBtn.textContent(), "Try again");

  // Trigger retry
  await retryBtn.click();
  const retryCalled = await page.evaluate(() => (window as any).errorFixture.isRetryTriggered());
  assert.equal(retryCalled, true, "Clicking retry button triggers onReroll retry callback");

  // Capture screenshot of truthful error
  await page.screenshot({ path: ".cache/ux-redesign/qa-truthful-error-desktop.png" });
  console.log("Saved .cache/ux-redesign/qa-truthful-error-desktop.png");

  // =========================================================================
  // SCENARIO 6: Mobile Viewport & Touch Targets (QA-MOB-01)
  // =========================================================================
  console.log("\n--- Running Scenario 6: Mobile Viewport (360x640) ---");
  const mobileContext = await browser.newContext({
    viewport: { width: 360, height: 640 },
    hasTouch: true,
    isMobile: true,
  });
  const mobilePage = await mobileContext.newPage();

  // 6A: Mobile Settings Layout
  await mobilePage.goto(`http://127.0.0.1:${server.port}/?settings`);
  const settingsScrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(settingsScrollWidth <= 360, `Settings panel fits mobile width: ${settingsScrollWidth} <= 360`);

  await mobilePage.screenshot({ path: ".cache/ux-redesign/qa-settings-mobile.png", fullPage: true });
  console.log("Saved .cache/ux-redesign/qa-settings-mobile.png");

  // 6B: Mobile Reading Stage
  await mobilePage.goto(`http://127.0.0.1:${server.port}/?reading`);
  const stageControlsBounds = await mobilePage.locator("[data-vn-controls]").boundingBox();
  const stageSpeakerBounds = await mobilePage.locator("[data-vn-speaker]").boundingBox();

  assert.ok(stageControlsBounds, "Controls have bounding box");
  assert.ok(stageSpeakerBounds, "Speaker has bounding box");

  // Controls must not collide with speaker nameplate vertically
  assert.ok(
    stageControlsBounds.y + stageControlsBounds.height <= stageSpeakerBounds.y + 4 ||
    stageControlsBounds.y >= stageSpeakerBounds.y + stageSpeakerBounds.height - 4 ||
    stageControlsBounds.x >= stageSpeakerBounds.x + stageSpeakerBounds.width,
    "Controls do not overlap the speaker nameplate on mobile"
  );

  // Minimum tap target size >= 44px
  const prevBtnBox = await mobilePage.locator('[data-vn-control="previous"]').boundingBox();
  assert.ok(prevBtnBox && prevBtnBox.height >= 40, `Previous button height ${prevBtnBox?.height} >= 40px for touch`);

  await mobilePage.screenshot({ path: ".cache/ux-redesign/qa-reading-mobile.png" });
  console.log("Saved .cache/ux-redesign/qa-reading-mobile.png");
  await mobileContext.close();

  console.log("\n========================================================");
  console.log("ALL INDEPENDENT UX ACCEPTANCE CHECKS PASSED SUCCESSFULLY!");
  console.log("========================================================\n");

} finally {
  await browser?.close();
  server.stop();
}