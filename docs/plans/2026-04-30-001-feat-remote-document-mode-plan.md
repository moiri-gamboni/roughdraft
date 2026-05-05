---
title: "feat: Remote document mode"
type: feat
status: active
date: 2026-04-30
origin: docs/brainstorms/remote-document-mode-requirements.md
---

# feat: Remote document mode

## Overview

Add a "remote document" mode that lets a CLI on one machine surface a markdown file in a Roughdraft instance running on another machine. The CLI reads the file's bytes from local disk, registers a remote-document session against a hosted Roughdraft (configured via `ROUGHDRAFT_HOST`), and holds an SSE connection open to receive save events. Saves stream back through the SSE channel; the CLI writes them to disk on the source machine.

The hosted Roughdraft gains a new `backend: "remote"` mode that lives alongside the existing `local-files` backend. Local mode is unchanged.

---

## Problem Frame

Kieran's daily workflow: laptop is the human-facing surface; agents run on SSH-targeted machines (Mac mini, Hetzner runner) where markdown files actually live. Today, surfacing those files in Roughdraft requires either running Roughdraft on the SSH box (per-box clutter, no roaming) or copying files manually. We want one persistent Roughdraft instance the user browses to from any device, with the SSH-side agent able to push files into it.

See origin: `docs/brainstorms/remote-document-mode-requirements.md`.

---

## Requirements Trace

- R1. An agent on any Tailscale-reachable machine can run `roughdraft open foo.md` and see it appear in a hosted Roughdraft instance.
- R2. Edits made in the browser save back to the file's home machine on disk.
- R3. The hosted Roughdraft survives laptop sleep — it runs on an always-on box (Mac mini default) reachable via Tailscale.
- R4. Only outbound connectivity is required from the SSH-side machine. No inbound port on the SSH box.
- R5. `ROUGHDRAFT_HOST` is overrideable. When unset, the CLI falls back to today's local-mode behavior unchanged.
- R6. The hosted Roughdraft owns no persistent storage for remote documents. The CLI process is the source of truth for bytes; server holds session state in memory only (preserving ADR-0004's stance).
- R7. One markdown file at a time per session, preserving ADR-0001's product identity.

---

## Scope Boundaries

- Multi-document dashboard view (challenger Approach D from origin) — out of scope for v1.
- Public-internet hosting, multi-user collaboration, real-time CRDT editing.
- File watching / auto-reload when the file changes on disk *outside* the open session.
- Conflict resolution for two CLIs opening the same logical path simultaneously beyond "each gets its own session id."
- Authentication beyond what Tailscale ACLs already provide.
- Phone-specific UI affordances.

### Deferred to Follow-Up Work

- Multi-tenant dashboard listing all active remote sessions: future plan once the single-doc primitive ships.
- Optional reconnect-on-drop UX for the CLI: v1 keeps it simple — CLI exits cleanly when the SSE drops, user reruns the command.

---

## Context & Research

### Relevant Code and Patterns

- `packages/server/src/index.ts` — Single-file Express app. `createApp()` builds it; capability flag already exists in `GET /api/status` (`backend: "local-files"`). SSE is in-use at `/api/markdown-file/events` and `/api/open-requests`. Optimistic-concurrency with `expectedVersion` is in `PUT /api/markdown-file`.
- `packages/server/src/cli.ts` — Open command at line ~1824 follows a DI pattern via `CliDependencies`. `sendOpenRequestToExistingWindow` (line ~784) is the model for "POST a JSON payload to a known endpoint." `resolveTargetPath` (line ~810) handles disk reads.
- `packages/server/src/network.ts` — Currently hardcodes `ROUGHDRAFT_BIND_HOST = "127.0.0.1"` and a loopback list. Needs to be made env-configurable for the hosted instance.
- `packages/app/src/storage.ts` — `StorageBackend` interface with `BackendInfo.kind: "local-files" | "local-storage"` union. Extending the union is the established way to add a backend.
- `packages/app/src/api-backend.ts` and `local-storage-backend.ts` — Existing backend implementations to mirror.
- `packages/app/src/detect-backend.ts` — Branches on `payload.backend === "local-files"`. Add a `"remote"` branch here.
- `packages/app/src/App.tsx` (~L810-840) — Frontend listens to `/api/open-requests` SSE and navigates on `event: open-request`. Reusable pattern for "session ready" notifications.
- `packages/server/src/index.test.ts` — Vitest + supertest against the Express app, with `mkdtempSync` fixtures. Convention to follow.
- `packages/server/src/cli.test.ts` — Fully fake `CliDependencies`. New CLI test scenarios use the same DI pattern; do not spawn real processes.

### Institutional Learnings

- `docs/solutions/` does not exist in this repo. No prior learnings to draw from. After this lands, capture via `/ce-compound`.

### ADR Constraints

- `docs/adr/0001-single-local-markdown-file.md` — "single local markdown file." Remote mode keeps the one-file unit but breaks the *local-filesystem* clause. ADR needs a clarifying revision (handled in U6).
- `docs/adr/0004-cli-server-state-model.md` — State file "is not a collaboration backend, sync system, or persistent document model." Remote sessions therefore live in **server-process memory only**, never in the state file. U6 acknowledges this.

---

## Key Technical Decisions

- **SSE + POST, not WebSocket.** SSE for server→CLI save events; POST for CLI→server registration and content updates. Matches existing codebase patterns (`/api/markdown-file/events`, `/api/open-requests`). Lower complexity than introducing `ws`. Bidirectionality is achieved via two channels.
- **In-memory session store on the hosted server.** A `Map<sessionId, RemoteSession>` lives in the Express process. Session contains `{ id, originalPath, currentContent, version, createdAt, sseClient | null }`. No persistence — server restart drops sessions. Preserves ADR-0004's "no document model in state file."
- **Session lifecycle:** CLI generates a session id (UUID), POSTs `/api/remote-document` to register, then opens `/api/remote-document/:id/events` SSE. When SSE drops (CLI exit, network blip), session is marked `disconnected` and frontend shows a banner. After a 5-minute TTL with no reconnect, server evicts the session.
- **Concurrent opens of the same path = two sessions.** Each CLI invocation gets its own session id. The server does not deduplicate by path.
- **`ROUGHDRAFT_HOST` unset on a CLI = fall back to local mode.** Today's behavior is unchanged. We print a one-line hint about remote mode the first time `roughdraft open` runs without it (low priority polish; can drop if it bloats the diff).
- **Hosted-server bind host is env-driven.** New `ROUGHDRAFT_BIND_HOST` env var (defaults to current loopback list). Setting it to `0.0.0.0` exposes the server on all interfaces, including Tailscale. The `ROUGHDRAFT_PUBLIC_HOST` constant becomes a derived hint, not a binding.
- **Save semantics.** When the browser saves, server pushes `event: save` over the session SSE with `{ content, version }`. CLI applies to disk via the same atomic-write pattern used for local files. Optimistic concurrency: server tracks `version`, browser sends `expectedVersion`, server returns 409 if stale (mirroring `/api/markdown-file`).
- **Path validation bypass.** Remote-document endpoints do not run through `ensureProjectPath()`. The CLI is responsible for reading/writing only the file it registered. The server treats the path as opaque metadata.

---

## Open Questions

### Resolved During Planning

- **SSE vs WebSocket?** SSE+POST. See decisions above.
- **Where does session state live?** In-process memory on the hosted server only. ADR-0004-aligned.
- **Concurrent opens?** Allowed; each gets a session id.
- **Fallback when `ROUGHDRAFT_HOST` is unset?** Local mode (current behavior).
- **Server binding for the hosted instance?** New env `ROUGHDRAFT_BIND_HOST`; default is today's loopback.

### Deferred to Implementation

- **Exact session-disconnect UI affordance** — banner copy, dismiss behavior, whether the editor goes read-only. Decide once the working integration is visible.
- **CLI reconnect on transient SSE drops** — out of scope for v1, but the session-id mechanism is reconnect-friendly if we add it later.
- **Hint copy when `ROUGHDRAFT_HOST` is unset** — wording can wait until the rest is wired.
- **Whether to persist a small client-id → host mapping** for nicer multi-source UI later. Defer; v1 displays one document at a time.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
+-------------------+        +---------------------------+        +-----------------+
|  CLI on SSH box   |        |  Hosted Roughdraft        |        |  Browser tab    |
|  (file owner)     |        |  (server + frontend)      |        |  (any device)   |
+---------+---------+        +-------------+-------------+        +--------+--------+
          |                                |                                |
   1. read foo.md                          |                                |
   2. POST /api/remote-document            |                                |
      { sessionId, path, content, version }|                                |
          |--------------------------------|>                               |
          |                                |  store in Map<id, session>     |
          |                                |                                |
   3. GET /api/remote-document/:id/events  |                                |
      (SSE)                                |                                |
          |<-------------------------------|  open SSE channel              |
          |                                |                                |
          |                                |  4. browser navigates to       |
          |                                |     /?session=<id>             |
          |                                |<-------------------------------|
          |                                |  5. GET /api/remote-document/:id|
          |                                |     return { content, version }|
          |                                |------------------------------->|
          |                                |                                |
          |                                |  6. user edits + saves         |
          |                                |  PUT /api/remote-document/:id  |
          |                                |     { content, expectedVersion}|
          |                                |<-------------------------------|
          |                                |  update Map, increment version |
          |                                |                                |
   7. SSE event "save"                     |                                |
      { content, version }                 |                                |
          |<-------------------------------|                                |
   8. fs.writeFile(originalPath, content)  |                                |
          |                                |                                |
```

---

## Implementation Units

- U1. **Make server bind host env-configurable**

**Goal:** Allow the hosted Roughdraft to bind to a non-loopback host (e.g. Tailscale interface or `0.0.0.0`) without code changes. Enables every later unit to be testable across machines.

**Requirements:** R3, R4

**Dependencies:** None

**Files:**
- Modify: `packages/server/src/network.ts`
- Modify: `packages/server/src/index.ts` (the `createServer()` listen loop)
- Test: `packages/server/src/network.test.ts` *(new)*

**Approach:**
- Introduce `ROUGHDRAFT_BIND_HOST` env var. When set, replaces the loopback list with a single host (or comma-separated list).
- Keep `ROUGHDRAFT_LOOPBACK_HOSTS` as the default for back-compat.
- `network.ts` exposes a small `resolveBindHosts(env)` helper.
- No CLI flag in v1 — env-only is sufficient and matches `ROUGHDRAFT_HOST`/`ROUGHDRAFT_STATE_DIR` precedent.

**Patterns to follow:**
- `packages/server/src/network.ts` style (small constant module, no class wrapper).
- `ROUGHDRAFT_STATE_DIR` env handling in `cli.ts` for env-resolution shape.

**Test scenarios:**
- Happy path: `resolveBindHosts({})` returns the existing loopback list.
- Happy path: `resolveBindHosts({ ROUGHDRAFT_BIND_HOST: "0.0.0.0" })` returns `["0.0.0.0"]`.
- Edge case: `resolveBindHosts({ ROUGHDRAFT_BIND_HOST: "" })` returns the loopback list (empty string treated as unset).
- Edge case: comma-separated hosts (`"0.0.0.0,::"`) parse to a list.

**Verification:**
- `pnpm test` passes new test cases.
- Manual smoke: `ROUGHDRAFT_BIND_HOST=0.0.0.0 roughdraft start` is reachable from another Tailscale device.

---

- U2. **Server-side remote document endpoints and session store**

**Goal:** Add the in-memory `RemoteSession` store and the four endpoints that drive remote-document mode: register, fetch, save, and SSE save-stream.

**Requirements:** R1, R2, R6

**Dependencies:** U1 (recommended for testability across machines, but not strictly required for unit tests)

**Files:**
- Modify: `packages/server/src/index.ts` (new module-scope `Map<string, RemoteSession>`, four new routes, status payload extension)
- Test: `packages/server/src/index.test.ts` (new describe block for `/api/remote-document`)

**Approach:**
- Routes:
  - `POST /api/remote-document` — body `{ sessionId, path, content, version? }`. Stores the session, returns `{ id, version, viewerUrl }`.
  - `GET /api/remote-document/:id` — returns `{ id, path, content, version }`.
  - `PUT /api/remote-document/:id` — body `{ content, expectedVersion }`. Writes new content + version, returns `{ version }`. Returns 409 with `{ current }` on stale-write, mirroring `/api/markdown-file`.
  - `GET /api/remote-document/:id/events` — SSE channel held by the CLI. Server emits `event: save\ndata: { content, version }` on PUT. Heartbeat every 15s like existing SSE handlers.
- Status payload (`GET /api/status`) extends `capabilities` with `{ remoteDocuments: true }` so the frontend can detect support.
- Session eviction: 5-minute TTL after SSE disconnect. Use a timestamp + interval sweep, not a per-session timer.
- Path is opaque to the server. **Do not** call `ensureProjectPath()` for remote endpoints.

**Technical design:** *(directional guidance, not implementation specification)*

```
RemoteSession {
  id            : string  // UUID, generated by CLI
  originalPath  : string  // for display only; opaque to server
  content       : string
  version       : string  // sha256+size+timestamp; reuse fileVersionFromContent
  sseClient     : Response | null
  lastSeenAt    : number
}
```

**Patterns to follow:**
- Existing SSE handler at `packages/server/src/index.ts` `app.get("/api/open-requests", ...)` — same heartbeat shape, same client cleanup on `req.on("close")`.
- Optimistic-concurrency pattern in `PUT /api/markdown-file`.
- Capability flag pattern in `GET /api/status`.

**Test scenarios:**
- Happy path: POST register → GET returns the same content.
- Happy path: PUT with correct `expectedVersion` updates content and bumps version.
- Happy path (Covers F1 from origin success criteria): PUT triggers an SSE `save` event on the registered SSE channel.
- Edge case: GET on unknown session id returns 404.
- Edge case: PUT with wrong `expectedVersion` returns 409 with `{ current }`.
- Edge case: SSE stream sends a heartbeat every 15s (use fake timers).
- Edge case: SSE client disconnect followed by 5+ min wait → session is evicted; subsequent GET returns 404.
- Integration: register session, open SSE, PUT new content, assert SSE emits `save` with the new bytes.

**Verification:**
- All test scenarios pass.
- `GET /api/status` returns `capabilities.remoteDocuments === true`.
- No path-validation gate (`ensureProjectPath`) is invoked on the new routes (asserted by the absence of a path traversal test failing — i.e., a `..` in the path field is accepted because path is opaque).

---

- U3. **CLI: remote-mode `open` command**

**Goal:** When `ROUGHDRAFT_HOST` is set, `roughdraft open <file>` reads the file, registers a remote-document session, holds the SSE channel open, applies save events to disk, and exits cleanly when the channel drops.

**Requirements:** R1, R2, R4, R5

**Dependencies:** U2

**Files:**
- Modify: `packages/server/src/cli.ts` (new `openRemote` branch in the open command)
- Modify: `packages/server/src/index.ts` (only if the remote-mode CLI needs additional contract surface — likely not; included here as a placeholder)
- Test: `packages/server/src/cli.test.ts` (new describe block for remote-mode open)

**Approach:**
- Branch decision lives at the top of the open command: if `env.ROUGHDRAFT_HOST` is set, take the remote path; otherwise behave exactly as today.
- Remote path:
  1. Read file via `fs.readFile` (reuse `resolveTargetPath` for path normalization, but skip the project-dir scoping since there is no local server).
  2. Generate session id via `crypto.randomUUID()`.
  3. POST `${ROUGHDRAFT_HOST}/api/remote-document` with `{ sessionId, path: absolutePath, content, version }`. On non-2xx, exit 1 with a helpful message.
  4. Open EventSource (or `fetch` + ReadableStream — the codebase doesn't depend on EventSource yet) to `${ROUGHDRAFT_HOST}/api/remote-document/:id/events`.
  5. `deps.openUrl(viewerUrl)` to open the browser tab on the user's local machine. (For SSH agents that have no local browser, the URL is also printed to stdout so the user can paste it.)
  6. On `event: save`, write content to the original disk path atomically (write to `path.tmp`, rename) and POST a no-op acknowledgement back to the server (or rely on the next save's version check; v1 can skip an explicit ack).
  7. On SSE close or process signal, flush any pending writes and exit.
- Exit code: 0 on clean shutdown, 1 on register failure, 130 on SIGINT.

**Execution note:** Test-first for the SSE-handler save-to-disk path. The DI pattern in `cli.test.ts` makes this cheap; verify save-to-disk via the fake `fetchImpl` driving an in-memory ReadableStream.

**Patterns to follow:**
- DI structure in `cli.ts` (`CliDependencies` — extend with a `createSseStream` impl so tests can inject a controllable stream).
- `sendOpenRequestToExistingWindow` for the POST shape.
- The existing atomic-write pattern in the server-side `PUT /api/markdown-file` — port the same approach (write tmp, rename) to the CLI.

**Test scenarios:**
- Happy path (Covers R1, R2): with `ROUGHDRAFT_HOST` set, `open foo.md` reads bytes, POSTs to register, opens SSE, browser URL is opened, exits cleanly when SSE closes.
- Happy path (Covers R2): SSE delivers a `save` event → CLI writes new content to the original path on disk.
- Edge case: SSE delivers consecutive saves; only the latest content lands on disk.
- Edge case: file path is a non-`.md` extension → CLI rejects before registering (preserves existing `Roughdraft can only open .md files` behavior).
- Error path: POST `/api/remote-document` returns 5xx → CLI exits 1 with a "could not register remote session" message; nothing is opened.
- Error path: SSE drops mid-session → CLI logs disconnect and exits 0 (or 130 if SIGINT).
- Error path: file does not exist → CLI exits 1 before any network call.
- Integration: `ROUGHDRAFT_HOST` unset → CLI runs the existing local flow unchanged (regression guard).

**Verification:**
- Manual: from the SSH host, `ROUGHDRAFT_HOST=http://mac-mini.tailnet:7373 roughdraft open plan.md` shows the file in a browser tab on the laptop within ~1s. Edits in browser save back; `cat plan.md` on the SSH host reflects the new content.
- Test suite: all new scenarios pass; existing local-mode tests are untouched.

---

- U4. **Frontend: `remote` backend support**

**Goal:** Detect `backend: "remote"` capability, build a `RemoteBackend` implementation, and route document operations through `/api/remote-document/:id` instead of the path-scoped local-files endpoints.

**Requirements:** R1, R2, R7

**Dependencies:** U2

**Files:**
- Modify: `packages/app/src/storage.ts` (extend `BackendInfo.kind` union with `"remote"`, add a session-id field to the storage shape)
- Create: `packages/app/src/remote-backend.ts`
- Modify: `packages/app/src/detect-backend.ts` (new branch when `payload.capabilities.remoteDocuments && url.searchParams.has("session")`)
- Modify: `packages/app/src/App.tsx` (read `?session=<id>` from URL; route through the remote backend when present)
- Test: `packages/app/src/remote-backend.test.ts` *(new)*
- Test: `packages/app/src/detect-backend.test.ts` (extend with a remote-mode branch)

**Approach:**
- `RemoteBackend` mirrors `ApiBackend`'s shape but ignores `projectPath`. It uses the session id from `BackendInfo` for every request.
- `getMarkdownFile` → `GET /api/remote-document/:id`.
- `saveMarkdownFile` → `PUT /api/remote-document/:id` with `expectedVersion`.
- `watchMarkdownFile` → SSE on `/api/remote-document/:id/events` to refresh on remote saves (a save from the CLI pushing content change later, if we ever add it; v1 may emit only browser-originated saves).
- `saveAsset` and `resolveFileUrl` — out of scope in v1; remote sessions don't have an asset directory. Throw a clear error if invoked.
- `openProject` — N/A in remote mode; throw or no-op.

**Patterns to follow:**
- `packages/app/src/api-backend.ts` for HTTP wrapper shape.
- `packages/app/src/local-storage-backend.ts` for the "minimal backend that throws on unsupported ops" pattern.

**Test scenarios:**
- Happy path: `RemoteBackend.getMarkdownFile()` issues `GET /api/remote-document/<id>` and returns content + version.
- Happy path: `saveMarkdownFile` issues `PUT` with `expectedVersion`; success returns new version.
- Edge case: 409 conflict surfaces as `MarkdownFileConflictError` (mirroring `ApiBackend`).
- Edge case: `saveAsset` throws a clear "remote sessions do not support asset uploads" error.
- Edge case: `detect-backend` chooses `RemoteBackend` when both `capabilities.remoteDocuments` is true and `?session=` is present in the URL; falls back to `ApiBackend` otherwise.

**Verification:**
- `pnpm test` passes.
- Manual: load `http://hosted/?session=<uuid>` after registering via CLI → editor renders the file content, save round-trips to disk on the CLI side.

---

- U5. **Frontend: session-disconnect affordance**

**Goal:** When the SSE channel for the open session closes (CLI exited or server lost it), the editor surfaces a clear "session disconnected — saves will not persist" banner instead of silently failing.

**Requirements:** R6 (clarity that bytes are owned by the CLI process)

**Dependencies:** U4

**Files:**
- Modify: `packages/app/src/remote-backend.ts` (expose a `sessionStatus` observable or callback)
- Modify: `packages/app/src/DocumentWorkspace.tsx` or equivalent top-level editor wrapper
- Create: `packages/app/src/components/RemoteSessionBanner.tsx`
- Test: `packages/app/src/components/RemoteSessionBanner.test.tsx` *(new, if a test file is warranted)*

**Approach:**
- Banner copy: "This document's CLI session disconnected. Reopen from the source machine to continue editing."
- Editor goes read-only when disconnected. No auto-reconnect in v1.
- Use a shadcn-style component from `packages/app/src/components/ui/` per `AGENTS.md`.

**Patterns to follow:**
- Existing top-level UI scaffolding in `DocumentWorkspace.tsx` and the components in `packages/app/src/components/`.
- shadcn alert / banner style if one is already in `components/ui/`.

**Test scenarios:**
- Happy path: when `sessionStatus === "connected"`, banner is not rendered.
- Happy path: when `sessionStatus === "disconnected"`, banner appears with the expected copy.
- Edge case: editor is read-only when disconnected (saves are blocked at the UI level, not just the network level).

**Verification:**
- Manual: kill the CLI process while editing → banner appears within ~1s; editor blocks new saves.
- Test cases pass.

---

- U6. **Update ADR-0001 and ADR-0004 to acknowledge remote mode**

**Goal:** Reconcile the new mode with the recorded decisions. ADR-0001 is updated (not superseded) to clarify the unit of work is one markdown file regardless of where it's stored. ADR-0004 gets a brief note that remote-document sessions are intentionally in-memory only and not part of the state file.

**Requirements:** R6, R7

**Dependencies:** None (can land alongside or after U2)

**Files:**
- Modify: `docs/adr/0001-single-local-markdown-file.md`
- Modify: `docs/adr/0004-cli-server-state-model.md`

**Approach:**
- ADR-0001: append a "Clarification (2026-04-30)" section noting that remote document mode preserves the one-file-at-a-time unit. The "local-file boundaries" wording is broadened to "the resolved file boundary" — the file is still a single markdown file, it just may live on a different machine that the CLI bridges.
- ADR-0004: append a short clarification that remote-document sessions are deliberately in-memory only and are not persisted in the state file. This keeps the state file's role unchanged.
- Do not write a new ADR; the existing decisions are still valid with these clarifications.

**Test scenarios:** *Test expectation: none — documentation-only change.*

**Verification:**
- ADRs read coherently after the additions.
- Plan reviewers can locate the rationale for in-memory-only session storage in ADR-0004.

---

## System-Wide Impact

- **Interaction graph:** New `/api/remote-document/*` routes added to the Express app. New SSE channel added. Frontend backend detection branches expanded. CLI gains a parallel command path. No existing routes are modified except `GET /api/status` (additive `capabilities.remoteDocuments` flag).
- **Error propagation:** Remote registration failures surface as CLI exit 1 with stderr message. SSE disconnect surfaces as a UI banner; CLI exits 0 (intentional). 409 conflicts on save mirror existing `/api/markdown-file` behavior.
- **State lifecycle risks:** In-memory session map can leak if the eviction sweep is buggy. Mitigation: explicit TTL test (U2) and a session count metric (or just `console.log` count on each sweep — keep simple).
- **API surface parity:** `local-files` mode is untouched. Remote mode is fully additive. `GET /api/status` is the one shared surface; the `capabilities` extension is back-compat (older frontend ignores unknown fields).
- **Integration coverage:** End-to-end happy path is a manual smoke test in U3 verification. Automated coverage stops at the SSE-emit-on-PUT integration scenario in U2 — anything more ambitious requires multi-process orchestration we don't have.
- **Unchanged invariants:**
  - `roughdraft open foo.md` with no `ROUGHDRAFT_HOST` set behaves exactly as today.
  - `local-files` backend, `/api/markdown-file`, and the existing SSE channels are not touched.
  - The CLI state file (`.roughdraft-state`) keeps its current shape and purpose.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| In-memory session map leaks if TTL sweep is buggy | Explicit TTL test in U2; sweep is a simple `setInterval` with a single eviction predicate. |
| Tailscale not available on a participating machine | Documented as a hard prerequisite in the origin doc; not solved by this plan. |
| CLI process exits before browser opens the URL → session never viewed | Acceptable: user just reruns. Server's TTL evicts. |
| Path traversal via the opaque `path` field on register | Path is metadata only on the server; only the CLI uses it for disk writes, and the CLI only ever writes to the path it itself read. No user-supplied path crosses the trust boundary on the server. |
| Two CLIs from two boxes register the same session id (collision) | UUIDs make this practically impossible. Server returns 409 on duplicate-id register if it ever happens. |
| Long-running SSE keeps too much server memory tied up | Each session holds the file content in memory. Monitor in practice; v1 is single-user. |

---

## Documentation / Operational Notes

- README update: add a "Remote document mode" section with the `ROUGHDRAFT_HOST` and `ROUGHDRAFT_BIND_HOST` env vars and the canonical Mac-mini-as-host setup.
- After landing, add a `docs/solutions/` entry capturing the SSE+POST decision and the in-memory session-store rationale (use `/ce-compound`).
- No production rollout — this is a local/Tailnet feature. No flags, no monitoring, no migration.

---

## Sources & References

- **Origin document:** [docs/brainstorms/remote-document-mode-requirements.md](docs/brainstorms/remote-document-mode-requirements.md)
- ADRs: [docs/adr/0001-single-local-markdown-file.md](docs/adr/0001-single-local-markdown-file.md), [docs/adr/0004-cli-server-state-model.md](docs/adr/0004-cli-server-state-model.md)
- Code: `packages/server/src/index.ts` (existing SSE handlers, capability flag, version concurrency), `packages/server/src/cli.ts` (`open` command flow), `packages/app/src/storage.ts` (backend abstraction)
