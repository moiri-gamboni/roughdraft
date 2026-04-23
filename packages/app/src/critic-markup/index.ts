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

interface CriticCommentToken {
  type: "criticCommentAnchor";
  raw: string;
  commentIds: string[];
  tokens: Token[];
}

const extensions = createEditorExtensions("");
const criticCommentWithAnchorPattern =
  /^\{==([\s\S]+?)==\}\{>>([\s\S]*?)<<\}(?:\{@([\s\S]+?)@\})?/;

function createCommentId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `cmt_${crypto.randomUUID()}`;
  }

  return `cmt_${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseMetadata(metadataText?: string): Omit<CriticComment, "content"> {
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
    id: fields.get("id") ?? createCommentId(),
    createdAt: fields.get("at") ?? new Date().toISOString(),
    authorType: author.toUpperCase() === "AI" ? "ai" : "user",
    authorId: author.toUpperCase() === "AI" ? null : author,
    parentCommentId: fields.get("re") ?? null,
  };
}

function serializeMetadata(comment: CriticComment): string {
  const fields = [
    `id:${comment.id}`,
    `by:${comment.authorType === "ai" ? "AI" : comment.authorId || "user"}`,
    `at:${comment.createdAt || new Date().toISOString()}`,
  ];

  if (comment.parentCommentId) {
    fields.push(`re:${comment.parentCommentId}`);
  }

  return `{@${fields.join(";")}@}`;
}

function tokenizeCriticCommentAnchor(
  lexer: TokenizerThis["lexer"],
  src: string,
):
  | {
      token: CriticCommentToken;
      comment: CriticComment;
    }
  | undefined {
  const match = src.match(criticCommentWithAnchorPattern);

  if (!match) return undefined;

  const [, anchor, commentText, metadataText] = match;
  const comment: CriticComment = {
    ...parseMetadata(metadataText),
    content: commentText,
  };

  return {
    token: {
      type: "criticCommentAnchor",
      raw: match[0],
      commentIds: [comment.id],
      tokens: lexer.inlineTokens(anchor),
    },
    comment,
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

      const rootComments = commentIds
        .map((commentId) => comments.get(commentId))
        .filter(
          (comment): comment is CriticComment =>
            comment != null && !comment.parentCommentId,
        );

      if (rootComments.length === 0) return content;

      const [firstComment, ...remainingComments] = rootComments;
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
          const result = tokenizeCriticCommentAnchor(this.lexer, src);
          if (!result) return undefined;

          comments.set(result.comment.id, result.comment);
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
): CriticComment {
  const authorType = partial?.authorType ?? "user";

  return {
    id: partial?.id ?? createCommentId(),
    content: partial?.content ?? "",
    createdAt: partial?.createdAt ?? new Date().toISOString(),
    authorType,
    authorId: partial?.authorId ?? (authorType === "ai" ? null : "user"),
    parentCommentId: partial?.parentCommentId ?? null,
  };
}
