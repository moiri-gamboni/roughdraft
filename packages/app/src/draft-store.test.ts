import { afterEach, describe, expect, it } from "vitest";
import {
  clearDraft,
  DRAFT_KEY_PREFIX,
  draftKeyFromUrl,
  readDraft,
  updateBase,
  writeDraft,
  writeSessionPointer,
} from "./draft-store";

class MemoryStorage implements Storage {
  private entries = new Map<string, string>();
  /** Set to a function that throws to simulate a quota-exceeded browser. */
  onSetItem: ((key: string, value: string) => void) | null = null;

  get length() {
    return this.entries.size;
  }

  key(index: number) {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.onSetItem?.(key, value);
    this.entries.set(key, value);
  }

  removeItem(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}

function quotaError() {
  return new DOMException("quota", "QuotaExceededError");
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("draftKeyFromUrl", () => {
  it("derives a local file key from the requested document path", () => {
    window.history.replaceState(null, "", "/?path=/work/notes/plan.md");

    expect(draftKeyFromUrl(new MemoryStorage())).toEqual({
      key: `${DRAFT_KEY_PREFIX}file:/work/notes/plan.md`,
      mode: "local",
    });
  });

  it("has no durable destination when the URL names no document", () => {
    window.history.replaceState(null, "", "/");

    expect(draftKeyFromUrl(new MemoryStorage())).toBeNull();
  });

  it("has no durable destination when the URL names a directory", () => {
    window.history.replaceState(null, "", "/?path=/work/notes");

    expect(draftKeyFromUrl(new MemoryStorage())).toBeNull();
  });

  it("cannot resolve a remote key before the session pointer exists", () => {
    window.history.replaceState(null, "", "/?session=abc123");

    expect(draftKeyFromUrl(new MemoryStorage())).toBeNull();
  });

  it("resolves a remote key to the origin path through the session pointer", () => {
    const storage = new MemoryStorage();
    window.history.replaceState(null, "", "/?session=abc123");
    writeSessionPointer(storage, "abc123", "/work/origin.md");

    expect(draftKeyFromUrl(storage)).toEqual({
      key: `${DRAFT_KEY_PREFIX}origin:/work/origin.md`,
      mode: "remote",
    });
  });

  it("survives storage being unavailable", () => {
    window.history.replaceState(null, "", "/?session=abc123");

    expect(draftKeyFromUrl(null)).toBeNull();
  });
});

describe("writeSessionPointer", () => {
  it("follows the session to a different origin file", () => {
    // A session id can be reused for another document. Keeping the first
    // mapping would point this document's draft at the other one's record.
    const storage = new MemoryStorage();
    writeSessionPointer(storage, "abc123", "/work/origin.md");
    writeSessionPointer(storage, "abc123", "/work/other.md");

    expect(storage.getItem(`${DRAFT_KEY_PREFIX}session:abc123`)).toBe(
      "/work/other.md",
    );
  });

  it("does not rewrite the pointer when the origin is unchanged", () => {
    const storage = new MemoryStorage();
    writeSessionPointer(storage, "abc123", "/work/origin.md");
    let writes = 0;
    storage.onSetItem = () => {
      writes += 1;
    };

    writeSessionPointer(storage, "abc123", "/work/origin.md");

    expect(writes).toBe(0);
  });
});

describe("draft records", () => {
  const key = `${DRAFT_KEY_PREFIX}file:/work/plan.md`;

  it("round-trips a draft", () => {
    const storage = new MemoryStorage();

    expect(
      writeDraft(storage, key, { content: "draft", baseContent: "disk" }),
    ).toBe(true);
    expect(readDraft(storage, key)).toMatchObject({
      content: "draft",
      baseContent: "disk",
    });
  });

  it("marks the base unknown when no base content is supplied", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, key, { content: "draft", baseContent: null });

    expect(readDraft(storage, key)).toMatchObject({
      content: "draft",
      baseContent: null,
    });
  });

  it("returns nothing when no draft was ever written", () => {
    expect(readDraft(new MemoryStorage(), key)).toBeNull();
  });

  it("moves the base forward without touching newer draft content", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, key, { content: "first", baseContent: "disk" });
    writeDraft(storage, key, { content: "second", baseContent: "disk" });

    updateBase(storage, key, "first");

    expect(readDraft(storage, key)).toMatchObject({
      content: "second",
      baseContent: "first",
    });
  });

  it("does not resurrect a cleared record when the base moves", () => {
    const storage = new MemoryStorage();
    writeDraft(storage, key, { content: "draft", baseContent: "disk" });
    clearDraft(storage, key);

    updateBase(storage, key, "draft");

    expect(readDraft(storage, key)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("tolerates a corrupted record without deleting it", () => {
    const storage = new MemoryStorage();
    storage.setItem(key, "{not json");

    expect(readDraft(storage, key)).toBeNull();
    expect(storage.getItem(key)).toBe("{not json");
  });

  it("keeps an unknown-schema record and surfaces it with an unknown base", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      key,
      JSON.stringify({
        schema: 99,
        content: "future draft",
        baseContent: "disk",
        updatedAt: 1,
      }),
    );

    expect(readDraft(storage, key)).toMatchObject({
      content: "future draft",
      baseContent: null,
    });
    expect(storage.getItem(key)).not.toBeNull();
  });

  it("surfaces an unknown base when the stored one is not a string", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      key,
      JSON.stringify({ schema: 1, content: "draft", baseContent: 42 }),
    );

    expect(readDraft(storage, key)).toMatchObject({
      content: "draft",
      baseContent: null,
    });
  });

  it("survives storage being unavailable", () => {
    expect(writeDraft(null, key, { content: "a", baseContent: null })).toBe(
      false,
    );
    expect(readDraft(null, key)).toBeNull();
    expect(() => updateBase(null, key, "a")).not.toThrow();
    expect(() => clearDraft(null, key)).not.toThrow();
  });
});

describe("quota pressure", () => {
  const key = `${DRAFT_KEY_PREFIX}file:/work/plan.md`;

  it("evicts the oldest other draft and retries the write", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      `${DRAFT_KEY_PREFIX}file:/work/old.md`,
      JSON.stringify({
        schema: 1,
        content: "old",
        baseContent: null,
        updatedAt: 1,
      }),
    );
    storage.setItem(
      `${DRAFT_KEY_PREFIX}file:/work/newer.md`,
      JSON.stringify({
        schema: 1,
        content: "newer",
        baseContent: null,
        updatedAt: 2,
      }),
    );
    let failures = 1;
    storage.onSetItem = () => {
      if (failures-- > 0) throw quotaError();
    };

    expect(
      writeDraft(storage, key, { content: "draft", baseContent: "disk" }),
    ).toBe(true);
    expect(storage.getItem(`${DRAFT_KEY_PREFIX}file:/work/old.md`)).toBeNull();
    expect(
      storage.getItem(`${DRAFT_KEY_PREFIX}file:/work/newer.md`),
    ).not.toBeNull();
  });

  it("reports the write as not durable rather than emptying storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      `${DRAFT_KEY_PREFIX}file:/work/old.md`,
      JSON.stringify({
        schema: 1,
        content: "old",
        baseContent: null,
        updatedAt: 1,
      }),
    );
    storage.setItem(
      `${DRAFT_KEY_PREFIX}file:/work/newer.md`,
      JSON.stringify({
        schema: 1,
        content: "newer",
        baseContent: null,
        updatedAt: 2,
      }),
    );
    storage.onSetItem = () => {
      throw quotaError();
    };

    expect(
      writeDraft(storage, key, { content: "draft", baseContent: "disk" }),
    ).toBe(false);
    expect(
      storage.getItem(`${DRAFT_KEY_PREFIX}file:/work/newer.md`),
    ).not.toBeNull();
  });
});

describe("secrets", () => {
  it("never puts the URL token in a draft key or a stored value", () => {
    const storage = new MemoryStorage();
    window.history.replaceState(
      null,
      "",
      "/?path=/work/plan.md&token=SUPERSECRET",
    );

    const draftKey = draftKeyFromUrl(storage);
    if (!draftKey) throw new Error("expected a draft key");
    writeDraft(storage, draftKey.key, {
      content: "draft",
      baseContent: "disk",
    });

    const stored = [...Array(storage.length).keys()].map((index) => {
      const storedKey = storage.key(index) ?? "";
      return `${storedKey} ${storage.getItem(storedKey) ?? ""}`;
    });

    expect(stored.join("\n")).not.toContain("SUPERSECRET");
  });

  it("never puts the URL token in a remote draft key or pointer", () => {
    const storage = new MemoryStorage();
    window.history.replaceState(null, "", "/?session=abc123&token=SUPERSECRET");
    writeSessionPointer(storage, "abc123", "/work/origin.md");

    const draftKey = draftKeyFromUrl(storage);
    if (!draftKey) throw new Error("expected a draft key");
    writeDraft(storage, draftKey.key, {
      content: "draft",
      baseContent: "disk",
    });

    const stored = [...Array(storage.length).keys()].map((index) => {
      const storedKey = storage.key(index) ?? "";
      return `${storedKey} ${storage.getItem(storedKey) ?? ""}`;
    });

    expect(stored.join("\n")).not.toContain("SUPERSECRET");
  });
});
