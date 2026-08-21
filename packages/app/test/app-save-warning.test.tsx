import { describe, expect, it } from "vitest";
import { shouldWarnBeforeUnload } from "../src/App";
import type { DocumentSaveState } from "../src/PageCard";
import type { DocumentDiskChangeState } from "../src/storage";

/**
 * Keyed by the union rather than listed, so adding a disk-change state without
 * deciding whether it should block a reload is a compile error.
 */
const warnByDiskChangeState: Record<DocumentDiskChangeState, boolean> = {
  clean: false,
  changed: true,
  conflict: true,
  paused: true,
  "draft-restore": true,
};

const warnBySaveState: Record<DocumentSaveState, boolean> = {
  saved: false,
  saving: true,
  unsaved: true,
  error: true,
};

describe("beforeunload save warning", () => {
  it.each(
    Object.entries(warnByDiskChangeState),
  )("returns %s for disk state %s", (diskChangeState, expected) => {
    expect(
      shouldWarnBeforeUnload({
        activeDocumentPath: "doc.md",
        isDirty: false,
        saveState: "saved",
        diskChangeState: diskChangeState as DocumentDiskChangeState,
      }),
    ).toBe(expected);
  });

  it.each(
    Object.entries(warnBySaveState),
  )("returns %s for save state %s", (saveState, expected) => {
    expect(
      shouldWarnBeforeUnload({
        activeDocumentPath: "doc.md",
        isDirty: false,
        saveState: saveState as DocumentSaveState,
        diskChangeState: "clean",
      }),
    ).toBe(expected);
  });

  it("warns while the document is dirty", () => {
    expect(
      shouldWarnBeforeUnload({
        activeDocumentPath: "doc.md",
        isDirty: true,
        saveState: "saved",
        diskChangeState: "clean",
      }),
    ).toBe(true);
  });

  it("does not warn when no document is open", () => {
    expect(
      shouldWarnBeforeUnload({
        activeDocumentPath: null,
        isDirty: true,
        saveState: "error",
        diskChangeState: "conflict",
      }),
    ).toBe(false);
  });
});
