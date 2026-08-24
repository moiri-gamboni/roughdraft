# 0001: Single Local Markdown File

## Context

Roughdraft's core workflow is opening one ordinary Markdown file from the local filesystem so a human and coding agents can review it together.

## Decision

Roughdraft treats a Markdown file path as the primary unit of work. The server resolves that file within local-file boundaries and the app edits the file directly.

## Consequences

The CLI and app should optimize for quick open, review, edit, save, and close flows. Features that require a project database, global index, or vault model need a separate decision.

## What This Explicitly Does Not Mean

This does not make Roughdraft a vault manager, note database, git client, desktop shell, or multi-document workspace.

## Clarification (2026-04-30): Remote Document Mode

The "single markdown file" unit of work is preserved when the file lives on a different machine than the Roughdraft server. Remote document mode (see `docs/plans/2026-04-30-001-feat-remote-document-mode-plan.md`) lets a CLI on a remote host register one markdown file with a hosted Roughdraft over HTTP/SSE; the server holds the bytes in memory for the duration of the session and never browses or indexes a remote filesystem. The user-facing invariant is the same: open one file, edit it, save it, close it.

The "local-file boundary" wording above should be read as the **resolved file boundary** — Roughdraft still resolves and operates on a single markdown file. Whether the bytes originate from local disk or from a CLI-owned session does not change the unit of work.

This clarification does not extend Roughdraft into a vault manager, note database, or multi-document workspace.

## Clarification (2026-08-24): Per-Document Review History

Roughdraft now keeps past versions of a document in a sidecar directory beside it, `<dir>/.roughdraft-history/v1/<stem>/` (the format is specified in [`docs/spec/history-sidecar.md`](../spec/history-sidecar.md)). Every state Roughdraft writes over an existing document is captured there, deduplicated against the previous one and coalesced within a 90-second burst of like captures, and a roost `PreToolUse` hook captures a review-bearing document before an agent overwrites it. The point is narrow: review content saved to disk — CriticMarkup comments, suggestions, YAML endmatter — is ordinary Markdown to every other tool on the machine, so a second session writing from a stale copy erases it with no trace. Recovery previously depended on whatever whole-filesystem backup the machine happened to have, which is operator-only and hours coarse.

**This does not make Roughdraft a git client.** The history is a bounded ring of at most 50 flat copies of one file, ordered by time and nothing else. There are no branches, no commits, no messages, no remotes, no merges, and no index spanning documents — a snapshot cannot be named, annotated, tagged, or related to a snapshot of any other file. The unit of work is still one Markdown file, and the history is a property of that file in the same way the file's own bytes are. A feature that needed to reason about several documents' histories together, or about how one version became another, would need a separate decision.

### The new confidentiality class

The sidecar changes what it means to hand someone a document's directory. Content the author deliberately removed — a comment they thought better of, a paragraph they cut, a name they redacted — persists in `.roughdraft-history/` beside the document and travels with it into any copy, archive, or backup of that directory. Snapshots are plain Markdown; nothing is encrypted, obfuscated, or expired by time. File modes are the only barrier and a thin one: Roughdraft writes its snapshots `0600`, but the roost hook copies a document's own mode, so a world-readable document ordinarily leaves world-readable history.

This is a real cost, and it is accepted knowingly, because the failure it buys protection from is the same content being *silently* lost. The mitigations are deliberately modest: the sidecar carries a `.gitignore` containing `*` so that `git add -A` cannot publish it and `git clean -fd` cannot delete it, and this repository ignores `.roughdraft-history/` outright. Neither helps with a directory copied, archived, or shared wholesale. Anyone who needs a document's removed content to be gone must delete the sidecar; there is no in-product way to redact one snapshot.

### Accumulation and rename-orphaning

A document accumulates at most 50 snapshots, each the size of the document when it was taken. For prose documents that is kilobytes to low megabytes per document over months, which is why the retention rule is a count cap and not a calendar policy — no sweeper, no TTL, no background job. The bound is per document and there is no bound across documents: a directory of many reviewed files carries many sidecars.

Two consequences follow from the sidecar being keyed by file name. A document renamed after a snapshot was taken keeps its history under its former name, where nothing will ever look for it again and nothing will ever evict it; and a new document taking that name inherits the old one's history. Both are accepted rather than solved. Solving them properly means tracking document identity independently of its path, which is the cross-document index this ADR rules out.

### Fork-permanent

This feature is not proposed upstream. It exists because this fork's documents are reviewed by agents that overwrite files, and it carries an on-disk format, a hook in another repository, and the confidentiality cost above — none of which upstream has asked for. It is maintained here and rebased along with the fork's other changes.
