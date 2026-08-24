import { describe, expect, it } from "vitest";
import { diffSnapshot, MAX_DIFF_RUN_LINES } from "./snapshot-diff";

/** Everything the renderer needs, flattened for readable assertions. */
function render(before: string, after: string) {
  return diffSnapshot(before, after).lines.map((line) =>
    line.kind === "elided" ? `… ${line.count}` : `${line.kind[0]} ${line.text}`,
  );
}

describe("diffing a snapshot against the open document", () => {
  it("marks what was added, what was removed, and what stayed", () => {
    const before = "# Title\n\nKept line.\nOld line.\n";
    const after = "# Title\n\nKept line.\nNew line.\n";

    expect(render(before, after)).toEqual([
      "c # Title",
      "c ",
      "c Kept line.",
      "r Old line.",
      "a New line.",
    ]);
  });

  it("reports no changes as no changes, not as a wall of context", () => {
    const identical = "# Same\n\nBody.\n";

    expect(diffSnapshot(identical, identical).changed).toBe(false);
  });

  it("says a document is changed even when only one line moved", () => {
    expect(diffSnapshot("a\nb\n", "a\nc\n").changed).toBe(true);
  });

  it("keeps a trailing line that has no newline after it", () => {
    expect(render("one", "two")).toEqual(["r one", "a two"]);
  });

  it("does not invent a trailing blank line for a newline-terminated file", () => {
    expect(render("one\n", "one\n")).toEqual(["c one"]);
  });

  it("caps a long run and says how much it left out", () => {
    const before = "# Doc\n";
    const after = `# Doc\n${Array.from(
      { length: MAX_DIFF_RUN_LINES + 25 },
      (_, index) => `added ${index}`,
    ).join("\n")}\n`;

    const diff = diffSnapshot(before, after);
    const added = diff.lines.filter((line) => line.kind === "added");

    expect(added).toHaveLength(MAX_DIFF_RUN_LINES);
    expect(diff.truncated).toBe(true);
    expect(diff.lines).toContainEqual({ kind: "elided", count: 25 });
  });

  it("leaves a run alone when it fits under the cap", () => {
    const after = `# Doc\n${Array.from(
      { length: MAX_DIFF_RUN_LINES },
      (_, index) => `added ${index}`,
    ).join("\n")}\n`;

    const diff = diffSnapshot("# Doc\n", after);

    expect(diff.truncated).toBe(false);
    expect(diff.lines.some((line) => line.kind === "elided")).toBe(false);
  });

  it("passes a fenced code block through verbatim", () => {
    // A line diff cannot reinterpret its input, and the fence content here
    // includes the very markers a CriticMarkup-aware diff would try to nest.
    const before = "# Doc\n\n```text\n{++inserted++}\n```\n";
    const after = "# Doc\n\n```text\n{--deleted--}\n```\n";

    expect(render(before, after)).toEqual([
      "c # Doc",
      "c ",
      "c ```text",
      "r {++inserted++}",
      "a {--deleted--}",
      "c ```",
    ]);
  });

  it("carries real CriticMarkup through without rewriting it", () => {
    const before = "{==Anchor==}{>>Note<<}{#c1} tail.\n";
    const after = "{==Anchor==}{>>Note<<}{#c1} tail, edited.\n";

    const diff = diffSnapshot(before, after);
    const removed = diff.lines.find((line) => line.kind === "removed");
    const added = diff.lines.find((line) => line.kind === "added");

    expect(removed).toEqual({
      kind: "removed",
      text: "{==Anchor==}{>>Note<<}{#c1} tail.",
    });
    expect(added).toEqual({
      kind: "added",
      text: "{==Anchor==}{>>Note<<}{#c1} tail, edited.",
    });
  });

  it("treats an empty snapshot as everything added", () => {
    const diff = diffSnapshot("", "# New\n");

    expect(diff.changed).toBe(true);
    expect(diff.lines).toEqual([{ kind: "added", text: "# New" }]);
  });
});
