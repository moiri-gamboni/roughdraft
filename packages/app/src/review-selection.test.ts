import { Editor } from "@tiptap/core";
import { afterAll, describe, expect, it } from "vitest";
import { criticMarkdownToEditorState } from "./critic-markup";
import { createEditorExtensions } from "./editor-extensions";
import {
  resolveCommentAnchor,
  resolveSuggestedDeletion,
} from "./review-selection";

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

describe("resolveSuggestedDeletion", () => {
  it("keeps a solid selection as a plain deletion", () => {
    load("the field\n");
    expect(resolveSuggestedDeletion(editor.state, 5, 10)).toEqual({
      kind: "deletion",
      from: 5,
      to: 10,
    });
  });

  it("turns a deleted space into a substitution absorbing its neighbors", () => {
    load("the field\n");
    expect(resolveSuggestedDeletion(editor.state, 4, 5)).toEqual({
      kind: "substitution",
      from: 3,
      to: 6,
      replacement: "ef",
    });
  });

  it("keeps unselected whitespace of the run in the replacement", () => {
    // Markdown collapses doubled spaces at parse, so type the second one.
    load("a b\n");
    editor.commands.insertContentAt(2, { type: "text", text: " " });
    // Select only the second space of the doubled run.
    expect(resolveSuggestedDeletion(editor.state, 3, 4)).toEqual({
      kind: "substitution",
      from: 1,
      to: 5,
      replacement: "a b",
    });
  });

  it("refuses at a paragraph edge", () => {
    load("ab \n\ncd\n");
    // Trailing space of the first paragraph has no right neighbor.
    expect(resolveSuggestedDeletion(editor.state, 3, 4)).toBeNull();
  });
});
