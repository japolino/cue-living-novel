import {
  createInitialVnStageState,
  reduceVnStage,
  selectVnStageView,
  type VnChoice,
  type VnPhase,
  type VnSceneImage,
  type VnStageAction,
  type VnStageState,
  type VnTurnInput,
} from "../store";
import type {
  VisualNovelSceneImageFit,
  VisualNovelThemePreset,
} from "../../config.js";
import {
  applyVnUserCss,
  VN_BASE_CSS,
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
}

export interface VnSceneImageRequest {
  url: string;
  alt?: string;
  requestId?: string;
}

const THEME_MARKUP = `
  <main data-vn-root data-vn-mode="standard" data-vn-phase="idle" tabindex="0" aria-label="Visual novel">
    <div data-vn-scene aria-hidden="true">
      <img data-vn-scene-image data-vn-empty="true" alt="" />
      <div data-vn-scrim></div>
    </div>

    <div data-vn-status-stack aria-live="polite" aria-atomic="false"></div>
    <div data-vn-empty-state>
      This chat has no assistant reply to present yet. Use Exit, send the first message in normal chat, then open Visual novel again.
    </div>

    <section data-vn-narrative hidden aria-label="Dialogue">
      <div data-vn-dialogue>
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
      return "Waiting for response";
    case "planning":
      return "Planning scene";
    case "submitting":
      return "Sending response";
    default:
      return null;
  }
};

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
  private readonly sceneImage: HTMLImageElement;
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
  private readonly createImage: VnImageFactory | undefined;
  private imageRequestSequence = 0;
  private destroyed = false;

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
    this.sceneImage = queryRequired(this.themeRoot, "[data-vn-scene-image]");
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

  setSceneImageFit(fit: VisualNovelSceneImageFit): void {
    this.sceneImage.dataset.vnSceneImageFit = fit;
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

  loadTurn(turn: VnTurnInput): void {
    this.dispatch({ type: "load-turn", turn });
    this.focus();
  }

  setPhase(phase: VnPhase): void {
    this.dispatch({ type: "set-phase", phase });
  }

  setActivity(label: string | null, kind: "loading" | "error" = "loading"): void {
    this.dispatch({
      type: "set-activity",
      activity: label ? { kind, label } : null,
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
    if (this.destroyed) return;
    this.destroyed = true;
    this.host.remove();
  }

  private bindEvents(): void {
    this.exitButton.addEventListener("click", () => this.callbacks.onExit?.());
    this.continueButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.advance();
    });

    this.root.addEventListener("click", (event) => {
      if (!isInteractiveTarget(event.target)) this.advance();
    });

    this.root.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isInteractiveTarget(event.target)) return;
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
      if (this.sceneImage.getAttribute("src") !== displayedImage.url) {
        this.sceneImage.src = displayedImage.url;
      }
      this.sceneImage.alt = displayedImage.alt;
      this.sceneImage.dataset.vnEmpty = "false";
    } else {
      this.sceneImage.removeAttribute("src");
      this.sceneImage.alt = "";
      this.sceneImage.dataset.vnEmpty = "true";
    }

    this.narrative.hidden = view.paragraph === null;
    this.emptyState.hidden = view.paragraph !== null || this.state.phase !== "idle";
    const paragraphText = view.paragraph?.text ?? "";
    if (this.dialogueText.textContent !== paragraphText) {
      this.dialogueText.textContent = paragraphText;
    }
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
    this.continueButton.hidden = !view.canAdvance;

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

  private renderStatus(): void {
    const badges: Array<{ kind: "loading" | "error"; label: string }> = [];
    const phaseLabel = phaseLoadingLabel(this.state.phase);
    if (phaseLabel) badges.push({ kind: "loading", label: phaseLabel });
    if (this.state.pendingImage) badges.push({ kind: "loading", label: "Loading scene image" });
    if (this.state.activity) badges.push(this.state.activity);
    if (this.state.imageError) badges.push({ kind: "error", label: this.state.imageError });
    if (this.state.error) badges.push({ kind: "error", label: this.state.error });

    this.statusStack.replaceChildren(
      ...badges.map(({ kind, label }) => {
        const badge = document.createElement("span");
        badge.setAttribute("data-vn-badge", "");
        badge.dataset.vnBadgeKind = kind;
        badge.textContent = label;
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
