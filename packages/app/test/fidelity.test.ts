import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
} from "../src/critic-markup";

/**
 * The contract: opening a document and saving it without editing anything must
 * return the same bytes. Anything else is the app rewriting a file the reviewer
 * only read, which is how a 342-line document once produced an 891-line diff.
 *
 * These go through the editor rather than toHtml/toMarkdown, because that is
 * the path a save actually takes.
 */
const FIXTURE_DIR = path.join(process.cwd(), "test", "fixtures", "fidelity");

function loadAndSave(markdown: string): string {
  const { doc, comments, frontmatter, endmatter } =
    criticMarkdownToEditorState(markdown);
  return editorStateToCriticMarkdown(doc, comments, { frontmatter, endmatter });
}

const fixtures = fs
  .readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith(".md"))
  .sort();

describe("byte fidelity: load then save changes nothing", () => {
  for (const name of fixtures) {
    it(name, () => {
      const source = fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
      expect(loadAndSave(source)).toBe(source);
    });
  }
});
