import { describe, expect, it, vi } from "vitest";
import {
  buildDashboardRows,
  type DashboardPayload,
  fetchDashboard,
  normalizeAbsolutePath,
} from "./dashboard-data";
import { EXAMPLE_DASHBOARD_PAYLOAD } from "./dashboard-data.fixture";
import type { DraftListing } from "./draft-store";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function documentRow(
  overrides: Partial<DashboardPayload["documents"][number]> = {},
): DashboardPayload["documents"][number] {
  return {
    absolutePath: "/work/notes.md",
    lastActivityAt: "2026-08-26T09:30:00.000Z",
    lastOpenedAt: "2026-08-26T09:30:00.000Z",
    lastReviewedAt: null,
    exists: true,
    modifiedAt: "2026-08-26T09:00:00.000Z",
    summary: { comments: 0, replies: 0, suggestions: 0, unresolved: 0 },
    waiterCount: 0,
    ...overrides,
  };
}

function payload(
  documents: DashboardPayload["documents"],
  recentReviews: DashboardPayload["recentReviews"] = [],
): DashboardPayload {
  return {
    server: {
      port: 7373,
      startedAt: "2026-08-26T09:00:00.000Z",
      now: "2026-08-26T09:32:00.000Z",
    },
    documents,
    recentReviews,
  };
}

function draft(overrides: Partial<DraftListing> = {}): DraftListing {
  return {
    key: "roughdraft:draft:v1:file:/work/notes.md",
    mode: "local",
    path: "/work/notes.md",
    updatedAt: Date.parse("2026-08-26T09:31:00.000Z"),
    disposition: "unsaved",
    ...overrides,
  };
}

describe("fetchDashboard", () => {
  it("returns the payload when the server answers with dashboard JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(EXAMPLE_DASHBOARD_PAYLOAD),
    );

    const result = await fetchDashboard(
      fetchImpl as unknown as typeof fetch,
      new AbortController().signal,
    );

    expect(result).toEqual({ kind: "ok", payload: EXAMPLE_DASHBOARD_PAYLOAD });
  });

  it("reports an older server build when the route is not found", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("not found", { status: 404 }),
    );

    const result = await fetchDashboard(
      fetchImpl as unknown as typeof fetch,
      new AbortController().signal,
    );

    expect(result).toEqual({ kind: "unsupported" });
  });

  it("reports an older server build when the SPA fallback answers with HTML", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<!doctype html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    );

    const result = await fetchDashboard(
      fetchImpl as unknown as typeof fetch,
      new AbortController().signal,
    );

    expect(result).toEqual({ kind: "unsupported" });
  });

  it("reports unreachable when the request rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await fetchDashboard(
      fetchImpl as unknown as typeof fetch,
      new AbortController().signal,
    );

    expect(result).toEqual({ kind: "unreachable" });
  });

  it("reports unreachable when the JSON body is not a dashboard payload", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ documents: [] }));

    const result = await fetchDashboard(
      fetchImpl as unknown as typeof fetch,
      new AbortController().signal,
    );

    expect(result).toEqual({ kind: "unreachable" });
  });

  it("passes the caller's abort signal to the request", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(EXAMPLE_DASHBOARD_PAYLOAD),
    );
    const signal = new AbortController().signal;

    await fetchDashboard(fetchImpl as unknown as typeof fetch, signal);

    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ signal });
  });
});

describe("normalizeAbsolutePath", () => {
  it("collapses '.', '..' and repeated separators", () => {
    expect(normalizeAbsolutePath("/work//notes/./../docs/plan.md")).toBe(
      "/work/docs/plan.md",
    );
  });

  it("stops at the root, the way path.resolve does on the server", () => {
    expect(normalizeAbsolutePath("/work/../../x.md")).toBe("/x.md");
  });

  it("leaves a relative path relative", () => {
    expect(normalizeAbsolutePath("  notes/./plan.md ")).toBe("notes/plan.md");
  });
});

describe("buildDashboardRows", () => {
  it("puts a document with a live waiter under waiting", () => {
    const rows = buildDashboardRows(
      payload([
        documentRow({ absolutePath: "/work/report.md", waiterCount: 1 }),
        documentRow({ absolutePath: "/work/notes.md" }),
      ]),
      [],
    );

    expect(rows.waiting.map((row) => row.absolutePath)).toEqual([
      "/work/report.md",
    ]);
    expect(rows.documents.map((row) => row.absolutePath)).toEqual([
      "/work/notes.md",
    ]);
    expect(rows.waiting[0]?.awaiting).toBe(true);
  });

  it("orders documents by most recent activity first", () => {
    const rows = buildDashboardRows(
      payload([
        documentRow({
          absolutePath: "/work/older.md",
          lastActivityAt: "2026-08-26T09:00:00.000Z",
        }),
        documentRow({
          absolutePath: "/work/newer.md",
          lastActivityAt: "2026-08-26T09:30:00.000Z",
        }),
      ]),
      [],
    );

    expect(rows.documents.map((row) => row.absolutePath)).toEqual([
      "/work/newer.md",
      "/work/older.md",
    ]);
  });

  it("splits each path into a filename, a directory and a document link", () => {
    const rows = buildDashboardRows(
      payload([documentRow({ absolutePath: "/work/docs/plan.md" })]),
      [],
    );

    expect(rows.documents[0]).toMatchObject({
      fileName: "plan.md",
      directory: "/work/docs",
      href: "/?path=%2Fwork%2Fdocs%2Fplan.md",
    });
  });

  it("marks a row whose file no longer exists as missing", () => {
    const rows = buildDashboardRows(
      payload([documentRow({ exists: false, summary: null })]),
      [],
    );

    expect(rows.documents[0]?.missing).toBe(true);
  });

  it("attaches a draft to the server row with the same path", () => {
    const rows = buildDashboardRows(
      payload([documentRow({ absolutePath: "/work/notes.md" })]),
      [draft()],
    );

    expect(rows.documents).toHaveLength(1);
    expect(rows.documents[0]?.draft?.key).toBe(
      "roughdraft:draft:v1:file:/work/notes.md",
    );
  });

  it("synthesises a draft-only row after the server rows", () => {
    const rows = buildDashboardRows(
      payload([documentRow({ absolutePath: "/work/notes.md" })]),
      [
        draft({
          key: "roughdraft:draft:v1:file:/work/orphan.md",
          path: "/work/orphan.md",
        }),
      ],
    );

    expect(rows.documents.map((row) => row.absolutePath)).toEqual([
      "/work/notes.md",
      "/work/orphan.md",
    ]);
    expect(rows.documents[1]).toMatchObject({
      document: null,
      awaiting: false,
      missing: false,
    });
  });

  it("ignores drafts held for a remote document", () => {
    const rows = buildDashboardRows(payload([]), [
      draft({
        key: "roughdraft:draft:v1:origin:https://example.com/doc",
        mode: "remote",
        path: "https://example.com/doc",
      }),
    ]);

    expect(rows.documents).toEqual([]);
  });

  it("passes the recent reviews through", () => {
    const rows = buildDashboardRows(EXAMPLE_DASHBOARD_PAYLOAD, []);

    expect(rows.reviews).toEqual(EXAMPLE_DASHBOARD_PAYLOAD.recentReviews);
  });
});
