import type { DashboardPayload } from "./dashboard-data";

/**
 * One realistic `GET /api/dashboard` body: an agent blocked on a review, a
 * document loaded earlier, and one whose file was deleted after it was opened.
 *
 * It lives in `src/` rather than a test directory so `tsc -b` checks it against
 * `DashboardPayload` on every build — a wire-contract drift then fails the
 * build instead of only the tests that happen to use it.
 */
export const EXAMPLE_DASHBOARD_PAYLOAD: DashboardPayload = {
  server: {
    port: 7373,
    startedAt: "2026-08-26T08:55:00.000Z",
    now: "2026-08-26T09:32:00.000Z",
  },
  documents: [
    {
      absolutePath: "/home/dana/programs/transitions/REPORT.md",
      lastActivityAt: "2026-08-26T09:31:40.000Z",
      lastOpenedAt: "2026-08-26T09:31:40.000Z",
      lastLoadedAt: "2026-08-26T09:31:42.000Z",
      lastReviewedAt: null,
      exists: true,
      modifiedAt: "2026-08-26T09:31:38.000Z",
      summary: { comments: 3, replies: 1, suggestions: 1, unresolved: 4 },
      waiterCount: 1,
    },
    {
      absolutePath: "/home/dana/programs/transitions/notes.md",
      lastActivityAt: "2026-08-26T09:20:00.000Z",
      lastOpenedAt: "2026-08-26T09:19:55.000Z",
      lastLoadedAt: "2026-08-26T09:20:00.000Z",
      lastReviewedAt: "2026-08-26T09:18:00.000Z",
      exists: true,
      modifiedAt: "2026-08-26T09:18:00.000Z",
      summary: { comments: 0, replies: 0, suggestions: 0, unresolved: 0 },
      waiterCount: 0,
    },
    {
      absolutePath: "/home/dana/scratch/draft-post.md",
      lastActivityAt: "2026-08-26T09:05:00.000Z",
      lastOpenedAt: "2026-08-26T09:05:00.000Z",
      lastLoadedAt: null,
      lastReviewedAt: null,
      exists: false,
      modifiedAt: null,
      summary: null,
      waiterCount: 0,
    },
  ],
  recentReviews: [
    {
      sequence: 4,
      createdAt: "2026-08-26T09:18:00.000Z",
      absolutePath: "/home/dana/programs/transitions/notes.md",
      summary: { comments: 2, replies: 0, suggestions: 1, unresolved: 0 },
      hasOverallComment: true,
      deliveredToWaiter: true,
    },
    {
      sequence: 3,
      createdAt: "2026-08-26T09:02:00.000Z",
      absolutePath: "/home/dana/scratch/draft-post.md",
      summary: { comments: 1, replies: 0, suggestions: 1, unresolved: 2 },
      hasOverallComment: false,
      deliveredToWaiter: false,
    },
  ],
};
