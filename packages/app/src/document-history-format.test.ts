import { describe, expect, it } from "vitest";
import {
  formatSnapshotAge,
  formatSnapshotBytes,
} from "./DocumentHistoryDialog";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");

function ageAt(iso: string) {
  return formatSnapshotAge(iso, NOW);
}

describe("saying how old a version is", () => {
  it("calls anything under a minute just now", () => {
    expect(ageAt("2026-08-24T11:59:30.000Z")).toBe("just now");
  });

  it("counts minutes up to the hour", () => {
    expect(ageAt("2026-08-24T11:01:00.000Z")).toBe("59m ago");
  });

  it("switches to hours at the hour", () => {
    expect(ageAt("2026-08-24T11:00:00.000Z")).toBe("1h ago");
  });

  it("switches to days at the day", () => {
    expect(ageAt("2026-08-23T12:00:00.000Z")).toBe("1d ago");
    expect(ageAt("2026-08-24T00:00:00.000Z")).toBe("12h ago");
  });

  it("says nothing rather than NaN for an unparseable timestamp", () => {
    expect(ageAt("not a date")).toBe("");
  });
});

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
