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
    await act(async () => {
      root.render(
        <Homepage
          message="Roughdraft is a markdown editor with commenting and suggest changes mode, making it easier to align with AI on complex ideas."
          updateStatus={null}
        />,
      );
      await Promise.resolve();
    });

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
    expect(container.querySelector(".rfm-format-demo")?.className).toContain(
      "max-w-none",
    );
    const formatDemoGrid = container.querySelector(
      ".rfm-format-demo > div:nth-of-type(3)",
    );
    const formatDemoArrow = formatDemoGrid?.children.item(1);
    expect(formatDemoArrow?.className).toContain("items-start");
    expect(APP_STYLES).toMatch(
      /\.rfm-result-editor \.document-page-shell \{[^}]*grid-template-columns:\s*minmax\(0,\s*min\(100%,\s*42rem\)\)\s+minmax\(13rem,\s*16rem\);[^}]*justify-content:\s*start;/s,
    );
    expect(APP_STYLES).not.toContain("rfm-token-");
    expect(container.querySelector('[class*="rfm-token-"]')).toBeNull();
    expect(
      container.querySelector(".comment-anchor[data-comment-ids]"),
    ).not.toBeNull();
    expect(
      container.querySelector(".critic-change[data-critic-change-id]"),
    ).not.toBeNull();
    expect(container.textContent).toContain("Review workflow");
    expect(container.textContent).toContain(
      "Pass the same Markdown file back and forth with your agent.",
    );
    expect(container.textContent).toContain("Review an agent's draft");
    expect(container.textContent).toContain(
      "tell the agent to read the file again",
    );
    expect(container.textContent).toContain("Ask the agent to review yours");
    expect(container.textContent).toContain(
      "leave detailed comments, questions, and suggested edits",
    );
    expect(
      container.querySelectorAll('[contenteditable="plaintext-only"]'),
    ).toHaveLength(0);
    expect(
      container
        .querySelector('img[alt="Roughdraft markdown review workspace"]')
        ?.getAttribute("src"),
    ).toBe("/sneak-peek.png");
    expect(document.body.textContent).not.toContain(AGENT_SETUP_PROMPT);

    const cta = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Install Now"),
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

    const planReviewButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Review a plan"),
    );

    expect(planReviewButton).toBeDefined();
    if (!planReviewButton) throw new Error("Plan review example not found");

    await click(planReviewButton);

    expect(container.textContent).toContain("Agent Plan Review");
    expect(container.textContent).toContain(
      "rollback note for the migration step",
    );
    expect(container.textContent).toContain('re="s1"');

    expect(cta).toBeDefined();
    if (!cta) throw new Error("CTA not found");

    await click(cta);

    expect(document.body.textContent).toContain(
      "Copy this into your coding agent",
    );
    expect(document.body.textContent).toContain(AGENT_SETUP_PROMPT);

    const copyButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Copy prompt"),
    );

    expect(copyButton).toBeDefined();
    if (!copyButton) throw new Error("Copy button not found");

    await click(copyButton);

    expect(writeText).toHaveBeenCalledWith(AGENT_SETUP_PROMPT);
    expect(document.body.textContent).toContain("Copied");
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
    expect(setItem).not.toHaveBeenCalled();
  });
});
