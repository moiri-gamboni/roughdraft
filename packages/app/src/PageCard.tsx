import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useCanvasScale } from "./Canvas";
import { EditorContextMenu } from "./EditorContextMenu";
import { createEditorExtensions } from "./editor-extensions";
import { EditorToolbar } from "./EditorToolbar";
import { toHtml, toMarkdown } from "./markdown";
import type { Page, StorageBackend } from "./storage";

interface PageCardProps {
  page: Page;
  x?: number;
  y?: number;
  selected?: boolean;
  focusRequestKey?: string | null;
  canDelete?: boolean;
  mode?: "canvas" | "document";
  onSelect?: (id: string) => void;
  onSave: (id: string, content: string) => Promise<void>;
  onReposition?: (id: string, x: number, y: number) => void;
  onDelete?: (id: string) => void;
  onSaveStateChange?: (state: "idle" | "saving" | "error") => void;
  documentToolbarHost?: HTMLElement | null;
  backend: StorageBackend;
}

function getCanvasFilenameLabel(pageId: string) {
  const leaf = pageId.split(/[\\/]/).filter(Boolean).at(-1) || pageId;
  return leaf.toLowerCase().endsWith(".md") ? leaf : `${leaf}.md`;
}

export function PageCard({
  page,
  x = 0,
  y = 0,
  selected = false,
  focusRequestKey = null,
  canDelete = true,
  mode = "canvas",
  onSelect,
  onSave,
  onReposition,
  onDelete,
  onSaveStateChange,
  documentToolbarHost = null,
  backend,
}: PageCardProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, pageX: 0, pageY: 0 });
  const recentMarkdownRef = useRef<Set<string>>(new Set());
  const editorRef = useRef<Editor | null>(null);
  const lastFocusRequestKeyRef = useRef<string | null>(null);
  const scale = useCanvasScale();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">(
    "idle",
  );

  const resolveFileUrl = useCallback(
    (path: string) => backend.resolveFileUrl(path),
    [backend],
  );

  const htmlContent = useMemo(
    () =>
      toHtml(page.content, {
        resolveFileUrl,
      }),
    [page.content, resolveFileUrl],
  );

  const insertFiles = useCallback(
    async (files: File[]) => {
      const currentEditor = editorRef.current;
      if (!currentEditor || files.length === 0) return;

      const assets = await Promise.all(
        files.map((file) => backend.saveAsset(file)),
      );
      const markdown = assets
        .map((asset, index) => {
          const file = files[index];
          if (asset.mimeType.startsWith("image/")) {
            return `![${file?.name || "Image"}](${asset.markdownPath})`;
          }
          return `[${file?.name || "Attachment"}](${asset.markdownPath})`;
        })
        .join("\n\n");

      currentEditor
        .chain()
        .focus()
        .insertContent(
          toHtml(markdown, {
            resolveFileUrl,
          }),
        )
        .run();
    },
    [backend, resolveFileUrl],
  );

  const editor = useEditor(
    {
      extensions: createEditorExtensions("Start writing..."),
      content: htmlContent,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class:
            mode === "canvas"
              ? "tiptap min-h-[120px] text-[1.05rem] leading-8 text-slate-800 outline-none selection:bg-sky-100"
              : "tiptap min-h-[70vh] text-[1.08rem] leading-8 text-slate-800 outline-none selection:bg-sky-100",
        },
        handleDrop: (_view, event) => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.length === 0) return false;
          event.preventDefault();
          void insertFiles(files);
          return true;
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length === 0) return false;
          event.preventDefault();
          void insertFiles(files);
          return true;
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        const markdown = toMarkdown(currentEditor.getHTML());
        recentMarkdownRef.current.add(markdown);
        if (recentMarkdownRef.current.size > 10) {
          const iterator = recentMarkdownRef.current.values();
          recentMarkdownRef.current.delete(iterator.next().value as string);
        }

        if (saveTimer.current) clearTimeout(saveTimer.current);
        setSaveState("saving");
        saveTimer.current = setTimeout(async () => {
          try {
            await onSave(page.id, markdown);
            setSaveState("idle");
          } catch (error) {
            console.error("Failed to save page:", error);
            setSaveState("error");
          }
        }, 500);
      },
    },
    [page.id],
  );

  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) return;
    if (recentMarkdownRef.current.has(page.content)) {
      recentMarkdownRef.current.delete(page.content);
      return;
    }

    if (editor.getHTML() !== htmlContent) {
      editor.commands.setContent(htmlContent, { emitUpdate: false });
    }
  }, [editor, htmlContent, page.content]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    onSaveStateChange?.(saveState);
  }, [onSaveStateChange, saveState]);

  useEffect(() => {
    if (!editor || !selected || !focusRequestKey) return;
    if (lastFocusRequestKeyRef.current === focusRequestKey) return;
    lastFocusRequestKeyRef.current = focusRequestKey;

    requestAnimationFrame(() => {
      editor.chain().focus("end").run();
    });
  }, [editor, focusRequestKey, selected]);

  const handleDragPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (mode !== "canvas" || !onSelect) return;
      event.stopPropagation();
      event.preventDefault();
      isDragging.current = true;
      dragStart.current = { x, y, pageX: event.clientX, pageY: event.clientY };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      onSelect(page.id);
    },
    [mode, onSelect, page.id, x, y],
  );

  const handleDragPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (mode !== "canvas" || !onReposition || !isDragging.current) return;
      const dx = (event.clientX - dragStart.current.pageX) / scale;
      const dy = (event.clientY - dragStart.current.pageY) / scale;
      onReposition(page.id, dragStart.current.x + dx, dragStart.current.y + dy);
    },
    [mode, onReposition, page.id, scale],
  );

  const handleDragPointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleBodyPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      event.stopPropagation();
      onSelect?.(page.id);
    },
    [onSelect, page.id],
  );

  const isCanvasMode = mode === "canvas";
  const chromeTitle = isCanvasMode
    ? getCanvasFilenameLabel(page.id)
    : page.title;
  const toolbar = (
    <EditorToolbar
      editor={editor}
      onPickFiles={insertFiles}
      variant={isCanvasMode ? "canvas" : "document"}
    />
  );

  return (
    <div
      className={
        isCanvasMode
          ? `absolute w-[680px] overflow-hidden rounded-3xl border bg-white/95 shadow-[0_18px_50px_rgba(15,23,42,0.14)] backdrop-blur transition-[border-color,box-shadow] ${
              selected
                ? "border-sky-300 shadow-[0_28px_72px_rgba(14,116,144,0.22)]"
                : "border-slate-200/90"
            }`
          : "w-full"
      }
      style={isCanvasMode ? { left: x, top: y } : undefined}
    >
      {isCanvasMode ? (
        <div
          className="flex min-h-10 cursor-grab select-none items-center gap-2 border-b border-slate-200/80 bg-slate-50/90 px-4 active:cursor-grabbing"
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={handleDragPointerUp}
        >
          <span className="flex-1 truncate text-sm text-slate-500">
            {chromeTitle}
          </span>
          {saveState === "saving" ? (
            <span className="text-[11px] font-medium tracking-[0.08em] text-slate-400 uppercase">
              Saving…
            </span>
          ) : null}
          {saveState === "error" ? (
            <span className="text-[11px] font-medium tracking-[0.08em] text-rose-600 uppercase">
              Save failed
            </span>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-full border border-transparent text-lg leading-none text-slate-400 transition hover:border-rose-100 hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onDelete?.(page.id);
              }}
              title="Delete page"
            >
              &times;
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        className={`cursor-text bg-white ${
          isCanvasMode ? "px-5 pt-4 pb-6" : "bg-transparent"
        }`}
        onPointerDown={handleBodyPointerDown}
      >
        {isCanvasMode || !documentToolbarHost
          ? toolbar
          : createPortal(toolbar, documentToolbarHost)}
        <div className={isCanvasMode ? undefined : "pb-24"}>
          <EditorContextMenu editor={editor} backend={backend}>
            <EditorContent editor={editor} />
          </EditorContextMenu>
        </div>
      </div>
    </div>
  );
}
