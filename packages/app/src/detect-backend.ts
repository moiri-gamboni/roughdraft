import type { StorageBackend } from "./storage";
import { ApiBackend } from "./api-backend";
import { LocalStorageBackend } from "./local-storage-backend";

export async function detectBackend(): Promise<StorageBackend> {
  if (import.meta.env.VITE_PREVIEW_WEB === "1") {
    return new LocalStorageBackend();
  }

  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      const payload = (await res.json()) as {
        backend?: string;
        projectDir?: string;
        stateless?: boolean;
      };

      if (payload.backend === "local-files") {
        return new ApiBackend({
          kind: "local-files",
          label: "Local files",
          detail: payload.stateless
            ? "Open a markdown file"
            : "Markdown file on disk",
          projectPath: payload.projectDir,
        });
      }
    }
  } catch {
    // network error — no server available
  }
  return new LocalStorageBackend();
}
