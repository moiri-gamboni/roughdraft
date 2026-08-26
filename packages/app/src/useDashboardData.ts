/**
 * Short-polls `GET /api/dashboard` and merges this browser's drafts onto the
 * result.
 *
 * The seam exists so the page stays a pure render: tests hand `Dashboard` a
 * `DashboardData` value directly, and this hook is exercised on its own with a
 * stubbed `fetchImpl` and fake timers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildDashboardRows,
  type DashboardFetchResult,
  type DashboardPayload,
  type DashboardRows,
  fetchDashboard,
} from "./dashboard-data";
import {
  clearDraft,
  type DraftListing,
  getDraftStorage,
  listDraftRecords,
} from "./draft-store";

const DEFAULT_POLL_INTERVAL_MS = 5000;
/** A poll that has not answered by now is treated as a failure, so a hung
 * request cannot hold the page on a payload that stopped being true. */
const REQUEST_DEADLINE_MS = 10_000;

export interface DashboardData {
  status: "loading" | "ok" | "stale" | "unreachable" | "unsupported";
  payload: DashboardPayload | null;
  rows: DashboardRows | null;
  /** The server's clock at the last successful poll, so ages survive skew. */
  nowMs: number;
  updatedAtMs: number | null;
  drafts: DraftListing[];
  retry(): void;
  discardDraft(key: string): void;
}

interface FetchState {
  status: DashboardData["status"];
  payload: DashboardPayload | null;
  nowMs: number;
  updatedAtMs: number | null;
}

export function useDashboardData(
  options: {
    fetchImpl?: typeof fetch;
    pollIntervalMs?: number;
    storage?: Storage | null;
  } = {},
): DashboardData {
  const {
    fetchImpl = globalThis.fetch,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = options;
  const storage = "storage" in options ? options.storage : getDraftStorage();

  const [state, setState] = useState<FetchState>(() => ({
    status: "loading",
    payload: null,
    nowMs: Date.now(),
    updatedAtMs: null,
  }));
  const [drafts, setDrafts] = useState<DraftListing[]>(() =>
    listDraftRecords(storage ?? null),
  );

  const inFlightRef = useRef<AbortController | null>(null);

  const poll = useCallback(async () => {
    if (inFlightRef.current) return;
    const request = new AbortController();
    inFlightRef.current = request;
    const deadline = setTimeout(() => request.abort(), REQUEST_DEADLINE_MS);

    try {
      const result = await fetchDashboard(fetchImpl, request.signal);
      setState((previous) => nextState(previous, result));
      setDrafts(listDraftRecords(storage ?? null));
    } finally {
      clearTimeout(deadline);
      if (inFlightRef.current === request) inFlightRef.current = null;
    }
  }, [fetchImpl, storage]);

  useEffect(() => {
    void poll();
    // Release the slot before aborting: a request abandoned here must not keep
    // the next poll (a re-run of this effect) from starting.
    return () => {
      const abandoned = inFlightRef.current;
      inFlightRef.current = null;
      abandoned?.abort();
    };
  }, [poll]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void poll();
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [poll, pollIntervalMs]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [poll]);

  useEffect(() => {
    const onStorage = () => setDrafts(listDraftRecords(storage ?? null));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storage]);

  const rows = useMemo(
    () => (state.payload ? buildDashboardRows(state.payload, drafts) : null),
    [state.payload, drafts],
  );

  const discardDraft = useCallback(
    (key: string) => {
      clearDraft(storage ?? null, key);
      setDrafts(listDraftRecords(storage ?? null));
    },
    [storage],
  );

  return {
    ...state,
    rows,
    drafts,
    retry: () => {
      void poll();
    },
    discardDraft,
  };
}

function nextState(
  previous: FetchState,
  result: DashboardFetchResult,
): FetchState {
  if (result.kind === "ok") {
    return {
      status: "ok",
      payload: result.payload,
      nowMs: Date.parse(result.payload.server.now),
      updatedAtMs: Date.now(),
    };
  }

  if (result.kind === "unsupported") {
    return { ...previous, status: "unsupported", payload: null };
  }

  return {
    ...previous,
    status: previous.payload ? "stale" : "unreachable",
  };
}
