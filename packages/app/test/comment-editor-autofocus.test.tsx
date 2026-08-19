import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentEditorList } from "../src/CommentEditorList";
import type { CriticComment } from "../src/critic-markup";

function queryByTestId<T extends Element = HTMLElement>(
  container: ParentNode,
  testId: string,
) {
  return container.querySelector<T>(`[data-testid="${testId}"]`);
}

function getByTestId<T extends Element = HTMLElement>(
  container: ParentNode,
  testId: string,
) {
  const element = queryByTestId<T>(container, testId);
  expect(element).not.toBeNull();
  return element as T;
}

const comments: CriticComment[] = [
  {
    id: "c1",
    content: "Root comment",
    createdAt: "2026-04-25T23:56:00.000Z",
    authorType: "user",
  },
];

describe("comment editor autofocus", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalOffsetParent: PropertyDescriptor | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    // jsdom reports offsetParent as null for every element, which would skip
    // the autofocus effect entirely. Make the textarea look laid out.
    originalOffsetParent = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetParent",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return document.body;
      },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    if (originalOffsetParent) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetParent",
        originalOffsetParent,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "offsetParent");
    }
    vi.restoreAllMocks();
  });

  it("autofocuses a pending comment editor without scrolling its container", async () => {
    const focusSpy = vi
      .spyOn(HTMLTextAreaElement.prototype, "focus")
      .mockImplementation(() => {});

    await act(async () => {
      root.render(
        <CommentEditorList
          comments={comments}
          testId="comment-list"
          pendingFocusCommentId="c1"
          onDeleteComment={() => {}}
          onUpdateComment={() => {}}
        />,
      );
      await Promise.resolve();
    });

    expect(
      queryByTestId<HTMLTextAreaElement>(container, "comment-banner-c1-editor"),
    ).not.toBeNull();
    expect(getByTestId(container, "comment-list")).not.toBeNull();
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });
});
