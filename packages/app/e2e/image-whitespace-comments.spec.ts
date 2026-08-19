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

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("image and whitespace comments", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("image-comments");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("comments on a selected image and saves the anchor @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "figure.md",
      [
        "# Figure Review",
        "",
        "Intro before the figure.",
        "",
        "![Sketch](./images/sketch.png)",
        "",
        "Prose after the figure.",
        "",
      ].join("\n"),
    );
    writeProjectFile(projectDir, "images/sketch.png", onePixelPng);

    await openMarkdownFile(page, filePath);

    const image = richTextEditor(page).locator('img[alt="Sketch"]');
    await expect(image).toBeVisible();
    await image.click();

    await page.getByTestId("selection-menu-action-comment").click();
    await page
      .getByTestId("comment-rail-c1-editor")
      .fill("Swap this for the updated export.");
    await page.getByTestId("comment-rail-c1-action-save").click();

    await expect
      .poll(() => readProjectFile(projectDir, "figure.md"))
      .toMatch(
        /\{==!\[Sketch\]\(\.\/images\/sketch\.png\)==\}\{>>Swap this for the updated export\.<<\}\{id="c1" by="user" at="[^"]+"\}/,
      );
    expect(readProjectFile(projectDir, "figure.md")).toContain(
      "Intro before the figure.\n",
    );

    logE2eEvent("image-comments.image-anchor-saved", {
      file: "figure.md",
    });
  });

  test("drops a point comment at the caret and saves it standalone", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "point.md",
      [
        "# Point Comment",
        "",
        "Closing paragraph before the gap.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);

    const editor = richTextEditor(page);
    await editor.getByText("Closing paragraph before the gap.").click();
    await page.keyboard.press("End");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Alt+m" : "Control+Alt+m",
    );

    await page
      .getByTestId("comment-rail-c1-editor")
      .fill("Add a wrap-up section here.");
    await page.getByTestId("comment-rail-c1-action-save").click();

    await expect
      .poll(() => readProjectFile(projectDir, "point.md"))
      .toMatch(
        /Closing paragraph before the gap\.\{>>Add a wrap-up section here\.<<\}\{id="c1" by="user" at="[^"]+"\}/,
      );

    logE2eEvent("image-comments.point-comment-saved", {
      file: "point.md",
    });
  });
});
