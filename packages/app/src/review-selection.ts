import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

/**
 * Review marks anchored on pure whitespace do not survive serialization (see
 * createTurndownService's blankReplacement), so the app never creates that
 * state: a whitespace-only comment selection becomes a point comment, and a
 * whitespace-only suggested deletion becomes a substitution that absorbs the
 * neighbouring characters (`e f` -> `ef`), the way word processors render it.
 * These resolvers hold that policy; PageCard's handlers and the fuzz harness
 * both apply it.
 */

/** Placeholder for leaf nodes (images) so they never read as whitespace. */
const LEAF_TEXT = "￼";

/** Word joiner: the point-comment / suggested-paragraph sentinel. Never
 * absorb one into a substitution — it belongs to other review machinery. */
const SENTINEL = "⁠";

const UNSUITABLE_NEIGHBOR = new RegExp(`[\\s${SENTINEL}${LEAF_TEXT}]`);

function charAt(doc: ProseMirrorNode, position: number): string {
  return doc.textBetween(position, position + 1, "\n", LEAF_TEXT);
}

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

export type SuggestedDeletionResolution =
  | { kind: "deletion"; from: number; to: number }
  | { kind: "substitution"; from: number; to: number; replacement: string }
  | null;

export function resolveSuggestedDeletion(
  state: EditorState,
  from: number,
  to: number,
): SuggestedDeletionResolution {
  if (to <= from) return null;

  const text = state.doc.textBetween(from, to, "\n", LEAF_TEXT);
  if (text.trim().length > 0) return { kind: "deletion", from, to };

  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) return null;

  const blockStart = $from.start();
  const blockEnd = $from.end();

  // Take in the whole whitespace run plus one solid character on each side;
  // the replacement re-types everything except the selected range.
  let expandedFrom = from;
  while (
    expandedFrom > blockStart &&
    /\s/.test(charAt(state.doc, expandedFrom - 1))
  ) {
    expandedFrom -= 1;
  }
  let expandedTo = to;
  while (expandedTo < blockEnd && /\s/.test(charAt(state.doc, expandedTo))) {
    expandedTo += 1;
  }

  if (expandedFrom <= blockStart || expandedTo >= blockEnd) return null;
  const previous = charAt(state.doc, expandedFrom - 1);
  const next = charAt(state.doc, expandedTo);
  if (
    !previous ||
    !next ||
    UNSUITABLE_NEIGHBOR.test(previous) ||
    UNSUITABLE_NEIGHBOR.test(next)
  ) {
    return null;
  }

  expandedFrom -= 1;
  expandedTo += 1;
  const replacement =
    state.doc.textBetween(expandedFrom, from, "\n", LEAF_TEXT) +
    state.doc.textBetween(to, expandedTo, "\n", LEAF_TEXT);

  return {
    kind: "substitution",
    from: expandedFrom,
    to: expandedTo,
    replacement,
  };
}
