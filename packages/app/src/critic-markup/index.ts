import { generateHTML, generateJSON, type JSONContent } from "@tiptap/core";
import {
  Marked,
  type RendererThis,
  type Token,
  type TokenizerAndRendererExtension,
  type TokenizerThis,
  type Tokens,
} from "marked";
import type TurndownService from "turndown";
import { createEditorExtensions } from "../editor-extensions";
import {
  createMarkedRenderer,
  createTurndownService,
  type MarkdownOptions,
} from "../markdown";

export interface CriticComment {
  id: string;
  content: string;
  createdAt: string;
  authorType?: "user" | "ai";
  authorId?: string | null;
  parentCommentId?: string | null;
}

export interface CriticCommentThread {
  comment: CriticComment;
  replies: CriticCommentThread[];
}

interface CriticCommentToken {
  type: "criticCommentAnchor";
  raw: string;
  commentIds: string[];
  tokens: Token[];
}

const extensions = createEditorExtensions("");
const criticCommentAnchorPattern = /^\{==([\s\S]+?)==\}/;
const criticCommentBlockPattern =
  /^\{>>([\s\S]*?)<<\}(?:(\{@([\s\S]+?)@\})|(\{(?:\s*[A-Za-z][A-Za-z0-9_-]*="(?:\\[\s\S]|[^"\\])*")+\s*\}))?/;
const metadataAttributePattern =
  /([A-Za-z][A-Za-z0-9_-]*)="((?:\\[\s\S]|[^"\\])*)"/g;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseLegacyMetadata(
  metadataText?: string,
): Partial<Omit<CriticComment, "content">> {
  const fields = new Map<string, string>();

  for (const part of metadataText?.split(";") ?? []) {
    const [rawKey, ...valueParts] = part.split(":");
    const key = rawKey?.trim();
    const value = valueParts.join(":").trim();

    if (!key || !value) continue;
    fields.set(key, value);
  }

  const author = fields.get("by") ?? "user";

  return {
    id: fields.get("id"),
    createdAt: fields.get("at") ?? new Date().toISOString(),
    authorType: author.toUpperCase() === "AI" ? "ai" : "user",
    authorId: author.toUpperCase() === "AI" ? null : author,
    parentCommentId: fields.get("re") ?? null,
  };
}

function unescapeMetadataAttributeValue(value: string): string {
  return value.replaceAll(/\\([\s\S])/g, "$1");
}

function escapeMetadataAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function parseAttributeMetadata(
  metadataText?: string,
): Partial<Omit<CriticComment, "content">> {
  if (!metadataText?.startsWith("{") || !metadataText.endsWith("}")) {
    return {};
  }

  const fields = new Map<string, string>();
  const content = metadataText.slice(1, -1);

  for (const match of content.matchAll(metadataAttributePattern)) {
    fields.set(match[1], unescapeMetadataAttributeValue(match[2]));
  }

  const author = fields.get("by") ?? "user";

  return {
    id: fields.get("id"),
    createdAt: fields.get("at") ?? new Date().toISOString(),
    authorType: author.toUpperCase() === "AI" ? "ai" : "user",
    authorId: author.toUpperCase() === "AI" ? null : author,
    parentCommentId: fields.get("re") ?? null,
  };
}

function parseMetadata(
  legacyMetadataText?: string,
  attributeMetadataText?: string,
): Partial<Omit<CriticComment, "content">> {
  if (attributeMetadataText) {
    return parseAttributeMetadata(attributeMetadataText);
  }

  return parseLegacyMetadata(legacyMetadataText);
}

function serializeMetadata(comment: CriticComment): string {
  const fields = [
    ["id", comment.id],
    ["by", comment.authorType === "ai" ? "AI" : comment.authorId || "user"],
    ["at", comment.createdAt || new Date().toISOString()],
  ];

  if (comment.parentCommentId) {
    fields.push(["re", comment.parentCommentId]);
  }

  return `{${fields
    .map(([key, value]) => `${key}="${escapeMetadataAttributeValue(value)}"`)
    .join(" ")}}`;
}

export function createNextCommentId(
  existingComments: Iterable<Pick<CriticComment, "id">>,
): string {
  let maxId = 0;

  for (const comment of existingComments) {
    const match = comment.id.match(/^c(\d+)$/);
    if (!match) continue;

    const parsed = Number.parseInt(match[1] || "0", 10);
    if (parsed > maxId) {
      maxId = parsed;
    }
  }

  return `c${maxId + 1}`;
}

function createCommentWithContext(
  partial?: Partial<CriticComment>,
  existingComments: Iterable<Pick<CriticComment, "id">> = [],
): CriticComment {
  const authorType = partial?.authorType ?? "user";

  return {
    id: partial?.id ?? createNextCommentId(existingComments),
    content: partial?.content ?? "",
    createdAt: partial?.createdAt ?? new Date().toISOString(),
    authorType,
    authorId: partial?.authorId ?? (authorType === "ai" ? null : "user"),
    parentCommentId: partial?.parentCommentId ?? null,
  };
}

function buildCommentThreadsFromOrderedComments(
  orderedComments: CriticComment[],
): CriticCommentThread[] {
  const validCommentIds = new Set(orderedComments.map((comment) => comment.id));
  const repliesByParentId = new Map<string, CriticComment[]>();
  const rootComments: CriticComment[] = [];

  for (const comment of orderedComments) {
    const parentCommentId = comment.parentCommentId;

    if (
      !parentCommentId ||
      parentCommentId === comment.id ||
      !validCommentIds.has(parentCommentId)
    ) {
      rootComments.push(comment);
      continue;
    }

    const replies = repliesByParentId.get(parentCommentId) ?? [];
    replies.push(comment);
    repliesByParentId.set(parentCommentId, replies);
  }

  const buildNode = (comment: CriticComment): CriticCommentThread => ({
    comment,
    replies: (repliesByParentId.get(comment.id) ?? []).map(buildNode),
  });

  return rootComments.map(buildNode);
}

export function buildCommentThreads(
  comments: Iterable<CriticComment>,
): CriticCommentThread[] {
  return buildCommentThreadsFromOrderedComments([...comments]);
}

export function flattenCommentThreads(
  threads: Iterable<CriticCommentThread>,
): CriticComment[] {
  const orderedComments: CriticComment[] = [];

  const visit = (thread: CriticCommentThread) => {
    orderedComments.push(thread.comment);
    for (const reply of thread.replies) {
      visit(reply);
    }
  };

  for (const thread of threads) {
    visit(thread);
  }

  return orderedComments;
}

export function getOrderedAnchorComments(
  commentIds: string[],
  comments: ReadonlyMap<string, CriticComment>,
): CriticComment[] {
  const visibleComments = commentIds
    .map((commentId) => comments.get(commentId))
    .filter((comment): comment is CriticComment => Boolean(comment));

  return flattenCommentThreads(buildCommentThreads(visibleComments));
}

export function getCommentDescendantIds(
  commentId: string,
  comments: ReadonlyMap<string, CriticComment>,
): string[] {
  const childrenByParentId = new Map<string, string[]>();

  for (const comment of comments.values()) {
    if (!comment.parentCommentId || comment.parentCommentId === comment.id) {
      continue;
    }

    const childIds = childrenByParentId.get(comment.parentCommentId) ?? [];
    childIds.push(comment.id);
    childrenByParentId.set(comment.parentCommentId, childIds);
  }

  const descendantIds: string[] = [];
  const stack = [...(childrenByParentId.get(commentId) ?? [])].reverse();

  while (stack.length > 0) {
    const nextCommentId = stack.pop();
    if (!nextCommentId) continue;

    descendantIds.push(nextCommentId);

    const childIds = childrenByParentId.get(nextCommentId) ?? [];
    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      const childId = childIds[index];
      if (childId) {
        stack.push(childId);
      }
    }
  }

  return descendantIds;
}

function tokenizeCriticCommentAnchor(
  lexer: TokenizerThis["lexer"],
  src: string,
  existingComments: Iterable<Pick<CriticComment, "id">>,
):
  | {
      token: CriticCommentToken;
      comments: CriticComment[];
    }
  | undefined {
  const anchorMatch = src.match(criticCommentAnchorPattern);

  if (!anchorMatch) return undefined;

  const [, anchor] = anchorMatch;
  let raw = anchorMatch[0];
  let offset = raw.length;
  const parsedComments: CriticComment[] = [];

  while (offset < src.length) {
    const nextMatch = src.slice(offset).match(criticCommentBlockPattern);
    if (!nextMatch) break;

    const [, commentText, , legacyMetadataText, attributeMetadataText] =
      nextMatch;
    const comment = createCommentWithContext(
      {
        ...parseMetadata(legacyMetadataText, attributeMetadataText),
        content: commentText,
      },
      [...existingComments, ...parsedComments],
    );
    parsedComments.push(comment);
    raw += nextMatch[0];
    offset += nextMatch[0].length;
  }

  if (parsedComments.length === 0) return undefined;

  return {
    token: {
      type: "criticCommentAnchor",
      raw,
      commentIds: parsedComments.map((comment) => comment.id),
      tokens: lexer.inlineTokens(anchor),
    },
    comments: parsedComments,
  };
}

function addCriticCommentRule(
  service: TurndownService,
  comments: Map<string, CriticComment>,
) {
  service.addRule("criticComment", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      (node as HTMLElement).hasAttribute("data-comment-ids"),
    replacement(content, node) {
      const commentIdsText = (node as HTMLElement).getAttribute(
        "data-comment-ids",
      );

      if (!commentIdsText) return content;

      let commentIds: string[] = [];

      try {
        commentIds = JSON.parse(commentIdsText) as string[];
      } catch {
        return content;
      }

      const orderedComments = getOrderedAnchorComments(commentIds, comments);
      if (orderedComments.length === 0) return content;

      const [firstComment, ...remainingComments] = orderedComments;
      let result = `{==${content}==}{>>${firstComment.content}<<}${serializeMetadata(firstComment)}`;

      for (const comment of remainingComments) {
        result += `{>>${comment.content}<<}${serializeMetadata(comment)}`;
      }

      return result;
    },
  });
}

function createCriticMarked(markdownOptions?: MarkdownOptions) {
  const comments = new Map<string, CriticComment>();
  const renderer = createMarkedRenderer(markdownOptions);
  const parser = new Marked({
    gfm: true,
    async: false,
    renderer,
  });

  parser.use({
    extensions: [
      {
        name: "criticCommentAnchor",
        level: "inline",
        start(src: string) {
          return src.indexOf("{==");
        },
        tokenizer(this: TokenizerThis, src: string) {
          const result = tokenizeCriticCommentAnchor(
            this.lexer,
            src,
            comments.values(),
          );
          if (!result) return undefined;

          for (const comment of result.comments) {
            comments.set(comment.id, comment);
          }
          return result.token;
        },
        renderer(this: RendererThis, token: Tokens.Generic) {
          const criticToken = token as CriticCommentToken;
          return `<span data-comment-ids="${escapeHtml(
            JSON.stringify(criticToken.commentIds),
          )}">${this.parser.parseInline(criticToken.tokens)}</span>`;
        },
        childTokens: ["tokens"],
      } satisfies TokenizerAndRendererExtension,
    ],
  });

  return { parser, comments };
}

export function criticMarkdownToEditorState(
  markdown: string,
  options?: MarkdownOptions,
): { doc: JSONContent; comments: Map<string, CriticComment> } {
  const { parser, comments } = createCriticMarked(options);
  const html = parser.parse(markdown) as string;
  const doc = generateJSON(html, extensions);

  return { doc, comments };
}

export function editorStateToCriticMarkdown(
  doc: JSONContent,
  comments: Map<string, CriticComment>,
): string {
  const html = generateHTML(doc, extensions);
  const service = createTurndownService();
  addCriticCommentRule(service, comments);
  return `${service.turndown(html).trimEnd()}\n`;
}

export function createCriticComment(
  partial?: Partial<CriticComment>,
  options?: {
    existingComments?: Iterable<Pick<CriticComment, "id">>;
  },
): CriticComment {
  return createCommentWithContext(partial, options?.existingComments);
}
