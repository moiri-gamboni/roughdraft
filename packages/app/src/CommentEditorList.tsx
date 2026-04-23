import type { CriticComment } from "./critic-markup";
import { Textarea } from "./components/ui/textarea";
import { cn } from "./lib/utils";

interface CommentEditorListProps {
  comments: CriticComment[];
  variant?: "banner" | "rail";
  selectedCommentId?: string | null;
  hoveredCommentId?: string | null;
  className?: string;
  onDeleteComment: (commentId: string) => void;
  onUpdateComment: (commentId: string, nextContent: string) => void;
  onSelectComment?: (commentId: string) => void;
  onHoverComment?: (commentId: string | null) => void;
  onFocusComment?: (commentId: string) => void;
}

export function CommentEditorList({
  comments,
  variant = "banner",
  selectedCommentId = null,
  hoveredCommentId = null,
  className,
  onDeleteComment,
  onUpdateComment,
  onSelectComment,
  onHoverComment,
  onFocusComment,
}: CommentEditorListProps) {
  if (comments.length === 0) return null;

  return (
    <div
      className={cn(
        variant === "banner"
          ? "space-y-3 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3"
          : "space-y-2",
        className,
      )}
    >
      {comments.map((comment, index) => {
        const isSelected = comment.id === selectedCommentId;
        const isHovered = comment.id === hoveredCommentId;

        return (
          <div
            key={comment.id}
            className={cn(
              "space-y-2 transition-colors",
              variant === "rail" &&
                (index > 0 ? "border-t border-slate-200/80 pt-3" : "pt-0"),
              variant === "rail" &&
                (isSelected
                  ? "rounded-xl bg-amber-100/70 px-3 py-3"
                  : isHovered
                    ? "rounded-xl bg-amber-50/80 px-3 py-3"
                    : "px-3 py-3"),
            )}
            onClick={() => onFocusComment?.(comment.id)}
            onMouseEnter={() => onHoverComment?.(comment.id)}
            onMouseLeave={() => onHoverComment?.(null)}
            onPointerDown={() => onSelectComment?.(comment.id)}
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(
                  "text-[11px] font-semibold tracking-[0.12em] uppercase",
                  variant === "banner" ? "text-amber-800" : "text-slate-600",
                )}
              >
                Comment
              </span>
              <button
                type="button"
                className={cn(
                  "text-xs font-medium transition",
                  variant === "banner"
                    ? "text-amber-900/80 hover:text-rose-700"
                    : "text-slate-500 hover:text-rose-700",
                )}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteComment(comment.id);
                }}
              >
                Delete
              </button>
            </div>
            <Textarea
              value={comment.content}
              placeholder="Add your comment"
              className={cn(
                "min-h-20 text-sm text-slate-800",
                variant === "banner"
                  ? "border-amber-200 bg-white/90"
                  : "border-slate-200 bg-white shadow-none",
              )}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelectComment?.(comment.id);
              }}
              onClick={(event) => event.stopPropagation()}
              onFocus={() => onSelectComment?.(comment.id)}
              onChange={(event) => {
                onUpdateComment(comment.id, event.target.value);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
