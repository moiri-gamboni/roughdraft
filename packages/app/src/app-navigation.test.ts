import { afterEach, describe, expect, it } from "vitest";
import {
  getRequestedPathState,
  syncRequestedPathInUrl,
} from "./app-navigation";

describe("app navigation", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("reads absolute markdown paths from the path query parameter", () => {
    window.history.replaceState(
      null,
      "",
      "/?path=%2FUsers%2Fme%2F.claude%2Fplans%2Fexample.md",
    );

    expect(getRequestedPathState()).toEqual({
      rawPath: "/Users/me/.claude/plans/example.md",
      projectPath: "/Users/me/.claude/plans",
      documentPath: "example.md",
    });
  });

  it("keeps absolute paths in the path query parameter", () => {
    window.history.replaceState(null, "", "/");

    syncRequestedPathInUrl("/Users/me/.claude/plans/example.md");

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe(
      "?path=%2FUsers%2Fme%2F.claude%2Fplans%2Fexample.md",
    );
  });
});
