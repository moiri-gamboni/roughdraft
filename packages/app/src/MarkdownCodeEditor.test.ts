import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import { createMarkdownCodeEditorExtensions } from "./MarkdownCodeEditor";

describe("createMarkdownCodeEditorExtensions", () => {
  it("loads YAML frontmatter and Markdown content without rewriting the document", () => {
    const input = "---\ntitle: Code mode\n---\n\n# Body\n";
    const onChange = vi.fn();
    const state = EditorState.create({
      doc: input,
      extensions: createMarkdownCodeEditorExtensions(false, onChange, {
        current: input,
      }),
    });

    expect(state.doc.toString()).toBe(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
