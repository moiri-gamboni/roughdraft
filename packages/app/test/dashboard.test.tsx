import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "../src/Dashboard";
import {
  buildDashboardRows,
  type DashboardDocument,
  type DashboardPayload,
  type DashboardReview,
} from "../src/dashboard-data";
import type { DraftListing } from "../src/draft-store";
import { copyTextToClipboard } from "../src/lib/clipboard";
import type { DashboardData } from "../src/useDashboardData";

vi.mock("../src/lib/clipboard", () => ({
  copyTextToClipboard: vi.fn(async () => {}),
}));

const copyMock = vi.mocked(copyTextToClipboard);

const NOW = "2026-08-26T09:32:00.000Z";
const NOW_MS = Date.parse(NOW);
const STARTED_AT = "2026-08-26T09:00:00.000Z";

function documentEntry(
  overrides: Partial<DashboardDocument> = {},
): DashboardDocument {
  return {
    absolutePath: "/work/notes.md",
    lastActivityAt: "2026-08-26T09:30:00.000Z",
    lastOpenedAt: "2026-08-26T09:20:00.000Z",
    lastLoadedAt: null,
    lastReviewedAt: null,
    exists: true,
    modifiedAt: "2026-08-26T09:29:00.000Z",
    summary: { comments: 0, replies: 0, suggestions: 0, unresolved: 0 },
    waiterCount: 0,
    ...overrides,
  };
}

function reviewEntry(
  overrides: Partial<DashboardReview> = {},
): DashboardReview {
  return {
    sequence: 1,
    createdAt: "2026-08-26T09:25:00.000Z",
    absolutePath: "/work/notes.md",
    summary: { comments: 2, replies: 0, suggestions: 0, unresolved: 0 },
    hasOverallComment: false,
    deliveredToWaiter: true,
    ...overrides,
  };
}

function payloadOf(
  documents: DashboardDocument[],
  recentReviews: DashboardReview[] = [],
  startedAt = STARTED_AT,
): DashboardPayload {
  return {
    server: { port: 7373, startedAt, now: NOW },
    documents,
    recentReviews,
  };
}

function draftEntry(overrides: Partial<DraftListing> = {}): DraftListing {
  return {
    key: "roughdraft:draft:v1:file:/work/notes.md",
    mode: "local",
    path: "/work/notes.md",
    updatedAt: Date.parse("2026-08-26T09:28:00.000Z"),
    disposition: "unsaved",
    ...overrides,
  };
}

function dashboardData(
  overrides: {
    status?: DashboardData["status"];
    payload?: DashboardPayload | null;
    drafts?: DraftListing[];
    updatedAtMs?: number | null;
    retry?: () => void;
    discardDraft?: (key: string) => void;
  } = {},
): DashboardData {
  const payload = overrides.payload ?? null;
  const drafts = overrides.drafts ?? [];
  return {
    status: overrides.status ?? (payload ? "ok" : "loading"),
    payload,
    rows: payload ? buildDashboardRows(payload, drafts) : null,
    nowMs: NOW_MS,
    updatedAtMs: overrides.updatedAtMs ?? NOW_MS,
    drafts,
    retry: overrides.retry ?? vi.fn(),
    discardDraft: overrides.discardDraft ?? vi.fn(),
  };
}

let container: HTMLDivElement;
let root: Root;
let assignSpy: ReturnType<typeof vi.fn>;
let realLocation: Location;

async function render(props: {
  loadError?: string | null;
  requestedPath?: string | null;
  data: DashboardData;
}) {
  await act(async () => {
    root.render(
      <Dashboard
        loadError={props.loadError ?? null}
        requestedPath={props.requestedPath ?? null}
        data={props.data}
      />,
    );
  });
}

function query(selector: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(selector);
}

function queryAll(selector: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(selector)];
}

function text(): string {
  return container.textContent ?? "";
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom's `location.assign` is a non-configurable own property, so it cannot
  // be spied directly; `window.location` itself is configurable.
  assignSpy = vi.fn();
  realLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get href() {
        return realLocation.href;
      },
      get origin() {
        return realLocation.origin;
      },
      get pathname() {
        return realLocation.pathname;
      },
      get search() {
        return realLocation.search;
      },
      get hash() {
        return realLocation.hash;
      },
      assign: assignSpy,
    },
  });
  copyMock.mockClear();
  copyMock.mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: realLocation,
  });
  vi.restoreAllMocks();
});

describe("Dashboard status states", () => {
  it("shows neither rows nor the empty state while the first poll is in flight", async () => {
    await render({ data: dashboardData({ status: "loading" }) });

    expect(query('[data-testid="dashboard"]')).not.toBeNull();
    expect(query('[data-testid="dashboard-empty"]')).toBeNull();
    expect(queryAll('[data-testid="dashboard-row"]')).toHaveLength(0);
  });

  it("offers a retry when the server cannot be reached at all", async () => {
    const retry = vi.fn();
    await render({ data: dashboardData({ status: "unreachable", retry }) });

    const notice = query('[data-testid="dashboard-unreachable"]');
    expect(notice?.textContent).toContain(
      "Couldn't reach the Roughdraft server",
    );

    const button = query('[data-testid="dashboard-unreachable-retry"]');
    await act(async () => {
      button?.click();
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("names the older server build and the command that fixes it", async () => {
    await render({ data: dashboardData({ status: "unsupported" }) });

    const notice = query('[data-testid="dashboard-unsupported"]');
    expect(notice?.textContent).toContain(
      "This server is running an older build",
    );
    expect(notice?.textContent).toContain("roughdraft stop");
    expect(query('[data-testid="dashboard-empty"]')).toBeNull();
  });

  it("says the list may be out of date when a poll fails after a success", async () => {
    await render({
      data: dashboardData({
        status: "stale",
        payload: payloadOf([documentEntry()]),
      }),
    });

    expect(query('[data-testid="dashboard-stale-notice"]')).not.toBeNull();
    expect(queryAll('[data-testid="dashboard-row"]')).toHaveLength(1);
  });

  it("puts the load error above the list with the path that failed", async () => {
    await render({
      loadError: "Roughdraft now opens one .md file at a time.",
      requestedPath: "/tmp/x.txt",
      data: dashboardData({ payload: payloadOf([documentEntry()]) }),
    });

    const banner = query('[data-testid="dashboard-load-error"]');
    expect(banner?.textContent).toContain(
      "Roughdraft now opens one .md file at a time.",
    );
    expect(banner?.textContent).toContain("/tmp/x.txt");
    expect(
      banner?.compareDocumentPosition(
        query('[data-testid="dashboard-row"]') as HTMLElement,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("Dashboard header", () => {
  it("names the port and how long the server has been up", async () => {
    await render({ data: dashboardData({ payload: payloadOf([]) }) });

    expect(text()).toContain("port 7373");
    expect(text()).toContain("running since 32m ago");
    expect(text()).toMatch(/updated \d{2}:\d{2}:\d{2}/);
  });

  it("spells out the start date when the server has been up since another day", async () => {
    const startedAt = "2026-08-24T09:00:00.000Z";
    await render({
      data: dashboardData({ payload: payloadOf([], [], startedAt) }),
    });

    expect(text()).toContain(new Date(startedAt).toLocaleString());
  });
});

describe("Dashboard empty state", () => {
  it("names the start time and how to open a document", async () => {
    await render({ data: dashboardData({ payload: payloadOf([]) }) });

    const empty = query('[data-testid="dashboard-empty"]');
    expect(empty?.textContent).toContain(
      "This server has not been asked to open a document since it started",
    );
    expect(empty?.textContent).toContain("32m ago");
    expect(empty?.textContent).toContain("roughdraft open <file.md>");
    expect(query('[data-testid="dashboard-open-path-input"]')).not.toBeNull();
  });
});

describe("Dashboard rows", () => {
  it("lists a document with a live waiter under Waiting for your review", async () => {
    await render({
      data: dashboardData({
        payload: payloadOf([
          documentEntry({ absolutePath: "/work/report.md", waiterCount: 1 }),
          documentEntry(),
        ]),
      }),
    });

    const waiting = query('[data-testid="dashboard-section-waiting"]');
    expect(waiting?.textContent).toContain("Waiting for your review");
    const row = waiting?.querySelector(
      '[data-testid="dashboard-row"][data-document-path="/work/report.md"]',
    );
    expect(row).not.toBeNull();
    expect(
      row?.querySelector('[data-testid="dashboard-waiting-badge"]')
        ?.textContent,
    ).toBe("agent waiting");
    expect(
      query('[data-testid="dashboard-section-documents"]')?.textContent,
    ).toContain("Documents");
  });

  it("omits a section with nothing in it", async () => {
    await render({
      data: dashboardData({ payload: payloadOf([documentEntry()]) }),
    });

    expect(query('[data-testid="dashboard-section-waiting"]')).toBeNull();
    expect(query('[data-testid="dashboard-section-reviews"]')).toBeNull();
    expect(query('[data-testid="dashboard-section-documents"]')).not.toBeNull();
  });

  it("links the filename to the document and shows its directory", async () => {
    await render({
      data: dashboardData({
        payload: payloadOf([
          documentEntry({ absolutePath: "/work/docs/a.md" }),
        ]),
      }),
    });

    const link = query(
      '[data-testid="dashboard-row"][data-document-path="/work/docs/a.md"] [data-testid="dashboard-row-open"]',
    );
    expect(link?.textContent).toBe("a.md");
    expect(link?.getAttribute("href")).toBe("/?path=%2Fwork%2Fdocs%2Fa.md");
    expect(
      query(
        '[data-testid="dashboard-row"][data-document-path="/work/docs/a.md"]',
      )?.textContent,
    ).toContain("/work/docs");
  });

  it("counts comments, suggestions and unresolved items, dropping the zeros", async () => {
    await render({
      data: dashboardData({
        payload: payloadOf([
          documentEntry({
            summary: {
              comments: 3,
              replies: 1,
              suggestions: 1,
              unresolved: 2,
            },
          }),
        ]),
      }),
    });

    expect(query('[data-testid="dashboard-row"]')?.textContent).toContain(
      "3 comments · 1 suggestion · 2 unresolved",
    );
  });

  it("shows no counts at all for a document with an empty review", async () => {
    await render({
      data: dashboardData({ payload: payloadOf([documentEntry()]) }),
    });

    expect(query('[data-testid="dashboard-row"]')?.textContent).not.toContain(
      "comment",
    );
  });

  it("dates when the file changed, when it was opened and when it was reviewed", async () => {
    await render({
      data: dashboardData({
        payload: payloadOf([
          documentEntry({ lastReviewedAt: "2026-08-26T08:32:00.000Z" }),
        ]),
      }),
    });

    expect(query('[data-testid="dashboard-row"]')?.textContent).toContain(
      "modified 3m ago · opened 12m ago · reviewed 1h ago",
    );
  });

  it("stays quiet about the facts it lacks", async () => {
    await render({
      data: dashboardData({
        payload: payloadOf([
          documentEntry({ lastReviewedAt: null, lastOpenedAt: null }),
        ]),
      }),
    });

    const row = query('[data-testid="dashboard-row"]');
    expect(row?.textContent).toContain("modified 3m ago");
    expect(row?.textContent).not.toContain("opened");
    expect(row?.textContent).not.toContain("reviewed");
  });

  it("flags a document whose file is gone", async () => {
    await render({
      data: dashboardData({
        payload: payloadOf([documentEntry({ exists: false, summary: null })]),
      }),
    });

    expect(query('[data-testid="dashboard-missing-badge"]')?.textContent).toBe(
      "file missing on disk",
    );
  });

  it("flags an unsaved draft and offers to discard it", async () => {
    const discardDraft = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await render({
      data: dashboardData({
        payload: payloadOf([documentEntry()]),
        drafts: [draftEntry()],
        discardDraft,
      }),
    });

    const row = query(
      '[data-testid="dashboard-row"][data-document-path="/work/notes.md"]',
    );
    expect(
      row?.querySelector('[data-testid="dashboard-draft-badge"]')?.textContent,
    ).toBe("unsaved draft");
    expect(row?.textContent).toContain("draft saved 4m ago");

    await act(async () => {
      row
        ?.querySelector<HTMLElement>(
          '[data-testid="dashboard-row-discard-draft"]',
        )
        ?.click();
    });

    expect(discardDraft).toHaveBeenCalledWith(
      "roughdraft:draft:v1:file:/work/notes.md",
    );
  });

  it("keeps a draft the server has never heard of, marked as draft only", async () => {
    await render({
      data: dashboardData({
        payload: payloadOf([]),
        drafts: [
          draftEntry({
            key: "roughdraft:draft:v1:file:/work/orphan.md",
            path: "/work/orphan.md",
          }),
        ],
      }),
    });

    const row = query(
      '[data-testid="dashboard-row"][data-document-path="/work/orphan.md"]',
    );
    expect(
      row?.querySelector('[data-testid="dashboard-draft-badge"]')?.textContent,
    ).toBe("draft only");
    expect(query('[data-testid="dashboard-empty"]')).toBeNull();
  });

  it("copies the absolute path and says so", async () => {
    await render({
      data: dashboardData({ payload: payloadOf([documentEntry()]) }),
    });

    const button = query('[data-testid="dashboard-row-copy-path"]');
    await act(async () => {
      button?.click();
    });

    expect(copyMock).toHaveBeenCalledWith("/work/notes.md");
    expect(button?.textContent).toContain("Copied");
  });

  it("says so when copying fails", async () => {
    copyMock.mockRejectedValue(new Error("no clipboard"));
    await render({
      data: dashboardData({ payload: payloadOf([documentEntry()]) }),
    });

    const button = query('[data-testid="dashboard-row-copy-path"]');
    await act(async () => {
      button?.click();
    });

    expect(button?.textContent).toContain("Couldn't copy");
  });
});

describe("Dashboard recent reviews", () => {
  it("shows the review, its counts and the overall-comment chip", async () => {
    await render({
      data: dashboardData({
        payload: payloadOf(
          [documentEntry()],
          [
            reviewEntry({
              hasOverallComment: true,
              summary: {
                comments: 2,
                replies: 0,
                suggestions: 1,
                unresolved: 3,
              },
            }),
          ],
        ),
      }),
    });

    const item = query('[data-testid="dashboard-review-item"]');
    expect(item?.textContent).toContain("notes.md");
    expect(item?.textContent).toContain("7m ago");
    expect(item?.textContent).toContain(
      "2 comments · 1 suggestion · 3 unresolved",
    );
    expect(item?.textContent).toContain("overall comment");
  });

  it("says when a finished review reached nobody", async () => {
    await render({
      data: dashboardData({
        payload: payloadOf(
          [documentEntry()],
          [reviewEntry({ deliveredToWaiter: false })],
        ),
      }),
    });

    expect(
      query('[data-testid="dashboard-review-item"]')?.textContent,
    ).toContain("no agent was waiting when this was sent");
  });
});

describe("Dashboard open-by-path field", () => {
  async function submitPath(value: string) {
    const input = query(
      '[data-testid="dashboard-open-path-input"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      query('[data-testid="dashboard-open-path-submit"]')?.click();
    });
  }

  it("refuses a path that is not absolute", async () => {
    await render({ data: dashboardData({ payload: payloadOf([]) }) });

    await submitPath("notes.md");

    expect(
      query('[data-testid="dashboard-open-path-error"]')?.textContent,
    ).toContain("absolute");
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("refuses a file that is not markdown", async () => {
    await render({ data: dashboardData({ payload: payloadOf([]) }) });

    await submitPath("/work/x.txt");

    expect(
      query('[data-testid="dashboard-open-path-error"]')?.textContent,
    ).toContain(".md");
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("normalises and opens an absolute markdown path", async () => {
    await render({ data: dashboardData({ payload: payloadOf([]) }) });

    await submitPath("/work//docs/./../notes.md");

    expect(assignSpy).toHaveBeenCalledWith("/?path=%2Fwork%2Fnotes.md");
    expect(query('[data-testid="dashboard-open-path-error"]')).toBeNull();
  });
});
