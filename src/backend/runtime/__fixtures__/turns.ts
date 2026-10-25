/** A planned `vn_turn` (the only turn message a frontend from before the text before the plan reads). */
export function isPlannedTurn(message: { type?: unknown; turn?: unknown }): boolean {
  return message.type === "vn_turn";
}

/** The text before the plan (`vn_turn_text`, TurnView.provisional). */
export function isProvisionalTurn(message: { type?: unknown; turn?: unknown }): boolean {
  return message.type === "vn_turn_text";
}
