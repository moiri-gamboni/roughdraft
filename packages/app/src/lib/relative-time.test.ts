import { describe, expect, it } from "vitest";
import { formatRelativeAge } from "./relative-time";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");

function ageAt(iso: string) {
  return formatRelativeAge(iso, NOW);
}

describe("saying how old a timestamp is", () => {
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
