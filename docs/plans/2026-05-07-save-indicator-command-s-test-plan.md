# Save Indicator Command-S Test Plan

## Strategy reconciliation

The implementation plan matches the agreed strategy: autosave remains the primary persistence path, `Cmd-S` / `Ctrl-S` becomes a manual flush instead of browser Save Page, save truth originates in `PageCard`, document-level UX and keyboard handling live in `DocumentWorkspace`, and backend writes stay centralized through `App`.

No strategy changes require user approval. The planned harnesses are already present in this repo: Vitest/jsdom component tests for `PageCard`, `DocumentWorkspace`, and pure App risk logic, plus Playwright browser tests against real markdown files. No paid APIs, remote infrastructure, or manual visual review are required.

## Harness requirements

1. **Playwright markdown-file workflow harness**
   - **Does:** Opens a real temporary Markdown file through Roughdraft, simulates user input in rich-text or code mode, presses keyboard shortcuts, observes DOM state, and reads the file from disk.
   - **Exposes:** `openMarkdownFile`, `appendInCodeEditor`, `readProjectFile`, `writeProjectFile`, role/label queries, keyboard input, `expect.poll` against disk.
   - **Estimated complexity:** Low. Existing helpers in `packages/app/e2e/helpers.ts` cover most needs; add only test-specific steps.
   - **Dependent tests:** 1, 2, 3, 4, 5, 6.

2. **PageCard save-controller component harness**
   - **Does:** Renders `PageCard` in Vitest/jsdom, captures editor instance, save callback, save-state callback, and the new `DocumentSaveController`.
   - **Exposes:** Programmatic rich-text edits, fake timers for debounce, `flushSave()`, mocked save success/failure, `saveBlocked` rerenders.
   - **Estimated complexity:** Low to medium. Existing `renderPageCard()` needs controller capture and `saveBlocked` support.
   - **Dependent tests:** 7, 8, 9, 10, 11.

3. **DocumentWorkspace component harness**
   - **Does:** Renders document workspace with an in-memory backend, configurable disk-change state, review watcher count, and mocked save callback.
   - **Exposes:** DOM status assertions, handoff button state, capture-phase keyboard event simulation, conflict banner assertions.
   - **Estimated complexity:** Low. Existing `view-toggle-bugs.test.tsx` has the renderer and backend stub; expand it.
   - **Dependent tests:** 12, 13, 14, 15, 16, 17, 18.

4. **App beforeunload risk helper harness**
   - **Does:** Tests the pure decision for whether closing/reloading should warn.
   - **Exposes:** `shouldWarnBeforeUnload({ activeDocumentPath, isDirty, saveState, diskChangeState })`.
   - **Estimated complexity:** Low. Extract the helper from `App.tsx`.
   - **Dependent tests:** 19, 20.

5. **App storage-boundary harness**
   - **Does:** Exercises the document save boundary with a mocked `StorageBackend` so tests can assert `expectedVersion` and conflict propagation without relying on private component state.
   - **Exposes:** A minimal helper around the same inputs used by `App.handleSaveDocument`: active path, current page id/version, markdown content, backend save result/error, and resulting disk-change state.
   - **Estimated complexity:** Medium if extracted from `App.tsx`; low if implemented by rendering `App` behind an injectable backend in tests. Keep the helper behavior identical to `handleSaveDocument` and avoid duplicating save policy in the test.
   - **Dependent tests:** 21.

## Test plan

1. **Manual save shortcut flushes code-mode edits to disk**
   - **Type:** scenario
   - **Harness:** Playwright markdown-file workflow harness
   - **Preconditions:** A temporary file `manual-save.md` contains `# Manual Save\n\nInitial body.\n`; Roughdraft opens it in code mode.
   - **Actions:** Append `Saved by shortcut.` in the code editor. Press `Meta+S` on macOS or `Control+S` elsewhere.
   - **Expected outcome:** The file on disk contains `Saved by shortcut.` without waiting for the normal autosave debounce, and the DOM has a visible status with accessible name `Saved`. Source of truth: user request for an easy save shortcut without Save As; implementation plan End-State Behavior for manual flush and persistent `Saved`; ADR 0001 single markdown file.
   - **Interactions:** CodeMirror input, `DocumentWorkspace` shortcut handler, `PageCard` save controller, `App.handleSaveDocument`, server filesystem write.

2. **Save shortcut never opens browser Save Page while a document is open**
   - **Type:** scenario
   - **Harness:** Playwright markdown-file workflow harness
   - **Preconditions:** A temporary markdown file is open in Roughdraft, first in rich-text mode and then in code mode.
   - **Actions:** Install a capture-phase test listener on `window` that records save-key events after app handlers run. For each mode, press `Meta+S` and `Control+S`.
   - **Expected outcome:** The recorded events for both shortcuts have `defaultPrevented=true`, the page stays on the same URL, and the document editor remains focused/usable. Source of truth: user report that browser web-file save is confusing; implementation plan End-State Behavior says both shortcuts prevent the browser dialog with a document open.
   - **Interactions:** Browser keyboard default handling, capture-phase workspace listener, TipTap or CodeMirror key handling.

3. **Manual save shortcut flushes rich-text edits to disk**
   - **Type:** scenario
   - **Harness:** Playwright markdown-file workflow harness
   - **Preconditions:** A temporary file contains `# Rich Save\n\nInitial body.\n`; Roughdraft opens it in rich-text mode.
   - **Actions:** Type `Saved by shortcut.` into the rich-text editor and press platform save shortcut.
   - **Expected outcome:** The disk file contains the typed text, and the visible save status becomes `Saved`. Existing supported Markdown around the edit remains parseable as Markdown. Source of truth: user wants saved screen edits to be what gets pushed; implementation plan says manual save writes current rich-text markdown; ADR 0003 round-trip contract.
   - **Interactions:** TipTap editing, Markdown serialization, save controller, backend persistence.

4. **Initial open shows persistent saved confidence**
   - **Type:** scenario
   - **Harness:** Playwright markdown-file workflow harness
   - **Preconditions:** A clean temporary markdown file is opened with no edits.
   - **Actions:** Wait for the document editor to render.
   - **Expected outcome:** A visible status with accessible name `Saved` is present. Source of truth: implementation plan End-State Behavior says initial opened document shows `Saved`; user requested peace of mind about save state.
   - **Interactions:** Document load, `PageCard` initial save state, `DocumentWorkspace` status rendering.

5. **Autosave still saves normal code-mode edits without manual shortcut**
   - **Type:** scenario
   - **Harness:** Playwright markdown-file workflow harness
   - **Preconditions:** A temporary file is open in code mode.
   - **Actions:** Append text and do not press a save shortcut.
   - **Expected outcome:** The file on disk eventually contains the appended text, and existing fenced CriticMarkup examples remain literal. Source of truth: implementation plan says keep autosave primary; ADR 0003 requires round-trip preservation.
   - **Interactions:** CodeMirror update listener, `PageCard` debounce, `App.handleSaveDocument`, filesystem write.

6. **Disk conflict blocks persistence while preserving local draft UI**
   - **Type:** scenario
   - **Harness:** Playwright markdown-file workflow harness
   - **Preconditions:** A temporary file is open in code mode; server file events are disabled or controlled so an external disk write creates a stale expected-version conflict.
   - **Actions:** Modify the file externally, type local draft text, press platform save shortcut, then choose `Keep editing with autosave paused`.
   - **Expected outcome:** The browser save dialog is prevented, disk content remains the external version, visible UI includes `Save conflict` before pausing and `Autosave paused` after choosing keep-editing, and local draft text remains visible in the editor. Source of truth: implementation plan blocked/conflict behavior; ADR 0004 stale-write/versioned server model.
   - **Interactions:** File watcher/stale write path, shortcut handling, conflict banner, persistent save status, CodeMirror local state.

7. **Manual rich-text save cancels pending autosave and writes once**
   - **Type:** integration
   - **Harness:** PageCard save-controller component harness
   - **Preconditions:** `PageCard` is rendered with content `Start`, selected, rich-text mode, fake timers enabled, and `onSave` mocked as successful.
   - **Actions:** Insert ` now` at the end of the editor, then call `flushSave()` before advancing the 500 ms debounce.
   - **Expected outcome:** `onSave` is called exactly once with the page id and markdown containing `Start now`; advancing the debounce afterward does not call `onSave` again; final save state is `saved`. Source of truth: implementation plan End-State Behavior says manual save cancels pending debounce and writes current markdown immediately.
   - **Interactions:** TipTap edit serialization, save debounce timer, save controller, save-state callback.

8. **Autosave still debounces rich-text edits**
   - **Type:** regression
   - **Harness:** PageCard save-controller component harness
   - **Preconditions:** `PageCard` is rendered with content `Start` in rich-text mode and fake timers enabled.
   - **Actions:** Insert text and advance timers by less than 500 ms, then to 500 ms.
   - **Expected outcome:** No save occurs before 500 ms; one save occurs at/after the debounce with the edited markdown; final state becomes `saved`. Source of truth: implementation plan preserves autosave as primary and existing PageCard autosave behavior.
   - **Interactions:** TipTap editing, debounce scheduling, save-state callback.

9. **Manual save of already-saved content is harmless**
   - **Type:** boundary
   - **Harness:** PageCard save-controller component harness
   - **Preconditions:** `PageCard` is rendered with unchanged content; no save timer or in-flight save exists.
   - **Actions:** Call `flushSave()`.
   - **Expected outcome:** Result is `{ status: "saved" }`, no backend save callback is invoked, and save state is `saved`. Source of truth: implementation plan End-State Behavior says pressing the shortcut when already saved is harmless and keeps/refocuses saved confirmation.
   - **Interactions:** Save controller state machine only.

10. **Manual save failure reports failure without marking dirty content saved**
    - **Type:** integration
    - **Harness:** PageCard save-controller component harness
    - **Preconditions:** `PageCard` is rendered with content `Start`; `onSave` rejects once with a non-conflict error.
    - **Actions:** Edit the document and call `flushSave()`.
    - **Expected outcome:** Result has status `error`, final save state is `error`, and dirty content is not accepted as saved. Source of truth: implementation plan End-State Behavior says non-conflict save failures show `Save failed`; user wants confidence that unsaved edits are not falsely considered saved.
    - **Interactions:** Save controller, failed backend promise, dirty-state reporting.

11. **Manual save is blocked without backend write when disk state blocks saves**
    - **Type:** integration
    - **Harness:** PageCard save-controller component harness
    - **Preconditions:** `PageCard` is rendered with content `Start`; user edits content; component is rerendered with `saveBlocked=true`.
    - **Actions:** Call `flushSave()`.
    - **Expected outcome:** Result is `{ status: "blocked" }`, `onSave` is not called, and final save state is `unsaved`. Source of truth: implementation plan says conflict-blocked shortcut prevents browser dialog and leaves conflict UI visible; top-right status must not imply saved.
    - **Interactions:** Dirty refs, blocked save path, DocumentWorkspace-provided `saveBlocked` prop.

12. **Status indicator exposes every clean save state accessibly**
    - **Type:** integration
    - **Harness:** DocumentWorkspace component harness
    - **Preconditions:** Render `DocumentSaveStatusIndicator` with disk state `clean`.
    - **Actions:** Render states `saved`, `saving`, `unsaved`, and `error`.
    - **Expected outcome:** Each render has `role="status"` with accessible names and visible labels `Saved`, `Saving`, `Unsaved changes`, and `Save failed` respectively. Source of truth: implementation plan End-State Behavior and status view model labels.
    - **Interactions:** Save status view model, icon/ARIA rendering.

13. **Disk-blocked states override clean save labels**
    - **Type:** integration
    - **Harness:** DocumentWorkspace component harness
    - **Preconditions:** Render `DocumentSaveStatusIndicator` with arbitrary save state.
    - **Actions:** Render disk states `changed`, `conflict`, and `paused`.
    - **Expected outcome:** Accessible status names are `File changed on disk`, `Save conflict`, and `Autosave paused`; no `Saved` implication is shown for blocked disk states. Source of truth: implementation plan says blocked/conflict messaging must not imply the draft was saved.
    - **Interactions:** Disk state mapping and visual status rendering.

14. **Save status appears in the top-right stack under handoff**
    - **Type:** integration
    - **Harness:** DocumentWorkspace component harness
    - **Preconditions:** Render `DocumentWorkspace` with a document open and backend watcher count `1` so `I'm done` is visible.
    - **Actions:** Inspect `[data-document-status-stack="true"]`.
    - **Expected outcome:** The stack contains both `I'm done` and `Saved`, with the save indicator in the same top-right stack. Source of truth: user Roughdraft review comment incorporated in the implementation plan; implementation plan Task 4 placement.
    - **Interactions:** Review watcher status, handoff affordance, save status layout.

15. **Workspace prevents browser save for Meta+S and Control+S**
    - **Type:** integration
    - **Harness:** DocumentWorkspace component harness
    - **Preconditions:** Render `DocumentWorkspace` with a document open and clean disk state.
    - **Actions:** Dispatch cancelable `keydown` events for `Meta+S` and `Control+S` on `window`.
    - **Expected outcome:** `preventDefault()` is called for each event. Source of truth: implementation plan End-State Behavior says both shortcuts are prevented whenever a document is open.
    - **Interactions:** Capture-phase window listener, document-open guard.

16. **Workspace prevents browser save but does not write during conflict**
    - **Type:** integration
    - **Harness:** DocumentWorkspace component harness
    - **Preconditions:** Render `DocumentWorkspace` with disk state `conflict` and mocked `onSaveDocument`.
    - **Actions:** Dispatch cancelable `Meta+S`.
    - **Expected outcome:** `preventDefault()` is called, `onSaveDocument` is not called, and the DOM contains `Save conflict`. Source of truth: implementation plan End-State Behavior for conflict-blocked shortcut.
    - **Interactions:** Shortcut handler, disk conflict state, save controller guard, conflict banner/status.

17. **Conflict status does not replace the existing conflict banner**
    - **Type:** regression
    - **Harness:** DocumentWorkspace component harness
    - **Preconditions:** Render `DocumentWorkspace` with disk state `conflict`.
    - **Actions:** Inspect DOM text and status elements.
    - **Expected outcome:** Persistent status has accessible name `Save conflict`, and the existing banner still contains the explanatory copy `This file changed on disk while you have unsaved edits`. Source of truth: implementation plan says existing amber banner remains the prominent explanation.
    - **Interactions:** Banner rendering, persistent status rendering.

18. **Handoff is disabled unless document is saved and conflict-free**
    - **Type:** invariant
    - **Harness:** DocumentWorkspace component harness
    - **Preconditions:** Render `DocumentWorkspace` with watcher count `1`.
    - **Actions:** Drive/render save states `saving`, `unsaved`, `error`, and disk state `conflict`, then inspect the `I'm done` button.
    - **Expected outcome:** `I'm done` is disabled for each risky state and enabled only for `saved` with disk state `clean` and idle handoff state. Source of truth: implementation plan Review Checklist and Task 4 disabled guard.
    - **Interactions:** Save status, disk state, review handoff action boundary.

19. **Beforeunload warns for every local save risk**
    - **Type:** unit
    - **Harness:** App beforeunload risk helper harness
    - **Preconditions:** `activeDocumentPath` is `doc.md`.
    - **Actions:** Call `shouldWarnBeforeUnload` for dirty content, save states `saving`, `unsaved`, `error`, and disk states `changed`, `conflict`, `paused`.
    - **Expected outcome:** The helper returns `true` for each risky input. Source of truth: implementation plan says closing/reloading warns only for dirty, saving, failed, or disk-change blocked states.
    - **Interactions:** App-level refs/effect decision once wired into `beforeunload`.

20. **Beforeunload does not warn for clean saved or no-document states**
    - **Type:** boundary
    - **Harness:** App beforeunload risk helper harness
    - **Preconditions:** None.
    - **Actions:** Call `shouldWarnBeforeUnload` with active document, `isDirty=false`, `saveState="saved"`, `diskChangeState="clean"`; call again with `activeDocumentPath=null` and otherwise risky inputs.
    - **Expected outcome:** The helper returns `false` in both cases. Source of truth: implementation plan says no warning for a clean saved document and only with a document open.
    - **Interactions:** App route/document-open boundary.

21. **Manual save preserves backend stale-write expectedVersion semantics**
    - **Type:** integration
    - **Harness:** App storage-boundary harness
    - **Preconditions:** A document has version `v1`; the save backend can assert the expected version it receives.
    - **Actions:** Trigger manual save through the document save path.
    - **Expected outcome:** The backend save receives the current document version as `expectedVersion`; if the backend throws `MarkdownFileConflictError`, disk state becomes `conflict` and the error is not swallowed as saved. Source of truth: implementation plan architecture says `App` remains the single backend persistence boundary preserving stale-write `expectedVersion`; ADR 0004.
    - **Interactions:** Save controller, `DocumentWorkspace`, `App.handleSaveDocument`, storage backend versioning.

22. **Save status layout is present and non-overlapping on desktop and mobile snapshots**
    - **Type:** invariant
    - **Harness:** Playwright markdown-file workflow harness
    - **Preconditions:** A document is open with watcher count or mocked backend status that makes `I'm done` visible; run at desktop and mobile viewport widths.
    - **Actions:** Capture DOM bounding boxes or screenshots for `[data-document-status-stack="true"]`, the save status, the handoff button, and the conflict banner when present.
    - **Expected outcome:** Stack elements have non-zero bounding boxes within the viewport; status and handoff bounding boxes do not intersect except through intended vertical stacking; conflict banner and top-right stack both remain visible. Source of truth: implementation plan placement requirement and frontend design constraints for non-overlap.
    - **Interactions:** CSS layout, fixed positioning, responsive viewport constraints.

## Coverage summary

Covered action space:

- Opening a single Markdown file and seeing persistent initial `Saved` confidence.
- Editing in rich-text and code modes.
- Autosave debounce behavior and manual save shortcut behavior.
- `Meta+S` and `Control+S` browser-default prevention.
- Immediate manual save flushing, duplicate-save prevention, already-saved no-op behavior, save failure behavior, and blocked save behavior.
- Persistent status labels for clean, saving, unsaved, failed, changed, conflict, and paused states.
- Top-right status placement with `I'm done`.
- Handoff disabling when save confidence is not clean.
- App-level unload warnings for local-risk states.
- Stale-write/version conflict semantics through the backend save boundary.
- Round-trip preservation where save tests touch Markdown serialization.

Explicitly excluded:

- A `Save As` workflow, file picker, document database, git action, vault model, or multi-file workspace. These are excluded by the user request, ADR 0001, and the implementation plan strategy gate. Risk: users who expect a separate save-location flow will not get one, but adding it would materially change scope and product direction.
- Exhaustive CodeMirror internals tests in jsdom. Browser scenarios cover code-mode user behavior more predictively. Risk: a low-level CodeMirror integration regression might be found later than a unit failure, but the scenario test covers the user-visible contract.
- Full visual snapshot approval by a human. Layout checks are expressed as reproducible DOM/screenshot/bounding-box assertions. Risk: some aesthetic regressions may pass if they do not violate measurable visibility or overlap rules.
- Remote document mode-specific manual save coverage. The same `StorageBackend.saveMarkdownFile` contract is exercised through the shared App boundary; remote transport-specific failures are out of scope for this save indicator change. Risk: remote-only latency or auth behavior could need follow-up if manual save exposes a transport issue.
