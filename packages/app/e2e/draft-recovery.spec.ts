import fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  appendInCodeEditor,
  codeEditor,
  createMarkdownProject,
  documentSaveStatus,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

const ORIGINAL_BODY = "# Recover\n\nOriginal body.\n";
const RETRYING_LABEL = "Changes saved in this browser, retrying";

/** Only the save; the document still has to load and the watcher still runs. */
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

function waitForDraftEvent(page: Page, event: string) {
  return page.waitForEvent("console", (message) =>
    message.text().includes(`[roughdraft:draft] ${event}`),
  );
}

/** Foregrounding the tab is the wake-up the retry loop listens for. */
async function wakeTab(page: Page) {
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test.describe("draft recovery", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("draft-recovery");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("keeps edits in the browser and says so when the save cannot land @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(projectDir, "recover.md", ORIGINAL_BODY);
    await blockSaves(page);
    await openMarkdownFile(page, filePath, "code");
    await expect(codeEditor(page)).toContainText("Original body.");

    await appendInCodeEditor(page, "\nUnsent body.\n");

    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      RETRYING_LABEL,
    );
    expect(readProjectFile(projectDir, "recover.md")).toBe(ORIGINAL_BODY);

    logE2eEvent("draft-recovery.retrying-pill", { file: "recover.md" });
  });

  test("delivers the edits on its own once the save works again @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(projectDir, "converge.md", ORIGINAL_BODY);
    await blockSaves(page);
    await openMarkdownFile(page, filePath, "code");
    await expect(codeEditor(page)).toContainText("Original body.");

    await appendInCodeEditor(page, "\nUnsent body.\n");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      RETRYING_LABEL,
    );

    const retrySucceeded = waitForDraftEvent(page, "retry-succeeded");
    await allowSaves(page);
    await wakeTab(page);
    await retrySucceeded;

    await expect
      .poll(() => readProjectFile(projectDir, "converge.md"))
      .toContain("Unsent body.");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "Saved",
    );

    logE2eEvent("draft-recovery.converged", { file: "converge.md" });
  });

  test("restores the unsent edits after a reload and then delivers them @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(projectDir, "reload.md", ORIGINAL_BODY);
    await blockSaves(page);
    await openMarkdownFile(page, filePath, "code");
    await expect(codeEditor(page)).toContainText("Original body.");

    await appendInCodeEditor(page, "\nUnsent body.\n");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      RETRYING_LABEL,
    );

    // Reload while the save is still blocked: the tab's memory is gone and the
    // file on disk never received the edits.
    const restored = waitForDraftEvent(page, "restored");
    await page.reload();
    // Interception does not survive the navigation, so the block has to be
    // re-applied or the restore would simply save on the way back up.
    await blockSaves(page);
    await restored;
    await expect(codeEditor(page)).toContainText("Unsent body.");
    // Wait for the restored draft to be owed to the file again before lifting
    // the block, or the plain save beats the test to it and nothing retries.
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      RETRYING_LABEL,
    );

    const retrySucceeded = waitForDraftEvent(page, "retry-succeeded");
    await allowSaves(page);
    await wakeTab(page);
    await retrySucceeded;

    await expect
      .poll(() => readProjectFile(projectDir, "reload.md"))
      .toContain("Unsent body.");

    logE2eEvent("draft-recovery.restored-after-reload", { file: "reload.md" });
  });

  test("asks instead of clobbering when the file moved while the save was blocked", async ({
    page,
  }) => {
    const filePath = writeProjectFile(projectDir, "diverge.md", ORIGINAL_BODY);
    await blockSaves(page);
    await openMarkdownFile(page, filePath, "code");
    await expect(codeEditor(page)).toContainText("Original body.");

    await appendInCodeEditor(page, "\nUnsent body.\n");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      RETRYING_LABEL,
    );

    // Someone else edits the file. The live watcher sees this and pauses
    // autosave, which is why the reload below is the interesting moment.
    const externalBody = "# Recover\n\nSomeone else's body.\n";
    fs.writeFileSync(filePath, externalBody);
    await expect(page.getByTestId("file-conflict-notice")).toBeVisible();

    await page.reload();
    await blockSaves(page);

    await expect(page.getByTestId("draft-restore-notice")).toBeVisible();
    await expect(
      page.getByTestId("draft-restore-action-restore"),
    ).toBeVisible();
    await expect(
      page.getByTestId("draft-restore-action-discard"),
    ).toBeVisible();
    // Nothing was written behind the reviewer's back.
    expect(readProjectFile(projectDir, "diverge.md")).toBe(externalBody);

    logE2eEvent("draft-recovery.divergent-disk", { file: "diverge.md" });
  });
});
