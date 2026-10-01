---
title: A Reviewed Code Block Must Not Be Converted Twice
date: 2026-10-01
category: serializer-bugs
module: Roughdraft critic-markup serializer
problem_type: data_loss
component: app
symptoms:
  - "A fenced code block with a comment or suggestion in it saved as a single line"
  - "Indentation inside such a block gone after save"
  - "`*` and `_` inside such a block saved as `\\*` and `\\_`"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [turndown, code-block, criticmarkup, whitespace, escaping, round-trip]
---

# A Reviewed Code Block Must Not Be Converted Twice

## Problem

Saving a document whose fenced code block carried a comment anchor or a pending suggestion rewrote the block: every newline and the indentation collapsed to single spaces, and Markdown punctuation in the code came back backslash-escaped. `function f() {\n    {==return==}{>>note<<}{#c1} a * b_c;\n}` saved as `function f() { {==return==}{>>note<<}{#c1} a \* b\_c; }`. Blocks without review marks were unaffected, because only a marked block takes the custom `criticCodeBlock` Turndown rule. Mermaid diagrams made this visible: their source is line-sensitive and invites comments.

## Root cause

The rule's `replacement` ignored the `content` Turndown passed it and ran `service.turndown(codeElement.innerHTML)` instead. That second conversion sees the `<code>` element's inner markup with no `<pre>` around it, so Turndown's `collapseWhitespace` treats it as ordinary flow text, and with no `<code>` ancestor its text nodes go through `escape()`.

## Solution

Use the `content` argument (`packages/app/src/critic-markup/index.ts`, `addCriticCodeBlockRule`). In the outer pass Turndown already keeps whitespace inside `<pre>` (its default `isPre`), leaves text under `<code>` unescaped (`node.isCode`), and has applied the comment and suggestion rules to the spans inside, so `content` is the block body exactly as it should be written. The `<code>` element directly inside `<pre>` falls through Turndown's inline-code rule (it excludes a sole child of `<pre>`), so no backticks are added.

Regression coverage: `code block review round-trip fidelity` in `editor-roundtrip.test.ts` (comment and suggestion, with `*`/`_` in the code), and the commented-fence save in `e2e/mermaid-diagrams.spec.ts`.

## Still open

A suggestion inside a fence saves correctly but is not parsed back as a suggestion on reopen: `renderCriticCodeText` only recognizes comment anchors inside code, so the suggestion returns as literal text. Recognizing more inside fences collides with fences that show CriticMarkup as examples, which must stay literal (`markdown-roundtrip.spec.ts`).
