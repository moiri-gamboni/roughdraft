import { expect, test } from "@playwright/test";
import { logE2eEvent } from "./helpers";

test.describe("homepage workflow storyboard", () => {
  test("renders the plan-review storyboard above the Markdown section @smoke", async ({
    page,
  }, testInfo) => {
    await page.goto("/");

    const storyboard = page.getByTestId("homepage-workflow-storyboard");
    await expect(storyboard).toBeVisible();
    await expect(page.getByTestId("homepage-workflow-heading")).toHaveText(
      "How it works",
    );

    const scenes = storyboard.getByTestId("homepage-workflow-scene");
    await expect(scenes).toHaveCount(6);
    const sceneTexts = await scenes.allTextContents();
    expect(sceneTexts).toHaveLength(6);
    expect(sceneTexts[0]).toContain("Ask for a plan");
    expect(sceneTexts[1]).toContain("The agent works normally");
    expect(sceneTexts[2]).toContain("Roughdraft opens the plan");
    expect(sceneTexts[3]).toContain("Leave comments and suggestions");
    expect(sceneTexts[4]).toContain("Click I'm done");
    expect(sceneTexts[5]).toContain("The agent resumes");
    await expect(storyboard).toContainText(
      "Let's make the homepage more persuasive. Write a plan first.",
    );

    const agentWorkTranscript = storyboard.getByTestId(
      "homepage-workflow-agent-work",
    );
    await expect(agentWorkTranscript).toHaveAttribute(
      "data-agent-work-visible",
      "false",
    );
    const hiddenTranscriptState = await agentWorkTranscript.evaluate(
      (element) => ({
        maxHeight: window.getComputedStyle(element).maxHeight,
        opacity: window.getComputedStyle(element).opacity,
      }),
    );
    expect(hiddenTranscriptState).toEqual({
      maxHeight: "0px",
      opacity: "0",
    });

    const roughdraftPopup = storyboard.getByTestId("homepage-workflow-popup");
    await expect(roughdraftPopup).toHaveAttribute(
      "data-popup-visible",
      "false",
    );
    await expect(roughdraftPopup).toHaveAttribute("aria-hidden", "true");

    const hiddenPopupState = await roughdraftPopup.evaluate((element) => ({
      opacity: window.getComputedStyle(element).opacity,
      pointerEvents: window.getComputedStyle(element).pointerEvents,
    }));
    expect(hiddenPopupState).toEqual({
      opacity: "0",
      pointerEvents: "none",
    });

    await scenes.nth(1).evaluate((element) => {
      window.scrollTo({
        top: element.getBoundingClientRect().top + window.scrollY - 1,
      });
    });
    await expect(agentWorkTranscript).toHaveAttribute(
      "data-agent-work-visible",
      "false",
    );

    await scenes.nth(1).evaluate((element) => {
      window.scrollTo({
        top: element.getBoundingClientRect().top + window.scrollY,
      });
    });
    await expect(agentWorkTranscript).toHaveAttribute(
      "data-agent-work-visible",
      "true",
    );
    await expect(storyboard).toContainText(
      "I'll inspect the current homepage, draft a Markdown plan, and open it in Roughdraft for review before I code.",
    );
    await expect(
      storyboard.getByTestId("homepage-workflow-terminal-tools"),
    ).toContainText("Tool calls");
    await expect(roughdraftPopup).toHaveAttribute(
      "data-popup-visible",
      "false",
    );

    await scenes.nth(2).evaluate((element) => {
      window.scrollTo({
        top: element.getBoundingClientRect().top + window.scrollY,
      });
    });
    await expect(roughdraftPopup).toHaveAttribute("data-popup-visible", "true");
    await expect(roughdraftPopup).not.toHaveAttribute("aria-hidden", "true");
    await expect(
      storyboard.getByTestId("homepage-workflow-document-title"),
    ).toBeVisible();
    await expect(
      roughdraftPopup.getByTestId(
        "homepage-workflow-document-shell-no-comments",
      ),
    ).toBeVisible();
    const previewLayout = await storyboard.evaluate((element) => {
      const terminal = element.querySelector(
        '[data-testid="homepage-workflow-terminal"]',
      );
      const popup = element.querySelector(
        '[data-testid="homepage-workflow-popup"]',
      );
      const scaledDocument = element.querySelector(
        '[data-testid="homepage-workflow-document-scale"]',
      );
      if (!terminal || !popup || !scaledDocument) {
        throw new Error("Expected terminal, popup, and scaled document");
      }

      const transform = window.getComputedStyle(scaledDocument).transform;
      const matrix =
        transform === "none"
          ? new DOMMatrixReadOnly()
          : new DOMMatrixReadOnly(transform);

      return {
        documentScale: matrix.a,
        popupWidth: popup.getBoundingClientRect().width,
        terminalWidth: terminal.getBoundingClientRect().width,
      };
    });
    expect(previewLayout.popupWidth).toBeGreaterThan(
      previewLayout.terminalWidth,
    );
    expect(previewLayout.documentScale).toBeCloseTo(0.6, 2);
    await expect(
      roughdraftPopup.getByTestId("homepage-workflow-review-comment"),
    ).toHaveCount(0);
    await expect(
      storyboard.getByTestId("homepage-workflow-handoff-button"),
    ).toHaveCount(0);
    await expect(storyboard).not.toContainText("Review complete");

    await scenes.nth(3).evaluate((element) => {
      window.scrollTo({
        top: element.getBoundingClientRect().top + window.scrollY,
      });
    });
    await expect(
      roughdraftPopup.getByTestId(
        "homepage-workflow-document-shell-with-comments",
      ),
    ).toBeVisible();
    await expect(
      roughdraftPopup.getByTestId("homepage-workflow-review-comment"),
    ).toBeVisible();
    const commentsLayout = await storyboard.evaluate((element) => {
      const popup = element.querySelector(
        '[data-testid="homepage-workflow-popup"]',
      );
      const shell = element.querySelector(
        '[data-testid="homepage-workflow-document-shell-with-comments"]',
      );
      if (!popup || !shell) {
        throw new Error("Expected popup and comments shell");
      }

      return {
        bodyScrollWidth: document.body.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        popupWidth: popup.getBoundingClientRect().width,
        shellWidth: shell.getBoundingClientRect().width,
        viewportWidth: window.innerWidth,
      };
    });
    expect(commentsLayout.bodyScrollWidth).toBeLessThanOrEqual(
      commentsLayout.viewportWidth,
    );
    expect(commentsLayout.documentScrollWidth).toBeLessThanOrEqual(
      commentsLayout.viewportWidth,
    );
    expect(commentsLayout.shellWidth).toBeLessThan(
      commentsLayout.popupWidth * 0.85,
    );

    await scenes.nth(4).evaluate((element) => {
      window.scrollTo({
        top: element.getBoundingClientRect().top + window.scrollY,
      });
    });
    await expect(
      storyboard.getByTestId("homepage-workflow-handoff-button"),
    ).toBeVisible();
    await expect(storyboard).not.toContainText("Review complete");

    const stickyLayout = await storyboard.evaluate((element) => {
      const sticky = element.querySelector(
        '[data-testid="homepage-workflow-sticky-visual"]',
      );
      const sceneList = element.querySelector(
        '[data-testid="homepage-workflow-scene-list"]',
      );
      if (!sticky || !sceneList) {
        throw new Error("Expected sticky visual and scene list");
      }

      const stickyRect = sticky.getBoundingClientRect();
      const sceneListRect = sceneList.getBoundingClientRect();
      return {
        position: window.getComputedStyle(sticky).position,
        sceneListRight: sceneListRect.right,
        stickyLeft: stickyRect.left,
        stickyTop: stickyRect.top,
      };
    });
    expect(stickyLayout.position).toBe("sticky");
    expect(stickyLayout.stickyLeft).toBeGreaterThan(
      stickyLayout.sceneListRight,
    );

    const sceneLayout = await scenes.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          top: rect.top + window.scrollY,
        };
      }),
    );
    expect(sceneLayout).toHaveLength(6);
    for (let index = 1; index < sceneLayout.length; index += 1) {
      expect(sceneLayout[index].top).toBeGreaterThan(
        sceneLayout[index - 1].top,
      );
    }
    for (const scene of sceneLayout) {
      expect(scene.height).toBeGreaterThan(500);
    }

    const storyboardTop = await storyboard.evaluate(
      (element) => element.getBoundingClientRect().top + window.scrollY,
    );
    const markdownTop = await page
      .getByTestId("rfm-format-demo")
      .evaluate(
        (element) => element.getBoundingClientRect().top + window.scrollY,
      );
    expect(storyboardTop).toBeLessThan(markdownTop);

    await testInfo.attach("homepage-workflow-storyboard-desktop", {
      body: await storyboard.screenshot(),
      contentType: "image/png",
    });

    logE2eEvent("homepage.workflow-storyboard.desktop", {
      commentsLayout,
      previewLayout,
      sceneLayout,
      stickyLayout,
      storyboardTop,
      markdownTop,
    });
  });

  test("docks the storyboard visual without mobile overlap", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const storyboard = page.getByTestId("homepage-workflow-storyboard");
    await expect(storyboard).toBeVisible();
    await expect(page.getByTestId("homepage-workflow-heading")).toHaveText(
      "How it works",
    );

    const mobileSceneTexts = await storyboard
      .getByTestId("homepage-workflow-scene")
      .allTextContents();
    expect(mobileSceneTexts).toHaveLength(6);
    expect(mobileSceneTexts[0]).toContain("Ask for a plan");
    expect(mobileSceneTexts[1]).toContain("The agent works normally");
    expect(mobileSceneTexts[2]).toContain("Roughdraft opens the plan");
    expect(mobileSceneTexts[3]).toContain("Leave comments and suggestions");
    expect(mobileSceneTexts[4]).toContain("Click I'm done");
    expect(mobileSceneTexts[5]).toContain("The agent resumes");

    const stickyVisual = storyboard.getByTestId(
      "homepage-workflow-sticky-visual",
    );
    await expect(stickyVisual).toBeVisible();
    const scenes = storyboard.getByTestId("homepage-workflow-scene");

    await storyboard.evaluate((element) => {
      window.scrollTo({
        top: element.getBoundingClientRect().top + window.scrollY,
      });
    });

    const layoutAtStart = await storyboard.evaluate((element) => {
      const sticky = element.querySelector(
        '[data-testid="homepage-workflow-sticky-visual"]',
      );
      const sceneList = element.querySelector(
        '[data-testid="homepage-workflow-scene-list"]',
      );
      const popup = element.querySelector(
        '[data-testid="homepage-workflow-popup"]',
      );
      if (!sticky || !sceneList || !popup) {
        throw new Error("Expected sticky visual, scene list, and popup");
      }

      const stickyRect = sticky.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();
      const stickyStyles = window.getComputedStyle(sticky);
      const sceneListStyles = window.getComputedStyle(sceneList);
      const popupStyles = window.getComputedStyle(popup);

      return {
        bodyScrollWidth: document.body.scrollWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        popupLeft: popupRect.left,
        popupRight: popupRect.right,
        popupOverhang: popupStyles.getPropertyValue(
          "--homepage-workflow-popup-overhang",
        ),
        position: stickyStyles.position,
        sceneListPaddingBottom: Number.parseFloat(
          sceneListStyles.paddingBottom,
        ),
        stickyBottomGap: window.innerHeight - stickyRect.bottom,
        stickyHeight: stickyRect.height,
        stickyTop: stickyRect.top,
        storyboardClientWidth: element.clientWidth,
        storyboardScrollWidth: element.scrollWidth,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });

    expect(layoutAtStart.position).toBe("sticky");
    expect(layoutAtStart.stickyBottomGap).toBeGreaterThanOrEqual(8);
    expect(layoutAtStart.stickyBottomGap).toBeLessThan(40);
    expect(layoutAtStart.stickyHeight).toBeGreaterThan(200);
    expect(layoutAtStart.sceneListPaddingBottom).toBeGreaterThan(
      layoutAtStart.stickyHeight,
    );
    expect(layoutAtStart.popupOverhang.trim()).toBe("0rem");
    expect(layoutAtStart.popupLeft).toBeGreaterThanOrEqual(0);
    expect(layoutAtStart.popupRight).toBeLessThanOrEqual(
      layoutAtStart.viewportWidth,
    );

    const stageLayouts: Array<{
      copyBottom: number;
      copyTop: number;
      documentTitleBottom: number | null;
      documentTitleTop: number | null;
      stage: number;
      stickyBottom: number;
      stickyTop: number;
      viewportHeight: number;
    }> = [];
    for (const index of [1, 2, 3, 4, 5]) {
      const targetStage = String(index + 1);
      await scenes.nth(index).evaluate((element) => {
        const sticky = document.querySelector(
          '[data-testid="homepage-workflow-sticky-visual"]',
        );
        if (!sticky) {
          throw new Error("Expected sticky visual");
        }

        const stickyRect = sticky.getBoundingClientRect();
        const activationLine = Math.max(
          0,
          Math.ceil(
            stickyRect.top -
              Math.min(stickyRect.height + 32, window.innerHeight * 0.35),
          ),
        );
        window.scrollTo({
          top:
            element.getBoundingClientRect().top +
            window.scrollY -
            activationLine,
        });
      });

      await expect(
        storyboard.getByTestId("homepage-workflow-terminal"),
      ).toHaveAttribute("data-homepage-workflow-terminal-stage", targetStage);

      stageLayouts.push(
        await scenes.nth(index).evaluate((element, stage) => {
          const sticky = document.querySelector(
            '[data-testid="homepage-workflow-sticky-visual"]',
          );
          const sceneCopy = element.querySelector(
            ".homepage-workflow-scene-copy",
          );
          const documentTitle = document.querySelector(
            '[data-testid="homepage-workflow-document-title"]',
          );
          if (!sticky || !sceneCopy || !documentTitle) {
            throw new Error(
              "Expected sticky visual, scene copy, and document title",
            );
          }

          const stickyRect = sticky.getBoundingClientRect();
          const copyRect = sceneCopy.getBoundingClientRect();
          const titleRect = documentTitle.getBoundingClientRect();
          return {
            copyBottom: copyRect.bottom,
            copyTop: copyRect.top,
            documentTitleBottom: stage >= 3 ? titleRect.bottom : null,
            documentTitleTop: stage >= 3 ? titleRect.top : null,
            stage,
            stickyBottom: stickyRect.bottom,
            stickyTop: stickyRect.top,
            viewportHeight: window.innerHeight,
          };
        }, index + 1),
      );
    }

    for (const stageLayout of stageLayouts) {
      expect(stageLayout.copyTop).toBeGreaterThanOrEqual(0);
      expect(stageLayout.copyBottom).toBeLessThanOrEqual(
        stageLayout.stickyTop - 8,
      );
      expect(stageLayout.stickyBottom).toBeLessThanOrEqual(
        stageLayout.viewportHeight,
      );
      if (
        stageLayout.stage >= 3 &&
        stageLayout.documentTitleTop !== null &&
        stageLayout.documentTitleBottom !== null
      ) {
        expect(stageLayout.documentTitleTop).toBeGreaterThanOrEqual(
          stageLayout.stickyTop + 8,
        );
        expect(stageLayout.documentTitleBottom).toBeLessThanOrEqual(
          stageLayout.stickyBottom - 8,
        );
      }
    }

    const dimensions = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      storyboardClientWidth:
        document.querySelector('[data-testid="homepage-workflow-storyboard"]')
          ?.clientWidth ?? 0,
      storyboardScrollWidth:
        document.querySelector('[data-testid="homepage-workflow-storyboard"]')
          ?.scrollWidth ?? 0,
      viewportWidth: window.innerWidth,
    }));

    expect(dimensions.bodyScrollWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );
    expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );
    expect(dimensions.storyboardScrollWidth).toBeLessThanOrEqual(
      dimensions.storyboardClientWidth,
    );

    await testInfo.attach("homepage-workflow-storyboard-mobile", {
      body: await storyboard.screenshot(),
      contentType: "image/png",
    });

    logE2eEvent("homepage.workflow-storyboard.mobile-sticky", {
      dimensions,
      layoutAtStart,
      stageLayouts,
    });
  });
});
