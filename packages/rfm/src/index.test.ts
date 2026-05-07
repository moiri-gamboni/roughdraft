import { describe, expect, it } from "vitest";
import {
  appendRoughdraftReply,
  extractRoughdraftReviewIndex,
  markRoughdraftResolved,
  validateRoughdraftMarkdown,
} from "./index";

function codes(markdown: string): string[] {
  return validateRoughdraftMarkdown(markdown).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );
}

describe("validateRoughdraftMarkdown", () => {
  it("accepts valid comments, anchored comments, and suggestions", () => {
    const result = validateRoughdraftMarkdown(
      [
        'Please revisit {==this sentence==}{>>Needs a source.<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}.',
        'Add {++one concrete example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"}.',
        'Use {~~rough~>specific~~}{id="s2" by="user" at="2026-04-28T12:07:00.000Z"} wording.',
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 1,
      suggestions: 2,
      legacyMetadata: 0,
    });
  });

  it("ignores review markers inside fenced code blocks and inline code spans", () => {
    const result = validateRoughdraftMarkdown(
      [
        "```md",
        "This is {>>not a comment<<}.",
        "This is {++not a suggestion++}.",
        "```",
        "Literal `{>>not a comment<<}` text.",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 0,
      suggestions: 0,
    });
  });

  it("reports missing canonical metadata attributes", () => {
    expect(codes("{>>Needs metadata<<}\n")).toEqual([
      "missing-metadata-id",
      "missing-metadata-by",
      "missing-metadata-at",
    ]);
  });

  it("reports invalid timestamps", () => {
    expect(
      codes('{>>Bad time<<}{id="c1" by="user" at="yesterday"}\n'),
    ).toContain("invalid-metadata-at");
  });

  it("reports unclosed review markers", () => {
    expect(codes("{++unfinished\n")).toEqual(["unclosed-addition"]);
    expect(codes("{--unfinished\n")).toEqual(["unclosed-deletion"]);
    expect(codes("{~~old text\n")).toEqual(["unclosed-substitution"]);
  });

  it("reports duplicate ids across comments and suggestions", () => {
    expect(
      codes(
        [
          '{>>First<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}',
          '{++Second++}{id="c1" by="user" at="2026-04-28T12:01:00.000Z"}',
        ].join("\n"),
      ),
    ).toContain("duplicate-id");
  });

  it("reports self replies as errors and missing reply targets as warnings", () => {
    const result = validateRoughdraftMarkdown(
      [
        '{>>Self<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z" re="c1"}',
        '{>>Missing parent<<}{id="c2" by="user" at="2026-04-28T12:01:00.000Z" re="missing"}',
      ].join("\n"),
    );

    expect(result.errors.map((diagnostic) => diagnostic.code)).toContain(
      "self-reply",
    );
    expect(result.warnings.map((diagnostic) => diagnostic.code)).toContain(
      "missing-reply-target",
    );
    expect(result.ok).toBe(false);
  });

  it("accepts legacy metadata with a warning", () => {
    const result = validateRoughdraftMarkdown(
      "{>>Legacy<<}{@id:c1; by:AI; at:2026-04-28T12:00:00.000Z@}\n",
    );

    expect(result.ok).toBe(true);
    expect(result.warnings.map((diagnostic) => diagnostic.code)).toEqual([
      "legacy-metadata",
    ]);
    expect(result.summary.legacyMetadata).toBe(1);
  });

  it("reports CRLF source locations with one-based line and column", () => {
    const result = validateRoughdraftMarkdown(
      "First line\r\n{>>Needs metadata<<}\r\n",
    );

    expect(result.errors[0]).toMatchObject({
      line: 2,
      column: 1,
    });
  });
});

describe("extractRoughdraftReviewIndex", () => {
  it("extracts comments, anchored comments, replies, and suggestions", () => {
    const index = extractRoughdraftReviewIndex(
      [
        'Please revisit {==this sentence==}{>>Needs a source.<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}.',
        '{>>I added one.<<}{id="c2" by="AI" at="2026-04-28T12:02:00.000Z" re="c1"}',
        'Add {++one concrete example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"}.',
        'Use {~~rough~>specific~~}{id="s2" by="user" at="2026-04-28T12:07:00.000Z"} wording.',
      ].join("\n"),
    );

    expect(index.summary).toMatchObject({
      comments: 1,
      replies: 1,
      suggestions: 2,
      unresolved: 4,
    });
    expect(index.items.map((item) => [item.id, item.kind])).toEqual([
      ["c1", "comment"],
      ["c2", "reply"],
      ["s1", "suggestion"],
      ["s2", "suggestion"],
    ]);
    expect(index.items[0]).toMatchObject({
      anchorText: "this sentence",
      author: "user",
      line: 1,
      column: 35,
      text: "Needs a source.",
    });
    expect(index.items[3]).toMatchObject({
      suggestionKind: "substitution",
      originalText: "rough",
      replacementText: "specific",
    });
  });

  it("preserves literal CriticMarkup inside inline code and fenced code blocks", () => {
    const index = extractRoughdraftReviewIndex(
      [
        "```md",
        '{>>not a comment<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}',
        "```",
        'Literal `{++not a suggestion++}{id="s1" by="AI" at="2026-04-28T12:01:00.000Z"}` text.',
      ].join("\n"),
    );

    expect(index.items).toEqual([]);
    expect(index.summary).toMatchObject({
      comments: 0,
      replies: 0,
      suggestions: 0,
      unresolved: 0,
    });
  });
});

describe("RFM mutation helpers", () => {
  it("appends a reply without rewriting unrelated Markdown", () => {
    const markdown =
      '# Plan\n\nKeep {==this claim==}{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"} as written.\n';

    const updated = appendRoughdraftReply(markdown, {
      parentId: "c1",
      id: "c2",
      author: "AI",
      at: "2026-04-28T12:10:00.000Z",
      message: "Added a citation in the next paragraph.",
    });

    expect(updated).toBe(
      '# Plan\n\nKeep {==this claim==}{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}{>>Added a citation in the next paragraph.<<}{id="c2" by="AI" at="2026-04-28T12:10:00.000Z" re="c1"} as written.\n',
    );
  });

  it("rejects reply text that would close CriticMarkup early", () => {
    const markdown =
      '{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}\n';

    expect(() =>
      appendRoughdraftReply(markdown, {
        parentId: "c1",
        id: "c2",
        author: "AI",
        at: "2026-04-28T12:10:00.000Z",
        message: "This closes early <<} and corrupts the thread.",
      }),
    ).toThrow(/CriticMarkup close delimiter/);
  });

  it("marks a target resolved without changing unrelated markup", () => {
    const markdown =
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"} and keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"}.\n';

    const updated = markRoughdraftResolved(markdown, {
      targetId: "s1",
      summary: "Accepted in draft.",
    });

    expect(updated).toBe(
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z" status="resolved" resolved="Accepted in draft."} and keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"}.\n',
    );
  });
});
