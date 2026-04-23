export interface CommentAnchorMeasurement {
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

export interface CommentRailLayout extends CommentGroupAnchor {
  railTop: number;
  railBottom: number;
  height: number;
}

interface CommentAnchorElementLike {
  dataset: {
    commentIds?: string;
  };
  getBoundingClientRect: () => {
    top: number;
    bottom: number;
  };
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

export function getCommentGroupKey(commentIds: string[]): string {
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

export function getCommentAnchorMeasurements(
  anchorElements: Iterable<CommentAnchorElementLike>,
  containerTop: number,
): CommentAnchorMeasurement[] {
  const measurements: CommentAnchorMeasurement[] = [];

  for (const element of anchorElements) {
    const commentIds = parseCommentIds(element.dataset.commentIds);
    if (commentIds.length === 0) continue;

    const rect = element.getBoundingClientRect();
    measurements.push({
      commentIds,
      anchorTop: rect.top - containerTop,
      anchorBottom: rect.bottom - containerTop,
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
