import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearDraft,
  type DraftKey,
  type DraftRecord,
  draftKeyFromUrl,
  getDraftStorage,
  logDraftEvent,
  readDraft,
  updateBase,
  writeDraft,
  writeSessionPointer,
} from "./draft-store";
import { nextRetryDelayMs } from "./save-recovery";
import type { DocumentDiskChangeState } from "./storage";

export interface DraftPersistenceOptions {
  /**
   * Deliver the given content to the destination. Rejecting arms the retry, so
   * the caller must reject for anything it wants retried and settle anything
   * it wants owned elsewhere (a real conflict, for instance).
   */
  save: (content: string) => Promise<void>;
  /**
   * The retry shares the save schedule with the editor's debounce and with the
   * disk-conflict banner, so it has to be able to read that state and stand
   * down while the document is not clean.
   */
  getDiskChangeState: () => DocumentDiskChangeState;
}

export interface DraftPersistence {
  /** The document's durable destination, or null when there is none. */
  getKey(): DraftKey | null;
  read(): DraftRecord | null;
  /** Write a genuine edit through synchronously. */
  recordLocalContent(content: string, baseContent: string | null): void;
  /**
   * Settle after a save landed: clear the record when nothing newer is owed,
   * otherwise keep the newer content and only move the base forward. Also ends
   * any retry in flight, because the destination is now up to date.
   */
  noteSaveSuccess(savedContent: string): void;
  /** Arm the retry after a delivery failure worth retrying. */
  noteSaveFailure(): void;
  /** Stand down a scheduled retry that a fresher save supersedes. */
  cancelRetry(): void;
  /** Retry immediately instead of waiting out the backoff. */
  retryNow(): void;
  discard(): void;
  /** Bind a remote session id to its origin file so the draft outlives it. */
  resolveRemoteKey(sessionId: string, originPath: string): DraftKey | null;
}

/**
 * Owns the browser-side draft cell for the open document, and the retry that
 * gets its contents to the destination once the destination comes back.
 *
 * The API object is identity-stable and imperative: every caller is an effect
 * or an event handler, so re-rendering on a keystroke would buy nothing.
 * `retryPending` is separate precisely because it *is* rendered.
 */
export function useDraftPersistence({
  save,
  getDiskChangeState,
}: DraftPersistenceOptions): {
  draft: DraftPersistence;
  retryPending: boolean;
} {
  const [storage] = useState(getDraftStorage);
  const [initialKey] = useState(() => draftKeyFromUrl(storage));
  const keyRef = useRef(initialKey);
  const holdsUnsentRef = useRef(false);
  const [retryPending, setRetryPending] = useState(false);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);

  const saveRef = useRef(save);
  saveRef.current = save;
  const diskChangeStateRef = useRef(getDiskChangeState);
  diskChangeStateRef.current = getDiskChangeState;

  const draft = useMemo<DraftPersistence>(() => {
    function currentKey() {
      return keyRef.current;
    }

    function currentRecord() {
      const key = currentKey();
      return key ? readDraft(storage, key.key) : null;
    }

    function cancelRetry() {
      if (retryTimerRef.current === null) return;
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    function settleRetry() {
      cancelRetry();
      retryAttemptRef.current = 0;
      setRetryPending(false);
    }

    function scheduleRetry() {
      cancelRetry();
      retryAttemptRef.current += 1;
      setRetryPending(true);

      const delayMs = nextRetryDelayMs(retryAttemptRef.current);
      logDraftEvent("retry-scheduled", {
        attempt: retryAttemptRef.current,
        delayMs,
      });
      retryTimerRef.current = window.setTimeout(runRetry, delayMs);
    }

    async function runRetry() {
      retryTimerRef.current = null;

      // The disk-conflict banner and the editor's debounce own the save
      // schedule while the document is not clean; re-armed by `retryNow` once
      // it is.
      const diskChangeState = diskChangeStateRef.current();
      if (diskChangeState !== "clean") {
        logDraftEvent("retry-deferred", { diskChangeState });
        return;
      }

      const content = currentRecord()?.content;
      if (content === undefined) {
        settleRetry();
        return;
      }

      try {
        await saveRef.current(content);
        logDraftEvent("retry-succeeded");
      } catch {
        scheduleRetry();
      }
    }

    function clear(reason: string) {
      const key = currentKey();
      if (!key) return;
      clearDraft(storage, key.key);
      if (!holdsUnsentRef.current) return;
      holdsUnsentRef.current = false;
      logDraftEvent(reason, { key: key.key });
    }

    return {
      getKey: currentKey,
      read: currentRecord,

      recordLocalContent: (content, baseContent) => {
        const key = currentKey();
        if (!key) return;

        if (!writeDraft(storage, key.key, { content, baseContent })) {
          logDraftEvent("write-refused", { key: key.key });
          return;
        }
        // Log the edge, not every keystroke: the decision is "this document
        // now holds unsent work", which happens once per outage.
        if (holdsUnsentRef.current) return;
        holdsUnsentRef.current = true;
        logDraftEvent("unsent", { key: key.key });
      },

      noteSaveSuccess: (savedContent) => {
        settleRetry();
        const key = currentKey();
        if (!key) return;

        const record = readDraft(storage, key.key);
        if (!record || record.content === savedContent) {
          clear("cleared");
          return;
        }
        updateBase(storage, key.key, savedContent);
      },

      noteSaveFailure: scheduleRetry,
      cancelRetry,
      retryNow: () => {
        cancelRetry();
        void runRetry();
      },
      discard: () => {
        settleRetry();
        clear("discarded");
      },

      resolveRemoteKey: (sessionId, originPath) => {
        writeSessionPointer(storage, sessionId, originPath);
        keyRef.current = draftKeyFromUrl(storage);
        return keyRef.current;
      },
    };
  }, [storage]);

  useEffect(() => () => draft.cancelRetry(), [draft]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (retryTimerRef.current === null) return;
      draft.retryNow();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [draft]);

  return { draft, retryPending };
}
