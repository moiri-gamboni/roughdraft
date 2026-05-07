# Save Indicator Command-S Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use trycycle-executing to implement this plan task-by-task.

**Goal:** Give Roughdraft users persistent confidence that the visible Markdown document is saved, and make `Cmd-S` / `Ctrl-S` flush the current document instead of opening the browser's Save Page dialog.

**Architecture:** Keep autosave as the primary persistence model, but promote it from a transient implementation detail into a document save controller owned by `PageCard`, because `PageCard` is the component that has the current rich-text/code markdown and debounce state. `DocumentWorkspace` should own document-level UX: persistent save status in the top-right handoff/status cluster, a capture-phase save shortcut handler, and blocked/conflict messaging. `App` remains the single backend persistence boundary through `handleSaveDocument`, preserving stale-write `expectedVersion` behavior for local and remote documents.

**Tech Stack:** React 19, TypeScript, Vite, Vitest/jsdom, Playwright, TipTap, CodeMirror, shadcn-style local UI primitives, lucide-react icons.

---

## Strategy Gate

The user's complaint is not that Roughdraft lacks a file picker or a new save workflow. The problem is that the browser currently owns `Cmd-S`, and the UI does not continuously answer whether the screen version is the persisted version. Do not implement `Save As`, a document database, a git action, or a new file lifecycle.

The clean steady-state architecture is:

- `PageCard` reports the truth about local markdown save state and exposes `flushSave()`.
- `DocumentWorkspace` renders that truth and binds the platform save shortcut.
- `App` keeps backend saves centralized and version-checked.

This directly lands the requested end state: visible save confidence plus a reliable manual save shortcut. It also aligns with ADR 0001's single Markdown file boundary, ADR 0003's round-trip contract, and ADR 0004's stale-write/versioned server model.

Key decisions:

- Use `Cmd-S` on macOS and `Ctrl-S` elsewhere, but prevent the browser save dialog for either shortcut whenever a Roughdraft document is open. This is safer than platform-sniffing for prevention because users may use either shortcut and the browser behavior is always wrong inside the document editor.
- Keep the persistent indicator separate from `I'm done`. `I'm done` means handoff to an agent; save status means the visible document has persisted.
- Put the save indicator in the fixed top-right handoff/status area. When `I'm done` is visible, render the save indicator directly below it in the same vertical stack.
- Reuse the existing stale-write path. Manual save must call the same `onSaveDocument` path as autosave, with the same `expectedVersion` logic in `App`.
- Add a lightweight `beforeunload` warning only for risky states: dirty, saving, failed, or disk-change blocked. Do not warn for a clean saved document.

## End-State Behavior

- Initial opened document shows `Saved`.
- Editing shows `Saving` while a debounced save is pending or a write is in flight.
- After the backend acknowledges the visible markdown, the indicator returns to persistent `Saved`.
- If saving fails for a non-conflict reason, the indicator shows `Save failed`.
- If local content is dirty but a save is blocked, the indicator shows `Unsaved changes` or the more specific blocked state supplied by the existing conflict banner.
- If the file changed on disk or autosave is paused, the existing amber banner remains the prominent explanation, and the top-right save status must not imply the draft was saved.
- Pressing `Cmd-S` / `Ctrl-S` with a document open always calls `preventDefault()` in capture phase.
- Pressing `Cmd-S` / `Ctrl-S` with pending autosave cancels the debounce and immediately writes the current rich-text or code-mode markdown.
- Pressing `Cmd-S` / `Ctrl-S` when already saved is harmless and keeps/refocuses the `Saved` confirmation.
- Pressing `Cmd-S` / `Ctrl-S` while conflict-blocked still prevents the browser dialog and leaves the conflict UI visible.
- Closing/reloading the tab warns only when there is a real local risk: dirty, saving, failed, changed/conflict/paused.

### Task 1: Add Failing PageCard Save Controller Tests

**Files:**
- Modify: `packages/app/test/page-card.test.tsx`

**Step 1: Extend the PageCard test harness**

Add support for the new controller callback before implementing it. The test should fail to compile until the production prop exists.

```tsx
import type { DocumentSaveController } from "../src/PageCard";

type RenderedPageCard = {
  container: HTMLDivElement;
  onSave: ReturnType<typeof vi.fn>;
  onSaveStateChange: ReturnType<typeof vi.fn>;
  getEditor: () => Editor;
  getSaveController: () => DocumentSaveController;
  rerender: (overrides?: PageCardTestOptions) => Promise<void>;
  unmount: () => Promise<void>;
};

let saveController: DocumentSaveController | null = null;

let props = {
  // existing props...
  onSaveControllerChange: (controller: DocumentSaveController | null) => {
    saveController = controller;
  },
} as const;
```

Return `getSaveController()` from `renderPageCard()`:

```tsx
getSaveController() {
  expect(saveController).not.toBeNull();
  return saveController as DocumentSaveController;
},
```

**Step 2: Write the failing rich-text flush test**

Add this test under `describe("PageCard editor integration", ...)` near the existing autosave tests:

```tsx
it("manual save flushes pending rich-text autosave immediately", async () => {
  const rendered = await renderPageCard({
    page: {
      id: "doc-manual-save-rich-1",
      title: "Manual Save Rich",
      content: "Start",
    },
    selected: true,
  });

  vi.useFakeTimers();

  await insertTextAtEnd(rendered.getEditor(), " now");

  expect(rendered.onSaveStateChange.mock.calls.at(-1)?.[0]).toBe("saving");
  expect(rendered.onSave).not.toHaveBeenCalled();

  await act(async () => {
    await rendered.getSaveController().flushSave();
  });

  expect(rendered.onSave).toHaveBeenCalledTimes(1);
  expect(rendered.onSave).toHaveBeenCalledWith(
    "doc-manual-save-rich-1",
    expect.stringContaining("Start now"),
  );

  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
  });

  expect(rendered.onSave).toHaveBeenCalledTimes(1);
  expect(rendered.onSaveStateChange.mock.calls.at(-1)?.[0]).toBe("saved");
});
```

**Step 3: Do not add a CodeMirror jsdom input test**

Do not try to simulate CodeMirror typing in jsdom here. The PageCard unit test should prove the save controller flushes the current markdown immediately, and Task 7 will cover code-mode typing plus `Cmd-S` in a real browser. This avoids a brittle unit test that depends on CodeMirror internals rather than Roughdraft behavior.

**Step 4: Run the focused failing test**

Run:

```bash
pnpm --filter @roughdraft/app exec vitest run test/page-card.test.tsx
```

Expected: FAIL because `DocumentSaveController` and `onSaveControllerChange` do not exist yet, and/or `flushSave` is not implemented.

**Step 5: Commit**

Do not commit yet if the suite cannot compile because implementation is next. Keep this as the red step for Task 2.

### Task 2: Implement PageCard Save Controller

**Files:**
- Modify: `packages/app/src/PageCard.tsx`
- Modify: `packages/app/test/page-card.test.tsx`

**Step 1: Replace the narrow save-state type**

At the top of `packages/app/src/PageCard.tsx`, replace:

```ts
type SaveState = "idle" | "saving" | "error";
```

with exported document save types:

```ts
export type DocumentSaveState = "saved" | "unsaved" | "saving" | "error";

export type ManualSaveResult =
  | { status: "saved" }
  | { status: "blocked" }
  | { status: "error"; error: unknown };

export interface DocumentSaveController {
  flushSave: () => Promise<ManualSaveResult>;
}
```

Use `DocumentSaveState` everywhere this file currently uses `SaveState`.

**Step 2: Add the controller prop**

Add this prop to both `PageCardProps` and `PageCardEditorSurfaceProps`:

```ts
onSaveControllerChange?: (controller: DocumentSaveController | null) => void;
```

Pass it from `PageCard` into `PageCardEditorSurface`.

**Step 3: Track save state from the editor surface**

Initialize the public save state as saved:

```tsx
const [saveState, setSaveState] = useState<DocumentSaveState>("saved");
```

In `PageCardEditorSurface`, keep these refs:

```ts
const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
const inFlightSaveRef = useRef<Promise<ManualSaveResult> | null>(null);
const pendingMarkdownRef = useRef(page.content);
const lastAcceptedMarkdownRef = useRef(page.content);
const localDirtyRef = useRef(false);
```

`pendingMarkdownRef.current` must be updated in every path that updates local markdown.

**Step 4: Extract a single save executor**

Inside `PageCardEditorSurface`, add:

```ts
const rememberRecentMarkdown = useCallback((nextMarkdown: string) => {
  recentMarkdownRef.current.add(nextMarkdown);
  if (recentMarkdownRef.current.size > 10) {
    const iterator = recentMarkdownRef.current.values();
    recentMarkdownRef.current.delete(iterator.next().value as string);
  }
}, []);

const performSave = useCallback(
  async (nextMarkdown: string): Promise<ManualSaveResult> => {
    if (saveBlocked) {
      onSaveStateChange(
        nextMarkdown === lastAcceptedMarkdownRef.current ? "saved" : "unsaved",
      );
      return { status: "blocked" };
    }

    rememberRecentMarkdown(nextMarkdown);
    onSaveStateChange("saving");

    try {
      await onSave(page.id, nextMarkdown);
      lastAcceptedMarkdownRef.current = nextMarkdown;
      reportDirtyState(pendingMarkdownRef.current !== nextMarkdown);
      onSaveStateChange(
        pendingMarkdownRef.current === nextMarkdown ? "saved" : "saving",
      );
      return { status: "saved" };
    } catch (error) {
      console.error("Failed to save page:", error);
      onSaveStateChange("error");
      return { status: "error", error };
    }
  },
  [
    onSave,
    onSaveStateChange,
    page.id,
    rememberRecentMarkdown,
    reportDirtyState,
    saveBlocked,
  ],
);
```

If a save finishes after the user has made a newer edit, it must not clear dirty state for the newer edit. That is why the post-save state compares `pendingMarkdownRef.current` to `nextMarkdown`.

**Step 5: Implement debounced autosave through the executor**

Replace the existing `scheduleSave` body with:

```ts
const scheduleSave = useCallback(
  (nextMarkdown: string) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    if (saveBlocked) {
      onSaveStateChange("unsaved");
      return;
    }

    onSaveStateChange("saving");
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      inFlightSaveRef.current = performSave(nextMarkdown).finally(() => {
        inFlightSaveRef.current = null;
      });
      void inFlightSaveRef.current;
    }, 500);
  },
  [onSaveStateChange, performSave, saveBlocked],
);
```

**Step 6: Implement manual flush**

Add:

```ts
const flushSave = useCallback(async (): Promise<ManualSaveResult> => {
  if (saveTimer.current) {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }

  const currentMarkdown = pendingMarkdownRef.current;

  if (
    currentMarkdown === lastAcceptedMarkdownRef.current &&
    !inFlightSaveRef.current
  ) {
    onSaveStateChange("saved");
    return { status: "saved" };
  }

  if (inFlightSaveRef.current) {
    await inFlightSaveRef.current;
    if (pendingMarkdownRef.current === lastAcceptedMarkdownRef.current) {
      onSaveStateChange("saved");
      return { status: "saved" };
    }
  }

  const result = await performSave(pendingMarkdownRef.current);
  return result;
}, [onSaveStateChange, performSave]);
```

Then register it:

```ts
useEffect(() => {
  onSaveControllerChange?.({ flushSave });
  return () => onSaveControllerChange?.(null);
}, [flushSave, onSaveControllerChange]);
```

**Step 7: Update markdown-change and accept paths**

In `acceptMarkdown(nextMarkdown)`, add:

```ts
pendingMarkdownRef.current = nextMarkdown;
onSaveStateChange("saved");
```

In `handleMarkdownChange(nextMarkdown)`, add:

```ts
pendingMarkdownRef.current = nextMarkdown;
```

before `setMarkdown(nextMarkdown)`.

When `saveBlocked` becomes true and a timer is cancelled, set state to:

```ts
onSaveStateChange(
  pendingMarkdownRef.current === lastAcceptedMarkdownRef.current
    ? "saved"
    : "unsaved",
);
```

not `"idle"`.

**Step 8: Run the focused tests**

Run:

```bash
pnpm --filter @roughdraft/app exec vitest run test/page-card.test.tsx
```

Expected: PASS for the new manual flush test and existing autosave tests.

**Step 9: Commit**

```bash
git add packages/app/src/PageCard.tsx packages/app/test/page-card.test.tsx
git commit -m "feat: add document save controller"
```

### Task 3: Add Failing DocumentWorkspace Status and Shortcut Tests

**Files:**
- Modify: `packages/app/test/view-toggle-bugs.test.tsx`

**Step 1: Update imports**

Import the new types:

```ts
import type { DocumentSaveState } from "../src/PageCard";
```

**Step 2: Add direct save-status component coverage**

The persistent status states are a view concern. Export the status component from `DocumentWorkspace.tsx` in Task 4 so tests can cover every state without faking PageCard internals.

Add this import, which should fail until Task 4 implements it:

```ts
import {
  DocumentSaveStatusIndicator,
  DocumentWorkspace,
} from "../src/DocumentWorkspace";
```

Add a helper:

```tsx
async function renderSaveStatus({
  saveState = "saved",
  documentDiskChangeState = "clean",
}: {
  saveState?: DocumentSaveState;
  documentDiskChangeState?: "clean" | "changed" | "conflict" | "paused";
} = {}) {
  await act(async () => {
    root.render(
      <DocumentSaveStatusIndicator
        saveState={saveState}
        diskChangeState={documentDiskChangeState}
      />,
    );
    await Promise.resolve();
  });
}
```

Then add:

```tsx
it.each([
  ["saved", "Saved"],
  ["saving", "Saving"],
  ["unsaved", "Unsaved changes"],
  ["error", "Save failed"],
] satisfies Array<[DocumentSaveState, string]>)(
  "shows persistent %s save status",
  async (saveState, label) => {
    await renderSaveStatus({ saveState });

    expect(
      container.querySelector(`[role="status"][aria-label="${label}"]`),
    ).not.toBeNull();
    expect(container.textContent).toContain(label);
  },
);

it.each([
  ["changed", "File changed on disk"],
  ["conflict", "Save conflict"],
  ["paused", "Autosave paused"],
] as const)("shows disk-blocked %s save status", async (state, label) => {
  await renderSaveStatus({ documentDiskChangeState: state });

  expect(
    container.querySelector(`[role="status"][aria-label="${label}"]`),
  ).not.toBeNull();
  expect(container.textContent).toContain(label);
});
```

**Step 3: Make a reusable workspace renderer**

In the save-status describe block, add a helper that can capture props:

```tsx
async function renderWorkspace({
  documentDiskChangeState = "clean",
  watcherCount = 0,
  onSaveDocument = async () => {},
}: {
  documentDiskChangeState?: "clean" | "changed" | "conflict" | "paused";
  watcherCount?: number;
  onSaveDocument?: (id: string, content: string) => Promise<void>;
} = {}) {
  await act(async () => {
    root.render(
      <DocumentWorkspace
        documentPage={createPage()}
        activeDocumentPath="test.md"
        documentFilenameLabel="test.md"
        documentEditorViewMode="rich-text"
        onDocumentEditorViewModeChange={() => {}}
        onSaveDocument={onSaveDocument}
        onDocumentSaveStateChange={() => {}}
        onDocumentDirtyStateChange={() => {}}
        onDocumentLocalContentChange={() => {}}
        documentDiskChangeState={documentDiskChangeState}
        documentForceResetKey={null}
        onReloadDocumentFromDisk={() => {}}
        onKeepEditingWithoutAutosave={() => {}}
        onOverwriteDocumentOnDisk={() => {}}
        onCompleteReview={async () => ({ delivered: false })}
        backend={createBackend({ watcherCount })}
      />,
    );
    await Promise.resolve();
  });
}
```

Add a handoff placement test:

```tsx
it("renders save status in the same top-right stack under the handoff button", async () => {
  await renderWorkspace({ watcherCount: 1 });

  const stack = container.querySelector('[data-document-status-stack="true"]');
  expect(stack).not.toBeNull();
  expect(stack?.textContent).toContain("I'm done");
  expect(stack?.textContent).toContain("Saved");
});
```

**Step 4: Write failing shortcut prevention tests**

Add:

```tsx
it.each([
  ["Meta+S", { key: "s", metaKey: true }],
  ["Control+S", { key: "s", ctrlKey: true }],
])("prevents browser save on %s", async (_label, init) => {
  const onSaveDocument = vi.fn().mockResolvedValue(undefined);
  await renderWorkspace({ onSaveDocument });

  const event = new KeyboardEvent("keydown", {
    ...init,
    bubbles: true,
    cancelable: true,
  });
  const preventDefault = vi.spyOn(event, "preventDefault");

  await act(async () => {
    window.dispatchEvent(event);
    await Promise.resolve();
  });

  expect(preventDefault).toHaveBeenCalled();
});
```

Add a blocked-state prevention test:

```tsx
it("prevents browser save even when disk conflict blocks persistence", async () => {
  const onSaveDocument = vi.fn().mockResolvedValue(undefined);
  await renderWorkspace({
    documentDiskChangeState: "conflict",
    onSaveDocument,
  });

  const event = new KeyboardEvent("keydown", {
    key: "s",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  const preventDefault = vi.spyOn(event, "preventDefault");

  await act(async () => {
    window.dispatchEvent(event);
    await Promise.resolve();
  });

  expect(preventDefault).toHaveBeenCalled();
  expect(onSaveDocument).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Save conflict");
});
```

The browser-level test in Task 7 proves the shortcut also flushes dirty code-mode content to disk. The PageCard test in Task 1 proves the flush cancels pending rich-text autosave immediately.

**Step 5: Run the focused failing test**

Run:

```bash
pnpm --filter @roughdraft/app exec vitest run test/view-toggle-bugs.test.tsx
```

Expected: FAIL because `DocumentWorkspace` does not render persistent saved/unsaved/error states and has no save shortcut handler.

### Task 4: Implement Persistent Status UI and Shortcut Handling

**Files:**
- Modify: `packages/app/src/DocumentWorkspace.tsx`
- Modify: `packages/app/test/view-toggle-bugs.test.tsx`

**Step 1: Import the new save types**

Replace the local `SaveState` type with:

```ts
import {
  PageCard,
  type DocumentInteractionMode,
  type DocumentSaveController,
  type DocumentSaveState,
} from "./PageCard";
```

Remove the old `type SaveState = "idle" | "saving" | "error";`.

**Step 2: Update props**

Change:

```ts
onDocumentSaveStateChange: (state: SaveState) => void;
```

to:

```ts
onDocumentSaveStateChange: (state: DocumentSaveState) => void;
```

**Step 3: Replace transient saved state**

Remove `showSaved`, `wasSavingRef`, and the timer logic. Initialize:

```ts
const [saveState, setSaveState] = useState<DocumentSaveState>("saved");
const saveControllerRef = useRef<DocumentSaveController | null>(null);
```

Use:

```ts
const handleSaveStateChange = useCallback(
  (state: DocumentSaveState) => {
    setSaveState(state);
    onDocumentSaveStateChange(state);
  },
  [onDocumentSaveStateChange],
);
```

**Step 4: Add an exported save status indicator**

Add a helper near `conflictNoticeCopy`:

```ts
function getSaveStatusViewModel(
  saveState: DocumentSaveState,
  diskChangeState: DiskChangeState,
) {
  if (diskChangeState === "conflict") {
    return {
      label: "Save conflict",
      ariaLabel: "Save conflict",
      tone: "warning" as const,
      Icon: AlertTriangle,
    };
  }

  if (diskChangeState === "changed") {
    return {
      label: "File changed",
      ariaLabel: "File changed on disk",
      tone: "warning" as const,
      Icon: AlertTriangle,
    };
  }

  if (diskChangeState === "paused") {
    return {
      label: "Autosave paused",
      ariaLabel: "Autosave paused",
      tone: "warning" as const,
      Icon: AlertTriangle,
    };
  }

  if (saveState === "saving") {
    return {
      label: "Saving",
      ariaLabel: "Saving",
      tone: "neutral" as const,
      Icon: Loader2,
    };
  }

  if (saveState === "error") {
    return {
      label: "Save failed",
      ariaLabel: "Save failed",
      tone: "danger" as const,
      Icon: AlertTriangle,
    };
  }

  if (saveState === "unsaved") {
    return {
      label: "Unsaved changes",
      ariaLabel: "Unsaved changes",
      tone: "warning" as const,
      Icon: AlertTriangle,
    };
  }

  return {
    label: "Saved",
    ariaLabel: "Saved",
    tone: "success" as const,
    Icon: Check,
  };
}
```

Add the exported component below the helper:

```tsx
export function DocumentSaveStatusIndicator({
  saveState,
  diskChangeState,
}: {
  saveState: DocumentSaveState;
  diskChangeState: DiskChangeState;
}) {
  const saveStatus = getSaveStatusViewModel(saveState, diskChangeState);
  const SaveStatusIcon = saveStatus.Icon;

  return (
    <span
      role="status"
      aria-label={saveStatus.ariaLabel}
      className={cn(
        "inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-[7px] border bg-white/92 px-2.5 font-mono text-[0.68rem] leading-none shadow-[0_8px_22px_rgba(15,23,42,0.08)] backdrop-blur dark:bg-slate-950/88",
        saveStatus.tone === "success" &&
          "border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300",
        saveStatus.tone === "warning" &&
          "border-amber-200 text-amber-800 dark:border-amber-800 dark:text-amber-300",
        saveStatus.tone === "danger" &&
          "border-red-200 text-red-700 dark:border-red-800 dark:text-red-300",
        saveStatus.tone === "neutral" &&
          "border-stone-200 text-stone-500 dark:border-slate-700 dark:text-slate-300",
      )}
    >
      <SaveStatusIcon
        className={cn(
          "size-3.5 shrink-0",
          saveStatus.label === "Saving" && "animate-spin",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate">{saveStatus.label}</span>
    </span>
  );
}
```

**Step 5: Render one top-right status stack**

Replace the current fixed `I'm done` button wrapper with this stack:

```tsx
<div
  className="fixed top-3 right-3 z-[60] flex max-w-[min(16rem,calc(100vw-1rem))] flex-col items-end gap-1.5"
  data-document-status-stack="true"
>
  {showReviewHandoffButton ? (
    <Popover>
      {/* existing PopoverTrigger/Button/PopoverContent */}
    </Popover>
  ) : null}
  {documentPage ? (
    <DocumentSaveStatusIndicator
      saveState={saveState}
      diskChangeState={documentDiskChangeState}
    />
  ) : null}
</div>
```

This intentionally puts status below `I'm done` when the handoff button is present. Leave the inline filename row free of save chips; it can keep filename, mode toggle, interaction selector, and review watcher status.

**Step 6: Register the save controller**

Pass to `PageCard`:

```tsx
onSaveControllerChange={(controller) => {
  saveControllerRef.current = controller;
}}
```

**Step 7: Add capture-phase save shortcut**

Add:

```ts
useEffect(() => {
  if (!documentPage) return;

  const handleKeyDown = (event: KeyboardEvent) => {
    const isSaveShortcut =
      event.key.toLowerCase() === "s" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey;

    if (!isSaveShortcut) return;

    event.preventDefault();
    event.stopPropagation();

    if (documentDiskChangeState !== "clean") return;

    void saveControllerRef.current?.flushSave();
  };

  window.addEventListener("keydown", handleKeyDown, { capture: true });
  return () => {
    window.removeEventListener("keydown", handleKeyDown, { capture: true });
  };
}, [documentDiskChangeState, documentPage]);
```

This prevents the browser Save Page dialog before TipTap, CodeMirror, or the browser default action can handle it.

**Step 8: Keep handoff disabling correct**

Change the `I'm done` disabled guard from `saveState === "saving"` to:

```ts
saveState === "saving" ||
saveState === "unsaved" ||
saveState === "error" ||
documentDiskChangeState !== "clean"
```

This prevents handoff while visible edits are not confirmed saved.

**Step 9: Run focused tests**

Run:

```bash
pnpm --filter @roughdraft/app exec vitest run test/view-toggle-bugs.test.tsx
```

Expected: PASS.

**Step 10: Commit**

```bash
git add packages/app/src/DocumentWorkspace.tsx packages/app/test/view-toggle-bugs.test.tsx
git commit -m "feat: show persistent document save status"
```

### Task 5: Carry Save Risk Into App-Level Beforeunload

**Files:**
- Modify: `packages/app/src/App.tsx`
- Create: `packages/app/test/app-save-warning.test.tsx`

**Step 1: Update App save-state imports/types**

Import:

```ts
import type { DocumentSaveState } from "./PageCard";
```

Replace the local `type SaveState = "idle" | "saving" | "error";` with the imported type.

**Step 2: Track save state in refs**

Change:

```ts
const [, setDocumentSaveState] = useState<SaveState>("idle");
```

to:

```ts
const [documentSaveState, setDocumentSaveState] =
  useState<DocumentSaveState>("saved");
const documentSaveStateRef = useRef<DocumentSaveState>("saved");
```

Keep the ref synchronized:

```ts
documentSaveStateRef.current = documentSaveState;
```

Add:

```ts
const handleDocumentSaveStateChange = useCallback(
  (state: DocumentSaveState) => {
    documentSaveStateRef.current = state;
    setDocumentSaveState(state);
  },
  [],
);
```

Pass `handleDocumentSaveStateChange` to `DocumentWorkspace`.

**Step 3: Add beforeunload risk detection**

Add this effect in `App`, after the document refs are initialized:

```ts
useEffect(() => {
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!activeDocumentPathRef.current) return;

    const hasLocalRisk =
      documentDirtyRef.current ||
      documentSaveStateRef.current === "saving" ||
      documentSaveStateRef.current === "unsaved" ||
      documentSaveStateRef.current === "error" ||
      documentDiskChangeState !== "clean";

    if (!hasLocalRisk) return;

    event.preventDefault();
    event.returnValue = "";
  };

  window.addEventListener("beforeunload", handleBeforeUnload);
  return () => window.removeEventListener("beforeunload", handleBeforeUnload);
}, [documentDiskChangeState]);
```

This is intentionally generic because browsers do not allow custom unload copy.

**Step 4: Add tests for unload warning**

Rendering the whole `App` with a mocked backend is more work than this behavior needs. Extract a pure helper from `App.tsx` and test that helper:

```ts
export function shouldWarnBeforeUnload({
  activeDocumentPath,
  isDirty,
  saveState,
  diskChangeState,
}: {
  activeDocumentPath: string | null;
  isDirty: boolean;
  saveState: DocumentSaveState;
  diskChangeState: DocumentDiskChangeState;
}) {
  return (
    !!activeDocumentPath &&
    (isDirty ||
      saveState === "saving" ||
      saveState === "unsaved" ||
      saveState === "error" ||
      diskChangeState !== "clean")
  );
}
```

Export `DocumentDiskChangeState` from `App.tsx` if needed:

```ts
export type DocumentDiskChangeState =
  | "clean"
  | "changed"
  | "conflict"
  | "paused";
```

Create `packages/app/test/app-save-warning.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { shouldWarnBeforeUnload } from "../src/App";

describe("beforeunload save warning", () => {
  it.each([
    [{ isDirty: true, saveState: "saved", diskChangeState: "clean" }, true],
    [{ isDirty: false, saveState: "saving", diskChangeState: "clean" }, true],
    [{ isDirty: false, saveState: "unsaved", diskChangeState: "clean" }, true],
    [{ isDirty: false, saveState: "error", diskChangeState: "clean" }, true],
    [{ isDirty: false, saveState: "saved", diskChangeState: "conflict" }, true],
    [{ isDirty: false, saveState: "saved", diskChangeState: "clean" }, false],
  ] as const)("returns %s for %o", (input, expected) => {
    expect(
      shouldWarnBeforeUnload({
        activeDocumentPath: "doc.md",
        ...input,
      }),
    ).toBe(expected);
  });

  it("does not warn when no document is open", () => {
    expect(
      shouldWarnBeforeUnload({
        activeDocumentPath: null,
        isDirty: true,
        saveState: "error",
        diskChangeState: "conflict",
      }),
    ).toBe(false);
  });
});
```

**Step 5: Run focused tests**

Run:

```bash
pnpm --filter @roughdraft/app exec vitest run test/app-save-warning.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/app/src/App.tsx packages/app/test/app-save-warning.test.tsx
git commit -m "feat: warn before leaving unsaved drafts"
```

### Task 6: Preserve Backend Conflict Semantics

**Files:**
- Modify: `packages/app/test/page-card.test.tsx`
- Modify: `packages/app/test/view-toggle-bugs.test.tsx`
- Modify if needed: `packages/app/src/PageCard.tsx`
- Modify if needed: `packages/app/src/DocumentWorkspace.tsx`

**Step 1: Add a PageCard save failure test**

In `packages/app/test/page-card.test.tsx`, add:

```tsx
it("manual save reports save failure without clearing dirty state", async () => {
  const rendered = await renderPageCard({
    page: {
      id: "doc-manual-save-failure-1",
      title: "Manual Save Failure",
      content: "Start",
    },
    selected: true,
  });
  rendered.onSave.mockRejectedValueOnce(new Error("disk unavailable"));

  vi.useFakeTimers();

  await insertTextAtEnd(rendered.getEditor(), " failed");

  let result;
  await act(async () => {
    result = await rendered.getSaveController().flushSave();
  });

  expect(result).toMatchObject({ status: "error" });
  expect(rendered.onSaveStateChange.mock.calls.at(-1)?.[0]).toBe("error");
});
```

**Step 2: Add a blocked manual-save test**

Rerender with `saveBlocked: true` after making an edit. The expected behavior:

```tsx
it("manual save is blocked without calling onSave when disk state blocks saves", async () => {
  const rendered = await renderPageCard({
    page: {
      id: "doc-manual-save-blocked-1",
      title: "Manual Save Blocked",
      content: "Start",
    },
    selected: true,
  });

  vi.useFakeTimers();
  await insertTextAtEnd(rendered.getEditor(), " blocked");
  await rendered.rerender({ saveBlocked: true });

  let result;
  await act(async () => {
    result = await rendered.getSaveController().flushSave();
  });

  expect(result).toEqual({ status: "blocked" });
  expect(rendered.onSave).not.toHaveBeenCalled();
  expect(rendered.onSaveStateChange.mock.calls.at(-1)?.[0]).toBe("unsaved");
});
```

Update `PageCardTestOptions` to include `saveBlocked?: boolean`.

**Step 3: Add a DocumentWorkspace conflict status test**

In `packages/app/test/view-toggle-bugs.test.tsx`:

```tsx
it("shows conflict status without replacing the existing conflict banner", async () => {
  await renderWorkspace({ documentDiskChangeState: "conflict" });

  expect(container.textContent).toContain("Save conflict");
  expect(container.textContent).toContain("This file changed on disk");
  expect(
    container.querySelector('[aria-label="Save conflict"]'),
  ).not.toBeNull();
});
```

**Step 4: Run focused tests**

Run:

```bash
pnpm --filter @roughdraft/app exec vitest run test/page-card.test.tsx test/view-toggle-bugs.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/app/src/PageCard.tsx packages/app/src/DocumentWorkspace.tsx packages/app/test/page-card.test.tsx packages/app/test/view-toggle-bugs.test.tsx
git commit -m "test: cover save failure and blocked states"
```

### Task 7: Add Browser-Level Cmd-S Smoke Coverage

**Files:**
- Modify: `packages/app/e2e/markdown-roundtrip.spec.ts`

**Step 1: Add the e2e test**

Append to `test.describe("markdown round-trips", ...)`:

```ts
test("manual save shortcut flushes code-mode edits to disk @smoke", async ({
  page,
}) => {
  const initial = ["# Manual Save", "", "Initial body.", ""].join("\n");
  const filePath = writeProjectFile(projectDir, "manual-save.md", initial);

  await openMarkdownFile(page, filePath, "code");
  await appendInCodeEditor(page, "\nSaved by shortcut.\n");

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+S" : "Control+S",
  );

  await expect
    .poll(() => readProjectFile(projectDir, "manual-save.md"))
    .toContain("Saved by shortcut.");
  await expect(page.getByRole("status", { name: "Saved" })).toBeVisible();

  logE2eEvent("markdown-roundtrip.manual-save-shortcut", {
    file: "manual-save.md",
    size: fs.statSync(filePath).size,
  });
});
```

This test uses code mode because it is the fastest browser-level proof that the exact text the user typed flushes to disk. The PageCard rich-text test covers TipTap serialization.

**Step 2: Run the focused e2e**

Run:

```bash
pnpm exec playwright test --config packages/app/playwright.config.ts packages/app/e2e/markdown-roundtrip.spec.ts --grep "manual save shortcut"
```

Expected: PASS.

**Step 3: Commit**

```bash
git add packages/app/e2e/markdown-roundtrip.spec.ts
git commit -m "test: cover manual save shortcut in browser"
```

### Task 8: Final Integration Verification

**Files:**
- No new files expected unless preceding tasks reveal necessary fixes.

**Step 1: Run focused component tests**

Run:

```bash
pnpm --filter @roughdraft/app exec vitest run test/page-card.test.tsx test/view-toggle-bugs.test.tsx test/app-save-warning.test.tsx
```

Expected: PASS.

**Step 2: Run focused e2e smoke**

Run:

```bash
pnpm exec playwright test --config packages/app/playwright.config.ts packages/app/e2e/markdown-roundtrip.spec.ts --grep "@smoke|manual save shortcut"
```

Expected: PASS.

**Step 3: Run full repository check**

Run:

```bash
pnpm check
```

Expected: PASS for lint, unit tests, and build.

**Step 4: Inspect intended changes**

Run:

```bash
git status --short
```

Expected changed files after implementation:

```text
M packages/app/src/App.tsx
M packages/app/src/DocumentWorkspace.tsx
M packages/app/src/PageCard.tsx
M packages/app/e2e/markdown-roundtrip.spec.ts
M packages/app/test/page-card.test.tsx
M packages/app/test/view-toggle-bugs.test.tsx
A packages/app/test/app-save-warning.test.tsx
```

**Step 5: Commit final fixes if needed**

If `pnpm check` required any cleanup, commit it:

```bash
git add packages/app/src/App.tsx packages/app/src/DocumentWorkspace.tsx packages/app/src/PageCard.tsx packages/app/e2e/markdown-roundtrip.spec.ts packages/app/test/page-card.test.tsx packages/app/test/view-toggle-bugs.test.tsx packages/app/test/app-save-warning.test.tsx
git commit -m "fix: polish document save indicator integration"
```

Skip this commit if no final cleanup was needed.

## Review Checklist

- `Cmd-S` / `Ctrl-S` never opens the browser Save Page dialog while a document is open.
- Manual save writes the current markdown from both rich-text and code views.
- Autosave remains enabled and still debounces normal edits.
- Manual save cancels pending debounce instead of causing a duplicate write.
- Save failures show `Save failed` and do not mark dirty content as saved.
- Disk conflicts still route through `MarkdownFileConflictError` and the existing conflict banner.
- The save indicator is visible persistently, including the initial `Saved` state.
- When `I'm done` is visible, save status is directly below it in the same top-right stack.
- `I'm done` is disabled unless the document is saved and conflict-free.
- `beforeunload` warns only when there is local risk.
- No `Save As`, file picker, database, git behavior, or multi-file workflow was added.
