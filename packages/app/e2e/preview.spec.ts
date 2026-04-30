import { expect, test } from "@playwright/test";
import { appendInCodeEditor, logE2eEvent } from "./helpers";

test.describe("in-memory preview", () => {
  test("edits the preview document without persisting it @smoke", async ({
    page,
  }) => {
    await page.goto("/preview?editor=code");

    await expect(page.locator(".cm-content")).toContainText("Live Preview");
    await appendInCodeEditor(page, "\n\nPreview-only edit.");
    await expect(page.locator(".cm-content")).toContainText(
      "Preview-only edit.",
    );

    const roughdraftStorageKeys = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) =>
        key.startsWith("roughdraft:"),
      ),
    );
    expect(roughdraftStorageKeys).toEqual([]);

    await page.reload();
    await expect(page.locator(".cm-content")).toContainText("Live Preview");
    await expect(page.locator(".cm-content")).not.toContainText(
      "Preview-only edit.",
    );

    logE2eEvent("preview.in-memory-edit", {
      route: "/preview",
      persistedStorageKeys: roughdraftStorageKeys.length,
    });
  });
});
