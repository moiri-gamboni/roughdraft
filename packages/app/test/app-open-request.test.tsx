import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { detectBackend } from "../src/detect-backend";
import type { StorageBackend } from "../src/storage";
import { setupDomMocks } from "./dom-mocks";

vi.mock("../src/detect-backend", async () => {
  const actual = await vi.importActual<typeof import("../src/detect-backend")>(
    "../src/detect-backend",
  );
  return { ...actual, detectBackend: vi.fn() };
});

const detectBackendMock = vi.mocked(detectBackend);

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  private listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(handler);
  }

  removeEventListener(type: string, handler: (event: Event) => void) {
    this.listeners.get(type)?.delete(handler);
  }

  close() {}

  emit(type: string, data: string) {
    const event = new MessageEvent(type, { data });
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
}

function localBackend(): StorageBackend {
  return {
    info: {
      kind: "local-files",
      label: "Local files",
      detail: "Markdown file on disk",
      projectPath: "/work",
    },
    canManageProjects: false,
    async getMarkdownFile() {
      throw new Error("not used");
    },
    async saveMarkdownFile() {
      throw new Error("not used");
    },
    async saveAsset() {
      throw new Error("not used");
    },
    resolveFileUrl: (path) => `file://${path}`,
    watchMarkdownFile() {
      return () => {};
    },
    async openProject() {},
  };
}

let container: HTMLDivElement;
let root: Root;
let assignSpy: ReturnType<typeof vi.fn>;
let realLocation: Location;

async function renderApp() {
  await act(async () => {
    root.render(<App />);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );
  // jsdom's `location.assign` is a non-configurable own property, so it cannot
  // be spied directly (nor proxied). `window.location` itself is configurable,
  // so swap in a plain object that reads through to the real location live and
  // records `assign` calls.
  assignSpy = vi.fn();
  realLocation = window.location;
  const fakeLocation = {
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
  };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: fakeLocation,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  setupDomMocks();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", "/");
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("following server open requests", () => {
  it("ignores a javascript: URL", async () => {
    detectBackendMock.mockResolvedValue(localBackend());
    await renderApp();

    const source = FakeEventSource.instances.at(-1);
    if (!source) throw new Error("expected an EventSource");

    await act(async () => {
      source.emit(
        "open-request",
        JSON.stringify({ url: "javascript:alert(1)" }),
      );
    });

    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("navigates a cross-origin http URL to the same path on this origin", async () => {
    detectBackendMock.mockResolvedValue(localBackend());
    await renderApp();

    const source = FakeEventSource.instances.at(-1);
    if (!source) throw new Error("expected an EventSource");

    await act(async () => {
      source.emit(
        "open-request",
        JSON.stringify({ url: "http://localhost:7373/?path=/x.md" }),
      );
    });

    expect(assignSpy).toHaveBeenCalledTimes(1);
    const target = new URL(assignSpy.mock.calls[0][0] as string);
    expect(target.origin).toBe(window.location.origin);
    expect(`${target.pathname}${target.search}`).toBe("/?path=/x.md");
  });

  it("stops sending the failing path once a load error is shown", async () => {
    detectBackendMock.mockResolvedValue(localBackend());
    window.history.replaceState(null, "", "/?path=/tmp/x.txt");
    await renderApp();

    const latest = FakeEventSource.instances.at(-1);
    if (!latest) throw new Error("expected an EventSource");

    expect(latest.url).not.toContain("path=");
  });
});
