import { describe, expect, it } from "vitest";
import { toHtml, toMarkdown } from "./markdown";

function roundTrip(markdown: string): string {
  return toMarkdown(toHtml(markdown));
}

describe("markdown round-trip stability", () => {
  it("leaves a task list item unchanged", () => {
    const input = "- [ ] `existing/01-a-way-to-visualize` (body+props)\n";
    expect(roundTrip(input)).toBe(input);
  });

  it("leaves a checked task list item unchanged", () => {
    const input = "- [x] done thing\n- [ ] pending thing\n";
    expect(roundTrip(input)).toBe(input);
  });

  it("does not autolink a bare email inside prose", () => {
    const input =
      "renders mailto:operations@apartresearch.com?subject=unsubscribe — a mail client action\n";
    expect(roundTrip(input)).toBe(input);
  });

  it("does not rewrite a bare URL into an explicit link", () => {
    const input = "see https://example.com/path for details\n";
    expect(roundTrip(input)).toBe(input);
  });

  it("still writes a genuine link with distinct text", () => {
    const input = "see [the docs](https://example.com/path) for details\n";
    expect(roundTrip(input)).toBe(input);
  });
});
