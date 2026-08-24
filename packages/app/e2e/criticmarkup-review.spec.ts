import { expect, test, type Page } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  selectRichText,
  writeProjectFile,
} from "./helpers";

test.describe("CriticMarkup review flows", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("criticmarkup");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("renders a comment thread and saves a reply @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "comment.md",
      [
        "# Comment Review",
        "",
        'This paragraph has {==target text==}{>>Needs detail<<}{id="c1" by="user" at="2026-04-23T18:00:00.000Z"}.',
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await expect(page.getByTestId("document-review-rail")).toContainText(
      "Needs detail",
    );

    await page
      .getByTestId("comment-rail-c1-action-reply")
      .evaluate((element) => {
        (element as HTMLButtonElement).click();
      });
    await page
      .getByTestId("comment-rail-c2-editor")
      .fill("Added context looks good.");
    await page
      .getByTestId("comment-rail-c2-action-save")
      .evaluate((element) => {
        (element as HTMLButtonElement).click();
      });

    await expect
      .poll(() => readProjectFile(projectDir, "comment.md"))
      .toContain("Added context looks good.");
    expect(readProjectFile(projectDir, "comment.md")).toContain('re="c1"');

    logE2eEvent("criticmarkup.reply-saved", {
      file: "comment.md",
    });
  });

  test("creates a new root comment and saves it to disk @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "new-comment.md",
      [
        "# New Comment",
        "",
        "This paragraph has target text to review.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");
    await page.getByTestId("selection-menu-action-comment").click();
    await page
      .getByTestId("comment-rail-c1-editor")
      .fill("Clarify this phrase.");
    await page.getByTestId("comment-rail-c1-action-save").click();

    await expect
      .poll(() => readProjectFile(projectDir, "new-comment.md"))
      .toMatch(
        /\{==target text==\}\{>>Clarify this phrase\.<<\}\{id="c1" by="user" at="[^"]+"\}/,
      );

    logE2eEvent("criticmarkup.root-comment-saved", {
      file: "new-comment.md",
    });
  });

  test("animates the document layout when the review rail appears and disappears @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "layout-animation.md",
      [
        "# Layout Animation",
        "",
        "This paragraph has target text to review.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");
    await page.getByTestId("selection-menu-action-comment").waitFor();

    await recordReviewLayoutTransitions(page);
    await page.getByTestId("selection-menu-action-comment").click();
    await expectAnimatedReviewLayout(page);

    await page
      .getByTestId("comment-rail-c1-editor")
      .fill("Clarify this phrase.");
    await page.getByTestId("comment-rail-c1-action-save").click();

    await page.getByTestId("comment-rail-c1-action-delete-thread").waitFor();
    await recordReviewLayoutTransitions(page);
    await page.getByTestId("comment-rail-c1-action-delete-thread").click();
    await expectAnimatedReviewLayout(page);

    logE2eEvent("criticmarkup.layout-animation", {
      file: "layout-animation.md",
    });
  });

  test("shows tooltips for selection menu formatting actions", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "selection-tooltips.md",
      [
        "# Selection Tooltips",
        "",
        "This paragraph has target text to review.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");

    await page.getByTestId("selection-menu-action-bold").hover();
    await expect(page.getByTestId("selection-menu-action-tooltip")).toHaveText(
      "Bold",
    );

    await expect(
      page.getByTestId("selection-menu-action-suggest-insertion"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("selection-menu-action-suggest-deletion"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("selection-menu-action-suggest-replacement"),
    ).toHaveCount(0);

    await page.getByTestId("selection-menu-action-comment").hover();
    await expect(page.getByTestId("selection-menu-action-tooltip")).toHaveCount(
      0,
    );
  });

  test("accepts and rejects suggested changes on disk @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "suggestions.md",
      [
        "# Suggestion Review",
        "",
        'Keep {++clear wording++}{id="s1" by="user" at="2026-04-23T18:00:00.000Z"} here.',
        "",
        'Remove {--drafty --}{id="s2" by="user" at="2026-04-23T18:01:00.000Z"}there.',
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await expect(page.locator('[data-critic-change-id="s1"]')).toBeVisible();

    await page.getByTestId("comment-rail-s1-action-accept").click();
    await expect
      .poll(() => readProjectFile(projectDir, "suggestions.md"))
      .toContain("Keep clear wording here.");

    await page.getByTestId("comment-rail-s2-action-reject").click();
    await expect
      .poll(() => readProjectFile(projectDir, "suggestions.md"))
      .toContain("Remove drafty there.");
    expect(readProjectFile(projectDir, "suggestions.md")).not.toContain("{++");
    expect(readProjectFile(projectDir, "suggestions.md")).not.toContain("{--");

    logE2eEvent("criticmarkup.suggestions-applied", {
      file: "suggestions.md",
    });
  });
});

/**
 * The two elements the review-layout shift moves.
 *
 * That they move *together* is deliberately not asserted: measured 90ms and
 * 500ms apart under load in runs where the animation was fine, so the two
 * shifts are not always one commit and pinning it here only buys a flake back.
 * See `docs/solutions/test-flakiness/a-time-budget-is-not-evidence.md`.
 */
const REVIEW_LAYOUT_TEST_IDS = ["document-page-header", "document-page-shell"];

type ReviewLayoutRest = {
  testId: string;
  offsetX: number;
  animating: boolean;
};

type ReviewLayoutRecorder = {
  reviewLayoutTransitions?: string[];
  reviewLayoutRecording?: boolean;
};

/**
 * Start recording which review-layout elements begin a transform transition.
 *
 * Transition events are the only evidence of this animation that survives a
 * busy machine. Sampling transforms across animation frames misses the whole
 * 180ms window whenever rendering stalls, and reading a transform inside the
 * event handler is no better: the transition is composited, so under load it
 * has already finished by the time the main thread dispatches the event. That
 * a `transform` transition started at all is enough — the transition property
 * only exists while the animating class is applied, and a transition only
 * fires when the value actually changes, which the hook keeps above 1px.
 *
 * Recording starts from a standstill. A shift still finishing from an earlier
 * step would otherwise be the first start this sees for one element, and the
 * two elements' starts would no longer be from the same movement.
 */
async function recordReviewLayoutTransitions(page: Page) {
  await expectReviewLayoutAtRest(page);
  await page.evaluate((testIds) => {
    const recorder = window as Window & ReviewLayoutRecorder;
    recorder.reviewLayoutTransitions = [];
    if (recorder.reviewLayoutRecording) return;
    recorder.reviewLayoutRecording = true;

    document.addEventListener(
      "transitionstart",
      (event) => {
        if (event.propertyName !== "transform") return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const testId = target.dataset.testid ?? "";
        if (!testIds.includes(testId)) return;

        const started = recorder.reviewLayoutTransitions;
        if (started && !started.includes(testId)) started.push(testId);
      },
      { capture: true },
    );
  }, REVIEW_LAYOUT_TEST_IDS);
}

function readReviewLayoutRest(page: Page) {
  return page.evaluate(
    (testIds) =>
      testIds.map((testId) => {
        const element = document.querySelector(`[data-testid="${testId}"]`);
        if (!(element instanceof HTMLElement)) {
          // Never equals the expected rest state, so the poll keeps waiting.
          return {
            testId,
            offsetX: Number.NaN,
            animating: false,
          } satisfies ReviewLayoutRest;
        }

        const transform = getComputedStyle(element).transform;
        const translateX =
          transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
        return {
          testId,
          offsetX: Math.abs(Math.round(translateX)),
          animating: element.classList.contains(
            "review-layout-grid--animating",
          ),
        } satisfies ReviewLayoutRest;
      }),
    REVIEW_LAYOUT_TEST_IDS,
  );
}

/** No shift is in flight and both elements sit on the current layout. */
async function expectReviewLayoutAtRest(page: Page) {
  await expect
    .poll(() => readReviewLayoutRest(page))
    .toEqual(
      REVIEW_LAYOUT_TEST_IDS.map((testId) => ({
        testId,
        offsetX: 0,
        animating: false,
      })),
    );
}

/** Both elements animated the shift, then settled onto the new layout. */
async function expectAnimatedReviewLayout(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & ReviewLayoutRecorder).reviewLayoutTransitions ??
          [],
      ),
    )
    .toEqual(expect.arrayContaining(REVIEW_LAYOUT_TEST_IDS));

  await expectReviewLayoutAtRest(page);
}
