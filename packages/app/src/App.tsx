import { useEffect, useState, useCallback, useRef } from "react";
import type { StorageBackend, Page, ProjectLayout } from "./storage";
import { detectBackend } from "./detect-backend";
import { Canvas } from "./Canvas";
import { PageCard } from "./PageCard";
import { PathSwitcher } from "./PathSwitcher";
import { ProjectTreeSidebar } from "./ProjectTreeSidebar";
import { Button } from "./components/ui/button";

interface RequestedPathState {
  rawPath: string | null;
  projectPath: string | null;
  documentPath: string | null;
}

interface CanvasRevealRequest {
  pageId: string;
  key: string;
}

type ViewMode = "canvas" | "document";

function normalizePathSeparators(value: string) {
  return value.replace(/\\/g, "/");
}

function getRawPathFromLocation(): string | null {
  const searchParams = new URLSearchParams(window.location.search);
  const queryPath = searchParams.get("path")?.trim();
  if (queryPath) return queryPath;

  const normalizedPathname = normalizePathSeparators(window.location.pathname);
  if (normalizedPathname !== "/" && !normalizedPathname.startsWith("/api")) {
    const decodedPathname = decodeURIComponent(normalizedPathname);
    return decodedPathname.startsWith("/") ? decodedPathname : `/${decodedPathname}`;
  }

  return null;
}

function getRequestedPathState(): RequestedPathState {
  const rawPath = getRawPathFromLocation();
  if (!rawPath) {
    return { rawPath: null, projectPath: null, documentPath: null };
  }

  const normalizedPath = normalizePathSeparators(rawPath);
  if (!normalizedPath.toLowerCase().endsWith(".md")) {
    return { rawPath, projectPath: rawPath, documentPath: null };
  }

  const lastSlashIndex = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
  const projectPath = lastSlashIndex >= 0 ? rawPath.slice(0, lastSlashIndex) || "/" : ".";
  const documentPath = rawPath.slice(lastSlashIndex + 1);

  return { rawPath, projectPath, documentPath };
}

function getWorkspacePath(path?: string) {
  return path?.trim() || null;
}

function formatWorkspacePathForDisplay(path?: string | null) {
  const value = path?.trim();
  if (!value) return null;

  const normalizedPath = normalizePathSeparators(value);
  const collapsedHomePath = normalizedPath.replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
  return value.includes("\\") ? collapsedHomePath.replace(/\//g, "\\") : collapsedHomePath;
}

function getWorkspaceName(path?: string) {
  const workspacePath = getWorkspacePath(path);
  if (!workspacePath) return "Browser drafts";

  const segments = workspacePath.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || workspacePath;
}

function getPathLeaf(path?: string | null) {
  const value = path?.trim();
  if (!value) return null;

  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || value;
}

function getSaveStateLabel(saveState: "idle" | "saving" | "error") {
  switch (saveState) {
    case "saving":
      return "Saving…";
    case "error":
      return "Save failed";
    default:
      return "Saved";
  }
}

function joinPath(basePath: string, relativePath: string) {
  const separator = basePath.includes("\\") ? "\\" : "/";
  const normalizedBasePath = basePath.endsWith(separator)
    ? basePath.slice(0, -1)
    : basePath;

  return relativePath
    .split("/")
    .filter(Boolean)
    .reduce((result, segment) => `${result}${separator}${segment}`, normalizedBasePath);
}

function getCanvasPageId(relativePath: string) {
  const normalizedPath = normalizePathSeparators(relativePath);
  if (normalizedPath.includes("/")) return null;
  return normalizedPath.replace(/\.md$/i, "");
}

function getContainingPath(pathValue: string) {
  const trimmedPath = pathValue.trim();
  if (!trimmedPath) return trimmedPath;

  const normalizedPath = trimmedPath.replace(/[\\/]+$/, "");
  if (!normalizedPath) return trimmedPath.startsWith("\\") ? "\\" : "/";

  const lastSeparatorIndex = Math.max(
    normalizedPath.lastIndexOf("/"),
    normalizedPath.lastIndexOf("\\")
  );

  if (lastSeparatorIndex < 0) return ".";
  if (lastSeparatorIndex === 0) return normalizedPath[0] === "\\" ? "\\" : "/";
  return normalizedPath.slice(0, lastSeparatorIndex);
}

function getOpenedFolderPath(pathValue: string) {
  const trimmedPath = pathValue.trim();
  if (!trimmedPath) return trimmedPath;

  return normalizePathSeparators(trimmedPath).toLowerCase().endsWith(".md")
    ? getContainingPath(trimmedPath)
    : trimmedPath.replace(/[\\/]+$/, "") || trimmedPath;
}

function getDocumentNavigationState(
  projectPath: string,
  relativePath: string,
  currentRawPath: string | null
): RequestedPathState {
  const relativeFolderPath = getContainingPath(relativePath);
  const nextFolderPath =
    relativeFolderPath === "." ? projectPath : joinPath(projectPath, relativeFolderPath);
  const shouldPreserveUrl =
    !!currentRawPath &&
    normalizePathSeparators(getOpenedFolderPath(currentRawPath)) ===
      normalizePathSeparators(nextFolderPath);

  return {
    rawPath: shouldPreserveUrl ? currentRawPath : joinPath(projectPath, relativePath),
    projectPath,
    documentPath: relativePath,
  };
}

function buildLocationForPath(path?: string | null) {
  const nextPath = path?.trim() || null;
  const url = new URL(window.location.href);

  if (nextPath) {
    if (!nextPath.includes("\\")) {
      url.pathname = nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
      url.searchParams.delete("path");
    } else {
      url.pathname = "/";
      url.searchParams.set("path", nextPath);
    }
  } else {
    url.searchParams.delete("path");
    url.pathname = "/";
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function syncProjectPathInUrl(projectPath?: string) {
  const nextLocation = buildLocationForPath(getWorkspacePath(projectPath));
  const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextLocation !== currentLocation) {
    window.history.replaceState(null, "", nextLocation);
  }
}

function syncRequestedPathInUrl(path?: string | null) {
  const nextLocation = buildLocationForPath(path);
  const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextLocation !== currentLocation) {
    window.history.replaceState(null, "", nextLocation);
  }
}

export function App() {
  const [requestedPathState, setRequestedPathState] = useState<RequestedPathState>(
    getRequestedPathState()
  );
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [allPages, setAllPages] = useState<Page[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [documentPage, setDocumentPage] = useState<Page | null>(null);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(
    requestedPathState.documentPath
  );
  const [viewMode, setViewMode] = useState<ViewMode>(
    requestedPathState.documentPath ? "document" : "canvas"
  );
  const [layout, setLayout] = useState<ProjectLayout>({ pages: {} });
  const [pathSwitcherDismissCount, setPathSwitcherDismissCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasRevealRequest, setCanvasRevealRequest] = useState<CanvasRevealRequest | null>(null);
  const [documentSaveState, setDocumentSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [documentToolbarHost, setDocumentToolbarHost] = useState<HTMLDivElement | null>(null);
  const [projectTreeVersion, setProjectTreeVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const backendRef = useRef<StorageBackend | null>(null);
  const layoutRef = useRef<ProjectLayout>({ pages: {} });
  const saveLayoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  backendRef.current = backend;
  layoutRef.current = layout;

  const loadProject = useCallback(async (nextBackend: StorageBackend) => {
    if (saveLayoutTimer.current) {
      clearTimeout(saveLayoutTimer.current);
      saveLayoutTimer.current = null;
    }

    const [pageList, project] = await Promise.all([
      nextBackend.listPages(),
      nextBackend.getProject(),
    ]);

    let pg: Page[];
    let proj = project;

    if (pageList.length === 0) {
      const page = await nextBackend.createPage(
        "Untitled",
        "# Welcome to Roughdraft\n\nStart writing. Your work is saved automatically.\n"
      );
      pg = [page];
      proj = await nextBackend.getProject();
    } else {
      pg = pageList;
    }

    let layoutChanged = false;
    for (const p of pg) {
      if (!proj.pages[p.id]) {
        const idx = Object.keys(proj.pages).length;
        proj.pages[p.id] = {
          x: idx * 720,
          y: 0,
          width: 680,
          height: 500,
        };
        layoutChanged = true;
      }
    }
    if (layoutChanged) {
      await nextBackend.saveProject(proj);
    }

    setAllPages(pg);
    setSelectedId(null);
    setPages(pg);
    setLayout(proj);
  }, []);

  const loadDocument = useCallback(async (nextBackend: StorageBackend, relativePath: string) => {
    const nextDocument = await nextBackend.getMarkdownFile(relativePath);
    setDocumentPage(nextDocument);
    setActiveDocumentPath(relativePath);
    return nextDocument;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      const detectedBackend = await detectBackend();
      if (cancelled) return;

      if (detectedBackend.canManageProjects) {
        const requestedProjectPath = requestedPathState.projectPath;
        if (
          requestedProjectPath &&
          requestedProjectPath !== getWorkspacePath(detectedBackend.info.projectPath)
        ) {
          try {
            await detectedBackend.openProject(requestedProjectPath);
          } catch (error) {
            console.error("Failed to open project from URL:", error);
          }
        }
      }

      if (requestedPathState.rawPath) {
        syncRequestedPathInUrl(requestedPathState.rawPath);
      } else {
        syncProjectPathInUrl(detectedBackend.info.projectPath);
      }

      setBackend(detectedBackend);
      await loadProject(detectedBackend);

      if (requestedPathState.documentPath) {
        const nextDocument = await loadDocument(detectedBackend, requestedPathState.documentPath);
        setSelectedId(nextDocument.id);
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
  }, [loadDocument, loadProject, requestedPathState.documentPath, requestedPathState.projectPath, requestedPathState.rawPath]);

  const handleSavePage = useCallback(async (id: string, content: string) => {
    await backendRef.current?.savePage(id, content);
    const updatePage = (page: Page) => {
      if (page.id !== id) return page;
      const firstLine = content.split("\n")[0] || "";
      const title = firstLine.replace(/^#*\s*/, "") || page.id;
      return { ...page, content, title };
    };
    setPages((prev) => prev.map(updatePage));
    setAllPages((prev) => prev.map(updatePage));
  }, []);

  const handleSaveDocument = useCallback(async (id: string, content: string) => {
    if (!activeDocumentPath) return;
    await backendRef.current?.saveMarkdownFile(activeDocumentPath, content);

    const firstLine = content.split("\n")[0] || "";
    const fallbackTitle = id.split("/").at(-1) || id;
    const title = firstLine.replace(/^#*\s*/, "") || fallbackTitle;

    setDocumentPage((prev) =>
      prev && prev.id === id
        ? {
            ...prev,
            content,
            title,
          }
        : prev
    );
    setPages((prev) => prev.map((page) => (page.id === id ? { ...page, content, title } : page)));
    setAllPages((prev) =>
      prev.map((page) => (page.id === id ? { ...page, content, title } : page))
    );
  }, [activeDocumentPath]);

  const handleReposition = useCallback((id: string, x: number, y: number) => {
    setLayout((prev) => {
      const entry = prev.pages[id] || { x: 0, y: 0, width: 680, height: 500 };
      const next = {
        ...prev,
        pages: { ...prev.pages, [id]: { ...entry, x, y } },
      };
      if (saveLayoutTimer.current) clearTimeout(saveLayoutTimer.current);
      saveLayoutTimer.current = setTimeout(() => {
        backendRef.current?.saveProject(layoutRef.current).catch((err) => {
          console.error("Failed to save layout:", err);
        });
      }, 300);
      return next;
    });
  }, []);

  const handleCreatePage = useCallback(async () => {
    if (!backendRef.current) return;
    const page = await backendRef.current.createPage("Untitled", "# Untitled\n");
    const proj = await backendRef.current.getProject();
    setAllPages((prev) => [...prev, page]);
    setPages((prev) => [...prev, page]);
    setLayout(proj);
    setSelectedId(page.id);
    setProjectTreeVersion((version) => version + 1);

    if (viewMode !== "document") return;

    const projectPath = backendRef.current.info.projectPath ?? requestedPathState.projectPath;
    const relativePath = `${page.id}.md`;

    setDocumentPage(page);
    setActiveDocumentPath(relativePath);
    setDocumentSaveState("idle");
    setCanvasRevealRequest(null);

    if (!projectPath) return;

    const nextPathState = getDocumentNavigationState(
      projectPath,
      relativePath,
      requestedPathState.rawPath
    );
    setRequestedPathState(nextPathState);
    syncRequestedPathInUrl(nextPathState.rawPath);
  }, [requestedPathState.projectPath, requestedPathState.rawPath, viewMode]);

  const handleDeletePage = useCallback(
    async (id: string) => {
      if (!backendRef.current) return;
      await backendRef.current.deletePage(id);
      setAllPages((prev) => prev.filter((p) => p.id !== id));
      setPages((prev) => prev.filter((p) => p.id !== id));
      setLayout((prev) => {
        const next = { ...prev, pages: { ...prev.pages } };
        delete next.pages[id];
        return next;
      });
      if (selectedId === id) setSelectedId(null);
      setProjectTreeVersion((version) => version + 1);
    },
    [selectedId]
  );

  const handleCanvasPointerDown = useCallback(() => {
    setSelectedId(null);
    setPathSwitcherDismissCount((count) => count + 1);
  }, []);

  const openDocumentInRegularMode = useCallback(
    async (relativePath: string) => {
      if (!backendRef.current) return;

      const projectPath = backendRef.current.info.projectPath ?? requestedPathState.projectPath;
      if (!projectPath) return;

      try {
        const nextDocument = await loadDocument(backendRef.current, relativePath);
        const nextPathState = getDocumentNavigationState(
          projectPath,
          relativePath,
          requestedPathState.rawPath
        );
        setRequestedPathState(nextPathState);
        syncRequestedPathInUrl(nextPathState.rawPath);
        setSelectedId(nextDocument.id);
        setCanvasRevealRequest(null);
      } catch (error) {
        console.error("Failed to open markdown file:", error);
      }

      setPathSwitcherDismissCount((count) => count + 1);
    },
    [loadDocument, requestedPathState.projectPath, requestedPathState.rawPath]
  );

  const revealMarkdownPageOnCanvas = useCallback(
    (relativePath: string) => {
      const pageId = getCanvasPageId(relativePath);
      if (!pageId) return false;

      const targetPage = allPages.find((page) => page.id === pageId);
      if (!targetPage) return false;

      const projectPath = backendRef.current?.info.projectPath ?? requestedPathState.projectPath;
      if (!projectPath) return false;

      setRequestedPathState({
        rawPath: projectPath,
        projectPath,
        documentPath: null,
      });
      syncProjectPathInUrl(projectPath);
      setSelectedId(pageId);
      setCanvasRevealRequest({
        pageId,
        key: `${pageId}:${Date.now()}`,
      });
      setPathSwitcherDismissCount((count) => count + 1);
      return true;
    },
    [allPages, requestedPathState.projectPath]
  );

  const handleOpenMarkdownPage = useCallback(
    async (relativePath: string) => {
      if (viewMode === "document") {
        await openDocumentInRegularMode(relativePath);
        return;
      }

      revealMarkdownPageOnCanvas(relativePath);
    },
    [openDocumentInRegularMode, revealMarkdownPageOnCanvas, viewMode]
  );

  const handleViewModeChange = useCallback(
    async (nextMode: ViewMode) => {
      if (nextMode === viewMode) return;

      setViewMode(nextMode);

      if (nextMode === "canvas") {
        const projectPath = backendRef.current?.info.projectPath ?? requestedPathState.projectPath;
        if (!projectPath) return;

        setRequestedPathState({
          rawPath: projectPath,
          projectPath,
          documentPath: null,
        });
        syncProjectPathInUrl(projectPath);

        if (activeDocumentPath && revealMarkdownPageOnCanvas(activeDocumentPath)) {
          return;
        }

        setCanvasRevealRequest(null);
        setSelectedId(null);
        return;
      }

      if (activeDocumentPath) {
        await openDocumentInRegularMode(activeDocumentPath);
        return;
      }

      if (selectedId && allPages.some((page) => page.id === selectedId)) {
        await openDocumentInRegularMode(`${selectedId}.md`);
        return;
      }

      const firstPage = allPages[0];
      if (firstPage) {
        await openDocumentInRegularMode(`${firstPage.id}.md`);
      }
    },
    [
      activeDocumentPath,
      allPages,
      openDocumentInRegularMode,
      requestedPathState.projectPath,
      revealMarkdownPageOnCanvas,
      selectedId,
      viewMode,
    ]
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-sm font-medium tracking-[0.18em] text-slate-200 uppercase">
        <p>Loading canvas...</p>
      </div>
    );
  }

  const documentAbsolutePath =
    activeDocumentPath && backend?.info.projectPath
      ? joinPath(backend.info.projectPath, activeDocumentPath)
      : requestedPathState.rawPath;
  const displayPath =
    viewMode === "document" && documentPage ? documentAbsolutePath : backend?.info.projectPath;
  const workspaceName = getWorkspaceName(displayPath ?? undefined);
  const isDocumentMode = viewMode === "document";
  const workspacePath =
    getWorkspacePath(backend?.info.projectPath ?? requestedPathState.projectPath ?? undefined) ??
    "Browser drafts";
  const workspacePathLabel = formatWorkspacePathForDisplay(workspacePath) ?? workspacePath;
  const selectedCanvasPath =
    selectedId && backend?.info.projectPath
      ? joinPath(backend.info.projectPath, `${selectedId}.md`)
      : null;
  const treeCurrentPath = isDocumentMode
    ? documentAbsolutePath
    : selectedCanvasPath ?? backend?.info.projectPath ?? displayPath;
  const firstPage = pages[0];
  const firstPageLayout = firstPage ? layout.pages[firstPage.id] : null;
  const firstPageFrame = firstPage
    ? {
        x: firstPageLayout?.x ?? 0,
        y: firstPageLayout?.y ?? 0,
        width: firstPageLayout?.width ?? 680,
        height: firstPageLayout?.height ?? 500,
      }
    : null;
  const initialWorldCenter = firstPageFrame
    ? {
        x: firstPageFrame.x + firstPageFrame.width / 2,
        y: firstPageFrame.y + firstPageFrame.height / 2,
      }
    : null;
  const initialWorldCenterKey = `${displayPath ?? "browser"}:${firstPage?.id ?? "none"}`;
  const revealedPageLayout = canvasRevealRequest ? layout.pages[canvasRevealRequest.pageId] : null;
  const revealedPageFrame =
    canvasRevealRequest && revealedPageLayout
      ? {
          x: revealedPageLayout.x,
          y: revealedPageLayout.y,
          width: revealedPageLayout.width,
          height: revealedPageLayout.height,
        }
      : null;
  const projectLabel = getPathLeaf(backend?.info.projectPath) ?? workspaceName;
  const documentName = getPathLeaf(activeDocumentPath) ?? documentPage?.title ?? "Untitled";
  const documentSaveStateClass =
    documentSaveState === "error"
      ? "text-rose-600"
      : documentSaveState === "saving"
        ? "text-slate-500"
        : "text-emerald-700";

  return (
    <div
      className="flex h-screen overflow-hidden bg-white text-slate-950"
    >
      <aside
        className={`flex h-full w-[320px] max-w-[34vw] min-w-[280px] shrink-0 flex-col border-r ${
          isDocumentMode ? "border-slate-200 bg-white" : "border-slate-200/80 bg-white"
        }`}
      >
        <div className={`border-b px-4 pt-5 pb-4 ${isDocumentMode ? "border-slate-200" : "border-slate-200/80"}`}>
          {backend ? (
            <PathSwitcher
              backend={backend}
              currentLabel={projectLabel}
              currentPath={displayPath ?? null}
              projectPath={backend.info.projectPath ?? null}
              buildLocationForPath={buildLocationForPath}
              dismissCount={pathSwitcherDismissCount}
              description={workspacePathLabel}
            />
          ) : (
            <div className="rounded-[14px] border border-slate-200/80 bg-white/80 px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
              <div className="truncate text-[0.95rem] font-semibold tracking-[-0.02em] text-slate-950">
                {projectLabel}
              </div>
              <div className="mt-1 truncate text-[0.74rem] text-slate-500">{workspacePathLabel}</div>
            </div>
          )}

          <div className="mt-4">
            <div className="grid h-9 grid-cols-2 rounded-[10px] border border-slate-200/80 bg-white/75 p-1 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
              <button
                type="button"
                className={`rounded-[8px] px-3 text-[0.82rem] font-semibold transition ${
                  viewMode === "canvas"
                    ? "bg-slate-900 text-white shadow-[0_6px_14px_rgba(15,23,42,0.18)]"
                    : "text-slate-600 hover:bg-slate-100/80"
                }`}
                onClick={() => void handleViewModeChange("canvas")}
              >
                Canvas
              </button>
              <button
                type="button"
                className={`rounded-[8px] px-3 text-[0.82rem] font-semibold transition ${
                  isDocumentMode
                    ? "bg-slate-900 text-white shadow-[0_6px_14px_rgba(15,23,42,0.18)]"
                    : "text-slate-600 hover:bg-slate-100/80"
                }`}
                onClick={() => void handleViewModeChange("document")}
              >
                Document
              </button>
            </div>
          </div>

          <div className="mt-3">
            <Button
              type="button"
              variant={isDocumentMode ? "outline" : "default"}
              className={`h-10 w-full justify-center rounded-[10px] border text-[0.84rem] font-semibold shadow-none ${
                isDocumentMode
                  ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  : "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
              }`}
              onClick={() => void handleCreatePage()}
              title={isDocumentMode ? "New document" : "New page"}
            >
              {isDocumentMode ? "+ New document" : "+ New page"}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {backend ? (
            <ProjectTreeSidebar
              backend={backend}
              projectPath={backend.info.projectPath ?? null}
              currentPath={treeCurrentPath ?? null}
              buildLocationForPath={buildLocationForPath}
              layout="embedded"
              refreshKey={projectTreeVersion}
              onOpenMarkdownPage={handleOpenMarkdownPage}
            />
          ) : null}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <div
          className="flex h-full flex-col overflow-hidden bg-white"
        >
          {isDocumentMode ? (
            <>
              <div className="border-b border-slate-200 bg-white/90 px-8 py-3 backdrop-blur">
                <div className="mx-auto flex w-full max-w-[880px] flex-col gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-[0.95rem] font-medium text-slate-900">
                        {documentName}
                      </div>
                      {activeDocumentPath && activeDocumentPath !== documentName ? (
                        <div className="truncate text-[0.78rem] text-slate-500">
                          {activeDocumentPath}
                        </div>
                      ) : null}
                    </div>
                    <div
                      className={`shrink-0 text-[0.72rem] font-semibold tracking-[0.12em] uppercase ${documentSaveStateClass}`}
                    >
                      {getSaveStateLabel(documentSaveState)}
                    </div>
                  </div>
                  <div ref={setDocumentToolbarHost} className="min-h-11 min-w-0" />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8 sm:px-12">
                <div className="mx-auto min-h-full max-w-[880px]">
                  {documentPage ? (
                    <PageCard
                      key={`${documentPage.id}:${activeDocumentPath ?? ""}`}
                      page={documentPage}
                      mode="document"
                      selected
                      canDelete={false}
                      onSave={handleSaveDocument}
                      onSaveStateChange={setDocumentSaveState}
                      documentToolbarHost={documentToolbarHost}
                      backend={backend!}
                    />
                  ) : (
                    <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500">
                      Select a markdown file from the sidebar.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <Canvas
              onPointerDownOnCanvas={handleCanvasPointerDown}
              initialWorldCenter={initialWorldCenter}
              initialWorldCenterKey={initialWorldCenterKey}
              focusedWorldFrame={revealedPageFrame}
              focusedWorldFrameKey={canvasRevealRequest?.key}
            >
              {pages.map((page) => {
                const pos = layout.pages[page.id] || { x: 0, y: 0 };
                return (
                  <PageCard
                    key={page.id}
                    page={page}
                    x={pos.x}
                    y={pos.y}
                    selected={selectedId === page.id}
                    focusRequestKey={
                      canvasRevealRequest?.pageId === page.id ? canvasRevealRequest.key : null
                    }
                    canDelete
                    onSelect={setSelectedId}
                    onSave={handleSavePage}
                    onReposition={handleReposition}
                    onDelete={handleDeletePage}
                    backend={backend!}
                  />
                );
              })}
            </Canvas>
          )}
        </div>
      </main>
    </div>
  );
}
