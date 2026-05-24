---
title: Verify Exact UI Submit Path For Cross-Boundary Handoffs
date: 2026-05-24
category: ui-bugs
module: Roughdraft review handoff
problem_type: ui_bug
component: tooling
symptoms:
  - "Server tests passed, but a manually submitted overall handoff comment did not appear in the review event or Markdown file"
  - "Typing in the handoff dropdown and clicking the primary I'm done button silently dropped the comment"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [handoff, e2e, ui-paths, markdown, review-events]
---

# Verify Exact UI Submit Path For Cross-Boundary Handoffs

## Problem

Roughdraft added support for overall handoff comments, first as `review.completed` event metadata and then as durable YAML endmatter comments. Server and parser tests passed, but a live review still lost the overall comment when the user typed it in the dropdown and clicked the primary **I'm done** button.

The data crossed several boundaries: browser state, split-button UI behavior, API request body, server persistence, file versioning, event delivery, and Markdown reread. Tests that only covered the server POST path were not predictive enough.

## Symptoms

- `roughdraft open <file> --json` returned `review.completed` without `overallComment`.
- The event summary still counted only the existing inline comment.
- The Markdown file had no YAML `comments:` endmatter after Done Reviewing.
- Direct server tests passed when `overallComment` was posted manually.

## What Didn't Work

- Testing only `/api/review-events` with an explicit `overallComment` proved server persistence but missed whether the UI sent the field.
- Treating `overallComment` as event-only metadata made failed handoffs unrecoverable, because the Markdown file remained unchanged.
- Verifying the dropdown submit button was not enough, because the real manual flow typed in the dropdown and then clicked the primary handoff button.

## Solution

Add an e2e regression that exercises the exact user path:

1. Create a real Markdown file on disk.
2. Open it through the app with a real local API server.
3. Start a real review-event watcher.
4. Open the handoff dropdown.
5. Type an overall comment.
6. Click the primary **I'm done** button.
7. Verify the Markdown file now contains a document-level YAML `comments.cN.body` entry.
8. Verify the event reflects the persisted comment.

The fix was to pass the trimmed textarea value through the primary button path when present. The split control had two completion paths:

```tsx
// Broken: primary path ignored the textarea state.
onClick={() => void handleCompleteReview()}
```

```tsx
// Fixed: primary path forwards the draft overall comment when present.
onClick={() =>
  void handleCompleteReview(
    trimmedOverallComment
      ? { overallComment: trimmedOverallComment }
      : undefined,
  )
}
```

The durable representation is a root document-level YAML comment:

```yaml
comments:
  c2:
    body: Please focus on the CLI contract first.
    by: user
    at: 2026-05-24T20:08:52.429Z
```

`body` without `re` represents document-level feedback. Inline comments still use anchored CriticMarkup, and replies still use `re`.

## Why This Works

The e2e test matches the real workflow that failed. It does not assume the API request is correct; it proves the browser control, API call, server write, filesystem state, and watcher response line up.

Persisting the comment in Markdown also makes the file the source of truth. Even if a watcher misses event metadata, the next agent can recover the document-level comment by reading the file.

## Prevention

- When a feature crosses browser, API, CLI/watch, and filesystem boundaries, add one e2e test for the exact human workflow before calling the fix complete.
- For split buttons, menus, keyboard shortcuts, and alternate submit controls, test every control that can complete the same action.
- Prefer assertions against durable artifacts, such as the Markdown file, over event-only assertions when the product contract is file-backed.
- If a user says they performed a step that tests say should work, trust the report and add a reproduction around the exact path they used.

## Related Issues

- New regression coverage: `packages/app/e2e/review-handoff.spec.ts`
- Component coverage: `packages/app/test/view-toggle-bugs.test.tsx`
- Runtime path involved: `packages/app/src/DocumentWorkspace.tsx`, `packages/server/src/index.ts`, `packages/rfm/src/index.ts`
