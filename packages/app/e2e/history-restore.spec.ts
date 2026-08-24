import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  appendInCodeEditor,
  codeEditor,
  createMarkdownProject,
  documentSaveStatus,
  fileConflictNotice,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

/** A reviewed document: the CriticMarkup is the content worth recovering. */
const REVIEWED = `# Review

{==Reviewed line==}{>>Keep this<<}{#c1} and the rest of the paragraph.

---
comments:
  c1:
    by: Nora
    at: "2026-08-24T12:00:00.000Z"
`;

/** What an agent working from a stale copy leaves behind. */
const CLOBBERED = "# Review\n\nThe agent overwrote everything.\n";

const RETRYING_LABEL = "Changes saved in this browser, retrying";

const isMarkdownFileEndpoint = (url: URL) =>
  url.pathname === "/api/markdown-file";

async function blockSaves(page: Page) {
  await page.route(isMarkdownFileEndpoint, (route) => {
    if (route.request().method() === "PUT") return route.abort();
    return route.continue();
  });
}

async function allowSaves(page: Page) {
  await page.unroute(isMarkdownFileEndpoint);
}

function waitForHistoryEvent(page: Page, event: string) {
  return page.waitForEvent("console", (message) =>
    message.text().includes(`[roughdraft:history] ${event}`),
  );
}

/**
 * Open the dialog and select the newest snapshot. Content dedup and save
 * coalescing both mean the list is not one-entry-per-write, so a test may
 * never assume how many entries there are — only that the newest exists.
 */
async function openHistoryAndSelectNewest(page: Page) {
  await page.getByTestId("document-history-trigger").click();
  await expect(page.getByTestId("document-history-dialog")).toBeVisible();
  const entries = page.getByTestId("document-history-entry");
  await expect(entries.first()).toBeVisible();
  await entries.first().click();
  await expect(page.getByTestId("document-history-viewer")).toBeVisible();
}

test.describe("recovering a clobbered review from history", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("history-restore");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("restores the reviewed text an agent overwrote @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(projectDir, "review.md", REVIEWED);
    await openMarkdownFile(page, filePath, "code");
    await expect(codeEditor(page)).toContainText("Reviewed line");

    // One landed save is what puts this document in the store at all: the
    // wrapper captures the bytes it is about to replace, then what it wrote.
    await appendInCodeEditor(page, "\nReviewer note.\n");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "Saved",
    );

    // An agent writes from a stale copy. Nothing about this goes through
    // Roughdraft, so only the earlier snapshots hold the review now.
    fs.writeFileSync(filePath, CLOBBERED);
    await expect(page.getByTestId("external-change-notice")).toBeVisible();
    await expect(codeEditor(page)).toContainText("overwrote everything");

    // The notice is the path a reviewer actually takes here.
    await page.getByTestId("external-change-notice-view-history").click();
    await expect(page.getByTestId("document-history-dialog")).toBeVisible();
    const entries = page.getByTestId("document-history-entry");
    await expect(entries.first()).toBeVisible();
    await entries.first().click();
    // Raw, not rendered: the marker has to be visible in the fossil.
    await expect(page.getByTestId("document-history-viewer")).toContainText(
      "{==Reviewed line==}",
    );

    const restored = waitForHistoryEvent(page, "restored");
    await page.getByTestId("document-history-restore").click();
    await restored;

    await expect(codeEditor(page)).toContainText("Reviewed line");
    // The restore is a forward save, so it has to reach the file on its own.
    await expect
      .poll(() => readProjectFile(projectDir, "review.md"))
      .toContain("{==Reviewed line==}");
    expect(readProjectFile(projectDir, "review.md")).not.toContain(
      "overwrote everything",
    );

    logE2eEvent("history-restore.recovered-clobbered-review", {
      file: "review.md",
    });
  });

  test("opens above the sticky document header rather than under it", async ({
    page,
  }) => {
    // The header is `sticky z-70` and the dialog portals into the same root
    // stacking context, so a dialog left at the shadcn default z-50 loses a
    // band across its own top edge — the band holding its title and close
    // button. Measured rather than reasoned: ask the browser who is on top.
    const filePath = writeProjectFile(projectDir, "stack.md", REVIEWED);
    await openMarkdownFile(page, filePath, "code");
    await expect(codeEditor(page)).toContainText("Reviewed line");
    await page.getByTestId("document-history-trigger").click();
    await expect(page.getByTestId("document-history-dialog")).toBeVisible();

    const coveredBy = await page.evaluate(() => {
      const dialog = document.querySelector(
        '[data-testid="document-history-dialog"]',
      );
      const rect = dialog?.getBoundingClientRect();
      if (!rect) return ["no-dialog"];

      return [2, 10, 24, 48].map((offset) => {
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + offset,
        );
        return (
          hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? "none"
        );
      });
    });

    expect(new Set(coveredBy)).toEqual(new Set(["document-history-dialog"]));

    logE2eEvent("history-restore.dialog-above-sticky-header", {
      file: "stack.md",
    });
  });

  test("restores through the overwrite escape when the file will not take a plain save", async ({
    page,
  }) => {
    const filePath = writeProjectFile(projectDir, "escape.md", REVIEWED);
    await openMarkdownFile(page, filePath, "code");
    await expect(codeEditor(page)).toContainText("Reviewed line");

    await appendInCodeEditor(page, "\nReviewer note.\n");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "Saved",
    );

    // Unsaved edits plus a disk that moved: a forward save would be refused,
    // which is exactly the state that used to leave Restore dead with no way on.
    await blockSaves(page);
    await appendInCodeEditor(page, "\nStill unsent.\n");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      RETRYING_LABEL,
    );
    fs.writeFileSync(filePath, CLOBBERED);
    await expect(fileConflictNotice(page)).toBeVisible();

    await allowSaves(page);
    await openHistoryAndSelectNewest(page);
    await expect(page.getByTestId("document-history-restore")).toBeDisabled();

    const restored = waitForHistoryEvent(page, "restored");
    await page.getByTestId("document-history-restore-overwrite").click();
    await restored;

    await expect
      .poll(() => readProjectFile(projectDir, "escape.md"))
      .toContain("{==Reviewed line==}");
    expect(readProjectFile(projectDir, "escape.md")).not.toContain(
      "overwrote everything",
    );
    // The overwrite settles the document, so the banner has no reason to stay.
    await expect(fileConflictNotice(page)).toBeHidden();

    logE2eEvent("history-restore.overwrite-escape", { file: "escape.md" });
  });

  test("keeps hearing the file after the overwrite escape wrote", async ({
    page,
  }) => {
    // The watcher stands down while a restore is in flight, and the escape is
    // the first path that ends one through the overwrite handler. If that
    // handler did not lift the marker, this tab would never report a write
    // again — in the one situation where an agent is most likely to make one.
    const filePath = writeProjectFile(projectDir, "deaf.md", REVIEWED);
    await openMarkdownFile(page, filePath, "code");
    await appendInCodeEditor(page, "\nReviewer note.\n");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "Saved",
    );

    await blockSaves(page);
    await appendInCodeEditor(page, "\nStill unsent.\n");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      RETRYING_LABEL,
    );
    fs.writeFileSync(filePath, CLOBBERED);
    await expect(fileConflictNotice(page)).toBeVisible();

    await allowSaves(page);
    await openHistoryAndSelectNewest(page);
    await page.getByTestId("document-history-restore-overwrite").click();
    await expect(fileConflictNotice(page)).toBeHidden();

    fs.writeFileSync(filePath, "# Review\n\nA third body.\n");
    await expect(page.getByTestId("external-change-notice")).toBeVisible();

    logE2eEvent("history-restore.watcher-alive-after-escape", {
      file: "deaf.md",
    });
  });

  test("parks unsent edits as a resurfaced offer when the tab reloads instead", async ({
    page,
  }) => {
    // The escape exists so a reviewer is never cornered. This records what the
    // alternative actually costs: a plain browser reload keeps the unsent edits
    // and offers them back, so the escape is convenience and guaranteed
    // reversibility rather than the only non-lossy way out.
    const filePath = writeProjectFile(projectDir, "reload.md", REVIEWED);
    await openMarkdownFile(page, filePath, "code");
    await appendInCodeEditor(page, "\nReviewer note.\n");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "Saved",
    );

    await blockSaves(page);
    await appendInCodeEditor(page, "\nStill unsent.\n");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      RETRYING_LABEL,
    );
    fs.writeFileSync(filePath, CLOBBERED);
    await expect(fileConflictNotice(page)).toBeVisible();

    await page.reload();
    // A `page.route` block outlives the navigation, so the offer below would
    // otherwise be saved away before it could be asserted.
    await blockSaves(page);

    await expect(page.getByTestId("draft-restore-notice")).toBeVisible();
    await expect(codeEditor(page)).toContainText("overwrote everything");
    // Nothing was written behind the reviewer's back.
    expect(readProjectFile(projectDir, "reload.md")).toBe(CLOBBERED);

    logE2eEvent("history-restore.reload-parks-unsent-edits", {
      file: "reload.md",
    });
  });
});
