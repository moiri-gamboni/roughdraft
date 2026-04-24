import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  CheckSquare,
  Code2,
  type LucideIcon,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  MoreHorizontal,
  Pilcrow,
  Quote,
  Redo2,
  SquareCode,
  Table2,
  Undo2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
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

const BLOCK_TYPE_OPTIONS: Array<{
  label: string;
  value: BlockType;
  icon: LucideIcon;
}> = [
  { label: "Paragraph", value: "paragraph", icon: Pilcrow },
  { label: "Heading 1", value: "heading1", icon: Heading1 },
  { label: "Heading 2", value: "heading2", icon: Heading2 },
  { label: "Heading 3", value: "heading3", icon: Heading3 },
  { label: "Quote", value: "blockquote", icon: Quote },
  { label: "Code block", value: "codeBlock", icon: SquareCode },
];

function getBlockType(editor: Editor): BlockType {
  if (editor.isActive("heading", { level: 1 })) return "heading1";
  if (editor.isActive("heading", { level: 2 })) return "heading2";
  if (editor.isActive("heading", { level: 3 })) return "heading3";
  if (editor.isActive("blockquote")) return "blockquote";
  if (editor.isActive("codeBlock")) return "codeBlock";
  return "paragraph";
}

function getBlockTypeOption(blockType: BlockType) {
  return (
    BLOCK_TYPE_OPTIONS.find((option) => option.value === blockType) ??
    BLOCK_TYPE_OPTIONS[0]
  );
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
            size={variant === "document" ? "icon-sm" : "icon"}
            className={cn(
              variant === "document"
                ? "rounded-md border border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                : "size-8 rounded-xl border border-transparent text-slate-700 hover:border-slate-300 hover:bg-white",
              active &&
                (variant === "document"
                  ? "bg-slate-900 text-white hover:bg-slate-900 hover:text-white"
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
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("https://");

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      blockType: currentEditor ? getBlockType(currentEditor) : "paragraph",
      isBoldActive: currentEditor?.isActive("bold") ?? false,
      isItalicActive: currentEditor?.isActive("italic") ?? false,
      isCodeActive: currentEditor?.isActive("code") ?? false,
      isBulletListActive: currentEditor?.isActive("bulletList") ?? false,
      isTaskListActive: currentEditor?.isActive("taskList") ?? false,
      isOrderedListActive: currentEditor?.isActive("orderedList") ?? false,
      isLinkActive: currentEditor?.isActive("link") ?? false,
      canToggleBold:
        currentEditor?.can().chain().focus().toggleBold().run() ?? false,
      canToggleItalic:
        currentEditor?.can().chain().focus().toggleItalic().run() ?? false,
      canToggleCode:
        currentEditor?.can().chain().focus().toggleCode().run() ?? false,
      canToggleBulletList:
        currentEditor?.can().chain().focus().toggleBulletList().run() ?? false,
      canToggleTaskList:
        currentEditor?.can().chain().focus().toggleTaskList().run() ?? false,
      canToggleOrderedList:
        currentEditor?.can().chain().focus().toggleOrderedList().run() ?? false,
      canUndo: currentEditor?.can().chain().focus().undo().run() ?? false,
      canRedo: currentEditor?.can().chain().focus().redo().run() ?? false,
    }),
  }) ?? {
    blockType: "paragraph" as BlockType,
    isBoldActive: false,
    isItalicActive: false,
    isCodeActive: false,
    isBulletListActive: false,
    isTaskListActive: false,
    isOrderedListActive: false,
    isLinkActive: false,
    canToggleBold: false,
    canToggleItalic: false,
    canToggleCode: false,
    canToggleBulletList: false,
    canToggleTaskList: false,
    canToggleOrderedList: false,
    canUndo: false,
    canRedo: false,
  };

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
      .setMark("link", { href: next, dataMarkdownSrc: next })
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
      ? "inline-flex items-center gap-0.5 rounded-lg"
      : "inline-flex items-center gap-0.5 rounded-2xl border border-slate-200 bg-slate-50/80 p-1 shadow-sm";
  const toolbarClass = cn(
    "min-h-8",
    isDocumentToolbar
      ? "flex items-center gap-1 whitespace-nowrap"
      : "mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200/80 pb-4",
  );
  const selectTriggerClass = cn(
    "font-medium text-slate-700",
    isDocumentToolbar
      ? "h-6 min-w-[7.5rem] rounded-md border border-transparent bg-transparent px-2 text-xs hover:bg-slate-100 focus-visible:border-slate-300 focus-visible:ring-slate-300/50"
      : "min-w-40 rounded-xl border-transparent bg-transparent px-3 hover:border-slate-300 hover:bg-white focus-visible:border-sky-400 focus-visible:ring-sky-300/50",
  );
  const overflowActionClass =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100";
  const activeBlockTypeOption = getBlockTypeOption(toolbarState.blockType);
  const ActiveBlockTypeIcon = activeBlockTypeOption.icon;

  return (
    <>
      <div
        className={toolbarClass}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={sectionClass}>
          <Select
            value={toolbarState.blockType}
            onValueChange={(value) => handleBlockChange(value as BlockType)}
          >
            <SelectTrigger
              aria-label="Block type"
              className={selectTriggerClass}
            >
              <SelectValue>
                <span className="flex items-center gap-2">
                  <ActiveBlockTypeIcon size={15} className="text-slate-500" />
                  <span>{activeBlockTypeOption.label}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="start" className="rounded-2xl">
              {BLOCK_TYPE_OPTIONS.map((option) => {
                const OptionIcon = option.icon;

                return (
                  <SelectItem key={option.value} value={option.value}>
                    <OptionIcon size={15} className="text-slate-500" />
                    <span>{option.label}</span>
                  </SelectItem>
                );
              })}
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
            active={toolbarState.isBoldActive}
            disabled={!toolbarState.canToggleBold}
            label="Bold"
            onClick={() => editor.chain().focus().toggleBold().run()}
            icon={<Bold size={16} />}
            variant={variant}
          />
          <ToolbarButton
            active={toolbarState.isItalicActive}
            disabled={!toolbarState.canToggleItalic}
            label="Italic"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            icon={<Italic size={16} />}
            variant={variant}
          />
          {!isDocumentToolbar ? (
            <ToolbarButton
              active={toolbarState.isCodeActive}
              disabled={!toolbarState.canToggleCode}
              label="Inline code"
              onClick={() => editor.chain().focus().toggleCode().run()}
              icon={<Code2 size={16} />}
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
        <div className={sectionClass} aria-label="Lists" role="group">
          <ToolbarButton
            active={toolbarState.isBulletListActive}
            disabled={!toolbarState.canToggleBulletList}
            label="Bulleted list"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            icon={<List size={16} />}
            variant={variant}
          />
          {!isDocumentToolbar ? (
            <ToolbarButton
              active={toolbarState.isTaskListActive}
              disabled={!toolbarState.canToggleTaskList}
              label="Task list"
              onClick={() => editor.chain().focus().toggleTaskList().run()}
              icon={<CheckSquare size={16} />}
              variant={variant}
            />
          ) : null}
          {!isDocumentToolbar ? (
            <ToolbarButton
              active={toolbarState.isOrderedListActive}
              disabled={!toolbarState.canToggleOrderedList}
              label="Numbered list"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              icon={<ListOrdered size={16} />}
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
            active={toolbarState.isLinkActive}
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
        {!isDocumentToolbar ? (
          <div className={sectionClass} aria-label="History" role="group">
            <ToolbarButton
              label="Undo"
              disabled={!toolbarState.canUndo}
              onClick={() => editor.chain().focus().undo().run()}
              icon={<Undo2 size={16} />}
              variant={variant}
            />
            <ToolbarButton
              label="Redo"
              disabled={!toolbarState.canRedo}
              onClick={() => editor.chain().focus().redo().run()}
              icon={<Redo2 size={16} />}
              variant={variant}
            />
          </div>
        ) : null}
        {isDocumentToolbar ? (
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="rounded-md border border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900"
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
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                <ListOrdered size={16} />
                <span>Numbered list</span>
              </button>
              <button
                type="button"
                className={overflowActionClass}
                onClick={() => editor.chain().focus().toggleCode().run()}
              >
                <Code2 size={16} />
                <span>Inline code</span>
              </button>
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
              <button
                type="button"
                className={overflowActionClass}
                onClick={() => editor.chain().focus().undo().run()}
              >
                <Undo2 size={16} />
                <span>Undo</span>
              </button>
              <button
                type="button"
                className={overflowActionClass}
                onClick={() => editor.chain().focus().redo().run()}
              >
                <Redo2 size={16} />
                <span>Redo</span>
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
