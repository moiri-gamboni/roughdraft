import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCanvasScale } from "./Canvas";
import type { CriticComment } from "./critic-markup";
import {
  getPreferredCommentId,
  normalizeCommentMeasurement,
  resolveCommentRailLayouts,
  type CommentGroupAnchor,
} from "./document-comments";
import { CommentEditorList } from "./CommentEditorList";
import { cn } from "./lib/utils";

interface DocumentCommentRailProps {
  commentGroups: CommentGroupAnchor[];
  comments: Map<string, CriticComment>;
  selectedCommentId: string | null;
  hoveredCommentId: string | null;
  contentHeight: number;
  className?: string;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (commentId: string, nextContent: string) => void;
  onReplyComment: (commentId: string) => void;
  onSelectComment: (commentId: string) => void;
  onFocusComment: (commentId: string) => void;
  onHoverComment: (commentId: string | null) => void;
  pendingFocusCommentId?: string | null;
  onAutoFocusComment?: (commentId: string) => void;
}

export function DocumentCommentRail({
  commentGroups,
  comments,
  selectedCommentId,
  hoveredCommentId,
  contentHeight,
  className,
  onDeleteComment,
  onUpdateComment,
  onReplyComment,
  onSelectComment,
  onFocusComment,
  onHoverComment,
  pendingFocusCommentId = null,
  onAutoFocusComment,
}: DocumentCommentRailProps) {
  const groupRefs = useRef(new Map<string, HTMLDivElement>());
  const scale = useCanvasScale();
  const [groupHeights, setGroupHeights] = useState<Record<string, number>>({});

  const visibleGroups = useMemo(
    () =>
      commentGroups
        .map((group) => {
          const visibleComments = group.commentIds
            .map((commentId) => comments.get(commentId))
            .filter((comment): comment is CriticComment => Boolean(comment));

          if (visibleComments.length === 0) return null;

          return {
            ...group,
            visibleComments,
          };
        })
        .filter(
          (
            group,
          ): group is CommentGroupAnchor & {
            visibleComments: CriticComment[];
          } => Boolean(group),
        ),
    [commentGroups, comments],
  );

  const setGroupRef = useCallback(
    (key: string, node: HTMLDivElement | null) => {
      if (node) {
        groupRefs.current.set(key, node);
      } else {
        groupRefs.current.delete(key);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (visibleGroups.length === 0) {
      setGroupHeights({});
      return;
    }

    const updateHeights = () => {
      setGroupHeights((current) => {
        const next: Record<string, number> = {};
        let changed = false;

        for (const group of visibleGroups) {
          const element = groupRefs.current.get(group.key);
          const measuredHeight = Math.ceil(
            element?.getBoundingClientRect().height ?? 0,
          );
          const height =
            measuredHeight > 0
              ? Math.ceil(normalizeCommentMeasurement(measuredHeight, scale))
              : (current[group.key] ?? 0);
          next[group.key] = height;
          if (current[group.key] !== height) {
            changed = true;
          }
        }

        if (
          !changed &&
          Object.keys(current).length === Object.keys(next).length
        ) {
          return current;
        }

        return next;
      });
    };

    updateHeights();

    const resizeObserver = new ResizeObserver(() => {
      updateHeights();
    });

    for (const group of visibleGroups) {
      const element = groupRefs.current.get(group.key);
      if (element) {
        resizeObserver.observe(element);
      }
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [scale, visibleGroups]);

  const layouts = useMemo(() => {
    const baseLayouts = resolveCommentRailLayouts(visibleGroups, groupHeights);

    return baseLayouts.map((layout) => ({
      ...layout,
      visibleComments:
        visibleGroups.find((group) => group.key === layout.key)
          ?.visibleComments ?? [],
    }));
  }, [groupHeights, visibleGroups]);

  const railHeight =
    Math.max(contentHeight, layouts.at(-1)?.railBottom ?? 0) + 24;

  if (visibleGroups.length === 0) {
    return <aside className={cn("min-w-0", className)} aria-hidden="true" />;
  }

  return (
    <aside className={cn("min-w-0", className)}>
      <div className="relative" style={{ minHeight: railHeight }}>
        {layouts.map((layout) => {
          const isSelected =
            !!selectedCommentId &&
            layout.commentIds.includes(selectedCommentId);
          const isHovered =
            !!hoveredCommentId && layout.commentIds.includes(hoveredCommentId);
          const isExpanded = isSelected;
          const primaryCommentId =
            getPreferredCommentId(layout.commentIds, selectedCommentId) ??
            layout.visibleComments[0]?.id;

          return (
            <div
              key={layout.key}
              ref={(node) => setGroupRef(layout.key, node)}
              data-comment-thread-container="true"
              className={cn(
                "absolute left-0 right-0 rounded-2xl border bg-white/95 transition-all duration-200 ease-out will-change-transform",
                isSelected
                  ? "-translate-x-2 border-slate-300 shadow-[0_22px_48px_rgba(15,23,42,0.18)]"
                  : isHovered
                    ? "border-slate-300/80"
                    : "border-slate-200/90",
                isExpanded ? "cursor-default" : "cursor-pointer",
              )}
              style={{ top: layout.railTop }}
              onMouseEnter={() => {
                if (primaryCommentId) {
                  onHoverComment(primaryCommentId);
                }
              }}
              onMouseLeave={() => onHoverComment(null)}
              onClick={() => {
                if (isExpanded || !primaryCommentId) return;
                onFocusComment(primaryCommentId);
              }}
            >
              <CommentEditorList
                comments={layout.visibleComments}
                variant="rail"
                className={cn(!isExpanded && "pointer-events-none")}
                interactive={isExpanded}
                selectedCommentId={selectedCommentId}
                hoveredCommentId={hoveredCommentId}
                onDeleteComment={onDeleteComment}
                onUpdateComment={onUpdateComment}
                onReplyComment={onReplyComment}
                onSelectComment={onSelectComment}
                onFocusComment={onFocusComment}
                onHoverComment={onHoverComment}
                pendingFocusCommentId={pendingFocusCommentId}
                onAutoFocusComment={onAutoFocusComment}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
