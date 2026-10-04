import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";

/**
 * Focused offline browser checks for the speech feature. The page runs the
 * REAL transport/controller/dock/settings-card code against intercepted
 * in-page host endpoints (recorded, never leaving the page). Covers:
 * profile selection + save echo, manual Play/Pause/Stop, narrator vs named
 * fallback, default-disabled zero requests, delivery-tag route gating,
 * profile revision (updated_at) cache keying, and a stale completion after
 * the view closes. No paid calls; the external-request guard fails the run
 * if anything tries to leave the page.
 */

const build = await Bun.build({ entrypoints: ["scripts/speech-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => new URL(request.url).pathname === "/fixture.js"
  ? new Response(bundle, { headers: { "Content-Type": "application/javascript" } })
  : new Response('<html><body><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } }) });

type Snapshot = {
  requests: Array<{ method: string; url: string; body: Record<string, unknown> | null }>;
  patches: Array<Record<string, unknown>>;
  playCalls: number;
  pauseCalls: number;
  statuses: Array<{ kind: string; message?: string }>;
};
const snap = (page: Page): Promise<Snapshot> => page.evaluate(`(() => {
  const { requests, patches, playCalls, pauseCalls, statuses } = window.speechFixture;
  return JSON.parse(JSON.stringify({ requests, patches, playCalls, pauseCalls, statuses }));
})()`) as Promise<Snapshot>;
const synthCalls = (s: Snapshot) => s.requests.filter((r) => r.url.endsWith("/tts/synthesize"));
const fx = (page: Page, script: string) => page.evaluate(`(() => { const f = window.speechFixture; ${script} })()`);

let browser: Browser | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  const external: string[] = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith(`http://127.0.0.1:${server.port}`)) external.push(request.url()); });
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.locator("[data-speech-fixture-ready]").waitFor();

  const dock = page.locator(".vn-speech-dock");
  const card = page.locator(".vn-speech-settings");
  // The section is flat now (it renders inside the settings Voice section): no disclosure to open.
  assert.equal(await card.getByRole("button", { name: "Load profiles" }).isVisible(), true, "speech settings are visible without expanding anything");

  // 1) Default-disabled: dock hidden; cursor storms + activation trigger ZERO requests.
  assert.equal(await dock.isVisible(), false, "dock hidden while speech is off");
  await fx(page, `f.activate(); for (let i = 0; i < 4; i += 1) f.setCursor(i, "p" + i, ""); void f.controller.playCurrent();`);
  await page.waitForTimeout(50);
  assert.equal((await snap(page)).requests.length, 0, "disabled speech never calls any endpoint");
  assert.equal(await dock.isVisible(), false, "dock stays hidden while disabled even when the overlay is active");

  // 2) Profile listing is explicit; selection saves and the echo re-render keeps the choice.
  await card.getByRole("button", { name: "Load profiles" }).click();
  await card.getByText("2 saved TTS profile(s)").waitFor();
  let s = await snap(page);
  assert.equal(s.requests.length, 1, "one listing request, nothing else");
  assert.match(s.requests[0]!.url, /\/api\/v1\/tts-connections\?/);
  assert.equal(synthCalls(s).length, 0, "listing never synthesizes");
  const narratorSelect = card.locator('fieldset:has(legend:text-is("Narrator voice")) > select');
  await narratorSelect.selectOption("gem-1");
  s = await snap(page);
  assert.equal((s.patches.at(-1)!.narrator as { connectionId: string }).connectionId, "gem-1", "narrator profile saved");
  assert.equal(await narratorSelect.inputValue(), "gem-1", "save echo keeps the selection after re-render");
  const fallbackSelect = card.locator('fieldset:has(legend:text-is("Character default voice")) > select');
  await fallbackSelect.selectOption("oai-1");
  assert.equal(await fallbackSelect.inputValue(), "oai-1");

  // 3) Enable via the checkbox: patch saved, dock appears (overlay is active).
  await card.locator('input[type="checkbox"]').first().check();
  s = await snap(page);
  assert.equal(s.patches.at(-1)!.enabled, true, "enable saved as a speech patch");
  assert.equal(await dock.isVisible(), true, "dock appears once enabled and active");

  // 4) Manual Play: profile revision read + one synthesis; Pause/resume/Stop behave.
  await fx(page, `f.setCursor(0, "The wind picks up.", "");`);
  await dock.getByRole("button", { name: "Play this paragraph" }).click();
  await dock.getByText(/Speaking/).waitFor();
  s = await snap(page);
  assert.equal(s.requests.filter((r) => r.url === "/api/v1/tts-connections/gem-1").length, 1, "fresh Play reads the profile revision first");
  assert.equal(synthCalls(s).length, 1, "exactly one synthesis");
  assert.equal(synthCalls(s)[0]!.body!.connectionId, "gem-1", "narrator paragraph uses the narrator profile");
  assert.equal(s.playCalls, 1);
  await dock.getByRole("button", { name: "Pause speech" }).click();
  await dock.getByText("Paused").waitFor();
  await dock.getByRole("button", { name: "Play this paragraph" }).click();
  await dock.getByText(/Speaking/).waitFor();
  s = await snap(page);
  assert.equal(synthCalls(s).length, 1, "resume never re-synthesizes");
  assert.equal(s.playCalls, 2);
  await dock.getByRole("button", { name: "Stop speech" }).click();
  await dock.getByText(/Speech ready/).waitFor();

  // 5) Named speaker without an override falls back to the character default.
  await fx(page, `f.setCursor(1, "“You came back,” she says.", "Mira");`);
  await dock.getByRole("button", { name: "Play this paragraph" }).click();
  await dock.getByText(/Speaking — Mira/).waitFor();
  s = await snap(page);
  assert.equal(synthCalls(s).at(-1)!.body!.connectionId, "oai-1", "named speaker uses the character default");

  // 6) Delivery tags: Gemini route gets the tag; non-Gemini route never does automatically.
  await fx(page, `f.applySpeech({ deliveryMode: "gemini-audio-tags", deliveryTag: "whispers" });`);
  await fx(page, `f.setCursor(2, "A narrator line.", "");`); // narrator = gem-1 (Gemini model)
  await dock.getByRole("button", { name: "Play this paragraph" }).click();
  await dock.getByText(/Speaking/).waitFor();
  s = await snap(page);
  assert.equal(synthCalls(s).at(-1)!.body!.text, "[whispers] A narrator line.", "Gemini-family model receives the tag");
  await fx(page, `f.setCursor(3, "A spoken line.", "Mira");`); // characterDefault = oai-1 (non-Gemini)
  await dock.getByRole("button", { name: "Play this paragraph" }).click();
  await dock.getByText(/Speaking — Mira/).waitFor();
  s = await snap(page);
  assert.equal(synthCalls(s).at(-1)!.body!.text, "A spoken line.", "non-Gemini model gets NO tag without the labeled opt-in");

  // 7) Revision keying: replay = cache hit; a host-side profile edit forces re-synthesis.
  await fx(page, `f.applySpeech({ deliveryMode: "none", deliveryTag: "" });`);
  await fx(page, `f.setCursor(4, "Cache me.", "");`);
  await dock.getByRole("button", { name: "Play this paragraph" }).click();
  await dock.getByText(/Speaking/).waitFor();
  const afterFirst = synthCalls(await snap(page)).length;
  await fx(page, `f.endAudio();`);
  await dock.getByRole("button", { name: "Play this paragraph" }).click();
  await dock.getByText(/Speaking/).waitFor();
  s = await snap(page);
  assert.equal(synthCalls(s).length, afterFirst, "unchanged profile revision replays from cache");
  await fx(page, `f.endAudio(); f.bumpProfile("gem-1", "rev-2");`);
  await dock.getByRole("button", { name: "Play this paragraph" }).click();
  await dock.getByText(/Speaking/).waitFor();
  s = await snap(page);
  assert.equal(synthCalls(s).length, afterFirst + 1, "a profile edit (updated_at bump) misses the cache and synthesizes anew");

  // 8) Stale completion after close: a response landing after deactivate never plays.
  await fx(page, `f.endAudio(); f.setCursor(5, "Too late to speak.", ""); f.holdSynthesis = true;`);
  const playsBeforeStale = (await snap(page)).playCalls;
  await dock.getByRole("button", { name: "Play this paragraph" }).click();
  await page.waitForFunction("window.speechFixture.releaseSynthesis !== null");
  await fx(page, `f.deactivate();`); // view closed while the request is in flight
  await fx(page, `f.holdSynthesis = false; const release = f.releaseSynthesis; if (release) release();`);
  await page.waitForTimeout(80);
  s = await snap(page);
  assert.equal(s.playCalls, playsBeforeStale, "a completion landing after close never plays");
  assert.notEqual(s.statuses.at(-1)!.kind, "playing", "no playing status after close");
  assert.equal(await dock.isVisible(), false, "dock hides with the overlay");

  // 9) Character override drafts: with no narrator/character default, "Add" keeps
  // an editable row across the backend normalize+echo round-trip and saves
  // nothing until a profile is chosen.
  await fx(page, `f.activate(); f.applySpeech({ narrator: null, characterDefault: null });`);
  s = await snap(page);
  const patchesBeforeAdd = s.patches.length;
  const overridesBox = card.locator('fieldset:has(legend:text-is("Character voices (this chat)"))');
  await card.getByPlaceholder("Character name (as shown on the nameplate)").fill("Bram");
  await overridesBox.getByRole("button", { name: "Add" }).click();
  await overridesBox.locator('[data-speech-draft-row="bram"]').waitFor();
  s = await snap(page);
  assert.equal(s.patches.length, patchesBeforeAdd, "Add with no voice saved stores a local draft, not a config patch");
  const draftRow = overridesBox.locator('[data-speech-draft-row="bram"]');
  await draftRow.locator("select").selectOption("gem-1");
  s = await snap(page);
  assert.equal(s.patches.length, patchesBeforeAdd + 1, "choosing a profile saves the override");
  const savedChars = s.patches.at(-1)!.characters as Record<string, { connectionId: string }>;
  assert.equal(savedChars["chat::chat-1::bram"]?.connectionId, "gem-1", "draft saves under the chat-scoped key");
  const savedRow = overridesBox.locator('[data-speech-override-row="bram"]');
  await savedRow.waitFor();
  assert.equal(await savedRow.locator("select").inputValue(), "gem-1", "save echo keeps the row with its profile");

  assert.deepEqual(external, [], "nothing ever left the page");
  console.log("Speech browser checks passed: default-disabled zero requests, explicit profile listing, selection save echo, manual Play/Pause/Stop, narrator vs named fallback, Gemini-route tag gating, updated_at cache keying, stale completion after close, no external requests.");
} finally {
  await browser?.close();
  server.stop(true);
}
