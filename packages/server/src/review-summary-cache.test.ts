import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractRoughdraftReviewIndex } from "@roughdraft/rfm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SUMMARY_BYTES, ReviewSummaryCache } from "./review-summary-cache";

const REVIEW_DOC = `# Title

Some {==highlighted==}{>>A comment<<}{#c1} text and {++inserted++}{#s1} more.

---
comments:
  c1:
    by: AI
    at: "2026-04-28T12:00:00.000Z"
suggestions:
  s1:
    by: AI
    at: "2026-04-28T12:10:00.000Z"
`;

describe("ReviewSummaryCache", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-summary-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("parses the review summary and reports the mtime on first read", () => {
    const file = path.join(dir, "draft.md");
    fs.writeFileSync(file, REVIEW_DOC);
    const cache = new ReviewSummaryCache();

    const state = cache.read(file);

    expect(state.exists).toBe(true);
    expect(state.modifiedAt).toBe(fs.statSync(file).mtime.toISOString());
    expect(state.summary).toEqual(
      extractRoughdraftReviewIndex(REVIEW_DOC).summary,
    );
  });

  it("serves the cached summary without re-reading when the stat is unchanged", () => {
    const file = path.join(dir, "draft.md");
    fs.writeFileSync(file, REVIEW_DOC);
    const cache = new ReviewSummaryCache();
    cache.read(file);

    const readSpy = vi.spyOn(fs, "readFileSync");
    const second = cache.read(file);

    expect(readSpy).not.toHaveBeenCalled();
    expect(second.summary).toEqual(
      extractRoughdraftReviewIndex(REVIEW_DOC).summary,
    );
  });

  it("re-parses after the file is rewritten", () => {
    const file = path.join(dir, "draft.md");
    fs.writeFileSync(file, REVIEW_DOC);
    const cache = new ReviewSummaryCache();
    cache.read(file);

    const rewritten = `# Rewritten\n\nNo review marks here at all, longer body text.\n`;
    fs.writeFileSync(file, rewritten);
    const state = cache.read(file);

    expect(state.summary).toEqual(
      extractRoughdraftReviewIndex(rewritten).summary,
    );
  });

  it("reports a missing file as absent", () => {
    const cache = new ReviewSummaryCache();

    const state = cache.read(path.join(dir, "gone.md"));

    expect(state).toEqual({ exists: false, modifiedAt: null, summary: null });
  });

  it("treats a directory named like a document as present with no summary and warns once", () => {
    const dirPath = path.join(dir, "weird.md");
    fs.mkdirSync(dirPath);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = new ReviewSummaryCache();

    const first = cache.read(dirPath);
    const second = cache.read(dirPath);

    expect(first).toMatchObject({ exists: true, summary: null });
    expect(second).toMatchObject({ exists: true, summary: null });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.join(" ")).toContain(dirPath);
  });

  it("skips reading a file larger than MAX_SUMMARY_BYTES", () => {
    const file = path.join(dir, "big.md");
    fs.writeFileSync(file, "#".repeat(MAX_SUMMARY_BYTES + 1));
    const cache = new ReviewSummaryCache();
    const readSpy = vi.spyOn(fs, "readFileSync");

    const state = cache.read(file);

    expect(state.exists).toBe(true);
    expect(state.summary).toBeNull();
    expect(readSpy).not.toHaveBeenCalled();
  });
});
