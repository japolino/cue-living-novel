/** A planned `vn_turn`, not the provisional text sent before the plan (TurnView.provisional). */
export function isPlannedTurn(message: { type?: unknown; turn?: unknown }): boolean {
  return message.type === "vn_turn" && !(message.turn as { provisional?: boolean } | undefined)?.provisional;
}

/** The provisional `vn_turn` sent before the plan. */
export function isProvisionalTurn(message: { type?: unknown; turn?: unknown }): boolean {
  return message.type === "vn_turn" && Boolean((message.turn as { provisional?: boolean } | undefined)?.provisional);
}
