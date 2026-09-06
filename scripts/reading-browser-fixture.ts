import { VnStage } from "../src/frontend/stage/vn-stage.js";
import type { VnTurnInput } from "../src/frontend/store/index.js";

const mount = document.createElement("div");
Object.assign(mount.style, { position: "fixed", inset: "0", background: "#08090d" });
document.body.append(mount);
const params = new URL(location.href).searchParams;
const mode = params.get("mode") === "cyoa" ? "cyoa" : "standard";
const counters = { rerolls: 0, submits: 0, choices: 0, exits: 0 };
const stage = new VnStage({
  mount,
  textSpeed: 0,
  themePreset: (params.get("preset") as never) ?? "lumiverse",
  userCss: params.get("css") ?? "",
  onReroll: () => { counters.rerolls++; },
  onSubmit: async () => { counters.submits++; },
  onChoice: async () => { counters.choices++; },
  onExit: () => { counters.exits++; },
});
const turn: VnTurnInput = {
  mode,
  paragraphs: [0, 1, 2].map((i) => ({ id: `read-${i}`, text: `Paragraph ${i}. The evening settles over the ridge while the lamps come on one by one.`, speaker: `Speaker ${i}` })),
  choices: mode === "cyoa" ? [
    { id: "stay", label: "Stay until sunrise", value: "stay" },
    { id: "return", label: "Head back together", value: "return" },
    { id: "ask", label: "Ask what she wants", value: "ask" },
  ] : [],
};
stage.loadTurn(turn);
Object.assign(window, { readingFixture: { stage, turn, counters } });
