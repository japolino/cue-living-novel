/**
 * DOM decoration for inline dialogue text effects. `formatDialogueText`
 * emits `<span data-vn-text-fx="<id>">` wrappers; `applyTextEffects` then
 * prepares them in place (for example, splitting per-letter effects into
 * letter spans with an index custom property) so CSS can animate them.
 *
 * It must be idempotent, must keep every character in a text node (the
 * typewriter reveals text nodes one character at a time), and must not add
 * or remove visible characters.
 *
 * Contract stub: the text-effects implementation fills this in.
 */
export function applyTextEffects(_root: ParentNode): void {
  // Stub: no decoration yet.
}
