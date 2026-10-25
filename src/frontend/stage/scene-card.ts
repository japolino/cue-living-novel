/**
 * The scene's own chrome: the opening card a reply opens with (the place, its
 * time and weather, over the card's background picture, while the reply's
 * pictures are prepared) and the location label that stays at the top left
 * while reading. Markup and timing only; VnStage decides when they show and
 * the styles live in theme/waiting-css.ts.
 */
import type { VnScene } from "../store/vn-store.js";
import { sceneKickerPlace, sceneMetaLine } from "./recap.js";

/** The opening card closes by itself this long after it opened, ready or not (reading needs no pictures). */
export const OPENING_CARD_MAX_WAIT_MS = 5000;
/** How long the card fades out (ms); matches the CSS. */
export const OPENING_CARD_FADE_MS = 320;

export type OpeningCardContent = {
  scene: VnScene | null;
  /** Shown when no scene is known yet (the card's name). */
  fallbackTitle: string;
  paragraphCount: number;
  backgroundUrl: string | null;
};

export type OpeningCardTiming = {
  /** Shown at least this long before it closes by itself (ms). */
  minMs: number;
  /** Closes by itself once ready; false: waits for a tap. */
  autoStart: boolean;
  /** Fades and grows its rule; false shows and hides at once. */
  motion: boolean;
};

/** A CSS `url()` for a picture URL (quotes, backslashes and line breaks escaped). */
export const cssUrl = (value: string): string =>
  `url("${value.replace(/["\\\n\r]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `)}")`;

/** The words on a scene card: kicker, title and meta line. */
export function sceneCardWords(scene: VnScene | null, fallbackTitle: string, paragraphCount: number): { kicker: string; title: string; meta: string } {
  const place = sceneKickerPlace(scene?.location);
  return {
    kicker: place ? `Scene · ${place}` : "Scene",
    title: scene?.location?.trim() || fallbackTitle.trim() || "The next scene",
    meta: sceneMetaLine(scene, paragraphCount),
  };
}

export class OpeningCard {
  readonly element: HTMLElement;
  private readonly background: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly title: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly status: HTMLElement;
  private readonly onClose: () => void;
  private open = false;
  private ready = false;
  private shownAt = 0;
  private timing: OpeningCardTiming = { minMs: 1500, autoStart: true, motion: true };
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(onClose: () => void) {
    this.onClose = onClose;
    this.element = document.createElement("div");
    this.element.setAttribute("data-vn-opening", "");
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", "Scene");
    this.element.hidden = true;
    this.element.innerHTML = `
      <div data-vn-opening-bg aria-hidden="true"></div>
      <div data-vn-opening-card>
        <p data-vn-scene-kicker></p>
        <h2 data-vn-scene-title></h2>
        <p data-vn-scene-meta></p>
        <span data-vn-scene-rule aria-hidden="true"></span>
        <p data-vn-opening-status aria-live="polite"></p>
      </div>
      <p data-vn-opening-hint>Tap or Space to start · S skips to Your turn</p>
    `;
    this.background = this.element.querySelector("[data-vn-opening-bg]")!;
    this.kicker = this.element.querySelector("[data-vn-scene-kicker]")!;
    this.title = this.element.querySelector("[data-vn-scene-title]")!;
    this.meta = this.element.querySelector("[data-vn-scene-meta]")!;
    this.status = this.element.querySelector("[data-vn-opening-status]")!;
  }

  isOpen(): boolean {
    return this.open;
  }

  show(content: OpeningCardContent, timing: OpeningCardTiming): void {
    this.clearTimers();
    this.open = true;
    this.ready = false;
    this.timing = timing;
    this.shownAt = Date.now();
    this.update(content);
    this.element.hidden = false;
    this.element.dataset.vnOpeningMotion = String(timing.motion);
    delete this.element.dataset.vnOpeningClosing;
    this.renderStatus();
    // Not ready this long: start anyway (the text can be read while pictures load).
    this.closeTimer = setTimeout(() => this.markReady(true), Math.max(OPENING_CARD_MAX_WAIT_MS, timing.minMs));
  }

  /** New words for an open card (the plan arrived with the scene's place). */
  update(content: OpeningCardContent): void {
    const words = sceneCardWords(content.scene, content.fallbackTitle, content.paragraphCount);
    if (this.kicker.textContent !== words.kicker) this.kicker.textContent = words.kicker;
    if (this.title.textContent !== words.title) this.title.textContent = words.title;
    if (this.meta.textContent !== words.meta) this.meta.textContent = words.meta;
    this.meta.hidden = !words.meta;
    const image = content.backgroundUrl ? cssUrl(content.backgroundUrl) : "";
    if (this.background.style.backgroundImage !== image) this.background.style.backgroundImage = image;
    if (content.backgroundUrl) this.element.dataset.vnOpeningPicture = "";
    else delete this.element.dataset.vnOpeningPicture;
  }

  /** The reply's first picture is ready (or will not come): close by itself once the minimum time has passed. */
  markReady(ready: boolean): void {
    if (!this.open || this.ready === ready) return;
    this.ready = ready;
    this.renderStatus();
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    this.closeTimer = null;
    const elapsed = Date.now() - this.shownAt;
    if (!ready) {
      // Not ready again (another picture is on its way): wait for it, but no longer than the cap.
      const cap = Math.max(OPENING_CARD_MAX_WAIT_MS, this.timing.minMs);
      this.closeTimer = setTimeout(() => this.markReady(true), Math.max(0, cap - elapsed));
      return;
    }
    if (!this.timing.autoStart) return;
    this.closeTimer = setTimeout(() => this.close(), Math.max(0, this.timing.minMs - elapsed));
  }

  /** Close (a tap, or by itself). The stage starts reading in `onClose`. */
  close(): void {
    if (!this.open) return;
    this.clearTimers();
    this.open = false;
    if (!this.timing.motion) {
      this.element.hidden = true;
    } else {
      this.element.dataset.vnOpeningClosing = "";
      this.fadeTimer = setTimeout(() => {
        this.fadeTimer = null;
        if (!this.open) this.element.hidden = true;
      }, OPENING_CARD_FADE_MS);
    }
    this.onClose();
  }

  /** Gone at once, without starting anything (the stage was reset). */
  dismiss(): void {
    this.clearTimers();
    this.open = false;
    this.element.hidden = true;
  }

  private renderStatus(): void {
    const text = !this.ready
      ? "Preparing the scene…"
      : this.timing.autoStart ? "Ready" : "Ready · tap to start";
    if (this.status.textContent !== text) this.status.textContent = text;
    this.element.dataset.vnOpeningReady = String(this.ready);
  }

  private clearTimers(): void {
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    if (this.fadeTimer !== null) clearTimeout(this.fadeTimer);
    this.closeTimer = null;
    this.fadeTimer = null;
  }
}

/** The location label at the top left while reading: "Location", the place, its time and weather. */
export class LocationLabel {
  readonly element: HTMLElement;
  private readonly place: HTMLElement;
  private readonly meta: HTMLElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.setAttribute("data-vn-location", "");
    this.element.setAttribute("aria-label", "Location");
    this.element.hidden = true;
    this.element.innerHTML = `
      <span data-vn-location-kicker aria-hidden="true">Location</span>
      <span data-vn-location-place></span>
      <span data-vn-location-meta></span>
    `;
    this.place = this.element.querySelector("[data-vn-location-place]")!;
    this.meta = this.element.querySelector("[data-vn-location-meta]")!;
  }

  /** Show `scene` (null hides the label). */
  render(scene: VnScene | null): void {
    const place = scene?.location?.trim() ?? "";
    const meta = [scene?.timeOfDay, scene?.weather].map((part) => part?.trim()).filter(Boolean).join(" · ");
    if (this.place.textContent !== place) this.place.textContent = place;
    if (this.meta.textContent !== meta) this.meta.textContent = meta;
    this.meta.hidden = !meta;
    this.element.hidden = !place;
  }
}
