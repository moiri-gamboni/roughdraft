---
title: A Time Budget Is Not Evidence
date: 2026-08-24
category: test-flakiness
module: Roughdraft e2e suite
problem_type: flaky_test
component: e2e
symptoms:
  - "A smoke test fails on unmodified main and passes three times out of three when run alone"
  - "The layout-animation test failed 8 runs in 10 under --repeat-each with four workers"
  - "The review-handoff test reported No agent is watching now on a machine that was merely busy"
  - "Failures cluster on loaded machines and disappear the moment you try to watch them"
root_cause: incorrect_assumption
resolution_type: test_fix
severity: medium
tags: [playwright, flaky, animation, long-poll, requestanimationframe, condition-based-waiting]
---

# A Time Budget Is Not Evidence

## Problem

Three `@smoke` tests were flaky under parallel load, and all three had the same shape: a fixed span of wall-clock time was standing in for an observable condition. None of them contained a `waitForTimeout`, which is the usual tell, so the pattern went unnoticed.

**The layout-animation test** opened a sampling window — a `requestAnimationFrame` loop reading `getComputedStyle().transform`, running for 500ms — *before* the click that triggers the animation, then asserted that some sampled frame caught both the shell and the header mid-shift. Two independent things have to fit inside those 500ms: the click has to complete, and the 180ms animation has to run. Instrumentation measured the Playwright click round-trip at 400-1750ms under four workers, and individual `rAF` gaps at 200-350ms, because a busy page renders when it can. Most runs sampled an idle page and then stopped before anything moved.

**The review-handoff test** posted a `/api/review-events/watch` long poll with `timeoutSeconds: 10` and then performed the whole flow — page load, wait for the Done button, open the comment popover, type, click. The watch is what makes the Done button appear at all, so when the budget expired first the waiter count dropped to zero and the app correctly reported `No agent is watching now`. The test was racing its own scaffolding.

**The accept/reject test** was not this pattern; it was a real product race, documented separately. Nor was a fourth symptom, in which several unrelated smoke tests failed together: that was the API server crashing, also documented separately. Both are linked at the end.

## Symptoms

- Passes alone, fails in the suite; fails more on a loaded machine and less under a debugger.
- Assertions that read "did this happen?" fail with no sign of anything having gone wrong in the app.
- Re-running is enough to make it green, which is what teaches a team to re-run.

## What Didn't Work

- Widening the sampling window. It moves the failure rate without removing the race, and it slows every passing run by the amount it widens.
- Reading the transform inside a `transitionstart` handler. Measured: the value is already at the animation's *end* by the time the handler runs. The transition is composited (`will-change: transform`), so it completes on the compositor while the main thread is still queuing the event — the exact condition the test is trying to survive.
- Asserting that the shell and the header start their transitions in the same frame, to keep the "in step" property the old sampled predicate implied. `TransitionEvent.timeStamp` is the frame time rather than the dispatch time, so it looked load-proof, and across 16 measured runs the two stamps were identical in 14 and 0.8ms apart at worst. Under a longer run they were **90ms and then 500ms** apart, in runs where nothing was wrong with the animation and with the recorder started from a standstill so a leftover shift could not account for it. The two shifts are simply not always one React commit under load. Whether that split is visible to a reader is a real question, but it is a product question; asserting simultaneity in the test only bought the flake back, at 1 run in 8.

## Solution

**Record events, then wait for the condition.** Transition events cannot be missed however starved the main thread is, because they queue. The animation test now installs a `transitionstart` recorder before the click and polls until both elements have started a `transform` transition:

```ts
await recordReviewLayoutTransitions(page);
await page.getByTestId("selection-menu-action-comment").click();
await expectAnimatedReviewLayout(page);
```

**Assert the end state, not a mid-animation frame.** The second half of `expectAnimatedReviewLayout` polls until both elements are back at offset 0 with the animating class removed, which also pins the cleanup path.

**Let the scaffolding outlive the flow it is watching.** The handoff test's watch budget went to 25 seconds, sitting just inside Playwright's 30 second test timeout, with the relationship written down next to the number.

## Why This Works

The event assertion is not weaker than the sampled one, despite looking like less. A `transform` transition on these elements can only start while `review-layout-grid--animating` is applied, since that class is the only rule declaring the transition; and a transition only fires at all when the value actually changes, which the hook already guards at 1px. So "a transform transition started on both elements" carries everything the old four-part sampled predicate carried, without needing to be lucky.

Mutating the product three ways confirms it: making the hook return before it animates, deleting the CSS transition, and turning the cleanup into a no-op each fail the rewritten test. The first two fail on the recorder, the third on the settle assertion.

Measured on one loaded 8-core box, identical command (`--repeat-each=10 --workers=4`) before and after: 9 failures in 50 became 0 in 50, and the handoff test went from 3 failures in 14 to 28 in 28.

## Prevention

- Grep for durations, not just for `waitForTimeout`. A sampling window, a long-poll budget, a retry count times an interval and an animation duration are all the same bet on how fast the machine is.
- When a test needs to catch something transient, subscribe to it before triggering it and assert on what was recorded. Polling for a state that only exists for 180ms is a lottery on any machine you do not control.
- Prefer evidence that queues (events) to evidence that must be sampled (computed styles, positions, intermediate states).
- A property the product does not actually guarantee cannot be asserted deterministically, however cheap the assertion looks. Measure the property across enough runs before pinning it, and when the measurement says the product is looser than assumed, that is a finding to record rather than a test to tighten.
- A timing constant that must exceed something else should say what, next to the number. `timeoutSeconds: 10` reads like a detail; "must outlive the UI flow, bounded by the 30s test timeout" reads like a constraint.
- Reproduce a flake before fixing it and measure the same command afterwards. A flake that is not measured is a flake that has been rewritten, not fixed.
- Before assuming a flake, check whether the failures cluster. Two of the four symptoms chased here turned out not to be flaky tests at all, and a run where several unrelated cases fail at once is usually one cause, not several.

## Related Issues

- Rewritten tests: `packages/app/e2e/criticmarkup-review.spec.ts`, `packages/app/e2e/review-handoff.spec.ts`
- Runtime path the animation test covers: `packages/app/src/useReviewLayoutShiftAnimation.ts`, the `.review-layout-grid--animating` rule in `packages/app/src/style.css`
- The product race behind the third symptom: `docs/solutions/ui-bugs/an-echo-of-our-own-write-is-not-an-external-change.md`
- The server crash behind the fourth: `docs/solutions/cli-bugs/a-throw-inside-a-file-watcher-takes-the-server-with-it.md`
