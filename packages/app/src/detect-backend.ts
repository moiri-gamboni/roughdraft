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
      };

      if (payload.backend === "local-files" && payload.projectDir) {
        return new ApiBackend({
          kind: "local-files",
          label: "Local files",
          detail: payload.projectDir,
          projectPath: payload.projectDir,
        });
      }

      return new ApiBackend({
        kind: "local-files",
        label: "Local files",
        detail: "Project folder on disk",
        projectPath: payload.projectDir,
      });
    }
  } catch {
    // network error — no server available
  }
  return new LocalStorageBackend();
}
