# Roughdraft Agent Instructions

## Bug Fix Workflow

When the user asks you to fix something, first have a subagent reproduce the bug with a failing test case before implementing the fix. The subagent should focus on the smallest behavioral test that demonstrates the problem, and should report the failing command, changed test files, and why the failure captures the requested bug.

Tests should follow Kent Beck's desiderata:

- Isolated: tests should return the same results regardless of the order in which they are run.
- Composable: if tests are isolated, then 1, 10, 100, or 1,000,000 tests can run and get the same results.
- Fast: tests should run quickly.
- Inspiring: passing tests should inspire confidence.
- Writable: tests should be cheap to write relative to the cost of the code being tested.
- Readable: tests should be comprehensible for the reader, invoking the motivation for writing this particular test.
- Behavioral: tests should be sensitive to changes in the behavior of the code under test. If the behavior changes, the test result should change.
- Structure-insensitive: tests should not change their result if the structure of the code changes.
- Automated: tests should run without human intervention.
- Specific: if a test fails, the cause of the failure should be obvious.
- Deterministic: if nothing changes, the test result should not change.
- Predictive: if the tests all pass, then the code under test should be suitable for production.

## Slog Default

This repo vendors the `slog` skill at `.codex/skills/slog`.

Treat `slog` as a default self-verification tool in this repo.

- Use `slog` when fixing bugs.
- Use `slog` when building new features.
- Use `slog` during planning when you need to verify your understanding of the current code path before changing it.
- Default pattern: mint a fresh run, add focused logs around the decision points, exercise the path, read the log file, and summarize what the logs prove.
- Prefer `slog` over guesswork when the task depends on how the code actually behaves at runtime.

Basic workflow:

```bash
bun .codex/skills/slog/scripts/slog.ts new <label>
```

- Restart any long-running local services after creating the run so they pick up `.context/slog/current.env`.
- For one-shot commands, source or export `.context/slog/current.env` before running the command.
- Inspect the latest file with:

```bash
bun .codex/skills/slog/scripts/slog.ts latest file
```

## Worktree-Specific CLI

This repo installs a worktree-specific Roughdraft CLI wrapper during setup.

- `roughdraft` is the published npm package
- `roughdraft-dev-<worktree-name>` is the local CLI for one specific checkout

In a fresh worktree, `pnpm setup` runs `pnpm dev:install-cli`, which creates a wrapper in `~/.local/bin` by default.

To derive the correct command for the current checkout, use the git worktree root, then take its basename:

```bash
worktree_root="$(git rev-parse --show-toplevel)"
worktree_name="$(basename "$worktree_root")"
roughdraft_cmd="roughdraft-dev-$worktree_name"
```

Example in this checkout:

```bash
roughdraft-dev-lyon-v2 start
```

Do not use the global `roughdraft` command for repo-local development in this repo unless the user explicitly asks for the published package.

## Fallback If The Wrapper Is Missing

Setup should install the wrapper automatically, but if the command is missing:

```bash
cd "$(git rev-parse --show-toplevel)"
pnpm dev:install-cli
```

Then recompute `roughdraft_cmd` and use it.

## Roughdraft Workflow

Use Roughdraft when the user wants to open, review, or comment on a Markdown file.

The user may refer to Roughdraft as `rd` in natural language. Treat `rd` as shorthand for Roughdraft in user requests, but do not create or modify any shell alias, executable, symlink, or command named `rd`.

Preferred flow:

1. Derive `roughdraft_cmd` for the current worktree.
2. Start the local server if needed:

```bash
"$roughdraft_cmd" start
```

3. Open the relevant Markdown file:

```bash
"$roughdraft_cmd" open "/absolute/path/to/file.md"
```

4. After the user finishes reviewing in Roughdraft, read the markdown file from disk and make the requested changes there.

Useful commands:

```bash
"$roughdraft_cmd" status
"$roughdraft_cmd" stop
"$roughdraft_cmd" help
```

## CriticMarkup

Use CriticMarkup when reading or writing inline review feedback in markdown:

- Comment: `{>>comment<<}`
- Insertion: `{++new text++}`
- Deletion: `{--old text--}`
- Substitution: `{~~old~>new~~}`
- Highlight: `{==text==}`
