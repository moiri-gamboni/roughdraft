import { describe, expect, it } from "vitest";
import {
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
} from "../src/critic-markup";

describe("CriticMarkup comments", () => {
  it("round-trips a highlighted comment anchor", () => {
    const input =
      "This is {==highlighted==}{>>comment text<<}{@id:cmt1;by:AI;at:2024-01-15T10:30:00.000Z@} text.\n";

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(comments.get("cmt1")).toMatchObject({
      id: "cmt1",
      content: "comment text",
      authorType: "ai",
    });
    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("preserves formatting nested inside a comment anchor", () => {
    const input =
      "The {==**important**==}{>>Review this phrasing<<}{@id:cmt2;by:user@example.com;at:2024-01-15T10:31:00.000Z@} section stays bold.\n";

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("keeps the anchor attached when nearby text changes", () => {
    const input =
      "Before {==target==}{>>Check this<<}{@id:cmt3;by:AI;at:2024-01-15T10:32:00.000Z@} after.\n";
    const { doc, comments } = criticMarkdownToEditorState(input);
    const nextDoc = structuredClone(doc);
    const firstParagraph = nextDoc.content?.[0];
    const firstTextNode = firstParagraph?.content?.[0];

    if (firstTextNode?.type !== "text") {
      throw new Error("Expected leading text node in parsed paragraph");
    }

    firstTextNode.text = "Before nearby ";

    expect(editorStateToCriticMarkdown(nextDoc, comments)).toBe(
      "Before nearby {==target==}{>>Check this<<}{@id:cmt3;by:AI;at:2024-01-15T10:32:00.000Z@} after.\n",
    );
  });

  it("round-trips comments inside list items and headings", () => {
    const input = `## Sprint Notes

* First item
* {==Second item==}{>>Needs review<<}{@id:cmt4;by:AI;at:2024-01-15T10:33:00.000Z@}
`;

    const { doc, comments } = criticMarkdownToEditorState(input);
    const output = editorStateToCriticMarkdown(doc, comments);

    expect(output).toContain("## Sprint Notes");
    expect(output).toContain(
      "{==Second item==}{>>Needs review<<}{@id:cmt4;by:AI;at:2024-01-15T10:33:00.000Z@}",
    );
    expect(output).toContain("*   First item");
  });
});
