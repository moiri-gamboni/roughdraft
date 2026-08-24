/**
 * Per-document revision history, stored as plain markdown copies beside the
 * document itself.
 *
 * The on-disk layout is a **format, not an API**: a bash hook in another repo
 * derives the same paths from a file path alone and prunes by the same rules,
 * so `<dirname>/.roughdraft-history/v1/<stem>/<id>.md`, the snapshot id
 * grammar, the content-only dedup and the count cap are all frozen. See
 * `docs/spec/history-sidecar.md`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type SnapshotTrigger = "save" | "review" | "replaced" | "hook";

export interface SnapshotSummary {
  id: string;
  createdAt: Date;
  trigger: SnapshotTrigger;
  bytes: number;
}

export type SnapshotListing =
  | { status: "absent" }
  | { status: "error"; reason: string }
  /** `unreadable` counts `.md` files whose name is not a snapshot id. */
  | { status: "ok"; snapshots: SnapshotSummary[]; unreadable: number };

export interface CommitDocumentWriteOptions {
  /** What the caller believes is on disk; anything else is captured first. */
  priorContent?: string;
  trigger: SnapshotTrigger;
}

export interface CommitDocumentWriteResult {
  preCapture: SnapshotSummary | null;
  postCapture: SnapshotSummary | null;
}

export const MAX_SNAPSHOTS_PER_DOCUMENT = 50;

const HISTORY_DIR_NAME = ".roughdraft-history";
const HISTORY_FORMAT_DIR_NAME = "v1";
const SNAPSHOT_ID_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z--p(\d+)--(save|review|replaced|hook)$/;
/** The canonical id is 44 characters at a 7-digit pid; the rest is slack. */
const MAX_SNAPSHOT_ID_LENGTH = 64;

/** `<dirname(document)>/.roughdraft-history/v1/<stem>/` */
export function historyDirFor(documentPath: string): string {
  return path.join(
    sidecarRootFor(documentPath),
    HISTORY_FORMAT_DIR_NAME,
    path.basename(documentPath, ".md"),
  );
}

export function parseSnapshotId(
  id: string,
): { createdAt: Date; pid: number; trigger: SnapshotTrigger } | null {
  if (id.length > MAX_SNAPSHOT_ID_LENGTH) return null;
  const match = SNAPSHOT_ID_PATTERN.exec(id);
  if (!match) return null;

  const [, year, month, day, hour, minute, second, ms, pid, trigger] = match;
  const createdAt = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`,
  );
  if (Number.isNaN(createdAt.getTime())) return null;

  return {
    createdAt,
    pid: Number(pid),
    trigger: trigger as SnapshotTrigger,
  };
}

/** Newest first. An absent history is empty; an unreadable one is an error. */
export function listSnapshots(documentPath: string): SnapshotListing {
  const directory = historyDirFor(documentPath);
  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "absent" };
    return { status: "error", reason: describeError(error) };
  }

  const snapshots: SnapshotSummary[] = [];
  let unreadable = 0;
  for (const entry of entries) {
    // Anything not named like a snapshot file (`.gitignore`, an abandoned
    // temporary) is none of our business; a `.md` we cannot parse is.
    if (!entry.endsWith(".md")) continue;
    const id = entry.slice(0, -".md".length);
    const parsed = parseSnapshotId(id);
    const stat = statOrNull(path.join(directory, entry));
    if (!parsed || !stat) {
      unreadable += 1;
      continue;
    }
    snapshots.push({
      id,
      createdAt: parsed.createdAt,
      trigger: parsed.trigger,
      bytes: stat.size,
    });
  }

  snapshots.sort((left, right) => {
    const byTime = right.createdAt.getTime() - left.createdAt.getTime();
    if (byTime !== 0) return byTime;
    // Same millisecond from two processes. Plain codepoint order, because the
    // bash pruner decides the same tie by sorting filenames — a locale-aware
    // comparison could disagree with it about which snapshot is the older one.
    return right.id > left.id ? 1 : -1;
  });
  return { status: "ok", snapshots, unreadable };
}

export function readSnapshot(documentPath: string, id: string): string | null {
  if (!parseSnapshotId(id)) return null;
  try {
    return fs.readFileSync(
      path.join(historyDirFor(documentPath), `${id}.md`),
      "utf8",
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

/**
 * Records `content` as the newest snapshot of `documentPath`, unless the
 * newest snapshot already holds it. Returns `null` — never throws — when the
 * history cannot be written, so a failing store can never fail a document
 * write.
 */
export function captureSnapshot(
  documentPath: string,
  content: string,
  trigger: SnapshotTrigger,
): SnapshotSummary | null {
  try {
    const directory = ensureHistoryDir(documentPath);
    if (!directory) return null;

    const newest = newestSnapshot(documentPath);
    if (newest && readSnapshot(documentPath, newest.id) === content) {
      return promoteToReview(directory, newest, trigger);
    }

    const summary = writeSnapshot(directory, content, trigger, newest);
    evictExcess(documentPath);
    return summary;
  } catch (error) {
    warn(`could not snapshot ${documentPath}: ${describeError(error)}`);
    return null;
  }
}

/**
 * The one way a live document is written: preserve whatever the write is about
 * to destroy, write atomically, then record the new state. Snapshot failures
 * are swallowed; failures of the document write itself propagate.
 */
export function commitDocumentWrite(
  documentPath: string,
  nextContent: string,
  options: CommitDocumentWriteOptions,
): CommitDocumentWriteResult {
  const preCapture = captureReplacedContent(documentPath, options.priorContent);
  atomicWriteFileSync(documentPath, nextContent);
  return {
    preCapture,
    postCapture: captureSnapshot(documentPath, nextContent, options.trigger),
  };
}

/**
 * Writes via a fresh temporary in the same directory, so a reader never sees a
 * half-written document and `fs.watchFile` sees exactly one change. The
 * temporary is created `O_EXCL` under an unguessable name: a planted path is an
 * error, never something we write through. Renaming over a symlinked target
 * replaces the link rather than following it.
 */
export function atomicWriteFileSync(targetPath: string, content: string): void {
  const suffix = crypto.randomBytes(8).toString("hex");
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.tmp-${suffix}`,
  );

  const handle = fs.openSync(tempPath, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(handle, content);
      const existing = statOrNull(targetPath);
      // Keep the document's own permissions; only the temporary is private.
      if (existing) fs.fchmodSync(handle, existing.mode & 0o777);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function sidecarRootFor(documentPath: string): string {
  return path.join(path.dirname(documentPath), HISTORY_DIR_NAME);
}

/**
 * Creates the sidecar levels that are missing, refusing to descend through a
 * symlink — otherwise anyone able to plant one turns a save into a write into
 * an arbitrary directory.
 */
function ensureHistoryDir(documentPath: string): string | null {
  const root = sidecarRootFor(documentPath);
  const leaf = historyDirFor(documentPath);
  for (const level of [root, path.join(root, HISTORY_FORMAT_DIR_NAME), leaf]) {
    const existing = lstatOrNull(level);
    if (existing?.isSymbolicLink()) {
      warn(`refusing to snapshot through the symlinked path ${level}`);
      return null;
    }
    if (!existing) fs.mkdirSync(level);
  }

  // One ignore file at the top covers the whole sidecar, and the bash hook
  // writes the same one — whichever writer gets there first. It must exist or
  // `git add -A` publishes content the author deleted and `git clean -fd`
  // deletes the history.
  const gitignore = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, "*\n");
  return leaf;
}

function newestSnapshot(documentPath: string): SnapshotSummary | undefined {
  const listing = listSnapshots(documentPath);
  return listing.status === "ok" ? listing.snapshots[0] : undefined;
}

/**
 * Content-only dedup already decided there is nothing new to store. A `review`
 * capture still has to leave a `review`-labelled newest entry behind, since
 * that label is what pins the reviewed state against eviction — so relabel the
 * existing file instead of duplicating it.
 */
function promoteToReview(
  directory: string,
  newest: SnapshotSummary,
  trigger: SnapshotTrigger,
): SnapshotSummary | null {
  if (trigger !== "review" || newest.trigger === "review") return null;

  // An id ends with its trigger; everything before it stays as it was, so the
  // promoted snapshot keeps its original creation time and position.
  const id = `${newest.id.slice(0, -newest.trigger.length)}review`;
  fs.renameSync(
    path.join(directory, `${newest.id}.md`),
    path.join(directory, `${id}.md`),
  );
  return { ...newest, id, trigger: "review" };
}

function writeSnapshot(
  directory: string,
  content: string,
  trigger: SnapshotTrigger,
  newest: SnapshotSummary | undefined,
): SnapshotSummary {
  // The id is what orders the history, so a capture is never stamped at or
  // before the snapshot it follows — several land in one millisecond, and a
  // pre-write `replaced` must not sort after the write that caused it.
  const earliest = newest ? newest.createdAt.getTime() + 1 : 0;
  const createdAt = new Date(Math.max(Date.now(), earliest));
  const id = formatSnapshotId(createdAt, process.pid, trigger);

  atomicWriteFileSync(path.join(directory, `${id}.md`), content);
  return { id, createdAt, trigger, bytes: Buffer.byteLength(content) };
}

function formatSnapshotId(
  createdAt: Date,
  pid: number,
  trigger: SnapshotTrigger,
): string {
  // 2026-08-24T10:11:12.345Z -> 2026-08-24T10-11-12-345Z, so the whole name is
  // shell- and path-safe and `date -u +%Y-%m-%dT%H-%M-%S-%3NZ` reproduces it.
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
  return `${stamp}--p${pid}--${trigger}`;
}

/** Oldest first, but the newest `review` entry keeps its slot. */
function evictExcess(documentPath: string): void {
  const listing = listSnapshots(documentPath);
  if (listing.status !== "ok") return;
  const excess = listing.snapshots.length - MAX_SNAPSHOTS_PER_DOCUMENT;
  if (excess <= 0) return;

  const pinnedId = listing.snapshots.find(
    (snapshot) => snapshot.trigger === "review",
  )?.id;
  const directory = historyDirFor(documentPath);
  const evictable = listing.snapshots
    .filter((snapshot) => snapshot.id !== pinnedId)
    .reverse();
  for (const snapshot of evictable.slice(0, excess)) {
    fs.rmSync(path.join(directory, `${snapshot.id}.md`), { force: true });
  }
}

function captureReplacedContent(
  documentPath: string,
  priorContent: string | undefined,
): SnapshotSummary | null {
  let current: string;
  try {
    current = fs.readFileSync(documentPath, "utf8");
  } catch (error) {
    // A document that does not exist yet has nothing to preserve.
    if (errorCode(error) !== "ENOENT") {
      warn(
        `could not read ${documentPath} before writing it: ${describeError(error)}`,
      );
    }
    return null;
  }
  if (current === priorContent) return null;
  // Bytes nobody claims to have written: capture them before they are gone.
  // The content dedup drops this again if it is already the newest snapshot.
  return captureSnapshot(documentPath, current, "replaced");
}

function statOrNull(target: string): fs.Stats | null {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function warn(message: string): void {
  console.warn(`[roughdraft:history] ${message}`);
}
