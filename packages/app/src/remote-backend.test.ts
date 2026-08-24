import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteBackend } from "./remote-backend";
import { MarkdownFileConflictError } from "./storage";

class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readonly url: string;
  readyState: number = FakeEventSource.OPEN;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  private readonly listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Deliver a server-sent event to the listeners the backend registered. */
  emit(type: string, data?: string): void {
    const event =
      data === undefined ? new Event(type) : new MessageEvent(type, { data });
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  /**
   * The browser gave up on the stream, as it does for any non-2xx response
   * (the events endpoint 404s while the session is not registered).
   */
  failAndClose(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.onerror?.(new Event("error"));
  }

  /** A transient error the browser retries on its own. */
  failTransiently(): void {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.(new Event("error"));
  }
}

/** The payload the server sends with every viewer `connected` event. */
function connectedPayload(version = "version-1"): string {
  return JSON.stringify({ id: "session-1", role: "viewer", version });
}

function installFakeEventSource(): FakeEventSource[] {
  const sources: FakeEventSource[] = [];
  class TrackedEventSource extends FakeEventSource {
    constructor(url: string) {
      super(url);
      sources.push(this);
    }
  }
  global.EventSource = TrackedEventSource as unknown as typeof EventSource;
  return sources;
}

describe("RemoteBackend", () => {
  const originalFetch = global.fetch;
  const originalEventSource = global.EventSource;

  afterEach(() => {
    global.fetch = originalFetch;
    global.EventSource = originalEventSource;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function bootstrap() {
    return new RemoteBackend(
      {
        kind: "remote",
        label: "Remote document",
        detail: "draft.md",
        sessionId: "session-1",
        originPath: "/work/draft.md",
      },
      {
        id: "session-1",
        originPath: "/work/draft.md",
        content: "v1",
        version: "version-1",
      },
    );
  }

  it("creates an info object that exposes the session id and origin path", async () => {
    const backend = bootstrap();
    expect(backend.info.kind).toBe("remote");
    expect(backend.info.sessionId).toBe("session-1");
    expect(backend.info.originPath).toBe("/work/draft.md");
    expect(backend.canManageProjects).toBe(false);
  });

  it("getMarkdownFile fetches /api/remote-document/:id and returns the page", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "session-1",
            originPath: "/work/draft.md",
            content: "v2",
            version: "version-2",
          }),
          { status: 200 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const backend = bootstrap();
    const page = await backend.getMarkdownFile("ignored.md");

    expect(fetchMock).toHaveBeenCalledWith("/api/remote-document/session-1", {
      headers: {},
    });
    expect(page.content).toBe("v2");
    expect(page.version).toBe("version-2");
  });

  it("includes the bearer token on requests when constructed with one", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "session-1",
            originPath: "/work/draft.md",
            content: "v1",
            version: "v",
          }),
          { status: 200 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const backend = new RemoteBackend(
      {
        kind: "remote",
        label: "Remote document",
        detail: "draft.md",
        sessionId: "session-1",
        originPath: "/work/draft.md",
      },
      {
        id: "session-1",
        originPath: "/work/draft.md",
        content: "v1",
        version: "v",
      },
      "secret-token",
    );

    await backend.getMarkdownFile("ignored.md");

    expect(fetchMock).toHaveBeenCalledWith("/api/remote-document/session-1", {
      headers: { Authorization: "Bearer secret-token" },
    });
  });

  it("saveMarkdownFile PUTs the new content with expectedVersion", async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(init?.body as string) as {
        content: string;
        expectedVersion?: string;
      };
      expect(body).toMatchObject({
        content: "v2",
        expectedVersion: "version-1",
      });
      return new Response(
        JSON.stringify({ id: "session-1", version: "version-2" }),
        { status: 200 },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const backend = bootstrap();
    const page = await backend.saveMarkdownFile(
      "ignored.md",
      "v2",
      "version-1",
    );

    expect(page.version).toBe("version-2");
    expect(page.content).toBe("v2");
  });

  it("surfaces a 409 as MarkdownFileConflictError carrying current state", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            current: {
              id: "session-1",
              originPath: "/work/draft.md",
              content: "server-content",
              version: "version-server",
            },
          }),
          { status: 409 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const backend = bootstrap();
    await expect(
      backend.saveMarkdownFile("ignored.md", "client-content", "stale-version"),
    ).rejects.toBeInstanceOf(MarkdownFileConflictError);
  });

  it("saveAsset throws a clear error", async () => {
    const backend = bootstrap();
    const file = new File(["bytes"], "image.png");
    await expect(backend.saveAsset(file)).rejects.toThrow(
      /do not support asset uploads/,
    );
  });

  it("resolveFileUrl returns null", () => {
    const backend = bootstrap();
    expect(backend.resolveFileUrl("anything.png")).toBeNull();
  });

  it("openProject is a no-op for remote sessions", async () => {
    const backend = bootstrap();
    await expect(backend.openProject("/elsewhere")).resolves.toBeUndefined();
    expect(backend.info.projectPath).toBeUndefined();
  });

  it("onSessionStatusChange immediately reports the current status and any future changes", () => {
    const backend = bootstrap();
    const events: string[] = [];
    const unsubscribe = backend.onSessionStatusChange((status) =>
      events.push(status),
    );

    expect(events).toEqual(["disconnected"]);

    // Simulate the SSE flow flipping the status to connected, then disconnected.
    (
      backend as unknown as { setSessionStatus: (s: string) => void }
    ).setSessionStatus("connected");
    (
      backend as unknown as { setSessionStatus: (s: string) => void }
    ).setSessionStatus("disconnected");

    expect(events).toEqual(["disconnected", "connected", "disconnected"]);

    unsubscribe();

    (
      backend as unknown as { setSessionStatus: (s: string) => void }
    ).setSessionStatus("connected");
    expect(events).toEqual(["disconnected", "connected", "disconnected"]);
  });

  it("watchMarkdownFile opens a viewer event stream with the token in the query string", () => {
    const sources = installFakeEventSource();

    const backend = new RemoteBackend(
      {
        kind: "remote",
        label: "Remote document",
        detail: "draft.md",
        sessionId: "session-1",
        originPath: "/work/draft.md",
      },
      {
        id: "session-1",
        originPath: "/work/draft.md",
        content: "v1",
        version: "version-1",
      },
      "secret-token",
    );

    const statuses: string[] = [];
    backend.onSessionStatusChange((status) => statuses.push(status));

    const stopWatching = backend.watchMarkdownFile("ignored.md", () => {});
    expect(sources).toHaveLength(1);

    const eventsUrl = new URL(sources[0].url);
    expect(eventsUrl.pathname).toBe("/api/remote-document/session-1/events");
    expect(eventsUrl.searchParams.get("role")).toBe("viewer");
    expect(eventsUrl.searchParams.get("token")).toBe("secret-token");

    sources[0].emit("connected", connectedPayload());
    expect(statuses).toEqual(["disconnected", "connected"]);

    stopWatching();
    expect(statuses).toEqual(["disconnected", "connected", "disconnected"]);
  });

  it("reports a save pushed over the stream as a document change", () => {
    const sources = installFakeEventSource();
    const backend = bootstrap();
    const changes: Array<{ path: string; version?: string }> = [];
    backend.watchMarkdownFile("ignored.md", (event) => changes.push(event));
    sources[0].emit("connected", connectedPayload());

    sources[0].emit(
      "save",
      JSON.stringify({ id: "session-1", content: "v2", version: "version-2" }),
    );

    expect(changes).toEqual([
      { path: "/work/draft.md", exists: true, version: "version-2" },
    ]);
  });

  it("flips the session status when the server pushes a disconnected event", () => {
    const sources = installFakeEventSource();
    const backend = bootstrap();
    const statuses: string[] = [];
    backend.onSessionStatusChange((status) => statuses.push(status));

    backend.watchMarkdownFile("ignored.md", () => {});
    sources[0].emit("connected", connectedPayload());
    expect(statuses).toEqual(["disconnected", "connected"]);

    // The CLI's stream died; the viewer's own stream is still healthy, so the
    // server's push is the only signal that the session is gone.
    sources[0].emit("disconnected");

    expect(sources[0].readyState).toBe(FakeEventSource.OPEN);
    expect(statuses).toEqual(["disconnected", "connected", "disconnected"]);
  });

  describe("watchMarkdownFile re-opens a stream the browser gave up on", () => {
    function startWatching() {
      const sources = installFakeEventSource();
      const backend = bootstrap();
      const statuses: string[] = [];
      backend.onSessionStatusChange((status) => statuses.push(status));
      const stopWatching = backend.watchMarkdownFile("ignored.md", () => {});
      return { sources, statuses, stopWatching };
    }

    it("opens a fresh stream to the same url after a closed one", () => {
      vi.useFakeTimers();
      const { sources, statuses } = startWatching();
      sources[0].emit("connected", connectedPayload());

      sources[0].failAndClose();
      expect(statuses).toEqual(["disconnected", "connected", "disconnected"]);
      expect(sources).toHaveLength(1);

      vi.advanceTimersByTime(1000);

      expect(sources).toHaveLength(2);
      expect(sources[1].url).toBe(sources[0].url);

      sources[1].emit("connected", connectedPayload());
      expect(statuses).toEqual([
        "disconnected",
        "connected",
        "disconnected",
        "connected",
      ]);
    });

    it("leaves a transient error to the browser's own reconnect", () => {
      vi.useFakeTimers();
      const { sources, statuses } = startWatching();
      sources[0].emit("connected", connectedPayload());

      sources[0].failTransiently();
      vi.advanceTimersByTime(60_000);

      expect(sources).toHaveLength(1);
      expect(statuses).toEqual(["disconnected", "connected"]);
    });

    it("backs off between attempts and caps the delay at ten seconds", () => {
      vi.useFakeTimers();
      const { sources } = startWatching();

      const delays = [1000, 2000, 4000, 8000, 10_000, 10_000];
      let opened = 1;
      for (const delay of delays) {
        sources[opened - 1].failAndClose();
        vi.advanceTimersByTime(delay - 1);
        expect(sources).toHaveLength(opened);
        vi.advanceTimersByTime(1);
        opened += 1;
        expect(sources).toHaveLength(opened);
      }
    });

    it("restarts the backoff once a stream connects again", () => {
      vi.useFakeTimers();
      const { sources } = startWatching();

      sources[0].failAndClose();
      vi.advanceTimersByTime(1000);
      sources[1].failAndClose();
      vi.advanceTimersByTime(2000);
      expect(sources).toHaveLength(3);

      sources[2].emit("connected", connectedPayload());
      sources[2].failAndClose();
      vi.advanceTimersByTime(1000);

      expect(sources).toHaveLength(4);
    });

    it("reports the document as changed when it reconnects to a newer version", () => {
      vi.useFakeTimers();
      const sources = installFakeEventSource();
      const backend = bootstrap();
      const changes: Array<{ path: string; version?: string }> = [];
      backend.watchMarkdownFile("ignored.md", (event) => changes.push(event));

      sources[0].emit("connected", connectedPayload("version-1"));
      expect(changes).toEqual([]);

      // The session came back with the CLI's freshly re-read file, so the
      // viewer is now holding stale content and has to reload it.
      sources[0].failAndClose();
      vi.advanceTimersByTime(1000);
      sources[1].emit("connected", connectedPayload("version-7"));

      expect(changes).toEqual([
        { path: "/work/draft.md", exists: true, version: "version-7" },
      ]);
    });

    it("cancels a pending re-open when the watcher is disposed", () => {
      vi.useFakeTimers();
      const { sources, stopWatching } = startWatching();
      sources[0].failAndClose();

      stopWatching();
      vi.advanceTimersByTime(60_000);

      expect(sources).toHaveLength(1);
    });

    it("closes the stream a re-open opened when the watcher is disposed", () => {
      vi.useFakeTimers();
      const { sources, stopWatching } = startWatching();
      sources[0].failAndClose();
      vi.advanceTimersByTime(1000);

      stopWatching();

      expect(sources[1].closed).toBe(true);
    });
  });
});
