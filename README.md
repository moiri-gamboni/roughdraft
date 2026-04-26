# Roughdraft

A local-first markdown editor and viewer for working with AI.

Open one markdown file on your machine. Review it, comment on it, and suggest edits.

Paste this into your coding agent:

```text
Install Roughdraft for me using `npm i -g roughdraft`, then read https://roughdraft.page/setup.md and set yourself up to use it.
```

Or install and open a file yourself:

```bash
npm i -g roughdraft
roughdraft open /absolute/path/to/file.md
```

## What is this?

Roughdraft is a local-first markdown editor and viewer that runs on your computer.

Its job is to make markdown files easy to open, read, edit, review, and discuss with your AI agent without moving them into a proprietary format or a hosted app.

Roughdraft opens a single markdown file directly for CriticMarkup comments and suggested changes.

## How it works

*   **Local-first markdown editor** — Open normal `.md` files from your machine and edit them directly
    
*   **Works with your AI agent** — Tell your local agent to open a file in Roughdraft on your computer, then keep collaborating from there
    
*   **Comments & suggested changes** — Use CriticMarkup for inline feedback, revisions, and review conversations
    
*   **Markdown files on disk** — Everything stays as regular markdown files you can also edit in VS Code, Vim, Cursor, or anywhere else
    
*   **No cloud, no account, no telemetry** — Runs entirely on your machine
    

## Quick start

Install Roughdraft and start the local server:

```bash
npm i -g roughdraft
roughdraft start
```

`roughdraft start` runs Roughdraft in the background, reuses or chooses a free localhost port, writes server state to `~/.roughdraft/server.json`, prints the active URL, and exits while the server keeps running.

Open a specific markdown file:

```bash
roughdraft open ./path/to/my-essay/draft.md
```

Check or stop the background server:

```bash
roughdraft status
roughdraft stop
```

`roughdraft open` will reuse the running server and auto-start it if needed.

Roughdraft does not edit `~/CLAUDE.md`, `~/AGENTS.md`, or other user-level agent files. The setup prompt asks your agent to update its own guidance.

If the local server is already running, you can also open a file directly by URL:

```text
http://localhost:7373/?path=/absolute/path/to/my-essay/draft.md
```

That makes an agent-friendly workflow possible:

1.  Your AI writes or updates markdown files on disk.
    
2.  You tell it to open a markdown file in Roughdraft.
    
3.  Roughdraft opens locally on your machine.
    
4.  You read, edit, leave comments, and suggest changes.
    
5.  You tell the AI you are done, and it can respond to your comments or revise the document.
    

## Local development

```bash
./scripts/setup.sh
./scripts/run.sh
```

`./scripts/setup.sh` installs workspace dependencies and builds the app and server. `./scripts/run.sh` serves the built app at `http://localhost:7373`.

The two scripts coordinate through a lock file, so it's safe to start `./scripts/run.sh` while `./scripts/setup.sh` is still in progress. `run` will wait for setup to finish, or trigger setup itself if nothing has been built yet.

If you prefer package scripts, the same commands are available as `pnpm setup` and `pnpm start`.

Running `pnpm setup` also installs a per-worktree dev CLI wrapper into `~/.local/bin` by default, using the current worktree directory name. For example, this checkout might install `roughdraft-dev-lyon-v2`, which points at this worktree's local code while leaving the published global `roughdraft` command untouched.

Each dev wrapper keeps its own server state under `~/.roughdraft/dev/<wrapper-name>` by default, so opening a file from one worktree will not accidentally reuse a backend started from another worktree. `roughdraft-dev-<worktree> open ...` can start its own background server as needed; you do not need to run `pnpm dev` first just to open files in Roughdraft.

You can refresh that wrapper manually with:

```bash
pnpm dev:install-cli
pnpm dev:install-cli --name api-redesign
```

Quality checks:

```bash
pnpm lint
pnpm test
pnpm check
```

`pnpm check` is the same command the pull request workflow runs before merge.

## Publishing

Roughdraft publishes from `main` when the root `package.json` version is newer than the current npm `latest` version.

Release flow:

1.  Bump the root `package.json` version in a pull request.
    
2.  Merge the pull request to `main`.
    
3.  The `Publish to npm` GitHub Actions workflow runs `pnpm check`, publishes the package if that exact version is not already on npm and is newer than `latest`, then creates a `v<version>` git tag.
    

The workflow uses npm trusted publishing, so npm must be configured with this trusted publisher:

```text
Owner: Lex-Inc
Repository: roughdraft
Workflow filename: publish.yml
```

No `NPM_TOKEN` secret is required.

## Files on disk

```
my-essay/
  draft-1.md            # A normal markdown file on disk
  draft-2.md            # Another file you can open separately
```

Roughdraft reads and writes the markdown file directly.

## Agent setup

If you want your local agent to remember the Roughdraft workflow, ask it to read the live setup prompt:

```text
Install Roughdraft for me using `npm i -g roughdraft`, then read https://roughdraft.page/setup.md and set yourself up to use it.
```

Use `roughdraft help`, `roughdraft help agent`, or `roughdraft help criticmarkup` if you need a local refresher.

## CriticMarkup

Roughdraft uses [CriticMarkup](https://criticmarkup.com) for inline annotations and revision workflows:

```markdown
This is {--deleted--} text.
This is {++inserted++} text.
This is {~~old~>new~~} substituted text.
This is {>>a comment<<} in the margin.
This is {==highlighted==} text.
This is {==anchored text==}{>>a threaded comment<<}{id="c1" by="user" at="2026-04-23T18:00:00.000Z"}.
```

This matters because the main workflow is often:

*   The AI writes a doc
    
*   The user opens it in Roughdraft
    
*   The user leaves comments and suggested changes
    
*   The AI reads those comments and responds in the same markdown file
    

## Try the demo

Don't want to install anything? Try the [live demo](https://roughdraft.page) — it runs entirely in your browser using local storage.

## License

MIT

* * *

Built by [Nathan Baschez](https://twitter.com/nbashaw)
