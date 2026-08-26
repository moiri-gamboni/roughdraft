import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLE_DASHBOARD_PAYLOAD } from "./dashboard-data.fixture";
import { DRAFT_KEY_PREFIX } from "./draft-store";
import { type DashboardData, useDashboardData } from "./useDashboardData";

const POLL_MS = 5000;

function dashboardResponse(body: unknown, contentType = "application/json") {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": contentType }),
    json: async () => body,
  } as unknown as Response;
}

function notFoundResponse() {
  return {
    ok: false,
    status: 404,
    headers: new Headers({ "content-type": "text/plain" }),
    json: async () => ({}),
  } as unknown as Response;
}

function okFetch() {
  return vi.fn(async () => dashboardResponse(EXAMPLE_DASHBOARD_PAYLOAD));
}

let latest: DashboardData | null = null;
let container: HTMLDivElement;
let root: Root;

function Probe({
  options,
}: {
  options: Parameters<typeof useDashboardData>[0];
}) {
  latest = useDashboardData(options);
  return null;
}

function data(): DashboardData {
  if (!latest) throw new Error("expected the hook to have rendered");
  return latest;
}

async function renderHook(options: Parameters<typeof useDashboardData>[0]) {
  await act(async () => {
    root.render(<Probe options={options} />);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  latest = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  setVisibility("visible");
  window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useDashboardData", () => {
  it("loads the dashboard and reads the clock from the server", async () => {
    const fetchImpl = okFetch();

    await renderHook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });

    expect(data().status).toBe("ok");
    expect(data().payload).toEqual(EXAMPLE_DASHBOARD_PAYLOAD);
    expect(data().nowMs).toBe(Date.parse(EXAMPLE_DASHBOARD_PAYLOAD.server.now));
    expect(data().rows?.waiting).toHaveLength(1);
    expect(data().updatedAtMs).not.toBeNull();
  });

  it("polls again once the interval elapses", async () => {
    const fetchImpl = okFetch();
    await renderHook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await advance(POLL_MS);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops polling while the tab is hidden and refetches when it comes back", async () => {
    const fetchImpl = okFetch();
    await renderHook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });

    setVisibility("hidden");
    await advance(POLL_MS * 3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports unreachable when the very first poll fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });

    await renderHook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });

    expect(data().status).toBe("unreachable");
    expect(data().payload).toBeNull();
  });

  it("keeps the last payload and goes stale when a later poll fails", async () => {
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(dashboardResponse(EXAMPLE_DASHBOARD_PAYLOAD))
      .mockRejectedValue(new Error("offline"));

    await renderHook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });
    await advance(POLL_MS);

    expect(data().status).toBe("stale");
    expect(data().payload).toEqual(EXAMPLE_DASHBOARD_PAYLOAD);
  });

  it("counts a request that outlives the deadline as a failed poll", async () => {
    const fetchImpl = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(dashboardResponse(EXAMPLE_DASHBOARD_PAYLOAD))
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("timed out", "TimeoutError"));
            });
          }),
      );

    await renderHook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });
    await advance(POLL_MS);
    expect(data().status).toBe("ok");

    await advance(10_000);

    expect(data().status).toBe("stale");
  });

  it("reports an older server build and does not fall back to the empty state", async () => {
    const fetchImpl = vi.fn(async () => notFoundResponse());

    await renderHook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });

    expect(data().status).toBe("unsupported");
    expect(data().rows).toBeNull();
  });

  it("retries on demand after a failure", async () => {
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(dashboardResponse(EXAMPLE_DASHBOARD_PAYLOAD));

    await renderHook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });
    expect(data().status).toBe("unreachable");

    await act(async () => {
      data().retry();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(data().status).toBe("ok");
  });

  it("aborts the request in flight when the page unmounts", async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>(() => {
          capturedSignal = init.signal ?? undefined;
        }),
    );

    await renderHook({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });
    expect(capturedSignal?.aborted).toBe(false);

    await act(async () => {
      root.unmount();
    });

    expect(capturedSignal?.aborted).toBe(true);
  });

  it("does not stack a second request on top of one still in flight", async () => {
    const hanging = vi.fn(() => new Promise<Response>(() => {}));
    await renderHook({
      fetchImpl: hanging as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });

    await advance(POLL_MS * 3);

    expect(hanging).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh poll when the fetcher changes while one is in flight", async () => {
    const hanging = vi.fn(() => new Promise<Response>(() => {}));
    await renderHook({
      fetchImpl: hanging as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });
    expect(data().status).toBe("loading");

    const replacement = okFetch();
    await act(async () => {
      root.render(
        <Probe
          options={{
            fetchImpl: replacement as unknown as typeof fetch,
            pollIntervalMs: POLL_MS,
            storage: window.localStorage,
          }}
        />,
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(replacement).toHaveBeenCalledTimes(1);
    expect(data().status).toBe("ok");
  });

  it("lists this browser's drafts and drops one when it is discarded", async () => {
    const key = `${DRAFT_KEY_PREFIX}file:/work/orphan.md`;
    window.localStorage.setItem(
      key,
      JSON.stringify({
        schema: 2,
        content: "edited",
        baseContent: "base",
        updatedAt: Date.parse("2026-08-26T09:31:00.000Z"),
      }),
    );

    await renderHook({
      fetchImpl: okFetch() as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });
    expect(data().drafts.map((entry) => entry.path)).toEqual([
      "/work/orphan.md",
    ]);

    await act(async () => {
      data().discardDraft(key);
    });

    expect(data().drafts).toEqual([]);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("re-reads drafts when another tab writes one", async () => {
    await renderHook({
      fetchImpl: okFetch() as unknown as typeof fetch,
      pollIntervalMs: POLL_MS,
      storage: window.localStorage,
    });
    expect(data().drafts).toEqual([]);

    window.localStorage.setItem(
      `${DRAFT_KEY_PREFIX}file:/work/other-tab.md`,
      JSON.stringify({
        schema: 2,
        content: "edited",
        baseContent: "base",
        updatedAt: Date.parse("2026-08-26T09:31:00.000Z"),
      }),
    );
    await act(async () => {
      window.dispatchEvent(new Event("storage"));
    });

    expect(data().drafts.map((entry) => entry.path)).toEqual([
      "/work/other-tab.md",
    ]);
  });
});
