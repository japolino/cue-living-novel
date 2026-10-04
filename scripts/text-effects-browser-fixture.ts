import { VnStage } from "../src/frontend/stage/vn-stage.js";
import { formatDialogueText } from "../src/frontend/stage/rich-text.js";
import { applyTextEffects } from "../src/frontend/stage/text-effects.js";
import { VN_TEXT_EFFECTS_CSS } from "../src/frontend/theme/text-effects-css.js";
import { TEXT_EFFECT_CATALOGUE } from "../src/shared/text-effects.js";

/**
 * Browser fixture for inline text effects (scripts/test-text-effects-browser.ts).
 * ?view=stage (default): a VnStage with ?preset, ?speed, ?text, ?tfx.
 * ?view=card: a standalone reference card in its own shadow root that uses
 * only formatDialogueText + applyTextEffects + VN_TEXT_EFFECTS_CSS.
 */
const q = new URL(location.href).searchParams;
const view = q.get("view") ?? "stage";

if (view === "card") {
  const host = document.createElement("div");
  host.id = "card";
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${VN_TEXT_EFFECTS_CSS}
    [data-card] { font: 20px/1.5 system-ui, sans-serif; background: #14121b; color: #f2eefa; padding: 16px; }`;
  const card = document.createElement("div");
  card.dataset.card = "";
  card.innerHTML = TEXT_EFFECT_CATALOGUE.map((effect) => `<p data-id="${effect.id}">${formatDialogueText(effect.example)}</p>`).join("");
  applyTextEffects(card);
  shadow.append(style, card);
} else {
  const mount = document.createElement("div");
  Object.assign(mount.style, { position: "fixed", inset: "0", background: "#08090d" });
  document.body.append(mount);
  const stage = new VnStage({
    mount,
    textSpeed: Number(q.get("speed") ?? 0),
    themePreset: (q.get("preset") as never) ?? "lumiverse",
    onReroll: () => {}, onSubmit: async () => {}, onChoice: async () => {}, onExit: () => {},
  });
  const tfx = q.get("tfx");
  if (tfx) stage.setTextEffects(tfx as never);
  const text = q.get("text") ?? '"<shout>STOP!</shout>" <rainbow><wave>la la la</wave></rainbow> <glow>light</glow> <whisper>quiet</whisper>';
  stage.loadTurn({
    mode: "standard",
    paragraphs: [
      { id: "p0", speaker: "Mira", text },
      { id: "p1", speaker: "Mira", text: "Next line." },
    ],
  } as never);
  Object.assign(window, { fx: { stage } });
}
