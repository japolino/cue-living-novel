/** Stable selectors supported by custom VN themes. */
export const VN_THEME_SELECTORS = {
  root: "[data-vn-root]",
  scene: "[data-vn-scene]",
  sceneImage: "[data-vn-scene-image]",
  ornaments: "[data-vn-ornaments]",
  ornamentGroup: "[data-vn-ornament-group]",
  flash: "[data-vn-flash]",
  statusStack: "[data-vn-status-stack]",
  badge: "[data-vn-badge]",
  narrative: "[data-vn-narrative]",
  dialogue: "[data-vn-dialogue]",
  speaker: "[data-vn-speaker]",
  dialogueText: "[data-vn-dialogue-text]",
  progress: "[data-vn-progress]",
  continueButton: "[data-vn-continue]",
  interaction: "[data-vn-interaction]",
  choiceList: "[data-vn-choice-list]",
  choice: "[data-vn-choice]",
  inputForm: "[data-vn-input-form]",
  input: "[data-vn-input]",
  submit: "[data-vn-submit]",
} as const;

/** Stable custom properties supported by custom VN themes. */
export const VN_THEME_CUSTOM_PROPERTIES = [
  "--vn-accent",
  "--vn-text",
  "--vn-muted-text",
  "--vn-dialogue-bg",
  "--vn-dialogue-border",
  "--vn-dialogue-width",
  "--vn-font-family",
  "--vn-dialogue-font-size",
  "--vn-transition-duration",
] as const;

