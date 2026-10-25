import { readFile } from "node:fs/promises";

/**
 * Touch mode by hand (docs/SPRITE_MODE.md, "Touch"): the sprite stage
 * fixture (scripts/sprite-stage-browser-fixture.ts) on a fixed port, with
 * Mira (cat ears) and Aoi on stage and a small panel for the settings, the
 * waiting screen and the stand-in backend. Lines come from the fixture's
 * stand-in pack (no model call); bonds are kept in this browser's
 * localStorage so a reload keeps them.
 * Run: bun run ./scripts/sprite-touch-playground.ts  (PORT=5179 by default)
 */
const build = await Bun.build({ entrypoints: ["scripts/sprite-stage-browser-fixture.ts"], target: "browser" });
if (!build.success) throw new Error(String(build.logs));
const bundle = await build.outputs[0]!.text();

const PLAYGROUND = String.raw`
const fx = window.fx;
const KEY = "cue-touch-playground";
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
  Object.assign(fx.touchBackend.bonds, saved.bonds || {});
  Object.assign(fx.touchBackend.packs, saved.packs || {});
} catch {}
setInterval(() => {
  try { localStorage.setItem(KEY, JSON.stringify({ bonds: fx.touchBackend.bonds, packs: fx.touchBackend.packs })); } catch {}
}, 1000);

fx.identity("mira", "blonde twintails, cat ears, maid outfit");
const scene = () => fx.load([
  { speaker: "Mira", text: "Press the hand button (or T), then tap us: the top of the head pats, the sides of the head stroke hair (or my cat ears), cheeks squish, anywhere else pokes.", actors: [{ characterKey: "mira", slot: "left", focus: true }, { characterKey: "aoi", slot: "right", facing: "left" }], plateKey: "plate_park", light: "day" },
  { speaker: "Aoi", text: "Pat the same head three times in a row, or squish someone's cheeks four times. The heart at the top fills slowly and is kept for each of us.", actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "aoi", slot: "right", facing: "left", focus: true }], plateKey: "plate_park", light: "day" },
  { speaker: "Kaede", text: "Three of us now. Escape leaves touch mode; a tap away from everyone reads on.", actors: [{ characterKey: "mira", slot: "left" }, { characterKey: "kaede", slot: "center", focus: true }, { characterKey: "aoi", slot: "right", facing: "left" }], plateKey: "plate_classroom", light: "day" },
]);
scene();

const panel = document.createElement("details");
panel.open = true;
panel.innerHTML = '<summary>Touch playground</summary>'
  + '<div><b>Reactions</b> <button data-i="gentle">Gentle</button><button data-i="normal">Normal</button><button data-i="lively">Lively</button></div>'
  + '<div><label><input type="checkbox" data-touch checked> Touch mode in Settings</label></div>'
  + '<div><label><input type="checkbox" data-lines checked> Lines in character</label></div>'
  + '<div><label><input type="checkbox" data-fail> Line-pack call fails</label></div>'
  + '<div><label><input type="checkbox" data-sounds> Interface sounds</label></div>'
  + '<div><b>Motion</b> <button data-m="full">Full</button><button data-m="gentle">Gentle</button><button data-m="off">Still</button></div>'
  + '<div><button data-waiting>Waiting screen</button><button data-scene>Reload scene</button></div>'
  + '<div><button data-reset>Forget bonds and lines</button></div>'
  + '<pre data-state></pre>';
Object.assign(panel.style, { position: "fixed", top: "8px", right: "8px", zIndex: "2147483647", background: "rgba(16,18,26,.92)", color: "#eee", font: "12px/1.5 system-ui, sans-serif", padding: "6px 10px", borderRadius: "8px", maxWidth: "260px", border: "1px solid #444" });
document.body.append(panel);
const touchSettings = { spriteTouch: true, spriteTouchIntensity: "normal", spriteTouchLines: true };
const apply = () => fx.touch(touchSettings);
panel.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.i) { touchSettings.spriteTouchIntensity = button.dataset.i; apply(); }
  if (button.dataset.m) fx.stage.setEffectIntensity(button.dataset.m);
  if (button.hasAttribute("data-waiting")) fx.stage.previewWaitingScreen();
  if (button.hasAttribute("data-scene")) scene();
  if (button.hasAttribute("data-reset")) {
    for (const key of Object.keys(fx.touchBackend.bonds)) delete fx.touchBackend.bonds[key];
    for (const key of Object.keys(fx.touchBackend.packs)) delete fx.touchBackend.packs[key];
    try { localStorage.removeItem(KEY); } catch {}
    location.reload();
  }
});
panel.addEventListener("change", (event) => {
  const input = event.target;
  if (input.hasAttribute("data-touch")) { touchSettings.spriteTouch = input.checked; apply(); }
  if (input.hasAttribute("data-lines")) { touchSettings.spriteTouchLines = input.checked; apply(); }
  if (input.hasAttribute("data-fail")) fx.touchBackend.failWith = input.checked ? "The connection refused the call." : null;
  if (input.hasAttribute("data-sounds")) fx.feel({ interfaceSounds: input.checked, interfaceSoundVolume: 0.5 });
});
const state = panel.querySelector("[data-state]");
setInterval(() => {
  const snap = fx.stage.getTouchSnapshot();
  const last = snap.last ? snap.last.characterKey + " " + snap.last.zone + " → " + snap.last.mood : "–";
  state.textContent = "touch mode: " + (snap.active ? "on" : "off")
    + "\nlast: " + last
    + "\n" + snap.characters.map((c) => c.name + " ♥" + c.bond + " " + c.tier + " lines:" + c.lines).join("\n")
    + "\nline-pack calls: " + fx.touchBackend.calls.length;
}, 300);
`;

const page = `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cue touch playground</title></head><body style="margin:0"><script type="module" src="/fixture.js"></script><script type="module">${PLAYGROUND}</script></body></html>`;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 5179),
  fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/fixture.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
    if (path.startsWith("/sprites/")) {
      const file = path.slice("/sprites/".length).replace(/[^\w.-]/g, "");
      try { return new Response(await readFile(`scripts/fixtures/sprites/${file}`), { headers: { "Content-Type": "image/webp" } }); }
      catch { return new Response("missing", { status: 404 }); }
    }
    return new Response(page, { headers: { "Content-Type": "text/html" } });
  },
});
console.log(`Touch playground: http://127.0.0.1:${server.port}/  (add ?puppet=css for the CSS puppet)`);
