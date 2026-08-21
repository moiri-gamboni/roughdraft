import { describe, expect, it } from "vitest";
import {
  nextRetryDelayMs,
  resolveConflict,
  resolveRestore,
} from "./save-recovery";

describe("nextRetryDelayMs", () => {
  it.each([
    [1, 1_000],
    [2, 2_000],
    [3, 4_000],
    [4, 8_000],
    [5, 15_000],
    [6, 15_000],
    [40, 15_000],
  ])("waits %ims on attempt %i", (attempt, expected) => {
    expect(nextRetryDelayMs(attempt)).toBe(expected);
  });
});

describe("resolveRestore", () => {
  const draft = {
    content: "draft body",
    baseContent: "disk body",
    baseKnown: true,
  };

  it("does nothing when no draft was stored", () => {
    expect(
      resolveRestore({ draft: null, diskContent: "disk body", mode: "local" }),
    ).toBe("nothing");
  });

  it("does nothing when the stored draft already matches what loaded", () => {
    expect(
      resolveRestore({
        draft: { ...draft, content: "disk body" },
        diskContent: "disk body",
        mode: "local",
      }),
    ).toBe("nothing");
  });

  it("does nothing when the draft matches even with an unknown base", () => {
    expect(
      resolveRestore({
        draft: { content: "disk body", baseContent: "", baseKnown: false },
        diskContent: "disk body",
        mode: "local",
      }),
    ).toBe("nothing");
  });

  it("restores silently in local mode when the base still matches disk", () => {
    expect(
      resolveRestore({ draft, diskContent: "disk body", mode: "local" }),
    ).toBe("silent");
  });

  it("asks in local mode when disk moved away from the draft base", () => {
    expect(
      resolveRestore({
        draft,
        diskContent: "someone else body",
        mode: "local",
      }),
    ).toBe("ask");
  });

  it("asks when the base is unknown even though disk is empty", () => {
    expect(
      resolveRestore({
        draft: { content: "draft body", baseContent: "", baseKnown: false },
        diskContent: "",
        mode: "local",
      }),
    ).toBe("ask");
  });

  it("asks in local mode when the base is unknown and disk is non-empty", () => {
    expect(
      resolveRestore({
        draft: { content: "draft body", baseContent: "", baseKnown: false },
        diskContent: "disk body",
        mode: "local",
      }),
    ).toBe("ask");
  });

  it("never restores silently in remote mode, even when the base matches", () => {
    expect(
      resolveRestore({ draft, diskContent: "disk body", mode: "remote" }),
    ).toBe("ask");
  });
});

describe("resolveConflict", () => {
  it("reports already-applied when the server and the editor both hold what we sent", () => {
    expect(
      resolveConflict({
        attemptedContent: "new body",
        currentContent: "new body",
        draftBaseContent: "old body",
        editorContent: "new body",
      }),
    ).toBe("already-applied");
  });

  it("refuses already-applied when the editor has moved on since the attempt", () => {
    expect(
      resolveConflict({
        attemptedContent: "new body",
        currentContent: "new body",
        draftBaseContent: "new body",
        editorContent: "newer body",
      }),
    ).toBe("base-unchanged");
  });

  it("reports base-unchanged when the server still holds the draft base", () => {
    expect(
      resolveConflict({
        attemptedContent: "new body",
        currentContent: "old body",
        draftBaseContent: "old body",
        editorContent: "new body",
      }),
    ).toBe("base-unchanged");
  });

  it("reports a real conflict when the server holds someone else's text", () => {
    expect(
      resolveConflict({
        attemptedContent: "new body",
        currentContent: "someone else body",
        draftBaseContent: "old body",
        editorContent: "new body",
      }),
    ).toBe("real");
  });

  it("reports a real conflict when the draft base is unknown", () => {
    expect(
      resolveConflict({
        attemptedContent: "new body",
        currentContent: "old body",
        draftBaseContent: null,
        editorContent: "new body",
      }),
    ).toBe("real");
  });
});
