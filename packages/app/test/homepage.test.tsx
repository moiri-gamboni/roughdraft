import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Homepage,
  PreviewPage,
  RoughdraftFlavoredMarkdownPage,
} from "../src/App";

const AGENT_SETUP_PROMPT =
  "Install Roughdraft for me using `npm i -g roughdraft`, then read https://roughdraft.page/setup.md and set yourself up to use it.";
const APP_STYLES = readFileSync(
  resolve(process.cwd(), "src/style.css"),
  "utf8",
);

function createDomRect({
  left = 0,
  top = 0,
  width = 120,
  height = 24,
}: {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
} = {}) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function queryByTestId<T extends Element = HTMLElement>(
  container: ParentNode,
  testId: string,
) {
  return container.querySelector<T>(`[data-testid="${testId}"]`);
}

function getByTestId<T extends Element = HTMLElement>(
  container: ParentNode,
  testId: string,
) {
  const element = queryByTestId<T>(container, testId);
  expect(element).not.toBeNull();
  return element as T;
}

async function renderHomepage(root: Root) {
  await act(async () => {
    root.render(
      <Homepage
        message="Roughdraft is a markdown editor with commenting and suggest changes mode, making it easier to align with AI on complex ideas."
        updateStatus={null}
      />,
    );
    await Promise.resolve();
  });
}

describe("Homepage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    if (!("ResizeObserver" in globalThis)) {
      Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: class ResizeObserver {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      });
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      createDomRect({ width: 640, height: 480 }),
    );
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value() {
        return createDomRect({ width: 80, height: 20 });
      },
    });
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value() {
        return [createDomRect({ width: 80, height: 20 })];
      },
    });
    Object.defineProperty(HTMLElement.prototype, "getClientRects", {
      configurable: true,
      value() {
        return [this.getBoundingClientRect()];
      },
    });
    Object.defineProperty(Text.prototype, "getClientRects", {
      configurable: true,
      value() {
        return [createDomRect({ width: 80, height: 20 })];
      },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens the agent setup prompt from the CTA and copies it", async () => {
    await renderHomepage(root);

    expect(container.textContent).toContain(
      "Easier collaboration with your coding agent",
    );
    expect(container.textContent).toContain(
      "making it easier to align with AI on complex ideas",
    );
    expect(container.textContent).toContain("Free");
    expect(container.textContent).toContain("Open-source");
    expect(container.textContent).toContain("Runs locally");
    expect(container.textContent).toContain("Roughdraft flavored Markdown");
    expect(container.textContent).toContain("It's just Markdown");
    expect(container.textContent).toContain(
      "We extended the markdown format, building on prior art like CriticMarkup",
    );
    expect(
      container.querySelector('a[href="https://criticmarkup.com/"]')
        ?.textContent,
    ).toContain("CriticMarkup");
    expect(container.textContent).toContain(
      "working with other major Markdown apps to rally support",
    );
    expect(container.textContent).toContain("# Checkout Spec Review");
    expect(container.textContent).toContain(
      "PM: confirm whether this excludes SSO-only workspaces.",
    );
    expect(container.textContent).toContain("first successful team purchase");
    expect(container.textContent).toContain("Review a spec");
    expect(container.textContent).toContain("Review a plan");
    expect(container.textContent).toContain("Edit writing");
    expect(getByTestId(container, "rfm-format-demo").className).toContain(
      "max-w-none",
    );
    expect(getByTestId(container, "rfm-format-demo-intro").className).toContain(
      "px-4",
    );
    expect(
      getByTestId(container, "rfm-format-demo-examples").className,
    ).toContain("px-4");
    const formatDemoArrow = getByTestId(container, "rfm-format-demo-arrow");
    expect(formatDemoArrow?.className).toContain("items-start");
    expect(getByTestId(container, "rfm-source-pane").textContent).toContain(
      "Source",
    );
    expect(getByTestId(container, "rfm-result-pane").textContent).toContain(
      "Result",
    );
    expect(APP_STYLES).toMatch(
      /\.rfm-result-editor \.document-page-shell \{[^}]*grid-template-columns:\s*minmax\(0,\s*min\(100%,\s*42rem\)\)\s+minmax\(13rem,\s*16rem\);[^}]*justify-content:\s*start;/s,
    );
    expect(APP_STYLES).toMatch(
      /\.rfm-source-pane,\s*\.rfm-result-pane \{[^}]*border:\s*0;[^}]*background-color:\s*transparent;[^}]*box-shadow:\s*none;[^}]*overflow:\s*visible;/s,
    );
    expect(APP_STYLES).toMatch(
      /\.rfm-source-pane \.rfm-demo-pane-header \{[^}]*justify-content:\s*flex-end;/s,
    );
    expect(APP_STYLES).toMatch(
      /\.rfm-source-page \{[^}]*margin:\s*1rem;[^}]*min-height:\s*calc\(70vh \+ 7rem\);[^}]*border:\s*1px solid #e9e9e8;[^}]*border-radius:\s*0\.75rem;[^}]*background-color:\s*#fff;[^}]*box-shadow:\s*0 18px 44px rgb\(57 47 38 \/ 8%\);/s,
    );
    const resultDocumentCard = getByTestId(
      container,
      "rfm-result-editor",
    ).querySelector('[data-testid="document-content-card"]');
    expect(resultDocumentCard?.className).toContain("bg-white");
    expect(resultDocumentCard?.className).toContain("shadow-");
    expect(APP_STYLES).not.toContain("rfm-token-");
    expect(queryByTestId(container, "rfm-token")).toBeNull();
    expect(
      container.querySelector(".comment-anchor[data-comment-ids]"),
    ).not.toBeNull();
    expect(
      container.querySelector(".critic-change[data-critic-change-id]"),
    ).not.toBeNull();
    expect(container.innerHTML).not.toContain(
      'contenteditable="plaintext-only"',
    );
    expect(
      getByTestId(container, "homepage-sneak-peek-image").getAttribute("src"),
    ).toBe("/sneak-peek.png");
    expect(document.body.textContent).not.toContain(AGENT_SETUP_PROMPT);

    const cta = getByTestId<HTMLButtonElement>(
      container,
      "homepage-install-button",
    );
    const githubLink = container.querySelector(
      'a[href="https://github.com/Lex-Inc/roughdraft"]',
    );

    expect(container.textContent).not.toContain("Try live preview");
    expect(container.querySelector('a[href="/preview"]')).toBeNull();
    expect(githubLink?.textContent).toContain("View on GitHub");
    expect(githubLink?.getAttribute("target")).toBe("_blank");
    expect(githubLink?.getAttribute("rel")).toBe("noreferrer");
    expect(
      container.querySelector('a[href="/roughdraft-flavored-markdown"]')
        ?.textContent,
    ).toContain("spec");

    const planReviewButton = getByTestId<HTMLButtonElement>(
      container,
      "rfm-format-example-plan-review",
    );

    await click(planReviewButton);

    expect(container.textContent).toContain("Agent Plan Review");
    expect(container.textContent).toContain(
      "rollback note for the migration step",
    );
    expect(container.textContent).toContain('re="s1"');

    await click(cta);

    expect(document.body.textContent).toContain(
      "Give this to your coding agent",
    );
    expect(document.body.textContent).toContain(AGENT_SETUP_PROMPT);

    const copyButton = getByTestId<HTMLButtonElement>(
      document.body,
      "homepage-copy-prompt-button",
    );

    await click(copyButton);

    expect(writeText).toHaveBeenCalledWith(AGENT_SETUP_PROMPT);
    expect(document.body.textContent).toContain("Copied");
  });

  it("explains the plan-review workflow with scrolling steps and a sticky visual", async () => {
    await renderHomepage(root);

    const text = container.textContent ?? "";
    expect(text).toContain("How it works");

    const storyboard = getByTestId(container, "homepage-workflow-storyboard");
    expect(storyboard.getAttribute("aria-labelledby")).toBe(
      "homepage-workflow-heading",
    );
    expect(
      getByTestId(storyboard, "homepage-workflow-heading").textContent,
    ).toBe("How it works");

    const markdownDemo = getByTestId(container, "rfm-format-demo");
    expect(
      storyboard.compareDocumentPosition(markdownDemo) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const scenes = [
      "Ask for a plan",
      "The agent works normally",
      "Roughdraft opens the plan",
      "Leave comments and suggestions",
      "Click I'm done",
      "The agent resumes",
    ];

    const sceneNodes = [
      ...storyboard.querySelectorAll('[data-testid="homepage-workflow-scene"]'),
    ];
    expect(sceneNodes).toHaveLength(scenes.length);

    const stickyVisual = getByTestId(
      storyboard,
      "homepage-workflow-sticky-visual",
    );
    expect(stickyVisual).not.toBeNull();
    expect(
      storyboard.querySelectorAll('[data-testid="homepage-workflow-terminal"]'),
    ).toHaveLength(1);
    expect(
      getByTestId(storyboard, "homepage-workflow-terminal").getAttribute(
        "data-homepage-workflow-terminal-stage",
      ),
    ).toBe("1");
    expect(
      getByTestId(storyboard, "homepage-workflow-agent-work").getAttribute(
        "data-agent-work-visible",
      ),
    ).toBe("false");
    expect(
      getByTestId(
        storyboard,
        "homepage-workflow-terminal-command",
      ).getAttribute("data-terminal-line-visible"),
    ).toBe("false");
    expect(
      getByTestId(storyboard, "homepage-workflow-terminal-input").getAttribute(
        "data-terminal-line-visible",
      ),
    ).toBe("false");
    expect(
      storyboard.querySelectorAll('[data-testid="homepage-workflow-popup"]'),
    ).toHaveLength(1);
    expect(
      getByTestId(storyboard, "homepage-workflow-popup").getAttribute(
        "data-popup-visible",
      ),
    ).toBe("false");
    expect(
      getByTestId(storyboard, "homepage-workflow-popup").getAttribute(
        "aria-hidden",
      ),
    ).toBe("true");
    expect(APP_STYLES).toMatch(
      /\.homepage-workflow-sticky-visual \{[^}]*position:\s*sticky;[^}]*top:\s*2rem;/s,
    );
    expect(APP_STYLES).toMatch(
      /@media \(max-width:\s*899px\) \{[\s\S]*\.homepage-workflow-sticky-visual \{[^}]*position:\s*sticky;[^}]*top:\s*calc\([^}]*100svh[^}]*var\(--homepage-workflow-dock-height\)[^}]*var\(--homepage-workflow-dock-bottom\)[^}]*\);[^}]*bottom:\s*var\(--homepage-workflow-dock-bottom\);/s,
    );
    expect(APP_STYLES).toMatch(
      /@media \(max-width:\s*899px\) \{[\s\S]*\.homepage-workflow-scene-list \{[^}]*padding-bottom:\s*calc\([^}]*var\(--homepage-workflow-dock-height\)[^}]*var\(--homepage-workflow-dock-bottom\)[^}]*\+\s*2rem[^}]*\);/s,
    );
    expect(APP_STYLES).toMatch(
      /@media \(max-width:\s*899px\) \{[\s\S]*\.homepage-workflow-popup \{[^}]*--homepage-workflow-popup-overhang:\s*0rem;[^}]*right:\s*0\.5rem;[^}]*left:\s*0\.5rem;/s,
    );
    expect(APP_STYLES).toMatch(
      /@media \(max-width:\s*899px\) \{[\s\S]*\.homepage-workflow-document-workspace \{[^}]*--homepage-workflow-document-offset-y:\s*clamp\(7rem,\s*15svh,\s*8rem\);/s,
    );
    expect(APP_STYLES).toMatch(
      /\.homepage-workflow-popup \{[^}]*position:\s*absolute;[^}]*bottom:\s*1rem;/s,
    );
    expect(APP_STYLES).toMatch(
      /\.homepage-workflow-popup\[data-popup-visible="false"\] \{[^}]*opacity:\s*0;/s,
    );
    expect(APP_STYLES).toMatch(
      /\.homepage-workflow-terminal-reveal-stack\[data-agent-work-visible="false"\] \{[^}]*max-height:\s*0;[^}]*opacity:\s*0;/s,
    );
    expect(APP_STYLES).toMatch(
      /\.homepage-workflow-document-shell-no-comments \{[^}]*max-width:\s*39rem;/s,
    );

    scenes.forEach((scene, index) => {
      expect(sceneNodes[index]?.textContent).toContain(
        String(index + 1).padStart(2, "0"),
      );
      expect(sceneNodes[index]?.textContent).toContain(scene);
    });

    expect(storyboard.textContent).toContain(
      "Let's make the homepage more persuasive. Write a plan first.",
    );
    expect(storyboard.textContent).toContain(
      "I'll inspect the current homepage, draft a Markdown plan, and open it in Roughdraft for review before I code.",
    );
    expect(storyboard.textContent).toContain(
      'rg "It\'s just Markdown" packages/app/src',
    );
    expect(storyboard.textContent).toContain(
      "sed -n '1,220p' packages/app/src/App.tsx",
    );
    expect(storyboard.textContent).toContain(
      "write .context/homepage-conversion-plan.md",
    );
    expect(storyboard.textContent).toContain("Homepage Conversion Plan");
    expect(storyboard.textContent).toContain(
      'Move the workflow story above "It\'s just Markdown."',
    );
    expect(storyboard.textContent).toContain(
      "Show the agent pause, the review window, and the resume signal.",
    );
    expect(storyboard.textContent).toContain(
      "Keep the format section as proof that the review data is portable Markdown.",
    );
    expect(storyboard.textContent).toContain(
      "Review an agent's plan before it starts coding.",
    );
    expect(storyboard.textContent).not.toContain(
      'This should go above "It\'s just Markdown."',
    );
    expect(storyboard.textContent).not.toContain("Review complete");
    expect(storyboard.textContent).toContain("I read your comments.");
    expect(storyboard.textContent).toContain("Waiting for I'm done...");
  });

  it("renders the Roughdraft flavored Markdown spec page", async () => {
    await act(async () => {
      root.render(<RoughdraftFlavoredMarkdownPage />);
    });

    expect(container.textContent).toContain(
      "Markdown with review comments and suggested changes",
    );
    expect(container.textContent).toContain(
      "regular Markdown plus portable review markup",
    );
    expect(container.textContent).toContain("CriticMarkup");
    expect(container.textContent).toContain("Notion-flavored Markdown");
    expect(container.textContent).toContain("Official RFM spec");
    expect(container.textContent).toContain("Format contract");
    expect(container.textContent).toContain(
      "Review data lives where agents can inspect it",
    );
    expect(container.textContent).toContain("document-local");
    expect(
      container.querySelector('a[href="/spec/roughdraft-flavored-markdown.md"]')
        ?.textContent,
    ).toContain("Official RFM spec");
    expect(
      container.querySelector('a[href="https://criticmarkup.com/"]')
        ?.textContent,
    ).toContain("CriticMarkup");
    expect(
      container.querySelector(
        'a[href="https://developers.notion.com/guides/data-apis/enhanced-markdown"]',
      )?.textContent,
    ).toContain("Notion-flavored Markdown");
    expect(container.textContent).toContain("Threaded review");
    expect(container.textContent).toContain("Roughdraft extensions");
    expect(container.textContent).toContain("Attribute metadata");
    expect(container.textContent).toContain("Substitution");
    expect(container.textContent).toContain("{~~old text~>new text~~}");
    expect(container.querySelector('a[href="/"]')?.textContent).toContain(
      "Back to Roughdraft",
    );
  });

  it("renders an in-memory live preview page", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewPage />
        </TooltipProvider>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("preview.md");
    expect(container.textContent).toContain("Live Preview");
    expect(container.textContent).toContain("This draft only lives in memory.");
    expect(container.textContent).toContain("Select this sentence");
    expect(container.textContent).not.toContain("I'm done");
    expect(container.textContent).not.toContain("Review ready");
    expect(container.textContent).not.toContain("Copy prompt");
    expect(setItem).not.toHaveBeenCalled();
  });
});
