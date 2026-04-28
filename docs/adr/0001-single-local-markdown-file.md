# 0001: Single Local Markdown File

## Context

Roughdraft's core workflow is opening one ordinary Markdown file from the local filesystem so a human and coding agents can review it together.

## Decision

Roughdraft treats a Markdown file path as the primary unit of work. The server resolves that file within local-file boundaries and the app edits the file directly.

## Consequences

The CLI and app should optimize for quick open, review, edit, save, and close flows. Features that require a project database, global index, or vault model need a separate decision.

## What This Explicitly Does Not Mean

This does not make Roughdraft a vault manager, note database, git client, desktop shell, or multi-document workspace.
