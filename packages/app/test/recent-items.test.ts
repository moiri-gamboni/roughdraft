import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listRecentItems, recordRecentOpen } from "../src/recent-items";

describe("recent items", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
        clear: () => {
          storage.clear();
        },
      },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores a markdown file in recent files and its parent in recent folders", () => {
    recordRecentOpen("/Users/nb/docs/draft.md");

    expect(listRecentItems("file")).toEqual([
      expect.objectContaining({
        kind: "file",
        path: "/Users/nb/docs/draft.md",
      }),
    ]);

    expect(listRecentItems("folder")).toEqual([
      expect.objectContaining({
        kind: "folder",
        path: "/Users/nb/docs",
      }),
    ]);
  });

  it("stores folders separately from files", () => {
    recordRecentOpen("/Users/nb/docs");

    expect(listRecentItems("folder")).toEqual([
      expect.objectContaining({
        kind: "folder",
        path: "/Users/nb/docs",
      }),
    ]);
    expect(listRecentItems("file")).toEqual([]);
  });

  it("de-duplicates repeated opens and keeps the newest entry first", () => {
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    recordRecentOpen("/Users/nb/docs/first.md");
    vi.setSystemTime(new Date("2026-04-23T12:00:01.000Z"));
    recordRecentOpen("/Users/nb/docs/second.md");
    vi.setSystemTime(new Date("2026-04-23T12:00:02.000Z"));
    recordRecentOpen("/Users/nb/docs/first.md");

    const recentFiles = listRecentItems("file");

    expect(recentFiles).toHaveLength(2);
    expect(recentFiles[0]).toMatchObject({ path: "/Users/nb/docs/first.md" });
    expect(recentFiles[1]).toMatchObject({ path: "/Users/nb/docs/second.md" });
  });
});
