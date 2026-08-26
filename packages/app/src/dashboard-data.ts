/**
 * The dashboard's read model: the `GET /api/dashboard` wire contract, the fetch
 * that classifies what came back, and the rows the page renders.
 *
 * Kept apart from the hook and the page so both stay thin: everything here is
 * pure or a single request, and `dashboard-data.fixture.ts` is a typed example
 * of the payload that `tsc -b` checks against these types.
 */

import { buildLocationForPath } from "./app-navigation";
import type { DraftListing } from "./draft-store";

export interface DashboardReviewSummary {
  comments: number;
  replies: number;
  suggestions: number;
  unresolved: number;
}

export interface DashboardDocument {
  absolutePath: string;
  lastActivityAt: string;
  lastOpenedAt: string | null;
  lastLoadedAt: string | null;
  lastReviewedAt: string | null;
  exists: boolean;
  modifiedAt: string | null;
  summary: DashboardReviewSummary | null;
  waiterCount: number;
}

export interface DashboardReview {
  sequence: number;
  createdAt: string;
  absolutePath: string;
  summary: DashboardReviewSummary;
  hasOverallComment: boolean;
  deliveredToWaiter: boolean;
}

export interface DashboardPayload {
  server: { port: number; startedAt: string; now: string };
  documents: DashboardDocument[];
  recentReviews: DashboardReview[];
}

export type DashboardFetchResult =
  | { kind: "ok"; payload: DashboardPayload }
  /** Non-OK status or non-JSON body: this server predates the route. */
  | { kind: "unsupported" }
  | { kind: "unreachable" };

export interface DashboardRow {
  absolutePath: string;
  fileName: string;
  directory: string;
  href: string;
  /** Null when only this browser knows the document, through a draft. */
  document: DashboardDocument | null;
  draft: DraftListing | null;
  awaiting: boolean;
  missing: boolean;
}

export interface DashboardRows {
  waiting: DashboardRow[];
  documents: DashboardRow[];
  reviews: DashboardReview[];
}

export async function fetchDashboard(
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<DashboardFetchResult> {
  let response: Response;
  try {
    response = await fetchImpl("/api/dashboard", {
      signal,
      headers: { accept: "application/json" },
    });
  } catch {
    return { kind: "unreachable" };
  }

  // An older server has no such route, so its SPA fallback answers 200 HTML —
  // indistinguishable from success unless the content type is checked.
  if (!response.ok) return { kind: "unsupported" };
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return { kind: "unsupported" };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "unreachable" };
  }

  if (!isDashboardPayload(body)) return { kind: "unreachable" };
  return { kind: "ok", payload: body };
}

function isDashboardPayload(body: unknown): body is DashboardPayload {
  const candidate = body as DashboardPayload | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    Array.isArray(candidate.documents) &&
    Array.isArray(candidate.recentReviews) &&
    typeof candidate.server?.now === "string"
  );
}

/** Collapses `.`, `..` and repeated separators; keeps the path absolute or not. */
export function normalizeAbsolutePath(path: string): string {
  const trimmed = path.trim();
  const absolute = trimmed.startsWith("/");
  const segments: string[] = [];

  for (const segment of trimmed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && segments.length > 0 && segments.at(-1) !== "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const joined = segments.join("/");
  return absolute ? `/${joined}` : joined;
}

export function buildDashboardRows(
  payload: DashboardPayload,
  drafts: DraftListing[],
): DashboardRows {
  const localDrafts = drafts.filter((entry) => entry.mode === "local");
  const claimed = new Set<string>();

  const serverRows = [...payload.documents]
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
    .map((document) => {
      const draft =
        localDrafts.find((entry) => entry.path === document.absolutePath) ??
        null;
      if (draft) claimed.add(draft.key);
      return {
        ...splitPath(document.absolutePath),
        document,
        draft,
        awaiting: document.waiterCount > 0,
        missing: document.exists === false,
      };
    });

  const draftOnlyRows = localDrafts
    .filter((entry) => !claimed.has(entry.key))
    .map((draft) => ({
      ...splitPath(draft.path),
      document: null,
      draft,
      awaiting: false,
      missing: false,
    }));

  return {
    waiting: serverRows.filter((row) => row.awaiting),
    documents: [...serverRows.filter((row) => !row.awaiting), ...draftOnlyRows],
    reviews: payload.recentReviews,
  };
}

function splitPath(absolutePath: string): {
  absolutePath: string;
  fileName: string;
  directory: string;
  href: string;
} {
  const lastSeparator = absolutePath.lastIndexOf("/");
  return {
    absolutePath,
    fileName: absolutePath.slice(lastSeparator + 1),
    directory: absolutePath.slice(0, lastSeparator) || "/",
    href: buildLocationForPath(absolutePath),
  };
}
