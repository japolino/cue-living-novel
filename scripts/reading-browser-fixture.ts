import { VnStage } from "../src/frontend/stage/vn-stage.js";
import type { VnTurnInput } from "../src/frontend/store/index.js";
import { PanelDock } from "../src/frontend/stage/panel-dock.js";

const params = new URL(location.href).searchParams;
// Emulate the Lumiverse host: body > * { zoom: var(--lumiverse-ui-scale) } and a
// scale-compensated app root, exactly as frontend/src/App.module.css does.
const uiScale = Number(params.get("uiScale") ?? "1") || 1;
document.documentElement.style.setProperty("--lumiverse-ui-scale", String(uiScale));
const zoomStyle = document.createElement("style");
zoomStyle.textContent = "body > * { zoom: var(--lumiverse-ui-scale, 1); }";
document.head.append(zoomStyle);
const appRoot = document.createElement("div");
appRoot.setAttribute("data-app-root", "");
Object.assign(appRoot.style, { position: "fixed", inset: "0", width: "calc(100vw / var(--lumiverse-ui-scale, 1))", height: "calc(100dvh / var(--lumiverse-ui-scale, 1))", background: "#1a1a1a" });
document.body.append(appRoot);
const mount = document.createElement("div");
// Same inline sizing the host controller applies to app.root (see src/frontend/host/controller.ts).
Object.assign(mount.style, { position: "fixed", inset: "0", width: "100%", height: "calc(100dvh / var(--lumiverse-ui-scale, 1))", background: "#08090d" });
appRoot.append(mount);
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
// The host mounts the pinned-panel dock (with its "Panels" launcher) on the stage, as in src/frontend/host/controller.ts.
const panels = new PanelDock(stage.panelMount);
Object.assign(window, { readingFixture: { stage, turn, counters, panels } });
