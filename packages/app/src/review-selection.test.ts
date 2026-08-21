import { Editor } from "@tiptap/core";
import { afterAll, describe, expect, it } from "vitest";
import { criticMarkdownToEditorState } from "./critic-markup";
import { createEditorExtensions } from "./editor-extensions";
import { canSuggestDeletion, resolveCommentAnchor } from "./review-selection";

const editor = new Editor({
  extensions: createEditorExtensions(),
  content: { type: "doc" },
});
afterAll(() => editor.destroy());

function load(markdown: string) {
  editor.commands.setContent(criticMarkdownToEditorState(markdown).doc, {
    emitUpdate: false,
  });
}

describe("resolveCommentAnchor", () => {
  it("keeps a text selection as a range anchor", () => {
    load("the field\n");
    editor.commands.setTextSelection({ from: 1, to: 4 });
    expect(resolveCommentAnchor(editor.state)).toEqual({
      kind: "range",
      from: 1,
      to: 4,
    });
  });

  it("collapses a whitespace-only selection to a point comment", () => {
    load("the field\n");
    editor.commands.setTextSelection({ from: 4, to: 5 });
    expect(resolveCommentAnchor(editor.state)).toEqual({
      kind: "point",
      at: 4,
    });
  });
});

describe("canSuggestDeletion", () => {
  it("allows a selection with visible text", () => {
    load("the field\n");
    expect(canSuggestDeletion(editor.state, 5, 10)).toBe(true);
  });

  it("refuses a whitespace-only selection", () => {
    load("the field\n");
    expect(canSuggestDeletion(editor.state, 4, 5)).toBe(false);
  });

  it("refuses an empty selection", () => {
    load("the field\n");
    expect(canSuggestDeletion(editor.state, 5, 5)).toBe(false);
  });
});
