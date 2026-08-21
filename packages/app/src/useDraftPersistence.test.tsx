import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DRAFT_KEY_PREFIX, readDraft } from "./draft-store";
import {
  type DraftPersistence,
  useDraftPersistence,
} from "./useDraftPersistence";

let container: HTMLDivElement;
let root: Root;

function Harness({ onReady }: { onReady: (api: DraftPersistence) => void }) {
  onReady(useDraftPersistence());
  return null;
}

async function mountHook(): Promise<DraftPersistence> {
  let api: DraftPersistence | null = null;
  await act(async () => {
    root.render(<Harness onReady={(next) => (api = next)} />);
    await Promise.resolve();
  });
  if (!api) throw new Error("hook did not initialize");
  return api;
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
  window.history.replaceState(null, "", "/");
});

describe("useDraftPersistence", () => {
  const fileKey = `${DRAFT_KEY_PREFIX}file:/work/plan.md`;

  it("has no destination when the URL names no document", async () => {
    window.history.replaceState(null, "", "/");
    const persistence = await mountHook();

    persistence.recordLocalContent("edited", "disk");

    expect(persistence.getKey()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("writes an edit through to storage before the call returns", async () => {
    window.history.replaceState(null, "", "/?path=/work/plan.md");
    const persistence = await mountHook();

    persistence.recordLocalContent("edited", "disk");

    expect(readDraft(localStorage, fileKey)).toMatchObject({
      content: "edited",
      baseContent: "disk",
      baseKnown: true,
    });
  });

  it("marks the base unknown when the document has not loaded yet", async () => {
    window.history.replaceState(null, "", "/?path=/work/plan.md");
    const persistence = await mountHook();

    persistence.recordLocalContent("edited", null);

    expect(readDraft(localStorage, fileKey)).toMatchObject({
      baseKnown: false,
    });
  });

  it("clears the record once the saved content is what was owed", async () => {
    window.history.replaceState(null, "", "/?path=/work/plan.md");
    const persistence = await mountHook();
    persistence.recordLocalContent("edited", "disk");

    persistence.noteSaveSuccess("edited");

    expect(persistence.read()).toBeNull();
  });

  it("keeps newer keystrokes and only advances the base when a save lands late", async () => {
    window.history.replaceState(null, "", "/?path=/work/plan.md");
    const persistence = await mountHook();
    persistence.recordLocalContent("first", "disk");
    persistence.recordLocalContent("second", "disk");

    persistence.noteSaveSuccess("first");

    expect(persistence.read()).toMatchObject({
      content: "second",
      baseContent: "first",
      baseKnown: true,
    });
  });

  it("discards the record on request", async () => {
    window.history.replaceState(null, "", "/?path=/work/plan.md");
    const persistence = await mountHook();
    persistence.recordLocalContent("edited", "disk");

    persistence.discard();

    expect(persistence.read()).toBeNull();
  });

  it("reaches a remote draft only once the session resolves to an origin path", async () => {
    window.history.replaceState(null, "", "/?session=abc123&token=SECRET");
    const persistence = await mountHook();
    expect(persistence.getKey()).toBeNull();

    const resolved = persistence.resolveRemoteKey("abc123", "/work/origin.md");

    expect(resolved).toEqual({
      key: `${DRAFT_KEY_PREFIX}origin:/work/origin.md`,
      mode: "remote",
    });
    expect(persistence.getKey()).toEqual(resolved);

    persistence.recordLocalContent("edited", "server");
    expect(persistence.read()).toMatchObject({ content: "edited" });
  });

  it("keeps a stable identity across re-renders so effects do not churn", async () => {
    window.history.replaceState(null, "", "/?path=/work/plan.md");
    const first = await mountHook();
    const second = await mountHook();

    expect(second).toBe(first);
  });
});
