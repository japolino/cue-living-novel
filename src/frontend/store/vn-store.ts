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
}

export interface VnTurnInput {
  mode: VnMode;
  paragraphs: readonly VnParagraph[];
  choices?: readonly VnChoice[];
  inputPlaceholder?: string;
  preserveImage?: boolean;
  ambient?: AmbientEffect | null;
}

export type VnStageAction =
  | { type: "load-turn"; turn: VnTurnInput }
  | { type: "advance" }
  | { type: "set-mode"; mode: VnMode }
  | { type: "set-draft"; draft: string }
  | { type: "set-phase"; phase: VnPhase }
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
  | { type: "reset" };

export interface VnStageView {
  paragraph: VnParagraph | null;
  paragraphNumber: number;
  paragraphCount: number;
  canAdvance: boolean;
  acceptsInput: boolean;
  showChoices: boolean;
  showStandardInput: boolean;
  isBusy: boolean;
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
  ...values,
});

const clampParagraphIndex = (
  paragraphs: readonly VnParagraph[],
  index: number,
): number => {
  if (paragraphs.length === 0) return 0;
  return Math.min(Math.max(index, 0), paragraphs.length - 1);
};

export const selectVnStageView = (state: VnStageState): VnStageView => {
  const paragraph =
    state.paragraphs[clampParagraphIndex(state.paragraphs, state.currentParagraphIndex)] ??
    null;
  const acceptsInput = state.phase === "awaiting-input";

  return {
    paragraph,
    paragraphNumber: paragraph ? state.currentParagraphIndex + 1 : 0,
    paragraphCount: state.paragraphs.length,
    canAdvance: state.phase === "revealing" && paragraph !== null,
    acceptsInput,
    showChoices: acceptsInput && state.mode === "cyoa",
    showStandardInput: acceptsInput && state.mode === "standard",
    isBusy:
      state.phase === "waiting-for-response" ||
      state.phase === "planning" ||
      state.phase === "submitting",
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
      };
    }

    case "advance": {
      if (state.phase !== "revealing" || state.paragraphs.length === 0) return state;

      const finalIndex = state.paragraphs.length - 1;
      if (state.currentParagraphIndex < finalIndex) {
        return {
          ...state,
          currentParagraphIndex: state.currentParagraphIndex + 1,
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

    case "present-user-paragraph": {
      const paragraphs = [...state.paragraphs, action.paragraph];
      return {
        ...state,
        paragraphs,
        currentParagraphIndex: paragraphs.length - 1,
        phase: "revealing",
        isUserTurn: true,
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

    case "reset":
      return createInitialVnStageState();
  }
};
