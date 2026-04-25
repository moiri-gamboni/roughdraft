import { useCallback, useEffect, useRef, useState } from "react";
import {
  MarkdownFileConflictError,
  type Page,
  type StorageBackend,
} from "./storage";
import { detectBackend } from "./detect-backend";
import { AppSidebar } from "./AppSidebar";
import { DocumentWorkspace } from "./DocumentWorkspace";
import { HomeScreen } from "./HomeScreen";
import { UpdateNotice } from "./UpdateNotice";
import {
  type DocumentEditorViewMode,
  type RequestedPathState,
  buildLocationForDocumentEditorViewMode,
  buildLocationForPath,
  formatWorkspacePathForDisplay,
  getDocumentEditorViewModeFromLocation,
  getDocumentNavigationState,
  getPathLeaf,
  getRequestedPathState,
  getWorkspaceName,
  getWorkspacePath,
  joinPath,
  syncRequestedPathInUrl,
} from "./app-navigation";
import { LocalStorageBackend } from "./local-storage-backend";
import { recordRecentOpen } from "./recent-items";
import { fetchUpdateStatus, type UpdateStatus } from "./update-status";

type DocumentDiskChangeState = "clean" | "changed" | "conflict";

export function App() {
  const initialRequestedPathState = getRequestedPathState();
  const [requestedPathState, setRequestedPathState] =
    useState<RequestedPathState>(initialRequestedPathState);
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [documentPage, setDocumentPage] = useState<Page | null>(null);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(
    requestedPathState.documentPath,
  );
  const [pathSwitcherDismissCount, setPathSwitcherDismissCount] = useState(0);
  const [, setDocumentSaveState] = useState<"idle" | "saving" | "error">(
    "idle",
  );
  const [documentDiskChangeState, setDocumentDiskChangeState] =
    useState<DocumentDiskChangeState>("clean");
  const [documentForceResetKey, setDocumentForceResetKey] = useState<
    string | null
  >(null);
  const documentEditorViewMode =
    getDocumentEditorViewModeFromLocation("rich-text");
  const [projectTreeVersion, setProjectTreeVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [demoModeEnabled, setDemoModeEnabled] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(
    () => !getRequestedPathState().documentPath,
  );
  const backendRef = useRef<StorageBackend | null>(null);
  const documentPageRef = useRef<Page | null>(null);
  const activeDocumentPathRef = useRef<string | null>(activeDocumentPath);
  const documentDirtyRef = useRef(false);
  const documentDraftContentRef = useRef<string | null>(null);

  backendRef.current = backend;
  documentPageRef.current = documentPage;
  activeDocumentPathRef.current = activeDocumentPath;

  const loadProject = useCallback(async (nextBackend: StorageBackend) => {
    const pageList = await nextBackend.listPages();
    return pageList;
  }, []);

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

  const resetProjectState = useCallback(() => {
    setDocumentPage(null);
    setActiveDocumentPath(null);
    documentDirtyRef.current = false;
    documentDraftContentRef.current = null;
    setDocumentDiskChangeState("clean");
  }, []);

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
      const detectedBackend = await detectBackend();
      if (cancelled) return;

      if (requestedPathState.rawPath && detectedBackend.canManageProjects) {
        const requestedProjectPath = requestedPathState.projectPath;
        if (
          requestedProjectPath &&
          requestedProjectPath !==
            getWorkspacePath(detectedBackend.info.projectPath)
        ) {
          try {
            await detectedBackend.openProject(requestedProjectPath);
          } catch (error) {
            console.error("Failed to open project from URL:", error);
          }
        }
      }

      syncRequestedPathInUrl(requestedPathState.rawPath);
      setBackend(detectedBackend);

      if (!requestedPathState.projectPath) {
        resetProjectState();
        setLoading(false);
        return;
      }

      await loadProject(detectedBackend);

      if (requestedPathState.documentPath) {
        await loadDocument(detectedBackend, requestedPathState.documentPath);
      } else {
        setDocumentPage(null);
        setActiveDocumentPath(null);
      }

      if (cancelled) return;
      setLoading(false);
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [
    loadDocument,
    loadProject,
    resetProjectState,
    requestedPathState.documentPath,
    requestedPathState.projectPath,
    requestedPathState.rawPath,
  ]);

  useEffect(() => {
    if (!requestedPathState.rawPath) return;
    recordRecentOpen(requestedPathState.rawPath);
  }, [requestedPathState.rawPath]);

  useEffect(() => {
    const workspaceTitlePath = activeDocumentPath
      ? formatWorkspacePathForDisplay(
          backend?.info.projectPath
            ? joinPath(backend.info.projectPath, activeDocumentPath)
            : requestedPathState.rawPath,
        )
      : formatWorkspacePathForDisplay(
          backend?.info.projectPath ?? requestedPathState.projectPath,
        );

    document.title = workspaceTitlePath
      ? `Roughdraft of ${workspaceTitlePath}`
      : "Roughdraft";
  }, [
    activeDocumentPath,
    backend,
    requestedPathState.projectPath,
    requestedPathState.rawPath,
  ]);

  const openDocumentPage = useCallback(
    (
      page: Page,
      relativePath: string,
      projectPath: string | null,
      currentRawPath: string | null,
    ) => {
      applyDocumentPage(page);
      setActiveDocumentPath(relativePath);
      setDocumentSaveState("idle");
      documentDirtyRef.current = false;
      setDocumentDiskChangeState("clean");

      if (!projectPath) return;

      const nextPathState = getDocumentNavigationState(
        projectPath,
        relativePath,
        currentRawPath,
      );
      setRequestedPathState(nextPathState);
      syncRequestedPathInUrl(nextPathState.rawPath);
    },
    [applyDocumentPage],
  );

  const handleOpenDemo = useCallback(async () => {
    const nextBackend = new LocalStorageBackend();
    setLoading(true);
    setDemoModeEnabled(true);
    setSidebarVisible(true);
    syncRequestedPathInUrl(null);
    setBackend(nextBackend);
    resetProjectState();

    try {
      const loadedPages = await loadProject(nextBackend);
      const page =
        loadedPages[0] ??
        (await nextBackend.createPage(
          "Untitled",
          "# Welcome to Roughdraft\n\nStart writing. Your work is saved automatically.\n",
        ));
      openDocumentPage(page, `${page.id}.md`, null, null);
    } finally {
      setLoading(false);
    }
  }, [loadProject, openDocumentPage, resetProjectState]);

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

  const handleCreatePage = useCallback(async () => {
    if (!backendRef.current) return;
    const page = await backendRef.current.createPage(
      "Untitled",
      "# Untitled\n",
    );
    const projectPath =
      backendRef.current.info.projectPath ?? requestedPathState.projectPath;
    const relativePath = `${page.id}.md`;

    setProjectTreeVersion((version) => version + 1);
    openDocumentPage(
      page,
      relativePath,
      projectPath ?? null,
      requestedPathState.rawPath,
    );
  }, [
    openDocumentPage,
    requestedPathState.projectPath,
    requestedPathState.rawPath,
  ]);

  const openDocumentInRegularMode = useCallback(
    async (relativePath: string) => {
      if (!backendRef.current) return;

      const projectPath =
        backendRef.current.info.projectPath ?? requestedPathState.projectPath;
      if (!projectPath) return;

      try {
        const nextDocument = await loadDocument(
          backendRef.current,
          relativePath,
        );
        openDocumentPage(
          nextDocument,
          relativePath,
          projectPath,
          requestedPathState.rawPath,
        );
      } catch (error) {
        console.error("Failed to open markdown file:", error);
      }

      setPathSwitcherDismissCount((count) => count + 1);
    },
    [
      loadDocument,
      openDocumentPage,
      requestedPathState.projectPath,
      requestedPathState.rawPath,
    ],
  );

  const handleOpenMarkdownPage = useCallback(
    async (relativePath: string) => {
      await openDocumentInRegularMode(relativePath);
    },
    [openDocumentInRegularMode],
  );

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

  const shouldShowHomepage = !requestedPathState.rawPath && !demoModeEnabled;

  if (shouldShowHomepage) {
    return (
      <HomeScreen
        backend={backend}
        buildLocationForPath={buildLocationForPath}
        onOpenDemo={() => void handleOpenDemo()}
        updateStatus={updateStatus}
      />
    );
  }

  const documentAbsolutePath =
    activeDocumentPath && backend?.info.projectPath
      ? joinPath(backend.info.projectPath, activeDocumentPath)
      : requestedPathState.rawPath;
  const displayPath = documentPage
    ? documentAbsolutePath
    : backend?.info.projectPath;
  const workspaceName = getWorkspaceName(displayPath ?? undefined);
  const workspacePath =
    getWorkspacePath(
      backend?.info.projectPath ?? requestedPathState.projectPath ?? undefined,
    ) ?? "Browser drafts";
  const workspacePathLabel =
    formatWorkspacePathForDisplay(workspacePath) ?? workspacePath;
  const treeCurrentPath = documentAbsolutePath ?? backend?.info.projectPath;
  const projectLabel = getPathLeaf(backend?.info.projectPath) ?? workspaceName;
  const documentFilenameLabel =
    getPathLeaf(activeDocumentPath) ?? "Untitled.md";
  const sidebarToggleLabel = sidebarVisible ? "Hide sidebar" : "Show sidebar";

  return (
    <div className="flex h-screen overflow-hidden bg-[#FCFCFC] text-slate-950">
      {sidebarVisible ? (
        <AppSidebar
          sidebarToggleLabel={sidebarToggleLabel}
          backend={backend}
          projectLabel={projectLabel}
          displayPath={displayPath ?? null}
          workspacePathLabel={workspacePathLabel}
          buildLocationForPath={buildLocationForPath}
          pathSwitcherDismissCount={pathSwitcherDismissCount}
          onCreatePage={() => void handleCreatePage()}
          onHideSidebar={() => setSidebarVisible(false)}
          treeCurrentPath={treeCurrentPath ?? null}
          projectTreeVersion={projectTreeVersion}
          onOpenMarkdownPage={handleOpenMarkdownPage}
        />
      ) : null}

      <main className="relative min-w-0 flex-1 overflow-hidden">
        {updateStatus ? (
          <div className="pointer-events-none absolute top-4 right-4 z-40 max-w-sm">
            <div className="pointer-events-auto">
              <UpdateNotice updateStatus={updateStatus} />
            </div>
          </div>
        ) : null}
        <div className="flex h-full flex-col overflow-hidden bg-[#FCFCFC]">
          <DocumentWorkspace
            sidebarVisible={sidebarVisible}
            sidebarToggleLabel={sidebarToggleLabel}
            onToggleSidebar={() => setSidebarVisible((visible) => !visible)}
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
        </div>
      </main>
    </div>
  );
}
