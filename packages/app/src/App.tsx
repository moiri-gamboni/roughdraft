import {
  ArrowLeft,
  Braces,
  ExternalLink,
  FileText,
  MessageSquare,
  PencilLine,
  ServerOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildLocationForDocumentEditorViewMode,
  type DocumentEditorViewMode,
  formatWorkspacePathForDisplay,
  getDocumentEditorViewModeFromLocation,
  getPathLeaf,
  getRequestedPathState,
  joinPath,
  PREVIEW_PATH,
  ROUGHDRAFT_FLAVORED_MARKDOWN_PATH,
  syncRequestedPathInUrl,
} from "./app-navigation";
import { Button } from "./components/ui/button";
import { Dashboard } from "./Dashboard";
import { logHistoryEvent, type SnapshotRestore } from "./DocumentHistoryDialog";
import {
  type DocumentHistoryWiring,
  DocumentWorkspace,
  type DraftRestoreOffer,
} from "./DocumentWorkspace";
import { BackendUnavailableError, detectBackend } from "./detect-backend";
import { logDraftEvent } from "./draft-store";
import type { DocumentSaveState } from "./PageCard";
import { PreviewBackend } from "./preview-backend";
import {
  type DraftMode,
  nextRetryDelayMs,
  resolveConflict,
  resolveDiskChange,
  resolveRestore,
} from "./save-recovery";
import {
  type CompleteReviewOptions,
  type ContentRestore,
  type DocumentDiskChangeState,
  type LocalContentOrigin,
  MarkdownFileConflictError,
  type Page,
  type StorageBackend,
} from "./storage";
import { UpdateNotice } from "./UpdateNotice";
import { fetchUpdateStatus, type UpdateStatus } from "./update-status";
import { useDraftPersistence } from "./useDraftPersistence";

/**
 * The page a backend that returns nothing on save leaves us with: the content
 * we just sent, titled from its first heading.
 */
function pageFromSavedContent(
  id: string,
  content: string,
  version: string | undefined,
): Page {
  const firstLine = content.split("\n")[0] || "";
  const fallbackTitle = id.split("/").at(-1) || id;
  return {
    id,
    content,
    title: firstLine.replace(/^#*\s*/, "") || fallbackTitle,
    version,
  };
}

export function shouldWarnBeforeUnload({
  activeDocumentPath,
  isDirty,
  saveState,
  diskChangeState,
}: {
  activeDocumentPath: string | null;
  isDirty: boolean;
  saveState: DocumentSaveState;
  diskChangeState: DocumentDiskChangeState;
}) {
  return (
    !!activeDocumentPath &&
    (isDirty ||
      saveState === "saving" ||
      saveState === "unsaved" ||
      saveState === "error" ||
      diskChangeState !== "clean")
  );
}

/**
 * How many of our own file versions to recognise when the watcher echoes them
 * back. One poll interval can hide several saves, so the newest alone is not
 * enough, and nothing older than a handful of writes is ever reported.
 */
const SAVED_VERSION_MEMORY = 8;
const PREVIEW_DOCUMENT_PATH = "preview.md";
const PREVIEW_INITIAL_MARKDOWN = [
  "# Live Preview",
  "",
  "This draft only lives in memory. Edit it freely, switch between rich text and code view, and reload the page when you want a clean copy.",
  "",
  "- Comments and suggested changes use Roughdraft flavored Markdown.",
  "- Autosave updates the in-memory document, not disk or browser storage.",
  "",
  "{==Select this sentence==}{>>Try replying to this comment or suggesting a replacement.<<}{#preview-comment}",
  "",
  "---",
  "comments:",
  "  preview-comment:",
  "    by: Roughdraft",
  '    at: "2026-04-28T12:00:00.000Z"',
  "",
].join("\n");
const ROUGHDRAFT_MARKDOWN_SYNTAX = [
  {
    label: "Comment",
    syntax: "{==selected text==}{>>Comment text<<}{#c1}",
    description:
      "Highlights the reviewed text and attaches a margin comment to it.",
  },
  {
    label: "Reply",
    syntax:
      'comments:\n  c2:\n    body: I can make that edit.\n    by: AI\n    at: "2026-04-28T12:01:00.000Z"\n    re: c1',
    description:
      "Adds a threaded reply in YAML endmatter by pointing `re` at the parent id.",
  },
  {
    label: "Insertion",
    syntax: "{++new text++}{#s1}",
    description: "Suggests text to add without applying it silently.",
  },
  {
    label: "Deletion",
    syntax: "{--old text--}{#s2}",
    description: "Suggests removing text while keeping the original visible.",
  },
  {
    label: "Substitution",
    syntax: "{~~old text~>new text~~}{#s3}",
    description: "Suggests replacing one span with another.",
  },
] as const;
const ROUGHDRAFT_MARKDOWN_REFERENCES = [
  {
    title: "Official RFM spec",
    href: "/spec/roughdraft-flavored-markdown.md",
    description:
      "The normative syntax, metadata, round-trip, and JSON review-index contract for Roughdraft Flavored Markdown.",
  },
  {
    title: "CriticMarkup",
    href: "https://criticmarkup.com/",
    description:
      "The plain-text review syntax Roughdraft builds on for comments, highlights, insertions, deletions, and substitutions.",
  },
  {
    title: "Notion-flavored Markdown",
    href: "https://developers.notion.com/guides/data-apis/enhanced-markdown",
    description:
      "The product precedent for rich document affordances that still serialize to inspectable Markdown-like text.",
  },
] as const;
const ROUGHDRAFT_MARKDOWN_CONTRACT = [
  {
    title: "Metadata",
    description:
      "Compact inline references keep review anchors portable, while YAML endmatter stores authors, timestamps, statuses, and reply links.",
  },
  {
    title: "Anchors",
    description:
      "Comments attach to highlighted text when a highlight precedes the comment. A bare comment is allowed when the feedback applies to the surrounding paragraph or document.",
  },
  {
    title: "Pending changes",
    description:
      "Insertions, deletions, and substitutions stay visible until accepted or rejected. Roughdraft should not silently collapse suggested edits into normal prose.",
  },
  {
    title: "Round trips",
    description:
      "Normal Markdown should remain normal Markdown. Frontmatter, tables, task lists, links, image paths, code spans, and fenced code blocks should survive review edits with minimal serialization churn.",
  },
] as const;
const ROUGHDRAFT_MARKDOWN_EXTENSION_DETAILS = [
  {
    title: "YAML metadata",
    body: "Roughdraft stores ids inline as compact references such as {>>Looks right.<<}{#c1}, while authors, timestamps, and reply links live in final YAML endmatter.",
  },
  {
    title: "Threaded comments",
    body: "A comment can stand alone, attach to a highlighted span, or reply to another comment by setting `re` to the parent comment id.",
  },
  {
    title: "Reviewable suggestions",
    body: "Insertions, deletions, and substitutions can carry their own ids, then comments can reply to those ids to discuss a proposed edit before accepting it.",
  },
  {
    title: "Literal examples stay literal",
    body: "CriticMarkup inside inline code and fenced code blocks is preserved as example text instead of becoming live review feedback.",
  },
] as const;
export function RoughdraftFlavoredMarkdownPage() {
  return (
    <main className="min-h-screen bg-[#FCFCFC] dark:bg-background px-6 py-8 text-slate-950 dark:text-slate-50">
      <div className="mx-auto max-w-5xl">
        <Button
          className="h-9 gap-2 px-3 text-sm"
          nativeButton={false}
          variant="ghost"
          render={
            <a href="/">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to Roughdraft
            </a>
          }
        />

        <section className="mt-12 max-w-3xl">
          <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
            Roughdraft flavored Markdown
          </p>
          <h1 className="mt-3 text-4xl leading-tight font-semibold text-balance text-slate-950 dark:text-slate-50 sm:text-5xl">
            Markdown with review comments and suggested changes
          </h1>
          <p className="mt-5 text-lg leading-8 text-stone-600 dark:text-stone-400">
            Roughdraft Flavored Markdown is regular Markdown plus portable
            review markup. It builds on{" "}
            <a
              className="font-medium text-slate-950 dark:text-slate-50 underline decoration-slate-300 dark:decoration-slate-600 underline-offset-4 hover:decoration-slate-950 dark:hover:decoration-slate-50"
              href="https://criticmarkup.com/"
              target="_blank"
              rel="noreferrer"
            >
              CriticMarkup
            </a>{" "}
            syntax and the text-first model behind{" "}
            <a
              className="font-medium text-slate-950 dark:text-slate-50 underline decoration-slate-300 dark:decoration-slate-600 underline-offset-4 hover:decoration-slate-950 dark:hover:decoration-slate-50"
              href="https://developers.notion.com/guides/data-apis/enhanced-markdown"
              target="_blank"
              rel="noreferrer"
            >
              Notion-flavored Markdown
            </a>
            {", "}
            so a person and a coding agent can review the same file without a
            sidecar database or hosted document format.
          </p>
        </section>

        <section className="mt-10 grid gap-3 md:grid-cols-2">
          {ROUGHDRAFT_MARKDOWN_REFERENCES.map(
            ({ description, href, title }) => (
              <a
                className="group rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.3)] transition hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)] dark:hover:shadow-[0_14px_34px_rgba(0,0,0,0.4)]"
                href={href}
                key={title}
                target="_blank"
                rel="noreferrer"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                    {title}
                  </h2>
                  <ExternalLink
                    className="size-4 text-stone-400 dark:text-stone-500 transition group-hover:text-stone-700 dark:group-hover:text-stone-300"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                  {description}
                </p>
              </a>
            ),
          )}
        </section>

        <section className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Plain text first",
              description:
                "The saved file remains readable in editors, terminals, git diffs, and agent context windows.",
              icon: FileText,
            },
            {
              title: "Threaded review",
              description:
                "Comments carry document-local ids, authors, timestamps, and reply links for back-and-forth discussion.",
              icon: MessageSquare,
            },
            {
              title: "Explicit edits",
              description:
                "Suggestions are represented as insertions, deletions, and substitutions until someone accepts them.",
              icon: PencilLine,
            },
          ].map(({ description, icon: Icon, title }) => (
            <div
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
              key={title}
            >
              <div className="flex size-10 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-stone-700 dark:text-stone-300">
                <Icon className="size-4" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-slate-950 dark:text-slate-50">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                {description}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-14 grid gap-8 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
              Format contract
            </p>
            <h2 className="mt-3 text-3xl leading-tight font-semibold text-slate-950 dark:text-slate-50">
              Review data lives where agents can inspect it
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
              Roughdraft treats the Markdown file as the durable source of
              truth. The rich editor can add affordances around the text, but
              the saved representation needs to be readable in a terminal,
              reviewable in git, and understandable to another agent without
              loading Roughdraft.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {ROUGHDRAFT_MARKDOWN_CONTRACT.map(({ description, title }) => (
              <div
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
                key={title}
              >
                <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
              Syntax
            </p>
            <h2 className="mt-3 text-3xl leading-tight font-semibold text-slate-950 dark:text-slate-50">
              The review layer is small on purpose
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
              Roughdraft uses CriticMarkup-compatible markers for comments,
              highlights, insertions, deletions, and substitutions. Roughdraft
              extends those markers with document-local metadata so review
              threads, authorship, timestamps, and suggested-change discussions
              can survive in the Markdown file itself.
            </p>
          </div>

          <div className="grid gap-3">
            {ROUGHDRAFT_MARKDOWN_SYNTAX.map(
              ({ description, label, syntax }) => (
                <div
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
                  key={label}
                >
                  <div className="flex items-center gap-2">
                    <Braces
                      className="size-4 text-stone-500 dark:text-stone-400"
                      aria-hidden="true"
                    />
                    <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                      {label}
                    </h3>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                    {description}
                  </p>
                  <code className="mt-3 block overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700 bg-[#FAFAF8] dark:bg-slate-800 px-3 py-2 text-xs text-stone-700 dark:text-stone-300">
                    {syntax}
                  </code>
                </div>
              ),
            )}
          </div>
        </section>

        <section className="mt-14 grid gap-8 border-t border-slate-200 dark:border-slate-700 pt-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
              Roughdraft extensions
            </p>
            <h2 className="mt-3 text-3xl leading-tight font-semibold text-slate-950 dark:text-slate-50">
              The extra fields make review state portable
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
              Standard CriticMarkup captures the visible annotation. Roughdraft
              keeps the same readable markers, adds compact inline references,
              and stores review metadata in final YAML endmatter.
            </p>
          </div>

          <div className="grid gap-3">
            {ROUGHDRAFT_MARKDOWN_EXTENSION_DETAILS.map(({ body, title }) => (
              <div
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
                key={title}
              >
                <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 max-w-3xl border-t border-slate-200 dark:border-slate-700 pt-10">
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-slate-50">
            What this is not
          </h2>
          <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
            It is not a new replacement for Markdown, and it is not a hidden app
            state format. If Roughdraft adds review information, that
            information should stay visible, portable, and understandable in the
            Markdown file itself.
          </p>
        </section>
      </div>
    </main>
  );
}

function createPreviewPage(): Page {
  return {
    id: "preview",
    title: "Live Preview",
    content: PREVIEW_INITIAL_MARKDOWN,
    version: "memory:initial",
  };
}

export function PreviewPage() {
  const [backend] = useState(() => new PreviewBackend(createPreviewPage()));
  const [previewPage, setPreviewPage] = useState<Page>(() =>
    backend.getCurrentPage(),
  );
  const [previewForceResetKey, setPreviewForceResetKey] = useState<
    string | null
  >(null);
  const [editorViewMode, setEditorViewMode] = useState<DocumentEditorViewMode>(
    () => getDocumentEditorViewModeFromLocation("rich-text"),
  );
  const [, setSaveState] = useState<DocumentSaveState>("saved");

  useEffect(() => () => backend.dispose(), [backend]);

  useEffect(() => {
    document.title = "Roughdraft Preview";
  }, []);

  const handleSaveDocument = useCallback(
    async (_id: string, content: string) => {
      const savedPage = await backend.saveMarkdownFile(
        PREVIEW_DOCUMENT_PATH,
        content,
      );
      setPreviewPage(savedPage);
    },
    [backend],
  );

  const handleResetPreview = useCallback(async () => {
    const freshBackendPage = createPreviewPage();
    const savedPage = await backend.saveMarkdownFile(
      PREVIEW_DOCUMENT_PATH,
      freshBackendPage.content,
    );
    setPreviewPage(savedPage);
    setPreviewForceResetKey(`preview-reset:${Date.now()}`);
  }, [backend]);

  const handleCompletePreviewReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      return backend.completeReview
        ? backend.completeReview(PREVIEW_DOCUMENT_PATH, options)
        : { delivered: false };
    },
    [backend],
  );

  return (
    <main className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-[#FCFCFC] dark:bg-background text-slate-950 dark:text-slate-50">
      <DocumentWorkspace
        documentPage={previewPage}
        activeDocumentPath={PREVIEW_DOCUMENT_PATH}
        documentCopyPath={PREVIEW_DOCUMENT_PATH}
        documentFilenameLabel={PREVIEW_DOCUMENT_PATH}
        documentEditorViewMode={editorViewMode}
        onDocumentEditorViewModeChange={setEditorViewMode}
        onSaveDocument={handleSaveDocument}
        onDocumentSaveStateChange={setSaveState}
        onDocumentDirtyStateChange={() => {}}
        onDocumentLocalContentChange={() => {}}
        documentDiskChangeState="clean"
        documentForceResetKey={previewForceResetKey}
        onReloadDocumentFromDisk={handleResetPreview}
        onKeepEditingWithoutAutosave={() => {}}
        onOverwriteDocumentOnDisk={() => {}}
        onCompleteReview={handleCompletePreviewReview}
        backend={backend}
      />
    </main>
  );
}

export const MAX_BOOT_RETRIES = 5;

/**
 * The boot could not reach whatever holds this document. Says so, says the
 * unsent work is safe, and keeps trying — the old generic "could not open that
 * markdown file" was a dead end for a condition that usually clears itself.
 *
 * The ladder runs out after ~30s, so the copy has to stop promising a retry
 * that is no longer coming and name the button as the way forward.
 */
function BackendUnavailableNotice({
  hasUnsentDraft,
  retriesExhausted,
  onRetry,
}: {
  hasUnsentDraft: boolean;
  retriesExhausted: boolean;
  onRetry: () => void;
}) {
  const draftClause = hasUnsentDraft
    ? "Your unsent edits for this file are saved in this browser. "
    : "";
  const retryClause = retriesExhausted
    ? "Roughdraft has stopped retrying. Check that the local server is running, then choose Try again."
    : "Roughdraft keeps trying in the background. Check that the local server is still running.";
  return (
    <main className="flex h-screen items-center justify-center bg-[#FCFCFC] px-6 dark:bg-background">
      <div
        data-testid="backend-unavailable-notice"
        role="status"
        className="flex max-w-md flex-col items-start gap-3 rounded-[8px] border border-slate-300 bg-white px-5 py-5 text-slate-900 shadow-[0_14px_40px_rgba(15,23,42,0.12)] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="flex items-start gap-2.5">
          <ServerOff
            className="mt-0.5 size-4 shrink-0 text-slate-500 dark:text-slate-400"
            aria-hidden="true"
          />
          <div>
            <div className="text-sm font-semibold leading-5">
              Roughdraft can't reach the server
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
              {draftClause}
              {retryClause}
            </p>
          </div>
        </div>
        <Button
          type="button"
          data-testid="backend-unavailable-retry"
          size="sm"
          variant="outline"
          className="self-end rounded-[7px] text-xs"
          onClick={onRetry}
        >
          Try again
        </Button>
      </div>
    </main>
  );
}

export function App() {
  const initialRequestedPathState = getRequestedPathState();
  const [requestedPathState] = useState(initialRequestedPathState);
  const isRoughdraftFlavoredMarkdownRoute =
    window.location.pathname === ROUGHDRAFT_FLAVORED_MARKDOWN_PATH;
  const isPreviewRoute = window.location.pathname === PREVIEW_PATH;
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [documentPage, setDocumentPage] = useState<Page | null>(null);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(
    initialRequestedPathState.documentPath,
  );
  const [documentSaveState, setDocumentSaveState] =
    useState<DocumentSaveState>("saved");
  const [documentDiskChangeState, setDocumentDiskChangeState] =
    useState<DocumentDiskChangeState>("clean");
  const [documentForceResetKey, setDocumentForceResetKey] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  // Content offered by the draft-restore banner, awaiting the reviewer's call.
  const [offeredDraftContent, setOfferedDraftContent] = useState<string | null>(
    null,
  );
  const [contentRestore, setContentRestore] = useState<ContentRestore | null>(
    null,
  );
  // An external write the watcher already reloaded. Not a disk-change state:
  // nothing is blocked, so it must not pause autosave or gate the handoff.
  const [externalChangeSeen, setExternalChangeSeen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [documentEditorViewMode, setDocumentEditorViewMode] = useState(() =>
    getDocumentEditorViewModeFromLocation("rich-text"),
  );
  const backendRef = useRef<StorageBackend | null>(null);
  const documentPageRef = useRef<Page | null>(null);
  const activeDocumentPathRef = useRef<string | null>(activeDocumentPath);
  const documentDirtyRef = useRef(false);
  const documentSaveStateRef = useRef<DocumentSaveState>("saved");
  const documentDraftContentRef = useRef<string | null>(null);
  const documentDiskChangeStateRef = useRef<DocumentDiskChangeState>("clean");
  const previousDiskChangeStateRef = useRef<DocumentDiskChangeState>("clean");
  const saveDraftContentRef = useRef<(content: string) => Promise<void>>(
    async () => {},
  );
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const contentRestoreRef = useRef<ContentRestore | null>(null);
  // Every version this session has written, newest last. Set synchronously on
  // save, unlike `documentPageRef`, which only catches up on the next commit —
  // the watcher can report our own write before then. Why the whole list and
  // not just the newest: `resolveDiskChange`.
  const savedVersionsRef = useRef<string[]>([]);
  /**
   * Every path that writes the document must record what it wrote, or the
   * watcher's echo of that write reads as someone else's and the reviewer gets
   * a clobber alarm over their own save.
   */
  const noteSavedVersion = useCallback((version: string | undefined) => {
    if (!version) return;
    savedVersionsRef.current = [...savedVersionsRef.current, version].slice(
      -SAVED_VERSION_MEMORY,
    );
  }, []);
  const bootRetryTimerRef = useRef<number | null>(null);
  // The reset key must be monotonic: PageCard compares it by identity, so a
  // repeat of the same reset would otherwise be a silent no-op.
  const forceResetCounterRef = useRef(0);
  const { draft: draftPersistence, retryPending: documentRetryPending } =
    useDraftPersistence({
      save: (content) => saveDraftContentRef.current(content),
      getDiskChangeState: () => documentDiskChangeStateRef.current,
    });

  backendRef.current = backend;
  documentPageRef.current = documentPage;
  activeDocumentPathRef.current = activeDocumentPath;
  documentSaveStateRef.current = documentSaveState;
  documentDiskChangeStateRef.current = documentDiskChangeState;
  contentRestoreRef.current = contentRestore;

  const applyDocumentPage = useCallback((nextDocument: Page) => {
    setDocumentPage(nextDocument);
    documentDraftContentRef.current = nextDocument.content;
  }, []);

  /**
   * Put the draft back in the editor as unsaved work and let it be delivered.
   * The state updates land in one commit, so autosave is already unblocked by
   * the time the card sees the restore and tries to send it.
   */
  const restoreDraftContent = useCallback((content: string) => {
    setOfferedDraftContent(null);
    setDocumentDiskChangeState("clean");
    setContentRestore({ content, source: "draft" });
    logDraftEvent("restored");
  }, []);

  const resolveDraftRecovery = useCallback(
    (loadedContent: string, mode: DraftMode) => {
      const record = draftPersistence.read();
      const decision = resolveRestore({
        draft: record,
        diskContent: loadedContent,
        mode,
      });
      logDraftEvent("restore-decision", { decision, mode });

      if (!record || decision === "nothing") {
        draftPersistence.discard();
        return;
      }

      if (decision === "silent") {
        restoreDraftContent(record.content);
        return;
      }

      setOfferedDraftContent(record.content);
      setDocumentDiskChangeState("draft-restore");
    },
    [draftPersistence, restoreDraftContent],
  );

  const loadDocument = useCallback(
    async (nextBackend: StorageBackend, relativePath: string) => {
      const nextDocument = await nextBackend.getMarkdownFile(relativePath);
      applyDocumentPage(nextDocument);
      setActiveDocumentPath(relativePath);
      documentDirtyRef.current = false;
      setDocumentDiskChangeState("clean");
      return nextDocument;
    },
    [applyDocumentPage],
  );

  useEffect(() => {
    let cancelled = false;

    const loadUpdateStatus = async () => {
      const nextUpdateStatus = await fetchUpdateStatus();
      if (!cancelled) {
        setUpdateStatus(nextUpdateStatus);
      }
    };

    void loadUpdateStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sourceUrl = new URL("/api/open-requests", window.location.origin);
    // A load-error tab must not claim the failing path on the server, or its
    // subscription registers a document row for a file that never opened.
    if (requestedPathState.rawPath && !loadError) {
      sourceUrl.searchParams.set("path", requestedPathState.rawPath);
    }

    const source = new EventSource(`${sourceUrl.pathname}${sourceUrl.search}`);
    const handleOpenRequest = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          url?: unknown;
        };
        if (typeof payload.url !== "string" || !payload.url.trim()) return;

        const requested = new URL(payload.url, window.location.origin);
        // Only same-origin navigations, and never a scripted scheme: the CLI
        // sends a `localhost` URL that is wrong for a tailnet viewer anyway, so
        // rebuild the target on this origin from the path it asked for.
        if (requested.protocol !== "http:" && requested.protocol !== "https:") {
          return;
        }

        const target = `${window.location.origin}${requested.pathname}${requested.search}${requested.hash}`;
        window.focus();
        if (target !== window.location.href) {
          window.location.assign(target);
        }
      } catch (error) {
        console.error("Failed to handle Roughdraft open request:", error);
      }
    };

    source.addEventListener("open-request", handleOpenRequest);

    return () => {
      source.removeEventListener("open-request", handleOpenRequest);
      source.close();
    };
  }, [requestedPathState.rawPath, loadError]);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      setLoading(true);
      setLoadError(null);
      setBackendUnavailable(false);
      setDocumentPage(null);
      // A boot resolves the restore question against the document it loads, so
      // a retry must not inherit the previous boot's answer: a leftover offer
      // or accepted restore would replay stale content over the fresh load.
      setContentRestore(null);
      setOfferedDraftContent(null);
      setExternalChangeSeen(false);

      try {
        const detectedBackend = await detectBackend();
        if (cancelled) return;

        setBackend(detectedBackend);

        if (detectedBackend.info.kind === "remote") {
          const { sessionId, originPath } = detectedBackend.info;
          // Bind the session to its origin file so a draft written under this
          // session is still findable after the CLI re-registers.
          if (sessionId && originPath) {
            draftPersistence.resolveRemoteKey(sessionId, originPath);
          }

          const documentPath = detectedBackend.info.detail || "remote.md";
          const remoteDocument = await loadDocument(
            detectedBackend,
            documentPath,
          );
          if (cancelled) return;
          resolveDraftRecovery(remoteDocument.content, "remote");
          setLoading(false);
          return;
        }

        if (!requestedPathState.rawPath) {
          setActiveDocumentPath(null);
          setLoading(false);
          return;
        }

        syncRequestedPathInUrl(requestedPathState.rawPath);

        if (
          !requestedPathState.projectPath ||
          !requestedPathState.documentPath
        ) {
          setActiveDocumentPath(null);
          setLoadError("Roughdraft now opens one .md file at a time.");
          setLoading(false);
          return;
        }

        if (detectedBackend.canManageProjects) {
          await detectedBackend.openProject(requestedPathState.projectPath);
        }

        if (cancelled) return;

        const loadedDocument = await loadDocument(
          detectedBackend,
          requestedPathState.documentPath,
        );
        if (cancelled) return;
        resolveDraftRecovery(loadedDocument.content, "local");

        setLoading(false);
      } catch (error) {
        if (cancelled) return;

        console.error("Failed to open markdown file:", error);
        setLoading(false);

        if (error instanceof BackendUnavailableError) {
          setBackendUnavailable(true);
          if (bootAttempt < MAX_BOOT_RETRIES) {
            bootRetryTimerRef.current = window.setTimeout(
              () => setBootAttempt((attempt) => attempt + 1),
              nextRetryDelayMs(bootAttempt + 1),
            );
          }
          return;
        }

        setActiveDocumentPath(null);
        setLoadError("Could not open that markdown file.");
      }
    };

    void initialize();

    return () => {
      cancelled = true;
      if (bootRetryTimerRef.current === null) return;
      window.clearTimeout(bootRetryTimerRef.current);
      bootRetryTimerRef.current = null;
    };
  }, [
    bootAttempt,
    draftPersistence,
    loadDocument,
    requestedPathState.documentPath,
    requestedPathState.projectPath,
    requestedPathState.rawPath,
    resolveDraftRecovery,
  ]);

  useEffect(() => {
    const workspaceTitlePath = activeDocumentPath
      ? formatWorkspacePathForDisplay(
          backend?.info.projectPath
            ? joinPath(backend.info.projectPath, activeDocumentPath)
            : requestedPathState.rawPath,
        )
      : null;

    document.title = isPreviewRoute
      ? "Roughdraft Preview"
      : isRoughdraftFlavoredMarkdownRoute
        ? "Roughdraft Flavored Markdown"
        : (workspaceTitlePath ?? "Roughdraft");
  }, [
    activeDocumentPath,
    backend,
    isRoughdraftFlavoredMarkdownRoute,
    isPreviewRoute,
    requestedPathState.rawPath,
  ]);

  const handleDocumentSaveStateChange = useCallback(
    (state: DocumentSaveState) => {
      documentSaveStateRef.current = state;
      setDocumentSaveState(state);
    },
    [],
  );

  /** Serialize every save so the retry cannot interleave with the debounce. */
  const runExclusively = useCallback(<T,>(task: () => Promise<T>) => {
    const run = saveChainRef.current.then(task, task);
    saveChainRef.current = run.catch(() => undefined);
    return run;
  }, []);

  const deliverDocumentSave = useCallback(
    async (
      id: string,
      content: string,
      expectedVersion: string | undefined,
      allowConflictResend: boolean,
    ): Promise<void> => {
      const currentBackend = backendRef.current;
      const currentPath = activeDocumentPathRef.current;
      // Resolving here would report a save that never happened as a success,
      // and the editor would drop the edits as delivered.
      if (!currentBackend || !currentPath) {
        throw new Error("Roughdraft has no open document to save to.");
      }

      const settleSaved = (savedDocument: Page) => {
        noteSavedVersion(savedDocument.version);
        applyDocumentPage(savedDocument);
        documentDirtyRef.current = false;
        draftPersistence.noteSaveSuccess(content);
        // Whatever was owed has landed, so no restore is in flight any more.
        setContentRestore(null);
      };

      try {
        const savedDocument = await currentBackend.saveMarkdownFile(
          currentPath,
          content,
          expectedVersion,
        );
        settleSaved(
          savedDocument ?? pageFromSavedContent(id, content, expectedVersion),
        );
        return;
      } catch (error) {
        if (!(error instanceof MarkdownFileConflictError)) throw error;

        const record = draftPersistence.read();
        const resolution = resolveConflict({
          attemptedContent: content,
          currentContent: error.current.content,
          draftBaseContent:
            record?.baseContent ?? documentPageRef.current?.content ?? null,
          editorContent: documentDraftContentRef.current ?? content,
        });
        logDraftEvent("conflict-classified", { resolution });

        if (resolution === "already-applied") {
          settleSaved(error.current);
          return;
        }

        if (resolution === "base-unchanged" && allowConflictResend) {
          // Nothing was lost: the destination still holds what we based on, so
          // re-send once with the version it just told us about.
          await deliverDocumentSave(id, content, error.current.version, false);
          return;
        }

        // The restore is over, lost rather than landed. Leaving it marked as
        // in flight would keep the watcher standing down for the rest of the
        // session, so every later write to this file would go unreported.
        setContentRestore(null);
        setDocumentDiskChangeState("conflict");
        throw error;
      }
    },
    [applyDocumentPage, draftPersistence, noteSavedVersion],
  );

  const saveDocumentContent = useCallback(
    (id: string, content: string) => {
      const expectedVersion =
        documentPageRef.current?.id === id
          ? documentPageRef.current.version
          : undefined;
      return runExclusively(() =>
        deliverDocumentSave(id, content, expectedVersion, true),
      );
    },
    [deliverDocumentSave, runExclusively],
  );

  saveDraftContentRef.current = async (content: string) => {
    const currentDocument = documentPageRef.current;
    if (!currentDocument) {
      throw new Error("Roughdraft has no open document to save to.");
    }
    await saveDocumentContent(currentDocument.id, content);
  };

  const handleSaveDocument = useCallback(
    async (id: string, content: string) => {
      // This save carries at least what the pending retry was going to send.
      draftPersistence.cancelRetry();

      try {
        await saveDocumentContent(id, content);
      } catch (error) {
        // A real conflict is the banner's to resolve; anything else is worth
        // retrying until the destination comes back.
        if (!(error instanceof MarkdownFileConflictError)) {
          draftPersistence.noteSaveFailure();
        }
        throw error;
      }
    },
    [draftPersistence, saveDocumentContent],
  );

  useEffect(() => {
    const previousDiskChangeState = previousDiskChangeStateRef.current;
    previousDiskChangeStateRef.current = documentDiskChangeState;

    if (!documentRetryPending) return;
    if (documentDiskChangeState !== "clean") return;
    if (previousDiskChangeState === "clean") return;

    draftPersistence.retryNow();
  }, [documentDiskChangeState, documentRetryPending, draftPersistence]);

  const handleDocumentDirtyStateChange = useCallback((isDirty: boolean) => {
    documentDirtyRef.current = isDirty;
  }, []);

  const handleDocumentLocalContentChange = useCallback(
    (markdown: string, origin: LocalContentOrigin) => {
      documentDraftContentRef.current = markdown;
      // Only the user's own edits are unsent work. Adopting content the app
      // handed the editor would re-record what is already on disk.
      if (origin !== "edit") return;
      draftPersistence.recordLocalContent(
        markdown,
        documentPageRef.current?.content ?? null,
      );
    },
    [draftPersistence],
  );

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !shouldWarnBeforeUnload({
          activeDocumentPath: activeDocumentPathRef.current,
          isDirty: documentDirtyRef.current,
          saveState: documentSaveStateRef.current,
          diskChangeState: documentDiskChangeState,
        })
      ) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [documentDiskChangeState]);

  const nextForceResetKey = useCallback((path: string) => {
    forceResetCounterRef.current += 1;
    return `${path}:${forceResetCounterRef.current}`;
  }, []);

  const handleRestoreDraft = useCallback(() => {
    if (offeredDraftContent === null) return;
    restoreDraftContent(offeredDraftContent);
  }, [offeredDraftContent, restoreDraftContent]);

  const handleDiscardDraft = useCallback(() => {
    setOfferedDraftContent(null);
    draftPersistence.discard();
    setDocumentDiskChangeState("clean");
  }, [draftPersistence]);

  // Deliberately not memoised: the mode comes from `getKey()`, which reads a
  // ref that `resolveRemoteKey` mutates without changing `draftPersistence`'s
  // identity, so no dependency list can observe it. Nothing downstream keys off
  // this object's identity, so recomputing every render is both correct and
  // cheaper than a memo that would have to lie about what it depends on.
  const draftRestoreOffer: DraftRestoreOffer = {
    mode: draftPersistence.getKey()?.mode ?? "local",
    onRestore: handleRestoreDraft,
    onDiscard: handleDiscardDraft,
  };

  const handleReloadDocumentFromDisk = useCallback(async () => {
    const currentBackend = backendRef.current;
    const currentPath = activeDocumentPathRef.current;
    if (!currentBackend || !currentPath) return;

    const nextDocument = await currentBackend.getMarkdownFile(currentPath);
    applyDocumentPage(nextDocument);
    documentDirtyRef.current = false;
    // Taking the file's version is a decision to drop the local edits, so the
    // record must go too or the next boot would offer them back.
    draftPersistence.discard();
    setContentRestore(null);
    setDocumentDiskChangeState("clean");
    setDocumentForceResetKey(nextForceResetKey(currentPath));
  }, [applyDocumentPage, draftPersistence, nextForceResetKey]);

  const handleKeepEditingWithoutAutosave = useCallback(() => {
    setDocumentDiskChangeState("paused");
  }, []);

  /**
   * Write `content` over whatever the file now holds, version-check and all
   * skipped. Takes the bytes explicitly because the two callers disagree about
   * them: the conflict banner sends the editor's draft, a history restore sends
   * the snapshot, and the editor has not adopted the snapshot yet at that point.
   */
  const overwriteDocumentWith = useCallback(
    async (content: string) => {
      const currentBackend = backendRef.current;
      const currentPath = activeDocumentPathRef.current;
      const currentDocument = documentPageRef.current;
      if (!currentBackend || !currentPath || !currentDocument) return;

      // Through the same latch as the autosave and the retry: this deliberately
      // sends no expectedVersion, so it must not overlap a save that does.
      let savedDocument: Page | undefined;
      try {
        savedDocument = await runExclusively(async () =>
          currentBackend.saveMarkdownFile(currentPath, content),
        );
      } catch (error) {
        // The write that was going to end the restore never happened. Leaving
        // the marker set would keep the watcher standing down for the rest of
        // the session, so every later write to this file would go unreported —
        // and this is the one path that always sets it before writing.
        setContentRestore(null);
        throw error;
      }

      noteSavedVersion(savedDocument?.version);
      applyDocumentPage(
        savedDocument ??
          pageFromSavedContent(
            currentDocument.id,
            content,
            currentDocument.version,
          ),
      );
      documentDirtyRef.current = false;
      draftPersistence.noteSaveSuccess(content);
      // Whatever was being restored is now what the file holds, so the watcher
      // has no reason left to stand down.
      setContentRestore(null);
      handleDocumentSaveStateChange("saved");
      setDocumentDiskChangeState("clean");
      setDocumentForceResetKey(nextForceResetKey(currentPath));
    },
    [
      applyDocumentPage,
      draftPersistence,
      handleDocumentSaveStateChange,
      nextForceResetKey,
      noteSavedVersion,
      runExclusively,
    ],
  );

  const handleOverwriteDocumentOnDisk = useCallback(async () => {
    const currentDocument = documentPageRef.current;
    if (!currentDocument) return;

    await overwriteDocumentWith(
      documentDraftContentRef.current ?? currentDocument.content,
    );
  }, [overwriteDocumentWith]);

  /**
   * Restoring is a forward save, not a rewind: the snapshot goes back into the
   * editor as unsaved work and is delivered like any other edit, so it lands in
   * history too and the reviewer can undo it the same way.
   */
  const handleRestoreSnapshot = useCallback(
    async ({ content, id, overwrite }: SnapshotRestore) => {
      // A fresh object every time: the adoption effect keys on identity, so
      // restoring the same bytes twice has to read as a second request.
      setContentRestore({ content, source: "snapshot" });
      setExternalChangeSeen(false);
      logHistoryEvent("restored", { id, overwrite });

      if (!overwrite) return;

      try {
        await overwriteDocumentWith(content);
      } catch (error) {
        // The save machinery already tells the reviewer the write is not
        // landing, and the restore marker was lifted on the way out, so there
        // is nothing left to do but say which restore it was. Rethrowing would
        // only reach the dialog's fire-and-forget caller as an unhandled
        // rejection.
        logHistoryEvent("restore-failed", { id, reason: String(error) });
      }
    },
    [overwriteDocumentWith],
  );

  // Stable, so the dialog can depend on it honestly: it reads refs at call
  // time, which is the point — the editor's live text must not be captured
  // into a closure that goes stale between renders.
  const getDocumentContent = useCallback(
    () =>
      documentDraftContentRef.current ?? documentPageRef.current?.content ?? "",
    [],
  );

  const documentHistoryWiring: DocumentHistoryWiring = {
    getDocumentContent,
    onRestore: handleRestoreSnapshot,
  };

  const dismissExternalChangeNotice = useCallback(() => {
    setExternalChangeSeen(false);
  }, []);

  const handleCompleteReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      const currentBackend = backendRef.current;
      const currentPath = activeDocumentPathRef.current;
      const currentDocument = documentPageRef.current;
      if (!currentBackend || !currentPath || !currentDocument) {
        return { delivered: false };
      }

      const content =
        documentDraftContentRef.current ?? currentDocument.content;
      const expectedVersion = currentDocument.version;
      const savedDocument = await runExclusively(async () =>
        currentBackend.saveMarkdownFile(currentPath, content, expectedVersion),
      );

      applyDocumentPage(
        savedDocument ??
          pageFromSavedContent(currentDocument.id, content, expectedVersion),
      );
      documentDirtyRef.current = false;
      // The review is over: nothing about this document is owed any more.
      draftPersistence.discard();
      setDocumentDiskChangeState("clean");

      return currentBackend.completeReview
        ? currentBackend.completeReview(currentPath, options)
        : { delivered: false };
    },
    [applyDocumentPage, draftPersistence, runExclusively],
  );

  // The subscription deliberately does not depend on the disk-change state:
  // tearing the watch down and re-opening it on every UI transition would also
  // reset the backend's own reconnect backoff.
  useEffect(() => {
    if (!backend?.watchMarkdownFile || !activeDocumentPath) return;

    let disposed = false;
    const stopWatching = backend.watchMarkdownFile(
      activeDocumentPath,
      (event) => {
        if (disposed || event.path !== activeDocumentPath) return;

        // A write of ours reaches the watcher before the save that caused it
        // reports its version, so an echo arriving mid-save would read as
        // somebody else's edit and pause autosave over our own work. Waiting
        // for the writes already in flight is what makes the versions below
        // knowable.
        const savesInFlight = saveChainRef.current;

        void (async () => {
          await savesInFlight;
          if (disposed) return;

          const decision = resolveDiskChange({
            event,
            documentVersion: documentPageRef.current?.version ?? null,
            savedVersions: savedVersionsRef.current,
            dirty: documentDirtyRef.current,
            diskChangeState: documentDiskChangeStateRef.current,
            contentRestorePending: contentRestoreRef.current !== null,
          });

          if (decision === "ignore") return;
          if (decision === "flag-changed") {
            setDocumentDiskChangeState("changed");
            return;
          }

          const currentBackend = backendRef.current;
          const currentPath = activeDocumentPathRef.current;
          if (!currentBackend || !currentPath) return;

          try {
            const nextDocument =
              await currentBackend.getMarkdownFile(currentPath);
            if (disposed) return;
            applyDocumentPage(nextDocument);
            setDocumentDiskChangeState("clean");
            // The reload is silent by design, but the text just changed under
            // the reviewer. Say so, and point at where the old bytes went.
            setExternalChangeSeen(true);
            logHistoryEvent("external-change-reloaded");
          } catch (error) {
            if (disposed) return;
            // The file moved and we could not follow it, so the editor is now
            // showing bytes that are not on disk with autosave still running.
            // Flagging it puts up the banner the reviewer would otherwise meet
            // later as a conflict they cannot account for.
            setDocumentDiskChangeState("changed");
            console.error("Failed to reload changed markdown file:", error);
          }
        })();
      },
    );

    return () => {
      disposed = true;
      stopWatching();
    };
  }, [activeDocumentPath, applyDocumentPage, backend]);

  const retryBoot = useCallback(() => {
    if (bootRetryTimerRef.current !== null) {
      window.clearTimeout(bootRetryTimerRef.current);
      bootRetryTimerRef.current = null;
    }
    setBootAttempt((attempt) => attempt + 1);
  }, []);

  const handleDocumentEditorViewModeChange = useCallback(
    (nextMode: DocumentEditorViewMode) => {
      setDocumentEditorViewMode((current) => {
        if (nextMode === current) return current;
        window.history.replaceState(
          null,
          "",
          buildLocationForDocumentEditorViewMode(nextMode),
        );
        return nextMode;
      });
    },
    [],
  );

  if (loading) {
    return (
      <div
        className="h-screen bg-[#FCFCFC] dark:bg-background"
        aria-hidden="true"
      />
    );
  }

  if (isRoughdraftFlavoredMarkdownRoute) {
    return <RoughdraftFlavoredMarkdownPage />;
  }

  if (isPreviewRoute) {
    return <PreviewPage />;
  }

  if (backendUnavailable) {
    return (
      <BackendUnavailableNotice
        hasUnsentDraft={draftPersistence.read() !== null}
        retriesExhausted={bootAttempt >= MAX_BOOT_RETRIES}
        onRetry={retryBoot}
      />
    );
  }

  // A remote session names its document through `?session=`, not through a
  // path, so the requested path alone does not decide whether one was asked for.
  const documentRequested =
    !!requestedPathState.rawPath || backend?.info.kind === "remote";

  if (!documentRequested || loadError) {
    return (
      <Dashboard
        loadError={loadError}
        requestedPath={requestedPathState.rawPath}
      />
    );
  }

  const documentAbsolutePath =
    activeDocumentPath && backend?.info.projectPath
      ? joinPath(backend.info.projectPath, activeDocumentPath)
      : requestedPathState.rawPath;
  const documentFilenameLabel =
    getPathLeaf(documentAbsolutePath ?? activeDocumentPath) ?? "Untitled.md";

  return (
    <main className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-[#FCFCFC] dark:bg-background text-slate-950 dark:text-slate-50">
      {updateStatus ? (
        <div className="pointer-events-none absolute top-4 right-4 z-40 max-w-sm">
          <div className="pointer-events-auto">
            <UpdateNotice updateStatus={updateStatus} />
          </div>
        </div>
      ) : null}
      <DocumentWorkspace
        documentPage={documentPage}
        activeDocumentPath={activeDocumentPath}
        documentCopyPath={documentAbsolutePath}
        documentFilenameLabel={documentFilenameLabel}
        documentEditorViewMode={documentEditorViewMode}
        onDocumentEditorViewModeChange={handleDocumentEditorViewModeChange}
        onSaveDocument={handleSaveDocument}
        onDocumentSaveStateChange={handleDocumentSaveStateChange}
        onDocumentDirtyStateChange={handleDocumentDirtyStateChange}
        onDocumentLocalContentChange={handleDocumentLocalContentChange}
        documentDiskChangeState={documentDiskChangeState}
        documentRetryPending={documentRetryPending}
        documentForceResetKey={documentForceResetKey}
        contentRestore={contentRestore}
        draftRestoreOffer={draftRestoreOffer}
        externalChangeNotice={
          externalChangeSeen ? { onDismiss: dismissExternalChangeNotice } : null
        }
        history={documentHistoryWiring}
        onReloadDocumentFromDisk={handleReloadDocumentFromDisk}
        onKeepEditingWithoutAutosave={handleKeepEditingWithoutAutosave}
        onOverwriteDocumentOnDisk={handleOverwriteDocumentOnDisk}
        onCompleteReview={handleCompleteReview}
        backend={backend}
      />
    </main>
  );
}
