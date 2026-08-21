---
title: Push Editor Content That Is Not Yet On Disk
date: 2026-08-21
category: ui-bugs
module: Roughdraft document editor
problem_type: ui_bug
component: app
symptoms:
  - "Restored draft content appeared in the editor for a moment and was then replaced by the copy on disk"
  - "A restore performed on boot never reached the file, with no error shown"
  - "The save status pill stayed red on Save failed after the edits had actually landed"
  - "Autosave paused itself with File changed on disk immediately after Roughdraft's own successful write"
root_cause: state_machine
resolution_type: code_fix
severity: high
tags: [pagecard, autosave, react-effects, strictmode, file-watcher, e2e]
---

# Push Editor Content That Is Not Yet On Disk

## Problem

Most content reaching `PageCard` is content the destination already holds: a file load, a reload from disk, an adopt after a successful save. Local edit persistence introduced the opposite case — handing the card content that the destination has *never* seen, recovered from `localStorage` after a save failed, and asking it to be treated as unsaved work owed to the file.

Four separate mechanisms in the editor assume the arriving content is authoritative. None of them fail loudly; each quietly reverts, cancels, or mislabels the restore. All four were invisible in jsdom and only appeared in a real browser.

## Symptoms

- The restored text rendered and was then overwritten by the file's content on the next render.
- On the boot-recovery path the restore produced no save at all, and the file kept its old content indefinitely.
- After a retry delivered the edits, `document-save-status` still read `Save failed` in red.
- Seconds after a successful write, the workspace showed `File changed on disk` and paused autosave — reacting to Roughdraft's own write.

## What Didn't Work

- Component tests that mounted the card and *then* re-rendered it with a restore. That ordering never reproduces the boot case, where the card mounts with the restore already in hand and its first reconciliation pass runs against the restored content.
- Guarding the restore effect with a `useRef` key. React discards and replays mount effects; the replay cancels the save the effect scheduled, while the ref survives the replay and suppresses the re-run. The result is a restore with no delivery.
- Reporting the save state from `App` after an out-of-band save. `App` and `DocumentWorkspace` hold separate save states, and the pill renders the one only `PageCard` writes.

## Solution

**Adopt the content as unsaved, and say which kind of adopt it is.** `acceptMarkdown` gained a `markSaved` option; with `markSaved: false` it leaves the last-accepted marker on what the destination actually holds, so the card stays dirty. `onLocalContentChange` gained an origin (`"edit" | "adopt" | "restore"`) so persistence records genuine edits only.

**Compare against live pending content, not the render's snapshot.** The reconciliation effect's "local work in progress" guard read the render-scoped `markdown`, which within the restoring commit is still the pre-restore value:

```tsx
// Reverts a restore adopted during this same commit.
if (localDirtyRef.current && markdown !== page.content) return;

// Sees what the card is actually holding right now.
if (localDirtyRef.current && pendingMarkdownRef.current !== page.content) return;
```

**Make the restore effect safe to replay.** It depends only on the offer object, reads its callbacks through a ref, and carries no guard, so React replaying it simply re-adopts and re-schedules. Each offer is a distinct object, which is what makes restoring the same bytes twice a real request rather than a repeat.

**Report `saved` from the one component that owns the pill.** `PageCard`'s reconciliation reports `"saved"` when the destination has caught up with the editor, in both branches that can observe it, and only ever as an upgrade — a save already in flight keeps ownership of the state.

**Give the watcher the two facts it lacks.** It now stands down while a restore is in flight, and it recognises a version Roughdraft itself just wrote:

```tsx
// documentPageRef only catches up on the next commit; this is set synchronously.
lastSavedVersionRef.current = savedDocument.version ?? null;
```

## Why This Works

The reconciliation effect is a negotiation between two writers of the same text, and its inputs have to be from the same instant. Refs are current; render-scoped state is a snapshot of the commit that scheduled the effect. Any effect that reacts to content arriving from outside has to read the refs.

Standing the watcher down during a restore does not weaken the disk-divergence protection, because the save still carries the loaded `expectedVersion`. A file that genuinely moved comes back as a `409` and reaches the conflict banner through `resolveConflict`. The watcher was only ever an early-warning path.

## Prevention

- When handing a component content the destination has not seen, state that in the call rather than letting the component infer it from equality checks.
- Any effect that schedules a timer or a request must survive being replayed after cleanup. If a ref guard would suppress the replay, the guard and the side effect have to be cleaned up together — or the guard has to go.
- Read refs, not render-scoped state, in effects that reconcile against content arriving mid-commit.
- After a write, ignore watcher events carrying the version just written, recorded synchronously rather than through React state.
- Exercise recovery paths in a real browser. StrictMode's effect replay, the live file watcher, and a real reload are all absent from jsdom, and each of these four defects was invisible without them.

## Related Issues

- Regression coverage: `packages/app/e2e/draft-recovery.spec.ts`, `packages/app/test/page-card.test.tsx`, `packages/app/test/app-draft-recovery.test.tsx`
- Runtime path involved: `packages/app/src/PageCard.tsx`, `packages/app/src/App.tsx`, `packages/app/src/useDraftPersistence.ts`
- Adjacent hazard already documented: `docs/solutions/ui-bugs/verify-exact-ui-submit-path-for-cross-boundary-handoffs.md`
