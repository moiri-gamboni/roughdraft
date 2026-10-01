import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  richTextEditor,
  writeProjectFile,
} from "./helpers";

test.describe("mermaid diagrams", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("mermaid");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("renders a mermaid fence as a diagram and reveals its source for editing @smoke", async ({
    page,
  }) => {
    const original = [
      "# Timeline",
      "",
      "```mermaid",
      "flowchart TD",
      '    A["<b>Fri 2 Oct</b><br/>Announcement"] --> B["Groups form"]',
      "```",
      "",
      "After the chart.",
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "chart.md", original);

    await openMarkdownFile(page, filePath);

    const diagram = page.getByTestId("mermaid-diagram");
    const source = page.getByTestId("mermaid-source");

    await expect(page.getByTestId("mermaid-svg")).toBeVisible();
    await expect(diagram).toContainText("Announcement");
    await expect(diagram).toContainText("Groups form");
    await expect(source).toBeHidden();

    await diagram.click();
    await expect(source).toBeVisible();
    await expect(source).toContainText("flowchart TD");

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.type(" --> C[Moved in]");
    await expect(diagram).toContainText("Moved in");

    await richTextEditor(page).getByText("After the chart.").click();
    await expect(source).toBeHidden();

    await expect
      .poll(() => readProjectFile(projectDir, "chart.md"))
      .toBe(
        original.replace('"Groups form"]', '"Groups form"] --> C[Moved in]'),
      );

    logE2eEvent("mermaid.render-edit-save", { file: "chart.md" });
  });

  test("shows the source and the parse error for an invalid diagram", async ({
    page,
  }) => {
    const original = [
      "Before the chart.",
      "",
      "```mermaid",
      "flowchart TD",
      "    A --> --> B",
      "```",
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "broken.md", original);

    await openMarkdownFile(page, filePath);

    await expect(page.getByTestId("mermaid-error")).toBeVisible();
    await expect(page.getByTestId("mermaid-source")).toBeVisible();
    await expect(page.getByTestId("mermaid-source")).toContainText(
      "A --> --> B",
    );
    expect(readProjectFile(projectDir, "broken.md")).toBe(original);
    // Mermaid draws its own error graphic onto the page unless told not to.
    expect(
      await page.evaluate(() => document.body.textContent ?? ""),
    ).not.toContain("Syntax error in text");
  });

  test("keeps a commented source visible and its lines intact on save", async ({
    page,
  }) => {
    const original = [
      "Before the chart.",
      "",
      "```mermaid",
      "flowchart TD",
      "    {==A --> B==}{>>Should B come first?<<}{#c1}",
      "```",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: AI",
      '    at: "2026-10-01T12:00:00.000Z"',
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "commented.md", original);

    await openMarkdownFile(page, filePath);

    await expect(page.getByTestId("mermaid-svg")).toBeVisible();
    await expect(page.getByTestId("mermaid-source")).toBeVisible();
    await expect(
      page.getByTestId("mermaid-source").getByTestId("comment-decoration"),
    ).toHaveText("A --> B");

    // Any edit re-serializes the whole document, commented fence included.
    await richTextEditor(page).getByText("Before the chart.").click();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await expect
      .poll(() => readProjectFile(projectDir, "commented.md"))
      .toBe(original.replace("Before the chart.", "Before the chart.!"));
  });

  test("reaches the hidden source with the arrow keys", async ({ page }) => {
    const filePath = writeProjectFile(
      projectDir,
      "keys.md",
      [
        "Above.",
        "",
        "```mermaid",
        "flowchart TD",
        "    A --> B",
        "```",
        "",
        "Below.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    const source = page.getByTestId("mermaid-source");
    await expect(page.getByTestId("mermaid-svg")).toBeVisible();

    await richTextEditor(page).getByText("Above.").click();
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowDown");
    await expect(source).toBeVisible();
    await page.keyboard.type("%% top");
    await page.keyboard.press("Enter");

    await richTextEditor(page).getByText("Below.").click();
    await expect(source).toBeHidden();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowUp");
    await expect(source).toBeVisible();
    await page.keyboard.type(" %% bottom");

    await expect
      .poll(() => readProjectFile(projectDir, "keys.md"))
      .toContain("%% top\nflowchart TD\n    A --> B %% bottom\n```");
  });

  test("re-renders diagrams when the colour scheme changes", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    const filePath = writeProjectFile(
      projectDir,
      "theme.md",
      ["```mermaid", "flowchart TD", "    A --> B", "```", ""].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    const diagram = page.getByTestId("mermaid-diagram");
    await expect(diagram).toHaveAttribute("data-theme", "default");

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(diagram).toHaveAttribute("data-theme", "dark");
  });
});
