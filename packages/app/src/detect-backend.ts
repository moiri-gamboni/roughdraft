import type { StorageBackend } from "./storage";
import { ApiBackend } from "./api-backend";
import { getRequestedPathState } from "./app-navigation";
import { LocalStorageBackend } from "./local-storage-backend";
import { RemoteBackend } from "./remote-backend";

interface StatusPayload {
  backend?: string;
  projectDir?: string;
  stateless?: boolean;
  capabilities?: { remoteDocuments?: boolean };
}

/**
 * The document the URL asks for exists somewhere Roughdraft cannot reach right
 * now. Distinct from a document that genuinely cannot be opened, because this
 * one is worth retrying and any unsent edits for it are still safe.
 */
export class BackendUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BackendUnavailableError";
  }
}

export async function detectBackend(): Promise<StorageBackend> {
  if (import.meta.env.VITE_PREVIEW_WEB === "1") {
    return new LocalStorageBackend();
  }

  const sessionId = readSessionIdFromUrl();
  const token = readTokenFromUrl();

  let statusPayload: StatusPayload | null = null;

  try {
    const res = await fetch("/api/status");
    if (res.ok) {
      statusPayload = (await res.json()) as StatusPayload;
    }
  } catch {
    // network error — no server available
  }

  if (statusPayload) {
    if (sessionId && statusPayload.capabilities?.remoteDocuments) {
      try {
        return await RemoteBackend.create(sessionId, token);
      } catch (error) {
        console.error("Could not initialize remote backend:", error);
        throw new BackendUnavailableError(
          error instanceof Error
            ? error.message
            : `Could not load remote document session ${sessionId}`,
          { cause: error },
        );
      }
    }

    if (statusPayload.backend === "local-files") {
      return new ApiBackend({
        kind: "local-files",
        label: "Local files",
        detail: statusPayload.stateless
          ? "Open a markdown file"
          : "Markdown file on disk",
        projectPath: statusPayload.projectDir,
      });
    }
  }

  // No server answered. Falling back to browser storage when the URL names a
  // real document would show an empty page for a file that is fine on disk.
  if (sessionId || getRequestedPathState().rawPath) {
    throw new BackendUnavailableError(
      "Roughdraft could not reach the local server.",
    );
  }

  return new LocalStorageBackend();
}

function readSessionIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const session = params.get("session")?.trim();
  return session && session.length > 0 ? session : null;
}

function readTokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("token")?.trim() ?? "";
}
