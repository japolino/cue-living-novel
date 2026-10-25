/**
 * Touch mode's own layer on the stage (docs/SPRITE_MODE.md, "Touch"): the
 * hand cursor, the line bubble, the heart gauges and each character's touch
 * state (escalation, bond, lines). VnStage finds the figure and the zone
 * under a tap (sprite layer or waiting-screen line-up) and hands it here
 * with a `react` callback that shows the reaction on that figure.
 *
 * Zero model calls per touch: the reaction comes from sprite-touch.ts and
 * the line from the character's cached pack (or the generic lines). The
 * host loads each character's saved bond and pack once (`onCharacters`),
 * asks for a pack the first time a character without one is touchable
 * (`onLines`, one call per character, made once) or when the reader
 * presses Refresh, and saves the bond a moment after it changes (`onBond`).
 */
import { DEFAULT_CONFIG, spriteTouchSettings, type VisualNovelSpriteTouch } from "../../config.js";
import { normalizeTouchBond, touchBondTier, type TouchBondTier, type TouchCharacterRef, type TouchCharacterState, type TouchLinePack } from "../../shared/touch.js";
import type { InterfaceSounds } from "./interface-sounds.js";
import {
  TOUCH_INTENSITY,
  bondAfter,
  pickTouchLine,
  touchHandMarkup,
  touchMemory,
  touchReaction,
  touchStep,
  touchZoneOf,
  type TouchArea,
  type TouchHand,
  type TouchMemory,
  type TouchMotion,
  type TouchReaction,
} from "./sprite-touch.js";

/** A changed bond is saved this long after the last touch (one write per burst). */
export const TOUCH_BOND_SAVE_MS = 1200;
/** The hand's touch animation runs this long; a tap's hand on a touch screen fades after it. */
export const TOUCH_HAND_ANIM_MS = 560;
/** The bubble fades out this long (ms); matches the CSS. */
export const TOUCH_BUBBLE_FADE_MS = 240;

export type SpriteTouchCallbacks = {
  /** Characters new to this stage: load their saved bond and lines (answered by `applyStates`). */
  onCharacters?: (characters: TouchCharacterRef[]) => void;
  /** A character's bond changed (saved with its card). */
  onBond?: (character: TouchCharacterRef, bond: number) => void;
  /** Make (or remake, `refresh`) a character's line pack; answered by `applyLines`. */
  onLines?: (character: TouchCharacterRef, refresh: boolean) => void;
};

/** What the figure shows for a reaction, as the stage applies it. */
export type TouchShow = {
  reaction: TouchReaction;
  /** Motion allowed (Motion not "off", no reduced motion). */
  motion: boolean;
  amp: number;
  holdMs: number;
  /** Show the emote (off at gentle intensity, except blush). */
  emote: boolean;
  line: string | null;
};

export type SpriteTouchOptions = {
  /** The stage root the layer goes in (`[data-vn-root]`). */
  root: HTMLElement;
  sounds: Pick<InterfaceSounds, "touch">;
  callbacks: SpriteTouchCallbacks;
  /** Whether motion is allowed now (Motion not "off", no reduced motion). */
  motion: () => boolean;
  now?: () => number;
  random?: () => number;
};

type LinesState = "none" | "pending" | "ready" | "failed";

type Character = {
  ref: TouchCharacterRef;
  memory: TouchMemory;
  bond: number;
  /** The saved bond and pack arrived (or the host has none to give). */
  loaded: boolean;
  pack: TouchLinePack | null;
  lines: LinesState;
  linesError: string | null;
  recent: string[];
  saveTimer: ReturnType<typeof setTimeout> | null;
};

export type SpriteTouchSnapshot = {
  active: boolean;
  characters: Array<{ characterKey: string; name: string; bond: number; tier: TouchBondTier; lines: LinesState; ownLines: boolean }>;
  /** The last touch that reacted, or null. */
  last: { characterKey: string; area: TouchArea; zone: TouchReaction["zone"]; mood: TouchReaction["mood"]; expression: string; emote: string; motion: TouchMotion; line: string | null; bond: number } | null;
  /** The line in the bubble now, or null. */
  bubble: string | null;
  cursor: { hand: TouchHand | null; visible: boolean; anim: string | null };
};

const TIER_WORD: Readonly<Record<TouchBondTier, string>> = { shy: "Shy", warm: "Warm", fond: "Fond" };

const HEART_PATH = "M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.6 4.5c2.2 0 3.7 1.3 5.4 3.3 1.7-2 3.2-3.3 5.4-3.3 3.6 0 5.7 3.8 4.2 7.2C19.5 16.4 12 21 12 21z";
const HEART_OUTLINE = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${HEART_PATH}" fill="rgba(255,255,255,0.12)" stroke="#ff8db4" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const HEART_FILL = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${HEART_PATH}" fill="#ff6c9d" stroke="#ff8db4" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const REFRESH_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 5.7" /><path d="M13.5 2.5v3.2h-3.2" /><path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10.3" /><path d="M2.5 13.5v-3.2h3.2" /></svg>`;

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

const clockNow = (): number => (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now());

export class SpriteTouch {
  private active = false;
  private settings: VisualNovelSpriteTouch = spriteTouchSettings(DEFAULT_CONFIG);
  private readonly characters = new Map<string, Character>();
  /** Characters touchable now (on stage or in the line-up), in the gauges' order. */
  private touchable: string[] = [];
  private layer: HTMLElement | null = null;
  private cursor: HTMLElement | null = null;
  private bubble: HTMLElement | null = null;
  private hud: HTMLElement | null = null;
  private hand: TouchHand | null = null;
  private cursorVisible = false;
  private cursorAnim: string | null = null;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  private bubbleText: string | null = null;
  private last: SpriteTouchSnapshot["last"] = null;
  private destroyed = false;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly options: SpriteTouchOptions) {
    this.now = options.now ?? clockNow;
    this.random = options.random ?? Math.random;
  }

  setSettings(settings: VisualNovelSpriteTouch): void {
    const linesWereOn = this.settings.spriteTouchLines;
    this.settings = spriteTouchSettings(settings);
    if (!this.settings.spriteTouch && this.active) this.setActive(false);
    if (this.settings.spriteTouchLines && !linesWereOn) for (const character of this.characters.values()) if (character.lines === "failed") character.lines = "none";
    this.requestLines();
    this.renderHud();
  }

  getSettings(): VisualNovelSpriteTouch {
    return { ...this.settings };
  }

  isActive(): boolean {
    return this.active;
  }

  /** Touch mode on or off. Off hides the hand, the bubble and the gauges, and saves any pending bond at once. */
  setActive(active: boolean): void {
    const next = active && this.settings.spriteTouch;
    if (next === this.active || this.destroyed) return;
    this.active = next;
    if (next) {
      this.ensureLayer();
      this.layer!.hidden = false;
      this.options.root.dataset.vnTouch = "on";
      this.requestLines();
      this.renderHud();
    } else {
      delete this.options.root.dataset.vnTouch;
      delete this.options.root.dataset.vnTouchHover;
      this.hideCursor();
      this.hideBubble(true);
      if (this.layer) this.layer.hidden = true;
      this.flushSaves();
    }
  }

  /**
   * Who can be touched now (the characters on stage, or the line-up). New
   * ones are announced once (`onCharacters`) to load their bond and lines.
   */
  setCharacters(refs: readonly TouchCharacterRef[]): void {
    const fresh: TouchCharacterRef[] = [];
    for (const ref of refs) {
      const known = this.characters.get(ref.characterKey);
      if (known) {
        known.ref = ref;
        continue;
      }
      this.characters.set(ref.characterKey, {
        ref, memory: touchMemory(), bond: 0, loaded: !this.options.callbacks.onCharacters, pack: null,
        lines: "none", linesError: null, recent: [], saveTimer: null,
      });
      fresh.push(ref);
    }
    const keys = refs.map((ref) => ref.characterKey);
    const changed = keys.join("\u0000") !== this.touchable.join("\u0000");
    this.touchable = keys;
    if (fresh.length) this.options.callbacks.onCharacters?.(fresh);
    this.requestLines();
    if (changed || fresh.length) this.renderHud();
  }

  /** Saved bonds and packs arrived (`vn_touch_state`). */
  applyStates(states: readonly TouchCharacterState[]): void {
    for (const state of states) {
      const character = this.characters.get(state.characterKey);
      if (!character) continue;
      character.loaded = true;
      // A touch made while the state was on its way counts on top of it.
      if (!character.saveTimer) character.bond = normalizeTouchBond(state.bond);
      if (state.pack) {
        character.pack = state.pack;
        character.lines = "ready";
      }
    }
    this.requestLines();
    this.renderHud();
  }

  /** A character's pack arrived, or the call failed (`vn_touch_lines`). */
  applyLines(characterKey: string, pack: TouchLinePack | null, error?: string): void {
    const character = this.characters.get(characterKey);
    if (!character) return;
    if (pack) {
      character.pack = pack;
      character.lines = "ready";
      character.linesError = null;
      character.recent = [];
    } else {
      character.lines = "failed";
      character.linesError = error?.trim() || "The lines could not be written.";
    }
    this.renderHud();
  }

  /** Ask for new lines for a character (the Refresh button). */
  refreshLines(characterKey: string): void {
    const character = this.characters.get(characterKey);
    if (!character || !this.settings.spriteTouchLines || character.lines === "pending" || !this.options.callbacks.onLines) return;
    character.lines = "pending";
    character.linesError = null;
    this.options.callbacks.onLines(character.ref, true);
    this.renderHud();
  }

  /** The pointer moved: the hand follows it over a character (`hand`), the pointer stays elsewhere. */
  hover(x: number, y: number, hand: TouchHand | null): void {
    if (!this.active || this.destroyed) return;
    if (!hand) {
      delete this.options.root.dataset.vnTouchHover;
      if (!this.cursorTimer) this.hideCursor();
      return;
    }
    this.options.root.dataset.vnTouchHover = "";
    this.placeCursor(x, y, hand);
  }

  /** The pointer left the stage. */
  leave(): void {
    delete this.options.root.dataset.vnTouchHover;
    if (!this.cursorTimer) this.hideCursor();
  }

  /**
   * A tap on a character's `area`. Plays the reaction (`react` shows it on
   * the figure and says whether it could), the hand at the tap, the sound
   * and the line in a bubble at `head` (client px). Returns the reaction, or
   * null when the touch came too soon after the last one (only the hand
   * moves then) or the character is not touchable.
   */
  touch(input: {
    ref: TouchCharacterRef;
    area: TouchArea;
    point: { x: number; y: number };
    head: { x: number; y: number };
    animalEars: boolean;
    react: (show: TouchShow) => boolean;
  }): TouchReaction | null {
    if (!this.active || this.destroyed) return null;
    let character = this.characters.get(input.ref.characterKey);
    if (!character) {
      this.setCharacters([...this.touchable.map((key) => this.characters.get(key)!.ref), input.ref]);
      character = this.characters.get(input.ref.characterKey)!;
    }
    const motion = this.options.motion();
    const zone = touchZoneOf(input.area, input.animalEars);
    const step = touchStep(character.memory, zone, character.bond, this.now());
    this.playHand(input.point, input.area, step ? touchReaction(zone, step).motion : null, motion);
    if (!step) return null;
    const reaction = touchReaction(zone, step);
    const intensity = TOUCH_INTENSITY[this.settings.spriteTouchIntensity] ?? TOUCH_INTENSITY.normal;
    const line = reaction.speaks
      ? pickTouchLine(this.settings.spriteTouchLines ? character.pack : null, zone, reaction.mood, character.recent, this.random)
      : null;
    const shown = input.react({
      reaction,
      motion,
      amp: intensity.amp,
      holdMs: intensity.holdMs,
      emote: intensity.emotes || reaction.emote === "blush",
      line,
    });
    if (!shown) return null;
    this.options.sounds.touch(reaction.sound);
    if (line) this.showBubble(line, character.ref.name, input.head, intensity.holdMs, motion);
    const bond = bondAfter(character.bond, reaction);
    if (bond !== character.bond) {
      character.bond = bond;
      this.scheduleSave(character);
      this.renderHud();
    }
    this.last = {
      characterKey: character.ref.characterKey, area: input.area, zone, mood: reaction.mood, expression: reaction.expression,
      emote: reaction.emote, motion: reaction.motion, line, bond,
    };
    return reaction;
  }

  /** Forget every character (another chat opens): pending bonds are saved first. */
  forget(): void {
    this.flushSaves();
    this.characters.clear();
    this.touchable = [];
    this.last = null;
    this.hideBubble(true);
    this.renderHud();
  }

  /** A character's bond (0 for one not seen). */
  bondOf(characterKey: string): number {
    return this.characters.get(characterKey)?.bond ?? 0;
  }

  snapshot(): SpriteTouchSnapshot {
    return {
      active: this.active,
      characters: this.touchable.map((key) => {
        const character = this.characters.get(key)!;
        return { characterKey: key, name: character.ref.name, bond: character.bond, tier: touchBondTier(character.bond), lines: character.lines, ownLines: Boolean(character.pack) };
      }),
      last: this.last,
      bubble: this.bubbleText,
      cursor: { hand: this.hand, visible: this.cursorVisible, anim: this.cursorAnim },
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.flushSaves();
    this.destroyed = true;
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.layer?.remove();
    this.layer = null;
  }

  /* ---- internals ----------------------------------------------------- */

  private ensureLayer(): void {
    if (this.layer) return;
    const layer = document.createElement("div");
    layer.setAttribute("data-vn-touch-layer", "");
    layer.hidden = true;
    const cursor = document.createElement("div");
    cursor.setAttribute("data-vn-touch-cursor", "");
    cursor.setAttribute("aria-hidden", "true");
    const bubble = document.createElement("p");
    bubble.setAttribute("data-vn-touch-bubble", "");
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-live", "polite");
    bubble.hidden = true;
    const hud = document.createElement("ul");
    hud.setAttribute("data-vn-touch-hud", "");
    hud.setAttribute("aria-label", "Bond");
    hud.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-vn-touch-refresh]") : null;
      event.stopPropagation();
      if (button && !button.disabled) this.refreshLines(button.dataset.vnTouchKey ?? "");
    });
    layer.append(hud, bubble, cursor);
    this.options.root.append(layer);
    this.layer = layer;
    this.cursor = cursor;
    this.bubble = bubble;
    this.hud = hud;
  }

  /** Ask for the pack of every touchable character that has none (once each), while touch mode is on. */
  private requestLines(): void {
    if (!this.active || !this.settings.spriteTouchLines || !this.options.callbacks.onLines) return;
    for (const key of this.touchable) {
      const character = this.characters.get(key);
      if (!character || !character.loaded || character.pack || character.lines !== "none") continue;
      character.lines = "pending";
      this.options.callbacks.onLines(character.ref, false);
    }
  }

  private scheduleSave(character: Character): void {
    if (!this.options.callbacks.onBond) return;
    if (character.saveTimer) clearTimeout(character.saveTimer);
    character.saveTimer = setTimeout(() => {
      character.saveTimer = null;
      this.options.callbacks.onBond?.(character.ref, character.bond);
    }, TOUCH_BOND_SAVE_MS);
  }

  private flushSaves(): void {
    for (const character of this.characters.values()) {
      if (!character.saveTimer) continue;
      clearTimeout(character.saveTimer);
      character.saveTimer = null;
      this.options.callbacks.onBond?.(character.ref, character.bond);
    }
  }

  private local(x: number, y: number): { x: number; y: number; width: number; height: number } {
    const box = typeof this.options.root.getBoundingClientRect === "function"
      ? this.options.root.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    return { x: x - box.left, y: y - box.top, width: box.width, height: box.height };
  }

  private placeCursor(x: number, y: number, hand: TouchHand): void {
    this.ensureLayer();
    const cursor = this.cursor!;
    if (this.hand !== hand) {
      this.hand = hand;
      cursor.dataset.vnTouchHand = hand;
      cursor.innerHTML = touchHandMarkup(hand);
    }
    const at = this.local(x, y);
    cursor.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
    cursor.dataset.vnTouchVisible = "";
    this.cursorVisible = true;
  }

  private hideCursor(): void {
    if (!this.cursor) return;
    delete this.cursor.dataset.vnTouchVisible;
    this.cursorVisible = false;
  }

  /** The hand at the tap, playing the touch (still without motion); on a touch screen it fades after. */
  private playHand(point: { x: number; y: number }, area: TouchArea, motion: TouchMotion | null, animate: boolean): void {
    const hand: TouchHand = area === "cheeks" ? "hands" : area === "head" || area === "side" ? "palm" : "finger";
    this.placeCursor(point.x, point.y, hand);
    const cursor = this.cursor!;
    if (this.layer) {
      if (animate) delete this.layer.dataset.vnTouchStill;
      else this.layer.dataset.vnTouchStill = "";
    }
    delete cursor.dataset.vnTouchAnim;
    this.cursorAnim = null;
    if (motion) {
      void cursor.offsetWidth;
      cursor.dataset.vnTouchAnim = motion;
      this.cursorAnim = motion;
    }
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = null;
      delete cursor.dataset.vnTouchAnim;
      this.cursorAnim = null;
      // A touch screen has no pointer to follow: the hand goes once the touch is done.
      if (this.options.root.dataset.vnTouchHover === undefined) this.hideCursor();
    }, TOUCH_HAND_ANIM_MS);
  }

  private showBubble(line: string, name: string, head: { x: number; y: number }, holdMs: number, animate: boolean): void {
    this.ensureLayer();
    const bubble = this.bubble!;
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    // The colon is for screen readers ("Mira: Hey!"); the name sits on its own line on screen.
    bubble.innerHTML = `<span data-vn-touch-name>${escapeHtml(name)}</span><span data-vn-touch-sep>: </span><span data-vn-touch-line>${escapeHtml(line)}</span>`;
    bubble.hidden = false;
    delete bubble.dataset.vnTouchOut;
    delete bubble.dataset.vnTouchIn;
    if (animate) {
      void bubble.offsetWidth;
      bubble.dataset.vnTouchIn = "";
    }
    this.bubbleText = line;
    // Keep the bubble on screen; its tail still points at the head.
    const at = this.local(head.x, head.y);
    const half = (bubble.offsetWidth || 0) / 2;
    const margin = 12;
    const x = at.width > 0 ? Math.max(margin + half, Math.min(at.width - margin - half, at.x)) : at.x;
    const height = bubble.offsetHeight || 0;
    const y = Math.max(height + margin, at.y - 10);
    bubble.style.left = `${Math.round(x)}px`;
    bubble.style.top = `${Math.round(y)}px`;
    bubble.style.setProperty("--vn-touch-tail", `calc(50% + ${Math.round(at.x - x)}px)`);
    this.bubbleTimer = setTimeout(() => this.hideBubble(false), holdMs);
  }

  private hideBubble(now: boolean): void {
    const bubble = this.bubble;
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = null;
    this.bubbleText = null;
    if (!bubble || bubble.hidden) return;
    if (now) {
      bubble.hidden = true;
      return;
    }
    bubble.dataset.vnTouchOut = "";
    this.bubbleTimer = setTimeout(() => {
      this.bubbleTimer = null;
      bubble.hidden = true;
      delete bubble.dataset.vnTouchOut;
    }, TOUCH_BUBBLE_FADE_MS);
  }

  /** The gauges: one heart per touchable character, with its tier and the Refresh button. */
  private renderHud(): void {
    const hud = this.hud;
    if (!hud || !this.active) return;
    const focus = (typeof hud.getRootNode === "function" ? (hud.getRootNode() as Document | ShadowRoot).activeElement : null) ?? null;
    const focusedKey = focus instanceof HTMLElement && hud.contains(focus) ? focus.dataset.vnTouchKey ?? null : null;
    hud.hidden = this.touchable.length === 0;
    hud.innerHTML = this.touchable.map((key) => {
      const character = this.characters.get(key)!;
      const { name } = character.ref;
      const tier = touchBondTier(character.bond);
      const share = character.bond / 100;
      const refresh = this.settings.spriteTouchLines && this.options.callbacks.onLines
        ? (() => {
          const pending = character.lines === "pending";
          const label = pending ? `Writing touch lines for ${name}` : `Write new touch lines for ${name} (one model call)`;
          const title = character.lines === "failed" && character.linesError ? `${character.linesError} Try again.` : label;
          return `<button type="button" data-vn-touch-refresh data-vn-touch-key="${escapeHtml(key)}" data-vn-touch-lines="${character.lines}" aria-label="${escapeHtml(label)}" title="${escapeHtml(title)}"${pending ? " disabled" : ""}>${REFRESH_ICON}</button>`;
        })()
        : "";
      return `<li data-vn-touch-gauge data-vn-touch-key="${escapeHtml(key)}" data-vn-touch-tier-id="${tier}">`
        + `<span data-vn-touch-heart role="meter" aria-label="${escapeHtml(name)}'s bond" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${character.bond}" aria-valuetext="${character.bond} of 100, ${TIER_WORD[tier].toLowerCase()}" style="--vn-touch-bond: ${share.toFixed(2)}">${HEART_OUTLINE}${HEART_FILL}</span>`
        + `<span data-vn-touch-gauge-name>${escapeHtml(name)}</span><span data-vn-touch-tier>${TIER_WORD[tier]}</span>${refresh}</li>`;
    }).join("");
    // Rewriting the gauges keeps the keyboard where it was.
    if (focusedKey) {
      for (const button of hud.querySelectorAll<HTMLButtonElement>("[data-vn-touch-refresh]")) {
        if (button.dataset.vnTouchKey === focusedKey) button.focus({ preventScroll: true });
      }
    }
  }
}
