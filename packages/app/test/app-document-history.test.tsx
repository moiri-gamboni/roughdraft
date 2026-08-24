import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { detectBackend } from "../src/detect-backend";
import { DRAFT_KEY_PREFIX, DRAFT_SCHEMA } from "../src/draft-store";
import {
  type DocumentHistory,
  type MarkdownFileChangeEvent,
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
const ON_DISK = "# Plan\n\nOn disk.\n";

/** Canonical snapshot ids, in the shape the store actually mints. */
const NEWER_ID = "2026-08-24T14-30-00-000Z--p2287619--save";
const OLDER_ID = "2026-08-24T14-28-49-104Z--p2287619--review";

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
  /** Report a change to whatever path the app actually subscribed to. */
  emitDiskChange(version: string): void;
  isWatched(): boolean;
  /** What the document reads as on the next load. */
  setDiskContent(content: string, version: string): void;
  historyCalls: string[];
  snapshotCalls: string[];
}

const DEFAULT_HISTORY: DocumentHistory = {
  snapshots: [
    {
      id: NEWER_ID,
      createdAt: "2026-08-24T14:30:00.000Z",
      trigger: "save",
      bytes: 24,
    },
    {
      id: OLDER_ID,
      createdAt: "2026-08-24T14:28:49.104Z",
      trigger: "review",
      bytes: 18,
    },
  ],
  unreadable: 0,
};

const SNAPSHOT_BODIES: Record<string, string> = {
  [NEWER_ID]: "# Plan\n\nThe saved body.\n",
  [OLDER_ID]: "# Plan\n\n{==Reviewed==}{>>Nice<<}{#c1}\n",
};

function createFakeBackend({
  content = ON_DISK,
  history = DEFAULT_HISTORY,
  withHistorySupport = true,
  historyError,
  conflictOnFirstSaveWith,
}: {
  content?: string;
  history?: DocumentHistory;
  withHistorySupport?: boolean;
  historyError?: Error;
  conflictOnFirstSaveWith?: string;
} = {}): FakeBackend {
  const saved: FakeBackend["saved"] = [];
  const historyCalls: string[] = [];
  const snapshotCalls: string[] = [];
  let conflictsLeft = conflictOnFirstSaveWith === undefined ? 0 : 1;
  let watcher: {
    path: string;
    onChange: (event: MarkdownFileChangeEvent) => void;
  } | null = null;
  const page: Page = {
    id: "plan.md",
    title: "Plan",
    content,
    version: "v1",
  };

  const historyMethods = withHistorySupport
    ? {
        async listSnapshots(relativePath: string): Promise<DocumentHistory> {
          historyCalls.push(relativePath);
          if (historyError) throw historyError;
          return history;
        },
        async getSnapshot(_relativePath: string, id: string): Promise<string> {
          snapshotCalls.push(id);
          const body = SNAPSHOT_BODIES[id];
          if (body === undefined) throw new Error(`No snapshot ${id}`);
          return body;
        },
      }
    : {};

  return {
    saved,
    historyCalls,
    snapshotCalls,
    isWatched: () => watcher !== null,
    setDiskContent(nextContent, version) {
      page.content = nextContent;
      page.version = version;
    },
    emitDiskChange(version) {
      if (!watcher) throw new Error("Nothing is watching the document");
      watcher.onChange({ path: watcher.path, exists: true, version });
    },
    backend: {
      watchMarkdownFile(relativePath, onChange) {
        watcher = { path: relativePath, onChange };
        return () => {
          watcher = null;
        };
      },
      info: {
        kind: "local-files",
        label: "Local files",
        detail: "Markdown file on disk",
        projectPath: "/work",
      },
      canManageProjects: false,
      async getMarkdownFile() {
        return { ...page };
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
        page.content = nextContent;
        page.version = "v2";
        return { ...page };
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
      ...historyMethods,
    },
  };
}

function writeDraftRecord({
  content,
  baseContent,
}: {
  content: string;
  baseContent: string | null;
}) {
  localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      schema: DRAFT_SCHEMA,
      content,
      baseContent,
      updatedAt: Date.now(),
    }),
  );
}

async function renderApp() {
  await act(async () => {
    root.render(<App />);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The dialog renders through a portal, so it is not inside `container`. */
function queryByTestId(testId: string) {
  return document.body.querySelector(`[data-testid="${testId}"]`);
}

function queryAllByTestId(testId: string) {
  return Array.from(
    document.body.querySelectorAll(`[data-testid="${testId}"]`),
  );
}

async function click(element: Element | null) {
  if (!element) throw new Error("Nothing to click");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

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

/** Open the history dialog from the header control and wait for the list. */
async function openHistory() {
  await click(queryByTestId("document-history-trigger"));
  await waitFor(() => queryByTestId("document-history-dialog") !== null);
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

describe("browsing document history", () => {
  it("offers no history control when the backend cannot list snapshots", async () => {
    const { backend } = createFakeBackend({ withHistorySupport: false });
    detectBackendMock.mockResolvedValue(backend);

    await renderApp();

    expect(queryByTestId("document-history-trigger")).toBeNull();
  });

  it("does not ask for the history until the reviewer opens it", async () => {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();

    expect(queryByTestId("document-history-trigger")).not.toBeNull();
    expect(fake.historyCalls).toEqual([]);
  });

  it("lists the snapshots newest first, with trigger, time and size", async () => {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistory();
    await waitFor(() => queryAllByTestId("document-history-entry").length > 0);

    const entries = queryAllByTestId("document-history-entry");
    expect(
      entries.map((entry) => entry.getAttribute("data-snapshot-id")),
    ).toEqual([NEWER_ID, OLDER_ID]);
    expect(entries[0]?.textContent).toContain("save");
    expect(entries[1]?.textContent).toContain("review");
    // The size is what tells a reviewer an empty clobber apart from real text.
    expect(entries[0]?.textContent).toContain("24 B");
  });

  it("says so rather than showing an empty list when there is no history", async () => {
    const fake = createFakeBackend({
      history: { snapshots: [], unreadable: 0 },
    });
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistory();
    await waitFor(() => queryByTestId("document-history-empty") !== null);

    expect(queryAllByTestId("document-history-entry")).toHaveLength(0);
  });

  it("surfaces snapshots it could not read, because they are recoverable bytes", async () => {
    const fake = createFakeBackend({
      history: { ...DEFAULT_HISTORY, unreadable: 3 },
    });
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistory();
    await waitFor(() => queryByTestId("document-history-unreadable") !== null);

    expect(queryByTestId("document-history-unreadable")?.textContent).toContain(
      "3",
    );
  });

  it("keeps quiet about unreadable snapshots when there are none", async () => {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistory();
    await waitFor(() => queryAllByTestId("document-history-entry").length > 0);

    expect(queryByTestId("document-history-unreadable")).toBeNull();
  });

  it("reports a history it could not load at all", async () => {
    const fake = createFakeBackend({
      historyError: new Error("History unavailable"),
    });
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistory();
    await waitFor(() => queryByTestId("document-history-error") !== null);
  });

  it("shows a chosen snapshot as raw markdown, markers and all", async () => {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistory();
    await waitFor(() => queryAllByTestId("document-history-entry").length > 0);

    await click(queryAllByTestId("document-history-entry")[1] ?? null);
    await waitFor(() => queryByTestId("document-history-viewer") !== null);

    // A rendered view would hide the CriticMarkup; a snapshot is a fossil and
    // has to show every marker it holds.
    expect(queryByTestId("document-history-viewer")?.textContent).toContain(
      "{==Reviewed==}",
    );
    expect(fake.snapshotCalls).toEqual([OLDER_ID]);
  });
});

/** Open the dialog and select the newest snapshot, ready to restore. */
async function openHistoryAndSelectNewest() {
  await openHistory();
  await waitFor(() => queryAllByTestId("document-history-entry").length > 0);
  await click(queryAllByTestId("document-history-entry")[0] ?? null);
  await waitFor(() => queryByTestId("document-history-viewer") !== null);
}

function restoreButton() {
  return queryByTestId("document-history-restore") as HTMLButtonElement | null;
}

describe("restoring a snapshot", () => {
  it("sends the chosen version back to the file as a forward save", async () => {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistoryAndSelectNewest();
    await click(restoreButton());
    await waitFor(() => fake.saved.length > 0);

    expect(fake.saved.map((entry) => entry.content)).toContain(
      SNAPSHOT_BODIES[NEWER_ID],
    );
    // A forward save, so it quotes the version it loaded and a moved file would
    // still come back as a conflict rather than being clobbered.
    expect(fake.saved[0]?.expectedVersion).toBe("v1");
  });

  it("closes the dialog once the restore is on its way", async () => {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistoryAndSelectNewest();
    await click(restoreButton());

    await waitFor(() => queryByTestId("document-history-dialog") === null);
  });

  it("sends the same version again when asked to restore it twice", async () => {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistoryAndSelectNewest();
    await click(restoreButton());
    await waitFor(() => fake.saved.length > 0);

    await openHistoryAndSelectNewest();
    await click(restoreButton());
    await waitFor(() => fake.saved.length > 1);

    expect(fake.saved[1]?.content).toBe(SNAPSHOT_BODIES[NEWER_ID]);
  });
});

describe("seeing what changed", () => {
  it("shows the snapshot itself before it shows a diff", async () => {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistoryAndSelectNewest();

    expect(queryByTestId("document-history-viewer")).not.toBeNull();
    expect(queryByTestId("document-history-diff")).toBeNull();
  });

  it("lists what the open document added and removed against that version", async () => {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistoryAndSelectNewest();
    await click(queryByTestId("document-history-view-diff"));
    await waitFor(() => queryByTestId("document-history-diff") !== null);

    const diff = queryByTestId("document-history-diff");
    // The snapshot holds "The saved body."; the open document holds "On disk."
    expect(diff?.textContent).toContain("The saved body.");
    expect(diff?.textContent).toContain("On disk.");
    expect(
      queryAllByTestId("document-history-diff-line-removed").length,
    ).toBeGreaterThan(0);
    expect(
      queryAllByTestId("document-history-diff-line-added").length,
    ).toBeGreaterThan(0);
  });

  it("says so plainly when the version matches the open document", async () => {
    // The snapshot and the file hold the same bytes, so a diff pane full of
    // context lines would make the reviewer hunt for a change that is not there.
    const fake = createFakeBackend({ content: SNAPSHOT_BODIES[NEWER_ID] });
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistoryAndSelectNewest();
    await click(queryByTestId("document-history-view-diff"));
    await waitFor(
      () => queryByTestId("document-history-diff-unchanged") !== null,
    );

    expect(queryByTestId("document-history-diff")).toBeNull();
  });

  it("goes back to the snapshot when the reviewer switches back", async () => {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistoryAndSelectNewest();
    await click(queryByTestId("document-history-view-diff"));
    await waitFor(() => queryByTestId("document-history-diff") !== null);
    await click(queryByTestId("document-history-view-snapshot"));

    await waitFor(() => queryByTestId("document-history-viewer") !== null);
    expect(queryByTestId("document-history-diff")).toBeNull();
  });
});

describe("restoring when the destination will not take a plain save", () => {
  const UNSENT = "# Plan\n\nUnsent body.\n";

  /** Boot into a real save conflict, the state that blocks a forward save. */
  async function bootIntoConflict() {
    const fake = createFakeBackend({
      conflictOnFirstSaveWith: "# Plan\n\nSomeone else.\n",
    });
    detectBackendMock.mockResolvedValue(fake.backend);
    writeDraftRecord({ content: UNSENT, baseContent: ON_DISK });

    await renderApp();
    await waitFor(() => queryByTestId("file-conflict-notice") !== null);
    return fake;
  }

  it("refuses a plain restore and offers to overwrite instead", async () => {
    await bootIntoConflict();
    await openHistoryAndSelectNewest();

    expect(restoreButton()?.disabled).toBe(true);
    expect(queryByTestId("document-history-restore-overwrite")).not.toBeNull();
    expect(
      queryByTestId("document-history-restore-blocked")?.textContent,
    ).toContain("changed on disk");
  });

  it("writes the snapshot over the file when the reviewer takes the escape", async () => {
    const fake = await bootIntoConflict();
    const savedBefore = fake.saved.length;
    await openHistoryAndSelectNewest();
    await click(queryByTestId("document-history-restore-overwrite"));
    await waitFor(() => fake.saved.length > savedBefore);

    const overwrite = fake.saved[fake.saved.length - 1];
    expect(overwrite?.content).toBe(SNAPSHOT_BODIES[NEWER_ID]);
    // No version: the whole point of the escape is not to be refused again.
    expect(overwrite?.expectedVersion).toBeUndefined();
  });

  it("is still listening to the file after the escape wrote", async () => {
    // The watcher stands down while a restore is in flight. This is the first
    // path that ends a restore through the overwrite handler, so if that
    // handler forgot to clear the marker the tab would go deaf for good.
    const fake = await bootIntoConflict();
    const savedBefore = fake.saved.length;
    await openHistoryAndSelectNewest();
    await click(queryByTestId("document-history-restore-overwrite"));
    await waitFor(() => fake.saved.length > savedBefore);
    await waitFor(() => queryByTestId("file-conflict-notice") === null);

    await act(async () => {
      fake.emitDiskChange("v-someone-else");
      await Promise.resolve();
    });

    await waitFor(() => queryByTestId("external-change-notice") !== null);
  });
});

describe("yielding to an unsent draft", () => {
  it("will not restore over an offer the reviewer has not answered", async () => {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);
    writeDraftRecord({
      content: "# Plan\n\nUnsent body.\n",
      baseContent: "# Plan\n\nWhat we based on.\n",
    });

    await renderApp();
    await waitFor(() => queryByTestId("draft-restore-notice") !== null);
    await openHistoryAndSelectNewest();

    expect(restoreButton()?.disabled).toBe(true);
    // Overwriting here would answer the unsent-draft question by destroying it.
    expect(queryByTestId("document-history-restore-overwrite")).toBeNull();
    expect(
      queryByTestId("document-history-restore-blocked")?.textContent,
    ).toContain("unsent-draft offer");
  });
});

describe("telling the reviewer their text moved", () => {
  async function bootAndTakeAnExternalWrite() {
    const fake = createFakeBackend();
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    fake.setDiskContent("# Plan\n\nAn agent's body.\n", "v-agent");
    await act(async () => {
      fake.emitDiskChange("v-agent");
      await Promise.resolve();
    });
    await waitFor(() => queryByTestId("external-change-notice") !== null);
    return fake;
  }

  it("says so after a silent reload, and points at the history", async () => {
    await bootAndTakeAnExternalWrite();

    expect(queryByTestId("external-change-notice-view-history")).not.toBeNull();
  });

  it("stays out of the way once dismissed", async () => {
    await bootAndTakeAnExternalWrite();
    await click(queryByTestId("external-change-notice-dismiss"));

    expect(queryByTestId("external-change-notice")).toBeNull();
  });

  it("does not block anything, unlike a real conflict", async () => {
    await bootAndTakeAnExternalWrite();

    // A disk-change state would pause autosave and gate the review handoff.
    // This notice is only news, so neither may happen.
    expect(queryByTestId("file-conflict-notice")).toBeNull();
    expect(
      document.body
        .querySelector('[data-testid="document-save-status"]')
        ?.getAttribute("aria-label"),
    ).not.toBe("Autosave paused");
  });

  it("opens the history from the notice", async () => {
    await bootAndTakeAnExternalWrite();
    await click(queryByTestId("external-change-notice-view-history"));

    await waitFor(() => queryByTestId("document-history-dialog") !== null);
  });
});
