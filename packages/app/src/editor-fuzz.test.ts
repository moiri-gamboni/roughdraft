import { Editor, type JSONContent } from "@tiptap/core";
import { afterAll, describe, expect, it } from "vitest";
import {
  type CriticComment,
  createCriticChange,
  createCriticComment,
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
} from "./critic-markup";
import { createEditorExtensions } from "./editor-extensions";
import {
  resolveCommentAnchor,
  resolveSuggestedDeletion,
} from "./review-selection";

/**
 * Seeded fuzz over the edit -> save -> reparse cycle. Each case applies a
 * short random op sequence (delete, type, comment, suggest, resolve) to a
 * corpus document through the real editor, saves through the real serializer,
 * reparses, and checks invariants that hold for every user action:
 *
 * - the visible text survives the round trip (a literal `**` or `{==` leaking
 *   into it shows up as a diff),
 * - every comment still anchored in the edited doc parses back out,
 * - every suggestion still marked in the edited doc parses back out,
 * - nothing throws.
 *
 * Deterministic: case N always runs the same ops (mulberry32, seed = case
 * index), so a failure reproduces by index and the printed repro alone.
 * FUZZ_CASES scales the run (default 120, CI-friendly); a deep run is
 * `FUZZ_CASES=5000 pnpm vitest run src/editor-fuzz.test.ts`.
 */

const CASE_COUNT = Number(process.env.FUZZ_CASES ?? 120);

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CORPUS = [
  "the **bold text** and *em words* here\n",
  "# Title\n\nA paragraph with `code`, a [link](https://example.com/), and ~~gone~~ text.\n\nSecond paragraph **ends bold.**\n",
  "- first item with **bold**\n- second item\n- third *item*\n",
  "> quoted **statement:** with punctuation\n\nAfter the quote.\n",
  'plain {==anchored==}{>>existing note<<}{#c1} text\n\n---\ncomments:\n  c1:\n    by: user\n    at: "2026-01-01T00:00:00.000Z"\n  c2:\n    body: endmatter reply\n    by: AI\n    at: "2026-01-01T00:01:00.000Z"\n    re: c1\n',
  "keep {--removed--} and {++added++} suggestions\n",
  "| a | b |\n| --- | --- |\n| **one** | two |\n",
  "Both tiers together: **317 entering the field (6.7%)** and more.\n",
];

// Typed text includes markdown-significant characters on purpose: whatever
// the user types must come back as the same text, escaped however needed.
const WORDS = ["zap ", "x: ", " :y", "a*b", "_c_", "`d`", "50%*", "e~~f", "no"];

const SENTINELS = /⁠/g;

function normalizeText(text: string): string {
  return text.replace(SENTINELS, "").replace(/\s+/g, " ").trim();
}

function collectMarkIds(
  node: JSONContent,
  markName: string,
  attribute: "commentIds" | "changeId",
  into: Set<string>,
): Set<string> {
  for (const mark of node.marks ?? []) {
    if (mark.type !== markName) continue;
    const value = (mark.attrs as Record<string, unknown> | undefined)?.[
      attribute
    ];
    if (typeof value === "string") into.add(value);
    if (Array.isArray(value))
      for (const id of value) if (typeof id === "string") into.add(id);
  }
  for (const child of node.content ?? []) {
    collectMarkIds(child, markName, attribute, into);
  }
  return into;
}

interface FuzzContext {
  editor: Editor;
  comments: Map<string, CriticComment>;
  random: () => number;
}

type FuzzOp = (context: FuzzContext) => string | null;

function randomRange(context: FuzzContext, maxLength: number) {
  const size = context.editor.state.doc.content.size;
  const from = 1 + Math.floor(context.random() * Math.max(1, size - 2));
  const to = Math.min(
    size - 1,
    from + 1 + Math.floor(context.random() * maxLength),
  );
  return to > from ? { from, to } : null;
}

const OPS: Record<string, FuzzOp> = {
  delete(context) {
    const range = randomRange(context, 8);
    if (!range) return null;
    context.editor.commands.deleteRange(range);
    return `delete(${range.from},${range.to})`;
  },
  type(context) {
    const word = WORDS[Math.floor(context.random() * WORDS.length)] ?? "no";
    const size = context.editor.state.doc.content.size;
    const at = 1 + Math.floor(context.random() * Math.max(1, size - 2));
    context.editor.commands.insertContentAt(at, { type: "text", text: word });
    return `type(${at},${JSON.stringify(word)})`;
  },
  comment(context) {
    // Mirrors PageCard's handleAddComment: a whitespace-only selection
    // becomes a point comment (a mark on pure whitespace cannot survive
    // serialization).
    const range = randomRange(context, 12);
    if (!range) return null;
    context.editor.commands.setTextSelection(range);
    const anchor = resolveCommentAnchor(context.editor.state);
    const comment = createCriticComment(
      { content: "note" },
      { existingComments: context.comments.values() },
    );
    if (anchor.kind === "point") {
      context.editor.commands.setTextSelection(anchor.at);
      if (
        !context.editor.commands.insertPointComment({
          commentIds: [comment.id],
        })
      )
        return null;
      context.comments.set(comment.id, comment);
      return `pointComment(${anchor.at})=${comment.id}`;
    }
    if (!context.editor.commands.setCommentRef({ commentIds: [comment.id] }))
      return null;
    context.comments.set(comment.id, comment);
    return `comment(${range.from},${range.to})=${comment.id}`;
  },
  deleteComment(context) {
    const ids = [...context.comments.keys()];
    const id = ids[Math.floor(context.random() * ids.length)];
    if (!id) return null;
    context.comments.delete(id);
    context.editor.chain().removeCommentId(id).run();
    return `deleteComment(${id})`;
  },
  suggestDelete(context) {
    // Mirrors PageCard's handleSuggestDeletion: a whitespace-only selection
    // becomes a substitution absorbing the neighbouring characters.
    const range = randomRange(context, 8);
    if (!range) return null;
    const resolution = resolveSuggestedDeletion(
      context.editor.state,
      range.from,
      range.to,
    );
    if (!resolution) return null;
    const existingChanges = [
      ...collectMarkIds(
        context.editor.getJSON(),
        "criticChange",
        "changeId",
        new Set<string>(),
      ),
    ].map((changeId) => ({ changeId }));
    if (resolution.kind === "deletion") {
      const change = createCriticChange("deletion", undefined, {
        existingChanges,
      });
      context.editor.commands.setTextSelection(range);
      if (!context.editor.commands.setCriticChange(change)) return null;
      return `suggestDelete(${range.from},${range.to})=${change.changeId}`;
    }
    const change = createCriticChange("substitution-old", undefined, {
      existingChanges,
    });
    const applied = context.editor
      .chain()
      .setTextSelection({ from: resolution.from, to: resolution.to })
      .setCriticChange(change)
      .insertContentAt(resolution.to, {
        type: "text",
        text: resolution.replacement,
        marks: [
          {
            type: "criticChange",
            attrs: { ...change, kind: "substitution-new" },
          },
        ],
      })
      .run();
    if (!applied) return null;
    return `substituteWhitespace(${resolution.from},${resolution.to})=${change.changeId}`;
  },
  resolveSuggestion(context) {
    const ids = [
      ...collectMarkIds(
        context.editor.getJSON(),
        "criticChange",
        "changeId",
        new Set<string>(),
      ),
    ];
    const id = ids[Math.floor(context.random() * ids.length)];
    if (!id) return null;
    const accept = context.random() < 0.5;
    const applied = accept
      ? context.editor.commands.acceptCriticChange(id)
      : context.editor.commands.rejectCriticChange(id);
    return applied ? `${accept ? "accept" : "reject"}(${id})` : null;
  },
};

const OP_NAMES = Object.keys(OPS);

describe("editor round-trip fuzz", () => {
  const extensions = createEditorExtensions();
  const editor = new Editor({ extensions, content: { type: "doc" } });
  const reparseEditor = new Editor({ extensions, content: { type: "doc" } });
  afterAll(() => {
    editor.destroy();
    reparseEditor.destroy();
  });

  // ~50ms/case; sized for a deep FUZZ_CASES run, not just the default 120.
  it(`holds invariants across ${CASE_COUNT} random edit sequences`, {
    timeout: 30_000 + CASE_COUNT * 300,
  }, () => {
    const failures: string[] = [];

    for (let caseIndex = 0; caseIndex < CASE_COUNT; caseIndex++) {
      const random = mulberry32(caseIndex);
      const markdown =
        CORPUS[Math.floor(random() * CORPUS.length)] ?? CORPUS[0]!;
      const { doc, comments, frontmatter, endmatter } =
        criticMarkdownToEditorState(markdown);
      editor.commands.setContent(doc, { emitUpdate: false });
      const context: FuzzContext = { editor, comments, random };

      const applied: string[] = [];
      const opCount = 1 + Math.floor(random() * 3);
      const fail = (problem: string, detail: string) => {
        failures.push(
          `case ${caseIndex} doc=${JSON.stringify(markdown)} ops=[${applied.join(" ")}]\n  ${problem}: ${detail}`,
        );
      };

      try {
        for (let step = 0; step < opCount; step++) {
          const name = OP_NAMES[Math.floor(random() * OP_NAMES.length)]!;
          const description = OPS[name]!(context);
          if (description) applied.push(description);
        }

        const editedJson = editor.getJSON();
        const editedText = normalizeText(editor.getText());
        const anchoredCommentIds = collectMarkIds(
          editedJson,
          "commentRef",
          "commentIds",
          new Set<string>(),
        );
        const anchoredChangeIds = collectMarkIds(
          editedJson,
          "criticChange",
          "changeId",
          new Set<string>(),
        );

        const saved = editorStateToCriticMarkdown(editedJson, comments, {
          frontmatter,
          endmatter,
        });
        const reparsed = criticMarkdownToEditorState(saved);
        reparseEditor.commands.setContent(reparsed.doc, { emitUpdate: false });
        const reparsedText = normalizeText(reparseEditor.getText());

        if (reparsedText !== editedText) {
          fail(
            "text changed across save/reparse",
            `edited=${JSON.stringify(editedText)} reparsed=${JSON.stringify(reparsedText)} saved=${JSON.stringify(saved)}`,
          );
        }

        for (const id of anchoredCommentIds) {
          if (!comments.has(id)) continue;
          if (!reparsed.comments.has(id)) {
            fail(
              "anchored comment lost",
              `${id} saved=${JSON.stringify(saved)}`,
            );
          }
        }

        const reparsedChangeIds = collectMarkIds(
          reparsed.doc,
          "criticChange",
          "changeId",
          new Set<string>(),
        );
        for (const id of anchoredChangeIds) {
          if (!reparsedChangeIds.has(id)) {
            fail("suggestion lost", `${id} saved=${JSON.stringify(saved)}`);
          }
        }
      } catch (error) {
        fail("threw", String(error));
      }
    }

    expect(failures.slice(0, 12), `${failures.length} failing cases`).toEqual(
      [],
    );
  });
});
