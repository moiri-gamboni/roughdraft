import { describe, expect, it } from "vitest";
import { resolveRestoreAvailability } from "./DocumentWorkspace";

describe("deciding whether a version can be restored", () => {
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
