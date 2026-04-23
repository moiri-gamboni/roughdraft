import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronDown, ChevronRight, ExternalLink, FileText, Folder } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FileSystemListing, StorageBackend } from "./storage";

interface PathSwitcherProps {
  backend: StorageBackend;
  currentLabel: string;
  currentPath: string | null;
  projectPath: string | null;
  buildLocationForPath: (path?: string | null) => string;
  dismissCount?: number;
  description?: string | null;
}

interface MenuPanelProps {
  eyebrow: string;
  title: string;
  children: ReactNode;
}

interface ListingEntriesProps {
  listing: FileSystemListing | null;
  currentPath: string | null;
  projectPath: string | null;
  listingsByPath: Record<string, FileSystemListing>;
  loadingPaths: Set<string>;
  errorByPath: Record<string, string | null>;
  onLoadDirectory: (path: string) => void;
  onOpenDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
}

interface DirectorySubmenuProps extends Omit<ListingEntriesProps, "listing"> {
  directory: FileSystemListing["directories"][number];
}

const ROOT_LISTING_KEY = "__root__";

const menuPopupClass =
  "z-50 w-[min(22rem,calc(100vw-32px))] origin-(--transform-origin) overflow-y-auto overflow-x-hidden rounded-md border border-slate-200/80 bg-white p-1.5 text-sm text-slate-900 shadow-lg ring-1 ring-slate-950/5 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

const menuItemClass =
  "flex min-w-0 cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-sm text-slate-700 outline-none transition data-[highlighted]:bg-slate-100 data-[highlighted]:text-slate-950 data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

function MenuPanel({ eyebrow, title, children }: MenuPanelProps) {
  return (
    <div className="min-w-0">
      <header className="border-b border-slate-200/80 px-2.5 py-2">
        <div className="truncate text-[0.68rem] font-semibold tracking-[0.14em] text-slate-500 uppercase">
          {eyebrow}
        </div>
        <div className="mt-1 truncate text-sm font-medium text-slate-950" title={title}>
          {title}
        </div>
      </header>
      <div className="p-1">{children}</div>
    </div>
  );
}

function MenuStatusRow({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "rounded-md px-2.5 py-2 text-sm",
        tone === "error" ? "border border-rose-200 bg-rose-50 text-rose-700" : "text-slate-500"
      )}
    >
      {children}
    </div>
  );
}

function DirectorySubmenu({
  directory,
  currentPath,
  projectPath,
  listingsByPath,
  loadingPaths,
  errorByPath,
  onLoadDirectory,
  onOpenDirectory,
  onOpenFile,
}: DirectorySubmenuProps) {
  const isCurrent = directory.path === projectPath;
  const listing = listingsByPath[directory.path] ?? null;
  const loading = loadingPaths.has(directory.path);
  const error = errorByPath[directory.path] ?? null;

  return (
    <MenuPrimitive.SubmenuRoot onOpenChange={(open) => open && onLoadDirectory(directory.path)}>
      <MenuPrimitive.SubmenuTrigger
        openOnHover
        onMouseEnter={() => onLoadDirectory(directory.path)}
        onFocus={() => onLoadDirectory(directory.path)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void onOpenDirectory(directory.path);
        }}
        className={menuItemClass}
      >
        <Folder className="size-4 shrink-0 text-slate-500" />
        <span className="min-w-0 flex-1 truncate" title={directory.name}>
          {directory.name}
        </span>
        {isCurrent ? (
          <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[0.65rem] font-medium text-slate-700">
            Current
          </span>
        ) : null}
        <ChevronRight className="size-4 shrink-0 text-slate-400" />
      </MenuPrimitive.SubmenuTrigger>

      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          side="right"
          align="start"
          sideOffset={6}
          alignOffset={-6}
          className="isolate z-50"
        >
          <MenuPrimitive.Popup className={cn(menuPopupClass, "max-h-[min(72vh,560px)] p-1")}>
            {loading ? (
              <MenuStatusRow>Loading…</MenuStatusRow>
            ) : error ? (
              <MenuStatusRow tone="error">{error}</MenuStatusRow>
            ) : listing ? (
              <ListingEntries
                listing={listing}
                currentPath={currentPath}
                projectPath={projectPath}
                listingsByPath={listingsByPath}
                loadingPaths={loadingPaths}
                errorByPath={errorByPath}
                onLoadDirectory={onLoadDirectory}
                onOpenDirectory={onOpenDirectory}
                onOpenFile={onOpenFile}
              />
            ) : (
              <MenuStatusRow>Loading…</MenuStatusRow>
            )}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.SubmenuRoot>
  );
}

function ListingEntries({
  listing,
  currentPath,
  projectPath,
  listingsByPath,
  loadingPaths,
  errorByPath,
  onLoadDirectory,
  onOpenDirectory,
  onOpenFile,
}: ListingEntriesProps) {
  const hasEntries = !!listing && (listing.directories.length > 0 || listing.files.length > 0);

  if (!listing) {
    return <MenuStatusRow>No folder loaded.</MenuStatusRow>;
  }

  if (!hasEntries) {
    return <MenuStatusRow>No folders or markdown files.</MenuStatusRow>;
  }

  return (
    <>
      {listing.directories.map((directory) => (
        <DirectorySubmenu
          key={directory.path}
          directory={directory}
          currentPath={currentPath}
          projectPath={projectPath}
          listingsByPath={listingsByPath}
          loadingPaths={loadingPaths}
          errorByPath={errorByPath}
          onLoadDirectory={onLoadDirectory}
          onOpenDirectory={onOpenDirectory}
          onOpenFile={onOpenFile}
        />
      ))}

      {listing.files.map((file) => {
        const isCurrent = file.path === currentPath;

        return (
          <MenuPrimitive.Item
            key={file.path}
            closeOnClick={false}
            onClick={() => onOpenFile(file.path)}
            className={cn(menuItemClass, isCurrent && "bg-slate-900 text-white data-[highlighted]:bg-slate-800 data-[highlighted]:text-white")}
          >
            <FileText className={cn("size-4 shrink-0", isCurrent ? "text-white/80" : "text-slate-500")} />
            <span className="min-w-0 flex-1 truncate" title={file.name}>
              {file.name}
            </span>
            {isCurrent ? (
              <span className="shrink-0 text-[0.65rem] font-medium text-white/75">Current</span>
            ) : (
              <ExternalLink className="size-4 shrink-0 text-slate-400" />
            )}
          </MenuPrimitive.Item>
        );
      })}
    </>
  );
}

export function PathSwitcher({
  backend,
  currentLabel,
  currentPath,
  projectPath,
  buildLocationForPath,
  dismissCount = 0,
  description,
}: PathSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [listingsByPath, setListingsByPath] = useState<Record<string, FileSystemListing>>({});
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [errorByPath, setErrorByPath] = useState<Record<string, string | null>>({});

  const setPathLoading = useCallback((pathKey: string, loading: boolean) => {
    setLoadingPaths((prev) => {
      const next = new Set(prev);
      if (loading) {
        next.add(pathKey);
      } else {
        next.delete(pathKey);
      }
      return next;
    });
  }, []);

  const loadListing = useCallback(
    async (path?: string) => {
      const normalizedPath = path?.trim() || undefined;
      const pathKey = normalizedPath ?? ROOT_LISTING_KEY;

      if (normalizedPath && listingsByPath[normalizedPath]) {
        return listingsByPath[normalizedPath];
      }

      if (!normalizedPath && rootPath && listingsByPath[rootPath]) {
        return listingsByPath[rootPath];
      }

      if (loadingPaths.has(pathKey)) {
        return null;
      }

      setPathLoading(pathKey, true);
      setErrorByPath((prev) => ({ ...prev, [pathKey]: null }));

      try {
        const listing = await backend.listFileSystem(normalizedPath);
        setListingsByPath((prev) => ({ ...prev, [listing.path]: listing }));
        setRootPath((prev) => prev ?? listing.path);
        return listing;
      } catch (error) {
        const message = getErrorMessage(error, "Could not load folders.");
        setErrorByPath((prev) => ({ ...prev, [pathKey]: message }));
        return null;
      } finally {
        setPathLoading(pathKey, false);
      }
    },
    [backend, listingsByPath, loadingPaths, rootPath, setPathLoading]
  );

  useEffect(() => {
    if (!open || !backend.canManageProjects) return;

    void loadListing();
  }, [backend.canManageProjects, loadListing, open]);

  useEffect(() => {
    if (dismissCount === 0) return;
    setOpen(false);
  }, [dismissCount]);

  const openFile = useCallback(
    (path: string) => {
      setOpen(false);
      window.location.assign(buildLocationForPath(path));
    },
    [buildLocationForPath]
  );

  const openDirectory = useCallback(
    async (path: string) => {
      try {
        await backend.openProject(path);
        setOpen(false);
        window.location.assign(buildLocationForPath(path));
      } catch (error) {
        const message = getErrorMessage(error, "Could not open folder.");
        setErrorByPath((prev) => ({ ...prev, [path]: message }));
      }
    },
    [backend, buildLocationForPath]
  );

  const rootListing = rootPath ? listingsByPath[rootPath] ?? null : null;
  const rootLoading = loadingPaths.has(ROOT_LISTING_KEY);
  const rootError = errorByPath[ROOT_LISTING_KEY] ?? null;
  const canBrowseProjects = backend.canManageProjects;

  return (
    <MenuPrimitive.Root modal={false} open={open} onOpenChange={setOpen}>
      <div className="block max-w-full">
        <MenuPrimitive.Trigger
          aria-label="Open another file or folder"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-auto w-full min-w-0 justify-between gap-3 rounded-md px-3 py-2 text-left shadow-none"
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" title={currentLabel}>
              {currentLabel}
            </span>
            <span
              className="mt-0.5 block truncate text-xs text-muted-foreground"
              title={description ?? projectPath ?? currentPath ?? currentLabel}
            >
              {description ?? projectPath ?? currentPath ?? "Browse files and folders"}
            </span>
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </MenuPrimitive.Trigger>
      </div>

      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner align="start" sideOffset={8} className="isolate z-50">
          <MenuPrimitive.Popup className={cn(menuPopupClass, "max-h-[min(72vh,560px)]")}>
            {!canBrowseProjects ? (
              <MenuPanel eyebrow="Filesystem" title="Project browsing unavailable">
                <MenuStatusRow>Project browsing is unavailable in browser storage mode.</MenuStatusRow>
              </MenuPanel>
            ) : (
              <MenuPanel eyebrow="Filesystem" title={rootListing?.displayPath ?? "Loading..."}>
                {rootLoading && !rootListing ? (
                  <MenuStatusRow>Loading…</MenuStatusRow>
                ) : rootError ? (
                  <MenuStatusRow tone="error">{rootError}</MenuStatusRow>
                ) : (
                  <ListingEntries
                    listing={rootListing}
                    currentPath={currentPath}
                    projectPath={projectPath}
                    listingsByPath={listingsByPath}
                    loadingPaths={loadingPaths}
                    errorByPath={errorByPath}
                    onLoadDirectory={(path) => void loadListing(path)}
                    onOpenDirectory={(path) => void openDirectory(path)}
                    onOpenFile={openFile}
                  />
                )}
              </MenuPanel>
            )}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  );
}
