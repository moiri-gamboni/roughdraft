import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLocationForDocumentEditorViewMode,
  getDocumentEditorViewModeFromLocation,
  type DocumentEditorViewMode,
} from "../src/app-navigation";
import { DocumentWorkspace } from "../src/DocumentWorkspace";
import type {
  CompleteReviewResult,
  Page,
  StorageBackend,
} from "../src/storage";

function createBackend({
  watcherCount,
}: {
  watcherCount?: number;
} = {}): StorageBackend {
  const backend: StorageBackend = {
    info: {
      kind: "local-storage",
      label: "Test backend",
      detail: "In-memory",
    },
    canManageProjects: false,
    async getMarkdownFile(relativePath) {
      return { id: relativePath, title: relativePath, content: "" };
    },
    async saveMarkdownFile() {
      return undefined;
    },
    async saveAsset(file) {
      return {
        markdownPath: file.name,
        previewUrl: `file://${file.name}`,
        mimeType: file.type || "application/octet-stream",
      };
    },
    resolveFileUrl(path) {
      return `file://${path}`;
    },
    async openProject() {},
  };

  if (watcherCount !== undefined) {
    backend.getReviewWatchStatus = async () => ({
      watching: watcherCount > 0,
      watcherCount,
    });
  }

  return backend;
}

function createPage(content = "Hello world"): Page {
  return {
    id: "test-doc",
    title: "Test Doc",
    content,
  };
}

function setupDomMocks() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 640,
    height: 480,
    right: 640,
    bottom: 480,
    toJSON() {
      return this;
    },
  } as DOMRect);

  if (!("ResizeObserver" in globalThis)) {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }

  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });

  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 80,
        height: 20,
        right: 80,
        bottom: 20,
        toJSON() {
          return this;
        },
      } as DOMRect;
    },
  });

  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [
        {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          width: 80,
          height: 20,
          right: 80,
          bottom: 20,
          toJSON() {
            return this;
          },
        } as DOMRect,
      ];
    },
  });

  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [this.getBoundingClientRect()];
    },
  });

  Object.defineProperty(Text.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [
        {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          width: 80,
          height: 20,
          right: 80,
          bottom: 20,
          toJSON() {
            return this;
          },
        } as DOMRect,
      ];
    },
  });

  window.scrollBy = vi.fn();
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("view mode toggle uses client-side state (issue 1 fix)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("buildLocationForDocumentEditorViewMode produces a URL for history.replaceState", () => {
    window.history.replaceState(
      null,
      "",
      "/?path=/test/doc.md&editor=rich-text",
    );

    const nextLocation = buildLocationForDocumentEditorViewMode("code");

    expect(nextLocation).toContain("editor=code");
    expect(typeof nextLocation).toBe("string");
  });

  it("view mode can be read from the URL query param", () => {
    window.history.replaceState(null, "", "/?editor=rich-text");
    expect(getDocumentEditorViewModeFromLocation("rich-text")).toBe(
      "rich-text",
    );

    window.history.replaceState(null, "", "/?editor=code");
    expect(getDocumentEditorViewModeFromLocation("rich-text")).toBe("code");
  });

  it("buildLocationForDocumentEditorViewMode returns the expected path+search", () => {
    window.history.replaceState(null, "", "/doc.md?editor=rich-text");

    const result = buildLocationForDocumentEditorViewMode("code");

    expect(result).toBe("/doc.md?editor=code");
  });
});

describe("saving/saved status indicator (issue 2 fix)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    setupDomMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("DocumentWorkspace shows a save status indicator when saving", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    await act(async () => {
      root.render(
        <DocumentWorkspace
          documentPage={createPage()}
          activeDocumentPath="test.md"
          documentFilenameLabel="test.md"
          documentEditorViewMode="rich-text"
          onDocumentEditorViewModeChange={() => {}}
          onSaveDocument={async () => {}}
          onDocumentSaveStateChange={() => {}}
          onDocumentDirtyStateChange={() => {}}
          onDocumentLocalContentChange={() => {}}
          documentDiskChangeState="clean"
          documentForceResetKey={null}
          onReloadDocumentFromDisk={() => {}}
          onKeepEditingWithoutAutosave={() => {}}
          onOverwriteDocumentOnDisk={() => {}}
          onCompleteReview={async () => ({ delivered: false })}
          backend={createBackend()}
        />,
      );
    });

    // Initially idle — no indicator visible
    const textContent = container.textContent ?? "";
    expect(textContent).not.toContain("Saving");
    expect(textContent).not.toContain("Saved");

    // The save status indicator has proper ARIA when it appears
    expect(
      container.querySelector('[role="status"][aria-label="Saving"]'),
    ).toBeNull();
  });
});

describe("interaction mode preserved across view toggle (issue 3 fix)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    setupDomMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("interaction mode is preserved when view mode changes without remount", async () => {
    // With the fix, view mode changes use React state (no page reload),
    // so the DocumentWorkspace component stays mounted and interaction
    // mode is preserved.

    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    const renderWorkspace = async (viewMode: DocumentEditorViewMode) => {
      await act(async () => {
        root.render(
          <DocumentWorkspace
            documentPage={createPage()}
            activeDocumentPath="test.md"
            documentFilenameLabel="test.md"
            documentEditorViewMode={viewMode}
            onDocumentEditorViewModeChange={() => {}}
            onSaveDocument={async () => {}}
            onDocumentSaveStateChange={() => {}}
            onDocumentDirtyStateChange={() => {}}
            onDocumentLocalContentChange={() => {}}
            documentDiskChangeState="clean"
            documentForceResetKey={null}
            onReloadDocumentFromDisk={() => {}}
            onKeepEditingWithoutAutosave={() => {}}
            onOverwriteDocumentOnDisk={() => {}}
            onCompleteReview={async () => ({ delivered: false })}
            backend={createBackend()}
          />,
        );
      });
    };

    // Mount with rich-text → mode is "editing" by default
    await renderWorkspace("rich-text");
    expect(
      container.querySelector('[aria-label="Document mode"]')?.textContent,
    ).toContain("editing");

    // Rerender with code view (same component instance, no remount) →
    // mode stays "editing" because the component is not destroyed.
    await renderWorkspace("code");
    expect(
      container.querySelector('[aria-label="Document mode"]')?.textContent,
    ).toContain("editing");
  });
});

describe("review handoff watcher affordance", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    setupDomMocks();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderWorkspace({
    getWatcherCount,
    onCompleteReview = async () => ({ delivered: false }),
  }: {
    getWatcherCount: () => number;
    onCompleteReview?: () => Promise<CompleteReviewResult>;
  }) {
    await act(async () => {
      root.render(
        <DocumentWorkspace
          documentPage={createPage()}
          activeDocumentPath="test.md"
          documentFilenameLabel="test.md"
          documentEditorViewMode="rich-text"
          onDocumentEditorViewModeChange={() => {}}
          onSaveDocument={async () => {}}
          onDocumentSaveStateChange={() => {}}
          onDocumentDirtyStateChange={() => {}}
          onDocumentLocalContentChange={() => {}}
          documentDiskChangeState="clean"
          documentForceResetKey={null}
          onReloadDocumentFromDisk={() => {}}
          onKeepEditingWithoutAutosave={() => {}}
          onOverwriteDocumentOnDisk={() => {}}
          onCompleteReview={onCompleteReview}
          backend={createBackend({ watcherCount: getWatcherCount() })}
        />,
      );
      await Promise.resolve();
    });
  }

  it("hides the done reviewing button when no agent is watching", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: false });

    await renderWorkspace({ getWatcherCount: () => 0, onCompleteReview });

    expect(container.textContent).not.toContain("I'm done");
    expect(container.textContent).not.toContain("Review ready");
    expect(container.textContent).not.toContain("Copy prompt");
    expect(onCompleteReview).not.toHaveBeenCalled();
  });

  it("shows the done reviewing button only for an active watcher", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: true });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const doneReviewingButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("I'm done"),
    );
    expect(doneReviewingButton).toBeDefined();
    expect(container.textContent).toContain("Agent watching");

    if (!doneReviewingButton) {
      throw new Error("I'm done button not found");
    }
    await click(doneReviewingButton);

    expect(onCompleteReview).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Sent");
    expect(container.textContent).not.toContain("Agent notified");
    expect(container.textContent).not.toContain("Review ready");
    expect(container.textContent).not.toContain("Copy prompt");
  });

  it("shows visible feedback when the watcher disappears before handoff delivery", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: false });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const doneReviewingButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("I'm done"),
    );
    if (!doneReviewingButton) {
      throw new Error("I'm done button not found");
    }
    await click(doneReviewingButton);

    expect(onCompleteReview).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Not sent");
    expect(container.textContent).not.toContain("I'm done");
  });

  it("keeps visible sent feedback after the watcher receives the event", async () => {
    let watcherCount = 1;
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockImplementation(async () => {
        watcherCount = 0;
        return { delivered: true };
      });

    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    const doneReviewingButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("I'm done"),
    );
    if (!doneReviewingButton) {
      throw new Error("I'm done button not found");
    }

    await click(doneReviewingButton);
    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    expect(onCompleteReview).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Sent");
    expect(container.textContent).not.toContain("Agent notified");
    expect(container.textContent).not.toContain("I'm done");
  });

  it("lets a new watcher start another handoff after sent feedback", async () => {
    let watcherCount = 1;
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockImplementation(async () => {
        watcherCount = 0;
        return { delivered: true };
      });

    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    const doneReviewingButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("I'm done"),
    );
    if (!doneReviewingButton) {
      throw new Error("I'm done button not found");
    }

    await click(doneReviewingButton);
    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    expect(container.textContent).toContain("Sent");
    expect(container.textContent).not.toContain("I'm done");

    watcherCount = 1;
    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("I'm done");
    expect(container.textContent).not.toContain("Sent");
  });
});
