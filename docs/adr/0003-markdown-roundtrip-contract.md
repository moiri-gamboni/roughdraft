# 0003: Markdown Round-Trip Contract

## Context

Roughdraft renders Markdown through rich text and code editing surfaces. Accidental rewrites make reviews noisy and can damage documents.

## Decision

Roughdraft should preserve user-authored Markdown unless an edit requires a minimal, understandable serialization change. Frontmatter, local links, image paths, tables, task lists, code fences, inline code, raw supported HTML blocks, and CriticMarkup need explicit tests.

## Consequences

Round-trip tests are part of the product contract. New Markdown support should add fixture coverage before broad parser refactors.

## What This Explicitly Does Not Mean

Roughdraft does not promise to preserve every byte of unsupported Markdown syntax, and it should not normalize documents just to make implementation easier.
