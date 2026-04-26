import { Check, Reply, X } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CommentEditorList } from "./CommentEditorList";
import type {
  CriticChangeAttrs,
  CriticChangeKind,
  CriticComment,
} from "./critic-markup";
import {
  buildCommentThreadRailItems,
  type CommentGroupAnchor,
  type CommentThreadRailItem,
  getPreferredCommentId,
  getRootThreadIdForCommentId,
  normalizeCommentMeasurement,
  resolveAnchoredRailLayouts,
} from "./document-comments";
import { cn } from "./lib/utils";

export interface CriticChangeRailItem {
  changeId: string;
  change: CriticChangeAttrs;
  kind: CriticChangeKind;
  oldText: string;
  newText: string;
  commentIds: string[];
  anchorTop: number;
  anchorBottom: number;
}

interface DocumentReviewRailProps {
  commentGroups: CommentGroupAnchor[];
  comments: Map<string, CriticComment>;
  suggestions: CriticChangeRailItem[];
  selectedCommentId: string | null;
  hoveredCommentId: string | null;
  selectedChangeId: string | null;
  hoveredChangeId: string | null;
  contentHeight: number;
  className?: string;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (commentId: string, nextContent: string) => void;
  onReplyComment: (commentId: string) => void;
  onSelectComment: (commentId: string) => void;
  onFocusComment: (commentId: string) => void;
  onHoverComment: (commentId: string | null) => void;
  onAcceptSuggestion: (changeId: string) => void;
  onRejectSuggestion: (changeId: string) => void;
  onReplySuggestion: (changeId: string) => void;
  onSelectSuggestion: (changeId: string) => void;
  onFocusSuggestion: (changeId: string) => void;
  onHoverSuggestion: (changeId: string | null) => void;
  pendingFocusCommentId?: string | null;
  onAutoFocusComment?: (commentId: string) => void;
}

function getSuggestionTypeLabel(kind: CriticChangeKind) {
  if (kind === "addition") return "Insertion";
  if (kind === "deletion") return "Deletion";
  return "Replacement";
}

function getSuggestionPreview(suggestion: CriticChangeRailItem) {
  const oldText = suggestion.oldText.trim();
  const newText = suggestion.newText.trim();

  if (suggestion.kind === "addition") return newText || "Inserted text";
  if (suggestion.kind === "deletion") return oldText || "Deleted text";
  if (oldText && newText) return `${oldText} -> ${newText}`;
  return oldText || newText || "Changed text";
}

function getSuggestionAuthor(change: CriticChangeAttrs) {
  return change.authorType === "ai" ? "AI" : change.authorId || "Me";
}

export function DocumentReviewRail({
  commentGroups,
  comments,
  suggestions,
  selectedCommentId,
  hoveredCommentId,
  selectedChangeId,
  hoveredChangeId,
  contentHeight,
  className,
  onDeleteComment,
  onUpdateComment,
  onReplyComment,
  onSelectComment,
  onFocusComment,
  onHoverComment,
  onAcceptSuggestion,
  onRejectSuggestion,
  onReplySuggestion,
  onSelectSuggestion,
  onFocusSuggestion,
  onHoverSuggestion,
  pendingFocusCommentId = null,
  onAutoFocusComment,
}: DocumentReviewRailProps) {
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [itemHeights, setItemHeights] = useState<Record<string, number>>({});

  const activeRootThreadId = useMemo(
    () => getRootThreadIdForCommentId(selectedCommentId, comments),
    [comments, selectedCommentId],
  );

  const suggestionCommentIds = useMemo(
    () => new Set(suggestions.flatMap((suggestion) => suggestion.commentIds)),
    [suggestions],
  );

  const visibleCommentThreads = useMemo(
    () =>
      buildCommentThreadRailItems(
        commentGroups
          .map((group) => ({
            ...group,
            commentIds: group.commentIds.filter(
              (commentId) => !suggestionCommentIds.has(commentId),
            ),
          }))
          .filter((group) => group.commentIds.length > 0),
        comments,
      )
        .map((item) => {
          const visibleComments = item.commentIds
            .map((commentId) => comments.get(commentId))
            .filter((comment): comment is CriticComment => Boolean(comment));

          if (visibleComments.length === 0) return null;

          return {
            ...item,
            visibleComments,
          };
        })
        .filter(
          (
            item,
          ): item is CommentThreadRailItem & {
            visibleComments: CriticComment[];
          } => Boolean(item),
        ),
    [commentGroups, comments, suggestionCommentIds],
  );

  const commentEntries = useMemo(
    () =>
      visibleCommentThreads.map((thread) => ({
        type: "comment" as const,
        key: thread.key,
        anchorTop: thread.anchorTop,
        anchorBottom: thread.anchorBottom,
        thread,
      })),
    [visibleCommentThreads],
  );

  const suggestionEntries = useMemo(
    () =>
      suggestions.map((suggestion) => ({
        type: "suggestion" as const,
        key: suggestion.changeId,
        anchorTop: suggestion.anchorTop,
        anchorBottom: suggestion.anchorBottom,
        suggestion,
      })),
    [suggestions],
  );

  const activeSuggestionIdForComment = useMemo(
    () =>
      selectedCommentId
        ? (suggestions.find((suggestion) =>
            suggestion.commentIds.includes(selectedCommentId),
          )?.changeId ?? null)
        : null,
    [selectedCommentId, suggestions],
  );

  const layouts = useMemo(() => {
    const entries = [...suggestionEntries, ...commentEntries].sort(
      (left, right) => left.anchorTop - right.anchorTop,
    );
    const activeKey =
      selectedChangeId ?? activeSuggestionIdForComment ?? activeRootThreadId;

    return resolveAnchoredRailLayouts(entries, itemHeights, activeKey);
  }, [
    activeRootThreadId,
    activeSuggestionIdForComment,
    commentEntries,
    itemHeights,
    selectedChangeId,
    suggestionEntries,
  ]);

  const setItemRef = useCallback((key: string, node: HTMLDivElement | null) => {
    if (node) {
      itemRefs.current.set(key, node);
    } else {
      itemRefs.current.delete(key);
    }
  }, []);

  useLayoutEffect(() => {
    if (layouts.length === 0) {
      setItemHeights((current) =>
        Object.keys(current).length === 0 ? current : {},
      );
      return;
    }

    const updateHeights = () => {
      setItemHeights((current) => {
        const next: Record<string, number> = {};
        let changed = false;

        for (const layout of layouts) {
          const element = itemRefs.current.get(layout.key);
          const measuredHeight = Math.ceil(
            element?.getBoundingClientRect().height ?? 0,
          );
          const height =
            measuredHeight > 0
              ? Math.ceil(normalizeCommentMeasurement(measuredHeight, 1))
              : (current[layout.key] ?? 0);
          next[layout.key] = height;
          if (current[layout.key] !== height) {
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

    for (const layout of layouts) {
      const element = itemRefs.current.get(layout.key);
      if (element) {
        resizeObserver.observe(element);
      }
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [layouts]);

  const railHeight =
    Math.max(contentHeight, layouts.at(-1)?.railBottom ?? 0) + 24;

  if (layouts.length === 0) {
    return <aside className={cn("min-w-0", className)} aria-hidden="true" />;
  }

  return (
    <aside className={cn("min-w-0", className)}>
      <div className="relative" style={{ minHeight: railHeight }}>
        {layouts.map((layout) => {
          if (layout.type === "comment") {
            const isSelected =
              !!activeRootThreadId &&
              layout.thread.rootCommentId === activeRootThreadId;
            const isExpanded = isSelected;
            const primaryCommentId =
              getPreferredCommentId(
                layout.thread.commentIds,
                selectedCommentId,
              ) ?? layout.thread.visibleComments[0]?.id;

            return (
              <div
                key={layout.key}
                ref={(node) => setItemRef(layout.key, node)}
                data-comment-thread-container="true"
                className={cn(
                  "absolute left-0 right-0 rounded-xl border border-transparent bg-transparent shadow-none transition-all duration-200 ease-out will-change-transform",
                  isSelected
                    ? "border-[#DFDFDC] bg-white shadow-[0_20px_48px_rgba(57,47,38,0.14)]"
                    : "",
                  isSelected && "-translate-x-2",
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
                  comments={layout.thread.visibleComments}
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
          }

          const suggestion = layout.suggestion;
          const isSelected = selectedChangeId === suggestion.changeId;
          const isHovered = hoveredChangeId === suggestion.changeId;
          const isExpanded = isSelected || suggestion.commentIds.length > 0;
          const suggestionComments = suggestion.commentIds
            .map((commentId) => comments.get(commentId))
            .filter((comment): comment is CriticComment => Boolean(comment));

          return (
            <div
              key={layout.key}
              ref={(node) => setItemRef(layout.key, node)}
              data-suggestion-thread-container="true"
              className={cn(
                "absolute left-0 right-0 rounded-xl border border-transparent bg-transparent px-4 py-3 shadow-none transition-all duration-200 ease-out will-change-transform",
                isSelected
                  ? "-translate-x-2 border-[#DFDFDC] bg-white shadow-[0_20px_48px_rgba(57,47,38,0.14)]"
                  : "",
                isHovered && !isSelected && "cursor-pointer",
              )}
              style={{ top: layout.railTop }}
              onMouseEnter={() => onHoverSuggestion(suggestion.changeId)}
              onMouseLeave={() => onHoverSuggestion(null)}
              onPointerDown={() => onSelectSuggestion(suggestion.changeId)}
              onClick={() => {
                if (isSelected) return;
                onFocusSuggestion(suggestion.changeId);
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold tracking-[0.08em] text-stone-500 uppercase">
                    {getSuggestionTypeLabel(suggestion.kind)}
                  </div>
                  <div className="mt-1 text-sm leading-5 text-slate-800">
                    {getSuggestionPreview(suggestion)}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-stone-400">
                    {getSuggestionAuthor(suggestion.change)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-full text-emerald-700 transition hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                    aria-label="Accept suggestion"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAcceptSuggestion(suggestion.changeId);
                    }}
                  >
                    <Check className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-full text-rose-700 transition hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                    aria-label="Reject suggestion"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRejectSuggestion(suggestion.changeId);
                    }}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
              {isExpanded && suggestionComments.length > 0 ? (
                <CommentEditorList
                  comments={suggestionComments}
                  variant="rail"
                  className="mt-3 border-t border-slate-200/80 px-0 pt-3"
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
              ) : null}
              {isExpanded ? (
                <button
                  type="button"
                  className="mt-3 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-stone-500 transition hover:bg-[#DED8CE]/45 hover:text-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                  onClick={(event) => {
                    event.stopPropagation();
                    onReplySuggestion(suggestion.changeId);
                  }}
                >
                  <Reply className="size-3.5" />
                  Reply
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
