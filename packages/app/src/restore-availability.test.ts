import { describe, expect, it } from "vitest";
import { resolveRestoreAvailability } from "./DocumentWorkspace";

describe("deciding whether a version can be restored", () => {
  it("is ready on a clean file with nothing owed", () => {
    expect(
      resolveRestoreAvailability({
        diskChangeState: "clean",
        hasUnsentEdits: false,
      }),
    ).toBe("ready");
  });

  it("refuses while edits have not reached the file", () => {
    // Unsent edits are on no disk anywhere, so no snapshot holds them and
    // restoring over them destroys them for good.
    expect(
      resolveRestoreAvailability({
        diskChangeState: "clean",
        hasUnsentEdits: true,
      }),
    ).toBe("blocked-by-unsent-edits");
  });

  it("offers the overwrite escape when the file moved on disk", () => {
    for (const diskChangeState of ["changed", "conflict", "paused"] as const) {
      expect(
        resolveRestoreAvailability({ diskChangeState, hasUnsentEdits: false }),
      ).toBe("needs-overwrite");
    }
  });

  it("keeps yielding to an unanswered draft offer above all else", () => {
    // The draft offer is a question the reviewer has not answered yet, and
    // both of the other outcomes would answer it for them.
    expect(
      resolveRestoreAvailability({
        diskChangeState: "draft-restore",
        hasUnsentEdits: true,
      }),
    ).toBe("blocked-by-draft-offer");
  });

  it("reports the disk problem rather than the unsent edits when both hold", () => {
    // A moved file is the more actionable of the two: its escape is reversible
    // through the pre-capture, so it is the one worth naming.
    expect(
      resolveRestoreAvailability({
        diskChangeState: "conflict",
        hasUnsentEdits: true,
      }),
    ).toBe("needs-overwrite");
  });
});
