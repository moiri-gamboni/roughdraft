import type { Editor } from "@tiptap/react";
import {
  Bold,
  CheckSquare,
  Code2,
  Italic,
  Link2,
  List,
  ListOrdered,
  MoreHorizontal,
  Redo2,
  Table2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface EditorToolbarProps {
  editor: Editor | null;
  onPickFiles: (files: File[]) => void | Promise<void>;
  variant?: "canvas" | "document";
}

type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "blockquote"
  | "codeBlock";

const BLOCK_TYPE_OPTIONS: Array<{ label: string; value: BlockType }> = [
  { label: "Paragraph", value: "paragraph" },
  { label: "Heading 1", value: "heading1" },
  { label: "Heading 2", value: "heading2" },
  { label: "Heading 3", value: "heading3" },
  { label: "Quote", value: "blockquote" },
  { label: "Code block", value: "codeBlock" },
];

function getBlockType(editor: Editor): BlockType {
  if (editor.isActive("heading", { level: 1 })) return "heading1";
  if (editor.isActive("heading", { level: 2 })) return "heading2";
  if (editor.isActive("heading", { level: 3 })) return "heading3";
  if (editor.isActive("blockquote")) return "blockquote";
  if (editor.isActive("codeBlock")) return "codeBlock";
  return "paragraph";
}

function ToolbarButton({
  active = false,
  disabled = false,
  label,
  onClick,
  icon,
  variant = "canvas",
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  variant?: "canvas" | "document";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              variant === "document"
                ? "size-8 rounded-lg border border-transparent text-slate-600 hover:bg-slate-100"
                : "size-8 rounded-xl border border-transparent text-slate-700 hover:border-slate-300 hover:bg-white",
              active &&
                (variant === "document"
                  ? "bg-slate-900 text-white hover:bg-slate-900"
                  : "border-sky-200 bg-sky-50 text-sky-700 shadow-sm"),
            )}
          >
            {icon}
          </Button>
        }
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function EditorToolbar({
  editor,
  onPickFiles,
  variant = "canvas",
}: EditorToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [blockType, setBlockType] = useState<BlockType>("paragraph");
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("https://");

  useEffect(() => {
    if (!editor) return;

    const updateBlockType = () => {
      setBlockType(getBlockType(editor));
    };

    updateBlockType();
    editor.on("selectionUpdate", updateBlockType);
    editor.on("update", updateBlockType);

    return () => {
      editor.off("selectionUpdate", updateBlockType);
      editor.off("update", updateBlockType);
    };
  }, [editor]);

  if (!editor) {
    return null;
  }

  const handleBlockChange = (next: BlockType) => {
    switch (next) {
      case "paragraph":
        editor.chain().focus().setParagraph().run();
        break;
      case "heading1":
        editor.chain().focus().toggleHeading({ level: 1 }).run();
        break;
      case "heading2":
        editor.chain().focus().toggleHeading({ level: 2 }).run();
        break;
      case "heading3":
        editor.chain().focus().toggleHeading({ level: 3 }).run();
        break;
      case "blockquote":
        editor.chain().focus().toggleBlockquote().run();
        break;
      case "codeBlock":
        editor.chain().focus().toggleCodeBlock().run();
        break;
    }
  };

  const openLinkDialog = () => {
    const existing = editor.getAttributes("link").dataMarkdownSrc as
      | string
      | null;
    setLinkValue(existing || "https://");
    setLinkDialogOpen(true);
  };

  const handleLinkSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = linkValue.trim();

    if (!next) {
      editor.chain().focus().unsetLink().run();
      setLinkDialogOpen(false);
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: next, dataMarkdownSrc: next } as any)
      .run();
    setLinkDialogOpen(false);
  };

  const handleRemoveLink = () => {
    editor.chain().focus().unsetLink().run();
    setLinkDialogOpen(false);
  };

  const isDocumentToolbar = variant === "document";
  const sectionClass =
    variant === "document"
      ? "inline-flex items-center gap-0.5 rounded-xl"
      : "inline-flex items-center gap-0.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-1 shadow-sm";
  const toolbarClass = cn(
    "min-h-11",
    isDocumentToolbar
      ? "flex flex-wrap items-center gap-1"
      : "mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200/80 pb-4",
  );
  const selectTriggerClass = cn(
    "h-8 text-sm font-medium text-slate-700",
    isDocumentToolbar
      ? "min-w-32 rounded-lg border border-transparent bg-transparent px-2.5 hover:bg-slate-100 focus-visible:border-slate-300 focus-visible:ring-slate-300/50"
      : "min-w-40 rounded-xl border-transparent bg-transparent px-3 hover:border-slate-300 hover:bg-white focus-visible:border-sky-400 focus-visible:ring-sky-300/50",
  );
  const overflowActionClass =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100";

  return (
    <>
      <div
        className={toolbarClass}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={sectionClass}>
          <Select
            value={blockType}
            onValueChange={(value) => handleBlockChange(value as BlockType)}
          >
            <SelectTrigger
              aria-label="Block type"
              className={selectTriggerClass}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" className="rounded-2xl">
              {BLOCK_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!isDocumentToolbar ? (
          <Separator
            orientation="vertical"
            className="hidden h-8 bg-slate-200 sm:block"
            aria-hidden="true"
          />
        ) : null}
        <div className={sectionClass} aria-label="Text formatting" role="group">
          <ToolbarButton
            active={editor.isActive("bold")}
            disabled={!editor.can().chain().focus().toggleBold().run()}
            label="Bold"
            onClick={() => editor.chain().focus().toggleBold().run()}
            icon={<Bold size={16} />}
            variant={variant}
          />
          <ToolbarButton
            active={editor.isActive("italic")}
            disabled={!editor.can().chain().focus().toggleItalic().run()}
            label="Italic"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            icon={<Italic size={16} />}
            variant={variant}
          />
          <ToolbarButton
            active={editor.isActive("code")}
            disabled={!editor.can().chain().focus().toggleCode().run()}
            label="Inline code"
            onClick={() => editor.chain().focus().toggleCode().run()}
            icon={<Code2 size={16} />}
            variant={variant}
          />
        </div>
        {!isDocumentToolbar ? (
          <Separator
            orientation="vertical"
            className="hidden h-8 bg-slate-200 sm:block"
            aria-hidden="true"
          />
        ) : null}
        <div className={sectionClass} aria-label="Lists" role="group">
          <ToolbarButton
            active={editor.isActive("bulletList")}
            disabled={!editor.can().chain().focus().toggleBulletList().run()}
            label="Bulleted list"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            icon={<List size={16} />}
            variant={variant}
          />
          <ToolbarButton
            active={editor.isActive("orderedList")}
            disabled={!editor.can().chain().focus().toggleOrderedList().run()}
            label="Numbered list"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            icon={<ListOrdered size={16} />}
            variant={variant}
          />
          {!isDocumentToolbar ? (
            <ToolbarButton
              active={editor.isActive("taskList")}
              disabled={!editor.can().chain().focus().toggleTaskList().run()}
              label="Task list"
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              icon={<CheckSquare size={16} />}
              variant={variant}
            />
          ) : null}
        </div>
        {!isDocumentToolbar ? (
          <Separator
            orientation="vertical"
            className="hidden h-8 bg-slate-200 sm:block"
            aria-hidden="true"
          />
        ) : null}
        <div className={sectionClass} aria-label="Insert" role="group">
          <ToolbarButton
            active={editor.isActive("link")}
            label="Link"
            onClick={openLinkDialog}
            icon={<Link2 size={16} />}
            variant={variant}
          />
          {!isDocumentToolbar ? (
            <>
              <ToolbarButton
                label="Insert table"
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run()
                }
                icon={<Table2 size={16} />}
                variant={variant}
              />
              <ToolbarButton
                label="Insert file or image"
                onClick={() => fileInputRef.current?.click()}
                icon={<Upload size={16} />}
                variant={variant}
              />
            </>
          ) : null}
        </div>
        {!isDocumentToolbar ? (
          <Separator
            orientation="vertical"
            className="hidden h-8 bg-slate-200 sm:block"
            aria-hidden="true"
          />
        ) : null}
        <div className={sectionClass} aria-label="History" role="group">
          <ToolbarButton
            label="Undo"
            disabled={!editor.can().chain().focus().undo().run()}
            onClick={() => editor.chain().focus().undo().run()}
            icon={<Undo2 size={16} />}
            variant={variant}
          />
          <ToolbarButton
            label="Redo"
            disabled={!editor.can().chain().focus().redo().run()}
            onClick={() => editor.chain().focus().redo().run()}
            icon={<Redo2 size={16} />}
            variant={variant}
          />
        </div>
        {isDocumentToolbar ? (
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-lg border border-transparent text-slate-600 hover:bg-slate-100"
                  aria-label="More editor actions"
                >
                  <MoreHorizontal size={16} />
                </Button>
              }
            />
            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_14px_36px_rgba(15,23,42,0.12)]"
            >
              <button
                type="button"
                className={overflowActionClass}
                onClick={() => editor.chain().focus().toggleTaskList().run()}
              >
                <CheckSquare size={16} />
                <span>Task list</span>
              </button>
              <button
                type="button"
                className={overflowActionClass}
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                    .run()
                }
              >
                <Table2 size={16} />
                <span>Insert table</span>
              </button>
              <button
                type="button"
                className={overflowActionClass}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={16} />
                <span>Insert file</span>
              </button>
            </PopoverContent>
          </Popover>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length > 0) {
              void onPickFiles(files);
            }
            event.target.value = "";
          }}
        />
      </div>
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form className="grid gap-4" onSubmit={handleLinkSubmit}>
            <DialogHeader>
              <DialogTitle>Edit link</DialogTitle>
              <DialogDescription>
                Enter a URL to apply to the current selection, or clear the
                field to remove the link.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              placeholder="https://example.com"
            />
            <DialogFooter className="sm:justify-between">
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRemoveLink}
                  disabled={!editor.isActive("link")}
                >
                  Remove link
                </Button>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLinkDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Apply link</Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
