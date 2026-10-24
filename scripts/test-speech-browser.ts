import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";

/**
 * Focused offline browser checks for read aloud. The page runs the REAL
 * ChoirBridge/controller/dock/settings-card code against a fake Choir on
 * `window.__CHOIR_API__` (recorded, never leaving the page). Covers:
 * default-off zero Choir calls, the Choir-only card (no TTS-profile pickers),
 * enable + save echo, manual Play/Pause/Stop, reading each new paragraph once
 * the page had a gesture, a late status after the view closes, Mute narrator,
 * Sound from Choir (on by default), the card without Choir, and the music
 * credit. The external-request guard fails the run if anything tries to
 * leave the page.
 */

const build = await Bun.build({ entrypoints: ["scripts/speech-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => new URL(request.url).pathname === "/fixture.js"
  ? new Response(bundle, { headers: { "Content-Type": "application/javascript" } })
  : new Response('<html><body><script type="module" src="/fixture.js"></script></body></html>', { headers: { "Content-Type": "text/html" } }) });

type Snapshot = {
  paragraphs: Array<{ text: string; speaker?: string; paragraphIndex?: number }>;
  stopCalls: number;
  patches: Array<Record<string, unknown>>;
  statuses: Array<{ kind: string; message?: string }>;
  muteCalls: boolean[];
  choirSoundCalls: boolean[];
};
const snap = (page: Page): Promise<Snapshot> => page.evaluate(`(() => {
  const { paragraphs, stopCalls, patches, statuses, muteCalls, choirSoundCalls } = window.speechFixture;
  return JSON.parse(JSON.stringify({ paragraphs, stopCalls, patches, statuses, muteCalls, choirSoundCalls }));
})()`) as Promise<Snapshot>;
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
  const card = page.locator(".vn-speech-settings").first();

  // 1) The card is Choir-only: no TTS profiles, voice pickers, delivery tags, auto-play or volume.
  assert.equal(await card.getByText("Read each paragraph aloud").isVisible(), true, "read aloud switch is visible without expanding anything");
  assert.equal(await card.getByRole("button", { name: "Open Choir voice setup" }).isVisible(), true, "voices are cast in Choir");
  for (const retired of ["Load profiles", "Narrator voice", "Character default voice", "Delivery style", "Auto-play", "Speech volume"]) {
    assert.equal(await card.getByText(retired).count(), 0, `no "${retired}" in the Choir-only card`);
  }

  // 2) Default-off: dock hidden; cursor storms + activation reach Choir ZERO times.
  assert.equal(await dock.isVisible(), false, "dock hidden while read aloud is off");
  await fx(page, `f.activate(); for (let i = 0; i < 4; i += 1) f.setCursor(i, "p" + i, ""); void f.controller.playCurrent();`);
  await page.waitForTimeout(50);
  assert.equal((await snap(page)).paragraphs.length, 0, "read aloud off never calls Choir");
  assert.equal(await dock.isVisible(), false, "dock stays hidden while off even when the overlay is active");

  // 3) Enable via the checkbox: patch saved, echo keeps it, dock appears (overlay is active).
  await card.locator('[data-speech-field="enable"]').check();
  let s = await snap(page);
  assert.equal(s.patches.at(-1)!.enabled, true, "enable saved as a speech patch");
  assert.equal(await card.locator('[data-speech-field="enable"]').isChecked(), true, "save echo keeps the switch on");
  assert.equal(await dock.isVisible(), true, "dock appears once enabled and active");
  assert.equal(s.paragraphs.length, 0, "turning it on does not read the paragraph already shown");

  // 4) The page has had a gesture (the click above), so a new paragraph is read
  // as it appears; Pause stops Choir; Play starts it over; Stop.
  await fx(page, `f.setCursor(0, "The wind picks up.", "");`);
  await dock.getByText("Speaking — Narrator").waitFor();
  s = await snap(page);
  assert.deepEqual(s.paragraphs.at(-1), { text: "The wind picks up.", speaker: "Narrator", paragraphIndex: 0 });
  await dock.getByRole("button", { name: "Pause speech" }).click();
  await dock.getByText("Paused").waitFor();
  assert.equal((await snap(page)).stopCalls, 1, "Pause stops Choir");
  await dock.getByRole("button", { name: "Play this paragraph" }).click();
  await dock.getByText(/Speaking/).waitFor();
  s = await snap(page);
  assert.equal(s.paragraphs.length, 2, "Play after Pause starts the paragraph over");
  await dock.getByRole("button", { name: "Stop speech" }).click();
  await dock.getByText(/Speech ready/).waitFor();

  // 5) The next paragraph is read too, with no Play.
  await fx(page, `f.setCursor(1, "“You came back,” she says.", "Mira");`);
  await dock.getByText("Speaking — Mira").waitFor();
  s = await snap(page);
  assert.deepEqual(s.paragraphs.at(-1), { text: "“You came back,” she says.", speaker: "Mira", paragraphIndex: 1 });
  await fx(page, `f.finishParagraph();`);
  await dock.getByText("Speech ready — Mira").waitFor();

  // 6) A late status after close: the view closes while Choir is reading; nothing shows as playing.
  await fx(page, `f.setCursor(2, "Too late to speak.", "");`);
  await dock.getByText(/Speaking/).waitFor();
  await fx(page, `f.deactivate(); f.finishParagraph(true);`);
  await page.waitForTimeout(50);
  s = await snap(page);
  assert.notEqual(s.statuses.at(-1)!.kind, "playing", "no playing status after close");
  assert.equal(await dock.isVisible(), false, "dock hides with the overlay");

  // 7) Mute narrator calls Choir and saves.
  await card.locator('[data-speech-field="mute-narrator"]').check();
  s = await snap(page);
  assert.deepEqual(s.muteCalls, [true], "the switch mutes Choir's narrator");
  assert.equal(s.patches.at(-1)!.muteNarrator, true, "muteNarrator saved");

  // 8) Sound from Choir: shown only when the installed Choir can switch its sound; on by default.
  const choirSound = card.locator('[data-speech-field="choir-sound"]');
  assert.equal(await choirSound.count(), 0, "no Sound from Choir switch on a Choir without sound control");
  await fx(page, `f.choirCanControlSound = true; f.section.refresh();`);
  assert.equal(await choirSound.isChecked(), true, "Sound from Choir is on by default");
  await choirSound.uncheck();
  s = await snap(page);
  assert.deepEqual(s.choirSoundCalls, [false], "the switch turns Choir's sound off");
  assert.equal(s.patches.at(-1)!.choirSound, false, "choirSound saved");
  assert.equal(await choirSound.isChecked(), false, "the switch stays off after the save echo");

  // 9) Without Choir the card says so and offers no switches.
  const noChoir = page.locator("[data-no-choir-section] .vn-speech-settings");
  assert.equal(await noChoir.getByText(/voiced by the Choir extension/).isVisible(), true, "the card says read aloud needs Choir");
  assert.equal(await noChoir.locator("input").count(), 0, "no switches without Choir");

  // 10) Music credit under the dock: shown with a track, hidden without one.
  await fx(page, `f.activate();`);
  const credit = dock.locator("[data-music-credit]");
  await fx(page, `f.dock.setMusicCredit('"Gymnopedie" Kevin MacLeod (incompetech.com) · CC BY 4.0');`);
  assert.equal(await credit.isVisible(), true, "credit shows while Choir plays music");
  assert.match(await credit.innerText(), /Kevin MacLeod \(incompetech\.com\) · CC BY 4\.0/);
  await fx(page, `f.dock.setMusicCredit(null);`);
  assert.equal(await credit.isVisible(), false, "credit hides when the music stops");

  assert.deepEqual(external, [], "nothing ever left the page");
  console.log("Read-aloud browser checks passed: Choir-only card, default-off zero Choir calls, enable save echo, manual Play/Pause/Stop, each new paragraph read after a gesture, late status after close, Mute narrator, Sound from Choir on by default, card without Choir, music credit, no external requests.");
} finally {
  await browser?.close();
  server.stop(true);
}
