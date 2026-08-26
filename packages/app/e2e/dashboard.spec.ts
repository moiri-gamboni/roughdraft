import type { APIResponse } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  removeMarkdownProject,
  richTextEditor,
  writeProjectFile,
} from "./helpers";

/**
 * Deliberately longer than the 30s Playwright test timeout, for the reason
 * `review-handoff.spec.ts` gives: the parked watch is what puts the row in
 * "Waiting for your review" at all, so a budget that could expire mid-flow
 * would let a loaded machine, rather than the product, decide whether the badge
 * is there. The happy path releases the watch explicitly, so the budget is
 * never actually spent.
 */
const WATCH_TIMEOUT_SECONDS = 60;

/**
 * How long to let a still-parked watch settle during teardown. A test that
 * fails before the release leaves the poll running, and awaiting it in full
 * would spend the watch budget inside `afterEach` — where Playwright charges it
 * to the test, burying the real assertion failure under a hook timeout.
 */
const WATCH_TEARDOWN_GRACE_MS = 500;

test.describe("dashboard", () => {
  let projectDir: string;
  let pendingWatch: Promise<APIResponse> | null = null;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("dashboard");
    pendingWatch = null;
  });

  test.afterEach(async () => {
    if (pendingWatch) {
      await Promise.race([
        pendingWatch.catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, WATCH_TEARDOWN_GRACE_MS)),
      ]);
    }
    removeMarkdownProject(projectDir);
  });

  // The suite is `fullyParallel` against one shared API server, so every
  // assertion below is scoped to this spec's own `mkdtemp` path. Row counts or
  // "this section is absent" would be assertions about the other specs.
  test("lists the document an agent is blocked on and opens it @smoke", async ({
    page,
    request,
  }) => {
    const relativePath = "waiting-review.md";
    const absolutePath = writeProjectFile(
      projectDir,
      relativePath,
      ["# Waiting Review", "", "An agent is blocked on this.", ""].join("\n"),
    );

    pendingWatch = request.post("/api/review-events/watch", {
      data: {
        projectPath: projectDir,
        path: relativePath,
        timeoutSeconds: WATCH_TIMEOUT_SECONDS,
      },
    });

    await page.goto("/");

    const waitingRow = page
      .getByTestId("dashboard-section-waiting")
      .locator(
        `[data-testid="dashboard-row"][data-document-path="${absolutePath}"]`,
      );

    await expect(waitingRow).toBeVisible();
    await expect(waitingRow.getByTestId("dashboard-waiting-badge")).toHaveText(
      "agent waiting",
    );

    await waitingRow.getByTestId("dashboard-row-open").click();

    await expect(richTextEditor(page)).toContainText("Waiting Review");

    const released = await request.post("/api/review-events", {
      data: { projectPath: projectDir, path: relativePath },
    });
    expect(released.ok()).toBe(true);

    const watchResponse = await pendingWatch;
    pendingWatch = null;
    expect(await watchResponse.json()).toMatchObject({
      events: [{ type: "review.completed", documentPath: absolutePath }],
    });
  });
});
