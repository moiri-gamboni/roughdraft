import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useCanvasScale } from "./Canvas";
import { CommentEditorList } from "./CommentEditorList";
import { DocumentCommentRail } from "./DocumentCommentRail";
import {
  createCriticComment,
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
  type CriticComment,
} from "./critic-markup";
import { getPreferredCommentId, parseCommentIds } from "./document-comments";
import { EditorContextMenu } from "./EditorContextMenu";
import { createEditorExtensions } from "./editor-extensions";
import { EditorToolbar } from "./EditorToolbar";
import { toHtml } from "./markdown";
import type { Page, StorageBackend } from "./storage";
import { useCommentAnchorLayout } from "./useCommentAnchorLayout";

const CANVAS_CONTENT_WIDTH = 680;
const CANVAS_CONTENT_HORIZONTAL_PADDING = 20;
const CANVAS_EDITOR_FRAME_WIDTH =
  CANVAS_CONTENT_WIDTH - CANVAS_CONTENT_HORIZONTAL_PADDING * 2;
const CANVAS_RAIL_WIDTH = 296;
const CANVAS_RAIL_GAP = 24;

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

function getSelectionCommentIds(editor: Editor | null): string[] {
  if (!editor) return [];

  const directAttributes = editor.getAttributes("commentRef").commentIds;

  if (Array.isArray(directAttributes) && directAttributes.length > 0) {
    return directAttributes;
  }

  const { from, to, empty, $from } = editor.state.selection;
  const commentIds = new Set<string>();

  if (empty) {
    for (const mark of $from.marks()) {
      if (mark.type.name !== "commentRef") continue;

      for (const commentId of mark.attrs.commentIds ?? []) {
        commentIds.add(commentId);
      }
    }
  } else {
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return;

      for (const mark of node.marks) {
        if (mark.type.name !== "commentRef") continue;

        for (const commentId of mark.attrs.commentIds ?? []) {
          commentIds.add(commentId);
        }
      }
    });
  }

  return [...commentIds];
}

function findCommentRange(editor: Editor | null, commentId: string) {
  if (!editor) return null;

  const commentMarkType = editor.state.schema.marks.commentRef;
  if (!commentMarkType) return null;

  let from: number | null = null;
  let to: number | null = null;
  let closed = false;

  editor.state.doc.descendants((node, pos) => {
    if (closed || !node.isText) return false;

    const hasCommentId = node.marks.some(
      (mark) =>
        mark.type === commentMarkType &&
        Array.isArray(mark.attrs.commentIds) &&
        mark.attrs.commentIds.includes(commentId),
    );

    if (!hasCommentId) {
      if (from != null && to != null && pos >= to) {
        closed = true;
      }
      return;
    }

    if (from == null || to == null) {
      from = pos;
      to = pos + node.nodeSize;
      return;
    }

    if (pos <= to) {
      to = pos + node.nodeSize;
      return;
    }

    closed = true;
  });

  if (from == null || to == null) return null;

  return { from, to };
}

function findCommentAnchorElement(editor: Editor | null, commentId: string) {
  if (!editor) return null;

  const anchors = editor.view.dom.querySelectorAll<HTMLElement>(
    ".comment-anchor[data-comment-ids]",
  );

  return (
    [...anchors].find((anchor) =>
      parseCommentIds(anchor.dataset.commentIds).includes(commentId),
    ) ?? null
  );
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
  const commentsRef = useRef<Map<string, CriticComment>>(new Map());
  const lastFocusRequestKeyRef = useRef<string | null>(null);
  const selectedCommentIdRef = useRef<string | null>(null);
  const scale = useCanvasScale();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">(
    "idle",
  );
  const [activeCommentIds, setActiveCommentIds] = useState<string[]>([]);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(
    null,
  );
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);

  const resolveFileUrl = useCallback(
    (path: string) => backend.resolveFileUrl(path),
    [backend],
  );

  const parsedContent = useMemo(
    () =>
      criticMarkdownToEditorState(page.content, {
        resolveFileUrl,
      }),
    [page.content, resolveFileUrl],
  );
  const [comments, setComments] = useState<Map<string, CriticComment>>(
    () => parsedContent.comments,
  );

  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  const scheduleSave = useCallback(
    (doc?: JSONContent, nextComments?: Map<string, CriticComment>) => {
      const currentEditor = editorRef.current;
      const currentDoc = doc ?? currentEditor?.getJSON();

      if (!currentDoc) return;

      const markdown = editorStateToCriticMarkdown(
        currentDoc,
        nextComments ?? commentsRef.current,
      );

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
    [onSave, page.id],
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
      content: parsedContent.doc,
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
        scheduleSave(currentEditor.getJSON());
      },
      onSelectionUpdate: ({ editor: currentEditor }) => {
        const nextActiveCommentIds = getSelectionCommentIds(currentEditor);
        setActiveCommentIds(nextActiveCommentIds);
        setSelectedCommentId((current) =>
          getPreferredCommentId(nextActiveCommentIds, current),
        );
      },
    },
    [page.id],
  );

  editorRef.current = editor;
  selectedCommentIdRef.current = selectedCommentId;
  const { commentGroups, contentHeight, measureLayout } =
    useCommentAnchorLayout(editor, true);

  useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) return;
    if (recentMarkdownRef.current.has(page.content)) {
      recentMarkdownRef.current.delete(page.content);
      return;
    }

    commentsRef.current = parsedContent.comments;
    setComments(parsedContent.comments);
    setActiveCommentIds([]);
    setSelectedCommentId(null);
    setHoveredCommentId(null);

    const nextDoc = parsedContent.doc;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(nextDoc)) {
      editor.commands.setContent(nextDoc, { emitUpdate: false });
    }
  }, [editor, page.content, parsedContent]);

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

  useEffect(() => {
    if (selectedCommentId && !comments.has(selectedCommentId)) {
      setSelectedCommentId(null);
    }

    if (hoveredCommentId && !comments.has(hoveredCommentId)) {
      setHoveredCommentId(null);
    }
  }, [comments, hoveredCommentId, selectedCommentId]);

  useEffect(() => {
    if (!editor) return;

    const anchorElements = editor.view.dom.querySelectorAll<HTMLElement>(
      ".comment-anchor[data-comment-ids]",
    );

    for (const anchor of anchorElements) {
      const commentIds = parseCommentIds(anchor.dataset.commentIds);
      const isSelected =
        !!selectedCommentId && commentIds.includes(selectedCommentId);
      const isHovered =
        !!hoveredCommentId && commentIds.includes(hoveredCommentId);

      anchor.dataset.selected = isSelected ? "true" : "false";
      anchor.dataset.hovered = isHovered ? "true" : "false";
    }

    return () => {
      for (const anchor of anchorElements) {
        delete anchor.dataset.selected;
        delete anchor.dataset.hovered;
      }
    };
  }, [editor, hoveredCommentId, selectedCommentId]);

  useEffect(() => {
    if (!editor) return;

    const anchorElements = editor.view.dom.querySelectorAll<HTMLElement>(
      ".comment-anchor[data-comment-ids]",
    );
    const cleanupCallbacks: Array<() => void> = [];

    for (const anchor of anchorElements) {
      const commentIds = parseCommentIds(anchor.dataset.commentIds);
      if (commentIds.length === 0) continue;

      const handleMouseEnter = () => {
        const nextCommentId = getPreferredCommentId(
          commentIds,
          selectedCommentIdRef.current,
        );
        if (nextCommentId) {
          setHoveredCommentId(nextCommentId);
        }
      };

      const handleMouseLeave = () => {
        setHoveredCommentId((current) =>
          current && commentIds.includes(current) ? null : current,
        );
      };

      const handleClick = () => {
        const nextCommentId = getPreferredCommentId(
          commentIds,
          selectedCommentIdRef.current,
        );
        if (nextCommentId) {
          setSelectedCommentId(nextCommentId);
        }
      };

      anchor.addEventListener("mouseenter", handleMouseEnter);
      anchor.addEventListener("mouseleave", handleMouseLeave);
      anchor.addEventListener("click", handleClick);
      cleanupCallbacks.push(() => {
        anchor.removeEventListener("mouseenter", handleMouseEnter);
        anchor.removeEventListener("mouseleave", handleMouseLeave);
        anchor.removeEventListener("click", handleClick);
      });
    }

    return () => {
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
    };
  }, [editor]);

  const handleAddComment = useCallback(() => {
    const currentEditor = editorRef.current;

    if (!currentEditor || currentEditor.state.selection.empty) return;

    const existingIds = getSelectionCommentIds(currentEditor);
    const comment = createCriticComment();
    const nextComments = new Map(commentsRef.current);
    nextComments.set(comment.id, comment);
    commentsRef.current = nextComments;
    setComments(nextComments);

    currentEditor
      .chain()
      .focus()
      .setCommentRef({ commentIds: [...existingIds, comment.id] })
      .run();

    const nextActiveCommentIds = [...existingIds, comment.id];
    setActiveCommentIds(nextActiveCommentIds);
    setSelectedCommentId(comment.id);
    scheduleSave(currentEditor.getJSON(), nextComments);
    requestAnimationFrame(() => {
      measureLayout();
    });
  }, [measureLayout, scheduleSave]);

  const updateComment = useCallback(
    (commentId: string, updater: (comment: CriticComment) => CriticComment) => {
      const existingComment = commentsRef.current.get(commentId);

      if (!existingComment) return;

      const nextComments = new Map(commentsRef.current);
      nextComments.set(commentId, updater(existingComment));
      commentsRef.current = nextComments;
      setComments(nextComments);
      scheduleSave(undefined, nextComments);
    },
    [scheduleSave],
  );

  const deleteComment = useCallback(
    (commentId: string) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      const nextComments = new Map(commentsRef.current);
      nextComments.delete(commentId);
      commentsRef.current = nextComments;
      setComments(nextComments);

      currentEditor.chain().focus().removeCommentId(commentId).run();
      setActiveCommentIds((current) =>
        current.filter((id) => id !== commentId),
      );
      setSelectedCommentId((current) =>
        current === commentId ? null : current,
      );
      setHoveredCommentId((current) =>
        current === commentId ? null : current,
      );
      scheduleSave(currentEditor.getJSON(), nextComments);
      requestAnimationFrame(() => {
        measureLayout();
      });
    },
    [measureLayout, scheduleSave],
  );

  const selectComment = useCallback((commentId: string) => {
    setSelectedCommentId(commentId);
  }, []);

  const focusComment = useCallback((commentId: string) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;

    setSelectedCommentId(commentId);

    const range = findCommentRange(currentEditor, commentId);
    if (range) {
      currentEditor.commands.focus();
      currentEditor.view.dispatch(
        currentEditor.state.tr
          .setSelection(
            TextSelection.create(currentEditor.state.doc, range.from, range.to),
          )
          .scrollIntoView(),
      );
      return;
    }

    const anchorElement = findCommentAnchorElement(currentEditor, commentId);
    if (anchorElement) {
      anchorElement.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
      currentEditor.commands.focus();
    }
  }, []);

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

  const handleSelectPageCapture = useCallback(() => {
    onSelect?.(page.id);
  }, [onSelect, page.id]);

  const isCanvasMode = mode === "canvas";
  const showCanvasRail = isCanvasMode && comments.size > 0;
  const chromeTitle = isCanvasMode
    ? getCanvasFilenameLabel(page.id)
    : page.title;
  const activeComments = activeCommentIds
    .map((commentId) => comments.get(commentId))
    .filter((comment): comment is CriticComment => Boolean(comment));
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
        isCanvasMode ? `absolute ${selected ? "z-10" : "z-0"}` : "w-full"
      }
      style={isCanvasMode ? { left: x, top: y } : undefined}
    >
      {isCanvasMode ? (
        <div className="relative" style={{ width: CANVAS_CONTENT_WIDTH }}>
          <div
            className={`rounded-3xl border bg-white/95 shadow-[0_18px_50px_rgba(15,23,42,0.14)] backdrop-blur transition-[border-color,box-shadow] ${
              selected
                ? "border-sky-300 shadow-[0_28px_72px_rgba(14,116,144,0.22)]"
                : "border-slate-200/90"
            }`}
          >
            <div
              className="flex min-h-10 cursor-grab select-none items-center gap-2 rounded-t-3xl border-b border-slate-200/80 bg-slate-50/90 px-4 active:cursor-grabbing"
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
            <div
              className="cursor-text rounded-b-3xl bg-white px-5 pt-4 pb-6"
              onPointerDown={handleBodyPointerDown}
            >
              {toolbar}
              <div className="relative">
                <EditorContextMenu
                  editor={editor}
                  backend={backend}
                  onAddComment={handleAddComment}
                >
                  <EditorContent editor={editor} />
                </EditorContextMenu>
                {showCanvasRail ? (
                  <div
                    className="absolute top-0"
                    style={{
                      left: CANVAS_EDITOR_FRAME_WIDTH + CANVAS_RAIL_GAP,
                      width: CANVAS_RAIL_WIDTH,
                    }}
                    onPointerDownCapture={handleSelectPageCapture}
                    onPointerDown={handleBodyPointerDown}
                  >
                    <DocumentCommentRail
                      className="w-full"
                      commentGroups={commentGroups}
                      comments={comments}
                      selectedCommentId={selectedCommentId}
                      hoveredCommentId={hoveredCommentId}
                      contentHeight={contentHeight}
                      onDeleteComment={deleteComment}
                      onUpdateComment={(commentId, nextContent) => {
                        updateComment(commentId, (current) => ({
                          ...current,
                          content: nextContent,
                        }));
                      }}
                      onSelectComment={selectComment}
                      onFocusComment={focusComment}
                      onHoverComment={setHoveredCommentId}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="cursor-text bg-transparent"
          onPointerDown={handleBodyPointerDown}
        >
          {!documentToolbarHost
            ? toolbar
            : createPortal(toolbar, documentToolbarHost)}
          <div className="document-page-shell">
            <div className="min-w-0">
              {activeComments.length > 0 ? (
                <CommentEditorList
                  comments={activeComments}
                  className="document-comment-fallback mb-4"
                  selectedCommentId={selectedCommentId}
                  hoveredCommentId={hoveredCommentId}
                  onDeleteComment={deleteComment}
                  onUpdateComment={(commentId, nextContent) => {
                    updateComment(commentId, (current) => ({
                      ...current,
                      content: nextContent,
                    }));
                  }}
                  onSelectComment={selectComment}
                  onHoverComment={setHoveredCommentId}
                />
              ) : null}
              <div className="pb-24">
                <EditorContextMenu
                  editor={editor}
                  backend={backend}
                  onAddComment={handleAddComment}
                >
                  <EditorContent editor={editor} />
                </EditorContextMenu>
              </div>
            </div>
            <DocumentCommentRail
              className="document-comment-rail"
              commentGroups={commentGroups}
              comments={comments}
              selectedCommentId={selectedCommentId}
              hoveredCommentId={hoveredCommentId}
              contentHeight={contentHeight}
              onDeleteComment={deleteComment}
              onUpdateComment={(commentId, nextContent) => {
                updateComment(commentId, (current) => ({
                  ...current,
                  content: nextContent,
                }));
              }}
              onSelectComment={selectComment}
              onFocusComment={focusComment}
              onHoverComment={setHoveredCommentId}
            />
          </div>
        </div>
      )}
    </div>
  );
}
