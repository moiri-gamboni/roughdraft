import {
  FileTree as FileTreeModel,
  preparePresortedFileTreeInput,
} from "@pierre/trees";
import { FileTree as FileTreeView } from "@pierre/trees/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { ProjectTreeListing, StorageBackend } from "./storage";

interface ProjectTreeSidebarProps {
  backend: StorageBackend;
  projectPath: string | null;
  currentPath: string | null;
  buildLocationForPath: (path?: string | null) => string;
  layout?: "floating" | "docked" | "embedded";
  refreshKey?: number;
  onOpenMarkdownPage?: (relativePath: string) => void;
}

interface ProjectTreePanelProps {
  projectPath: string;
  currentPath: string | null;
  listing: ProjectTreeListing;
  buildLocationForPath: (path?: string | null) => string;
  layout?: "floating" | "docked" | "embedded";
  onOpenMarkdownPage?: (relativePath: string) => void;
}

const UNSUPPORTED_FILE_TOOLTIP = "only markdown files are supported";

function toSlashPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function toCanonicalRelativePath(
  projectPath: string,
  currentPath: string | null,
): string | null {
  if (!currentPath) return null;

  const normalizedProjectPath = toSlashPath(projectPath).replace(/\/+$/, "");
  const normalizedCurrentPath = toSlashPath(currentPath).replace(/\/+$/, "");

  if (normalizedCurrentPath === normalizedProjectPath) return null;
  if (!normalizedCurrentPath.startsWith(`${normalizedProjectPath}/`))
    return null;

  return normalizedCurrentPath.slice(normalizedProjectPath.length + 1);
}

function joinProjectPath(projectPath: string, relativePath: string): string {
  const separator = projectPath.includes("\\") ? "\\" : "/";
  const normalizedProjectPath = projectPath.endsWith(separator)
    ? projectPath.slice(0, -1)
    : projectPath;

  return relativePath
    .split("/")
    .filter(Boolean)
    .reduce(
      (result, segment) => `${result}${separator}${segment}`,
      normalizedProjectPath,
    );
}

function getInitialExpandedPaths(activePath: string | null): string[] {
  if (!activePath) return [];

  const segments = activePath.replace(/\/$/, "").split("/").filter(Boolean);
  const directorySegments = activePath.endsWith("/")
    ? segments
    : segments.slice(0, -1);
  const expandedPaths: string[] = [];

  for (let index = 0; index < directorySegments.length; index += 1) {
    expandedPaths.push(`${directorySegments.slice(0, index + 1).join("/")}/`);
  }

  return expandedPaths;
}

function openSelectedPath(
  projectPath: string,
  relativePath: string,
  buildLocationForPath: ProjectTreeSidebarProps["buildLocationForPath"],
  onOpenMarkdownPage?: ProjectTreeSidebarProps["onOpenMarkdownPage"],
): void {
  if (relativePath.endsWith("/")) return;

  if (isMarkdownPath(relativePath)) {
    if (onOpenMarkdownPage) {
      onOpenMarkdownPage(relativePath);
      return;
    }

    window.location.assign(
      buildLocationForPath(joinProjectPath(projectPath, relativePath)),
    );
    return;
  }
}

function useStableFileTreeModel(
  options: ConstructorParameters<typeof FileTreeModel>[0],
): FileTreeModel {
  const modelRef = useRef<FileTreeModel | null>(null);
  const cleanupTimerRef = useRef<number | null>(null);

  if (!modelRef.current) {
    modelRef.current = new FileTreeModel(options);
  }

  useEffect(() => {
    if (cleanupTimerRef.current !== null) {
      window.clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }

    return () => {
      const model = modelRef.current;
      cleanupTimerRef.current = window.setTimeout(() => {
        if (modelRef.current === model) {
          model?.cleanUp();
          modelRef.current = null;
        }
        cleanupTimerRef.current = null;
      }, 0);
    };
  }, []);

  return modelRef.current;
}

function ProjectTreePanel({
  projectPath,
  currentPath,
  listing,
  buildLocationForPath,
  layout = "floating",
  onOpenMarkdownPage,
}: ProjectTreePanelProps) {
  const activePath = toCanonicalRelativePath(projectPath, currentPath);
  const [preparedInput] = useState(() =>
    preparePresortedFileTreeInput(listing.paths),
  );
  const [initialExpandedPaths] = useState(() =>
    getInitialExpandedPaths(activePath),
  );
  const treeWrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrapper = treeWrapperRef.current;
    const hostElement = wrapper?.querySelector("file-tree-container");
    const shadowRoot = hostElement?.shadowRoot;

    if (!hostElement || !shadowRoot) return;

    const updateUnsupportedFileRows = () => {
      shadowRoot
        .querySelectorAll<HTMLElement>('[data-type="item"][data-item-path]')
        .forEach((rowElement) => {
          const rowPath = rowElement.dataset.itemPath;
          const isUnsupportedFile =
            !!rowPath && !rowPath.endsWith("/") && !isMarkdownPath(rowPath);

          if (isUnsupportedFile) {
            rowElement.dataset.unsupportedFile = "true";
            rowElement.setAttribute("title", UNSUPPORTED_FILE_TOOLTIP);
            rowElement.setAttribute("aria-disabled", "true");
            rowElement.style.cursor = "not-allowed";
            return;
          }

          rowElement.removeAttribute("data-unsupported-file");
          rowElement.removeAttribute("title");
          rowElement.removeAttribute("aria-disabled");
          rowElement.style.removeProperty("cursor");
        });
    };

    const handleBlockedInteraction = (event: Event) => {
      const rowElement = event
        .composedPath()
        .find(
          (entry): entry is HTMLElement =>
            entry instanceof HTMLElement &&
            entry.dataset.type === "item" &&
            !!entry.dataset.itemPath,
        );

      const nextPath = rowElement?.dataset.itemPath;
      if (!nextPath || nextPath.endsWith("/") || isMarkdownPath(nextPath))
        return;

      event.preventDefault();
      event.stopPropagation();
    };

    updateUnsupportedFileRows();

    const observer = new MutationObserver(() => {
      updateUnsupportedFileRows();
    });

    observer.observe(shadowRoot, {
      childList: true,
      subtree: true,
    });

    hostElement.addEventListener("mousedown", handleBlockedInteraction, true);
    hostElement.addEventListener("click", handleBlockedInteraction, true);

    return () => {
      observer.disconnect();
      hostElement.removeEventListener(
        "mousedown",
        handleBlockedInteraction,
        true,
      );
      hostElement.removeEventListener("click", handleBlockedInteraction, true);
    };
  }, []);

  const handleTreeClick = (event: React.MouseEvent<HTMLElement>) => {
    const rowElement = event.nativeEvent
      .composedPath()
      .find(
        (entry): entry is HTMLElement =>
          entry instanceof HTMLElement &&
          entry.dataset.type === "item" &&
          !!entry.dataset.itemPath,
      );

    const nextPath = rowElement?.dataset.itemPath;
    if (!nextPath || nextPath.endsWith("/")) return;

    openSelectedPath(
      projectPath,
      nextPath,
      buildLocationForPath,
      onOpenMarkdownPage,
    );
  };

  const model = useStableFileTreeModel({
    preparedInput,
    initialExpansion: 1,
    initialExpandedPaths,
    initialSelectedPaths: activePath ? [activePath] : undefined,
    itemHeight: 30,
    overscan: 10,
    icons: { set: "complete", colored: true },
    onSelectionChange: (selectedPaths) => {
      const nextPath = selectedPaths[0];
      if (!nextPath || nextPath === activePath) return;
      openSelectedPath(
        projectPath,
        nextPath,
        buildLocationForPath,
        onOpenMarkdownPage,
      );
    },
  });

  return (
    <div
      ref={treeWrapperRef}
      className={`flex min-h-0 flex-1 overflow-hidden ${
        layout === "embedded"
          ? "bg-transparent"
          : "rounded-[22px] border border-slate-200/80 bg-white/70"
      }`}
    >
      <FileTreeView
        className="block h-full w-full"
        model={model}
        onClick={handleTreeClick}
        style={
          {
            height: "100%",
            width: "100%",
            "--trees-bg-override": "transparent",
            "--trees-bg-muted-override":
              layout === "embedded"
                ? "rgba(241, 245, 249, 1)"
                : "rgba(241, 245, 249, 0.78)",
            "--trees-border-color-override":
              layout === "embedded"
                ? "rgba(226, 232, 240, 1)"
                : "rgba(226, 232, 240, 0.78)",
            "--trees-fg-override": "rgb(15 23 42)",
            "--trees-fg-muted-override": "rgb(100 116 139)",
            "--trees-selected-bg-override": "rgba(15, 23, 42, 0.08)",
            "--trees-selected-fg-override": "rgb(15 23 42)",
            "--trees-selected-focused-border-color-override":
              "rgba(15, 23, 42, 0.14)",
            "--trees-font-family-override":
              '"SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif',
            "--trees-font-size-override": "13px",
            "--trees-border-radius-override":
              layout === "embedded" ? "0px" : "14px",
            "--trees-padding-inline-override":
              layout === "embedded" ? "8px" : "10px",
          } as React.CSSProperties
        }
      />
    </div>
  );
}

export function ProjectTreeSidebar({
  backend,
  projectPath,
  currentPath,
  buildLocationForPath,
  layout = "floating",
  refreshKey = 0,
  onOpenMarkdownPage,
}: ProjectTreeSidebarProps) {
  const [listing, setListing] = useState<ProjectTreeListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is an intentional rerun trigger from the parent.
  useEffect(() => {
    if (!backend.canManageProjects || !projectPath) {
      setListing(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadListing = async () => {
      setLoading(true);
      setError(null);

      try {
        const nextListing = await backend.listProjectTree();
        if (!cancelled) {
          setListing(nextListing);
        }
      } catch (loadError) {
        console.error(loadError);
        if (!cancelled) {
          setListing(null);
          setError("Could not load the folder tree.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadListing();

    return () => {
      cancelled = true;
    };
  }, [backend, projectPath, refreshKey]);

  if (!backend.canManageProjects || !projectPath) {
    return null;
  }

  const asideClassName =
    layout === "embedded"
      ? "flex h-full min-h-0 flex-col overflow-hidden bg-transparent"
      : layout === "docked"
        ? "flex h-full w-full flex-col rounded-[28px] border border-slate-200/80 bg-white/80 p-3 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur-xl"
        : "fixed top-[98px] left-[40px] z-[105] flex h-[min(68vh,640px)] w-[min(360px,calc(100vw-40px))] max-w-[calc(100vw-40px)] flex-col rounded-[28px] border border-slate-200/80 bg-white/92 p-3 shadow-[0_18px_48px_rgba(15,23,42,0.14)] backdrop-blur-xl";

  return (
    <aside className={asideClassName}>
      {loading ? (
        <div
          className={`flex min-h-0 flex-1 items-center justify-center px-4 text-sm text-slate-500 ${
            layout === "embedded"
              ? "bg-transparent pb-4"
              : "rounded-[22px] border border-slate-200/80 bg-white/70"
          }`}
        >
          Loading folder tree...
        </div>
      ) : error ? (
        <div
          className={`flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-slate-500 ${
            layout === "embedded"
              ? "bg-transparent pb-4"
              : "rounded-[22px] border border-slate-200/80 bg-white/70"
          }`}
        >
          {error}
        </div>
      ) : listing && listing.paths.length > 0 ? (
        <ProjectTreePanel
          key={`${projectPath}:${currentPath ?? ""}:${listing.paths.length}`}
          projectPath={projectPath}
          currentPath={currentPath}
          listing={listing}
          buildLocationForPath={buildLocationForPath}
          layout={layout}
          onOpenMarkdownPage={onOpenMarkdownPage}
        />
      ) : (
        <div
          className={`flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-slate-500 ${
            layout === "embedded"
              ? "bg-transparent pb-4"
              : "rounded-[22px] border border-slate-200/80 bg-white/70"
          }`}
        >
          No files or folders in this location.
        </div>
      )}
    </aside>
  );
}
