# 0002: CriticMarkup As Review Format

## Context

Review feedback must remain portable in the Markdown file and readable outside the app.

## Decision

Roughdraft uses CriticMarkup for comments, highlights, insertions, deletions, substitutions, and threaded metadata. The app may render richer controls, but the saved representation is Markdown plus CriticMarkup.

## Consequences

Agents can leave review feedback without depending on Roughdraft-specific sidecar files. Parser and editor changes must preserve CriticMarkup predictably, including escaped metadata and literal examples in code spans or fenced code blocks.

## What This Explicitly Does Not Mean

CriticMarkup is not a hidden product database, chat transcript format, or replacement for normal Markdown content.
