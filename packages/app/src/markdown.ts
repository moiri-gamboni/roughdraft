import { tables, taskListItems } from "@joplin/turndown-plugin-gfm";
import { Lexer, marked } from "marked";
import TurndownService from "turndown";
import { parse as parseYaml } from "yaml";

export const rawMarkdownBlockAttribute = "data-markdown-raw-block";

/*
 * marked masks `code` and <tag> spans out of its emphasis-pairing view
 * (rules.inline.blockSkip) so delimiters never pair across them. Its <...>
 * alternative matches ANY angle-bracket pair, and CriticMarkup comment blocks
 * fake it out: the `<` of one `<<}` and the `>` of the NEXT `{>>` read as a
 * single huge "tag", so between two comments every `**`/`*` came back as
 * literal text. Require a tag-shaped character after `<` — every real tag,
 * closing tag, comment, PI and autolink starts with a letter, `/`, `!` or `?`
 * — so bare angle punctuation cannot mask prose. Patched on the shared rule
 * sets so every lexer (ours and marked's own) sees it; revisit on marked
 * upgrades (a regression test in editor-roundtrip.test.ts guards it).
 */
const flankingSafeBlockSkip =
  /\[[^[\]]*?\]\((?:\.|[^()]|\((?:\.|[^()])*\))*\)|`[^`]*?`|<\/?[A-Za-z!?][^<>]*?>/g;
for (const ruleSet of Object.values(
  Lexer.rules.inline as Record<string, Record<string, unknown>>,
)) {
  if (ruleSet && typeof ruleSet === "object" && "blockSkip" in ruleSet) {
    ruleSet.blockSkip = flankingSafeBlockSkip;
  }
}

/*
 * Source preservation.
 *
 * Serializing a document re-derives it from the editor model, so it comes back
 * in the serializer's conventions rather than the author's. The only way a save
 * cannot rewrite a file is not to serialize the parts that did not change: each
 * top-level block carries the exact source text it was parsed from, plus a hash
 * of the node it produced. If the node still hashes the same on save, its
 * original bytes are emitted verbatim and no serializer runs on it.
 *
 * A block's recorded source includes any blank lines that preceded it, so
 * concatenating the blocks of an untouched document reproduces it byte for byte.
 */
export const SOURCE_TEXT_ATTRIBUTE = "dataMdSource";
export const SOURCE_HASH_ATTRIBUTE = "dataMdSourceHash";

interface RawToken {
  type: string;
  raw: string;
}

/**
 * One entry per block that renders, carrying the blank lines that preceded it.
 * Marked emits blank runs as their own `space` tokens which produce no output,
 * so they are folded into the following block rather than dropped.
 */
export function topLevelSourceBlocks(tokens: unknown[]): string[] {
  const blocks: string[] = [];
  let pendingSpace = "";

  for (const token of tokens as RawToken[]) {
    if (token.type === "space") {
      pendingSpace += token.raw ?? "";
      continue;
    }

    blocks.push(`${pendingSpace}${token.raw ?? ""}`);
    pendingSpace = "";
  }

  // Trailing blank lines belong to the last block, or to an empty document.
  if (pendingSpace) {
    if (blocks.length === 0) blocks.push(pendingSpace);
    else blocks[blocks.length - 1] += pendingSpace;
  }

  return blocks;
}

/** FNV-1a. Only needs to detect change, not resist collisions. */
export function hashSourceNode(node: unknown): string {
  // Key order must not matter: the document is hashed once as parsed and again
  // as the editor hands it back, and the editor emits attributes in schema
  // order rather than the order they were created in.
  const serialized = JSON.stringify(node, (key, value) => {
    if (key === SOURCE_TEXT_ATTRIBUTE || key === SOURCE_HASH_ATTRIBUTE) {
      return undefined;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(
          ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
        ),
      );
    }

    return value;
  });

  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}

export interface MarkdownOptions {
  resolveFileUrl?: (path: string) => string | null;
  resolveLinkUrl?: (path: string) => string | null;
}

export interface YamlFrontmatterSplit {
  frontmatter: string | null;
  body: string;
}

export interface YamlDocumentMetadataSplit {
  frontmatter: string | null;
  body: string;
  endmatter: string | null;
}

function isExternalUrl(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//");
}

function isInPageAnchor(path: string): boolean {
  return path.startsWith("#");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function encodeRawMarkdownBlock(markdown: string): string {
  return encodeURIComponent(markdown);
}

export function decodeRawMarkdownBlock(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function createRawMarkdownBlock(markdown: string): string {
  return `<div ${rawMarkdownBlockAttribute}="${escapeHtml(
    encodeRawMarkdownBlock(markdown),
  )}"></div>\n`;
}

function protectRawHtmlBlocks(markdown: string): string {
  return markdown
    .replace(
      /^[ \t]*<details\b[\s\S]*?<\/details>[ \t]*(?:\r?\n|$)/gim,
      (raw) => createRawMarkdownBlock(raw),
    )
    .replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*(?:\r?\n|$)/gm, (raw) =>
      createRawMarkdownBlock(raw),
    );
}

function protectIndentedCodeAfterLists(markdown: string): string {
  return markdown.replace(
    /^(?:[-*+]|\d+[.)]) [^\r\n]*(?:\r?\n)[ \t]*(?:\r?\n)(?:(?: {4}|\t)[^\r\n]*(?:\r?\n|$))+/gm,
    (raw) => createRawMarkdownBlock(raw),
  );
}

function codeSpanContainsPipe(value: string): boolean {
  return /`[^`\n]*\|[^`\n]*`/.test(value);
}

function protectPipeSensitiveTables(markdown: string): string {
  const lines = markdown.match(/[^\r\n]*(?:\r?\n|$)/g) ?? [];
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";

    if (
      !line.includes("|") ||
      !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(nextLine)
    ) {
      output.push(line);
      continue;
    }

    const tableLines = [line, nextLine];
    index += 2;

    while (index < lines.length) {
      const row = lines[index] ?? "";
      if (!row.trim() || !row.includes("|")) break;
      tableLines.push(row);
      index += 1;
    }

    const raw = tableLines.join("");
    const needsProtection = raw.includes("\\|") || codeSpanContainsPipe(raw);
    output.push(needsProtection ? createRawMarkdownBlock(raw) : raw);
    index -= 1;
  }

  return output.join("");
}

export function protectRichTextRoundTripMarkdown(markdown: string): string {
  return protectPipeSensitiveTables(
    protectIndentedCodeAfterLists(protectRawHtmlBlocks(markdown)),
  );
}

function normalizeMarkdownPath(path: string): string {
  if (path.startsWith("./") || path.startsWith("../")) return path;
  return `./${path.replace(/^\/+/, "")}`;
}

function tableHasUnsupportedMarkdownContent(table: HTMLTableElement): boolean {
  return Boolean(
    table.querySelector(
      "blockquote, h1, h2, h3, h4, h5, h6, hr, ol, pre, table, ul",
    ),
  );
}

function getFirstTableRow(table: HTMLTableElement): HTMLTableRowElement | null {
  return table.rows.length > 0 ? table.rows[0] : null;
}

function isHeaderTableRow(row: HTMLTableRowElement | null): boolean {
  if (!row || row.cells.length === 0) return false;

  return Array.from(row.cells).every((cell) => cell.tagName === "TH");
}

function isMarkdownTableDivider(line: string | undefined): boolean {
  return Boolean(line && /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line));
}

function markdownTableDividerForCell(cell: HTMLTableCellElement): string {
  const alignment = (
    cell.getAttribute("align") ||
    cell.style.textAlign ||
    ""
  ).toLowerCase();

  if (alignment === "left") return ":---";
  if (alignment === "right") return "---:";
  if (alignment === "center") return ":---:";

  return "---";
}

function markdownTableDividerForRow(row: HTMLTableRowElement): string {
  const dividers = Array.from(row.cells).map(markdownTableDividerForCell);
  return `| ${dividers.join(" | ")} |`;
}

function resolveRenderedUrl(
  path: string,
  resolveFileUrl?: MarkdownOptions["resolveFileUrl"],
) {
  if (isExternalUrl(path) || isInPageAnchor(path)) return path;
  return resolveFileUrl?.(path) ?? path;
}

function isYamlFrontmatterDelimiter(line: string): boolean {
  return /^(?:---|\.\.\.)[ \t]*$/.test(line.replace(/\r$/, ""));
}

function isReviewEndmatterMap(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasBodiedComment(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  // body + by + at is the review-comment signature. `re:` entries count too:
  // a reply whose inline root was deleted is orphaned but still review data,
  // and rejecting the endmatter over it dumps the whole YAML block into the
  // document as text.
  return Object.values(value as Record<string, unknown>).some(
    (entry) =>
      Boolean(entry) &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).body === "string" &&
      typeof (entry as Record<string, unknown>).by === "string" &&
      typeof (entry as Record<string, unknown>).at === "string",
  );
}

function isRoughdraftReviewEndmatter(endmatter: string): boolean {
  const yamlText = endmatter.replace(/^---[ \t]*(?:\r\n|\n)/, "");
  let parsed: unknown;

  try {
    parsed = parseYaml(yamlText);
  } catch {
    return false;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }

  const record = parsed as Record<string, unknown>;
  return (
    isReviewEndmatterMap(record.comments) ||
    isReviewEndmatterMap(record.suggestions)
  );
}

export function splitYamlFrontmatter(markdown: string): YamlFrontmatterSplit {
  const openingDelimiter = markdown.match(/^---[ \t]*(?:\r\n|\n)/);
  if (!openingDelimiter) return { frontmatter: null, body: markdown };

  let lineStart = openingDelimiter[0].length;

  while (lineStart < markdown.length) {
    const nextLineBreak = markdown.indexOf("\n", lineStart);
    const lineEnd = nextLineBreak === -1 ? markdown.length : nextLineBreak + 1;
    const line = markdown.slice(
      lineStart,
      nextLineBreak === -1 ? lineEnd : lineEnd - 1,
    );

    if (isYamlFrontmatterDelimiter(line)) {
      let bodyStart = lineEnd;

      while (bodyStart < markdown.length) {
        const blankLineBreak = markdown.indexOf("\n", bodyStart);
        const blankLineEnd =
          blankLineBreak === -1 ? markdown.length : blankLineBreak + 1;
        const blankLine = markdown.slice(
          bodyStart,
          blankLineBreak === -1 ? blankLineEnd : blankLineEnd - 1,
        );

        if (blankLine.replace(/\r$/, "").trim() !== "") break;
        bodyStart = blankLineEnd;
      }

      return {
        frontmatter: markdown.slice(0, bodyStart),
        body: markdown.slice(bodyStart),
      };
    }

    lineStart = lineEnd;
  }

  return { frontmatter: null, body: markdown };
}

export function prependYamlFrontmatter(
  markdown: string,
  frontmatter?: string | null,
): string {
  return frontmatter ? `${frontmatter}${markdown}` : markdown;
}

export function splitYamlDocumentMetadata(
  markdown: string,
): YamlDocumentMetadataSplit {
  const { frontmatter, body } = splitYamlFrontmatter(markdown);
  const matches = [...body.matchAll(/\n---[ \t]*\r?\n/g)];
  const match = matches.at(-1);

  if (!match || match.index === undefined) {
    return { frontmatter, body, endmatter: null };
  }

  const endmatter = body.slice(match.index);
  const candidate = endmatter.replace(/^\n/, "");

  const precedingBody = body.slice(0, match.index);
  if (!isRoughdraftReviewEndmatter(candidate)) {
    return { frontmatter, body, endmatter: null };
  }
  if (!precedingBody.includes("{#")) {
    const yamlText = candidate.replace(/^---[ \t]*(?:\r\n|\n)/, "");
    const parsed = parseYaml(yamlText) as Record<string, unknown> | null;
    if (!hasBodiedComment(parsed?.comments)) {
      return { frontmatter, body, endmatter: null };
    }
  }

  return {
    frontmatter,
    body: body.slice(0, match.index).replace(/\s*$/, "\n"),
    endmatter: candidate,
  };
}

export function appendYamlEndmatter(
  markdown: string,
  endmatter?: string | null,
): string {
  return endmatter
    ? `${markdown.replace(/\s*$/, "\n")}\n${endmatter}`
    : markdown;
}

export function createMarkedRenderer(options?: MarkdownOptions) {
  const renderer = new marked.Renderer();
  const baseRenderer = new marked.Renderer();
  const resolveFileUrl = options?.resolveFileUrl;
  const resolveLinkUrl = options?.resolveLinkUrl;

  renderer.code = ({ text, lang, escaped }) => {
    const language = (lang || "").match(/\S+/)?.[0];
    const content = escaped ? text : escapeHtml(text);
    const classAttr = language
      ? ` class="language-${escapeHtml(language)}"`
      : "";

    return `<pre><code${classAttr}>${content}</code></pre>\n`;
  };

  renderer.link = function ({ href, title, tokens, raw }) {
    const rawHref = href || "";
    const renderedHref = resolveRenderedUrl(
      rawHref,
      (path) => resolveLinkUrl?.(path) ?? resolveFileUrl?.(path) ?? null,
    );
    const text = this.parser.parseInline(tokens);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    const markdownSrcAttr = ` data-markdown-src="${escapeHtml(rawHref)}"`;
    const autolinkAttr =
      !title && raw?.startsWith("<") && raw.endsWith(">")
        ? ' data-markdown-autolink="true"'
        : "";
    // GFM linkifies bare URLs and email addresses that the author never marked
    // up at all. Record that, so serializing can put the plain text back rather
    // than inventing a link -- otherwise prose containing
    // `mailto:someone@example.com` is rewritten to
    // `mailto:[someone@example.com](mailto:someone@example.com)`.
    const bareAutolinkAttr =
      !title && raw !== undefined && raw === text
        ? ' data-markdown-bare-autolink="true"'
        : "";
    const externalAttr =
      isExternalUrl(rawHref) && !rawHref.startsWith("mailto:")
        ? ' target="_blank" rel="noreferrer noopener"'
        : "";

    return `<a href="${escapeHtml(renderedHref)}"${titleAttr}${markdownSrcAttr}${autolinkAttr}${bareAutolinkAttr}${externalAttr}>${text}</a>`;
  };

  // The editor's image node is block-level, so an image inside a <p> gets
  // lifted out of it during parsing and leaves an empty paragraph behind.
  // That phantom block breaks the one-node-per-source-block mapping source
  // preservation depends on, so a paragraph that is only an image (optionally
  // wrapped in a comment anchor) is emitted without the <p>.
  renderer.paragraph = function (token) {
    const content = this.parser.parseInline(token.tokens);

    if (/^(?:<span [^>]*>)?<img [^>]*>(?:<\/span>)?$/.test(content)) {
      return `${content}\n`;
    }

    return `<p>${content}</p>\n`;
  };

  renderer.image = ({ href, title, text }) => {
    const rawHref = href || "";
    const renderedHref = resolveRenderedUrl(rawHref, resolveFileUrl);
    const alt = text || "";
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    const markdownSrcAttr = ` data-markdown-src="${escapeHtml(rawHref)}"`;

    return `<img src="${escapeHtml(renderedHref)}" alt="${escapeHtml(alt)}"${titleAttr}${markdownSrcAttr}>`;
  };

  renderer.heading = function (token) {
    const spacing = token as unknown as {
      compactBefore?: boolean;
      compactAfter?: boolean;
    };
    const before = spacing.compactBefore
      ? ` ${headingSpacing.compactBeforeAttribute}="true"`
      : "";
    const after = spacing.compactAfter
      ? ` ${headingSpacing.compactAfterAttribute}="true"`
      : "";
    const text = this.parser.parseInline(token.tokens);

    return `<h${token.depth}${before}${after}>${text}</h${token.depth}>\n`;
  };

  renderer.list = function (token) {
    const hasTaskItems = token.items.some((item) => item.task);
    if (!hasTaskItems) {
      return baseRenderer.list.call(this, token);
    }

    const items = token.items
      .map((item) => {
        const checked = item.checked ? "true" : "false";
        const inner = this.parser.parse(item.tokens, false);
        return `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${
          item.checked ? ' checked="checked"' : ""
        }><span></span></label><div>${inner}</div></li>`;
      })
      .join("");

    return `<ul data-type="taskList">${items}</ul>`;
  };

  return renderer;
}

const emphasisPunctuation = /[\p{P}\p{S}]/u;

function isEmphasisPunctuation(character: string): boolean {
  return emphasisPunctuation.test(character);
}

function isEmphasisAlphanumeric(character: string): boolean {
  return (
    character !== "" &&
    !/\s/.test(character) &&
    !isEmphasisPunctuation(character)
  );
}

/**
 * Wrap inline content in `*`/`**` so CommonMark actually reads the delimiters
 * as emphasis. A closing run that follows punctuation must not be glued to a
 * letter (`**tiers:**the` is literal), and the mirror holds for an opening
 * run (`the**:tiers**`). Editing can produce exactly that, e.g. deleting the
 * space after `**Both tiers:**`. The edge punctuation moves outside the
 * delimiters: `**Both tiers**:the` renders as intended.
 *
 * Em uses `*` rather than turndown's `_` because `_` can never be intraword,
 * so `s_em_` after a deleted space is literal however it is arranged.
 */
function wrapEmphasis(
  content: string,
  delimiter: string,
  node: HTMLElement,
): string {
  const flanking = (
    node as HTMLElement & {
      flankingWhitespace?: { leading: string; trailing: string };
    }
  ).flankingWhitespace;
  const previousCharacter = flanking?.leading
    ? " "
    : (node.previousSibling?.textContent?.slice(-1) ?? "");
  const nextCharacter = flanking?.trailing
    ? " "
    : (node.nextSibling?.textContent?.charAt(0) ?? "");

  let prefix = "";
  let suffix = "";
  let inner = content;

  // When edge punctuation moves outside the delimiters, any whitespace it
  // exposes must move with it: `**...field **(` leaves the closer after a
  // space, which is just as unreadable as the glued punctuation was.
  if (isEmphasisAlphanumeric(previousCharacter)) {
    const match = inner.match(/^[\p{P}\p{S}]+\s*/u);
    if (match) {
      prefix = match[0];
      inner = inner.slice(prefix.length);
    }
  }

  if (isEmphasisAlphanumeric(nextCharacter)) {
    const match = inner.match(/\s*[\p{P}\p{S}]+$/u);
    if (match) {
      suffix = match[0];
      inner = inner.slice(0, inner.length - suffix.length);
    }
  }

  if (!inner.trim()) return content;

  return `${prefix}${delimiter}${inner}${delimiter}${suffix}`;
}

export function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    // Known limitation: turndown replaces whitespace-only ("blank") nodes
    // here before any rule can see them, so a review span anchored on pure
    // whitespace (a comment or suggested deletion on a lone space) does not
    // survive serialization. Emitting `{-- --}` is not enough either: the
    // flanking whitespace is re-added outside the marker and ProseMirror
    // drops a whitespace-only mark span on reparse. A real fix needs
    // sentinel text through serializer, parser and editor.
    blankReplacement(_content, node) {
      if (node.hasAttribute(rawMarkdownBlockAttribute)) {
        return `\n\n${decodeRawMarkdownBlock(
          node.getAttribute(rawMarkdownBlockAttribute) ?? "",
        ).trimEnd()}\n\n`;
      }

      return (node as HTMLElement & { isBlock?: boolean }).isBlock
        ? "\n\n"
        : "";
    },
  });

  service.use(tables as Parameters<TurndownService["use"]>[0]);
  service.use(taskListItems as Parameters<TurndownService["use"]>[0]);

  // The task-list renderer wraps an item's content in a <div> so the editor can
  // hold a block there. Turndown has no rule for <div>, so the default block
  // handling wraps it in blank lines, and compactListItem then indents them:
  // `- [ ] x` comes back as `- [ ]\n  \n  x\n`. Serialize it inline instead.
  service.addRule("taskItemContent", {
    filter(node) {
      const parent = node.parentNode as HTMLElement | null;
      return (
        node.nodeName === "DIV" &&
        parent?.nodeName === "LI" &&
        parent.getAttribute("data-type") === "taskItem"
      );
    },
    replacement(content) {
      return content.trim();
    },
  });

  // Replay the author's heading spacing. The markers are stripped in
  // applyHeadingSpacing once Turndown has finished joining blocks.
  service.addRule("markdownAwareHeading", {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement(content, node) {
      const element = node as HTMLElement;
      const level = Number(element.nodeName.charAt(1));
      const before =
        element.getAttribute(headingSpacing.compactBeforeAttribute) === "true"
          ? headingSpacing.compactBeforeMarker
          : "";
      const after =
        element.getAttribute(headingSpacing.compactAfterAttribute) === "true"
          ? headingSpacing.compactAfterMarker
          : "";

      return `\n\n${before}${"#".repeat(level)} ${content}${after}\n\n`;
    },
  });

  service.addRule("compactListItem", {
    filter: "li",
    replacement(content, node, options) {
      const trimmed = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n/gm, "\n  ")
        // Indenting every line also indents the empty ones, leaving "  " on a
        // line that should be blank. Invisible, but it is a diff on a file the
        // author only opened.
        .replace(/\n[ \t]+(?=\n|$)/g, "\n");

      let prefix = `${options.bulletListMarker} `;
      const parent = node.parentNode;
      if (parent && parent.nodeName === "OL") {
        const start = (parent as HTMLOListElement).getAttribute("start");
        const index = Array.prototype.indexOf.call(parent.children, node);
        prefix = `${start ? Number(start) + index : index + 1}. `;
      }

      return (
        prefix +
        trimmed +
        (node.nextSibling && !/\n$/.test(trimmed) ? "\n" : "")
      );
    },
  });

  service.addRule("tiptapHeaderTable", {
    filter(node) {
      if (node.tagName !== "TABLE") return false;

      const table = node as HTMLTableElement;
      return (
        !tableHasUnsupportedMarkdownContent(table) &&
        isHeaderTableRow(getFirstTableRow(table))
      );
    },
    replacement(content, node) {
      const table = node as HTMLTableElement;
      const headerRow = getFirstTableRow(table);
      if (!headerRow) return content;

      const lines = content.replace(/\n+/g, "\n").trim().split("\n");
      if (lines.length === 0) return content;

      if (!isMarkdownTableDivider(lines[1])) {
        lines.splice(1, 0, markdownTableDividerForRow(headerRow));
      }

      const captionContent = table.caption?.textContent || "";
      const caption = captionContent ? `${captionContent}\n\n` : "";

      return `\n\n${caption}${lines.join("\n")}\n\n`;
    },
  });

  // Turndown's default escape doubles backslashes and guards line-start
  // syntax, rewriting text the parser never treated as markup. But inline
  // delimiters do need escaping: typed text like `woa*brds` inside emphasis
  // otherwise saves as `*em woa*brds*` and comes back as different markup.
  // A backslash before ASCII punctuation never changes the rendered text.
  service.escape = (value: string) => value.replace(/[*_`~[\]]/g, "\\$&");

  service.addRule("markdownAwareLinks", {
    filter: "a",
    replacement(content, node) {
      const element = node as HTMLAnchorElement;
      const href =
        element.getAttribute("data-markdown-src") ||
        element.getAttribute("href") ||
        "";
      const normalizedHref =
        isExternalUrl(href) || isInPageAnchor(href)
          ? href
          : normalizeMarkdownPath(href);
      const title = element.getAttribute("title");
      const titleMarkdown = title
        ? ` "${title.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
        : "";

      if (
        element.getAttribute("data-markdown-bare-autolink") === "true" &&
        !titleMarkdown
      ) {
        return content;
      }

      if (
        element.getAttribute("data-markdown-autolink") === "true" &&
        !titleMarkdown
      ) {
        return href.startsWith("mailto:")
          ? `<${href.slice("mailto:".length)}>`
          : `<${normalizedHref}>`;
      }

      return `[${content}](${normalizedHref}${titleMarkdown})`;
    },
  });

  service.addRule("markdownAwareImages", {
    filter: "img",
    replacement(_content, node) {
      const element = node as HTMLImageElement;
      const src =
        element.getAttribute("data-markdown-src") ||
        element.getAttribute("src") ||
        "";
      const normalizedSrc = isExternalUrl(src)
        ? src
        : normalizeMarkdownPath(src);
      const alt = element.getAttribute("alt") || "";
      const title = element.getAttribute("title");
      const titleMarkdown = title
        ? ` "${title.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
        : "";
      return `![${alt}](${normalizedSrc}${titleMarkdown})`;
    },
  });

  service.addRule("flankingSafeEmphasis", {
    filter: ["em", "i", "strong", "b"],
    replacement(content, node) {
      if (!content.trim()) return "";
      const delimiter =
        node.nodeName === "STRONG" || node.nodeName === "B" ? "**" : "*";
      return wrapEmphasis(content, delimiter, node as HTMLElement);
    },
  });

  service.addRule("markdownStrikethrough", {
    filter: (node) =>
      node.nodeName === "DEL" ||
      node.nodeName === "S" ||
      node.nodeName === "STRIKE",
    replacement(content) {
      return `~~${content}~~`;
    },
  });

  service.addRule("rawMarkdownBlock", {
    filter: (node) =>
      node.nodeType === 1 &&
      (node as HTMLElement).hasAttribute(rawMarkdownBlockAttribute),
    replacement(_content, node) {
      const encoded =
        (node as HTMLElement).getAttribute(rawMarkdownBlockAttribute) ?? "";
      return `\n\n${decodeRawMarkdownBlock(encoded).trimEnd()}\n\n`;
    },
  });

  return service;
}

const turndown = createTurndownService();

/*
 * Heading spacing.
 *
 * Turndown treats a heading as a block and always separates it with a blank
 * line, so a compact source would gain blank lines on every save. The author's
 * choice is therefore recorded per heading on the way in and replayed on the
 * way out, rather than normalized to one style for everyone.
 *
 * Marked reports the two sides differently: a blank line *before* a heading is
 * its own `space` token, while a blank line *after* one is folded into the
 * heading token's own `raw`.
 */
const COMPACT_BEFORE_MARKER = " rd-compact-before ";
const COMPACT_AFTER_MARKER = " rd-compact-after ";

export const headingSpacing = {
  compactBeforeAttribute: "data-md-compact-before",
  compactAfterAttribute: "data-md-compact-after",
  compactBeforeMarker: COMPACT_BEFORE_MARKER,
  compactAfterMarker: COMPACT_AFTER_MARKER,
};

interface SpacingAnnotatedToken {
  type: string;
  raw: string;
  compactBefore?: boolean;
  compactAfter?: boolean;
}

export function annotateHeadingSpacing(tokens: unknown[]): void {
  const list = tokens as SpacingAnnotatedToken[];

  list.forEach((token, index) => {
    if (token.type !== "heading") return;

    const previous = list[index - 1];
    // Nothing precedes the first block, so it cannot have lost a blank line.
    token.compactBefore =
      previous !== undefined && previous.type !== "space" ? true : undefined;
    token.compactAfter = /\n\n$/.test(token.raw ?? "") ? undefined : true;
  });
}

/**
 * Annotate headings wherever markdown is parsed. Both this module and the
 * CriticMarkup parser call marked separately, so hanging the annotation off a
 * hook keeps them from drifting apart.
 */
export const headingSpacingHooks = {
  processAllTokens(tokens: unknown[]) {
    annotateHeadingSpacing(tokens);
    return tokens;
  },
} as unknown as NonNullable<Parameters<typeof marked.parse>[1]>["hooks"];

function applyHeadingSpacing(md: string): string {
  return md
    .replace(new RegExp(`\\n{2,}${COMPACT_BEFORE_MARKER}`, "g"), "\n")
    .replace(new RegExp(`${COMPACT_AFTER_MARKER}\\n{2,}`, "g"), "\n")
    .replaceAll(COMPACT_BEFORE_MARKER, "")
    .replaceAll(COMPACT_AFTER_MARKER, "");
}

/**
 * Collapse runs of 3+ newlines to 2.
 *
 * This used to also strip the blank line before and after every ATX heading,
 * because Turndown always emits one and a compact source would otherwise gain
 * blank lines on save. But it stripped them unconditionally, so a source that
 * *had* blank lines around its headings lost them — a whole-document diff for
 * a file the author only opened. Heading spacing is now carried through the
 * round trip per heading (see `headingSpacing` markers), so nothing here has
 * to guess.
 */
export function normalizeBlockSpacing(md: string): string {
  // Deliberately does nothing to blank runs. Collapsing 3+ newlines removed
  // blank lines the author wrote, which is a diff on a file they only opened.
  // Turndown's own extra newlines are handled where they are produced.
  return md;
}

/**
 * Final pass for anything Turndown produced. Both this module and the
 * CriticMarkup serializer must run it: it is what strips the heading-spacing
 * markers, so skipping it leaks them into the saved file as literal text.
 */
export function finalizeMarkdown(serialized: string): string {
  return `${applyHeadingSpacing(normalizeBlockSpacing(serialized)).trimEnd()}\n`;
}

export function toMarkdown(html: string): string {
  return finalizeMarkdown(turndown.turndown(html));
}

export function toHtml(markdown: string, options?: MarkdownOptions): string {
  const tokens = marked.lexer(markdown, { gfm: true });
  annotateHeadingSpacing(tokens);

  return marked.parser(tokens, {
    async: false,
    gfm: true,
    renderer: createMarkedRenderer(options),
  }) as string;
}
