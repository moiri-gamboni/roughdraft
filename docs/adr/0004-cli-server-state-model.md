# 0004: CLI Server State Model

## Context

The CLI starts or reuses a local server so `roughdraft open <file.md>` works without manual process management.

## Decision

The server state file records the managed background process, port, URL, and start time. The CLI should reuse healthy managed servers, recover from stale state, and avoid claiming ownership of unrelated processes unless explicitly requested.

## Consequences

State handling must remain deterministic and testable. Stale-write protection and local-file boundary checks belong in the core server path.

## What This Explicitly Does Not Mean

The state file is not a project database, collaboration backend, sync system, or persistent document model.

## Clarification (2026-04-30): Remote Document Sessions

Remote document mode (see `docs/plans/2026-04-30-001-feat-remote-document-mode-plan.md`) introduces in-memory session state on the server: a map of registered remote-document sessions, each holding a CLI-supplied markdown file's bytes for the lifetime of the SSE connection.

This state is **deliberately not persisted in the state file**. Sessions live only in the running server process and are evicted on disconnect or server restart. The state file's role — managed background process, port, URL, start time — is unchanged. Treating remote-document sessions as transient in-memory state preserves the boundary above: the state file does not become a document model just because the server now hosts other machines' edits.

### Trust model and `ROUGHDRAFT_TOKEN`

The hosted Roughdraft is a write-capable peer for every connected CLI: a PUT to a session causes the CLI on the source machine to atomically rewrite the registered file on disk. Loopback-only deployments can rely on the OS for trust, but the moment the server binds to a non-loopback host (e.g. `ROUGHDRAFT_BIND_HOST=0.0.0.0` for Tailscale access), anyone reachable on that interface can register, read, or PUT.

The mitigation is a shared bearer token, `ROUGHDRAFT_TOKEN`:

- The server reads `ROUGHDRAFT_TOKEN` at startup. When set, all `/api/remote-document/*` endpoints require it (Authorization: Bearer header, or `?token=` query for the SSE endpoint specifically since `EventSource` can't set headers).
- `createServer()` refuses to bind to any non-loopback host without a token, returning a clear actionable error before listening.
- The CLI sends the same token via `Authorization: Bearer` on its register POST and SSE GET, and surfaces a 401 explicitly (suggesting the user set `ROUGHDRAFT_TOKEN`).
- The viewerUrl printed by the CLI includes `?token=...` so the browser tab can authenticate. The frontend forwards the token as a header on fetches and as `?token=` on the EventSource.

Loopback-only deployments stay back-compatible: no token required, no behavior change. The token is the contract that lets non-loopback deployments be safe; the secure-by-default startup guard is the contract that lets us ship the feature without expecting users to read documentation before exposing the endpoints.

## Clarification (2026-08-24): Review History In Remote Document Mode

Review history (see [ADR 0001](./0001-single-local-markdown-file.md) and [`docs/spec/history-sidecar.md`](../spec/history-sidecar.md)) is kept on the machine that owns the file, so for a remote document it is written and read entirely by the origin CLI, beside the origin file; the hosted server holds the session's bytes in memory as before and keeps no sidecar of its own.

That placement caps a disk-amplification exposure rather than removing it. Writes now leave snapshots behind, so a caller who can reach a write route can drive a document's sidecar to its cap and leave up to 50 retained copies of that document on disk, where before the same requests left one file. `ROUGHDRAFT_TOKEN` gates `/api/remote-document/*` but not the local-file routes, which remain unauthenticated. The real fix is authentication on those routes; that gap is pre-existing and out of the history feature's scope, and the count cap is what bounds the damage in the meantime. Revisit if the local-file routes gain auth, or if a disk-pressure incident traces here.

## Clarification (2026-08-26): In-Memory Document Registry

The page at `/` is now a dashboard of the documents this server has been asked to open, which means the server keeps a second piece of in-memory state beside the remote-document sessions: a `DocumentRegistry` mapping an absolute path to the times it was last opened, last loaded, and last reviewed. Like the sessions, and for the same reason, **it is deliberately not persisted in the state file**. The state file still records one thing — the managed background process, its port, its URL, its start time — and a server restart still leaves a dashboard that has never heard of any document, which is exactly what the empty state says.

The registry's boundaries are what keep it from becoming the global index [ADR 0001](./0001-single-local-markdown-file.md) rules out. It holds at most 50 entries and evicts the least recently active. It is fed only by requests the server was already serving, at five points: the open-request subscribe and publish routes, the markdown-file load, the review-events watch, and a completed review. It never walks a directory, never watches a file, and never learns of a document except by being asked about it. At the two feed points that take a raw client string (the open-request subscribe and publish), a path is recorded only if it is absolute, `path.resolve`-stable, `.md`, at most 4096 characters, free of control characters, and outside a `.roughdraft-history` segment; anything else is skipped silently, because those routes' own contracts never promised to reject a path on the registry's behalf. The other three feed points inherit `ensureProjectPath`'s resolution instead, which enforces the same absolute/`.md`/no-history rules but not the length or control-character caps -- reaching them requires a file the user themselves asked Roughdraft to open.

Live waiter state stays where it already lived, in `ReviewEventQueue`. The registry records that a watch *happened*; whether an agent is blocked *right now* is read from the queue at compose time, and the set of documents with live waiters is unioned into the dashboard's rows so a blocked agent is listed even if its row was evicted. That single ownership is worth more than it looks: `/api/review-events/status` and `/api/dashboard` cannot drift apart, because there is only one count to read. It is also what forced a real fix rather than a mirror. A waiter used to survive its client — kill a CLI mid-review and the queue kept its waiter for up to 240 seconds — which was invisible before and would have been a lie on a badge. The watch route now aborts the wait when its response closes, so the chip disappears within one poll of the CLI dying.

`GET /api/dashboard` takes no parameters and, like every local-file route, is unauthenticated. That is not a new decision so much as an old one becoming visible: `/api/status`, `/api/fs/list`, `/api/review-index` and `/api/review-events/status` already answer any caller who can reach the port, and the dashboard mostly re-serves what they expose for a path the caller has to already know. What it genuinely adds is enumeration — the caller no longer has to know the path — and the honest reading is that this makes an existing exposure easier to exploit rather than creating a new one. Hence two responses. The bind guard's error text now names the local-file routes and the dashboard, not only the remote-document endpoints, so nobody binds to a tailnet address believing the token covers everything. And the overall comment left with a review is deliberately withheld: the payload carries `hasOverallComment` and the page renders a chip linking to the document, because free prose a reviewer wrote is the one thing here that has no path-free reader today and no business acquiring one.

Publishing paths also changed what `POST /api/open-request` is worth attacking. That route hands a URL to an already-open tab, which follows it; the dashboard now advertises the exact strings the route matches on. So the app no longer follows an open request wholesale — it accepts only `http:` and `https:`, and rebuilds the target on `window.location.origin` from the path, query and hash. A `javascript:` URL is dropped, and as a side effect a tailnet viewer's tab stops trying to follow the CLI's `localhost` URL, which was never correct for it.

Fork-permanent. Upstream has not asked for a dashboard; this one exists because agents on this box open documents and block on them, and a person arriving at `/` needs to see that without a shell.
