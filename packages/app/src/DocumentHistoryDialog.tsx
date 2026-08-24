import { AlertTriangle, History, Undo2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { ScrollArea } from "./components/ui/scroll-area";
import { cn } from "./lib/utils";
import { MarkdownCodeEditor } from "./MarkdownCodeEditor";
import type {
  DocumentHistory,
  SnapshotSummary,
  StorageBackend,
} from "./storage";

/** One line per history decision; the e2e suite waits on these. */
export function logHistoryEvent(
  event: string,
  detail?: Record<string, unknown>,
): void {
  console.info(
    detail
      ? `[roughdraft:history] ${event} ${JSON.stringify(detail)}`
      : `[roughdraft:history] ${event}`,
  );
}

/**
 * Whether restoring can go ahead, and if not, why. Restore is a forward save,
 * so it needs a destination that will accept one.
 */
export type RestoreAvailability =
  | "ready"
  | "blocked-by-draft-offer"
  | "needs-overwrite";

const restoreBlockedCopy: Record<
  Exclude<RestoreAvailability, "ready">,
  string
> = {
  "blocked-by-draft-offer":
    "Answer the unsent-draft offer first. Restoring now would decide that question for you.",
  "needs-overwrite":
    "This file changed on disk, so a plain restore would be refused. Overwriting is undoable: the bytes it replaces are snapshotted first.",
};

const triggerLabels: Record<SnapshotSummary["trigger"], string> = {
  save: "save",
  review: "review",
  replaced: "replaced",
  hook: "hook",
};

export function formatSnapshotBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatSnapshotAge(createdAt: string, now: number): string {
  const elapsedMs = now - new Date(createdAt).getTime();
  if (!Number.isFinite(elapsedMs)) return "";

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatSnapshotTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString();
}

type Listing =
  | { status: "loading" }
  | { status: "ready"; history: DocumentHistory }
  | { status: "error" };

type Viewing =
  | { status: "loading"; id: string }
  | { status: "ready"; id: string; content: string }
  | { status: "error"; id: string };

interface DocumentHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backend: StorageBackend;
  documentPath: string;
  documentFilenameLabel: string;
  restoreAvailability: RestoreAvailability;
  onRestore: (restore: SnapshotRestore) => void | Promise<void>;
}

/**
 * `overwrite` is the escape from a destination that will not accept a plain
 * forward save: it writes without a version rather than giving up.
 */
export interface SnapshotRestore {
  content: string;
  id: string;
  overwrite: boolean;
}

export function DocumentHistoryDialog({
  open,
  onOpenChange,
  backend,
  documentPath,
  documentFilenameLabel,
  restoreAvailability,
  onRestore,
}: DocumentHistoryDialogProps) {
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [viewing, setViewing] = useState<Viewing | null>(null);

  // Lazily, and again on every open: the history grows with every save, so a
  // list fetched once would go stale in the background.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setListing({ status: "loading" });
    setViewing(null);
    logHistoryEvent("opened", { path: documentPath });

    void (async () => {
      try {
        const history = await backend.listSnapshots?.(documentPath);
        if (cancelled || !history) return;
        setListing({ status: "ready", history });
        logHistoryEvent("listed", {
          count: history.snapshots.length,
          unreadable: history.unreadable,
        });
      } catch (error) {
        if (cancelled) return;
        setListing({ status: "error" });
        logHistoryEvent("list-failed", { reason: String(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [backend, documentPath, open]);

  const selectSnapshot = useCallback(
    (id: string) => {
      let cancelled = false;
      setViewing({ status: "loading", id });

      void (async () => {
        try {
          const content = await backend.getSnapshot?.(documentPath, id);
          if (cancelled || content === undefined) return;
          setViewing({ status: "ready", id, content });
          logHistoryEvent("viewed", { id });
        } catch (error) {
          if (cancelled) return;
          setViewing({ status: "error", id });
          logHistoryEvent("view-failed", { id, reason: String(error) });
        }
      })();

      return () => {
        cancelled = true;
      };
    },
    [backend, documentPath],
  );

  const viewedContent = viewing?.status === "ready" ? viewing : null;
  const now = Date.now();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="document-history-dialog"
        className="flex h-[min(44rem,calc(100vh-4rem))] max-w-[min(64rem,calc(100vw-2rem))] flex-col gap-4"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="size-4" aria-hidden="true" />
            History of {documentFilenameLabel}
          </DialogTitle>
          <DialogDescription>
            Every version Roughdraft wrote, newest first. Snapshots are shown as
            raw Markdown, so review markers appear exactly as they were stored.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-2">
            {listing.status === "ready" && listing.history.unreadable > 0 ? (
              <div
                data-testid="document-history-unreadable"
                className="flex items-start gap-2 rounded-[7px] border border-amber-300 bg-amber-50 px-2 py-1.5 text-[0.7rem] leading-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
              >
                <AlertTriangle
                  className="mt-px size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  {listing.history.unreadable} snapshot
                  {listing.history.unreadable === 1 ? "" : "s"} could not be
                  listed. The files are still on disk beside the document.
                </span>
              </div>
            ) : null}

            {listing.status === "loading" ? (
              <p
                data-testid="document-history-loading"
                className="px-1 text-xs text-stone-500 dark:text-slate-400"
              >
                Loading history…
              </p>
            ) : null}

            {listing.status === "error" ? (
              <p
                data-testid="document-history-error"
                className="px-1 text-xs text-red-700 dark:text-red-300"
              >
                Roughdraft could not read this document's history.
              </p>
            ) : null}

            {listing.status === "ready" &&
            listing.history.snapshots.length === 0 ? (
              <p
                data-testid="document-history-empty"
                className="px-1 text-xs text-stone-500 dark:text-slate-400"
              >
                No versions yet. Roughdraft snapshots this file every time it
                writes to it.
              </p>
            ) : null}

            {listing.status === "ready" &&
            listing.history.snapshots.length > 0 ? (
              <ScrollArea
                data-testid="document-history-list"
                className="min-h-0 flex-1 rounded-[7px] border border-[#DCD6CC] dark:border-slate-700"
              >
                <div className="flex flex-col p-1">
                  {listing.history.snapshots.map((snapshot) => (
                    <button
                      key={snapshot.id}
                      type="button"
                      data-testid="document-history-entry"
                      data-snapshot-id={snapshot.id}
                      aria-pressed={viewing?.id === snapshot.id}
                      onClick={() => selectSnapshot(snapshot.id)}
                      className={cn(
                        "flex flex-col gap-1 rounded-[6px] px-2 py-1.5 text-left outline-none transition hover:bg-[#EEE9E1] focus-visible:bg-[#EEE9E1] dark:hover:bg-slate-700 dark:focus-visible:bg-slate-700",
                        viewing?.id === snapshot.id &&
                          "bg-[#EEE9E1] dark:bg-slate-700",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="rounded-full bg-stone-200 px-1.5 py-px text-[0.62rem] font-medium tracking-[0.02em] text-stone-700 dark:bg-slate-600 dark:text-slate-100">
                          {triggerLabels[snapshot.trigger]}
                        </span>
                        <span className="text-[0.72rem] font-medium text-stone-700 dark:text-slate-200">
                          {formatSnapshotAge(snapshot.createdAt, now)}
                        </span>
                      </span>
                      <span className="text-[0.66rem] leading-4 text-stone-500 dark:text-slate-400">
                        {formatSnapshotTimestamp(snapshot.createdAt)} ·{" "}
                        {formatSnapshotBytes(snapshot.bytes)}
                      </span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <div className="min-h-0 flex-1 overflow-auto rounded-[7px] border border-[#DCD6CC] p-3 dark:border-slate-700">
              {viewing === null ? (
                <p
                  data-testid="document-history-viewer-empty"
                  className="text-xs text-stone-500 dark:text-slate-400"
                >
                  Choose a version to see what it held.
                </p>
              ) : null}
              {viewing?.status === "loading" ? (
                <p className="text-xs text-stone-500 dark:text-slate-400">
                  Loading version…
                </p>
              ) : null}
              {viewing?.status === "error" ? (
                <p
                  data-testid="document-history-viewer-error"
                  className="text-xs text-red-700 dark:text-red-300"
                >
                  Roughdraft could not read that version.
                </p>
              ) : null}
              {viewedContent ? (
                <MarkdownCodeEditor
                  key={viewedContent.id}
                  value={viewedContent.content}
                  onChange={() => {}}
                  readOnly
                  testId="document-history-viewer"
                  className="text-xs"
                />
              ) : null}
            </div>

            {restoreAvailability !== "ready" ? (
              <p
                data-testid="document-history-restore-blocked"
                className="text-[0.7rem] leading-4 text-stone-600 dark:text-slate-300"
              >
                {restoreBlockedCopy[restoreAvailability]}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Button
                type="button"
                data-testid="document-history-restore"
                variant="ghost"
                size="sm"
                disabled={!viewedContent || restoreAvailability !== "ready"}
                className="h-8 rounded-[7px] bg-slate-900 px-2 text-xs text-white hover:bg-slate-800 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
                onClick={() => {
                  if (!viewedContent) return;
                  void onRestore({
                    content: viewedContent.content,
                    id: viewedContent.id,
                    overwrite: false,
                  });
                  onOpenChange(false);
                }}
              >
                <Undo2 className="size-3.5" />
                Restore this version
              </Button>
              {restoreAvailability === "needs-overwrite" ? (
                <Button
                  type="button"
                  data-testid="document-history-restore-overwrite"
                  variant="ghost"
                  size="sm"
                  disabled={!viewedContent}
                  className="h-8 rounded-[7px] bg-amber-900 px-2 text-xs text-white hover:bg-amber-800 disabled:opacity-40 dark:bg-amber-600 dark:hover:bg-amber-500"
                  onClick={() => {
                    if (!viewedContent) return;
                    void onRestore({
                      content: viewedContent.content,
                      id: viewedContent.id,
                      overwrite: true,
                    });
                    onOpenChange(false);
                  }}
                >
                  <Upload className="size-3.5" />
                  Restore and overwrite
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
