import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

test.describe("Review rail focus scroll", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("rail-focus-scroll");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("clicking a rail comment card scrolls its anchor into view @smoke", async ({
    page,
  }) => {
    const fillerParagraphs = Array.from(
      { length: 60 },
      (_, index) =>
        `Filler paragraph ${index + 1} exists only to push the document well past the height of the viewport so the anchored comment near the end starts off-screen.`,
    );

    const filePath = writeProjectFile(
      projectDir,
      "rail-focus-scroll.md",
      [
        "# Rail Focus Scroll",
        "",
        ...fillerParagraphs.slice(0, -1),
        `Final paragraph has {==target text==}{>>Needs detail<<}{id="c1" by="user" at="2026-04-23T18:00:00.000Z"} near the very end of the document.`,
        "",
      ].join("\n\n"),
    );

    await openMarkdownFile(page, filePath);
    await expect(page.getByTestId("document-review-rail")).toContainText(
      "Needs detail",
    );

    const anchor = page
      .locator(".comment-anchor[data-comment-ids]")
      .filter({ hasText: "target text" });
    await expect(anchor).toBeAttached();

    const isAnchorFullyVisibleInScrollContainer = async () =>
      anchor.evaluate((element) => {
        let container: HTMLElement | null = element.parentElement;
        while (container) {
          if (container.scrollHeight > container.clientHeight) break;
          container = container.parentElement;
        }
        if (!container) {
          throw new Error(
            "Could not find an ancestor scroll container for the comment anchor",
          );
        }

        const anchorRect = element.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        return (
          anchorRect.top >= containerRect.top &&
          anchorRect.bottom <= containerRect.bottom
        );
      });

    // Sanity check: the anchor starts off-screen (guards against a viewport
    // tall enough to show the whole document, which would mask the bug).
    expect(await isAnchorFullyVisibleInScrollContainer()).toBe(false);

    // Click via evaluate() to bypass Playwright's actionability auto-scroll,
    // which would otherwise scroll the container itself and mask the bug.
    await page.getByTestId("comment-thread-c1").evaluate((element) => {
      (element as HTMLElement).click();
    });

    await expect
      .poll(() => isAnchorFullyVisibleInScrollContainer(), {
        message: "expected the comment anchor to scroll into view",
      })
      .toBe(true);

    logE2eEvent("rail-focus-scroll.anchor-visible", {
      file: "rail-focus-scroll.md",
    });
  });
});
