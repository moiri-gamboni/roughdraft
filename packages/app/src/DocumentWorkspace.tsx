import { CodeXml, Eye, RefreshCcw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { DocumentEditorViewMode } from "./app-navigation";
import { Button } from "./components/ui/button";
import { criticMarkdownHasReviewRail } from "./critic-markup";
import { cn } from "./lib/utils";
import { PageCard, type DocumentInteractionMode } from "./PageCard";
import type { Page, StorageBackend } from "./storage";

type SaveState = "idle" | "saving" | "error";
type DiskChangeState = "clean" | "changed" | "conflict";

interface DocumentWorkspaceProps {
  documentPage: Page | null;
  activeDocumentPath: string | null;
  documentFilenameLabel: string;
  documentEditorViewMode: DocumentEditorViewMode;
  onDocumentEditorViewModeChange: (mode: DocumentEditorViewMode) => void;
  onSaveDocument: (id: string, content: string) => Promise<void>;
  onDocumentSaveStateChange: (state: SaveState) => void;
  onDocumentDirtyStateChange: (isDirty: boolean) => void;
  onDocumentLocalContentChange: (markdown: string) => void;
  documentDiskChangeState: DiskChangeState;
  documentForceResetKey: string | null;
  onReloadDocumentFromDisk: () => void | Promise<void>;
  onOverwriteDocumentOnDisk: () => void | Promise<void>;
  backend: StorageBackend | null;
}

export function DocumentWorkspace({
  documentPage,
  activeDocumentPath,
  documentFilenameLabel,
  documentEditorViewMode,
  onDocumentEditorViewModeChange,
  onSaveDocument,
  onDocumentSaveStateChange,
  onDocumentDirtyStateChange,
  onDocumentLocalContentChange,
  documentDiskChangeState,
  documentForceResetKey,
  onReloadDocumentFromDisk,
  onOverwriteDocumentOnDisk,
  backend,
}: DocumentWorkspaceProps) {
  const [documentInteractionMode, setDocumentInteractionMode] =
    useState<DocumentInteractionMode>("editing");
  const [documentHasComments, setDocumentHasComments] = useState(
    () =>
      !!documentPage?.content &&
      criticMarkdownHasReviewRail(documentPage.content),
  );

  useEffect(() => {
    setDocumentHasComments(
      !!documentPage?.content &&
        criticMarkdownHasReviewRail(documentPage.content),
    );
  }, [documentPage]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-10 pb-8 sm:px-12">
      <div className="mx-auto min-h-full max-w-[1080px]">
        {documentPage ? (
          <div
            className={cn(
              "document-page-header mb-2 flex w-full max-w-[46.5rem] flex-wrap items-center gap-1.5 px-1 text-[0.62rem] font-medium tracking-[0.01em] text-stone-400",
              !documentHasComments && "document-page-header-no-comments",
            )}
          >
            <button
              type="button"
              className="grid h-[1.25rem] shrink-0 grid-cols-2 rounded-[999px] bg-[#DED8CE] px-[2px] py-[2px] shadow-[inset_0_1px_0_rgba(255,251,245,0.72)]"
              onClick={() =>
                onDocumentEditorViewModeChange(
                  documentEditorViewMode === "rich-text" ? "code" : "rich-text",
                )
              }
              aria-label={
                documentEditorViewMode === "rich-text"
                  ? "Switch to code view"
                  : "Switch to rich text view"
              }
              title={
                documentEditorViewMode === "rich-text"
                  ? "Switch to code view"
                  : "Switch to rich text view"
              }
            >
              <span
                className={`flex h-[1rem] w-[1.375rem] items-center justify-center rounded-full transition ${
                  documentEditorViewMode === "rich-text"
                    ? "bg-[#FFFDFC] text-stone-700 shadow-[0_1px_2px_rgba(41,37,36,0.12)]"
                    : "text-stone-500"
                }`}
              >
                <Eye className="size-[0.75rem]" />
              </span>
              <span
                className={`flex h-[1rem] w-[1.375rem] items-center justify-center rounded-full transition ${
                  documentEditorViewMode === "code"
                    ? "bg-[#FFFDFC] text-stone-700 shadow-[0_1px_2px_rgba(41,37,36,0.12)]"
                    : "text-stone-500"
                }`}
              >
                <CodeXml className="size-[0.75rem]" />
              </span>
            </button>
            <div
              className="min-w-0 truncate font-mono text-[0.7rem] tracking-[0.01em] text-stone-400"
              title={documentFilenameLabel}
            >
              {documentFilenameLabel}
            </div>
            <label className="ml-auto flex shrink-0 items-center gap-1.5 rounded-[8px] border border-[#DFDFDC] bg-[#FFFDFC] px-2 py-1 text-[0.68rem] text-stone-600">
              <span>Mode</span>
              <select
                value={documentInteractionMode}
                className="bg-transparent text-[0.68rem] font-medium text-stone-800 outline-none"
                aria-label="Document mode"
                onChange={(event) =>
                  setDocumentInteractionMode(
                    event.target.value as DocumentInteractionMode,
                  )
                }
              >
                <option value="viewing">Viewing</option>
                <option value="suggesting">Suggesting</option>
                <option value="editing">Editing</option>
              </select>
            </label>
            {documentDiskChangeState !== "clean" ? (
              <div className="flex max-w-full shrink-0 items-center gap-1.5 rounded-[8px] border border-amber-200 bg-amber-50 px-2 py-1 text-[0.68rem] text-amber-900">
                <span className="whitespace-nowrap">
                  {documentDiskChangeState === "conflict"
                    ? "Save conflict"
                    : "Changed on disk"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded-[7px] px-1.5 text-[0.68rem] text-amber-950 hover:bg-amber-100"
                  onClick={() => void onReloadDocumentFromDisk()}
                >
                  <RefreshCcw className="size-3" />
                  Reload
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded-[7px] px-1.5 text-[0.68rem] text-amber-950 hover:bg-amber-100"
                  onClick={() => void onOverwriteDocumentOnDisk()}
                >
                  <Upload className="size-3" />
                  Overwrite
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {documentPage ? (
          backend ? (
            <PageCard
              key={`${documentPage.id}:${activeDocumentPath ?? ""}`}
              page={documentPage}
              selected
              onSave={onSaveDocument}
              onSaveStateChange={onDocumentSaveStateChange}
              editorViewMode={documentEditorViewMode}
              interactionMode={documentInteractionMode}
              backend={backend}
              onCommentRailPresenceChange={setDocumentHasComments}
              onDirtyStateChange={onDocumentDirtyStateChange}
              onLocalContentChange={onDocumentLocalContentChange}
              saveBlocked={documentDiskChangeState !== "clean"}
              forceResetKey={documentForceResetKey}
            />
          ) : null
        ) : (
          <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500">
            Open a markdown file to begin.
          </div>
        )}
      </div>
    </div>
  );
}
