import { PanelDock } from "../src/frontend/stage/panel-dock.js";
import { renderPanelRule } from "../src/frontend/stage/panel-rules.js";
import type { TurnView } from "../src/protocol.js";
import { VisualNovelSettingsPanel } from "../src/frontend/settings/panel.js";
import { DEFAULT_CONFIG } from "../src/config.js";
const mount = document.createElement("div");
Object.assign(mount.style, { position: "fixed", inset: "0", background: "#08090d" });
document.body.append(mount);
if (new URL(location.href).searchParams.has("settings")) {
  Object.assign(mount.style, { position: "relative", minHeight: "100vh" });
  const fixture = { saved: {} };
  const settings = new VisualNovelSettingsPanel({ mount, onSave: (patch) => { fixture.saved = patch; }, onOpenPreview() {}, onRefreshConnections() {} });
  settings.setConfig({ ...DEFAULT_CONFIG, imageParameters: { steps: 28 }, customCss: "[data-vn-dialogue] { opacity: .9; }", ignoredTags: "status, inventory" });
  Object.assign(window, { settingsFixture: fixture });
} else {
const dock = new PanelDock(mount);
const turn: TurnView = { chatId: "panel-test", messageId: "message-1", swipeId: 0, sourceFingerprint: "source-1", revision: 1, speaker: "Mira", paragraphs: ["First", "Second", "Last"], status: "ready", assets: [], choices: [], panelSource: "[STATUS: Jay]", panels: [{ id: "status", title: "Hero status", followKey: "tag:status", paragraphIndex: 1, html: '<style>#toggle{display:none}.stats{display:none}#toggle:checked~.stats{display:block}.hero{padding:12px;background:#162334;color:#c4dcf3;border:1px solid #54758c}</style><div class="hero"><h2>Jay · Traveler</h2><p>HP 100 / 100</p><input type="checkbox" id="toggle"><label for="toggle">View status</label><div class="stats">Strength 10</div><img src="https://example.com/blocked.png"><script>parent.compromised=true</script><svg onload="parent.compromised=true"><circle r="4"/></svg></div>' }] };
dock.setTurn(turn);
Object.assign(window, { fixture: { dock, turn, renderPanelRule } });
}
