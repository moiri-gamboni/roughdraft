# Roughdraft Agent Setup

You are setting yourself up to use Roughdraft, a local Markdown review tool.

Roughdraft lets you open one Markdown file from disk in a local browser editor so the user can read, edit, comment, and suggest changes. It is currently a single-file Markdown viewer/editor.

## Check Installation

Check whether Roughdraft is available:

```bash
roughdraft help
```

If Roughdraft is missing and the user has asked you to install it, install it with:

```bash
npm i -g roughdraft
```

If the user did not explicitly ask you to install software, ask before installing a global npm package.

## Update Your Persistent Instructions

Add Roughdraft guidance to the appropriate persistent instruction file for this environment.

Prefer global or user-level persistent instructions, because Roughdraft is a cross-project workflow. Examples may include global Codex instructions, global Claude instructions, `CLAUDE.md`, `AGENTS.md`, Cursor rules, or another configured instruction file.

These are examples, not hard rules. Inspect the user's actual setup and conform to it. If you are unsure where your current version stores persistent instructions, use current official docs or web search before editing.

If global or user-level instructions are unavailable or unclear, fall back to a project-level instruction file and tell the user what you changed.

Add guidance like this:

```text
Use Roughdraft when the user wants to review or comment on a Markdown file.

The user may refer to Roughdraft as `rd` in natural language. Treat `rd` as shorthand for Roughdraft in user requests, but do not create or modify any shell alias, executable, symlink, or command named `rd`.

When the user asks for a plan, write the plan as a Markdown file on disk before asking them to review it.

When you write or modify a Markdown file and want the user to review or comment on it, open it with:

roughdraft open "/absolute/path/to/file.md"

Roughdraft is currently a single-file Markdown viewer/editor. Open one `.md` file at a time.

If Roughdraft is not running, `roughdraft open` will start it automatically.

After the user finishes reviewing in Roughdraft, read the Markdown file from disk and respond to any CriticMarkup comments or suggested changes.

Use CriticMarkup when reading or writing inline review feedback in Markdown.

Use `roughdraft help` and `roughdraft help criticmarkup` for local command and syntax details.
```

After updating your instructions, briefly tell the user which file you changed.

## CriticMarkup Reference

Roughdraft uses CriticMarkup for inline comments and suggested changes:

```text
Comment: `{>>comment<<}`
Insertion: `{++new text++}`
Deletion: `{--old text--}`
Substitution: `{~~old~>new~~}`
Highlight: `{==text==}`
```

CriticMarkup inside fenced code blocks is literal example text. Do not treat it as review feedback.

User comments may appear inline in the Markdown file. Suggested insertions, deletions, and substitutions should be interpreted as review feedback unless the user asks you to accept them directly.

Use `roughdraft help criticmarkup` for local syntax examples.
