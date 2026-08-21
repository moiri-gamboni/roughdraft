import {
  MarkdownFileConflictError,
  type BackendInfo,
  type MarkdownFileChangeEvent,
  type Page,
  type StorageBackend,
  type StoredAsset,
} from "./storage";

interface RemoteDocumentPayload {
  id: string;
  originPath: string;
  content: string;
  version: string;
}

export type RemoteSessionStatus = "connected" | "disconnected";

const VIEWER_REOPEN_BASE_DELAY_MS = 1000;
const VIEWER_REOPEN_MAX_DELAY_MS = 10_000;

export class RemoteBackend implements StorageBackend {
  info: BackendInfo;
  canManageProjects = false;
  sessionStatus: RemoteSessionStatus = "disconnected";

  private bootstrap: RemoteDocumentPayload;
  private statusListeners = new Set<(status: RemoteSessionStatus) => void>();
  private token: string;

  constructor(info: BackendInfo, bootstrap: RemoteDocumentPayload, token = "") {
    this.info = info;
    this.bootstrap = bootstrap;
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    return this.token.length > 0
      ? { Authorization: `Bearer ${this.token}` }
      : {};
  }

  static async create(sessionId: string, token = ""): Promise<RemoteBackend> {
    const headers: Record<string, string> =
      token.length > 0 ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(
      `/api/remote-document/${encodeURIComponent(sessionId)}`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(
        `Could not load remote document session ${sessionId}: ${response.status}`,
      );
    }
    const bootstrap = (await response.json()) as RemoteDocumentPayload;
    const filename = bootstrap.originPath.split(/[\\/]/).pop() ?? "remote.md";
    return new RemoteBackend(
      {
        kind: "remote",
        label: "Remote document",
        detail: filename,
        sessionId,
        originPath: bootstrap.originPath,
      },
      bootstrap,
      token,
    );
  }

  documentPath(): string {
    return this.bootstrap.originPath.split(/[\\/]/).pop() ?? "remote.md";
  }

  onSessionStatusChange(
    listener: (status: RemoteSessionStatus) => void,
  ): () => void {
    this.statusListeners.add(listener);
    listener(this.sessionStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setSessionStatus(next: RemoteSessionStatus): void {
    if (this.sessionStatus === next) return;
    this.sessionStatus = next;
    for (const listener of this.statusListeners) {
      listener(next);
    }
  }

  private pageFromBootstrap(): Page {
    return {
      id: this.bootstrap.id,
      title: titleFromContent(this.bootstrap.content, this.documentPath()),
      content: this.bootstrap.content,
      version: this.bootstrap.version,
    };
  }

  async getMarkdownFile(_relativePath: string): Promise<Page> {
    const sessionId = this.info.sessionId;
    if (!sessionId) {
      throw new Error("Remote backend missing session id");
    }
    const response = await fetch(
      `/api/remote-document/${encodeURIComponent(sessionId)}`,
      { headers: this.authHeaders() },
    );
    if (!response.ok) {
      throw new Error(
        `Failed to load remote document: HTTP ${response.status}`,
      );
    }
    const payload = (await response.json()) as RemoteDocumentPayload;
    this.bootstrap = payload;
    return this.pageFromBootstrap();
  }

  async saveMarkdownFile(
    _relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page> {
    const sessionId = this.info.sessionId;
    if (!sessionId) {
      throw new Error("Remote backend missing session id");
    }
    const response = await fetch(
      `/api/remote-document/${encodeURIComponent(sessionId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({ content, expectedVersion }),
      },
    );

    if (response.status === 409) {
      const payload = (await response.json()) as {
        current?: RemoteDocumentPayload;
      };
      if (payload.current) {
        this.bootstrap = payload.current;
        throw new MarkdownFileConflictError(this.pageFromBootstrap());
      }
    }

    if (!response.ok) {
      throw new Error(
        `Failed to save remote document: HTTP ${response.status}`,
      );
    }

    const updated = (await response.json()) as { id: string; version: string };
    this.bootstrap = {
      ...this.bootstrap,
      content,
      version: updated.version,
    };
    return this.pageFromBootstrap();
  }

  watchMarkdownFile(
    _relativePath: string,
    onChange: (event: MarkdownFileChangeEvent) => void,
  ): () => void {
    const sessionId = this.info.sessionId;
    if (!sessionId) return () => {};

    // EventSource cannot set custom headers, so the token rides as a query
    // parameter. The server accepts both `Authorization: Bearer` and ?token=
    // for the SSE endpoint specifically.
    const eventsUrl = new URL(
      `/api/remote-document/${encodeURIComponent(sessionId)}/events`,
      window.location.origin,
    );
    eventsUrl.searchParams.set("role", "viewer");
    if (this.token.length > 0) {
      eventsUrl.searchParams.set("token", this.token);
    }
    let current: EventSource | null = null;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const notifyChanged = (version: string) => {
      onChange({ path: this.bootstrap.originPath, exists: true, version });
    };

    const scheduleReopen = () => {
      if (disposed || reopenTimer !== null) return;
      const delay = Math.min(
        VIEWER_REOPEN_BASE_DELAY_MS * 2 ** attempt,
        VIEWER_REOPEN_MAX_DELAY_MS,
      );
      attempt += 1;
      reopenTimer = setTimeout(() => {
        reopenTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      const source = new EventSource(eventsUrl.toString());
      current = source;

      source.addEventListener("connected", (event) => {
        attempt = 0;
        this.setSessionStatus("connected");

        // A session that came back while the viewer was away carries the CLI's
        // re-read file under a new version, so the viewer is holding stale
        // content until it reloads.
        const { version } = readSessionEvent(event);
        if (version !== undefined && version !== this.bootstrap.version) {
          notifyChanged(version);
        }
      });

      // The server pushes this when the CLI's stream drops. The viewer's own
      // stream stays healthy, so it is the only signal the session is gone.
      source.addEventListener("disconnected", () => {
        this.setSessionStatus("disconnected");
      });

      source.addEventListener("save", (event) => {
        const { content, version } = readSessionEvent(event);
        if (content === undefined || version === undefined) return;
        this.bootstrap = { ...this.bootstrap, content, version };
        notifyChanged(version);
      });

      source.onerror = () => {
        // EventSource retries transient errors itself, but never re-opens a
        // stream it closed — and the events endpoint 404s while the session is
        // unregistered (server restarted, CLI not back yet), so re-opening a
        // closed stream is the only way the viewer ever reattaches.
        if (source.readyState !== EventSource.CLOSED) return;
        this.setSessionStatus("disconnected");
        scheduleReopen();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reopenTimer !== null) {
        clearTimeout(reopenTimer);
        reopenTimer = null;
      }
      current?.close();
      this.setSessionStatus("disconnected");
    };
  }

  async saveAsset(_file: File): Promise<StoredAsset> {
    throw new Error(
      "Remote document sessions do not support asset uploads in this version.",
    );
  }

  resolveFileUrl(_path: string): string | null {
    return null;
  }

  async openProject(_path: string): Promise<void> {
    // Remote sessions are bound to a single document; openProject is a no-op.
  }
}

/** Reads the fields a remote session event carries, tolerating malformed data. */
function readSessionEvent(event: Event): {
  content?: string;
  version?: string;
} {
  try {
    const payload = JSON.parse((event as MessageEvent<string>).data) as {
      content?: unknown;
      version?: unknown;
    };
    return {
      content:
        typeof payload.content === "string" ? payload.content : undefined,
      version:
        typeof payload.version === "string" ? payload.version : undefined,
    };
  } catch (error) {
    console.error("Failed to read remote session event:", error);
    return {};
  }
}

function titleFromContent(content: string, fallback: string): string {
  const firstLine = content.split("\n")[0] ?? "";
  const trimmed = firstLine.replace(/^#*\s*/, "").trim();
  return trimmed || fallback;
}
