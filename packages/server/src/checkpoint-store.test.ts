import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  atomicWriteFileSync,
  captureSnapshot,
  commitDocumentWrite,
  historyDirFor,
  listSnapshots,
  MAX_SNAPSHOTS_PER_DOCUMENT,
  parseSnapshotId,
  readSnapshot,
  type SnapshotSummary,
  type SnapshotTrigger,
} from "./checkpoint-store";

const CANONICAL_ID = "2026-08-24T10-11-12-345Z--p1234--hook";
/** Mirrors the module's own formatting, so tests can plant dated snapshots. */
const idAt = (when: Date, pid: number, trigger: SnapshotTrigger) =>
  `${when.toISOString().replace(/[:.]/g, "-")}--p${pid}--${trigger}`;

/** Permission bits mean nothing to root, so those tests would pass vacuously. */
const asRoot = process.getuid?.() === 0;

let projectDir: string;
let docPath: string;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-history-"));
  docPath = path.join(projectDir, "notes.md");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(projectDir, { recursive: true, force: true });
});

/** Fails loudly rather than letting a non-`ok` listing silently satisfy a `?.` chain. */
function readableSnapshots(documentPath: string): {
  snapshots: SnapshotSummary[];
  unreadable: number;
} {
  const listing = listSnapshots(documentPath);
  if (listing.status !== "ok") {
    throw new Error(`expected a readable history, got "${listing.status}"`);
  }
  return listing;
}

function ids(documentPath: string): string[] {
  return readableSnapshots(documentPath).snapshots.map(
    (snapshot) => snapshot.id,
  );
}

function contents(documentPath: string): (string | null)[] {
  return ids(documentPath).map((id) => readSnapshot(documentPath, id));
}

/** Puts a snapshot on disk without going through the store. */
function plantSnapshot(
  documentPath: string,
  id: string,
  content: string,
): string {
  const directory = historyDirFor(documentPath);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${id}.md`), content);
  return id;
}

describe("historyDirFor", () => {
  it("places history beside the document, keyed by the filename stem", () => {
    expect(historyDirFor("/tmp/project/notes.md")).toBe(
      "/tmp/project/.roughdraft-history/v1/notes",
    );
  });

  it("only strips a .md extension from the stem", () => {
    expect(historyDirFor("/tmp/project/notes.draft.md")).toBe(
      "/tmp/project/.roughdraft-history/v1/notes.draft",
    );
    expect(historyDirFor("/tmp/project/README")).toBe(
      "/tmp/project/.roughdraft-history/v1/README",
    );
  });
});

describe("parseSnapshotId", () => {
  it("parses the canonical timestamp, pid and trigger", () => {
    expect(parseSnapshotId(CANONICAL_ID)).toEqual({
      createdAt: new Date("2026-08-24T10:11:12.345Z"),
      pid: 1234,
      trigger: "hook",
    });
  });

  it("accepts every trigger in the frozen set", () => {
    for (const trigger of ["save", "review", "replaced", "hook"] as const) {
      const id = `2026-08-24T10-11-12-345Z--p7--${trigger}`;
      expect(parseSnapshotId(id)?.trigger).toBe(trigger);
    }
  });

  it("rejects ids carrying path or extension characters", () => {
    for (const id of [
      `${CANONICAL_ID}.md`,
      `${CANONICAL_ID}/x`,
      "..",
      `../${CANONICAL_ID}`,
      `${CANONICAL_ID}/../../etc/passwd`,
      "2026-08-24T10-11-12-345Z--p1234--rm",
      "2026-08-24T10-11-12-345Z--1234--save",
      "",
    ]) {
      expect(parseSnapshotId(id), id).toBeNull();
    }
  });

  it("rejects an overlong id", () => {
    const overlong = `2026-08-24T10-11-12-345Z--p${"9".repeat(4096)}--save`;
    expect(parseSnapshotId(overlong)).toBeNull();
  });

  it("rejects a well-shaped id whose timestamp is not a real instant", () => {
    expect(parseSnapshotId("2026-13-42T99-11-12-345Z--p1--save")).toBeNull();
  });

  it("rejects a date that only parses by rolling over into another day", () => {
    // `new Date("2026-02-30T…")` is not an Invalid Date — it silently becomes
    // March 2nd, which would make the parsed instant disagree with the
    // filename, and filename order is what the bash pruner deletes by.
    expect(parseSnapshotId("2026-02-30T00-00-00-000Z--p1--save")).toBeNull();
    expect(parseSnapshotId("2026-01-01T24-00-00-000Z--p1--save")).toBeNull();
    expect(parseSnapshotId("2026-01-01T00-60-00-000Z--p1--save")).toBeNull();
  });

  it("rejects a non-canonical spelling of a valid instant", () => {
    expect(parseSnapshotId("2026-08-24T10-11-12-345Z--p007--save")).toBeNull();
  });

  it("round-trips the id of a freshly captured snapshot", () => {
    const before = Date.now();
    const summary = captureSnapshot(docPath, "hello", "review");
    if (!summary) throw new Error("expected a snapshot");

    const parsed = parseSnapshotId(summary.id);
    expect(parsed?.trigger).toBe("review");
    expect(parsed?.pid).toBe(process.pid);
    expect(parsed?.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(summary.createdAt).toEqual(parsed?.createdAt);
  });
});

describe("captureSnapshot", () => {
  it("creates the versioned leaf lazily and marks the sidecar git-ignored", () => {
    expect(fs.existsSync(path.join(projectDir, ".roughdraft-history"))).toBe(
      false,
    );

    captureSnapshot(docPath, "hello", "save");

    expect(fs.existsSync(historyDirFor(docPath))).toBe(true);
    expect(
      fs.readFileSync(
        path.join(projectDir, ".roughdraft-history", ".gitignore"),
        "utf8",
      ),
    ).toBe("*\n");
  });

  it("restores the sidecar .gitignore when the sidecar already exists without one", () => {
    // The bash hook creates the same sidecar; either writer may get there
    // first, and the file is what keeps deleted content out of a commit.
    fs.mkdirSync(path.join(projectDir, ".roughdraft-history", "v1"), {
      recursive: true,
    });

    captureSnapshot(docPath, "hello", "save");

    expect(
      fs.readFileSync(
        path.join(projectDir, ".roughdraft-history", ".gitignore"),
        "utf8",
      ),
    ).toBe("*\n");
  });

  it("leaves an existing sidecar .gitignore alone", () => {
    captureSnapshot(docPath, "hello", "save");
    const gitignore = path.join(
      projectDir,
      ".roughdraft-history",
      ".gitignore",
    );
    fs.writeFileSync(gitignore, "*\n!keep-me\n");

    captureSnapshot(docPath, "goodbye", "hook");

    expect(fs.readFileSync(gitignore, "utf8")).toBe("*\n!keep-me\n");
  });

  it("records the trigger and the on-disk byte length", () => {
    const summary = captureSnapshot(docPath, "héllo", "hook");

    expect(summary).toMatchObject({ trigger: "hook", bytes: 6 });
    expect(readSnapshot(docPath, summary?.id ?? "")).toBe("héllo");
  });

  it("skips a capture whose content matches the newest snapshot", () => {
    captureSnapshot(docPath, "same", "save");
    const second = captureSnapshot(docPath, "same", "hook");

    expect(second).toBeNull();
    expect(readableSnapshots(docPath).snapshots).toHaveLength(1);
  });

  it("captures again once the content has changed back and forth", () => {
    captureSnapshot(docPath, "a", "hook");
    captureSnapshot(docPath, "b", "hook");
    captureSnapshot(docPath, "a", "hook");

    expect(readableSnapshots(docPath).snapshots).toHaveLength(3);
  });

  it("promotes the newest snapshot to review instead of duplicating it", () => {
    const original = captureSnapshot(docPath, "same", "save");
    if (!original) throw new Error("expected a snapshot");

    const promoted = captureSnapshot(docPath, "same", "review");

    const { snapshots } = readableSnapshots(docPath);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].trigger).toBe("review");
    expect(promoted?.id).toBe(snapshots[0].id);
    expect(parseSnapshotId(snapshots[0].id)?.createdAt).toEqual(
      original.createdAt,
    );
    expect(readSnapshot(docPath, snapshots[0].id)).toBe("same");
  });

  it("promotes a replaced snapshot too, so clobbered bytes can be pinned", () => {
    const clobbered = captureSnapshot(
      docPath,
      "the bytes an agent ate",
      "replaced",
    );
    if (!clobbered) throw new Error("expected a snapshot");

    const promoted = captureSnapshot(
      docPath,
      "the bytes an agent ate",
      "review",
    );

    const { snapshots } = readableSnapshots(docPath);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].trigger).toBe("review");
    expect(promoted?.id).toBe(snapshots[0].id);
    expect(readSnapshot(docPath, snapshots[0].id)).toBe(
      "the bytes an agent ate",
    );
  });

  it("leaves an already-review newest snapshot alone on a tie", () => {
    const original = captureSnapshot(docPath, "same", "review");
    const again = captureSnapshot(docPath, "same", "review");

    expect(again).toBeNull();
    expect(ids(docPath)).toEqual([original?.id]);
  });

  it("stamps a capture after a newest snapshot dated in the future", () => {
    // Clock skew, or another writer with a fast clock. Ids order the history,
    // so a later capture must still sort later.
    const future = new Date(Date.now() + 60_000);
    plantSnapshot(docPath, idAt(future, 1, "save"), "from the future");

    const summary = captureSnapshot(docPath, "now", "hook");

    expect(summary?.createdAt.getTime()).toBeGreaterThan(future.getTime());
    expect(ids(docPath)[0]).toBe(summary?.id);
  });

  it("refuses to write a snapshot whose id would leave the grammar", () => {
    // One millisecond past the end of the grammar's range, `toISOString`
    // switches to expanded-year form. Writing that would produce a file the
    // store cannot see, and then one new file per save for ever.
    const poisoned = plantSnapshot(
      docPath,
      "9999-12-31T23-59-59-999Z--p1--save",
      "at the end of time",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      captureSnapshot(docPath, "after the end of time", "hook"),
    ).toBeNull();

    expect(warn).toHaveBeenCalled();
    expect(fs.readdirSync(historyDirFor(docPath))).toEqual([`${poisoned}.md`]);
  });

  it.skipIf(asRoot)(
    "returns null instead of throwing when the sidecar cannot be created",
    () => {
      fs.chmodSync(projectDir, 0o500);
      try {
        expect(captureSnapshot(docPath, "hello", "save")).toBeNull();
      } finally {
        fs.chmodSync(projectDir, 0o700);
      }
    },
  );

  it("refuses a symlinked history leaf", () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-out-"));
    fs.mkdirSync(path.join(projectDir, ".roughdraft-history", "v1"), {
      recursive: true,
    });
    fs.symlinkSync(elsewhere, historyDirFor(docPath));

    try {
      expect(captureSnapshot(docPath, "hello", "save")).toBeNull();
      expect(fs.readdirSync(elsewhere)).toEqual([]);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("refuses a symlinked sidecar root", () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-out-"));
    fs.symlinkSync(elsewhere, path.join(projectDir, ".roughdraft-history"));

    try {
      expect(captureSnapshot(docPath, "hello", "save")).toBeNull();
      expect(fs.readdirSync(elsewhere)).toEqual([]);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it.skipIf(asRoot)(
    "refuses to capture into a history it cannot list",
    () => {
      // A leaf that is writable but not readable makes every capture look like
      // the first one: no dedup, no coalescing and no pruning, so the cap stops
      // holding and the directory grows a snapshot per keystroke pause.
      captureSnapshot(docPath, "first", "save");
      const leaf = historyDirFor(docPath);
      fs.chmodSync(leaf, 0o300);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        expect(captureSnapshot(docPath, "second", "save")).toBeNull();
        expect(warn).toHaveBeenCalled();
      } finally {
        fs.chmodSync(leaf, 0o700);
      }

      expect(contents(docPath)).toEqual(["first"]);
    },
  );

  it("rethrows a programmer error rather than degrading to no history", () => {
    // A blanket catch that swallows everything hides a broken refactor behind
    // "the history is just unavailable" on a server nobody tails.
    vi.spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new TypeError("readdirSync is not a function");
    });

    expect(() => captureSnapshot(docPath, "hello", "save")).toThrow(TypeError);
  });
});

describe("save coalescing", () => {
  it("folds a burst of saves into the first one", () => {
    const first = captureSnapshot(docPath, "typing", "save");
    const second = captureSnapshot(docPath, "typing a bit more", "save");

    expect(second).toBeNull();
    expect(ids(docPath)).toEqual([first?.id]);
  });

  it("captures a save once the window has passed", () => {
    plantSnapshot(
      docPath,
      idAt(new Date(Date.now() - 120_000), 1, "save"),
      "two minutes ago",
    );

    const summary = captureSnapshot(docPath, "now", "save");

    expect(summary?.trigger).toBe("save");
    expect(ids(docPath)).toHaveLength(2);
  });

  it("never coalesces a replaced, review or hook capture", () => {
    captureSnapshot(docPath, "typing", "save");

    expect(captureSnapshot(docPath, "clobbered", "replaced")?.trigger).toBe(
      "replaced",
    );
    expect(captureSnapshot(docPath, "reviewed", "review")?.trigger).toBe(
      "review",
    );
    expect(captureSnapshot(docPath, "by an agent", "hook")?.trigger).toBe(
      "hook",
    );
  });

  it("does not coalesce a save behind a snapshot of another kind", () => {
    captureSnapshot(docPath, "by an agent", "hook");

    expect(captureSnapshot(docPath, "ours", "save")?.trigger).toBe("save");
  });
});

describe("snapshot eviction", () => {
  it("freezes the documented cap at 50", () => {
    // Every other test uses the symbol; this is the one place that pins the
    // number the cross-repo format promises, so the bash pruner can match it.
    expect(MAX_SNAPSHOTS_PER_DOCUMENT).toBe(50);
  });

  it("evicts the oldest snapshots once the cap is exceeded", () => {
    for (let index = 0; index < MAX_SNAPSHOTS_PER_DOCUMENT + 3; index += 1) {
      captureSnapshot(docPath, `revision ${index}`, "hook");
    }

    const { snapshots } = readableSnapshots(docPath);
    expect(snapshots).toHaveLength(MAX_SNAPSHOTS_PER_DOCUMENT);
    expect(readSnapshot(docPath, snapshots[0].id)).toBe(
      `revision ${MAX_SNAPSHOTS_PER_DOCUMENT + 2}`,
    );
    expect(readSnapshot(docPath, snapshots[snapshots.length - 1].id)).toBe(
      "revision 3",
    );
  });

  it("holds the cap on the path production writes through", () => {
    for (let index = 0; index < MAX_SNAPSHOTS_PER_DOCUMENT + 3; index += 1) {
      commitDocumentWrite(docPath, `revision ${index}`, {
        priorContent: `revision ${index - 1}`,
        trigger: "hook",
      });
    }

    expect(readableSnapshots(docPath).snapshots).toHaveLength(
      MAX_SNAPSHOTS_PER_DOCUMENT,
    );
  });

  it("keeps the newest review snapshot even when it is the oldest entry", () => {
    const reviewed = captureSnapshot(docPath, "reviewed state", "review");
    if (!reviewed) throw new Error("expected a snapshot");

    for (let index = 0; index < MAX_SNAPSHOTS_PER_DOCUMENT + 3; index += 1) {
      captureSnapshot(docPath, `burst ${index}`, "hook");
    }

    const { snapshots } = readableSnapshots(docPath);
    expect(snapshots).toHaveLength(MAX_SNAPSHOTS_PER_DOCUMENT);
    expect(snapshots.map((snapshot) => snapshot.id)).toContain(reviewed.id);
    expect(readSnapshot(docPath, reviewed.id)).toBe("reviewed state");
    // The pin costs the next-oldest entry its slot rather than raising the cap.
    expect(readSnapshot(docPath, snapshots[snapshots.length - 2].id)).toBe(
      "burst 4",
    );
  });

  it("pins only the newest review snapshot, not every one", () => {
    const superseded = captureSnapshot(docPath, "first review", "review");
    const pinned = captureSnapshot(docPath, "second review", "review");
    if (!superseded || !pinned) throw new Error("expected two snapshots");

    for (let index = 0; index < MAX_SNAPSHOTS_PER_DOCUMENT; index += 1) {
      captureSnapshot(docPath, `burst ${index}`, "hook");
    }

    const surviving = ids(docPath);
    expect(surviving).toHaveLength(MAX_SNAPSHOTS_PER_DOCUMENT);
    expect(surviving).toContain(pinned.id);
    expect(surviving).not.toContain(superseded.id);
  });

  it("reports the snapshot it wrote even when pruning fails", () => {
    // Injected because an unlink failure inside a directory we just wrote to
    // is not reachable in-process; the point is that a pruning problem must
    // not be reported as "this save was not checkpointed".
    for (let index = 0; index < MAX_SNAPSHOTS_PER_DOCUMENT; index += 1) {
      captureSnapshot(docPath, `revision ${index}`, "hook");
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(fs, "rmSync").mockImplementation(() => {
      throw Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
    });

    const summary = captureSnapshot(docPath, "one too many", "hook");

    expect(summary?.trigger).toBe("hook");
    expect(warn).toHaveBeenCalled();
  });
});

describe("listSnapshots", () => {
  it("distinguishes an absent history from an unreadable one", () => {
    expect(listSnapshots(docPath)).toEqual({ status: "absent" });
  });

  it.skipIf(asRoot)("reports an unreadable history as an error", () => {
    captureSnapshot(docPath, "hello", "save");
    fs.chmodSync(historyDirFor(docPath), 0o000);
    try {
      expect(listSnapshots(docPath).status).toBe("error");
    } finally {
      fs.chmodSync(historyDirFor(docPath), 0o700);
    }
  });

  it("orders snapshots newest first", () => {
    const first = captureSnapshot(docPath, "one", "hook");
    const second = captureSnapshot(docPath, "two", "hook");
    const third = captureSnapshot(docPath, "three", "hook");

    expect(ids(docPath)).toEqual([third?.id, second?.id, first?.id]);
  });

  it("breaks a same-millisecond tie the way a filename sort does", () => {
    // The bash pruner walks `sort`ed filenames, so both implementations have to
    // agree on which of two same-instant snapshots is the older one.
    const lowPid = plantSnapshot(
      docPath,
      "2020-01-01T00-00-00-000Z--p10--save",
      "ten",
    );
    const highPid = plantSnapshot(
      docPath,
      "2020-01-01T00-00-00-000Z--p9--save",
      "nine",
    );

    expect(ids(docPath)).toEqual([highPid, lowPid]);
  });

  it("counts unparseable snapshot files instead of dropping them silently", () => {
    const kept = captureSnapshot(docPath, "hello", "save");
    fs.writeFileSync(path.join(historyDirFor(docPath), "handwritten.md"), "x");
    fs.writeFileSync(path.join(historyDirFor(docPath), "notes.txt"), "x");

    const listing = readableSnapshots(docPath);
    expect(listing.snapshots.map((snapshot) => snapshot.id)).toEqual([
      kept?.id,
    ]);
    expect(listing.unreadable).toBe(1);
  });

  it("skips anything that is not a regular file, without calling it unreadable", () => {
    const kept = captureSnapshot(docPath, "hello", "save");
    const directory = historyDirFor(docPath);
    fs.symlinkSync(
      path.join(projectDir, "nowhere"),
      path.join(directory, "2026-08-24T10-11-12-345Z--p1--save.md"),
    );
    fs.mkdirSync(path.join(directory, "2026-08-24T10-11-12-346Z--p1--save.md"));

    const listing = readableSnapshots(docPath);
    expect(listing.snapshots.map((snapshot) => snapshot.id)).toEqual([
      kept?.id,
    ]);
    expect(listing.unreadable).toBe(0);
  });

  it("skips a snapshot pruned between the listing and the stat", () => {
    // A concurrent prune by the bash hook must not inflate the "N unreadable"
    // count, which is meant to mean "someone is writing the wrong filenames".
    captureSnapshot(docPath, "hello", "save");
    vi.spyOn(fs, "lstatSync").mockImplementation(() => {
      throw Object.assign(new Error("ENOENT: no such file"), {
        code: "ENOENT",
      });
    });

    expect(readableSnapshots(docPath)).toMatchObject({
      snapshots: [],
      unreadable: 0,
    });
  });
});

describe("readSnapshot", () => {
  it("returns null for an unknown or malformed id", () => {
    captureSnapshot(docPath, "hello", "save");

    expect(readSnapshot(docPath, CANONICAL_ID)).toBeNull();
    expect(readSnapshot(docPath, "../../notes.md")).toBeNull();
  });

  it("refuses to read through a symlinked snapshot", () => {
    // Task 2 serves snapshot bytes over an unauthenticated route, so a planted
    // link must not turn it into a file-read primitive.
    const secret = path.join(projectDir, "secret.txt");
    fs.writeFileSync(secret, "not a snapshot");
    const directory = historyDirFor(docPath);
    fs.mkdirSync(directory, { recursive: true });
    const planted = "2026-08-24T10-11-12-345Z--p1--save";
    fs.symlinkSync(secret, path.join(directory, `${planted}.md`));

    expect(readSnapshot(docPath, planted)).toBeNull();
    expect(ids(docPath)).toEqual([]);
  });

  it("refuses to list through a symlinked history leaf directory", () => {
    // The write path refuses a symlinked leaf; a listing that followed one
    // would let a planted link serve chosen content as this document's history.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "rd-elsewhere-"));
    try {
      fs.writeFileSync(
        path.join(elsewhere, "2026-08-24T10-11-12-345Z--p1--save.md"),
        "planted",
      );
      const sidecar = path.join(projectDir, ".roughdraft-history", "v1");
      fs.mkdirSync(sidecar, { recursive: true });
      fs.symlinkSync(elsewhere, historyDirFor(docPath));

      const listing = listSnapshots(docPath);
      expect(listing.status).toBe("error");
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it.each([
    { level: "sidecar root", link: [".roughdraft-history"], inner: ["v1", "notes"] },
    { level: "version directory", link: [".roughdraft-history", "v1"], inner: ["notes"] },
  ])(
    "refuses to list through a symlinked $level",
    ({ link, inner }: { link: string[]; inner: string[] }) => {
      // The write path refuses a symlink at all three levels; a listing that
      // only checked the leaf would still serve a planted link's contents.
      const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "rd-elsewhere-"));
      try {
        const leaf = path.join(elsewhere, ...inner);
        fs.mkdirSync(leaf, { recursive: true });
        fs.writeFileSync(
          path.join(leaf, "2026-08-24T10-11-12-345Z--p1--save.md"),
          "planted",
        );
        const linkPath = path.join(projectDir, ...link);
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });
        fs.symlinkSync(elsewhere, linkPath);

        expect(listSnapshots(docPath).status).toBe("error");
      } finally {
        fs.rmSync(elsewhere, { recursive: true, force: true });
      }
    },
  );
});

describe("commitDocumentWrite", () => {
  it("writes the document and captures the new content under the given trigger", () => {
    commitDocumentWrite(docPath, "first draft", { trigger: "save" });

    expect(fs.readFileSync(docPath, "utf8")).toBe("first draft");
    const { snapshots } = readableSnapshots(docPath);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].trigger).toBe("save");
    expect(readSnapshot(docPath, snapshots[0].id)).toBe("first draft");
  });

  it("keeps the original bytes of a document it has never snapshotted", () => {
    // The first save of a document Roughdraft just opened: the caller's
    // `priorContent` matches disk, so nothing looks amiss — but this is the
    // pre-Roughdraft state, and the likeliest thing anyone will ask to recover.
    fs.writeFileSync(docPath, "original review content {>>keep me<<}");

    commitDocumentWrite(docPath, "edited", {
      priorContent: "original review content {>>keep me<<}",
      trigger: "save",
    });

    expect(contents(docPath)).toContain(
      "original review content {>>keep me<<}",
    );
  });

  it("captures the disk bytes as replaced when the caller vouches for nothing", () => {
    fs.writeFileSync(docPath, "on disk already");
    captureSnapshot(docPath, "something else entirely", "hook");

    const result = commitDocumentWrite(docPath, "next", { trigger: "save" });

    expect(result.preCapture?.trigger).toBe("replaced");
    expect(readSnapshot(docPath, result.preCapture?.id ?? "")).toBe(
      "on disk already",
    );
  });

  it("captures diverged disk bytes as replaced before overwriting them", () => {
    commitDocumentWrite(docPath, "ours", { trigger: "save" });
    fs.writeFileSync(docPath, "an agent wrote this");

    const result = commitDocumentWrite(docPath, "ours again", {
      priorContent: "ours",
      trigger: "save",
    });

    expect(result.preCapture?.trigger).toBe("replaced");
    expect(readSnapshot(docPath, result.preCapture?.id ?? "")).toBe(
      "an agent wrote this",
    );
    expect(fs.readFileSync(docPath, "utf8")).toBe("ours again");
    expect(
      readableSnapshots(docPath).snapshots.map((snapshot) => snapshot.trigger),
    ).toEqual(["save", "replaced", "save"]);
  });

  it("captures a clobber even while saves are being coalesced", () => {
    commitDocumentWrite(docPath, "ours", { trigger: "save" });
    commitDocumentWrite(docPath, "ours, edited", {
      priorContent: "ours",
      trigger: "save",
    });
    fs.writeFileSync(docPath, "an agent wrote this");

    const result = commitDocumentWrite(docPath, "ours, edited again", {
      priorContent: "ours, edited",
      trigger: "save",
    });

    expect(result.preCapture?.trigger).toBe("replaced");
    expect(readSnapshot(docPath, result.preCapture?.id ?? "")).toBe(
      "an agent wrote this",
    );
  });

  it("coalesces the steady state down to one snapshot", () => {
    commitDocumentWrite(docPath, "ours", { trigger: "save" });

    const result = commitDocumentWrite(docPath, "ours edited", {
      priorContent: "ours",
      trigger: "save",
    });

    expect(result.preCapture).toBeNull();
    expect(result.postCapture).toBeNull();
    expect(ids(docPath)).toHaveLength(1);
  });

  it("skips the replaced capture when the diverged bytes are already the newest snapshot", () => {
    captureSnapshot(docPath, "known", "hook");
    fs.writeFileSync(docPath, "known");

    const result = commitDocumentWrite(docPath, "next", { trigger: "save" });

    expect(result.preCapture).toBeNull();
    expect(ids(docPath)).toHaveLength(2);
  });

  it("dedups the post-capture against the newest snapshot", () => {
    commitDocumentWrite(docPath, "same", { trigger: "save" });

    const result = commitDocumentWrite(docPath, "same", {
      priorContent: "same",
      trigger: "save",
    });

    expect(result.postCapture).toBeNull();
    expect(ids(docPath)).toHaveLength(1);
  });

  it("promotes the newest snapshot when a review commit ties on content", () => {
    commitDocumentWrite(docPath, "same", { trigger: "save" });

    const result = commitDocumentWrite(docPath, "same", {
      priorContent: "same",
      trigger: "review",
    });

    const { snapshots } = readableSnapshots(docPath);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].trigger).toBe("review");
    expect(result.postCapture?.id).toBe(snapshots[0].id);
  });

  it.skipIf(asRoot)(
    "still writes the document when the history sidecar cannot be written",
    () => {
      const sidecar = path.join(projectDir, ".roughdraft-history");
      fs.mkdirSync(sidecar);
      fs.chmodSync(sidecar, 0o500);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const result = commitDocumentWrite(docPath, "survives", {
          trigger: "save",
        });

        expect(result.postCapture).toBeNull();
        expect(fs.readFileSync(docPath, "utf8")).toBe("survives");
        expect(warn).toHaveBeenCalled();
      } finally {
        fs.chmodSync(sidecar, 0o700);
      }
    },
  );

  it("crashes out of band rather than failing a write that already landed", () => {
    // The post-capture runs after the document is on disk, so a bug in the
    // store must not answer 500 to a save that succeeded — the client would
    // retry a write it already made.
    const deferred: Array<() => void> = [];
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((task) => {
      deferred.push(task);
    });
    vi.spyOn(fs, "readdirSync").mockImplementation(() => {
      throw new TypeError("readdirSync is not a function");
    });

    expect(() =>
      commitDocumentWrite(docPath, "landed", { trigger: "save" }),
    ).not.toThrow();

    expect(fs.readFileSync(docPath, "utf8")).toBe("landed");
    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toThrow(TypeError);
  });

  it.skipIf(asRoot)("propagates a failure to write the document itself", () => {
    const readOnlyDir = path.join(projectDir, "locked");
    fs.mkdirSync(readOnlyDir);
    fs.chmodSync(readOnlyDir, 0o500);

    try {
      expect(() =>
        commitDocumentWrite(path.join(readOnlyDir, "notes.md"), "nope", {
          trigger: "save",
        }),
      ).toThrow();
    } finally {
      fs.chmodSync(readOnlyDir, 0o700);
    }
  });
});

describe("atomicWriteFileSync", () => {
  it("replaces the file and leaves no temporary behind", () => {
    fs.writeFileSync(docPath, "before");

    atomicWriteFileSync(docPath, "after");

    expect(fs.readFileSync(docPath, "utf8")).toBe("after");
    expect(fs.readdirSync(projectDir)).toEqual(["notes.md"]);
  });

  it("preserves the mode of the file it replaces", () => {
    fs.writeFileSync(docPath, "before", { mode: 0o640 });
    fs.chmodSync(docPath, 0o640);

    atomicWriteFileSync(docPath, "after");

    expect(fs.statSync(docPath).mode & 0o777).toBe(0o640);
  });

  it("writes through a symlinked target rather than replacing the link", () => {
    // Renaming over the link would leave the reviewer editing a new file while
    // the document they opened keeps its old bytes, and report success.
    const outside = path.join(projectDir, "outside.md");
    fs.writeFileSync(outside, "before");
    const link = path.join(projectDir, "link.md");
    fs.symlinkSync(outside, link);

    atomicWriteFileSync(link, "written");

    expect(fs.readFileSync(outside, "utf8")).toBe("written");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it("writes through a hard-linked target rather than breaking the link", () => {
    const other = path.join(projectDir, "other.md");
    fs.writeFileSync(docPath, "before");
    fs.linkSync(docPath, other);

    atomicWriteFileSync(docPath, "written");

    expect(fs.readFileSync(other, "utf8")).toBe("written");
    expect(fs.statSync(docPath).nlink).toBe(2);
  });

  it.skipIf(asRoot)(
    "falls back to an in-place write when the directory forbids a temporary",
    () => {
      // A plain write to an already-writable file used to succeed here, and a
      // save that worked before this store existed must not start failing.
      const locked = path.join(projectDir, "locked");
      fs.mkdirSync(locked);
      const target = path.join(locked, "notes.md");
      fs.writeFileSync(target, "before");
      fs.chmodSync(locked, 0o555);

      try {
        atomicWriteFileSync(target, "written");
        expect(fs.readFileSync(target, "utf8")).toBe("written");
      } finally {
        fs.chmodSync(locked, 0o700);
      }
    },
  );

  it("refuses to write through a pre-existing temporary file", () => {
    const suffix = Buffer.from("0123456789abcdef", "hex");
    vi.spyOn(crypto, "randomBytes").mockReturnValue(
      suffix as unknown as ReturnType<typeof crypto.randomBytes>,
    );
    fs.writeFileSync(docPath, "before");
    const planted = path.join(
      projectDir,
      `.notes.md.tmp-${suffix.toString("hex")}`,
    );
    fs.writeFileSync(planted, "planted");

    expect(() => atomicWriteFileSync(docPath, "after")).toThrow(/EEXIST/);
    expect(fs.readFileSync(planted, "utf8")).toBe("planted");
    expect(fs.readFileSync(docPath, "utf8")).toBe("before");
  });

  it("leaves no temporary behind when the write fails", () => {
    fs.writeFileSync(docPath, "before");
    // A directory at the target path makes renameSync fail after the temp exists.
    const blocked = path.join(projectDir, "blocked.md");
    fs.mkdirSync(blocked);

    expect(() => atomicWriteFileSync(blocked, "content")).toThrow();
    expect(fs.readdirSync(projectDir).sort()).toEqual([
      "blocked.md",
      "notes.md",
    ]);
  });

  it("wakes an fs.watchFile watcher exactly once", async () => {
    fs.writeFileSync(docPath, "before");
    let fires = 0;
    const fired = new Promise<void>((resolve) => {
      fs.watchFile(docPath, { interval: 20 }, () => {
        fires += 1;
        resolve();
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 60));

    try {
      atomicWriteFileSync(docPath, "after the atomic write");
      await fired;
      await new Promise((resolve) => setTimeout(resolve, 120));
    } finally {
      fs.unwatchFile(docPath);
    }

    expect(fires).toBe(1);
  });
});
