/**
 * The durable cell that holds a document's unsent browser edits.
 *
 * One synchronous `localStorage` record per document. Keys are derived from the
 * URL, never from a live backend, so recovery still works on a boot where the
 * backend cannot be constructed at all.
 */

import { getRequestedPathState, joinPath } from "./app-navigation";
import type { DraftMode, DraftSnapshot } from "./save-recovery";

export const DRAFT_KEY_PREFIX = "roughdraft:draft:v1:";
const SESSION_POINTER_PREFIX = `${DRAFT_KEY_PREFIX}session:`;
const RECORD_PREFIXES = [
  `${DRAFT_KEY_PREFIX}file:`,
  `${DRAFT_KEY_PREFIX}origin:`,
];
const DRAFT_SCHEMA = 1;

export interface DraftRecord extends DraftSnapshot {
  updatedAt: number;
}

export interface DraftKey {
  key: string;
  mode: DraftMode;
}

/** One line per persistence decision; the e2e suite waits on these. */
export function logDraftEvent(
  event: string,
  detail?: Record<string, unknown>,
): void {
  console.info(
    detail
      ? `[roughdraft:draft] ${event} ${JSON.stringify(detail)}`
      : `[roughdraft:draft] ${event}`,
  );
}

/**
 * Some browsers throw on `localStorage` access itself in private mode, so the
 * whole feature is guarded here once and every other function takes `null`.
 */
export function getDraftStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sessionIdFromUrl(): string | null {
  const session = new URLSearchParams(window.location.search)
    .get("session")
    ?.trim();
  return session ? session : null;
}

/**
 * Resolve the draft destination straight from the URL.
 *
 * Remote sessions key on the origin file path rather than the session id, so a
 * draft survives the server restarting and the CLI re-registering.
 */
export function draftKeyFromUrl(storage: Storage | null): DraftKey | null {
  const sessionId = sessionIdFromUrl();
  if (sessionId) {
    const originPath = storage?.getItem(
      `${SESSION_POINTER_PREFIX}${sessionId}`,
    );
    if (!originPath) return null;
    return { key: `${DRAFT_KEY_PREFIX}origin:${originPath}`, mode: "remote" };
  }

  const { projectPath, documentPath } = getRequestedPathState();
  if (!projectPath || !documentPath) return null;

  return {
    key: `${DRAFT_KEY_PREFIX}file:${joinPath(projectPath, documentPath)}`,
    mode: "local",
  };
}

/**
 * Remember which origin file a session id stands for, so a draft written under
 * that session is still reachable on the next boot before any backend exists.
 *
 * The caller passes the origin the server reported for the live session, which
 * is authoritative: session ids get reused, and a stale mapping would point
 * this document's draft at a different document's record. Unchanged mappings
 * are left alone so a normal boot does not write.
 */
export function writeSessionPointer(
  storage: Storage | null,
  sessionId: string,
  originPath: string,
): void {
  if (!storage) return;
  const pointerKey = `${SESSION_POINTER_PREFIX}${sessionId}`;
  if (storage.getItem(pointerKey) === originPath) return;
  guardedSetItem(storage, pointerKey, originPath);
}

export function readDraft(
  storage: Storage | null,
  key: string,
): DraftRecord | null {
  const raw = storage?.getItem(key);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A record we cannot read is still not ours to delete.
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Partial<DraftRecord> & { schema?: unknown };
  if (typeof record.content !== "string") return null;

  // An unknown schema — or a record whose base is missing or malformed — keeps
  // its content but loses its base, which routes the decision through the
  // explicit "ask" branch instead of destroying the draft.
  const baseContent =
    record.schema === DRAFT_SCHEMA && typeof record.baseContent === "string"
      ? record.baseContent
      : null;

  return {
    content: record.content,
    baseContent,
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

/**
 * Write the draft through synchronously. Returns false when the browser
 * refused to store it, so the caller can say so rather than assume durability.
 */
export function writeDraft(
  storage: Storage | null,
  key: string,
  { content, baseContent }: { content: string; baseContent: string | null },
): boolean {
  if (!storage) return false;
  return guardedSetItem(
    storage,
    key,
    serialize({ content, baseContent, updatedAt: Date.now() }),
  );
}

/**
 * Move the record's base forward after a successful save without touching the
 * content, which may already have advanced past what was saved.
 */
export function updateBase(
  storage: Storage | null,
  key: string,
  baseContent: string | null,
): void {
  if (!storage) return;
  const existing = readDraft(storage, key);
  if (!existing) return;

  guardedSetItem(
    storage,
    key,
    serialize({
      content: existing.content,
      baseContent,
      updatedAt: Date.now(),
    }),
  );
}

export function clearDraft(storage: Storage | null, key: string): void {
  storage?.removeItem(key);
}

function serialize(record: DraftRecord): string {
  return JSON.stringify({ schema: DRAFT_SCHEMA, ...record });
}

function guardedSetItem(storage: Storage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    if (!evictOldestRecord(storage, key)) return false;
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Free space by dropping the least recently updated *other* draft. Exactly one
 * eviction per write: emptying the shelf to fit one record would destroy the
 * unsent work this store exists to protect.
 */
function evictOldestRecord(storage: Storage, exceptKey: string): boolean {
  let oldestKey: string | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;

  for (let index = 0; index < storage.length; index += 1) {
    const candidate = storage.key(index);
    if (!candidate || candidate === exceptKey) continue;
    if (!RECORD_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
      continue;
    }

    const updatedAt = readDraft(storage, candidate)?.updatedAt ?? 0;
    if (updatedAt < oldestAt) {
      oldestAt = updatedAt;
      oldestKey = candidate;
    }
  }

  if (!oldestKey) return false;
  storage.removeItem(oldestKey);
  logDraftEvent("evicted", { key: oldestKey });
  return true;
}
