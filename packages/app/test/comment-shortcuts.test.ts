import { describe, expect, it } from "vitest";
import {
  getAddCommentShortcutLabel,
  matchesAddCommentShortcut,
} from "../src/comment-shortcuts";

describe("comment shortcuts", () => {
  it("formats the add comment shortcut label for Mac platforms", () => {
    expect(getAddCommentShortcutLabel("MacIntel")).toBe("Cmd + Option + M");
    expect(getAddCommentShortcutLabel("iPhone")).toBe("Cmd + Option + M");
  });

  it("formats the add comment shortcut label for non-Mac platforms", () => {
    expect(getAddCommentShortcutLabel("Win32")).toBe("Ctrl + Alt + M");
    expect(getAddCommentShortcutLabel("Linux x86_64")).toBe("Ctrl + Alt + M");
  });

  it("matches the Mac add comment shortcut", () => {
    expect(
      matchesAddCommentShortcut(
        {
          key: "m",
          altKey: true,
          ctrlKey: false,
          metaKey: true,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toBe(true);
  });

  it("matches the Windows add comment shortcut", () => {
    expect(
      matchesAddCommentShortcut(
        {
          key: "M",
          altKey: true,
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
        },
        "Win32",
      ),
    ).toBe(true);
  });

  it("rejects partial or conflicting modifier combinations", () => {
    expect(
      matchesAddCommentShortcut(
        {
          key: "m",
          altKey: false,
          ctrlKey: true,
          metaKey: false,
          shiftKey: false,
        },
        "Win32",
      ),
    ).toBe(false);

    expect(
      matchesAddCommentShortcut(
        {
          key: "m",
          altKey: true,
          ctrlKey: true,
          metaKey: true,
          shiftKey: false,
        },
        "MacIntel",
      ),
    ).toBe(false);
  });
});
