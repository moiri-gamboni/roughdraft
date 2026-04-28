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

test.describe("markdown round-trips", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("roundtrip");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("toggles rich text and code mode without rewriting literal CriticMarkup @smoke", async ({
    page,
  }) => {
    const original = [
      "---",
      "title: Literal CriticMarkup",
      "---",
      "",
      "# Round Trip",
      "",
      "Inline code stays literal: `{==not a comment==}`.",
      "",
      "```md",
      "{>>not review feedback<<}",
      "{++not a suggestion++}",
      "```",
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "roundtrip.md", original);

    await openMarkdownFile(page, filePath);
    await expect(
      page.getByRole("heading", { name: "Round Trip" }),
    ).toBeVisible();

    await page.getByLabel("Switch to code view").click();
    await expect(page.locator(".cm-content")).toContainText(
      "{>>not review feedback<<}",
    );

    await page.getByLabel("Switch to rich text view").click();
    await expect(
      page.getByRole("heading", { name: "Round Trip" }),
    ).toBeVisible();
    expect(readProjectFile(projectDir, "roundtrip.md")).toBe(original);

    logE2eEvent("markdown-roundtrip.toggle-preserved", {
      file: "roundtrip.md",
    });
  });

  test("saves code-mode edits to disk while preserving fenced CriticMarkup examples @smoke", async ({
    page,
  }) => {
    const initial = [
      "# Code Save",
      "",
      "```md",
      "{==literal==}{>>example<<}",
      "```",
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "code-save.md", initial);

    await openMarkdownFile(page, filePath, "code");
    await appendInCodeEditor(page, "\nSaved from Playwright.\n");

    await expect
      .poll(() => readProjectFile(projectDir, "code-save.md"))
      .toContain("Saved from Playwright.");
    expect(readProjectFile(projectDir, "code-save.md")).toContain(
      "{==literal==}{>>example<<}",
    );

    logE2eEvent("markdown-roundtrip.code-save", {
      size: fs.statSync(filePath).size,
    });
  });
});
