# Roughdraft

A local-first markdown editor and viewer for working with AI.

Open any markdown file on your machine. Review it, comment on it, suggest edits, and explore variations on a canvas when you need to.

```
npx roughdraft
```

https://github.com/user-attachments/assets/placeholder.mp4

## What is this?

Roughdraft is a local-first markdown editor and viewer that runs on your computer.

Its job is to make markdown files easy to open, read, edit, review, and discuss with your AI agent without moving them into a proprietary format or a hosted app.

The canvas is part of the product, but it is not the whole product. You can open a single markdown file directly, review it with CriticMarkup comments and suggested changes, or open a folder and use the canvas to explore different versions of an idea.

## How it works

- **Local-first markdown editor** — Open normal `.md` files from your machine and edit them directly
- **Works with your AI agent** — Tell your local agent to open a file in Roughdraft on your computer, then keep collaborating from there
- **Comments & suggested changes** — Use CriticMarkup for inline feedback, revisions, and review conversations
- **Canvas for exploration** — Open a folder of docs and arrange pages spatially when you want to compare, branch, or explore versions
- **Markdown files on disk** — Everything stays as regular markdown files you can also edit in VS Code, Vim, Cursor, or anywhere else
- **No cloud, no account, no telemetry** — Runs entirely on your machine

## Quick start

```bash
npx roughdraft
```

This starts Roughdraft locally and opens it automatically.

If you want a persistent `roughdraft` command and the user-level agent guidance block, run:

```bash
npx --yes roughdraft install
```

That installs `roughdraft` globally and updates `~/CLAUDE.md` plus `~/AGENTS.md` with Roughdraft instructions.

On macOS, if Google Chrome is installed, Roughdraft prefers opening in a separate Chrome app window instead of a normal browser tab.

```bash
npx roughdraft ~/writing/my-essay
```

Open a specific project folder.

```bash
npx roughdraft ~/writing/my-essay/draft.md
```

Open a specific markdown file directly.

If the local server is already running, you can also open a folder or file directly by URL:

```text
http://roughdraft.localhost:3000/absolute/path/to/my-essay
http://roughdraft.localhost:3000/absolute/path/to/my-essay/draft.md
```

That makes an agent-friendly workflow possible:

1. Your AI writes or updates markdown files on disk.
2. You tell it to open a file or folder in Roughdraft.
3. Roughdraft opens locally on your machine.
4. You read, edit, leave comments, and suggest changes.
5. You tell the AI you are done, and it can respond to your comments or revise the document.

## Local development

```bash
./scripts/setup.sh
./scripts/run.sh
```

`./scripts/setup.sh` installs workspace dependencies and builds the app and server. `./scripts/run.sh` serves the built app at `http://roughdraft.localhost:3000`.

The two scripts coordinate through a lock file, so it's safe to start `./scripts/run.sh` while `./scripts/setup.sh` is still in progress. `run` will wait for setup to finish, or trigger setup itself if nothing has been built yet.

If you prefer package scripts, the same commands are available as `pnpm setup` and `pnpm start`.

Quality checks:

```bash
pnpm lint
pnpm test
pnpm check
```

`pnpm check` is the same command the pull request workflow runs before merge.

## What's in the folder

```
my-essay/
  roughdraft.json       # Canvas layout and metadata
  draft-1.md            # A normal markdown file on disk
  draft-1-alt.md        # A variation you are exploring
  draft-2.md            # Another page you can open directly or on the canvas
```

Every page is a regular markdown file. Roughdraft reads and writes those files directly.

## Agent skill

Roughdraft includes a skill for Claude Code that lets your agent:

- Open a local markdown file or folder in Roughdraft
- Read and edit pages on your canvas
- Add inline comments and suggested changes
- Respond to user review feedback in the document
- Fork a page and rewrite it with a different approach
- Rearrange the canvas layout when exploring multiple versions

```bash
# The guidance block is installed when you run `npx --yes roughdraft install`
claude code --skill roughdraft
```

## CriticMarkup

Roughdraft uses [CriticMarkup](https://criticmarkup.com) for inline annotations and revision workflows:

```markdown
This is {--deleted--} text.
This is {++inserted++} text.
This is {~~old~>new~~} substituted text.
This is {>>a comment<<} in the margin.
This is {==highlighted==} text.
```

This matters because the main workflow is often:

- The AI writes a doc
- The user opens it in Roughdraft
- The user leaves comments and suggested changes
- The AI reads those comments and responds in the same markdown file
- The user and AI use the canvas when they want to branch or compare alternatives

## Try the demo

Don't want to install anything? Try the [live demo](https://roughdraft.page) — it runs entirely in your browser using local storage.

## License

MIT

---

Built by [Nathan Baschez](https://twitter.com/nbashaw)
