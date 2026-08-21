import { useMemo, useRef, useState } from "react";
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

export interface DraftPersistence {
  /** The document's durable destination, or null when there is none. */
  getKey(): DraftKey | null;
  read(): DraftRecord | null;
  /** Write a genuine edit through synchronously. */
  recordLocalContent(content: string, baseContent: string | null): void;
  /**
   * Settle the record after a save landed: clear it when nothing newer is
   * owed, otherwise keep the newer content and only move the base forward.
   */
  noteSaveSuccess(savedContent: string): void;
  discard(): void;
  /** Bind a remote session id to its origin file so the draft outlives it. */
  resolveRemoteKey(sessionId: string, originPath: string): DraftKey | null;
}

/**
 * Owns the browser-side draft cell for the open document.
 *
 * Deliberately imperative and identity-stable: every caller is an effect or an
 * event handler in `App`, so re-rendering on a keystroke would buy nothing.
 */
export function useDraftPersistence(): DraftPersistence {
  const [storage] = useState(getDraftStorage);
  const [initialKey] = useState(() => draftKeyFromUrl(storage));
  const keyRef = useRef(initialKey);
  const holdsUnsentRef = useRef(false);

  return useMemo<DraftPersistence>(() => {
    const clear = (reason: string) => {
      const key = keyRef.current;
      if (!key) return;
      clearDraft(storage, key.key);
      if (holdsUnsentRef.current) {
        holdsUnsentRef.current = false;
        logDraftEvent(reason, { key: key.key });
      }
    };

    return {
      getKey: () => keyRef.current,

      read: () => {
        const key = keyRef.current;
        return key ? readDraft(storage, key.key) : null;
      },

      recordLocalContent: (content, baseContent) => {
        const key = keyRef.current;
        if (!key) return;

        const durable = writeDraft(storage, key.key, { content, baseContent });
        if (!durable) {
          logDraftEvent("write-refused", { key: key.key });
          return;
        }
        // Log the edge, not every keystroke: the decision is "this document now
        // holds unsent work", which happens once per outage.
        if (!holdsUnsentRef.current) {
          holdsUnsentRef.current = true;
          logDraftEvent("unsent", { key: key.key });
        }
      },

      noteSaveSuccess: (savedContent) => {
        const key = keyRef.current;
        if (!key) return;

        const record = readDraft(storage, key.key);
        if (!record || record.content === savedContent) {
          clear("cleared");
          return;
        }
        updateBase(storage, key.key, savedContent);
      },

      discard: () => clear("discarded"),

      resolveRemoteKey: (sessionId, originPath) => {
        writeSessionPointer(storage, sessionId, originPath);
        keyRef.current = draftKeyFromUrl(storage);
        return keyRef.current;
      },
    };
  }, [storage]);
}
