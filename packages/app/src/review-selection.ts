import type { EditorState } from "@tiptap/pm/state";

/**
 * Review marks anchored on pure whitespace do not survive serialization (see
 * createTurndownService's blankReplacement), so the app never creates that
 * state: a whitespace-only comment selection becomes a point comment, and a
 * whitespace-only suggested deletion is refused, like an empty selection.
 * These resolvers hold that policy; PageCard's handlers and the fuzz harness
 * both apply it.
 */

/** Placeholder for leaf nodes (images) so they never read as whitespace. */
const LEAF_TEXT = "\uFFFC";

export type CommentAnchorResolution =
  | { kind: "point"; at: number }
  | { kind: "range"; from: number; to: number };

export function resolveCommentAnchor(
  state: EditorState,
): CommentAnchorResolution {
  const { from, to, empty } = state.selection;
  if (empty) return { kind: "point", at: from };

  const text = state.doc.textBetween(from, to, "\n", LEAF_TEXT);
  if (text.trim().length === 0) return { kind: "point", at: from };

  return { kind: "range", from, to };
}

export function canSuggestDeletion(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  if (to <= from) return false;
  return state.doc.textBetween(from, to, "\n", LEAF_TEXT).trim().length > 0;
}
