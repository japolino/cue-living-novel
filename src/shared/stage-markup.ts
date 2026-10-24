/**
 * Inline HTML tags the stage renders in dialogue (`formatDialogueText` in
 * src/frontend/stage/rich-text.ts); any other tag is shown as escaped text.
 * The backend's non-story cleanup keeps these in story lines unchanged.
 */
export const STAGE_INLINE_TAGS: ReadonlySet<string> = new Set([
  "font",
  "span",
  "em",
  "strong",
  "b",
  "i",
  "del",
  "s",
  "u",
  "mark",
  "ruby",
  "rt",
  "rp",
  "code",
  "small",
  "sub",
  "sup",
  "br",
]);
