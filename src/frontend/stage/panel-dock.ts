import type { TurnView } from "../../protocol.js";
import { MAX_PANELS, PanelArtifactSchema, panelHash, type PanelArtifact } from "../../shared/panels.js";
import { panelDocument } from "./panel-document.js";
import { renderPanelRule, type PanelRule } from "./panel-rules.js";

type Pin = { key: string; follow: string | null; card: PanelArtifact; message: string; fingerprint: string; x: number; y: number; width: number; height: number; collapsed: boolean; remote: boolean };
type Capture = { title: string; html: string };
const PIN_ICON = "📌";

export function clampPanel(value: number, maximum: number): number {
  return Math.max(0, Math.min(Number.isFinite(value) ? value : 0, Math.max(0, maximum)));
}

const CSS = `
:host{position:absolute;inset:0;pointer-events:none;z-index:7;font:13px/1.45 system-ui;color:#eeeef4;--edge:#535565;--ink:#eeeef4;--muted:#b2b3c3;--paper:#171822;--accent:#c1b0eb}
button,input,textarea{font:inherit;color:inherit}button{cursor:pointer;background:#252632;border:1px solid var(--edge);border-radius:6px;padding:7px 10px;min-height:34px}button:hover{border-color:var(--accent)}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.launcher{position:absolute;top:max(12px,env(safe-area-inset-top));left:max(12px,env(safe-area-inset-left));pointer-events:auto;border-radius:20px;min-height:44px;background:#171822ed}
.drawer{position:absolute;top:64px;left:12px;width:min(390px,calc(100% - 24px));max-height:calc(100% - 80px);overflow:auto;pointer-events:auto;background:var(--paper);border:1px solid var(--edge);border-radius:10px;padding:14px;box-shadow:0 12px 36px #0008;z-index:100}
[hidden]{display:none!important}h2{font:600 18px/1.2 Georgia,serif;margin:0 0 10px}p{margin:8px 0;color:var(--muted)}small{color:var(--muted)}.row{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.candidate{border-top:1px solid var(--edge);padding:8px 0}.candidate strong{display:block}.candidate button{margin:6px 5px 0 0}label{display:block;margin:8px 0}input:not([type=checkbox]),textarea{box-sizing:border-box;width:100%;background:#101119;border:1px solid var(--edge);border-radius:4px;padding:8px}textarea{min-height:90px;font:12px/1.5 ui-monospace,monospace}summary{cursor:pointer;padding:8px 0}.notice{white-space:pre-wrap;color:#e5c38d}
.pin{position:absolute;pointer-events:auto;display:flex;flex-direction:column;box-sizing:border-box;border:1px solid var(--edge);border-radius:8px;overflow:hidden;background:#171822f5;box-shadow:0 6px 24px #0005}.bar{display:flex;align-items:center;gap:4px;padding:4px;flex-shrink:0}.handle{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:grab;touch-action:none;border:0;background:transparent}.bar button{padding:4px 7px}.body{flex:1;min-height:0;display:flex;flex-direction:column}.body iframe{border:0;width:100%;flex:1;min-height:0;background:transparent}.state{padding:3px 8px;font-size:11px;color:var(--muted)}.resize{position:absolute;bottom:0;right:0;width:24px;height:24px;min-height:24px;padding:0;border-radius:6px 0 0 0;cursor:nwse-resize;touch-action:none}.remote{font-size:11px;padding:0 8px;margin:3px 0}.waiting{padding:12px;color:var(--muted)}
@media(max-width:560px){button{min-height:40px}.drawer{top:62px}.bar button{min-height:36px}}
`;

export class PanelDock {
  private host = document.createElement("div");
  private root = this.host.attachShadow({ mode: "open" });
  private launcher = document.createElement("button");
  private drawer = document.createElement("section");
  private list = document.createElement("div");
  private notice = document.createElement("p");
  private pins: Pin[] = [];
  private rules: PanelRule[] = [];
  private candidates: PanelArtifact[] = [];
  private nodes = new Map<string, HTMLElement>();
  private turn: TurnView | null = null;
  private cursor = 0;
  private epoch = 0;
  private chat = "";
  private dead = false;
  private observer: ResizeObserver;
  private bridgeRevision = new Map<string, number>();
  onCapture: (() => Capture[]) | undefined;
  onResolveTemplate: ((template: string) => Promise<string>) | undefined;

  constructor(mount: HTMLElement) {
    this.host.setAttribute("data-vn-panel-layer", "");
    const style = document.createElement("style"); style.textContent = CSS;
    this.launcher.className = "launcher";
    this.launcher.textContent = "Panels";
    this.launcher.setAttribute("aria-expanded", "false");
    this.drawer.className = "drawer"; this.drawer.hidden = true;
    this.drawer.setAttribute("aria-label", "Pinned panels");
    this.notice.className = "notice"; this.notice.setAttribute("role", "status");
    const heading = document.createElement("h2"); heading.textContent = "Pinned panels";
    const description = document.createElement("p");
    description.textContent = "Keep a card, or follow a named status source. Drag its title to move it. Pins and rules are saved for this chat in this browser.";
    const capture = this.button("Capture SimTracker snapshot", () => this.capture());
    const reset = this.button("Reset positions", () => { this.pins.forEach((pin, i) => { pin.x = i % 2; pin.y = Math.min(.8, Math.floor(i / 2) * .12); pin.width = 300; pin.height = 320; }); this.layout(); this.save(); });
    const clear = this.button("Unpin all", () => { this.pins = []; this.renderPins(); this.save(); });
    const refresh = this.button("Refresh live sources", () => this.requestBridge());
    const close = this.button("Close", () => this.toggle(false));
    const actions = document.createElement("div"); actions.className = "row"; actions.append(capture, refresh, reset, clear, close);
    this.drawer.append(heading, description, actions, this.notice, this.list, this.importForm(), this.ruleForm());
    this.root.append(style, this.launcher, this.drawer); mount.append(this.host);
    this.launcher.onclick = () => this.toggle(Boolean(this.drawer.hidden));
    // This layer is outside the stage's narrative root. Also stop host-level shortcuts.
    for (const event of ["click", "pointerdown", "keydown", "wheel"]) this.host.addEventListener(event, (e) => e.stopPropagation());
    this.root.addEventListener("keydown", (event) => { if ((event as KeyboardEvent).key === "Escape") { this.toggle(false); this.launcher.focus(); } });
    this.observer = new ResizeObserver(() => this.layout()); this.observer.observe(mount);
    window.addEventListener("vn-panel-export-v1", this.receiveBridge);
  }

  private button(text: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button"); button.type = "button"; button.textContent = text; button.onclick = action; return button;
  }
  private toggle(open: boolean): void { this.drawer.hidden = !open; this.launcher.setAttribute("aria-expanded", String(open)); }
  private error(error: unknown): void { this.notice.textContent = error instanceof Error ? error.message : String(error); }
  private storageKey(): string { return `vn-panels-v1:${this.chat}`; }
  private save(): void {
    if (!this.chat) return;
    try { localStorage.setItem(this.storageKey(), JSON.stringify({ pins: this.pins, rules: this.rules })); }
    catch { this.error("Browser storage is full or unavailable. These changes will last only for this session."); }
  }
  private load(): void {
    this.pins = []; this.rules = [];
    try {
      const data = JSON.parse(localStorage.getItem(this.storageKey()) ?? "{}");
      for (const pin of Array.isArray(data.pins) ? data.pins.slice(0, MAX_PANELS) : []) {
        if (!PanelArtifactSchema.safeParse(pin.card).success || typeof pin.key !== "string" || typeof pin.message !== "string" || typeof pin.fingerprint !== "string") continue;
        if (pin.follow !== null && typeof pin.follow !== "string") continue;
        this.pins.push({ ...pin, x: clampPanel(pin.x, 1), y: clampPanel(pin.y, 1), width: clampPanel(pin.width, 900) || 300, height: clampPanel(pin.height, 900) || 320, collapsed: !!pin.collapsed, remote: false });
      }
      for (const rule of Array.isArray(data.rules) ? data.rules.slice(0, 12) : []) {
        if ([rule.id, rule.title, rule.pattern, rule.flags, rule.template].every((value) => typeof value === "string") && rule.template.length <= 100_000 && rule.pattern.length <= 4000) this.rules.push(rule);
      }
    } catch { this.error("Saved panels could not be loaded. You can pin new cards."); }
  }

  setTurn(turn: TurnView | null, cursor = 0): void {
    const changedChat = (turn?.chatId ?? "") !== this.chat;
    const changedSource = !this.turn || !turn || this.turn.messageId !== turn.messageId || this.turn.sourceFingerprint !== turn.sourceFingerprint;
    this.turn = turn; this.cursor = cursor;
    if (changedChat) { this.chat = turn?.chatId ?? ""; this.load(); this.notice.textContent = ""; }
    if (changedSource || changedChat) {
      this.epoch++; this.bridgeRevision.clear();
      this.candidates = [...(turn?.panels ?? [])];
      // Source changes must not display stale live state from another swipe or turn.
      for (const pin of this.pins) if (pin.follow) pin.fingerprint = "";
      for (const node of this.nodes.values()) node.remove();
      this.nodes.clear();
      this.renderPins();
    }
    this.refresh();
    if (turn && changedSource) this.requestBridge();
  }
  setCursor(cursor: number): void { this.cursor = cursor; this.refresh(); }
  private refresh(): void {
    const visible = this.candidates.filter((card) => card.paragraphIndex <= this.cursor);
    for (const pin of this.pins) {
      if (!pin.follow || !this.turn) continue;
      const latest = visible.filter((card) => card.followKey === pin.follow).at(-1);
      if (latest && (pin.card.html !== latest.html || pin.fingerprint !== this.turn.sourceFingerprint)) {
        pin.card = latest; pin.message = this.turn.messageId; pin.fingerprint = this.turn.sourceFingerprint;
        this.nodes.get(pin.key)?.remove(); this.nodes.delete(pin.key);
      }
    }
    this.list.replaceChildren();
    this.launcher.textContent = `Panels${visible.length ? ` · ${visible.length}` : ""}`;
    if (!visible.length) { const p = document.createElement("p"); p.textContent = "No cards revealed yet. You can paste HTML below or capture a mounted SimTracker card. Extraction applies to newly planned replies; older cached turns may have no card source."; this.list.append(p); }
    for (const card of visible) {
      const row = document.createElement("div"); row.className = "candidate";
      const label = document.createElement("strong"); label.textContent = card.title;
      row.append(label, this.button("Keep this card", () => this.pin(card, false)));
      if (card.followKey) row.append(this.button("Follow updates", () => this.pin(card, true)));
      this.list.append(row);
    }
    for (const rule of this.rules) {
      const row = document.createElement("div"); row.className = "candidate";
      const label = document.createElement("span"); label.textContent = `Rule: ${rule.title} `;
      row.append(label, this.button("Remove rule", () => { this.rules = this.rules.filter((r) => r.id !== rule.id); this.candidates = this.candidates.filter((c) => !c.id.startsWith(`rule:${rule.id}:`)); this.epoch++; for (const pin of this.pins) if (pin.follow === `rule:${rule.id}`) { pin.fingerprint = ""; this.nodes.get(pin.key)?.remove(); this.nodes.delete(pin.key); } this.save(); this.refresh(); }));
      this.list.append(row);
    }
    this.renderPins();
  }
  private pin(card: PanelArtifact, follow: boolean): void {
    if (!this.turn) { this.error("Open an assistant turn before pinning a card."); return; }
    const key = follow ? `follow:${card.followKey}` : `snapshot:${this.turn.messageId}:${panelHash(card.html)}`;
    if (this.pins.some((p) => p.key === key)) { this.error("That card is already pinned."); return; }
    if (this.pins.length >= MAX_PANELS) { this.error("Unpin a card before adding another. The limit is 12."); return; }
    try { panelDocument(card.html); } catch (e) { this.error(e); return; }
    this.pins.push({ key, follow: follow ? card.followKey ?? null : null, card, message: this.turn.messageId, fingerprint: this.turn.sourceFingerprint, x: this.pins.length % 2, y: Math.min(.8, Math.floor(this.pins.length / 2) * .12), width: 300, height: 320, collapsed: false, remote: false });
    this.renderPins(); this.save(); this.toggle(false);
  }

  private renderPins(): void {
    for (const [key, node] of this.nodes) if (!this.pins.some((p) => p.key === key)) { node.remove(); this.nodes.delete(key); }
    for (const pin of this.pins) {
      if (this.nodes.has(pin.key)) continue;
      const node = document.createElement("section"); node.className = "pin"; node.setAttribute("aria-label", pin.card.title);
      node.onpointerdown = () => { for (const other of this.nodes.values()) other.style.zIndex = "1"; node.style.zIndex = "2"; };
      const bar = document.createElement("div"); bar.className = "bar";
      const handle = this.button(pin.card.title, () => {}); handle.className = "handle";
      handle.title = "Drag to move. Arrow keys move; Shift + arrows resize.";
      const collapse = this.button(pin.collapsed ? "+" : "−", () => { pin.collapsed = !pin.collapsed; this.rebuild(pin); this.save(); }); collapse.setAttribute("aria-label", "Collapse or expand panel");
      const unpin = this.button(PIN_ICON, () => { this.pins = this.pins.filter((p) => p !== pin); this.renderPins(); this.save(); }); unpin.setAttribute("aria-label", "Unpin panel"); unpin.title = "Unpin panel";
      bar.append(handle, collapse, unpin); node.append(bar);
      const body = document.createElement("div"); body.className = "body"; body.hidden = pin.collapsed;
      const state = document.createElement("div"); state.className = "state"; state.textContent = pin.follow ? "Following this source · updates appear when revealed" : "Saved snapshot · does not update"; body.append(state);
      const valid = !pin.follow || (pin.fingerprint === this.turn?.sourceFingerprint && pin.message === this.turn?.messageId);
      if (valid) {
        try {
          const frame = document.createElement("iframe"); frame.title = pin.card.title; frame.setAttribute("sandbox", ""); frame.referrerPolicy = "no-referrer"; frame.srcdoc = panelDocument(pin.card.html, pin.remote); body.append(frame);
          const remoteLabel = document.createElement("label"); remoteLabel.className = "remote";
          const remote = document.createElement("input"); remote.type = "checkbox"; remote.checked = pin.remote;
          remote.onchange = () => { pin.remote = remote.checked; frame.srcdoc = panelDocument(pin.card.html, pin.remote); };
          remoteLabel.append(remote, " Allow remote images/fonts (contacts third-party sites)"); body.append(remoteLabel);
        } catch (error) { const p = document.createElement("p"); p.textContent = String(error); body.append(p); }
      } else { const p = document.createElement("p"); p.className = "waiting"; p.textContent = "Waiting for this source in the current turn. Previous-turn values are hidden."; body.append(p); }
      const resize = this.button("◢", () => {}); resize.className = "resize"; resize.setAttribute("aria-label", "Resize panel with arrow keys or drag"); resize.hidden = pin.collapsed;
      node.append(body, resize); this.root.append(node); this.nodes.set(pin.key, node);
      this.drag(handle, pin, false); this.drag(resize, pin, true);
    }
    this.layout();
  }
  private rebuild(pin: Pin): void { this.nodes.get(pin.key)?.remove(); this.nodes.delete(pin.key); this.renderPins(); }
  private layout(): void {
    const box = this.host.getBoundingClientRect();
    for (const pin of this.pins) {
      const node = this.nodes.get(pin.key); if (!node) continue;
      const width = Math.min(Math.max(180, pin.width), Math.max(0, box.width - 24));
      const height = pin.collapsed ? 46 : Math.min(Math.max(140, pin.height), Math.max(0, box.height - 80));
      Object.assign(node.style, { width: `${width}px`, height: `${height}px`, left: `${12 + clampPanel(pin.x, 1) * Math.max(0, box.width - width - 24)}px`, top: `${64 + clampPanel(pin.y, 1) * Math.max(0, box.height - height - 80)}px` });
    }
  }
  private drag(handle: HTMLButtonElement, pin: Pin, resizing: boolean): void {
    const move = (dx: number, dy: number, resize: boolean) => {
      const box = this.host.getBoundingClientRect();
      if (resize) { pin.width = Math.max(180, Math.min(box.width - 24, pin.width + dx)); pin.height = Math.max(140, Math.min(box.height - 80, pin.height + dy)); }
      else { pin.x = clampPanel(pin.x + dx / Math.max(1, box.width - Math.min(pin.width, box.width - 24) - 24), 1); pin.y = clampPanel(pin.y + dy / Math.max(1, box.height - (pin.collapsed ? 46 : Math.min(pin.height, box.height - 80)) - 80), 1); }
      this.layout();
    };
    handle.onkeydown = (event) => {
      const delta: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
      const d = delta[event.key]; if (!d) return; event.preventDefault(); move(d[0], d[1], resizing || event.shiftKey); this.save();
    };
    handle.onpointerdown = (event) => {
      if (event.button !== 0) return; event.preventDefault(); handle.setPointerCapture(event.pointerId);
      let x = event.clientX, y = event.clientY;
      handle.onpointermove = (e) => { move(e.clientX - x, e.clientY - y, resizing); x = e.clientX; y = e.clientY; };
      const done = () => { handle.onpointermove = null; this.save(); };
      handle.onpointerup = done; handle.onpointercancel = done; handle.onlostpointercapture = done;
    };
  }

  private importForm(): HTMLElement {
    const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "Paste rendered HTML or SVG";
    const text = document.createElement("textarea"); text.setAttribute("aria-label", "Rendered HTML or SVG"); text.maxLength = 100_000;
    const help = document.createElement("p"); help.textContent = "Use rendered markup, not a template with host macros. Scripts and navigation are disabled. Remote assets start blocked.";
    details.append(summary, help, text, this.button("Pin pasted card", () => this.pin({ id: `paste:${panelHash(text.value)}`, title: "Imported card", html: text.value, paragraphIndex: 0 }, false)));
    return details;
  }
  private ruleForm(): HTMLElement {
    const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "Add status template rule";
    const help = document.createElement("p"); help.textContent = "Rules create panels from this chat's source text (first 200,000 characters). They do not hide dialogue or exclude image planning. Use Ignored tags for that. Matches appear at the end of the turn to avoid spoilers. Language and other host macros are resolved without committing variable changes. Multiple matches are snapshots; use a more specific pattern to follow one entity.";
    const field = (label: string, multiline = false) => { const wrapper = document.createElement("label"); wrapper.textContent = label; const input = document.createElement(multiline ? "textarea" : "input"); wrapper.append(input); details.append(wrapper); return input; };
    details.append(summary, help);
    const title = field("Rule name"); const pattern = field("Regex pattern (without / delimiters)", true); const flags = field("Flags"); flags.value = "gi";
    const template = field("HTML replacement ($1, $2, ... $36)", true);
    details.append(this.button("Save and test rule", () => {
      if (!this.turn) { this.error("Open an assistant turn before saving a panel rule."); return; }
      if (!title.value.trim() || !pattern.value || !template.value) { this.error("Fill in the rule name, pattern, and HTML replacement."); return; }
      if (this.rules.length >= 12) { this.error("Remove a rule before adding another. The limit is 12."); return; }
      const rule: PanelRule = { id: crypto.randomUUID(), title: title.value.trim().slice(0, 120), pattern: pattern.value, flags: flags.value, template: template.value };
      this.rules.push(rule); this.epoch++; this.save(); void this.runRules();
    }));
    return details;
  }
  private async runRules(): Promise<void> {
    const turn = this.turn; if (!turn) return;
    const epoch = this.epoch;
    for (const rule of this.rules) {
      try {
        let resolvedRule = rule;
        if (rule.template.includes("{{")) {
          if (!this.onResolveTemplate) throw new Error("Host macro resolution is unavailable. Paste rendered HTML instead.");
          resolvedRule = { ...rule, template: await this.onResolveTemplate(rule.template) };
          if (this.dead || epoch !== this.epoch) return;
        }
        const cards = await renderPanelRule(turn.panelSource ?? turn.paragraphs.join("\n\n"), resolvedRule, Math.max(0, turn.paragraphs.length - 1));
        if (this.dead || epoch !== this.epoch) return;
        this.candidates = this.candidates.filter((c) => !c.id.startsWith(`rule:${rule.id}:`));
        this.candidates.push(...cards);
        if (!cards.length) this.error(`No match for rule "${rule.title}" in this turn.`);
      } catch (error) { if (epoch === this.epoch && !this.dead) this.error(error); }
    }
    if (epoch === this.epoch && !this.dead) this.refresh();
  }
  private capture(): void {
    const cards = this.onCapture?.() ?? [];
    if (!cards.length) { this.error("No mounted SimTracker card found. Capture before opening VN, use pasted HTML, or install a compatible live export bridge. Snapshot capture cannot follow updates."); return; }
    this.candidates = this.candidates.filter((c) => !c.id.startsWith("capture:"));
    for (const card of cards.slice(0, 12)) this.candidates.push({ id: `capture:${panelHash(card.html)}`, title: `${card.title} · snapshot`, html: card.html, paragraphIndex: this.cursor });
    this.refresh();
  }
  private requestBridge(): void {
    const turn = this.turn; if (!turn) return;
    this.epoch++;
    void this.runRules();
    window.dispatchEvent(new CustomEvent("vn-panel-request-v1", { detail: { version: 1, chatId: turn.chatId, messageId: turn.messageId, swipeId: turn.swipeId, sourceFingerprint: turn.sourceFingerprint } }));
  }
  private receiveBridge = (event: Event): void => {
    // Explicit versioned companion contract. Never treat arbitrary window messages as cards.
    const data = (event as CustomEvent).detail;
    const turn = this.turn;
    if (!turn || !data || data.version !== 1 || data.provider !== "simtracker" || data.chatId !== turn.chatId || data.messageId !== turn.messageId || data.sourceFingerprint !== turn.sourceFingerprint || data.swipeId !== turn.swipeId) return;
    if (typeof data.cardId !== "string" || data.cardId.length > 100 || !Number.isSafeInteger(data.revision) || data.revision < 0) return;
    const key = `simtracker:${data.cardId}`;
    if (!this.bridgeRevision.has(key) && this.bridgeRevision.size >= MAX_PANELS) return;
    if (data.revision <= (this.bridgeRevision.get(key) ?? -1)) return;
    if (data.status !== "removed" && data.status !== "ready") return;
    const parsed = PanelArtifactSchema.safeParse({ id: key, title: data.title, html: data.html, paragraphIndex: Math.max(0, turn.paragraphs.length - 1), followKey: key });
    if (data.status === "ready" && !parsed.success) return;
    this.bridgeRevision.set(key, data.revision);
    this.candidates = this.candidates.filter((c) => c.followKey !== key);
    if (data.status === "ready" && parsed.success) this.candidates.push(parsed.data);
    else for (const pin of this.pins) if (pin.follow === key) { pin.fingerprint = ""; this.nodes.get(pin.key)?.remove(); this.nodes.delete(pin.key); }
    this.refresh();
  };
  destroy(): void { this.dead = true; this.epoch++; this.observer.disconnect(); window.removeEventListener("vn-panel-export-v1", this.receiveBridge); this.host.remove(); }
}
