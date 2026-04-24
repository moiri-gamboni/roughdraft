import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { Bot, Check, Pencil, Reply, Trash2, User, X } from "lucide-react";
import {
  buildCommentThreads,
  type CriticComment,
  type CriticCommentThread,
} from "./critic-markup";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { cn } from "./lib/utils";

interface CommentEditorListProps {
  comments: CriticComment[];
  variant?: "banner" | "rail";
  selectedCommentId?: string | null;
  hoveredCommentId?: string | null;
  className?: string;
  interactive?: boolean;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (commentId: string, nextContent: string) => void;
  onSelectComment?: (commentId: string) => void;
  onHoverComment?: (commentId: string | null) => void;
  onFocusComment?: (commentId: string) => void;
  onReplyComment?: (commentId: string) => void;
  pendingFocusCommentId?: string | null;
  onAutoFocusComment?: (commentId: string) => void;
}

export function CommentEditorList({
  comments,
  variant = "banner",
  selectedCommentId = null,
  hoveredCommentId = null,
  className,
  interactive = true,
  onDeleteComment,
  onUpdateComment,
  onSelectComment,
  onHoverComment,
  onFocusComment,
  onReplyComment,
  pendingFocusCommentId = null,
  onAutoFocusComment,
}: CommentEditorListProps) {
  const textareaRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingCommentIds, setEditingCommentIds] = useState<string[]>([]);
  const threads = useMemo(() => buildCommentThreads(comments), [comments]);
  const commentMap = useMemo(
    () => new Map(comments.map((comment) => [comment.id, comment])),
    [comments],
  );

  useEffect(() => {
    const validCommentIds = new Set(comments.map((comment) => comment.id));

    setDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([commentId]) =>
          validCommentIds.has(commentId),
        ),
      ),
    );
    setEditingCommentIds((current) =>
      current.filter((commentId) => validCommentIds.has(commentId)),
    );
  }, [comments]);

  useEffect(() => {
    if (!interactive) return;
    if (!pendingFocusCommentId) return;

    const pendingComment = commentMap.get(pendingFocusCommentId);
    if (!pendingComment) return;

    setDrafts((current) => ({
      ...current,
      [pendingFocusCommentId]:
        current[pendingFocusCommentId] ?? pendingComment.content,
    }));
    setEditingCommentIds((current) =>
      current.includes(pendingFocusCommentId)
        ? current
        : [...current, pendingFocusCommentId],
    );
  }, [commentMap, interactive, pendingFocusCommentId]);

  useEffect(() => {
    if (!interactive) return;
    if (!pendingFocusCommentId) return;
    if (!editingCommentIds.includes(pendingFocusCommentId)) return;

    const target = textareaRefs.current.get(pendingFocusCommentId);
    if (!target || target.offsetParent === null) return;

    target.focus();
    const cursorPosition = target.value.length;
    target.setSelectionRange(cursorPosition, cursorPosition);
    onAutoFocusComment?.(pendingFocusCommentId);
  }, [
    editingCommentIds,
    interactive,
    onAutoFocusComment,
    pendingFocusCommentId,
  ]);

  if (comments.length === 0) return null;

  const startEditingComment = (commentId: string) => {
    const comment = commentMap.get(commentId);
    if (!comment) return;

    setDrafts((current) => ({
      ...current,
      [commentId]: current[commentId] ?? comment.content,
    }));
    setEditingCommentIds((current) =>
      current.includes(commentId) ? current : [...current, commentId],
    );
    onSelectComment?.(commentId);
  };

  const stopEditingComment = (commentId: string) => {
    setEditingCommentIds((current) =>
      current.filter((currentCommentId) => currentCommentId !== commentId),
    );
  };

  const submitEditingComment = (commentId: string) => {
    const comment = commentMap.get(commentId);
    if (!comment) return;

    const nextContent = (drafts[commentId] ?? comment.content).trim();

    if (nextContent.length === 0) {
      onDeleteComment(commentId);
      return;
    }

    if (nextContent !== comment.content) {
      onUpdateComment(commentId, nextContent);
    }

    setDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[commentId];
      return nextDrafts;
    });
    stopEditingComment(commentId);
  };

  const cancelEditingComment = (commentId: string) => {
    const comment = commentMap.get(commentId);
    if (!comment) return;

    setDrafts((current) => {
      const nextDrafts = { ...current };
      delete nextDrafts[commentId];
      return nextDrafts;
    });

    if (comment.content.trim().length === 0) {
      onDeleteComment(commentId);
      return;
    }

    stopEditingComment(commentId);
  };

  return (
    <div
      data-comment-thread-container="true"
      className={cn(
        variant === "banner"
          ? "space-y-2 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3"
          : "space-y-1.5 px-4 py-3",
        className,
      )}
    >
      {threads.map((thread, index) => (
        <CommentThreadNode
          key={thread.comment.id}
          thread={thread}
          depth={0}
          index={index}
          variant={variant}
          interactive={interactive}
          drafts={drafts}
          editingCommentIds={editingCommentIds}
          selectedCommentId={selectedCommentId}
          hoveredCommentId={hoveredCommentId}
          textareaRefs={textareaRefs}
          onDeleteComment={onDeleteComment}
          onUpdateComment={onUpdateComment}
          onSelectComment={onSelectComment}
          onHoverComment={onHoverComment}
          onFocusComment={onFocusComment}
          onReplyComment={onReplyComment}
          onStartEditingComment={startEditingComment}
          onSubmitEditingComment={submitEditingComment}
          onCancelEditingComment={cancelEditingComment}
          onChangeDraft={(commentId, nextContent) => {
            setDrafts((current) => ({
              ...current,
              [commentId]: nextContent,
            }));
          }}
        />
      ))}
    </div>
  );
}

interface CommentThreadNodeProps {
  thread: CriticCommentThread;
  depth: number;
  index: number;
  variant: "banner" | "rail";
  interactive: boolean;
  drafts: Record<string, string>;
  editingCommentIds: string[];
  selectedCommentId: string | null;
  hoveredCommentId: string | null;
  textareaRefs: MutableRefObject<Map<string, HTMLTextAreaElement>>;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (commentId: string, nextContent: string) => void;
  onSelectComment?: (commentId: string) => void;
  onHoverComment?: (commentId: string | null) => void;
  onFocusComment?: (commentId: string) => void;
  onReplyComment?: (commentId: string) => void;
  onStartEditingComment: (commentId: string) => void;
  onSubmitEditingComment: (commentId: string) => void;
  onCancelEditingComment: (commentId: string) => void;
  onChangeDraft: (commentId: string, nextContent: string) => void;
}

function CommentActionButton({
  label,
  variant,
  tone = "neutral",
  icon,
  compact = false,
  onClick,
}: {
  label: string;
  variant: "banner" | "rail";
  tone?: "neutral" | "danger";
  icon: ReactNode;
  compact?: boolean;
  onClick: (event: MouseEvent) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={compact ? "icon-xs" : "sm"}
            className={cn(
              compact
                ? "rounded-full border border-transparent transition-colors duration-150"
                : "h-7 rounded-full border border-transparent px-2.5 text-[11px] font-medium tracking-[0.08em] uppercase transition-colors duration-150",
              tone === "danger"
                ? variant === "banner"
                  ? "text-amber-900/75 hover:bg-rose-100 hover:text-rose-700"
                  : "text-slate-400 hover:bg-rose-50 hover:text-slate-900"
                : variant === "banner"
                  ? "text-amber-900/80 hover:bg-amber-100 hover:text-amber-950"
                  : "text-slate-400 hover:bg-slate-100 hover:text-slate-900",
            )}
          >
            {icon}
            {compact ? null : <span>{label}</span>}
          </Button>
        }
        aria-label={label}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onClick}
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function CommentThreadNode({
  thread,
  depth,
  index,
  variant,
  interactive,
  drafts,
  editingCommentIds,
  selectedCommentId,
  hoveredCommentId,
  textareaRefs,
  onDeleteComment,
  onUpdateComment,
  onSelectComment,
  onHoverComment,
  onFocusComment,
  onReplyComment,
  onStartEditingComment,
  onSubmitEditingComment,
  onCancelEditingComment,
  onChangeDraft,
}: CommentThreadNodeProps) {
  const { comment, replies } = thread;
  const isSelected = comment.id === selectedCommentId;
  const isHovered = comment.id === hoveredCommentId;
  const isEditing = interactive && editingCommentIds.includes(comment.id);
  const isAiAuthor = comment.authorType === "ai";
  const authorLabel = isAiAuthor
    ? "AI"
    : comment.authorId?.trim()
      ? comment.authorId
      : "User";
  const AuthorIcon = isAiAuthor ? Bot : User;
  const draftContent = drafts[comment.id] ?? comment.content;
  const showThreadLine = replies.length > 0;
  const avatarTone = isAiAuthor
    ? variant === "banner"
      ? "border-sky-200 bg-sky-100 text-sky-700"
      : "border-sky-200 bg-sky-50 text-sky-700"
    : variant === "banner"
      ? "border-amber-200 bg-amber-100 text-amber-800"
      : "border-amber-200 bg-amber-50 text-amber-700";
  const bodyTone =
    variant === "banner"
      ? isSelected
        ? "bg-white/85"
        : isHovered
          ? "bg-white/70"
          : "bg-transparent"
      : "bg-transparent";
  const threadLineTone =
    variant === "banner" ? "bg-amber-200/80" : "bg-slate-200/90";

  return (
    <div
      className={cn(
        "relative transition-all duration-200 ease-out",
        variant === "rail" &&
          depth === 0 &&
          (index > 0 ? "border-t border-slate-200/80 pt-3" : "pt-0"),
      )}
      onClick={() => {
        if (!interactive) return;
        onSelectComment?.(comment.id);
      }}
      onMouseEnter={() => {
        if (!interactive) return;
        onHoverComment?.(comment.id);
      }}
      onMouseLeave={() => {
        if (!interactive) return;
        onHoverComment?.(null);
      }}
      onPointerDown={() => {
        if (!interactive) return;
        onSelectComment?.(comment.id);
      }}
    >
      {showThreadLine ? (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-4 w-px",
            threadLineTone,
            depth > 0 ? "top-0 bottom-0" : "top-10 bottom-0",
          )}
        />
      ) : null}
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2">
        <div className="relative flex justify-center">
          <div
            className={cn(
              "relative z-10 flex size-7 items-center justify-center rounded-full border shadow-[0_1px_2px_rgba(15,23,42,0.08)]",
              avatarTone,
            )}
            title={authorLabel}
          >
            <AuthorIcon className="size-4 shrink-0" />
          </div>
        </div>
        <div className={cn("min-w-0 rounded-2xl px-0.5", bodyTone)}>
          <div className="truncate text-[13px] font-semibold text-slate-900">
            {authorLabel}
          </div>
          <div
            className={cn(
              "mt-1 text-sm leading-6 whitespace-pre-wrap",
              variant === "banner" ? "text-slate-800" : "text-slate-700",
            )}
          >
            {isEditing
              ? null
              : comment.content.trim().length > 0
                ? comment.content
                : "Empty comment"}
          </div>
          {isEditing ? (
            <Textarea
              ref={(node) => {
                if (node) {
                  textareaRefs.current.set(comment.id, node);
                } else {
                  textareaRefs.current.delete(comment.id);
                }
              }}
              value={draftContent}
              placeholder={depth === 0 ? "Add your comment" : "Write a reply"}
              rows={1}
              className={cn(
                "mt-1 min-h-12 px-3 py-2 text-sm leading-6 md:text-sm md:leading-6",
                variant === "banner"
                  ? "border-amber-200 bg-white/90 text-slate-800"
                  : "border-slate-200 bg-white text-slate-700 shadow-none",
              )}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectComment?.(comment.id);
              }}
              onClick={(event) => {
                event.stopPropagation();
              }}
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  event.key.toLowerCase() === "enter"
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  onSubmitEditingComment(comment.id);
                  return;
                }

                if (event.key !== "Escape") return;

                event.preventDefault();
                event.stopPropagation();
                onCancelEditingComment(comment.id);
              }}
              onFocus={() => {
                onSelectComment?.(comment.id);
              }}
              onChange={(event) => {
                onChangeDraft(comment.id, event.target.value);
              }}
            />
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {isEditing ? (
              <>
                <CommentActionButton
                  label="Save"
                  variant={variant}
                  icon={<Check className="size-3.5" />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSubmitEditingComment(comment.id);
                  }}
                />
                <CommentActionButton
                  label="Cancel"
                  variant={variant}
                  icon={<X className="size-3.5" />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancelEditingComment(comment.id);
                  }}
                />
              </>
            ) : (
              <>
                <CommentActionButton
                  label="Reply"
                  variant={variant}
                  icon={<Reply className="size-3.5" />}
                  compact
                  onClick={(event) => {
                    event.stopPropagation();
                    onReplyComment?.(comment.id);
                  }}
                />
                <CommentActionButton
                  label="Edit"
                  variant={variant}
                  icon={<Pencil className="size-3.5" />}
                  compact
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartEditingComment(comment.id);
                  }}
                />
                <CommentActionButton
                  label="Delete"
                  variant={variant}
                  tone="danger"
                  icon={<Trash2 className="size-3.5" />}
                  compact
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteComment(comment.id);
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>
      {replies.length > 0 ? (
        <div className="mt-3 ml-5 space-y-3">
          {replies.map((reply, replyIndex) => (
            <CommentThreadNode
              key={reply.comment.id}
              thread={reply}
              depth={depth + 1}
              index={replyIndex}
              variant={variant}
              interactive={interactive}
              drafts={drafts}
              editingCommentIds={editingCommentIds}
              selectedCommentId={selectedCommentId}
              hoveredCommentId={hoveredCommentId}
              textareaRefs={textareaRefs}
              onDeleteComment={onDeleteComment}
              onUpdateComment={onUpdateComment}
              onSelectComment={onSelectComment}
              onHoverComment={onHoverComment}
              onFocusComment={onFocusComment}
              onReplyComment={onReplyComment}
              onStartEditingComment={onStartEditingComment}
              onSubmitEditingComment={onSubmitEditingComment}
              onCancelEditingComment={onCancelEditingComment}
              onChangeDraft={onChangeDraft}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
