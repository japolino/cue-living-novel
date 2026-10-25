/**
 * The waiting screen: while the next reply is written, the stage recalls the
 * reply just read over a backdrop (docs: README "While you wait").
 *
 * Backdrops: "card" (the scene card on the card's background picture), "tidy"
 * (a dark veil, the scene centred, faces in rings), "daylight" (a light
 * loading screen: stripes, a Now loading banner, a tip) and "cast" (a violet
 * dark, everyone filling in from a silhouette). Recaps on top: "lineup"
 * (everyone side by side with a speech bubble of one of their lines; a tap
 * gives the next line and their picture for it), "cards" (one character at a
 * time with their last line), "film" (the reply as a strip of cards scrolling
 * by; a tap on a card enlarges it) or "off"; "auto" lines up to three and
 * rotates cards from four. The backdrop answers the pointer: it drifts a
 * little with it, and a tap on empty space sends a ripple (on daylight, a
 * light sweep across the moving stripes too).
 *
 * Markup and timers only. VnStage builds the WaitingRecap (recap.ts) and
 * decides when the screen shows; styles are in theme/waiting-css.ts.
 */
import type { VisualNovelWaitingBackdrop, VisualNovelWaitingRecap } from "../../config.js";
import type { RecapCharacter, RecapEntry, RecapImage, RecapLine, WaitingRecap } from "./recap.js";
import { cssUrl, sceneCardWords } from "./scene-card.js";

export type WaitingBackdrop = Exclude<VisualNovelWaitingBackdrop, "off">;
export type WaitingRecapMode = Exclude<VisualNovelWaitingRecap, "auto">;

export type WaitingScreenOptions = {
  backdrop: WaitingBackdrop;
  recap: VisualNovelWaitingRecap;
  /** A preview from Settings: a banner says so and a tap away from the characters closes it. */
  preview: boolean;
  /** Animations and the scrolling film; false keeps everything still. */
  motion: boolean;
};

export type WaitingScreenHooks = {
  /** A tap on a character or a card (sparks at the pointer). */
  onTap?: (event: MouseEvent) => void;
  /** A bubble or card changed because of a tap (a pop sound). */
  onPop?: () => void;
  /** The preview closed. */
  onClose?: () => void;
};

/** A bubble changes on its own this often (ms), one character at a time. */
export const WAITING_LINE_MS = 4500;
/** A flashback card stays this long (ms). */
export const WAITING_CARD_MS = 5200;
/** "auto" rotates cards from this many characters. */
export const WAITING_AUTO_CARDS_FROM = 4;
/** At most this many characters stand in the line-up. */
export const WAITING_LINEUP_MAX = 5;
/** The film moves this many seconds per card. */
export const WAITING_FILM_SECONDS_PER_CARD = 4;
/** How long a bubble fades out before the next line pops in (ms); matches the CSS. */
export const WAITING_BUBBLE_SWAP_MS = 200;
/** The screen fades out this long (ms); matches the CSS. */
export const WAITING_FADE_MS = 320;
/** A tap's ripple (and daylight's light sweep) lasts this long (ms); matches the CSS. */
export const WAITING_RIPPLE_MS = 700;

const TIPS = [
  "Tap a character to hear another of their lines.",
  "History (L) shows every line you have read.",
  "Auto (A) reads on by itself; Skip (S) jumps to Your turn.",
  "Settings → Reading changes this screen.",
];

/** The recap a setting shows for this reply ("auto": line-up up to three, cards from four). */
export function resolveRecapMode(recap: VisualNovelWaitingRecap, data: Pick<WaitingRecap, "characters" | "voices" | "entries">): WaitingRecapMode {
  if (recap !== "auto") return recap;
  const standing = data.characters.length;
  if (standing >= WAITING_AUTO_CARDS_FROM) return "cards";
  if (standing > 0) return "lineup";
  return data.voices.length > 0 ? "cards" : "off";
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const CJK = /[぀-ヿ㐀-鿿가-힯]/;

/** A line in quotes that suit its script: 「…」 for CJK text, “…” otherwise. */
export function quoteLine(text: string): string {
  return CJK.test(text) ? `「${text}」` : `“${text}”`;
}

/** Inline CSS vars that frame a cut-out by its opaque box (the figure is exactly the character). */
export function figureVars(image: RecapImage | null): string {
  const [x, y, w, h] = image?.bbox ?? [0, 0, 1, 1];
  const aspect = (image?.width ?? 832) / (image?.height ?? 1216);
  const safeH = Math.max(0.05, h);
  const ratio = (Math.max(0.05, w) * aspect) / safeH;
  return [
    `--vn-fig-ratio: ${ratio.toFixed(4)}`,
    `--vn-img-h: ${(1 / safeH).toFixed(4)}`,
    `--vn-img-top: ${(-y / safeH).toFixed(4)}`,
    `--vn-img-left: ${(-x * aspect / safeH).toFixed(4)}`,
  ].join("; ");
}

/**
 * Inline CSS for a round face of `size` px cut from a sprite: its detected
 * face, else the top of its opaque box.
 */
export function faceAvatarStyle(image: RecapImage, size: number): string {
  const width = image.width ?? 832;
  const height = image.height ?? 1216;
  const [bx, by, bw] = image.bbox ?? [0, 0, 1, 1];
  const face = image.face ?? [bx + bw * 0.3, by + 0.02, bw * 0.4, bw * 0.4 * (width / height)];
  const [fx, fy, fw, fh] = face;
  const facePx = Math.max(fw * width, fh * height, 1);
  const scale = size / (facePx * 1.7);
  const centreX = (fx + fw / 2) * width * scale;
  const centreY = (fy + fh / 2) * height * scale;
  return [
    `background-image: ${cssUrl(image.url)}`,
    `background-size: ${(width * scale).toFixed(1)}px ${(height * scale).toFixed(1)}px`,
    `background-position: ${(size / 2 - centreX).toFixed(1)}px ${(size / 2 - centreY).toFixed(1)}px`,
  ].join("; ");
}

function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

/** One character standing in the line-up, with the line in their bubble. */
type Figure = { character: RecapCharacter; element: HTMLElement; line: number; swapTimer: ReturnType<typeof setTimeout> | null };

export class WaitingScreen {
  readonly element: HTMLElement;
  private readonly hooks: WaitingScreenHooks;
  private open = false;
  private options: WaitingScreenOptions | null = null;
  private data: WaitingRecap | null = null;
  private figures: Figure[] = [];
  private cardItems: RecapCharacter[] = [];
  private cardIndex = 0;
  private lineTimer: ReturnType<typeof setInterval> | null = null;
  private cardTimer: ReturnType<typeof setInterval> | null = null;
  private tipTimer: ReturnType<typeof setInterval> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private nextFigure = 0;
  private status = "";
  /** The pointer drift waiting for the next frame (null: none pending). */
  private drift: { x: number; y: number } | null = null;
  private rushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(hooks: WaitingScreenHooks = {}) {
    this.hooks = hooks;
    this.element = document.createElement("div");
    this.element.setAttribute("data-vn-waiting", "");
    this.element.setAttribute("role", "region");
    this.element.setAttribute("aria-label", "While the next reply is written");
    this.element.hidden = true;
    this.element.addEventListener("click", (event) => this.onClick(event));
    this.element.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.element.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (this.filmZoomOpen()) {
        event.preventDefault();
        event.stopPropagation();
        this.hideFilmDetail();
        return;
      }
      if (this.options?.preview) {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  isPreview(): boolean {
    return this.open && Boolean(this.options?.preview);
  }

  /** The recap mode on screen, or null when closed. */
  mode(): WaitingRecapMode | null {
    return this.open ? (this.element.dataset.vnRecap as WaitingRecapMode | undefined) ?? null : null;
  }

  show(data: WaitingRecap, options: WaitingScreenOptions, status: string): void {
    this.stopTimers();
    this.open = true;
    this.options = options;
    this.data = data;
    this.status = status;
    const mode = resolveRecapMode(options.recap, data);
    this.element.dataset.vnBackdrop = options.backdrop;
    this.element.dataset.vnRecap = mode;
    this.element.dataset.vnWaitingMotion = String(options.motion);
    if (options.preview) this.element.dataset.vnWaitingPreview = "";
    else delete this.element.dataset.vnWaitingPreview;
    delete this.element.dataset.vnWaitingClosing;
    this.element.innerHTML = this.markup(data, options, mode);
    this.element.hidden = false;
    this.figures = Array.from(this.element.querySelectorAll<HTMLElement>("[data-vn-waiting-figure]"))
      .map((element, index) => ({ character: this.lineupCharacters(data, mode)[index]!, element, line: 0, swapTimer: null }))
      .filter((figure) => Boolean(figure.character));
    this.nextFigure = 0;
    this.cardItems = mode === "cards" ? [...data.characters, ...data.voices].filter((item) => item.lines.length > 0 || item.image) : [];
    this.cardIndex = 0;
    if (mode === "cards") this.renderCard(false);
    this.startTimers(mode);
  }

  /** The status line ("Mira is writing the next scene…"). */
  setStatus(status: string): void {
    this.status = status;
    const element = this.element.querySelector<HTMLElement>("[data-vn-waiting-status]");
    if (element && element.textContent !== status) element.textContent = status;
  }

  /** Fade out and stop. */
  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.stopTimers();
    if (!this.options?.motion) {
      this.element.hidden = true;
      this.element.replaceChildren();
      return;
    }
    this.element.dataset.vnWaitingClosing = "";
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null;
      if (this.open) return;
      this.element.hidden = true;
      this.element.replaceChildren();
    }, WAITING_FADE_MS);
  }

  /** Gone at once (the stage was reset). */
  dismiss(): void {
    this.open = false;
    this.stopTimers();
    if (this.fadeTimer !== null) clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    this.element.hidden = true;
    this.element.replaceChildren();
  }

  private close(): void {
    this.hide();
    this.hooks.onClose?.();
  }

  /** Who stands in the line-up (and in the cast backdrop without a recap). */
  private lineupCharacters(data: WaitingRecap, mode: WaitingRecapMode): RecapCharacter[] {
    if (mode !== "lineup" && !(mode === "off" && (this.options?.backdrop === "cast" || this.options?.backdrop === "tidy"))) return [];
    return data.characters.slice(0, WAITING_LINEUP_MAX);
  }

  private markup(data: WaitingRecap, options: WaitingScreenOptions, mode: WaitingRecapMode): string {
    const words = sceneCardWords(data.scene, data.writer, data.paragraphCount);
    const background = data.backgroundUrl ? ` style="background-image: ${escapeHtml(cssUrl(data.backgroundUrl))}"` : "";
    const cast = data.characters.map((character) => character.name);
    const castLine = cast.length > 0 ? `With ${cast.slice(0, 3).join(", ")}${cast.length > 3 ? ` and ${cast.length - 3} more` : ""}` : "";
    const counts = [
      data.paragraphCount > 0 ? (data.paragraphCount === 1 ? "1 paragraph" : `${data.paragraphCount} paragraphs`) : "",
      cast.length > 0 ? `${cast.length} in the scene` : "",
    ].filter(Boolean).join(" · ");
    const sent = data.sent
      ? `<div data-vn-waiting-sent><span data-vn-waiting-sent-label>You sent</span><p data-vn-waiting-sent-text>${escapeHtml(data.sent)}</p></div>`
      : "";
    const info = `
      <section data-vn-waiting-info>
        ${options.backdrop === "tidy" ? `<p data-vn-tidy-mark aria-hidden="true">— Scene —</p>` : ""}
        <p data-vn-scene-kicker>${escapeHtml(words.kicker)}</p>
        <h2 data-vn-scene-title>${escapeHtml(words.title)}</h2>
        ${words.meta ? `<p data-vn-scene-meta>${escapeHtml(words.meta)}</p>` : ""}
        ${options.backdrop === "tidy" && mode === "off" ? this.tidyFaces(data) : ""}
        <div data-vn-waiting-progress aria-hidden="true"><span></span></div>
        <p data-vn-waiting-status role="status">${escapeHtml(this.status)}</p>
        ${sent}
      </section>`;
    const daylight = options.backdrop === "daylight" ? `
      <div data-vn-daylight-banner aria-hidden="true"><span>Now loading</span></div>
      <aside data-vn-daylight-tip><b>Tip</b><p data-vn-daylight-tip-text>${escapeHtml(TIPS[0]!)}</p></aside>
      <p data-vn-daylight-pill><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5A4.5 4.5 0 0 0 8 1.5zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z"/></svg><span>${escapeHtml(words.title)}</span></p>
      ${castLine || counts ? `<p data-vn-daylight-meta>${escapeHtml([castLine, data.paragraphCount > 0 ? `${data.paragraphCount} paragraphs` : ""].filter(Boolean).join(" · "))}</p>` : ""}
      <div data-vn-daylight-bar aria-hidden="true"><span></span></div>
      ${mode === "off" && data.characters[0]?.image ? `<figure data-vn-daylight-hero aria-hidden="true"><img alt="" draggable="false" src="${escapeHtml(data.characters[0].image.url)}" /></figure>` : ""}` : "";
    const castHeader = options.backdrop === "cast" ? `
      <header data-vn-cast-header><h2>${escapeHtml(words.title)}</h2>${counts ? `<p>${escapeHtml(counts)}</p>` : ""}</header>
      <div data-vn-cast-bar aria-hidden="true"><span></span></div>` : "";
    const preview = options.preview
      ? `<p data-vn-waiting-preview-note>Preview · tap away from the characters to close</p>`
      : "";
    return `
      <div data-vn-waiting-bg aria-hidden="true"${background}></div>
      <div data-vn-waiting-veil aria-hidden="true"></div>
      ${castHeader}
      ${daylight}
      <div data-vn-waiting-stage>${this.recapMarkup(data, mode)}</div>
      ${info}
      ${preview}`;
  }

  private tidyFaces(data: WaitingRecap): string {
    const faces = data.characters.slice(0, 6);
    if (faces.length === 0) return "";
    return `<ul data-vn-tidy-faces>${faces.map((character) => `
      <li style="--vn-figure-color: ${character.color}">
        ${this.avatar(character.image, character.name, 56)}
        <span>${escapeHtml(character.name)}</span>
      </li>`).join("")}</ul>`;
  }

  private avatar(image: RecapImage | null, name: string, size: number, mark?: string): string {
    if (image) return `<span data-vn-avatar style="${escapeHtml(faceAvatarStyle(image, size))}; --vn-avatar-size: ${size}px" aria-hidden="true"></span>`;
    return `<span data-vn-avatar data-vn-avatar-initial style="--vn-avatar-size: ${size}px" aria-hidden="true">${escapeHtml(mark ?? initialOf(name))}</span>`;
  }

  private recapMarkup(data: WaitingRecap, mode: WaitingRecapMode): string {
    if (mode === "lineup" || mode === "off") {
      const standing = this.lineupCharacters(data, mode);
      if (standing.length === 0) return "";
      const bubbles = mode === "lineup";
      return `<div data-vn-lineup style="--vn-lineup-count: ${standing.length}">${standing.map((character, index) => this.figureMarkup(character, index, bubbles)).join("")}</div>`;
    }
    if (mode === "cards") {
      return `
        <div data-vn-recap-cards>
          <figure data-vn-card-figure aria-hidden="true"><img data-vn-card-img data-vn-layer="a" alt="" draggable="false" /><img data-vn-card-img data-vn-layer="b" alt="" draggable="false" /></figure>
          <article data-vn-recap-card aria-live="polite">
            <p data-vn-recap-kicker>Last line</p>
            <h3 data-vn-recap-name></h3>
            <span data-vn-recap-chip hidden></span>
            <p data-vn-recap-line></p>
            <ol data-vn-recap-dots aria-hidden="true"></ol>
          </article>
        </div>`;
    }
    if (mode === "film") {
      const entries = data.entries.filter((entry) => entry.excerpt);
      if (entries.length === 0) return "";
      const cards = entries.map((entry) => this.filmCard(entry, data.paragraphCount)).join("");
      const seconds = Math.max(12, entries.length * WAITING_FILM_SECONDS_PER_CARD);
      const names = data.characters.map((character) => character.name);
      const recapLine = [
        data.scene?.location ? `Last scene: ${data.scene.location}` : "Last scene",
        data.paragraphCount > 0 ? `${data.paragraphCount} paragraphs` : "",
        names.length > 0 ? `with ${names.slice(0, 3).join(", ")}` : "",
      ].filter(Boolean).join(" · ");
      return `
        <div data-vn-film>
          <div data-vn-film-track style="--vn-film-duration: ${seconds}s">${cards}<span data-vn-film-copy aria-hidden="true">${cards}</span></div>
        </div>
        <p data-vn-film-recap>${escapeHtml(recapLine)}</p>
        <div data-vn-film-zoom hidden>
          <article data-vn-film-detail tabindex="-1" aria-live="polite">
            <header data-vn-film-detail-top><span data-vn-film-detail-avatar></span><p data-vn-film-detail-head></p></header>
            <p data-vn-film-detail-text></p>
            <small data-vn-film-detail-hint>Tap to close</small>
          </article>
        </div>`;
    }
    return "";
  }

  private figureMarkup(character: RecapCharacter, index: number, bubbles: boolean): string {
    const line = character.lines[0] ?? null;
    const image = line?.image ?? character.image;
    const body = image
      ? `<span data-vn-figure-body style="${figureVars(image)}"><img data-vn-figure-img data-vn-layer="a" data-vn-front alt="" draggable="false" src="${escapeHtml(image.url)}" /><img data-vn-figure-img data-vn-layer="b" alt="" draggable="false" /></span>`
      : `<span data-vn-figure-body data-vn-figure-plain>${this.avatar(null, character.name, 96)}</span>`;
    const bubble = bubbles && line ? this.bubbleMarkup(line) : "";
    const label = bubbles && character.lines.length > 1 ? `${character.name}: next line` : character.name;
    return `
      <button type="button" data-vn-waiting-figure data-vn-figure-index="${index}" style="--vn-figure-color: ${character.color}; --vn-figure-order: ${index}" aria-label="${escapeHtml(label)}">
        ${bubble}
        ${body}
        <span data-vn-name-tag>${escapeHtml(character.name)}</span>
      </button>`;
  }

  private bubbleMarkup(line: RecapLine): string {
    return `<span data-vn-bubble data-vn-bubble-state="in">${line.chip ? `<span data-vn-bubble-chip>${escapeHtml(line.chip)}</span>` : ""}<span data-vn-bubble-text>${escapeHtml(quoteLine(line.excerpt))}</span></span>`;
  }

  private filmCard(entry: RecapEntry, total: number): string {
    const mark = entry.kind === "voice" ? "✦" : entry.kind === "reader" ? "You" : undefined;
    return `
      <button type="button" data-vn-film-card data-vn-film-kind="${entry.kind}" data-vn-film-index="${entry.index}" style="--vn-figure-color: ${entry.color}">
        <span data-vn-film-head>${this.avatar(entry.kind === "voice" || entry.kind === "reader" ? null : entry.image, entry.speaker || "·", 34, mark)}<span data-vn-film-name>${escapeHtml(entry.speaker || "Narration")}</span>${entry.kind === "reader" ? "" : `<span data-vn-film-count>${entry.index + 1}/${total}</span>`}</span>
        ${entry.chip ? `<span data-vn-film-chip>${escapeHtml(entry.chip)}</span>` : ""}
        <span data-vn-film-text>${escapeHtml(entry.excerpt)}</span>
      </button>`;
  }

  private onClick(event: MouseEvent): void {
    // The stage never reads on underneath.
    event.stopPropagation();
    const target = event.target instanceof Element ? event.target : null;
    // An enlarged film card closes first (also in a preview, which stays open).
    if (this.filmZoomOpen()) {
      this.hideFilmDetail();
      return;
    }
    const figure = target?.closest<HTMLElement>("[data-vn-waiting-figure]");
    if (figure) {
      this.hooks.onTap?.(event);
      this.bounce(figure);
      const found = this.figures.find((item) => item.element === figure);
      if (found && this.element.dataset.vnRecap === "lineup") {
        this.hooks.onPop?.();
        this.nextLine(found);
      }
      return;
    }
    if (target?.closest("[data-vn-recap-cards]")) {
      this.hooks.onTap?.(event);
      this.hooks.onPop?.();
      this.advanceCard(true);
      return;
    }
    const film = target?.closest<HTMLElement>("[data-vn-film-card]");
    if (film) {
      this.hooks.onTap?.(event);
      this.hooks.onPop?.();
      this.showFilmDetail(film);
      return;
    }
    if (this.options?.preview) {
      this.close();
      return;
    }
    this.ripple(event);
  }

  /** The backdrop drifts a little against the pointer (one update per frame). */
  private onPointerMove(event: PointerEvent): void {
    if (!this.open || !this.options?.motion || event.pointerType === "touch") return;
    const box = this.element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const pending = this.drift === null;
    this.drift = {
      x: Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1)),
      y: Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1)),
    };
    if (!pending) return;
    requestAnimationFrame(() => {
      const drift = this.drift;
      this.drift = null;
      if (!drift || !this.open) return;
      this.element.style.setProperty("--vn-waiting-px", drift.x.toFixed(3));
      this.element.style.setProperty("--vn-waiting-py", drift.y.toFixed(3));
    });
  }

  /** A tap on empty space: a ripple at the pointer and, on daylight, a light sweep across the stripes. */
  private ripple(event: MouseEvent): void {
    if (!this.options?.motion) return;
    // Hosts without layout (tests) have no box: the ring starts at the corner.
    const box = typeof this.element.getBoundingClientRect === "function" ? this.element.getBoundingClientRect() : { left: 0, top: 0 };
    const ring = document.createElement("span");
    ring.setAttribute("data-vn-waiting-ripple", "");
    ring.setAttribute("aria-hidden", "true");
    ring.style.setProperty("--vn-ripple-x", `${event.clientX - box.left}px`);
    ring.style.setProperty("--vn-ripple-y", `${event.clientY - box.top}px`);
    this.element.append(ring);
    setTimeout(() => ring.remove(), WAITING_RIPPLE_MS);
    this.element.removeAttribute("data-vn-waiting-rush");
    void this.element.offsetWidth;
    this.element.setAttribute("data-vn-waiting-rush", "");
    if (this.rushTimer !== null) clearTimeout(this.rushTimer);
    this.rushTimer = setTimeout(() => {
      this.rushTimer = null;
      this.element.removeAttribute("data-vn-waiting-rush");
    }, WAITING_RIPPLE_MS);
    this.hooks.onTap?.(event);
  }

  private bounce(element: HTMLElement): void {
    if (!this.options?.motion) return;
    element.removeAttribute("data-vn-figure-bounce");
    // Restart the animation on a second tap.
    void element.offsetWidth;
    element.setAttribute("data-vn-figure-bounce", "");
  }

  /** The figure's next line: the bubble fades out, the next pops in, and the picture changes to that line's. */
  private nextLine(figure: Figure): void {
    const lines = figure.character.lines;
    if (lines.length === 0) return;
    figure.line = (figure.line + 1) % lines.length;
    const line = lines[figure.line]!;
    const bubble = figure.element.querySelector<HTMLElement>("[data-vn-bubble]");
    const apply = (): void => {
      figure.swapTimer = null;
      if (!this.open) return;
      if (bubble) {
        bubble.innerHTML = `${line.chip ? `<span data-vn-bubble-chip>${escapeHtml(line.chip)}</span>` : ""}<span data-vn-bubble-text>${escapeHtml(quoteLine(line.excerpt))}</span>`;
        bubble.dataset.vnBubbleState = "in";
      }
      this.swapFigureImage(figure.element, line.image);
    };
    if (figure.swapTimer !== null) clearTimeout(figure.swapTimer);
    if (bubble && this.options?.motion) {
      bubble.dataset.vnBubbleState = "out";
      figure.swapTimer = setTimeout(apply, WAITING_BUBBLE_SWAP_MS);
    } else {
      apply();
    }
  }

  private swapFigureImage(element: HTMLElement, image: RecapImage | null): void {
    if (!image) return;
    const body = element.querySelector<HTMLElement>("[data-vn-figure-body]");
    const layers = Array.from(element.querySelectorAll<HTMLImageElement>("[data-vn-figure-img]"));
    if (!body || layers.length < 2) return;
    const front = layers.find((layer) => layer.dataset.vnFront !== undefined) ?? layers[0]!;
    if (front.getAttribute("src") === image.url) return;
    const back = front === layers[0] ? layers[1]! : layers[0]!;
    body.setAttribute("style", figureVars(image));
    back.setAttribute("src", image.url);
    back.dataset.vnFront = "";
    delete front.dataset.vnFront;
  }

  private advanceCard(byTap: boolean): void {
    if (this.cardItems.length === 0) return;
    this.cardIndex = (this.cardIndex + 1) % this.cardItems.length;
    this.renderCard(true);
    if (byTap) this.restartCardTimer();
  }

  private renderCard(animate: boolean): void {
    const item = this.cardItems[this.cardIndex];
    const card = this.element.querySelector<HTMLElement>("[data-vn-recap-card]");
    if (!item || !card) return;
    const line = item.lines[item.lines.length - 1] ?? null;
    card.style.setProperty("--vn-figure-color", item.color);
    card.dataset.vnRecapKind = item.kind;
    const name = card.querySelector<HTMLElement>("[data-vn-recap-name]")!;
    const chip = card.querySelector<HTMLElement>("[data-vn-recap-chip]")!;
    const text = card.querySelector<HTMLElement>("[data-vn-recap-line]")!;
    name.textContent = item.name;
    chip.textContent = line?.chip ?? "";
    chip.hidden = !line?.chip;
    text.textContent = line ? quoteLine(line.excerpt) : "";
    const dots = card.querySelector<HTMLElement>("[data-vn-recap-dots]")!;
    dots.innerHTML = this.cardItems.map((_, index) => `<li${index === this.cardIndex ? " data-vn-active" : ""}></li>`).join("");
    if (animate && this.options?.motion) {
      card.removeAttribute("data-vn-card-enter");
      void card.offsetWidth;
      card.setAttribute("data-vn-card-enter", "");
    }
    const figure = this.element.querySelector<HTMLElement>("[data-vn-card-figure]");
    const image = line?.image ?? item.image;
    if (!figure) return;
    figure.dataset.vnCardEmpty = String(!image);
    const layers = Array.from(figure.querySelectorAll<HTMLImageElement>("[data-vn-card-img]"));
    if (!image || layers.length < 2) {
      for (const layer of layers) delete layer.dataset.vnFront;
      return;
    }
    const front = layers.find((layer) => layer.dataset.vnFront !== undefined);
    if (front?.getAttribute("src") === image.url) return;
    const back = front === layers[0] ? layers[1]! : layers[0]!;
    back.setAttribute("src", image.url);
    back.dataset.vnFront = "";
    if (front) delete front.dataset.vnFront;
  }

  /** The film card, enlarged in the middle with its whole paragraph; the film stops under it. */
  private showFilmDetail(card: HTMLElement): void {
    const zoom = this.element.querySelector<HTMLElement>("[data-vn-film-zoom]");
    const detail = zoom?.querySelector<HTMLElement>("[data-vn-film-detail]");
    const index = Number(card.dataset.vnFilmIndex);
    const kind = card.dataset.vnFilmKind;
    const entry = this.data?.entries.find((item) => item.index === index && item.kind === kind);
    if (!zoom || !detail || !entry) return;
    for (const other of this.element.querySelectorAll("[data-vn-film-card][data-vn-film-selected]")) other.removeAttribute("data-vn-film-selected");
    card.setAttribute("data-vn-film-selected", "");
    detail.style.setProperty("--vn-figure-color", entry.color);
    const mark = entry.kind === "voice" ? "✦" : entry.kind === "reader" ? "You" : undefined;
    const pictured = entry.kind === "voice" || entry.kind === "reader" ? null : entry.image;
    const avatar = detail.querySelector<HTMLElement>("[data-vn-film-detail-avatar]")!;
    avatar.innerHTML = entry.kind === "narration" ? "" : this.avatar(pictured, entry.speaker || "·", 64, mark);
    avatar.hidden = entry.kind === "narration";
    detail.querySelector<HTMLElement>("[data-vn-film-detail-head]")!.textContent = [entry.speaker || "Narration", entry.chip].filter(Boolean).join(" · ");
    detail.querySelector<HTMLElement>("[data-vn-film-detail-text]")!.textContent = entry.text.replace(/<[^>]+>/g, "");
    this.element.querySelector("[data-vn-film]")?.setAttribute("data-vn-film-open", "");
    zoom.hidden = false;
    detail.focus({ preventScroll: true });
  }

  private filmZoomOpen(): boolean {
    const zoom = this.element.querySelector<HTMLElement>("[data-vn-film-zoom]");
    return Boolean(zoom && !zoom.hidden);
  }

  /** The enlarged film card closes and the film moves on. */
  private hideFilmDetail(): void {
    const zoom = this.element.querySelector<HTMLElement>("[data-vn-film-zoom]");
    if (zoom) zoom.hidden = true;
    this.element.querySelector("[data-vn-film]")?.removeAttribute("data-vn-film-open");
    for (const card of this.element.querySelectorAll("[data-vn-film-card][data-vn-film-selected]")) card.removeAttribute("data-vn-film-selected");
  }

  private startTimers(mode: WaitingRecapMode): void {
    if (mode === "lineup" && this.figures.some((figure) => figure.character.lines.length > 1)) {
      this.lineTimer = setInterval(() => {
        if (!this.open) return;
        const talkers = this.figures.filter((figure) => figure.character.lines.length > 1);
        if (talkers.length === 0) return;
        const figure = talkers[this.nextFigure % talkers.length]!;
        this.nextFigure += 1;
        this.nextLine(figure);
      }, WAITING_LINE_MS);
    }
    if (mode === "cards") this.restartCardTimer();
    if (this.options?.backdrop === "daylight") {
      let tip = 0;
      this.tipTimer = setInterval(() => {
        const element = this.element.querySelector<HTMLElement>("[data-vn-daylight-tip-text]");
        if (!element) return;
        tip = (tip + 1) % TIPS.length;
        element.textContent = TIPS[tip]!;
      }, WAITING_CARD_MS * 1.5);
    }
  }

  private restartCardTimer(): void {
    if (this.cardTimer !== null) clearInterval(this.cardTimer);
    this.cardTimer = this.cardItems.length > 1 ? setInterval(() => { if (this.open) this.advanceCard(false); }, WAITING_CARD_MS) : null;
  }

  private stopTimers(): void {
    if (this.lineTimer !== null) clearInterval(this.lineTimer);
    if (this.cardTimer !== null) clearInterval(this.cardTimer);
    if (this.tipTimer !== null) clearInterval(this.tipTimer);
    this.lineTimer = null;
    this.cardTimer = null;
    this.tipTimer = null;
    for (const figure of this.figures) if (figure.swapTimer !== null) clearTimeout(figure.swapTimer);
    if (this.fadeTimer !== null) clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    if (this.rushTimer !== null) clearTimeout(this.rushTimer);
    this.rushTimer = null;
    this.element.removeAttribute("data-vn-waiting-rush");
  }
}
