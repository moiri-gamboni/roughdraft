import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { BackendUnavailableError, detectBackend } from "../src/detect-backend";
import { DRAFT_KEY_PREFIX } from "../src/draft-store";
import {
  MarkdownFileConflictError,
  type Page,
  type StorageBackend,
} from "../src/storage";
import { setupDomMocks } from "./dom-mocks";

vi.mock("../src/detect-backend", async () => {
  const actual = await vi.importActual<typeof import("../src/detect-backend")>(
    "../src/detect-backend",
  );
  return { ...actual, detectBackend: vi.fn() };
});

const detectBackendMock = vi.mocked(detectBackend);

const DOCUMENT_PATH = "/work/plan.md";
const DRAFT_KEY = `${DRAFT_KEY_PREFIX}file:${DOCUMENT_PATH}`;

let container: HTMLDivElement;
let root: Root;

class SilentEventSource {
  static readonly CLOSED = 2;
  readyState = 0;
  onerror: (() => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

interface FakeBackend {
  backend: StorageBackend;
  saved: Array<{ content: string; expectedVersion?: string }>;
}

function createFakeBackend({
  kind = "local-files",
  content = "# Plan\n\nOn disk.\n",
  sessionId,
  originPath,
  conflictOnFirstSaveWith,
}: {
  kind?: "local-files" | "remote";
  content?: string;
  sessionId?: string;
  originPath?: string;
  /** What the destination claims to hold when it rejects the first save. */
  conflictOnFirstSaveWith?: string;
} = {}): FakeBackend {
  const saved: FakeBackend["saved"] = [];
  let conflictsLeft = conflictOnFirstSaveWith === undefined ? 0 : 1;
  const page: Page = {
    id: "plan.md",
    title: "Plan",
    content,
    version: "v1",
  };

  return {
    saved,
    backend: {
      info: {
        kind,
        label: kind === "remote" ? "Remote document" : "Local files",
        detail: kind === "remote" ? "origin.md" : "Markdown file on disk",
        projectPath: kind === "remote" ? undefined : "/work",
        sessionId,
        originPath,
      },
      canManageProjects: false,
      async getMarkdownFile() {
        return page;
      },
      async saveMarkdownFile(_path, nextContent, expectedVersion) {
        saved.push({ content: nextContent, expectedVersion });
        if (conflictsLeft > 0 && conflictOnFirstSaveWith !== undefined) {
          conflictsLeft -= 1;
          throw new MarkdownFileConflictError({
            ...page,
            content: conflictOnFirstSaveWith,
            version: "v-server",
          });
        }
        return { ...page, content: nextContent, version: "v2" };
      },
      async saveAsset(file) {
        return {
          markdownPath: file.name,
          previewUrl: `file://${file.name}`,
          mimeType: "application/octet-stream",
        };
      },
      resolveFileUrl: (path) => `file://${path}`,
      async openProject() {},
    },
  };
}

function writeDraftRecord({
  content,
  baseContent,
  key = DRAFT_KEY,
}: {
  content: string;
  baseContent: string | null;
  key?: string;
}) {
  localStorage.setItem(
    key,
    JSON.stringify({
      schema: 1,
      content,
      baseContent: baseContent ?? "",
      baseKnown: baseContent !== null,
      updatedAt: Date.now(),
    }),
  );
}

async function renderApp() {
  await act(async () => {
    root.render(<App />);
    await Promise.resolve();
  });
  // The boot path awaits backend detection and the document load.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function queryByTestId(testId: string) {
  return container.querySelector(`[data-testid="${testId}"]`);
}

/**
 * Wait for the outcome rather than for a duration: the save the app schedules
 * is debounced, and a fixed sleep is both slower than it needs to be and a
 * guess about how long is long enough.
 */
async function waitFor(condition: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the expected app state");
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("EventSource", SilentEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  setupDomMocks();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", `/?path=${DOCUMENT_PATH}&editor=code`);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("recovering unsent edits on boot", () => {
  it("sends the draft straight through when the file has not moved", async () => {
    const { backend, saved } = createFakeBackend();
    detectBackendMock.mockResolvedValue(backend);
    writeDraftRecord({
      content: "# Plan\n\nUnsent body.\n",
      baseContent: "# Plan\n\nOn disk.\n",
    });

    await renderApp();
    await waitFor(() => saved.length > 0);

    expect(queryByTestId("draft-restore-notice")).toBeNull();
    expect(saved.map((entry) => entry.content)).toContain(
      "# Plan\n\nUnsent body.\n",
    );
  });

  it("asks before restoring when the file moved under the draft", async () => {
    const { backend, saved } = createFakeBackend();
    detectBackendMock.mockResolvedValue(backend);
    writeDraftRecord({
      content: "# Plan\n\nUnsent body.\n",
      baseContent: "# Plan\n\nWhat we based on.\n",
    });

    await renderApp();
    await waitFor(() => queryByTestId("draft-restore-notice") !== null);

    expect(saved).toEqual([]);
  });

  it("always asks in a remote session, even when nothing moved", async () => {
    window.history.replaceState(null, "", "/?session=abc123&editor=code");
    localStorage.setItem(
      `${DRAFT_KEY_PREFIX}session:abc123`,
      "/work/origin.md",
    );
    writeDraftRecord({
      content: "# Plan\n\nUnsent body.\n",
      baseContent: "# Plan\n\nOn disk.\n",
      key: `${DRAFT_KEY_PREFIX}origin:/work/origin.md`,
    });
    const { backend, saved } = createFakeBackend({
      kind: "remote",
      sessionId: "abc123",
      originPath: "/work/origin.md",
    });
    detectBackendMock.mockResolvedValue(backend);

    await renderApp();
    await waitFor(() => queryByTestId("draft-restore-notice") !== null);

    expect(saved).toEqual([]);
  });

  it("leaves nothing behind when the draft already reached the file", async () => {
    const { backend, saved } = createFakeBackend();
    detectBackendMock.mockResolvedValue(backend);
    writeDraftRecord({
      content: "# Plan\n\nOn disk.\n",
      baseContent: "# Plan\n\nEarlier.\n",
    });

    await renderApp();

    expect(queryByTestId("draft-restore-notice")).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(saved).toEqual([]);
  });

  it("does not resurrect a draft the reviewer discarded", async () => {
    const { backend } = createFakeBackend();
    detectBackendMock.mockResolvedValue(backend);
    writeDraftRecord({
      content: "# Plan\n\nUnsent body.\n",
      baseContent: "# Plan\n\nWhat we based on.\n",
    });

    await renderApp();
    const discard = queryByTestId("draft-restore-action-discard");
    expect(discard).not.toBeNull();
    await act(async () => {
      discard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(queryByTestId("draft-restore-notice")).toBeNull();
  });

  it("sends the draft when the reviewer restores it", async () => {
    const { backend, saved } = createFakeBackend();
    detectBackendMock.mockResolvedValue(backend);
    writeDraftRecord({
      content: "# Plan\n\nUnsent body.\n",
      baseContent: "# Plan\n\nWhat we based on.\n",
    });

    await renderApp();
    await act(async () => {
      queryByTestId("draft-restore-action-restore")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    await waitFor(() => saved.length > 0);

    expect(saved.map((entry) => entry.content)).toContain(
      "# Plan\n\nUnsent body.\n",
    );
  });

  it("says the edits are safe when the server cannot be reached", async () => {
    detectBackendMock.mockRejectedValue(
      new BackendUnavailableError("Roughdraft could not reach the server."),
    );
    writeDraftRecord({
      content: "# Plan\n\nUnsent body.\n",
      baseContent: "# Plan\n\nOn disk.\n",
    });

    await renderApp();

    const notice = queryByTestId("backend-unavailable-notice");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("saved in this browser");
    expect(queryByTestId("backend-unavailable-retry")).not.toBeNull();
    expect(container.textContent).not.toContain(
      "Could not open that markdown file",
    );
  });

  it("still reports a document it genuinely cannot open", async () => {
    detectBackendMock.mockRejectedValue(new Error("ENOENT"));

    await renderApp();

    expect(queryByTestId("backend-unavailable-notice")).toBeNull();
    expect(document.body.textContent).toContain(
      "Could not open that markdown file",
    );
  });
});

describe("resolving a save conflict", () => {
  const DISK = "# Plan\n\nOn disk.\n";
  const UNSENT = "# Plan\n\nUnsent body.\n";

  /** Boot with a draft whose base matches disk, so the restore saves at once. */
  async function bootWithSilentRestore(
    options: Parameters<typeof createFakeBackend>[0],
    { expectedSaves = 1 }: { expectedSaves?: number } = {},
  ) {
    const fake = createFakeBackend(options);
    detectBackendMock.mockResolvedValue(fake.backend);
    writeDraftRecord({ content: UNSENT, baseContent: DISK });

    await renderApp();
    await waitFor(() => fake.saved.length >= expectedSaves);
    return fake;
  }

  it("accepts a conflict that reports our own write as already applied", async () => {
    const { saved } = await bootWithSilentRestore({
      conflictOnFirstSaveWith: UNSENT,
    });
    await waitFor(() => localStorage.getItem(DRAFT_KEY) === null);

    expect(saved).toHaveLength(1);
    expect(queryByTestId("file-conflict-notice")).toBeNull();
  });

  it("re-sends once with the fresh version when the destination still holds our base", async () => {
    const { saved } = await bootWithSilentRestore(
      { conflictOnFirstSaveWith: DISK },
      { expectedSaves: 2 },
    );

    expect(saved).toHaveLength(2);
    expect(saved[1]).toEqual({
      content: UNSENT,
      expectedVersion: "v-server",
    });
    expect(queryByTestId("file-conflict-notice")).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("asks the reviewer when the destination holds someone else's text", async () => {
    const { saved } = await bootWithSilentRestore({
      conflictOnFirstSaveWith: "# Plan\n\nSomeone else.\n",
    });
    await waitFor(() => queryByTestId("file-conflict-notice") !== null);

    expect(saved).toHaveLength(1);
    // The edits are still owed, so they must still be on the shelf.
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });
});
