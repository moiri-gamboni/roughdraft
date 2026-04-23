# Markdown Editing

## Purpose

Roughdraft pages are markdown documents first.

The editor exists to make markdown writing and review feel fast, direct, and reliable without turning the document into a proprietary format. A page should remain a normal markdown file on disk that can be edited in Roughdraft, in a text editor, or by local agents without loss of meaning.

## Core principles

- Markdown on disk is the source of truth for page content
- Editing should feel rich and direct, but the saved result must remain clean markdown
- The editor must preserve author intent over visual cleverness
- A page should be editable with mouse, keyboard, paste, and drag-and-drop alone
- The editor is single-player and local-first
- The editor should never require network connectivity to author or format a page
- Roughdraft should work well when the document is being passed back and forth between a user and a local AI agent

## Primary workflow

- A local AI agent creates or edits markdown files on disk
- The user opens a specific file or a folder in Roughdraft running locally
- The user reads the document in Roughdraft and leaves comments or suggested changes directly in markdown
- The user tells the AI they are done reviewing
- The AI reads the same markdown file, responds to comments, and revises the draft
- When the work branches into multiple alternatives, the user and AI can use the canvas to explore versions

## Editing model

- Every prose page opens in an editable rich text surface
- The editing surface represents the underlying markdown document, not a separate unpublished draft format
- Typing updates the page immediately in the editor and saves back to disk automatically with debouncing
- Re-opening a page shows the same document structure and formatting that was previously saved
- If a page changes on disk outside Roughdraft, the editor reloads it without corrupting user content
- The editor should avoid clobbering in-progress local edits when a file change is detected
- Empty pages show a lightweight placeholder until the user starts typing
- Opening a single markdown file directly should focus the experience on that file without requiring the rest of a canvas workflow

## Markdown fidelity

- Roughdraft must round-trip supported markdown constructs without unnecessary rewrites
- Re-saving an unchanged page should not introduce spurious escaping, duplicated backslashes, or formatting churn
- Supported markdown that Roughdraft does not render richly should still be preserved in the saved file
- Links, emphasis, inline code, fenced code blocks, headings, lists, block quotes, rules, and tables should remain valid markdown after editing
- Mixed plain-text and rich editing workflows should be safe: editing a page in Roughdraft and then in a text editor must not degrade the document
- The editor should preserve intentional escaping such as literal brackets, underscores, asterisks, and backticks
- CriticMarkup syntax should remain stable and readable on disk so agents and humans can both operate on it safely

## Supported block content

- Paragraphs
- Headings `#`, `##`, and `###`
- Bulleted lists
- Numbered lists
- Task lists with checkboxes
- Block quotes
- Fenced code blocks
- Horizontal rules
- Tables

## Supported inline content

- Bold
- Italic
- Inline code
- Links
- Images
- Page links
- CriticMarkup comments
- CriticMarkup insertions, deletions, substitutions, and highlights

## Review and CriticMarkup

- Comments and suggested changes are first-class parts of the editing workflow
- Roughdraft should preserve CriticMarkup on disk exactly enough that a human or agent can continue the review loop outside Roughdraft
- Users should be able to read and write comments like `{>>comment<<}` and suggestions like `{~~old~>new~~}` without the editor corrupting them
- The editor should make review-oriented markdown feel practical, not like an edge case
- AI-written comments and human-written comments should coexist cleanly in the same file
- A user should be able to finish a review pass in Roughdraft and hand the same file back to an agent without any export step

## Headings

- Heading levels 1 through 3 are first-class editor blocks
- Headings render with clear visual hierarchy inside the page card
- Saving the document writes headings back as ATX markdown headings
- Converting a block between paragraph and heading should not disturb surrounding content

## Lists

- Bullet lists can be created, continued, indented, outdented, and exited with normal editor keyboard behavior
- Numbered lists behave the same way and save as ordered markdown lists
- Nested lists are supported
- Pressing Enter on an empty list item exits the list
- Task lists support unchecked and checked items and save as `- [ ]` and `- [x]`
- Nested task items are supported
- Toggling a checkbox updates the document immediately and persists to markdown

## Code blocks

- Fenced code blocks are first-class blocks in the editor
- Code blocks preserve their raw text exactly, including indentation and blank lines
- Language tags on fenced code blocks should be preserved when present
- The editor must not apply normal prose formatting inside a code block

## Tables

- Markdown tables are editable as real tables in the editor
- Tables support header rows and body rows
- Cell content can contain normal inline formatting
- Adding or removing rows and columns should keep the table valid when saved back to markdown
- Column resizing is allowed as an editing affordance, but resizing must not leak non-markdown layout metadata into the document
- A valid markdown table on disk should reopen as a table, not flattened paragraphs

## Links and page links

- Standard markdown links are editable inline
- Clicking a link while editing should not unexpectedly navigate away from the current editing session
- The editor provides a quick way to insert links without requiring raw markdown syntax entry
- Roughdraft pages can be linked from other pages through page-link autocomplete
- Inserting a page link writes a stable markdown representation to disk
- Clicking a page link opens or focuses the referenced page on the canvas
- If a referenced page is renamed, Roughdraft should retain or repair the link in a way that preserves author intent

## Images and file attachments

- Dragging an image or file into a page inserts a markdown reference to a local asset managed by the project
- Pasting an image from the clipboard does the same
- Images render inline in the editor
- Non-image files render as links or attachment chips in the editor while saving as markdown links on disk
- Inserted asset paths should remain portable within the project folder
- Removing an image or attachment from the document removes only the markdown reference unless the user explicitly deletes the asset itself

## Paste behavior

- Pasting plain text inserts plain text
- Pasting markdown can preserve markdown structure instead of flattening everything into paragraphs
- Pasting rich content from other apps should prefer a clean markdown interpretation over verbose HTML residue
- Pasting a URL over selected text should create a link when that behavior is unambiguous
- Pasting into a code block inserts raw text, not formatted content

## Formatting controls

- Roughdraft provides lightweight formatting controls for common block changes
- Controls may appear as a compact toolbar, contextual menu, slash menu, or keyboard-driven command surface
- The editor should not require users to memorize raw markdown for common formatting operations
- Keyboard shortcuts for standard rich text actions should work where they map cleanly to markdown

## Keyboard behavior

- Arrow keys, selection, deletion, copy, cut, undo, and redo behave like a normal document editor
- Tab and Shift+Tab indent and outdent list items and table navigation where appropriate
- Enter creates expected continuation behavior for lists, tables, and block quotes
- Escape should dismiss transient editor UI such as autocomplete or menus without discarding document changes

## Autocomplete and insertions

- The editor can offer inline insertion flows for page links, headings, lists, code blocks, and tables
- Autocomplete results should be fast, keyboard-accessible, and dismissible
- Accepting an autocomplete suggestion inserts the final markdown-backed structure directly into the document

## Save behavior

- Document changes save automatically after a short debounce
- Save timing should make typing feel uninterrupted
- Roughdraft should expose when a save fails and should not silently discard edits
- The saved markdown file should be human-readable and suitable for version control diffs
- Saving should preserve the review state of the document so comments and suggestions remain actionable for later agent passes

## Local-first constraints

- All core editing behavior works offline
- The editor does not depend on realtime collaboration, remote cursors, or multi-user presence
- Any future annotations or review features must degrade cleanly to plain markdown or preserved local markup on disk
- Opening a file in Roughdraft should not require copying it into a special project format first

## Non-goals

- Realtime collaborative editing
- Cloud-only document state
- Locking content into a JSON-only editor format
- Hiding markdown from users or making markdown files optional
