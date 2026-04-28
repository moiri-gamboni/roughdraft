import fs from "node:fs";
import { expect, test } from "@playwright/test";
import {
  appendInCodeEditor,
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

test.describe("stale writes", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("stale-write");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("surfaces a save conflict when the file changed externally @smoke", async ({
    page,
  }) => {
    await page.route("**/api/markdown-file/events**", (route) => route.abort());

    const filePath = writeProjectFile(
      projectDir,
      "conflict.md",
      "# Conflict\n\nOriginal body.\n",
    );

    await openMarkdownFile(page, filePath, "code");
    await expect(page.locator(".cm-content")).toContainText("Original body.");

    fs.writeFileSync(filePath, "# Conflict\n\nExternal body.\n");
    await appendInCodeEditor(page, "\nLocal body.\n");

    await expect(page.getByText("Save conflict")).toBeVisible();
    await expect(page.getByText("Reload")).toBeVisible();
    expect(readProjectFile(projectDir, "conflict.md")).toBe(
      "# Conflict\n\nExternal body.\n",
    );

    logE2eEvent("stale-write.conflict-surfaced", {
      file: "conflict.md",
    });
  });
});
