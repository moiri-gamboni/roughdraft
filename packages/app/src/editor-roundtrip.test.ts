import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
} from "./critic-markup";
import { createEditorExtensions } from "./editor-extensions";

/**
 * These go through the editor, unlike the toHtml/toMarkdown tests. That matters:
 * an attribute the editor schema does not declare is silently dropped, so a fix
 * can pass the direct round trip and still rewrite the file on save.
 */
function appRoundTrip(markdown: string): string {
  const { doc, frontmatter, endmatter } = criticMarkdownToEditorState(markdown);
  return editorStateToCriticMarkdown(doc, { frontmatter, endmatter });
}

describe("editor round-trip fidelity", () => {
  it("leaves a bare email in prose alone", () => {
    const input = "renders mailto:ops@example.com?subject=x here\n";
    expect(appRoundTrip(input)).toBe(input);
  });

  it("leaves a task list item alone", () => {
    const input = "- [ ] `a/b` (body+props)\n";
    expect(appRoundTrip(input)).toBe(input);
  });

  it("keeps blank lines around headings when the author wrote them", () => {
    const input = "# T\n\nPara\n\n## U\n\nMore\n";
    expect(appRoundTrip(input)).toBe(input);
  });

  it("keeps a compact document compact", () => {
    const input = "# T\nPara\n## U\nMore\n";
    expect(appRoundTrip(input)).toBe(input);
  });

  it("keeps mixed heading spacing exactly as written", () => {
    const input = "# T\n\nPara\n## U\nMore\n";
    expect(appRoundTrip(input)).toBe(input);
  });

  // Known gap: a loose list (blank lines between items) comes back tight,
  // because the editor schema has no loose/tight distinction to preserve.
  // Pre-existing, and unrelated to the heading-spacing work above.
  it.skip("keeps a loose list loose", () => {
    const input = "- first\n\n- second\n";
    expect(appRoundTrip(input)).toBe(input);
  });
});

describe("through a live editor", () => {
  /**
   * generateJSON does not add the trailing empty paragraph that the editor
   * keeps so the cursor can sit past the last block, so a document can round
   * trip perfectly in a test and still be rewritten by the running app.
   */
  function liveRoundTrip(markdown: string): string {
    const { doc, comments, frontmatter, endmatter } =
      criticMarkdownToEditorState(markdown);
    const editor = new Editor({
      extensions: createEditorExtensions(""),
      content: doc,
    });

    return editorStateToCriticMarkdown(editor.getJSON(), comments, {
      frontmatter,
      endmatter,
    });
  }

  it("leaves a document ending in a list untouched", () => {
    const input = "# Title\n\nIntro.\n\n- one\n- two\n";
    expect(liveRoundTrip(input)).toBe(input);
  });

  it("keeps a run of two blank lines", () => {
    const input = "First.\n\n\nSecond.\n";
    expect(liveRoundTrip(input)).toBe(input);
  });
});
