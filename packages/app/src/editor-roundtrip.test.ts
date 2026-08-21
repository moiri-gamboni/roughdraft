import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  createCriticComment,
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

describe("emphasis stays emphasis after edits", () => {
  function editRoundTrip(
    markdown: string,
    edit: (editor: Editor) => void,
  ): { saved: string; reparsedText: string } {
    const { doc, comments, frontmatter, endmatter } =
      criticMarkdownToEditorState(markdown);
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: doc,
    });
    edit(editor);
    const saved = editorStateToCriticMarkdown(editor.getJSON(), comments, {
      frontmatter,
      endmatter,
    });
    editor.destroy();

    const reparsed = new Editor({
      extensions: createEditorExtensions(),
      content: criticMarkdownToEditorState(saved).doc,
    });
    const reparsedText = reparsed.getText();
    reparsed.destroy();
    return { saved, reparsedText };
  }

  it("moves trailing punctuation out of bold glued to a word", () => {
    // Deleting the space after the bold run: `**Both tiers:**the` cannot
    // close, CommonMark shows the asterisks literally.
    const { saved, reparsedText } = editRoundTrip(
      "**Both tiers:** the field\n",
      (editor) => editor.commands.deleteRange({ from: 12, to: 13 }),
    );

    expect(saved).toBe("**Both tiers**:the field\n");
    expect(reparsedText).toBe("Both tiers:the field");
  });

  it("moves leading punctuation out of bold glued to a word", () => {
    const { saved, reparsedText } = editRoundTrip(
      "the **:bold** here\n",
      (editor) => editor.commands.deleteRange({ from: 4, to: 5 }),
    );

    expect(saved).toBe("the:**bold** here\n");
    expect(reparsedText).toBe("the:bold here");
  });

  it("keeps intraword emphasis readable", () => {
    const { saved, reparsedText } = editRoundTrip(
      "see *em text* here\n",
      (editor) => editor.commands.deleteRange({ from: 4, to: 5 }),
    );

    expect(saved).toBe("see*em text* here\n");
    expect(reparsedText).toBe("seeem text here");
  });

  it("leaves ordinary emphasis alone", () => {
    const { saved } = editRoundTrip("the **bold text** here\n", (editor) =>
      editor.commands.deleteRange({ from: 5, to: 10 }),
    );

    expect(saved).toBe("the **text** here\n");
  });
});

// Regression pins from editor-fuzz.test.ts findings (2026-08-21).
describe("fuzz-found round-trip bugs", () => {
  function roundTrip(markdown: string, edit: (editor: Editor) => void) {
    const { doc, comments, frontmatter, endmatter } =
      criticMarkdownToEditorState(markdown);
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: doc,
    });
    edit(editor);
    const saved = editorStateToCriticMarkdown(editor.getJSON(), comments, {
      frontmatter,
      endmatter,
    });
    editor.destroy();
    return { saved, reparsed: criticMarkdownToEditorState(saved) };
  }

  it("keeps text around a suggestion when a comment overlaps it", () => {
    // The comment anchor contains the deletion suggestion plus plain text;
    // serializing only the suggestion dropped "ep " from the file.
    const markdown =
      'keep {--removed--}{#s1} word\n\n---\nsuggestions:\n  s1:\n    by: user\n    at: "2026-01-01T00:00:00.000Z"\n';
    const { saved, reparsed } = roundTrip(markdown, (editor) => {
      const comment = createCriticComment({ content: "note" }, {});
      editor.commands.setTextSelection({ from: 3, to: 13 });
      editor.commands.setCommentRef({ commentIds: [comment.id] });
    });

    expect(saved).toContain("ep ");
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: reparsed.doc,
    });
    expect(editor.getText()).toBe("keep removed word");
    editor.destroy();
  });

  it("keeps an endmatter reply orphaned by deleting its root", () => {
    // Rejecting the whole endmatter over the dangling `re:` dumped the YAML
    // into the document body as text.
    const markdown =
      'plain {==anchored==}{>>root<<}{#c1} text\n\n---\ncomments:\n  c1:\n    by: user\n    at: "2026-01-01T00:00:00.000Z"\n  c2:\n    body: reply\n    by: AI\n    at: "2026-01-01T00:01:00.000Z"\n    re: c1\n';
    const { saved, reparsed } = roundTrip(markdown, (editor) => {
      editor.chain().removeCommentId("c1").run();
    });

    expect(saved).toContain("re: c1");
    expect(reparsed.endmatter).not.toBeNull();
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: reparsed.doc,
    });
    expect(editor.getText()).toBe("plain anchored text");
    editor.destroy();
  });

  it("keeps emphasis between two comment anchors parsed", () => {
    // marked's blockSkip masked everything from one comment's `<<}` to the
    // next comment's `{>>` as a bogus <tag>, so emphasis between two
    // comments came back as literal asterisks (patched in markdown.ts).
    const markdown =
      'a {==x==}{>>n<<}{#c1}**bold** and *em* {==y==}{>>n<<}{#c2} b\n\n---\ncomments:\n  c1:\n    by: user\n    at: "2026-01-01T00:00:00.000Z"\n  c2:\n    by: user\n    at: "2026-01-01T00:00:00.000Z"\n';
    const { saved, reparsedText } = (() => {
      const { doc, comments, frontmatter, endmatter } =
        criticMarkdownToEditorState(markdown);
      const editor = new Editor({
        extensions: createEditorExtensions(),
        content: doc,
      });
      const reparsedText = editor.getText();
      const saved = editorStateToCriticMarkdown(editor.getJSON(), comments, {
        frontmatter,
        endmatter,
      });
      editor.destroy();
      return { saved, reparsedText };
    })();

    expect(reparsedText).toBe("a xbold and em y b");
    expect(saved).toBe(markdown);
  });

  it("escapes typed markdown delimiters so text stays text", () => {
    const { saved, reparsed } = roundTrip("plain *em words* here\n", (editor) =>
      editor.commands.insertContentAt(9, { type: "text", text: "a*b `c`" }),
    );

    expect(saved).toBe("plain *ema\\*b \\`c\\` words* here\n");
    const editor = new Editor({
      extensions: createEditorExtensions(),
      content: reparsed.doc,
    });
    expect(editor.getText()).toBe("plain ema*b `c` words here");
    editor.destroy();
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
