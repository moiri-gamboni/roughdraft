# 0004: CLI Server State Model

## Context

The CLI starts or reuses a local server so `roughdraft open <file.md>` works without manual process management.

## Decision

The server state file records the managed background process, port, URL, and start time. The CLI should reuse healthy managed servers, recover from stale state, and avoid claiming ownership of unrelated processes unless explicitly requested.

## Consequences

State handling must remain deterministic and testable. Stale-write protection and local-file boundary checks belong in the core server path.

## What This Explicitly Does Not Mean

The state file is not a project database, collaboration backend, sync system, or persistent document model.
