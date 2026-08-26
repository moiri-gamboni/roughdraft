import fs from "node:fs";
import { extractRoughdraftReviewIndex } from "@roughdraft/rfm";
import { MAX_TRACKED_DOCUMENTS } from "./document-registry.js";

export const MAX_SUMMARY_BYTES = 2_000_000;

interface ReviewSummary {
  comments: number;
  replies: number;
  suggestions: number;
  unresolved: number;
}

export interface DocumentFileState {
  exists: boolean;
  /** ISO from mtime. */
  modifiedAt: string | null;
  summary: ReviewSummary | null;
}

interface CacheEntry {
  key: string;
  state: DocumentFileState;
}

/**
 * Disk facts for a document row, keyed by `(mtimeMs, size)` so an unchanged
 * file is a single `statSync` per poll. Never throws: every failure resolves
 * to a `DocumentFileState`. An unreadable file warns once per stat key, not
 * once per poll.
 */
export class ReviewSummaryCache {
  private readonly entries = new Map<string, CacheEntry>();

  read(absolutePath: string): DocumentFileState {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      // Any stat failure — ENOENT, or ENOTDIR from a path nested under a
      // regular file — reads to the caller as "no document here". `read` runs
      // once per row inside the synchronous dashboard handler, so throwing
      // would fail the whole endpoint rather than dim one row.
      this.entries.delete(absolutePath);
      return { exists: false, modifiedAt: null, summary: null };
    }

    const key = `${stat.mtimeMs}:${stat.size}`;
    const cached = this.entries.get(absolutePath);
    if (cached && cached.key === key) {
      this.entries.delete(absolutePath);
      this.entries.set(absolutePath, cached);
      return cached.state;
    }

    const state = this.computeState(absolutePath, stat);
    this.store(absolutePath, key, state);
    return state;
  }

  private computeState(
    absolutePath: string,
    stat: fs.Stats,
  ): DocumentFileState {
    const modifiedAt = stat.mtime.toISOString();

    if (stat.size > MAX_SUMMARY_BYTES) {
      return { exists: true, modifiedAt, summary: null };
    }

    try {
      const markdown = fs.readFileSync(absolutePath, "utf-8");
      return {
        exists: true,
        modifiedAt,
        summary: extractRoughdraftReviewIndex(markdown).summary,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return { exists: false, modifiedAt: null, summary: null };
      }
      console.warn(
        `[roughdraft:summary] could not read ${absolutePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { exists: true, modifiedAt, summary: null };
    }
  }

  private store(absolutePath: string, key: string, state: DocumentFileState) {
    this.entries.delete(absolutePath);
    this.entries.set(absolutePath, { key, state });
    while (this.entries.size > MAX_TRACKED_DOCUMENTS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
