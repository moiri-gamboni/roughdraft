---
title: An Echo Of Our Own Write Is Not An External Change
date: 2026-08-24
category: ui-bugs
module: Roughdraft document editor
problem_type: race_condition
component: app
symptoms:
  - "File changed on disk appeared seconds after Roughdraft's own successful save, with no other writer present"
  - "Autosave paused itself and every later edit was silently dropped until the banner was answered"
  - "A rejected suggestion applied in the editor but never reached the file"
  - "The accept/reject smoke test failed intermittently under parallel load, roughly one run in ten"
root_cause: race_condition
resolution_type: code_fix
severity: high
tags: [autosave, file-watcher, sse, versions, race-condition, e2e]
---

# An Echo Of Our Own Write Is Not An External Change

## Problem

The server watches the open file with `fs.watchFile({ interval: 500 })` and pushes a `change` event carrying the file's current version. Roughdraft writes that file itself on every autosave, so the watcher reports Roughdraft's own writes back to it. The client filtered those echoes out by comparing the event's version against the version it holds — `documentPage.version`, or `lastSavedVersionRef` recorded synchronously on save.

Both of those are only knowable *after* the save's HTTP response has been processed, and the server writes the file before it answers. Between the write and the response there is a window in which the watcher can report a version the client has never seen. The client concludes that somebody else edited the file, and because the editor is still dirty — dirty is only cleared when the save settles — it raises the `changed` state: `File changed on disk`, autosave paused.

Nothing recovers from that on its own. The user keeps editing into a paused autosave and the writes stop landing, which is how a mis-read echo turns into lost work rather than a stray banner.

## Symptoms

- The conflict banner appears moments after a save the user did not think of as a save, with no second writer anywhere.
- The editor and the file disagree afterwards: the change is visible on screen and absent on disk.
- Reproducible only under load, because it needs the save response to be slower than the watcher's next poll.

## Evidence

Instrumenting the watcher callback with the four values it decides on caught the window directly. On the failing runs, and only on those:

```
{"eventVersion":"…:123:c04c2044…","docVersion":"…:178:41f30df6…","lastSaved":null,"dirty":true,"diskState":"clean"}
```

`eventVersion` is the file *after* the accept saved it (123 bytes). `docVersion` is still the file as loaded (178 bytes). `lastSaved` is `null`: the save that produced the echo had not answered yet. Every passing run showed the same event with `lastSaved` already equal to `eventVersion`.

## What Didn't Work

- Recording the saved version synchronously instead of through React state. That was the previous fix in this area and it is still necessary — `documentPageRef` only catches up on the next commit — but it does not help, because there is nothing to record until the response arrives.
- Deferring the decision while still remembering only the newest version written. That combination is *worse* than what it replaces, for the reason set out under "Why This Works" below.

## Solution

**Wait for the writes already in flight before classifying the event.** The save chain is the thing that makes the versions knowable, so the watcher callback awaits it and then decides:

```tsx
const savesInFlight = saveChainRef.current;

void (async () => {
  await savesInFlight;
  if (disposed) return;
  // …version comparison and the changed/paused/reload branches…
})();
```

**Remember more than the newest version.** `lastSavedVersionRef` became `savedVersionsRef`, a bounded list of the last `SAVED_VERSION_MEMORY` (8) versions this session has written, and the comparison is `includes`.

**Put the decision somewhere it can be tested.** The branching moved out of the effect into `resolveDiskChange` in `save-recovery.ts`, beside `resolveConflict` and `resolveRestore`. `App` awaits the chain, asks, and acts on the answer.

## Why This Works

The two pieces are not independent, and deferring alone would make the single-slot memory *worse*. The server always reports the file as it stands at the poll — `sendChange` recomputes the version with `fileVersionFromFile` at emit time — so the event itself is never stale. The staleness comes from the wait. Autosave is debounced at 500ms and the chain serialises, so a second write is routinely queued while the first is still in flight; if the poll lands between the two writes, the event carries the *first* version, the callback waits for both, and by the time it decides, the newest version recorded is the second. One slot misses it and pauses autosave over our own work. Widening the memory alone would not help either, because the version of an unanswered save is in no slot at all. Together they answer the same question — *did we write this?* — for a report that can arrive at any point relative to our own requests.

Deferring costs nothing in correctness for genuine external changes. `saveChainRef.current` is the `catch`-wrapped tail of the chain, so it always settles; a real external write is still detected, one save later, and the save that raced it still carries `expectedVersion` and still comes back as a `409` through `resolveConflict`. The watcher was only ever the early-warning path.

## Prevention

- A file watcher on a file you also write is an echo chamber. Before treating any event as external, ask what the process itself has in flight — not only what it has finished.
- Identity that is only knowable from a response cannot be used to filter events that can arrive before it. Either wait for the response or identify the write by something computed locally.
- A "recently seen" filter for a polling source needs a small window, not a single slot: one poll can hide several writes.
- Pausing autosave is a data-loss path, not a notice. Any branch that reaches it deserves the same scrutiny as a delete.

## Related Issues

- Runtime path: `packages/app/src/App.tsx` (`watchMarkdownFile` subscription, `deliverDocumentSave`), `packages/app/src/save-recovery.ts` (`resolveDiskChange`)
- Server side of the contract: `packages/server/src/index.ts` (`GET /api/markdown-file/events`, `fileVersionFromFile`)
- Regression coverage: `packages/app/e2e/stale-write.spec.ts` ("keeps autosaving when the watcher echoes a slow save") for the timing half, `packages/app/src/save-recovery.test.ts` (`resolveDiskChange`) for the identity half
- The earlier fix in this area, whose synchronous-version rule this sharpens: `docs/solutions/ui-bugs/push-editor-content-that-is-not-yet-on-disk.md`
