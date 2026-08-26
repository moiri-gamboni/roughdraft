import path from "node:path";
import { refusesHistorySegment } from "./checkpoint-store.js";
import { appendSlog } from "./review-events.js";

const SLOG_SOURCE = "packages/server/src/document-registry.ts";
const MAX_PATH_LENGTH = 4096;

export const MAX_TRACKED_DOCUMENTS = 50;

export interface DocumentActivity {
  absolutePath: string;
  /** ISO; eviction and sort key. */
  lastActivityAt: string;
  /** ISO; open request, tab subscribe, or watch. */
  lastOpenedAt: string | null;
  /** ISO; GET /api/markdown-file. */
  lastLoadedAt: string | null;
  lastReviewedAt: string | null;
}

interface DocumentEntry extends DocumentActivity {
  lastActivityMs: number;
}

/**
 * Which documents this server has been asked about, and when. Bounded, in
 * memory, never persisted; fed only by request handlers the server already
 * serves. Keyed by absolute path alone — every producer's project/relative
 * pair is `dirname`/`basename` of the same string, so the row derives them.
 */
export class DocumentRegistry {
  readonly startedAt: string;
  private readonly now: () => number;
  private readonly entries = new Map<string, DocumentEntry>();

  constructor(options?: { now?: () => number }) {
    this.now = options?.now ?? Date.now;
    this.startedAt = new Date(this.now()).toISOString();
  }

  noteOpened(absolutePath: string, source: "request" | "load"): void {
    const entry = this.touch(absolutePath);
    if (source === "load") {
      entry.lastLoadedAt = entry.lastActivityAt;
    } else {
      entry.lastOpenedAt = entry.lastActivityAt;
    }
    this.slog("noteOpened", absolutePath);
  }

  noteReviewCompleted(absolutePath: string): void {
    const entry = this.touch(absolutePath);
    entry.lastReviewedAt = entry.lastActivityAt;
    this.slog("noteReviewCompleted", absolutePath);
  }

  list(): DocumentActivity[] {
    return [...this.entries.values()]
      .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
      .map(({ lastActivityMs: _lastActivityMs, ...activity }) => activity);
  }

  size(): number {
    return this.entries.size;
  }

  private touch(absolutePath: string): DocumentEntry {
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();
    const existing = this.entries.get(absolutePath);
    if (existing) {
      existing.lastActivityMs = nowMs;
      existing.lastActivityAt = nowIso;
      return existing;
    }

    const entry: DocumentEntry = {
      absolutePath,
      lastActivityMs: nowMs,
      lastActivityAt: nowIso,
      lastOpenedAt: null,
      lastLoadedAt: null,
      lastReviewedAt: null,
    };
    this.entries.set(absolutePath, entry);
    this.evictExcess();
    return entry;
  }

  private evictExcess(): void {
    while (this.entries.size > MAX_TRACKED_DOCUMENTS) {
      let oldestPath: string | null = null;
      let oldestMs = Number.POSITIVE_INFINITY;
      for (const entry of this.entries.values()) {
        if (entry.lastActivityMs < oldestMs) {
          oldestMs = entry.lastActivityMs;
          oldestPath = entry.absolutePath;
        }
      }
      if (oldestPath === null) return;
      this.entries.delete(oldestPath);
    }
  }

  private slog(method: string, absolutePath: string): void {
    appendSlog(SLOG_SOURCE, `document-registry.${method}`, {
      absolutePath,
      entryCount: this.entries.size,
    });
  }
}

/**
 * The requested path if it is safe to key a registry row and copy to a
 * clipboard: absolute, `path.resolve`-stable, `.md`, ≤4096 chars, no character
 * below U+0020 or U+007F, no `.roughdraft-history` segment. Otherwise null —
 * feed points skip a null rather than reject the request.
 */
export function registryPathFromRequest(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length > MAX_PATH_LENGTH) return null;
  if (!raw.toLowerCase().endsWith(".md")) return null;
  if (!path.isAbsolute(raw)) return null;
  if (raw !== path.resolve(raw)) return null;
  if (hasControlCharacter(raw)) return null;
  if (refusesHistorySegment(raw)) return null;
  return raw;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
