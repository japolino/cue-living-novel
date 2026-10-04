/**
 * Sprite library gallery for the settings panel (sprite mode).
 *
 * Shows every sprite set (character + outfit + image style) with its
 * expressions on a checkerboard, and every background plate, with the
 * library actions the backend offers (`vn_sprite_action`). Pure DOM, no
 * network of its own: thumbnails are the cut-out URLs the backend sends, and
 * load lazily. Live updates change elements in place, so focus survives.
 */
import type { PlateView, SpriteImageStatus, SpriteImageView, SpriteSetView } from "../../shared/sprites.js";
import {
  SPRITE_STATUS_LABELS,
  countReady,
  describeSpriteLibrary,
  expressionLabel,
  mergePlate,
  mergeSpriteImage,
  orderedExpressions,
  plateDetails,
  setCoverImage,
  sortSpriteSets,
  spriteStatusBusy,
  summarizeSpriteLibrary,
} from "./model.js";
import { spriteExpressionSet, spriteSetReadyCount, type SpriteExpressionCount } from "../../shared/sprites.js";

/** A library action as the panel reports it; the host adds `type` (and the chat id for "prepare_chat"). */
export type SpriteLibraryAction = {
  action: "prepare_chat" | "regenerate" | "recut" | "delete_set" | "regenerate_plate" | "delete_plate";
  chatId?: string;
  setKey?: string;
  expression?: string;
  plateKey?: string;
};

export type SpriteLibraryOptions = {
  onAction?: (action: SpriteLibraryAction) => void;
  onRequest?: () => void;
};

const CONFIRM_MS = 4000;

const SILHOUETTE = '<svg viewBox="0 0 40 60" aria-hidden="true" data-silhouette><circle cx="20" cy="15" r="9"/><path d="M4 60c0-15 6-26 16-26s16 11 16 26z"/></svg>';
const LANDSCAPE = '<svg viewBox="0 0 60 40" aria-hidden="true" data-silhouette><circle cx="44" cy="12" r="5"/><path d="M0 40 18 18l12 13 8-8 22 17z"/></svg>';

export const SPRITE_LIBRARY_CSS = `
[data-sprite-library] { display: grid; gap: .85rem; min-width: 0; --checker-a: color-mix(in srgb, var(--set-text) 11%, var(--set-field)); --checker-b: color-mix(in srgb, var(--set-text) 4%, var(--set-field)); }
[data-checker] { background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 14px 14px; }
[data-library-head] { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem; }
[data-library-summary] { flex: 1 1 14rem; font-weight: 600; }
[data-library-note] { min-height: 1.2rem; }
[data-library-note]:empty { display: none; }
[data-library-sub] { display: flex; align-items: baseline; gap: .5rem; margin: .2rem 0 -.25rem; font-size: .8rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--set-muted); }
[data-library-sub] small { font-size: .78rem; font-weight: 500; letter-spacing: 0; text-transform: none; }
[data-library-empty] { padding: .9rem 1rem; border: 1px dashed var(--set-border); border-radius: .7rem; color: var(--set-muted); font-size: .88rem; }
[data-sprite-sets] { display: grid; gap: .5rem; min-width: 0; }

details[data-sprite-set] { min-width: 0; border: 1px solid var(--set-border); border-radius: .75rem; background: var(--set-field); }
details[data-sprite-set][open] { border-color: color-mix(in srgb, var(--set-accent) 40%, var(--set-border)); }
details[data-sprite-set] > summary { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: .75rem; min-height: 3.6rem; padding: .45rem .75rem .45rem .5rem; cursor: pointer; list-style: none; border-radius: .75rem; }
details[data-sprite-set] > summary::-webkit-details-marker { display: none; }
details[data-sprite-set] > summary:hover { background: var(--set-hover); }
[data-set-cover] { position: relative; width: 2.9rem; height: 2.9rem; border-radius: 50%; overflow: hidden; border: 1px solid var(--set-border); color: var(--set-muted); }
[data-set-text] { display: grid; min-width: 0; }
[data-set-text] b { overflow: hidden; font-weight: 650; white-space: nowrap; text-overflow: ellipsis; }
[data-set-text] small { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
[data-set-progress] { display: grid; justify-items: end; gap: .25rem; font-size: .8rem; font-weight: 650; white-space: nowrap; }
[data-set-progress] [data-set-flags] { display: flex; gap: .3rem; }
[data-meter] { position: relative; width: 4.5rem; height: .3rem; border-radius: 999px; background: var(--set-hover); overflow: hidden; }
[data-meter] > i { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: var(--set-success); }
[data-chevron] { width: .45rem; height: .45rem; margin: 0 .2rem 0 .15rem; border-right: 1.5px solid var(--set-muted); border-bottom: 1.5px solid var(--set-muted); transform: rotate(45deg); }
details[data-sprite-set][open] [data-chevron] { transform: rotate(-135deg); }
details[data-sprite-set] > summary > span:last-child { display: flex; align-items: center; gap: .55rem; }

[data-chip] { display: inline-flex; align-items: center; gap: .3rem; padding: .05rem .5rem; border-radius: 999px; font-size: .72rem; font-weight: 650; line-height: 1.35rem; white-space: nowrap; background: var(--set-hover); color: var(--set-muted); }
[data-chip]::before { content: ""; width: .45rem; height: .45rem; border-radius: 50%; background: currentColor; }
[data-chip][data-sprite-status="ready"] { color: var(--set-success); }
[data-chip]:is([data-sprite-status="queued"], [data-sprite-status="generating"], [data-sprite-status="cutting"]) { color: var(--set-accent); }
[data-chip][data-sprite-status="failed"] { color: var(--set-danger); background: color-mix(in srgb, var(--set-danger) 12%, transparent); }

[data-set-body] { display: grid; gap: .75rem; padding: .2rem .75rem .8rem; min-width: 0; }
[data-expressions] { display: grid; grid-template-columns: repeat(auto-fill, minmax(5.4rem, 1fr)); gap: .45rem; }
[data-expression] { position: relative; display: grid; gap: .25rem; min-height: 0; padding: .3rem .3rem .4rem; border-radius: .6rem; background: transparent; text-align: center; font-weight: 550; }
[data-expression][aria-pressed="true"] { border-color: var(--set-accent); background: color-mix(in srgb, var(--set-accent) 14%, transparent); box-shadow: 0 0 0 1px var(--set-accent); }
[data-thumb] { position: relative; display: block; aspect-ratio: 4 / 5; border-radius: .45rem; overflow: hidden; color: var(--set-muted); }
[data-thumb] img, [data-set-cover] img { position: absolute; display: block; max-width: none; }
[data-thumb] img[data-fit="contain"], [data-set-cover] img[data-fit="contain"] { inset: 0; width: 100%; height: 100%; object-fit: contain; object-position: 50% 0; }
[data-silhouette] { position: absolute; left: 50%; bottom: 0; width: 62%; transform: translateX(-50%); fill: currentColor; opacity: .28; }
[data-set-cover] [data-silhouette] { width: 70%; }
[data-tile-label] { overflow: hidden; font-size: .76rem; line-height: 1.2; white-space: nowrap; text-overflow: ellipsis; }
[data-tile-dot] { position: absolute; top: .55rem; right: .55rem; width: .6rem; height: .6rem; border: 2px solid var(--set-field); border-radius: 50%; background: var(--set-muted); box-sizing: content-box; }
[data-expression][data-sprite-status="ready"] [data-tile-dot] { display: none; }
[data-expression]:is([data-sprite-status="queued"], [data-sprite-status="generating"], [data-sprite-status="cutting"]) [data-tile-dot] { background: var(--set-accent); }
[data-expression][data-sprite-status="failed"] [data-tile-dot] { background: var(--set-danger); }
[data-expression][data-sprite-status="failed"] [data-thumb] { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--set-danger) 70%, transparent); color: var(--set-danger); }
[data-expression][data-sprite-status="missing"] [data-thumb] { background: none; border: 1.5px dashed var(--set-border); }
:is([data-expression], [data-plate]):is([data-sprite-status="generating"], [data-sprite-status="cutting"]) :is([data-thumb], [data-plate-thumb])::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--set-accent) 22%, transparent) 50%, transparent 70%) 0 0 / 250% 100%; animation: sprite-busy 1.6s linear infinite; }
@keyframes sprite-busy { from { background-position: 125% 0; } to { background-position: -125% 0; } }

[data-inspector] { display: grid; grid-template-columns: minmax(7rem, 11rem) minmax(0, 1fr); gap: .9rem; align-items: start; padding: .75rem; border-radius: .65rem; background: var(--set-hover); }
[data-inspector-art] { position: relative; aspect-ratio: 832 / 1216; border-radius: .5rem; overflow: hidden; color: var(--set-muted); }
[data-inspector-art] img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
[data-inspector-info] { display: grid; gap: .45rem; min-width: 0; align-content: start; }
[data-inspector-info] h4 { font-size: 1rem; font-weight: 650; }
[data-inspector-error] { padding: .45rem .6rem; border-radius: .5rem; background: color-mix(in srgb, var(--set-danger) 12%, transparent); color: var(--set-danger); overflow-wrap: anywhere; }
[data-set-foot] { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; justify-content: space-between; }
[data-set-foot] small { flex: 1 1 12rem; }
button[data-confirming] { border-color: var(--set-danger); color: var(--set-danger); background: transparent; }

[data-plates] { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr)); gap: .55rem; margin: 0; padding: 0; list-style: none; }
[data-plate] { display: grid; grid-template-rows: auto 1fr; min-width: 0; border: 1px solid var(--set-border); border-radius: .7rem; overflow: hidden; background: var(--set-field); }
[data-plate-thumb] { position: relative; aspect-ratio: 1216 / 832; background: linear-gradient(160deg, color-mix(in srgb, var(--set-text) 9%, var(--set-field)), var(--set-field)); color: var(--set-muted); }
[data-plate-thumb] img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
[data-plate-thumb] [data-silhouette] { bottom: 50%; width: 36%; transform: translate(-50%, 50%); }
[data-plate-thumb] [data-chip] { position: absolute; left: .45rem; top: .45rem; background: color-mix(in srgb, var(--set-field) 88%, transparent); }
[data-plate][data-sprite-status="ready"] [data-plate-thumb] [data-chip] { display: none; }
[data-plate-body] { display: flex; flex-direction: column; gap: .3rem; padding: .55rem .65rem .65rem; min-width: 0; }
[data-plate-body] [data-actions] { margin-top: auto; padding-top: .15rem; }
[data-plate-body] b { overflow: hidden; font-weight: 620; white-space: nowrap; text-overflow: ellipsis; }
[data-plate-body] [data-actions] { gap: .4rem; }
[data-plate-body] [data-actions] button, [data-inspector] [data-actions] button, [data-set-foot] button { min-height: 2.3rem; padding: .25rem .85rem; font-size: .84rem; }
[data-plate-error] { color: var(--set-danger); overflow-wrap: anywhere; }

@media (pointer: coarse) {
  [data-plate-body] [data-actions] button, [data-inspector] [data-actions] button, [data-set-foot] button { min-height: 2.75rem; }
}
@container (max-width: 520px) {
  [data-inspector] { grid-template-columns: minmax(0, 6.5rem) minmax(0, 1fr); gap: .7rem; padding: .6rem; }
  [data-expressions] { grid-template-columns: repeat(auto-fill, minmax(4.6rem, 1fr)); gap: .35rem; }
  [data-set-body] { padding: .15rem .45rem .6rem; }
  [data-meter] { width: 3.2rem; }
  [data-plate] { grid-template-rows: none; grid-template-columns: minmax(0, 6.5rem) minmax(0, 1fr); }
  [data-plate-body] [data-actions] button { padding: .25rem .7rem; }
  [data-plate-thumb] { align-self: stretch; aspect-ratio: auto; min-height: 5.2rem; }
  [data-plate-thumb] [data-chip] { left: .3rem; top: .3rem; padding: 0 .4rem; }
  [data-plate-body] { padding: .45rem .55rem .55rem; }
}
@media (prefers-reduced-motion: reduce) {
  :is([data-expression], [data-plate]) :is([data-thumb], [data-plate-thumb])::after { animation: none; background-position: 50% 0; }
}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

function chip(status: SpriteImageStatus, text = SPRITE_STATUS_LABELS[status]): HTMLElement {
  const element = el("span", { "data-chip": "", "data-sprite-status": status }, text);
  return element;
}

/**
 * Frames a cut-out so the face and shoulders fill a small box: the window is
 * centred on the opaque bounding box and starts at its top. Without a bbox
 * the whole sprite is shown (contain).
 */
export function faceCrop(image: Pick<SpriteImageView, "bbox" | "width" | "height">, boxAspect: number): { width: string; left: string; top: string } | null {
  const bbox = image.bbox;
  if (!bbox || bbox.length !== 4 || !bbox.every((value) => Number.isFinite(value))) return null;
  const imageWidth = image.width && image.width > 0 ? image.width : 832;
  const imageHeight = image.height && image.height > 0 ? image.height : 1216;
  const [x, y, w] = bbox;
  const windowWidth = Math.min(1, Math.max(0.3, Math.min(w, 0.62))) * imageWidth;
  const windowHeight = windowWidth / boxAspect;
  const centre = (x + w / 2) * imageWidth;
  const left = Math.min(imageWidth - windowWidth, Math.max(0, centre - windowWidth / 2));
  const top = Math.min(Math.max(0, imageHeight - windowHeight), Math.max(0, y * imageHeight - imageHeight * 0.015));
  const percent = (value: number) => `${Math.round(value * 10000) / 100}%`;
  return { width: percent(imageWidth / windowWidth), left: percent(-left / windowWidth), top: percent(-top / windowHeight) };
}

function setImage(box: HTMLElement, image: SpriteImageView | null, alt: string, aspect: number, silhouette = SILHOUETTE): void {
  const url = image?.status === "ready" ? image.url : undefined;
  let img = box.querySelector<HTMLImageElement>("img");
  if (!url) {
    img?.remove();
    if (!box.querySelector("[data-silhouette]")) box.insertAdjacentHTML("afterbegin", silhouette);
    return;
  }
  box.querySelector("[data-silhouette]")?.remove();
  if (!img) {
    img = el("img", { loading: "lazy", decoding: "async" });
    box.prepend(img);
  }
  img.alt = alt;
  if (img.getAttribute("src") !== url) img.src = url;
  const crop = aspect > 0 ? faceCrop(image!, aspect) : null;
  if (crop) {
    img.removeAttribute("data-fit");
    Object.assign(img.style, { width: crop.width, left: crop.left, top: crop.top, height: "auto" });
  } else {
    img.setAttribute("data-fit", "contain");
    img.removeAttribute("style");
  }
}

/** Inspector line for an expression that is not made yet, at a set size. */
export function missingHint(expression: string, count: SpriteExpressionCount): string {
  if ((spriteExpressionSet(count) as readonly string[]).includes(expression)) return "Cue makes it soon after the set is first used";
  if (count === 12) return "Until it exists, the nearest expression stands in";
  return `It is not in the ${count} set, so the nearest expression in the set stands in`;
}

export class SpriteLibraryView {
  readonly element: HTMLElement;
  private readonly options: SpriteLibraryOptions;
  private sets = new Map<string, SpriteSetView>();
  private plates: PlateView[] = [];
  /** Expressions per character (config spriteExpressionCount): what the lists and counts show. */
  private count: SpriteExpressionCount = 12;
  private loaded = false;
  private readonly selected = new Map<string, string>();
  private readonly confirmTimers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();
  private readonly summary: HTMLElement;
  private readonly note: HTMLElement;
  private readonly setList: HTMLElement;
  private readonly plateList: HTMLElement;
  private readonly setsEmpty: HTMLElement;
  private readonly platesEmpty: HTMLElement;

  constructor(mount: HTMLElement, options: SpriteLibraryOptions) {
    this.options = options;
    this.element = el("div", { "data-sprite-library": "", "data-state": "idle" });
    this.element.innerHTML = `
      <div data-library-head>
        <p data-library-summary>Library not loaded yet.</p>
        <div data-actions>
          <button type="button" data-primary data-sprite-prepare>Prepare sprites for this chat</button>
          <button type="button" data-quiet data-sprite-refresh>Refresh</button>
        </div>
      </div>
      <small data-library-note role="status" aria-live="polite"></small>
      <h4 data-library-sub id="sprite-sets-title">Characters <small data-sets-note>12 expressions each, made once and reused in every chat</small></h4>
      <p data-library-empty data-sets-empty>No characters yet. Cue makes a set the first time a character appears in sprite mode, or when you choose Prepare sprites for this chat.</p>
      <div data-sprite-sets aria-labelledby="sprite-sets-title"></div>
      <h4 data-library-sub id="sprite-plates-title">Backgrounds <small>one per place, time of day and weather</small></h4>
      <p data-library-empty data-plates-empty>No backgrounds yet.</p>
      <ul data-plates aria-labelledby="sprite-plates-title"></ul>`;
    mount.append(this.element);
    this.summary = this.element.querySelector("[data-library-summary]")!;
    this.note = this.element.querySelector("[data-library-note]")!;
    this.setList = this.element.querySelector("[data-sprite-sets]")!;
    this.plateList = this.element.querySelector("[data-plates]")!;
    this.setsEmpty = this.element.querySelector("[data-sets-empty]")!;
    this.platesEmpty = this.element.querySelector("[data-plates-empty]")!;
    const prepare = this.element.querySelector<HTMLButtonElement>("[data-sprite-prepare]")!;
    const refresh = this.element.querySelector<HTMLButtonElement>("[data-sprite-refresh]")!;
    prepare.disabled = !options.onAction;
    refresh.disabled = !options.onRequest;
    prepare.addEventListener("click", () => {
      this.act({ action: "prepare_chat" }, "Asked Cue to prepare sprites and backgrounds for this chat. They appear here as they are made.");
    });
    refresh.addEventListener("click", () => this.request());
    this.render();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /** Marks a pending request (shows a loading line until the library arrives). */
  request(): void {
    if (!this.options.onRequest) return;
    if (!this.loaded) {
      this.element.dataset.state = "loading";
      this.summary.textContent = "Loading the library…";
    }
    this.options.onRequest();
  }

  setLibrary(sets: readonly SpriteSetView[], plates: readonly PlateView[]): void {
    this.loaded = true;
    this.element.dataset.state = "ready";
    this.sets = new Map(sortSpriteSets(sets).map((set) => [set.setKey, { ...set, readyCount: countReady(set, this.count) }]));
    this.plates = plates.slice();
    this.render();
  }

  /** The set size changed (config spriteExpressionCount): lists, counts and hints follow it. */
  setExpressionCount(count: SpriteExpressionCount): void {
    if (count === this.count) return;
    this.count = count;
    for (const [key, set] of this.sets) this.sets.set(key, { ...set, readyCount: countReady(set, count) });
    this.render();
  }

  expressionCount(): SpriteExpressionCount {
    return this.count;
  }

  /** Returns false when the set is unknown (the caller may ask for the whole library). */
  applySpriteUpdate(setKey: string, image: SpriteImageView): boolean {
    const set = this.sets.get(setKey);
    if (!set) return false;
    const next = mergeSpriteImage(set, image, this.count);
    this.sets.set(setKey, next);
    const element = this.setElement(setKey);
    if (element) this.updateSet(element, next);
    this.renderSummary();
    return true;
  }

  applyPlateUpdate(plate: PlateView): void {
    this.plates = mergePlate(this.plates, plate);
    this.renderPlates();
    this.renderSummary();
  }

  destroy(): void {
    for (const timer of this.confirmTimers.values()) clearTimeout(timer);
    this.confirmTimers.clear();
    this.element.remove();
  }

  /* -------------------------------------------------------------------- */

  private act(action: SpriteLibraryAction, message: string): void {
    if (!this.options.onAction) return;
    this.options.onAction(action);
    this.note.textContent = message;
  }

  /** Destructive buttons need a second click within four seconds. */
  private confirm(button: HTMLButtonElement, prompt: string, run: () => void): void {
    if (!button.hasAttribute("data-confirming")) {
      button.dataset.label = button.textContent ?? "";
      const aria = button.getAttribute("aria-label");
      if (aria !== null) { button.dataset.ariaLabel = aria; button.setAttribute("aria-label", prompt); }
      button.setAttribute("data-confirming", "");
      button.textContent = prompt;
      const timer = setTimeout(() => {
        this.unconfirm(button);
        this.confirmTimers.delete(button);
      }, CONFIRM_MS);
      this.confirmTimers.set(button, timer);
      return;
    }
    const timer = this.confirmTimers.get(button);
    if (timer) clearTimeout(timer);
    this.confirmTimers.delete(button);
    this.unconfirm(button);
    run();
  }

  private unconfirm(button: HTMLButtonElement): void {
    button.removeAttribute("data-confirming");
    button.textContent = button.dataset.label ?? "";
    if (button.dataset.ariaLabel !== undefined) button.setAttribute("aria-label", button.dataset.ariaLabel);
  }

  private render(): void {
    this.element.querySelector("[data-sets-note]")!.textContent = `${this.count} expressions each, made once and reused in every chat`;
    this.renderSummary();
    this.renderSets();
    this.renderPlates();
  }

  private renderSummary(): void {
    if (!this.loaded) {
      this.summary.textContent = this.element.dataset.state === "loading" ? "Loading the library…" : "Library not loaded yet.";
      this.setsEmpty.hidden = true;
      this.platesEmpty.hidden = true;
      return;
    }
    this.summary.textContent = describeSpriteLibrary(summarizeSpriteLibrary([...this.sets.values()], this.plates, this.count));
    this.setsEmpty.hidden = this.sets.size > 0;
    this.platesEmpty.hidden = this.plates.length > 0;
  }

  private setElement(setKey: string): HTMLDetailsElement | null {
    for (const element of this.setList.children) {
      if ((element as HTMLElement).dataset.spriteSet === setKey) return element as HTMLDetailsElement;
    }
    return null;
  }

  private renderSets(): void {
    const existing = new Map<string, HTMLDetailsElement>();
    for (const element of Array.from(this.setList.children)) existing.set((element as HTMLElement).dataset.spriteSet!, element as HTMLDetailsElement);
    const wanted: HTMLDetailsElement[] = [];
    // A short library opens its first set so the expressions show at once.
    const autoOpen = this.sets.size <= 2 && existing.size === 0;
    let first = true;
    for (const set of this.sets.values()) {
      let element = existing.get(set.setKey);
      existing.delete(set.setKey);
      if (!element) {
        element = this.createSet(set);
        if (autoOpen && first) element.open = true;
      }
      this.updateSet(element, set);
      wanted.push(element);
      first = false;
    }
    for (const stale of existing.values()) stale.remove();
    const current = Array.from(this.setList.children);
    if (current.length !== wanted.length || current.some((element, index) => element !== wanted[index])) {
      // Re-append only when the order really changed: moving a node drops its focus.
      wanted.forEach((element, index) => {
        if (this.setList.children[index] !== element) this.setList.insertBefore(element, this.setList.children[index] ?? null);
      });
    }
  }

  private createSet(set: SpriteSetView): HTMLDetailsElement {
    const details = el("details", { "data-sprite-set": set.setKey });
    const summary = el("summary");
    summary.innerHTML = `<span data-set-cover data-checker></span><span data-set-text><b></b><small></small></span><span><span data-set-progress><span data-set-count></span><span data-meter aria-hidden="true"><i></i></span><span data-set-flags></span></span><span data-chevron aria-hidden="true"></span></span>`;
    details.append(summary);
    details.addEventListener("toggle", () => {
      if (details.open && !details.querySelector("[data-set-body]")) {
        const current = this.sets.get(set.setKey);
        if (current) { this.buildBody(details, current); this.updateSet(details, current); }
      }
    });
    if (details.open) this.buildBody(details, set);
    return details;
  }

  private buildBody(details: HTMLDetailsElement, set: SpriteSetView): void {
    const body = el("div", { "data-set-body": "" });
    const grid = el("div", { "data-expressions": "", role: "group", "aria-label": `${set.name} expressions` });
    grid.addEventListener("click", (event) => {
      const tile = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-expression]");
      if (tile) this.select(details, tile.dataset.expression!);
    });
    grid.addEventListener("keydown", (event) => this.gridKeys(grid, event));
    const inspector = el("div", { "data-inspector": "", role: "region", "aria-label": `${set.name}: selected expression` });
    inspector.innerHTML = `<div data-inspector-art data-checker></div><div data-inspector-info><h4 data-inspector-title></h4><span data-inspector-chip></span><small data-inspector-meta></small><p data-inspector-error hidden></p><div data-actions><button type="button" data-sprite-regenerate>Regenerate</button><button type="button" data-sprite-recut>Re-cut</button></div></div>`;
    inspector.querySelector<HTMLButtonElement>("[data-sprite-regenerate]")!.addEventListener("click", () => {
      const current = this.sets.get(details.dataset.spriteSet!);
      const expression = this.selected.get(details.dataset.spriteSet!) ?? "idle";
      if (!current) return;
      const missing = (current.expressions[expression]?.status ?? "missing") === "missing";
      this.act({ action: "regenerate", setKey: current.setKey, expression }, `${missing ? "Making" : "Regenerating"} ${current.name} · ${expressionLabel(expression)}…`);
    });
    inspector.querySelector<HTMLButtonElement>("[data-sprite-recut]")!.addEventListener("click", () => {
      const current = this.sets.get(details.dataset.spriteSet!);
      const expression = this.selected.get(details.dataset.spriteSet!) ?? "idle";
      if (current) this.act({ action: "recut", setKey: current.setKey, expression }, `Cutting out ${current.name} · ${expressionLabel(expression)} again…`);
    });
    const foot = el("div", { "data-set-foot": "" });
    const hint = el("small", {}, "Deleting removes this set from every chat. Cue makes it again when the character returns.");
    const remove = el("button", { type: "button", "data-sprite-delete-set": "" }, "Delete set");
    remove.addEventListener("click", () => {
      const current = this.sets.get(details.dataset.spriteSet!);
      if (!current) return;
      this.confirm(remove, `Confirm delete ${current.name}?`, () => this.act({ action: "delete_set", setKey: current.setKey }, `Deleting ${current.name}…`));
    });
    foot.append(hint, remove);
    body.append(grid, inspector, foot);
    details.append(body);
    if (!this.selected.has(set.setKey)) {
      const images = orderedExpressions(set, this.count);
      const pick = images.find((image) => image.status === "failed") ?? images.find((image) => image.status === "ready") ?? images[0]!;
      this.selected.set(set.setKey, pick.expression);
    }
  }

  private updateSet(details: HTMLDetailsElement, set: SpriteSetView): void {
    const summary = details.querySelector("summary")!;
    summary.querySelector("[data-set-text] b")!.textContent = set.name;
    summary.querySelector("[data-set-text] small")!.textContent = set.attire?.trim() || "Usual outfit";
    const images = orderedExpressions(set, this.count);
    // Progress of the active set; other images are listed but not counted.
    const { ready: setReady, total: setTotal } = spriteSetReadyCount(set.expressions, this.count);
    summary.querySelector("[data-set-count]")!.textContent = `${setReady}/${setTotal} ready`;
    (summary.querySelector("[data-meter] > i") as HTMLElement).style.width = `${Math.round((setReady / setTotal) * 100)}%`;
    const failed = images.filter((image) => image.status === "failed").length;
    const busy = images.filter((image) => spriteStatusBusy(image.status)).length;
    const flags = summary.querySelector<HTMLElement>("[data-set-flags]")!;
    flags.replaceChildren(...[
      ...(busy ? [chip("generating", `${busy} in progress`)] : []),
      ...(failed ? [chip("failed", `${failed} failed`)] : []),
    ]);
    summary.setAttribute("aria-label", `${set.name}, ${set.attire?.trim() || "usual outfit"}: ${setReady} of ${setTotal} expressions ready${busy ? `, ${busy} in progress` : ""}${failed ? `, ${failed} failed` : ""}`);
    setImage(summary.querySelector<HTMLElement>("[data-set-cover]")!, setCoverImage(set), "", 1);
    details.dataset.spriteStatus = failed ? "failed" : busy ? "busy" : setReady === setTotal ? "ready" : "partial";

    const grid = details.querySelector<HTMLElement>("[data-expressions]");
    if (!grid) return;
    // A tile no longer listed (smaller set size) leaves the grid.
    for (const tile of Array.from(grid.querySelectorAll<HTMLButtonElement>("[data-expression]"))) {
      if (!images.some((image) => image.expression === tile.dataset.expression)) tile.remove();
    }
    if (!images.some((image) => image.expression === this.selected.get(set.setKey))) this.selected.set(set.setKey, images[0]!.expression);
    const selected = this.selected.get(set.setKey) ?? images[0]!.expression;
    const tiles = new Map<string, HTMLButtonElement>();
    for (const tile of Array.from(grid.querySelectorAll<HTMLButtonElement>("[data-expression]"))) tiles.set(tile.dataset.expression!, tile);
    images.forEach((image, index) => {
      let tile = tiles.get(image.expression);
      if (!tile) {
        tile = el("button", { type: "button", "data-expression": image.expression });
        tile.innerHTML = `<span data-thumb data-checker></span><span data-tile-label></span><span data-tile-dot aria-hidden="true"></span>`;
      }
      if (grid.children[index] !== tile) grid.insertBefore(tile, grid.children[index] ?? null);
      const label = expressionLabel(image.expression);
      tile.dataset.spriteStatus = image.status;
      tile.querySelector("[data-tile-label]")!.textContent = label;
      tile.setAttribute("aria-label", `${label}: ${SPRITE_STATUS_LABELS[image.status]}`);
      tile.title = image.status === "failed" && image.error
        ? `${label}: failed. ${image.error}`
        : `${label}: ${SPRITE_STATUS_LABELS[image.status]}${image.twoFigures ? ". May show two figures" : ""}`;
      tile.setAttribute("aria-pressed", String(image.expression === selected));
      tile.tabIndex = image.expression === selected ? 0 : -1;
      setImage(tile.querySelector<HTMLElement>("[data-thumb]")!, image, "", 4 / 5);
    });
    this.updateInspector(details, set);
  }

  private updateInspector(details: HTMLDetailsElement, set: SpriteSetView): void {
    const inspector = details.querySelector<HTMLElement>("[data-inspector]");
    if (!inspector) return;
    const expression = this.selected.get(set.setKey) ?? "idle";
    const image: SpriteImageView = set.expressions[expression] ?? { expression, status: "missing" };
    const label = expressionLabel(expression);
    inspector.querySelector("[data-inspector-title]")!.textContent = `${set.name} · ${label}`;
    inspector.querySelector("[data-inspector-chip]")!.replaceChildren(chip(image.status));
    const meta = inspector.querySelector<HTMLElement>("[data-inspector-meta]")!;
    meta.textContent = image.status === "ready"
      ? `${image.width && image.height ? `${image.width}×${image.height} cut-out` : "Cut-out ready"}. Shown whenever ${set.name} feels this way.${image.twoFigures ? " It may show two figures: Regenerate draws a new one." : ""}`
      : image.status === "missing"
        ? `Not made yet. ${missingHint(expression, this.count)}.`
        : image.status === "failed"
          ? "Regenerate draws it again. Re-cut redoes only the cut-out."
          : "Cue is working on it. It appears here when it is ready.";
    const error = inspector.querySelector<HTMLElement>("[data-inspector-error]")!;
    error.hidden = !(image.status === "failed" && image.error);
    error.textContent = image.error ?? "";
    const art = inspector.querySelector<HTMLElement>("[data-inspector-art]")!;
    setImage(art, image, `${set.name}, ${label}`, 0);
    const regenerate = inspector.querySelector<HTMLButtonElement>("[data-sprite-regenerate]")!;
    const recut = inspector.querySelector<HTMLButtonElement>("[data-sprite-recut]")!;
    const busy = spriteStatusBusy(image.status);
    regenerate.textContent = image.status === "missing" ? "Make now" : "Regenerate";
    regenerate.disabled = busy || !this.options.onAction;
    recut.hidden = !(image.status === "ready" || image.status === "failed");
    recut.disabled = busy || !this.options.onAction;
  }

  private select(details: HTMLDetailsElement, expression: string, focus = false): void {
    const setKey = details.dataset.spriteSet!;
    this.selected.set(setKey, expression);
    const set = this.sets.get(setKey);
    if (!set) return;
    this.updateSet(details, set);
    if (focus) details.querySelector<HTMLElement>(`[data-expression="${CSS.escape(expression)}"]`)?.focus();
  }

  /** Arrow keys move through the expression grid (one tab stop per set). */
  private gridKeys(grid: HTMLElement, event: KeyboardEvent): void {
    const tiles = Array.from(grid.querySelectorAll<HTMLButtonElement>("[data-expression]"));
    const index = tiles.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const first = tiles[0]!.getBoundingClientRect();
    const columns = Math.max(1, tiles.filter((tile) => Math.abs(tile.getBoundingClientRect().top - first.top) < 2).length);
    let next = -1;
    if (event.key === "ArrowRight") next = Math.min(tiles.length - 1, index + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (event.key === "ArrowDown") next = Math.min(tiles.length - 1, index + columns);
    else if (event.key === "ArrowUp") next = Math.max(0, index - columns);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tiles.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const details = grid.closest<HTMLDetailsElement>("details[data-sprite-set]")!;
    this.select(details, tiles[next]!.dataset.expression!, true);
  }

  private renderPlates(): void {
    const existing = new Map<string, HTMLElement>();
    for (const item of Array.from(this.plateList.children)) existing.set((item as HTMLElement).dataset.plate!, item as HTMLElement);
    this.plates.forEach((plate, index) => {
      let item = existing.get(plate.plateKey);
      existing.delete(plate.plateKey);
      if (!item) item = this.createPlate(plate.plateKey);
      if (this.plateList.children[index] !== item) this.plateList.insertBefore(item, this.plateList.children[index] ?? null);
      this.updatePlate(item, plate);
    });
    for (const stale of existing.values()) stale.remove();
    if (this.loaded) this.platesEmpty.hidden = this.plates.length > 0;
  }

  private createPlate(plateKey: string): HTMLElement {
    const item = el("li", { "data-plate": plateKey });
    item.innerHTML = `<div data-plate-thumb><span data-plate-chip></span></div><div data-plate-body><b data-plate-title></b><small data-plate-meta></small><small data-plate-error hidden></small><div data-actions><button type="button" data-plate-regenerate>Regenerate</button><button type="button" data-plate-delete>Delete</button></div></div>`;
    const plate = () => this.plates.find((candidate) => candidate.plateKey === plateKey);
    item.querySelector<HTMLButtonElement>("[data-plate-regenerate]")!.addEventListener("click", () => {
      const current = plate();
      if (current) this.act({ action: "regenerate_plate", plateKey }, `Regenerating ${current.location || "background"}…`);
    });
    const remove = item.querySelector<HTMLButtonElement>("[data-plate-delete]")!;
    remove.addEventListener("click", () => {
      const current = plate();
      if (!current) return;
      this.confirm(remove, "Confirm delete?", () => this.act({ action: "delete_plate", plateKey }, `Deleting ${current.location || "background"}…`));
    });
    return item;
  }

  private updatePlate(item: HTMLElement, plate: PlateView): void {
    const title = plate.location.trim() || "Unnamed place";
    item.dataset.spriteStatus = plate.status;
    item.querySelector("[data-plate-title]")!.textContent = title;
    (item.querySelector("[data-plate-title]") as HTMLElement).title = title;
    const details = plateDetails(plate);
    const meta = item.querySelector<HTMLElement>("[data-plate-meta]")!;
    meta.textContent = details || "Any time, any weather";
    const chipSlot = item.querySelector<HTMLElement>("[data-plate-chip]")!;
    chipSlot.replaceChildren(chip(plate.status));
    const thumb = item.querySelector<HTMLElement>("[data-plate-thumb]")!;
    const url = plate.status === "ready" ? plate.url : undefined;
    let img = thumb.querySelector("img");
    if (url) {
      thumb.querySelector("[data-silhouette]")?.remove();
      if (!img) { img = el("img", { loading: "lazy", decoding: "async", alt: "" }); thumb.prepend(img); }
      img.alt = `${title}${details ? `, ${details}` : ""}`;
      if (img.getAttribute("src") !== url) img.src = url;
    } else {
      img?.remove();
      if (!thumb.querySelector("[data-silhouette]")) thumb.insertAdjacentHTML("afterbegin", LANDSCAPE);
    }
    const error = item.querySelector<HTMLElement>("[data-plate-error]")!;
    error.hidden = !(plate.status === "failed" && plate.error);
    error.textContent = plate.error ?? "";
    const busy = spriteStatusBusy(plate.status);
    const regenerate = item.querySelector<HTMLButtonElement>("[data-plate-regenerate]")!;
    regenerate.disabled = busy || !this.options.onAction;
    regenerate.textContent = plate.status === "missing" ? "Make now" : "Regenerate";
    regenerate.setAttribute("aria-label", `${regenerate.textContent} ${title}`);
    const remove = item.querySelector<HTMLButtonElement>("[data-plate-delete]")!;
    remove.disabled = !this.options.onAction;
    if (!remove.hasAttribute("data-confirming")) remove.setAttribute("aria-label", `Delete ${title}`);
  }
}
