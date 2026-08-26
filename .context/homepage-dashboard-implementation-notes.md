# Homepage dashboard — implementation notes

Consolidated from four parallel units built against `plans/homepage-dashboard.md`: `server` (Tasks 1–3), `app-foundation` (Tasks 4–5), `dashboard-ui` (Tasks 6–7) and `integration` (Tasks 8–9). The per-unit logs, with their red-green evidence and review transcripts, are in `plans/homepage-dashboard/.workspace/workers/`.

Everything the plan called a fixed outcome shipped. What follows is where reality diverged, what was traded away, and what is left.

## Decisions the plan did not make

**The summary cache swallows every stat failure, not only ENOENT.** The plan's step-by-step named ENOENT; its interface block said "never throws". `ENOTDIR` is reachable — `/dir/notes.md/sub.md` passes every check `registryPathFromRequest` makes — and because `read()` runs once per row inside the synchronous `/api/dashboard` handler, one such row would have 500'd the whole endpoint. The app is specified to read a non-OK dashboard as "this server is running an older build", so the failure mode was a misleading upgrade prompt caused by a stray path. Every stat failure now returns `{exists:false, modifiedAt:null, summary:null}`. Reproduced with a failing test before fixing.

**The polling deadline is a plain `AbortController` plus `setTimeout`, not `AbortSignal.any([unmount, AbortSignal.timeout(10_000)])`.** `AbortSignal.timeout` runs on Node's internal timer, which vitest's fake timers do not patch, so the plan's own test case ("a timed-out poll counts as failed") could only have been written as a ten-second real-time wait. One controller per request, aborted by either the faked timer or the effect cleanup, hands `fetch` the same signal and makes the deadline falsifiable.

**The open-by-path field sits at the foot of the page, not inside the empty state.** The plan listed it among the empty state's contents, which would have made it unreachable the moment a row existed — against fixed outcome 5. It renders once, below the sections, which in the empty case reads as part of that block.

**`normalizeAbsolutePath` clamps `..` at the root.** `/a/../../x.md` becomes `/x.md`, matching the server's `path.resolve`. Without the clamp the path field could navigate to `/../x.md`, which the server rejects even when the file exists.

**Two extra test IDs.** `dashboard-unreachable-retry` (the plan named the Retry button but gave it no handle, and `check-test-selectors.mjs` requires one) and the `data-document-path` attribute on rows, always selected behind `[data-testid="dashboard-row"]`.

**The e2e watch budget is 60 seconds, not the plan's 25.** The plan's 25 came from `docs/solutions/test-flakiness/a-time-budget-is-not-evidence.md`, whose prose says 25 while the commit it describes actually landed 60 in `review-handoff.spec.ts`, with the rationale that a budget shorter than the test timeout lets a loaded machine decide whether the badge is there. The dashboard spec follows the code: 60 seconds plus the same 500 ms teardown grace, so a failure before the release still reports its own assertion instead of a hook timeout. The happy path releases the watch explicitly, so the budget is never spent.

**The screenshot guide keeps an update-notice row.** The plan said to delete rows 99–108 as homepage states, but `UpdateNotice` still renders over the document workspace — only the dashboard omits it. The row moved to the Document area rather than disappearing.

**Two exports were dropped that the plan did not mention.** `badgeVariants` (the repo's own `button.tsx` exports only the component) and the server's `ReviewSummary` interface, both module-internal and both `pnpm unused` findings the deletion pass would otherwise have left behind.

## Tradeoffs worth knowing

**The dashboard is unauthenticated, and that is a deliberate continuation, not an oversight.** Every local-file route already is. What the dashboard adds is enumeration: a caller no longer needs to know a path to learn one. Three things follow from accepting that. The bind guard's error text now names the local-file routes and the dashboard, so nobody binds to a tailnet address believing `ROUGHDRAFT_TOKEN` covers everything. The overall comment left with a review is withheld from the payload — only a `hasOverallComment` flag and a chip linking to the document. And because the page publishes the exact strings `POST /api/open-request` matches on, the app now follows only same-origin `http:`/`https:` open requests, rebuilt on `window.location.origin`. A `javascript:` URL delivered through that route used to execute in the page; it no longer does. ADR 0004's 2026-08-26 clarification records all of this.

**Waiter state has one owner.** The registry records that a watch happened; whether an agent is blocked right now is read from `ReviewEventQueue` at compose time, and the queue's waiting paths are unioned into the row set so a blocked agent renders even after the registry evicts its row. That made a pre-existing bug into a blocker rather than a nuisance: a waiter used to outlive its client by up to 240 seconds, which was invisible before and would have been a lie on a badge. The watch route now aborts the wait when its response closes.

**`unresolved` is not the comment count.** For the shared fixture (one comment, one suggestion) it is 2. Anything writing a new fixture should take the number from `extractRoughdraftReviewIndex` rather than counting by hand.

**A draft with a null base reads as `unsaved`.** That is intended — it is what the workspace will prompt about — and the plan cut the third `unknown` disposition that would have distinguished it.

**Draft rows are matched to server rows by exact string equality on the path.** A hand-typed non-canonical `?path=` would split one document into two rows. The plan considered and rejected normalising draft keys (no app or CLI path writes an unnormalised URL; the open-by-path field normalises before navigating), and the reviewer independently agreed the case is narrow.

**The empty state ignores `recentReviews`.** A payload with zero documents but a non-empty review list renders "has not been asked to open a document since it started" above a Recent reviews section. Reaching it needs more than 50 documents churned since the review, so no guard was added.

## Verification and its gaps

`pnpm --filter @roughdraft/app exec vitest run --maxWorkers=2` is green: 36 files, 501 passed, 1 skipped. The server suite is green except for seven `src/cli.test.ts` cases that fail identically on clean `main` in this environment — browser-launch cases where `getLastOpenedUrl()` returns null in a sandbox with no browser to launch. They are not this feature's, and they are what makes `pnpm check` red end to end.

`pnpm test:smoke` passes 19/19 at `--workers=1` in about 1.6 minutes, including the new `e2e/dashboard.spec.ts`. At the default four workers on this box every test fails, including ones this branch never touches, and the box was carrying a load average between 14 and 36 across eight cores at the time from other unrelated sessions. That is machine contention rather than a regression, but it means the smoke gate here is only meaningful single-worker until the box is quiet.

`pnpm unused` gains three findings against the pre-feature baseline, all in the "unused exported types" bucket that already held twelve entries on `main`: `DraftDisposition`, `DocumentActivity` and `DocumentFileState`. All three are `export`ed because the plan's interface blocks specify them that way, and all three are currently only used inside their own module. Un-exporting them would contradict a binding interface; leaving them is consistent with how the repo already treats that bucket. The `pnpm unused` gate was about the *deletion* not orphaning anything, and it does not.

The residual realism gap the unit logs carried is now closed for the main path: `e2e/dashboard.spec.ts` drives a real browser through a parked watch, the waiting row, the open link and the editor, then releases the waiter. A separate manual pass with `rodney` against the dev server confirmed the empty state, the non-Markdown load-error banner, and the missing-file banner rendering above a row with the `file missing on disk` chip.

One thing that pass turned up, which is worth knowing but is not a defect: **under `pnpm dev`, killing the API server makes the page say "This server is running an older build"**, not "Couldn't reach the Roughdraft server". Vite's proxy turns the connection refusal into a 5xx response, and `fetchDashboard` classifies any non-OK status as `unsupported`, exactly as the plan specifies. In production there is no proxy — the same Express process serves both the bundle and the API — so a dead server produces a real network error and the `unreachable` notice, and a 200 `text/html` SPA fallback from a genuinely older server produces `unsupported`. Both production paths are what the classification was designed for; only the dev sandwich is misleading.

## Left for later

- **MCP `roughdraft_get_open_documents` is still unwired.** Its docstring now says so plainly instead of calling itself "stateless". Wiring it to the registry is a small change and the trigger is anyone actually registering `roughdraft mcp` with a client.
- **No way to clear a single row.** Rows age out at 50. The trigger is a stray row that bothers someone.
- **No per-request parse budget in the summary cache.** The size bound (2 MB) is in; a mass invalidation — a `git checkout` touching many tracked documents — could still cost 50 parses in one request. The trigger is an observed stall.
- **No build identity on `/api/status`.** The "older server build" state is detected from the response shape. A second version-skew incident would justify a real build ref.
- **`docs/plans/2026-05-07-homepage-workflow-storyboard*.md` are marked superseded rather than deleted**, and `public/sneak-peek.png` is kept: it is unreferenced (the og tags point at a remote URL) but it is upstream rebase surface.
- **`packages/app/test/homepage-metadata.test.ts` keeps its name and its assertions.** It tests `index.html`'s social-preview tags, which the route swap does not touch; the name is now slightly stale.
