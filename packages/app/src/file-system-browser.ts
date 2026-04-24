import { useCallback, useState } from "react";
import type { FileSystemListing, StorageBackend } from "./storage";

const ROOT_LISTING_KEY = "__root__";

export function getFileSystemBrowserError(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export function useFileSystemBrowser(backend: StorageBackend) {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [listingsByPath, setListingsByPath] = useState<
    Record<string, FileSystemListing>
  >({});
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [errorByPath, setErrorByPath] = useState<Record<string, string | null>>(
    {},
  );

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
        const message = getFileSystemBrowserError(
          error,
          "Could not load folders.",
        );
        setErrorByPath((prev) => ({ ...prev, [pathKey]: message }));
        return null;
      } finally {
        setPathLoading(pathKey, false);
      }
    },
    [backend, listingsByPath, loadingPaths, rootPath, setPathLoading],
  );

  return {
    rootPath,
    listingsByPath,
    loadingPaths,
    errorByPath,
    loadListing,
    rootListing: rootPath ? (listingsByPath[rootPath] ?? null) : null,
    rootLoading: loadingPaths.has(ROOT_LISTING_KEY),
    rootError: errorByPath[ROOT_LISTING_KEY] ?? null,
  };
}
