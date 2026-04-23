import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CriticComment } from "./critic-markup";
import {
  getPreferredCommentId,
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
  onSelectComment: (commentId: string) => void;
  onFocusComment: (commentId: string) => void;
  onHoverComment: (commentId: string | null) => void;
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
  onSelectComment,
  onFocusComment,
  onHoverComment,
}: DocumentCommentRailProps) {
  const groupRefs = useRef(new Map<string, HTMLDivElement>());
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
          const height = Math.ceil(
            element?.getBoundingClientRect().height ?? current[group.key] ?? 0,
          );
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
  }, [visibleGroups]);

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
          const primaryCommentId =
            getPreferredCommentId(layout.commentIds, selectedCommentId) ??
            layout.visibleComments[0]?.id;

          return (
            <div
              key={layout.key}
              ref={(node) => setGroupRef(layout.key, node)}
              className={cn(
                "absolute left-0 right-0 cursor-default rounded-2xl border bg-white/95 shadow-[0_10px_30px_rgba(15,23,42,0.08)] transition-[border-color,box-shadow,background-color]",
                isSelected
                  ? "border-amber-300 bg-amber-50/80 shadow-[0_16px_36px_rgba(217,119,6,0.14)]"
                  : isHovered
                    ? "border-amber-200 bg-amber-50/50 shadow-[0_12px_32px_rgba(217,119,6,0.10)]"
                    : "border-slate-200/90",
              )}
              style={{ top: layout.railTop }}
              onMouseEnter={() => {
                if (primaryCommentId) {
                  onHoverComment(primaryCommentId);
                }
              }}
              onMouseLeave={() => onHoverComment(null)}
            >
              <CommentEditorList
                comments={layout.visibleComments}
                variant="rail"
                selectedCommentId={selectedCommentId}
                hoveredCommentId={hoveredCommentId}
                onDeleteComment={onDeleteComment}
                onUpdateComment={onUpdateComment}
                onSelectComment={onSelectComment}
                onFocusComment={onFocusComment}
                onHoverComment={onHoverComment}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
