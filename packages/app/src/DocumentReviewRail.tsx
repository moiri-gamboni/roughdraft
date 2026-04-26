import { Check, Reply, X } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CommentEditorList,
  type CommentActionDefinition,
  type CommentActionsRenderContext,
  type CommentContentRenderContext,
} from "./CommentEditorList";
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

function getSuggestionPreview(suggestion: CriticChangeRailItem) {
  const oldText = suggestion.oldText.trim();
  const newText = suggestion.newText.trim();

  if (suggestion.kind === "addition") return newText || "Inserted text";
  if (suggestion.kind === "deletion") return oldText || "Deleted text";
  if (oldText && newText) return `${oldText} -> ${newText}`;
  return oldText || newText || "Changed text";
}

function getSuggestionRootComment(
  suggestion: CriticChangeRailItem,
): CriticComment {
  return {
    id: suggestion.changeId,
    content: getSuggestionPreview(suggestion),
    createdAt: suggestion.change.createdAt,
    authorType: suggestion.change.authorType,
    authorId: suggestion.change.authorId,
  };
}

function renderQuotedSuggestionText(text: string, fallback: string) {
  return (
    <span className="italic text-slate-600">"{text.trim() || fallback}"</span>
  );
}

function SuggestionCommentContent({
  suggestion,
}: {
  suggestion: CriticChangeRailItem;
}) {
  const oldText = suggestion.oldText.trim();
  const newText = suggestion.newText.trim();

  if (suggestion.kind === "addition") {
    return (
      <>
        <span className="font-semibold text-slate-800">Insert:</span>{" "}
        {renderQuotedSuggestionText(newText, "Inserted text")}
      </>
    );
  }

  if (suggestion.kind === "deletion") {
    return (
      <>
        <span className="font-semibold text-slate-800">Delete:</span>{" "}
        {renderQuotedSuggestionText(oldText, "Deleted text")}
      </>
    );
  }

  return (
    <>
      <span className="font-semibold text-slate-800">Replace:</span>{" "}
      {renderQuotedSuggestionText(oldText, "Original text")}{" "}
      <span className="text-slate-500">with</span>{" "}
      {renderQuotedSuggestionText(newText, "Changed text")}
    </>
  );
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
          const suggestionComments = suggestion.commentIds
            .map((commentId) => comments.get(commentId))
            .filter((comment): comment is CriticComment => Boolean(comment));
          const suggestionCommentIds = new Set(
            suggestionComments.map((comment) => comment.id),
          );
          const normalizedSuggestionComments = suggestionComments.map(
            (comment) =>
              comment.parentCommentId === suggestion.changeId ||
              (comment.parentCommentId &&
                suggestionCommentIds.has(comment.parentCommentId))
                ? comment
                : {
                    ...comment,
                    parentCommentId: suggestion.changeId,
                  },
          );
          const suggestionRootComment = getSuggestionRootComment(suggestion);
          const suggestionThreadComments = [
            suggestionRootComment,
            ...normalizedSuggestionComments,
          ];
          const renderCommentContent = ({
            comment,
            defaultContent,
          }: CommentContentRenderContext) =>
            comment.id === suggestion.changeId ? (
              <SuggestionCommentContent suggestion={suggestion} />
            ) : (
              defaultContent
            );
          const getCommentActions = ({
            comment,
            defaultActions,
          }: CommentActionsRenderContext): CommentActionDefinition[] =>
            comment.id === suggestion.changeId
              ? [
                  {
                    key: "accept",
                    label: "Accept suggestion",
                    icon: <Check className="size-3.5" />,
                    compact: true,
                    onClick: (event) => {
                      event.stopPropagation();
                      onAcceptSuggestion(suggestion.changeId);
                    },
                  },
                  {
                    key: "reject",
                    label: "Reject suggestion",
                    tone: "danger",
                    icon: <X className="size-3.5" />,
                    compact: true,
                    onClick: (event) => {
                      event.stopPropagation();
                      onRejectSuggestion(suggestion.changeId);
                    },
                  },
                  {
                    key: "reply",
                    label: "Reply",
                    icon: <Reply className="size-3.5" />,
                    compact: true,
                    onClick: (event) => {
                      event.stopPropagation();
                      onReplySuggestion(suggestion.changeId);
                    },
                  },
                ]
              : defaultActions;

          return (
            <div
              key={layout.key}
              ref={(node) => setItemRef(layout.key, node)}
              data-suggestion-thread-container="true"
              className={cn(
                "absolute left-0 right-0 rounded-xl border border-transparent bg-transparent shadow-none transition-all duration-200 ease-out will-change-transform",
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
              <CommentEditorList
                comments={suggestionThreadComments}
                variant="rail"
                selectedCommentId={
                  selectedCommentId ?? (isSelected ? suggestion.changeId : null)
                }
                hoveredCommentId={
                  hoveredCommentId ?? (isHovered ? suggestion.changeId : null)
                }
                onDeleteComment={onDeleteComment}
                onUpdateComment={onUpdateComment}
                onReplyComment={(commentId) => {
                  if (commentId === suggestion.changeId) {
                    onReplySuggestion(suggestion.changeId);
                    return;
                  }

                  onReplyComment(commentId);
                }}
                onSelectComment={(commentId) => {
                  if (commentId === suggestion.changeId) {
                    onSelectSuggestion(suggestion.changeId);
                    return;
                  }

                  onSelectComment(commentId);
                }}
                onFocusComment={(commentId) => {
                  if (commentId === suggestion.changeId) {
                    onFocusSuggestion(suggestion.changeId);
                    return;
                  }

                  onFocusComment(commentId);
                }}
                onHoverComment={(commentId) => {
                  if (commentId === suggestion.changeId) {
                    onHoverSuggestion(suggestion.changeId);
                    return;
                  }

                  onHoverComment(commentId);
                }}
                pendingFocusCommentId={pendingFocusCommentId}
                onAutoFocusComment={onAutoFocusComment}
                renderCommentContent={renderCommentContent}
                getCommentActions={getCommentActions}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
