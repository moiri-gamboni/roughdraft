import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DocumentEditorViewMode,
  buildLocationForDocumentEditorViewMode,
  formatWorkspacePathForDisplay,
  getDocumentEditorViewModeFromLocation,
  getPathLeaf,
  getRequestedPathState,
  joinPath,
  syncRequestedPathInUrl,
} from "./app-navigation";
import { detectBackend } from "./detect-backend";
import { DocumentWorkspace } from "./DocumentWorkspace";
import {
  MarkdownFileConflictError,
  type Page,
  type StorageBackend,
} from "./storage";
import { fetchUpdateStatus, type UpdateStatus } from "./update-status";
import { UpdateNotice } from "./UpdateNotice";

type SaveState = "idle" | "saving" | "error";
type DocumentDiskChangeState = "clean" | "changed" | "conflict";

function EmptyState({
  message,
  updateStatus,
}: {
  message: string;
  updateStatus: UpdateStatus | null;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FCFCFC] px-6 text-slate-950">
      {updateStatus ? (
        <div className="absolute top-4 right-4 max-w-sm">
          <UpdateNotice updateStatus={updateStatus} />
        </div>
      ) : null}
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight">
          Open a markdown file
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{message}</p>
        <code className="mt-5 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-600">
          roughdraft open /absolute/path/to/file.md
        </code>
      </div>
    </div>
  );
}

export function App() {
  const initialRequestedPathState = getRequestedPathState();
  const [requestedPathState] = useState(initialRequestedPathState);
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [documentPage, setDocumentPage] = useState<Page | null>(null);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(
    initialRequestedPathState.documentPath,
  );
  const [, setDocumentSaveState] = useState<SaveState>("idle");
  const [documentDiskChangeState, setDocumentDiskChangeState] =
    useState<DocumentDiskChangeState>("clean");
  const [documentForceResetKey, setDocumentForceResetKey] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const documentEditorViewMode =
    getDocumentEditorViewModeFromLocation("rich-text");
  const backendRef = useRef<StorageBackend | null>(null);
  const documentPageRef = useRef<Page | null>(null);
  const activeDocumentPathRef = useRef<string | null>(activeDocumentPath);
  const documentDirtyRef = useRef(false);
  const documentDraftContentRef = useRef<string | null>(null);

  backendRef.current = backend;
  documentPageRef.current = documentPage;
  activeDocumentPathRef.current = activeDocumentPath;

  const applyDocumentPage = useCallback((nextDocument: Page) => {
    setDocumentPage(nextDocument);
    documentDraftContentRef.current = nextDocument.content;
  }, []);

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
    let cancelled = false;

    const initialize = async () => {
      setLoading(true);
      setLoadError(null);
      setDocumentPage(null);

      try {
        const detectedBackend = await detectBackend();
        if (cancelled) return;

        setBackend(detectedBackend);

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

        await loadDocument(detectedBackend, requestedPathState.documentPath);
        if (cancelled) return;

        setLoading(false);
      } catch (error) {
        if (cancelled) return;

        console.error("Failed to open markdown file:", error);
        setActiveDocumentPath(null);
        setLoadError("Could not open that markdown file.");
        setLoading(false);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [
    loadDocument,
    requestedPathState.documentPath,
    requestedPathState.projectPath,
    requestedPathState.rawPath,
  ]);

  useEffect(() => {
    const workspaceTitlePath = activeDocumentPath
      ? formatWorkspacePathForDisplay(
          backend?.info.projectPath
            ? joinPath(backend.info.projectPath, activeDocumentPath)
            : requestedPathState.rawPath,
        )
      : null;

    document.title = workspaceTitlePath
      ? `Roughdraft of ${workspaceTitlePath}`
      : "Roughdraft";
  }, [activeDocumentPath, backend, requestedPathState.rawPath]);

  const handleSaveDocument = useCallback(
    async (id: string, content: string) => {
      if (!activeDocumentPath) return;
      const expectedVersion =
        documentPageRef.current?.id === id
          ? documentPageRef.current.version
          : undefined;

      let savedDocument: Page | undefined;
      try {
        savedDocument = await backendRef.current?.saveMarkdownFile(
          activeDocumentPath,
          content,
          expectedVersion,
        );
      } catch (error) {
        if (error instanceof MarkdownFileConflictError) {
          setDocumentDiskChangeState("conflict");
        }
        throw error;
      }

      const firstLine = content.split("\n")[0] || "";
      const fallbackTitle = id.split("/").at(-1) || id;
      const title = firstLine.replace(/^#*\s*/, "") || fallbackTitle;
      const nextDocument = savedDocument ?? {
        id,
        content,
        title,
        version: expectedVersion,
      };

      applyDocumentPage(nextDocument);
      documentDirtyRef.current = false;
      setDocumentDiskChangeState("clean");
    },
    [activeDocumentPath, applyDocumentPage],
  );

  const handleDocumentDirtyStateChange = useCallback((isDirty: boolean) => {
    documentDirtyRef.current = isDirty;
  }, []);

  const handleDocumentLocalContentChange = useCallback((markdown: string) => {
    documentDraftContentRef.current = markdown;
  }, []);

  const handleReloadDocumentFromDisk = useCallback(async () => {
    const currentBackend = backendRef.current;
    const currentPath = activeDocumentPathRef.current;
    if (!currentBackend || !currentPath) return;

    const nextDocument = await currentBackend.getMarkdownFile(currentPath);
    applyDocumentPage(nextDocument);
    documentDirtyRef.current = false;
    setDocumentDiskChangeState("clean");
    setDocumentForceResetKey(
      `${currentPath}:${nextDocument.version ?? Date.now()}`,
    );
  }, [applyDocumentPage]);

  const handleOverwriteDocumentOnDisk = useCallback(async () => {
    const currentBackend = backendRef.current;
    const currentPath = activeDocumentPathRef.current;
    const currentDocument = documentPageRef.current;
    if (!currentBackend || !currentPath || !currentDocument) return;

    const content = documentDraftContentRef.current ?? currentDocument.content;
    const firstLine = content.split("\n")[0] || "";
    const fallbackTitle =
      currentDocument.id.split("/").at(-1) || currentDocument.id;
    const title = firstLine.replace(/^#*\s*/, "") || fallbackTitle;
    const savedDocument = (await currentBackend.saveMarkdownFile(
      currentPath,
      content,
    )) ?? {
      ...currentDocument,
      content,
      title,
    };

    applyDocumentPage(savedDocument);
    documentDirtyRef.current = false;
    setDocumentDiskChangeState("clean");
  }, [applyDocumentPage]);

  useEffect(() => {
    if (!backend?.watchMarkdownFile || !activeDocumentPath) return;

    let disposed = false;
    const stopWatching = backend.watchMarkdownFile(
      activeDocumentPath,
      (event) => {
        if (disposed || event.path !== activeDocumentPath) return;

        const currentDocument = documentPageRef.current;
        if (event.version && currentDocument?.version === event.version) {
          return;
        }

        if (!event.exists) {
          setDocumentDiskChangeState("changed");
          return;
        }

        if (documentDirtyRef.current) {
          setDocumentDiskChangeState("changed");
          return;
        }

        void (async () => {
          const currentBackend = backendRef.current;
          const currentPath = activeDocumentPathRef.current;
          if (!currentBackend || !currentPath || disposed) return;

          try {
            const nextDocument =
              await currentBackend.getMarkdownFile(currentPath);
            if (disposed) return;
            applyDocumentPage(nextDocument);
            setDocumentDiskChangeState("clean");
          } catch (error) {
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

  const handleDocumentEditorViewModeChange = useCallback(
    (nextMode: DocumentEditorViewMode) => {
      if (nextMode === documentEditorViewMode) return;
      window.location.assign(buildLocationForDocumentEditorViewMode(nextMode));
    },
    [documentEditorViewMode],
  );

  if (loading) {
    return <div className="h-screen bg-[#FCFCFC]" aria-hidden="true" />;
  }

  if (!requestedPathState.rawPath || loadError) {
    return (
      <EmptyState
        message={
          loadError ??
          "Use the Roughdraft CLI to open a single markdown file from disk."
        }
        updateStatus={updateStatus}
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
    <main className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-[#FCFCFC] text-slate-950">
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
        documentFilenameLabel={documentFilenameLabel}
        documentEditorViewMode={documentEditorViewMode}
        onDocumentEditorViewModeChange={handleDocumentEditorViewModeChange}
        onSaveDocument={handleSaveDocument}
        onDocumentSaveStateChange={setDocumentSaveState}
        onDocumentDirtyStateChange={handleDocumentDirtyStateChange}
        onDocumentLocalContentChange={handleDocumentLocalContentChange}
        documentDiskChangeState={documentDiskChangeState}
        documentForceResetKey={documentForceResetKey}
        onReloadDocumentFromDisk={handleReloadDocumentFromDisk}
        onOverwriteDocumentOnDisk={handleOverwriteDocumentOnDisk}
        backend={backend}
      />
    </main>
  );
}
