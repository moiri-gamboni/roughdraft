import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Folder } from "lucide-react";
import type { StorageBackend } from "./storage";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { UpdateNotice } from "./UpdateNotice";
import {
  getFileSystemBrowserError,
  useFileSystemBrowser,
} from "./file-system-browser";
import type { UpdateStatus } from "./update-status";

interface HomeScreenProps {
  backend: StorageBackend | null;
  buildLocationForPath: (path?: string | null) => string;
  onOpenDemo: () => void;
  updateStatus: UpdateStatus | null;
}

const disabledBackend: StorageBackend = {
  info: {
    kind: "local-storage",
    label: "Browser storage",
    detail: "Saved in this browser only",
  },
  canManageProjects: false,
  listPages: async () => [],
  getPage: async () => {
    throw new Error("Unavailable");
  },
  getMarkdownFile: async () => {
    throw new Error("Unavailable");
  },
  savePage: async () => {},
  saveMarkdownFile: async () => undefined,
  createPage: async () => {
    throw new Error("Unavailable");
  },
  deletePage: async () => {},
  saveAsset: async () => {
    throw new Error("Unavailable");
  },
  resolveFileUrl: () => null,
  listDirectories: async () => {
    throw new Error("Unavailable");
  },
  listFileSystem: async () => {
    throw new Error("Unavailable");
  },
  listProjectTree: async () => ({ paths: [] }),
  openProject: async () => {},
  createProject: async () => {},
};

function BrowserPanel({
  backend,
  buildLocationForPath,
  onOpenDemo,
}: {
  backend: StorageBackend | null;
  buildLocationForPath: HomeScreenProps["buildLocationForPath"];
  onOpenDemo: HomeScreenProps["onOpenDemo"];
}) {
  const {
    rootListing,
    rootLoading,
    rootError,
    listingsByPath,
    loadingPaths,
    errorByPath,
    loadListing,
  } = useFileSystemBrowser(backend ?? disabledBackend);
  const [activeDirectoryPath, setActiveDirectoryPath] = useState<string | null>(
    null,
  );
  const [manualPath, setManualPath] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    if (!backend?.canManageProjects) return;

    let cancelled = false;
    void loadListing().then((listing) => {
      if (!cancelled && listing) {
        setActiveDirectoryPath((current) => current ?? listing.path);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [backend?.canManageProjects, loadListing]);

  const activeListing =
    (activeDirectoryPath && listingsByPath[activeDirectoryPath]) || rootListing;
  const activePathKey = activeListing?.path ?? "";
  const listingError = activePathKey ? errorByPath[activePathKey] : null;
  const listingLoading = activePathKey
    ? loadingPaths.has(activePathKey)
    : false;

  const openPath = useCallback(
    (path: string) => {
      window.location.assign(buildLocationForPath(path));
    },
    [buildLocationForPath],
  );

  const browseDirectory = useCallback(
    async (path: string) => {
      const listing = await loadListing(path);
      if (listing) {
        setActiveDirectoryPath(listing.path);
      }
    },
    [loadListing],
  );

  const handleOpenManualPath = useCallback(() => {
    const trimmedPath = manualPath.trim();
    if (!trimmedPath) {
      setManualError("Enter an absolute file or folder path.");
      return;
    }

    setManualError(null);
    openPath(trimmedPath);
  }, [manualPath, openPath]);

  const handleBrowseParent = useCallback(async () => {
    if (!activeListing?.parentPath) return;
    await browseDirectory(activeListing.parentPath);
  }, [activeListing?.parentPath, browseDirectory]);

  if (!backend?.canManageProjects) {
    return (
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-sm leading-6 text-slate-600">
          Local filesystem access is unavailable in this session.
        </p>
        <Button
          type="button"
          className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
          onClick={onOpenDemo}
        >
          Open demo workspace
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          value={manualPath}
          onChange={(event) => setManualPath(event.currentTarget.value)}
          placeholder="/absolute/path/to/file.md"
          className="h-10 rounded-lg border-slate-300 bg-white px-3 text-sm md:text-sm"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleOpenManualPath();
            }
          }}
        />
        <Button
          type="button"
          className="h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
          onClick={handleOpenManualPath}
        >
          Open
        </Button>
      </div>

      {manualError ? (
        <div className="text-sm text-rose-600">{manualError}</div>
      ) : null}

      <div className="flex items-center gap-3 text-sm text-slate-500">
        {activeListing?.parentPath ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 text-slate-600 hover:text-slate-950"
            onClick={() => void handleBrowseParent()}
          >
            <ChevronLeft className="size-4" />
            Back
          </button>
        ) : null}
        <div
          className="min-w-0 truncate"
          title={activeListing?.path ?? rootListing?.path ?? "Loading..."}
        >
          {activeListing?.displayPath ??
            rootListing?.displayPath ??
            "Loading..."}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {rootLoading && !rootListing ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            Loading your filesystem…
          </div>
        ) : rootError ? (
          <div className="bg-rose-50 px-4 py-4 text-sm text-rose-700">
            {rootError}
          </div>
        ) : listingError ? (
          <div className="bg-rose-50 px-4 py-4 text-sm text-rose-700">
            {listingError}
          </div>
        ) : listingLoading && !activeListing ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            Loading folder…
          </div>
        ) : activeListing ? (
          activeListing.directories.length === 0 &&
          activeListing.files.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              Empty folder
            </div>
          ) : (
            <div className="max-h-[28rem] overflow-y-auto">
              {activeListing.directories.map((directory) => (
                <div
                  key={directory.path}
                  className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => void browseDirectory(directory.path)}
                  >
                    <Folder className="size-4 shrink-0 text-slate-400" />
                    <div
                      className="truncate text-sm text-slate-950"
                      title={directory.name}
                    >
                      {directory.name}
                    </div>
                  </button>

                  <button
                    type="button"
                    className="shrink-0 text-xs text-slate-500 hover:text-slate-950"
                    onClick={() => openPath(directory.path)}
                  >
                    Open
                  </button>
                </div>
              ))}

              {activeListing.files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className="flex w-full items-center gap-3 border-b border-slate-200 px-4 py-3 text-left transition last:border-b-0 hover:bg-slate-50"
                  onClick={() => openPath(file.path)}
                >
                  <FileText className="size-4 shrink-0 text-slate-400" />
                  <div
                    className="min-w-0 flex-1 truncate text-sm text-slate-950"
                    title={file.name}
                  >
                    {file.name}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-slate-300" />
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            {getFileSystemBrowserError(null, "Choose a folder to begin.")}
          </div>
        )}
      </div>
    </div>
  );
}

export function HomeScreen({
  backend,
  buildLocationForPath,
  onOpenDemo,
  updateStatus,
}: HomeScreenProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-start px-6 py-12 sm:px-8 sm:py-20">
        <div className="w-full">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Open a file or folder
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 sm:text-base">
            Start from a markdown file, or open a folder.
          </p>

          {!backend?.canManageProjects ? (
            <Button
              type="button"
              variant="outline"
              className="mt-4 h-10 rounded-lg border-slate-300 bg-white px-4 text-sm"
              onClick={onOpenDemo}
            >
              Open demo workspace
            </Button>
          ) : null}

          {updateStatus ? (
            <div className="mt-6 max-w-xl">
              <UpdateNotice updateStatus={updateStatus} />
            </div>
          ) : null}

          <div className="mt-8">
            <BrowserPanel
              backend={backend}
              buildLocationForPath={buildLocationForPath}
              onOpenDemo={onOpenDemo}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
