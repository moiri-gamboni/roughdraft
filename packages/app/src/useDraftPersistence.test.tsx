import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_KEY_PREFIX, readDraft } from "./draft-store";
import type { DocumentDiskChangeState } from "./storage";
import {
  type DraftPersistence,
  useDraftPersistence,
} from "./useDraftPersistence";

let container: HTMLDivElement;
let root: Root;

interface MountedHook {
  draft: DraftPersistence;
  retryPending: () => boolean;
  saveAttempts: () => string[];
}

/**
 * Mount the hook against a destination that rejects the next
 * `failuresRemaining` deliveries and then starts accepting, standing in for a
 * server that comes back on its own.
 */
async function mountHook({
  failuresRemaining = 0,
  diskChangeState = "clean",
}: {
  failuresRemaining?: number;
  diskChangeState?: DocumentDiskChangeState;
} = {}): Promise<MountedHook> {
  let failures = failuresRemaining;
  const currentDiskChangeState = diskChangeState;
  const saveAttempts: string[] = [];
  let api: DraftPersistence | null = null;
  let latestRetryPending = false;

  function Harness() {
    const { draft, retryPending } = useDraftPersistence({
      save: async (content) => {
        saveAttempts.push(content);
        if (failures > 0) {
          failures -= 1;
          throw new Error("save failed");
        }
        draft.noteSaveSuccess(content);
      },
      getDiskChangeState: () => currentDiskChangeState,
    });
    api = draft;
    latestRetryPending = retryPending;
    return null;
  }

  await act(async () => {
    root.render(<Harness />);
    await Promise.resolve();
  });
  if (!api) throw new Error("hook did not initialize");

  return {
    draft: api,
    retryPending: () => latestRetryPending,
    saveAttempts: () => saveAttempts,
  };
}

/** Run an imperative hook call and let React flush the state it changed. */
async function run(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("draft cell", () => {
  const fileKey = `${DRAFT_KEY_PREFIX}file:/work/plan.md`;

  it("has no destination when the URL names no document", async () => {
    window.history.replaceState(null, "", "/");
    const { draft } = await mountHook();

    draft.recordLocalContent("edited", "disk");

    expect(draft.getKey()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("writes an edit through to storage before the call returns", async () => {
    window.history.replaceState(null, "", "/?path=/work/plan.md");
    const { draft } = await mountHook();

    draft.recordLocalContent("edited", "disk");

    expect(readDraft(localStorage, fileKey)).toMatchObject({
      content: "edited",
      baseContent: "disk",
      baseKnown: true,
    });
  });

  it("marks the base unknown when the document has not loaded yet", async () => {
    window.history.replaceState(null, "", "/?path=/work/plan.md");
    const { draft } = await mountHook();

    draft.recordLocalContent("edited", null);

    expect(readDraft(localStorage, fileKey)).toMatchObject({
      baseKnown: false,
    });
  });

  it("clears the record once the saved content is what was owed", async () => {
    window.history.replaceState(null, "", "/?path=/work/plan.md");
    const { draft } = await mountHook();
    draft.recordLocalContent("edited", "disk");

    draft.noteSaveSuccess("edited");

    expect(draft.read()).toBeNull();
  });

  it("keeps newer keystrokes and only advances the base when a save lands late", async () => {
    window.history.replaceState(null, "", "/?path=/work/plan.md");
    const { draft } = await mountHook();
    draft.recordLocalContent("first", "disk");
    draft.recordLocalContent("second", "disk");

    draft.noteSaveSuccess("first");

    expect(draft.read()).toMatchObject({
      content: "second",
      baseContent: "first",
      baseKnown: true,
    });
  });

  it("discards the record on request", async () => {
    window.history.replaceState(null, "", "/?path=/work/plan.md");
    const { draft } = await mountHook();
    draft.recordLocalContent("edited", "disk");

    draft.discard();

    expect(draft.read()).toBeNull();
  });

  it("reaches a remote draft only once the session resolves to an origin path", async () => {
    window.history.replaceState(null, "", "/?session=abc123&token=SECRET");
    const { draft } = await mountHook();
    expect(draft.getKey()).toBeNull();

    const resolved = draft.resolveRemoteKey("abc123", "/work/origin.md");

    expect(resolved).toEqual({
      key: `${DRAFT_KEY_PREFIX}origin:/work/origin.md`,
      mode: "remote",
    });
    expect(draft.getKey()).toEqual(resolved);

    draft.recordLocalContent("edited", "server");
    expect(draft.read()).toMatchObject({ content: "edited" });
  });
});

describe("save retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/?path=/work/plan.md");
  });

  it("delivers the draft without another keystroke once the destination returns", async () => {
    // The initial save already failed (that is what arms the retry); the next
    // two attempts fail too, and the third one lands.
    const mounted = await mountHook({ failuresRemaining: 2 });
    mounted.draft.recordLocalContent("unsent body", "disk");

    await run(() => mounted.draft.noteSaveFailure());
    expect(mounted.retryPending()).toBe(true);

    await advanceTimers(1_000);
    await advanceTimers(2_000);
    await advanceTimers(4_000);

    expect(mounted.saveAttempts()).toEqual([
      "unsent body",
      "unsent body",
      "unsent body",
    ]);
    expect(mounted.retryPending()).toBe(false);
    expect(mounted.draft.read()).toBeNull();
  });

  it("retries the newest draft content, not the content that first failed", async () => {
    const mounted = await mountHook({ failuresRemaining: 1 });
    mounted.draft.recordLocalContent("first body", "disk");
    await run(() => mounted.draft.noteSaveFailure());
    mounted.draft.recordLocalContent("second body", "disk");

    await advanceTimers(1_000);
    await advanceTimers(2_000);

    expect(mounted.saveAttempts().at(-1)).toBe("second body");
  });

  it("stands down while the document is not clean", async () => {
    const mounted = await mountHook({
      failuresRemaining: 1,
      diskChangeState: "paused",
    });
    mounted.draft.recordLocalContent("unsent body", "disk");

    await run(() => mounted.draft.noteSaveFailure());
    await advanceTimers(60_000);

    expect(mounted.saveAttempts()).toEqual([]);
    expect(mounted.retryPending()).toBe(true);
  });

  it("stops retrying once a fresher save supersedes the pending one", async () => {
    const mounted = await mountHook({ failuresRemaining: 1 });
    mounted.draft.recordLocalContent("unsent body", "disk");
    await run(() => mounted.draft.noteSaveFailure());

    await run(() => mounted.draft.cancelRetry());
    await advanceTimers(60_000);

    expect(mounted.saveAttempts()).toEqual([]);
  });

  it("ends the retry when a save from elsewhere lands the same content", async () => {
    const mounted = await mountHook({ failuresRemaining: 1 });
    mounted.draft.recordLocalContent("unsent body", "disk");
    await run(() => mounted.draft.noteSaveFailure());

    await run(() => mounted.draft.noteSaveSuccess("unsent body"));

    expect(mounted.retryPending()).toBe(false);
    await advanceTimers(60_000);
    expect(mounted.saveAttempts()).toEqual([]);
  });

  it("retries as soon as the tab is looked at again", async () => {
    const mounted = await mountHook({ failuresRemaining: 0 });
    mounted.draft.recordLocalContent("unsent body", "disk");
    await run(() => mounted.draft.noteSaveFailure());

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(mounted.saveAttempts()).toEqual(["unsent body"]);
    expect(mounted.retryPending()).toBe(false);
  });

  it("gives up on the retry when the record is gone", async () => {
    const mounted = await mountHook({ failuresRemaining: 1 });
    mounted.draft.recordLocalContent("unsent body", "disk");
    await run(() => mounted.draft.noteSaveFailure());
    await run(() => mounted.draft.discard());

    await advanceTimers(60_000);

    expect(mounted.saveAttempts()).toEqual([]);
    expect(mounted.retryPending()).toBe(false);
  });
});
