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

    await expect(
      page.getByRole("status", { name: "Save conflict" }),
    ).toBeVisible();
    await expect(page.getByText("Reload")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Keep editing" }),
    ).toBeVisible();
    expect(readProjectFile(projectDir, "conflict.md")).toBe(
      "# Conflict\n\nExternal body.\n",
    );

    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(
      page.getByRole("status", { name: "Autosave paused" }),
    ).toBeVisible();
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

  test("overwrite after conflict marks the current draft saved", async ({
    page,
  }) => {
    await page.route("**/api/markdown-file/events**", (route) => route.abort());

    const filePath = writeProjectFile(
      projectDir,
      "overwrite-conflict.md",
      "# Conflict\n\nOriginal body.\n",
    );

    await openMarkdownFile(page, filePath, "code");
    await expect(page.locator(".cm-content")).toContainText("Original body.");

    fs.writeFileSync(filePath, "# Conflict\n\nExternal body.\n");
    await appendInCodeEditor(page, "\nLocal overwrite body.\n");

    await expect(
      page.getByRole("status", { name: "Save conflict" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Overwrite disk file" }).click();

    await expect
      .poll(() => readProjectFile(projectDir, "overwrite-conflict.md"))
      .toContain("Local overwrite body.");
    await expect(page.getByRole("status", { name: "Saved" })).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Save failed" }),
    ).toBeHidden();
    await expect(
      page.getByRole("status", { name: "Unsaved changes" }),
    ).toBeHidden();

    logE2eEvent("stale-write.overwrite-saved", {
      file: "overwrite-conflict.md",
      size: fs.statSync(filePath).size,
    });
  });

  test("manual save preserves expected-version conflict behavior", async ({
    page,
  }) => {
    await page.route("**/api/markdown-file/events**", (route) => route.abort());

    const filePath = writeProjectFile(
      projectDir,
      "manual-conflict.md",
      "# Manual Conflict\n\nOriginal body.\n",
    );

    await openMarkdownFile(page, filePath, "code");
    await expect(page.locator(".cm-content")).toContainText("Original body.");

    fs.writeFileSync(filePath, "# Manual Conflict\n\nExternal body.\n");
    await appendInCodeEditor(page, "\nLocal body.\n");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+S" : "Control+S",
    );

    await expect(
      page.getByRole("status", { name: "Save conflict" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "File conflict" }),
    ).toContainText("This file changed on disk while you have unsaved edits.");
    expect(readProjectFile(projectDir, "manual-conflict.md")).toBe(
      "# Manual Conflict\n\nExternal body.\n",
    );

    logE2eEvent("stale-write.manual-conflict", {
      file: "manual-conflict.md",
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

  test("keeps conflict banner and save status stack from overlapping", async ({
    page,
  }) => {
    await page.route("**/api/markdown-file/events**", (route) => route.abort());

    const filePath = writeProjectFile(
      projectDir,
      "layout-conflict.md",
      "# Layout conflict\n\nOriginal body.\n",
    );

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
    ]) {
      fs.writeFileSync(filePath, "# Layout conflict\n\nOriginal body.\n");
      await page.setViewportSize(viewport);
      await openMarkdownFile(page, filePath, "code");
      await expect(page.locator(".cm-content")).toContainText("Original body.");

      fs.writeFileSync(filePath, "# Layout conflict\n\nExternal body.\n");
      await appendInCodeEditor(page, `\nLocal body ${viewport.width}.\n`);

      const conflictNotice = page.getByRole("status", {
        name: "File conflict",
      });
      const statusStack = page.locator('[data-document-status-stack="true"]');
      await expect(conflictNotice).toBeVisible();
      await expect(statusStack).toBeVisible();

      const conflictBox = await conflictNotice.boundingBox();
      const stackBox = await statusStack.boundingBox();
      expect(conflictBox).not.toBeNull();
      expect(stackBox).not.toBeNull();

      if (!conflictBox || !stackBox) {
        throw new Error("Expected conflict and status stack bounds");
      }

      const intersects =
        conflictBox.x < stackBox.x + stackBox.width &&
        conflictBox.x + conflictBox.width > stackBox.x &&
        conflictBox.y < stackBox.y + stackBox.height &&
        conflictBox.y + conflictBox.height > stackBox.y;

      expect(intersects).toBe(false);
      await page.getByRole("button", { name: "Reload from disk" }).click();
      await expect(conflictNotice).toBeHidden();
    }
  });
});
