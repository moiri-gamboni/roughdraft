---
title: Fuzz The Edit-Save-Reparse Cycle To Find Serializer Data Loss
date: 2026-08-21
category: serializer-bugs
module: Roughdraft critic-markup serializer
problem_type: data_loss
component: app
symptoms:
  - "Raw ** or _ appearing in the rendered document after an edit and save"
  - "Text next to a suggestion vanishing after commenting a range that overlaps it"
  - "YAML endmatter rendered as document text after deleting a comment with an endmatter reply"
  - "Typed *, `, [ or _ turning into live markup after reload"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [fuzzing, round-trip, turndown, criticmarkup, escaping, endmatter]
---

# Fuzz The Edit-Save-Reparse Cycle To Find Serializer Data Loss

## Problem

Individual round-trip tests kept passing while users still hit save-cycle corruption: the space of (document shape × edit operation × position) is too large to enumerate by hand, and the failing combinations were always interactions (a comment overlapping a suggestion, a deletion landing next to punctuation inside bold).

## Solution

`packages/app/src/editor-fuzz.test.ts` runs seeded random edit sequences through the real editor and serializer and asserts cycle invariants instead of specific outputs: visible text survives save→reparse, anchored comments and suggestions survive, nothing throws. 120 cases run in-suite; `FUZZ_CASES=5000` for a deep pass. Four bug classes fell out on the first runs:

1. Emphasis delimiters glued to a word (`**tiers:**the`) are not valid CommonMark; the serializer now moves edge punctuation outside the delimiters, and em uses `*` instead of the never-intraword `_`.
2. A comment anchor that contains a suggestion plus surrounding text serialized only the suggestion, silently dropping the text. The comment-on-suggestion path now applies only when the change spans the whole anchor.
3. One orphaned `re:` entry made the endmatter recognizer reject the entire block, dumping the YAML into the document body. Entries with body+by+at now count as review endmatter regardless of `re:`.
4. `service.escape` was identity, so typed `*` `_` ` ` ` `[` `]` `~` became live markup on reload. It now backslash-escapes exactly those inline delimiters (never backslashes or line-start syntax, which is what the identity escape was protecting against).

A 5000-case deep run surfaced two more:

5. marked's `blockSkip` masks `<...>` spans out of emphasis pairing, and the `<` of one comment's `<<}` plus the `>` of the next comment's `{>>` read as one giant "tag" — every `**`/`*` between two comments came back literal. Patched the shared rule to require a tag-shaped `<` (letter, `/`, `!`, `?`); revisit on marked upgrades, a regression test in `editor-roundtrip.test.ts` guards it.
6. A comment anchor spanning several distinct suggestions serialized only the first. The comment-on-suggestion path now also requires a single change id.

A serializer-level gap remains documented in `createTurndownService`: a review mark anchored on pure whitespace cannot survive save (turndown replaces "blank" nodes before rules run, and ProseMirror drops a whitespace-only mark span on reparse). Instead of threading sentinel text through serializer, parser and editor, the app never creates that state: `review-selection.ts` collapses a whitespace-only comment selection to a point comment and refuses a whitespace-only suggested deletion, the same way an empty selection is refused. PageCard's handlers and the fuzz ops share those resolvers, so the fuzz asserts the full policy with no exemptions.

## Key Insight

Assert what must be true of every save cycle, not what one save should produce. Invariant checks plus a seeded PRNG give reproducible counterexamples (`case N` always runs the same ops); each new class gets pinned as a named regression test in `editor-roundtrip.test.ts` afterwards.
