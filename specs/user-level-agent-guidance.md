# User-Level Agent Guidance

## Purpose

Roughdraft should help users set up one durable, user-level source of truth for agent guidance so their coding agents know to open markdown files in Roughdraft for review instead of treating markdown review as a terminal-only workflow.

The product goal is not to invent a new universal agent standard. The goal is to give users a safe, pragmatic bootstrap path that works across today’s fragmented tool landscape while preserving a clean future migration path if a global `AGENTS.md` standard eventually lands.

## Problem

Project-level agent guidance is converging on `AGENTS.md`, but user-level guidance is still fragmented.

- Claude Code documents user-level memory at `~/.claude/CLAUDE.md`
- Factory documents a personal override at `~/.factory/AGENTS.md`
- Amp documents both `$HOME/.config/amp/AGENTS.md` and `$HOME/.config/AGENTS.md`
- A proposal exists to standardize user-level guidance at `$XDG_CONFIG_HOME/agents/AGENTS.md`, but it is not yet adopted across tools

This means Roughdraft should not assume that `~/CLAUDE.md` or `~/AGENTS.md` is a real standard location, and it should not silently write to those paths.

## Product stance

- The canonical Roughdraft-managed user-level source of truth should be `~/.config/agents/AGENTS.md`
- Provider-specific files should point at that canonical file when it is safe to do so
- `AGENTS.md` should be the source of truth, not `CLAUDE.md`
- Roughdraft should prefer symlinks for clean installs
- Roughdraft should use non-destructive migration behavior for users who already have existing global agent files
- Roughdraft should install guidance for markdown review workflows, not broad personal-agent policy

## Why `~/.config/agents/AGENTS.md`

- It keeps the source of truth in `AGENTS.md`, which is the open, tool-agnostic format Roughdraft should align with
- It matches the direction of the open proposal for a global user-level path
- It avoids pretending that any vendor-specific path is the universal home for all agents
- It gives Roughdraft one predictable canonical file to create, update, and document

## Supported target files

Roughdraft should manage a canonical file and then create or maintain tool-specific adapters.

### Canonical file

- `~/.config/agents/AGENTS.md`

### Provider-specific adapters

- Claude Code: `~/.claude/CLAUDE.md`
- Factory / droid: `~/.factory/AGENTS.md`
- Amp: `~/.config/amp/AGENTS.md`

### Deferred / experimental adapters

- Codex: `~/.codex/AGENTS.md`

Codex should be treated differently for now. OpenAI’s current public Codex docs clearly document `~/.codex/config.toml` as a configuration path and strongly emphasize project-level `AGENTS.md`, but they do not clearly document a user-level `~/.codex/AGENTS.md` path. Roughdraft can support this path later as an opt-in or experimental adapter, but should not rely on it as a guaranteed official location until OpenAI documents it.

## Adapter strategy

Roughdraft should use the following rules when bootstrapping or updating user-level guidance.

### Case 1: canonical file missing

- Create `~/.config/agents/`
- Create `~/.config/agents/AGENTS.md`
- Write the Roughdraft managed block into that file

### Case 2: canonical file exists

- Update the Roughdraft managed block in place
- Leave all non-Roughdraft user content intact

### Case 3: provider-specific file missing

- Create the parent directory if needed
- Create a symlink from the provider-specific file to the canonical `~/.config/agents/AGENTS.md`

This is the preferred clean-install path.

### Case 4: provider-specific file already symlinks to the canonical file

- Leave the symlink in place
- Only update the canonical file

### Case 5: provider-specific file exists and is empty

- Replace it with a symlink to the canonical file

### Case 6: provider-specific file exists and contains user-authored content

Roughdraft should not overwrite it silently.

Instead, Roughdraft should choose a non-destructive fallback:

- Preserve the existing file
- Add or update a Roughdraft-managed block directly inside that file if needed
- Show the user a migration note explaining that a unified symlinked setup is possible, but was not forced because the target file already had content

This means Roughdraft gets the user the markdown-review behavior immediately without risking data loss.

## Claude-specific behavior

Claude Code officially reads `CLAUDE.md`, not `AGENTS.md`, and its docs recommend creating a `CLAUDE.md` that imports `AGENTS.md` when a project already uses `AGENTS.md`.

For user-level setup, Roughdraft should still prefer a symlink for clean installs because the user explicitly wants `AGENTS.md` as the source of truth. A symlink gives Claude a file named `CLAUDE.md` while still preserving `AGENTS.md` as the canonical content.

If `~/.claude/CLAUDE.md` already exists with user-authored content, Roughdraft should not replace it automatically. In that case the safer migration path is:

- keep the existing file
- append or update a Roughdraft-managed block there
- optionally suggest that the user later convert it into a symlink or import-based shim manually

## Guidance content

The managed guidance should stay narrowly focused on the Roughdraft review workflow.

It should tell the agent:

- when the agent wants the user to review, comment on, or compare markdown files, use Roughdraft
- open the relevant markdown file or folder with `roughdraft "<absolute path>"`
- after the user finishes reviewing in Roughdraft, continue by reading the markdown file from disk
- if it needs a refresher on Roughdraft usage or CriticMarkup syntax, run a Roughdraft help command instead of guessing

## Required CLI help surface

Roughdraft should expose a user- and agent-facing help surface that makes the guidance self-contained and durable.

### Minimum requirement

- `roughdraft help`

This should cover:

- what Roughdraft is for
- how to open a file or folder
- how the review loop works
- where to go for CriticMarkup help

### Recommended addition

- `roughdraft help criticmarkup`

This should include a compact reference for:

- comments: `{>>comment<<}`
- insertions: `{++new text++}`
- deletions: `{--old text--}`
- substitutions: `{~~old~>new~~}`
- highlights: `{==text==}`

The agent guidance should reference `roughdraft help` or `roughdraft help criticmarkup`, not a long syntax tutorial inline.

## Managed block behavior

Roughdraft should manage its own block inside whichever file it edits.

- Use explicit start and end markers
- Replace only the Roughdraft-managed block on update
- Never rewrite the rest of the file unnecessarily
- Keep the managed content short so it does not dilute other personal agent instructions

## User flows

### Clean bootstrap

1. User runs `roughdraft onboard`
2. Roughdraft creates `~/.config/agents/AGENTS.md`
3. Roughdraft writes the managed Roughdraft block into that canonical file
4. Roughdraft creates symlinks for supported provider-specific targets that do not already exist
5. Roughdraft prints a short summary of what it created

### Existing-user bootstrap

1. User runs `roughdraft onboard`
2. Roughdraft updates or creates the canonical file
3. Roughdraft inspects provider-specific targets
4. Missing or empty targets become symlinks
5. Non-empty user-authored targets are preserved and get a managed Roughdraft block instead of forced replacement
6. Roughdraft prints which files were symlinked and which were preserved

### Edit-only flow

If the user already has a unified setup, rerunning onboarding should behave like an updater:

- update the managed Roughdraft block in the canonical file
- leave symlinks untouched
- avoid additional prompts or churn

## Non-goals

- Defining a new cross-vendor standard for user-level agent memory
- Overwriting existing user-authored global agent files without consent
- Assuming `~/CLAUDE.md` or `~/AGENTS.md` are universal user-level paths
- Injecting large Roughdraft manuals directly into the global guidance file
- Solving every tool’s configuration model in v1

## Open questions

- Whether Codex should get an experimental `~/.codex/AGENTS.md` symlink path in v1 or wait for clearer official documentation
- Whether onboarding should modify files directly, or instead generate a reviewable patch/proposal for the user’s current agent to apply
- Whether the product should distinguish between "bootstrap global guidance" and "print guidance snippet only"

## Recommended next steps

1. Rename `roughdraft install` to `roughdraft onboard`
2. Add `roughdraft help criticmarkup`
3. Replace the current simplistic `~/CLAUDE.md` and `~/AGENTS.md` install story with the canonical-plus-adapters model in this spec
4. Start with documented adapters for Claude, Factory, and Amp
5. Leave Codex as explicit follow-up work until its user-level global path is documented more clearly

## References

- Anthropic Claude Code memory docs: https://code.claude.com/docs/en/memory
- Factory AGENTS.md docs: https://docs.factory.ai/cli/configuration/agents-md
- Amp manual: https://ampcode.com/manual
- Proposal to standardize user-level AGENTS.md: https://github.com/agentsmd/agents.md/issues/91
- OpenAI Codex docs home: https://developers.openai.com/codex
