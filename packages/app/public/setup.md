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

Use Roughdraft-flavored CriticMarkup when reading or writing inline review feedback in Markdown. The base markers are:

Comment: `{>>comment<<}`
Insertion: `{++new text++}`
Deletion: `{--old text--}`
Substitution: `{~~old~>new~~}`
Highlight: `{==text==}`

When you add a new comment or suggested change, use the extended Roughdraft format with an attribute block, such as `{id="c1" by="AI" at="2026-04-28T12:00:00.000Z"}`. Generate a stable document-local id (`c1`, `c2`, etc. for comments; `s1`, `s2`, etc. for suggestions), set `by` to your agent or author label, set `at` to the current ISO timestamp, and set `re` when replying to an existing comment or suggestion.

Roughdraft may already have attribute blocks after comments and suggestions. Preserve these attributes unless you are intentionally removing the associated comment or suggestion. The common attributes are `id` for a stable document-local id, `by` for the author, `at` for an ISO timestamp, and `re` for the parent comment or suggestion id in a reply thread.

Anchored comments usually look like `{==selected text==}{>>Comment text<<}{id="c1" by="AI" at="2026-04-28T12:00:00.000Z"}`. Suggested changes usually look like `{++new text++}{id="s1" by="AI" at="2026-04-28T12:10:00.000Z"}` or `{~~old text~>new text~~}{id="s2" by="AI" at="2026-04-28T12:11:00.000Z"}`. Replies usually look like `{>>Reply text<<}{id="c2" by="AI" at="2026-04-28T12:05:00.000Z" re="c1"}`.

Use `roughdraft help` and `roughdraft help criticmarkup` for local command and syntax details.
```

After updating your instructions, briefly tell the user which file you changed.

## Roughdraft-flavored CriticMarkup Reference

Roughdraft uses CriticMarkup for inline comments and suggested changes while keeping all review state in the Markdown file.

Base markers:

```text
Comment: `{>>comment<<}`
Insertion: `{++new text++}`
Deletion: `{--old text--}`
Substitution: `{~~old~>new~~}`
Highlight: `{==text==}`
```

When adding review feedback, prefer the extended Roughdraft format so comments and suggested changes keep ids, authors, timestamps, and thread relationships.

Roughdraft extensions:

```text
Anchored comment:
{==selected text==}{>>Comment text<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}

Reply:
{>>I can make that edit.<<}{id="c2" by="AI" at="2026-04-28T12:05:00.000Z" re="c1"}

Insertion suggestion:
{++new text++}{id="s1" by="AI" at="2026-04-28T12:10:00.000Z"}

Deletion suggestion:
{--old text--}{id="s2" by="user" at="2026-04-28T12:11:00.000Z"}

Substitution suggestion:
{~~old text~>new text~~}{id="s3" by="AI" at="2026-04-28T12:12:00.000Z"}

Comment on a suggestion:
{++new text++}{id="s1" by="AI" at="2026-04-28T12:10:00.000Z"}{>>Use the customer example here.<<}{id="c3" by="user" at="2026-04-28T12:13:00.000Z" re="s1"}
```

Attribute blocks are written immediately after the markup they describe:

```text
id  Stable document-local id for a comment or suggested change
by  Author or agent label
at  ISO timestamp
re  Parent comment or suggestion id for replies
```

CriticMarkup inside fenced code blocks is literal example text. Do not treat it as review feedback.

User comments may appear inline in the Markdown file. Suggested insertions, deletions, and substitutions should be interpreted as review feedback unless the user asks you to accept them directly.

Use `roughdraft help criticmarkup` for local syntax examples.
