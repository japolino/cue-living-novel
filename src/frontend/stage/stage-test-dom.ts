/**
 * Tiny DOM stand-in for stage unit tests. It parses the real THEME_MARKUP
 * (tags, attributes, text) so tests see the same structure the browser gets,
 * and supports the selector subset the stage uses.
 */

type Listener = (event: FakeEvent) => void;

export class FakeEvent {
  defaultPrevented = false;
  propagationStopped = false;
  target: FakeNode | null = null;
  key = "";
  altKey = false;
  ctrlKey = false;
  metaKey = false;
  deltaY = 0;
  constructor(public type: string, init: Partial<FakeEvent> = {}) {
    Object.assign(this, init);
  }
  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.propagationStopped = true; }
}

const toCamel = (name: string): string => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const toKebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export class FakeNode {
  tagName: string;
  attributes = new Map<string, string>();
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  listeners = new Map<string, Listener[]>();
  private text = "";
  hidden = false;
  disabled = false;
  offsetWidth = 100;
  scrollTop = 0;
  scrollHeight = 0;
  type = "";
  value = "";
  placeholder = "";
  title = "";
  readonly dataset: Record<string, string>;
  readonly style: Record<string, string> & { setProperty(name: string, value: string): void };
  readonly classList: { add(...n: string[]): void; remove(...n: string[]): void; contains(n: string): boolean };

  constructor(tagName: string, text = "") {
    this.tagName = tagName.toUpperCase();
    this.text = text;
    const node = this;
    this.dataset = new Proxy({} as Record<string, string>, {
      get: (_, key) => (typeof key === "string" ? node.attributes.get(`data-${toKebab(key)}`) : undefined),
      set: (_, key, value) => { if (typeof key === "string") node.attributes.set(`data-${toKebab(key)}`, String(value)); return true; },
      deleteProperty: (_, key) => { if (typeof key === "string") node.attributes.delete(`data-${toKebab(key)}`); return true; },
      has: (_, key) => typeof key === "string" && node.attributes.has(`data-${toKebab(key)}`),
      ownKeys: () => Array.from(node.attributes.keys()).filter((k) => k.startsWith("data-")).map((k) => toCamel(k.slice(5))),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
    const styleStore: Record<string, string> = {};
    this.style = Object.assign(styleStore, { setProperty: (name: string, value: string) => { styleStore[name] = value; } });
    const classes = () => new Set((node.attributes.get("class") ?? "").split(/\s+/).filter(Boolean));
    const write = (set: Set<string>) => { if (set.size) node.attributes.set("class", Array.from(set).join(" ")); else node.attributes.delete("class"); };
    this.classList = {
      add: (...names) => { const s = classes(); names.forEach((n) => s.add(n)); write(s); },
      remove: (...names) => { const s = classes(); names.forEach((n) => s.delete(n)); write(s); },
      contains: (name) => classes().has(name),
    };
  }

  get isText(): boolean { return this.tagName === "#TEXT"; }
  get className(): string { return this.attributes.get("class") ?? ""; }
  set className(value: string) { if (value) this.attributes.set("class", value); else this.attributes.delete("class"); }
  get id(): string { return this.attributes.get("id") ?? ""; }
  get childNodes(): FakeNode[] { return this.children; }
  get childElementCount(): number { return this.children.filter((c) => !c.isText).length; }
  get parentElement(): FakeNode | null { return this.parentNode; }
  get lastChild(): FakeNode | null { return this.children[this.children.length - 1] ?? null; }
  get firstElementChild(): FakeNode | null { return this.children.find((c) => !c.isText) ?? null; }
  get src(): string { return this.getAttribute("src") ?? ""; }
  set src(v: string) { if (v) this.setAttribute("src", v); else this.removeAttribute("src"); }
  get alt(): string { return this.getAttribute("alt") ?? ""; }
  set alt(v: string) { this.setAttribute("alt", v); }

  get textContent(): string {
    if (this.isText) return this.text;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(value: string) {
    if (this.isText) { this.text = value; return; }
    this.children = [];
    if (value) this.appendChild(new FakeNode("#text", value));
  }

  get innerHTML(): string {
    if (this.isText) return escape(this.text);
    return this.children.map((c) => c.outerHTML).join("");
  }
  set innerHTML(html: string) {
    this.children = [];
    for (const child of parseHtml(html)) this.appendChild(child);
  }
  get outerHTML(): string {
    if (this.isText) return escape(this.text);
    const attrs = Array.from(this.attributes.entries()).map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${v}"`)).join("");
    const tag = this.tagName.toLowerCase();
    return `<${tag}${attrs}>${this.innerHTML}</${tag}>`;
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, String(value)); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  removeAttribute(name: string): void { this.attributes.delete(name); }

  append(...nodes: Array<FakeNode | string>): void {
    for (const n of nodes) this.appendChild(typeof n === "string" ? new FakeNode("#text", n) : n);
  }
  appendChild(node: FakeNode): FakeNode { node.remove(); node.parentNode = this; this.children.push(node); return node; }
  prepend(...nodes: FakeNode[]): void {
    for (const node of [...nodes].reverse()) { node.remove(); node.parentNode = this; this.children.unshift(node); }
  }
  remove(): void {
    if (!this.parentNode) return;
    const idx = this.parentNode.children.indexOf(this);
    if (idx !== -1) this.parentNode.children.splice(idx, 1);
    this.parentNode = null;
  }
  replaceChildren(...nodes: FakeNode[]): void { this.children = []; for (const n of nodes) this.appendChild(n); }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((l) => l !== listener));
  }
  /** Bubbles like the browser: target first, then ancestors, unless stopped. */
  dispatchEvent(event: FakeEvent): boolean {
    event.target ??= this;
    let node: FakeNode | null = this;
    while (node && !event.propagationStopped) {
      for (const l of node.listeners.get(event.type) ?? []) l(event);
      node = node.parentNode;
    }
    return !event.defaultPrevented;
  }
  click(): void {
    if (this.disabled) return;
    this.dispatchEvent(new FakeEvent("click"));
  }
  focus(): void { FakeDocument.activeElement = this; }
  blur(): void { if (FakeDocument.activeElement === this) FakeDocument.activeElement = null; }
  requestSubmit(): void { this.dispatchEvent(new FakeEvent("submit")); }
  attachShadow(): FakeNode { const s = new FakeNode("#shadow-root"); this.appendChild(s); return s; }

  matches(selector: string): boolean {
    return selector.split(",").some((part) => matchesComplex(this, part.trim()));
  }
  closest(selector: string): FakeNode | null {
    let node: FakeNode | null = this;
    while (node) { if (!node.isText && node.matches(selector)) return node; node = node.parentNode; }
    return null;
  }
  querySelector(selector: string): FakeNode | null { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector: string): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode) => { for (const c of n.children) { if (!c.isText && c.matches(selector)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
}

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescape(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

const VOID_TAGS = new Set(["img", "br", "hr", "input", "circle", "path", "rect", "line", "ellipse", "use", "stop", "polygon", "polyline"]);

/** Minimal well-formed HTML parser: tags, attributes, text, comments ignored. */
export function parseHtml(html: string): FakeNode[] {
  const root = new FakeNode("#fragment");
  const stack: FakeNode[] = [root];
  const tokens = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[\w:@.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(html))) {
    if (match[0].startsWith("<!--")) continue;
    const [, closeTag, openTag, attrText, selfClose, text] = match;
    if (text !== undefined) {
      const trimmed = text.replace(/^\s+$/, "");
      if (trimmed) stack[stack.length - 1]!.appendChild(new FakeNode("#text", unescape(text)));
      continue;
    }
    if (closeTag) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tagName === closeTag.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    if (openTag) {
      const node = new FakeNode(openTag);
      const attrRe = /([\w:@.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(attrText ?? ""))) {
        node.attributes.set(a[1]!, unescape(a[2] ?? a[3] ?? a[4] ?? ""));
      }
      if (node.tagName === "BUTTON" && !node.attributes.has("type")) node.type = "submit";
      if (node.attributes.has("type")) node.type = node.attributes.get("type")!;
      if (node.attributes.has("hidden")) node.hidden = true;
      if (node.attributes.has("disabled")) node.disabled = true;
      if (node.attributes.has("title")) node.title = node.attributes.get("title")!;
      stack[stack.length - 1]!.appendChild(node);
      if (!selfClose && !VOID_TAGS.has(openTag.toLowerCase())) stack.push(node);
    }
  }
  return [...root.children].map((c) => { c.parentNode = null; return c; });
}

function matchesComplex(node: FakeNode, selector: string): boolean {
  const parts = selector.split(/\s+(?![^\[]*\])/).filter(Boolean);
  const direct = parts.indexOf(">");
  if (direct !== -1) {
    const left = parts.slice(0, direct).join(" ");
    const right = parts.slice(direct + 1).join(" ");
    if (!matchesComplex(node, right)) return false;
    const parent = node.parentNode;
    return Boolean(parent && !parent.isText && matchesComplex(parent, left));
  }
  if (!matchesCompound(node, parts[parts.length - 1]!)) return false;
  let ancestor = node.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    while (ancestor && !(matchesCompound(ancestor, parts[i]!))) ancestor = ancestor.parentNode;
    if (!ancestor) return false;
    ancestor = ancestor.parentNode;
  }
  return true;
}

function matchesCompound(node: FakeNode, compound: string): boolean {
  if (node.isText) return false;
  let rest = compound;
  const tag = /^([a-zA-Z*][\w-]*)/.exec(rest);
  if (tag) {
    if (tag[1] !== "*" && node.tagName !== tag[1]!.toUpperCase()) return false;
    rest = rest.slice(tag[0].length);
  }
  const re = /^(?:\.([\w-]+)|#([\w-]+)|\[([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|:not\(([^)]*)\)|:(disabled|enabled|empty))/;
  while (rest.length) {
    const m = re.exec(rest);
    if (!m) throw new Error(`Unsupported selector piece: ${rest}`);
    rest = rest.slice(m[0].length);
    if (m[1]) {
      if (!node.classList.contains(m[1])) return false;
    } else if (m[2]) {
      if (node.id !== m[2]) return false;
    } else if (m[3]) {
      const expected = m[4] ?? m[5] ?? m[6];
      if (!node.attributes.has(m[3])) return false;
      if (expected !== undefined && node.attributes.get(m[3]) !== expected) return false;
    } else if (m[7] !== undefined) {
      if (matchesCompound(node, m[7])) return false;
    } else if (m[8]) {
      if (m[8] === "disabled" && !node.disabled) return false;
      if (m[8] === "enabled" && node.disabled) return false;
      if (m[8] === "empty" && node.children.length > 0) return false;
    }
  }
  return true;
}

export const FakeDocument = {
  activeElement: null as FakeNode | null,
  createElement: (tag: string) => new FakeNode(tag),
  createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
};

/** Install the fake document for one test; returns a restore function. */
export function installFakeDocument(): () => void {
  const g = globalThis as Record<string, unknown>;
  const previous = { document: g.document, requestAnimationFrame: g.requestAnimationFrame, Element: g.Element };
  FakeDocument.activeElement = null;
  g.document = FakeDocument;
  g.Element = FakeNode;
  g.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
  return () => { g.document = previous.document; g.requestAnimationFrame = previous.requestAnimationFrame; g.Element = previous.Element; };
}
