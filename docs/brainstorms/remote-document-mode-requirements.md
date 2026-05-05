---
date: 2026-04-30
status: brainstorm
scope: deep-feature
---

# Remote Document Mode — Requirements

## Problem

Kieran's daily setup: he uses a laptop as the human-facing surface and SSHes into other machines (Mac mini, Hetzner Linux runner, etc.) where coding agents do work. Markdown files (plans, drafts, ADR drafts) live on the SSH-target machine because that's where the agent is reading and writing them.

Roughdraft today assumes the file lives on the same machine the server runs on. So today the only ways to review those remote-authored files in Roughdraft are:

1. Run Roughdraft *on* the SSH box, set up an SSH tunnel from the laptop, browse to it. — One Roughdraft per SSH session, port clutter, no roaming.
2. Copy files back and forth manually. — Defeats the point of the agent owning the file.
3. Editor-shells like VS Code Remote-SSH. — Not Roughdraft.

The user wants: open Roughdraft once on a stable host he can browse to, and have the SSH-side agent say "open this remote file" — saves round-trip back to the SSH box's disk transparently.

## Goals

- An agent on any SSH/Tailscale-reachable machine can run a CLI command that surfaces a markdown file in a single, persistent Roughdraft instance.
- Edits made in the browser save back to the file's home machine.
- The user views the editor from any device with a browser (laptop, phone) without per-box Roughdraft instances.
- Works over Tailscale (assume both sides are reachable to each other on the tailnet); no inbound ports on the SSH box required.
- Default-on persistence: the hosted Roughdraft survives laptop sleep.

## Non-Goals

- Not a multi-user collaboration product (single-user-across-machines is the target).
- Not a vault, note database, or document index. The unit of work is still one markdown file, per ADR-0001.
- Not a replacement for local Roughdraft on the laptop; both modes coexist.
- Not a generic remote filesystem mount. Documents are surfaced one at a time.
- Not a public-internet hosted SaaS. Tailnet/LAN scope only.

## Recommended Approach: Remote-Document API

A single Roughdraft instance runs persistently (default: Mac mini, since `Mijn Tuin` already provides launchd + overmind for it). The CLI gains a remote mode:

1. CLI on the SSH box reads `ROUGHDRAFT_HOST` env or repo config.
2. `roughdraft open foo.md` reads the file content from local disk, POSTs it to a new endpoint on the hosted Roughdraft (e.g. registers a "remote document session" with content + a unique session id).
3. The CLI process keeps a long-lived SSE/WebSocket connection open to receive save-back events.
4. The hosted Roughdraft displays the document under a new `backend: "remote"` mode that lives alongside `local-files`. The editor itself is unchanged.
5. When the user saves in the browser, the hosted server pushes the updated bytes through the SSE/WS connection back to the CLI, which writes them to disk on the SSH box.
6. CLI exit (Ctrl-C, agent finished) closes the session; the document stays viewable but read-only or marked disconnected.

Key properties:

- Only **outbound** connectivity required from the SSH box. No inbound port on the SSH side.
- The CLI process *is* the source of truth for that file's bytes; the hosted Roughdraft owns no persistent storage.
- One `ROUGHDRAFT_HOST` env var is the only configuration the agent needs to add.

## Hosting Recommendation

Default to **Mac mini, accessible via Tailscale**. Browser tab opens from any device.

Why:
- Already always-on (launchd + overmind in `~/tuin/`).
- Tailscale-reachable from every machine in the user's network.
- Decoupling the server (always-on box) from the viewer (whichever browser is convenient) matches the actual workflow.

Keep `ROUGHDRAFT_HOST` overrideable so the user can point at his laptop, a teammate's instance, or any other host without code changes.

## Alternatives Considered

**B. Local Roughdraft as SSH/SFTP client.** Roughdraft on laptop opens SSH to the remote and reads/writes files itself. Rejected: embeds an SSH client in Roughdraft, key/identity mapping, file-watching over SFTP is awkward, and laptop must be on for any agent to surface a doc.

**C. Reverse tunnel, per-box Roughdraft.** Run Roughdraft on each SSH box bound to a Tailscale-reachable host; CLI prints the URL. Rejected: this is the "load a local version" pattern the user is explicitly trying to avoid. Scales poorly across many SSH targets, no roaming, port-state proliferation.

**D. Multi-tenant persistent dashboard (challenger).** Same as A, but the hosted Roughdraft surfaces a list of all currently-registered documents from all CLIs across all machines. Deferred to a later phase — once the single-document remote primitive ships, this becomes mostly a UI affordance over multiple sessions, not a separate architecture.

## Scope Boundaries

### Deferred for later

- Multi-document dashboard view (Approach D).
- Mobile/phone usability tweaks beyond what the existing UI already provides.
- Push-style notifications (e.g. "agent X just opened a doc").
- File watching / auto-reload when the file changes on disk *outside* the open session.
- Conflict resolution if the same file is opened from two CLIs simultaneously.
- Authentication beyond Tailscale ACLs.

### Outside this product's identity

- Becoming a vault, document database, or sync engine. This stays "open one markdown file at a time."
- Public-internet hosting or multi-user collaboration.
- A real-time collaborative editor.

## ADR Conflicts to Surface

This feature pushes against two recorded decisions; neither is fatal but both deserve an explicit nod (or a follow-up ADR) before implementation:

- **`docs/adr/0001-single-local-markdown-file.md`** — currently states "the server resolves that file within local-file boundaries." Remote-document mode keeps "one markdown file at a time" but breaks the *local-filesystem* boundary. Proposed update: clarify that the unit of work is still one markdown file, but the file may be owned by a CLI process rather than the local disk under the server.
- **`docs/adr/0004-cli-server-state-model.md`** — explicitly says the state model "is not a collaboration backend, sync system, or persistent document model." Remote-document mode introduces session state (registered remote documents) that lives only in the running server's memory, not in the state file. Worth confirming this is acceptable as transient in-memory state.

## Dependencies / Assumptions

- Tailscale (or equivalent) is present on every machine that participates. Without bidirectional reachability the user must arrange it themselves.
- The hosted Roughdraft is reachable from each SSH box on a stable URL.
- The CLI process on the SSH box is long-lived enough to hold the SSE/WS open (i.e. the agent doesn't exit immediately after `roughdraft open`).

## Security Model (added 2026-04-30 after code review)

The hosted server is a write-capable peer for every connected CLI: an authenticated PUT triggers a disk rewrite on the source machine. Two layers gate that:

1. **Token-based auth.** A shared secret `ROUGHDRAFT_TOKEN` is required on every `/api/remote-document/*` request when set on the server. The CLI sends it via `Authorization: Bearer`; the browser viewer URL embeds it as `?token=...` so the frontend forwards it on fetches and EventSource. The server rejects unauthenticated requests with 401 and a remediation hint.
2. **Secure-by-default startup.** `createServer()` refuses to bind to a non-loopback host (e.g. `0.0.0.0` for Tailscale exposure) unless `ROUGHDRAFT_TOKEN` is set. Loopback-only deployments stay back-compatible — no token, no behavior change.

The trust model is "Tailscale ACLs + a shared token." We are not solving multi-user collaboration, end-to-end encryption beyond TLS, or token rotation. Compromise of the host still implies file overwrites on connected CLIs; the token is defense in depth, not a complete answer.

## Open Questions

- **Save-back mechanism**: SSE (server-sent events, simpler) vs WebSocket (bidirectional, easier for ack). Either works; planning decision.
- **Session lifecycle on CLI disconnect**: should the document stay on screen as read-only with a "disconnected" badge, or close the tab automatically?
- **Concurrent opens**: if two CLIs from two boxes register the same logical doc (`foo.md`), are they the same session or two? Probably two, distinguished by a session id, but UX needs a call.
- **CriticMarkup comments produced in the browser** — they round-trip to the file on the SSH box like any other edit. Worth confirming nothing else (e.g. comment authorship, timestamps) needs persistence outside the file.
- **What if `ROUGHDRAFT_HOST` is unset and the CLI is on a non-laptop host?** Fall back to local mode (current behavior), or error out, or print install instructions?

## Success Criteria

- From a fresh SSH session into the Hetzner runner: `ROUGHDRAFT_HOST=<mac-mini-url> roughdraft open plan.md` shows the file in a browser tab on the laptop within ~1 second.
- Edit in the browser; save; SSH back to Hetzner; `cat plan.md` shows the new content.
- Close the laptop lid, reopen it, browse to the same URL: document is still there (or gracefully marked disconnected if the CLI session ended).
- Running `roughdraft open` *without* `ROUGHDRAFT_HOST` set still works exactly as today.
- No new inbound ports on the SSH box.

## Suggested Next Step

`/ce-plan` to produce an implementation plan covering: the new remote backend type, the `/api/remote-documents` endpoint shape, SSE-vs-WS choice, CLI session lifecycle, and ADR-0001/0004 updates.
