/**
 * Pure recovery policy for unsent browser edits.
 *
 * These functions decide *what* should happen; the App owns the effects. They
 * take plain strings so the interesting cases can be written as literals.
 */

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/** Backoff for the save retry loop: 1s, 2s, 4s, 8s, then 15s forever. */
export function nextRetryDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1) - 1, RETRY_DELAYS_MS.length - 1);
  return RETRY_DELAYS_MS[index];
}

export interface DraftSnapshot {
  content: string;
  baseContent: string;
  baseKnown: boolean;
}

export type DraftMode = "local" | "remote";

export type RestoreDecision = "nothing" | "silent" | "ask";

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
  if (!draft.baseKnown) return "ask";

  // Remote "disk content" is the server's RAM, not the origin file, so a
  // matching base is not enough evidence to restore without asking.
  if (mode === "remote") return "ask";

  return draft.baseContent === diskContent ? "silent" : "ask";
}

export type ConflictResolution = "already-applied" | "base-unchanged" | "real";

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
