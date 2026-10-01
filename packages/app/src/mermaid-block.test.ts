import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import {
  type CriticChangeKind,
  createEditorExtensions,
  UNANCHORED_COMMENT_SENTINEL,
} from "./editor-extensions";
import { diagramSource } from "./mermaid-block";

const schema = getSchema(createEditorExtensions(""));

function change(text: string, kind: CriticChangeKind) {
  return schema.text(text, [
    schema.marks.criticChange.create({
      kind,
      changeId: "s1",
      createdAt: "2026-10-01T12:00:00.000Z",
    }),
  ]);
}

function mermaidBlock(...content: ReturnType<typeof schema.text>[]) {
  return schema.nodes.codeBlock.create({ language: "mermaid" }, content);
}

describe("diagramSource", () => {
  it("draws the document as it would read with pending suggestions accepted", () => {
    const block = mermaidBlock(
      schema.text("flowchart TD\n    A --> "),
      change("Bee", "substitution-old"),
      change("Cat", "substitution-new"),
      change(" --> Dog", "deletion"),
      change(" --> Eel", "addition"),
    );

    expect(diagramSource(block)).toBe("flowchart TD\n    A --> Cat --> Eel");
  });

  it("leaves out the invisible characters that carry point comments", () => {
    const block = mermaidBlock(
      schema.text("flowchart TD\n    A"),
      schema.text(UNANCHORED_COMMENT_SENTINEL, [
        schema.marks.commentRef.create({ commentIds: ["c1"] }),
      ]),
      schema.text(" --> B"),
    );

    expect(diagramSource(block)).toBe("flowchart TD\n    A --> B");
  });
});
