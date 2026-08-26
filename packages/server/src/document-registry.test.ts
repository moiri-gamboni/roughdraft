import { describe, expect, it } from "vitest";
import {
  DocumentRegistry,
  MAX_TRACKED_DOCUMENTS,
  registryPathFromRequest,
} from "./document-registry";

describe("registryPathFromRequest", () => {
  it("accepts an absolute .md path", () => {
    expect(registryPathFromRequest("/tmp/project/draft.md")).toBe(
      "/tmp/project/draft.md",
    );
  });

  it("rejects a relative path", () => {
    expect(registryPathFromRequest("project/draft.md")).toBeNull();
  });

  it("rejects a non-.md path", () => {
    expect(registryPathFromRequest("/tmp/project/notes.txt")).toBeNull();
  });

  it("rejects a path.resolve-unstable path", () => {
    expect(registryPathFromRequest("/a/../b.md")).toBeNull();
  });

  it("rejects a path containing a control character", () => {
    expect(registryPathFromRequest("/tmp/project/dr\naft.md")).toBeNull();
    expect(registryPathFromRequest("/tmp/project/draft.md")).toBeNull();
  });

  it("rejects a path with a .roughdraft-history segment", () => {
    expect(
      registryPathFromRequest("/tmp/project/.roughdraft-history/v1/draft.md"),
    ).toBeNull();
  });

  it("rejects a path longer than 4096 characters", () => {
    const long = `/tmp/${"a".repeat(4096)}.md`;
    expect(registryPathFromRequest(long)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(registryPathFromRequest(42)).toBeNull();
    expect(registryPathFromRequest(null)).toBeNull();
    expect(registryPathFromRequest(undefined)).toBeNull();
    expect(registryPathFromRequest({ path: "/x.md" })).toBeNull();
  });
});

describe("DocumentRegistry", () => {
  function fixedClock(startMs: number) {
    let current = startMs;
    return {
      now: () => current,
      advance(deltaMs: number) {
        current += deltaMs;
      },
    };
  }

  it("records startedAt as an ISO string at construction", () => {
    const clock = fixedClock(Date.parse("2026-08-26T10:00:00.000Z"));
    const registry = new DocumentRegistry({ now: clock.now });
    expect(registry.startedAt).toBe("2026-08-26T10:00:00.000Z");
  });

  it("sets lastLoadedAt and lastActivityAt on a load", () => {
    const clock = fixedClock(Date.parse("2026-08-26T10:00:00.000Z"));
    const registry = new DocumentRegistry({ now: clock.now });

    registry.noteOpened("/tmp/a.md", "load");

    const [entry] = registry.list();
    expect(entry).toMatchObject({
      absolutePath: "/tmp/a.md",
      lastLoadedAt: "2026-08-26T10:00:00.000Z",
      lastActivityAt: "2026-08-26T10:00:00.000Z",
      lastOpenedAt: null,
      lastReviewedAt: null,
    });
  });

  it("sets lastOpenedAt on a request source", () => {
    const clock = fixedClock(Date.parse("2026-08-26T10:00:00.000Z"));
    const registry = new DocumentRegistry({ now: clock.now });

    registry.noteOpened("/tmp/a.md", "request");

    const [entry] = registry.list();
    expect(entry.lastOpenedAt).toBe("2026-08-26T10:00:00.000Z");
    expect(entry.lastLoadedAt).toBeNull();
  });

  it("sets lastReviewedAt on a review", () => {
    const clock = fixedClock(Date.parse("2026-08-26T10:00:00.000Z"));
    const registry = new DocumentRegistry({ now: clock.now });

    registry.noteReviewCompleted("/tmp/a.md");

    const [entry] = registry.list();
    expect(entry.lastReviewedAt).toBe("2026-08-26T10:00:00.000Z");
  });

  it("bumps lastActivityAt on each mutation of the same path without duplicating the row", () => {
    const clock = fixedClock(Date.parse("2026-08-26T10:00:00.000Z"));
    const registry = new DocumentRegistry({ now: clock.now });

    registry.noteOpened("/tmp/a.md", "request");
    clock.advance(60_000);
    registry.noteReviewCompleted("/tmp/a.md");

    expect(registry.size()).toBe(1);
    const [entry] = registry.list();
    expect(entry.lastOpenedAt).toBe("2026-08-26T10:00:00.000Z");
    expect(entry.lastReviewedAt).toBe("2026-08-26T10:01:00.000Z");
    expect(entry.lastActivityAt).toBe("2026-08-26T10:01:00.000Z");
  });

  it("lists documents newest lastActivityAt first", () => {
    const clock = fixedClock(Date.parse("2026-08-26T10:00:00.000Z"));
    const registry = new DocumentRegistry({ now: clock.now });

    registry.noteOpened("/tmp/a.md", "request");
    clock.advance(1_000);
    registry.noteOpened("/tmp/b.md", "request");
    clock.advance(1_000);
    registry.noteOpened("/tmp/c.md", "request");
    clock.advance(1_000);
    registry.noteReviewCompleted("/tmp/a.md");

    expect(registry.list().map((entry) => entry.absolutePath)).toEqual([
      "/tmp/a.md",
      "/tmp/c.md",
      "/tmp/b.md",
    ]);
  });

  it("evicts the least-recently-active entry past MAX_TRACKED_DOCUMENTS", () => {
    const clock = fixedClock(Date.parse("2026-08-26T10:00:00.000Z"));
    const registry = new DocumentRegistry({ now: clock.now });

    for (let index = 0; index < MAX_TRACKED_DOCUMENTS; index += 1) {
      registry.noteOpened(`/tmp/${index}.md`, "request");
      clock.advance(1_000);
    }
    // Touch /tmp/0.md so it is no longer the oldest.
    registry.noteReviewCompleted("/tmp/0.md");
    clock.advance(1_000);

    registry.noteOpened("/tmp/new.md", "request");

    expect(registry.size()).toBe(MAX_TRACKED_DOCUMENTS);
    const paths = registry.list().map((entry) => entry.absolutePath);
    // /tmp/1.md was the least-recently-active and is evicted; /tmp/0.md survives.
    expect(paths).not.toContain("/tmp/1.md");
    expect(paths).toContain("/tmp/0.md");
    expect(paths).toContain("/tmp/new.md");
  });
});
