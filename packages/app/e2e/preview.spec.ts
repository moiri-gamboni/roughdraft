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

  test("shows a fixed agent handoff popover from the done button", async ({
    page,
  }) => {
    await page.goto("/preview");

    const doneButton = page.getByRole("button", { name: "I'm done" });
    await expect(doneButton).toBeVisible();

    const buttonStyles = await doneButton.evaluate((button) => {
      const styles = window.getComputedStyle(button);
      const parentStyles = button.parentElement
        ? window.getComputedStyle(button.parentElement)
        : null;
      const rect = button.getBoundingClientRect();

      return {
        backgroundColor: styles.backgroundColor,
        fontWeight: styles.fontWeight,
        parentPosition: parentStyles?.position ?? null,
        top: rect.top,
        rightInset: window.innerWidth - rect.right,
      };
    });

    expect(buttonStyles.backgroundColor).toBe("rgb(0, 0, 0)");
    expect(Number(buttonStyles.fontWeight)).toBeGreaterThanOrEqual(700);
    expect(buttonStyles.parentPosition).toBe("fixed");
    expect(buttonStyles.top).toBeLessThanOrEqual(16);
    expect(buttonStyles.rightInset).toBeLessThanOrEqual(16);

    await doneButton.click();

    await expect(page.getByText("Your agent is now working")).toBeVisible();
    await expect(
      page.getByText("replying to comments, questions, and suggestions"),
    ).toBeVisible();
    await expect(page.getByText("directly editing the doc")).toBeVisible();

    logE2eEvent("preview.done-button-popover", {
      route: "/preview",
      backgroundColor: buttonStyles.backgroundColor,
      fontWeight: buttonStyles.fontWeight,
      parentPosition: buttonStyles.parentPosition,
    });
  });
});
