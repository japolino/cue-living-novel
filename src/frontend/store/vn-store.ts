import type { SpriteTurnView } from "../../shared/sprites.js";

export type VnMode = "cyoa" | "standard";

export type VnPhase =
  | "idle"
  | "waiting-for-response"
  | "planning"
  | "revealing"
  | "awaiting-input"
  | "submitting"
  | "error";

export type StageEffect =
  | "shake"
  | "flash_white"
  | "flash_red"
  | "zoom_in"
  | "fade_to_black"
  | "shake_hard"
  | "rumble"
  | "zoom_punch"
  | "speed_lines"
  | "fade_from_black"
  | "fade_to_white"
  | "lightning"
  | "zoom_out"
  | "tilt"
  | "heartbeat"
  | "blur_pulse"
  | "sparkle_burst"
  | "hearts_burst"
  | "confetti";

export type AmbientEffect =
  | "rain"
  | "heavy_rain"
  | "snow"
  | "sakura"
  | "fog"
  | "fireflies"
  | "embers"
  | "vignette_dark"
  | "sepia_flashback"
  | "desaturate"
  | "dream_haze"
  | "danger_pulse";

export interface VnParagraph {
  id: string;
  text: string;
  speaker?: string;
  effect?: StageEffect;
  ambient?: AmbientEffect | null;
  cue?: {
    effect?: StageEffect;
    ambient?: AmbientEffect | null;
    [key: string]: unknown;
  };
}

export interface VnChoice {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
}

export interface VnSceneImage {
  url: string;
  alt: string;
  requestId: string;
}

export interface VnAssetProgress {
  current: number;
  total: number;
}

export interface VnActivity {
  kind: "loading" | "error" | "success" | "warning" | "reroll" | "prompt";
  label: string;
}

export interface VnStageState {
  mode: VnMode;
  phase: VnPhase;
  paragraphs: readonly VnParagraph[];
  currentParagraphIndex: number;
  choices: readonly VnChoice[];
  draft: string;
  displayedImage: VnSceneImage | null;
  pendingImage: VnSceneImage | null;
  imageError: string | null;
  activity: VnActivity | null;
  error: string | null;
  inputPlaceholder: string;
  assetProgress: VnAssetProgress | null;
  turnFinished: boolean;
  noValidOutput: boolean;
  showRerollPrompt: boolean;
  isUserTurn?: boolean;
  ambient: AmbientEffect | null;
  /**
   * Highest paragraph index the reader has already seen in this turn. While an
   * error card is shown (phase "error") the reader may move Previous/Continue
   * only within [0, highestRevealedIndex]; unrevealed text stays hidden and no
   * input is accepted until the host sets a new phase.
   */
  highestRevealedIndex: number;
  /**
   * The turn's text arrived before its visual plan (a provisional turn): the
   * last paragraph index the reader may reach until the plan lands, or null
   * when nothing is pending. The reader never passes the final paragraph to
   * Your turn while the plan is pending (its choices are not known yet).
   */
  planHold: number | null;
}

export interface VnTurnInput {
  mode: VnMode;
  paragraphs: readonly VnParagraph[];
  choices?: readonly VnChoice[];
  inputPlaceholder?: string;
  preserveImage?: boolean;
  ambient?: AmbientEffect | null;
  /** Sprite mode staging for this turn (`TurnView.sprites`); the stage keeps it, the store ignores it. */
  sprites?: SpriteTurnView | null;
  /**
   * Set for a provisional turn (text before the plan): the paragraph index the
   * reader waits at until the plan lands (clamped to the final paragraph).
   */
  planHold?: number;
}

export type VnStageAction =
  | { type: "load-turn"; turn: VnTurnInput }
  /**
   * The planned turn for the provisional one on screen. Same reader position;
   * the paragraphs (speakers, effects, ambients), choices and mode come from the
   * plan. A turn whose read paragraphs differ is loaded instead (see `canUpgradeTurn`).
   */
  | { type: "upgrade-turn"; turn: VnTurnInput }
  | { type: "advance" }
  | { type: "previous" }
  | { type: "set-mode"; mode: VnMode }
  | { type: "set-draft"; draft: string }
  | { type: "set-phase"; phase: VnPhase }
  /** End a "planning" phase that a retry of the same turn left behind, keeping the cursor. */
  | { type: "resume"; phase: "revealing" | "awaiting-input" }
  | { type: "set-activity"; activity: VnActivity | null }
  | { type: "set-error"; error: string | null }
  | { type: "set-asset-progress"; progress: VnAssetProgress | null }
  | { type: "set-turn-finished"; finished: boolean }
  | { type: "set-no-valid-output"; noValidOutput: boolean }
  | { type: "set-reroll-prompt"; show: boolean }
  | { type: "submit-started" }
  | { type: "submit-failed"; error: string }
  | { type: "image-requested"; image: VnSceneImage }
  | { type: "image-ready"; requestId: string }
  | { type: "image-failed"; requestId: string; error: string }
  | { type: "present-user-paragraph"; paragraph: VnParagraph }
  | { type: "set-ambient"; ambient: AmbientEffect | null }
  /** Drop the displayed and pending scene image (sprite plate removed on a mode switch). */
  | { type: "clear-image" }
  | { type: "reset" };

export interface VnStageView {
  paragraph: VnParagraph | null;
  paragraphNumber: number;
  paragraphCount: number;
  canAdvance: boolean;
  canGoBack: boolean;
  acceptsInput: boolean;
  showChoices: boolean;
  showStandardInput: boolean;
  isBusy: boolean;
  /** The reader is at the paragraph a provisional turn holds them at, waiting for the plan. */
  waitingForPlan: boolean;
}

export const createInitialVnStageState = (
  values: Partial<VnStageState> = {},
): VnStageState => ({
  mode: "standard",
  phase: "idle",
  paragraphs: [],
  currentParagraphIndex: 0,
  choices: [],
  draft: "",
  displayedImage: null,
  pendingImage: null,
  imageError: null,
  activity: null,
  error: null,
  inputPlaceholder: "What do you do?",
  assetProgress: null,
  turnFinished: false,
  noValidOutput: false,
  showRerollPrompt: false,
  isUserTurn: false,
  ambient: null,
  highestRevealedIndex: 0,
  planHold: null,
  ...values,
});

const clampParagraphIndex = (
  paragraphs: readonly VnParagraph[],
  index: number,
): number => {
  if (paragraphs.length === 0) return 0;
  return Math.min(Math.max(index, 0), paragraphs.length - 1);
};

const planHoldFor = (turn: VnTurnInput): number | null =>
  turn.planHold === undefined || turn.paragraphs.length === 0
    ? null
    : clampParagraphIndex(turn.paragraphs, turn.planHold);

/**
 * Whether `turn` can upgrade the turn on the stage in place: the same
 * paragraphs (ids and text) up to the furthest one the reader has seen.
 * The reader's own line on screen, or no text yet, means a normal load.
 */
export const canUpgradeTurn = (state: VnStageState, turn: VnTurnInput): boolean => {
  if (state.paragraphs.length === 0 || state.isUserTurn) return false;
  const seen = Math.max(state.highestRevealedIndex, state.currentParagraphIndex);
  if (turn.paragraphs.length <= seen) return false;
  for (let index = 0; index <= seen; index += 1) {
    const before = state.paragraphs[index];
    const after = turn.paragraphs[index];
    if (!before || !after || before.id !== after.id || before.text !== after.text) return false;
  }
  return true;
};

export const selectVnStageView = (state: VnStageState): VnStageView => {
  const paragraph =
    state.paragraphs[clampParagraphIndex(state.paragraphs, state.currentParagraphIndex)] ??
    null;
  const acceptsInput = state.phase === "awaiting-input";
  const waitingForPlan = paragraph !== null
    && state.phase === "revealing"
    && !state.isUserTurn
    && state.planHold !== null
    && state.currentParagraphIndex >= state.planHold;

  return {
    paragraph,
    paragraphNumber: paragraph ? state.currentParagraphIndex + 1 : 0,
    paragraphCount: state.paragraphs.length,
    canAdvance: paragraph !== null && !waitingForPlan && (
      state.phase === "revealing"
      || (state.phase === "error" && state.currentParagraphIndex < state.highestRevealedIndex)
    ),
    canGoBack: (state.phase === "revealing" || state.phase === "awaiting-input" || state.phase === "error")
      && !state.isUserTurn && state.currentParagraphIndex > 0,
    acceptsInput,
    showChoices: acceptsInput && state.mode === "cyoa",
    showStandardInput: acceptsInput && state.mode === "standard",
    isBusy:
      state.phase === "waiting-for-response" ||
      state.phase === "planning" ||
      state.phase === "submitting",
    waitingForPlan,
  };
};

export const reduceVnStage = (
  state: VnStageState,
  action: VnStageAction,
): VnStageState => {
  switch (action.type) {
    case "load-turn": {
      const paragraphs = [...action.turn.paragraphs];
      const hasNoParagraphs = paragraphs.length === 0;
      return {
        ...state,
        mode: action.turn.mode,
        phase: hasNoParagraphs ? "awaiting-input" : "revealing",
        paragraphs,
        currentParagraphIndex: 0,
        choices: [...(action.turn.choices ?? [])],
        draft: "",
        displayedImage: action.turn.preserveImage ? state.displayedImage : null,
        pendingImage: null,
        imageError: null,
        activity: null,
        error: null,
        inputPlaceholder: action.turn.inputPlaceholder ?? state.inputPlaceholder,
        assetProgress: null,
        turnFinished: false,
        noValidOutput: hasNoParagraphs,
        showRerollPrompt: hasNoParagraphs,
        isUserTurn: false,
        ambient: action.turn.ambient !== undefined ? action.turn.ambient : state.ambient,
        highestRevealedIndex: 0,
        planHold: planHoldFor(action.turn),
      };
    }

    case "upgrade-turn": {
      if (!canUpgradeTurn(state, action.turn)) {
        return reduceVnStage(state, { type: "load-turn", turn: { ...action.turn, preserveImage: true } });
      }
      const paragraphs = [...action.turn.paragraphs];
      return {
        ...state,
        mode: action.turn.mode,
        // A retry pressed while the text waited for its plan ends with the plan.
        phase: state.phase === "planning" ? "revealing" : state.phase,
        paragraphs,
        choices: [...(action.turn.choices ?? [])],
        inputPlaceholder: action.turn.inputPlaceholder ?? state.inputPlaceholder,
        ambient: action.turn.ambient !== undefined ? action.turn.ambient : state.ambient,
        planHold: planHoldFor(action.turn),
      };
    }

    case "advance": {
      if (state.phase === "error") {
        // Reread only: move within already revealed paragraphs, keep the error card.
        if (!selectVnStageView(state).canAdvance) return state;
        return { ...state, currentParagraphIndex: state.currentParagraphIndex + 1 };
      }
      if (state.phase !== "revealing" || state.paragraphs.length === 0) return state;
      if (selectVnStageView(state).waitingForPlan) return state;

      const finalIndex = state.paragraphs.length - 1;
      if (state.currentParagraphIndex < finalIndex) {
        const nextIndex = state.currentParagraphIndex + 1;
        return {
          ...state,
          currentParagraphIndex: nextIndex,
          highestRevealedIndex: Math.max(state.highestRevealedIndex, nextIndex),
        };
      }

      if (state.isUserTurn) {
        return {
          ...state,
          phase: "waiting-for-response",
          isUserTurn: false,
        };
      }

      return {
        ...state,
        phase: "awaiting-input",
        turnFinished: true,
        showRerollPrompt: true,
      };
    }

    case "previous": {
      if (!selectVnStageView(state).canGoBack) return state;
      // Rereading during an error keeps the error card (and phase) visible.
      const phase = state.phase === "error" ? "error" : "revealing";
      // The host shows the earlier paragraph's image. Text waiting for its plan
      // has none: it keeps the scene it shows.
      const images = state.planHold !== null ? {} : { displayedImage: null, pendingImage: null, imageError: null };
      return { ...state, currentParagraphIndex: state.currentParagraphIndex - 1, phase,
        turnFinished: false, showRerollPrompt: false, ...images };
    }

    case "present-user-paragraph": {
      const paragraphs = [...state.paragraphs, action.paragraph];
      return {
        ...state,
        paragraphs,
        currentParagraphIndex: paragraphs.length - 1,
        phase: "revealing",
        isUserTurn: true,
        highestRevealedIndex: paragraphs.length - 1,
        turnFinished: false,
        noValidOutput: false,
        showRerollPrompt: false,
        draft: "",
      };
    }

    case "set-mode":
      return { ...state, mode: action.mode };

    case "set-draft":
      return { ...state, draft: action.draft };

    case "set-phase": {
      const isResetPhase =
        action.phase === "waiting-for-response" ||
        action.phase === "planning" ||
        action.phase === "submitting";
      return {
        ...state,
        phase: action.phase,
        turnFinished: isResetPhase ? false : state.turnFinished,
        noValidOutput: isResetPhase ? false : state.noValidOutput,
        showRerollPrompt: isResetPhase ? false : state.showRerollPrompt,
        assetProgress: isResetPhase ? null : state.assetProgress,
      };
    }

    case "resume": {
      // A retry that kept the turn (images only, or a replan of the same text)
      // never reloads it, so nothing else would end the planning phase.
      if (state.phase !== "planning" || state.paragraphs.length === 0) return state;
      const yourTurn = action.phase === "awaiting-input"
        && state.currentParagraphIndex >= state.paragraphs.length - 1;
      return {
        ...state,
        phase: yourTurn ? "awaiting-input" : "revealing",
        error: null,
        turnFinished: yourTurn,
        showRerollPrompt: yourTurn,
      };
    }

    case "set-activity":
      return { ...state, activity: action.activity };

    case "set-error":
      return {
        ...state,
        error: action.error,
        phase: action.error ? "error" : state.phase,
      };

    case "set-asset-progress":
      return { ...state, assetProgress: action.progress };

    case "set-turn-finished":
      return {
        ...state,
        turnFinished: action.finished,
        showRerollPrompt: action.finished ? true : state.showRerollPrompt,
      };

    case "set-no-valid-output":
      return {
        ...state,
        noValidOutput: action.noValidOutput,
        showRerollPrompt: action.noValidOutput ? true : state.showRerollPrompt,
      };

    case "set-reroll-prompt":
      return { ...state, showRerollPrompt: action.show };

    case "submit-started":
      if (state.phase !== "awaiting-input") return state;
      return {
        ...state,
        phase: "submitting",
        error: null,
        assetProgress: null,
        turnFinished: false,
        noValidOutput: false,
        showRerollPrompt: false,
      };

    case "submit-failed":
      return {
        ...state,
        phase: "awaiting-input",
        error: action.error,
      };

    case "image-requested":
      return {
        ...state,
        pendingImage: action.image,
        imageError: null,
      };

    case "image-ready":
      if (state.pendingImage?.requestId !== action.requestId) return state;
      return {
        ...state,
        displayedImage: state.pendingImage,
        pendingImage: null,
        imageError: null,
      };

    case "image-failed":
      if (state.pendingImage?.requestId !== action.requestId) return state;
      return {
        ...state,
        pendingImage: null,
        imageError: action.error,
      };

    case "set-ambient":
      return {
        ...state,
        ambient: action.ambient,
      };

    case "clear-image":
      return { ...state, displayedImage: null, pendingImage: null, imageError: null };

    case "reset":
      return createInitialVnStageState();
  }
};
