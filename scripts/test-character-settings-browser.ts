/**
 * Browser check: settings saved per character, with the real backend and
 * frontend host in one page (scripts/character-settings-browser-fixture.ts).
 * Switch Settings to "<name> only", change a setting, switch chats, and see
 * it apply only to that character; back to shared, one setting or all.
 */
import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const build = await Bun.build({ entrypoints: ["scripts/character-settings-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => {
  const { pathname } = new URL(request.url);
  if (pathname === "/fixture.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
  if (pathname === "/") return new Response('<html><body><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
  return new Response("Not found", { status: 404 });
} });

type Stored = Record<string, any>;
const call = <T,>(page: Page, name: string, arg?: unknown) =>
  page.evaluate(([fn, value]) => (window as any).characterSettings[fn as string](value), [name, arg] as const) as Promise<T>;
const storage = (page: Page) => call<Stored>(page, "storage");
const preset = (page: Page) => call<string | null>(page, "stagePreset");
const switchChat = (page: Page, chatId: string) => call<void>(page, "switchChat", chatId);

let diagnostics: () => Promise<unknown> = async () => null;
async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) {
      console.error(JSON.stringify(await diagnostics().catch((error) => String(error)), null, 2));
      throw new Error(`Timed out waiting for: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  diagnostics = async () => ({
    consoleErrors,
    page: await page.evaluate(() => {
      const fixture = (window as any).characterSettings;
      const summary = (message: Record<string, any>) => ({ type: message.type, chatId: message.chatId, theme: message.config?.themePreset, scope: message.characterScope && { id: message.characterScope.characterId, overrides: message.characterScope.overrides }, error: message.error });
      return {
        preset: fixture.stagePreset(),
        backendErrors: fixture.backendErrors,
        backendLog: fixture.backendLog.slice(-10),
        toBackend: fixture.toBackend.slice(-8).map((message: Record<string, any>) => ({ type: message.type, chatId: message.chatId, patch: message.patch, character: message.character })),
        toFrontend: fixture.toFrontend.slice(-8).map(summary),
      };
    }),
  });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.waitForSelector("body[data-fixture-ready]");
  const settings = page.locator("[data-vn-settings]");
  const scope = settings.locator("[data-scope]");
  const scopeName = scope.locator("[data-scope-name]").first();
  const sharedChoice = settings.locator('input[name="settingsScope"][value="shared"]');
  const characterChoice = settings.locator('input[name="settingsScope"][value="character"]');
  const openTab = (name: string) => settings.getByRole("tab", { name, exact: true }).click();
  const themeGroup = settings.locator('[data-group]:has(input[name="themePreset"])');
  const saved = () => waitFor("the save to be confirmed", async () => (await settings.locator("[data-status]").getAttribute("data-kind")) === "saved");
  const isInert = (selector: string) => settings.locator(selector).first().evaluate((element) => element.closest("[inert]") !== null);

  // A chat with a character: the switch shows, on All characters, and the stage uses the shared theme.
  await scope.waitFor({ state: "visible" });
  assert.equal(await scopeName.innerText(), "Mira");
  assert.equal(await sharedChoice.isChecked(), true, "Settings starts on All characters");
  await waitFor("the shared theme on the stage", async () => (await preset(page)) === "golden-hour");
  assert.equal(await settings.locator("[data-own-marker]").count(), 0, "no own values yet");
  assert.equal(await isInert('input[name="autoEnter"]'), false, "nothing is locked on All characters");

  // "Mira only": shared settings are locked with a note; per-character ones are not.
  assert.match(await scope.innerText(), /All characters\s*Mira only/);
  await characterChoice.check();
  assert.equal(await characterChoice.isChecked(), true);
  assert.match(await scope.locator("[data-scope-help]").innerText(), /for Mira only/);
  assert.equal(await isInert('input[name="autoEnter"]'), true, "Open automatically is shared");
  assert.equal(await isInert('input[name="generateChoices"]'), false, "Suggest replies is per character");
  assert.equal(await settings.locator('[data-group]:has(input[name="autoEnter"]) [data-shared-note]').isVisible(), true);
  await mkdir(".cache/character-settings", { recursive: true });
  await page.screenshot({ path: ".cache/character-settings/reading-locked.png", fullPage: true });
  await openTab("Sound");
  assert.equal(await settings.locator('[data-pane="sound"] > [data-shared-note]').isVisible(), true, "Sound is shared by all characters");
  assert.equal(await isInert('input[name="bgmVolume"]'), true);
  await openTab("Look");
  assert.equal(await isInert('input[name="themePreset"]'), false);

  // A theme for Mira only: saved for her card, the shared config is untouched, the stage follows.
  await settings.locator('input[name="themePreset"][value="midnight-noir"]').check();
  await saved();
  await waitFor("Mira's theme on the stage", async () => (await preset(page)) === "midnight-noir");
  let stored = await storage(page);
  assert.deepEqual(stored["config-characters.json"].characters["card-mira"].overrides, { themePreset: "midnight-noir" });
  assert.equal(stored["config.json"].themePreset, "golden-hour", "the shared theme did not change");
  assert.match(await themeGroup.locator("[data-own-marker]").innerText(), /Only for Mira/);
  const sentSaves = await page.evaluate(() => (window as any).characterSettings.toBackend.filter((message: { type: string }) => message.type === "vn_set_config"));
  assert.deepEqual(sentSaves.at(-1).character, { characterId: "card-mira" }, "the save names the character");
  await page.screenshot({ path: ".cache/character-settings/mira-only.png" });

  // Another character's chat: shared settings, All characters again, no markers.
  await switchChat(page, "chat-theo");
  await waitFor("Theo's chat in Settings", async () => (await scopeName.innerText()) === "Theo");
  await waitFor("the shared theme for Theo", async () => (await preset(page)) === "golden-hour");
  assert.equal(await sharedChoice.isChecked(), true, "another character starts on All characters");
  assert.equal(await settings.locator('input[name="themePreset"][value="golden-hour"]').isChecked(), true);
  assert.equal(await settings.locator("[data-own-marker]").count(), 0);

  // A chat without a character offers only the shared settings.
  await switchChat(page, "chat-group");
  await waitFor("no character scope in a group chat", async () => !(await scope.isVisible()));
  assert.equal(await preset(page), "golden-hour");

  // Back to Mira: her theme returns; on All characters the control shows the shared value, marked.
  await switchChat(page, "chat-mira");
  await waitFor("Mira's theme back on the stage", async () => (await preset(page)) === "midnight-noir");
  await waitFor("Mira in Settings", async () => (await scope.isVisible()) && (await scopeName.innerText()) === "Mira");
  assert.equal(await sharedChoice.isChecked(), true);
  assert.equal(await settings.locator('input[name="themePreset"][value="golden-hour"]').isChecked(), true, "All characters shows the shared theme");
  assert.match(await themeGroup.locator("[data-own-marker]").innerText(), /Mira has its own value/);
  await page.screenshot({ path: ".cache/character-settings/all-characters-marked.png" });

  // A shared change reaches every character but not Mira's own theme.
  await settings.locator('input[name="themePreset"][value="daylight"]').check();
  await saved();
  stored = await storage(page);
  assert.equal(stored["config.json"].themePreset, "daylight");
  assert.equal(await preset(page), "midnight-noir", "Mira keeps her own theme");
  await switchChat(page, "chat-theo");
  await waitFor("the new shared theme for Theo", async () => (await preset(page)) === "daylight");
  await switchChat(page, "chat-mira");
  await waitFor("Mira's own theme again", async () => (await preset(page)) === "midnight-noir");
  await waitFor("Mira's marker again", async () => (await themeGroup.locator("[data-own-marker]").count()) === 1);

  // "Use shared" beside the theme: Mira follows the shared theme again.
  await themeGroup.locator("[data-own-marker]").getByRole("button", { name: /Use the shared value/ }).click();
  await waitFor("the shared theme for Mira", async () => (await preset(page)) === "daylight");
  await saved();
  stored = await storage(page);
  assert.deepEqual(stored["config-characters.json"].characters, {}, "no own values left");
  assert.equal(await settings.locator("[data-own-marker]").count(), 0);

  // Two own values, then "Use shared settings for Mira" (a second click confirms).
  await characterChoice.check();
  await settings.locator('input[name="themePreset"][value="nvl"]').check();
  await saved();
  await settings.locator('input[name="textScaleStep"][value="1.2"]').check();
  await saved();
  stored = await storage(page);
  assert.deepEqual(stored["config-characters.json"].characters["card-mira"].overrides, { themePreset: "nvl", textScale: 1.2 });
  assert.equal(await preset(page), "nvl");
  assert.equal(await settings.locator("[data-own-marker]").count(), 2);
  const clear = scope.locator("[data-scope-clear]");
  assert.equal(await clear.innerText(), "Use shared settings for Mira");
  await clear.click();
  assert.match(await clear.innerText(), /^Confirm/);
  assert.deepEqual((await storage(page))["config-characters.json"].characters["card-mira"].overrides, { themePreset: "nvl", textScale: 1.2 }, "one click changes nothing");
  await clear.click();
  await waitFor("Mira back on every shared setting", async () => (await preset(page)) === "daylight");
  await saved();
  stored = await storage(page);
  assert.deepEqual(stored["config-characters.json"].characters, {});
  assert.equal(await scope.locator("[data-scope-actions]").isVisible(), false, "nothing left to clear");
  await page.screenshot({ path: ".cache/character-settings/mira-cleared.png" });

  // Narrow screen: the switch wraps without a horizontal scroll.
  await page.setViewportSize({ width: 390, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no horizontal scroll at phone width");
  await page.screenshot({ path: ".cache/character-settings/phone.png" });

  const backendErrors = await page.evaluate(() => (window as any).characterSettings.backendErrors as string[]);
  const vnErrors = await page.evaluate(() => (window as any).characterSettings.toFrontend.filter((message: { type: string }) => message.type === "vn_error"));
  assert.deepEqual(backendErrors, [], "no backend errors");
  assert.deepEqual(vnErrors, [], "no vn_error answers");
  assert.deepEqual(consoleErrors, [], "no console errors");
  console.log("character settings browser check passed");
} finally {
  await browser?.close();
  server.stop(true);
}
