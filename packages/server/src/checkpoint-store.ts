/**
 * Per-document revision history, stored as plain markdown copies beside the
 * document itself.
 *
 * The on-disk layout is a **format, not an API**: a bash hook in another repo
 * derives the same paths from a file path alone and prunes by the same rules,
 * so `<dirname>/.roughdraft-history/v1/<stem>/<id>.md`, the snapshot id
 * grammar, the content-only dedup and the count cap are all frozen. The
 * normative description is `docs/spec/history-sidecar.md` (written alongside
 * the rest of the feature's documentation).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Part of the frozen format, so adding a value is a format change. Declared
 * three times over: here, as `SnapshotTrigger` in `packages/app/src/storage.ts`
 * (the app cannot import this package), and as the trigger table in
 * `docs/spec/history-sidecar.md`, which the bash hook is written against.
 */
export type SnapshotTrigger = "save" | "review" | "replaced" | "hook";

export interface SnapshotSummary {
  id: string;
  createdAt: Date;
  trigger: SnapshotTrigger;
  bytes: number;
}

type SnapshotListing =
  | { status: "absent" }
  | { status: "error"; reason: string }
  /** `unreadable` counts `.md` files whose name is not a snapshot id. */
  | { status: "ok"; snapshots: SnapshotSummary[]; unreadable: number };

interface CommitDocumentWriteOptions {
  /** What the caller believes is on disk; anything else is captured first. */
  priorContent?: string;
  trigger: SnapshotTrigger;
}

interface CommitDocumentWriteResult {
  preCapture: SnapshotSummary | null;
  postCapture: SnapshotSummary | null;
}

export const MAX_SNAPSHOTS_PER_DOCUMENT = 50;

/** The sidecar directory name, and so the path segment routes must refuse. */
export const HISTORY_DIR_NAME = ".roughdraft-history";
const HISTORY_FORMAT_DIR_NAME = "v1";
const SNAPSHOT_ID_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z--p(\d+)--(save|review|replaced|hook)$/;
/** The canonical id is 44 characters at a 7-digit pid; the rest is slack. */
const MAX_SNAPSHOT_ID_LENGTH = 64;
/**
 * Consecutive `save` snapshots inside this window fold into the first one.
 * The app autosaves 500ms after the last keystroke, so without this the fifty
 * slots hold a few minutes of typing and evict the clobber they exist to keep.
 * The bash hook debounces by the same amount.
 */
const SAVE_COALESCE_WINDOW_MS = 90_000;
/** Directory permissions that stop a temporary being created, but not a write. */
const IN_PLACE_WRITE_CODES = ["EACCES", "EPERM", "EROFS"];

/**
 * Snapshots are `.md` files inside the project, so without this they would be
 * openable, savable and reviewable as documents — and each write would start a
 * history of the history. Every resolver that turns caller input into a
 * document path shares this one, so none of them can be the one that forgot.
 *
 * Case-insensitively, because on a case-insensitive filesystem a shifted
 * segment still resolves to the real sidecar.
 */
export function refusesHistorySegment(absolutePath: string): boolean {
  return absolutePath
    .split(path.sep)
    .some((segment) => segment.toLowerCase() === HISTORY_DIR_NAME);
}

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

  const [, year, month, day, hour, minute, second, ms, digits, name] = match;
  const createdAt = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`,
  );
  if (Number.isNaN(createdAt.getTime())) return null;

  const pid = Number(digits);
  const trigger = name as SnapshotTrigger;
  // `2026-02-30T…` is not an invalid date, it is March 2nd. Insisting the id
  // round-trips rejects every such rollover, which is what lets the rest of
  // this module treat codepoint order on ids as chronological order.
  if (formatSnapshotId(createdAt, pid, trigger) !== id) return null;

  return { createdAt, pid, trigger };
}

/**
 * Newest first. An absent history is not an error — it reads the same to a
 * consumer as an `ok` listing with no snapshots, and neither deserves its own
 * empty state. An unreadable directory is an error, because that is a
 * different fact. `reason` carries a raw fs message including the absolute
 * path: log it, never put it in an HTTP body.
 */
export function listSnapshots(documentPath: string): SnapshotListing {
  const directory = historyDirFor(documentPath);
  // The write path refuses to descend through a symlinked sidecar at any of its
  // three levels; a listing that only checked the leaf would still let a link
  // planted higher up serve chosen "snapshots".
  for (const level of sidecarLevelsFor(documentPath)) {
    const levelStat = lstatOrNull(level);
    if (levelStat && !levelStat.isDirectory()) {
      return { status: "error", reason: `${level} is not a directory` };
    }
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(directory);
  } catch (error) {
    assertFilesystemFailure(error);
    if (errorCode(error) === "ENOENT") return { status: "absent" };
    return { status: "error", reason: describeError(error) };
  }

  const snapshots: SnapshotSummary[] = [];
  let unreadable = 0;
  for (const entry of entries) {
    // Anything not named like a snapshot file (`.gitignore`, an abandoned
    // temporary) is none of our business; a `.md` we cannot parse is.
    if (!entry.endsWith(".md")) continue;
    const stat = lstatOrNull(path.join(directory, entry));
    // Gone since the readdir — a concurrent prune, not grammar drift. A
    // symlink or a directory is not a snapshot either, and following one is
    // how a planted link turns the history route into a file reader.
    if (!stat?.isFile()) continue;

    const id = entry.slice(0, -".md".length);
    const parsed = parseSnapshotId(id);
    if (!parsed) {
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

  // Every id that parses has a fixed-width zero-padded timestamp, so codepoint
  // order is time order — the same order the bash pruner gets by sorting
  // filenames under `LC_ALL=C`. One rule, so the two cannot disagree about
  // which snapshot is the oldest and therefore the next to be deleted.
  snapshots.sort((left, right) => (right.id > left.id ? 1 : -1));
  return { status: "ok", snapshots, unreadable };
}

export function readSnapshot(documentPath: string, id: string): string | null {
  if (!parseSnapshotId(id)) return null;
  const target = path.join(historyDirFor(documentPath), `${id}.md`);

  let handle: number;
  try {
    handle = fs.openSync(target, fs.constants.O_RDONLY | noFollow());
  } catch (error) {
    const code = errorCode(error);
    // ELOOP is a symlink where a snapshot should be: as good as not there.
    if (code === "ENOENT" || code === "ELOOP") return null;
    throw error;
  }
  try {
    return fs.readFileSync(handle, "utf8");
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Records `content` as the newest snapshot of `documentPath`, unless the
 * newest snapshot already holds it. Returns `null` — never for an I/O reason
 * throws — when there was nothing to store or the history could not be
 * written, so a failing store can never fail a document write.
 */
export function captureSnapshot(
  documentPath: string,
  content: string,
  trigger: SnapshotTrigger,
): SnapshotSummary | null {
  try {
    const directory = ensureHistoryDir(documentPath);
    if (!directory) return null;
    return capture(documentPath, directory, content, trigger);
  } catch (error) {
    assertFilesystemFailure(error);
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
    postCapture: capturePostWrite(documentPath, nextContent, options.trigger),
  };
}

/**
 * The document is already on disk by the time this runs, so a bug in the store
 * must not come back out of the write: the caller would answer 500 and the
 * client would retry a save that landed. Rethrowing from a microtask still
 * crashes the process as loudly, just not through the write's return path.
 */
function capturePostWrite(
  documentPath: string,
  content: string,
  trigger: SnapshotTrigger,
): SnapshotSummary | null {
  try {
    return captureSnapshot(documentPath, content, trigger);
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
    return null;
  }
}

/**
 * Writes via a fresh temporary in the same directory, so a reader never sees a
 * half-written document and `fs.watchFile` sees exactly one change. The
 * temporary is created `O_EXCL` under an unguessable name: a planted path is an
 * error, never something we write through. Renaming over a symlinked target
 * replaces the link rather than following it.
 */
export function atomicWriteFileSync(targetPath: string, content: string): void {
  // A rename would replace a symlink with a regular file and break a hard
  // link, so the name the caller was given would quietly stop being the file
  // they meant to edit. A snapshot never takes this path: its target is a fresh
  // id that does not exist yet.
  const target = lstatOrNull(targetPath);
  if (target?.isSymbolicLink() || (target?.isFile() && target.nlink > 1)) {
    fs.writeFileSync(targetPath, content);
    return;
  }

  const suffix = crypto.randomBytes(8).toString("hex");
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.tmp-${suffix}`,
  );

  let handle: number;
  try {
    handle = fs.openSync(tempPath, "wx", 0o600);
  } catch (error) {
    // A temporary needs write permission on the directory, which a plain write
    // to an already-writable file does not. Failing here would refuse a save
    // that succeeded before this writer existed.
    if (!IN_PLACE_WRITE_CODES.includes(errorCode(error) ?? "")) throw error;
    fs.writeFileSync(targetPath, content);
    return;
  }
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

function capture(
  documentPath: string,
  directory: string,
  content: string,
  trigger: SnapshotTrigger,
): SnapshotSummary | null {
  const listing = listSnapshots(documentPath);
  if (listing.status === "error") {
    // Reading an unlistable directory as an empty one disables dedup,
    // coalescing and pruning at once: every save would write a fresh copy of
    // identical bytes, for ever, into a directory nobody can read.
    warn(`could not list the history of ${documentPath}: ${listing.reason}`);
    return null;
  }
  const previous = listing.status === "ok" ? listing.snapshots : [];
  const newest = previous[0];

  if (newest && snapshotHolds(documentPath, newest, content)) {
    return promoteToReview(directory, newest, trigger);
  }
  if (coalescesWith(newest, trigger)) return null;

  const summary = writeSnapshot(directory, content, trigger, newest);
  if (!summary) return null;
  try {
    pruneExcess(directory, previous, summary);
  } catch (error) {
    // The snapshot is on disk; only the pruning failed. Reporting that as a
    // failed capture would tell the caller its save went unrecorded.
    warn(`could not prune ${documentPath}: ${describeError(error)}`);
  }
  return summary;
}

function sidecarRootFor(documentPath: string): string {
  return path.join(path.dirname(documentPath), HISTORY_DIR_NAME);
}

/**
 * Root, version directory, leaf — the three levels both the write path and the
 * listing refuse to descend through a symlink, kept in one place so the two
 * cannot come to cover different depths.
 */
function sidecarLevelsFor(documentPath: string): string[] {
  const root = sidecarRootFor(documentPath);
  return [
    root,
    path.join(root, HISTORY_FORMAT_DIR_NAME),
    historyDirFor(documentPath),
  ];
}

/**
 * Creates the sidecar levels that are missing, refusing to descend through a
 * symlink — otherwise anyone able to plant one turns a save into a write into
 * an arbitrary directory.
 */
function ensureHistoryDir(documentPath: string): string | null {
  const root = sidecarRootFor(documentPath);
  const leaf = historyDirFor(documentPath);
  for (const level of sidecarLevelsFor(documentPath)) {
    const existing = lstatOrNull(level);
    if (existing?.isSymbolicLink()) {
      warn(`refusing to snapshot through the symlinked path ${level}`);
      return null;
    }
    // `recursive` for its tolerance of an existing directory, not its depth:
    // five writers race to create this, and the loser's `EEXIST` would cost
    // the document its very first snapshot.
    if (!existing) fs.mkdirSync(level, { recursive: true });
  }

  // One ignore file at the top covers the whole sidecar, and the bash hook
  // writes the same one — whichever writer gets there first. It must exist or
  // `git add -A` publishes content the author deleted and `git clean -fd`
  // deletes the history.
  const gitignore = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, "*\n");
  return leaf;
}

function snapshotHolds(
  documentPath: string,
  newest: SnapshotSummary,
  content: string,
): boolean {
  // Size first: reading the whole snapshot back is the expensive half, and
  // this runs on the event loop at the autosave cadence.
  if (newest.bytes !== Buffer.byteLength(content)) return false;
  return readSnapshot(documentPath, newest.id) === content;
}

function coalescesWith(
  newest: SnapshotSummary | undefined,
  trigger: SnapshotTrigger,
): boolean {
  // Only an ordinary save folds into an ordinary save. A `replaced` is the
  // record of someone else's write, a `review` is the state being pinned, and
  // a `hook` comes from the other implementation — none may be dropped.
  if (trigger !== "save" || newest?.trigger !== "save") return false;
  return Date.now() - newest.createdAt.getTime() < SAVE_COALESCE_WINDOW_MS;
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
): SnapshotSummary | null {
  // The id is what orders the history, so a capture is never stamped at or
  // before the snapshot it follows — several land in one millisecond, and a
  // pre-write `replaced` must not sort after the write that caused it.
  const earliest = newest ? newest.createdAt.getTime() + 1 : 0;
  const createdAt = new Date(Math.max(Date.now(), earliest));
  const id = formatSnapshotId(createdAt, process.pid, trigger);
  if (!parseSnapshotId(id)) {
    // Past the year 9999 `toISOString` switches to expanded-year form, which
    // the grammar rejects. Writing it would produce a file this module cannot
    // see, and then a new one on every save for ever.
    warn(`refusing to write a snapshot named ${id}: it is not a snapshot id`);
    return null;
  }

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
function pruneExcess(
  directory: string,
  previous: SnapshotSummary[],
  added: SnapshotSummary,
): void {
  // `added` is newest by construction, so this is the listing after the write
  // without paying for a second one.
  const snapshots = [added, ...previous];
  const excess = snapshots.length - MAX_SNAPSHOTS_PER_DOCUMENT;
  if (excess <= 0) return;

  const pinnedId = snapshots.find(
    (snapshot) => snapshot.trigger === "review",
  )?.id;
  const evictable = snapshots
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

  // `priorContent` is the caller vouching for these bytes — nobody else wrote
  // them, so there is nothing to preserve. That holds only once the history
  // has something in it: with an empty history these are the document's
  // original bytes, which no snapshot records and which are the likeliest
  // thing anyone will ever ask to recover.
  if (current === priorContent && hasSnapshots(documentPath)) return null;

  // Bytes nobody claims to have written: capture them before they are gone.
  // The content dedup drops this again if it is already the newest snapshot.
  return captureSnapshot(documentPath, current, "replaced");
}

function hasSnapshots(documentPath: string): boolean {
  const listing = listSnapshots(documentPath);
  return listing.status === "ok" && listing.snapshots.length > 0;
}

/** `O_NOFOLLOW` is POSIX-only; where it does not exist the flag is a no-op. */
function noFollow(): number {
  return fs.constants.O_NOFOLLOW ?? 0;
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

/**
 * Every filesystem failure carries an errno. Anything without one is this
 * module broken rather than the disk misbehaving, and swallowing that would
 * hide a bug behind "the history is unavailable" on a server nobody tails.
 */
function assertFilesystemFailure(error: unknown): void {
  if (errorCode(error) === undefined) throw error;
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
