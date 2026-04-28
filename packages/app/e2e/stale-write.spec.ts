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
    await expect(
      page.getByRole("button", { name: "Keep editing" }),
    ).toBeVisible();
    expect(readProjectFile(projectDir, "conflict.md")).toBe(
      "# Conflict\n\nExternal body.\n",
    );

    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByText("Autosave paused")).toBeVisible();
    await appendInCodeEditor(page, "\nStill local.\n");
    await expect(page.locator(".cm-content")).toContainText("Local body.");
    await expect(page.locator(".cm-content")).toContainText("Still local.");
    await expect
      .poll(() => readProjectFile(projectDir, "conflict.md"))
      .toBe("# Conflict\n\nExternal body.\n");

    logE2eEvent("stale-write.conflict-surfaced", {
      file: "conflict.md",
    });
  });

  test("rejects autosave after external content changes with stable metadata", async ({
    page,
  }) => {
    const fixedTimestamp = new Date("2026-01-01T00:00:00.000Z");
    const filePath = writeProjectFile(
      projectDir,
      "metadata-conflict.md",
      "# Original\n",
    );
    fs.utimesSync(filePath, fixedTimestamp, fixedTimestamp);

    await openMarkdownFile(page, filePath, "code");
    await expect(page.locator(".cm-content")).toContainText("Original");

    fs.writeFileSync(filePath, "# External\n");
    fs.utimesSync(filePath, fixedTimestamp, fixedTimestamp);
    await appendInCodeEditor(page, "\nLocal body.\n");

    await expect(page.getByText("Save conflict")).toBeVisible();
    expect(readProjectFile(projectDir, "metadata-conflict.md")).toBe(
      "# External\n",
    );

    logE2eEvent("stale-write.metadata-conflict-surfaced", {
      file: "metadata-conflict.md",
    });
  });

  test("keeps explanatory conflict choices visible while scrolled in a long document", async ({
    page,
  }) => {
    await page.route("**/api/markdown-file/events**", (route) => route.abort());

    const longBody = Array.from(
      { length: 120 },
      (_, index) => `Paragraph ${index + 1}: local review text.`,
    ).join("\n\n");
    const filePath = writeProjectFile(
      projectDir,
      "long-conflict.md",
      `# Long conflict\n\n${longBody}\n`,
    );

    await openMarkdownFile(page, filePath, "code");
    await expect(page.locator(".cm-content")).toContainText("Paragraph 1");

    await page.locator(".cm-content").click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+End" : "Control+End",
    );
    fs.writeFileSync(
      filePath,
      "# Long conflict\n\nExternal body from another editor.\n",
    );
    await page.keyboard.type("\nLocal draft at the bottom.\n");

    const conflictNotice = page.getByRole("status", {
      name: "File conflict",
    });
    await expect(conflictNotice).toBeVisible();
    await expect(conflictNotice).toHaveCSS("position", "fixed");
    await expect(conflictNotice).toContainText(
      "This file changed on disk while you have unsaved edits.",
    );
    await expect(conflictNotice).toContainText(
      "Autosave is paused so your draft will not overwrite those changes.",
    );
    await expect(
      conflictNotice.getByRole("button", { name: "Reload from disk" }),
    ).toBeVisible();
    await expect(
      conflictNotice.getByRole("button", {
        name: "Keep editing with autosave paused",
      }),
    ).toBeVisible();
    await expect(
      conflictNotice.getByRole("button", { name: "Overwrite disk file" }),
    ).toBeVisible();
  });
});
