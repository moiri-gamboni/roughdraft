import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import {
  getAddCommentShortcutLabel,
  matchesAddCommentShortcut,
} from "./comment-shortcuts";
import { toHtml } from "./markdown";
import type { StorageBackend } from "./storage";

interface EditorContextMenuProps {
  editor: Editor | null;
  backend: StorageBackend;
  onAddComment?: () => void;
  children: ReactNode;
}

interface MenuPosition {
  x: number;
  y: number;
}

interface SelectionActionPosition {
  left: number;
  top: number;
}

function getNavigatorPlatform() {
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: {
      platform?: string;
    };
  };

  return (
    navigatorWithUserAgentData.userAgentData?.platform ?? navigator.platform
  );
}

export function EditorContextMenu({
  editor,
  backend,
  onAddComment,
  children,
}: EditorContextMenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [selectionActionPosition, setSelectionActionPosition] =
    useState<SelectionActionPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shortcutLabel = getAddCommentShortcutLabel(getNavigatorPlatform());

  const close = useCallback(() => {
    setPosition(null);
  }, []);

  const updateSelectionActionPosition = useCallback(() => {
    if (
      !editor ||
      !onAddComment ||
      !editor.isFocused ||
      editor.state.selection.empty
    ) {
      setSelectionActionPosition(null);
      return;
    }

    const container = containerRef.current;
    const selection = window.getSelection();

    if (
      !container ||
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed
    ) {
      setSelectionActionPosition(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const ancestor =
      range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;

    if (!ancestor || !container.contains(ancestor)) {
      setSelectionActionPosition(null);
      return;
    }

    const boundingRect = range.getBoundingClientRect();
    if (boundingRect.width === 0 && boundingRect.height === 0) {
      setSelectionActionPosition(null);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const nextLeft =
      boundingRect.left + boundingRect.width / 2 - containerRect.left;
    const nextTop = boundingRect.top - containerRect.top - 10;

    setSelectionActionPosition({
      left: nextLeft,
      top: nextTop,
    });
  }, [editor, onAddComment]);

  useEffect(() => {
    if (!position) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        close();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [close, position]);

  useEffect(() => {
    if (!editor) return;

    const schedulePositionUpdate = () => {
      requestAnimationFrame(updateSelectionActionPosition);
    };

    const clearSelectionAction = () => {
      setSelectionActionPosition(null);
    };

    const handleSelectionChange = () => {
      schedulePositionUpdate();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        !onAddComment ||
        !editor.isFocused ||
        editor.state.selection.empty ||
        !matchesAddCommentShortcut(event, getNavigatorPlatform())
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      onAddComment();
      clearSelectionAction();
    };

    editor.on("selectionUpdate", schedulePositionUpdate);
    editor.on("focus", schedulePositionUpdate);
    editor.on("blur", clearSelectionAction);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", schedulePositionUpdate);
    window.addEventListener("scroll", schedulePositionUpdate, true);

    schedulePositionUpdate();

    return () => {
      editor.off("selectionUpdate", schedulePositionUpdate);
      editor.off("focus", schedulePositionUpdate);
      editor.off("blur", clearSelectionAction);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", schedulePositionUpdate);
      window.removeEventListener("scroll", schedulePositionUpdate, true);
    };
  }, [editor, onAddComment, updateSelectionActionPosition]);

  const handlePasteText = useCallback(async () => {
    if (!editor) return;

    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        editor.chain().focus().insertContent(text).run();
      }
    } finally {
      close();
    }
  }, [close, editor]);

  const handlePasteMarkdown = useCallback(async () => {
    if (!editor) return;

    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        editor
          .chain()
          .focus()
          .insertContent(
            toHtml(text, {
              resolveFileUrl: (path) => backend.resolveFileUrl(path),
            }),
          )
          .run();
      }
    } finally {
      close();
    }
  }, [backend, close, editor]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      {selectionActionPosition ? (
        <button
          type="button"
          className="absolute z-30 inline-flex -translate-x-1/2 -translate-y-full items-center gap-2 rounded-full border border-slate-200/90 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-[0_14px_32px_rgba(15,23,42,0.16)] backdrop-blur transition hover:border-sky-200 hover:bg-sky-50/90 hover:text-sky-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          style={{
            left: selectionActionPosition.left,
            top: selectionActionPosition.top,
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => {
            onAddComment?.();
            setSelectionActionPosition(null);
          }}
        >
          <MessageSquarePlus className="size-3.5" />
          <span>Add comment</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tracking-[0.01em] text-slate-500">
            {shortcutLabel}
          </span>
        </button>
      ) : null}
      {position ? (
        <div
          ref={menuRef}
          className="fixed z-[200] min-w-44 rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl"
          style={{ left: position.x, top: position.y }}
        >
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!editor || editor.state.selection.empty}
            onClick={() => {
              onAddComment?.();
              close();
            }}
          >
            <span>Add comment</span>
            <span className="text-[11px] font-medium text-slate-400">
              {shortcutLabel}
            </span>
          </button>
          <button
            type="button"
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
            onClick={() => void handlePasteText()}
          >
            Paste
          </button>
          <button
            type="button"
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
            onClick={() => void handlePasteMarkdown()}
          >
            Paste Markdown
          </button>
        </div>
      ) : null}
    </div>
  );
}
