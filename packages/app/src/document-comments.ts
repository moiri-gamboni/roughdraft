import type { JSONContent } from "@tiptap/core";
import {
  buildCommentThreads,
  type CriticComment,
  flattenCommentThreads,
  getCommentDescendantIds,
} from "./critic-markup";

interface CommentAnchorMeasurement {
  commentIds: string[];
  anchorTop: number;
  anchorBottom: number;
}

export interface CommentGroupAnchor {
  key: string;
  commentIds: string[];
  anchorTop: number;
  anchorBottom: number;
}

interface CommentRailLayout extends CommentGroupAnchor {
  railTop: number;
  railBottom: number;
  height: number;
}

export interface CommentThreadRailItem {
  key: string;
  anchorGroupKey: string;
  rootCommentId: string;
  commentIds: string[];
  anchorTop: number;
  anchorBottom: number;
}

interface CommentThreadRailLayout extends CommentThreadRailItem {
  railTop: number;
  railBottom: number;
  height: number;
}

interface AnchoredRailItem {
  key: string;
  anchorTop: number;
  anchorBottom: number;
}

export type AnchoredRailLayout<T extends AnchoredRailItem> = T & {
  railTop: number;
  railBottom: number;
  height: number;
};

interface CommentAnchorElementLike {
  dataset: {
    commentIds?: string;
  };
  getBoundingClientRect: () => {
    top: number;
    bottom: number;
  };
}

export function normalizeCommentMeasurement(
  value: number,
  measurementScale = 1,
) {
  if (!Number.isFinite(measurementScale) || measurementScale <= 0) {
    return value;
  }

  return value / measurementScale;
}

export function parseCommentIds(value: string | null | undefined): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter((entry): entry is string => typeof entry === "string"),
      ),
    ];
  } catch {
    return [];
  }
}

function getCommentGroupKey(commentIds: string[]): string {
  return [...new Set(commentIds)].sort().join("::");
}

export function getPreferredCommentId(
  commentIds: string[],
  currentCommentId: string | null,
): string | null {
  if (currentCommentId && commentIds.includes(currentCommentId)) {
    return currentCommentId;
  }

  return commentIds[0] ?? null;
}

export function getRootThreadIdForCommentId(
  commentId: string | null,
  comments: ReadonlyMap<string, CriticComment>,
): string | null {
  if (!commentId) return null;

  const visited = new Set<string>();
  let currentComment = comments.get(commentId);

  while (currentComment) {
    if (visited.has(currentComment.id)) {
      break;
    }

    visited.add(currentComment.id);
    const parentCommentId = currentComment.parentCommentId;

    if (
      !parentCommentId ||
      parentCommentId === currentComment.id ||
      !comments.has(parentCommentId)
    ) {
      return currentComment.id;
    }

    currentComment = comments.get(parentCommentId);
  }

  return comments.has(commentId) ? commentId : null;
}

export function getCommentAnchorMeasurements(
  anchorElements: Iterable<CommentAnchorElementLike>,
  containerTop: number,
  measurementScale = 1,
): CommentAnchorMeasurement[] {
  const measurements: CommentAnchorMeasurement[] = [];

  for (const element of anchorElements) {
    const commentIds = parseCommentIds(element.dataset.commentIds);
    if (commentIds.length === 0) continue;

    const rect = element.getBoundingClientRect();
    measurements.push({
      commentIds,
      anchorTop: normalizeCommentMeasurement(
        rect.top - containerTop,
        measurementScale,
      ),
      anchorBottom: normalizeCommentMeasurement(
        rect.bottom - containerTop,
        measurementScale,
      ),
    });
  }

  return measurements;
}

export function groupCommentAnchorMeasurements(
  measurements: CommentAnchorMeasurement[],
): CommentGroupAnchor[] {
  const grouped = new Map<string, CommentGroupAnchor>();

  for (const measurement of measurements) {
    const key = getCommentGroupKey(measurement.commentIds);
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        key,
        commentIds: measurement.commentIds,
        anchorTop: measurement.anchorTop,
        anchorBottom: measurement.anchorBottom,
      });
      continue;
    }

    existing.anchorTop = Math.min(existing.anchorTop, measurement.anchorTop);
    existing.anchorBottom = Math.max(
      existing.anchorBottom,
      measurement.anchorBottom,
    );
  }

  return [...grouped.values()].sort(
    (left, right) => left.anchorTop - right.anchorTop,
  );
}

/**
 * Resolve anchored comment ids to the comments that belong with them, including
 * replies that carry no inline marker.
 *
 * Anchor ids come from a `data-comment-ids` attribute or from the marks under
 * the selection, both of which list only comments written inline. Replies
 * stored in YAML endmatter have no marker by design, so without this they are
 * parsed into `comments` and then dropped by every surface that renders from an
 * anchor: they appear while being composed and vanish on reload.
 */
export function collectAnchoredThreadComments(
  anchorCommentIds: string[],
  comments: ReadonlyMap<string, CriticComment>,
): CriticComment[] {
  const collected = anchorCommentIds
    .map((commentId) => comments.get(commentId))
    .filter((comment): comment is CriticComment => Boolean(comment));

  const seenCommentIds = new Set(collected.map((comment) => comment.id));
  for (const commentId of [...seenCommentIds]) {
    for (const descendantId of getCommentDescendantIds(commentId, comments)) {
      if (seenCommentIds.has(descendantId)) continue;

      const descendant = comments.get(descendantId);
      if (!descendant) continue;

      seenCommentIds.add(descendantId);
      collected.push(descendant);
    }
  }

  return collected;
}

export function buildCommentThreadRailItems(
  groups: CommentGroupAnchor[],
  comments: ReadonlyMap<string, CriticComment>,
): CommentThreadRailItem[] {
  // Keyed by thread root: a comment whose range partially overlaps another
  // comment's is anchored under two different id sets (e.g. `[c1]` and
  // `[c1, c2]`), so the same thread shows up in several groups. Rendering it
  // once per group duplicates React keys and the rail's height map, and the
  // cards pile onto each other.
  const items = new Map<string, CommentThreadRailItem>();

  for (const group of groups) {
    const visibleComments = collectAnchoredThreadComments(
      group.commentIds,
      comments,
    );

    if (visibleComments.length === 0) continue;

    for (const thread of buildCommentThreads(visibleComments)) {
      const threadComments = flattenCommentThreads([thread]);

      if (threadComments.length === 0) continue;

      const existing = items.get(thread.comment.id);
      if (existing) {
        existing.anchorTop = Math.min(existing.anchorTop, group.anchorTop);
        existing.anchorBottom = Math.max(
          existing.anchorBottom,
          group.anchorBottom,
        );
        existing.commentIds = [
          ...new Set([
            ...existing.commentIds,
            ...threadComments.map((comment) => comment.id),
          ]),
        ];
        continue;
      }

      items.set(thread.comment.id, {
        key: thread.comment.id,
        anchorGroupKey: group.key,
        rootCommentId: thread.comment.id,
        commentIds: threadComments.map((comment) => comment.id),
        anchorTop: group.anchorTop,
        anchorBottom: group.anchorBottom,
      });
    }
  }

  return [...items.values()].sort(
    (left, right) => left.anchorTop - right.anchorTop,
  );
}

export function resolveCommentRailLayouts(
  groups: CommentGroupAnchor[],
  heights: Record<string, number>,
  gap = 16,
): CommentRailLayout[] {
  let previousRailBottom = 0;

  return groups.map((group) => {
    const height = heights[group.key] ?? 120;
    const railTop = Math.max(
      group.anchorTop,
      previousRailBottom === 0 ? group.anchorTop : previousRailBottom + gap,
    );
    const railBottom = railTop + height;
    previousRailBottom = railBottom;

    return {
      ...group,
      railTop,
      railBottom,
      height,
    };
  });
}

export function resolveAnchoredRailLayouts<T extends AnchoredRailItem>(
  items: T[],
  heights: Record<string, number>,
  activeKey: string | null,
  gap = 16,
  defaultHeight = 120,
): Array<AnchoredRailLayout<T>> {
  if (items.length === 0) return [];

  const getHeight = (item: T) => heights[item.key] ?? defaultHeight;

  // Resting pass: every card at its anchor, pushed down just far enough to
  // clear the cards before it.
  const restingTops = new Array<number>(items.length);
  let minRestingTop = Number.NEGATIVE_INFINITY;
  items.forEach((item, index) => {
    const railTop = Math.max(item.anchorTop, minRestingTop);
    restingTops[index] = railTop;
    minRestingTop = railTop + getHeight(item) + gap;
  });

  const activeIndex = Math.max(
    0,
    activeKey ? items.findIndex((item) => item.key === activeKey) : 0,
  );

  const resolved = new Array<AnchoredRailLayout<T>>(items.length);

  const activeItem = items[activeIndex] ?? items[0];
  if (!activeItem) return [];

  const activeHeight = getHeight(activeItem);
  resolved[activeIndex] = {
    ...activeItem,
    railTop: activeItem.anchorTop,
    railBottom: activeItem.anchorTop + activeHeight,
    height: activeHeight,
  };

  // Cards above the active one move up from their resting position — not
  // toward their own anchor — so a card that already had clearance stays put
  // when the selection changes.
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    const nextLayout = resolved[index + 1];

    if (!item || !nextLayout) continue;

    const height = getHeight(item);
    const railTop = Math.min(
      restingTops[index] ?? item.anchorTop,
      nextLayout.railTop - gap - height,
    );

    resolved[index] = {
      ...item,
      railTop,
      railBottom: railTop + height,
      height,
    };
  }

  for (let index = activeIndex + 1; index < items.length; index += 1) {
    const item = items[index];
    const previousLayout = resolved[index - 1];

    if (!item || !previousLayout) continue;

    const height = getHeight(item);
    const railTop = Math.max(item.anchorTop, previousLayout.railBottom + gap);

    resolved[index] = {
      ...item,
      railTop,
      railBottom: railTop + height,
      height,
    };
  }

  // Cards above the active one may resolve to negative railTops and slide out
  // of view past the top edge; keeping the active card pinned to its anchor
  // takes priority over keeping every card visible.
  return resolved;
}

export function resolveCommentThreadRailLayouts(
  items: CommentThreadRailItem[],
  heights: Record<string, number>,
  selectedRootThreadId: string | null,
  gap = 16,
): CommentThreadRailLayout[] {
  const activeItem =
    selectedRootThreadId == null
      ? null
      : (items.find((item) => item.rootCommentId === selectedRootThreadId) ??
        null);

  return resolveAnchoredRailLayouts(
    items,
    heights,
    activeItem?.key ?? null,
    gap,
  );
}

/**
 * Comments live in React state beside the ProseMirror document, so undo/redo
 * moves the anchors without moving the comments: undoing a comment deletion
 * brought the highlight back with no card behind it, and the next save then
 * dropped the comment for good. Reconcile after every editor update: a
 * buried comment whose anchor reappears is restored, and a live comment
 * whose anchor disappears is buried (covering undo of creation and redo of
 * deletion).
 *
 * `everAnchored` guards the burial direction and is updated in place: only
 * comments that were anchored at some point this session may be buried, so
 * replies parsed from endmatter whose inline root is already gone (a state
 * hand-edited files can carry) are never touched.
 */
export function reconcileCommentsWithDoc(
  doc: JSONContent,
  live: Map<string, CriticComment>,
  graveyard: Map<string, CriticComment>,
  everAnchored: Set<string>,
): {
  live: Map<string, CriticComment>;
  graveyard: Map<string, CriticComment>;
  changed: boolean;
} {
  const anchoredCommentIds = new Set<string>();
  const anchoredChangeIds = new Set<string>();
  collectAnchorIds(doc, anchoredCommentIds, anchoredChangeIds);

  const combined = new Map([...graveyard, ...live]);
  const rootIsAnchored = (commentId: string): boolean => {
    const visited = new Set<string>();
    let current = combined.get(commentId);
    while (current) {
      if (visited.has(current.id)) return false;
      visited.add(current.id);
      if (anchoredCommentIds.has(current.id)) return true;
      const parentId = current.parentCommentId;
      if (!parentId) return false;
      if (!combined.has(parentId)) {
        // A parent outside the comment maps is a suggestion's change id.
        return anchoredChangeIds.has(parentId);
      }
      current = combined.get(parentId);
    }
    return false;
  };

  const nextLive = new Map(live);
  const nextGraveyard = new Map(graveyard);
  let changed = false;

  for (const [id, comment] of graveyard) {
    if (rootIsAnchored(id)) {
      nextGraveyard.delete(id);
      nextLive.set(id, comment);
      changed = true;
    }
  }

  for (const [id, comment] of live) {
    if (comment.scope === "document") continue;
    if (!everAnchored.has(id)) continue;
    if (rootIsAnchored(id)) continue;
    nextLive.delete(id);
    nextGraveyard.set(id, comment);
    changed = true;
  }

  for (const id of nextLive.keys()) {
    if (rootIsAnchored(id)) everAnchored.add(id);
  }

  return { live: nextLive, graveyard: nextGraveyard, changed };
}

function collectAnchorIds(
  node: JSONContent,
  commentIds: Set<string>,
  changeIds: Set<string>,
): void {
  for (const mark of node.marks ?? []) {
    const attrs = mark.attrs as Record<string, unknown> | undefined;
    if (mark.type === "commentRef" && Array.isArray(attrs?.commentIds)) {
      for (const id of attrs.commentIds) {
        if (typeof id === "string") commentIds.add(id);
      }
    }
    if (mark.type === "criticChange" && typeof attrs?.changeId === "string") {
      changeIds.add(attrs.changeId);
    }
  }
  for (const child of node.content ?? []) {
    collectAnchorIds(child, commentIds, changeIds);
  }
}
