/**
 * Pure recovery policy for unsent browser edits.
 *
 * These functions decide *what* should happen; the App owns the effects. They
 * take plain strings so the interesting cases can be written as literals.
 */

import type { DocumentDiskChangeState } from "./storage";

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/** Backoff for the save retry loop: 1s, 2s, 4s, 8s, then 15s forever. */
export function nextRetryDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1) - 1, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

export interface DraftSnapshot {
  content: string;
  /** The text this draft was edited from, or null when that is unknown. */
  baseContent: string | null;
}

export type DraftMode = "local" | "remote";

type RestoreDecision = "nothing" | "silent" | "ask";

/**
 * Decide what to do with a stored draft once the document has loaded.
 *
 * Comparison is by content, never by version: versions do not survive the
 * reload and re-registration events this feature exists for.
 */
export function resolveRestore({
  draft,
  diskContent,
  mode,
}: {
  draft: DraftSnapshot | null;
  diskContent: string;
  mode: DraftMode;
}): RestoreDecision {
  if (!draft) return "nothing";
  if (draft.content === diskContent) return "nothing";
  if (draft.baseContent === null) return "ask";

  // Remote "disk content" is the server's RAM, not the origin file, so a
  // matching base is not enough evidence to restore without asking.
  if (mode === "remote") return "ask";

  return draft.baseContent === diskContent ? "silent" : "ask";
}

type ConflictResolution = "already-applied" | "base-unchanged" | "real";

/**
 * Classify a save conflict reported by the backend.
 *
 * - `already-applied`: the destination already holds exactly what we sent and
 *   the editor still shows it, so the write landed and only the version token
 *   went stale.
 * - `base-unchanged`: the destination still holds the text our draft was based
 *   on, so nothing was lost and the write can be re-sent with a fresh version.
 * - `real`: someone else's text is there; the user has to decide.
 */
export function resolveConflict({
  attemptedContent,
  currentContent,
  draftBaseContent,
  editorContent,
}: {
  attemptedContent: string;
  currentContent: string;
  draftBaseContent: string | null;
  editorContent: string;
}): ConflictResolution {
  if (currentContent === attemptedContent && currentContent === editorContent) {
    return "already-applied";
  }
  if (draftBaseContent !== null && currentContent === draftBaseContent) {
    return "base-unchanged";
  }
  return "real";
}

/**
 * What a file-watcher event means for the open document.
 *
 * - `ignore`: nothing to do — the write was ours, or the document is already in
 *   a state the reviewer has to resolve.
 * - `flag-changed`: raise the disk-change banner and pause autosave.
 * - `reload`: nothing local is at stake, so take the file's content.
 */
export type DiskChangeDecision = "ignore" | "flag-changed" | "reload";

/**
 * Decide what a watcher event means, given everything the session knows about
 * its own writes.
 *
 * Callers must settle the saves already in flight before asking. A write of
 * ours reaches the watcher before the save that caused it reports its version,
 * and an echo judged too early looks exactly like somebody else's edit — which
 * pauses autosave over our own work. Waiting is also why `savedVersions` is a
 * list: by the time an echo is judged, later writes may already have moved the
 * document on, so the newest version alone does not identify it.
 */
export function resolveDiskChange({
  event,
  documentVersion,
  savedVersions,
  dirty,
  diskChangeState,
  contentRestorePending,
}: {
  event: { exists: boolean; version: string | null };
  documentVersion: string | null;
  /** Every version this session has written, newest last. */
  savedVersions: readonly string[];
  dirty: boolean;
  diskChangeState: DocumentDiskChangeState;
  contentRestorePending: boolean;
}): DiskChangeDecision {
  if (
    event.version &&
    (event.version === documentVersion || savedVersions.includes(event.version))
  ) {
    return "ignore";
  }

  // An unsent draft is waiting on the reviewer; neither reloading over it nor
  // relabelling the banner would help them decide.
  if (diskChangeState === "draft-restore") return "ignore";

  // A restore in flight looks exactly like unsaved local work, and pausing
  // autosave over it would strand the very edits being restored. The save
  // carries the loaded version, so a genuinely changed file still comes back as
  // a conflict.
  if (contentRestorePending) return "ignore";

  if (!event.exists) return "flag-changed";
  if (diskChangeState === "paused") return "ignore";
  if (dirty) return "flag-changed";
  return "reload";
}
