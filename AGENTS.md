# Roughdraft Agent Instructions

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
