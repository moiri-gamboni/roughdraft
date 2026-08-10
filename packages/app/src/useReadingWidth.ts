import { useCallback, useEffect, useState } from "react";

export const READING_WIDTH_STORAGE_KEY = "roughdraft:editor-wide";
const WIDE_CLASS = "editor-wide";

function readStoredPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(READING_WIDTH_STORAGE_KEY) === "1";
  } catch {
    // Private-mode and sandboxed contexts throw on access rather than
    // returning null. Width is a preference, so fall back to the default
    // instead of taking the document down with it.
    return false;
  }
}

function applyWideClass(wide: boolean) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.classList.toggle(WIDE_CLASS, wide);
}

/**
 * Full-width reading mode. Widening is a single class on the root element,
 * because the document column, the rail grid, and the shell that centres them
 * all read their size from `--reading-width` / `--reading-shell-width`.
 */
export function useReadingWidth(): {
  isWide: boolean;
  toggleWide: () => void;
} {
  const [isWide, setIsWide] = useState<boolean>(readStoredPreference);

  useEffect(() => {
    applyWideClass(isWide);
  }, [isWide]);

  const toggleWide = useCallback(() => {
    setIsWide((current) => {
      const next = !current;
      try {
        globalThis.localStorage?.setItem(
          READING_WIDTH_STORAGE_KEY,
          next ? "1" : "0",
        );
      } catch {
        // Preference is not persisted; the toggle still works for this session.
      }
      return next;
    });
  }, []);

  return { isWide, toggleWide };
}
