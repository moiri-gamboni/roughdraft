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
  /** The version each save handed back, in order. */
  versionsWritten: string[];
  /** Report a change to whatever path the app actually subscribed to. */
  emitDiskChange(version: string): void;
  /** What the document reads as on the next load. */
  setDiskContent(content: string, version: string): void;
  historyCalls: string[];
  snapshotCalls: string[];
  /** Let parked snapshot reads answer newest-request-first, so the earliest
   * request is the one that settles last. */
  releaseHeldSnapshotsInReverse(): void;
  setSavesFail(fail: boolean): void;
  heldSnapshotCount(): number;
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
  holdSnapshots = false,
}: {
  content?: string;
  history?: DocumentHistory;
  withHistorySupport?: boolean;
  historyError?: Error;
  conflictOnFirstSaveWith?: string;
  /** Park every snapshot read so the test decides what answers, and when. */
  holdSnapshots?: boolean;
} = {}): FakeBackend {
  /** Not a conflict: the destination is simply not answering. */
  let savesFail = false;
  const saved: FakeBackend["saved"] = [];
  const historyCalls: string[] = [];
  const snapshotCalls: string[] = [];
  const heldSnapshots: Array<() => void> = [];
  let conflictsLeft = conflictOnFirstSaveWith === undefined ? 0 : 1;
  let savedVersionCount = 0;
  const versionsWritten: string[] = [];
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
          if (holdSnapshots) {
            await new Promise<void>((resolve) => {
              heldSnapshots.push(resolve);
            });
          }
          return body;
        },
      }
    : {};

  return {
    saved,
    versionsWritten,
    historyCalls,
    snapshotCalls,
    heldSnapshotCount: () => heldSnapshots.length,
    setSavesFail(fail) {
      savesFail = fail;
    },
    releaseHeldSnapshotsInReverse() {
      const waiting = heldSnapshots.splice(0, heldSnapshots.length).reverse();
      for (const resolve of waiting) resolve();
    },
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
        if (savesFail) {
          throw new Error("The destination is unreachable");
        }
        if (conflictsLeft > 0 && conflictOnFirstSaveWith !== undefined) {
          conflictsLeft -= 1;
          throw new MarkdownFileConflictError({
            ...page,
            content: conflictOnFirstSaveWith,
            version: "v-server",
          });
        }
        page.content = nextContent;
        // A fresh version per save, as a real backend gives: two saves that
        // both reported "v2" would hide whether the app remembers each one.
        savedVersionCount += 1;
        page.version = `v-saved-${savedVersionCount}`;
        versionsWritten.push(page.version);
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

/**
 * Waits on the outcome, not on a duration. The budget is generous because
 * these cases boot the real `App` and mount CodeMirror inside a portal; under
 * a loaded machine and a parallel suite that is comfortably slower than the
 * 3s the lighter harnesses use, and a timeout here says "slow", not "broken".
 */
async function waitFor(condition: () => boolean, timeoutMs = 15_000) {
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
    expect(entries[0]?.textContent).toContain("saved");
    expect(entries[1]?.textContent).toContain("reviewed");
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

describe("choosing versions faster than they load", () => {
  it("shows the version last clicked, not the read that answers last", async () => {
    // Two reads in flight at once. The first one clicked answers last, so a
    // viewer that simply takes whatever arrives would settle on the version
    // the reviewer has already moved off — and then Restore would send those
    // bytes, which is a wrong-version restore, not just a display glitch.
    const fake = createFakeBackend({ holdSnapshots: true });
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    await openHistory();
    await waitFor(() => queryAllByTestId("document-history-entry").length > 0);

    const entries = queryAllByTestId("document-history-entry");
    await click(entries[1] ?? null); // older, resolves first once released
    await click(entries[0] ?? null); // newer, the reviewer's actual choice
    await waitFor(() => fake.heldSnapshotCount() === 2);

    await act(async () => {
      fake.releaseHeldSnapshotsInReverse();
      await Promise.resolve();
    });
    await waitFor(() => queryByTestId("document-history-viewer") !== null);

    expect(queryByTestId("document-history-viewer")?.textContent).toContain(
      "The saved body.",
    );
    expect(queryByTestId("document-history-viewer")?.textContent).not.toContain(
      "{==Reviewed==}",
    );
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

  it("does not report the overwrite's own echo as an external change", async () => {
    // The server's watcher polls, so the echo of our own write can arrive after
    // a later save has moved the document on. Recognising it then depends on
    // the overwrite having recorded the version it wrote — the plain save path
    // does, and this one used to not.
    const fake = await bootIntoConflict();
    const savedBefore = fake.saved.length;
    await openHistoryAndSelectNewest();
    await click(queryByTestId("document-history-restore-overwrite"));
    await waitFor(() => fake.saved.length > savedBefore);
    await waitFor(() => queryByTestId("file-conflict-notice") === null);
    const overwriteVersion = fake.versionsWritten.at(-1) as string;

    // A later save, so the echo below can no longer be recognised by the
    // document's current version alone.
    await openHistoryAndSelectNewest();
    await click(restoreButton());
    await waitFor(() => fake.versionsWritten.length > 1);
    await waitFor(() => queryByTestId("document-history-dialog") === null);

    await act(async () => {
      fake.emitDiskChange(overwriteVersion);
      await Promise.resolve();
    });

    await waitFor(() => queryByTestId("document-history-dialog") === null);
    expect(queryByTestId("external-change-notice")).toBeNull();
  });
});

describe("when a restore cannot be delivered", () => {
  /** Get into a non-clean state, then make the destination unreachable. */
  async function bootIntoConflictWithDeadSaves() {
    const fake = createFakeBackend({
      conflictOnFirstSaveWith: "# Plan\n\nSomeone else.\n",
    });
    detectBackendMock.mockResolvedValue(fake.backend);
    writeDraftRecord({
      content: "# Plan\n\nUnsent body.\n",
      baseContent: ON_DISK,
    });

    await renderApp();
    await waitFor(() => queryByTestId("file-conflict-notice") !== null);
    fake.setSavesFail(true);
    return fake;
  }

  it("keeps hearing the file when the overwrite never lands", async () => {
    // The watcher stands down while a restore is in flight. If the write that
    // was going to end the restore throws instead, nothing else lifts that —
    // and the tab goes deaf for the rest of the session, which is the very
    // failure the restore channel's conflict path was fixed for.
    //
    // The conflict notice is already up here, so its mere presence proves
    // nothing: the assertion is that a later external write still moves it.
    const conflictNoticeSays = (text: string) =>
      queryByTestId("file-conflict-notice")?.textContent?.includes(text) ??
      false;

    const fake = await bootIntoConflictWithDeadSaves();
    const savedBefore = fake.saved.length;
    await waitFor(() => conflictNoticeSays("Save conflict"));

    await openHistoryAndSelectNewest();
    await click(queryByTestId("document-history-restore-overwrite"));
    await waitFor(() => fake.saved.length > savedBefore);

    fake.setSavesFail(false);
    await act(async () => {
      fake.emitDiskChange("v-someone-else");
      await Promise.resolve();
    });

    await waitFor(() => conflictNoticeSays("File changed on disk"));
  });

  it("lets the reviewer try the same version again after a failed restore", async () => {
    // A failed restore must not wedge the button: the second attempt at the
    // same version still has to reach the file once saves work again.
    const fake = await bootIntoConflictWithDeadSaves();

    await openHistoryAndSelectNewest();
    await click(queryByTestId("document-history-restore-overwrite"));
    await waitFor(() => fake.saved.length >= 2);

    const savedAfterFirst = fake.saved.length;
    fake.setSavesFail(false);
    await openHistoryAndSelectNewest();
    await click(queryByTestId("document-history-restore-overwrite"));

    await waitFor(() => fake.saved.length > savedAfterFirst);
    expect(fake.saved[fake.saved.length - 1]?.content).toBe(
      SNAPSHOT_BODIES[NEWER_ID],
    );
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

  it("still says so on a backend that watches but cannot browse history", async () => {
    // A remote session watches the origin file but serves no snapshots. Gating
    // the whole notice on the browse controls replaced the reviewer's text
    // under them with no banner and nothing to click.
    const fake = createFakeBackend({ withHistorySupport: false });
    detectBackendMock.mockResolvedValue(fake.backend);

    await renderApp();
    fake.setDiskContent("# Plan\n\nAn agent's body.\n", "v-agent");
    await act(async () => {
      fake.emitDiskChange("v-agent");
      await Promise.resolve();
    });

    await waitFor(() => queryByTestId("external-change-notice") !== null);
    expect(queryByTestId("external-change-notice-view-history")).toBeNull();
    expect(queryByTestId("external-change-notice-dismiss")).not.toBeNull();
  });
});
