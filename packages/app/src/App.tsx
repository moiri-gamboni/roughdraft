import { useEffect, useState, useCallback, useRef } from "react";
import type { StorageBackend, Page, ProjectLayout } from "./storage";
import { detectBackend } from "./detect-backend";
import { Canvas } from "./Canvas";
import { PageCard } from "./PageCard";
import { PathSwitcher } from "./PathSwitcher";
import { ProjectTreeSidebar } from "./ProjectTreeSidebar";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";

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

const CANVAS_FRAME_WIDTH = 680;
const CANVAS_FRAME_WIDTH_WITH_RAIL = 960;

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
    return decodedPathname.startsWith("/")
      ? decodedPathname
      : `/${decodedPathname}`;
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

  const lastSlashIndex = Math.max(
    normalizedPath.lastIndexOf("/"),
    normalizedPath.lastIndexOf("\\"),
  );
  const projectPath =
    lastSlashIndex >= 0 ? rawPath.slice(0, lastSlashIndex) || "/" : ".";
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
  const collapsedHomePath = normalizedPath.replace(
    /^\/Users\/[^/]+(?=\/|$)/,
    "~",
  );
  return value.includes("\\")
    ? collapsedHomePath.replace(/\//g, "\\")
    : collapsedHomePath;
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

function hasCriticMarkupComments(content: string) {
  return content.includes("{>>");
}

function getCanvasFrameWidth(
  page: Page | null | undefined,
  fallbackWidth: number,
) {
  if (!page) return fallbackWidth;
  return hasCriticMarkupComments(page.content)
    ? CANVAS_FRAME_WIDTH_WITH_RAIL
    : fallbackWidth;
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
    .reduce(
      (result, segment) => `${result}${separator}${segment}`,
      normalizedBasePath,
    );
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
    normalizedPath.lastIndexOf("\\"),
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
  currentRawPath: string | null,
): RequestedPathState {
  const relativeFolderPath = getContainingPath(relativePath);
  const nextFolderPath =
    relativeFolderPath === "."
      ? projectPath
      : joinPath(projectPath, relativeFolderPath);
  const shouldPreserveUrl =
    !!currentRawPath &&
    normalizePathSeparators(getOpenedFolderPath(currentRawPath)) ===
      normalizePathSeparators(nextFolderPath);

  return {
    rawPath: shouldPreserveUrl
      ? currentRawPath
      : joinPath(projectPath, relativePath),
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

function getInstallCommand() {
  return "npx --yes roughdraft install";
}

function buildAgentInstallPrompt() {
  return [
    "Install Roughdraft on this machine and set it up for future markdown review workflows.",
    "",
    `1. Run \`${getInstallCommand()}\`.`,
    "2. Let the command update or create user-level `~/CLAUDE.md` and `~/AGENTS.md` with Roughdraft guidance.",
    "3. Confirm that the `roughdraft` command is available when you are done.",
    "4. Do not modify any project files as part of setup.",
  ].join("\n");
}

function Homepage({ onOpenDemo }: { onOpenDemo: () => void }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "prompt" | "command">(
    "idle",
  );
  const installCommand = getInstallCommand();
  const agentPrompt = buildAgentInstallPrompt();

  const copyText = useCallback(
    async (text: string, nextState: "prompt" | "command") => {
      try {
        await navigator.clipboard.writeText(text);
        setCopyState(nextState);
        window.setTimeout(() => {
          setCopyState((current) => (current === nextState ? "idle" : current));
        }, 1800);
      } catch (error) {
        console.error("Failed to copy text:", error);
        setCopyState("idle");
      }
    },
    [],
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(235,94,40,0.18),_transparent_28%),radial-gradient(circle_at_80%_20%,_rgba(15,23,42,0.12),_transparent_24%),linear-gradient(180deg,_#fcfaf6_0%,_#f3eee3_100%)] text-slate-950">
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute top-[-8rem] right-[-6rem] h-[24rem] w-[24rem] rounded-full bg-[radial-gradient(circle,_rgba(190,24,93,0.14),_transparent_62%)]" />
        <div className="absolute bottom-[-10rem] left-[-5rem] h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,_rgba(2,132,199,0.12),_transparent_60%)]" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 sm:px-10 lg:px-14">
        <header className="flex items-center justify-between gap-4">
          <div className="inline-flex items-center gap-3 rounded-full border border-slate-900/10 bg-white/70 px-4 py-2 shadow-[0_12px_40px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-[0.72rem] font-semibold tracking-[0.18em] text-white uppercase">
              Rd
            </div>
            <div>
              <div className="text-[0.76rem] font-semibold tracking-[0.24em] text-slate-500 uppercase">
                Roughdraft
              </div>
              <div className="text-sm font-medium text-slate-950">
                Markdown review for AI workflows
              </div>
            </div>
          </div>

          <button
            type="button"
            className="rounded-full border border-slate-900/10 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 shadow-[0_12px_40px_rgba(15,23,42,0.08)] backdrop-blur transition hover:border-slate-900/20 hover:text-slate-950"
            onClick={onOpenDemo}
          >
            Try the demo
          </button>
        </header>

        <main className="flex flex-1 items-center py-12 lg:py-16">
          <div className="grid w-full gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-center">
            <section className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/60 bg-amber-100/80 px-3 py-1 text-[0.77rem] font-semibold tracking-[0.16em] text-amber-900 uppercase shadow-[0_10px_30px_rgba(217,119,6,0.12)]">
                Install through your agent
              </div>
              <h1 className="mt-6 max-w-4xl text-5xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-6xl lg:text-7xl">
                Paste one prompt.
                <br />
                Let your agent wire up the rest.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-700 sm:text-xl">
                Roughdraft turns markdown review into a local workflow your
                agent can actually use. Install it, teach your agent to open
                `.md` files in Roughdraft, and keep comments, revisions, and
                final edits in normal markdown on disk.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  size="lg"
                  className="h-12 rounded-full bg-slate-950 px-6 text-sm font-semibold text-white hover:bg-slate-800"
                  onClick={() => setDialogOpen(true)}
                >
                  Install Now
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="h-12 rounded-full border-slate-300 bg-white/70 px-6 text-sm font-semibold text-slate-700 hover:bg-white"
                  onClick={onOpenDemo}
                >
                  Open browser demo
                </Button>
              </div>

              <div className="mt-10 grid gap-4 sm:grid-cols-3">
                <div className="rounded-[28px] border border-white/70 bg-white/72 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
                  <div className="text-[0.72rem] font-semibold tracking-[0.18em] text-slate-500 uppercase">
                    01
                  </div>
                  <p className="mt-3 text-base font-medium tracking-[-0.02em] text-slate-950">
                    Run one `npx` install command.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    It installs the CLI and appends a marked Roughdraft block to
                    your user-level agent docs.
                  </p>
                </div>
                <div className="rounded-[28px] border border-white/70 bg-white/72 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
                  <div className="text-[0.72rem] font-semibold tracking-[0.18em] text-slate-500 uppercase">
                    02
                  </div>
                  <p className="mt-3 text-base font-medium tracking-[-0.02em] text-slate-950">
                    Ask your agent to open the doc.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    The guidance tells it to prefer `roughdraft` whenever you
                    want to review or comment on markdown.
                  </p>
                </div>
                <div className="rounded-[28px] border border-white/70 bg-white/72 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
                  <div className="text-[0.72rem] font-semibold tracking-[0.18em] text-slate-500 uppercase">
                    03
                  </div>
                  <p className="mt-3 text-base font-medium tracking-[-0.02em] text-slate-950">
                    Leave comments in normal markdown.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Roughdraft keeps everything local and agent-friendly, so the
                    next pass can happen on the same files.
                  </p>
                </div>
              </div>
            </section>

            <section className="relative">
              <div className="absolute inset-x-8 top-8 h-full rounded-[34px] bg-slate-950/8 blur-3xl" />
              <div className="relative overflow-hidden rounded-[34px] border border-slate-900/10 bg-[#171717] p-5 text-slate-100 shadow-[0_24px_90px_rgba(15,23,42,0.25)]">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-rose-400" />
                  <span className="h-3 w-3 rounded-full bg-amber-300" />
                  <span className="h-3 w-3 rounded-full bg-emerald-400" />
                  <div className="ml-3 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[0.72rem] tracking-[0.18em] text-slate-400 uppercase">
                    Agent setup preview
                  </div>
                </div>

                <div className="mt-5 rounded-[24px] border border-white/8 bg-black/25 p-4">
                  <div className="text-[0.72rem] font-semibold tracking-[0.16em] text-slate-500 uppercase">
                    Prompt
                  </div>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm leading-7 text-slate-100">
                    {agentPrompt}
                  </pre>
                </div>

                <div className="mt-4 rounded-[24px] border border-white/8 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[0.72rem] font-semibold tracking-[0.16em] text-slate-500 uppercase">
                        Install command
                      </div>
                      <code className="mt-2 block text-sm leading-6 text-slate-100">
                        {installCommand}
                      </code>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[20px] border border-white/8 bg-white/5 p-4">
                    <div className="text-sm font-medium text-white">
                      Updates user guidance
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Appends a managed Roughdraft block to `~/CLAUDE.md` and
                      `~/AGENTS.md` if it is not already there.
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/5 p-4">
                    <div className="text-sm font-medium text-white">
                      Keeps the workflow local
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Your agent opens files with `roughdraft`, and the markdown
                      stays on your machine.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl rounded-[28px] border border-slate-200 bg-[#faf7f1] p-0 text-slate-950 shadow-[0_32px_120px_rgba(15,23,42,0.28)]">
          <div className="border-b border-slate-200 px-6 py-5 sm:px-8">
            <DialogHeader className="gap-2">
              <DialogTitle className="text-2xl font-semibold tracking-[-0.04em] text-slate-950">
                Copy this prompt into Claude Code or another local agent
              </DialogTitle>
              <DialogDescription className="max-w-2xl text-sm leading-6 text-slate-600">
                The prompt tells the agent to run `npx --yes roughdraft
                install`, verify the `roughdraft` CLI, and update `~/CLAUDE.md`
                plus `~/AGENTS.md` with Roughdraft guidance.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="space-y-5 px-6 py-6 sm:px-8">
            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[0.72rem] font-semibold tracking-[0.18em] text-slate-500 uppercase">
                    Agent prompt
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    Paste this as-is into the agent.
                  </div>
                </div>
                <Button
                  type="button"
                  size="lg"
                  className="h-10 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800"
                  onClick={() => void copyText(agentPrompt, "prompt")}
                >
                  {copyState === "prompt" ? "Copied prompt" : "Copy prompt"}
                </Button>
              </div>
              <textarea
                readOnly
                value={agentPrompt}
                className="min-h-[220px] w-full resize-none rounded-[18px] border border-slate-200 bg-[#fcfbf8] p-4 text-sm leading-6 text-slate-800 outline-none"
              />
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[0.72rem] font-semibold tracking-[0.18em] text-slate-500 uppercase">
                    Direct install command
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    For users who want to run it manually.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-10 rounded-full border-slate-300 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => void copyText(installCommand, "command")}
                >
                  {copyState === "command" ? "Copied command" : "Copy command"}
                </Button>
              </div>
              <code className="block overflow-x-auto rounded-[18px] bg-slate-950 px-4 py-4 text-sm leading-6 text-slate-100">
                {installCommand}
              </code>
            </div>
          </div>

          <DialogFooter className="border-t border-slate-200 px-6 py-4 sm:px-8">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-10 rounded-full border-slate-300 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={onOpenDemo}
            >
              Open browser demo
            </Button>
            <Button
              type="button"
              size="lg"
              className="h-10 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={() => setDialogOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
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
  const [requestedPathState, setRequestedPathState] =
    useState<RequestedPathState>(getRequestedPathState());
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [allPages, setAllPages] = useState<Page[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [documentPage, setDocumentPage] = useState<Page | null>(null);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(
    requestedPathState.documentPath,
  );
  const [viewMode, setViewMode] = useState<ViewMode>(
    requestedPathState.documentPath ? "document" : "canvas",
  );
  const [layout, setLayout] = useState<ProjectLayout>({ pages: {} });
  const [pathSwitcherDismissCount, setPathSwitcherDismissCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [canvasRevealRequest, setCanvasRevealRequest] =
    useState<CanvasRevealRequest | null>(null);
  const [documentSaveState, setDocumentSaveState] = useState<
    "idle" | "saving" | "error"
  >("idle");
  const [documentToolbarHost, setDocumentToolbarHost] =
    useState<HTMLDivElement | null>(null);
  const [projectTreeVersion, setProjectTreeVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [demoModeEnabled, setDemoModeEnabled] = useState(false);
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
        "# Welcome to Roughdraft\n\nStart writing. Your work is saved automatically.\n",
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

  const loadDocument = useCallback(
    async (nextBackend: StorageBackend, relativePath: string) => {
      const nextDocument = await nextBackend.getMarkdownFile(relativePath);
      setDocumentPage(nextDocument);
      setActiveDocumentPath(relativePath);
      return nextDocument;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      const detectedBackend = await detectBackend();
      if (cancelled) return;

      if (detectedBackend.canManageProjects) {
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

      if (requestedPathState.rawPath) {
        syncRequestedPathInUrl(requestedPathState.rawPath);
      } else {
        syncProjectPathInUrl(detectedBackend.info.projectPath);
      }

      setBackend(detectedBackend);
      await loadProject(detectedBackend);

      if (requestedPathState.documentPath) {
        const nextDocument = await loadDocument(
          detectedBackend,
          requestedPathState.documentPath,
        );
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
  }, [
    loadDocument,
    loadProject,
    requestedPathState.documentPath,
    requestedPathState.projectPath,
    requestedPathState.rawPath,
  ]);

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

  const handleSaveDocument = useCallback(
    async (id: string, content: string) => {
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
          : prev,
      );
      setPages((prev) =>
        prev.map((page) =>
          page.id === id ? { ...page, content, title } : page,
        ),
      );
      setAllPages((prev) =>
        prev.map((page) =>
          page.id === id ? { ...page, content, title } : page,
        ),
      );
    },
    [activeDocumentPath],
  );

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
    const page = await backendRef.current.createPage(
      "Untitled",
      "# Untitled\n",
    );
    const proj = await backendRef.current.getProject();
    setAllPages((prev) => [...prev, page]);
    setPages((prev) => [...prev, page]);
    setLayout(proj);
    setSelectedId(page.id);
    setProjectTreeVersion((version) => version + 1);

    if (viewMode !== "document") return;

    const projectPath =
      backendRef.current.info.projectPath ?? requestedPathState.projectPath;
    const relativePath = `${page.id}.md`;

    setDocumentPage(page);
    setActiveDocumentPath(relativePath);
    setDocumentSaveState("idle");
    setCanvasRevealRequest(null);

    if (!projectPath) return;

    const nextPathState = getDocumentNavigationState(
      projectPath,
      relativePath,
      requestedPathState.rawPath,
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
    [selectedId],
  );

  const handleCanvasPointerDown = useCallback(() => {
    setSelectedId(null);
    setPathSwitcherDismissCount((count) => count + 1);
  }, []);

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
        const nextPathState = getDocumentNavigationState(
          projectPath,
          relativePath,
          requestedPathState.rawPath,
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
    [loadDocument, requestedPathState.projectPath, requestedPathState.rawPath],
  );

  const revealMarkdownPageOnCanvas = useCallback(
    (relativePath: string) => {
      const pageId = getCanvasPageId(relativePath);
      if (!pageId) return false;

      const targetPage = allPages.find((page) => page.id === pageId);
      if (!targetPage) return false;

      const projectPath =
        backendRef.current?.info.projectPath ?? requestedPathState.projectPath;
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
    [allPages, requestedPathState.projectPath],
  );

  const handleOpenMarkdownPage = useCallback(
    async (relativePath: string) => {
      if (viewMode === "document") {
        await openDocumentInRegularMode(relativePath);
        return;
      }

      revealMarkdownPageOnCanvas(relativePath);
    },
    [openDocumentInRegularMode, revealMarkdownPageOnCanvas, viewMode],
  );

  const handleViewModeChange = useCallback(
    async (nextMode: ViewMode) => {
      if (nextMode === viewMode) return;

      setViewMode(nextMode);

      if (nextMode === "canvas") {
        const projectPath =
          backendRef.current?.info.projectPath ??
          requestedPathState.projectPath;
        if (!projectPath) return;

        setRequestedPathState({
          rawPath: projectPath,
          projectPath,
          documentPath: null,
        });
        syncProjectPathInUrl(projectPath);

        if (
          activeDocumentPath &&
          revealMarkdownPageOnCanvas(activeDocumentPath)
        ) {
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
    ],
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-sm font-medium tracking-[0.18em] text-slate-200 uppercase">
        <p>Loading canvas...</p>
      </div>
    );
  }

  const shouldShowHomepage =
    backend?.info.kind === "local-storage" &&
    !requestedPathState.rawPath &&
    !demoModeEnabled;

  if (shouldShowHomepage) {
    return <Homepage onOpenDemo={() => setDemoModeEnabled(true)} />;
  }

  const documentAbsolutePath =
    activeDocumentPath && backend?.info.projectPath
      ? joinPath(backend.info.projectPath, activeDocumentPath)
      : requestedPathState.rawPath;
  const displayPath =
    viewMode === "document" && documentPage
      ? documentAbsolutePath
      : backend?.info.projectPath;
  const workspaceName = getWorkspaceName(displayPath ?? undefined);
  const isDocumentMode = viewMode === "document";
  const workspacePath =
    getWorkspacePath(
      backend?.info.projectPath ?? requestedPathState.projectPath ?? undefined,
    ) ?? "Browser drafts";
  const workspacePathLabel =
    formatWorkspacePathForDisplay(workspacePath) ?? workspacePath;
  const selectedCanvasPath =
    selectedId && backend?.info.projectPath
      ? joinPath(backend.info.projectPath, `${selectedId}.md`)
      : null;
  const treeCurrentPath = isDocumentMode
    ? documentAbsolutePath
    : (selectedCanvasPath ?? backend?.info.projectPath ?? displayPath);
  const firstPage = pages[0];
  const firstPageLayout = firstPage ? layout.pages[firstPage.id] : null;
  const firstPageFrame = firstPage
    ? {
        x: firstPageLayout?.x ?? 0,
        y: firstPageLayout?.y ?? 0,
        width: getCanvasFrameWidth(
          firstPage,
          firstPageLayout?.width ?? CANVAS_FRAME_WIDTH,
        ),
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
  const revealedPageLayout = canvasRevealRequest
    ? layout.pages[canvasRevealRequest.pageId]
    : null;
  const revealedPage = canvasRevealRequest
    ? pages.find((page) => page.id === canvasRevealRequest.pageId)
    : null;
  const revealedPageFrame =
    canvasRevealRequest && revealedPageLayout
      ? {
          x: revealedPageLayout.x,
          y: revealedPageLayout.y,
          width: getCanvasFrameWidth(revealedPage, revealedPageLayout.width),
          height: revealedPageLayout.height,
        }
      : null;
  const projectLabel = getPathLeaf(backend?.info.projectPath) ?? workspaceName;
  const documentName =
    getPathLeaf(activeDocumentPath) ?? documentPage?.title ?? "Untitled";
  const documentSaveStateClass =
    documentSaveState === "error"
      ? "text-rose-600"
      : documentSaveState === "saving"
        ? "text-slate-500"
        : "text-emerald-700";

  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-950">
      <aside
        className={`flex h-full w-[320px] max-w-[34vw] min-w-[280px] shrink-0 flex-col border-r ${
          isDocumentMode
            ? "border-slate-200 bg-white"
            : "border-slate-200/80 bg-white"
        }`}
      >
        <div
          className={`border-b px-4 pt-5 pb-4 ${isDocumentMode ? "border-slate-200" : "border-slate-200/80"}`}
        >
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
              <div className="mt-1 truncate text-[0.74rem] text-slate-500">
                {workspacePathLabel}
              </div>
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
        <div className="flex h-full flex-col overflow-hidden bg-white">
          {isDocumentMode ? (
            <>
              <div className="border-b border-slate-200 bg-white/90 px-8 py-3 backdrop-blur">
                <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="truncate text-[0.95rem] font-medium text-slate-900">
                        {documentName}
                      </div>
                      {activeDocumentPath &&
                      activeDocumentPath !== documentName ? (
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
                  <div
                    ref={setDocumentToolbarHost}
                    className="min-h-11 min-w-0"
                  />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8 sm:px-12">
                <div className="mx-auto min-h-full max-w-[1080px]">
                  {documentPage ? (
                    backend ? (
                      <PageCard
                        key={`${documentPage.id}:${activeDocumentPath ?? ""}`}
                        page={documentPage}
                        mode="document"
                        selected
                        canDelete={false}
                        onSave={handleSaveDocument}
                        onSaveStateChange={setDocumentSaveState}
                        documentToolbarHost={documentToolbarHost}
                        backend={backend}
                      />
                    ) : null
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
                if (!backend) return null;

                return (
                  <PageCard
                    key={page.id}
                    page={page}
                    x={pos.x}
                    y={pos.y}
                    selected={selectedId === page.id}
                    focusRequestKey={
                      canvasRevealRequest?.pageId === page.id
                        ? canvasRevealRequest.key
                        : null
                    }
                    canDelete
                    onSelect={setSelectedId}
                    onSave={handleSavePage}
                    onReposition={handleReposition}
                    onDelete={handleDeletePage}
                    backend={backend}
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
