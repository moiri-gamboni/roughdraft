import type { EditorState } from "@tiptap/pm/state";

/**
 * Review marks anchored on pure whitespace do not survive serialization (see
 * createTurndownService's blankReplacement), so the app never creates that
 * state through comment anchors: a whitespace-only comment selection becomes a
 * point comment. (Suggested deletions of whitespace are fine: the serializer
 * shields whitespace-only change spans, and `{-- --}` parses back into a
 * marked space.) PageCard's handleAddComment and the fuzz harness both apply
 * this.
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
