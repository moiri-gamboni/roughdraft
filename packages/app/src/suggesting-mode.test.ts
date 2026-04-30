import { Editor } from "@tiptap/core";
import type { Mark as ProseMirrorMark } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { createCriticChange } from "./critic-markup";
import { createEditorExtensions } from "./editor-extensions";

/**
 * Helper: build a tiptap Editor in JSDOM with the standard Roughdraft
 * extensions. Returns the editor after `onCreate` has fired.
 */
function createTestEditor(html?: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);

  return new Editor({
    element,
    extensions: createEditorExtensions(""),
    content: html,
  });
}

/**
 * Helper: simulate one character of text input in suggesting mode.
 *
 * Mirrors the `handleTextInput` logic in PageCard.tsx — when the cursor
 * is a collapsed caret the character is wrapped in an addition mark that
 * reuses an adjacent addition/substitution-new mark when possible.
 */
function suggestingTypeChar(editor: Editor, char: string) {
  const { state } = editor.view;
  const from = state.selection.from;
  const to = state.selection.to;
  const tr = state.tr;
  const markType = state.schema.marks.criticChange;

  const isReusable = (m: ProseMirrorMark) =>
    m.type === markType &&
    (m.attrs.kind === "addition" || m.attrs.kind === "substitution-new");

  const $pos = state.doc.resolve(from);
  const reusableMark =
    $pos.nodeBefore?.marks.find(isReusable) ??
    $pos.nodeAfter?.marks.find(isReusable) ??
    null;

  if (from !== to) {
    throw new Error("suggestingTypeChar does not support range selections");
  }

  const mark =
    reusableMark ??
    markType.create(
      createCriticChange("addition", undefined, {
        existingChanges: [],
      }),
    );

  tr.insert(from, state.schema.text(char, [mark]));
  tr.setSelection(TextSelection.create(tr.doc, from + char.length));
  editor.view.dispatch(tr);
}

/**
 * Helper: simulate a Backspace press in suggesting mode.
 *
 * Mirrors the *fixed* handleKeyDown logic from PageCard.tsx: if the
 * character being deleted carries an addition/substitution-new mark it
 * is truly removed; otherwise it is marked as a deletion.
 */
function suggestingBackspace(editor: Editor) {
  const { state } = editor.view;
  const { selection } = state;
  const criticMarkType = state.schema.marks.criticChange;
  let from = selection.from;
  const to = selection.to;

  if (selection.empty) {
    from = Math.max(1, selection.from - 1);
  }

  if (from === to) return;

  const isAdditionKind = (m: ProseMirrorMark) =>
    m.type === criticMarkType &&
    (m.attrs.kind === "addition" || m.attrs.kind === "substitution-new");

  type Segment = { from: number; to: number; isAddition: boolean };
  const segments: Segment[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const segFrom = Math.max(pos, from);
    const segTo = Math.min(pos + node.nodeSize, to);
    if (segFrom >= segTo) return;
    const isAdd = node.marks.some(isAdditionKind);
    const prev = segments[segments.length - 1];
    if (prev && prev.isAddition === isAdd && prev.to === segFrom) {
      prev.to = segTo;
    } else {
      segments.push({ from: segFrom, to: segTo, isAddition: isAdd });
    }
  });

  const tr = state.tr;

  for (const seg of [...segments].reverse()) {
    if (seg.isAddition) {
      tr.delete(seg.from, seg.to);
    } else {
      const isReusableDeletion = (m: ProseMirrorMark) =>
        m.type === criticMarkType && m.attrs.kind === "deletion";

      const deletionMark =
        state.doc
          .resolve(seg.from)
          .nodeBefore?.marks.find(isReusableDeletion) ??
        state.doc.resolve(seg.to).nodeAfter?.marks.find(isReusableDeletion) ??
        criticMarkType.create(
          createCriticChange("deletion", undefined, { existingChanges: [] }),
        );

      tr.addMark(seg.from, seg.to, deletionMark);
    }
  }

  const mappedPos = tr.mapping.map(from, -1);
  tr.setSelection(TextSelection.create(tr.doc, mappedPos));
  tr.scrollIntoView();
  editor.view.dispatch(tr);
}

describe("suggesting mode backspace inside an insertion", () => {
  it("should delete the last character of a suggested insertion rather than marking it as a deletion", () => {
    const editor = createTestEditor("<p>Hello world</p>");

    // Place cursor at end of "Hello" (position 6 in ProseMirror)
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)),
    );

    // Type " there" in suggesting mode → creates an addition mark
    for (const char of " there") {
      suggestingTypeChar(editor, char);
    }

    // Verify the addition mark exists
    let hasAdditionMark = false;
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (
          mark.type.name === "criticChange" &&
          mark.attrs.kind === "addition"
        ) {
          hasAdditionMark = true;
        }
      }
    });
    expect(hasAdditionMark).toBe(true);

    // The full text should now be "Hello there world"
    expect(editor.state.doc.textContent).toBe("Hello there world");

    // Now press Backspace — this should delete "e" from the addition,
    // leaving "Hello ther world" with "addition" mark on " ther"
    suggestingBackspace(editor);

    // Correct behaviour: "e" is simply removed because it was part of the
    // user's own suggested insertion — it was never committed content.
    expect(editor.state.doc.textContent).toBe("Hello ther world");

    // No deletion mark should exist
    let hasDeletionMark = false;
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (
          mark.type.name === "criticChange" &&
          mark.attrs.kind === "deletion"
        ) {
          hasDeletionMark = true;
        }
      }
    });
    expect(hasDeletionMark).toBe(false);

    editor.destroy();
  });

  it("should still mark original text as a deletion when backspacing", () => {
    const editor = createTestEditor("<p>Hello world</p>");

    // Place cursor after "Hello " (position 7)
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7)),
    );

    // Backspace on original text → should create a deletion mark
    suggestingBackspace(editor);

    // The text content stays the same (deletion marks don't remove text)
    expect(editor.state.doc.textContent).toBe("Hello world");

    // There should be a deletion mark on the space character
    let hasDeletionMark = false;
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (
          mark.type.name === "criticChange" &&
          mark.attrs.kind === "deletion"
        ) {
          hasDeletionMark = true;
        }
      }
    });
    expect(hasDeletionMark).toBe(true);

    editor.destroy();
  });

  it("should fully remove a suggested insertion when all characters are backspaced", () => {
    const editor = createTestEditor("<p>Hello world</p>");

    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)),
    );

    // Type "X" in suggesting mode
    suggestingTypeChar(editor, "X");
    expect(editor.state.doc.textContent).toBe("HelloX world");

    // Backspace "X" — should completely remove it
    suggestingBackspace(editor);
    expect(editor.state.doc.textContent).toBe("Hello world");

    // No critic marks should remain
    let hasCriticMark = false;
    editor.state.doc.descendants((node) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (mark.type.name === "criticChange") {
          hasCriticMark = true;
        }
      }
    });
    expect(hasCriticMark).toBe(false);

    editor.destroy();
  });
});
