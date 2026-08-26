import { describe, expect, it } from "vitest";
import { formatSnapshotBytes } from "./DocumentHistoryDialog";

describe("saying how big a version is", () => {
  it("reports small versions in bytes", () => {
    expect(formatSnapshotBytes(0)).toBe("0 B");
    expect(formatSnapshotBytes(1023)).toBe("1023 B");
  });

  it("switches to kilobytes at 1024", () => {
    expect(formatSnapshotBytes(1024)).toBe("1.0 KB");
    expect(formatSnapshotBytes(20_480)).toBe("20.0 KB");
  });
});
