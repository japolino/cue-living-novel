import {
  escapeHtml,
  formatDialogueText,
  parseCustomRegexRules,
  type CustomRegexRule,
} from "./rich-text.js";
import {
  createInitialVnStageState,
  reduceVnStage,
  selectVnStageView,
  type VnActivity,
  type VnAssetProgress,
  type VnChoice,
  type VnPhase,
  type VnSceneImage,
  type AmbientEffect,
  type StageEffect,
  type VnParagraph,
  type VnStageAction,
  type VnStageState,
  type VnTurnInput,
} from "../store";
import { generateAmbientMarkup, generateCueEffectMarkup } from "./procedural-particles.js";

export type { StageEffect };
export type { AmbientEffect };

const STAGE_EFFECT_IDS: ReadonlySet<string> = new Set([
  "shake",
  "flash_white",
  "flash_red",
  "zoom_in",
  "fade_to_black",
  "shake_hard",
  "rumble",
  "zoom_punch",
  "speed_lines",
  "fade_from_black",
  "fade_to_white",
  "lightning",
  "zoom_out",
  "tilt",
  "heartbeat",
  "blur_pulse",
  "sparkle_burst",
  "hearts_burst",
  "confetti",
]);

const AMBIENT_EFFECT_IDS: ReadonlySet<string> = new Set([
  "rain",
  "heavy_rain",
  "snow",
  "sakura",
  "fog",
  "fireflies",
  "embers",
  "vignette_dark",
  "sepia_flashback",
  "desaturate",
  "dream_haze",
  "danger_pulse",
]);

export function isStageEffect(value: unknown): value is StageEffect {
  return typeof value === "string" && STAGE_EFFECT_IDS.has(value);
}

export function isAmbientEffect(value: unknown): value is AmbientEffect {
  return typeof value === "string" && AMBIENT_EFFECT_IDS.has(value);
}

export const TEXT_SHAKE_HEURISTIC_REGEX = /\*\s*(?:thud|slam|crash|smack|shake)[!?.,]*\s*\*/i;
import type {
  VisualNovelSceneImageFit,
  VisualNovelThemePreset,
} from "../../config.js";
import {
  applyVnUserCss,
  VN_BASE_CSS,
  VN_ORNAMENT_LAYER_MARKUP,
  VN_OUTER_CSS,
  THEME_PRESET_CSS,
  THEME_STYLE_LAYER_ATTRIBUTE,
  THEME_STYLE_LAYER_ORDER,
  type ThemeStyleLayer,
} from "../theme";
import {
  preloadAndDecodeVnImage,
  type VnImageFactory,
} from "./image-loader";

export interface VnStageCallbacks {
  onAdvance?: (paragraphIndex: number, inputUnlocked: boolean) => void;
  onChoice?: (choice: VnChoice) => void | Promise<void>;
  onSubmit?: (text: string) => void | Promise<void>;
  onExit?: () => void;
  onReroll?: () => void | Promise<void>;
  onSwipe?: () => void | Promise<void>;
}

export interface VnStageOptions extends VnStageCallbacks {
  mount: HTMLElement;
  initialState?: VnStageState;
  userCss?: string;
  createImage?: VnImageFactory;
  exitLabel?: string;
  sceneImageFit?: VisualNovelSceneImageFit;
  /** Visual theme preset applied to the stage root. Defaults to "lumiverse". */
  themePreset?: VisualNovelThemePreset;
  textSpeed?: number;
  autoPlayDelay?: number;
  skipMode?: "read" | "all";
}

export interface VnSceneImageRequest {
  url: string;
  alt?: string;
  requestId?: string;
}

const THEME_MARKUP = `
  <main data-vn-root data-vn-mode="standard" data-vn-phase="idle" tabindex="0" aria-label="Visual novel">
    <div data-vn-scene aria-hidden="true">
      <img data-vn-scene-image data-vn-layer="active" data-vn-empty="true" alt="" />
      <img data-vn-scene-image data-vn-layer="incoming" data-vn-empty="true" alt="" />
      <div data-vn-ambient aria-hidden="true"></div>
      <div data-vn-scrim></div>
    </div>

    ${VN_ORNAMENT_LAYER_MARKUP}

    <div data-vn-fx aria-hidden="true"></div>
    <div data-vn-flash aria-hidden="true"></div>

    <div data-vn-status-stack aria-live="polite" aria-atomic="false"></div>
    <div data-vn-empty-state>
      This chat has no assistant reply to present yet. Use Exit, send the first message in normal chat, then open Visual novel again.
    </div>

    <section data-vn-narrative hidden aria-label="Dialogue">
      <div data-vn-dialogue>
        <nav data-vn-controls aria-label="Dialogue controls">
          <button data-vn-control="log" type="button" aria-label="History Log">Log</button>
          <button data-vn-control="auto" type="button" aria-label="Toggle auto play">
            <span data-vn-auto-ring aria-hidden="true">
              <svg viewBox="0 0 16 16" width="14" height="14">
                <circle class="vn-auto-track" cx="8" cy="8" r="6" fill="none" stroke-width="2" />
                <circle class="vn-auto-bar" cx="8" cy="8" r="6" fill="none" stroke-width="2" stroke-dasharray="37.7" stroke-dashoffset="37.7" />
              </svg>
            </span>
            <span>Auto</span>
          </button>
          <button data-vn-control="skip" type="button" aria-label="Toggle fast forward">Skip</button>
        </nav>
        <span data-vn-speaker hidden></span>
        <p data-vn-dialogue-text aria-live="polite" aria-atomic="true"></p>
        <span data-vn-progress></span>
        <button
          data-vn-continue
          type="button"
          aria-label="Continue"
          aria-keyshortcuts="Enter Space ArrowRight"
        ></button>
      </div>
    </section>

    <section data-vn-interaction hidden aria-label="Your response">
      <ol data-vn-choice-list hidden aria-label="Choose a response"></ol>
      <form data-vn-input-form hidden>
        <textarea data-vn-input aria-label="Your response"></textarea>
        <button data-vn-submit type="submit">Send</button>
      </form>
    </section>

    <div data-vn-backlog hidden aria-modal="true" role="dialog" aria-label="Dialogue history">
      <div data-vn-backlog-header>
        <h3 data-vn-backlog-title>History Log</h3>
        <button data-vn-backlog-close type="button" aria-label="Close history log">✕</button>
      </div>
      <div data-vn-backlog-content tabindex="0"></div>
    </div>
  </main>
`;

const queryRequired = <T extends Element>(
  root: ParentNode,
  selector: string,
): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`VN stage is missing ${selector}.`);
  return element;
};

const isInteractiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  Boolean(target.closest("button, textarea, input, select, option, a, [role='button']"));

const phaseLoadingLabel = (phase: VnPhase): string | null => {
  switch (phase) {
    case "waiting-for-response":
      return "Generating message...";
    case "planning":
      return "Planning scene...";
    case "submitting":
      return "Sending response...";
    default:
      return null;
  }
};

function createBadgeIconSvg(icon: "spinner" | "image" | "check" | "alert" | "reroll"): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("data-vn-badge-icon", icon);

  switch (icon) {
    case "spinner": {
      svg.setAttribute("fill", "none");
      svg.innerHTML = `
        <circle class="vn-spinner-track" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25"/>
        <circle class="vn-spinner-head" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="24 36"/>
      `;
      break;
    }
    case "image": {
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.innerHTML = `
        <rect x="3" y="3" width="18" height="18" rx="3"/>
        <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
        <path d="m21 15-5-5L5 21"/>
      `;
      break;
    }
    case "check": {
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2.5");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.innerHTML = `<path d="M20 6 9 17l-5-5"/>`;
      break;
    }
    case "alert": {
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.innerHTML = `
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      `;
      break;
    }
    case "reroll": {
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.innerHTML = `
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
        <path d="M21 3v5h-5"/>
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        <path d="M3 21v-5h5"/>
      `;
      break;
    }
  }
  return svg;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim()
    ? error.message
    : "The request failed. Try again.";

export class VnStage {
  private state: VnStageState;
  private readonly callbacks: VnStageCallbacks;
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly presetStyle: HTMLStyleElement;
  private readonly outerRoot: ShadowRoot;
  private readonly themeRoot: ShadowRoot;
  private readonly userStyle: HTMLStyleElement;
  private readonly root: HTMLElement;
  private readonly scene: HTMLElement;
  private readonly sceneImages: HTMLImageElement[];
  private activeImageEl: HTMLImageElement;
  private incomingImageEl: HTMLImageElement;
  private sceneImage: HTMLImageElement;
  private readonly flashOverlay: HTMLElement;
  private readonly fxOverlay: HTMLElement;
  private readonly ambientOverlay: HTMLElement;
  private currentAmbient: AmbientEffect | null = null;
  private ambientOverride: AmbientEffect | null | undefined = undefined;
  private sceneFxTimer: ReturnType<typeof setTimeout> | null = null;
  private fxBurstTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly statusStack: HTMLElement;
  private readonly emptyState: HTMLElement;
  private readonly narrative: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly dialogueText: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly continueButton: HTMLButtonElement;
  private readonly interaction: HTMLElement;
  private readonly choiceList: HTMLOListElement;
  private readonly inputForm: HTMLFormElement;
  private readonly input: HTMLTextAreaElement;
  private readonly submitButton: HTMLButtonElement;
  private readonly exitButton: HTMLButtonElement;
  private readonly logButton: HTMLButtonElement;
  private readonly autoButton: HTMLButtonElement;
  private readonly autoBar: HTMLElement | null;
  private readonly skipButton: HTMLButtonElement;
  private readonly backlogModal: HTMLElement;
  private readonly backlogClose: HTMLButtonElement;
  private readonly backlogContent: HTMLElement;
  private readonly createImage: VnImageFactory | undefined;
  private imageRequestSequence = 0;
  private destroyed = false;
  private customRegexRules: CustomRegexRule[] = [];
  private textSpeed = 20;
  private autoPlayDelay = 2000;
  private skipMode: "read" | "all" = "read";
  private isAutoPlay = false;
  private isSkipping = false;
  private isBacklogOpen = false;
  private isTyping = false;
  private typewriterTimer: ReturnType<typeof setInterval> | null = null;
  private autoPlayTimer: ReturnType<typeof setTimeout> | null = null;
  private skipTimer: ReturnType<typeof setTimeout> | null = null;
  private crossfadeTimer: ReturnType<typeof setTimeout> | null = null;
  private currentDisplayedUrl: string | null = null;
  private shakeTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly readParagraphIds = new Set<string>();
  private readonly backlogEntries: Array<{ speaker?: string | undefined; text: string; formatted: string }> = [];
  private activeTextNodes: Array<{ node: Text; fullText: string }> = [];
  private currentRenderedParagraphId = "";
  private currentRenderedFormatted = "";

  constructor(options: VnStageOptions) {
    this.state = options.initialState ?? createInitialVnStageState();
    this.callbacks = options;
    this.createImage = options.createImage;

    this.host = document.createElement("div");
    this.host.setAttribute("data-vn-stage-host", "");
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.outerRoot = this.shadow;

    const outerStyle = document.createElement("style");
    outerStyle.textContent = VN_OUTER_CSS;
    const shell = document.createElement("div");
    shell.setAttribute("data-vn-shell", "");

    const themeHost = document.createElement("div");
    themeHost.setAttribute("data-vn-theme-host", "");
    this.themeRoot = themeHost.attachShadow({ mode: "open" });

    const baseStyle = document.createElement("style");
    baseStyle.setAttribute(THEME_STYLE_LAYER_ATTRIBUTE.base, "");
    baseStyle.textContent = VN_BASE_CSS;

    this.presetStyle = document.createElement("style");
    this.presetStyle.setAttribute(THEME_STYLE_LAYER_ATTRIBUTE.preset, "");

    this.userStyle = document.createElement("style");
    this.userStyle.setAttribute(THEME_STYLE_LAYER_ATTRIBUTE.user, "");
    applyVnUserCss(this.userStyle, options.userCss);

    /**
     * The theme shadow root layers its styles in the reference order from
     * THEME_STYLE_LAYER_ORDER: base -> preset -> user. The preset element is
     * created inert here and filled in by applyThemePreset, and the user layer
     * is always appended last so custom CSS stays the final cascade layer.
     */
    const layers: Record<ThemeStyleLayer, HTMLStyleElement> = {
      base: baseStyle,
      preset: this.presetStyle,
      user: this.userStyle,
    };

    const content = document.createElement("div");
    content.innerHTML = THEME_MARKUP;
    this.themeRoot.append(
      ...THEME_STYLE_LAYER_ORDER.map((layer) => layers[layer]),
      ...Array.from(content.childNodes),
    );

    this.exitButton = document.createElement("button");
    this.exitButton.type = "button";
    this.exitButton.setAttribute("data-vn-exit", "");
    this.exitButton.setAttribute("aria-label", options.exitLabel ?? "Exit visual novel mode");
    this.exitButton.textContent = "Exit";

    shell.append(themeHost, this.exitButton);
    this.outerRoot.append(outerStyle, shell);
    options.mount.append(this.host);

    this.root = queryRequired(this.themeRoot, "[data-vn-root]");
    this.applyThemePreset(options.themePreset ?? "lumiverse");
    this.scene = queryRequired(this.themeRoot, "[data-vn-scene]");
    this.sceneImages = Array.from(this.themeRoot.querySelectorAll<HTMLImageElement>("[data-vn-scene-image]"));
    this.activeImageEl = queryRequired(this.themeRoot, "[data-vn-scene-image][data-vn-layer='active']");
    this.incomingImageEl = queryRequired(this.themeRoot, "[data-vn-scene-image][data-vn-layer='incoming']");
    this.sceneImage = this.activeImageEl;
    this.flashOverlay = queryRequired(this.themeRoot, "[data-vn-flash]");
    this.fxOverlay = queryRequired(this.themeRoot, "[data-vn-fx]");
    this.ambientOverlay = queryRequired(this.themeRoot, "[data-vn-ambient]");
    this.setSceneImageFit(options.sceneImageFit ?? "cover");
    this.statusStack = queryRequired(this.themeRoot, "[data-vn-status-stack]");
    this.emptyState = queryRequired(this.themeRoot, "[data-vn-empty-state]");
    this.narrative = queryRequired(this.themeRoot, "[data-vn-narrative]");
    this.speaker = queryRequired(this.themeRoot, "[data-vn-speaker]");
    this.dialogueText = queryRequired(this.themeRoot, "[data-vn-dialogue-text]");
    this.progress = queryRequired(this.themeRoot, "[data-vn-progress]");
    this.continueButton = queryRequired(this.themeRoot, "[data-vn-continue]");
    this.interaction = queryRequired(this.themeRoot, "[data-vn-interaction]");
    this.choiceList = queryRequired(this.themeRoot, "[data-vn-choice-list]");
    this.inputForm = queryRequired(this.themeRoot, "[data-vn-input-form]");
    this.input = queryRequired(this.themeRoot, "[data-vn-input]");
    this.submitButton = queryRequired(this.themeRoot, "[data-vn-submit]");
    this.logButton = queryRequired(this.themeRoot, "[data-vn-control='log']");
    this.autoButton = queryRequired(this.themeRoot, "[data-vn-control='auto']");
    this.autoBar = this.themeRoot.querySelector<HTMLElement>(".vn-auto-bar");
    this.skipButton = queryRequired(this.themeRoot, "[data-vn-control='skip']");
    this.backlogModal = queryRequired(this.themeRoot, "[data-vn-backlog]");
    this.backlogClose = queryRequired(this.themeRoot, "[data-vn-backlog-close]");
    this.backlogContent = queryRequired(this.themeRoot, "[data-vn-backlog-content]");

    if (typeof options.textSpeed === "number") this.setTextSpeed(options.textSpeed);
    if (typeof options.autoPlayDelay === "number") this.setAutoPlayDelay(options.autoPlayDelay);
    if (options.skipMode) this.setSkipMode(options.skipMode);

    this.bindEvents();
    this.render(null);
  }

  getState(): Readonly<VnStageState> {
    return this.state;
  }

  getElement(): HTMLElement {
    return this.host;
  }

  focus(): void {
    this.root.focus({ preventScroll: true });
  }

  setUserCss(css: string): void {
    applyVnUserCss(this.userStyle, css);
  }

  setDisplayRegexRules(rulesText: string): void {
    this.customRegexRules = parseCustomRegexRules(rulesText);
    this.renderDialogueContent();
  }

  setTextSpeed(speed: number): void {
    this.textSpeed = Math.max(0, Math.min(100, Math.round(speed)));
  }

  setAutoPlayDelay(delay: number): void {
    this.autoPlayDelay = Math.max(500, Math.min(10000, Math.round(delay)));
  }

  setSkipMode(mode: "read" | "all"): void {
    this.skipMode = mode === "all" ? "all" : "read";
  }

  toggleAutoPlay(force?: boolean): void {
    if (this.destroyed) return;
    this.isAutoPlay = force !== undefined ? force : !this.isAutoPlay;
    if (this.isAutoPlay) {
      this.isSkipping = false;
      this.clearSkipTimer();
      this.updateControlButtons();
      if (!this.isTyping) {
        this.onTextRenderFinished();
      }
    } else {
      this.clearAutoPlayTimer();
      this.updateControlButtons();
    }
  }

  toggleSkip(force?: boolean): void {
    if (this.destroyed) return;
    this.isSkipping = force !== undefined ? force : !this.isSkipping;
    if (this.isSkipping) {
      this.isAutoPlay = false;
      this.clearAutoPlayTimer();
      this.updateControlButtons();
      if (this.isTyping) {
        this.completeTypewriter();
      } else {
        this.scheduleSkipAdvance();
      }
    } else {
      this.clearSkipTimer();
      this.updateControlButtons();
    }
  }

  openBacklog(): void {
    if (this.destroyed) return;
    this.isBacklogOpen = true;
    this.backlogModal.hidden = false;
    this.backlogContent.innerHTML = this.backlogEntries
      .map(
        (entry) => `
        <div data-vn-backlog-item>
          ${entry.speaker ? `<span data-vn-backlog-speaker>${escapeHtml(entry.speaker)}</span>` : ""}
          <p data-vn-backlog-text>${entry.formatted}</p>
        </div>
      `,
      )
      .join("");
    this.backlogContent.scrollTop = this.backlogContent.scrollHeight;
  }

  closeBacklog(): void {
    if (this.destroyed) return;
    this.isBacklogOpen = false;
    this.backlogModal.hidden = true;
    this.root.focus({ preventScroll: true });
  }

  private updateControlButtons(): void {
    this.autoButton.dataset.vnActive = String(this.isAutoPlay);
    this.skipButton.dataset.vnActive = String(this.isSkipping);
    if (!this.isAutoPlay) {
      this.resetAutoRing();
    }
  }

  private updateContinueButton(): void {
    const view = selectVnStageView(this.state);
    const canAdvance = view.canAdvance;
    const isReady = canAdvance && !this.isTyping;
    this.continueButton.hidden = !canAdvance;
    this.continueButton.dataset.vnReady = String(isReady);
  }

  setSceneImageFit(fit: VisualNovelSceneImageFit): void {
    for (const img of this.sceneImages) {
      img.dataset.vnSceneImageFit = fit;
    }
  }

  /**
   * Apply a built-in theme preset. Safe to call repeatedly; the latest
   * preset wins and the style element is reused.
   */
  setThemePreset(preset: VisualNovelThemePreset): void {
    this.applyThemePreset(preset);
  }

  private applyThemePreset(preset: VisualNovelThemePreset): void {
    this.presetStyle.textContent = THEME_PRESET_CSS[preset] ?? "";
    this.root.dataset.vnPreset = preset;
  }

  reset(): void {
    this.clearAllTimers();
    this.resetEffects();
    this.clearSceneImages();
    this.isAutoPlay = false;
    this.isSkipping = false;
    this.isTyping = false;
    this.currentRenderedParagraphId = "";
    this.currentRenderedFormatted = "";
    this.updateControlButtons();
    this.updateContinueButton();
    this.dispatch({ type: "reset" });
  }

  loadTurn(turn: VnTurnInput): void {
    this.resetZoom();
    this.ambientOverride = undefined;
    this.dispatch({ type: "load-turn", turn });
    this.focus();
  }

  presentUserParagraph(text: string, speaker: string = "You"): void {
    this.dispatch({
      type: "present-user-paragraph",
      paragraph: {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text,
        speaker,
      },
    });
  }

  isReadingUserParagraph(): boolean {
    return Boolean(this.state.isUserTurn && this.state.phase === "revealing");
  }

  setPhase(phase: VnPhase): void {
    this.dispatch({ type: "set-phase", phase });
  }

  setActivity(
    label: string | null,
    kind: "loading" | "error" | "success" | "warning" | "reroll" | "prompt" = "loading",
  ): void {
    this.dispatch({
      type: "set-activity",
      activity: label ? { kind, label } : null,
    });
  }

  setAssetProgress(progress: VnAssetProgress | null): void {
    this.dispatch({
      type: "set-asset-progress",
      progress,
    });
  }

  setTurnFinished(finished: boolean): void {
    this.dispatch({
      type: "set-turn-finished",
      finished,
    });
  }

  setNoValidOutput(noValidOutput: boolean): void {
    this.dispatch({
      type: "set-no-valid-output",
      noValidOutput,
    });
  }

  setRerollPrompt(show: boolean): void {
    this.dispatch({
      type: "set-reroll-prompt",
      show,
    });
  }

  setError(error: string | null): void {
    this.dispatch({ type: "set-error", error });
  }

  async setSceneImage(request: VnSceneImageRequest): Promise<boolean> {
    if (this.destroyed) return false;

    const image: VnSceneImage = {
      url: request.url,
      alt: request.alt ?? "",
      requestId: request.requestId ?? `vn-image-${++this.imageRequestSequence}`,
    };
    this.dispatch({ type: "image-requested", image });

    try {
      await preloadAndDecodeVnImage(image.url, this.createImage);
      if (this.destroyed) return false;
      const wasCurrent = this.state.pendingImage?.requestId === image.requestId;
      this.dispatch({ type: "image-ready", requestId: image.requestId });
      return wasCurrent;
    } catch (error) {
      if (this.destroyed) return false;
      this.dispatch({
        type: "image-failed",
        requestId: image.requestId,
        error: errorMessage(error),
      });
      return false;
    }
  }

  destroy(): void {
    this.clearAllTimers();
    this.resetEffects();
    if (this.crossfadeTimer !== null) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    if (this.destroyed) return;
    this.destroyed = true;
    this.host.remove();
  }

  getActiveSceneImage(): HTMLImageElement {
    return this.activeImageEl;
  }

  getIncomingSceneImage(): HTMLImageElement {
    return this.incomingImageEl;
  }

  getFlashOverlay(): HTMLElement {
    return this.flashOverlay;
  }

  isCrossfading(): boolean {
    return this.crossfadeTimer !== null;
  }

  triggerEffect(effect: StageEffect): void {
    if (this.destroyed) return;
    switch (effect) {
      case "shake":
        this.triggerShake();
        break;
      case "flash_white":
        this.triggerFlash("white");
        break;
      case "flash_red":
        this.triggerFlash("red");
        break;
      case "zoom_in":
        this.triggerZoomIn();
        break;
      case "fade_to_black":
        this.triggerFadeToBlack();
        break;
      case "shake_hard":
        this.triggerTimedShake("vn-shake-hard", "hard", 500);
        break;
      case "rumble":
        this.triggerTimedShake("vn-rumble", "rumble", 800);
        break;
      case "zoom_out":
        this.triggerZoomOut();
        break;
      case "zoom_punch":
        this.triggerSceneAnimation("vnZoom", "punch", "vn-zoom-punch", 450);
        break;
      case "tilt":
        this.triggerSceneAnimation("vnTilt", "true", "vn-tilt", 700);
        break;
      case "blur_pulse":
        this.triggerSceneAnimation("vnBlur", "true", "vn-blur-pulse", 650);
        break;
      case "heartbeat":
        this.triggerHeartbeat();
        break;
      case "fade_from_black":
        this.triggerFlashPreset("fade_from_black", 800);
        break;
      case "fade_to_white":
        this.triggerFlashPreset("fade_to_white", 800);
        break;
      case "lightning":
        this.triggerFlashPreset("lightning", 550);
        break;
      case "speed_lines":
        this.triggerFxBurst("speed_lines", 650);
        break;
      case "sparkle_burst":
        this.triggerFxBurst("sparkle_burst", 850);
        break;
      case "hearts_burst":
        this.triggerFxBurst("hearts_burst", 950);
        break;
      case "confetti":
        this.triggerFxBurst("confetti", 1200);
        break;
    }
  }

  /** Timed whole-stage shake variants (hard impact / rumble). */
  private triggerTimedShake(className: string, datasetValue: string, duration: number): void {
    if (this.shakeTimer !== null) {
      clearTimeout(this.shakeTimer);
      this.shakeTimer = null;
    }
    const classes = ["vn-shake", "vn-shake-hard", "vn-rumble"];
    for (const el of [this.root, this.scene]) {
      el.classList.remove(...classes);
      delete el.dataset.vnShake;
    }
    if (typeof this.root.offsetWidth === "number") {
      void this.root.offsetWidth;
    }
    for (const el of [this.root, this.scene]) {
      el.classList.add(className);
      el.dataset.vnShake = datasetValue;
    }
    this.shakeTimer = setTimeout(() => {
      if (this.destroyed) return;
      for (const el of [this.root, this.scene]) {
        el.classList.remove(className);
        delete el.dataset.vnShake;
      }
      this.shakeTimer = null;
    }, duration);
  }

  private triggerZoomOut(): void {
    this.resetZoom();
    this.scene.classList.add("vn-zoom-out");
    this.scene.dataset.vnZoom = "out";
    for (const img of this.sceneImages) {
      img.classList.add("vn-zoom-out");
      img.dataset.vnZoom = "out";
    }
  }

  /** Short scene-level dataset animation (zoom punch, tilt, blur pulse). */
  private triggerSceneAnimation(datasetKey: "vnZoom" | "vnTilt" | "vnBlur", datasetValue: string, className: string, duration: number): void {
    if (this.sceneFxTimer !== null) {
      clearTimeout(this.sceneFxTimer);
      this.sceneFxTimer = null;
    }
    this.scene.classList.remove("vn-zoom-punch", "vn-tilt", "vn-blur-pulse");
    delete this.scene.dataset.vnTilt;
    delete this.scene.dataset.vnBlur;
    if (this.scene.dataset.vnZoom === "punch") delete this.scene.dataset.vnZoom;
    if (typeof this.scene.offsetWidth === "number") {
      void this.scene.offsetWidth;
    }
    this.scene.classList.add(className);
    this.scene.dataset[datasetKey] = datasetValue;
    this.sceneFxTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.scene.classList.remove(className);
      if (datasetKey === "vnZoom") {
        if (this.scene.dataset.vnZoom === "punch") delete this.scene.dataset.vnZoom;
      } else {
        delete this.scene.dataset[datasetKey];
      }
      this.sceneFxTimer = null;
    }, duration);
  }

  private triggerHeartbeat(): void {
    this.triggerSceneAnimation("vnTilt", "false", "vn-heartbeat", 850);
    delete this.scene.dataset.vnTilt;
    this.scene.dataset.vnHeartbeat = "true";
    this.flashOverlay.classList.remove("vn-heartbeat-flash");
    if (typeof this.flashOverlay.offsetWidth === "number") {
      void this.flashOverlay.offsetWidth;
    }
    this.flashOverlay.classList.add("vn-heartbeat-flash");
    setTimeout(() => {
      if (this.destroyed) return;
      delete this.scene.dataset.vnHeartbeat;
      this.flashOverlay.classList.remove("vn-heartbeat-flash");
    }, 900);
  }

  /** Full-screen flash overlay presets driven by data-vn-flash values. */
  private triggerFlashPreset(value: "fade_from_black" | "fade_to_white" | "lightning", duration: number): void {
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.flashOverlay.classList.remove("vn-flash-white", "vn-flash-red", "vn-fade-to-black", "vn-fade-from-black", "vn-fade-to-white", "vn-lightning");
    delete this.flashOverlay.dataset.vnFlash;
    if (typeof this.flashOverlay.offsetWidth === "number") {
      void this.flashOverlay.offsetWidth;
    }
    this.flashOverlay.dataset.vnFlash = value;
    this.fadeTimer = setTimeout(() => {
      if (this.destroyed) return;
      delete this.flashOverlay.dataset.vnFlash;
      this.fadeTimer = null;
    }, duration);
  }

  /** One-shot procedural particle bursts rendered into the fx overlay. */
  private triggerFxBurst(effect: StageEffect, duration: number): void {
    if (this.fxBurstTimer !== null) {
      clearTimeout(this.fxBurstTimer);
      this.fxBurstTimer = null;
    }
    delete this.fxOverlay.dataset.vnEffect;
    this.fxOverlay.innerHTML = "";
    if (typeof this.fxOverlay.offsetWidth === "number") {
      void this.fxOverlay.offsetWidth;
    }
    this.fxOverlay.innerHTML = generateCueEffectMarkup(effect);
    this.fxOverlay.dataset.vnEffect = effect;
    this.fxBurstTimer = setTimeout(() => {
      if (this.destroyed) return;
      delete this.fxOverlay.dataset.vnEffect;
      this.fxOverlay.innerHTML = "";
      this.fxBurstTimer = null;
    }, duration);
  }

  /** Apply (or clear) the persistent scene-level ambient overlay. */
  applyAmbient(effect: AmbientEffect | null): void {
    if (this.destroyed) return;
    if (effect === this.currentAmbient) return;
    this.currentAmbient = effect;
    if (this.currentAmbient === null) {
      delete this.scene.dataset.vnSceneAmbient;
      delete this.ambientOverlay.dataset.vnAmbient;
      this.ambientOverlay.className = "";
      this.ambientOverlay.innerHTML = "";
      return;
    }
    this.scene.dataset.vnSceneAmbient = effect as string;
    this.ambientOverlay.dataset.vnAmbient = effect as string;
    this.ambientOverlay.className = `vn-ambient-${effect}`;
    this.ambientOverlay.innerHTML = generateAmbientMarkup(this.currentAmbient);
  }

  getAmbientOverlay(): HTMLElement {
    return this.ambientOverlay;
  }

  getFxOverlay(): HTMLElement {
    return this.fxOverlay;
  }

  getCurrentAmbient(): AmbientEffect | null {
    return this.currentAmbient;
  }

  resetZoom(): void {
    this.scene.classList.remove("vn-zoom-in", "vn-zoom-out");
    delete this.scene.dataset.vnZoom;
    for (const img of this.sceneImages) {
      img.classList.remove("vn-zoom-in", "vn-zoom-out");
      delete img.dataset.vnZoom;
    }
  }

  resetEffects(): void {
    if (this.shakeTimer !== null) {
      clearTimeout(this.shakeTimer);
      this.shakeTimer = null;
    }
    if (this.flashTimer !== null) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    if (this.sceneFxTimer !== null) {
      clearTimeout(this.sceneFxTimer);
      this.sceneFxTimer = null;
    }
    if (this.fxBurstTimer !== null) {
      clearTimeout(this.fxBurstTimer);
      this.fxBurstTimer = null;
    }
    this.root.classList.remove("vn-shake", "vn-shake-hard", "vn-rumble");
    this.scene.classList.remove("vn-shake", "vn-shake-hard", "vn-rumble", "vn-zoom-punch", "vn-tilt", "vn-blur-pulse", "vn-heartbeat");
    delete this.root.dataset.vnShake;
    delete this.scene.dataset.vnShake;
    delete this.scene.dataset.vnTilt;
    delete this.scene.dataset.vnBlur;
    delete this.scene.dataset.vnHeartbeat;

    this.flashOverlay.classList.remove("vn-flash-white", "vn-flash-red", "vn-fade-to-black", "vn-fade-from-black", "vn-fade-to-white", "vn-lightning", "vn-heartbeat-flash");
    delete this.flashOverlay.dataset.vnFlash;

    delete this.fxOverlay.dataset.vnEffect;
    this.fxOverlay.innerHTML = "";

    this.ambientOverride = undefined;
    this.applyAmbient(null);

    this.resetZoom();
  }

  private triggerShake(): void {
    if (this.shakeTimer !== null) {
      clearTimeout(this.shakeTimer);
      this.shakeTimer = null;
    }
    this.root.classList.remove("vn-shake");
    this.scene.classList.remove("vn-shake");
    delete this.root.dataset.vnShake;
    delete this.scene.dataset.vnShake;

    if (typeof this.root.offsetWidth === "number") {
      void this.root.offsetWidth;
    }

    this.root.classList.add("vn-shake");
    this.scene.classList.add("vn-shake");
    this.root.dataset.vnShake = "true";
    this.scene.dataset.vnShake = "true";

    this.shakeTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.root.classList.remove("vn-shake");
      this.scene.classList.remove("vn-shake");
      delete this.root.dataset.vnShake;
      delete this.scene.dataset.vnShake;
      this.shakeTimer = null;
    }, 300);
  }

  private triggerFlash(color: "white" | "red"): void {
    if (this.flashTimer !== null) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
    this.flashOverlay.classList.remove("vn-flash-white", "vn-flash-red", "vn-fade-to-black");
    delete this.flashOverlay.dataset.vnFlash;

    if (typeof this.flashOverlay.offsetWidth === "number") {
      void this.flashOverlay.offsetWidth;
    }

    const className = color === "white" ? "vn-flash-white" : "vn-flash-red";
    this.flashOverlay.classList.add(className);
    this.flashOverlay.dataset.vnFlash = color;

    this.flashTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.flashOverlay.classList.remove(className);
      delete this.flashOverlay.dataset.vnFlash;
      this.flashTimer = null;
    }, 500);
  }

  private triggerFadeToBlack(): void {
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
    this.flashOverlay.classList.remove("vn-flash-white", "vn-flash-red", "vn-fade-to-black");
    delete this.flashOverlay.dataset.vnFlash;

    if (typeof this.flashOverlay.offsetWidth === "number") {
      void this.flashOverlay.offsetWidth;
    }

    this.flashOverlay.classList.add("vn-fade-to-black");
    this.flashOverlay.dataset.vnFlash = "fade_to_black";

    this.fadeTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.flashOverlay.classList.remove("vn-fade-to-black");
      delete this.flashOverlay.dataset.vnFlash;
      this.fadeTimer = null;
    }, 1000);
  }

  private triggerZoomIn(): void {
    this.scene.classList.add("vn-zoom-in");
    this.scene.dataset.vnZoom = "in";
    for (const img of this.sceneImages) {
      img.classList.add("vn-zoom-in");
      img.dataset.vnZoom = "in";
    }
  }

  private triggerParagraphEffects(paragraph: VnParagraph): void {
    let triggeredEffect: StageEffect | null = null;
    const explicitEffect = paragraph.effect ?? paragraph.cue?.effect;
    if (explicitEffect && isStageEffect(explicitEffect)) {
      this.triggerEffect(explicitEffect);
      triggeredEffect = explicitEffect;
    }

    if (triggeredEffect !== "shake" && TEXT_SHAKE_HEURISTIC_REGEX.test(paragraph.text)) {
      this.triggerEffect("shake");
    }

    const paragraphAmbient = paragraph.ambient ?? paragraph.cue?.ambient;
    if (paragraphAmbient === null || isAmbientEffect(paragraphAmbient)) {
      this.ambientOverride = paragraphAmbient;
      this.applyAmbient(paragraphAmbient);
    }
  }

  private clearSceneImages(): void {
    if (this.crossfadeTimer !== null) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    this.activeImageEl.removeAttribute("src");
    this.activeImageEl.alt = "";
    this.activeImageEl.dataset.vnEmpty = "true";

    this.incomingImageEl.removeAttribute("src");
    this.incomingImageEl.alt = "";
    this.incomingImageEl.dataset.vnEmpty = "true";

    this.currentDisplayedUrl = null;
  }

  private updateSceneImage(displayedImage: VnSceneImage): void {
    if (this.currentDisplayedUrl === displayedImage.url) {
      this.activeImageEl.alt = displayedImage.alt;
      return;
    }

    // First image (empty stage): show directly on active layer
    if (!this.currentDisplayedUrl || this.activeImageEl.dataset.vnEmpty === "true") {
      this.currentDisplayedUrl = displayedImage.url;
      this.activeImageEl.src = displayedImage.url;
      this.activeImageEl.alt = displayedImage.alt;
      this.activeImageEl.dataset.vnEmpty = "false";
      this.incomingImageEl.removeAttribute("src");
      this.incomingImageEl.alt = "";
      this.incomingImageEl.dataset.vnEmpty = "true";
      return;
    }

    // Previous image exists: smooth crossfade to incoming layer
    if (this.crossfadeTimer !== null) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
      const temp = this.activeImageEl;
      this.activeImageEl = this.incomingImageEl;
      this.incomingImageEl = temp;
      this.activeImageEl.setAttribute("data-vn-layer", "active");
      this.incomingImageEl.setAttribute("data-vn-layer", "incoming");
    }

    this.currentDisplayedUrl = displayedImage.url;
    this.incomingImageEl.src = displayedImage.url;
    this.incomingImageEl.alt = displayedImage.alt;
    this.incomingImageEl.dataset.vnEmpty = "false";

    this.crossfadeTimer = setTimeout(() => {
      if (this.destroyed) return;
      const temp = this.activeImageEl;
      this.activeImageEl = this.incomingImageEl;
      this.incomingImageEl = temp;

      this.activeImageEl.setAttribute("data-vn-layer", "active");
      this.incomingImageEl.setAttribute("data-vn-layer", "incoming");
      this.incomingImageEl.dataset.vnEmpty = "true";
      this.incomingImageEl.removeAttribute("src");
      this.incomingImageEl.alt = "";
      this.sceneImage = this.activeImageEl;
      this.crossfadeTimer = null;
    }, 350);
  }

  private bindEvents(): void {
    this.exitButton.addEventListener("click", () => this.callbacks.onExit?.());
    this.continueButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.advance();
    });

    this.logButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openBacklog();
    });

    this.autoButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleAutoPlay();
    });

    this.skipButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleSkip();
    });

    this.backlogClose.addEventListener("click", (event) => {
      event.stopPropagation();
      this.closeBacklog();
    });

    this.backlogModal.addEventListener("click", (event) => {
      if (event.target === this.backlogModal) {
        this.closeBacklog();
      }
    });

    this.root.addEventListener("wheel", (event) => {
      if (this.isBacklogOpen) return;
      if (event.deltaY < -30) {
        this.openBacklog();
      }
    }, { passive: true });

    this.root.addEventListener("click", (event) => {
      if (this.isBacklogOpen) return;
      if (!isInteractiveTarget(event.target)) this.advance();
    });

    this.root.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (this.isBacklogOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          this.closeBacklog();
        }
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      if (event.key === "l" || event.key === "L") {
        event.preventDefault();
        this.openBacklog();
        return;
      }
      if (event.key === "a" || event.key === "A") {
        event.preventDefault();
        this.toggleAutoPlay();
        return;
      }
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        this.toggleSkip();
        return;
      }
      if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowRight") return;

      event.preventDefault();
      this.advance();
    });

    this.choiceList.addEventListener("click", (event) => {
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>("[data-vn-choice]")
          : null;
      if (!button || button.disabled) return;
      const choice = this.state.choices.find((item) => item.id === button.dataset.vnChoiceId);
      if (choice) void this.submitChoice(choice);
    });

    this.input.addEventListener("input", () => {
      this.dispatch({ type: "set-draft", draft: this.input.value });
    });

    this.input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      this.inputForm.requestSubmit();
    });

    this.inputForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitDraft();
    });
  }

  private dispatch(action: VnStageAction): void {
    if (this.destroyed) return;
    const previousPhase = this.state.phase;
    this.state = reduceVnStage(this.state, action);
    this.render(previousPhase);
  }

  private advance(): void {
    if (this.isBacklogOpen) return;
    if (this.isTyping) {
      this.completeTypewriter();
      return;
    }
    if (this.isAutoPlay) {
      this.clearAutoPlayTimer();
    }

    const before = this.state;
    const view = selectVnStageView(before);
    if (!view.canAdvance) return;

    this.dispatch({ type: "advance" });
    this.callbacks.onAdvance?.(
      this.state.currentParagraphIndex,
      this.state.phase === "awaiting-input",
    );
  }

  private async submitChoice(choice: VnChoice): Promise<void> {
    if (!selectVnStageView(this.state).showChoices || choice.disabled || !this.callbacks.onChoice) {
      return;
    }
    this.dispatch({ type: "submit-started" });

    try {
      await this.callbacks.onChoice(choice);
    } catch (error) {
      this.dispatch({ type: "submit-failed", error: errorMessage(error) });
    }
  }

  private async submitDraft(): Promise<void> {
    const text = this.state.draft.trim();
    if (!selectVnStageView(this.state).showStandardInput || !text || !this.callbacks.onSubmit) {
      return;
    }
    this.dispatch({ type: "submit-started" });

    try {
      await this.callbacks.onSubmit(text);
    } catch (error) {
      this.dispatch({ type: "submit-failed", error: errorMessage(error) });
    }
  }

  private render(previousPhase: VnPhase | null): void {
    const view = selectVnStageView(this.state);
    this.root.dataset.vnMode = this.state.mode;
    this.root.dataset.vnPhase = this.state.phase;
    this.root.dataset.vnImageStatus = this.state.pendingImage
      ? "loading"
      : this.state.imageError
        ? "error"
        : this.state.displayedImage
          ? "ready"
          : "empty";
    this.root.setAttribute("aria-busy", String(view.isBusy));

    const displayedImage = this.state.displayedImage;
    if (displayedImage) {
      this.updateSceneImage(displayedImage);
    } else {
      this.clearSceneImages();
    }

    this.applyAmbient(this.ambientOverride !== undefined ? this.ambientOverride : this.state.ambient);

    this.narrative.hidden = view.paragraph === null;
    this.emptyState.hidden = view.paragraph !== null || this.state.phase !== "idle";
    this.renderDialogueContent();
    this.dialogueText.dataset.vnParagraphId = view.paragraph?.id ?? "";
    this.dialogueText.dataset.vnParagraphIndex = String(
      view.paragraph ? this.state.currentParagraphIndex : -1,
    );
    const speaker = view.paragraph?.speaker ?? "";
    if (this.speaker.textContent !== speaker) this.speaker.textContent = speaker;
    this.speaker.hidden = !view.paragraph?.speaker;
    const progress = view.paragraph
      ? `${view.paragraphNumber} / ${view.paragraphCount}`
      : "";
    if (this.progress.textContent !== progress) this.progress.textContent = progress;
    this.updateContinueButton();

    this.renderStatus();
    this.renderInteraction(view.showChoices, view.showStandardInput, view.isBusy);

    if (previousPhase !== "awaiting-input" && this.state.phase === "awaiting-input") {
      queueMicrotask(() => {
        if (this.destroyed) return;
        if (this.state.mode === "cyoa") {
          this.choiceList.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        } else {
          this.input.focus({ preventScroll: true });
        }
      });
    }
  }

  private clearAllTimers(): void {
    this.clearTypewriter();
    this.clearAutoPlayTimer();
    this.clearSkipTimer();
    if (this.crossfadeTimer !== null) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    this.resetEffects();
  }

  private clearTypewriter(): void {
    if (this.typewriterTimer !== null) {
      clearInterval(this.typewriterTimer);
      this.typewriterTimer = null;
    }
  }

  private clearAutoPlayTimer(): void {
    if (this.autoPlayTimer !== null) {
      clearTimeout(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    this.resetAutoRing();
  }

  private resetAutoRing(): void {
    if (this.autoBar) {
      const circumference = 37.7;
      this.autoBar.style.transition = "none";
      this.autoBar.style.strokeDashoffset = String(circumference);
    }
  }

  private startAutoCountdown(delayMs: number): void {
    if (this.autoPlayTimer !== null) {
      clearTimeout(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    this.resetAutoRing();

    if (this.autoBar) {
      const circumference = 37.7;
      const bar = this.autoBar;
      bar.style.transition = "none";
      bar.style.strokeDashoffset = String(circumference);
      // Wait for next animation frame so the browser commits the full circumference before animating to 0
      requestAnimationFrame(() => {
        if (!this.destroyed && this.isAutoPlay && bar) {
          bar.style.transition = `stroke-dashoffset ${delayMs}ms linear`;
          bar.style.strokeDashoffset = "0";
        }
      });
    }

    this.autoPlayTimer = setTimeout(() => {
      if (!this.destroyed && this.isAutoPlay) {
        this.resetAutoRing();
        this.advance();
      }
    }, delayMs);
  }

  private clearSkipTimer(): void {
    if (this.skipTimer !== null) {
      clearTimeout(this.skipTimer);
      this.skipTimer = null;
    }
  }

  private recordBacklogAndRead(
    id: string,
    speaker: string | undefined,
    text: string,
    formatted: string,
  ): void {
    this.readParagraphIds.add(id);
    const last = this.backlogEntries[this.backlogEntries.length - 1];
    if (!last || last.text !== text || last.speaker !== speaker) {
      this.backlogEntries.push({ speaker, text, formatted });
    }
  }

  private completeTypewriter(): void {
    this.clearTypewriter();
    if (this.activeTextNodes.length > 0) {
      for (const item of this.activeTextNodes) {
        item.node.textContent = item.fullText;
      }
      this.activeTextNodes = [];
    }
    this.isTyping = false;
    this.updateContinueButton();
    this.onTextRenderFinished();
  }

  private onTextRenderFinished(): void {
    if (this.destroyed) return;
    if (this.isSkipping) {
      this.scheduleSkipAdvance();
    } else if (this.isAutoPlay) {
      const view = selectVnStageView(this.state);
      if (view.canAdvance) {
        this.startAutoCountdown(this.autoPlayDelay);
      } else {
        this.resetAutoRing();
      }
    }
  }

  private scheduleSkipAdvance(): void {
    this.clearSkipTimer();
    if (!this.isSkipping) return;
    const view = selectVnStageView(this.state);
    if (!view.canAdvance) {
      this.isSkipping = false;
      this.updateControlButtons();
      return;
    }
    if (this.skipMode === "read") {
      const nextIdx = this.state.currentParagraphIndex + 1;
      const nextPara = this.state.paragraphs[nextIdx];
      if (nextPara && !this.readParagraphIds.has(nextPara.id)) {
        this.isSkipping = false;
        this.updateControlButtons();
        return;
      }
    }
    this.skipTimer = setTimeout(() => {
      if (this.destroyed || !this.isSkipping) return;
      this.advance();
    }, 60);
  }

  private startTypewriter(formatted: string): void {
    this.clearTypewriter();
    this.resetAutoRing();
    this.dialogueText.innerHTML = formatted;

    if (typeof document.createTreeWalker !== "function") {
      this.isTyping = false;
      this.updateContinueButton();
      this.onTextRenderFinished();
      return;
    }

    const filter = typeof NodeFilter !== "undefined" ? NodeFilter.SHOW_TEXT : 4;
    const walker = document.createTreeWalker(this.dialogueText, filter);
    const textNodes: Array<{ node: Text; fullText: string }> = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push({ node: node as Text, fullText: node.textContent ?? "" });
    }

    if (textNodes.length === 0 || textNodes.every((t) => !t.fullText)) {
      this.isTyping = false;
      this.updateContinueButton();
      this.onTextRenderFinished();
      return;
    }

    this.activeTextNodes = textNodes;
    for (const item of textNodes) {
      item.node.textContent = "";
    }

    this.isTyping = true;
    this.updateContinueButton();
    let nodeIdx = 0;
    let charIdx = 0;
    this.typewriterTimer = setInterval(() => {
      if (this.destroyed) {
        this.clearTypewriter();
        return;
      }
      if (nodeIdx >= textNodes.length) {
        this.completeTypewriter();
        return;
      }
      const current = textNodes[nodeIdx]!;
      if (charIdx < current.fullText.length) {
        current.node.textContent += current.fullText[charIdx++];
      } else {
        nodeIdx++;
        charIdx = 0;
      }
    }, this.textSpeed);
  }

  private renderDialogueContent(): void {
    const view = selectVnStageView(this.state);
    const paragraph = view.paragraph;
    if (!paragraph) {
      this.clearTypewriter();
      this.dialogueText.innerHTML = "";
      this.currentRenderedParagraphId = "";
      this.currentRenderedFormatted = "";
      return;
    }
    const currentPreset = this.root.dataset.vnPreset;
    const shouldStripMarkdown = currentPreset === "literature-club" || currentPreset === "yamaku-classic";
    const formatted = formatDialogueText(paragraph.text, this.customRegexRules, {
      stripMarkdown: shouldStripMarkdown,
      forceQuotes: shouldStripMarkdown,
      hasSpeaker: Boolean(paragraph.speaker && paragraph.speaker.trim())
    });
    if (
      this.currentRenderedParagraphId === paragraph.id &&
      this.currentRenderedFormatted === formatted
    ) {
      return;
    }
    this.currentRenderedParagraphId = paragraph.id;
    this.currentRenderedFormatted = formatted;
    this.recordBacklogAndRead(paragraph.id, paragraph.speaker, paragraph.text, formatted);
    this.triggerParagraphEffects(paragraph);

    if (this.textSpeed <= 0 || this.isSkipping) {
      this.clearTypewriter();
      this.dialogueText.innerHTML = formatted;
      this.isTyping = false;
      this.updateContinueButton();
      this.onTextRenderFinished();
    } else {
      this.startTypewriter(formatted);
    }
  }

  private renderStatus(): void {
    type BadgeSpec = {
      kind: "loading" | "error" | "image" | "success" | "warning" | "reroll";
      label: string;
      icon?: "spinner" | "image" | "check" | "alert" | "reroll";
      interactive?: boolean;
      action?: () => void;
    };

    const badges: BadgeSpec[] = [];
    const phaseLabel = phaseLoadingLabel(this.state.phase);
    if (phaseLabel) {
      badges.push({ kind: "loading", label: phaseLabel, icon: "spinner" });
    }

    if (this.state.assetProgress && this.state.assetProgress.total > 0) {
      badges.push({
        kind: "image",
        label: `Generating images ${this.state.assetProgress.current}/${this.state.assetProgress.total}`,
        icon: "spinner",
      });
    } else if (this.state.pendingImage) {
      badges.push({ kind: "loading", label: "Loading scene image", icon: "spinner" });
    }

    if (this.state.activity) {
      const actKind = this.state.activity.kind;
      const icon =
        actKind === "error"
          ? "alert"
          : actKind === "success"
            ? "check"
            : actKind === "warning"
              ? "alert"
              : actKind === "reroll" || actKind === "prompt"
                ? "reroll"
                : "spinner";
      badges.push({
        kind: actKind === "prompt" ? "reroll" : actKind,
        label: this.state.activity.label,
        icon,
      });
    }

    if (this.state.turnFinished) {
      badges.push({ kind: "success", label: "Turn finished", icon: "check" });
    }

    if (this.state.noValidOutput) {
      badges.push({ kind: "warning", label: "No valid output produced", icon: "alert" });
    }

    if (this.state.showRerollPrompt) {
      const handleReroll = () => {
        if (this.callbacks.onReroll) {
          void this.callbacks.onReroll();
        } else if (this.callbacks.onSwipe) {
          void this.callbacks.onSwipe();
        }
      };
      badges.push({
        kind: "reroll",
        label: "Swipe? (reroll the message)",
        icon: "reroll",
        interactive: true,
        action: handleReroll,
      });
    }

    if (this.state.imageError) {
      badges.push({ kind: "error", label: this.state.imageError, icon: "alert" });
    }
    if (this.state.error) {
      badges.push({ kind: "error", label: this.state.error, icon: "alert" });
    }

    // Reconcile status badges in-place if structure matches to prevent restarting spinner/dash animations
    const currentElements = Array.from(this.statusStack.children) as HTMLElement[];
    const canReconcile = currentElements.length === badges.length &&
      currentElements.every((el, i) => {
        const b = badges[i]!;
        const hasInteractiveMatch = Boolean(b.interactive) === (el.tagName.toLowerCase() === "button");
        const hasKindMatch = el.dataset.vnBadgeKind === b.kind;
        const iconEl = el.querySelector("[data-vn-badge-icon]");
        const hasIconMatch = (iconEl?.getAttribute("data-vn-badge-icon") ?? undefined) === b.icon;
        return hasInteractiveMatch && hasKindMatch && hasIconMatch;
      });

    if (canReconcile) {
      currentElements.forEach((el, i) => {
        const textSpan = el.querySelector("span:not([data-vn-badge-icon])") ?? el.lastChild;
        if (textSpan) textSpan.textContent = badges[i]!.label;
      });
      return;
    }

    this.statusStack.replaceChildren(
      ...badges.map(({ kind, label, icon, interactive, action }) => {
        const badge = document.createElement(interactive ? "button" : "span");
        if (interactive) {
          (badge as HTMLButtonElement).type = "button";
          badge.setAttribute("data-vn-badge-interactive", "true");
          if (action) {
            badge.addEventListener("click", (e) => {
              e.stopPropagation();
              action();
            });
          }
        }
        badge.setAttribute("data-vn-badge", "");
        badge.dataset.vnBadgeKind = kind;
        if (icon) {
          badge.appendChild(createBadgeIconSvg(icon));
        }
        const textSpan = document.createElement("span");
        textSpan.textContent = label;
        badge.appendChild(textSpan);

        if (kind === "error") badge.setAttribute("role", "alert");
        return badge;
      }),
    );
  }

  private renderInteraction(
    showChoices: boolean,
    showStandardInput: boolean,
    isBusy: boolean,
  ): void {
    this.interaction.hidden = !showChoices && !showStandardInput;
    this.choiceList.hidden = !showChoices;
    this.inputForm.hidden = !showStandardInput;

    if (showChoices) {
      this.choiceList.replaceChildren(
        ...this.state.choices.map((choice) => {
          const item = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("data-vn-choice", "");
          button.dataset.vnChoiceId = choice.id;
          button.textContent = choice.label;
          button.disabled = Boolean(choice.disabled) || isBusy;
          item.append(button);
          return item;
        }),
      );
    } else if (this.choiceList.childElementCount > 0) {
      this.choiceList.replaceChildren();
    }

    this.input.placeholder = this.state.inputPlaceholder;
    if (this.input.value !== this.state.draft) this.input.value = this.state.draft;
    this.input.disabled = isBusy;
    this.submitButton.disabled = isBusy || this.state.draft.trim().length === 0;
  }
}
