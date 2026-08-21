import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { BackendUnavailableError, detectBackend } from "../src/detect-backend";
import { DRAFT_KEY_PREFIX } from "../src/draft-store";
import type { Page, StorageBackend } from "../src/storage";
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
}: {
  kind?: "local-files" | "remote";
  content?: string;
  sessionId?: string;
  originPath?: string;
} = {}): FakeBackend {
  const saved: FakeBackend["saved"] = [];
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(queryByTestId("draft-restore-notice")).not.toBeNull();
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(queryByTestId("draft-restore-notice")).not.toBeNull();
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

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
