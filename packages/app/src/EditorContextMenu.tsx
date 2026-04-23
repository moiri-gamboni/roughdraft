import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toHtml } from "./markdown";
import type { StorageBackend } from "./storage";

interface EditorContextMenuProps {
  editor: Editor | null;
  backend: StorageBackend;
  children: ReactNode;
}

interface MenuPosition {
  x: number;
  y: number;
}

export function EditorContextMenu({
  editor,
  backend,
  children,
}: EditorContextMenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setPosition(null);
  }, []);

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
            })
          )
          .run();
      }
    } finally {
      close();
    }
  }, [backend, close, editor]);

  return (
    <div
      className="relative"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      {position ? (
        <div
          ref={menuRef}
          className="fixed z-[200] min-w-44 rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)] backdrop-blur-xl"
          style={{ left: position.x, top: position.y }}
        >
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
